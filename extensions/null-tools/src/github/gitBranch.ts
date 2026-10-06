'use strict';

import { execFileSync } from 'child_process';

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export function branchNameForIssue(issueNumber: number, title: string): string {
  const slug = slugify(title);
  return slug ? `issue-${issueNumber}-${slug}` : `issue-${issueNumber}`;
}

/** The number in `issue-<n>` or `issue-<n>-<slug>`, the names `branchNameForIssue` makes. */
export function issueNumberFromBranch(name: string | undefined): number | null {
  const match = /^issue-(\d{1,9})(?:-|$)/.exec(name ?? '');
  const n = match ? Number(match[1]) : 0;
  return n > 0 ? n : null;
}

/**
 * Decides which HEAD changes deserve an "open this issue?" prompt. The git extension reports every
 * status change, not just branch switches, so this keeps a prompt to a real switch onto a branch we
 * haven't offered yet.
 */
export class BranchIssueTracker {
  private readonly last = new Map<string, string | undefined>();
  private readonly offered = new Set<string>();
  private readonly created = new Set<string>();

  /** The issue number to offer, or null. Call on every HEAD change; the first call per repo only records it. */
  onHead(repoKey: string, branch: string | undefined): number | null {
    const previous = this.last.get(repoKey);
    this.last.set(repoKey, branch);
    // ponytail: an unknown previous HEAD (startup, still loading, detached) never prompts, so leaving a
    // detached HEAD onto an issue branch is missed. Track "seen a real branch" separately if that matters.
    if (!previous || !branch || previous === branch) return null;
    const n = issueNumberFromBranch(branch);
    if (n === null) return null;
    const key = `${repoKey}\0${branch}`;
    if (this.offered.has(key)) return null;
    this.offered.add(key);
    if (this.created.delete(branch)) return null;
    return n;
  }

  /** The panel just created `branch`: its first checkout is the user's own doing, not news. */
  skip(branch: string): void {
    this.created.add(branch);
  }
}

export const branchIssueTracker = new BranchIssueTracker();

export function createIssueBranch(cwd: string, issueNumber: number, title: string): { ok: true; branch: string } | { ok: false; message: string } {
  const branch = branchNameForIssue(issueNumber, title);
  try {
    execFileSync('git', ['checkout', '-b', branch], { cwd, encoding: 'utf8', timeout: 5000 });
    branchIssueTracker.skip(branch);
    return { ok: true, branch };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

const CLOSING_KEYWORD_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;

/** Issue numbers that unpushed local commits will close, via GitHub's closing-keyword syntax. */
export function getLocallyClosedIssueNumbers(cwd: string): Set<number> {
  const numbers = new Set<number>();
  let log: string;
  try {
    // @{u}..HEAD throws when there's no upstream (fresh branch, detached HEAD) — treat as "nothing unpushed".
    log = execFileSync('git', ['log', '--format=%B', '@{u}..HEAD'], { cwd, encoding: 'utf8', timeout: 5000 });
  } catch {
    return numbers;
  }
  for (const match of log.matchAll(CLOSING_KEYWORD_RE)) {
    numbers.add(Number(match[1]));
  }
  return numbers;
}

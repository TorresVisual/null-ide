'use strict';

import { execFileSync } from 'child_process';

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export function branchNameForIssue(issueNumber: number, title: string): string {
  const slug = slugify(title);
  return slug ? `issue-${issueNumber}-${slug}` : `issue-${issueNumber}`;
}

export function createIssueBranch(cwd: string, issueNumber: number, title: string): { ok: true; branch: string } | { ok: false; message: string } {
  const branch = branchNameForIssue(issueNumber, title);
  try {
    execFileSync('git', ['checkout', '-b', branch], { cwd, encoding: 'utf8', timeout: 5000 });
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

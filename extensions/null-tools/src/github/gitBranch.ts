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

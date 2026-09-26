'use strict';

import { execFileSync } from 'child_process';

export interface WorktreeBase {
  path: string;
  branch: string | null;
  head: string;
  isCurrent: boolean;
  prunable: boolean;
}

export interface WorktreeEntry extends WorktreeBase {
  dirty: boolean;
  ahead: number;
  behind: number;
  aheadBase: number;
  behindBase: number;
  lastCommitSubject: string;
  lastCommitDate: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}

export function parseWorktreeListPorcelain(output: string, currentPath: string): WorktreeBase[] {
  const current = normalizePath(currentPath);
  return output
    .split(/\r?\n\r?\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      let wtPath = '', head = '', branch: string | null = null, prunable = false;
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) wtPath = line.slice('worktree '.length).trim();
        else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim();
        else if (line.startsWith('branch ')) branch = line.slice('branch '.length).replace('refs/heads/', '').trim();
        else if (line === 'detached') branch = null;
        else if (line.startsWith('prunable')) prunable = true;
      }
      return { path: wtPath, branch, head, prunable, isCurrent: normalizePath(wtPath) === current };
    });
}

export function getBaseBranch(repoCwd: string): string {
  try {
    const ref = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 }).trim();
    return ref.replace(/^refs\/remotes\/origin\//, '');
  } catch {
    // no remote, or origin/HEAD not set
  }
  for (const candidate of ['main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', `refs/heads/${candidate}`], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 });
      return candidate;
    } catch {
      // candidate branch doesn't exist
    }
  }
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 }).trim();
}

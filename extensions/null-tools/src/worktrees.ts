'use strict';

import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { computeGitStatuses } from './dashboardGitStatus';

const execFileAsync = promisify(execFile);

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

interface WorktreeStatusFields {
  dirty: boolean;
  ahead: number;
  behind: number;
  aheadBase: number;
  behindBase: number;
  lastCommitSubject: string;
  lastCommitDate: string;
}

async function fetchWorktreeStatus(
  worktreePath: string,
  branch: string | null,
  head: string,
  baseBranch: string,
): Promise<WorktreeStatusFields | null> {
  try {
    const { stdout: porcelain } = await execFileAsync('git', ['status', '--porcelain'], { cwd: worktreePath, timeout: 5000 });
    const dirty = porcelain.trim().length > 0;

    let ahead = 0, behind = 0;
    if (branch) {
      try {
        const { stdout } = await execFileAsync('git', ['rev-list', '--left-right', '--count', `${branch}...${branch}@{u}`], { cwd: worktreePath, timeout: 5000 });
        [ahead, behind] = stdout.trim().split(/\s+/).map(Number);
      } catch {
        // no upstream configured
      }
    }

    let aheadBase = 0, behindBase = 0;
    try {
      const ref = branch ?? head;
      const { stdout } = await execFileAsync('git', ['rev-list', '--left-right', '--count', `${ref}...${baseBranch}`], { cwd: worktreePath, timeout: 5000 });
      [aheadBase, behindBase] = stdout.trim().split(/\s+/).map(Number);
    } catch {
      // base branch unresolvable from this worktree
    }

    const { stdout: log } = await execFileAsync('git', ['log', '-1', '--format=%s%x1f%cI', 'HEAD'], { cwd: worktreePath, timeout: 5000 });
    const [lastCommitSubject, lastCommitDate] = log.trim().split('\x1f');

    return { dirty, ahead, behind, aheadBase, behindBase, lastCommitSubject: lastCommitSubject ?? '', lastCommitDate: lastCommitDate ?? '' };
  } catch {
    return null;
  }
}

export async function listWorktrees(repoCwd: string): Promise<WorktreeEntry[]> {
  const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoCwd, timeout: 10000 });
  const base = parseWorktreeListPorcelain(stdout, repoCwd);
  if (base.length === 0) return [];

  const baseBranch = getBaseBranch(repoCwd);
  const byPath = new Map(base.map(e => [e.path, e]));
  const statuses = new Map<string, WorktreeStatusFields | null>();

  await computeGitStatuses<WorktreeStatusFields>(
    base.map(e => e.path),
    (p, status) => statuses.set(p, status),
    4,
    (p) => {
      const entry = byPath.get(p)!;
      return fetchWorktreeStatus(p, entry.branch, entry.head, baseBranch);
    },
  );

  return base.map(entry => {
    const status = statuses.get(entry.path);
    return {
      ...entry,
      dirty: status?.dirty ?? false,
      ahead: status?.ahead ?? 0,
      behind: status?.behind ?? 0,
      aheadBase: status?.aheadBase ?? 0,
      behindBase: status?.behindBase ?? 0,
      lastCommitSubject: status?.lastCommitSubject ?? '',
      lastCommitDate: status?.lastCommitDate ?? '',
    };
  });
}

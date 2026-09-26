'use strict';

import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { computeGitStatuses } from './dashboardGitStatus';
import { branchNameForIssue } from './github/gitBranch';
import { slugify } from './scratchNotesStorage';

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

export function resolveMainWorktreeRoot(repoCwd: string): string {
  try {
    const stdout = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoCwd, encoding: 'utf8', timeout: 10000 });
    return parseWorktreeListPorcelain(stdout, repoCwd)[0]?.path ?? repoCwd;
  } catch {
    return repoCwd;
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

export type CreateWorktreeOptions =
  | { kind: 'issue'; issueNumber: number; title: string }
  | { kind: 'branch'; branch: string }
  | { kind: 'scratch'; description: string };

function ensureWorktreesIgnored(repoCwd: string): void {
  try {
    execFileSync('git', ['check-ignore', '-q', '.claude/worktrees'], { cwd: repoCwd, stdio: 'ignore' });
    return; // already ignored
  } catch (err) {
    if ((err as { status?: number }).status !== 1) return; // not a "no match" result — leave .gitignore alone
  }
  const gitignorePath = path.join(repoCwd, '.gitignore');
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  if (existing.includes('.claude/worktrees')) return;
  const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(gitignorePath, `${existing}${sep}.claude/worktrees/\n`);
  try {
    execFileSync('git', ['add', '--', '.gitignore'], { cwd: repoCwd, timeout: 5000 });
    execFileSync('git', ['commit', '-q', '-m', 'chore: ignore .claude/worktrees/', '--', '.gitignore'], { cwd: repoCwd, timeout: 5000 });
  } catch {
    // leave the .gitignore edit uncommitted — the caller's own dirty checks (e.g. mergeWorktreeBack) still see it
  }
}

function branchExists(repoCwd: string, branch: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoCwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function createWorktree(repoCwd: string, opts: CreateWorktreeOptions): Result<{ path: string; branch: string }> {
  let branch: string;
  let isNewBranch: boolean;
  switch (opts.kind) {
    case 'issue':
      branch = branchNameForIssue(opts.issueNumber, opts.title);
      isNewBranch = true;
      break;
    case 'branch':
      branch = opts.branch;
      isNewBranch = false;
      break;
    case 'scratch':
      branch = slugify(opts.description);
      isNewBranch = true;
      break;
  }
  if (isNewBranch && branchExists(repoCwd, branch)) isNewBranch = false;

  const worktreePath = path.join(repoCwd, '.claude', 'worktrees', branch);
  if (fs.existsSync(worktreePath)) {
    return { ok: false, message: `A worktree already exists at ${worktreePath}.` };
  }

  ensureWorktreesIgnored(repoCwd);

  try {
    const args = isNewBranch
      ? ['worktree', 'add', '-b', branch, worktreePath]
      : ['worktree', 'add', worktreePath, branch];
    execFileSync('git', args, { cwd: repoCwd, encoding: 'utf8', timeout: 15000 });
    return { ok: true, value: { path: worktreePath, branch } };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export function listLocalBranches(repoCwd: string): string[] {
  try {
    const stdout = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 });
    return stdout.split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function removeWorktree(repoCwd: string, worktreePath: string, force: boolean): Result<void> {
  try {
    const args = force ? ['worktree', 'remove', '--force', worktreePath] : ['worktree', 'remove', worktreePath];
    execFileSync('git', args, { cwd: repoCwd, encoding: 'utf8', timeout: 15000 });
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export type MergeBackResult =
  | { ok: true; value: { mode: 'ff' | 'merge' } }
  | { ok: false; reason: 'dirty' | 'checkout' | 'merge'; message: string };

export function mergeWorktreeBack(
  repoCwd: string, branch: string, baseBranch: string, mode: 'ff-only' | 'merge',
): MergeBackResult {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 });
  if (status.trim().length > 0) {
    return { ok: false, reason: 'dirty', message: `${repoCwd} has uncommitted changes — commit or stash before merging back.` };
  }

  try {
    execFileSync('git', ['checkout', baseBranch], { cwd: repoCwd, encoding: 'utf8', timeout: 10000 });
  } catch (err) {
    return { ok: false, reason: 'checkout', message: `Failed to check out ${baseBranch}: ${(err as Error).message}` };
  }

  try {
    execFileSync('git', ['merge', mode === 'ff-only' ? '--ff-only' : '--no-edit', branch], { cwd: repoCwd, encoding: 'utf8', timeout: 10000 });
    return { ok: true, value: { mode: mode === 'ff-only' ? 'ff' : 'merge' } };
  } catch (err) {
    return { ok: false, reason: 'merge', message: (err as Error).message };
  }
}

export async function pruneCandidates(
  repoCwd: string, baseBranch: string,
): Promise<{ merged: WorktreeEntry[]; missing: WorktreeEntry[] }> {
  const entries = await listWorktrees(repoCwd);
  const merged: WorktreeEntry[] = [];
  const missing: WorktreeEntry[] = [];

  let mergedBranches: string[] = [];
  try {
    const stdout = execFileSync('git', ['branch', '--merged', baseBranch, '--format=%(refname:short)'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 });
    mergedBranches = stdout.split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    // leave mergedBranches empty — nothing will be classified as merged
  }

  for (const entry of entries) {
    if (entry.isCurrent) continue;
    if (entry.prunable) { missing.push(entry); continue; }
    if (entry.branch && mergedBranches.includes(entry.branch)) merged.push(entry);
  }
  return { merged, missing };
}

export function pruneWorktrees(repoCwd: string): Result<void> {
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: repoCwd, encoding: 'utf8', timeout: 10000 });
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/// <reference path="./protocol.ts" />
'use strict';

import { Result } from '../worktrees';
import { RunGit } from './gitRun';

export type CheckoutTarget =
  | { kind: 'branch'; name: string }
  | { kind: 'remote'; name: string }
  | { kind: 'detach'; sha: string };

export interface StoppedInfo {
  /** True when git stopped mid-operation (conflict or empty pick) and the operation is still in progress. */
  stopped: boolean;
  message: string;
}

export interface ResetImpact {
  branch: string | null;
  /** Commits that stop being on the current branch. */
  leaving: number;
  /** Of those, commits no other branch, tag or remote ref contains. */
  orphaned: number;
  /** Tracked files with changes; `reset --hard` would overwrite them (untracked files are never touched). */
  trackedChanges: number;
}

type InProgress = () => Promise<GraphInProgress | null>;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (message: string): Result<never> => ({ ok: false, message });
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function run(git: RunGit, args: string[]): Promise<Result<void>> {
  try {
    await git(args);
    return ok(undefined);
  } catch (err) {
    return fail(messageOf(err));
  }
}

export function checkout(git: RunGit, target: CheckoutTarget): Promise<Result<void>> {
  switch (target.kind) {
    case 'branch': return run(git, ['checkout', target.name, '--']);
    case 'remote': return run(git, ['switch', '--track', target.name]);
    case 'detach': return run(git, ['checkout', '--detach', target.sha]);
  }
}

export async function createBranch(git: RunGit, name: string, sha: string): Promise<Result<void>> {
  if (!name || name.startsWith('-')) return fail(`"${name}" is not a valid branch name.`);
  try {
    await git(['check-ref-format', '--branch', name]);
  } catch {
    return fail(`"${name}" is not a valid branch name.`);
  }
  return run(git, ['switch', '-c', name, sha]);
}

/** Runs a cherry-pick/revert/continue/skip/abort. A non-zero exit with the operation still in progress is a stop, not a failure. */
async function sequencer(git: RunGit, inProgress: InProgress, args: string[]): Promise<Result<StoppedInfo>> {
  try {
    const out = await git(args);
    return ok({ stopped: false, message: out.trim() });
  } catch (err) {
    if (await inProgress()) return ok({ stopped: true, message: messageOf(err) });
    return fail(messageOf(err));
  }
}

const parentArgs = (parent?: number): string[] => (parent ? ['-m', String(parent)] : []);

export function cherryPick(git: RunGit, inProgress: InProgress, sha: string, parent?: number): Promise<Result<StoppedInfo>> {
  return sequencer(git, inProgress, ['cherry-pick', ...parentArgs(parent), sha]);
}

export function revert(git: RunGit, inProgress: InProgress, sha: string, parent?: number): Promise<Result<StoppedInfo>> {
  return sequencer(git, inProgress, ['revert', '--no-edit', ...parentArgs(parent), sha]);
}

export async function resumeOperation(
  git: RunGit,
  inProgress: InProgress,
  action: 'continue' | 'skip' | 'abort',
): Promise<Result<StoppedInfo>> {
  const operation = await inProgress();
  if (!operation) return fail('No operation is in progress.');
  if (operation.kind === 'merge' && action === 'skip') return fail('A merge cannot be skipped; continue or abort it.');
  return sequencer(git, inProgress, [operation.kind, `--${action}`]);
}

export function reset(git: RunGit, mode: 'soft' | 'mixed' | 'hard', sha: string): Promise<Result<void>> {
  return run(git, ['reset', `--${mode}`, sha, '--']);
}

async function count(git: RunGit, args: string[]): Promise<number> {
  return Number((await git(args)).trim()) || 0;
}

export async function resetImpact(git: RunGit, sha: string): Promise<Result<ResetImpact>> {
  try {
    let branch: string | null = null;
    try { branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() || null; } catch { /* detached */ }
    const leaving = await count(git, ['rev-list', '--count', 'HEAD', '--not', sha]);
    // After --not every later ref is negated; --exclude (before the glob) keeps the current branch from hiding its own commits.
    const orphaned = await count(git, [
      'rev-list', '--count', 'HEAD', '--not', sha, ...(branch ? [`--exclude=${branch}`] : []), '--branches', '--tags', '--remotes',
    ]);
    let trackedChanges = 0;
    try { trackedChanges = (await git(['diff', '--name-only', '-z', 'HEAD'])).split('\0').filter(Boolean).length; } catch { /* no commits */ }
    return ok({ branch, leaving, orphaned, trackedChanges });
  } catch (err) {
    return fail(messageOf(err));
  }
}

export type PullOutcome =
  | { kind: 'upToDate' }
  | { kind: 'fastForwarded'; commits: number }
  | { kind: 'noUpstream' }
  | { kind: 'diverged'; ahead: number; behind: number };

/** Fast-forward only: a diverged branch is reported and left alone, so no merge commit and no conflict can appear. */
export async function pull(git: RunGit): Promise<Result<PullOutcome>> {
  try {
    let upstream: string;
    try {
      upstream = (await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim();
    } catch {
      return ok({ kind: 'noUpstream' });
    }
    if (!upstream) return ok({ kind: 'noUpstream' });
    // The counts read the remote-tracking ref, which only a fetch moves; without this a pull never sees new commits.
    await git(['fetch']);
    const behind = await count(git, ['rev-list', '--count', 'HEAD..@{u}']);
    if (behind === 0) return ok({ kind: 'upToDate' });
    const ahead = await count(git, ['rev-list', '--count', '@{u}..HEAD']);
    if (ahead > 0) return ok({ kind: 'diverged', ahead, behind });
    await git(['pull', '--ff-only']);
    return ok({ kind: 'fastForwarded', commits: behind });
  } catch (err) {
    return fail(messageOf(err));
  }
}

export type IntegrateStrategy = 'rebase' | 'merge';

/**
 * Brings a diverged branch level with its upstream. The caller has fetched already, so this never touches the network.
 * No --autostash: a dirty tree is refused by git and its message comes back as a failure.
 */
export function integrateUpstream(git: RunGit, inProgress: InProgress, strategy: IntegrateStrategy): Promise<Result<StoppedInfo>> {
  return sequencer(git, inProgress, strategy === 'rebase' ? ['rebase', '@{u}'] : ['merge', '--no-edit', '@{u}']);
}

export type PullPreference = 'rebase' | 'merge' | 'ff-only' | 'ask';

/** One `git config --get` value, lower-cased; '' when unset or unreadable (git exits 1 for an unset key). */
async function configValue(git: RunGit, key: string): Promise<string> {
  try { return (await git(['config', '--get', key])).trim().toLowerCase(); } catch { return ''; }
}

/**
 * What the user's git config says a pull should do once the branch has diverged.
 * Same precedence as git: branch.<name>.rebase over pull.rebase; a rebase setting over pull.ff.
 * `merges` and `interactive` are not offered by Null, so they ask rather than silently rebase plainly.
 * Anything unset or unreadable asks: that is what git itself does (it refuses and tells the user to choose).
 */
export async function pullPreference(git: RunGit): Promise<PullPreference> {
  let branch = '';
  try { branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim(); } catch { /* detached */ }
  const rebase = (branch && await configValue(git, `branch.${branch}.rebase`)) || await configValue(git, 'pull.rebase');
  if (['true', 'yes', 'on', '1'].includes(rebase)) return 'rebase';
  const ff = await configValue(git, 'pull.ff');
  if (['false', 'no', 'off', '0'].includes(rebase)) return ff === 'only' ? 'ff-only' : 'merge';
  if (rebase) return 'ask';
  if (ff === 'only') return 'ff-only';
  return ['false', 'no', 'off', '0'].includes(ff) ? 'merge' : 'ask';
}

/// <reference path="./protocol.ts" />
'use strict';

export interface LogCommit {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  /** Unix seconds. */
  time: number;
  refs: GraphRefLabel[];
  subject: string;
}

export interface StashInfo {
  sha: string;
  parents: string[];
}

/** Fields are separated by \x1f; with `-z` git ends each record with NUL. The subject is last so it may hold anything. */
export const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s';

function labelFor(full: string, current: boolean): GraphRefLabel | undefined {
  if (full.startsWith('refs/heads/')) return { name: full.slice('refs/heads/'.length), kind: 'branch', current };
  if (full.startsWith('refs/remotes/')) {
    const name = full.slice('refs/remotes/'.length);
    return name.endsWith('/HEAD') ? undefined : { name, kind: 'remote' };
  }
  if (full.startsWith('refs/tags/')) return { name: full.slice('refs/tags/'.length), kind: 'tag' };
  return undefined; // refs/stash (labeled from the stash list), notes, pull refs, ...
}

/** Parses `%D` produced with `--decorate=full`. */
export function parseDecoration(text: string): GraphRefLabel[] {
  const refs: GraphRefLabel[] = [];
  for (const raw of text.split(', ')) {
    const item = raw.trim();
    if (!item) continue;
    let label: GraphRefLabel | undefined;
    if (item === 'HEAD') label = { name: 'HEAD', kind: 'head', current: true };
    else if (item.startsWith('HEAD -> ')) label = labelFor(item.slice('HEAD -> '.length), true);
    else if (item.startsWith('tag: ')) label = labelFor(item.slice('tag: '.length), false);
    else label = labelFor(item, false);
    if (label) refs.push(label);
  }
  return refs;
}

export function parseLog(output: string): LogCommit[] {
  const commits: LogCommit[] = [];
  for (const record of output.split('\0')) {
    if (!record) continue;
    const f = record.split('\x1f');
    if (f.length < 7) continue;
    commits.push({
      sha: f[0].trim(),
      parents: f[1] ? f[1].split(' ') : [],
      author: f[2],
      email: f[3],
      time: Number(f[4]) || 0,
      refs: parseDecoration(f[5]),
      subject: f.slice(6).join('\x1f'),
    });
  }
  return commits;
}

/**
 * Stash commits have an index commit (and with -u an untracked-files commit) as extra parents. Those helper commits
 * are dropped from the list, and each stash keeps its first parent only and is labeled `stash@{n}` by position.
 */
export function applyStashes(commits: LogCommit[], stashes: StashInfo[]): LogCommit[] {
  if (stashes.length === 0) return commits;
  const position = new Map(stashes.map((s, n) => [s.sha, n]));
  const helpers = new Set(stashes.flatMap((s) => s.parents.slice(1)));
  return commits
    .filter((c) => !helpers.has(c.sha))
    .map((c) => {
      const n = position.get(c.sha);
      return n === undefined ? c : { ...c, parents: c.parents.slice(0, 1), refs: [{ name: `stash@{${n}}`, kind: 'stash' as const }] };
    });
}

/** Parses `diff-tree -z --name-status`: `STATUS\0path\0`, renames and copies carry two paths. */
export function parseNameStatus(output: string): GraphFile[] {
  const tokens = output.split('\0');
  const files: GraphFile[] = [];
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i++];
    if (!status) continue;
    const letter = status[0];
    if (letter === 'R' || letter === 'C') {
      const oldPath = tokens[i++];
      files.push({ status: letter, oldPath, path: tokens[i++] });
    } else {
      files.push({ status: letter, path: tokens[i++] });
    }
  }
  return files;
}

/** Short relative age for the tree: now, 5m, 2h, 3d, 3w, 3mo, 2y. */
export function formatAge(time: number, now: number): string {
  const seconds = Math.max(0, now - time);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

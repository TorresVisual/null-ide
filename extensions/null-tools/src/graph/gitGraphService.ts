/// <reference path="./protocol.ts" />
'use strict';

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { LOG_FORMAT, LogCommit, StashInfo, applyStashes, parseLog, parseNameStatus } from './gitLog';
import { GitError, RunGit, makeRunGit } from './gitRun';

export const PAGE_SIZE = 500;

export interface RefInfo {
  name: string;
  kind: 'branch' | 'remote' | 'tag';
  /** The commit the ref points at (annotated tags are peeled). */
  sha: string;
}

export interface LogPage {
  commits: LogCommit[];
  /** Commits git returned before stash helper commits were dropped; the next page starts at skip + rawCount. */
  rawCount: number;
  hasMore: boolean;
}

export type RootResult = { ok: true; root: string } | { ok: false; reason: 'no-git' | 'not-a-repo' };

const OPERATION_MARKERS: Array<[string, GraphOperationKind]> = [
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['MERGE_HEAD', 'merge'],
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
];

export async function resolveRepoRoot(folder: string): Promise<RootResult> {
  try {
    const out = await makeRunGit(folder)(['rev-parse', '--show-toplevel']);
    return { ok: true, root: path.normalize(out.trim()) };
  } catch (err) {
    return { ok: false, reason: err instanceof GitError && err.code === 'ENOENT' ? 'no-git' : 'not-a-repo' };
  }
}

export class GitGraphService {
  constructor(private readonly git: RunGit, readonly root: string) {}

  async stashes(): Promise<StashInfo[]> {
    const out = await this.git(['stash', 'list', '--format=%H%x1f%P']);
    return out.split('\n').filter(Boolean).map((line) => {
      const [sha, parents] = line.split('\x1f');
      return { sha, parents: parents ? parents.split(' ') : [] };
    });
  }

  /** `--date-order` is parent-safe and roughly newest-first (`--topo-order` lets one old branch fill page 1). */
  async loadPage(skip: number, count: number = PAGE_SIZE): Promise<LogPage> {
    const stashes = await this.stashes();
    const run = (withHead: boolean) => this.git([
      'log', '--date-order', '--decorate=full', '-z', `--format=${LOG_FORMAT}`, `--skip=${skip}`, '-n', String(count),
      '--branches', '--tags', '--remotes', ...(withHead ? ['HEAD'] : []), ...stashes.map((s) => s.sha), '--',
    ]);
    let out: string;
    try {
      out = await run(true);
    } catch (err) {
      // git words the unborn-HEAD error differently across versions, so ask whether HEAD resolves instead of matching text.
      if (await this.attempt(['rev-parse', '--verify', '--quiet', 'HEAD'])) throw err;
      try { out = await run(false); } catch { out = ''; } // unborn HEAD: nothing (or only other refs) to show
    }
    const raw = parseLog(out);
    return { commits: applyStashes(raw, stashes), rawCount: raw.length, hasMore: raw.length === count };
  }

  async refs(): Promise<RefInfo[]> {
    const out = await this.git([
      'for-each-ref', '--format=%(refname)%1f%(objectname)%1f%(*objectname)', 'refs/heads', 'refs/remotes', 'refs/tags',
    ]);
    const refs: RefInfo[] = [];
    for (const line of out.split('\n')) {
      if (!line) continue;
      const [full, object, peeled] = line.split('\x1f');
      const sha = peeled || object;
      if (full.startsWith('refs/heads/')) refs.push({ name: full.slice('refs/heads/'.length), kind: 'branch', sha });
      else if (full.startsWith('refs/remotes/') && !full.endsWith('/HEAD')) refs.push({ name: full.slice('refs/remotes/'.length), kind: 'remote', sha });
      else if (full.startsWith('refs/tags/')) refs.push({ name: full.slice('refs/tags/'.length), kind: 'tag', sha });
    }
    return refs;
  }

  private async attempt(args: string[]): Promise<string> {
    try { return (await this.git(args)).trim(); } catch { return ''; }
  }

  /** A hash of everything the graph shows plus the in-progress state; a working-tree edit does not change it. */
  async fingerprint(): Promise<{ hash: string; inProgress: GraphInProgress | null }> {
    const [refs, head, branch, stash, inProgress] = await Promise.all([
      this.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags']),
      this.attempt(['rev-parse', '--verify', '--quiet', 'HEAD']),
      this.attempt(['symbolic-ref', '--quiet', 'HEAD']),
      this.git(['stash', 'list', '--format=%H']),
      this.inProgress(),
    ]);
    const hash = crypto.createHash('sha1').update([refs, head, branch, stash, inProgress?.kind ?? ''].join('\n--\n')).digest('hex');
    return { hash, inProgress };
  }

  /** Markers are resolved through --git-path so a linked worktree (where .git is a file) reads its own state. */
  async inProgress(): Promise<GraphInProgress | null> {
    const out = await this.git(['rev-parse', ...OPERATION_MARKERS.flatMap(([name]) => ['--git-path', name])]);
    const paths = out.split('\n').filter(Boolean);
    for (let i = 0; i < OPERATION_MARKERS.length; i++) {
      if (paths[i] && fs.existsSync(path.resolve(this.root, paths[i]))) return { kind: OPERATION_MARKERS[i][1] };
    }
    return null;
  }

  async commitDetail(sha: string): Promise<GraphDetail> {
    const out = await this.git(['show', '-s', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B', sha, '--']);
    const f = out.split('\x1f');
    return {
      sha: f[0].trim(),
      parents: f[1] ? f[1].split(' ') : [],
      author: f[2],
      authorEmail: f[3],
      authorTime: Number(f[4]) || 0,
      committer: f[5],
      committerEmail: f[6],
      committerTime: Number(f[7]) || 0,
      message: f.slice(8).join('\x1f').trim(),
    };
  }

  /** Files changed against `parent` (the first parent for a merge); a root commit passes no parent and diffs against nothing. */
  async commitFiles(sha: string, parent?: string): Promise<GraphFile[]> {
    const base = ['diff-tree', '-z', '--no-commit-id', '--name-status', '-r', '-M'];
    const out = await this.git(parent ? [...base, parent, sha, '--'] : [...base, '--root', sha, '--']);
    return parseNameStatus(out);
  }
}

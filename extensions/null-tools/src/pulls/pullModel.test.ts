'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { ApiError } from '../github/githubApi';
import {
  ListPullsData, PullSummary, ThreadsData, commentFromGql, commentFromRest, describeFailure, leftPath, mapFiles, mapPulls, mapThreads,
  pinCurrent, pullBranch, threadAction, threadCount,
} from './pullModel';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const pullNode = (over: Record<string, unknown> = {}) => ({
  number: 12, title: 'Add x', url: 'https://github.com/o/r/pull/12', state: 'OPEN', isDraft: false, updatedAt: '2026-10-02T10:00:00Z',
  isCrossRepository: false,
  headRefName: 'feat/x', baseRefName: 'main', headRefOid: A, baseRefOid: B, reviewDecision: 'APPROVED',
  author: { login: 'octocat' }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  ...over,
});
const list = (nodes: unknown[]): ListPullsData => ({ search: { nodes } } as ListPullsData);

test('mapPulls maps a PR and skips non-PR search nodes', () => {
  const [pull, ...rest] = mapPulls(list([pullNode(), {}]));
  assert.strictEqual(rest.length, 0);
  assert.deepStrictEqual(pull, {
    number: 12, title: 'Add x', url: 'https://github.com/o/r/pull/12', state: 'open', draft: false, author: 'octocat', fork: false,
    headRef: 'feat/x', baseRef: 'main', headSha: A, baseSha: B, updatedAt: '2026-10-02T10:00:00Z',
    checks: 'success', review: 'approved',
  });
});

test('mapPulls: check rollup and review decision variants, missing rollup, deleted author', () => {
  const states = (s: string | null, review: string | null) => mapPulls(list([pullNode({
    reviewDecision: review,
    commits: { nodes: s ? [{ commit: { statusCheckRollup: { state: s } } }] : [{ commit: { statusCheckRollup: null } }] },
  })]))[0];
  assert.strictEqual(states('FAILURE', 'CHANGES_REQUESTED').checks, 'failure');
  assert.strictEqual(states('ERROR', null).checks, 'failure');
  assert.strictEqual(states('PENDING', 'REVIEW_REQUIRED').checks, 'pending');
  assert.strictEqual(states('EXPECTED', null).checks, 'pending');
  assert.strictEqual(states(null, null).checks, 'none');
  assert.strictEqual(states('SUCCESS', 'CHANGES_REQUESTED').review, 'changes');
  assert.strictEqual(states('SUCCESS', 'REVIEW_REQUIRED').review, 'required');
  assert.strictEqual(states('SUCCESS', null).review, 'none');
  assert.strictEqual(mapPulls(list([pullNode({ author: null, commits: { nodes: [] } })]))[0].author, 'ghost');
});

test('mapFiles: statuses collapse to added/removed/renamed/modified and renames keep the old path', () => {
  const files = mapFiles([
    { filename: 'a.ts', status: 'added', additions: 3, deletions: 0 },
    { filename: 'b.ts', status: 'removed', additions: 0, deletions: 4 },
    { filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed', additions: 1, deletions: 1 },
    { filename: 'c.ts', status: 'changed', additions: 2, deletions: 2 },
    { filename: 'd.ts', status: 'copied', additions: 0, deletions: 0 },
  ]);
  assert.deepStrictEqual(files.map(f => f.status), ['added', 'removed', 'renamed', 'modified', 'modified']);
  assert.strictEqual(files[2].oldPath, 'old.ts');
  assert.strictEqual(files[0].oldPath, undefined);
});

test('leftPath reads the old name of a renamed file and is the identity otherwise', () => {
  const files = mapFiles([
    { filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed', additions: 0, deletions: 0 },
    { filename: 'same.ts', status: 'modified', additions: 1, deletions: 0 },
  ]);
  assert.strictEqual(leftPath(files, 'new.ts'), 'old.ts');
  assert.strictEqual(leftPath(files, 'same.ts'), 'same.ts');
  assert.strictEqual(leftPath(files, 'unknown.ts'), 'unknown.ts');
});

const thread = (over: Record<string, unknown> = {}) => ({
  id: 'T1', isResolved: false, isOutdated: false, viewerCanResolve: true, viewerCanUnresolve: false,
  path: 'src/a.ts', line: 10, startLine: null, diffSide: 'RIGHT',
  comments: { nodes: [
    { databaseId: 101, state: 'SUBMITTED', body: 'Why?', createdAt: '2026-10-01T10:00:00Z', author: { login: 'rev', avatarUrl: 'https://x/a.png' } },
    { databaseId: 102, state: 'SUBMITTED', body: 'Because.', createdAt: '2026-10-01T11:00:00Z', author: null },
  ] },
  ...over,
});
const threads = (nodes: unknown[]): ThreadsData => ({ repository: { pullRequest: { reviewThreads: { nodes } } } } as ThreadsData);

test('mapThreads maps comments, side, range and resolved flag; a deleted author is ghost', () => {
  const [t] = mapThreads(threads([thread({ isResolved: true, diffSide: 'LEFT', startLine: 8 })])).threads;
  assert.strictEqual(t.path, 'src/a.ts');
  assert.strictEqual(t.line, 10);
  assert.strictEqual(t.startLine, 8);
  assert.strictEqual(t.side, 'LEFT');
  assert.strictEqual(t.resolved, true);
  assert.deepStrictEqual(t.comments.map(c => [c.id, c.author]), [[101, 'rev'], [102, 'ghost']]);
  assert.strictEqual(mapThreads(threads([thread()])).threads[0].startLine, null);
});

test('mapThreads hides outdated threads but counts them; also skips threads without a line or comments', () => {
  const result = mapThreads(threads([
    thread({ isOutdated: true }), thread({ isOutdated: true }), thread({ line: null }), thread({ comments: { nodes: [] } }), thread(),
  ]));
  assert.strictEqual(result.threads.length, 1);
  assert.strictEqual(result.outdated, 2);
});

test('mapThreads tolerates a PR that no longer exists', () => {
  assert.deepStrictEqual(mapThreads({ repository: { pullRequest: null } } as ThreadsData), { threads: [], outdated: 0 });
});

test('threadCount counts the threads of one file', () => {
  const { threads: all } = mapThreads(threads([thread(), thread(), thread({ path: 'b.ts' })]));
  assert.strictEqual(threadCount(all, 'src/a.ts'), 2);
  assert.strictEqual(threadCount(all, 'none.ts'), 0);
});

test('mapPulls: merged and closed PRs keep their state, anything unknown counts as open', () => {
  const state = (s: string) => mapPulls(list([pullNode({ state: s })]))[0].state;
  assert.strictEqual(state('MERGED'), 'merged');
  assert.strictEqual(state('CLOSED'), 'closed');
  assert.strictEqual(state('OPEN'), 'open');
  assert.strictEqual(state('SOMETHING_NEW'), 'open');
});

const summary = (over: Partial<PullSummary>): PullSummary => ({ ...mapPulls(list([pullNode()]))[0], ...over });

test('pullBranch: a same-repo PR keeps its head branch, a fork PR (or an option-looking name) becomes pr/<n>', () => {
  assert.strictEqual(pullBranch(summary({ headRef: 'feat/x' })), 'feat/x');
  assert.strictEqual(pullBranch(summary({ number: 7, fork: true, headRef: 'main' })), 'pr/7');
  assert.strictEqual(pullBranch(summary({ number: 8, headRef: '-x' })), 'pr/8');
  assert.strictEqual(pullBranch(summary({ number: 9, headRef: 'a b;c' })), 'pr/9');
});

test('pinCurrent puts the PR of the checked-out branch first and keeps the rest in order', () => {
  const pulls = [summary({ number: 1, headRef: 'a' }), summary({ number: 2, headRef: 'b' }), summary({ number: 3, headRef: 'c', fork: true })];
  assert.deepStrictEqual(pinCurrent(pulls, 'b').map(p => p.number), [2, 1, 3]);
  assert.deepStrictEqual(pinCurrent(pulls, 'pr/3').map(p => p.number), [3, 1, 2]);
  assert.deepStrictEqual(pinCurrent(pulls, 'other').map(p => p.number), [1, 2, 3]);
  assert.deepStrictEqual(pinCurrent(pulls, null).map(p => p.number), [1, 2, 3]);
});

test('commentFromRest maps a REST review comment', () => {
  assert.deepStrictEqual(
    commentFromRest({ id: 7, body: 'hi', created_at: '2026-10-01T10:00:00Z', user: { login: 'me', avatar_url: 'https://x/m.png' } }),
    { id: 7, body: 'hi', author: 'me', avatar: 'https://x/m.png', createdAt: '2026-10-01T10:00:00Z', pending: false },
  );
});

test('mapThreads carries the thread id, the resolve rights and which comments are pending', () => {
  const [t] = mapThreads(threads([thread({ comments: { nodes: [
    { databaseId: 1, state: 'SUBMITTED', body: 'a', createdAt: '2026-10-01T10:00:00Z', author: null },
    { databaseId: 2, state: 'PENDING', body: 'b', createdAt: '2026-10-01T10:01:00Z', author: null },
  ] } })])).threads;
  assert.strictEqual(t.id, 'T1');
  assert.strictEqual(t.canResolve, true);
  assert.strictEqual(t.canUnresolve, false);
  assert.deepStrictEqual(t.comments.map(c => c.pending), [false, true]);
});

test('commentFromGql maps one comment; an unknown state is not pending', () => {
  const c = commentFromGql({ databaseId: 5, state: 'SOMETHING_NEW', body: 'x', createdAt: '2026-10-01T10:00:00Z', author: { login: 'me', avatarUrl: 'https://x/m.png' } });
  assert.deepStrictEqual(c, { id: 5, body: 'x', author: 'me', avatar: 'https://x/m.png', createdAt: '2026-10-01T10:00:00Z', pending: false });
});

test('threadAction: what the thread-title button offers', () => {
  const t = (resolved: boolean, canResolve: boolean, canUnresolve: boolean) => ({ resolved, canResolve, canUnresolve });
  assert.strictEqual(threadAction(t(false, true, false)), 'resolvable');
  assert.strictEqual(threadAction(t(true, false, true)), 'unresolvable');
  assert.strictEqual(threadAction(t(false, false, false)), undefined);
  assert.strictEqual(threadAction(t(true, true, false)), undefined, 'resolved and you cannot reopen it');
  assert.strictEqual(threadAction(t(false, false, true)), undefined, 'open: unresolve makes no sense');
});

test('describeFailure: a rate limit says when to retry, anything else keeps its own message', () => {
  const limited = new ApiError('GitHub API 403: rate limit', 403, 1_000_000 + 5 * 60_000);
  assert.strictEqual(describeFailure(limited, 1_000_000), 'GitHub API 403: rate limit. Try again in 5 min.');
  assert.strictEqual(describeFailure(new ApiError('GitHub API 401: Bad credentials', 401), 0), 'GitHub API 401: Bad credentials');
  assert.strictEqual(describeFailure(new Error('boom')), 'boom');
  assert.strictEqual(describeFailure('odd'), 'odd');
});

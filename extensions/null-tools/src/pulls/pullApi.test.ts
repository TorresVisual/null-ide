'use strict';

import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import test, { afterEach, mock } from 'node:test';
import {
  createLineComment, fetchLabelNames, fetchMergeBase, fetchMilestoneTitles, fetchPullFiles, fetchReviewThreads, listPulls, replyToComment,
} from './pullApi';
import { DEFAULT_FILTER } from './pullFilter';

afterEach(() => mock.restoreAll());

interface Call { url: string; method: string; body?: any }

/** Answers each https.request with the next canned response (the last one repeats) and records what was asked. */
function stub(responses: unknown[]): Call[] {
  const calls: Call[] = [];
  mock.method(https, 'request', (url: string, opts: { method: string }, onResponse: (res: unknown) => void) => {
    const call: Call = { url, method: opts.method };
    calls.push(call);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return Object.assign(new EventEmitter(), {
      setTimeout() {}, destroy() {},
      write(payload: string) { call.body = JSON.parse(payload); },
      end() {
        const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, setEncoding() {} });
        onResponse(res);
        res.emit('data', JSON.stringify(next));
        res.emit('end');
      },
    });
  });
  return calls;
}

const restFile = (i: number) => ({ filename: `f${i}.ts`, status: 'modified', additions: 1, deletions: 0 });

test('listPulls sends the filter as the search query', async () => {
  const empty = { data: { search: { nodes: [] } } };
  const calls = stub([empty, empty]);
  assert.deepStrictEqual(await listPulls('o', 'r', DEFAULT_FILTER, 't'), []);
  assert.strictEqual(calls[0].url, 'https://api.github.com/graphql');
  assert.strictEqual(calls[0].body.variables.q, 'repo:o/r is:pr is:open sort:updated-desc');
  await listPulls('o', 'r', { ...DEFAULT_FILTER, state: 'merged', mine: true }, 't');
  assert.strictEqual(calls[1].body.variables.q, 'repo:o/r is:pr is:merged author:@me sort:updated-desc');
});

test('fetchPullFiles pages until a short page, so a PR with more than 100 files is not cut off', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => restFile(i));
  const calls = stub([page1, [restFile(100)]]);
  const files = await fetchPullFiles('o', 'r', 5, 't');
  assert.strictEqual(files.length, 101);
  assert.deepStrictEqual(calls.map(c => c.url), [
    'https://api.github.com/repos/o/r/pulls/5/files?per_page=100&page=1',
    'https://api.github.com/repos/o/r/pulls/5/files?per_page=100&page=2',
  ]);
});

test('fetchMergeBase returns the merge-base commit of base...head', async () => {
  const calls = stub([{ merge_base_commit: { sha: 'c'.repeat(40) } }]);
  assert.strictEqual(await fetchMergeBase('o', 'r', 'a'.repeat(40), 'b'.repeat(40), 't'), 'c'.repeat(40));
  assert.strictEqual(calls[0].url, `https://api.github.com/repos/o/r/compare/${'a'.repeat(40)}...${'b'.repeat(40)}?per_page=1`);
});

test('fetchReviewThreads sends owner, name and number', async () => {
  const calls = stub([{ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } }]);
  assert.deepStrictEqual(await fetchReviewThreads('o', 'r', 5, 't'), { threads: [], outdated: 0 });
  assert.deepStrictEqual(calls[0].body.variables, { owner: 'o', name: 'r', number: 5 });
});

const posted = { id: 9, body: 'ok', created_at: '2026-10-01T10:00:00Z', user: { login: 'me', avatar_url: 'u' } };

test('createLineComment posts a single-line review comment on the head commit', async () => {
  const calls = stub([posted]);
  const c = await createLineComment('o', 'r', 5, { body: 'ok', commitId: 'b'.repeat(40), path: 'a.ts', line: 3, side: 'RIGHT' }, 't');
  assert.strictEqual(c.id, 9);
  assert.strictEqual(calls[0].method, 'POST');
  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/pulls/5/comments');
  assert.deepStrictEqual(calls[0].body, { body: 'ok', commit_id: 'b'.repeat(40), path: 'a.ts', line: 3, side: 'RIGHT' });
});

test('createLineComment sends start_line / start_side for a multi-line range on one side', async () => {
  const calls = stub([posted]);
  await createLineComment('o', 'r', 5, { body: 'ok', commitId: 'b'.repeat(40), path: 'a.ts', startLine: 3, line: 6, side: 'LEFT' }, 't');
  assert.deepStrictEqual(calls[0].body, {
    body: 'ok', commit_id: 'b'.repeat(40), path: 'a.ts', start_line: 3, start_side: 'LEFT', line: 6, side: 'LEFT',
  });
});

test('replyToComment posts to the thread\'s first comment', async () => {
  const calls = stub([posted]);
  await replyToComment('o', 'r', 5, 101, 'thanks', 't');
  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/pulls/5/comments/101/replies');
  assert.deepStrictEqual(calls[0].body, { body: 'thanks' });
});

test('fetchLabelNames returns the names and drops any that could break out of a search qualifier', async () => {
  const calls = stub([[{ name: 'bug' }, { name: 'good first issue' }, { name: 'x" is:closed' }]]);
  assert.deepStrictEqual(await fetchLabelNames('o', 'r', 't'), ['bug', 'good first issue']);
  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/labels?per_page=100');
});

test('fetchMilestoneTitles lists open and closed milestones, minus unsafe titles', async () => {
  const calls = stub([[{ title: 'v1' }, { title: 'v2\nis:open' }]]);
  assert.deepStrictEqual(await fetchMilestoneTitles('o', 'r', 't'), ['v1']);
  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/milestones?state=all&per_page=100');
});

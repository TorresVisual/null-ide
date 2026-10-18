'use strict';

import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import test, { afterEach, mock } from 'node:test';
import { fetchPullPage, rerunFailedRuns } from './pullDetailApi';

afterEach(() => mock.restoreAll());

interface Call { url: string; method: string; body?: any }
interface Canned { status?: number; body: unknown }

/** Answers each https.request with the next canned response (the last one repeats) and records what was asked. */
function stub(responses: Canned[]): Call[] {
  const calls: Call[] = [];
  mock.method(https, 'request', (url: string, opts: { method: string }, onResponse: (res: unknown) => void) => {
    const call: Call = { url, method: opts.method };
    calls.push(call);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return Object.assign(new EventEmitter(), {
      setTimeout() {}, destroy() {},
      write(payload: string) { call.body = JSON.parse(payload); },
      end() {
        const res = Object.assign(new EventEmitter(), { statusCode: next.status ?? 200, headers: {}, setEncoding() {} });
        onResponse(res);
        res.emit('data', JSON.stringify(next.body));
        res.emit('end');
      },
    });
  });
  return calls;
}

const minimalPage = {
  number: 5, title: 'T', url: 'https://github.com/o/r/pull/5', state: 'MERGED', isDraft: false, createdAt: '2026-10-01T10:00:00Z',
  bodyHTML: '', headRefName: 'h', baseRefName: 'main', isCrossRepository: false, additions: 1, deletions: 0, changedFiles: 1,
  author: null, labels: { nodes: [] }, milestone: null, assignees: { nodes: [] }, reviewRequests: { nodes: [] },
  latestOpinionatedReviews: { nodes: [] }, commits: { totalCount: 0, nodes: [] }, timelineItems: { totalCount: 0, nodes: [] },
  lastCommit: { nodes: [] },
};

test('fetchPullPage asks GraphQL for one PR and maps it', async () => {
  const calls = stub([{ body: { data: { repository: { pullRequest: minimalPage } } } }]);
  const page = await fetchPullPage('o', 'r', 5, 't');
  assert.strictEqual(calls[0].url, 'https://api.github.com/graphql');
  assert.deepStrictEqual(calls[0].body.variables, { owner: 'o', name: 'r', number: 5 });
  assert.strictEqual(page.state, 'merged');
  assert.strictEqual(page.author.login, 'ghost');
});

test('fetchPullPage: a PR that does not exist is a readable error', async () => {
  stub([{ body: { data: { repository: { pullRequest: null } } } }]);
  await assert.rejects(fetchPullPage('o', 'r', 404, 't'), /Pull request not found/);
});

test('rerunFailedRuns posts once per run, in order', async () => {
  const calls = stub([{ status: 201, body: {} }]);
  assert.deepStrictEqual(await rerunFailedRuns('o', 'r', [11, 12], 't'), { started: 2, errors: [] });
  assert.deepStrictEqual(calls.map(c => `${c.method} ${c.url}`), [
    'POST https://api.github.com/repos/o/r/actions/runs/11/rerun-failed-jobs',
    'POST https://api.github.com/repos/o/r/actions/runs/12/rerun-failed-jobs',
  ]);
});

test('rerunFailedRuns: a run GitHub refuses is reported with GitHub\'s words, the rest still go', async () => {
  const calls = stub([{ status: 403, body: { message: 'Workflow is still running' } }, { status: 201, body: {} }]);
  const result = await rerunFailedRuns('o', 'r', [11, 12], 't');
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(result.started, 1);
  assert.strictEqual(result.errors.length, 1);
  assert.match(result.errors[0], /Workflow is still running/);
});

test('rerunFailedRuns with no runs makes no request', async () => {
  const calls = stub([{ body: {} }]);
  assert.deepStrictEqual(await rerunFailedRuns('o', 'r', [], 't'), { started: 0, errors: [] });
  assert.strictEqual(calls.length, 0);
});

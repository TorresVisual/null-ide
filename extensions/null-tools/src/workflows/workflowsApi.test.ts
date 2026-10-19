'use strict';

import assert from 'node:assert';
import test, { afterEach, mock } from 'node:test';
import { ApiError } from '../github/githubApi';
import { stub } from '../pulls/httpStub';
import {
  cancelRun, dispatchWorkflow, enableWorkflow, fetchJobLog, getDefaultBranch, listBranches, listJobs, listRuns, listWorkflows,
  rerunFailedJobs, rerunJob, rerunRun,
} from './workflowsApi';
import { DEFAULT_FILTER } from './workflowsModel';

afterEach(() => mock.restoreAll());

const ctx = { branch: 'main', login: 'me' };

test('listRuns sends the filter and maps the payload', async () => {
  const calls = stub([{ body: { total_count: 41, workflow_runs: [{ id: 1, workflow_id: 2, display_title: 'T', status: 'completed', conclusion: 'success', run_number: 9, html_url: 'https://github.com/o/r/actions/runs/1' }] } }]);
  const res = await listRuns('o', 'r', { ...DEFAULT_FILTER, failed: true }, ctx, 2, 'tok');
  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/actions/runs?per_page=30&page=2&status=failure');
  assert.strictEqual(calls[0].headers.Authorization, 'Bearer tok');
  assert.strictEqual(res.total, 41);
  assert.strictEqual(res.runs[0].title, 'T');
});

test('jobs, workflows and branches use the latest attempt and the first 100', async () => {
  const calls = stub([
    { body: { jobs: [{ id: 5, name: 'b', status: 'completed', steps: [] }] } },
    { body: { total_count: 120, workflows: [{ id: 3, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' }] } },
    { body: [{ name: 'main' }, { name: 'dev' }] },
    { body: { default_branch: 'trunk' } },
  ]);
  assert.strictEqual((await listJobs('o', 'r', 77, 't'))[0].id, 5);
  const wf = await listWorkflows('o', 'r', 't');
  assert.deepStrictEqual([wf.total, wf.workflows[0].name], [120, 'CI']);
  assert.deepStrictEqual(await listBranches('o', 'r', 't'), ['main', 'dev']);
  assert.strictEqual(await getDefaultBranch('o', 'r', 't'), 'trunk');
  assert.deepStrictEqual(calls.map(c => c.url), [
    'https://api.github.com/repos/o/r/actions/runs/77/jobs?filter=latest&per_page=100',
    'https://api.github.com/repos/o/r/actions/workflows?per_page=100',
    'https://api.github.com/repos/o/r/branches?per_page=100',
    'https://api.github.com/repos/o/r',
  ]);
});

test('management calls hit the documented endpoints with the right verb and body', async () => {
  const calls = stub([{ status: 201, raw: '' }]);
  await rerunRun('o', 'r', 1, 't');
  await rerunFailedJobs('o', 'r', 2, 't');
  await rerunJob('o', 'r', 3, 't');
  await cancelRun('o', 'r', 4, 't');
  await enableWorkflow('o', 'r', 5, 't');
  await dispatchWorkflow('o', 'r', 6, 'main', {}, 't');
  await dispatchWorkflow('o', 'r', 6, 'v1', { who: 'me', fail: 'false' }, 't');
  assert.deepStrictEqual(calls.map(c => `${c.method} ${c.url.replace('https://api.github.com/repos/o/r/actions/', '')}`), [
    'POST runs/1/rerun', 'POST runs/2/rerun-failed-jobs', 'POST jobs/3/rerun', 'POST runs/4/cancel',
    'PUT workflows/5/enable', 'POST workflows/6/dispatches', 'POST workflows/6/dispatches',
  ]);
  assert.deepStrictEqual(calls[5].body, { ref: 'main' }, 'no inputs key when there are none');
  assert.deepStrictEqual(calls[6].body, { ref: 'v1', inputs: { who: 'me', fail: 'false' } });
});

test('a refusal keeps GitHub\'s words in the ApiError', async () => {
  stub([{ status: 409, body: { message: 'Workflow is already running' } }]);
  await assert.rejects(rerunRun('o', 'r', 1, 't'), (e: unknown) => e instanceof ApiError && e.status === 409 && /already running/.test(e.message));
});

test('fetchJobLog follows the redirect and never sends the token to the second host', async () => {
  const calls = stub([
    { status: 302, raw: '', headers: { location: 'https://logs.example.net/signed?sig=abc' } },
    { raw: '2026-10-01T10:00:00.0000000Z hello\n' },
  ]);
  const log = await fetchJobLog('o', 'r', 9, 'secret-token');
  assert.strictEqual(log.text, '2026-10-01T10:00:00.0000000Z hello\n');
  assert.strictEqual(log.truncated, false);
  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/actions/jobs/9/logs');
  assert.strictEqual(calls[0].headers.Authorization, 'Bearer secret-token');
  assert.strictEqual(calls[1].url, 'https://logs.example.net/signed?sig=abc');
  assert.strictEqual(calls[1].headers.Authorization, undefined, 'the token stays on api.github.com');
  assert.ok(!JSON.stringify(calls[1].headers).includes('secret-token'));
});

test('fetchJobLog: bad redirects, missing logs and big logs end in a clear result', async () => {
  stub([{ status: 302, raw: '' }]);
  await assert.rejects(fetchJobLog('o', 'r', 9, 't'), /did not say where/);
  mock.restoreAll();

  stub([{ status: 302, raw: '', headers: { location: 'http://insecure.example/log' } }]);
  await assert.rejects(fetchJobLog('o', 'r', 9, 't'), /https/);
  mock.restoreAll();

  stub([{ status: 404, body: { message: 'Not Found' } }]);
  await assert.rejects(fetchJobLog('o', 'r', 9, 't'), (e: unknown) => e instanceof ApiError && e.status === 404);
  mock.restoreAll();

  stub([{ status: 302, raw: '', headers: { location: 'https://logs.example.net/x' } }, { status: 403, raw: '<Error>expired</Error>' }]);
  await assert.rejects(fetchJobLog('o', 'r', 9, 't'), (e: unknown) => e instanceof ApiError && e.status === 403);
  mock.restoreAll();

  const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  stub([{ status: 302, raw: '', headers: { location: 'https://logs.example.net/x' } }, { raw: lines }]);
  const big = await fetchJobLog('o', 'r', 9, 't', 200);
  assert.strictEqual(big.truncated, true);
  assert.ok(big.text.length <= 200);
  assert.ok(big.text.endsWith('line 99'), 'the end of the log is what survives');
  assert.ok(/^line \d+/.test(big.text), 'the cut lands on a line boundary');
});

test('fetchJobLog accepts a log served directly with 200', async () => {
  stub([{ raw: 'direct\n' }]);
  assert.deepStrictEqual(await fetchJobLog('o', 'r', 9, 't'), { text: 'direct\n', truncated: false });
});

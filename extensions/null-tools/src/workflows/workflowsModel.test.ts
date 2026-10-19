'use strict';

import assert from 'node:assert';
import test from 'node:test';
import {
  DEFAULT_FILTER, PAGE_SIZE, RepoRef, WfNode, WorkflowJob, WorkflowRun, branchChoices, dedupeRepos, describeFilter, describeNode,
  elapsed, filterRows, formatDuration, isActive, isDefaultFilter, isFailed, isPlausibleRef, isWorkflowFile, mapJob, mapLimit,
  mapRun, mergeRuns, nodeId, parseFilter, pollDelay, refusal, runActions, runContext, runDescription, runsPath, statusIcon,
  workflowContext,
} from './workflowsModel';
import { ApiError } from '../github/githubApi';
import { actionFailureText } from './workflowsModel';

const repo: RepoRef = { key: 'o/r', owner: 'o', repo: 'r' };
const run = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: 1, workflowId: 9, title: 'Fix it', status: 'completed', conclusion: 'success', branch: 'main', sha: 'abcdef1234567',
  event: 'push', number: 42, attempt: 1, startedAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:01:05Z',
  url: 'https://github.com/o/r/actions/runs/1', actor: 'octocat', ...over,
});
const job = (over: Partial<WorkflowJob> = {}): WorkflowJob => ({
  id: 5, name: 'build', status: 'completed', conclusion: 'success', startedAt: '2026-10-01T10:00:00Z',
  completedAt: '2026-10-01T10:00:30Z', url: 'https://github.com/o/r/actions/runs/1/job/5', steps: [], ...over,
});

test('statusIcon: one function for run, job and step rows', () => {
  assert.deepStrictEqual(statusIcon('completed', 'success'), { icon: 'pass', color: 'charts.green' });
  for (const c of ['failure', 'timed_out', 'startup_failure']) assert.strictEqual(statusIcon('completed', c).icon, 'error', c);
  assert.strictEqual(statusIcon('completed', 'cancelled').icon, 'circle-slash');
  assert.strictEqual(statusIcon('completed', 'skipped').icon, 'debug-step-over');
  assert.strictEqual(statusIcon('completed', 'neutral').icon, 'debug-step-over');
  assert.strictEqual(statusIcon('completed', 'action_required').icon, 'warning');
  assert.strictEqual(statusIcon('in_progress', null).icon, 'sync~spin');
  for (const s of ['queued', 'waiting', 'pending', 'requested']) assert.strictEqual(statusIcon(s, null).icon, 'clock', s);
  assert.strictEqual(statusIcon('who-knows', null).icon, 'circle-outline');
});

test('isActive / isFailed', () => {
  assert.ok(isActive({ status: 'queued' }) && isActive({ status: 'in_progress' }) && isActive({ status: 'waiting' }));
  assert.ok(!isActive({ status: 'completed' }) && !isActive({ status: '' }), 'an unknown status must not poll forever');
  assert.ok(isFailed({ status: 'completed', conclusion: 'timed_out' }));
  assert.ok(!isFailed({ status: 'completed', conclusion: 'cancelled' }) && !isFailed({ status: 'in_progress', conclusion: null }));
});

test('durations', () => {
  assert.strictEqual(formatDuration(0), '0s');
  assert.strictEqual(formatDuration(45_000), '45s');
  assert.strictEqual(formatDuration(65_000), '1m 5s');
  assert.strictEqual(formatDuration(3_725_000), '1h 2m');
  assert.strictEqual(formatDuration(-5), '0s');
  assert.strictEqual(elapsed(null, null, 0), '');
  assert.strictEqual(elapsed('2026-10-01T10:00:00Z', '2026-10-01T10:00:30Z', 0), '30s');
  const now = Date.parse('2026-10-01T10:02:00Z');
  assert.strictEqual(elapsed('2026-10-01T10:00:00Z', null, now), '2m 0s');
  assert.strictEqual(elapsed('garbage', null, now), '');
});

test('runDescription: attempt only above 1, duration from updatedAt when finished', () => {
  const now = Date.parse('2026-10-01T11:00:00Z');
  assert.strictEqual(runDescription(run(), now), 'main · abcdef1 · push · 1m 5s · #42');
  assert.strictEqual(runDescription(run({ attempt: 3 }), now), 'main · abcdef1 · push · 1m 5s · #42 · attempt 3');
  const active = runDescription(run({ status: 'in_progress', conclusion: null }), Date.parse('2026-10-01T10:00:10Z'));
  assert.strictEqual(active, 'main · abcdef1 · push · 10s · #42');
});

test('mapRun / mapJob tolerate missing fields and refuse non-github urls', () => {
  const r = mapRun({ id: 7, workflow_id: 3, display_title: 'T', status: 'queued', head_branch: 'x', head_sha: 'a'.repeat(40),
    event: 'push', run_number: 5, html_url: 'javascript:alert(1)', created_at: '2026-10-01T10:00:00Z' });
  assert.strictEqual(r.url, '');
  assert.strictEqual(r.attempt, 1);
  assert.strictEqual(r.actor, '');
  assert.strictEqual(r.startedAt, '2026-10-01T10:00:00Z');
  assert.strictEqual(r.title, 'T');
  assert.strictEqual(mapRun({ id: 1, name: 'CI', html_url: 'https://github.com/o/r/actions/runs/1' }).title, 'CI');
  const j = mapJob({ id: 1, name: 'b', status: 'completed', conclusion: 'failure', steps: [{ number: 1, name: 's', status: 'completed', conclusion: 'failure' }, null] });
  assert.strictEqual(j.steps.length, 1, 'a null step is dropped');
  assert.strictEqual(j.steps[0].conclusion, 'failure');
  assert.deepStrictEqual(mapJob({ id: 2, name: 'x' }).steps, []);
});

test('runActions: what each run state offers', () => {
  assert.deepStrictEqual(runActions(run()), ['rerunAll']);
  assert.deepStrictEqual(runActions(run({ conclusion: 'failure' })), ['rerunAll', 'rerunFailed']);
  assert.deepStrictEqual(runActions(run({ status: 'in_progress', conclusion: null })), ['cancel']);
  assert.deepStrictEqual(runActions(run({ status: 'queued', conclusion: null })), ['cancel']);
  assert.deepStrictEqual(runActions(run({ conclusion: 'cancelled' })), ['rerunAll']);
});

test('refusal: the host re-reads the target and refuses a stale click with the reason', () => {
  const finished = { status: 'completed', conclusion: 'success' };
  const running = { status: 'in_progress', conclusion: null };
  assert.strictEqual(refusal('cancel', running), null);
  assert.match(refusal('cancel', finished)!, /already finished/);
  assert.strictEqual(refusal('rerunAll', finished), null);
  assert.match(refusal('rerunAll', running)!, /still running/);
  assert.match(refusal('rerunFailed', finished)!, /no failed jobs/);
  assert.strictEqual(refusal('rerunFailed', { status: 'completed', conclusion: 'failure' }), null);
  assert.match(refusal('rerunJob', running)!, /still running/);
  assert.strictEqual(refusal('rerunJob', finished), null);
});

test('context values are space-separated tokens the when-clauses match', () => {
  assert.strictEqual(runContext(run({ conclusion: 'failure' })), 'run failed rerunAll rerunFailed');
  assert.strictEqual(runContext(run({ status: 'queued', conclusion: null })), 'run cancel');
  assert.strictEqual(workflowContext({ id: 1, name: 'ci', path: '.github/workflows/ci.yml', state: 'active' }, true), 'workflow dispatch');
  assert.strictEqual(workflowContext({ id: 1, name: 'ci', path: 'p', state: 'active' }, false), 'workflow');
  assert.strictEqual(workflowContext({ id: 1, name: 'ci', path: 'p', state: 'disabled_manually' }, true), 'workflow enable');
});

test('actionFailureText keeps GitHub\'s words and explains a 403', () => {
  assert.strictEqual(actionFailureText(new ApiError('GitHub API 409: Workflow is already running', 409)), 'GitHub API 409: Workflow is already running');
  assert.match(actionFailureText(new ApiError('GitHub API 403: Resource not accessible', 403)), /write access/);
  assert.strictEqual(actionFailureText(new Error('boom')), 'boom');
});

test('filter: parse falls back field by field, query follows the filter', () => {
  for (const junk of [undefined, null, 'x', 7, [], {}]) assert.deepStrictEqual(parseFilter(junk), DEFAULT_FILTER);
  assert.deepStrictEqual(parseFilter({ branch: 'yes', mine: true, failed: 1, workflow: '../../x' }), { ...DEFAULT_FILTER, mine: true });
  assert.deepStrictEqual(parseFilter({ workflow: 'ci.yml' }), { ...DEFAULT_FILTER, workflow: 'ci.yml' });
  assert.ok(isDefaultFilter(DEFAULT_FILTER) && !isDefaultFilter({ ...DEFAULT_FILTER, failed: true }));
  assert.strictEqual(describeFilter(DEFAULT_FILTER), '');
  assert.strictEqual(describeFilter({ branch: true, mine: true, failed: true, workflow: 'ci.yml' }), 'Current branch · My runs · Failed only · ci.yml');
  assert.ok(isWorkflowFile('ci.yml') && isWorkflowFile('a-b_c.yaml'));
  for (const bad of ['', 'ci', '../ci.yml', 'a/b.yml', 'ci.yml?x=1', 'x'.repeat(200) + '.yml']) assert.ok(!isWorkflowFile(bad), bad);
  assert.deepStrictEqual(filterRows(DEFAULT_FILTER).map(r => r.id), ['branch', 'mine', 'failed', 'workflow']);
});

test('runsPath: page size, optional qualifiers, workflow-scoped endpoint, encoding', () => {
  const ctx = { branch: 'feat/x y', login: 'octo cat' };
  assert.strictEqual(runsPath('o', 'r', DEFAULT_FILTER, ctx, 1), `/repos/o/r/actions/runs?per_page=${PAGE_SIZE}&page=1`);
  assert.strictEqual(
    runsPath('o', 'r', { branch: true, mine: true, failed: true, workflow: null }, ctx, 2),
    `/repos/o/r/actions/runs?per_page=${PAGE_SIZE}&page=2&branch=feat%2Fx%20y&actor=octo%20cat&status=failure`);
  assert.strictEqual(
    runsPath('o', 'r', { ...DEFAULT_FILTER, workflow: 'ci.yml' }, ctx, 1),
    `/repos/o/r/actions/workflows/ci.yml/runs?per_page=${PAGE_SIZE}&page=1`);
  assert.strictEqual(runsPath('o', 'r', { ...DEFAULT_FILTER, branch: true, mine: true }, { branch: null, login: null }, 1),
    `/repos/o/r/actions/runs?per_page=${PAGE_SIZE}&page=1`, 'no branch (detached) or login: the qualifier is simply dropped');
});

test('nodeId is stable and unique per row kind', () => {
  const r = run(); const j = job();
  const ids = [
    nodeId({ kind: 'repo', repo }), nodeId({ kind: 'signin', repo }), nodeId({ kind: 'group', repo, group: 'runs' }),
    nodeId({ kind: 'group', repo, group: 'workflows' }), nodeId({ kind: 'run', repo, run: r }), nodeId({ kind: 'job', repo, run: r, job: j }),
    nodeId({ kind: 'step', repo, run: r, job: j, step: { number: 2, name: 's', status: 'completed', conclusion: 'success', startedAt: null, completedAt: null } }),
    nodeId({ kind: 'workflow', repo, workflow: { id: 9, name: 'ci', path: 'p', state: 'active' }, dispatchable: false }),
    nodeId({ kind: 'more', repo }),
  ];
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.strictEqual(nodeId({ kind: 'run', repo, run: { ...r, status: 'in_progress' } }), nodeId({ kind: 'run', repo, run: r }), 'a status change keeps the id, so the row stays expanded');
});

test('describeNode: run rows mark the checked-out branch, failed jobs expand by themselves', () => {
  const now = Date.parse('2026-10-01T11:00:00Z');
  const failedRun = run({ conclusion: 'failure' });
  const v = describeNode({ kind: 'run', repo, run: failedRun }, { now, branch: 'main' });
  assert.strictEqual(v.label, 'Fix it');
  assert.ok(v.description!.startsWith('● '), 'checked-out branch marked');
  assert.strictEqual(v.collapsible, 'collapsed');
  assert.strictEqual(v.icon.icon, 'error');
  assert.strictEqual(v.context, 'run failed rerunAll rerunFailed');
  assert.ok(!describeNode({ kind: 'run', repo, run: failedRun }, { now, branch: 'other' }).description!.startsWith('●'));
  const failedJob = describeNode({ kind: 'job', repo, run: failedRun, job: job({ conclusion: 'failure' }) }, { now, branch: null });
  assert.strictEqual(failedJob.collapsible, 'expanded');
  assert.strictEqual(describeNode({ kind: 'job', repo, run: failedRun, job: job() }, { now, branch: null }).collapsible, 'collapsed');
  assert.strictEqual(failedJob.context, 'job failed rerunJob');
  const step = describeNode({ kind: 'step', repo, run: failedRun, job: job(), step: { number: 3, name: 'Test', status: 'completed', conclusion: 'failure', startedAt: '2026-10-01T10:00:00Z', completedAt: '2026-10-01T10:00:12Z' } }, { now, branch: null });
  assert.deepStrictEqual([step.label, step.description, step.collapsible, step.context], ['Test', '12s', 'none', 'step failed']);
  const wf = describeNode({ kind: 'workflow', repo, workflow: { id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'disabled_manually' }, dispatchable: false }, { now, branch: null });
  assert.strictEqual(wf.description, 'disabled');
  assert.strictEqual(wf.context, 'workflow enable');
});

test('dedupeRepos keeps the first folder of a repo that is open twice, case-insensitively', () => {
  const a = { repo: { key: 'o/r', owner: 'o', repo: 'r' }, folder: 'a' };
  const b = { repo: { key: 'o/r', owner: 'O', repo: 'R' }, folder: 'b' };
  const c = { repo: { key: 'o/other', owner: 'o', repo: 'other' }, folder: 'c' };
  assert.deepStrictEqual(dedupeRepos([a, b, c]).map(x => x.folder), ['a', 'c']);
});

test('mergeRuns: fresh page first, older loaded pages kept, no duplicates', () => {
  const r = (id: number) => run({ id });
  assert.deepStrictEqual(mergeRuns([r(5), r(4), r(3)], [r(4), r(3), r(2), r(1)]).map(x => x.id), [5, 4, 3, 2, 1]);
  assert.deepStrictEqual(mergeRuns([], [r(1)]).map(x => x.id), [1]);
});

test('pollDelay: 10 s, 30 s for old runs, back-off on errors, rate limit wins', () => {
  const now = 1_000_000_000;
  const base = { now, failures: 0, retryAt: null as number | null };
  assert.strictEqual(pollDelay({ ...base, oldestActiveSince: now - 60_000 }), 10_000);
  assert.strictEqual(pollDelay({ ...base, oldestActiveSince: now - 11 * 60_000 }), 30_000);
  assert.strictEqual(pollDelay({ ...base, oldestActiveSince: null }), 10_000);
  assert.deepStrictEqual([1, 2, 3, 9].map(failures => pollDelay({ ...base, failures, oldestActiveSince: now })), [10_000, 30_000, 60_000, 60_000]);
  assert.strictEqual(pollDelay({ ...base, retryAt: now + 120_000, oldestActiveSince: now }), 120_000);
  assert.strictEqual(pollDelay({ ...base, retryAt: now - 5, oldestActiveSince: now }), 10_000);
});

test('branchChoices puts the checked-out branch first only when it exists remotely; isPlausibleRef', () => {
  assert.deepStrictEqual(branchChoices(['main', 'dev', 'feat'], 'feat'), ['feat', 'main', 'dev']);
  assert.deepStrictEqual(branchChoices(['main', 'dev'], 'local-only'), ['main', 'dev']);
  assert.deepStrictEqual(branchChoices(['main'], null), ['main']);
  for (const ok of ['main', 'v1.2.3', 'feat/x']) assert.ok(isPlausibleRef(ok), ok);
  for (const bad of ['', '  ', 'a b', 'a..b', '-x', 'a\nb', 'a~b', 'a^b', 'a:b', 'x'.repeat(300)]) assert.ok(!isPlausibleRef(bad), JSON.stringify(bad));
});

test('mapLimit runs at most `limit` at once and keeps result order', async () => {
  let running = 0; let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async n => {
    running++; peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 5));
    running--;
    return n * 2;
  });
  assert.deepStrictEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.strictEqual(peak, 3);
  assert.deepStrictEqual(await mapLimit([], 3, async () => 1), []);
});

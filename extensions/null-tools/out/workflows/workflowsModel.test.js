'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const workflowsModel_1 = require("./workflowsModel");
const githubApi_1 = require("../github/githubApi");
const workflowsModel_2 = require("./workflowsModel");
const repo = { key: 'o/r', owner: 'o', repo: 'r' };
const run = (over = {}) => ({
    id: 1, workflowId: 9, title: 'Fix it', status: 'completed', conclusion: 'success', branch: 'main', sha: 'abcdef1234567',
    event: 'push', number: 42, attempt: 1, startedAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:01:05Z',
    url: 'https://github.com/o/r/actions/runs/1', actor: 'octocat', ...over,
});
const job = (over = {}) => ({
    id: 5, name: 'build', status: 'completed', conclusion: 'success', startedAt: '2026-10-01T10:00:00Z',
    completedAt: '2026-10-01T10:00:30Z', url: 'https://github.com/o/r/actions/runs/1/job/5', steps: [], ...over,
});
(0, node_test_1.default)('statusIcon: one function for run, job and step rows', () => {
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.statusIcon)('completed', 'success'), { icon: 'pass', color: 'charts.green' });
    for (const c of ['failure', 'timed_out', 'startup_failure'])
        node_assert_1.default.strictEqual((0, workflowsModel_1.statusIcon)('completed', c).icon, 'error', c);
    node_assert_1.default.strictEqual((0, workflowsModel_1.statusIcon)('completed', 'cancelled').icon, 'circle-slash');
    node_assert_1.default.strictEqual((0, workflowsModel_1.statusIcon)('completed', 'skipped').icon, 'debug-step-over');
    node_assert_1.default.strictEqual((0, workflowsModel_1.statusIcon)('completed', 'neutral').icon, 'debug-step-over');
    node_assert_1.default.strictEqual((0, workflowsModel_1.statusIcon)('completed', 'action_required').icon, 'warning');
    node_assert_1.default.strictEqual((0, workflowsModel_1.statusIcon)('in_progress', null).icon, 'sync~spin');
    for (const s of ['queued', 'waiting', 'pending', 'requested'])
        node_assert_1.default.strictEqual((0, workflowsModel_1.statusIcon)(s, null).icon, 'clock', s);
    node_assert_1.default.strictEqual((0, workflowsModel_1.statusIcon)('who-knows', null).icon, 'circle-outline');
});
(0, node_test_1.default)('isActive / isFailed', () => {
    node_assert_1.default.ok((0, workflowsModel_1.isActive)({ status: 'queued' }) && (0, workflowsModel_1.isActive)({ status: 'in_progress' }) && (0, workflowsModel_1.isActive)({ status: 'waiting' }));
    node_assert_1.default.ok(!(0, workflowsModel_1.isActive)({ status: 'completed' }) && !(0, workflowsModel_1.isActive)({ status: '' }), 'an unknown status must not poll forever');
    node_assert_1.default.ok((0, workflowsModel_1.isFailed)({ status: 'completed', conclusion: 'timed_out' }));
    node_assert_1.default.ok(!(0, workflowsModel_1.isFailed)({ status: 'completed', conclusion: 'cancelled' }) && !(0, workflowsModel_1.isFailed)({ status: 'in_progress', conclusion: null }));
});
(0, node_test_1.default)('durations', () => {
    node_assert_1.default.strictEqual((0, workflowsModel_1.formatDuration)(0), '0s');
    node_assert_1.default.strictEqual((0, workflowsModel_1.formatDuration)(45_000), '45s');
    node_assert_1.default.strictEqual((0, workflowsModel_1.formatDuration)(65_000), '1m 5s');
    node_assert_1.default.strictEqual((0, workflowsModel_1.formatDuration)(3_725_000), '1h 2m');
    node_assert_1.default.strictEqual((0, workflowsModel_1.formatDuration)(-5), '0s');
    node_assert_1.default.strictEqual((0, workflowsModel_1.elapsed)(null, null, 0), '');
    node_assert_1.default.strictEqual((0, workflowsModel_1.elapsed)('2026-10-01T10:00:00Z', '2026-10-01T10:00:30Z', 0), '30s');
    const now = Date.parse('2026-10-01T10:02:00Z');
    node_assert_1.default.strictEqual((0, workflowsModel_1.elapsed)('2026-10-01T10:00:00Z', null, now), '2m 0s');
    node_assert_1.default.strictEqual((0, workflowsModel_1.elapsed)('garbage', null, now), '');
});
(0, node_test_1.default)('runDescription: attempt only above 1, duration from updatedAt when finished', () => {
    const now = Date.parse('2026-10-01T11:00:00Z');
    node_assert_1.default.strictEqual((0, workflowsModel_1.runDescription)(run(), now), 'main · abcdef1 · push · 1m 5s · #42');
    node_assert_1.default.strictEqual((0, workflowsModel_1.runDescription)(run({ attempt: 3 }), now), 'main · abcdef1 · push · 1m 5s · #42 · attempt 3');
    const active = (0, workflowsModel_1.runDescription)(run({ status: 'in_progress', conclusion: null }), Date.parse('2026-10-01T10:00:10Z'));
    node_assert_1.default.strictEqual(active, 'main · abcdef1 · push · 10s · #42');
});
(0, node_test_1.default)('mapRun / mapJob tolerate missing fields and refuse non-github urls', () => {
    const r = (0, workflowsModel_1.mapRun)({ id: 7, workflow_id: 3, display_title: 'T', status: 'queued', head_branch: 'x', head_sha: 'a'.repeat(40),
        event: 'push', run_number: 5, html_url: 'javascript:alert(1)', created_at: '2026-10-01T10:00:00Z' });
    node_assert_1.default.strictEqual(r.url, '');
    node_assert_1.default.strictEqual(r.attempt, 1);
    node_assert_1.default.strictEqual(r.actor, '');
    node_assert_1.default.strictEqual(r.startedAt, '2026-10-01T10:00:00Z');
    node_assert_1.default.strictEqual(r.title, 'T');
    node_assert_1.default.strictEqual((0, workflowsModel_1.mapRun)({ id: 1, name: 'CI', html_url: 'https://github.com/o/r/actions/runs/1' }).title, 'CI');
    const j = (0, workflowsModel_1.mapJob)({ id: 1, name: 'b', status: 'completed', conclusion: 'failure', steps: [{ number: 1, name: 's', status: 'completed', conclusion: 'failure' }, null] });
    node_assert_1.default.strictEqual(j.steps.length, 1, 'a null step is dropped');
    node_assert_1.default.strictEqual(j.steps[0].conclusion, 'failure');
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.mapJob)({ id: 2, name: 'x' }).steps, []);
});
(0, node_test_1.default)('runActions: what each run state offers', () => {
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.runActions)(run()), ['rerunAll']);
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.runActions)(run({ conclusion: 'failure' })), ['rerunAll', 'rerunFailed']);
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.runActions)(run({ status: 'in_progress', conclusion: null })), ['cancel']);
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.runActions)(run({ status: 'queued', conclusion: null })), ['cancel']);
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.runActions)(run({ conclusion: 'cancelled' })), ['rerunAll']);
});
(0, node_test_1.default)('refusal: the host re-reads the target and refuses a stale click with the reason', () => {
    const finished = { status: 'completed', conclusion: 'success' };
    const running = { status: 'in_progress', conclusion: null };
    node_assert_1.default.strictEqual((0, workflowsModel_1.refusal)('cancel', running), null);
    node_assert_1.default.match((0, workflowsModel_1.refusal)('cancel', finished), /already finished/);
    node_assert_1.default.strictEqual((0, workflowsModel_1.refusal)('rerunAll', finished), null);
    node_assert_1.default.match((0, workflowsModel_1.refusal)('rerunAll', running), /still running/);
    node_assert_1.default.match((0, workflowsModel_1.refusal)('rerunFailed', finished), /no failed jobs/);
    node_assert_1.default.strictEqual((0, workflowsModel_1.refusal)('rerunFailed', { status: 'completed', conclusion: 'failure' }), null);
    node_assert_1.default.match((0, workflowsModel_1.refusal)('rerunJob', running), /still running/);
    node_assert_1.default.strictEqual((0, workflowsModel_1.refusal)('rerunJob', finished), null);
});
(0, node_test_1.default)('context values are space-separated tokens the when-clauses match', () => {
    node_assert_1.default.strictEqual((0, workflowsModel_1.runContext)(run({ conclusion: 'failure' })), 'run failed rerunAll rerunFailed');
    node_assert_1.default.strictEqual((0, workflowsModel_1.runContext)(run({ status: 'queued', conclusion: null })), 'run cancel');
    node_assert_1.default.strictEqual((0, workflowsModel_1.workflowContext)({ id: 1, name: 'ci', path: '.github/workflows/ci.yml', state: 'active' }, true), 'workflow dispatch');
    node_assert_1.default.strictEqual((0, workflowsModel_1.workflowContext)({ id: 1, name: 'ci', path: 'p', state: 'active' }, false), 'workflow');
    node_assert_1.default.strictEqual((0, workflowsModel_1.workflowContext)({ id: 1, name: 'ci', path: 'p', state: 'disabled_manually' }, true), 'workflow enable');
});
(0, node_test_1.default)('actionFailureText keeps GitHub\'s words and explains a 403', () => {
    node_assert_1.default.strictEqual((0, workflowsModel_2.actionFailureText)(new githubApi_1.ApiError('GitHub API 409: Workflow is already running', 409)), 'GitHub API 409: Workflow is already running');
    node_assert_1.default.match((0, workflowsModel_2.actionFailureText)(new githubApi_1.ApiError('GitHub API 403: Resource not accessible', 403)), /write access/);
    node_assert_1.default.strictEqual((0, workflowsModel_2.actionFailureText)(new Error('boom')), 'boom');
});
(0, node_test_1.default)('filter: parse falls back field by field, query follows the filter', () => {
    for (const junk of [undefined, null, 'x', 7, [], {}])
        node_assert_1.default.deepStrictEqual((0, workflowsModel_1.parseFilter)(junk), workflowsModel_1.DEFAULT_FILTER);
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.parseFilter)({ branch: 'yes', mine: true, failed: 1, workflow: '../../x' }), { ...workflowsModel_1.DEFAULT_FILTER, mine: true });
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.parseFilter)({ workflow: 'ci.yml' }), { ...workflowsModel_1.DEFAULT_FILTER, workflow: 'ci.yml' });
    node_assert_1.default.ok((0, workflowsModel_1.isDefaultFilter)(workflowsModel_1.DEFAULT_FILTER) && !(0, workflowsModel_1.isDefaultFilter)({ ...workflowsModel_1.DEFAULT_FILTER, failed: true }));
    node_assert_1.default.strictEqual((0, workflowsModel_1.describeFilter)(workflowsModel_1.DEFAULT_FILTER), '');
    node_assert_1.default.strictEqual((0, workflowsModel_1.describeFilter)({ branch: true, mine: true, failed: true, workflow: 'ci.yml' }), 'Current branch · My runs · Failed only · ci.yml');
    node_assert_1.default.ok((0, workflowsModel_1.isWorkflowFile)('ci.yml') && (0, workflowsModel_1.isWorkflowFile)('a-b_c.yaml'));
    for (const bad of ['', 'ci', '../ci.yml', 'a/b.yml', 'ci.yml?x=1', 'x'.repeat(200) + '.yml'])
        node_assert_1.default.ok(!(0, workflowsModel_1.isWorkflowFile)(bad), bad);
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.filterRows)(workflowsModel_1.DEFAULT_FILTER).map(r => r.id), ['branch', 'mine', 'failed', 'workflow']);
});
(0, node_test_1.default)('runsPath: page size, optional qualifiers, workflow-scoped endpoint, encoding', () => {
    const ctx = { branch: 'feat/x y', login: 'octo cat' };
    node_assert_1.default.strictEqual((0, workflowsModel_1.runsPath)('o', 'r', workflowsModel_1.DEFAULT_FILTER, ctx, 1), `/repos/o/r/actions/runs?per_page=${workflowsModel_1.PAGE_SIZE}&page=1`);
    node_assert_1.default.strictEqual((0, workflowsModel_1.runsPath)('o', 'r', { branch: true, mine: true, failed: true, workflow: null }, ctx, 2), `/repos/o/r/actions/runs?per_page=${workflowsModel_1.PAGE_SIZE}&page=2&branch=feat%2Fx%20y&actor=octo%20cat&status=failure`);
    node_assert_1.default.strictEqual((0, workflowsModel_1.runsPath)('o', 'r', { ...workflowsModel_1.DEFAULT_FILTER, workflow: 'ci.yml' }, ctx, 1), `/repos/o/r/actions/workflows/ci.yml/runs?per_page=${workflowsModel_1.PAGE_SIZE}&page=1`);
    node_assert_1.default.strictEqual((0, workflowsModel_1.runsPath)('o', 'r', { ...workflowsModel_1.DEFAULT_FILTER, branch: true, mine: true }, { branch: null, login: null }, 1), `/repos/o/r/actions/runs?per_page=${workflowsModel_1.PAGE_SIZE}&page=1`, 'no branch (detached) or login: the qualifier is simply dropped');
});
(0, node_test_1.default)('nodeId is stable and unique per row kind', () => {
    const r = run();
    const j = job();
    const ids = [
        (0, workflowsModel_1.nodeId)({ kind: 'repo', repo }), (0, workflowsModel_1.nodeId)({ kind: 'signin', repo }), (0, workflowsModel_1.nodeId)({ kind: 'group', repo, group: 'runs' }),
        (0, workflowsModel_1.nodeId)({ kind: 'group', repo, group: 'workflows' }), (0, workflowsModel_1.nodeId)({ kind: 'run', repo, run: r }), (0, workflowsModel_1.nodeId)({ kind: 'job', repo, run: r, job: j }),
        (0, workflowsModel_1.nodeId)({ kind: 'step', repo, run: r, job: j, step: { number: 2, name: 's', status: 'completed', conclusion: 'success', startedAt: null, completedAt: null } }),
        (0, workflowsModel_1.nodeId)({ kind: 'workflow', repo, workflow: { id: 9, name: 'ci', path: 'p', state: 'active' }, dispatchable: false }),
        (0, workflowsModel_1.nodeId)({ kind: 'more', repo }),
    ];
    node_assert_1.default.strictEqual(new Set(ids).size, ids.length);
    node_assert_1.default.strictEqual((0, workflowsModel_1.nodeId)({ kind: 'run', repo, run: { ...r, status: 'in_progress' } }), (0, workflowsModel_1.nodeId)({ kind: 'run', repo, run: r }), 'a status change keeps the id, so the row stays expanded');
});
(0, node_test_1.default)('describeNode: run rows mark the checked-out branch, failed jobs expand by themselves', () => {
    const now = Date.parse('2026-10-01T11:00:00Z');
    const failedRun = run({ conclusion: 'failure' });
    const v = (0, workflowsModel_1.describeNode)({ kind: 'run', repo, run: failedRun }, { now, branch: 'main' });
    node_assert_1.default.strictEqual(v.label, 'Fix it');
    node_assert_1.default.ok(v.description.startsWith('● '), 'checked-out branch marked');
    node_assert_1.default.strictEqual(v.collapsible, 'collapsed');
    node_assert_1.default.strictEqual(v.icon.icon, 'error');
    node_assert_1.default.strictEqual(v.context, 'run failed rerunAll rerunFailed');
    node_assert_1.default.ok(!(0, workflowsModel_1.describeNode)({ kind: 'run', repo, run: failedRun }, { now, branch: 'other' }).description.startsWith('●'));
    const failedJob = (0, workflowsModel_1.describeNode)({ kind: 'job', repo, run: failedRun, job: job({ conclusion: 'failure' }) }, { now, branch: null });
    node_assert_1.default.strictEqual(failedJob.collapsible, 'expanded');
    node_assert_1.default.strictEqual((0, workflowsModel_1.describeNode)({ kind: 'job', repo, run: failedRun, job: job() }, { now, branch: null }).collapsible, 'collapsed');
    node_assert_1.default.strictEqual(failedJob.context, 'job failed rerunJob');
    const step = (0, workflowsModel_1.describeNode)({ kind: 'step', repo, run: failedRun, job: job(), step: { number: 3, name: 'Test', status: 'completed', conclusion: 'failure', startedAt: '2026-10-01T10:00:00Z', completedAt: '2026-10-01T10:00:12Z' } }, { now, branch: null });
    node_assert_1.default.deepStrictEqual([step.label, step.description, step.collapsible, step.context], ['Test', '12s', 'none', 'step failed']);
    const wf = (0, workflowsModel_1.describeNode)({ kind: 'workflow', repo, workflow: { id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'disabled_manually' }, dispatchable: false }, { now, branch: null });
    node_assert_1.default.strictEqual(wf.description, 'disabled');
    node_assert_1.default.strictEqual(wf.context, 'workflow enable');
});
(0, node_test_1.default)('dedupeRepos keeps the first folder of a repo that is open twice, case-insensitively', () => {
    const a = { repo: { key: 'o/r', owner: 'o', repo: 'r' }, folder: 'a' };
    const b = { repo: { key: 'o/r', owner: 'O', repo: 'R' }, folder: 'b' };
    const c = { repo: { key: 'o/other', owner: 'o', repo: 'other' }, folder: 'c' };
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.dedupeRepos)([a, b, c]).map(x => x.folder), ['a', 'c']);
});
(0, node_test_1.default)('mergeRuns: fresh page first, older loaded pages kept, no duplicates', () => {
    const r = (id) => run({ id });
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.mergeRuns)([r(5), r(4), r(3)], [r(4), r(3), r(2), r(1)]).map(x => x.id), [5, 4, 3, 2, 1]);
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.mergeRuns)([], [r(1)]).map(x => x.id), [1]);
});
(0, node_test_1.default)('pollDelay: 10 s, 30 s for old runs, back-off on errors, rate limit wins', () => {
    const now = 1_000_000_000;
    const base = { now, failures: 0, retryAt: null };
    node_assert_1.default.strictEqual((0, workflowsModel_1.pollDelay)({ ...base, oldestActiveSince: now - 60_000 }), 10_000);
    node_assert_1.default.strictEqual((0, workflowsModel_1.pollDelay)({ ...base, oldestActiveSince: now - 11 * 60_000 }), 30_000);
    node_assert_1.default.strictEqual((0, workflowsModel_1.pollDelay)({ ...base, oldestActiveSince: null }), 10_000);
    node_assert_1.default.deepStrictEqual([1, 2, 3, 9].map(failures => (0, workflowsModel_1.pollDelay)({ ...base, failures, oldestActiveSince: now })), [10_000, 30_000, 60_000, 60_000]);
    node_assert_1.default.strictEqual((0, workflowsModel_1.pollDelay)({ ...base, retryAt: now + 120_000, oldestActiveSince: now }), 120_000);
    node_assert_1.default.strictEqual((0, workflowsModel_1.pollDelay)({ ...base, retryAt: now - 5, oldestActiveSince: now }), 10_000);
});
(0, node_test_1.default)('branchChoices puts the checked-out branch first only when it exists remotely; isPlausibleRef', () => {
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.branchChoices)(['main', 'dev', 'feat'], 'feat'), ['feat', 'main', 'dev']);
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.branchChoices)(['main', 'dev'], 'local-only'), ['main', 'dev']);
    node_assert_1.default.deepStrictEqual((0, workflowsModel_1.branchChoices)(['main'], null), ['main']);
    for (const ok of ['main', 'v1.2.3', 'feat/x'])
        node_assert_1.default.ok((0, workflowsModel_1.isPlausibleRef)(ok), ok);
    for (const bad of ['', '  ', 'a b', 'a..b', '-x', 'a\nb', 'a~b', 'a^b', 'a:b', 'x'.repeat(300)])
        node_assert_1.default.ok(!(0, workflowsModel_1.isPlausibleRef)(bad), JSON.stringify(bad));
});
(0, node_test_1.default)('mapLimit runs at most `limit` at once and keeps result order', async () => {
    let running = 0;
    let peak = 0;
    const out = await (0, workflowsModel_1.mapLimit)([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise(r => setTimeout(r, 5));
        running--;
        return n * 2;
    });
    node_assert_1.default.deepStrictEqual(out, [2, 4, 6, 8, 10, 12, 14]);
    node_assert_1.default.strictEqual(peak, 3);
    node_assert_1.default.deepStrictEqual(await (0, workflowsModel_1.mapLimit)([], 3, async () => 1), []);
});
//# sourceMappingURL=workflowsModel.test.js.map
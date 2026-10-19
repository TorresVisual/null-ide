'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importStar(require("node:test"));
const githubApi_1 = require("../github/githubApi");
const httpStub_1 = require("../pulls/httpStub");
const workflowsApi_1 = require("./workflowsApi");
const workflowsModel_1 = require("./workflowsModel");
(0, node_test_1.afterEach)(() => node_test_1.mock.restoreAll());
const ctx = { branch: 'main', login: 'me' };
(0, node_test_1.default)('listRuns sends the filter and maps the payload', async () => {
    const calls = (0, httpStub_1.stub)([{ body: { total_count: 41, workflow_runs: [{ id: 1, workflow_id: 2, display_title: 'T', status: 'completed', conclusion: 'success', run_number: 9, html_url: 'https://github.com/o/r/actions/runs/1' }] } }]);
    const res = await (0, workflowsApi_1.listRuns)('o', 'r', { ...workflowsModel_1.DEFAULT_FILTER, failed: true }, ctx, 2, 'tok');
    node_assert_1.default.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/actions/runs?per_page=30&page=2&status=failure');
    node_assert_1.default.strictEqual(calls[0].headers.Authorization, 'Bearer tok');
    node_assert_1.default.strictEqual(res.total, 41);
    node_assert_1.default.strictEqual(res.runs[0].title, 'T');
});
(0, node_test_1.default)('jobs, workflows and branches use the latest attempt and the first 100', async () => {
    const calls = (0, httpStub_1.stub)([
        { body: { jobs: [{ id: 5, name: 'b', status: 'completed', steps: [] }] } },
        { body: { total_count: 120, workflows: [{ id: 3, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' }] } },
        { body: [{ name: 'main' }, { name: 'dev' }] },
        { body: { default_branch: 'trunk' } },
    ]);
    node_assert_1.default.strictEqual((await (0, workflowsApi_1.listJobs)('o', 'r', 77, 't'))[0].id, 5);
    const wf = await (0, workflowsApi_1.listWorkflows)('o', 'r', 't');
    node_assert_1.default.deepStrictEqual([wf.total, wf.workflows[0].name], [120, 'CI']);
    node_assert_1.default.deepStrictEqual(await (0, workflowsApi_1.listBranches)('o', 'r', 't'), ['main', 'dev']);
    node_assert_1.default.strictEqual(await (0, workflowsApi_1.getDefaultBranch)('o', 'r', 't'), 'trunk');
    node_assert_1.default.deepStrictEqual(calls.map(c => c.url), [
        'https://api.github.com/repos/o/r/actions/runs/77/jobs?filter=latest&per_page=100',
        'https://api.github.com/repos/o/r/actions/workflows?per_page=100',
        'https://api.github.com/repos/o/r/branches?per_page=100',
        'https://api.github.com/repos/o/r',
    ]);
});
(0, node_test_1.default)('management calls hit the documented endpoints with the right verb and body', async () => {
    const calls = (0, httpStub_1.stub)([{ status: 201, raw: '' }]);
    await (0, workflowsApi_1.rerunRun)('o', 'r', 1, 't');
    await (0, workflowsApi_1.rerunFailedJobs)('o', 'r', 2, 't');
    await (0, workflowsApi_1.rerunJob)('o', 'r', 3, 't');
    await (0, workflowsApi_1.cancelRun)('o', 'r', 4, 't');
    await (0, workflowsApi_1.enableWorkflow)('o', 'r', 5, 't');
    await (0, workflowsApi_1.dispatchWorkflow)('o', 'r', 6, 'main', {}, 't');
    await (0, workflowsApi_1.dispatchWorkflow)('o', 'r', 6, 'v1', { who: 'me', fail: 'false' }, 't');
    node_assert_1.default.deepStrictEqual(calls.map(c => `${c.method} ${c.url.replace('https://api.github.com/repos/o/r/actions/', '')}`), [
        'POST runs/1/rerun', 'POST runs/2/rerun-failed-jobs', 'POST jobs/3/rerun', 'POST runs/4/cancel',
        'PUT workflows/5/enable', 'POST workflows/6/dispatches', 'POST workflows/6/dispatches',
    ]);
    node_assert_1.default.deepStrictEqual(calls[5].body, { ref: 'main' }, 'no inputs key when there are none');
    node_assert_1.default.deepStrictEqual(calls[6].body, { ref: 'v1', inputs: { who: 'me', fail: 'false' } });
});
(0, node_test_1.default)('a refusal keeps GitHub\'s words in the ApiError', async () => {
    (0, httpStub_1.stub)([{ status: 409, body: { message: 'Workflow is already running' } }]);
    await node_assert_1.default.rejects((0, workflowsApi_1.rerunRun)('o', 'r', 1, 't'), (e) => e instanceof githubApi_1.ApiError && e.status === 409 && /already running/.test(e.message));
});
(0, node_test_1.default)('fetchJobLog follows the redirect and never sends the token to the second host', async () => {
    const calls = (0, httpStub_1.stub)([
        { status: 302, raw: '', headers: { location: 'https://logs.example.net/signed?sig=abc' } },
        { raw: '2026-10-01T10:00:00.0000000Z hello\n' },
    ]);
    const log = await (0, workflowsApi_1.fetchJobLog)('o', 'r', 9, 'secret-token');
    node_assert_1.default.strictEqual(log.text, '2026-10-01T10:00:00.0000000Z hello\n');
    node_assert_1.default.strictEqual(log.truncated, false);
    node_assert_1.default.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/actions/jobs/9/logs');
    node_assert_1.default.strictEqual(calls[0].headers.Authorization, 'Bearer secret-token');
    node_assert_1.default.strictEqual(calls[1].url, 'https://logs.example.net/signed?sig=abc');
    node_assert_1.default.strictEqual(calls[1].headers.Authorization, undefined, 'the token stays on api.github.com');
    node_assert_1.default.ok(!JSON.stringify(calls[1].headers).includes('secret-token'));
});
(0, node_test_1.default)('fetchJobLog: bad redirects, missing logs and big logs end in a clear result', async () => {
    (0, httpStub_1.stub)([{ status: 302, raw: '' }]);
    await node_assert_1.default.rejects((0, workflowsApi_1.fetchJobLog)('o', 'r', 9, 't'), /did not say where/);
    node_test_1.mock.restoreAll();
    (0, httpStub_1.stub)([{ status: 302, raw: '', headers: { location: 'http://insecure.example/log' } }]);
    await node_assert_1.default.rejects((0, workflowsApi_1.fetchJobLog)('o', 'r', 9, 't'), /https/);
    node_test_1.mock.restoreAll();
    (0, httpStub_1.stub)([{ status: 404, body: { message: 'Not Found' } }]);
    await node_assert_1.default.rejects((0, workflowsApi_1.fetchJobLog)('o', 'r', 9, 't'), (e) => e instanceof githubApi_1.ApiError && e.status === 404);
    node_test_1.mock.restoreAll();
    (0, httpStub_1.stub)([{ status: 302, raw: '', headers: { location: 'https://logs.example.net/x' } }, { status: 403, raw: '<Error>expired</Error>' }]);
    await node_assert_1.default.rejects((0, workflowsApi_1.fetchJobLog)('o', 'r', 9, 't'), (e) => e instanceof githubApi_1.ApiError && e.status === 403);
    node_test_1.mock.restoreAll();
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    (0, httpStub_1.stub)([{ status: 302, raw: '', headers: { location: 'https://logs.example.net/x' } }, { raw: lines }]);
    const big = await (0, workflowsApi_1.fetchJobLog)('o', 'r', 9, 't', 200);
    node_assert_1.default.strictEqual(big.truncated, true);
    node_assert_1.default.ok(big.text.length <= 200);
    node_assert_1.default.ok(big.text.endsWith('line 99'), 'the end of the log is what survives');
    node_assert_1.default.ok(/^line \d+/.test(big.text), 'the cut lands on a line boundary');
});
(0, node_test_1.default)('fetchJobLog accepts a log served directly with 200', async () => {
    (0, httpStub_1.stub)([{ raw: 'direct\n' }]);
    node_assert_1.default.deepStrictEqual(await (0, workflowsApi_1.fetchJobLog)('o', 'r', 9, 't'), { text: 'direct\n', truncated: false });
});
//# sourceMappingURL=workflowsApi.test.js.map
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
const node_events_1 = require("node:events");
const node_https_1 = __importDefault(require("node:https"));
const node_test_1 = __importStar(require("node:test"));
const pullDetailApi_1 = require("./pullDetailApi");
(0, node_test_1.afterEach)(() => node_test_1.mock.restoreAll());
/** Answers each https.request with the next canned response (the last one repeats) and records what was asked. */
function stub(responses) {
    const calls = [];
    node_test_1.mock.method(node_https_1.default, 'request', (url, opts, onResponse) => {
        const call = { url, method: opts.method };
        calls.push(call);
        const next = responses[Math.min(calls.length - 1, responses.length - 1)];
        return Object.assign(new node_events_1.EventEmitter(), {
            setTimeout() { }, destroy() { },
            write(payload) { call.body = JSON.parse(payload); },
            end() {
                const res = Object.assign(new node_events_1.EventEmitter(), { statusCode: next.status ?? 200, headers: {}, setEncoding() { } });
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
(0, node_test_1.default)('fetchPullPage asks GraphQL for one PR and maps it', async () => {
    const calls = stub([{ body: { data: { repository: { pullRequest: minimalPage } } } }]);
    const page = await (0, pullDetailApi_1.fetchPullPage)('o', 'r', 5, 't');
    node_assert_1.default.strictEqual(calls[0].url, 'https://api.github.com/graphql');
    node_assert_1.default.deepStrictEqual(calls[0].body.variables, { owner: 'o', name: 'r', number: 5 });
    node_assert_1.default.strictEqual(page.state, 'merged');
    node_assert_1.default.strictEqual(page.author.login, 'ghost');
});
(0, node_test_1.default)('fetchPullPage: a PR that does not exist is a readable error', async () => {
    stub([{ body: { data: { repository: { pullRequest: null } } } }]);
    await node_assert_1.default.rejects((0, pullDetailApi_1.fetchPullPage)('o', 'r', 404, 't'), /Pull request not found/);
});
(0, node_test_1.default)('rerunFailedRuns posts once per run, in order', async () => {
    const calls = stub([{ status: 201, body: {} }]);
    node_assert_1.default.deepStrictEqual(await (0, pullDetailApi_1.rerunFailedRuns)('o', 'r', [11, 12], 't'), { started: 2, errors: [] });
    node_assert_1.default.deepStrictEqual(calls.map(c => `${c.method} ${c.url}`), [
        'POST https://api.github.com/repos/o/r/actions/runs/11/rerun-failed-jobs',
        'POST https://api.github.com/repos/o/r/actions/runs/12/rerun-failed-jobs',
    ]);
});
(0, node_test_1.default)('rerunFailedRuns: a run GitHub refuses is reported with GitHub\'s words, the rest still go', async () => {
    const calls = stub([{ status: 403, body: { message: 'Workflow is still running' } }, { status: 201, body: {} }]);
    const result = await (0, pullDetailApi_1.rerunFailedRuns)('o', 'r', [11, 12], 't');
    node_assert_1.default.strictEqual(calls.length, 2);
    node_assert_1.default.strictEqual(result.started, 1);
    node_assert_1.default.strictEqual(result.errors.length, 1);
    node_assert_1.default.match(result.errors[0], /Workflow is still running/);
});
(0, node_test_1.default)('rerunFailedRuns with no runs makes no request', async () => {
    const calls = stub([{ body: {} }]);
    node_assert_1.default.deepStrictEqual(await (0, pullDetailApi_1.rerunFailedRuns)('o', 'r', [], 't'), { started: 0, errors: [] });
    node_assert_1.default.strictEqual(calls.length, 0);
});
//# sourceMappingURL=pullDetailApi.test.js.map
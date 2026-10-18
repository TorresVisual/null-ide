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
const pullApi_1 = require("./pullApi");
const pullFilter_1 = require("./pullFilter");
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
                const res = Object.assign(new node_events_1.EventEmitter(), { statusCode: 200, headers: {}, setEncoding() { } });
                onResponse(res);
                res.emit('data', JSON.stringify(next));
                res.emit('end');
            },
        });
    });
    return calls;
}
const restFile = (i) => ({ filename: `f${i}.ts`, status: 'modified', additions: 1, deletions: 0 });
(0, node_test_1.default)('listPulls sends the filter as the search query', async () => {
    const empty = { data: { search: { nodes: [] } } };
    const calls = stub([empty, empty]);
    node_assert_1.default.deepStrictEqual(await (0, pullApi_1.listPulls)('o', 'r', pullFilter_1.DEFAULT_FILTER, 't'), []);
    node_assert_1.default.strictEqual(calls[0].url, 'https://api.github.com/graphql');
    node_assert_1.default.strictEqual(calls[0].body.variables.q, 'repo:o/r is:pr is:open sort:updated-desc');
    await (0, pullApi_1.listPulls)('o', 'r', { ...pullFilter_1.DEFAULT_FILTER, state: 'merged', mine: true }, 't');
    node_assert_1.default.strictEqual(calls[1].body.variables.q, 'repo:o/r is:pr is:merged author:@me sort:updated-desc');
});
(0, node_test_1.default)('fetchPullFiles pages until a short page, so a PR with more than 100 files is not cut off', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => restFile(i));
    const calls = stub([page1, [restFile(100)]]);
    const files = await (0, pullApi_1.fetchPullFiles)('o', 'r', 5, 't');
    node_assert_1.default.strictEqual(files.length, 101);
    node_assert_1.default.deepStrictEqual(calls.map(c => c.url), [
        'https://api.github.com/repos/o/r/pulls/5/files?per_page=100&page=1',
        'https://api.github.com/repos/o/r/pulls/5/files?per_page=100&page=2',
    ]);
});
(0, node_test_1.default)('fetchMergeBase returns the merge-base commit of base...head', async () => {
    const calls = stub([{ merge_base_commit: { sha: 'c'.repeat(40) } }]);
    node_assert_1.default.strictEqual(await (0, pullApi_1.fetchMergeBase)('o', 'r', 'a'.repeat(40), 'b'.repeat(40), 't'), 'c'.repeat(40));
    node_assert_1.default.strictEqual(calls[0].url, `https://api.github.com/repos/o/r/compare/${'a'.repeat(40)}...${'b'.repeat(40)}?per_page=1`);
});
(0, node_test_1.default)('fetchReviewThreads sends owner, name and number', async () => {
    const calls = stub([{ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } }]);
    node_assert_1.default.deepStrictEqual(await (0, pullApi_1.fetchReviewThreads)('o', 'r', 5, 't'), { threads: [], outdated: 0 });
    node_assert_1.default.deepStrictEqual(calls[0].body.variables, { owner: 'o', name: 'r', number: 5 });
});
const posted = { id: 9, body: 'ok', created_at: '2026-10-01T10:00:00Z', user: { login: 'me', avatar_url: 'u' } };
(0, node_test_1.default)('createLineComment posts a single-line review comment on the head commit', async () => {
    const calls = stub([posted]);
    const c = await (0, pullApi_1.createLineComment)('o', 'r', 5, { body: 'ok', commitId: 'b'.repeat(40), path: 'a.ts', line: 3, side: 'RIGHT' }, 't');
    node_assert_1.default.strictEqual(c.id, 9);
    node_assert_1.default.strictEqual(calls[0].method, 'POST');
    node_assert_1.default.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/pulls/5/comments');
    node_assert_1.default.deepStrictEqual(calls[0].body, { body: 'ok', commit_id: 'b'.repeat(40), path: 'a.ts', line: 3, side: 'RIGHT' });
});
(0, node_test_1.default)('createLineComment sends start_line / start_side for a multi-line range on one side', async () => {
    const calls = stub([posted]);
    await (0, pullApi_1.createLineComment)('o', 'r', 5, { body: 'ok', commitId: 'b'.repeat(40), path: 'a.ts', startLine: 3, line: 6, side: 'LEFT' }, 't');
    node_assert_1.default.deepStrictEqual(calls[0].body, {
        body: 'ok', commit_id: 'b'.repeat(40), path: 'a.ts', start_line: 3, start_side: 'LEFT', line: 6, side: 'LEFT',
    });
});
(0, node_test_1.default)('replyToComment posts to the thread\'s first comment', async () => {
    const calls = stub([posted]);
    await (0, pullApi_1.replyToComment)('o', 'r', 5, 101, 'thanks', 't');
    node_assert_1.default.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/pulls/5/comments/101/replies');
    node_assert_1.default.deepStrictEqual(calls[0].body, { body: 'thanks' });
});
(0, node_test_1.default)('fetchLabelNames returns the names and drops any that could break out of a search qualifier', async () => {
    const calls = stub([[{ name: 'bug' }, { name: 'good first issue' }, { name: 'x" is:closed' }]]);
    node_assert_1.default.deepStrictEqual(await (0, pullApi_1.fetchLabelNames)('o', 'r', 't'), ['bug', 'good first issue']);
    node_assert_1.default.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/labels?per_page=100');
});
(0, node_test_1.default)('fetchMilestoneTitles lists open and closed milestones, minus unsafe titles', async () => {
    const calls = stub([[{ title: 'v1' }, { title: 'v2\nis:open' }]]);
    node_assert_1.default.deepStrictEqual(await (0, pullApi_1.fetchMilestoneTitles)('o', 'r', 't'), ['v1']);
    node_assert_1.default.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/milestones?state=all&per_page=100');
});
//# sourceMappingURL=pullApi.test.js.map
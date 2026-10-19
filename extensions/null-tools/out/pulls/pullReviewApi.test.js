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
const httpStub_1 = require("./httpStub");
const pullReviewApi_1 = require("./pullReviewApi");
(0, node_test_1.afterEach)(() => node_test_1.mock.restoreAll());
const stateData = (reviews, over = {}) => ({
    data: { repository: { pullRequest: { id: 'PR_1', headRefOid: 'a'.repeat(40), viewerDidAuthor: false, reviews: { nodes: reviews }, ...over } } },
});
const pending = { id: 'REV_1', comments: { totalCount: 3 } };
const gqlComment = { databaseId: 9, state: 'PENDING', body: 'hm', createdAt: '2026-10-01T10:00:00Z', author: { login: 'me', avatarUrl: 'https://x/m.png' } };
(0, node_test_1.default)('fetchReviewState reads the PR id, head, authorship and the unsent review', async () => {
    const calls = (0, httpStub_1.stub)([{ body: stateData([pending]) }]);
    node_assert_1.default.deepStrictEqual(await (0, pullReviewApi_1.fetchReviewState)('o', 'r', 5, 't'), {
        pullId: 'PR_1', headSha: 'a'.repeat(40), viewerIsAuthor: false, reviewId: 'REV_1', comments: 3,
    });
    node_assert_1.default.deepStrictEqual(calls[0].body.variables, { owner: 'o', name: 'r', number: 5 });
    node_assert_1.default.match(calls[0].body.query, /states: \[PENDING\]/);
});
(0, node_test_1.default)('fetchReviewState: no unsent review, and a PR that does not exist', async () => {
    (0, httpStub_1.stub)([{ body: stateData([]) }]);
    node_assert_1.default.deepStrictEqual({ ...await (0, pullReviewApi_1.fetchReviewState)('o', 'r', 5, 't') }, { pullId: 'PR_1', headSha: 'a'.repeat(40), viewerIsAuthor: false, reviewId: null, comments: 0 });
    node_test_1.mock.restoreAll();
    (0, httpStub_1.stub)([{ body: { data: { repository: { pullRequest: null } } } }]);
    await node_assert_1.default.rejects((0, pullReviewApi_1.fetchReviewState)('o', 'r', 404, 't'), /Pull request not found/);
});
(0, node_test_1.default)('ensureReview reuses the unsent review and starts one only when there is none', async () => {
    const reuse = (0, httpStub_1.stub)([{ body: stateData([pending]) }]);
    node_assert_1.default.strictEqual(await (0, pullReviewApi_1.ensureReview)('o', 'r', 5, 't'), 'REV_1');
    node_assert_1.default.strictEqual(reuse.length, 1, 'no mutation');
    node_test_1.mock.restoreAll();
    const start = (0, httpStub_1.stub)([{ body: stateData([]) }, { body: { data: { addPullRequestReview: { pullRequestReview: { id: 'REV_2' } } } } }]);
    node_assert_1.default.strictEqual(await (0, pullReviewApi_1.ensureReview)('o', 'r', 5, 't'), 'REV_2');
    node_assert_1.default.deepStrictEqual(start[1].body.variables, { input: { pullRequestId: 'PR_1', commitOID: 'a'.repeat(40) } });
    node_assert_1.default.ok(!('event' in start[1].body.variables.input), 'no event: the review stays pending');
});
(0, node_test_1.default)('addReviewThread: one line, or a range with its start side', async () => {
    const reply = { data: { addPullRequestReviewThread: { thread: { id: 'T9', comments: { nodes: [gqlComment] } } } } };
    const calls = (0, httpStub_1.stub)([{ body: reply }]);
    const one = await (0, pullReviewApi_1.addReviewThread)({ reviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 4, side: 'RIGHT' }, 't');
    node_assert_1.default.deepStrictEqual(calls[0].body.variables.input, { pullRequestReviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 4, side: 'RIGHT' });
    node_assert_1.default.strictEqual(one.threadId, 'T9');
    node_assert_1.default.deepStrictEqual(one.comment, { id: 9, body: 'hm', author: 'me', avatar: 'https://x/m.png', createdAt: '2026-10-01T10:00:00Z', pending: true });
    await (0, pullReviewApi_1.addReviewThread)({ reviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 6, startLine: 4, side: 'LEFT' }, 't');
    node_assert_1.default.deepStrictEqual(calls[1].body.variables.input, {
        pullRequestReviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 6, side: 'LEFT', startLine: 4, startSide: 'LEFT',
    });
    await (0, pullReviewApi_1.addReviewThread)({ reviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 4, startLine: 4, side: 'RIGHT' }, 't');
    node_assert_1.default.ok(!('startLine' in calls[2].body.variables.input), 'a start line equal to the line is a single line');
});
(0, node_test_1.default)('addReviewThread: GitHub returning no thread is an error, not a silent success', async () => {
    (0, httpStub_1.stub)([{ body: { data: { addPullRequestReviewThread: { thread: null } } } }]);
    await node_assert_1.default.rejects((0, pullReviewApi_1.addReviewThread)({ reviewId: 'R', body: 'x', path: 'a', line: 1, side: 'RIGHT' }, 't'), /did not create/);
});
(0, node_test_1.default)('replyInReview posts into the pending review', async () => {
    const calls = (0, httpStub_1.stub)([{ body: { data: { addPullRequestReviewThreadReply: { comment: gqlComment } } } }]);
    const c = await (0, pullReviewApi_1.replyInReview)('REV_1', 'T9', 'ok', 't');
    node_assert_1.default.deepStrictEqual(calls[0].body.variables.input, { pullRequestReviewId: 'REV_1', pullRequestReviewThreadId: 'T9', body: 'ok' });
    node_assert_1.default.strictEqual(c.pending, true);
});
(0, node_test_1.default)('submitReview, submitNewReview, discardReview and setThreadResolved send exactly what they are given', async () => {
    const calls = (0, httpStub_1.stub)([{ body: { data: {} } }]);
    await (0, pullReviewApi_1.submitReview)('REV_1', 'REQUEST_CHANGES', 'fix it', 't');
    node_assert_1.default.match(calls[0].body.query, /submitPullRequestReview/);
    node_assert_1.default.deepStrictEqual(calls[0].body.variables.input, { pullRequestReviewId: 'REV_1', event: 'REQUEST_CHANGES', body: 'fix it' });
    await (0, pullReviewApi_1.submitNewReview)({ pullId: 'PR_1', headSha: 'b'.repeat(40), viewerIsAuthor: false, reviewId: null, comments: 0 }, 'APPROVE', '', 't');
    node_assert_1.default.match(calls[1].body.query, /addPullRequestReview\(/);
    node_assert_1.default.deepStrictEqual(calls[1].body.variables.input, { pullRequestId: 'PR_1', commitOID: 'b'.repeat(40), event: 'APPROVE', body: '' });
    await (0, pullReviewApi_1.discardReview)('REV_1', 't');
    node_assert_1.default.match(calls[2].body.query, /deletePullRequestReview/);
    node_assert_1.default.deepStrictEqual(calls[2].body.variables.input, { pullRequestReviewId: 'REV_1' });
    await (0, pullReviewApi_1.setThreadResolved)('T9', true, 't');
    node_assert_1.default.match(calls[3].body.query, /resolveReviewThread/);
    node_assert_1.default.doesNotMatch(calls[3].body.query, /unresolveReviewThread/);
    await (0, pullReviewApi_1.setThreadResolved)('T9', false, 't');
    node_assert_1.default.match(calls[4].body.query, /unresolveReviewThread/);
    node_assert_1.default.deepStrictEqual(calls[4].body.variables.input, { threadId: 'T9' });
});
(0, node_test_1.default)('a GraphQL error from a mutation surfaces GitHub\'s message', async () => {
    (0, httpStub_1.stub)([{ body: { errors: [{ message: 'Can not approve your own pull request' }] } }]);
    await node_assert_1.default.rejects((0, pullReviewApi_1.submitReview)('REV_1', 'APPROVE', '', 't'), /Can not approve your own pull request/);
});
//# sourceMappingURL=pullReviewApi.test.js.map
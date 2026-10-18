'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const githubApi_1 = require("../github/githubApi");
const pullModel_1 = require("./pullModel");
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const pullNode = (over = {}) => ({
    number: 12, title: 'Add x', url: 'https://github.com/o/r/pull/12', state: 'OPEN', isDraft: false, updatedAt: '2026-10-02T10:00:00Z',
    isCrossRepository: false,
    headRefName: 'feat/x', baseRefName: 'main', headRefOid: A, baseRefOid: B, reviewDecision: 'APPROVED',
    author: { login: 'octocat' }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    ...over,
});
const list = (nodes) => ({ search: { nodes } });
(0, node_test_1.default)('mapPulls maps a PR and skips non-PR search nodes', () => {
    const [pull, ...rest] = (0, pullModel_1.mapPulls)(list([pullNode(), {}]));
    node_assert_1.default.strictEqual(rest.length, 0);
    node_assert_1.default.deepStrictEqual(pull, {
        number: 12, title: 'Add x', url: 'https://github.com/o/r/pull/12', state: 'open', draft: false, author: 'octocat', fork: false,
        headRef: 'feat/x', baseRef: 'main', headSha: A, baseSha: B, updatedAt: '2026-10-02T10:00:00Z',
        checks: 'success', review: 'approved',
    });
});
(0, node_test_1.default)('mapPulls: check rollup and review decision variants, missing rollup, deleted author', () => {
    const states = (s, review) => (0, pullModel_1.mapPulls)(list([pullNode({
            reviewDecision: review,
            commits: { nodes: s ? [{ commit: { statusCheckRollup: { state: s } } }] : [{ commit: { statusCheckRollup: null } }] },
        })]))[0];
    node_assert_1.default.strictEqual(states('FAILURE', 'CHANGES_REQUESTED').checks, 'failure');
    node_assert_1.default.strictEqual(states('ERROR', null).checks, 'failure');
    node_assert_1.default.strictEqual(states('PENDING', 'REVIEW_REQUIRED').checks, 'pending');
    node_assert_1.default.strictEqual(states('EXPECTED', null).checks, 'pending');
    node_assert_1.default.strictEqual(states(null, null).checks, 'none');
    node_assert_1.default.strictEqual(states('SUCCESS', 'CHANGES_REQUESTED').review, 'changes');
    node_assert_1.default.strictEqual(states('SUCCESS', 'REVIEW_REQUIRED').review, 'required');
    node_assert_1.default.strictEqual(states('SUCCESS', null).review, 'none');
    node_assert_1.default.strictEqual((0, pullModel_1.mapPulls)(list([pullNode({ author: null, commits: { nodes: [] } })]))[0].author, 'ghost');
});
(0, node_test_1.default)('mapFiles: statuses collapse to added/removed/renamed/modified and renames keep the old path', () => {
    const files = (0, pullModel_1.mapFiles)([
        { filename: 'a.ts', status: 'added', additions: 3, deletions: 0 },
        { filename: 'b.ts', status: 'removed', additions: 0, deletions: 4 },
        { filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed', additions: 1, deletions: 1 },
        { filename: 'c.ts', status: 'changed', additions: 2, deletions: 2 },
        { filename: 'd.ts', status: 'copied', additions: 0, deletions: 0 },
    ]);
    node_assert_1.default.deepStrictEqual(files.map(f => f.status), ['added', 'removed', 'renamed', 'modified', 'modified']);
    node_assert_1.default.strictEqual(files[2].oldPath, 'old.ts');
    node_assert_1.default.strictEqual(files[0].oldPath, undefined);
});
(0, node_test_1.default)('leftPath reads the old name of a renamed file and is the identity otherwise', () => {
    const files = (0, pullModel_1.mapFiles)([
        { filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed', additions: 0, deletions: 0 },
        { filename: 'same.ts', status: 'modified', additions: 1, deletions: 0 },
    ]);
    node_assert_1.default.strictEqual((0, pullModel_1.leftPath)(files, 'new.ts'), 'old.ts');
    node_assert_1.default.strictEqual((0, pullModel_1.leftPath)(files, 'same.ts'), 'same.ts');
    node_assert_1.default.strictEqual((0, pullModel_1.leftPath)(files, 'unknown.ts'), 'unknown.ts');
});
const thread = (over = {}) => ({
    isResolved: false, isOutdated: false, path: 'src/a.ts', line: 10, startLine: null, diffSide: 'RIGHT',
    comments: { nodes: [
            { databaseId: 101, body: 'Why?', createdAt: '2026-10-01T10:00:00Z', author: { login: 'rev', avatarUrl: 'https://x/a.png' } },
            { databaseId: 102, body: 'Because.', createdAt: '2026-10-01T11:00:00Z', author: null },
        ] },
    ...over,
});
const threads = (nodes) => ({ repository: { pullRequest: { reviewThreads: { nodes } } } });
(0, node_test_1.default)('mapThreads maps comments, side, range and resolved flag; a deleted author is ghost', () => {
    const [t] = (0, pullModel_1.mapThreads)(threads([thread({ isResolved: true, diffSide: 'LEFT', startLine: 8 })])).threads;
    node_assert_1.default.strictEqual(t.path, 'src/a.ts');
    node_assert_1.default.strictEqual(t.line, 10);
    node_assert_1.default.strictEqual(t.startLine, 8);
    node_assert_1.default.strictEqual(t.side, 'LEFT');
    node_assert_1.default.strictEqual(t.resolved, true);
    node_assert_1.default.deepStrictEqual(t.comments.map(c => [c.id, c.author]), [[101, 'rev'], [102, 'ghost']]);
    node_assert_1.default.strictEqual((0, pullModel_1.mapThreads)(threads([thread()])).threads[0].startLine, null);
});
(0, node_test_1.default)('mapThreads hides outdated threads but counts them; also skips threads without a line or comments', () => {
    const result = (0, pullModel_1.mapThreads)(threads([
        thread({ isOutdated: true }), thread({ isOutdated: true }), thread({ line: null }), thread({ comments: { nodes: [] } }), thread(),
    ]));
    node_assert_1.default.strictEqual(result.threads.length, 1);
    node_assert_1.default.strictEqual(result.outdated, 2);
});
(0, node_test_1.default)('mapThreads tolerates a PR that no longer exists', () => {
    node_assert_1.default.deepStrictEqual((0, pullModel_1.mapThreads)({ repository: { pullRequest: null } }), { threads: [], outdated: 0 });
});
(0, node_test_1.default)('threadCount counts the threads of one file', () => {
    const { threads: all } = (0, pullModel_1.mapThreads)(threads([thread(), thread(), thread({ path: 'b.ts' })]));
    node_assert_1.default.strictEqual((0, pullModel_1.threadCount)(all, 'src/a.ts'), 2);
    node_assert_1.default.strictEqual((0, pullModel_1.threadCount)(all, 'none.ts'), 0);
});
(0, node_test_1.default)('mapPulls: merged and closed PRs keep their state, anything unknown counts as open', () => {
    const state = (s) => (0, pullModel_1.mapPulls)(list([pullNode({ state: s })]))[0].state;
    node_assert_1.default.strictEqual(state('MERGED'), 'merged');
    node_assert_1.default.strictEqual(state('CLOSED'), 'closed');
    node_assert_1.default.strictEqual(state('OPEN'), 'open');
    node_assert_1.default.strictEqual(state('SOMETHING_NEW'), 'open');
});
const summary = (over) => ({ ...(0, pullModel_1.mapPulls)(list([pullNode()]))[0], ...over });
(0, node_test_1.default)('pullBranch: a same-repo PR keeps its head branch, a fork PR (or an option-looking name) becomes pr/<n>', () => {
    node_assert_1.default.strictEqual((0, pullModel_1.pullBranch)(summary({ headRef: 'feat/x' })), 'feat/x');
    node_assert_1.default.strictEqual((0, pullModel_1.pullBranch)(summary({ number: 7, fork: true, headRef: 'main' })), 'pr/7');
    node_assert_1.default.strictEqual((0, pullModel_1.pullBranch)(summary({ number: 8, headRef: '-x' })), 'pr/8');
    node_assert_1.default.strictEqual((0, pullModel_1.pullBranch)(summary({ number: 9, headRef: 'a b;c' })), 'pr/9');
});
(0, node_test_1.default)('pinCurrent puts the PR of the checked-out branch first and keeps the rest in order', () => {
    const pulls = [summary({ number: 1, headRef: 'a' }), summary({ number: 2, headRef: 'b' }), summary({ number: 3, headRef: 'c', fork: true })];
    node_assert_1.default.deepStrictEqual((0, pullModel_1.pinCurrent)(pulls, 'b').map(p => p.number), [2, 1, 3]);
    node_assert_1.default.deepStrictEqual((0, pullModel_1.pinCurrent)(pulls, 'pr/3').map(p => p.number), [3, 1, 2]);
    node_assert_1.default.deepStrictEqual((0, pullModel_1.pinCurrent)(pulls, 'other').map(p => p.number), [1, 2, 3]);
    node_assert_1.default.deepStrictEqual((0, pullModel_1.pinCurrent)(pulls, null).map(p => p.number), [1, 2, 3]);
});
(0, node_test_1.default)('commentFromRest maps a REST review comment', () => {
    node_assert_1.default.deepStrictEqual((0, pullModel_1.commentFromRest)({ id: 7, body: 'hi', created_at: '2026-10-01T10:00:00Z', user: { login: 'me', avatar_url: 'https://x/m.png' } }), { id: 7, body: 'hi', author: 'me', avatar: 'https://x/m.png', createdAt: '2026-10-01T10:00:00Z' });
});
(0, node_test_1.default)('describeFailure: a rate limit says when to retry, anything else keeps its own message', () => {
    const limited = new githubApi_1.ApiError('GitHub API 403: rate limit', 403, 1_000_000 + 5 * 60_000);
    node_assert_1.default.strictEqual((0, pullModel_1.describeFailure)(limited, 1_000_000), 'GitHub API 403: rate limit. Try again in 5 min.');
    node_assert_1.default.strictEqual((0, pullModel_1.describeFailure)(new githubApi_1.ApiError('GitHub API 401: Bad credentials', 401), 0), 'GitHub API 401: Bad credentials');
    node_assert_1.default.strictEqual((0, pullModel_1.describeFailure)(new Error('boom')), 'boom');
    node_assert_1.default.strictEqual((0, pullModel_1.describeFailure)('odd'), 'odd');
});
//# sourceMappingURL=pullModel.test.js.map
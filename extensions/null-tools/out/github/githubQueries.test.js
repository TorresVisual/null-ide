'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const githubQueries_1 = require("./githubQueries");
const issueNode = (over = {}) => ({
    number: 7, title: 'Crash on start', body: 'It crashes', state: 'OPEN', stateReason: null,
    url: 'https://github.com/o/r/issues/7', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z',
    closedAt: null, author: { login: 'octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' },
    labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
    assignees: { nodes: [{ login: 'hubot', avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4' }] },
    comments: { totalCount: 3 }, milestone: { number: 2, title: 'v1.0' }, issueType: { name: 'Bug' },
    subIssuesSummary: { total: 3, completed: 1 }, closedByPullRequestsReferences: { totalCount: 1 },
    ...over,
});
const page = (nodes, extra = {}) => ({
    search: { pageInfo: { hasNextPage: true, endCursor: 'abc' }, nodes },
    ...extra,
});
(0, node_test_1.default)('mapSearchPage maps an open issue to the REST-shaped GithubIssue the rest of the extension uses', () => {
    const result = (0, githubQueries_1.mapSearchPage)(page([issueNode()], { open: { issueCount: 52 }, closed: { issueCount: 58 } }));
    node_assert_1.default.deepStrictEqual(result.items[0], {
        number: 7, title: 'Crash on start', body: 'It crashes', state: 'open', state_reason: null,
        html_url: 'https://github.com/o/r/issues/7',
        labels: [{ name: 'bug', color: 'd73a4a' }],
        assignees: [{ login: 'hubot', avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4' }],
        user: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
        comments: 3, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-02T10:00:00Z', closed_at: null,
        milestone: { number: 2, title: 'v1.0' }, issue_type: 'Bug', sub_issues: { total: 3, completed: 1 }, linked_prs: 1,
    });
    node_assert_1.default.strictEqual(result.hasMore, true);
    node_assert_1.default.strictEqual(result.cursor, 'abc');
    node_assert_1.default.strictEqual(result.openCount, 52);
    node_assert_1.default.strictEqual(result.closedCount, 58);
});
(0, node_test_1.default)('mapSearchPage lowercases state and stateReason', () => {
    const closed = (0, githubQueries_1.mapSearchPage)(page([issueNode({ state: 'CLOSED', stateReason: 'NOT_PLANNED', closedAt: '2026-10-03T00:00:00Z' })]));
    node_assert_1.default.strictEqual(closed.items[0].state, 'closed');
    node_assert_1.default.strictEqual(closed.items[0].state_reason, 'not_planned');
    node_assert_1.default.strictEqual(closed.items[0].closed_at, '2026-10-03T00:00:00Z');
});
(0, node_test_1.default)('mapSearchPage tolerates a deleted author, null body, missing optional blocks, and zero sub-issues', () => {
    const [issue] = (0, githubQueries_1.mapSearchPage)(page([issueNode({
            author: null, body: null, milestone: null, issueType: null,
            subIssuesSummary: { total: 0, completed: 0 }, closedByPullRequestsReferences: null,
        })])).items;
    node_assert_1.default.deepStrictEqual(issue.user, { login: 'ghost', avatar_url: '' });
    node_assert_1.default.strictEqual(issue.body, '');
    node_assert_1.default.strictEqual(issue.milestone, null);
    node_assert_1.default.strictEqual(issue.issue_type, null);
    node_assert_1.default.strictEqual(issue.sub_issues, null);
    node_assert_1.default.strictEqual(issue.linked_prs, 0);
});
(0, node_test_1.default)('mapSearchPage skips non-issue search nodes and reports null counts when none were requested', () => {
    const result = (0, githubQueries_1.mapSearchPage)(page([{}, issueNode()]));
    node_assert_1.default.deepStrictEqual(result.items.map(i => i.number), [7]);
    node_assert_1.default.strictEqual(result.openCount, null);
    node_assert_1.default.strictEqual(result.closedCount, null);
});
(0, node_test_1.default)('mapMetadata handles a repo without issue types (issueTypes: null)', () => {
    const data = {
        viewer: { login: 'octocat' },
        repository: {
            labels: { nodes: [{ name: 'bug', color: 'd73a4a', description: 'Something isn\'t working' }] },
            assignableUsers: { nodes: [{ login: 'octocat', avatarUrl: 'https://a/u/1' }] },
            milestones: { nodes: [{ number: 2, title: 'v1.0' }] },
            issueTypes: null,
        },
    };
    node_assert_1.default.deepStrictEqual((0, githubQueries_1.mapMetadata)(data), {
        labels: [{ name: 'bug', color: 'd73a4a', description: 'Something isn\'t working' }],
        assignees: [{ login: 'octocat', avatar_url: 'https://a/u/1' }],
        milestones: [{ number: 2, title: 'v1.0' }],
        issueTypes: [],
        viewerLogin: 'octocat',
    });
});
//# sourceMappingURL=githubQueries.test.js.map
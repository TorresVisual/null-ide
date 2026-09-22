'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const issueFilter_1 = require("./issueFilter");
function makeIssue(overrides) {
    return {
        number: 1,
        title: 'Untitled',
        body: '',
        state: 'open',
        html_url: 'https://github.com/o/r/issues/1',
        labels: [],
        assignees: [],
        user: { login: 'author', avatar_url: '' },
        comments: 0,
        updated_at: '2026-01-01T00:00:00Z',
        ...overrides,
    };
}
(0, node_test_1.default)('stripPullRequests removes entries with a pull_request field', () => {
    const issue = makeIssue({ number: 1 });
    const pr = makeIssue({ number: 2, pull_request: { url: 'x' } });
    node_assert_1.default.deepStrictEqual((0, issueFilter_1.stripPullRequests)([issue, pr]), [issue]);
});
(0, node_test_1.default)('filterIssues requires ALL selected labels to be present (AND)', () => {
    const a = makeIssue({ number: 1, labels: [{ name: 'bug', color: 'f00' }] });
    const b = makeIssue({ number: 2, labels: [{ name: 'bug', color: 'f00' }, { name: 'ui', color: '0f0' }] });
    const opts = { labels: ['bug', 'ui'], assignee: 'everyone', query: '', viewerLogin: null };
    node_assert_1.default.deepStrictEqual((0, issueFilter_1.filterIssues)([a, b], opts), [b]);
});
(0, node_test_1.default)('filterIssues "me" never falls back to showing everyone when signed out', () => {
    const a = makeIssue({ number: 1, assignees: [{ login: 'octocat', avatar_url: '' }] });
    const opts = { labels: [], assignee: 'me', query: '', viewerLogin: null };
    node_assert_1.default.deepStrictEqual((0, issueFilter_1.filterIssues)([a], opts), []);
});
(0, node_test_1.default)('filterIssues "me" matches the viewer\'s own assigned issues', () => {
    const mine = makeIssue({ number: 1, assignees: [{ login: 'octocat', avatar_url: '' }] });
    const other = makeIssue({ number: 2, assignees: [{ login: 'someoneelse', avatar_url: '' }] });
    const opts = { labels: [], assignee: 'me', query: '', viewerLogin: 'octocat' };
    node_assert_1.default.deepStrictEqual((0, issueFilter_1.filterIssues)([mine, other], opts), [mine]);
});
(0, node_test_1.default)('filterIssues searches title and body case-insensitively', () => {
    const a = makeIssue({ number: 1, title: 'Crash on startup', body: '' });
    const b = makeIssue({ number: 2, title: 'Unrelated', body: 'reproduces on STARTUP too' });
    const c = makeIssue({ number: 3, title: 'Also unrelated', body: '' });
    const opts = { labels: [], assignee: 'everyone', query: 'startup', viewerLogin: null };
    node_assert_1.default.deepStrictEqual((0, issueFilter_1.filterIssues)([a, b, c], opts).map(i => i.number), [1, 2]);
});
(0, node_test_1.default)('filterIssues with no filters returns everything unchanged', () => {
    const issues = [makeIssue({ number: 1 }), makeIssue({ number: 2 })];
    const opts = { labels: [], assignee: 'everyone', query: '', viewerLogin: null };
    node_assert_1.default.deepStrictEqual((0, issueFilter_1.filterIssues)(issues, opts), issues);
});
(0, node_test_1.default)('relevantToViewer matches authored or assigned issues, and nothing without a viewer', () => {
    const authored = makeIssue({ number: 1, user: { login: 'octocat', avatar_url: '' } });
    const assigned = makeIssue({ number: 2, assignees: [{ login: 'octocat', avatar_url: '' }] });
    const other = makeIssue({ number: 3 });
    node_assert_1.default.deepStrictEqual((0, issueFilter_1.relevantToViewer)([authored, assigned, other], 'octocat'), [authored, assigned]);
    node_assert_1.default.deepStrictEqual((0, issueFilter_1.relevantToViewer)([authored, assigned, other], null), []);
});
(0, node_test_1.default)('newestUpdateTime returns the max updated_at, or 0 for an empty list', () => {
    const older = makeIssue({ number: 1, updated_at: '2026-01-01T00:00:00Z' });
    const newer = makeIssue({ number: 2, updated_at: '2026-06-01T00:00:00Z' });
    node_assert_1.default.strictEqual((0, issueFilter_1.newestUpdateTime)([older, newer]), new Date('2026-06-01T00:00:00Z').getTime());
    node_assert_1.default.strictEqual((0, issueFilter_1.newestUpdateTime)([]), 0);
});
//# sourceMappingURL=issueFilter.test.js.map
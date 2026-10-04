'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const detailQueries_1 = require("./detailQueries");
const user = { login: 'octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' };
const groups = [
    { content: 'THUMBS_UP', viewerHasReacted: true, reactors: { totalCount: 2 } },
    { content: 'EYES', viewerHasReacted: false, reactors: { totalCount: 0 } },
];
const commentNode = (over = {}) => ({
    __typename: 'IssueComment', id: 'IC_1', url: 'https://github.com/o/r/issues/7#issuecomment-1', body: 'Looks **good**',
    bodyHTML: '<p>Looks <strong>good</strong></p>', createdAt: '2026-10-01T11:00:00Z', lastEditedAt: null,
    authorAssociation: 'MEMBER', isMinimized: false, minimizedReason: null, viewerCanUpdate: true, viewerCanDelete: false,
    author: user, reactionGroups: groups, ...over,
});
const issueNode = (over = {}) => ({
    id: 'I_7', number: 7, title: 'Crash on start', body: 'It crashes', bodyHTML: '<p>It crashes</p>', state: 'OPEN',
    stateReason: null, url: 'https://github.com/o/r/issues/7', createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-02T10:00:00Z', closedAt: null, lastEditedAt: '2026-10-01T10:05:00Z', authorAssociation: 'OWNER',
    viewerCanUpdate: true, author: user, labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
    assignees: { nodes: [user] }, comments: { totalCount: 1 },
    milestone: { number: 2, title: 'v1.0', progressPercentage: 33.3333 }, issueType: { id: 'IT_1', name: 'Bug' },
    subIssuesSummary: { total: 1, completed: 0 },
    subIssues: { nodes: [{ id: 'I_8', number: 8, title: 'Child', state: 'OPEN', stateReason: null, url: 'https://github.com/o/r/issues/8', assignees: { nodes: [user] } }] },
    parent: { number: 3, title: 'Epic', url: 'https://github.com/o/r/issues/3' },
    closedByPullRequestsReferences: { totalCount: 1, nodes: [{ number: 9, title: 'Fix', state: 'MERGED', url: 'https://github.com/o/r/pull/9', isDraft: false }] },
    participants: { nodes: [user] }, reactionGroups: groups,
    timelineItems: { pageInfo: { hasNextPage: true, endCursor: 'cur' }, nodes: [commentNode()] },
    ...over,
});
const detail = (over = {}) => ({ repository: { issue: issueNode(over) } });
(0, node_test_1.default)('mapIssueDetail maps the header, sidebar data and the body as the first post', () => {
    const d = (0, detailQueries_1.mapIssueDetail)(detail(), 'o/r');
    node_assert_1.default.strictEqual(d.id, 'I_7');
    node_assert_1.default.strictEqual(d.issue.number, 7);
    node_assert_1.default.strictEqual(d.issue.state, 'open');
    node_assert_1.default.deepStrictEqual(d.issueType, { id: 'IT_1', name: 'Bug' });
    node_assert_1.default.deepStrictEqual(d.milestone, { number: 2, title: 'v1.0', percent: 33 });
    node_assert_1.default.deepStrictEqual(d.parent, { number: 3, title: 'Epic', url: 'https://github.com/o/r/issues/3' });
    node_assert_1.default.deepStrictEqual(d.subIssues.map(s => [s.id, s.number, s.state]), [['I_8', 8, 'open']]);
    node_assert_1.default.deepStrictEqual(d.linkedPrs, [{ number: 9, title: 'Fix', state: 'merged', isDraft: false, url: 'https://github.com/o/r/pull/9' }]);
    node_assert_1.default.strictEqual(d.participants.length, 1);
    node_assert_1.default.strictEqual(d.post.id, 'I_7');
    node_assert_1.default.strictEqual(d.post.bodyHTML, '<p>It crashes</p>');
    node_assert_1.default.strictEqual(d.post.viewerCanUpdate, true);
    node_assert_1.default.strictEqual(d.post.viewerCanDelete, false);
    node_assert_1.default.strictEqual(d.post.authorAssociation, 'OWNER');
    node_assert_1.default.strictEqual(d.hasMoreTimeline, true);
    node_assert_1.default.strictEqual(d.timelineCursor, 'cur');
});
(0, node_test_1.default)('mapIssueDetail copes with a repo without issue types, milestones, parent or linked PRs', () => {
    const d = (0, detailQueries_1.mapIssueDetail)(detail({
        milestone: null, issueType: null, parent: null, subIssuesSummary: null, closedByPullRequestsReferences: null,
        subIssues: { nodes: [] },
    }), 'o/r');
    node_assert_1.default.strictEqual(d.milestone, null);
    node_assert_1.default.strictEqual(d.issueType, null);
    node_assert_1.default.strictEqual(d.parent, null);
    node_assert_1.default.deepStrictEqual(d.linkedPrs, []);
    node_assert_1.default.deepStrictEqual(d.subIssues, []);
});
(0, node_test_1.default)('mapIssueDetail throws when the issue does not exist (e.g. the number belongs to a pull request)', () => {
    node_assert_1.default.throws(() => (0, detailQueries_1.mapIssueDetail)({ repository: { issue: null } }, 'o/r'), /not found/);
});
(0, node_test_1.default)('a deleted author is shown as ghost on the issue and on comments', () => {
    const d = (0, detailQueries_1.mapIssueDetail)(detail({
        author: null,
        timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [commentNode({ author: null })] },
    }), 'o/r');
    node_assert_1.default.strictEqual(d.post.author.login, 'ghost');
    const c = d.timeline[0];
    node_assert_1.default.strictEqual(c.kind === 'comment' && c.author.login, 'ghost');
});
(0, node_test_1.default)('mapComment maps reactions, minimized state and edit rights', () => {
    const post = (0, detailQueries_1.mapComment)(commentNode({ isMinimized: true, minimizedReason: 'OFF_TOPIC' }));
    node_assert_1.default.deepStrictEqual(post.reactions, [
        { content: 'THUMBS_UP', count: 2, viewerHasReacted: true },
        { content: 'EYES', count: 0, viewerHasReacted: false },
    ]);
    node_assert_1.default.strictEqual(post.minimizedReason, 'off_topic');
    node_assert_1.default.strictEqual((0, detailQueries_1.mapComment)(commentNode()).minimizedReason, null);
    node_assert_1.default.deepStrictEqual((0, detailQueries_1.mapReactions)([]), []);
});
const page = (nodes) => (0, detailQueries_1.mapTimelinePage)({ pageInfo: { hasNextPage: false, endCursor: null }, nodes }, 'o/r');
const ev = (typename, over = {}) => ({
    __typename: typename, createdAt: '2026-10-01T12:00:00Z', actor: { login: 'octocat' }, ...over,
});
(0, node_test_1.default)('timeline events map to plain data and unknown event types are skipped', () => {
    const { items } = page([
        ev('ClosedEvent', { stateReason: 'NOT_PLANNED', closer: { abbreviatedOid: 'abc1234', url: 'https://github.com/o/r/commit/abc1234' } }),
        ev('ReopenedEvent'),
        ev('RenamedTitleEvent', { previousTitle: 'old', currentTitle: 'new' }),
        ev('AssignedEvent', { assignee: { login: 'hubot' } }),
        ev('MilestonedEvent', { milestoneTitle: 'v1.0' }),
        ev('MentionedEvent'),
        ev('SubscribedEvent'),
    ]);
    node_assert_1.default.deepStrictEqual(items.map(i => i.kind === 'event' ? i.type : 'comment'), ['closed', 'reopened', 'renamed', 'assigned', 'milestoned']);
    const closed = items[0];
    node_assert_1.default.ok(closed.kind === 'event' && closed.type === 'closed');
    node_assert_1.default.strictEqual(closed.reason, 'not_planned');
    node_assert_1.default.deepStrictEqual(closed.closer, { text: 'abc1234', url: 'https://github.com/o/r/commit/abc1234' });
});
(0, node_test_1.default)('a pull request closer is shown as #n, and a missing closer stays null', () => {
    const { items } = page([
        ev('ClosedEvent', { stateReason: 'COMPLETED', closer: { number: 12, url: 'https://github.com/o/r/pull/12' } }),
        ev('ClosedEvent', { stateReason: null, closer: null }),
    ]);
    const [a, b] = items;
    node_assert_1.default.ok(a.kind === 'event' && a.type === 'closed' && b.kind === 'event' && b.type === 'closed');
    node_assert_1.default.strictEqual(a.closer?.text, '#12');
    node_assert_1.default.strictEqual(b.closer, null);
    node_assert_1.default.strictEqual(b.reason, null);
});
(0, node_test_1.default)('cross references show #n in this repo and owner/repo#n elsewhere; a deleted actor is ghost', () => {
    const src = (nameWithOwner) => ({
        source: { number: 5, title: 'Related', url: 'https://github.com/x/y/issues/5', repository: { nameWithOwner } },
    });
    const { items } = page([ev('CrossReferencedEvent', src('O/R')), ev('CrossReferencedEvent', { ...src('x/y'), actor: null })]);
    const [a, b] = items;
    node_assert_1.default.ok(a.kind === 'event' && b.kind === 'event' && 'text' in a && 'text' in b);
    node_assert_1.default.strictEqual(a.text, 'Related #5');
    node_assert_1.default.strictEqual(b.text, 'Related x/y#5');
    node_assert_1.default.strictEqual(b.actor, 'ghost');
});
(0, node_test_1.default)('a cross reference without a source, or a commit reference without a commit, is dropped', () => {
    node_assert_1.default.deepStrictEqual(page([ev('CrossReferencedEvent', { source: null }), ev('ReferencedEvent', { commit: null })]).items, []);
});
const label = (name) => ({ name, color: 'ffffff' });
const labelEvent = (type, name, at, actor = 'octocat') => ({
    kind: 'event', type: 'labels', at, actor, added: type === 'added' ? [label(name)] : [], removed: type === 'removed' ? [label(name)] : [],
});
(0, node_test_1.default)('collapseTimeline merges label events by the same actor within 60 seconds', () => {
    const out = (0, detailQueries_1.collapseTimeline)([
        labelEvent('added', 'bug', '2026-10-01T12:00:00Z'),
        labelEvent('added', 'ui', '2026-10-01T12:00:30Z'),
        labelEvent('removed', 'wip', '2026-10-01T12:01:10Z'),
    ]);
    node_assert_1.default.strictEqual(out.length, 1);
    const only = out[0];
    node_assert_1.default.ok(only.kind === 'event' && only.type === 'labels');
    node_assert_1.default.deepStrictEqual(only.added.map(l => l.name), ['bug', 'ui']);
    node_assert_1.default.deepStrictEqual(only.removed.map(l => l.name), ['wip']);
});
(0, node_test_1.default)('collapseTimeline keeps label events apart across actors, gaps over a minute, and other events', () => {
    node_assert_1.default.strictEqual((0, detailQueries_1.collapseTimeline)([
        labelEvent('added', 'a', '2026-10-01T12:00:00Z'), labelEvent('added', 'b', '2026-10-01T12:00:10Z', 'hubot'),
    ]).length, 2);
    node_assert_1.default.strictEqual((0, detailQueries_1.collapseTimeline)([
        labelEvent('added', 'a', '2026-10-01T12:00:00Z'), labelEvent('added', 'b', '2026-10-01T12:02:00Z'),
    ]).length, 2);
    const reopened = { kind: 'event', type: 'reopened', at: '2026-10-01T12:00:05Z', actor: 'octocat' };
    node_assert_1.default.strictEqual((0, detailQueries_1.collapseTimeline)([
        labelEvent('added', 'a', '2026-10-01T12:00:00Z'), reopened, labelEvent('added', 'b', '2026-10-01T12:00:10Z'),
    ]).length, 3);
});
//# sourceMappingURL=detailQueries.test.js.map
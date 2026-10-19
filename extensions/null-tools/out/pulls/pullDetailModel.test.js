'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const pullDetailModel_1 = require("./pullDetailModel");
const user = (login) => ({ login, avatarUrl: `https://avatars.githubusercontent.com/${login}` });
const gqlPage = (over = {}) => ({
    repository: {
        viewerPermission: 'WRITE', mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false,
        pullRequest: {
            id: 'PR_1', headRefOid: 'c'.repeat(40), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
            viewerCanUpdate: true, viewerDidAuthor: false, pendingReview: { nodes: [] },
            number: 12, title: 'Add x', url: 'https://github.com/o/r/pull/12', state: 'OPEN', isDraft: false,
            createdAt: '2026-10-01T10:00:00Z', bodyHTML: '<p>Hi</p>', headRefName: 'feat/x', baseRefName: 'main',
            isCrossRepository: false, additions: 10, deletions: 2, changedFiles: 3,
            author: user('octocat'),
            labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
            milestone: { title: 'v1' },
            assignees: { nodes: [user('hubot')] },
            reviewRequests: { nodes: [] },
            latestOpinionatedReviews: { nodes: [] },
            commits: {
                totalCount: 1,
                nodes: [{ commit: { oid: 'a'.repeat(40), abbreviatedOid: 'aaaaaaa', messageHeadline: 'wip', committedDate: '2026-10-01T09:00:00Z',
                            url: 'https://github.com/o/r/commit/a', author: { name: 'Octo Cat', user: { login: 'octocat' } } } }],
            },
            timelineItems: { totalCount: 0, nodes: [] },
            lastCommit: { nodes: [{ commit: { statusCheckRollup: null } }] },
            ...over,
        },
    },
});
(0, node_test_1.default)('mapPullPage maps the header, sidebar and commits', () => {
    const p = (0, pullDetailModel_1.mapPullPage)(gqlPage());
    node_assert_1.default.strictEqual(p.number, 12);
    node_assert_1.default.strictEqual(p.state, 'open');
    node_assert_1.default.deepStrictEqual(p.author, { login: 'octocat', avatar: 'https://avatars.githubusercontent.com/octocat' });
    node_assert_1.default.deepStrictEqual(p.labels, [{ name: 'bug', color: 'd73a4a' }]);
    node_assert_1.default.strictEqual(p.milestone, 'v1');
    node_assert_1.default.deepStrictEqual(p.assignees.map(a => a.login), ['hubot']);
    node_assert_1.default.deepStrictEqual(p.commits, [{
            sha: 'a'.repeat(40), short: 'aaaaaaa', headline: 'wip', author: 'octocat', at: '2026-10-01T09:00:00Z', url: 'https://github.com/o/r/commit/a',
        }]);
    node_assert_1.default.strictEqual(p.commitTotal, 1);
    node_assert_1.default.strictEqual(p.checkState, 'none');
    node_assert_1.default.deepStrictEqual(p.checks, []);
});
(0, node_test_1.default)('mapPullPage: merged, closed, a deleted author, a commit by a non-GitHub user', () => {
    node_assert_1.default.strictEqual((0, pullDetailModel_1.mapPullPage)(gqlPage({ state: 'MERGED' })).state, 'merged');
    node_assert_1.default.strictEqual((0, pullDetailModel_1.mapPullPage)(gqlPage({ state: 'CLOSED' })).state, 'closed');
    node_assert_1.default.strictEqual((0, pullDetailModel_1.mapPullPage)(gqlPage({ author: null })).author.login, 'ghost');
    const commits = { totalCount: 1, nodes: [{ commit: { oid: 'b'.repeat(40), abbreviatedOid: 'bbbbbbb', messageHeadline: 'x',
                    committedDate: '2026-10-01T09:00:00Z', url: 'u', author: { name: 'Octo Cat', user: null } } }] };
    node_assert_1.default.strictEqual((0, pullDetailModel_1.mapPullPage)(gqlPage({ commits })).commits[0].author, 'Octo Cat');
});
(0, node_test_1.default)('mapPullPage throws a readable error when the PR does not exist', () => {
    node_assert_1.default.throws(() => (0, pullDetailModel_1.mapPullPage)({ repository: { pullRequest: null } }), /Pull request not found/);
    node_assert_1.default.throws(() => (0, pullDetailModel_1.mapPullPage)({ repository: null }), /Pull request not found/);
});
(0, node_test_1.default)('mapPullPage keeps the ids for writes and derives the actions from the page', () => {
    const p = (0, pullDetailModel_1.mapPullPage)(gqlPage());
    node_assert_1.default.strictEqual(p.id, 'PR_1');
    node_assert_1.default.strictEqual(p.headSha, 'c'.repeat(40));
    node_assert_1.default.deepStrictEqual(p.actions, {
        review: { available: true, canApprove: true, pending: null },
        merge: { enabled: true, hint: 'Ready to merge.', methods: ['MERGE', 'SQUASH'] },
        state: 'close', draft: 'draft',
    });
    const unsent = (0, pullDetailModel_1.mapPullPage)(gqlPage({ pendingReview: { nodes: [{ id: 'REV_1', comments: { totalCount: 3 } }] } }));
    node_assert_1.default.strictEqual(unsent.actions.review.pending, 3);
    node_assert_1.default.strictEqual((0, pullDetailModel_1.mapPullPage)(gqlPage({ viewerDidAuthor: true })).actions.review.canApprove, false);
});
(0, node_test_1.default)('mapTimeline: comments, reviews, events; PENDING reviews, unknown types and null nodes are skipped; deleted authors are ghost', () => {
    const nodes = [
        { __typename: 'IssueComment', url: 'u1', createdAt: '2026-10-01T11:00:00Z', bodyHTML: '<p>c</p>', author: user('a') },
        { __typename: 'PullRequestReview', url: 'u2', state: 'APPROVED', createdAt: '2026-10-01T12:00:00Z', bodyHTML: '', author: user('b'), comments: { totalCount: 2 } },
        { __typename: 'PullRequestReview', url: 'u3', state: 'PENDING', createdAt: '2026-10-01T12:30:00Z', bodyHTML: '', author: user('me'), comments: { totalCount: 1 } },
        { __typename: 'PullRequestReview', url: 'u4', state: 'CHANGES_REQUESTED', createdAt: '2026-10-01T13:00:00Z', bodyHTML: '<p>no</p>', author: null, comments: { totalCount: 0 } },
        { __typename: 'MergedEvent', createdAt: '2026-10-02T10:00:00Z', actor: { login: 'maint' } },
        { __typename: 'ClosedEvent', createdAt: '2026-10-02T11:00:00Z', actor: null },
        { __typename: 'ConvertToDraftEvent', createdAt: '2026-10-02T12:00:00Z', actor: { login: 'a' } },
        { __typename: 'SomethingNew', createdAt: '2026-10-02T13:00:00Z' },
        { __typename: 'constructor' },
        null,
    ];
    const timeline = (0, pullDetailModel_1.mapPullPage)(gqlPage({ timelineItems: { totalCount: 12, nodes } })).timeline;
    node_assert_1.default.deepStrictEqual(timeline.map(i => (i.kind === 'event' ? `event:${i.event}:${i.actor}` : i.kind === 'review' ? `review:${i.verdict}:${i.author.login}` : `comment:${i.author.login}`)), [
        'comment:a', 'review:approved:b', 'review:changes:ghost', 'event:merged:maint', 'event:closed:ghost', 'event:draft:a',
    ]);
    const approved = timeline[1];
    node_assert_1.default.ok(approved.kind === 'review' && approved.comments === 2 && approved.url === 'u2');
});
(0, node_test_1.default)('mapPullPage keeps the timeline total so the page can say it is cut off', () => {
    const p = (0, pullDetailModel_1.mapPullPage)(gqlPage({ timelineItems: { totalCount: 230, nodes: [] }, commits: { totalCount: 130, nodes: [] } }));
    node_assert_1.default.strictEqual(p.timelineTotal, 230);
    node_assert_1.default.strictEqual(p.commitTotal, 130);
});
(0, node_test_1.default)('mapReviewers: latest verdicts, a re-request wins over an old verdict, a team request is skipped', () => {
    const p = (0, pullDetailModel_1.mapPullPage)(gqlPage({
        latestOpinionatedReviews: { nodes: [
                { state: 'APPROVED', author: user('ann') }, { state: 'CHANGES_REQUESTED', author: user('bob') },
                { state: 'DISMISSED', author: user('dee') }, { state: 'COMMENTED', author: null },
            ] },
        reviewRequests: { nodes: [
                { requestedReviewer: { __typename: 'User', login: 'bob', avatarUrl: 'https://a/bob' } },
                { requestedReviewer: { __typename: 'Team' } },
                { requestedReviewer: null },
            ] },
    }));
    node_assert_1.default.deepStrictEqual(p.reviewers.map(r => `${r.login}:${r.state}`), ['ann:approved', 'bob:pending', 'dee:dismissed']);
});
(0, node_test_1.default)('checkRowState / statusContextState', () => {
    node_assert_1.default.strictEqual((0, pullDetailModel_1.checkRowState)('COMPLETED', 'SUCCESS'), 'success');
    for (const c of ['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE'])
        node_assert_1.default.strictEqual((0, pullDetailModel_1.checkRowState)('COMPLETED', c), 'failure', c);
    for (const c of ['NEUTRAL', 'SKIPPED', 'CANCELLED', 'STALE', null])
        node_assert_1.default.strictEqual((0, pullDetailModel_1.checkRowState)('COMPLETED', c), 'neutral', String(c));
    node_assert_1.default.strictEqual((0, pullDetailModel_1.checkRowState)('COMPLETED', 'ACTION_REQUIRED'), 'pending');
    for (const s of ['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING', 'REQUESTED'])
        node_assert_1.default.strictEqual((0, pullDetailModel_1.checkRowState)(s, null), 'pending', s);
    node_assert_1.default.deepStrictEqual(['SUCCESS', 'FAILURE', 'ERROR', 'PENDING', 'EXPECTED', 'WHAT'].map(pullDetailModel_1.statusContextState), ['success', 'failure', 'failure', 'pending', 'pending', 'neutral']);
});
(0, node_test_1.default)('mapChecks: check runs and legacy statuses, failures first, then by name; run id only from Actions checks', () => {
    const rows = (0, pullDetailModel_1.mapChecks)([
        { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/o/r/actions/runs/1/job/1', checkSuite: { workflowRun: { databaseId: 1 } } },
        { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/2/job/9', checkSuite: { workflowRun: { databaseId: 2 } } },
        { __typename: 'CheckRun', name: 'app', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: null, checkSuite: { workflowRun: null } },
        { __typename: 'StatusContext', context: 'ci/legacy', state: 'FAILURE', targetUrl: 'https://ci.example/1', description: 'broke' },
        { __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: null, detailsUrl: 'https://x', checkSuite: null },
        { __typename: 'Unknown' },
        null,
    ]);
    node_assert_1.default.deepStrictEqual(rows.map(r => `${r.state}:${r.name}`), ['failure:app', 'failure:ci/legacy', 'failure:test', 'pending:build', 'success:lint']);
    node_assert_1.default.strictEqual(rows.find(r => r.name === 'test').runId, 2);
    node_assert_1.default.strictEqual(rows.find(r => r.name === 'app').runId, null);
    node_assert_1.default.strictEqual(rows.find(r => r.name === 'ci/legacy').description, 'broke');
});
(0, node_test_1.default)('mapPullPage reads the rollup: overall state, rows and the total (which may exceed the rows)', () => {
    const rollup = { state: 'FAILURE', contexts: { totalCount: 150, nodes: [
                { __typename: 'CheckRun', name: 't', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://x', checkSuite: { workflowRun: { databaseId: 5 } } },
            ] } };
    const p = (0, pullDetailModel_1.mapPullPage)(gqlPage({ lastCommit: { nodes: [{ commit: { statusCheckRollup: rollup } }] } }));
    node_assert_1.default.strictEqual(p.checkState, 'failure');
    node_assert_1.default.strictEqual(p.checks.length, 1);
    node_assert_1.default.strictEqual(p.checksTotal, 150);
});
(0, node_test_1.default)('failedRunIds: distinct runs of failed rows only; no failures or no run ids means nothing to re-run', () => {
    const row = (state, runId) => ({ name: 'n', state, url: null, runId, description: '' });
    node_assert_1.default.deepStrictEqual((0, pullDetailModel_1.failedRunIds)([row('failure', 2), row('failure', 2), row('failure', 3), row('success', 4), row('pending', 5), row('failure', null)]), [2, 3]);
    node_assert_1.default.deepStrictEqual((0, pullDetailModel_1.failedRunIds)([row('success', 1), row('neutral', 2)]), []);
    node_assert_1.default.deepStrictEqual((0, pullDetailModel_1.failedRunIds)([row('failure', null), row('failure', -1), row('failure', 1.5)]), []);
    node_assert_1.default.deepStrictEqual((0, pullDetailModel_1.failedRunIds)([]), []);
});
(0, node_test_1.default)('safeExternalUrl allows https only', () => {
    node_assert_1.default.strictEqual((0, pullDetailModel_1.safeExternalUrl)('https://github.com/o/r/pull/1'), 'https://github.com/o/r/pull/1');
    for (const bad of ['javascript:alert(1)', 'http://github.com', 'file:///etc/passwd', 'vscode://x', '/relative', '#frag', '', 'not a url', null, undefined, 7]) {
        node_assert_1.default.strictEqual((0, pullDetailModel_1.safeExternalUrl)(bad), null, String(bad));
    }
});
//# sourceMappingURL=pullDetailModel.test.js.map
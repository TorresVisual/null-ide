"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const widgetTypes_1 = require("./widgetTypes");
const widgetQueries_1 = require("./widgetQueries");
const pr = (over) => ({
    number: 1, title: 't', url: 'https://github.com/o/r/pull/1', updatedAt: '2026-10-21T10:00:00Z', isDraft: false,
    mergeable: 'MERGEABLE', reviewDecision: null, repository: { nameWithOwner: 'o/r' }, author: { login: 'me' },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, ...over,
});
const issue = (over) => ({
    number: 1, title: 'i', url: 'https://github.com/o/r/issues/1', updatedAt: '2026-10-21T10:00:00Z',
    repository: { nameWithOwner: 'o/r' }, labels: { nodes: [{ name: 'bug' }] }, assignees: { nodes: [{ login: 'me' }] }, ...over,
});
const data = (d) => ({
    assigned: { nodes: d.assigned ?? [] }, mentioned: { nodes: d.mentioned ?? [] },
    authored: { nodes: d.authored ?? [] }, reviewReq: { nodes: d.reviewReq ?? [] },
});
(0, node_test_1.default)('parseRepos keeps only well-formed owner/name entries and de-duplicates', () => {
    const out = (0, widgetTypes_1.parseRepos)([
        { repo: 'a/b', account: 'x' }, { repo: 'A/B', account: 'x' }, // duplicate, different case
        { repo: 'a/b is:private', account: 'x' }, { repo: '../x', account: 'x' }, { repo: 'a/b', account: '' },
        { repo: 5, account: 'x' }, null, 'a/b', { repo: 'c/d', account: 'y' },
    ]);
    node_assert_1.default.deepStrictEqual(out, [{ repo: 'a/b', account: 'x' }, { repo: 'c/d', account: 'y' }]);
    node_assert_1.default.deepStrictEqual((0, widgetTypes_1.parseRepos)('nope'), []);
    node_assert_1.default.ok(widgetTypes_1.REPO_RE.test('o/r.js-x_1') && !widgetTypes_1.REPO_RE.test('o/r/x') && !widgetTypes_1.REPO_RE.test('o /r'));
});
(0, node_test_1.default)('search strings scope to the repos and use the viewer qualifiers from the spec', () => {
    const s = (0, widgetQueries_1.searchStrings)(['a/b', 'c/d']);
    node_assert_1.default.strictEqual(s.assigned, 'repo:a/b repo:c/d is:issue is:open assignee:@me sort:updated-desc');
    node_assert_1.default.ok(s.mentioned.includes('mentions:@me') && s.authored.includes('is:pr is:open author:@me') && s.reviewReq.includes('review-requested:@me'));
    node_assert_1.default.ok(widgetQueries_1.WIDGET_QUERY.includes('mergeable') && widgetQueries_1.WIDGET_QUERY.includes('reviewDecision'));
});
(0, node_test_1.default)('chunking keeps every search under GitHub\'s 256 character limit', () => {
    const repos = Array.from({ length: 12 }, (_, i) => `organisation/repository-${i}`);
    const chunks = (0, widgetQueries_1.chunkRepos)(repos);
    node_assert_1.default.deepStrictEqual(chunks.flat(), repos);
    for (const c of chunks)
        for (const q of Object.values((0, widgetQueries_1.searchStrings)(c)))
            node_assert_1.default.ok(q.length <= 256, `${q.length}`);
    const longest = `${'o'.repeat(100)}/${'r'.repeat(100)}`;
    node_assert_1.default.deepStrictEqual((0, widgetQueries_1.chunkRepos)([longest, 'a/b']), [[longest], ['a/b']]); // an over-budget repo gets a chunk of its own
});
(0, node_test_1.default)('issues: assigned wins over mentioned, duplicates collapse, local checkout is attached', () => {
    const rows = (0, widgetQueries_1.mapIssues)(data({ assigned: [issue({ number: 1 })], mentioned: [issue({ number: 1 }), issue({ number: 2, assignees: { nodes: [] } })] }), new Map([['o/r', 'D:\\code\\r']]));
    node_assert_1.default.deepStrictEqual(rows.map(r => [r.number, r.attention, r.assignee, r.localPath]), [[1, 'assigned', 'me', 'D:\\code\\r'], [2, 'mentioned', null, 'D:\\code\\r']]);
    node_assert_1.default.deepStrictEqual(rows[0].labels, ['bug']);
    node_assert_1.default.strictEqual((0, widgetQueries_1.mapIssues)(data({ assigned: [{}] }), new Map()).length, 0); // search noise ({}) is skipped
});
(0, node_test_1.default)('PRs: review requested of the viewer, drafts of others dropped, checks and conflicts mapped', () => {
    const rows = (0, widgetQueries_1.mapPrs)(data({
        authored: [pr({ number: 1, isDraft: true, mergeable: 'CONFLICTING', reviewDecision: 'CHANGES_REQUESTED',
                commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } })],
        reviewReq: [pr({ number: 2, author: { login: 'sam' } }), pr({ number: 3, isDraft: true, author: { login: 'sam' } }), pr({ number: 1 })],
    }), new Map());
    node_assert_1.default.deepStrictEqual(rows.map(r => r.number), [1, 2]); // own draft kept, sam's draft dropped, #1 once
    const p1 = rows.find(r => r.number === 1), p2 = rows.find(r => r.number === 2);
    node_assert_1.default.deepStrictEqual([p1.review, p1.checks, p1.conflict], ['requested', 'failing', true]); // requested overrides CHANGES_REQUESTED
    node_assert_1.default.deepStrictEqual([p2.review, p2.checks, p2.conflict, p2.author], ['requested', 'passing', false, 'sam']);
    const own = (0, widgetQueries_1.mapPrs)(data({ authored: [pr({ reviewDecision: 'APPROVED' })] }), new Map())[0];
    node_assert_1.default.strictEqual(own.review, 'approved');
    node_assert_1.default.strictEqual((0, widgetQueries_1.mapPrs)(data({ authored: [pr({ reviewDecision: 'REVIEW_REQUIRED', commits: { nodes: [] } })] }), new Map())[0].review, 'none');
});
(0, node_test_1.default)('PR ranking: review requested, then changes requested, failing checks, conflicts, then recency', () => {
    const mk = (n, o) => ({ provider: 'github', repo: 'o/r', number: n, title: '', url: '', author: 'me', review: 'none',
        checks: 'passing', conflict: false, localPath: null, updatedAt: `2026-10-21T0${n}:00:00Z`, ...o });
    const ranked = (0, widgetQueries_1.rankPrs)([mk(1, {}), mk(2, { conflict: true }), mk(3, { checks: 'failing' }), mk(4, { review: 'changes' }), mk(5, { review: 'requested' }), mk(6, {})]);
    node_assert_1.default.deepStrictEqual(ranked.map(r => r.number), [5, 4, 3, 2, 6, 1]);
});
(0, node_test_1.default)('issue ranking: assigned before mentioned, newest first inside each', () => {
    const mk = (n, a) => ({ provider: 'github', repo: 'o/r', number: n, title: '', url: '', state: 'open', labels: [], assignee: null,
        attention: a, localPath: null, updatedAt: `2026-10-21T0${n}:00:00Z` });
    node_assert_1.default.deepStrictEqual((0, widgetQueries_1.rankIssues)([mk(1, 'mentioned'), mk(2, 'assigned'), mk(3, 'mentioned'), mk(4, 'assigned')]).map(r => r.number), [4, 2, 3, 1]);
});
//# sourceMappingURL=widgetQueries.test.js.map
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const pullFilter_1 = require("./pullFilter");
const q = (over = {}) => (0, pullFilter_1.pullsQuery)('o', 'r', { ...pullFilter_1.DEFAULT_FILTER, ...over });
(0, node_test_1.default)('the default filter is exactly the Phase 1 query', () => {
    node_assert_1.default.strictEqual(q(), 'repo:o/r is:pr is:open sort:updated-desc');
    node_assert_1.default.ok((0, pullFilter_1.isDefaultFilter)(pullFilter_1.DEFAULT_FILTER));
});
(0, node_test_1.default)('each state maps to its qualifiers: closed excludes merged, all adds none', () => {
    node_assert_1.default.strictEqual(q({ state: 'merged' }), 'repo:o/r is:pr is:merged sort:updated-desc');
    node_assert_1.default.strictEqual(q({ state: 'closed' }), 'repo:o/r is:pr is:closed is:unmerged sort:updated-desc');
    node_assert_1.default.strictEqual(q({ state: 'all' }), 'repo:o/r is:pr sort:updated-desc');
});
(0, node_test_1.default)('mine, review requested, draft and sort', () => {
    node_assert_1.default.strictEqual(q({ mine: true, reviewRequested: true, draft: 'hide', sort: 'created' }), 'repo:o/r is:pr is:open author:@me review-requested:@me draft:false sort:created-desc');
    node_assert_1.default.strictEqual(q({ draft: 'only', sort: 'comments' }), 'repo:o/r is:pr is:open draft:true sort:comments-desc');
});
(0, node_test_1.default)('label and milestone are quoted so names with spaces stay one qualifier', () => {
    node_assert_1.default.strictEqual(q({ label: 'good first issue', milestone: 'v 1.0' }), 'repo:o/r is:pr is:open label:"good first issue" milestone:"v 1.0" sort:updated-desc');
});
(0, node_test_1.default)('a label that would end the quotes or start another qualifier never reaches the query', () => {
    for (const bad of ['x" is:closed', 'a\\', 'line\nbreak', 'tab\there', '', 'x'.repeat(101)]) {
        node_assert_1.default.strictEqual((0, pullFilter_1.isSafeSearchValue)(bad), false, JSON.stringify(bad));
        node_assert_1.default.strictEqual(q({ label: bad, milestone: bad }), q(), JSON.stringify(bad));
    }
});
(0, node_test_1.default)('parseFilter: anything unusable falls back field by field and never throws', () => {
    for (const junk of [undefined, null, 'x', 7, [], {}])
        node_assert_1.default.deepStrictEqual((0, pullFilter_1.parseFilter)(junk), pullFilter_1.DEFAULT_FILTER);
    node_assert_1.default.deepStrictEqual((0, pullFilter_1.parseFilter)({ state: 'bogus', mine: 'yes', draft: 'only', label: 'bug" x', milestone: 'v1', sort: 7 }), { ...pullFilter_1.DEFAULT_FILTER, draft: 'only', milestone: 'v1' });
    const kept = { ...pullFilter_1.DEFAULT_FILTER, state: 'merged', mine: true, label: 'bug', sort: 'comments' };
    node_assert_1.default.deepStrictEqual((0, pullFilter_1.parseFilter)(JSON.parse(JSON.stringify(kept))), kept);
});
(0, node_test_1.default)('describeFilter names only what differs from the default, and isDefaultFilter agrees', () => {
    node_assert_1.default.strictEqual((0, pullFilter_1.describeFilter)(pullFilter_1.DEFAULT_FILTER), '');
    const f = { ...pullFilter_1.DEFAULT_FILTER, state: 'merged', mine: true, draft: 'hide', label: 'bug', sort: 'created' };
    node_assert_1.default.strictEqual((0, pullFilter_1.describeFilter)(f), 'Merged · Created by me · No drafts · Label: bug · Newest');
    node_assert_1.default.ok(!(0, pullFilter_1.isDefaultFilter)(f));
    node_assert_1.default.ok(!(0, pullFilter_1.isDefaultFilter)({ ...pullFilter_1.DEFAULT_FILTER, milestone: 'v1' }));
});
(0, node_test_1.default)('facetRows shows the current value of every facet', () => {
    const rows = (0, pullFilter_1.facetRows)({ ...pullFilter_1.DEFAULT_FILTER, state: 'closed', reviewRequested: true, label: 'bug' });
    const by = Object.fromEntries(rows.map(r => [r.id, r.description]));
    node_assert_1.default.deepStrictEqual(by, {
        state: 'Closed (not merged)', mine: 'Off', reviewRequested: 'On', draft: 'Any', label: 'bug', milestone: 'Any', sort: 'Recently updated',
    });
});
//# sourceMappingURL=pullFilter.test.js.map
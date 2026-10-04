'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const searchQuery_1 = require("./searchQuery");
(0, node_test_1.default)('getQualifierValues unquotes values and ignores negated and other keys', () => {
    const q = 'is:open label:"good first issue" label:bug -label:wontfix assignee:octocat fix crash';
    node_assert_1.default.deepStrictEqual((0, searchQuery_1.getQualifierValues)(q, 'label'), ['good first issue', 'bug']);
    node_assert_1.default.deepStrictEqual((0, searchQuery_1.getQualifierValues)(q, 'LABEL'), ['good first issue', 'bug']);
    node_assert_1.default.deepStrictEqual((0, searchQuery_1.getQualifierValues)(q, 'milestone'), []);
});
(0, node_test_1.default)('toggleQualifier adds, quotes values with spaces, and removes case-insensitively', () => {
    node_assert_1.default.strictEqual((0, searchQuery_1.toggleQualifier)('is:open', 'label', 'bug'), 'is:open label:bug');
    node_assert_1.default.strictEqual((0, searchQuery_1.toggleQualifier)('is:open', 'label', 'good first issue'), 'is:open label:"good first issue"');
    node_assert_1.default.strictEqual((0, searchQuery_1.toggleQualifier)('is:open label:Bug', 'label', 'bug'), 'is:open');
    node_assert_1.default.strictEqual((0, searchQuery_1.toggleQualifier)('label:"good first issue" x', 'label', 'good first issue'), 'x');
});
(0, node_test_1.default)('toggleQualifier twice is the identity', () => {
    const q = 'is:open label:ui fix';
    node_assert_1.default.strictEqual((0, searchQuery_1.toggleQualifier)((0, searchQuery_1.toggleQualifier)(q, 'label', 'bug'), 'label', 'bug'), q);
});
(0, node_test_1.default)('toggleQualifier leaves a negated token of the same key alone', () => {
    node_assert_1.default.strictEqual((0, searchQuery_1.toggleQualifier)('-label:bug', 'label', 'bug'), '-label:bug label:bug');
});
(0, node_test_1.default)('setQualifier replaces every value of the key and keeps free text', () => {
    node_assert_1.default.strictEqual((0, searchQuery_1.setQualifier)('is:open assignee:a assignee:b crash', 'assignee', 'c'), 'is:open crash assignee:c');
    node_assert_1.default.strictEqual((0, searchQuery_1.setQualifier)('is:open', 'sort', 'updated-desc'), 'is:open sort:updated-desc');
});
(0, node_test_1.default)('removeQualifier drops the key but keeps negations and free text', () => {
    node_assert_1.default.strictEqual((0, searchQuery_1.removeQualifier)('is:open label:a -label:b "exact phrase" x', 'label'), 'is:open -label:b "exact phrase" x');
});
(0, node_test_1.default)('withState swaps is:open / is:closed and keeps other is: filters', () => {
    node_assert_1.default.strictEqual((0, searchQuery_1.withState)('is:open label:bug', 'closed'), 'is:closed label:bug');
    node_assert_1.default.strictEqual((0, searchQuery_1.withState)('label:bug', 'open'), 'is:open label:bug');
    node_assert_1.default.strictEqual((0, searchQuery_1.withState)('is:open is:locked', 'closed'), 'is:closed is:locked');
});
(0, node_test_1.default)('describeQuery reports tab, selected values (@me resolved) and sort', () => {
    const view = (0, searchQuery_1.describeQuery)('is:closed assignee:@me label:bug sort:updated-desc', 'octocat');
    node_assert_1.default.strictEqual(view.state, 'closed');
    node_assert_1.default.deepStrictEqual(view.selected.assignee, ['octocat']);
    node_assert_1.default.deepStrictEqual(view.selected.label, ['bug']);
    node_assert_1.default.strictEqual(view.sort, 'updated-desc');
    node_assert_1.default.strictEqual((0, searchQuery_1.describeQuery)('', null).state, 'all');
    node_assert_1.default.strictEqual((0, searchQuery_1.describeQuery)('is:open is:closed', null).state, 'all');
    node_assert_1.default.deepStrictEqual((0, searchQuery_1.describeQuery)('assignee:@me', null).selected.assignee, ['@me']);
});
(0, node_test_1.default)('toApiQuery scopes to the repo and sorts newest-first when there is no text or sort', () => {
    node_assert_1.default.strictEqual((0, searchQuery_1.toApiQuery)('o/r', 'is:open'), 'repo:o/r is:issue is:open sort:created-desc');
    node_assert_1.default.strictEqual((0, searchQuery_1.toApiQuery)('o/r', 'is:open crash'), 'repo:o/r is:issue is:open crash');
    node_assert_1.default.strictEqual((0, searchQuery_1.toApiQuery)('o/r', 'is:open sort:comments-desc'), 'repo:o/r is:issue is:open sort:comments-desc');
    node_assert_1.default.strictEqual((0, searchQuery_1.toApiQuery)('o/r', ''), 'repo:o/r is:issue sort:created-desc');
});
(0, node_test_1.default)('toApiQuery drops repo:/org:/user: so the list cannot leave this repo', () => {
    node_assert_1.default.strictEqual((0, searchQuery_1.toApiQuery)('o/r', 'repo:evil/private org:x -user:y is:open'), 'repo:o/r is:issue is:open sort:created-desc');
});
(0, node_test_1.default)('toApiQuery also drops owner: (it widens the search to every repo of that owner)', () => {
    node_assert_1.default.strictEqual((0, searchQuery_1.toApiQuery)('o/r', 'owner:microsoft is:open'), 'repo:o/r is:issue is:open sort:created-desc');
});
(0, node_test_1.default)('hasFreeText is true only when there is text besides qualifiers', () => {
    node_assert_1.default.strictEqual((0, searchQuery_1.hasFreeText)('is:open label:"good first issue" sort:updated-desc'), false);
    node_assert_1.default.strictEqual((0, searchQuery_1.hasFreeText)('is:open crash'), true);
    node_assert_1.default.strictEqual((0, searchQuery_1.hasFreeText)('"exact phrase"'), true);
    node_assert_1.default.strictEqual((0, searchQuery_1.hasFreeText)(''), false);
});
//# sourceMappingURL=searchQuery.test.js.map
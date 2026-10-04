'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const recentlyCreated_1 = require("./recentlyCreated");
const issue = (number, state = 'open') => ({
    number, title: `#${number}`, body: '', state, html_url: '', labels: [], assignees: [],
    user: { login: 'u', avatar_url: '' }, comments: 0, updated_at: '2026-10-04T00:00:00Z',
});
const NOW = 1_000_000;
(0, node_test_1.default)('mergeRecentlyCreated puts a fresh issue the search has not indexed yet on top', () => {
    const r = (0, recentlyCreated_1.mergeRecentlyCreated)([issue(1)], [{ issue: issue(9), at: NOW - 5000 }], 'is:open', NOW);
    node_assert_1.default.deepStrictEqual(r.items.map(i => i.number), [9, 1]);
    node_assert_1.default.deepStrictEqual(r.added.map(i => i.number), [9]);
});
(0, node_test_1.default)('mergeRecentlyCreated leaves the page alone once search lists the issue', () => {
    const r = (0, recentlyCreated_1.mergeRecentlyCreated)([issue(9), issue(1)], [{ issue: issue(9), at: NOW - 5000 }], 'is:open', NOW);
    node_assert_1.default.deepStrictEqual(r.items.map(i => i.number), [9, 1]);
    node_assert_1.default.strictEqual(r.added.length, 0);
});
(0, node_test_1.default)('mergeRecentlyCreated ignores entries older than a minute', () => {
    const r = (0, recentlyCreated_1.mergeRecentlyCreated)([issue(1)], [{ issue: issue(9), at: NOW - 61000 }], 'is:open', NOW);
    node_assert_1.default.deepStrictEqual(r.items.map(i => i.number), [1]);
});
(0, node_test_1.default)('mergeRecentlyCreated skips queries the new issue may not match', () => {
    const recent = [{ issue: issue(9), at: NOW - 1000 }];
    node_assert_1.default.strictEqual((0, recentlyCreated_1.mergeRecentlyCreated)([], recent, 'is:closed', NOW).items.length, 0);
    node_assert_1.default.strictEqual((0, recentlyCreated_1.mergeRecentlyCreated)([], recent, 'is:open label:bug', NOW).items.length, 0);
    node_assert_1.default.strictEqual((0, recentlyCreated_1.mergeRecentlyCreated)([], recent, 'is:open crash', NOW).items.length, 0);
    node_assert_1.default.strictEqual((0, recentlyCreated_1.mergeRecentlyCreated)([], recent, '', NOW).items.length, 1);
});
//# sourceMappingURL=recentlyCreated.test.js.map
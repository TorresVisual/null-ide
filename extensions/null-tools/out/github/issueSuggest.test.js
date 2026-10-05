'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const issueSuggest_1 = require("./issueSuggest");
const issue = (number, title, state = 'open') => ({ number, title, state });
(0, node_test_1.default)('matchIssues with nothing typed lists the newest issues first, capped at the limit', () => {
    const out = (0, issueSuggest_1.matchIssues)([issue(1, 'a'), issue(3, 'c'), issue(2, 'b')], '', 2);
    node_assert_1.default.deepStrictEqual(out.map(i => i.number), [3, 2]);
});
(0, node_test_1.default)('a typed number matches issue numbers by prefix and titles containing it', () => {
    const out = (0, issueSuggest_1.matchIssues)([issue(12, 'x'), issue(120, 'y'), issue(5, 'Bump to v12'), issue(7, 'z')], '12');
    node_assert_1.default.deepStrictEqual(out.map(i => i.number), [120, 12, 5]);
});
(0, node_test_1.default)('text matches titles case-insensitively and a repeated number collapses', () => {
    const out = (0, issueSuggest_1.matchIssues)([issue(4, 'Crash on START'), issue(4, 'Crash on START'), issue(6, 'other')], 'start');
    node_assert_1.default.deepStrictEqual(out, [{ number: 4, title: 'Crash on START', state: 'open' }]);
});
(0, node_test_1.default)('matchIssues keeps the state so the popup can show open and closed icons', () => {
    node_assert_1.default.strictEqual((0, issueSuggest_1.matchIssues)([issue(9, 'done', 'closed')], '')[0].state, 'closed');
});
//# sourceMappingURL=issueSuggest.test.js.map
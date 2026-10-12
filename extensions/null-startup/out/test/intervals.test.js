'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const intervals_1 = require("../intervals");
(0, node_test_1.test)('unionMs does not double-count overlap', () => {
    node_assert_1.default.strictEqual((0, intervals_1.unionMs)([]), 0);
    node_assert_1.default.strictEqual((0, intervals_1.unionMs)([{ start: 0, end: 10 }, { start: 5, end: 15 }]), 15);
    node_assert_1.default.strictEqual((0, intervals_1.unionMs)([{ start: 0, end: 10 }, { start: 20, end: 30 }]), 20);
    node_assert_1.default.strictEqual((0, intervals_1.unionMs)([{ start: 0, end: 10 }, { start: 2, end: 4 }]), 10);
});
(0, node_test_1.test)('two extensions running over the same 500 ms add 500 ms, not 1000 ms', () => {
    const spans = [{ start: 1000, end: 1500 }, { start: 1000, end: 1500 }];
    const impact = (0, intervals_1.incrementalImpact)(spans);
    node_assert_1.default.strictEqual(impact.reduce((a, b) => a + b, 0), 500);
    node_assert_1.default.strictEqual((0, intervals_1.unionMs)(spans), 500);
});
(0, node_test_1.test)('incrementalImpact attributes overlap to the earlier-starting span', () => {
    node_assert_1.default.deepStrictEqual((0, intervals_1.incrementalImpact)([{ start: 0, end: 10 }, { start: 5, end: 15 }]), [10, 5]);
    node_assert_1.default.deepStrictEqual((0, intervals_1.incrementalImpact)([{ start: 5, end: 15 }, { start: 0, end: 10 }]), [5, 10], 'result keeps input order');
    node_assert_1.default.deepStrictEqual((0, intervals_1.incrementalImpact)([{ start: 0, end: 10 }, { start: 2, end: 4 }]), [10, 0]);
    node_assert_1.default.deepStrictEqual((0, intervals_1.incrementalImpact)([{ start: 0, end: 10 }, { start: 10, end: 20 }]), [10, 10]);
    node_assert_1.default.deepStrictEqual((0, intervals_1.incrementalImpact)([{ start: 5, end: 5 }, { start: 9, end: 3 }]), [0, 0], 'empty or reversed spans add nothing');
});
(0, node_test_1.test)('assignLanes packs non-overlapping spans into the same lane', () => {
    const lanes = (0, intervals_1.assignLanes)([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 10, end: 20 }, undefined]);
    node_assert_1.default.deepStrictEqual(lanes, [0, 1, 0, 0]);
});
//# sourceMappingURL=intervals.test.js.map
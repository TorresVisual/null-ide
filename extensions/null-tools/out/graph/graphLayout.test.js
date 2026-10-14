'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const graphLayout_1 = require("./graphLayout");
function c(sha, parents) {
    return { sha, parents, author: 'a', email: 'e', time: 1, refs: [], subject: sha };
}
(0, node_test_1.default)('a linear history stays in lane 0', () => {
    const rows = new graphLayout_1.GraphLayouter().layoutPage([c('c3', ['c2']), c('c2', ['c1']), c('c1', [])]);
    node_assert_1.default.deepStrictEqual(rows.map((r) => r.lane), [0, 0, 0]);
    node_assert_1.default.deepStrictEqual(rows.map((r) => r.laneCount), [1, 1, 1]);
    node_assert_1.default.deepStrictEqual(rows[0].edges, [{ kind: 'out', from: 0, to: 0, color: 0 }]);
    node_assert_1.default.deepStrictEqual(rows[1].edges, [{ kind: 'in', from: 0, to: 0, color: 0 }, { kind: 'out', from: 0, to: 0, color: 0 }]);
    node_assert_1.default.deepStrictEqual(rows[2].edges, [{ kind: 'in', from: 0, to: 0, color: 0 }]);
});
(0, node_test_1.default)('a merge opens a second lane and the fork point joins them again', () => {
    // M merges A and B, both of which sit on R.
    const rows = new graphLayout_1.GraphLayouter().layoutPage([c('M', ['A', 'B']), c('A', ['R']), c('B', ['R']), c('R', [])]);
    node_assert_1.default.deepStrictEqual(rows.map((r) => r.lane), [0, 0, 1, 0]);
    node_assert_1.default.deepStrictEqual(rows.map((r) => r.laneCount), [2, 2, 2, 2]);
    node_assert_1.default.deepStrictEqual(rows[0].edges, [
        { kind: 'out', from: 0, to: 0, color: 0 },
        { kind: 'out', from: 0, to: 1, color: 1 },
    ]);
    node_assert_1.default.deepStrictEqual(rows[1].edges, [
        { kind: 'pass', from: 1, to: 1, color: 1 },
        { kind: 'in', from: 0, to: 0, color: 0 },
        { kind: 'out', from: 0, to: 0, color: 0 },
    ]);
    node_assert_1.default.deepStrictEqual(rows[3].edges, [
        { kind: 'in', from: 0, to: 0, color: 0 },
        { kind: 'in', from: 1, to: 0, color: 1 },
    ]);
});
(0, node_test_1.default)('an octopus merge opens one lane per extra parent', () => {
    const rows = new graphLayout_1.GraphLayouter().layoutPage([c('M', ['A', 'B', 'C'])]);
    node_assert_1.default.strictEqual(rows[0].laneCount, 3);
    node_assert_1.default.deepStrictEqual(rows[0].edges.map((e) => [e.kind, e.from, e.to]), [['out', 0, 0], ['out', 0, 1], ['out', 0, 2]]);
});
(0, node_test_1.default)('a lane freed by a root commit is reused by the next new tip', () => {
    const rows = new graphLayout_1.GraphLayouter().layoutPage([c('X1', ['P1', 'P2']), c('P2', []), c('Y', []), c('P1', [])]);
    node_assert_1.default.strictEqual(rows[1].lane, 1);
    node_assert_1.default.strictEqual(rows[2].lane, 1, 'Y reuses the lane P2 freed');
});
(0, node_test_1.default)('colors repeat after the palette size', () => {
    const parents = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const rows = new graphLayout_1.GraphLayouter().layoutPage([c('M', parents)]);
    node_assert_1.default.deepStrictEqual(rows[0].edges.map((e) => e.color), [0, 1, 2, 3, 4, 5, 0]);
});
(0, node_test_1.default)('two pages lay out exactly like one page, and reset() starts over', () => {
    const history = [
        c('M', ['A', 'B']), c('A', ['R']), c('B', ['R']), c('N', ['Q']), c('R', ['Q']), c('Q', []),
    ];
    const whole = new graphLayout_1.GraphLayouter().layoutPage(history);
    for (let split = 1; split < history.length; split++) {
        const layouter = new graphLayout_1.GraphLayouter();
        const rows = [...layouter.layoutPage(history.slice(0, split)), ...layouter.layoutPage(history.slice(split))];
        node_assert_1.default.deepStrictEqual(rows, whole, `split at ${split}`);
    }
    const layouter = new graphLayout_1.GraphLayouter();
    layouter.layoutPage(history.slice(0, 2));
    layouter.reset();
    node_assert_1.default.deepStrictEqual(layouter.layoutPage(history), whole);
});
//# sourceMappingURL=graphLayout.test.js.map
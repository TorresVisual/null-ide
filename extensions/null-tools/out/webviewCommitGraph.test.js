'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_vm_1 = __importDefault(require("node:vm"));
// Built by `tsc -p tsconfig.webview-shared.json`; top-level functions of the plain-script webview files land on the sandbox.
const sandbox = node_vm_1.default.createContext({});
node_vm_1.default.runInContext((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);
const model = sandbox;
(0, node_test_1.default)('rows are 24 px tall', () => {
    node_assert_1.default.strictEqual(model.graphRowHeight(), 24);
});
(0, node_test_1.default)('graphVisibleRange renders the visible rows plus 20 on each side, clamped to the list', () => {
    node_assert_1.default.deepStrictEqual({ ...model.graphVisibleRange(0, 240, 1000) }, { start: 0, end: 30 });
    node_assert_1.default.deepStrictEqual({ ...model.graphVisibleRange(2400, 240, 1000) }, { start: 80, end: 130 });
    node_assert_1.default.deepStrictEqual({ ...model.graphVisibleRange(0, 240, 5) }, { start: 0, end: 5 });
    node_assert_1.default.deepStrictEqual({ ...model.graphVisibleRange(0, 240, 0) }, { start: 0, end: 0 });
});
(0, node_test_1.default)('graphMoveSelection handles every navigation key and clamps at both ends', () => {
    const move = model.graphMoveSelection;
    node_assert_1.default.strictEqual(move(-1, 'ArrowDown', 5, 100), 0);
    node_assert_1.default.strictEqual(move(0, 'ArrowUp', 5, 100), 0);
    node_assert_1.default.strictEqual(move(10, 'ArrowDown', 5, 100), 11);
    node_assert_1.default.strictEqual(move(10, 'ArrowUp', 5, 100), 9);
    node_assert_1.default.strictEqual(move(50, 'PageDown', 9, 100), 59);
    node_assert_1.default.strictEqual(move(50, 'PageUp', 9, 100), 41);
    node_assert_1.default.strictEqual(move(95, 'PageDown', 9, 100), 99);
    node_assert_1.default.strictEqual(move(50, 'Home', 9, 100), 0);
    node_assert_1.default.strictEqual(move(50, 'End', 9, 100), 99);
    node_assert_1.default.strictEqual(move(99, 'ArrowDown', 5, 100), 99);
    node_assert_1.default.strictEqual(move(3, 'x', 5, 100), 3);
    node_assert_1.default.strictEqual(move(3, 'ArrowDown', 5, 0), -1);
});
(0, node_test_1.default)('graphScrollToReveal scrolls only as far as needed', () => {
    node_assert_1.default.strictEqual(model.graphScrollToReveal(0, 240, 10), 24);
    node_assert_1.default.strictEqual(model.graphScrollToReveal(100, 240, 0), 0);
    node_assert_1.default.strictEqual(model.graphScrollToReveal(0, 240, 5), 0);
});
(0, node_test_1.default)('graphAnchorAfterReset keeps the same commit at the same offset, else gives up', () => {
    const rows = [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }];
    node_assert_1.default.strictEqual(model.graphAnchorAfterReset('c', 5, rows), 53);
    node_assert_1.default.strictEqual(model.graphAnchorAfterReset('gone', 5, rows), null);
    node_assert_1.default.strictEqual(model.graphAnchorAfterReset(null, 0, rows), null);
});
(0, node_test_1.default)('graphNeedsMore asks when within ten rows of the end and more exists', () => {
    node_assert_1.default.strictEqual(model.graphNeedsMore(0, 240, 10, true), true);
    node_assert_1.default.strictEqual(model.graphNeedsMore(0, 240, 500, true), false);
    node_assert_1.default.strictEqual(model.graphNeedsMore(11000, 800, 500, true), true);
    node_assert_1.default.strictEqual(model.graphNeedsMore(11000, 800, 500, false), false);
});
(0, node_test_1.default)('lane helpers cap the drawn column, count the hidden lanes and wrap colors', () => {
    node_assert_1.default.strictEqual(model.graphLaneColumn(3), 3);
    node_assert_1.default.strictEqual(model.graphLaneColumn(15), 9);
    node_assert_1.default.strictEqual(model.graphHiddenLanes(10), 0);
    node_assert_1.default.strictEqual(model.graphHiddenLanes(12), 2);
    node_assert_1.default.strictEqual(model.graphLaneColorVar(0), 'var(--vscode-charts-red)');
    node_assert_1.default.strictEqual(model.graphLaneColorVar(6), model.graphLaneColorVar(0));
});
//# sourceMappingURL=webviewCommitGraph.test.js.map
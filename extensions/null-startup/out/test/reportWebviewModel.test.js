'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = require("node:test");
const node_vm_1 = __importDefault(require("node:vm"));
// The webview bundle is a plain script: load the compiled shared file into a sandbox and read its
// top-level functions back. dom.ts only touches `document` when called, so an empty context is enough.
const sandbox = node_vm_1.default.createContext({});
node_vm_1.default.runInContext((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, '..', 'webview-report-shared.js'), 'utf8'), sandbox);
const w = sandbox;
(0, node_test_1.test)('formatMs and formatDelta', () => {
    node_assert_1.default.strictEqual(w.formatMs(undefined), 'n/a');
    node_assert_1.default.strictEqual(w.formatMs(12.4), '12 ms');
    node_assert_1.default.strictEqual(w.formatMs(1500), '1.50 s');
    node_assert_1.default.strictEqual(w.formatDelta(undefined), 'n/a');
    node_assert_1.default.strictEqual(w.formatDelta(0), '0 ms');
    node_assert_1.default.strictEqual(w.formatDelta(200), '+200 ms');
    node_assert_1.default.strictEqual(w.formatDelta(-1500), '−1.50 s');
});
(0, node_test_1.test)('pct clamps to 0..100 and survives a zero span', () => {
    node_assert_1.default.strictEqual(w.pct(50, 200), 25);
    node_assert_1.default.strictEqual(w.pct(500, 200), 100);
    node_assert_1.default.strictEqual(w.pct(-5, 200), 0);
    node_assert_1.default.strictEqual(w.pct(5, 0), 0);
});
(0, node_test_1.test)('sortBy orders by key in both directions and always puts undefined last', () => {
    const rows = [{ v: 2 }, { v: undefined }, { v: 1 }, { v: 3 }];
    const key = (r) => r.v;
    node_assert_1.default.deepStrictEqual(w.sortBy(rows, key, 1).map(key), [1, 2, 3, undefined]);
    node_assert_1.default.deepStrictEqual(w.sortBy(rows, key, -1).map(key), [3, 2, 1, undefined]);
    node_assert_1.default.deepStrictEqual(rows.map(key), [2, undefined, 1, 3], 'input is not mutated');
    node_assert_1.default.deepStrictEqual(w.sortBy([{ v: 'b' }, { v: 'a' }], (r) => r.v, 1).map((r) => r.v), ['a', 'b']);
});
//# sourceMappingURL=reportWebviewModel.test.js.map
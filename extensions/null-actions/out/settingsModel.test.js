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
const sandbox = node_vm_1.default.createContext({});
node_vm_1.default.runInContext((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, 'webview-settings-shared.js'), 'utf8'), sandbox);
const m = sandbox;
// Objects built inside the vm context have another realm's prototypes; compare as plain JSON.
const plain = (x) => JSON.parse(JSON.stringify(x));
const btn = (id, priority, extra = {}) => ({ id, label: id, command: 'x', type: 'terminal', background: 'none', priority, saveAll: false, focus: true, ...extra });
const ids = (l) => l.map(b => b.id).join(',');
const prios = (l) => l.map(b => b.priority).join(',');
(0, node_test_1.test)('sortByPriority: descending, stable on ties, input untouched', () => {
    const input = [btn('a', 0), btn('b', 5), btn('c', 0)];
    node_assert_1.default.strictEqual(ids(m.sortByPriority(input)), 'b,a,c');
    node_assert_1.default.strictEqual(ids(input), 'a,b,c');
});
(0, node_test_1.test)('moveButton with distinct priorities swaps only the two neighbours', () => {
    const out = m.moveButton([btn('a', 5), btn('b', 3), btn('c', 1)], 1, 'up');
    node_assert_1.default.strictEqual(ids(out), 'b,a,c');
    node_assert_1.default.strictEqual(prios(out), '5,3,1');
});
(0, node_test_1.test)('moveButton down swaps with the next', () => {
    const out = m.moveButton([btn('a', 5), btn('b', 3), btn('c', 1)], 0, 'down');
    node_assert_1.default.strictEqual(ids(out), 'b,a,c');
    node_assert_1.default.strictEqual(prios(out), '5,3,1');
});
(0, node_test_1.test)('moveButton at the ends is a no-op', () => {
    const list = [btn('a', 2), btn('b', 1)];
    node_assert_1.default.strictEqual(ids(m.moveButton(list, 0, 'up')), 'a,b');
    node_assert_1.default.strictEqual(ids(m.moveButton(list, 1, 'down')), 'a,b');
    node_assert_1.default.strictEqual(ids(m.moveButton(list, 5, 'up')), 'a,b');
});
(0, node_test_1.test)('moveButton breaks ties by renumbering downward from 0, never above the gear item', () => {
    const out = m.moveButton([btn('a', 0), btn('b', 0), btn('c', 0)], 2, 'up');
    node_assert_1.default.strictEqual(ids(out), 'a,c,b');
    node_assert_1.default.strictEqual(prios(out), '0,-1,-2');
    node_assert_1.default.ok(out.every(b => b.priority <= 0));
});
(0, node_test_1.test)('moveButton renumbers when a tie is elsewhere in the list', () => {
    const out = m.moveButton([btn('a', 9), btn('b', 4), btn('c', 4)], 0, 'down');
    node_assert_1.default.strictEqual(ids(out), 'b,a,c');
    node_assert_1.default.strictEqual(prios(out), '0,-1,-2');
});
(0, node_test_1.test)('moveButton does not mutate its input', () => {
    const list = [btn('a', 0), btn('b', 0)];
    m.moveButton(list, 1, 'up');
    node_assert_1.default.strictEqual(prios(list), '0,0');
});
(0, node_test_1.test)('nextPriority sits below every button and never above 0', () => {
    node_assert_1.default.strictEqual(m.nextPriority([]), 0);
    node_assert_1.default.strictEqual(m.nextPriority([btn('a', 0), btn('b', -1), btn('c', -2)]), -3);
    node_assert_1.default.strictEqual(m.nextPriority([btn('a', 0)]), -1);
    node_assert_1.default.strictEqual(m.nextPriority([btn('a', 7)]), -1);
});
(0, node_test_1.test)('addSuggestion appends once and hides the suggestion afterwards', () => {
    const s = { id: 'cargo-build', label: 'cargo build', command: 'cargo build' };
    const once = m.addSuggestion([btn('a', 0)], s);
    node_assert_1.default.strictEqual(ids(once), 'a,cargo-build');
    node_assert_1.default.strictEqual(once[1].priority, -1);
    node_assert_1.default.strictEqual(m.addSuggestion(once, s), once);
    node_assert_1.default.deepStrictEqual(plain(m.visibleSuggestions(once, [s])), []);
    node_assert_1.default.deepStrictEqual(plain(m.visibleSuggestions([btn('a', 0)], [s])), [s]);
});
(0, node_test_1.test)('newButton ids are unique even within the same millisecond', () => {
    const first = m.newButton([], 100);
    const second = m.newButton([first], 100);
    node_assert_1.default.notStrictEqual(first.id, second.id);
    node_assert_1.default.strictEqual(second.priority, -1);
});
(0, node_test_1.test)('validate flags empty or blank label and command, and the later duplicate id', () => {
    const errs = plain(m.validate([btn('a', 0, { label: ' ' }), btn('b', 0, { command: '' }), btn('a', 0)]));
    node_assert_1.default.deepStrictEqual(errs.map(e => `${e.index}:${e.field}`), ['0:label', '1:command', '2:id']);
    node_assert_1.default.deepStrictEqual(plain(m.validate([btn("a", 0), btn("b", 0)])), []);
});
(0, node_test_1.test)('isDirty: identical lists are clean, any real edit is dirty', () => {
    const list = [btn('a', 2), btn('b', 1)];
    node_assert_1.default.strictEqual(m.isDirty(list, JSON.parse(JSON.stringify(list))), false);
    node_assert_1.default.strictEqual(m.isDirty([btn('a', 2), btn('b', 1, { label: 'x' })], list), true);
    node_assert_1.default.strictEqual(m.isDirty([btn('a', 2)], list), true);
    node_assert_1.default.strictEqual(m.isDirty([btn('a', 3), btn('b', 1)], list), true);
});
(0, node_test_1.test)('isDirty ignores representation the host would normalise away', () => {
    const base = btn('a', 0);
    const noisy = { ...base, args: [], icon: '', problemMatcher: '  ', onBusy: 'ask', saveAll: false };
    node_assert_1.default.strictEqual(m.isDirty([noisy], [base]), false);
    node_assert_1.default.strictEqual(m.isDirty([{ ...base, problemMatcher: ' $tsc ' }], [{ ...base, problemMatcher: '$tsc' }]), false);
    node_assert_1.default.strictEqual(m.isDirty([{ ...base, problemMatcher: '$tsc' }], [base]), true);
});
(0, node_test_1.test)('isDirty: moving a button and moving it back is clean when priorities are distinct', () => {
    const list = [btn('a', 5), btn('b', 3), btn('c', 1)];
    const moved = m.moveButton(list, 1, 'up');
    node_assert_1.default.strictEqual(m.isDirty(moved, list), true);
    node_assert_1.default.strictEqual(m.isDirty(m.moveButton(moved, 0, 'down'), list), false);
});
//# sourceMappingURL=settingsModel.test.js.map
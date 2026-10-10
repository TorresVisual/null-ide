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
// The webview bundle is a plain script, so load the compiled shared file into a sandbox that has a
// tiny fake `document` (no jsdom) and read its top-level functions off it.
class FakeNode {
    tag;
    text;
    children = [];
    attrs = {};
    constructor(tag, text) {
        this.tag = tag;
        this.text = text;
    }
    setAttribute(k, v) {
        this.attrs[k] = v;
    }
    appendChild(c) {
        this.children.push(c);
        return c;
    }
}
const counter = { elements: 0 };
const document = {
    createElement: (tag) => {
        counter.elements++;
        return new FakeNode(tag);
    },
    createTextNode: (text) => new FakeNode('#text', text),
};
const sandbox = node_vm_1.default.createContext({ document });
node_vm_1.default.runInContext((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, '..', 'webview-dashboard-shared.js'), 'utf8'), sandbox);
const w = sandbox;
/** Arrays made inside the vm have another realm's prototype; round-trip them before deepStrictEqual. */
const plain = (v) => JSON.parse(JSON.stringify(v));
(0, node_test_1.test)('h() keeps markup in names inert: one element, text node child, literal attributes', () => {
    counter.elements = 0;
    const evil = '"><img src=x onerror=alert(1)>';
    const row = w.h('li', { 'data-id': evil, title: evil }, evil);
    node_assert_1.default.strictEqual(counter.elements, 1);
    node_assert_1.default.strictEqual(row.attrs['data-id'], evil);
    node_assert_1.default.strictEqual(row.attrs.title, evil);
    node_assert_1.default.strictEqual(row.children.length, 1);
    node_assert_1.default.strictEqual(row.children[0].tag, '#text');
    node_assert_1.default.strictEqual(row.children[0].text, evil);
});
(0, node_test_1.test)('h() skips null/undefined/false, sets boolean attributes and nests elements', () => {
    const inner = w.h('b', null, 'x');
    const el = w.h('div', { hidden: true, disabled: false, title: null, 'aria-pressed': 'false' }, null, undefined, false, inner, 'tail');
    node_assert_1.default.deepStrictEqual(plain(el.attrs), { hidden: '', 'aria-pressed': 'false' });
    node_assert_1.default.deepStrictEqual(el.children.map((c) => c.tag), ['b', '#text']);
});
(0, node_test_1.test)('formatDuration', () => {
    node_assert_1.default.strictEqual(w.formatDuration(0), '0m');
    node_assert_1.default.strictEqual(w.formatDuration(59_999), '<1m');
    node_assert_1.default.strictEqual(w.formatDuration(60_000), '1m');
    node_assert_1.default.strictEqual(w.formatDuration(3_599_999), '59m');
    node_assert_1.default.strictEqual(w.formatDuration(3_600_000), '1h 0m');
    node_assert_1.default.strictEqual(w.formatDuration((6 * 60 + 42) * 60_000), '6h 42m');
});
(0, node_test_1.test)('formatPercent shows "<1%" instead of a misleading 0%', () => {
    node_assert_1.default.strictEqual(w.formatPercent(42, 1000), '42%');
    node_assert_1.default.strictEqual(w.formatPercent(0, 5000), '<1%');
    node_assert_1.default.strictEqual(w.formatPercent(0, 0), '0%');
});
(0, node_test_1.test)('barScale: tallest bar fills maxPx, zero buckets keep a stub, all-zero input is all stubs', () => {
    node_assert_1.default.deepStrictEqual(plain(w.barScale([5, 10], 100, 2)), [50, 100]);
    node_assert_1.default.deepStrictEqual(plain(w.barScale([0, 10], 100, 2)), [2, 100]);
    node_assert_1.default.deepStrictEqual(plain(w.barScale([1, 100], 100, 2)), [2, 100]);
    node_assert_1.default.deepStrictEqual(plain(w.barScale([0, 0, 0], 100, 2)), [2, 2, 2]);
    node_assert_1.default.deepStrictEqual(plain(w.barScale([], 100, 2)), []);
});
(0, node_test_1.test)('axisTicks labels at most `max` evenly spaced buckets, starting at the first', () => {
    node_assert_1.default.deepStrictEqual(plain(w.axisTicks(24, 6)), [0, 4, 8, 12, 16, 20]);
    node_assert_1.default.deepStrictEqual(plain(w.axisTicks(31, 6)), [0, 6, 12, 18, 24, 30]);
    node_assert_1.default.deepStrictEqual(plain(w.axisTicks(7, 6)), [0, 2, 4, 6]);
    node_assert_1.default.deepStrictEqual(plain(w.axisTicks(1, 6)), [0]);
    node_assert_1.default.deepStrictEqual(plain(w.axisTicks(0, 6)), []);
});
(0, node_test_1.test)('barLabel joins label and duration', () => {
    node_assert_1.default.strictEqual(w.barLabel({ label: '14:00', startMs: 0, ms: 90 * 60_000 }), '14:00 · 1h 30m');
});
(0, node_test_1.test)('formatDateTime uses local time', () => {
    node_assert_1.default.strictEqual(w.formatDateTime(new Date(2026, 9, 8, 14, 5).getTime()), 'Thu 8 Oct, 14:05');
    node_assert_1.default.strictEqual(w.formatDateTime(new Date(2026, 0, 2, 0, 0).getTime()), 'Fri 2 Jan, 00:00');
});
(0, node_test_1.test)('filesTitle lists the files and truncates long lists', () => {
    node_assert_1.default.strictEqual(w.filesTitle([], 3), 'No files');
    node_assert_1.default.strictEqual(w.filesTitle(['a', 'b'], 3), 'a\nb');
    node_assert_1.default.strictEqual(w.filesTitle(['a', 'b', 'c', 'd', 'e'], 3), 'a\nb\nc\n+2 more');
});
(0, node_test_1.test)('nextIndex implements tab-list arrow navigation with wrap-around', () => {
    node_assert_1.default.strictEqual(w.nextIndex(0, 5, 'ArrowRight'), 1);
    node_assert_1.default.strictEqual(w.nextIndex(4, 5, 'ArrowRight'), 0);
    node_assert_1.default.strictEqual(w.nextIndex(0, 5, 'ArrowLeft'), 4);
    node_assert_1.default.strictEqual(w.nextIndex(2, 5, 'Home'), 0);
    node_assert_1.default.strictEqual(w.nextIndex(2, 5, 'End'), 4);
    node_assert_1.default.strictEqual(w.nextIndex(2, 5, 'Enter'), undefined);
});
//# sourceMappingURL=dashboardWebviewModel.test.js.map
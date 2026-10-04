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
// Webview bundles are plain scripts (module: none), so load the compiled shared files into a sandbox and read
// their top-level functions off it. Built by `tsc -p tsconfig.webview-shared.json`.
const sandbox = node_vm_1.default.createContext({});
node_vm_1.default.runInContext((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);
const shared = sandbox;
/** Just enough of the DOM tree API for reconcile(): ordered children, insert/move, replace, remove. */
class FakeElement {
    name;
    kids = [];
    parent = null;
    constructor(name) {
        this.name = name;
    }
    get children() { return this.kids; }
    get firstElementChild() { return this.kids[0] ?? null; }
    get nextElementSibling() {
        return this.parent ? this.parent.kids[this.parent.kids.indexOf(this) + 1] ?? null : null;
    }
    insertBefore(node, ref) {
        if (node.parent)
            node.parent.kids.splice(node.parent.kids.indexOf(node), 1);
        node.parent = this;
        this.kids.splice(ref ? this.kids.indexOf(ref) : this.kids.length, 0, node);
        return node;
    }
    removeChild(node) {
        this.kids.splice(this.kids.indexOf(node), 1);
        node.parent = null;
        return node;
    }
    replaceChild(node, old) {
        this.kids.splice(this.kids.indexOf(old), 1, node);
        node.parent = this;
        old.parent = null;
        return old;
    }
}
const render = (r) => new FakeElement(`${r.id}:${r.title}`);
const key = (r) => r.id;
const names = (c) => c.kids.map(k => k.name);
(0, node_test_1.default)('reconcile: unchanged rows keep their element across a refresh', () => {
    const c = new FakeElement('c');
    const rows = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
    shared.reconcile(c, rows, key, render);
    const [a, b] = c.kids;
    shared.reconcile(c, rows.map(r => ({ ...r })), key, render);
    node_assert_1.default.strictEqual(c.kids[0], a);
    node_assert_1.default.strictEqual(c.kids[1], b);
});
(0, node_test_1.default)('reconcile: a changed row is re-rendered in place, its neighbours are untouched', () => {
    const c = new FakeElement('c');
    shared.reconcile(c, [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], key, render);
    const [a, b] = c.kids;
    shared.reconcile(c, [{ id: 'a', title: 'A2' }, { id: 'b', title: 'B' }], key, render);
    node_assert_1.default.deepStrictEqual(names(c), ['a:A2', 'b:B']);
    node_assert_1.default.notStrictEqual(c.kids[0], a);
    node_assert_1.default.strictEqual(c.kids[1], b);
});
(0, node_test_1.default)('reconcile: reorders by moving existing elements, inserts new ones, removes missing ones', () => {
    const c = new FakeElement('c');
    shared.reconcile(c, [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }], key, render);
    const [a, , cc] = c.kids;
    shared.reconcile(c, [{ id: 'c', title: 'C' }, { id: 'd', title: 'D' }, { id: 'a', title: 'A' }], key, render);
    node_assert_1.default.deepStrictEqual(names(c), ['c:C', 'd:D', 'a:A']);
    node_assert_1.default.strictEqual(c.kids[0], cc);
    node_assert_1.default.strictEqual(c.kids[2], a);
    node_assert_1.default.strictEqual(c.kids.length, 3);
});
(0, node_test_1.default)('reconcile: removes children it did not create and skips repeated keys', () => {
    const c = new FakeElement('c');
    c.insertBefore(new FakeElement('skeleton'), null);
    shared.reconcile(c, [{ id: 'a', title: 'A' }, { id: 'a', title: 'A again' }, { id: 'b', title: 'B' }], key, render);
    node_assert_1.default.deepStrictEqual(names(c), ['a:A', 'b:B']);
});
(0, node_test_1.default)('reconcile: an empty list clears the container', () => {
    const c = new FakeElement('c');
    shared.reconcile(c, [{ id: 'a', title: 'A' }], key, render);
    shared.reconcile(c, [], key, render);
    node_assert_1.default.deepStrictEqual(names(c), []);
});
(0, node_test_1.default)('freeTextOf strips qualifiers (quoted, negated) and lowercases the rest', () => {
    node_assert_1.default.strictEqual(shared.freeTextOf('is:open fix Crash'), 'fix crash');
    node_assert_1.default.strictEqual(shared.freeTextOf('label:"good first issue" -author:bob  startup'), 'startup');
    node_assert_1.default.strictEqual(shared.freeTextOf('is:open'), '');
    node_assert_1.default.strictEqual(shared.freeTextOf('#12 "exact phrase"'), '#12 exact phrase');
});
(0, node_test_1.default)('matchesLocalFilter matches title and #number, ignoring qualifiers', () => {
    const issue = { number: 106, title: 'Creating issues is bugged' };
    node_assert_1.default.strictEqual(shared.matchesLocalFilter(issue, 'is:open label:bug'), true);
    node_assert_1.default.strictEqual(shared.matchesLocalFilter(issue, 'is:open BUGGED'), true);
    node_assert_1.default.strictEqual(shared.matchesLocalFilter(issue, '#106'), true);
    node_assert_1.default.strictEqual(shared.matchesLocalFilter(issue, '106'), true);
    node_assert_1.default.strictEqual(shared.matchesLocalFilter(issue, 'creating nothing'), false);
});
(0, node_test_1.default)('filterPickerItems matches label or description, case-insensitively', () => {
    const items = [
        { value: 'bug', label: 'bug', description: "Something isn't working" },
        { value: 'docs', label: 'documentation' },
    ];
    node_assert_1.default.deepStrictEqual(shared.filterPickerItems(items, '').map(i => i.value), ['bug', 'docs']);
    node_assert_1.default.deepStrictEqual(shared.filterPickerItems(items, 'WORKING').map(i => i.value), ['bug']);
    node_assert_1.default.deepStrictEqual(shared.filterPickerItems(items, 'doc').map(i => i.value), ['docs']);
    node_assert_1.default.deepStrictEqual(shared.filterPickerItems(items, 'zzz'), []);
});
(0, node_test_1.default)('escapeHtml escapes the five HTML-significant characters', () => {
    node_assert_1.default.strictEqual(shared.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});
//# sourceMappingURL=webviewList.test.js.map
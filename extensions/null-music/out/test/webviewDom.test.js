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
node_vm_1.default.runInContext((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, '..', 'webview-music-shared.js'), 'utf8'), sandbox);
const dom = sandbox;
(0, node_test_1.test)('h() keeps markup in names inert: one element, text node child, literal attributes', () => {
    counter.elements = 0;
    const evil = '"><img src=x onerror=alert(1)>';
    const row = dom.h('li', { 'data-id': evil, title: evil }, evil);
    node_assert_1.default.strictEqual(counter.elements, 1);
    node_assert_1.default.strictEqual(row.attrs['data-id'], evil);
    node_assert_1.default.strictEqual(row.attrs.title, evil);
    node_assert_1.default.strictEqual(row.children.length, 1);
    node_assert_1.default.strictEqual(row.children[0].tag, '#text');
    node_assert_1.default.strictEqual(row.children[0].text, evil);
});
(0, node_test_1.test)('h() skips null/undefined/false, sets boolean attributes and nests elements', () => {
    const inner = dom.h('b', null, 'x');
    const el = dom.h('div', { hidden: true, disabled: false, title: null, 'aria-pressed': 'false' }, null, undefined, false, inner, 'tail');
    node_assert_1.default.deepStrictEqual(el.attrs, { hidden: '', 'aria-pressed': 'false' });
    node_assert_1.default.deepStrictEqual(el.children.map((c) => c.tag), ['b', '#text']);
});
//# sourceMappingURL=webviewDom.test.js.map
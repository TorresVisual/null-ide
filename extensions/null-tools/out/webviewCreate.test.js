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
// The New issue form's HTML builders are plain top-level functions in a `module: none` bundle; load the compiled
// bundle into a sandbox (built by `tsc -p tsconfig.webview-shared.json`) like webviewDetail.test.ts does.
const sandbox = node_vm_1.default.createContext({});
node_vm_1.default.runInContext((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);
const html = sandbox;
const emptyState = { assignees: [], labels: [], type: null, milestone: null, parent: null };
const count = (haystack, needle) => haystack.split(needle).length - 1;
(0, node_test_1.default)('templateChooserHtml lists each template with its about text, then a Blank issue card', () => {
    const out = html.templateChooserHtml([
        { name: 'Bug report', about: 'Something broke', title: '', body: '', labels: [] },
        { name: 'Feature', about: '', title: '', body: '', labels: [] },
    ]);
    node_assert_1.default.ok(out.includes('data-index="0"') && out.includes('Bug report') && out.includes('Something broke'));
    node_assert_1.default.ok(out.includes('data-index="1"') && out.includes('Feature'));
    node_assert_1.default.ok(out.includes('data-index="-1"') && out.includes('Blank issue'));
    node_assert_1.default.strictEqual(count(out, 'class="template-card"'), 3);
});
(0, node_test_1.default)('templateChooserHtml with no templates is just the Blank card', () => {
    node_assert_1.default.strictEqual(count(html.templateChooserHtml([]), 'class="template-card"'), 1);
});
(0, node_test_1.default)('templateChooserHtml escapes template names and descriptions from the repo', () => {
    const out = html.templateChooserHtml([{ name: '<img src=x onerror=1>', about: '"><script>', title: '', body: '', labels: [] }]);
    node_assert_1.default.ok(!out.includes('<img') && !out.includes('<script>'));
    node_assert_1.default.ok(out.includes('&lt;img') && out.includes('&lt;script&gt;'));
});
(0, node_test_1.default)('createSidebarHtml shows the empty states and an edit gear for every section', () => {
    const out = html.createSidebarHtml(emptyState, { types: [{ id: 'T', name: 'Bug' }] });
    for (const key of ['assignees', 'labels', 'type', 'milestone', 'parent']) {
        node_assert_1.default.ok(out.includes(`data-act="pick-${key}"`), key);
    }
    node_assert_1.default.ok(out.includes('No one') && out.includes('None yet') && out.includes('No type') && out.includes('No milestone'));
});
(0, node_test_1.default)('createSidebarHtml shows Type only for repos that have issue types', () => {
    node_assert_1.default.ok(!html.createSidebarHtml(emptyState, { types: [] }).includes('data-sec="type"'));
    node_assert_1.default.ok(!html.createSidebarHtml(emptyState, null).includes('data-sec="type"'));
});
(0, node_test_1.default)('createSidebarHtml shows what was chosen, escaped', () => {
    const out = html.createSidebarHtml({
        assignees: [{ login: 'a<b', avatar_url: '' }],
        labels: [{ name: '"><x', color: 'd73a4a' }],
        type: { id: 'T', name: '<i>Bug</i>' },
        milestone: { number: 2, title: '<b>v1</b>' },
        parent: { number: 3, title: '<script>' },
    }, { types: [{ id: 'T', name: 'Bug' }] });
    node_assert_1.default.ok(!out.includes('<script>') && !out.includes('<i>Bug') && !out.includes('<b>v1'));
    node_assert_1.default.ok(out.includes('a&lt;b') && out.includes('&lt;script&gt;') && out.includes('#3'));
    node_assert_1.default.ok(!out.includes('No one'));
});
//# sourceMappingURL=webviewCreate.test.js.map
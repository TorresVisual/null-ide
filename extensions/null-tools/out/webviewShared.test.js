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
// Webview bundles are plain scripts (module: none), so load the compiled shared files into a
// sandbox and read their top-level functions off it. Built by `tsc -p tsconfig.webview-shared.json`.
const sandbox = node_vm_1.default.createContext({});
node_vm_1.default.runInContext((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);
const shared = sandbox;
const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
(0, node_test_1.default)('relativeTime: seconds, minutes, hours', () => {
    node_assert_1.default.strictEqual(shared.relativeTime('2026-09-28T11:59:30Z', NOW), 'just now');
    node_assert_1.default.strictEqual(shared.relativeTime('2026-09-28T11:59:00Z', NOW), '1 minute ago');
    node_assert_1.default.strictEqual(shared.relativeTime('2026-09-28T11:15:00Z', NOW), '45 minutes ago');
    node_assert_1.default.strictEqual(shared.relativeTime('2026-09-28T09:00:00Z', NOW), '3 hours ago');
});
(0, node_test_1.default)('relativeTime: a future timestamp (clock skew) reads "just now"', () => {
    node_assert_1.default.strictEqual(shared.relativeTime('2026-09-28T12:05:00Z', NOW), 'just now');
});
(0, node_test_1.default)('relativeTime: days, then absolute dates', () => {
    node_assert_1.default.strictEqual(shared.relativeTime('2026-09-27T10:00:00Z', NOW), 'yesterday');
    node_assert_1.default.strictEqual(shared.relativeTime('2026-09-16T12:00:00Z', NOW), '12 days ago');
    node_assert_1.default.strictEqual(shared.relativeTime('2026-08-01T12:00:00Z', NOW), 'on Aug 1');
    node_assert_1.default.strictEqual(shared.relativeTime('2025-03-03T12:00:00Z', NOW), 'on Mar 3, 2025');
});
(0, node_test_1.default)('rgbToHsl matches known GitHub label colors', () => {
    // Arrays from the vm realm have a different Array.prototype; copy before deep-comparing.
    node_assert_1.default.deepStrictEqual(Array.from(shared.rgbToHsl(215, 58, 74)), [354, 66, 54]); // d73a4a "bug"
    node_assert_1.default.deepStrictEqual(Array.from(shared.rgbToHsl(0, 117, 202)), [205, 100, 40]); // 0075ca "documentation"
    node_assert_1.default.deepStrictEqual(Array.from(shared.rgbToHsl(162, 238, 239)), [181, 71, 79]); // a2eeef "enhancement"
    node_assert_1.default.deepStrictEqual(Array.from(shared.rgbToHsl(255, 255, 255)), [0, 0, 100]);
    node_assert_1.default.deepStrictEqual(Array.from(shared.rgbToHsl(0, 0, 0)), [0, 0, 0]);
});
(0, node_test_1.default)('labelStyleVars emits the custom properties the .gh-label CSS computes from', () => {
    const expected = '--label-r:215;--label-g:58;--label-b:74;--label-h:354;--label-s:66;--label-l:54';
    node_assert_1.default.strictEqual(shared.labelStyleVars('d73a4a'), expected);
    node_assert_1.default.strictEqual(shared.labelStyleVars('#d73a4a'), expected);
});
(0, node_test_1.default)('issueStateKind maps REST and GraphQL state + reason', () => {
    node_assert_1.default.strictEqual(shared.issueStateKind('open', null), 'open');
    node_assert_1.default.strictEqual(shared.issueStateKind('OPEN', 'REOPENED'), 'open');
    node_assert_1.default.strictEqual(shared.issueStateKind('closed', 'completed'), 'completed');
    node_assert_1.default.strictEqual(shared.issueStateKind('closed', null), 'completed');
    node_assert_1.default.strictEqual(shared.issueStateKind('closed', 'not_planned'), 'not-planned');
    node_assert_1.default.strictEqual(shared.issueStateKind('closed', 'duplicate'), 'not-planned');
    node_assert_1.default.strictEqual(shared.issueStateKind('CLOSED', 'NOT_PLANNED'), 'not-planned');
});
(0, node_test_1.default)('octicon renders a generated path and tolerates unknown names', () => {
    node_assert_1.default.match(shared.octicon('issue-opened', 'x'), /^<svg class="octicon x" [^>]*><path d="/);
    node_assert_1.default.match(shared.octicon('no-such-icon'), /<svg[^>]*><\/svg>/);
});
//# sourceMappingURL=webviewShared.test.js.map
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const graphMessages_1 = require("./graphMessages");
const sha = 'a'.repeat(40);
(0, node_test_1.default)('isSha accepts only 40 lowercase hex characters', () => {
    node_assert_1.default.strictEqual((0, graphMessages_1.isSha)(sha), true);
    for (const bad of ['', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), '--upload-pack=x', `${sha}\n`, 42, null, undefined, {}]) {
        node_assert_1.default.strictEqual((0, graphMessages_1.isSha)(bad), false, String(bad));
    }
});
(0, node_test_1.default)('shaFromArg takes a sha string or an object carrying one (tree element, webview context)', () => {
    node_assert_1.default.strictEqual((0, graphMessages_1.shaFromArg)(sha), sha);
    node_assert_1.default.strictEqual((0, graphMessages_1.shaFromArg)({ sha, webviewSection: 'commit' }), sha);
    node_assert_1.default.strictEqual((0, graphMessages_1.shaFromArg)({ sha: '-x' }), undefined);
    node_assert_1.default.strictEqual((0, graphMessages_1.shaFromArg)(undefined), undefined);
    node_assert_1.default.strictEqual((0, graphMessages_1.shaFromArg)('HEAD'), undefined);
});
(0, node_test_1.default)('parseWebviewMessage keeps well-formed messages and drops everything else', () => {
    node_assert_1.default.deepStrictEqual((0, graphMessages_1.parseWebviewMessage)({ type: 'ready' }), { type: 'ready' });
    node_assert_1.default.deepStrictEqual((0, graphMessages_1.parseWebviewMessage)({ type: 'loadMore', extra: 1 }), { type: 'loadMore' });
    node_assert_1.default.deepStrictEqual((0, graphMessages_1.parseWebviewMessage)({ type: 'refresh' }), { type: 'refresh' });
    node_assert_1.default.deepStrictEqual((0, graphMessages_1.parseWebviewMessage)({ type: 'manageTrust' }), { type: 'manageTrust' });
    node_assert_1.default.deepStrictEqual((0, graphMessages_1.parseWebviewMessage)({ type: 'select', sha }), { type: 'select', sha });
    node_assert_1.default.deepStrictEqual((0, graphMessages_1.parseWebviewMessage)({ type: 'goto', sha }), { type: 'goto', sha });
    node_assert_1.default.deepStrictEqual((0, graphMessages_1.parseWebviewMessage)({ type: 'banner', action: 'skip' }), { type: 'banner', action: 'skip' });
    node_assert_1.default.deepStrictEqual((0, graphMessages_1.parseWebviewMessage)({ type: 'openDiff', sha, file: 'dir/a b é.txt' }), { type: 'openDiff', sha, file: 'dir/a b é.txt' });
    node_assert_1.default.deepStrictEqual((0, graphMessages_1.parseWebviewMessage)({ type: 'openDiff', sha, file: '-dash.txt' }), { type: 'openDiff', sha, file: '-dash.txt' });
    const rejected = [
        null, 'ready', 42, [], {}, { type: 'nope' },
        { type: 'select', sha: '--upload-pack=x' }, { type: 'select' }, { type: 'goto', sha: 'HEAD' },
        { type: 'openDiff', sha, file: '' }, { type: 'openDiff', sha, file: 'a\0b' }, { type: 'openDiff', sha, file: 'x'.repeat(5000) },
        { type: 'openDiff', sha: 'zz', file: 'a.txt' }, { type: 'banner', action: 'nuke' },
    ];
    for (const raw of rejected)
        node_assert_1.default.strictEqual((0, graphMessages_1.parseWebviewMessage)(raw), undefined, JSON.stringify(raw));
});
(0, node_test_1.default)('classifyWorkspace: no folder, remote, untrusted, otherwise available', () => {
    node_assert_1.default.strictEqual((0, graphMessages_1.classifyWorkspace)({ folderScheme: undefined, trusted: true }), 'no-folder');
    node_assert_1.default.strictEqual((0, graphMessages_1.classifyWorkspace)({ folderScheme: 'vscode-remote', trusted: true }), 'remote');
    node_assert_1.default.strictEqual((0, graphMessages_1.classifyWorkspace)({ folderScheme: 'file', trusted: false }), 'untrusted');
    node_assert_1.default.strictEqual((0, graphMessages_1.classifyWorkspace)({ folderScheme: 'file', trusted: true }), undefined);
});
(0, node_test_1.default)('unavailableText has a sentence for every reason', () => {
    for (const reason of ['no-folder', 'remote', 'untrusted', 'not-a-repo', 'no-git']) {
        node_assert_1.default.ok((0, graphMessages_1.unavailableText)(reason).length > 10, reason);
    }
});
//# sourceMappingURL=graphMessages.test.js.map
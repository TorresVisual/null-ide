'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = require("node:test");
const musicHtml_1 = require("../ui/musicHtml");
(0, node_test_1.test)('the shell sets a strict CSP, links the bundle and carries no inline script or style', () => {
    const html = (0, musicHtml_1.getMusicWebviewHtml)('test-nonce', 'vscode-webview-resource:', 'vscode:music.js', 'vscode:music.css');
    node_assert_1.default.ok(html.includes("script-src 'nonce-test-nonce'"));
    node_assert_1.default.ok(html.includes('<script nonce="test-nonce" src="vscode:music.js"></script>'));
    node_assert_1.default.ok(html.includes('<link rel="stylesheet" href="vscode:music.css">'));
    node_assert_1.default.ok(html.includes('id="app"'));
    node_assert_1.default.ok(!html.includes("'unsafe-inline'"));
    node_assert_1.default.ok(!html.includes('<style'));
    node_assert_1.default.ok(!/<script(?![^>]*\bsrc=)/.test(html), 'no inline <script>');
    node_assert_1.default.ok(html.split('\n').length < 40, 'the shell stays tiny');
});
(0, node_test_1.test)('the compiled bundle keeps the engine audio protocol and the AbortError filter', () => {
    const bundle = node_path_1.default.join(__dirname, '..', '..', 'lib', 'music.js');
    node_assert_1.default.ok((0, node_fs_1.existsSync)(bundle), 'run `npm run compile` first');
    const js = (0, node_fs_1.readFileSync)(bundle, 'utf8');
    for (const message of ['localLoad', 'localPause', 'localResume', 'localSeek', 'localVolume', 'localAudioPlayStarted', 'localAudioEnded']) {
        node_assert_1.default.ok(js.includes(`'${message}'`), `bundle handles ${message}`);
    }
    node_assert_1.default.ok(js.includes("err.name === 'AbortError'"), 'an interrupted play() must not count as a failure');
});
//# sourceMappingURL=musicHtml.test.js.map
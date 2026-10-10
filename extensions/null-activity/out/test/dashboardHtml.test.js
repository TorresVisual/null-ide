'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const dashboardHtml_1 = require("../dashboardHtml");
const html = (0, dashboardHtml_1.getDashboardHtml)('NONCE123', 'vscode-resource:', 'dash.js', 'dash.css');
(0, node_test_1.test)('the CSP denies everything by default and allows only the nonce\'d script and the extension stylesheet', () => {
    node_assert_1.default.match(html, /default-src 'none'/);
    node_assert_1.default.match(html, /script-src 'nonce-NONCE123'/);
    node_assert_1.default.match(html, /style-src vscode-resource:/);
    node_assert_1.default.ok(!html.includes('unsafe-inline'));
    node_assert_1.default.ok(!html.includes('unsafe-eval'));
    node_assert_1.default.ok(!/https?:\/\//.test(html), 'no remote resources');
});
(0, node_test_1.test)('the page loads the nonce\'d script and the stylesheet and nothing inline', () => {
    node_assert_1.default.match(html, /<script nonce="NONCE123" src="dash\.js"><\/script>/);
    node_assert_1.default.match(html, /<link rel="stylesheet" href="dash\.css">/);
    node_assert_1.default.match(html, /<div id="app"><\/div>/);
    node_assert_1.default.strictEqual((html.match(/<script/g) ?? []).length, 1);
});
//# sourceMappingURL=dashboardHtml.test.js.map
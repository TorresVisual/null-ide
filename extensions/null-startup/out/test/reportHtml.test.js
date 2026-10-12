'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const reportHtml_1 = require("../reportHtml");
(0, node_test_1.test)('the shell sets a nonce-only script CSP and loads the bundle', () => {
    const html = (0, reportHtml_1.getReportHtml)('N0NC3', 'vscode-resource:', 'script.js', 'style.css');
    node_assert_1.default.match(html, /script-src 'nonce-N0NC3'/);
    node_assert_1.default.match(html, /default-src 'none'/);
    node_assert_1.default.match(html, /<script nonce="N0NC3" src="script.js">/);
    node_assert_1.default.match(html, /href="style.css"/);
    node_assert_1.default.doesNotMatch(html, /unsafe-inline/);
});
//# sourceMappingURL=reportHtml.test.js.map
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const accountsClient_1 = require("./accountsClient");
const accountsHtml_1 = require("./accountsHtml");
(0, node_test_1.test)('the CSP is nonce-only and the same nonce guards the style and script tags', () => {
    const html = (0, accountsHtml_1.buildHtml)('abc123');
    node_assert_1.default.match(html, /Content-Security-Policy[^>]*default-src 'none'/);
    node_assert_1.default.match(html, /style-src 'nonce-abc123'/);
    node_assert_1.default.match(html, /script-src 'nonce-abc123'/);
    node_assert_1.default.match(html, /<script nonce="abc123">/);
    node_assert_1.default.match(html, /<style nonce="abc123">/);
    node_assert_1.default.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
});
(0, node_test_1.test)('the page has the add button the client script wires up, and embeds the client script', () => {
    const html = (0, accountsHtml_1.buildHtml)('n');
    node_assert_1.default.match(html, /id="add-btn"/);
    node_assert_1.default.match(html, /id="list"/);
    node_assert_1.default.ok(html.includes(accountsClient_1.CLIENT_SCRIPT));
});
(0, node_test_1.test)('account and folder text only ever reaches the DOM as text', () => {
    node_assert_1.default.doesNotMatch(accountsClient_1.CLIENT_SCRIPT, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    node_assert_1.default.match(accountsClient_1.CLIENT_SCRIPT, /textContent/);
});
(0, node_test_1.test)('the client script can ask the host to re-authenticate an account', () => {
    node_assert_1.default.match(accountsClient_1.CLIENT_SCRIPT, /type: 'reauth'/);
});
//# sourceMappingURL=accountsHtml.test.js.map
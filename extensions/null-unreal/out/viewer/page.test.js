"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const page_1 = require("./page");
(0, node_test_1.test)('pageFor maps every export kind to a page', () => {
    node_assert_1.strict.equal((0, page_1.pageFor)('texture'), 'texture');
    node_assert_1.strict.equal((0, page_1.pageFor)('material'), 'material');
    node_assert_1.strict.equal((0, page_1.pageFor)('skeletal-mesh'), 'mesh');
    node_assert_1.strict.equal((0, page_1.pageFor)('material-instance'), 'properties');
    node_assert_1.strict.equal((0, page_1.pageFor)('skeleton'), 'properties');
    node_assert_1.strict.equal((0, page_1.pageFor)('generic'), 'properties');
});
(0, node_test_1.test)('buildHtml pins the script to a nonce and never allows inline scripts', () => {
    const html = (0, page_1.buildHtml)({
        page: 'texture',
        nonce: 'abc',
        cspSource: 'https://x.vscode-cdn',
        scriptUri: 'https://x/texture.js',
        styleUri: 'https://x/viewer.css',
        title: 'T',
    });
    node_assert_1.strict.match(html, /script-src 'nonce-abc'/);
    node_assert_1.strict.match(html, /<script nonce="abc" src="https:\/\/x\/texture\.js">/);
    const scriptSrc = /script-src ([^;]*)/.exec(html)?.[1] ?? '';
    node_assert_1.strict.ok(!scriptSrc.includes('unsafe-inline'));
});
//# sourceMappingURL=page.test.js.map
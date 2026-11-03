"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = require("node:test");
const renderModel_1 = require("./renderModel");
// The fixture lives beside the package, next to the other hand-written exports.
const fixture = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, '..', '..', 'fixtures', 'material.json'), 'utf8'));
const data = fixture.data;
const exprs = data.expressions;
const m = (0, renderModel_1.buildRenderModel)(data);
(0, node_test_1.test)('expressionCount is the export count and nodes add the result node', () => {
    node_assert_1.strict.equal(m.expressionCount, exprs.length);
    node_assert_1.strict.equal(m.nodes.length, exprs.length + 1);
    node_assert_1.strict.equal(m.nodes.at(-1)?.id, renderModel_1.RESULT_ID);
});
(0, node_test_1.test)('link count is every connected input plus every connected output, missing ones included', () => {
    const inputLinks = exprs.reduce((n, e) => n + (e.inputs ?? []).filter((p) => p.link).length, 0);
    const outputLinks = data.outputs.filter((o) => o.link).length;
    node_assert_1.strict.equal(m.links.length, inputLinks + outputLinks);
});
(0, node_test_1.test)('an unreadable link becomes one missing link and a note, and never drops', () => {
    const missing = m.links.filter((l) => l.missing);
    node_assert_1.strict.equal(missing.length, 2);
    node_assert_1.strict.ok(missing.every((l) => l.from.node === renderModel_1.MISSING_NODE));
    node_assert_1.strict.ok(m.notes.includes('2 link(s) to unreadable expressions'));
});
(0, node_test_1.test)('a null-linked output creates no link', () => {
    const toResult = m.links.filter((l) => l.to.node === renderModel_1.RESULT_ID);
    node_assert_1.strict.equal(toResult.length, 2);
});
(0, node_test_1.test)('a node with three inputs and one output is 32 + 20 * 3 high', () => {
    const node = m.nodes.find((n) => n.inputs.length === 3);
    node_assert_1.strict.ok(node);
    node_assert_1.strict.equal(node.h, 32 + 20 * 3);
});
(0, node_test_1.test)('a reroute is shaped as a reroute', () => {
    node_assert_1.strict.equal(m.nodes.find((n) => n.label === 'Reroute')?.shape, 'reroute');
});
(0, node_test_1.test)('bounds contain every node', () => {
    for (const n of m.nodes) {
        node_assert_1.strict.ok(n.x >= m.bounds.x && n.x + n.w <= m.bounds.x + m.bounds.w);
        node_assert_1.strict.ok(n.y >= m.bounds.y && n.y + n.h <= m.bounds.y + m.bounds.h);
    }
});
(0, node_test_1.test)('an out-of-range link index is missing, not a crash', () => {
    const r = (0, renderModel_1.buildRenderModel)({ expressions: [{ class: 'MaterialExpressionAdd', inputs: [{ name: 'A', link: { from: 9, pin: '' } }], outputs: [] }], outputs: [] });
    node_assert_1.strict.equal(r.links.length, 1);
    node_assert_1.strict.equal(r.links[0].missing, true);
});
//# sourceMappingURL=renderModel.test.js.map
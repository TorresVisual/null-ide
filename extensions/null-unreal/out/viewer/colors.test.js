"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const colors_1 = require("./colors");
const FAMILIES = ['parameter', 'texture', 'math', 'constant', 'utility', 'function', 'other'];
(0, node_test_1.test)('every node family has a colour', () => {
    for (const f of FAMILIES)
        node_assert_1.strict.ok((0, colors_1.familyColor)(f).length > 0, f);
});
(0, node_test_1.test)('a float pin and a texture pin have different colours', () => {
    node_assert_1.strict.notEqual((0, colors_1.pinColor)(1), (0, colors_1.pinColor)(16));
});
(0, node_test_1.test)('an unknown pin type is the neutral grey', () => {
    node_assert_1.strict.equal((0, colors_1.pinColor)(null), colors_1.UNKNOWN_PIN);
    node_assert_1.strict.equal(colors_1.UNKNOWN_PIN, '#8a8a8a');
});
(0, node_test_1.test)('nodeFamily maps class names by pattern, texture before parameter', () => {
    node_assert_1.strict.equal((0, colors_1.nodeFamily)('MaterialExpressionTextureSampleParameter2D'), 'texture');
    node_assert_1.strict.equal((0, colors_1.nodeFamily)('MaterialExpressionScalarParameter'), 'parameter');
    node_assert_1.strict.equal((0, colors_1.nodeFamily)('MaterialExpressionMultiply'), 'math');
    node_assert_1.strict.equal((0, colors_1.nodeFamily)('MaterialExpressionConstant'), 'constant');
    node_assert_1.strict.equal((0, colors_1.nodeFamily)('MaterialExpressionSomethingNew'), 'other');
});
//# sourceMappingURL=colors.test.js.map
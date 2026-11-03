"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const channels_1 = require("./channels");
(0, node_test_1.test)('applyMask zeroes the off colour channels and keeps alpha', () => {
    const out = (0, channels_1.applyMask)(new Uint8ClampedArray([10, 20, 30, 40]), { r: true, g: false, b: true, a: true });
    node_assert_1.strict.deepEqual([...out], [10, 0, 30, 40]);
});
(0, node_test_1.test)('applyMask with alpha off forces full opacity', () => {
    const out = (0, channels_1.applyMask)(new Uint8ClampedArray([10, 20, 30, 40]), { r: true, g: true, b: true, a: false });
    node_assert_1.strict.deepEqual([...out], [10, 20, 30, 255]);
});
(0, node_test_1.test)('applyMask with only alpha on shows alpha as grey', () => {
    const out = (0, channels_1.applyMask)(new Uint8ClampedArray([10, 20, 30, 40]), { r: false, g: false, b: false, a: true });
    node_assert_1.strict.deepEqual([...out], [40, 40, 40, 255]);
});
(0, node_test_1.test)('isToneMapped is true for HDR or float compression only', () => {
    node_assert_1.strict.equal((0, channels_1.isToneMapped)({ compression: 'HDR' }), true);
    node_assert_1.strict.equal((0, channels_1.isToneMapped)({ compression: 'TC_HDR_Compressed' }), true);
    node_assert_1.strict.equal((0, channels_1.isToneMapped)({ compression: 'DEFAULT' }), false);
    node_assert_1.strict.equal((0, channels_1.isToneMapped)({ compression: { unreadable: 'x' } }), false);
});
//# sourceMappingURL=channels.test.js.map
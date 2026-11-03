"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const value_1 = require("./value");
(0, node_test_1.test)('describe shows unreadable values as not available, with the reason', () => {
    node_assert_1.strict.equal((0, value_1.describe)({ unreadable: 'no mip count' }), 'not available: no mip count');
});
(0, node_test_1.test)('describe shows missing values as a dash and numbers as text', () => {
    node_assert_1.strict.equal((0, value_1.describe)(undefined), '—');
    node_assert_1.strict.equal((0, value_1.describe)(null), '—');
    node_assert_1.strict.equal((0, value_1.describe)(1024), '1024');
});
(0, node_test_1.test)('describe counts arrays', () => {
    node_assert_1.strict.equal((0, value_1.describe)([1, 2, 3]), '3 items');
});
//# sourceMappingURL=value.test.js.map
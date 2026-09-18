"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
function trimVersionTag(tag) {
    return String(tag || '').replace(/^v/i, '');
}
function compareVersionTags(left, right) {
    if (left === right)
        return 0;
    if (right === 'local')
        return 1;
    if (left === 'local')
        return -1;
    const leftParts = trimVersionTag(left).split(/[.-]/).map(p => Number.parseInt(p, 10));
    const rightParts = trimVersionTag(right).split(/[.-]/).map(p => Number.parseInt(p, 10));
    if (leftParts.some(Number.isNaN) || rightParts.some(Number.isNaN)) {
        return String(left) === String(right) ? 0 : -1;
    }
    const count = Math.max(leftParts.length, rightParts.length);
    for (let i = 0; i < count; i++) {
        const diff = (leftParts[i] || 0) - (rightParts[i] || 0);
        if (diff !== 0)
            return diff;
    }
    return 0;
}
(0, node_test_1.default)('compareVersionTags handles local vs version tags correctly', () => {
    node_assert_1.default.strictEqual(compareVersionTags('v1.2.3', 'local'), 1);
    node_assert_1.default.strictEqual(compareVersionTags('local', 'v1.2.3'), -1);
    node_assert_1.default.strictEqual(compareVersionTags('local', 'local'), 0);
});
(0, node_test_1.default)('compareVersionTags compares semantic versions correctly', () => {
    node_assert_1.default.ok(compareVersionTags('v1.2.4', 'v1.2.3') > 0);
    node_assert_1.default.strictEqual(compareVersionTags('1.2.3', 'v1.2.3'), 0);
    node_assert_1.default.ok(compareVersionTags('1.2.0', '1.2.3') < 0);
    node_assert_1.default.ok(compareVersionTags('v2.0.0', 'v1.9.9') > 0);
});
//# sourceMappingURL=versionComparison.test.js.map
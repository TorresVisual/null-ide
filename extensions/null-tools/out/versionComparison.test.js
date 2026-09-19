"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const versionComparison_1 = require("./versionComparison");
(0, node_test_1.default)('compareVersionTags handles local vs version tags correctly', () => {
    node_assert_1.default.strictEqual((0, versionComparison_1.compareVersionTags)('v1.2.3', 'local'), 1);
    node_assert_1.default.strictEqual((0, versionComparison_1.compareVersionTags)('local', 'v1.2.3'), -1);
    node_assert_1.default.strictEqual((0, versionComparison_1.compareVersionTags)('local', 'local'), 0);
});
(0, node_test_1.default)('compareVersionTags compares semantic versions correctly', () => {
    node_assert_1.default.ok((0, versionComparison_1.compareVersionTags)('v1.2.4', 'v1.2.3') > 0);
    node_assert_1.default.strictEqual((0, versionComparison_1.compareVersionTags)('1.2.3', 'v1.2.3'), 0);
    node_assert_1.default.ok((0, versionComparison_1.compareVersionTags)('1.2.0', '1.2.3') < 0);
    node_assert_1.default.ok((0, versionComparison_1.compareVersionTags)('v2.0.0', 'v1.9.9') > 0);
});
(0, node_test_1.default)('compareVersionTags handles prerelease suffixes correctly', () => {
    node_assert_1.default.ok((0, versionComparison_1.compareVersionTags)('v1.2.0', 'v1.2.0-beta') > 0);
    node_assert_1.default.ok((0, versionComparison_1.compareVersionTags)('v1.2.0-beta', 'v1.2.0') < 0);
    node_assert_1.default.strictEqual((0, versionComparison_1.compareVersionTags)('v1.2.0-beta', 'v1.2.0-beta'), 0);
    node_assert_1.default.ok((0, versionComparison_1.compareVersionTags)('v1.2.0-alpha', 'v1.2.0-beta') < 0);
});
//# sourceMappingURL=versionComparison.test.js.map
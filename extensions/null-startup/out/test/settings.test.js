'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const settings_1 = require("../settings");
(0, node_test_1.test)('normalizeRetention clamps to 1..200 and defaults to 20', () => {
    node_assert_1.default.strictEqual((0, settings_1.normalizeRetention)(undefined), 20);
    node_assert_1.default.strictEqual((0, settings_1.normalizeRetention)('5'), 20);
    node_assert_1.default.strictEqual((0, settings_1.normalizeRetention)(0), 1);
    node_assert_1.default.strictEqual((0, settings_1.normalizeRetention)(5.4), 5);
    node_assert_1.default.strictEqual((0, settings_1.normalizeRetention)(9999), 200);
});
(0, node_test_1.test)('normalizeSlowMs accepts non-negative numbers, defaults to 100', () => {
    node_assert_1.default.strictEqual((0, settings_1.normalizeSlowMs)(undefined), 100);
    node_assert_1.default.strictEqual((0, settings_1.normalizeSlowMs)(-1), 100);
    node_assert_1.default.strictEqual((0, settings_1.normalizeSlowMs)(Number.NaN), 100);
    node_assert_1.default.strictEqual((0, settings_1.normalizeSlowMs)(0), 0);
    node_assert_1.default.strictEqual((0, settings_1.normalizeSlowMs)(250), 250);
});
//# sourceMappingURL=settings.test.js.map
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const buttonState_1 = require("./buttonState");
(0, node_test_1.test)('formatDuration', () => {
    node_assert_1.default.strictEqual((0, buttonState_1.formatDuration)(400), '400ms');
    node_assert_1.default.strictEqual((0, buttonState_1.formatDuration)(12_400), '12s');
    node_assert_1.default.strictEqual((0, buttonState_1.formatDuration)(125_000), '2m 5s');
});
(0, node_test_1.test)('statusText: idle keeps the configured icon, running spins, results show icon and duration', () => {
    node_assert_1.default.strictEqual((0, buttonState_1.statusText)('Build', 'tools', undefined), '$(tools) Build');
    node_assert_1.default.strictEqual((0, buttonState_1.statusText)('Build', undefined, undefined), 'Build');
    node_assert_1.default.strictEqual((0, buttonState_1.statusText)('Build', 'tools', { kind: 'running' }), '$(sync~spin) Build');
    node_assert_1.default.strictEqual((0, buttonState_1.statusText)('Build', 'tools', { kind: 'passed', exitCode: 0, durationMs: 12_000 }), '$(check) Build 12s');
    node_assert_1.default.strictEqual((0, buttonState_1.statusText)('Test', undefined, { kind: 'failed', exitCode: 1, durationMs: 3_000 }), '$(error) Test 3s');
});
(0, node_test_1.test)('statusTooltip appends the state to the configured tooltip and carries the exit code', () => {
    node_assert_1.default.strictEqual((0, buttonState_1.statusTooltip)('Run tests', undefined), 'Run tests');
    node_assert_1.default.strictEqual((0, buttonState_1.statusTooltip)(undefined, { kind: 'running' }), 'Running...');
    const failed = (0, buttonState_1.statusTooltip)('Run tests', { kind: 'failed', exitCode: 2, durationMs: 1_000 });
    node_assert_1.default.ok(failed?.startsWith('Run tests\n') && failed.includes('exit code 2'));
});
//# sourceMappingURL=buttonState.test.js.map
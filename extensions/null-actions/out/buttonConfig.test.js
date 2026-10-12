'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const buttonConfig_1 = require("./buttonConfig");
(0, node_test_1.test)('parses a minimal valid button, applying defaults', () => {
    const { buttons, errors } = (0, buttonConfig_1.parseButtonConfigs)([
        { id: 'build', label: 'Build', command: 'npm run build' },
    ]);
    node_assert_1.default.deepStrictEqual(errors, []);
    node_assert_1.default.strictEqual(buttons.length, 1);
    node_assert_1.default.deepStrictEqual(buttons[0], {
        id: 'build',
        label: 'Build',
        icon: undefined,
        type: 'terminal',
        command: 'npm run build',
        args: undefined,
        color: undefined,
        background: 'none',
        tooltip: undefined,
        cwd: undefined,
        saveAll: false,
        focus: true,
        onBusy: 'ask',
        priority: 0,
    });
});
(0, node_test_1.test)('undefined setting (never configured) yields empty buttons and no errors', () => {
    const { buttons, errors } = (0, buttonConfig_1.parseButtonConfigs)(undefined);
    node_assert_1.default.deepStrictEqual(buttons, []);
    node_assert_1.default.deepStrictEqual(errors, []);
});
(0, node_test_1.test)('non-array value is rejected with a single error', () => {
    const { buttons, errors } = (0, buttonConfig_1.parseButtonConfigs)({ not: 'an array' });
    node_assert_1.default.deepStrictEqual(buttons, []);
    node_assert_1.default.strictEqual(errors.length, 1);
});
(0, node_test_1.test)('entry missing required fields is skipped with an error, valid entries still parse', () => {
    const { buttons, errors } = (0, buttonConfig_1.parseButtonConfigs)([
        { id: 'no-label', command: 'echo hi' },
        { id: 'no-command', label: 'No Command' },
        { label: 'No Id', command: 'echo hi' },
        { id: 'ok', label: 'OK', command: 'echo ok' },
    ]);
    node_assert_1.default.strictEqual(buttons.length, 1);
    node_assert_1.default.strictEqual(buttons[0].id, 'ok');
    node_assert_1.default.strictEqual(errors.length, 3);
});
(0, node_test_1.test)('duplicate ids: first wins, second is rejected as an error', () => {
    const { buttons, errors } = (0, buttonConfig_1.parseButtonConfigs)([
        { id: 'dup', label: 'First', command: 'echo 1' },
        { id: 'dup', label: 'Second', command: 'echo 2' },
    ]);
    node_assert_1.default.strictEqual(buttons.length, 1);
    node_assert_1.default.strictEqual(buttons[0].label, 'First');
    node_assert_1.default.strictEqual(errors.length, 1);
});
(0, node_test_1.test)('invalid enum values fall back to their defaults instead of erroring', () => {
    const { buttons, errors } = (0, buttonConfig_1.parseButtonConfigs)([
        { id: 'x', label: 'X', command: 'echo x', type: 'bogus', background: 'purple' },
    ]);
    node_assert_1.default.deepStrictEqual(errors, []);
    node_assert_1.default.strictEqual(buttons[0].type, 'terminal');
    node_assert_1.default.strictEqual(buttons[0].background, 'none');
});
(0, node_test_1.test)('focus defaults to true when omitted, but an explicit false is honored', () => {
    const { buttons } = (0, buttonConfig_1.parseButtonConfigs)([
        { id: 'a', label: 'A', command: 'echo a' },
        { id: 'b', label: 'B', command: 'echo b', focus: false },
    ]);
    node_assert_1.default.strictEqual(buttons[0].focus, true);
    node_assert_1.default.strictEqual(buttons[1].focus, false);
});
(0, node_test_1.test)('onBusy accepts the known modes and falls back to ask for anything else', () => {
    const { buttons } = (0, buttonConfig_1.parseButtonConfigs)([
        { id: 'a', label: 'A', command: 'x', onBusy: 'restart' },
        { id: 'b', label: 'B', command: 'x', onBusy: 'bogus' },
    ]);
    node_assert_1.default.strictEqual(buttons[0].onBusy, 'restart');
    node_assert_1.default.strictEqual(buttons[1].onBusy, 'ask');
});
//# sourceMappingURL=buttonConfig.test.js.map
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
        focus: false,
        alignment: 'left',
        priority: 0,
        when: undefined,
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
        { id: 'x', label: 'X', command: 'echo x', type: 'bogus', alignment: 'sideways', background: 'purple' },
    ]);
    node_assert_1.default.deepStrictEqual(errors, []);
    node_assert_1.default.strictEqual(buttons[0].type, 'terminal');
    node_assert_1.default.strictEqual(buttons[0].alignment, 'left');
    node_assert_1.default.strictEqual(buttons[0].background, 'none');
});
(0, node_test_1.test)('parses a full when clause, filtering non-string array entries', () => {
    const { buttons } = (0, buttonConfig_1.parseButtonConfigs)([
        {
            id: 'x', label: 'X', command: 'echo x',
            when: { languages: ['cpp', 42, 'c'], filesExist: ['CMakeLists.txt'], folder: 'backend' },
        },
    ]);
    node_assert_1.default.deepStrictEqual(buttons[0].when, {
        languages: ['cpp', 'c'],
        filesExist: ['CMakeLists.txt'],
        folder: 'backend',
    });
});
//# sourceMappingURL=buttonConfig.test.js.map
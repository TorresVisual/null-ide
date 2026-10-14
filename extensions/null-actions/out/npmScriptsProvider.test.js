'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const npmScriptsProvider_1 = require("./npmScriptsProvider");
(0, node_test_1.test)('parses scripts into buttons', () => {
    const content = JSON.stringify({ scripts: { build: 'tsc', test: 'node --test out' } });
    const buttons = (0, npmScriptsProvider_1.parseNpmScripts)(content);
    node_assert_1.default.deepStrictEqual(buttons, [
        { id: 'npm-build', label: 'npm run build', command: 'npm run build', problemMatcher: '$tsc' },
        { id: 'npm-test', label: 'npm run test', command: 'npm run test' },
    ]);
});
(0, node_test_1.test)('package.json with no scripts field yields no buttons', () => {
    node_assert_1.default.deepStrictEqual((0, npmScriptsProvider_1.parseNpmScripts)(JSON.stringify({ name: 'x' })), []);
});
(0, node_test_1.test)('malformed JSON yields no buttons rather than throwing', () => {
    node_assert_1.default.deepStrictEqual((0, npmScriptsProvider_1.parseNpmScripts)('{ not valid json'), []);
});
(0, node_test_1.test)('non-string script values are ignored', () => {
    const content = JSON.stringify({ scripts: { build: 'tsc', weird: 123 } });
    const buttons = (0, npmScriptsProvider_1.parseNpmScripts)(content);
    node_assert_1.default.strictEqual(buttons.length, 1);
    node_assert_1.default.strictEqual(buttons[0].id, 'npm-build');
});
(0, node_test_1.test)('toActionButtonConfig fills in full ActionButtonConfig defaults', () => {
    const config = (0, npmScriptsProvider_1.toActionButtonConfig)({ id: 'npm-build', label: 'npm run build', command: 'npm run build' }, 10);
    node_assert_1.default.strictEqual(config.id, 'npm-build');
    node_assert_1.default.strictEqual(config.label, 'npm run build');
    node_assert_1.default.strictEqual(config.command, 'npm run build');
    node_assert_1.default.strictEqual(config.type, 'terminal');
    node_assert_1.default.strictEqual(config.priority, 10);
    node_assert_1.default.strictEqual(config.background, 'none');
    node_assert_1.default.strictEqual(config.saveAll, false);
    node_assert_1.default.strictEqual(config.focus, true);
});
(0, node_test_1.test)('tsc and eslint scripts get a matching problem matcher, others none', () => {
    const content = JSON.stringify({ scripts: { build: 'tsc -p .', lint: 'eslint src', test: 'node --test' } });
    const [build, lint, test] = (0, npmScriptsProvider_1.parseNpmScripts)(content);
    node_assert_1.default.strictEqual(build.problemMatcher, '$tsc');
    node_assert_1.default.strictEqual(lint.problemMatcher, '$eslint-stylish');
    node_assert_1.default.strictEqual(test.problemMatcher, undefined);
    node_assert_1.default.strictEqual((0, npmScriptsProvider_1.toActionButtonConfig)(build, 0).problemMatcher, '$tsc');
});
//# sourceMappingURL=npmScriptsProvider.test.js.map
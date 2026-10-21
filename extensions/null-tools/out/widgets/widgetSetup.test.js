"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const widgetSetup_1 = require("./widgetSetup");
(0, node_test_1.default)('mergeRepos replaces only the chosen account\'s entries and keeps order stable', () => {
    const existing = [{ repo: 'a/b', account: 'x' }, { repo: 'k/l', account: 'y' }];
    node_assert_1.default.deepStrictEqual((0, widgetSetup_1.mergeRepos)(existing, 'x', ['c/d', 'a/b']), [{ repo: 'k/l', account: 'y' }, { repo: 'c/d', account: 'x' }, { repo: 'a/b', account: 'x' }]);
    node_assert_1.default.deepStrictEqual((0, widgetSetup_1.mergeRepos)(existing, 'x', []), [{ repo: 'k/l', account: 'y' }]);
    node_assert_1.default.deepStrictEqual((0, widgetSetup_1.mergeRepos)(existing, 'x', ['bad repo', '../x', 'ok/ok']), [{ repo: 'k/l', account: 'y' }, { repo: 'ok/ok', account: 'x' }]);
});
(0, node_test_1.default)('repoChoices reads full_name and ignores everything unusable', () => {
    node_assert_1.default.deepStrictEqual((0, widgetSetup_1.repoChoices)([{ full_name: 'o/r' }, { full_name: 'x y/z' }, {}, null, 'nope', { full_name: 'o/r2' }]), ['o/r', 'o/r2']);
    node_assert_1.default.deepStrictEqual((0, widgetSetup_1.repoChoices)({}), []);
});
(0, node_test_1.default)('localPathsFrom maps a remote repo to the first checkout, case-insensitively', () => {
    const m = (0, widgetSetup_1.localPathsFrom)(new Map([['D:\\one', 'Owner/Repo'], ['D:\\two', 'owner/repo'], ['D:\\three', null]]));
    node_assert_1.default.deepStrictEqual([...m], [['owner/repo', 'D:\\one']]);
});
(0, node_test_1.default)('widgetEnv drops what would make a later null.exe run as plain Node, and nothing else', () => {
    const env = (0, widgetSetup_1.widgetEnv)({ PATH: 'p', ELECTRON_RUN_AS_NODE: '1', VSCODE_PID: '5', vscode_ipc_hook: 'x', Keep: 'k' });
    node_assert_1.default.deepStrictEqual(env, { PATH: 'p', Keep: 'k' });
});
//# sourceMappingURL=widgetSetup.test.js.map
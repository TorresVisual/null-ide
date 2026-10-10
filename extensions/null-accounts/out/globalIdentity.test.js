'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const globalIdentity_1 = require("./globalIdentity");
const account = {
    id: 'a1', provider: 'gitlab', host: 'gitlab.com', username: 'me', email: 'me@example.com', authMethod: 'ssh',
};
function fakeGit(globals, failOn) {
    const calls = [];
    const git = async (_cwd, args) => {
        calls.push(args);
        if (args[2] === '--get') {
            return { code: 0, stdout: `${globals[args[3]] ?? ''}\n`, stderr: '' };
        }
        if (args[2] === failOn) {
            return { code: 1, stdout: '', stderr: 'permission denied' };
        }
        globals[args[2]] = args[3];
        return { code: 0, stdout: '', stderr: '' };
    };
    return { git, calls };
}
(0, node_test_1.test)('sets name and email globally and says what it replaced', async () => {
    const globals = { 'user.name': 'old', 'user.email': 'old@example.com' };
    const { git } = fakeGit(globals);
    node_assert_1.default.strictEqual(await (0, globalIdentity_1.applyGlobalIdentity)(git, account, '/tmp'), 'Global git identity is now me <me@example.com> (was old <old@example.com>).');
    node_assert_1.default.deepStrictEqual(globals, { 'user.name': 'me', 'user.email': 'me@example.com' });
});
(0, node_test_1.test)('an unset global identity has nothing to report as replaced', async () => {
    const { git } = fakeGit({});
    node_assert_1.default.strictEqual(await (0, globalIdentity_1.applyGlobalIdentity)(git, account, '/tmp'), 'Global git identity is now me <me@example.com>.');
});
(0, node_test_1.test)('a failing git config surfaces its error', async () => {
    const { git } = fakeGit({}, 'user.email');
    await node_assert_1.default.rejects((0, globalIdentity_1.applyGlobalIdentity)(git, account, '/tmp'), /user\.email failed: permission denied/);
});
//# sourceMappingURL=globalIdentity.test.js.map
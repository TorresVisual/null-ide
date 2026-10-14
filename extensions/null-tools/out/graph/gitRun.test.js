'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const gitRun_1 = require("./gitRun");
(0, node_test_1.default)('runGit returns stdout and rejects with git\'s own message', async () => {
    const git = (0, gitRun_1.makeRunGit)(process.cwd());
    node_assert_1.default.match(await git(['--version']), /^git version/);
    await node_assert_1.default.rejects(git(['rev-parse', '--verify', 'definitely-not-a-ref']), (err) => err instanceof gitRun_1.GitError && err.message.length > 0);
});
(0, node_test_1.default)('runGit sets GIT_EDITOR=true so --continue never opens an editor', async () => {
    node_assert_1.default.strictEqual((await (0, gitRun_1.makeRunGit)(process.cwd())(['var', 'GIT_EDITOR'])).trim(), 'true');
});
(0, node_test_1.default)('BusyFlag refuses a second action and whenIdle waits for the first', async () => {
    const busy = new gitRun_1.BusyFlag();
    let release;
    const first = busy.run(() => new Promise((resolve) => { release = () => resolve('done'); }));
    node_assert_1.default.strictEqual(busy.busy, true);
    node_assert_1.default.deepStrictEqual(await busy.run(async () => 'second'), { ran: false });
    let idle = false;
    const waiting = busy.whenIdle().then(() => { idle = true; });
    await Promise.resolve();
    node_assert_1.default.strictEqual(idle, false);
    release();
    node_assert_1.default.deepStrictEqual(await first, { ran: true, value: 'done' });
    await waiting;
    node_assert_1.default.strictEqual(idle, true);
    node_assert_1.default.strictEqual(busy.busy, false);
});
(0, node_test_1.default)('BusyFlag clears even when the action throws', async () => {
    const busy = new gitRun_1.BusyFlag();
    await node_assert_1.default.rejects(busy.run(async () => { throw new Error('boom'); }), /boom/);
    node_assert_1.default.strictEqual(busy.busy, false);
});
//# sourceMappingURL=gitRun.test.js.map
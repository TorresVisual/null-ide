'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const gitRun_1 = require("../graph/gitRun");
const pullCheckout_1 = require("./pullCheckout");
/** A same-repo PR checks out as its head branch name; a fork PR as pr/<n>. */
const same = (n, headRef) => ({ number: n, headRef, fork: false });
const fork = (n) => ({ number: n, headRef: 'main', fork: true });
function git(dir, ...args) {
    return (0, node_child_process_1.execFileSync)('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}
function identity(dir) {
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'config', 'core.autocrlf', 'false');
}
function commit(dir, file, content) {
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, file), content);
    git(dir, 'add', '--', file);
    git(dir, 'commit', '-q', '-m', `edit ${file}`);
    return git(dir, 'rev-parse', 'HEAD');
}
/** A bare `origin`, an `author` clone that publishes `refs/pull/<n>/head` the way GitHub does, and the `reader` that checks out. */
function setup() {
    const root = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'pull-checkout-'));
    const origin = node_path_1.default.join(root, 'origin.git');
    const author = node_path_1.default.join(root, 'author');
    const reader = node_path_1.default.join(root, 'reader');
    git(root, 'init', '-q', '--bare', '--initial-branch=main', origin);
    git(root, 'init', '-q', '--initial-branch=main', author);
    identity(author);
    git(author, 'remote', 'add', 'origin', origin);
    commit(author, 'a.txt', '1');
    git(author, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
    git(root, 'clone', '-q', origin, reader);
    identity(reader);
    return { author, reader, publish: (n) => git(author, 'push', '-q', '--force', 'origin', `HEAD:refs/pull/${n}/head`) };
}
(0, node_test_1.default)('checkoutPull: a same-repo PR gets its head branch, a fork PR gets pr/<n>', async () => {
    const { author, reader, publish } = setup();
    commit(author, 'b.txt', 'b');
    publish(7);
    publish(8);
    const run = (0, gitRun_1.makeRunGit)(reader);
    node_assert_1.default.deepStrictEqual(await (0, pullCheckout_1.checkoutPull)(run, same(7, 'feat/x')), { ok: true, branch: 'feat/x' });
    node_assert_1.default.strictEqual(git(reader, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feat/x');
    node_assert_1.default.deepStrictEqual(await (0, pullCheckout_1.checkoutPull)(run, fork(8)), { ok: true, branch: 'pr/8' });
    node_assert_1.default.strictEqual(git(reader, 'rev-parse', '--abbrev-ref', 'HEAD'), 'pr/8');
});
(0, node_test_1.default)('checkoutPull creates the branch at the PR head, then fast-forwards it when the PR gains commits', async () => {
    const { author, reader, publish } = setup();
    const first = commit(author, 'b.txt', 'b');
    publish(7);
    const run = (0, gitRun_1.makeRunGit)(reader);
    node_assert_1.default.strictEqual((await (0, pullCheckout_1.checkoutPull)(run, fork(7))).ok, true);
    node_assert_1.default.strictEqual(git(reader, 'rev-parse', 'HEAD'), first);
    const second = commit(author, 'b.txt', 'bb');
    publish(7);
    node_assert_1.default.strictEqual((await (0, pullCheckout_1.checkoutPull)(run, fork(7))).ok, true);
    node_assert_1.default.strictEqual(git(reader, 'rev-parse', 'HEAD'), second);
});
(0, node_test_1.default)('checkoutPull: a diverged local branch is left alone', async () => {
    const { author, reader, publish } = setup();
    commit(author, 'b.txt', 'b');
    publish(7);
    const run = (0, gitRun_1.makeRunGit)(reader);
    await (0, pullCheckout_1.checkoutPull)(run, fork(7));
    const mine = commit(reader, 'mine.txt', 'local work');
    commit(author, 'b.txt', 'bb');
    publish(7);
    const result = await (0, pullCheckout_1.checkoutPull)(run, fork(7));
    node_assert_1.default.strictEqual(result.ok, false);
    node_assert_1.default.strictEqual(git(reader, 'rev-parse', 'HEAD'), mine);
});
(0, node_test_1.default)('checkoutPull: a dirty tree that conflicts is refused with git\'s message and no branch is created', async () => {
    const { author, reader, publish } = setup();
    commit(author, 'a.txt', 'changed upstream');
    publish(7);
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(reader, 'a.txt'), 'my uncommitted edit');
    const result = await (0, pullCheckout_1.checkoutPull)((0, gitRun_1.makeRunGit)(reader), fork(7));
    node_assert_1.default.strictEqual(result.ok, false);
    node_assert_1.default.ok(!result.ok && result.message.length > 0);
    node_assert_1.default.strictEqual(git(reader, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
    node_assert_1.default.strictEqual(git(reader, 'branch', '--list', 'pr/7'), '');
});
(0, node_test_1.default)('checkoutPull: a PR that does not exist is a failure with git\'s message', async () => {
    const { reader } = setup();
    const result = await (0, pullCheckout_1.checkoutPull)((0, gitRun_1.makeRunGit)(reader), fork(99));
    node_assert_1.default.strictEqual(result.ok, false);
    node_assert_1.default.ok(!result.ok && result.message.length > 0);
});
//# sourceMappingURL=pullCheckout.test.js.map
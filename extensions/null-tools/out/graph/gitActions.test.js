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
const gitActions_1 = require("./gitActions");
const gitGraphService_1 = require("./gitGraphService");
const gitRun_1 = require("./gitRun");
function git(dir, ...args) {
    return (0, node_child_process_1.execFileSync)('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}
function initRepo() {
    const dir = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'graph-actions-'));
    git(dir, 'init', '-q', '--initial-branch=main');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'config', 'core.autocrlf', 'false');
    return dir;
}
function commit(dir, file, content, message) {
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, file), content);
    git(dir, 'add', '--', file);
    git(dir, 'commit', '-q', '-m', message);
    return git(dir, 'rev-parse', 'HEAD');
}
function tools(dir) {
    const run = (0, gitRun_1.makeRunGit)(dir);
    const service = new gitGraphService_1.GitGraphService(run, dir);
    return { run, inProgress: () => service.inProgress() };
}
function expectOk(result) {
    node_assert_1.default.ok(result.ok, result.ok ? '' : String(result.message));
    return result.value;
}
(0, node_test_1.default)('checkout: a branch, a detached sha, and a remote branch that becomes a tracking branch', async () => {
    const dir = initRepo();
    const first = commit(dir, 'a.txt', '1', 'one');
    commit(dir, 'a.txt', '2', 'two');
    git(dir, 'branch', 'dev', first);
    const { run } = tools(dir);
    expectOk(await (0, gitActions_1.checkout)(run, { kind: 'branch', name: 'dev' }));
    node_assert_1.default.strictEqual(git(dir, 'branch', '--show-current'), 'dev');
    expectOk(await (0, gitActions_1.checkout)(run, { kind: 'detach', sha: first }));
    node_assert_1.default.strictEqual(git(dir, 'branch', '--show-current'), '');
    node_assert_1.default.strictEqual(git(dir, 'rev-parse', 'HEAD'), first);
    const clone = node_path_1.default.join((0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'graph-clone-')), 'c');
    (0, node_child_process_1.execFileSync)('git', ['clone', '-q', dir, clone]);
    git(dir, 'switch', '-q', '-c', 'feat');
    commit(dir, 'f.txt', 'f', 'feat');
    git(clone, 'fetch', '-q', 'origin');
    expectOk(await (0, gitActions_1.checkout)((0, gitRun_1.makeRunGit)(clone), { kind: 'remote', name: 'origin/feat' }));
    node_assert_1.default.strictEqual(git(clone, 'branch', '--show-current'), 'feat');
});
(0, node_test_1.default)('checkout of a dirty tree is refused by git and the message comes back', async () => {
    const dir = initRepo();
    commit(dir, 'a.txt', 'base', 'base');
    git(dir, 'switch', '-q', '-c', 'other');
    commit(dir, 'a.txt', 'other', 'other');
    git(dir, 'switch', '-q', 'main');
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, 'a.txt'), 'dirty');
    const result = await (0, gitActions_1.checkout)(tools(dir).run, { kind: 'branch', name: 'other' });
    node_assert_1.default.strictEqual(result.ok, false);
    node_assert_1.default.strictEqual((0, node_fs_1.readFileSync)(node_path_1.default.join(dir, 'a.txt'), 'utf8'), 'dirty', 'nothing forced');
});
(0, node_test_1.default)('createBranch validates the name and switches to the new branch at the sha', async () => {
    const dir = initRepo();
    const first = commit(dir, 'a.txt', '1', 'one');
    commit(dir, 'a.txt', '2', 'two');
    const { run } = tools(dir);
    node_assert_1.default.strictEqual((await (0, gitActions_1.createBranch)(run, 'bad name', first)).ok, false);
    node_assert_1.default.strictEqual((await (0, gitActions_1.createBranch)(run, '-x', first)).ok, false);
    expectOk(await (0, gitActions_1.createBranch)(run, 'feature/x', first));
    node_assert_1.default.strictEqual(git(dir, 'branch', '--show-current'), 'feature/x');
    node_assert_1.default.strictEqual(git(dir, 'rev-parse', 'HEAD'), first);
});
function divergent(dir) {
    commit(dir, 'a.txt', 'base', 'base');
    git(dir, 'switch', '-q', '-c', 'side');
    const side = commit(dir, 's.txt', 'side', 'side file');
    git(dir, 'switch', '-q', 'main');
    commit(dir, 'a.txt', 'main', 'main change');
    return side;
}
(0, node_test_1.default)('cherryPick applies a clean commit', async () => {
    const dir = initRepo();
    const side = divergent(dir);
    const { run, inProgress } = tools(dir);
    const info = expectOk(await (0, gitActions_1.cherryPick)(run, inProgress, side));
    node_assert_1.default.strictEqual(info.stopped, false);
    node_assert_1.default.ok((0, node_fs_1.existsSync)(node_path_1.default.join(dir, 's.txt')));
});
(0, node_test_1.default)('a conflicting cherry-pick stops, and abort restores the tree', async () => {
    const dir = initRepo();
    commit(dir, 'a.txt', 'base', 'base');
    git(dir, 'switch', '-q', '-c', 'side');
    const side = commit(dir, 'a.txt', 'side', 'side change');
    git(dir, 'switch', '-q', 'main');
    commit(dir, 'a.txt', 'main', 'main change');
    const { run, inProgress } = tools(dir);
    const info = expectOk(await (0, gitActions_1.cherryPick)(run, inProgress, side));
    node_assert_1.default.strictEqual(info.stopped, true);
    node_assert_1.default.deepStrictEqual(await inProgress(), { kind: 'cherry-pick' });
    expectOk(await (0, gitActions_1.resumeOperation)(run, inProgress, 'abort'));
    node_assert_1.default.strictEqual(await inProgress(), null);
    node_assert_1.default.strictEqual((0, node_fs_1.readFileSync)(node_path_1.default.join(dir, 'a.txt'), 'utf8'), 'main');
});
(0, node_test_1.default)('empty cherry-pick then skip', async () => {
    const dir = initRepo();
    const side = divergent(dir);
    const { run, inProgress } = tools(dir);
    expectOk(await (0, gitActions_1.cherryPick)(run, inProgress, side));
    const again = expectOk(await (0, gitActions_1.cherryPick)(run, inProgress, side));
    node_assert_1.default.strictEqual(again.stopped, true, 'the change is already applied, so git stops on an empty pick');
    expectOk(await (0, gitActions_1.resumeOperation)(run, inProgress, 'skip'));
    node_assert_1.default.strictEqual(await inProgress(), null);
});
(0, node_test_1.default)('cherry-picking a merge commit needs a parent number', async () => {
    const dir = initRepo();
    commit(dir, 'a.txt', 'base', 'base');
    git(dir, 'switch', '-q', '-c', 'side');
    commit(dir, 's.txt', 's', 'side');
    git(dir, 'switch', '-q', 'main');
    commit(dir, 'm.txt', 'm', 'main');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    const merge = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'switch', '-q', '-c', 'target', 'HEAD~1');
    const { run, inProgress } = tools(dir);
    node_assert_1.default.strictEqual((await (0, gitActions_1.cherryPick)(run, inProgress, merge)).ok, false);
    const info = expectOk(await (0, gitActions_1.cherryPick)(run, inProgress, merge, 1));
    node_assert_1.default.strictEqual(info.stopped, false);
});
(0, node_test_1.default)('revert: a clean revert, then a conflicting one that can be aborted', async () => {
    const dir = initRepo();
    const first = commit(dir, 'a.txt', 'one', 'one');
    const second = commit(dir, 'a.txt', 'two', 'two');
    commit(dir, 'a.txt', 'three', 'three');
    const { run, inProgress } = tools(dir);
    const conflicted = expectOk(await (0, gitActions_1.revert)(run, inProgress, second));
    node_assert_1.default.strictEqual(conflicted.stopped, true);
    expectOk(await (0, gitActions_1.resumeOperation)(run, inProgress, 'abort'));
    node_assert_1.default.strictEqual(await inProgress(), null);
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, 'b.txt'), 'b');
    git(dir, 'add', '--', 'b.txt');
    git(dir, 'commit', '-q', '-m', 'add b');
    const addB = git(dir, 'rev-parse', 'HEAD');
    const clean = expectOk(await (0, gitActions_1.revert)(run, inProgress, addB));
    node_assert_1.default.strictEqual(clean.stopped, false);
    node_assert_1.default.ok(!(0, node_fs_1.existsSync)(node_path_1.default.join(dir, 'b.txt')));
    node_assert_1.default.ok(first);
});
(0, node_test_1.default)('resumeOperation fails when nothing is in progress, and a merge cannot be skipped', async () => {
    const dir = initRepo();
    commit(dir, 'a.txt', 'base', 'base');
    const { run, inProgress } = tools(dir);
    node_assert_1.default.strictEqual((await (0, gitActions_1.resumeOperation)(run, inProgress, 'continue')).ok, false);
    git(dir, 'switch', '-q', '-c', 'side');
    commit(dir, 'a.txt', 'side', 'side');
    git(dir, 'switch', '-q', 'main');
    commit(dir, 'a.txt', 'main', 'main');
    try {
        git(dir, 'merge', 'side');
    }
    catch { /* conflict, expected */ }
    node_assert_1.default.deepStrictEqual(await inProgress(), { kind: 'merge' });
    node_assert_1.default.strictEqual((await (0, gitActions_1.resumeOperation)(run, inProgress, 'skip')).ok, false);
    expectOk(await (0, gitActions_1.resumeOperation)(run, inProgress, 'abort'));
});
(0, node_test_1.default)('reset soft keeps the index, mixed keeps the files, hard discards both', async () => {
    for (const mode of ['soft', 'mixed', 'hard']) {
        const dir = initRepo();
        const c1 = commit(dir, 'a.txt', '1', 'one');
        commit(dir, 'a.txt', '2', 'two');
        expectOk(await (0, gitActions_1.reset)(tools(dir).run, mode, c1));
        node_assert_1.default.strictEqual(git(dir, 'rev-parse', 'HEAD'), c1, mode);
        node_assert_1.default.strictEqual(git(dir, 'diff', '--cached', '--name-only') !== '', mode === 'soft', `${mode}: staged`);
        node_assert_1.default.strictEqual((0, node_fs_1.readFileSync)(node_path_1.default.join(dir, 'a.txt'), 'utf8'), mode === 'hard' ? '1' : '2', `${mode}: file`);
    }
});
(0, node_test_1.default)('resetImpact counts what leaves the branch, what is left on no other ref, and tracked changes', async () => {
    const dir = initRepo();
    const c1 = commit(dir, 'a.txt', '1', 'one');
    commit(dir, 'a.txt', '2', 'two');
    const c3 = commit(dir, 'a.txt', '3', 'three');
    const { run } = tools(dir);
    node_assert_1.default.deepStrictEqual(expectOk(await (0, gitActions_1.resetImpact)(run, c1)), { branch: 'main', leaving: 2, orphaned: 2, trackedChanges: 0 });
    git(dir, 'branch', 'keep', c3);
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, 'a.txt'), 'dirty');
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, 'untracked.txt'), 'u');
    node_assert_1.default.deepStrictEqual(expectOk(await (0, gitActions_1.resetImpact)(run, c1)), { branch: 'main', leaving: 2, orphaned: 0, trackedChanges: 1 });
});
//# sourceMappingURL=gitActions.test.js.map
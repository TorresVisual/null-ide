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
const gitGraphService_1 = require("./gitGraphService");
const gitRun_1 = require("./gitRun");
function git(dir, ...args) {
    return (0, node_child_process_1.execFileSync)('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}
function initRepo() {
    const dir = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'graph-service-'));
    git(dir, 'init', '-q', '--initial-branch=main');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'config', 'core.autocrlf', 'false');
    return dir;
}
function commit(dir, file, content, message) {
    (0, node_fs_1.mkdirSync)(node_path_1.default.dirname(node_path_1.default.join(dir, file)), { recursive: true });
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, file), content);
    git(dir, 'add', '--', file);
    git(dir, 'commit', '-q', '-m', message);
    return git(dir, 'rev-parse', 'HEAD');
}
const service = (dir) => new gitGraphService_1.GitGraphService((0, gitRun_1.makeRunGit)(dir), dir);
const real = (p) => node_fs_1.realpathSync.native(p).toLowerCase();
(0, node_test_1.default)('loadPage pages through history and labels HEAD, tags and branches', async () => {
    const dir = initRepo();
    const shas = [1, 2, 3, 4, 5].map((n) => commit(dir, 'a.txt', String(n), `commit ${n}`));
    git(dir, 'tag', 'v1', shas[1]);
    git(dir, 'branch', 'dev', shas[2]);
    const first = await service(dir).loadPage(0, 3);
    node_assert_1.default.deepStrictEqual(first.commits.map((x) => x.subject), ['commit 5', 'commit 4', 'commit 3']);
    node_assert_1.default.strictEqual(first.hasMore, true);
    node_assert_1.default.strictEqual(first.rawCount, 3);
    node_assert_1.default.deepStrictEqual(first.commits[0].refs, [{ name: 'main', kind: 'branch', current: true }]);
    node_assert_1.default.deepStrictEqual(first.commits[2].refs, [{ name: 'dev', kind: 'branch', current: false }]);
    const second = await service(dir).loadPage(3, 3);
    node_assert_1.default.deepStrictEqual(second.commits.map((x) => x.subject), ['commit 2', 'commit 1']);
    node_assert_1.default.strictEqual(second.hasMore, false);
    node_assert_1.default.deepStrictEqual(second.commits[0].refs, [{ name: 'v1', kind: 'tag' }]);
});
(0, node_test_1.default)('loadPage on an empty repository returns an empty page instead of failing', async () => {
    const dir = initRepo();
    node_assert_1.default.deepStrictEqual(await service(dir).loadPage(0), { commits: [], rawCount: 0, hasMore: false });
});
(0, node_test_1.default)('a detached HEAD gets its own label and the branch is no longer current', async () => {
    const dir = initRepo();
    const first = commit(dir, 'a.txt', '1', 'one');
    commit(dir, 'a.txt', '2', 'two');
    git(dir, 'checkout', '-q', '--detach', first);
    const page = await service(dir).loadPage(0);
    const byRef = (name) => page.commits.find((x) => x.refs.some((r) => r.name === name));
    node_assert_1.default.deepStrictEqual(byRef('HEAD').refs, [{ name: 'HEAD', kind: 'head', current: true }]);
    node_assert_1.default.deepStrictEqual(byRef('main').refs, [{ name: 'main', kind: 'branch', current: false }]);
});
(0, node_test_1.default)('refs lists branches, remotes and tags, with annotated tags peeled to their commit', async () => {
    const dir = initRepo();
    const sha = commit(dir, 'a.txt', '1', 'one');
    git(dir, 'tag', '-a', 'v2', '-m', 'annotated');
    git(dir, 'update-ref', 'refs/remotes/origin/main', sha);
    git(dir, 'update-ref', 'refs/remotes/origin/HEAD', sha);
    const refs = await service(dir).refs();
    node_assert_1.default.deepStrictEqual(refs.map((r) => [r.name, r.kind, r.sha]).sort(), [['main', 'branch', sha], ['origin/main', 'remote', sha], ['v2', 'tag', sha]]);
});
(0, node_test_1.default)('stashes appear once each, labeled by position, without their index/untracked helper commits', async () => {
    const dir = initRepo();
    commit(dir, 'a.txt', 'base', 'base');
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, 'a.txt'), 'older');
    git(dir, 'stash');
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, 'a.txt'), 'newer');
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, 'untracked.txt'), 'u');
    git(dir, 'stash', '-u');
    const page = await service(dir).loadPage(0);
    const subjects = page.commits.map((x) => x.subject);
    node_assert_1.default.ok(!subjects.some((s) => s.startsWith('index on') || s.startsWith('untracked files on')), subjects.join(' | '));
    const stashes = page.commits.filter((x) => x.refs.some((r) => r.kind === 'stash'));
    node_assert_1.default.deepStrictEqual(stashes.map((x) => x.refs[0].name).sort(), ['stash@{0}', 'stash@{1}']);
    node_assert_1.default.ok(stashes.every((x) => x.parents.length === 1));
});
(0, node_test_1.default)('fingerprint changes on a commit or a branch switch, not on a file edit', async () => {
    const dir = initRepo();
    commit(dir, 'a.txt', '1', 'one');
    const svc = service(dir);
    const base = (await svc.fingerprint()).hash;
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, 'a.txt'), 'edited but not committed');
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, 'new.txt'), 'untracked');
    node_assert_1.default.strictEqual((await svc.fingerprint()).hash, base);
    git(dir, 'switch', '-q', '-c', 'other');
    const switched = (await svc.fingerprint()).hash;
    node_assert_1.default.notStrictEqual(switched, base);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'two');
    node_assert_1.default.notStrictEqual((await svc.fingerprint()).hash, switched);
});
function conflictingCherryPick(dir) {
    commit(dir, 'a.txt', 'base', 'base');
    git(dir, 'switch', '-q', '-c', 'side');
    commit(dir, 'a.txt', 'side', 'side change');
    git(dir, 'switch', '-q', 'main');
    commit(dir, 'a.txt', 'main', 'main change');
}
(0, node_test_1.default)('inProgress sees a stopped cherry-pick, and the fingerprint reports it', async () => {
    const dir = initRepo();
    conflictingCherryPick(dir);
    const svc = service(dir);
    node_assert_1.default.strictEqual(await svc.inProgress(), null);
    try {
        git(dir, 'cherry-pick', 'side');
    }
    catch { /* conflict, expected */ }
    node_assert_1.default.deepStrictEqual(await svc.inProgress(), { kind: 'cherry-pick' });
    node_assert_1.default.deepStrictEqual((await svc.fingerprint()).inProgress, { kind: 'cherry-pick' });
});
(0, node_test_1.default)('inProgress in a linked worktree is found through --git-path and stays local to that worktree', async () => {
    const dir = initRepo();
    conflictingCherryPick(dir);
    const linked = node_path_1.default.join((0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'graph-linked-')), 'wt');
    git(dir, 'worktree', 'add', '-q', '-b', 'wt', linked, 'main');
    try {
        git(linked, 'cherry-pick', 'side');
    }
    catch { /* conflict, expected */ }
    node_assert_1.default.deepStrictEqual(await service(linked).inProgress(), { kind: 'cherry-pick' });
    node_assert_1.default.strictEqual(await service(dir).inProgress(), null);
});
(0, node_test_1.default)('commitDetail returns the full message, both identities and the parents', async () => {
    const dir = initRepo();
    const first = commit(dir, 'a.txt', '1', 'one');
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, 'a.txt'), '2');
    git(dir, 'add', '--', 'a.txt');
    git(dir, 'commit', '-q', '-m', 'Second', '-m', 'Body line one\nBody line two');
    const sha = git(dir, 'rev-parse', 'HEAD');
    const detail = await service(dir).commitDetail(sha);
    node_assert_1.default.strictEqual(detail.sha, sha);
    node_assert_1.default.deepStrictEqual(detail.parents, [first]);
    node_assert_1.default.strictEqual(detail.author, 'Test');
    node_assert_1.default.strictEqual(detail.committerEmail, 'test@example.com');
    node_assert_1.default.strictEqual(detail.message, 'Second\n\nBody line one\nBody line two');
});
(0, node_test_1.default)('commitFiles: root commit, rename + modify, and a merge against its first parent; odd file names survive', async () => {
    const dir = initRepo();
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, 'a b.txt'), 'content that is long enough to detect a rename\n'.repeat(5));
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, 'é.txt'), 'x');
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, '-dash.txt'), 'y');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'root');
    const root = git(dir, 'rev-parse', 'HEAD');
    const svc = service(dir);
    const rootFiles = await svc.commitFiles(root);
    node_assert_1.default.deepStrictEqual(rootFiles.map((f) => [f.status, f.path]).sort(), [['A', '-dash.txt'], ['A', 'a b.txt'], ['A', 'é.txt']]);
    git(dir, 'mv', 'a b.txt', 'c.txt');
    (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, 'é.txt'), 'changed');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'rename');
    const second = git(dir, 'rev-parse', 'HEAD');
    const renamed = await svc.commitFiles(second, root);
    node_assert_1.default.deepStrictEqual(renamed.map((f) => [f.status, f.path, f.oldPath]).sort(), [['M', 'é.txt', undefined], ['R', 'c.txt', 'a b.txt']]);
    git(dir, 'switch', '-q', '-c', 'side');
    commit(dir, 's.txt', 's', 'side');
    git(dir, 'switch', '-q', 'main');
    commit(dir, 'm.txt', 'm', 'main');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    const merge = git(dir, 'rev-parse', 'HEAD');
    const parents = (await svc.commitDetail(merge)).parents;
    node_assert_1.default.strictEqual(parents.length, 2);
    node_assert_1.default.deepStrictEqual((await svc.commitFiles(merge, parents[0])).map((f) => [f.status, f.path]), [['A', 's.txt']]);
});
(0, node_test_1.default)('resolveRepoRoot finds the top level from a subfolder and reports a plain folder', async () => {
    const dir = initRepo();
    (0, node_fs_1.mkdirSync)(node_path_1.default.join(dir, 'sub'));
    const found = await (0, gitGraphService_1.resolveRepoRoot)(node_path_1.default.join(dir, 'sub'));
    node_assert_1.default.ok(found.ok);
    if (found.ok)
        node_assert_1.default.strictEqual(real(found.root), real(dir));
    node_assert_1.default.deepStrictEqual(await (0, gitGraphService_1.resolveRepoRoot)((0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'graph-plain-'))), { ok: false, reason: 'not-a-repo' });
});
//# sourceMappingURL=gitGraphService.test.js.map
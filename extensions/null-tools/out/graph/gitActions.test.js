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
// Fake git: `answers` maps the joined args to stdout; a missing key throws like a failing git.
function fakeGit(answers, calls = []) {
    return async (args) => {
        calls.push(args);
        const key = args.join(' ');
        if (key in answers)
            return answers[key];
        throw new Error(`fatal: unexpected ${key}`);
    };
}
(0, node_test_1.default)('pull reports noUpstream when the branch tracks nothing, and runs no pull', async () => {
    const calls = [];
    node_assert_1.default.deepStrictEqual(await (0, gitActions_1.pull)(fakeGit({}, calls)), { ok: true, value: { kind: 'noUpstream' } });
    node_assert_1.default.strictEqual(calls.some((a) => a[0] === 'pull'), false);
});
(0, node_test_1.default)('pull reports upToDate when HEAD already contains the upstream', async () => {
    const git = fakeGit({
        'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main\n',
        'fetch': '',
        'rev-list --count HEAD..@{u}': '0\n',
        'pull --ff-only': 'Already up to date.\n',
    });
    node_assert_1.default.deepStrictEqual(await (0, gitActions_1.pull)(git), { ok: true, value: { kind: 'upToDate' } });
});
(0, node_test_1.default)('pull reports diverged and does not pull when local and upstream both have commits', async () => {
    const calls = [];
    const git = fakeGit({
        'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main\n',
        'rev-list --count HEAD..@{u}': '2\n',
        'rev-list --count @{u}..HEAD': '1\n',
        'fetch': '',
    }, calls);
    node_assert_1.default.deepStrictEqual(await (0, gitActions_1.pull)(git), { ok: true, value: { kind: 'diverged', ahead: 1, behind: 2 } });
    node_assert_1.default.strictEqual(calls.some((a) => a[0] === 'pull'), false);
});
(0, node_test_1.default)('pull fast-forwards and counts the commits that came in', async () => {
    const git = fakeGit({
        'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main\n',
        'rev-list --count HEAD..@{u}': '3\n',
        'rev-list --count @{u}..HEAD': '0\n',
        'fetch': '',
        'pull --ff-only': 'Fast-forward\n',
    });
    node_assert_1.default.deepStrictEqual(await (0, gitActions_1.pull)(git), { ok: true, value: { kind: 'fastForwarded', commits: 3 } });
});
(0, node_test_1.default)('pull fetches before it counts, so an upstream that moved on the remote is seen', async () => {
    const calls = [];
    const git = fakeGit({
        'fetch': '',
        'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main\n',
        'rev-list --count HEAD..@{u}': '1\n',
        'rev-list --count @{u}..HEAD': '0\n',
        'pull --ff-only': 'Fast-forward\n',
    }, calls);
    node_assert_1.default.deepStrictEqual(await (0, gitActions_1.pull)(git), { ok: true, value: { kind: 'fastForwarded', commits: 1 } });
    const keys = calls.map((a) => a.join(' '));
    node_assert_1.default.ok(keys.indexOf('fetch') >= 0 && keys.indexOf('fetch') < keys.indexOf('rev-list --count HEAD..@{u}'), keys.join(' | '));
});
(0, node_test_1.default)('pull returns git refusal text as a failure, e.g. a dirty tree', async () => {
    const git = async (args) => {
        const key = args.join(' ');
        if (key === 'fetch')
            return '';
        if (key.startsWith('rev-parse'))
            return 'origin/main\n';
        if (key === 'rev-list --count HEAD..@{u}')
            return '1\n';
        if (key === 'rev-list --count @{u}..HEAD')
            return '0\n';
        throw new Error('error: Your local changes to the following files would be overwritten by merge');
    };
    node_assert_1.default.deepStrictEqual(await (0, gitActions_1.pull)(git), {
        ok: false,
        message: 'error: Your local changes to the following files would be overwritten by merge',
    });
});
(0, node_test_1.default)('pull passes an offline or no-credentials failure through unchanged', async () => {
    const calls = [];
    const git = async (args) => {
        calls.push(args);
        const key = args.join(' ');
        if (key.startsWith('rev-parse'))
            return 'origin/main\n';
        if (key === 'fetch')
            throw new Error("fatal: could not read Username for 'https://github.com': terminal prompts disabled");
        if (key === 'rev-list --count HEAD..@{u}')
            return '1\n';
        if (key === 'rev-list --count @{u}..HEAD')
            return '0\n';
        throw new Error(`fatal: unexpected ${key}`);
    };
    node_assert_1.default.deepStrictEqual(await (0, gitActions_1.pull)(git), {
        ok: false,
        message: "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    });
    node_assert_1.default.strictEqual(calls.some((a) => a[0] === 'pull'), false);
});
// A clone whose branch has one local commit while origin has one new commit: ahead 1, behind 1, upstream already fetched.
function divergedClone(local, remote) {
    const origin = initRepo();
    commit(origin, 'a.txt', 'base', 'base');
    const clone = node_path_1.default.join((0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'graph-pull-')), 'c');
    (0, node_child_process_1.execFileSync)('git', ['clone', '-q', origin, clone]);
    for (const [key, value] of [['user.email', 'test@example.com'], ['user.name', 'Test'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) {
        git(clone, 'config', key, value);
    }
    commit(clone, local[0], local[1], 'local change');
    commit(origin, remote[0], remote[1], 'remote change');
    git(clone, 'fetch', '-q');
    return clone;
}
(0, node_test_1.default)('integrateUpstream rebase puts the local commit on top of the upstream with no merge commit', async () => {
    const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
    const { run, inProgress } = tools(clone);
    node_assert_1.default.strictEqual(expectOk(await (0, gitActions_1.integrateUpstream)(run, inProgress, 'rebase')).stopped, false);
    node_assert_1.default.strictEqual(git(clone, 'log', '--format=%s'), 'local change\nremote change\nbase');
    node_assert_1.default.strictEqual(git(clone, 'rev-list', '--merges', '--count', 'HEAD'), '0');
    node_assert_1.default.strictEqual(await inProgress(), null);
});
(0, node_test_1.default)('integrateUpstream merge adds one merge commit that keeps both histories', async () => {
    const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
    const { run, inProgress } = tools(clone);
    node_assert_1.default.strictEqual(expectOk(await (0, gitActions_1.integrateUpstream)(run, inProgress, 'merge')).stopped, false);
    node_assert_1.default.strictEqual(git(clone, 'rev-list', '--parents', '-n1', 'HEAD').split(' ').length, 3, 'a merge commit has two parents');
    node_assert_1.default.strictEqual(await inProgress(), null);
});
(0, node_test_1.default)('a conflicting rebase or merge is a stop, and Abort puts the branch back on the same commit', async () => {
    for (const strategy of ['rebase', 'merge']) {
        const clone = divergedClone(['a.txt', 'local'], ['a.txt', 'remote']);
        const { run, inProgress } = tools(clone);
        const before = git(clone, 'rev-parse', 'HEAD');
        node_assert_1.default.strictEqual(expectOk(await (0, gitActions_1.integrateUpstream)(run, inProgress, strategy)).stopped, true, strategy);
        node_assert_1.default.deepStrictEqual(await inProgress(), { kind: strategy }, strategy);
        expectOk(await (0, gitActions_1.resumeOperation)(run, inProgress, 'abort'));
        node_assert_1.default.strictEqual(git(clone, 'rev-parse', 'HEAD'), before, `${strategy}: HEAD restored`);
        node_assert_1.default.strictEqual(await inProgress(), null, strategy);
        node_assert_1.default.strictEqual((0, node_fs_1.readFileSync)(node_path_1.default.join(clone, 'a.txt'), 'utf8'), 'local', `${strategy}: file restored`);
    }
});
(0, node_test_1.default)('integrateUpstream is refused on a dirty tree, with the tree and HEAD untouched and no operation started', async () => {
    // Rebase refuses any unstaged change; merge refuses when the change overlaps what comes in.
    const cases = [
        { strategy: 'rebase', remote: ['o.txt', 'remote'] },
        { strategy: 'merge', remote: ['a.txt', 'remote'] },
    ];
    for (const { strategy, remote } of cases) {
        const clone = divergedClone(['l.txt', 'local'], [remote[0], remote[1]]);
        const { run, inProgress } = tools(clone);
        const before = git(clone, 'rev-parse', 'HEAD');
        (0, node_fs_1.writeFileSync)(node_path_1.default.join(clone, 'a.txt'), 'dirty');
        const result = await (0, gitActions_1.integrateUpstream)(run, inProgress, strategy);
        node_assert_1.default.strictEqual(result.ok, false, strategy);
        node_assert_1.default.strictEqual(git(clone, 'rev-parse', 'HEAD'), before, `${strategy}: HEAD`);
        node_assert_1.default.strictEqual((0, node_fs_1.readFileSync)(node_path_1.default.join(clone, 'a.txt'), 'utf8'), 'dirty', `${strategy}: file`);
        node_assert_1.default.strictEqual(await inProgress(), null, strategy);
    }
});
(0, node_test_1.default)('integrateUpstream rebase drops a local commit whose patch the upstream already has', async () => {
    // The upstream was amended or squashed: the same change exists on both sides under different hashes.
    const clone = divergedClone(['o.txt', 'same'], ['o.txt', 'same']);
    const { run, inProgress } = tools(clone);
    node_assert_1.default.strictEqual(expectOk(await (0, gitActions_1.integrateUpstream)(run, inProgress, 'rebase')).stopped, false);
    node_assert_1.default.strictEqual(git(clone, 'rev-parse', 'HEAD'), git(clone, 'rev-parse', '@{u}'), 'no duplicate commit is left');
});
// fakeGit answers only the keys given; an absent key throws, which is how `git config --get` reports "unset" (exit 1).
function configGit(config, branch = 'main') {
    const answers = {};
    if (branch)
        answers['symbolic-ref --quiet --short HEAD'] = `${branch}\n`;
    for (const [key, value] of Object.entries(config))
        answers[`config --get ${key}`] = `${value}\n`;
    return fakeGit(answers);
}
(0, node_test_1.default)('pullPreference maps git config to a strategy', async () => {
    const cases = [
        [{}, 'ask'],
        [{ 'pull.rebase': 'true' }, 'rebase'],
        [{ 'pull.rebase': 'false' }, 'merge'],
        [{ 'pull.ff': 'only' }, 'ff-only'],
        [{ 'pull.ff': 'false' }, 'merge'],
        [{ 'pull.ff': 'true' }, 'ask'],
        [{ 'pull.ff': 'only', 'pull.rebase': 'true' }, 'rebase'],
        [{ 'pull.ff': 'only', 'pull.rebase': 'false' }, 'ff-only'],
    ];
    for (const [config, expected] of cases) {
        node_assert_1.default.strictEqual(await (0, gitActions_1.pullPreference)(configGit(config)), expected, JSON.stringify(config));
    }
});
(0, node_test_1.default)('pullPreference asks for the rebase modes Null cannot run', async () => {
    for (const value of ['merges', 'interactive', 'preserve', 'nonsense']) {
        node_assert_1.default.strictEqual(await (0, gitActions_1.pullPreference)(configGit({ 'pull.rebase': value })), 'ask', value);
    }
});
(0, node_test_1.default)('pullPreference accepts every boolean spelling git does, in any case', async () => {
    for (const value of ['true', 'TRUE', 'yes', 'on', '1']) {
        node_assert_1.default.strictEqual(await (0, gitActions_1.pullPreference)(configGit({ 'pull.rebase': value })), 'rebase', value);
    }
    for (const value of ['false', 'No', 'off', '0']) {
        node_assert_1.default.strictEqual(await (0, gitActions_1.pullPreference)(configGit({ 'pull.rebase': value })), 'merge', value);
    }
});
(0, node_test_1.default)('pullPreference: the branch setting beats pull.rebase', async () => {
    node_assert_1.default.strictEqual(await (0, gitActions_1.pullPreference)(configGit({ 'pull.rebase': 'false', 'branch.main.rebase': 'true' })), 'rebase');
    node_assert_1.default.strictEqual(await (0, gitActions_1.pullPreference)(configGit({ 'pull.rebase': 'true', 'branch.main.rebase': 'false' })), 'merge');
});
(0, node_test_1.default)('pullPreference on a detached HEAD uses pull.* only, and never throws when git fails', async () => {
    node_assert_1.default.strictEqual(await (0, gitActions_1.pullPreference)(configGit({ 'pull.rebase': 'true' }, null)), 'rebase');
    const broken = async () => { throw new Error('fatal: not a git repository'); };
    node_assert_1.default.strictEqual(await (0, gitActions_1.pullPreference)(broken), 'ask');
});
(0, node_test_1.default)('pullPreference reads the real repo config, branch setting first', async () => {
    // Git for Windows ships pull.rebase=false in its system config; a local value cannot unset it, so ignore system and global config here.
    const isolated = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: node_path_1.default.join((0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'graph-cfg-')), 'none') };
    Object.assign(process.env, isolated);
    try {
        const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
        const { run } = tools(clone);
        node_assert_1.default.strictEqual(await (0, gitActions_1.pullPreference)(run), 'ask');
        git(clone, 'config', 'pull.rebase', 'true');
        node_assert_1.default.strictEqual(await (0, gitActions_1.pullPreference)(run), 'rebase');
        git(clone, 'config', 'branch.main.rebase', 'false');
        node_assert_1.default.strictEqual(await (0, gitActions_1.pullPreference)(run), 'merge');
    }
    finally {
        for (const key of Object.keys(isolated))
            delete process.env[key];
    }
});
//# sourceMappingURL=gitActions.test.js.map
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = require("node:test");
const git_1 = require("./git");
const gitWiring_1 = require("./gitWiring");
const testFakes_1 = require("./testFakes");
const scratch = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'null-accounts-wiring-'));
(0, node_test_1.after)(() => (0, node_fs_1.rmSync)(scratch, { recursive: true, force: true }));
let n = 0;
function makeRepo() {
    const dir = node_path_1.default.join(scratch, `repo-${++n}`);
    (0, node_child_process_1.execFileSync)('git', ['init', '-q', dir]);
    return dir;
}
const config = (dir, key) => {
    try {
        return (0, node_child_process_1.execFileSync)('git', ['config', '--local', '--get', key], { cwd: dir, encoding: 'utf8' }).trim();
    }
    catch {
        return undefined;
    }
};
const alice = {
    id: 'a1', provider: 'github', host: 'github.com', username: 'alice', email: 'alice@example.com', authMethod: 'oauth',
};
const bob = {
    id: 'a2', provider: 'gitlab', host: 'git.example.org:8443', username: 'bob', email: 'bob@example.org', authMethod: 'https',
};
const CRED_ALICE = 'credential.https://github.com.username';
function setup(initial, git = git_1.runGit) {
    const meta = new testFakes_1.FakeMeta();
    const accounts = new Map(initial.map(([, a]) => [a.id, a]));
    const bound = new Map(initial.map(([folder, a]) => [folder, a.id]));
    const calls = [];
    const counting = (cwd, args, input) => { calls.push(args); return git(cwd, args, input); };
    const make = () => new gitWiring_1.GitWiring({
        meta, git: counting, home: '/home/me', exists: node_fs_1.existsSync,
        bindings: { entries: () => [...bound.entries()] },
        accounts: { get: id => accounts.get(id) },
    });
    return { meta, accounts, bound, calls, wiring: make(), make };
}
(0, node_test_1.test)('binding writes the identity and the credential username into the repo, and nothing outside it', async () => {
    const dir = makeRepo();
    const { wiring } = setup([[dir, alice]]);
    node_assert_1.default.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'wired' }]);
    node_assert_1.default.strictEqual(config(dir, 'user.name'), 'alice');
    node_assert_1.default.strictEqual(config(dir, 'user.email'), 'alice@example.com');
    node_assert_1.default.strictEqual(config(dir, CRED_ALICE), 'alice');
});
(0, node_test_1.test)('a second reconcile with nothing changed runs no git at all', async () => {
    const dir = makeRepo();
    const { wiring, calls } = setup([[dir, alice]]);
    await wiring.reconcile();
    calls.length = 0;
    node_assert_1.default.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'unchanged' }]);
    node_assert_1.default.deepStrictEqual(calls, []);
});
(0, node_test_1.test)('rebinding swaps every value and drops keys the new account does not use', async () => {
    const dir = makeRepo();
    const { wiring, bound, accounts } = setup([[dir, alice]]);
    accounts.set(bob.id, bob);
    await wiring.reconcile();
    bound.set(dir, bob.id);
    node_assert_1.default.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'wired' }]);
    node_assert_1.default.strictEqual(config(dir, 'user.email'), 'bob@example.org');
    node_assert_1.default.strictEqual(config(dir, 'credential.https://git.example.org:8443.username'), 'bob');
    node_assert_1.default.strictEqual(config(dir, CRED_ALICE), undefined);
});
(0, node_test_1.test)('unbinding restores what the repo had before, and removes what it did not', async () => {
    const dir = makeRepo();
    (0, node_child_process_1.execFileSync)('git', ['config', '--local', 'user.email', 'me@work.example'], { cwd: dir });
    const { wiring, bound } = setup([[dir, alice]]);
    await wiring.reconcile();
    node_assert_1.default.strictEqual(config(dir, 'user.email'), 'alice@example.com');
    bound.delete(dir);
    node_assert_1.default.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'cleared' }]);
    node_assert_1.default.strictEqual(config(dir, 'user.email'), 'me@work.example');
    node_assert_1.default.strictEqual(config(dir, 'user.name'), undefined);
    node_assert_1.default.strictEqual(config(dir, CRED_ALICE), undefined);
    node_assert_1.default.deepStrictEqual(await wiring.reconcile(), []); // forgotten: nothing left to visit
});
(0, node_test_1.test)('a value the user changed after we wrote it is left alone on unbind', async () => {
    const dir = makeRepo();
    const { wiring, bound } = setup([[dir, alice]]);
    await wiring.reconcile();
    (0, node_child_process_1.execFileSync)('git', ['config', '--local', 'user.email', 'edited@by.hand'], { cwd: dir });
    bound.delete(dir);
    await wiring.reconcile();
    node_assert_1.default.strictEqual(config(dir, 'user.email'), 'edited@by.hand');
    node_assert_1.default.strictEqual(config(dir, 'user.name'), undefined);
});
(0, node_test_1.test)('removing the account clears its folders, even after a restart (the record lives in the metadata store)', async () => {
    const dir = makeRepo();
    const { wiring, accounts, meta, make } = setup([[dir, alice]]);
    await wiring.reconcile();
    accounts.delete(alice.id);
    const restarted = make(); // same meta, new instance
    node_assert_1.default.deepStrictEqual(await restarted.reconcile(), [{ folder: dir, status: 'cleared' }]);
    node_assert_1.default.strictEqual(config(dir, 'user.email'), undefined);
    node_assert_1.default.deepStrictEqual(meta.data.get('null-accounts.gitWiring'), {});
});
(0, node_test_1.test)('editing the account email rewrites the repo', async () => {
    const dir = makeRepo();
    const { wiring, accounts } = setup([[dir, alice]]);
    await wiring.reconcile();
    accounts.set(alice.id, { ...alice, email: 'new@example.com' });
    node_assert_1.default.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'wired' }]);
    node_assert_1.default.strictEqual(config(dir, 'user.email'), 'new@example.com');
});
(0, node_test_1.test)('a bound folder that is not a repo, or does not exist, is skipped without being mistaken for "git missing"', async () => {
    const plain = node_path_1.default.join(scratch, 'plain');
    (0, node_fs_1.mkdirSync)(plain);
    const gone = node_path_1.default.join(scratch, 'gone');
    const { wiring } = setup([[plain, alice], [gone, alice]]);
    const outcomes = await wiring.reconcile();
    const byFolder = Object.fromEntries(outcomes.map(o => [o.folder, o]));
    node_assert_1.default.strictEqual(byFolder[plain].status, 'skipped');
    node_assert_1.default.strictEqual(byFolder[plain].reason, 'not-a-repo');
    node_assert_1.default.strictEqual(byFolder[gone].reason, 'folder-missing');
    node_assert_1.default.strictEqual((0, gitWiring_1.describeSkip)(byFolder[plain], 'plain'), undefined);
    node_assert_1.default.strictEqual((0, gitWiring_1.describeSkip)(byFolder[gone], 'gone'), undefined);
});
(0, node_test_1.test)('git not being installed skips with a warning and keeps the record so cleanup is retried', async () => {
    const dir = makeRepo();
    let installed = true;
    const flaky = (cwd, args, input) => installed ? (0, git_1.runGit)(cwd, args, input) : Promise.resolve({ code: git_1.GIT_UNAVAILABLE, stdout: '', stderr: 'spawn git ENOENT' });
    const { wiring, bound } = setup([[dir, alice]], flaky);
    await wiring.reconcile();
    bound.delete(dir);
    installed = false;
    const [offline] = await wiring.reconcile();
    node_assert_1.default.deepStrictEqual(offline, { folder: dir, status: 'skipped', reason: 'git-missing' });
    node_assert_1.default.match((0, gitWiring_1.describeSkip)(offline, 'repo') ?? '', /git was not found/);
    node_assert_1.default.strictEqual(config(dir, 'user.email'), 'alice@example.com'); // untouched
    installed = true;
    node_assert_1.default.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'cleared' }]);
    node_assert_1.default.strictEqual(config(dir, 'user.email'), undefined);
});
(0, node_test_1.test)('an SSH account writes core.sshCommand; a missing key file changes nothing and names the file', async () => {
    const dir = makeRepo();
    const key = node_path_1.default.join(scratch, 'id_work');
    const ssh = { ...alice, id: 'a3', authMethod: 'ssh', sshKeyPath: key };
    const { wiring, accounts } = setup([[dir, ssh]]);
    const [missing] = await wiring.reconcile();
    node_assert_1.default.deepStrictEqual(missing, { folder: dir, status: 'skipped', reason: 'ssh-key-missing', detail: key.replace(/\\/g, '/') });
    node_assert_1.default.match((0, gitWiring_1.describeSkip)(missing, 'repo') ?? '', /SSH key .*id_work.* was not found/);
    node_assert_1.default.strictEqual(config(dir, 'user.email'), undefined);
    (0, node_fs_1.writeFileSync)(key, 'not a real key');
    node_assert_1.default.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'wired' }]);
    node_assert_1.default.strictEqual(config(dir, 'core.sshCommand'), `ssh -i '${key.replace(/\\/g, '/')}' -o IdentitiesOnly=yes`);
    node_assert_1.default.strictEqual(config(dir, CRED_ALICE), undefined);
    node_assert_1.default.ok(accounts.has('a3'));
});
(0, node_test_1.test)('rebinding to an SSH account whose key is missing still removes the previous account from the repo', async () => {
    const dir = makeRepo();
    const ssh = { ...bob, id: 'a3', authMethod: 'ssh', sshKeyPath: node_path_1.default.join(scratch, 'nope') };
    const { wiring, bound, accounts } = setup([[dir, alice]]);
    accounts.set(ssh.id, ssh);
    await wiring.reconcile();
    bound.set(dir, ssh.id);
    const [outcome] = await wiring.reconcile();
    node_assert_1.default.strictEqual(outcome.reason, 'ssh-key-missing');
    node_assert_1.default.strictEqual(config(dir, 'user.email'), undefined);
});
(0, node_test_1.test)('overlapping reconciles are serialised: two rapid calls leave one consistent result', async () => {
    const dir = makeRepo();
    const { wiring } = setup([[dir, alice]]);
    const [first, second] = await Promise.all([wiring.reconcile(), wiring.reconcile()]);
    node_assert_1.default.strictEqual(first[0].status, 'wired');
    node_assert_1.default.strictEqual(second[0].status, 'unchanged');
    node_assert_1.default.strictEqual(config(dir, 'user.email'), 'alice@example.com');
});
//# sourceMappingURL=gitWiring.test.js.map
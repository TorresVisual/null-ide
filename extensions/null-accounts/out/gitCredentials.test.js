'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const git_1 = require("./git");
const gitCredentials_1 = require("./gitCredentials");
const testFakes_1 = require("./testFakes");
const alice = {
    id: 'a1', provider: 'github', host: 'github.com', username: 'alice', email: 'alice@example.com', authMethod: 'oauth',
};
const bob = {
    id: 'a2', provider: 'gitlab', host: 'git.example.org:8443', username: 'bob', email: 'bob@example.org', authMethod: 'https',
};
const ssh = { ...alice, id: 'a3', username: 'carol', authMethod: 'ssh', sshKeyPath: '/k' };
function setup(initial) {
    const meta = new testFakes_1.FakeMeta();
    const accounts = new Map(initial.map(([, a]) => [a.id, a]));
    const bound = new Map(initial.map(([folder, a]) => [folder, a.id]));
    const tokens = new Map(initial.map(([, a]) => [a.id, `token-of-${a.username}`]));
    const calls = [];
    let result = { code: 0, stdout: '', stderr: '' };
    const git = async (cwd, args, input) => { calls.push({ cwd, args, input }); return result; };
    const sync = new gitCredentials_1.CredentialSync({
        meta, git, cwd: '/tmp',
        bindings: { entries: () => [...bound.entries()] },
        accounts: { get: id => accounts.get(id) },
        token: async (account) => tokens.get(account.id),
    });
    return { sync, meta, accounts, bound, tokens, calls, failWith: (code) => { result = { code, stdout: '', stderr: 'x' }; } };
}
(0, node_test_1.test)('the token reaches git over stdin only, in the credential format, never in the arguments', async () => {
    const { sync, calls } = setup([['/work/a', alice]]);
    await sync.sync();
    node_assert_1.default.deepStrictEqual(calls, [{
            cwd: '/tmp',
            args: ['credential', 'approve'],
            input: 'protocol=https\nhost=github.com\nusername=alice\npassword=token-of-alice\n\n',
        }]);
    node_assert_1.default.ok(!calls[0].args.join(' ').includes('token-of-alice'));
});
(0, node_test_1.test)('the same token is approved once; a refreshed token is approved again', async () => {
    const { sync, calls, tokens } = setup([['/work/a', bob]]);
    await sync.sync();
    await sync.sync();
    node_assert_1.default.strictEqual(calls.length, 1);
    tokens.set(bob.id, 'rotated');
    await sync.sync();
    node_assert_1.default.strictEqual(calls.length, 2);
    node_assert_1.default.match(calls[1].input ?? '', /host=git\.example\.org:8443\nusername=bob\npassword=rotated\n/);
});
(0, node_test_1.test)('two folders on one account share one credential; it is withdrawn only when the last folder lets go', async () => {
    const { sync, calls, bound } = setup([['/work/a', alice]]);
    bound.set('/work/b', alice.id);
    await sync.sync();
    node_assert_1.default.strictEqual(calls.length, 1);
    bound.delete('/work/a');
    await sync.sync();
    node_assert_1.default.strictEqual(calls.length, 1, 'still used by /work/b, so it stays in the store');
    bound.delete('/work/b');
    await sync.sync();
    node_assert_1.default.deepStrictEqual(calls[1], {
        cwd: '/tmp', args: ['credential', 'reject'], input: 'protocol=https\nhost=github.com\nusername=alice\n\n',
    });
});
(0, node_test_1.test)('removing the account withdraws its credential, and the record of it survives a restart', async () => {
    const { sync, calls, accounts, meta } = setup([['/work/a', alice]]);
    await sync.sync();
    node_assert_1.default.deepStrictEqual(meta.data.get(gitCredentials_1.CREDENTIALS_KEY), { a1: { host: 'github.com', username: 'alice' } });
    node_assert_1.default.ok(!JSON.stringify([...meta.data.values()]).includes('token-of-alice'), 'a token was persisted');
    accounts.delete(alice.id);
    const afterRestart = new gitCredentials_1.CredentialSync({
        meta, git: async (cwd, args, input) => { calls.push({ cwd, args, input }); return { code: 0, stdout: '', stderr: '' }; }, cwd: '/tmp',
        bindings: { entries: () => [['/work/a', alice.id]] }, accounts: { get: id => accounts.get(id) }, token: async () => undefined,
    });
    await afterRestart.sync();
    node_assert_1.default.deepStrictEqual(calls.at(-1)?.args, ['credential', 'reject']);
    node_assert_1.default.deepStrictEqual(meta.data.get(gitCredentials_1.CREDENTIALS_KEY), {});
});
(0, node_test_1.test)('an SSH account has no credential, and an account with no token is skipped without prompting', async () => {
    const { sync, calls, tokens } = setup([['/work/a', ssh], ['/work/b', alice]]);
    tokens.set(alice.id, undefined);
    await sync.sync();
    node_assert_1.default.deepStrictEqual(calls, []);
});
(0, node_test_1.test)('if git cannot run, nothing is recorded as approved, so the next sync tries again', async () => {
    const { sync, calls, failWith, meta } = setup([['/work/a', alice]]);
    failWith(git_1.GIT_UNAVAILABLE);
    await sync.sync();
    node_assert_1.default.deepStrictEqual(meta.data.get(gitCredentials_1.CREDENTIALS_KEY) ?? {}, {});
    failWith(0);
    await sync.sync();
    node_assert_1.default.strictEqual(calls.length, 2);
    node_assert_1.default.deepStrictEqual(meta.data.get(gitCredentials_1.CREDENTIALS_KEY), { a1: { host: 'github.com', username: 'alice' } });
});
(0, node_test_1.test)('a value containing a newline is refused instead of injecting another credential attribute', async () => {
    node_assert_1.default.strictEqual((0, gitCredentials_1.credentialInput)({ host: 'github.com', username: 'alice' }, 'tok\nhost=evil.example'), undefined);
    node_assert_1.default.strictEqual((0, gitCredentials_1.credentialInput)({ host: 'github.com', username: 'a\r\nb' }), undefined);
    const { sync, calls, tokens } = setup([['/work/a', alice]]);
    tokens.set(alice.id, 'tok\nhost=evil.example');
    await sync.sync();
    node_assert_1.default.deepStrictEqual(calls, []);
});
//# sourceMappingURL=gitCredentials.test.js.map
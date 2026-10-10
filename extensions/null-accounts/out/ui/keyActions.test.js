'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const keyActions_1 = require("./keyActions");
const alice = {
    id: 'a1', provider: 'github', host: 'github.com', username: 'alice', email: 'alice@example.com', authMethod: 'oauth', externalId: 'ext',
};
const sshOnly = {
    id: 'a2', provider: 'gitlab', host: 'git.uni.example', username: 'ada', email: 'ada@uni.example', authMethod: 'ssh', sshKeyPath: '/home/me/.ssh/id_uni',
};
const MANAGED = '/home/me/.ssh/null-accounts/github.com_alice_ed25519';
const PUB = { type: 'ssh-ed25519', blob: 'AAAAC3', comment: 'c', line: 'ssh-ed25519 AAAAC3 c' };
function setup(accounts, opts = {}, over = {}) {
    const store = new Map(accounts.map(a => [a.id, a]));
    const log = [];
    const shown = [];
    const updates = [];
    const choices = [...(opts.choices ?? [])];
    const ui = {
        confirm: async (_m, _d, action) => { log.push(`confirm:${action}`); return opts.confirm ?? true; },
        info: async (m) => { shown.push(m); return choices.shift(); },
        warn: async (m) => { shown.push(m); return choices.shift(); },
        copy: async (t) => { log.push(`copy:${t}`); },
        open: async (u) => { log.push(`open:${u}`); },
        pickKeyFile: async () => opts.picked,
    };
    const deps = {
        accounts: {
            get: id => store.get(id),
            update: async (id, patch) => {
                updates.push([id, patch]);
                const next = { ...store.get(id), ...patch };
                store.set(id, next);
                return next;
            },
        },
        getToken: async (_a, scopes, options) => { log.push(`token:${scopes.join(',')}:${options.interactive}`); return 'tok'; },
        ui,
        home: '/home/me',
        hostname: 'PC',
        now: () => new Date('2026-10-09T00:00:00Z'),
        exists: () => true,
        generate: async (input) => { log.push(`generate:${input.host}:${input.username}`); return MANAGED; },
        readPublicKey: () => PUB,
        canSign: async () => ({ ok: true, message: 'ok' }),
        deleteManagedKey: file => { log.push(`delete:${file}`); },
        upload: async (account, _token, _key, title) => { log.push(`upload:${account.host}:${title}`); return { ok: true, already: false }; },
        checkSsh: async () => ({ ok: true, user: 'alice', message: 'Connected to x as alice.' }),
        ...over,
    };
    return { actions: new keyActions_1.KeyActions(deps), log, shown, updates, store };
}
(0, node_test_1.test)('generate creates a key, stores it with signing off, and uploads it when the user agrees', async () => {
    const { actions, log, updates, shown } = setup([alice], { choices: ['Upload to github.com'] });
    await actions.generate('a1');
    node_assert_1.default.ok(log.includes('generate:github.com:alice'));
    node_assert_1.default.deepStrictEqual(updates, [['a1', { sshKeyPath: MANAGED, signCommits: undefined }]]);
    node_assert_1.default.ok(log.includes('token:write:public_key,write:ssh_signing_key:true'));
    node_assert_1.default.ok(log.includes('upload:github.com:Null IDE on PC (2026-10-09)'));
    node_assert_1.default.ok(shown.some(m => /Connected/.test(m)), 'a successful upload is followed by a connection test');
});
(0, node_test_1.test)('generate on an account that already has a key asks first; declining changes nothing', async () => {
    const { actions, log, updates } = setup([{ ...alice, sshKeyPath: '/k/id', signCommits: true }], { confirm: false });
    await actions.generate('a1');
    node_assert_1.default.deepStrictEqual(log, ['confirm:Generate']);
    node_assert_1.default.deepStrictEqual(updates, []);
});
(0, node_test_1.test)('an SSH-only account has no token: upload copies the key and opens the key page instead', async () => {
    const { actions, log } = setup([sshOnly]);
    await actions.upload('a2');
    node_assert_1.default.deepStrictEqual(log, ['copy:ssh-ed25519 AAAAC3 c', 'open:https://git.uni.example/-/user_settings/ssh_keys']);
});
(0, node_test_1.test)('upload without a sign-in explains how to carry on; a refusal from the server is shown as is', async () => {
    const keyed = { ...alice, sshKeyPath: '/k/id' };
    const noToken = setup([keyed], {}, { getToken: async () => undefined });
    await node_assert_1.default.rejects(noToken.actions.upload('a1'), /Re-authenticate/);
    const refused = setup([keyed], {}, { upload: async () => ({ ok: false, message: 'GitHub refused (HTTP 403)' }) });
    await node_assert_1.default.rejects(refused.actions.upload('a1'), /GitHub refused \(HTTP 403\)/);
});
(0, node_test_1.test)('attach refuses a .pub file and otherwise stores the key with signing off, then tests it', async () => {
    const bad = setup([alice], { picked: '/home/me/.ssh/id.pub' });
    await node_assert_1.default.rejects(bad.actions.attach('a1'), /public key/);
    node_assert_1.default.deepStrictEqual(bad.updates, []);
    const good = setup([alice], { picked: '/home/me/.ssh/id_work' });
    await good.actions.attach('a1');
    node_assert_1.default.deepStrictEqual(good.updates, [['a1', { sshKeyPath: '/home/me/.ssh/id_work', signCommits: undefined }]]);
    node_assert_1.default.ok(good.shown.some(m => /Connected/.test(m)));
});
(0, node_test_1.test)('turning signing on is refused, with the reason, when the key cannot sign without a prompt', async () => {
    const locked = setup([{ ...alice, sshKeyPath: '/k/id' }], {}, { canSign: async () => ({ ok: false, message: 'the key has a passphrase' }) });
    await node_assert_1.default.rejects(locked.actions.setSigning('a1', true), /passphrase/);
    node_assert_1.default.deepStrictEqual(locked.updates, []);
    const fine = setup([{ ...alice, sshKeyPath: '/k/id' }]);
    await fine.actions.setSigning('a1', true);
    await fine.actions.setSigning('a1', false);
    node_assert_1.default.deepStrictEqual(fine.updates, [['a1', { signCommits: true }], ['a1', { signCommits: undefined }]]);
});
(0, node_test_1.test)('removing a key Null IDE created deletes the files; a key the user brought is only detached', async () => {
    const managed = setup([{ ...alice, sshKeyPath: MANAGED, signCommits: true }]);
    await managed.actions.removeKey('a1');
    node_assert_1.default.deepStrictEqual(managed.updates, [['a1', { sshKeyPath: undefined, signCommits: undefined }]]);
    node_assert_1.default.deepStrictEqual(managed.log, ['confirm:Delete', `delete:${MANAGED}`]);
    const own = setup([{ ...alice, sshKeyPath: '/home/me/.ssh/id_ed25519' }]);
    await own.actions.removeKey('a1');
    node_assert_1.default.deepStrictEqual(own.log, ['confirm:Stop using']);
    node_assert_1.default.strictEqual(own.updates.length, 1);
});
(0, node_test_1.test)('declining the confirmation keeps the key; an SSH-only account cannot lose its key at all', async () => {
    const declined = setup([{ ...alice, sshKeyPath: MANAGED }], { confirm: false });
    await declined.actions.removeKey('a1');
    node_assert_1.default.deepStrictEqual(declined.updates, []);
    node_assert_1.default.ok(!declined.log.some(l => l.startsWith('delete:')));
    const ssh = setup([sshOnly]);
    await node_assert_1.default.rejects(ssh.actions.removeKey('a2'), /needs its key/);
    node_assert_1.default.deepStrictEqual(ssh.updates, []);
});
(0, node_test_1.test)('test reports a key that belongs to someone else as a warning', async () => {
    const { actions, shown } = setup([{ ...alice, sshKeyPath: '/k/id' }], {}, {
        checkSsh: async () => ({ ok: true, user: 'bob', message: 'Connected to github.com as bob.' }),
    });
    await actions.test('a1');
    node_assert_1.default.match(shown[0], /belongs to bob, not alice/);
});
(0, node_test_1.test)('copyPublic puts the public key line on the clipboard; an account without a key says so', async () => {
    const withKey = setup([{ ...alice, sshKeyPath: '/k/id' }]);
    await withKey.actions.copyPublic('a1');
    node_assert_1.default.deepStrictEqual(withKey.log, ['copy:ssh-ed25519 AAAAC3 c']);
    await node_assert_1.default.rejects(setup([alice]).actions.copyPublic('a1'), /no SSH key/);
    await node_assert_1.default.rejects(setup([]).actions.copyPublic('ghost'), /no longer exists/);
});
//# sourceMappingURL=keyActions.test.js.map
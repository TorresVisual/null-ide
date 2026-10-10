'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { PublicKey } from '../sshKey';
import { Account, NewAccount } from '../types';
import { KeyActions, KeyActionsDeps, KeyUi } from './keyActions';

const alice: Account = {
  id: 'a1', provider: 'github', host: 'github.com', username: 'alice', email: 'alice@example.com', authMethod: 'oauth', externalId: 'ext',
};
const sshOnly: Account = {
  id: 'a2', provider: 'gitlab', host: 'git.uni.example', username: 'ada', email: 'ada@uni.example', authMethod: 'ssh', sshKeyPath: '/home/me/.ssh/id_uni',
};
const MANAGED = '/home/me/.ssh/null-accounts/github.com_alice_ed25519';
const PUB: PublicKey = { type: 'ssh-ed25519', blob: 'AAAAC3', comment: 'c', line: 'ssh-ed25519 AAAAC3 c' };

function setup(
  accounts: Account[],
  opts: { choices?: string[]; confirm?: boolean; picked?: string } = {},
  over: Partial<KeyActionsDeps> = {},
) {
  const store = new Map(accounts.map(a => [a.id, a]));
  const log: string[] = [];
  const shown: string[] = [];
  const updates: Array<[string, Partial<NewAccount>]> = [];
  const choices = [...(opts.choices ?? [])];
  const ui: KeyUi = {
    confirm: async (_m, _d, action) => { log.push(`confirm:${action}`); return opts.confirm ?? true; },
    info: async m => { shown.push(m); return choices.shift(); },
    warn: async m => { shown.push(m); return choices.shift(); },
    copy: async t => { log.push(`copy:${t}`); },
    open: async u => { log.push(`open:${u}`); },
    pickKeyFile: async () => opts.picked,
  };
  const deps: KeyActionsDeps = {
    accounts: {
      get: id => store.get(id),
      update: async (id, patch) => {
        updates.push([id, patch]);
        const next = { ...store.get(id)!, ...patch } as Account;
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
    generate: async input => { log.push(`generate:${input.host}:${input.username}`); return MANAGED; },
    readPublicKey: () => PUB,
    canSign: async () => ({ ok: true, message: 'ok' }),
    deleteManagedKey: file => { log.push(`delete:${file}`); },
    upload: async (account, _token, _key, title) => { log.push(`upload:${account.host}:${title}`); return { ok: true, already: false }; },
    checkSsh: async () => ({ ok: true, user: 'alice', message: 'Connected to x as alice.' }),
    ...over,
  };
  return { actions: new KeyActions(deps), log, shown, updates, store };
}

test('generate creates a key, stores it with signing off, and uploads it when the user agrees', async () => {
  const { actions, log, updates, shown } = setup([alice], { choices: ['Upload to github.com'] });
  await actions.generate('a1');
  assert.ok(log.includes('generate:github.com:alice'));
  assert.deepStrictEqual(updates, [['a1', { sshKeyPath: MANAGED, signCommits: undefined }]]);
  assert.ok(log.includes('token:write:public_key,write:ssh_signing_key:true'));
  assert.ok(log.includes('upload:github.com:Null IDE on PC (2026-10-09)'));
  assert.ok(shown.some(m => /Connected/.test(m)), 'a successful upload is followed by a connection test');
});

test('generate on an account that already has a key asks first; declining changes nothing', async () => {
  const { actions, log, updates } = setup([{ ...alice, sshKeyPath: '/k/id', signCommits: true }], { confirm: false });
  await actions.generate('a1');
  assert.deepStrictEqual(log, ['confirm:Generate']);
  assert.deepStrictEqual(updates, []);
});

test('an SSH-only account has no token: upload copies the key and opens the key page instead', async () => {
  const { actions, log } = setup([sshOnly]);
  await actions.upload('a2');
  assert.deepStrictEqual(log, ['copy:ssh-ed25519 AAAAC3 c', 'open:https://git.uni.example/-/user_settings/ssh_keys']);
});

test('upload without a sign-in explains how to carry on; a refusal from the server is shown as is', async () => {
  const keyed: Account = { ...alice, sshKeyPath: '/k/id' };
  const noToken = setup([keyed], {}, { getToken: async () => undefined });
  await assert.rejects(noToken.actions.upload('a1'), /Re-authenticate/);
  const refused = setup([keyed], {}, { upload: async () => ({ ok: false, message: 'GitHub refused (HTTP 403)' }) });
  await assert.rejects(refused.actions.upload('a1'), /GitHub refused \(HTTP 403\)/);
});

test('attach refuses a .pub file and otherwise stores the key with signing off, then tests it', async () => {
  const bad = setup([alice], { picked: '/home/me/.ssh/id.pub' });
  await assert.rejects(bad.actions.attach('a1'), /public key/);
  assert.deepStrictEqual(bad.updates, []);

  const good = setup([alice], { picked: '/home/me/.ssh/id_work' });
  await good.actions.attach('a1');
  assert.deepStrictEqual(good.updates, [['a1', { sshKeyPath: '/home/me/.ssh/id_work', signCommits: undefined }]]);
  assert.ok(good.shown.some(m => /Connected/.test(m)));
});

test('turning signing on is refused, with the reason, when the key cannot sign without a prompt', async () => {
  const locked = setup([{ ...alice, sshKeyPath: '/k/id' }], {}, { canSign: async () => ({ ok: false, message: 'the key has a passphrase' }) });
  await assert.rejects(locked.actions.setSigning('a1', true), /passphrase/);
  assert.deepStrictEqual(locked.updates, []);

  const fine = setup([{ ...alice, sshKeyPath: '/k/id' }]);
  await fine.actions.setSigning('a1', true);
  await fine.actions.setSigning('a1', false);
  assert.deepStrictEqual(fine.updates, [['a1', { signCommits: true }], ['a1', { signCommits: undefined }]]);
});

test('removing a key Null IDE created deletes the files; a key the user brought is only detached', async () => {
  const managed = setup([{ ...alice, sshKeyPath: MANAGED, signCommits: true }]);
  await managed.actions.removeKey('a1');
  assert.deepStrictEqual(managed.updates, [['a1', { sshKeyPath: undefined, signCommits: undefined }]]);
  assert.deepStrictEqual(managed.log, ['confirm:Delete', `delete:${MANAGED}`]);

  const own = setup([{ ...alice, sshKeyPath: '/home/me/.ssh/id_ed25519' }]);
  await own.actions.removeKey('a1');
  assert.deepStrictEqual(own.log, ['confirm:Stop using']);
  assert.strictEqual(own.updates.length, 1);
});

test('declining the confirmation keeps the key; an SSH-only account cannot lose its key at all', async () => {
  const declined = setup([{ ...alice, sshKeyPath: MANAGED }], { confirm: false });
  await declined.actions.removeKey('a1');
  assert.deepStrictEqual(declined.updates, []);
  assert.ok(!declined.log.some(l => l.startsWith('delete:')));

  const ssh = setup([sshOnly]);
  await assert.rejects(ssh.actions.removeKey('a2'), /needs its key/);
  assert.deepStrictEqual(ssh.updates, []);
});

test('test reports a key that belongs to someone else as a warning', async () => {
  const { actions, shown } = setup([{ ...alice, sshKeyPath: '/k/id' }], {}, {
    checkSsh: async () => ({ ok: true, user: 'bob', message: 'Connected to github.com as bob.' }),
  });
  await actions.test('a1');
  assert.match(shown[0], /belongs to bob, not alice/);
});

test('copyPublic puts the public key line on the clipboard; an account without a key says so', async () => {
  const withKey = setup([{ ...alice, sshKeyPath: '/k/id' }]);
  await withKey.actions.copyPublic('a1');
  assert.deepStrictEqual(withKey.log, ['copy:ssh-ed25519 AAAAC3 c']);
  await assert.rejects(setup([alice]).actions.copyPublic('a1'), /no SSH key/);
  await assert.rejects(setup([]).actions.copyPublic('ghost'), /no longer exists/);
});

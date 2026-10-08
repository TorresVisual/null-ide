'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { GIT_UNAVAILABLE, GitRun } from './git';
import { CREDENTIALS_KEY, credentialInput, CredentialSync } from './gitCredentials';
import { FakeMeta } from './testFakes';
import { Account } from './types';

const alice: Account = {
  id: 'a1', provider: 'github', host: 'github.com', username: 'alice', email: 'alice@example.com', authMethod: 'oauth',
};
const bob: Account = {
  id: 'a2', provider: 'gitlab', host: 'git.example.org:8443', username: 'bob', email: 'bob@example.org', authMethod: 'https',
};
const ssh: Account = { ...alice, id: 'a3', username: 'carol', authMethod: 'ssh', sshKeyPath: '/k' };

function setup(initial: Array<[string, Account]>) {
  const meta = new FakeMeta();
  const accounts = new Map(initial.map(([, a]) => [a.id, a]));
  const bound = new Map(initial.map(([folder, a]) => [folder, a.id]));
  const tokens = new Map<string, string | undefined>(initial.map(([, a]) => [a.id, `token-of-${a.username}`]));
  const calls: Array<{ cwd: string; args: string[]; input?: string }> = [];
  let result = { code: 0, stdout: '', stderr: '' };
  const git: GitRun = async (cwd, args, input) => { calls.push({ cwd, args, input }); return result; };
  const sync = new CredentialSync({
    meta, git, cwd: '/tmp',
    bindings: { entries: () => [...bound.entries()] },
    accounts: { get: id => accounts.get(id) },
    token: async account => tokens.get(account.id),
  });
  return { sync, meta, accounts, bound, tokens, calls, failWith: (code: number) => { result = { code, stdout: '', stderr: 'x' }; } };
}

test('the token reaches git over stdin only, in the credential format, never in the arguments', async () => {
  const { sync, calls } = setup([['/work/a', alice]]);
  await sync.sync();
  assert.deepStrictEqual(calls, [{
    cwd: '/tmp',
    args: ['credential', 'approve'],
    input: 'protocol=https\nhost=github.com\nusername=alice\npassword=token-of-alice\n\n',
  }]);
  assert.ok(!calls[0].args.join(' ').includes('token-of-alice'));
});

test('the same token is approved once; a refreshed token is approved again', async () => {
  const { sync, calls, tokens } = setup([['/work/a', bob]]);
  await sync.sync();
  await sync.sync();
  assert.strictEqual(calls.length, 1);
  tokens.set(bob.id, 'rotated');
  await sync.sync();
  assert.strictEqual(calls.length, 2);
  assert.match(calls[1].input ?? '', /host=git\.example\.org:8443\nusername=bob\npassword=rotated\n/);
});

test('two folders on one account share one credential; it is withdrawn only when the last folder lets go', async () => {
  const { sync, calls, bound } = setup([['/work/a', alice]]);
  bound.set('/work/b', alice.id);
  await sync.sync();
  assert.strictEqual(calls.length, 1);

  bound.delete('/work/a');
  await sync.sync();
  assert.strictEqual(calls.length, 1, 'still used by /work/b, so it stays in the store');

  bound.delete('/work/b');
  await sync.sync();
  assert.deepStrictEqual(calls[1], {
    cwd: '/tmp', args: ['credential', 'reject'], input: 'protocol=https\nhost=github.com\nusername=alice\n\n',
  });
});

test('removing the account withdraws its credential, and the record of it survives a restart', async () => {
  const { sync, calls, accounts, meta } = setup([['/work/a', alice]]);
  await sync.sync();
  assert.deepStrictEqual(meta.data.get(CREDENTIALS_KEY), { a1: { host: 'github.com', username: 'alice' } });
  assert.ok(!JSON.stringify([...meta.data.values()]).includes('token-of-alice'), 'a token was persisted');

  accounts.delete(alice.id);
  const afterRestart = new CredentialSync({
    meta, git: async (cwd, args, input) => { calls.push({ cwd, args, input }); return { code: 0, stdout: '', stderr: '' }; }, cwd: '/tmp',
    bindings: { entries: () => [['/work/a', alice.id]] }, accounts: { get: id => accounts.get(id) }, token: async () => undefined,
  });
  await afterRestart.sync();
  assert.deepStrictEqual(calls.at(-1)?.args, ['credential', 'reject']);
  assert.deepStrictEqual(meta.data.get(CREDENTIALS_KEY), {});
});

test('an SSH account has no credential, and an account with no token is skipped without prompting', async () => {
  const { sync, calls, tokens } = setup([['/work/a', ssh], ['/work/b', alice]]);
  tokens.set(alice.id, undefined);
  await sync.sync();
  assert.deepStrictEqual(calls, []);
});

test('if git cannot run, nothing is recorded as approved, so the next sync tries again', async () => {
  const { sync, calls, failWith, meta } = setup([['/work/a', alice]]);
  failWith(GIT_UNAVAILABLE);
  await sync.sync();
  assert.deepStrictEqual(meta.data.get(CREDENTIALS_KEY) ?? {}, {});
  failWith(0);
  await sync.sync();
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(meta.data.get(CREDENTIALS_KEY), { a1: { host: 'github.com', username: 'alice' } });
});

test('a value containing a newline is refused instead of injecting another credential attribute', async () => {
  assert.strictEqual(credentialInput({ host: 'github.com', username: 'alice' }, 'tok\nhost=evil.example'), undefined);
  assert.strictEqual(credentialInput({ host: 'github.com', username: 'a\r\nb' }), undefined);
  const { sync, calls, tokens } = setup([['/work/a', alice]]);
  tokens.set(alice.id, 'tok\nhost=evil.example');
  await sync.sync();
  assert.deepStrictEqual(calls, []);
});

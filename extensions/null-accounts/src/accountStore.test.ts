'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { ACCOUNTS_KEY, AccountStore } from './accountStore';
import { FakeMeta, FakeVault } from './testFakes';
import { NewAccount } from './types';

function makeStore() {
  let n = 0;
  const meta = new FakeMeta();
  const vault = new FakeVault();
  const store = new AccountStore(meta, vault, () => `id-${++n}`);
  return { store, meta, vault };
}

const octocat: NewAccount = {
  provider: 'github', host: 'github.com', username: 'octocat', email: 'octocat@example.com', authMethod: 'oauth',
};

test('add persists metadata and keeps the secret out of it', async () => {
  const { store, meta, vault } = makeStore();
  const account = await store.add(octocat, 'ghp_supersecret');
  assert.strictEqual(account.id, 'id-1');
  assert.deepStrictEqual(store.list(), [account]);
  assert.strictEqual(await store.getSecret('id-1'), 'ghp_supersecret');
  assert.strictEqual(vault.data.get('null-accounts/id-1'), 'ghp_supersecret');
  assert.ok(!JSON.stringify([...meta.data.entries()]).includes('ghp_supersecret'), 'secret leaked into metadata');
});

test('add without a secret stores no vault entry', async () => {
  const { store, vault } = makeStore();
  await store.add(octocat);
  assert.strictEqual(vault.data.size, 0);
});

test('list returns copies, so callers cannot mutate stored state', async () => {
  const { store } = makeStore();
  await store.add(octocat);
  store.list()[0].username = 'mallory';
  assert.strictEqual(store.list()[0].username, 'octocat');
});

test('add rejects a duplicate provider+host+username, ignoring case and host formatting', async () => {
  const { store } = makeStore();
  await store.add(octocat);
  await assert.rejects(store.add({ ...octocat, username: 'OctoCat', host: 'HTTPS://GITHUB.COM/' }), /already/i);
  assert.strictEqual(store.list().length, 1);
  // Same login on a different host, or a different login on the same host, is fine.
  await store.add({ ...octocat, provider: 'gitlab', host: 'gitlab.com' });
  await store.add({ ...octocat, username: 'hubot' });
  assert.strictEqual(store.list().length, 3);
});

test('a failed add leaves no orphan secret and fires no event', async () => {
  const { store, vault } = makeStore();
  let fired = 0;
  store.onDidChange(() => fired++);
  await assert.rejects(store.add({ ...octocat, host: 'http://github.com' }, 'tok'), /http/i);
  assert.strictEqual(vault.data.size, 0);
  assert.strictEqual(fired, 0);
});

test('update patches fields, fires one event, and rejects a patch that creates a duplicate', async () => {
  const { store } = makeStore();
  const a = await store.add(octocat);
  await store.add({ ...octocat, username: 'hubot' });
  let fired = 0;
  store.onDidChange(() => fired++);

  const updated = await store.update(a.id, { email: 'new@example.com' });
  assert.strictEqual(updated.email, 'new@example.com');
  assert.strictEqual(store.get(a.id)?.email, 'new@example.com');
  assert.strictEqual(fired, 1);

  // Re-saving an account with its own username is not a duplicate of itself.
  await store.update(a.id, { username: 'octocat' });
  await assert.rejects(store.update(a.id, { username: 'hubot' }), /already/i);
  await assert.rejects(store.update('missing', { email: 'x@example.com' }), /no account/i);
});

test('remove deletes the account and its secret and fires one event', async () => {
  const { store, vault } = makeStore();
  const a = await store.add(octocat, 'tok');
  let fired = 0;
  store.onDidChange(() => fired++);
  await store.remove(a.id);
  assert.deepStrictEqual(store.list(), []);
  assert.strictEqual(vault.data.size, 0);
  assert.strictEqual(fired, 1);
});

test('removing an unknown account is a silent no-op', async () => {
  const { store } = makeStore();
  let fired = 0;
  store.onDidChange(() => fired++);
  await store.remove('nope');
  assert.strictEqual(fired, 0);
});

test('list ignores corrupt stored data instead of throwing', async () => {
  const { store, meta } = makeStore();
  meta.data.set(ACCOUNTS_KEY, 'garbage');
  assert.deepStrictEqual(store.list(), []);

  const good = { id: 'g', provider: 'github', host: 'github.com', username: 'u', email: 'u@e.com', authMethod: 'oauth' };
  meta.data.set(ACCOUNTS_KEY, ['x', null, { id: 1 }, { ...good, provider: 'bitbucket' }, good]);
  assert.deepStrictEqual(store.list(), [good]);
});

test('setSecret refuses an unknown account so no orphan secret is created', async () => {
  const { store, vault } = makeStore();
  await assert.rejects(store.setSecret('nope', 'tok'), /no account/i);
  assert.strictEqual(vault.data.size, 0);
  const a = await store.add(octocat);
  await store.setSecret(a.id, 'tok2');
  assert.strictEqual(await store.getSecret(a.id), 'tok2');
});

test('onDidChange listeners can be disposed, and a throwing listener does not break the write or other listeners', async () => {
  const { store } = makeStore();
  let kept = 0;
  let disposed = 0;
  store.onDidChange(() => { throw new Error('bad listener'); });
  store.onDidChange(() => kept++);
  const sub = store.onDidChange(() => disposed++);
  sub.dispose();
  await store.add(octocat);
  assert.strictEqual(kept, 1);
  assert.strictEqual(disposed, 0);
});

test('two overlapping adds of the same account with a secret store only one and leave no orphan secret', async () => {
  const { store, vault } = makeStore();
  const results = await Promise.allSettled([store.add(octocat, 'tok-a'), store.add(octocat, 'tok-b')]);
  assert.deepStrictEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
  assert.strictEqual(store.list().length, 1);
  assert.strictEqual(vault.data.size, 1);
});

test('add removes its freshly stored secret when the metadata write fails', async () => {
  const { store, meta, vault } = makeStore();
  meta.update = async () => { throw new Error('disk full'); };
  await assert.rejects(store.add(octocat, 'tok'), /disk full/);
  assert.strictEqual(vault.data.size, 0);
});

test('list skips an entry whose externalId is not a string', async () => {
  const { store, meta } = makeStore();
  const good = { id: 'g', provider: 'github', host: 'github.com', username: 'u', email: 'u@e.com', authMethod: 'oauth', externalId: '42' };
  meta.data.set(ACCOUNTS_KEY, [good, { ...good, id: 'bad', externalId: 42 }]);
  assert.deepStrictEqual(store.list(), [good]);
});

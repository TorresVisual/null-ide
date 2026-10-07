'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { AccountStore } from './accountStore';
import { addOrRefresh, addOrReuse, findAccount, importExisting } from './accountSetup';
import { ProjectBinding } from './projectBinding';
import { FakeMeta, FakeVault } from './testFakes';
import { NewAccount } from './types';

function setup() {
  let n = 0;
  const meta = new FakeMeta();
  const accounts = new AccountStore(meta, new FakeVault(), () => `id-${++n}`);
  const bindings = new ProjectBinding(meta, 'win32');
  return { accounts, bindings };
}

const octocat: NewAccount = {
  provider: 'github', host: 'github.com', username: 'octocat', email: 'o@e.com', authMethod: 'oauth', externalId: 'vsc-1',
};

test('addOrReuse adds a new account', async () => {
  const { accounts } = setup();
  const account = await addOrReuse(accounts, octocat);
  assert.strictEqual(account.id, 'id-1');
  assert.strictEqual(accounts.list().length, 1);
});

test('addOrReuse reuses an existing account instead of rejecting a duplicate', async () => {
  const { accounts } = setup();
  const first = await addOrReuse(accounts, octocat);
  const again = await addOrReuse(accounts, { ...octocat, username: 'OctoCat' });
  assert.strictEqual(again.id, first.id);
  assert.strictEqual(accounts.list().length, 1);
  assert.strictEqual(findAccount(accounts.list(), { ...octocat, username: 'hubot' }), undefined);
});

test('importExisting binds unbound open folders and leaves existing bindings alone', async () => {
  const { accounts, bindings } = setup();
  await bindings.bind('C:\\a', 'someone-else');
  const account = await importExisting(octocat, ['C:\\a', 'C:\\b'], accounts, bindings);
  assert.strictEqual(bindings.accountIdFor('C:\\a'), 'someone-else');
  assert.strictEqual(bindings.accountIdFor('C:\\b'), account.id);
});

test('importExisting twice does not duplicate the account', async () => {
  const { accounts, bindings } = setup();
  await importExisting(octocat, ['C:\\a'], accounts, bindings);
  await importExisting(octocat, ['C:\\a'], accounts, bindings);
  assert.strictEqual(accounts.list().length, 1);
});

function setupWithVault() {
  let n = 0;
  const vault = new FakeVault();
  const accounts = new AccountStore(new FakeMeta(), vault, () => `id-${++n}`);
  return { accounts, vault };
}

const tanuki: NewAccount = {
  provider: 'gitlab', host: 'gitlab.com', username: 'tanuki', email: 't@e.com', authMethod: 'oauth', externalId: '7',
};

test('addOrRefresh adds a new account together with its tokens', async () => {
  const { accounts, vault } = setupWithVault();
  const account = await addOrRefresh(accounts, tanuki, 'tokens-1');
  assert.strictEqual(accounts.list().length, 1);
  assert.strictEqual(vault.data.get(`null-accounts/${account.id}`), 'tokens-1');
});

test('addOrRefresh on a stored account replaces its tokens instead of failing as a duplicate', async () => {
  const { accounts, vault } = setupWithVault();
  const first = await addOrRefresh(accounts, tanuki, 'tokens-1');
  const again = await addOrRefresh(accounts, { ...tanuki, username: 'Tanuki' }, 'tokens-2');
  assert.strictEqual(again.id, first.id);
  assert.strictEqual(accounts.list().length, 1);
  assert.strictEqual(vault.data.get(`null-accounts/${first.id}`), 'tokens-2');
});

test('addOrRefresh switches a stored account to the new sign-in method along with its secret', async () => {
  const { accounts, vault } = setupWithVault();
  const first = await addOrRefresh(accounts, tanuki, 'oauth-tokens');
  const again = await addOrRefresh(accounts, { ...tanuki, authMethod: 'https', externalId: '9' }, 'glpat-abc');
  assert.strictEqual(again.id, first.id);
  assert.strictEqual(again.authMethod, 'https');
  assert.strictEqual(accounts.get(first.id)?.authMethod, 'https');
  assert.strictEqual(vault.data.get(`null-accounts/${first.id}`), 'glpat-abc');
});

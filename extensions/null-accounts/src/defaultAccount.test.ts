'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { applyDefaultAccount } from './defaultAccount';
import { ProjectBinding } from './projectBinding';
import { FakeMeta } from './testFakes';
import { Account } from './types';

const acct = (id: string, host = 'github.com'): Account =>
  ({ id, provider: 'github', host, username: id, email: `${id}@e.com`, authMethod: 'oauth' });

function setup(origins: Record<string, string> = {}) {
  const bindings = new ProjectBinding(new FakeMeta(), 'linux');
  const list = [acct('a1'), acct('a2', 'gitlab.example.org')];
  const deps = {
    bindings,
    accounts: { list: () => list, get: (id: string) => list.find(a => a.id === id) },
    originUrl: async (folder: string) => origins[folder],
  };
  return { bindings, deps };
}

test('does nothing while no default is set, or when the default account is gone', async () => {
  const { bindings, deps } = setup();
  await applyDefaultAccount(deps, ['/work/a']);
  assert.strictEqual(bindings.accountIdFor('/work/a'), undefined);

  await bindings.setDefault('ghost');
  await applyDefaultAccount(deps, ['/work/a']);
  assert.strictEqual(bindings.accountIdFor('/work/a'), undefined);
});

test('an unbound folder gets the default; a bound one keeps its account', async () => {
  const { bindings, deps } = setup();
  await bindings.setDefault('a1');
  await bindings.bind('/work/b', 'a2');
  await applyDefaultAccount(deps, ['/work/a', '/work/b']);
  assert.strictEqual(bindings.accountIdFor('/work/a'), 'a1');
  assert.strictEqual(bindings.accountIdFor('/work/b'), 'a2');
});

test('an account that matches the origin remote wins over the default', async () => {
  const { bindings, deps } = setup({ '/work/a': 'git@gitlab.example.org:me/app.git' });
  await bindings.setDefault('a1');
  await applyDefaultAccount(deps, ['/work/a']);
  assert.strictEqual(bindings.accountIdFor('/work/a'), 'a2');
});

test('a folder the user unbound is not given the default again', async () => {
  const { bindings, deps } = setup();
  await bindings.setDefault('a1');
  await applyDefaultAccount(deps, ['/work/a']);
  await bindings.unbind('/work/a');
  await applyDefaultAccount(deps, ['/work/a']);
  assert.strictEqual(bindings.accountIdFor('/work/a'), undefined);
});

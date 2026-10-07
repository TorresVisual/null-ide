'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Account } from '../types';
import { bindFolderToAccount, publishAccountsMenu } from './accountsMenuActions';
import { MENU_CONTEXT_KEY, NullAccountsMenuEntry } from './accountsMenuModel';

const acct = (id: string): Account =>
  ({ id, provider: 'github', host: 'github.com', username: id, email: `${id}@e.com`, authMethod: 'oauth' });

function deps(folderPath: string | undefined, accounts: Account[]) {
  const bound: [string, string][] = [];
  return {
    bound,
    deps: {
      folderPath,
      accounts: { get: (id: string) => accounts.find(a => a.id === id) },
      bindings: { bind: async (folder: string, id: string) => { bound.push([folder, id]); } },
    },
  };
}

test('binds the first folder to an existing account', async () => {
  const d = deps('C:/work/repo', [acct('a1')]);
  assert.strictEqual(await bindFolderToAccount(d.deps, 'a1'), 'bound');
  assert.deepStrictEqual(d.bound, [['C:/work/repo', 'a1']]);
});

test('no folder open: nothing is bound', async () => {
  const d = deps(undefined, [acct('a1')]);
  assert.strictEqual(await bindFolderToAccount(d.deps, 'a1'), 'no-folder');
  assert.deepStrictEqual(d.bound, []);
});

test('stale click (account removed since the menu opened), missing or non-string id: nothing is bound', async () => {
  const d = deps('C:/work/repo', [acct('a1')]);
  for (const id of ['gone', undefined, 42, { id: 'a1' }]) {
    assert.strictEqual(await bindFolderToAccount(d.deps, id), 'no-account');
  }
  assert.deepStrictEqual(d.bound, []);
});

test('publishes the model under the menu context key', async () => {
  const calls: [string, unknown][] = [];
  const model: NullAccountsMenuEntry[] = ['separator'];
  await publishAccountsMenu(() => model, async (k, v) => { calls.push([k, v]); });
  assert.deepStrictEqual(calls, [[MENU_CONTEXT_KEY, model]]);
});

test('a throwing model or a rejecting setContext never escapes', async () => {
  await publishAccountsMenu(() => { throw new Error('boom'); }, async () => { assert.fail('must not publish'); });
  await publishAccountsMenu(() => [], async () => { throw new Error('host gone'); });
});

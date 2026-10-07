'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Account } from '../types';
import { accountsMenuModel, ADD_ACCOUNT_COMMAND, BIND_COMMAND, MANAGE_COMMAND } from './accountsMenuModel';

const acct = (id: string, host = 'github.com'): Account =>
  ({ id, provider: 'github', host, username: id, email: `${id}@e.com`, authMethod: 'oauth' });

const ADD = { label: 'Add Account…', command: ADD_ACCOUNT_COMMAND };
const MANAGE = { label: 'Manage Accounts…', command: MANAGE_COMMAND };

test('no accounts: just Add and Manage, no leading separator', () => {
  assert.deepStrictEqual(accountsMenuModel([]), [ADD, MANAGE]);
});

test('each account becomes a row that binds the folder to it, then a separator, then Add and Manage', () => {
  const m = accountsMenuModel([acct('octo'), acct('hub', 'ghe.example.org')]);
  assert.deepStrictEqual(m, [
    { label: 'octo', description: 'github.com', checked: false, command: BIND_COMMAND, args: ['octo'] },
    { label: 'hub', description: 'ghe.example.org', checked: false, command: BIND_COMMAND, args: ['hub'] },
    'separator',
    ADD,
    MANAGE,
  ]);
});

test('only the current account is checked', () => {
  const m = accountsMenuModel([acct('a1'), acct('a2'), acct('a3')], 'a2');
  const checked = m.filter(e => e !== 'separator' && e.checked).map(e => (e as { args?: unknown[] }).args?.[0]);
  assert.deepStrictEqual(checked, ['a2']);
});

test('a current id that is not in the list (removed account) checks nothing', () => {
  const m = accountsMenuModel([acct('a1')], 'gone');
  assert.ok(m.every(e => e === 'separator' || !e.checked));
});

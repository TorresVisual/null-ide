'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Account } from '../types';
import { accountsMenuModel, activityAvatar, ADD_ACCOUNT_COMMAND, BIND_COMMAND, MANAGE_COMMAND } from './accountsMenuModel';

const acct = (id: string, host = 'github.com'): Account =>
  ({ id, provider: 'github', host, username: id, email: `${id}@e.com`, authMethod: 'oauth' });

const ADD = { label: 'Add Account…', icon: 'add', command: ADD_ACCOUNT_COMMAND };
const MANAGE = { label: 'Manage Accounts…', icon: 'gear', command: MANAGE_COMMAND };

test('no accounts: just Add and Manage, no leading separator', () => {
  assert.deepStrictEqual(accountsMenuModel([]), [ADD, MANAGE]);
});

test('each account becomes a row that binds the folder to it, then a separator, then Add and Manage', () => {
  const m = accountsMenuModel([acct('octo'), acct('hub', 'ghe.example.org')]);
  assert.deepStrictEqual(m, [
    { label: 'octo', description: 'github.com', provider: 'github', checked: false, command: BIND_COMMAND, args: ['octo'] },
    { label: 'hub', description: 'ghe.example.org', provider: 'github', checked: false, command: BIND_COMMAND, args: ['hub'] },
    'separator',
    ADD,
    MANAGE,
  ]);
});

test('a Project heading leads the accounts when a folder is open, and never without accounts', () => {
  const m = accountsMenuModel([acct('a1')], undefined, undefined, 'my-repo');
  assert.deepStrictEqual(m[0], { label: 'Project: my-repo', enabled: false, command: MANAGE_COMMAND });
  assert.deepStrictEqual(accountsMenuModel([], undefined, undefined, 'my-repo'), [ADD, MANAGE]);
  assert.ok(!accountsMenuModel([acct('a1')]).some(e => e !== 'separator' && e.enabled === false));
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

test('a row carries its picture only when there is one', () => {
  const m = accountsMenuModel([acct('a1'), acct('a2')], undefined, id => (id === 'a2' ? 'data:image/png;base64,AQID' : undefined));
  assert.ok(!('avatar' in (m[0] as object)));
  assert.strictEqual((m[1] as { avatar?: string }).avatar, 'data:image/png;base64,AQID');
});

test('the activity bar picture is the current account\'s, else the first one found, else empty', () => {
  const pics: Record<string, string> = { a2: 'two', a3: 'three' };
  const of = (id: string) => pics[id];
  const all = [acct('a1'), acct('a2'), acct('a3')];
  assert.strictEqual(activityAvatar(all, 'a3', of), 'three');
  assert.strictEqual(activityAvatar(all, 'a1', of), 'two');
  assert.strictEqual(activityAvatar(all, undefined, of), 'two');
  assert.strictEqual(activityAvatar([acct('a1')], undefined, of), '');
});

'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Account } from '../types';
import { ADD_GITHUB_LABEL, buildPickItems, PickItem, UNBIND_LABEL } from './pickItems';

const acct = (id: string): Account =>
  ({ id, provider: 'github', host: 'github.com', username: id, email: `${id}@e.com`, authMethod: 'oauth' });

const kinds = (items: PickItem[]): string[] =>
  items.map(i => (i.action.kind === 'account' ? i.action.account.id : i.action.kind));

test('the suggested account comes first and is marked; the add action is always last when unbound', () => {
  const items = buildPickItems([acct('a1'), acct('a2'), acct('a3')], { suggestedId: 'a2' });
  assert.deepStrictEqual(kinds(items), ['a2', 'a1', 'a3', 'add']);
  assert.match(items[0].detail ?? '', /suggested/i);
  assert.strictEqual(items[1].detail, undefined);
  assert.strictEqual(items[3].label, ADD_GITHUB_LABEL);
});

test('the current account comes first and is marked, followed by add and "no account"', () => {
  const items = buildPickItems([acct('a1'), acct('a2')], { currentId: 'a2', suggestedId: 'a1' });
  assert.deepStrictEqual(kinds(items), ['a2', 'a1', 'add', 'unbind']);
  assert.strictEqual(items[0].detail, 'Current');
  assert.match(items[1].detail ?? '', /suggested/i);
  assert.strictEqual(items[3].label, UNBIND_LABEL);
});

test('"no account" is offered only when the current account still exists', () => {
  assert.deepStrictEqual(kinds(buildPickItems([acct('a1')])), ['a1', 'add']);
  assert.deepStrictEqual(kinds(buildPickItems([acct('a1')], { currentId: 'deleted' })), ['a1', 'add']);
});

test('with no accounts only the add action remains', () => {
  assert.deepStrictEqual(kinds(buildPickItems([])), ['add']);
});

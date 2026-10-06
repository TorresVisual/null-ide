'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Account } from '../types';
import { ADD_GITHUB_LABEL, buildPickItems } from './pickItems';

const acct = (id: string): Account =>
  ({ id, provider: 'github', host: 'github.com', username: id, email: `${id}@e.com`, authMethod: 'oauth' });

test('the suggested account comes first and is marked; the add action is always last', () => {
  const items = buildPickItems([acct('a1'), acct('a2'), acct('a3')], 'a2');
  assert.deepStrictEqual(items.map(i => i.account?.id), ['a2', 'a1', 'a3', undefined]);
  assert.match(items[0].detail ?? '', /suggested/i);
  assert.strictEqual(items[1].detail, undefined);
  assert.strictEqual(items[3].label, ADD_GITHUB_LABEL);
});

test('without a suggestion the order is unchanged, and with no accounts only the add action remains', () => {
  assert.deepStrictEqual(buildPickItems([acct('a1'), acct('a2')]).map(i => i.account?.id), ['a1', 'a2', undefined]);
  const only = buildPickItems([]);
  assert.strictEqual(only.length, 1);
  assert.strictEqual(only[0].account, undefined);
});

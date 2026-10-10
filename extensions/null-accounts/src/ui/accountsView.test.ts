'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Account } from '../types';
import { buildRows, removeConfirmation } from './accountsView';

const acct = (id: string): Account =>
  ({ id, provider: 'github', host: 'github.com', username: id, email: `${id}@e.com`, authMethod: 'oauth' });

const exists = (key: string) => ({ path: key, exists: true });

test('projects are grouped under their account and sorted by name, ignoring case', () => {
  const rows = buildRows(
    [acct('a1'), acct('a2')],
    [['/work/zeta', 'a1'], ['/work/Alpha', 'a1'], ['/work/mid', 'a2']],
    exists,
  );
  assert.deepStrictEqual(rows[0].projects.map(p => p.name), ['Alpha', 'zeta']);
  assert.deepStrictEqual(rows[1].projects.map(p => p.name), ['mid']);
  assert.strictEqual(rows[0].projects[0].key, '/work/Alpha');
});

test('accounts with no projects get an empty list; bindings to unknown accounts are ignored', () => {
  const rows = buildRows([acct('a1')], [['/work/x', 'ghost']], exists);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0].projects, []);
});

test('the resolved (real-cased) path is shown; a missing or throwing folder falls back to its key', () => {
  const rows = buildRows(
    [acct('a1')],
    [['c:/work/myrepo', 'a1'], ['c:/gone', 'a1'], ['c:/broken', 'a1']],
    key => {
      if (key === 'c:/work/myrepo') { return { path: 'C:\\Work\\MyRepo', exists: true }; }
      if (key === 'c:/broken') { throw new Error('EPERM'); }
      return { path: key, exists: false };
    },
  );
  const byKey = Object.fromEntries(rows[0].projects.map(p => [p.key, p]));
  assert.deepStrictEqual(byKey['c:/work/myrepo'], { key: 'c:/work/myrepo', path: 'C:\\Work\\MyRepo', name: 'MyRepo', exists: true });
  assert.strictEqual(byKey['c:/gone'].exists, false);
  assert.strictEqual(byKey['c:/broken'].exists, false);
  assert.strictEqual(byKey['c:/broken'].name, 'broken');
});

test('rows carry only display fields — no secrets or provider internals', () => {
  const rows = buildRows([{ ...acct('a1'), externalId: 'ext-1' }], [], exists);
  assert.deepStrictEqual(Object.keys(rows[0]).sort(),
    ['authMethod', 'email', 'gitName', 'host', 'id', 'isDefault', 'needsReauth', 'projects', 'provider', 'username']);
});

test('needsReauth is taken from the callback per account and defaults to false', () => {
  assert.strictEqual(buildRows([acct('a1')], [], exists)[0].needsReauth, false);
  const rows = buildRows([acct('a1'), acct('a2')], [], exists, id => id === 'a2');
  assert.deepStrictEqual(rows.map(r => r.needsReauth), [false, true]);
});

test('removeConfirmation counts projects with correct plurals and never claims to sign out', () => {
  const none = removeConfirmation({ username: 'octo', host: 'github.com' }, 0);
  assert.strictEqual(none.message, 'Remove octo@github.com?');
  assert.doesNotMatch(none.detail, /project/);
  assert.match(removeConfirmation({ username: 'o', host: 'h' }, 1).detail, /1 project will lose/);
  assert.match(removeConfirmation({ username: 'o', host: 'h' }, 3).detail, /3 projects will lose/);
  assert.match(none.detail, /not affected/);
});

test('a key row is attached to its account only when one is supplied', () => {
  const key = { path: '/k/id', exists: true, managed: false, signCommits: false, removable: true };
  const rows = buildRows([acct('a1'), acct('a2')], [], exists, () => false, new Map([['a2', key]]));
  assert.ok(!('key' in rows[0]));
  assert.deepStrictEqual(rows[1].key, key);
});

test('a row carries the account picture only when one is supplied', () => {
  const rows = buildRows([acct('a1'), acct('a2')], [], exists, () => false, new Map(), id => (id === 'a2' ? 'data:image/png;base64,AQID' : undefined));
  assert.ok(!('avatar' in rows[0]));
  assert.strictEqual(rows[1].avatar, 'data:image/png;base64,AQID');
});

test('only the default account is flagged as default', () => {
  const rows = buildRows([acct('a1'), acct('a2')], [], exists, undefined, undefined, undefined, 'a2');
  assert.deepStrictEqual(rows.map(r => r.isDefault), [false, true]);
});

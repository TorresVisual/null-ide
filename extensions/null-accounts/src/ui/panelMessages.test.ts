'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { parsePanelMessage } from './panelMessages';

test('well-formed messages parse and drop unknown fields', () => {
  assert.deepStrictEqual(parsePanelMessage({ type: 'ready' }), { type: 'ready' });
  assert.deepStrictEqual(parsePanelMessage({ type: 'add', evil: 1 }), { type: 'add' });
  assert.deepStrictEqual(parsePanelMessage({ type: 'remove', id: 'a1', extra: true }), { type: 'remove', id: 'a1' });
  assert.deepStrictEqual(parsePanelMessage({ type: 'editEmail', id: 'a1' }), { type: 'editEmail', id: 'a1' });
  assert.deepStrictEqual(parsePanelMessage({ type: 'unbind', key: 'c:/repo' }), { type: 'unbind', key: 'c:/repo' });
  assert.deepStrictEqual(parsePanelMessage({ type: 'reauth', id: 'a1', extra: 1 }), { type: 'reauth', id: 'a1' });
});

test('anything else is rejected without throwing', () => {
  for (const bad of [
    undefined, null, 'remove', 42, [], {},
    { type: 'nope' },
    { type: 'remove' }, { type: 'remove', id: '' }, { type: 'remove', id: 7 },
    { type: 'editEmail', id: null },
    { type: 'reauth' }, { type: 'reauth', id: '' },
    { type: 'unbind' }, { type: 'unbind', key: '' }, { type: 'unbind', id: 'a1' },
  ]) {
    assert.strictEqual(parsePanelMessage(bad), undefined, JSON.stringify(bad));
  }
});

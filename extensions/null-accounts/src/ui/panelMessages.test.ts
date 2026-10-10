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

test('key messages carry an account id, and setSigning a real boolean', () => {
  for (const type of ['generateKey', 'attachKey', 'copyPublicKey', 'uploadKey', 'testKey', 'removeKey']) {
    assert.deepStrictEqual(parsePanelMessage({ type, id: 'a1', evil: 1 }), { type, id: 'a1' });
    assert.strictEqual(parsePanelMessage({ type }), undefined, type);
    assert.strictEqual(parsePanelMessage({ type, id: '' }), undefined, type);
  }
  assert.deepStrictEqual(parsePanelMessage({ type: 'setSigning', id: 'a1', on: true }), { type: 'setSigning', id: 'a1', on: true });
  assert.deepStrictEqual(parsePanelMessage({ type: 'setSigning', id: 'a1', on: false }), { type: 'setSigning', id: 'a1', on: false });
  for (const bad of [{ type: 'setSigning', id: 'a1' }, { type: 'setSigning', id: 'a1', on: 'yes' }, { type: 'setSigning', on: true }]) {
    assert.strictEqual(parsePanelMessage(bad), undefined, JSON.stringify(bad));
  }
});

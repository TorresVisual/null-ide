import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// launcher-model.js is a plain script; load it the way the page does and read its globals.
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../ui/launcher-model.js', import.meta.url), 'utf8'), ctx);
const plain = (x) => JSON.parse(JSON.stringify(x)); // arrays from the vm realm fail deepStrictEqual's prototype check

const row = (extra = {}) => ({ pinned: false, missing: false, ...extra });
const key = (k, extra = {}) => plain(ctx.keyAction({ key: k, ctrlKey: false, ...extra }, extra.row));

test('groupRows splits pinned from recent and records where each group starts', () => {
  const rows = [{ id: 1, pinned: true }, { id: 2, pinned: true }, { id: 3, pinned: false }];
  assert.deepEqual(plain(ctx.groupRows(rows)), [
    { title: 'Pinned', start: 0, rows: [rows[0], rows[1]] },
    { title: 'Recent', start: 2, rows: [rows[2]] },
  ]);
});

test('groupRows omits empty groups', () => {
  const recent = [{ pinned: false }, { pinned: false }];
  assert.deepEqual(plain(ctx.groupRows(recent)).map((g) => [g.title, g.start]), [['Recent', 0]]);
  const pinned = [{ pinned: true }];
  assert.deepEqual(plain(ctx.groupRows(pinned)).map((g) => [g.title, g.start]), [['Pinned', 0]]);
  assert.deepEqual(plain(ctx.groupRows([])), []);
});

test('moveSelection wraps both ways and survives an empty list', () => {
  assert.equal(ctx.moveSelection(0, 1, 3), 1);
  assert.equal(ctx.moveSelection(2, 1, 3), 0);
  assert.equal(ctx.moveSelection(0, -1, 3), 2);
  assert.equal(ctx.moveSelection(0, 1, 0), 0);
  assert.equal(ctx.moveSelection(5, -1, 0), 0);
});

test('Enter opens a normal row, and does nothing on a missing row or no row', () => {
  assert.equal(key('Enter', { row: row() }).type, 'open');
  assert.equal(key('Enter', { row: row({ missing: true }) }), null);
  assert.equal(key('Enter', {}), null);
});

test('Escape closes', () => {
  assert.equal(key('Escape', {}).type, 'close');
});

test('arrows move the selection and stop the caret from jumping', () => {
  assert.deepEqual(key('ArrowDown', {}), { type: 'move', delta: 1, preventDefault: true });
  assert.deepEqual(key('ArrowUp', {}), { type: 'move', delta: -1, preventDefault: true });
});

test('Ctrl+P pins and suppresses the print dialog, even with no row', () => {
  assert.deepEqual(key('p', { ctrlKey: true }), { type: 'pin', preventDefault: true });
  assert.deepEqual(key('P', { ctrlKey: true, row: row() }), { type: 'pin', preventDefault: true });
  assert.equal(key('p', {}), null, 'plain p is just text');
});

test('Delete removes an unpinned row, including a missing one, and ignores a pinned row', () => {
  assert.equal(key('Delete', { row: row() }).type, 'remove');
  assert.equal(key('Delete', { row: row({ missing: true }) }).type, 'remove');
  assert.equal(key('Delete', { row: row({ pinned: true }) }), null);
  assert.equal(key('Delete', {}), null);
});

test('a letter key is left to the search box', () => {
  assert.equal(key('a', { row: row() }), null);
});

test('only a blur after the window has had focus closes it', () => {
  assert.equal(ctx.shouldCloseOnBlur(false), false);
  assert.equal(ctx.shouldCloseOnBlur(true), true);
});

test('formatAge', () => {
  const now = 1_000_000_000_000;
  const ago = (ms) => ctx.formatAge(now - ms, now);
  const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
  assert.equal(ago(20 * S), 'just now');
  assert.equal(ago(5 * M), '5m ago');
  assert.equal(ago(3 * H), '3h ago');
  assert.equal(ago(30 * H), 'yesterday');
  assert.equal(ago(4 * D), '4d ago');
  assert.equal(ago(45 * D), '1mo ago');
  assert.equal(ctx.formatAge(now + 5 * M, now), 'just now');
});

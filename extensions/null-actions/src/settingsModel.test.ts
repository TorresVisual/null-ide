'use strict';

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

interface B { id: string; label: string; command: string; type: string; background: string; priority: number; saveAll: boolean; focus: boolean }
interface S { id: string; label: string; command: string }

const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, 'webview-settings-shared.js'), 'utf8'), sandbox);
const m = sandbox as unknown as {
  sortByPriority(b: B[]): B[];
  nextPriority(b: B[]): number;
  moveButton(b: B[], i: number, d: 'up' | 'down'): B[];
  visibleSuggestions(b: B[], s: S[]): S[];
  addSuggestion(b: B[], s: S): B[];
  newButton(b: B[], now?: number): B;
  validate(b: B[]): Array<{ index: number; field: string; message: string }>;
  isDirty(a: unknown[], b: unknown[]): boolean;
};
// Objects built inside the vm context have another realm's prototypes; compare as plain JSON.
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const btn = (id: string, priority: number, extra: Partial<B> = {}): B =>
  ({ id, label: id, command: 'x', type: 'terminal', background: 'none', priority, saveAll: false, focus: true, ...extra });
const ids = (l: B[]) => l.map(b => b.id).join(',');
const prios = (l: B[]) => l.map(b => b.priority).join(',');

test('sortByPriority: descending, stable on ties, input untouched', () => {
  const input = [btn('a', 0), btn('b', 5), btn('c', 0)];
  assert.strictEqual(ids(m.sortByPriority(input)), 'b,a,c');
  assert.strictEqual(ids(input), 'a,b,c');
});

test('moveButton with distinct priorities swaps only the two neighbours', () => {
  const out = m.moveButton([btn('a', 5), btn('b', 3), btn('c', 1)], 1, 'up');
  assert.strictEqual(ids(out), 'b,a,c');
  assert.strictEqual(prios(out), '5,3,1');
});

test('moveButton down swaps with the next', () => {
  const out = m.moveButton([btn('a', 5), btn('b', 3), btn('c', 1)], 0, 'down');
  assert.strictEqual(ids(out), 'b,a,c');
  assert.strictEqual(prios(out), '5,3,1');
});

test('moveButton at the ends is a no-op', () => {
  const list = [btn('a', 2), btn('b', 1)];
  assert.strictEqual(ids(m.moveButton(list, 0, 'up')), 'a,b');
  assert.strictEqual(ids(m.moveButton(list, 1, 'down')), 'a,b');
  assert.strictEqual(ids(m.moveButton(list, 5, 'up')), 'a,b');
});

test('moveButton breaks ties by renumbering downward from 0, never above the gear item', () => {
  const out = m.moveButton([btn('a', 0), btn('b', 0), btn('c', 0)], 2, 'up');
  assert.strictEqual(ids(out), 'a,c,b');
  assert.strictEqual(prios(out), '0,-1,-2');
  assert.ok(out.every(b => b.priority <= 0));
});

test('moveButton renumbers when a tie is elsewhere in the list', () => {
  const out = m.moveButton([btn('a', 9), btn('b', 4), btn('c', 4)], 0, 'down');
  assert.strictEqual(ids(out), 'b,a,c');
  assert.strictEqual(prios(out), '0,-1,-2');
});

test('moveButton does not mutate its input', () => {
  const list = [btn('a', 0), btn('b', 0)];
  m.moveButton(list, 1, 'up');
  assert.strictEqual(prios(list), '0,0');
});

test('nextPriority sits below every button and never above 0', () => {
  assert.strictEqual(m.nextPriority([]), 0);
  assert.strictEqual(m.nextPriority([btn('a', 0), btn('b', -1), btn('c', -2)]), -3);
  assert.strictEqual(m.nextPriority([btn('a', 0)]), -1);
  assert.strictEqual(m.nextPriority([btn('a', 7)]), -1);
});

test('addSuggestion appends once and hides the suggestion afterwards', () => {
  const s = { id: 'cargo-build', label: 'cargo build', command: 'cargo build' };
  const once = m.addSuggestion([btn('a', 0)], s);
  assert.strictEqual(ids(once), 'a,cargo-build');
  assert.strictEqual(once[1].priority, -1);
  assert.strictEqual(m.addSuggestion(once, s), once);
  assert.deepStrictEqual(plain(m.visibleSuggestions(once, [s])), []);
  assert.deepStrictEqual(plain(m.visibleSuggestions([btn('a', 0)], [s])), [s]);
});

test('newButton ids are unique even within the same millisecond', () => {
  const first = m.newButton([], 100);
  const second = m.newButton([first], 100);
  assert.notStrictEqual(first.id, second.id);
  assert.strictEqual(second.priority, -1);
});

test('validate flags empty or blank label and command, and the later duplicate id', () => {
  const errs = plain(m.validate([btn('a', 0, { label: ' ' }), btn('b', 0, { command: '' }), btn('a', 0)]));
  assert.deepStrictEqual(errs.map(e => `${e.index}:${e.field}`), ['0:label', '1:command', '2:id']);
  assert.deepStrictEqual(plain(m.validate([btn("a", 0), btn("b", 0)])), []);
});

test('isDirty: identical lists are clean, any real edit is dirty', () => {
  const list = [btn('a', 2), btn('b', 1)];
  assert.strictEqual(m.isDirty(list, JSON.parse(JSON.stringify(list))), false);
  assert.strictEqual(m.isDirty([btn('a', 2), btn('b', 1, { label: 'x' })], list), true);
  assert.strictEqual(m.isDirty([btn('a', 2)], list), true);
  assert.strictEqual(m.isDirty([btn('a', 3), btn('b', 1)], list), true);
});

test('isDirty ignores representation the host would normalise away', () => {
  const base = btn('a', 0);
  const noisy = { ...base, args: [], icon: '', problemMatcher: '  ', onBusy: 'ask', saveAll: false };
  assert.strictEqual(m.isDirty([noisy], [base]), false);
  assert.strictEqual(m.isDirty([{ ...base, problemMatcher: ' $tsc ' }], [{ ...base, problemMatcher: '$tsc' }]), false);
  assert.strictEqual(m.isDirty([{ ...base, problemMatcher: '$tsc' }], [base]), true);
});

test('isDirty: moving a button and moving it back is clean when priorities are distinct', () => {
  const list = [btn('a', 5), btn('b', 3), btn('c', 1)];
  const moved = m.moveButton(list, 1, 'up');
  assert.strictEqual(m.isDirty(moved, list), true);
  assert.strictEqual(m.isDirty(m.moveButton(moved, 0, 'down'), list), false);
});

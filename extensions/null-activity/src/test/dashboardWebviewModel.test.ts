'use strict';

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

// The webview bundle is a plain script, so load the compiled shared file into a sandbox that has a
// tiny fake `document` (no jsdom) and read its top-level functions off it.
class FakeNode {
  children: FakeNode[] = [];
  attrs: Record<string, string> = {};
  constructor(readonly tag: string, readonly text?: string) {}
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  appendChild(c: FakeNode) {
    this.children.push(c);
    return c;
  }
}

const counter = { elements: 0 };
const document = {
  createElement: (tag: string) => {
    counter.elements++;
    return new FakeNode(tag);
  },
  createTextNode: (text: string) => new FakeNode('#text', text),
};
const sandbox = vm.createContext({ document });
vm.runInContext(readFileSync(path.join(__dirname, '..', 'webview-dashboard-shared.js'), 'utf8'), sandbox);
const w = sandbox as unknown as {
  h(tag: string, attrs?: Record<string, unknown> | null, ...children: unknown[]): FakeNode;
  formatDuration(ms: number): string;
  formatPercent(percent: number, ms: number): string;
  barScale(values: number[], maxPx: number, stubPx: number): number[];
  axisTicks(count: number, max: number): number[];
  barLabel(bar: { label: string; startMs: number; ms: number }): string;
  formatDateTime(ts: number): string;
  filesTitle(files: string[], max: number): string;
  nextIndex(index: number, count: number, key: string): number | undefined;
  formatGit(t: { commits: number; filesChanged: number; linesAdded: number; linesRemoved: number }): { text: string; added: string; removed: string };
};
/** Arrays made inside the vm have another realm's prototype; round-trip them before deepStrictEqual. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

test('h() keeps markup in names inert: one element, text node child, literal attributes', () => {
  counter.elements = 0;
  const evil = '"><img src=x onerror=alert(1)>';
  const row = w.h('li', { 'data-id': evil, title: evil }, evil);
  assert.strictEqual(counter.elements, 1);
  assert.strictEqual(row.attrs['data-id'], evil);
  assert.strictEqual(row.attrs.title, evil);
  assert.strictEqual(row.children.length, 1);
  assert.strictEqual(row.children[0].tag, '#text');
  assert.strictEqual(row.children[0].text, evil);
});

test('h() skips null/undefined/false, sets boolean attributes and nests elements', () => {
  const inner = w.h('b', null, 'x');
  const el = w.h('div', { hidden: true, disabled: false, title: null, 'aria-pressed': 'false' }, null, undefined, false, inner, 'tail');
  assert.deepStrictEqual(plain(el.attrs), { hidden: '', 'aria-pressed': 'false' });
  assert.deepStrictEqual(el.children.map((c) => c.tag), ['b', '#text']);
});

test('formatDuration', () => {
  assert.strictEqual(w.formatDuration(0), '0m');
  assert.strictEqual(w.formatDuration(59_999), '<1m');
  assert.strictEqual(w.formatDuration(60_000), '1m');
  assert.strictEqual(w.formatDuration(3_599_999), '59m');
  assert.strictEqual(w.formatDuration(3_600_000), '1h 0m');
  assert.strictEqual(w.formatDuration((6 * 60 + 42) * 60_000), '6h 42m');
});

test('formatPercent shows "<1%" instead of a misleading 0%', () => {
  assert.strictEqual(w.formatPercent(42, 1000), '42%');
  assert.strictEqual(w.formatPercent(0, 5000), '<1%');
  assert.strictEqual(w.formatPercent(0, 0), '0%');
});

test('barScale: tallest bar fills maxPx, zero buckets keep a stub, all-zero input is all stubs', () => {
  assert.deepStrictEqual(plain(w.barScale([5, 10], 100, 2)), [50, 100]);
  assert.deepStrictEqual(plain(w.barScale([0, 10], 100, 2)), [2, 100]);
  assert.deepStrictEqual(plain(w.barScale([1, 100], 100, 2)), [2, 100]);
  assert.deepStrictEqual(plain(w.barScale([0, 0, 0], 100, 2)), [2, 2, 2]);
  assert.deepStrictEqual(plain(w.barScale([], 100, 2)), []);
});

test('axisTicks labels at most `max` evenly spaced buckets, starting at the first', () => {
  assert.deepStrictEqual(plain(w.axisTicks(24, 6)), [0, 4, 8, 12, 16, 20]);
  assert.deepStrictEqual(plain(w.axisTicks(31, 6)), [0, 6, 12, 18, 24, 30]);
  assert.deepStrictEqual(plain(w.axisTicks(7, 6)), [0, 2, 4, 6]);
  assert.deepStrictEqual(plain(w.axisTicks(1, 6)), [0]);
  assert.deepStrictEqual(plain(w.axisTicks(0, 6)), []);
});

test('barLabel joins label and duration', () => {
  assert.strictEqual(w.barLabel({ label: '14:00', startMs: 0, ms: 90 * 60_000 }), '14:00 · 1h 30m');
});

test('formatDateTime uses local time', () => {
  assert.strictEqual(w.formatDateTime(new Date(2026, 9, 8, 14, 5).getTime()), 'Thu 8 Oct, 14:05');
  assert.strictEqual(w.formatDateTime(new Date(2026, 0, 2, 0, 0).getTime()), 'Fri 2 Jan, 00:00');
});

test('filesTitle lists the files and truncates long lists', () => {
  assert.strictEqual(w.filesTitle([], 3), 'No files');
  assert.strictEqual(w.filesTitle(['a', 'b'], 3), 'a\nb');
  assert.strictEqual(w.filesTitle(['a', 'b', 'c', 'd', 'e'], 3), 'a\nb\nc\n+2 more');
});

test('nextIndex implements tab-list arrow navigation with wrap-around', () => {
  assert.strictEqual(w.nextIndex(0, 5, 'ArrowRight'), 1);
  assert.strictEqual(w.nextIndex(4, 5, 'ArrowRight'), 0);
  assert.strictEqual(w.nextIndex(0, 5, 'ArrowLeft'), 4);
  assert.strictEqual(w.nextIndex(2, 5, 'Home'), 0);
  assert.strictEqual(w.nextIndex(2, 5, 'End'), 4);
  assert.strictEqual(w.nextIndex(2, 5, 'Enter'), undefined);
});

test('formatGit: singular and plural, thousands separators, zero lines', () => {
  assert.deepStrictEqual(plain(w.formatGit({ commits: 1, filesChanged: 1, linesAdded: 0, linesRemoved: 0 })), {
    text: '1 commit · 1 file', added: '+0', removed: '−0',
  });
  assert.deepStrictEqual(plain(w.formatGit({ commits: 12, filesChanged: 40, linesAdded: 1234567, linesRemoved: 89 })), {
    text: '12 commits · 40 files', added: '+1,234,567', removed: '−89',
  });
});

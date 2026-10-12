'use strict';

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

// The webview bundle is a plain script: load the compiled shared file into a sandbox and read its
// top-level functions back. dom.ts only touches `document` when called, so an empty context is enough.
const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, '..', 'webview-report-shared.js'), 'utf8'), sandbox);
const w = sandbox as unknown as {
  formatMs(ms: number | undefined): string;
  formatDelta(ms: number | undefined): string;
  pct(ms: number, spanMs: number): number;
  sortBy<T>(rows: T[], key: (r: T) => number | string | undefined, dir: 1 | -1): T[];
};

test('formatMs and formatDelta', () => {
  assert.strictEqual(w.formatMs(undefined), 'n/a');
  assert.strictEqual(w.formatMs(12.4), '12 ms');
  assert.strictEqual(w.formatMs(1500), '1.50 s');
  assert.strictEqual(w.formatDelta(undefined), 'n/a');
  assert.strictEqual(w.formatDelta(0), '0 ms');
  assert.strictEqual(w.formatDelta(200), '+200 ms');
  assert.strictEqual(w.formatDelta(-1500), '−1.50 s');
});

test('pct clamps to 0..100 and survives a zero span', () => {
  assert.strictEqual(w.pct(50, 200), 25);
  assert.strictEqual(w.pct(500, 200), 100);
  assert.strictEqual(w.pct(-5, 200), 0);
  assert.strictEqual(w.pct(5, 0), 0);
});

test('sortBy orders by key in both directions and always puts undefined last', () => {
  const rows = [{ v: 2 }, { v: undefined }, { v: 1 }, { v: 3 }];
  const key = (r: { v: number | undefined }) => r.v;
  assert.deepStrictEqual(w.sortBy(rows, key, 1).map(key), [1, 2, 3, undefined]);
  assert.deepStrictEqual(w.sortBy(rows, key, -1).map(key), [3, 2, 1, undefined]);
  assert.deepStrictEqual(rows.map(key), [2, undefined, 1, 3], 'input is not mutated');
  assert.deepStrictEqual(w.sortBy([{ v: 'b' }, { v: 'a' }], (r) => r.v, 1).map((r) => r.v), ['a', 'b']);
});

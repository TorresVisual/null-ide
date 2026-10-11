'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { choiceRange, customRange, parseDay, trackedDataReport } from '../privacy';

const at = (day: number, h = 0, month = 9) => new Date(2026, month, day, h).getTime();

test('choiceRange', () => {
  const now = at(8, 15);
  assert.deepStrictEqual(choiceRange('today', now), { from: at(8), to: at(9) });
  assert.deepStrictEqual(choiceRange('last7', now), { from: at(2), to: at(9) });
  assert.deepStrictEqual(choiceRange('month', now), { from: at(1), to: at(1, 0, 10) });
});

test('parseDay accepts only real YYYY-MM-DD dates', () => {
  assert.strictEqual(parseDay('2026-10-08'), at(8));
  for (const bad of ['2026-02-31', '2026-13-01', 'abc', '2026-1-1', '', ' 2026-10-08']) {
    assert.strictEqual(parseDay(bad), undefined, bad);
  }
});

test('customRange includes the end day and rejects reversed or invalid input', () => {
  assert.deepStrictEqual(customRange('2026-10-05', '2026-10-07'), { from: at(5), to: at(8) });
  assert.deepStrictEqual(customRange('2026-10-05', '2026-10-05'), { from: at(5), to: at(6) });
  assert.strictEqual(customRange('2026-10-07', '2026-10-05'), undefined);
  assert.strictEqual(customRange('nope', '2026-10-05'), undefined);
});

test('trackedDataReport lists fields, storage, state and monthly totals', () => {
  const text = trackedDataReport({
    storageDir: 'C:\\store',
    enabled: true,
    months: [{ day: '2026-09-01', ms: 125 * 60_000 }, { day: '2026-10-01', ms: 5 * 60_000 }],
  });
  for (const needle of ['C:\\store', 'on', 'git branch', 'Never recorded', 'unless you publish badges', '2026-09  2h 5m', '2026-10  5m']) {
    assert.ok(text.includes(needle), needle);
  }
  assert.ok(trackedDataReport({ storageDir: 'x', enabled: false, months: [] }).includes('(no data yet)'));
  assert.ok(trackedDataReport({ storageDir: 'x', enabled: false, months: [] }).includes('Tracking: off'));
});

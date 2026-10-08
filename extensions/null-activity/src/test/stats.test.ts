'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import {
  dayKey, dayRange, formatDuration, languageStats, lastDaysRange, mergeClip, monthRange, nextPeriodStart,
  normalizeIntervals, periodStart, periodStats, projectStats, sessions,
} from '../stats';
import { Interval } from '../types';

const MIN = 60_000;
/** Local time; month is zero-based and defaults to October 2026 (Thu 8 Oct 2026). */
const at = (day: number, h: number, m = 0, month = 9) => new Date(2026, month, day, h, m).getTime();
const iv = (start: number, end: number, over: Partial<Interval> = {}): Interval => ({
  start, end, project: { key: 'k', name: 'proj' }, language: 'typescript', file: 'a.ts', linesAdded: 0, linesRemoved: 0, ...over,
});

test('weeks start on Monday and months on the 1st (local time)', () => {
  assert.strictEqual(periodStart(at(4, 12), 'week'), at(28, 0, 0, 8)); // Sun 4 Oct -> Mon 28 Sep
  assert.strictEqual(periodStart(at(5, 0), 'week'), at(5, 0)); // Monday stays
  assert.strictEqual(periodStart(at(8, 23, 59), 'week'), at(5, 0));
  assert.strictEqual(nextPeriodStart(at(8, 9), 'week'), at(12, 0));
  assert.strictEqual(periodStart(at(31, 23, 59), 'month'), at(1, 0));
  assert.strictEqual(nextPeriodStart(at(31, 23, 59), 'month'), at(1, 0, 0, 10));
  assert.strictEqual(dayKey(at(8, 0)), '2026-10-08');
});

test('day boundaries are local midnights even across DST changes', () => {
  let ts = new Date(2026, 0, 1).getTime();
  for (let n = 0; n < 365; n++) {
    const next = nextPeriodStart(ts, 'day');
    assert.ok(next - ts >= 23 * 3_600_000 && next - ts <= 25 * 3_600_000);
    assert.notStrictEqual(dayKey(next), dayKey(ts));
    ts = next;
  }
});

test('range helpers cover today, the last N days and the month', () => {
  assert.deepStrictEqual(dayRange(at(8, 15)), { from: at(8, 0), to: at(9, 0) });
  assert.deepStrictEqual(lastDaysRange(at(8, 15), 7), { from: at(2, 0), to: at(9, 0) });
  assert.deepStrictEqual(monthRange(at(8, 15)), { from: at(1, 0), to: at(1, 0, 0, 10) });
});

test('mergeClip drops duplicates and clips overlaps so two windows never double-count', () => {
  const a = iv(at(8, 10), at(8, 10, 10));
  const b = iv(at(8, 10, 5), at(8, 10, 15));
  const inside = iv(at(8, 10, 2), at(8, 10, 4));
  const merged = mergeClip([b, a, a, inside]);
  assert.deepStrictEqual(merged.map((i) => [i.start, i.end]), [[at(8, 10), at(8, 10, 10)], [at(8, 10, 10), at(8, 10, 15)]]);
  assert.strictEqual(projectStats([a, b], dayRange(at(8, 12)))[0].ms, 15 * MIN);
});

test('an interval crossing midnight is split per day; lines stay with the day it started', () => {
  const i = iv(at(7, 23, 30), at(8, 0, 30), { linesAdded: 4 });
  const days = periodStats([i], { from: at(1, 0), to: at(31, 0) }, 'day');
  assert.deepStrictEqual(days, [{ day: '2026-10-07', ms: 30 * MIN }, { day: '2026-10-08', ms: 30 * MIN }]);
  const oct8 = projectStats([i], dayRange(at(8, 12)))[0];
  assert.deepStrictEqual([oct8.ms, oct8.linesAdded], [30 * MIN, 0]);
  assert.strictEqual(projectStats([i], dayRange(at(7, 12)))[0].linesAdded, 4);
});

test('week buckets start on Monday; month buckets split at month end', () => {
  const sun = iv(at(4, 10), at(4, 11));
  const mon = iv(at(5, 10), at(5, 11));
  assert.deepStrictEqual(periodStats([sun, mon], { from: at(1, 0), to: at(31, 0) }, 'week'), [
    { day: '2026-09-28', ms: 60 * MIN },
    { day: '2026-10-05', ms: 60 * MIN },
  ]);
  const crossing = iv(at(31, 23, 30), at(1, 0, 30, 10));
  assert.deepStrictEqual(periodStats([crossing], { from: at(1, 0), to: at(30, 0, 0, 10) }, 'month'), [
    { day: '2026-10-01', ms: 30 * MIN },
    { day: '2026-11-01', ms: 30 * MIN },
  ]);
});

test('normalizeIntervals clips to the range', () => {
  const got = normalizeIntervals([iv(at(8, 9), at(8, 11), { linesAdded: 5 })], { from: at(8, 10), to: at(8, 12) });
  assert.deepStrictEqual(got.map((i) => [i.start, i.end, i.linesAdded]), [[at(8, 10), at(8, 11), 0]]);
});

test('projectStats groups by key, counts distinct files, uses the latest name and sorts by time', () => {
  const day = dayRange(at(8, 12));
  const p1 = { key: 'p1', name: 'old-name' };
  const stats = projectStats(
    [
      iv(at(8, 9), at(8, 10), { project: p1, file: 'a.ts', linesAdded: 2, linesRemoved: 1 }),
      iv(at(8, 11), at(8, 11, 30), { project: { key: 'p1', name: 'new-name' }, file: 'b.ts', linesAdded: 1 }),
      iv(at(8, 12), at(8, 12, 10), { project: { key: 'p2', name: 'other' }, file: undefined }),
    ],
    { from: at(8, 0), to: at(9, 0) },
  );
  assert.deepStrictEqual(stats, [
    { project: { key: 'p1', name: 'new-name' }, ms: 90 * MIN, files: 2, linesAdded: 3, linesRemoved: 1 },
    { project: { key: 'p2', name: 'other' }, ms: 10 * MIN, files: 0, linesAdded: 0, linesRemoved: 0 },
  ]);
  assert.ok(day.to > day.from);
});

test('languageStats sums time per language, largest first', () => {
  assert.deepStrictEqual(
    languageStats(
      [iv(at(8, 9), at(8, 9, 10)), iv(at(8, 10), at(8, 10, 30), { language: 'rust' }), iv(at(8, 11), at(8, 11, 5))],
      dayRange(at(8, 12)),
    ),
    [{ language: 'rust', ms: 30 * MIN }, { language: 'typescript', ms: 15 * MIN }],
  );
});

test('sessions split on gaps over sessionGap; a gap of exactly sessionGap stays in one', () => {
  const a = iv(at(8, 9), at(8, 9, 30), { file: 'a.ts' });
  const b = iv(at(8, 9, 40), at(8, 10), { file: 'b.ts', language: 'rust' });
  const c = iv(at(8, 10, 16), at(8, 10, 30), { project: { key: 'p2', name: 'two' } });
  const d = iv(at(8, 10, 45), at(8, 11));
  const got = sessions([a, b, c, d], dayRange(at(8, 12)), 15 * MIN);
  assert.strictEqual(got.length, 2);
  assert.deepStrictEqual([got[0].start, got[0].end, got[0].durationMs], [at(8, 9), at(8, 10), 50 * MIN]);
  assert.deepStrictEqual(got[0].languages, ['typescript', 'rust']);
  assert.deepStrictEqual(got[0].files, ['a.ts', 'b.ts']);
  assert.deepStrictEqual([got[1].start, got[1].end, got[1].durationMs], [at(8, 10, 16), at(8, 11), 29 * MIN]);
  assert.deepStrictEqual(got[1].projects.map((p) => p.key), ['p2', 'k']);
});

test('formatDuration', () => {
  assert.strictEqual(formatDuration(0), '0m');
  assert.strictEqual(formatDuration(59_000), '0m');
  assert.strictEqual(formatDuration(12 * MIN), '12m');
  assert.strictEqual(formatDuration((4 * 60 + 32) * MIN), '4h 32m');
});

'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { BadgeSource, buildBadges } from '../badgeModel';

const MIN = 60_000;
const source = (days: number[], languages: Array<[string, number]>): BadgeSource => ({
  getDailyStats: () => days.map((ms, n) => ({ day: `2026-10-0${n + 1}`, ms })),
  getLanguageStats: () => languages.map(([language, ms]) => ({ language, ms })),
});
const values = (s: BadgeSource) => buildBadges(s).map((b) => b.value);

test('empty log: zeros and "none", never NaN', () => {
  assert.deepStrictEqual(values(source([], [])), ['0m', '0m', 'none']);
});

test('total is the sum of all days; the average is over days with time', () => {
  const badges = buildBadges(source([120 * MIN, 60 * MIN], [['typescript', 180 * MIN]]));
  assert.deepStrictEqual(badges.map((b) => b.value), ['3h 0m', '1h 30m', 'typescript']);
  assert.deepStrictEqual(badges.map((b) => b.label), ['coding time', 'daily average', 'top language']);
  assert.deepStrictEqual(badges.map((b) => b.file), [
    'null-activity-total.svg', 'null-activity-daily-average.svg', 'null-activity-top-language.svg',
  ]);
});

test('top language skips terminal/unknown time', () => {
  assert.strictEqual(values(source([60 * MIN], [['', 50 * MIN], ['rust', 10 * MIN]]))[2], 'rust');
  assert.strictEqual(values(source([60 * MIN], [['', 60 * MIN]]))[2], 'none');
});

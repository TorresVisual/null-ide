'use strict';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeUpdate, todayMs } from './dashboardHome';

test('homeUpdate is absent without an available update and ready only when the staged zip is verified', () => {
  assert.equal(homeUpdate(undefined, undefined), undefined);
  assert.deepEqual(homeUpdate({ latest: '1.4.0' }, undefined), { version: '1.4.0', ready: false });
  assert.deepEqual(homeUpdate({ latest: '1.4.0' }, { version: '1.4.0', verified: false }), { version: '1.4.0', ready: false });
  assert.deepEqual(homeUpdate({ latest: '1.4.0' }, { version: '1.3.9', verified: true }), { version: '1.4.0', ready: false });
  assert.deepEqual(homeUpdate({ latest: '1.4.0' }, { version: '1.4.0', verified: true }), { version: '1.4.0', ready: true });
});

test('todayMs sums the buckets from local midnight and is undefined without null-activity', () => {
  const now = new Date(2026, 9, 10, 15, 30).getTime();
  let range = { from: 0, to: 0 };
  const total = todayMs({ getDailyStats: r => { range = r; return [{ ms: 60_000 }, { ms: 120_000 }]; } }, now);
  assert.equal(total, 180_000);
  assert.equal(range.from, new Date(2026, 9, 10).getTime());
  assert.ok(range.to > now);
  assert.equal(todayMs(undefined, now), undefined);
});

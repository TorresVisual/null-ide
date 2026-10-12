'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { normalizeRetention, normalizeSlowMs } from '../settings';

test('normalizeRetention clamps to 1..200 and defaults to 20', () => {
  assert.strictEqual(normalizeRetention(undefined), 20);
  assert.strictEqual(normalizeRetention('5'), 20);
  assert.strictEqual(normalizeRetention(0), 1);
  assert.strictEqual(normalizeRetention(5.4), 5);
  assert.strictEqual(normalizeRetention(9999), 200);
});

test('normalizeSlowMs accepts non-negative numbers, defaults to 100', () => {
  assert.strictEqual(normalizeSlowMs(undefined), 100);
  assert.strictEqual(normalizeSlowMs(-1), 100);
  assert.strictEqual(normalizeSlowMs(Number.NaN), 100);
  assert.strictEqual(normalizeSlowMs(0), 0);
  assert.strictEqual(normalizeSlowMs(250), 250);
});

'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { assignLanes, incrementalImpact, unionMs } from '../intervals';

test('unionMs does not double-count overlap', () => {
  assert.strictEqual(unionMs([]), 0);
  assert.strictEqual(unionMs([{ start: 0, end: 10 }, { start: 5, end: 15 }]), 15);
  assert.strictEqual(unionMs([{ start: 0, end: 10 }, { start: 20, end: 30 }]), 20);
  assert.strictEqual(unionMs([{ start: 0, end: 10 }, { start: 2, end: 4 }]), 10);
});

test('two extensions running over the same 500 ms add 500 ms, not 1000 ms', () => {
  const spans = [{ start: 1000, end: 1500 }, { start: 1000, end: 1500 }];
  const impact = incrementalImpact(spans);
  assert.strictEqual(impact.reduce((a, b) => a + b, 0), 500);
  assert.strictEqual(unionMs(spans), 500);
});

test('incrementalImpact attributes overlap to the earlier-starting span', () => {
  assert.deepStrictEqual(incrementalImpact([{ start: 0, end: 10 }, { start: 5, end: 15 }]), [10, 5]);
  assert.deepStrictEqual(incrementalImpact([{ start: 5, end: 15 }, { start: 0, end: 10 }]), [5, 10], 'result keeps input order');
  assert.deepStrictEqual(incrementalImpact([{ start: 0, end: 10 }, { start: 2, end: 4 }]), [10, 0]);
  assert.deepStrictEqual(incrementalImpact([{ start: 0, end: 10 }, { start: 10, end: 20 }]), [10, 10]);
  assert.deepStrictEqual(incrementalImpact([{ start: 5, end: 5 }, { start: 9, end: 3 }]), [0, 0], 'empty or reversed spans add nothing');
});

test('assignLanes packs non-overlapping spans into the same lane', () => {
  const lanes = assignLanes([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 10, end: 20 }, undefined]);
  assert.deepStrictEqual(lanes, [0, 1, 0, 0]);
});

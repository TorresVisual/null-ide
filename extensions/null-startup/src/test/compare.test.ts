/// <reference path="../protocol.ts" />
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { baselineOf, compare, medianBaseline } from '../compare';
import { fmtMs, stamp } from '../format';
import { Report } from '../types';

const report = (id: string, headline: number | undefined, phases: Record<string, number>, exts: Record<string, number>): Report => ({
  schemaVersion: 1, id, windowId: 'w', takenAt: 1, appVersion: '1', initialStartup: true, partial: false, headlineMs: headline,
  milestones: [],
  phases: Object.entries(phases).map(([id, durationMs]) => ({ id, label: id.toUpperCase(), process: 'renderer' as const, durationMs })),
  extensions: Object.entries(exts).map(([id, totalMs]) => ({ id, activationEvent: '*', reason: id, eager: true, deferred: false, totalMs })),
});

test('a slowdown above both thresholds is a regression; small or relative-tiny ones are not', () => {
  const base = baselineOf(report('a', 1000, { storage: 100, big: 2000 }, { 'p.x': 40 }));
  const cur = report('b', 1300, { storage: 110, big: 2100 }, { 'p.x': 160 });
  const c = compare(cur, base, 'previous');
  assert.strictEqual(c.headline.deltaMs, 300);
  assert.strictEqual(c.headline.regression, true);
  const phase = Object.fromEntries(c.phases.map((p) => [p.id, p]));
  assert.strictEqual(phase['storage'].regression, false, '+10 ms is under 50 ms');
  assert.strictEqual(phase['big'].regression, false, '+100 ms but only 5 %');
  assert.strictEqual(c.extensions[0].id, 'p.x');
  assert.strictEqual(c.extensions[0].regression, true);
  assert.strictEqual(c.baseLabel, 'previous');
});

test('rows are sorted by slowdown and keep entries present on only one side', () => {
  const base = baselineOf(report('a', 1000, { gone: 50 }, {}));
  const cur = report('b', undefined, { fresh: 70 }, {});
  const c = compare(cur, base, 'x');
  const gone = c.phases.find((p) => p.id === 'gone')!;
  const fresh = c.phases.find((p) => p.id === 'fresh')!;
  assert.strictEqual(gone.deltaMs, undefined);
  assert.strictEqual(fresh.deltaMs, undefined);
  assert.strictEqual(fresh.label, 'FRESH');
  assert.strictEqual(c.headline.deltaMs, undefined);
  assert.strictEqual(c.headline.regression, false);
});

test('medianBaseline takes the median per key over the launches that have it', () => {
  const m = medianBaseline([
    report('a', 100, { p: 10 }, { e: 1 }), report('b', 300, { p: 30 }, {}), report('c', 200, {}, { e: 5 }), report('d', 400, { p: 20 }, {}),
  ]);
  assert.strictEqual(m.headlineMs, 250);
  assert.strictEqual(m.phases['p'], 20);
  assert.strictEqual(m.extensions['e'], 3);
  assert.deepStrictEqual(medianBaseline([]), { headlineMs: undefined, phases: {}, extensions: {} });
});

test('format helpers', () => {
  assert.strictEqual(fmtMs(undefined), 'n/a');
  assert.strictEqual(fmtMs(12.4), '12 ms');
  assert.strictEqual(fmtMs(1500), '1.50 s');
  assert.match(stamp(Date.now()), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

/// <reference path="../protocol.ts" />
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { buildViewModel, parseWebviewMessage } from '../reportModel';
import { Report } from '../types';

const report = (id: string, takenAt: number, headlineMs: number | undefined, over: Partial<Report> = {}): Report => ({
  schemaVersion: 1, id, windowId: 'w', takenAt, appVersion: '1.0', initialStartup: true, partial: false, headlineMs,
  milestones: [{ id: 'workspaceRestored', label: 'Workspace restored', atMs: headlineMs }],
  phases: [
    { id: 'p1', label: 'Phase 1', process: 'renderer', startMs: 0, endMs: 300, durationMs: 300, impactMs: 300 },
    { id: 'p2', label: 'Phase 2', process: 'renderer', startMs: 100, endMs: 150, durationMs: 50, impactMs: 0 },
    { id: 'p3', label: 'Phase 3', process: 'main' },
  ],
  extensions: [
    { id: 'p.a', activationEvent: '*', reason: '', eager: true, deferred: false, startMs: 0, endMs: 400, totalMs: 400, impactMs: 400 },
    { id: 'p.b', activationEvent: '*', reason: '', eager: true, deferred: false, startMs: 100, endMs: 200, totalMs: 30, impactMs: 0 },
    { id: 'p.c', activationEvent: '*', reason: '', eager: false, deferred: true },
  ],
  ...over,
});

const history = [report('c', 3000, 1200), report('b', 2000, 1000), report('a', 1000, 900)];

test('no history gives an empty, usable model', () => {
  const m = buildViewModel([], { baseline: 'previous', slowMs: 100 });
  assert.strictEqual(m.hasReport, false);
  assert.deepStrictEqual([m.phases, m.extensions, m.launches], [[], [], []]);
  assert.ok(m.spanMs >= 1);
});

test('selects the newest report by default, flags slow extensions, assigns lanes, ranks the slowest', () => {
  const m = buildViewModel(history, { baseline: 'none', slowMs: 100 });
  assert.strictEqual(m.reportId, 'c');
  assert.strictEqual(m.headlineMs, 1200);
  assert.strictEqual(m.launches.length, 3);
  const e = Object.fromEntries(m.extensions.map((x) => [x.id, x]));
  assert.strictEqual(e['p.a'].slow, true);
  assert.strictEqual(e['p.b'].slow, false);
  assert.strictEqual(e['p.c'].slow, false, 'unknown total is never slow');
  assert.deepStrictEqual([e['p.a'].lane, e['p.b'].lane], [0, 1], 'overlapping activations get separate lanes');
  assert.deepStrictEqual(m.slowestPhases.map((p) => p.id), ['p1'], 'p2 is fully covered by p1, so it adds no wall-clock time');
  assert.deepStrictEqual(m.slowestExtensions.map((x) => x.id), ['p.a', 'p.b']);
  assert.strictEqual(m.spanMs, 1200);
  assert.strictEqual(m.comparison, undefined);
});

test('baseline previous compares with the next older launch; median with all others', () => {
  const prev = buildViewModel(history, { baseline: 'previous', slowMs: 100 });
  assert.strictEqual(prev.comparison!.headline.baseMs, 1000);
  assert.strictEqual(prev.comparison!.headline.deltaMs, 200);
  const med = buildViewModel(history, { baseline: 'median', slowMs: 100 });
  assert.strictEqual(med.comparison!.headline.baseMs, 950);
  const oldest = buildViewModel(history, { selectedId: 'a', baseline: 'previous', slowMs: 100 });
  assert.strictEqual(oldest.comparison, undefined, 'nothing older to compare with');
});

test('a selected id that no longer exists falls back to the newest', () => {
  assert.strictEqual(buildViewModel(history, { selectedId: 'gone', baseline: 'none', slowMs: 100 }).reportId, 'c');
});

test('parseWebviewMessage accepts only well-formed intents', () => {
  assert.deepStrictEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'copy' }), { type: 'copy' });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'select', reportId: 'a' }), { type: 'select', reportId: 'a' });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'setBaseline', baseline: 'median' }), { type: 'setBaseline', baseline: 'median' });
  for (const bad of [null, 'x', {}, { type: 'select' }, { type: 'select', reportId: 5 }, { type: 'setBaseline', baseline: 'weird' }, { type: 'nope' }]) {
    assert.strictEqual(parseWebviewMessage(bad), undefined);
  }
});

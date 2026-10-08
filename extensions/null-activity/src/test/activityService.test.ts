'use strict';

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { ActivityService, ActivitySettings, normalizeSettings } from '../activityService';
import { IntervalStore } from '../intervalStore';
import { dayRange } from '../stats';
import { Heartbeat } from '../types';

const MIN = 60_000;
const at = (day: number, h: number, m = 0, s = 0) => new Date(2026, 9, day, h, m, s).getTime();
const hb = (ts: number, over: Partial<Heartbeat> = {}): Heartbeat => ({
  ts, language: 'typescript', file: 'a.ts', workspace: '/w', isWrite: false, linesAdded: 0, linesRemoved: 0, ...over,
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-svc-'));
  let now = at(8, 9);
  const settings: ActivitySettings = { enabled: true, idleTimeoutMs: 2 * MIN, sessionGapMs: 15 * MIN };
  const service = new ActivityService({
    store: new IntervalStore({ dir, windowId: 'w1' }),
    clock: () => now,
    settings: () => settings,
    resolveProject: (w) => ({ key: w ?? '(no folder)', name: 'proj' }),
  });
  return { service, settings, dir, at: (t: number) => { now = t; } };
}

const day = dayRange(at(8, 12));

test('the open interval is visible through the API; closing fires onDidChange and refreshes reads', () => {
  const { service } = setup();
  let changes = 0;
  service.onDidChange(() => changes++);
  service.recordActivity(hb(at(8, 9)));
  service.recordActivity(hb(at(8, 9, 1)));
  assert.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 9), at(8, 9, 1)]]);
  assert.strictEqual(changes, 0);
  service.recordActivity(hb(at(8, 9, 30), { file: 'b.ts' })); // gap > idle: closes at the last heartbeat
  assert.strictEqual(changes, 1);
  assert.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 9), at(8, 9, 1)]]);
});

test('daily, project, language, session and monthly stats are derived from the log', () => {
  const { service, settings } = setup();
  settings.idleTimeoutMs = 20 * MIN; // heartbeats below are minutes apart
  service.refresh();
  service.recordActivity(hb(at(8, 9), { linesAdded: 3 }));
  service.recordActivity(hb(at(8, 9, 10)));
  service.recordActivity(hb(at(8, 9, 11), { language: 'rust', file: 'b.rs' }));
  service.recordActivity(hb(at(8, 9, 15), { language: 'rust', file: 'b.rs' }));
  service.endSession();
  assert.deepStrictEqual(service.getDailyStats(day), [{ day: '2026-10-08', ms: 15 * MIN }]);
  assert.deepStrictEqual(service.getLanguageStats(day).map((l) => l.language).sort(), ['rust', 'typescript']);
  const [project] = service.getProjectStats(day);
  assert.deepStrictEqual([project.ms, project.files, project.linesAdded], [15 * MIN, 2, 3]);
  assert.strictEqual(service.getSessions(day).length, 1);
  assert.deepStrictEqual(service.getMonthlyTotals(), [{ day: '2026-10-01', ms: 15 * MIN }]);
});

test('turning the master switch off closes the open interval and stops collection', () => {
  const { service, settings, at: setNow } = setup();
  service.recordActivity(hb(at(8, 9)));
  service.recordActivity(hb(at(8, 9, 1)));
  setNow(at(8, 9, 2));
  settings.enabled = false;
  service.refresh();
  assert.strictEqual(service.enabled, false);
  assert.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 9), at(8, 9, 2)]]);
  service.recordActivity(hb(at(8, 9, 3)));
  service.startSession(); // no-op while disabled
  service.recordActivity(hb(at(8, 9, 4)));
  service.recordActivity(hb(at(8, 9, 5)));
  assert.strictEqual(service.getIntervals(day).length, 1);
  settings.enabled = true;
  service.refresh();
  service.recordActivity(hb(at(8, 9, 10)));
  service.recordActivity(hb(at(8, 9, 11)));
  assert.strictEqual(service.getIntervals(day).length, 2);
});

test('pauseSession stops counting until startSession', () => {
  const { service, at: setNow } = setup();
  service.recordActivity(hb(at(8, 9)));
  setNow(at(8, 9, 1));
  service.pauseSession();
  service.recordActivity(hb(at(8, 9, 2)));
  service.recordActivity(hb(at(8, 9, 3)));
  assert.strictEqual(service.getIntervals(day).length, 1);
  service.startSession();
  service.recordActivity(hb(at(8, 9, 4)));
  service.recordActivity(hb(at(8, 9, 5)));
  assert.strictEqual(service.getIntervals(day).length, 2);
});

test('deleting a range while an interval is open does not bring the interval back', () => {
  const { service, at: setNow } = setup();
  service.recordActivity(hb(at(8, 9)));
  service.recordActivity(hb(at(8, 9, 1)));
  setNow(at(8, 9, 1, 30));
  service.deleteRange(day);
  assert.deepStrictEqual(service.getIntervals(day), []);
  service.recordActivity(hb(at(8, 9, 2)));
  service.recordActivity(hb(at(8, 9, 3)));
  assert.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 9, 2), at(8, 9, 3)]]);
  service.deleteAll();
  assert.deepStrictEqual(service.getIntervals(day), []);
});

test('normalizeSettings clamps nonsense to sane values', () => {
  const d = { enabled: true, idleTimeoutMs: 120_000, sessionGapMs: 15 * MIN };
  assert.deepStrictEqual(normalizeSettings({}), d);
  assert.deepStrictEqual(normalizeSettings({ enabled: false }), { ...d, enabled: false });
  assert.strictEqual(normalizeSettings({ idleTimeout: 0 }).idleTimeoutMs, 10_000);
  assert.strictEqual(normalizeSettings({ idleTimeout: -5 }).idleTimeoutMs, 10_000);
  assert.strictEqual(normalizeSettings({ idleTimeout: Number.NaN }).idleTimeoutMs, 120_000);
  assert.strictEqual(normalizeSettings({ idleTimeout: 'abc' }).idleTimeoutMs, 120_000);
  assert.strictEqual(normalizeSettings({ idleTimeout: 1e9 }).idleTimeoutMs, 3_600_000);
  assert.strictEqual(normalizeSettings({ sessionGap: 0 }).sessionGapMs, MIN);
  assert.strictEqual(normalizeSettings({ sessionGap: 1e9 }).sessionGapMs, 1_440 * MIN);
});

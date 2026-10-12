'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { buildReport } from '../buildReport';
import { Snapshot, SnapshotExtension } from '../types';

const mark = (source: string, name: string, startTime: number) => ({ source, name, startTime });
const ext = (over: Partial<SnapshotExtension> & { id: string }): SnapshotExtension => ({ activationEvent: '*', reason: over.id, eager: true, ...over });

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: 1, takenAt: 9000, appVersion: '1.2.3', initialStartup: true, metrics: {}, contributions: [],
    marks: [
      mark('main', 'code/didStartMain', 1000),
      mark('main', 'code/willCreateCodeWindow', 1100),
      mark('main', 'code/didCreateCodeWindow', 1200),
      mark('renderer', 'code/willStartWorkbench', 1500),
      mark('renderer', 'code/didStartWorkbench', 2000),
      mark('renderer', 'code/willRestoreEditors', 2000),
      mark('renderer', 'code/didRestoreEditors', 2500),
    ],
    extensions: [
      ext({ id: 'p.fast', startMs: 1100, endMs: 1900, loadMs: 10, callMs: 20, resolveMs: 30, activationEvent: 'workspaceContains:C:\\Users\\me\\x' }),
      ext({ id: 'p.late', startMs: 2000, endMs: 3000, loadMs: 1, callMs: 2, resolveMs: 3 }),
      ext({ id: 'p.lazy', eager: false, activationEvent: 'onLanguage:rust' }),
    ],
    ...over,
  };
}

test('milestones are offsets from launch and the headline is workspaceRestored', () => {
  const r = buildReport(snapshot(), { id: 'r1', windowId: 'w1' });
  const at = Object.fromEntries(r.milestones.map((m) => [m.id, m.atMs]));
  assert.deepStrictEqual(at, { windowCreated: 200, uiInteractive: 1000, workspaceRestored: 1500, extensionsSettled: 2000 });
  assert.strictEqual(r.headlineMs, 1500);
  assert.strictEqual(r.partial, false);
  assert.strictEqual(r.id, 'r1');
  assert.strictEqual(r.windowId, 'w1');
});

test('later windows start at willOpenNewWindow, falling back to timeOrigin', () => {
  const s = snapshot({ initialStartup: false, marks: [mark('renderer', 'code/willOpenNewWindow', 100), mark('renderer', 'code/didRestoreEditors', 400)] });
  assert.strictEqual(buildReport(s, { id: 'a', windowId: 'w' }).headlineMs, 300);
  const t = snapshot({ marks: [mark('renderer', 'code/timeOrigin', 50), mark('renderer', 'code/didRestoreEditors', 90)] });
  assert.strictEqual(buildReport(t, { id: 'a', windowId: 'w' }).headlineMs, 40);
});

test('phases have durations and wall-clock impact; missing marks give undefined, not errors', () => {
  const r = buildReport(snapshot(), { id: 'r', windowId: 'w' });
  const byId = Object.fromEntries(r.phases.map((p) => [p.id, p]));
  assert.deepStrictEqual([byId['window-create'].startMs, byId['window-create'].endMs, byId['window-create'].durationMs], [100, 200, 100]);
  assert.strictEqual(byId['workbench'].durationMs, 500);
  assert.strictEqual(byId['editors'].durationMs, 500);
  assert.strictEqual(byId['workbench'].impactMs, 500);
  assert.strictEqual(byId['editors'].impactMs, 500);
  assert.strictEqual(byId['storage'].durationMs, undefined, 'no storage marks in this snapshot');
  assert.strictEqual(byId['storage'].impactMs, undefined);
});

test('extensions split into startup and deferred, with sanitized events and totals', () => {
  const r = buildReport(snapshot(), { id: 'r', windowId: 'w' });
  const byId = Object.fromEntries(r.extensions.map((e) => [e.id, e]));
  assert.strictEqual(byId['p.fast'].deferred, false, 'ended (1900) before restored (2500)');
  assert.strictEqual(byId['p.fast'].totalMs, 60);
  assert.strictEqual(byId['p.fast'].activationEvent, 'workspaceContains');
  assert.deepStrictEqual([byId['p.fast'].startMs, byId['p.fast'].endMs], [100, 900]);
  assert.strictEqual(byId['p.late'].deferred, true, 'ended after restored');
  assert.strictEqual(byId['p.lazy'].deferred, true, 'no stamps and not eager');
  assert.strictEqual(byId['p.lazy'].totalMs, undefined);
});

test('overlapping activations are not double-counted in impact', () => {
  const s = snapshot({ extensions: [ext({ id: 'a', startMs: 1100, endMs: 1600 }), ext({ id: 'b', startMs: 1100, endMs: 1600 })] });
  const r = buildReport(s, { id: 'r', windowId: 'w' });
  assert.strictEqual(r.extensions.reduce((sum, e) => sum + (e.impactMs ?? 0), 0), 500);
});

test('a snapshot with no marks is partial and every offset is undefined', () => {
  const r = buildReport(snapshot({ marks: [], extensions: [ext({ id: 'a', startMs: 5, endMs: 9 })] }), { id: 'r', windowId: 'w' });
  assert.strictEqual(r.partial, true);
  assert.strictEqual(r.headlineMs, undefined);
  assert.ok(r.milestones.every((m) => m.atMs === undefined));
  assert.ok(r.phases.every((p) => p.durationMs === undefined));
  assert.strictEqual(r.extensions[0].startMs, undefined);
  assert.strictEqual(r.extensions[0].deferred, false, 'eager and no restored mark: falls back to the eager flag');
});

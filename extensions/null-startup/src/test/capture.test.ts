'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Capture, CaptureDeps, SETTLE_DELAY_MS } from '../capture';
import { Report, Snapshot } from '../types';

const snap = (extra = 0): Snapshot => ({
  schemaVersion: 1, takenAt: 5000, appVersion: '1', initialStartup: true, metrics: {}, contributions: [],
  marks: [{ source: 'main', name: 'code/didStartMain', startTime: 1000 }, { source: 'renderer', name: 'code/didRestoreEditors', startTime: 2000 }],
  extensions: Array.from({ length: extra }, (_, i) => ({ id: `p.e${i}`, activationEvent: '*', reason: '', eager: true })),
});

function harness(results: (Snapshot | undefined | Error)[]) {
  const saved: Report[] = [];
  const scheduled: { fn: () => void; ms: number; disposed: boolean }[] = [];
  const logs: string[] = [];
  let calls = 0;
  const deps: CaptureDeps = {
    snapshot: async () => {
      const r = results[Math.min(calls++, results.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
    save: async (r) => void saved.push(r),
    now: () => 777,
    windowId: 'win',
    schedule: (fn, ms) => {
      const entry = { fn, ms, disposed: false };
      scheduled.push(entry);
      return { dispose: () => void (entry.disposed = true) };
    },
    log: (m) => void logs.push(m),
    onSaved: () => {},
  };
  return { capture: new Capture(deps), saved, scheduled, logs };
}

test('saves a report at once and rewrites the same id after the settle delay', async () => {
  const h = harness([snap(0), snap(2)]);
  await h.capture.run();
  assert.strictEqual(h.saved.length, 1);
  assert.strictEqual(h.saved[0].id, '777-win');
  assert.strictEqual(h.scheduled[0].ms, SETTLE_DELAY_MS);
  h.scheduled[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(h.saved.length, 2);
  assert.strictEqual(h.saved[1].id, '777-win');
  assert.strictEqual(h.saved[1].extensions.length, 2, 'the later snapshot supersedes the first');
});

test('no snapshot (stock VS Code): nothing saved, nothing scheduled', async () => {
  const h = harness([undefined]);
  await h.capture.run();
  assert.deepStrictEqual([h.saved.length, h.scheduled.length], [0, 0]);
});

test('a failing second snapshot keeps the first report', async () => {
  const h = harness([snap(1), new Error('boom')]);
  await h.capture.run();
  h.scheduled[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(h.saved.length, 1);
  assert.ok(h.logs.some((l) => l.includes('boom')));
});

test('dispose cancels the pending second snapshot', async () => {
  const h = harness([snap(0)]);
  await h.capture.run();
  h.capture.dispose();
  assert.strictEqual(h.scheduled[0].disposed, true);
});

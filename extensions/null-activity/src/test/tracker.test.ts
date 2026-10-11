'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Tracker, lineDelta } from '../tracker';
import { Heartbeat, Interval } from '../types';

const IDLE = 900_000;

function setup() {
  let now = 0;
  let resolved = 0;
  const out: Interval[] = [];
  const tracker = new Tracker({
    clock: () => now,
    idleTimeoutMs: () => IDLE,
    resolveProject: (w) => {
      resolved++;
      return { key: w ?? '(no folder)', name: 'proj', branch: 'main' };
    },
    onInterval: (i) => out.push(i),
  });
  return { tracker, out, at: (ms: number) => { now = ms; }, resolveCount: () => resolved };
}

function hb(ts: number, over: Partial<Heartbeat> = {}): Heartbeat {
  return { ts, language: 'typescript', file: 'a.ts', workspace: '/w', isWrite: false, linesAdded: 0, linesRemoved: 0, ...over };
}

test('heartbeats within the idle timeout merge into one interval closed by tick()', () => {
  const { tracker, out, at, resolveCount } = setup();
  tracker.heartbeat(hb(1_000, { linesAdded: 2 }));
  tracker.heartbeat(hb(61_000, { linesAdded: 3, linesRemoved: 1 }));
  tracker.heartbeat(hb(100_000));
  assert.strictEqual(out.length, 0);
  at(100_000 + IDLE + 1);
  tracker.tick();
  assert.deepStrictEqual(out, [
    { start: 1_000, end: 100_000, project: { key: '/w', name: 'proj' }, language: 'typescript', file: 'a.ts', branch: 'main', linesAdded: 5, linesRemoved: 1 },
  ]);
  assert.strictEqual(resolveCount(), 1, 'project resolved once per interval, not per heartbeat');
});

test('a gap longer than the idle timeout closes at the last heartbeat and opens a new interval', () => {
  const { tracker, out } = setup();
  tracker.heartbeat(hb(0));
  tracker.heartbeat(hb(10_000));
  tracker.heartbeat(hb(10_000 + IDLE + 1));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].start, 0);
  assert.strictEqual(out[0].end, 10_000);
  tracker.heartbeat(hb(10_000 + IDLE + 1_001));
  assert.strictEqual(tracker.peek()?.start, 10_000 + IDLE + 1);
  assert.strictEqual(tracker.peek()?.end, 10_000 + IDLE + 1_001);
});

test('a lone heartbeat that goes stale produces no interval', () => {
  const { tracker, out, at } = setup();
  tracker.heartbeat(hb(0));
  at(IDLE + 1);
  tracker.tick();
  assert.strictEqual(out.length, 0);
  assert.strictEqual(tracker.peek(), undefined);
});

test('tick() only closes when the gap is strictly greater than the idle timeout', () => {
  const { tracker, out, at } = setup();
  tracker.heartbeat(hb(0));
  tracker.heartbeat(hb(10_000));
  at(10_000 + IDLE);
  tracker.tick();
  assert.strictEqual(out.length, 0);
  at(10_000 + IDLE + 1);
  tracker.tick();
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 10_000]]);
});

test('switching file, language or project closes at the switch and re-resolves the project', () => {
  const changes: Partial<Heartbeat>[] = [{ file: 'b.ts' }, { language: 'json' }, { workspace: '/other' }];
  for (const change of changes) {
    const { tracker, out, at, resolveCount } = setup();
    tracker.heartbeat(hb(0));
    tracker.heartbeat(hb(30_000, { ...change, linesAdded: 4 }));
    assert.strictEqual(out.length, 1, JSON.stringify(change));
    assert.deepStrictEqual([out[0].start, out[0].end], [0, 30_000]);
    assert.strictEqual(resolveCount(), 2);
    tracker.heartbeat(hb(40_000, change));
    tracker.closeOpen();
    assert.deepStrictEqual([out[1].start, out[1].end, out[1].linesAdded], [30_000, 40_000, 4]);
  }
});

test('a window that is never focused still accrues time, and a long silence is not credited', () => {
  const { tracker, out, at } = setup();
  tracker.heartbeat(hb(0));
  tracker.heartbeat(hb(10_000));
  at(10_000 + IDLE + 5_000);
  tracker.closeOpen();
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 10_000]], 'ends at the last heartbeat, not at the closing time');
});

test('a clock that jumps backwards never yields negative or inflated time', () => {
  const { tracker, out, at } = setup();
  tracker.heartbeat(hb(100_000));
  tracker.heartbeat(hb(150_000));
  tracker.heartbeat(hb(50_000));
  tracker.heartbeat(hb(60_000));
  at(60_000);
  tracker.closeOpen();
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[100_000, 150_000], [50_000, 60_000]]);
  assert.ok(out.every((i) => i.end > i.start));
});

test('sleep/wake: a heartbeat hours later does not credit the gap', () => {
  const { tracker, out } = setup();
  tracker.heartbeat(hb(0));
  tracker.heartbeat(hb(5_000));
  tracker.heartbeat(hb(8 * 3_600_000));
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 5_000]]);
});

test('setActive(false) closes the open interval and ignores heartbeats until re-enabled', () => {
  const { tracker, out, at } = setup();
  tracker.heartbeat(hb(0));
  tracker.heartbeat(hb(10_000));
  at(20_000);
  tracker.setActive(false);
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 10_000]]);
  tracker.heartbeat(hb(30_000));
  tracker.setActive(true);
  tracker.heartbeat(hb(40_000));
  tracker.heartbeat(hb(50_000));
  at(50_000);
  tracker.closeOpen();
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 10_000], [40_000, 50_000]]);
});

test('peek() runs the open interval up to now while within the idle timeout, without closing it', () => {
  const { tracker, out, at } = setup();
  assert.strictEqual(tracker.peek(), undefined);
  tracker.heartbeat(hb(0));
  assert.strictEqual(tracker.peek(), undefined, 'a single heartbeat has no duration yet');
  tracker.heartbeat(hb(5_000));
  at(5_000);
  assert.deepStrictEqual([tracker.peek()?.start, tracker.peek()?.end], [0, 5_000]);
  at(8_000);
  assert.strictEqual(tracker.peek()?.end, 8_000);
  at(5_000 + IDLE);
  assert.strictEqual(tracker.peek()?.end, 5_000 + IDLE);
  at(5_000 + IDLE + 1);
  assert.strictEqual(tracker.peek()?.end, 5_000, 'idle past the timeout: back to the last heartbeat');
  assert.strictEqual(out.length, 0);
});

test('lineDelta counts inserted newlines and removed lines', () => {
  const range = (a: number, b: number) => ({ start: { line: a }, end: { line: b } });
  assert.deepStrictEqual(lineDelta([{ text: 'a\nb\n', range: range(3, 3) }]), { linesAdded: 2, linesRemoved: 0 });
  assert.deepStrictEqual(lineDelta([{ text: '', range: range(3, 5) }]), { linesAdded: 0, linesRemoved: 2 });
  assert.deepStrictEqual(lineDelta([{ text: 'x\r\ny', range: range(4, 4) }]), { linesAdded: 1, linesRemoved: 0 });
  assert.deepStrictEqual(
    lineDelta([{ text: 'a\n', range: range(0, 0) }, { text: '', range: range(9, 10) }]),
    { linesAdded: 1, linesRemoved: 1 },
  );
});

test('lineDelta ignores a single change that inserts more than 50 lines (paste / agent write)', () => {
  const range = { start: { line: 0 }, end: { line: 0 } };
  assert.strictEqual(lineDelta([{ text: '\n'.repeat(50), range }]).linesAdded, 50);
  assert.strictEqual(lineDelta([{ text: '\n'.repeat(51), range }]).linesAdded, 0);
  assert.strictEqual(lineDelta([{ text: '\n'.repeat(51), range }, { text: 'a\n', range }]).linesAdded, 1);
});

'use strict';

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { IntervalStore, newWindowId } from '../intervalStore';
import { dayRange } from '../stats';
import { Interval } from '../types';

const at = (day: number, h: number, m = 0, month = 9) => new Date(2026, month, day, h, m).getTime();
const iv = (start: number, end: number, over: Partial<Interval> = {}): Interval => ({
  start, end, project: { key: 'k', name: 'proj' }, language: 'typescript', file: 'a.ts', linesAdded: 0, linesRemoved: 0, ...over,
});
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-store-'));
const byStart = (a: Interval, b: Interval) => a.start - b.start;

test('append + flush + read round-trips and merges the files of two windows', () => {
  const dir = tmpDir();
  const a = new IntervalStore({ dir, windowId: 'w1' });
  const b = new IntervalStore({ dir, windowId: 'w2' });
  a.append(iv(at(8, 10), at(8, 11)));
  b.append(iv(at(8, 12), at(8, 13)));
  a.flush();
  b.flush();
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['intervals-2026-10-w1.jsonl', 'intervals-2026-10-w2.jsonl']);
  const got = a.read(dayRange(at(8, 12))).sort(byStart);
  assert.deepStrictEqual(got.map((i) => i.start), [at(8, 10), at(8, 12)]);
  assert.deepStrictEqual(a.read(dayRange(at(9, 12))), [], 'other days are filtered out');
});

test('unflushed intervals are readable', () => {
  const store = new IntervalStore({ dir: tmpDir(), windowId: 'w1' });
  store.append(iv(at(8, 10), at(8, 11)));
  assert.strictEqual(store.read(dayRange(at(8, 12))).length, 1);
});

test('a torn last line is skipped and a later append to the same file is still readable', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'intervals-2026-10-old.jsonl'), JSON.stringify(iv(at(8, 9), at(8, 10))) + '\n{"start":5,"en');
  const store = new IntervalStore({ dir, windowId: 'old' });
  assert.strictEqual(store.read(dayRange(at(8, 12))).length, 1);
  store.append(iv(at(8, 11), at(8, 12)));
  store.flush();
  assert.strictEqual(new IntervalStore({ dir, windowId: 'other' }).read(dayRange(at(8, 12))).length, 2);
});

test('a corrupt file never blocks the others', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'intervals-2026-10-bad.jsonl'), '\u0000\u0000 garbage\nnull\n[]\n{"start":"x"}\n{"start":5,"end":3}\n');
  const store = new IntervalStore({ dir, windowId: 'w1' });
  store.append(iv(at(8, 10), at(8, 11)));
  store.flush();
  assert.strictEqual(store.read(dayRange(at(8, 12))).length, 1);
});

test('an interval crossing a month end is split across two files; lines stay on the first piece', () => {
  const dir = tmpDir();
  const store = new IntervalStore({ dir, windowId: 'w1' });
  store.append(iv(at(31, 23, 50), at(1, 0, 10, 10), { linesAdded: 3 }));
  store.flush();
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['intervals-2026-10-w1.jsonl', 'intervals-2026-11-w1.jsonl']);
  const got = store.read({ from: at(1, 0), to: at(30, 0, 0, 10) }).sort(byStart);
  assert.deepStrictEqual(
    got.map((i) => [i.start, i.end, i.linesAdded]),
    [[at(31, 23, 50), at(1, 0, 0, 10), 3], [at(1, 0, 0, 10), at(1, 0, 10, 10), 0]],
  );
});

test('deleteRange removes overlapping intervals (flushed and buffered) and empty files', () => {
  const dir = tmpDir();
  const store = new IntervalStore({ dir, windowId: 'w1' });
  store.append(iv(at(7, 10), at(7, 11)));
  store.append(iv(at(8, 10), at(8, 11)));
  store.append(iv(at(8, 23, 30), at(9, 0, 30)));
  store.append(iv(at(9, 10), at(9, 11)));
  store.flush();
  store.append(iv(at(8, 14), at(8, 15))); // still buffered
  store.deleteRange(dayRange(at(8, 12)));
  const left = store.read({ from: 0, to: Number.MAX_SAFE_INTEGER }).sort(byStart);
  assert.deepStrictEqual(left.map((i) => i.start), [at(7, 10), at(9, 10)]);

  const loneDir = tmpDir();
  const lone = new IntervalStore({ dir: loneDir, windowId: 'w1' });
  lone.append(iv(at(8, 10), at(8, 11)));
  lone.flush();
  lone.deleteRange(dayRange(at(8, 12)));
  assert.deepStrictEqual(fs.readdirSync(loneDir), []);
});

test('deleteAll removes every file and the buffer', () => {
  const dir = tmpDir();
  const a = new IntervalStore({ dir, windowId: 'w1' });
  const b = new IntervalStore({ dir, windowId: 'w2' });
  a.append(iv(at(8, 10), at(8, 11)));
  b.append(iv(at(9, 10), at(9, 11)));
  b.flush();
  a.flush();
  a.append(iv(at(10, 10), at(10, 11)));
  a.deleteAll();
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  assert.deepStrictEqual(a.read({ from: 0, to: Number.MAX_SAFE_INTEGER }), []);
});

test('an unwritable storage dir logs, keeps the data in memory, never throws, and retries', () => {
  const dir = path.join(tmpDir(), 'blocked');
  fs.writeFileSync(dir, 'a file where the directory should be');
  const logs: string[] = [];
  const store = new IntervalStore({ dir, windowId: 'w1', log: (m) => logs.push(m) });
  store.append(iv(at(8, 10), at(8, 11)));
  assert.doesNotThrow(() => store.flush());
  assert.ok(logs.length > 0);
  assert.strictEqual(store.read(dayRange(at(8, 12))).length, 1, 'still readable from memory');
  fs.rmSync(dir);
  store.flush();
  assert.strictEqual(fs.readdirSync(dir).length, 1, 'retried successfully');
});

test('the in-memory buffer is capped, dropping the oldest', () => {
  const dir = path.join(tmpDir(), 'blocked');
  fs.writeFileSync(dir, 'x');
  const store = new IntervalStore({ dir, windowId: 'w1', maxBuffered: 2, log: () => {} });
  store.append(iv(at(8, 10), at(8, 11)));
  store.append(iv(at(8, 12), at(8, 13)));
  store.append(iv(at(8, 14), at(8, 15)));
  const got = store.read(dayRange(at(8, 12))).sort(byStart);
  assert.deepStrictEqual(got.map((i) => i.start), [at(8, 12), at(8, 14)]);
});

test('replaceWindow swaps one window\'s files, splits months, can be repeated and can empty the window', () => {
  const dir = tmpDir();
  const native = new IntervalStore({ dir, windowId: 'w1' });
  native.append(iv(at(8, 9), at(8, 10)));
  native.flush();
  const store = new IntervalStore({ dir, windowId: 'w2' });
  assert.strictEqual(store.hasWindow('import-wakatime'), false);

  store.replaceWindow('import-wakatime', [iv(at(8, 10), at(8, 11)), iv(at(30, 23, 0, 8), at(1, 1, 0, 9))]);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), [
    'intervals-2026-09-import-wakatime.jsonl',
    'intervals-2026-10-import-wakatime.jsonl',
    'intervals-2026-10-w1.jsonl',
  ]);
  assert.strictEqual(store.hasWindow('import-wakatime'), true);

  store.replaceWindow('import-wakatime', [iv(at(8, 12), at(8, 13))]);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['intervals-2026-10-import-wakatime.jsonl', 'intervals-2026-10-w1.jsonl']);
  const all = { from: -Infinity, to: Infinity };
  assert.deepStrictEqual(store.read(all).sort(byStart).map((i) => i.start), [at(8, 9), at(8, 12)]);

  store.replaceWindow('import-wakatime', []);
  assert.strictEqual(store.hasWindow('import-wakatime'), false);
  assert.deepStrictEqual(fs.readdirSync(dir), ['intervals-2026-10-w1.jsonl']);
});

test('replaceWindow keeps every interval even beyond maxBuffered', () => {
  const store = new IntervalStore({ dir: tmpDir(), windowId: 'w1', maxBuffered: 10 });
  const many = Array.from({ length: 2_000 }, (_, n) => iv(at(8, 0) + n * 120_000, at(8, 0) + n * 120_000 + 60_000));
  store.replaceWindow('import-wakatime', many);
  assert.strictEqual(store.read({ from: -Infinity, to: Infinity }).length, 2_000);
});

test('read tags every interval with its window: files by file name, the unflushed buffer with its own id', () => {
  const dir = tmpDir();
  const a = new IntervalStore({ dir, windowId: 'w1' });
  const b = new IntervalStore({ dir, windowId: 'w2' });
  a.append(iv(at(8, 10), at(8, 11)));
  a.flush();
  b.append(iv(at(8, 12), at(8, 13)));
  fs.writeFileSync(path.join(dir, 'intervals-2026-10-import-wakatime.jsonl'), JSON.stringify(iv(at(8, 14), at(8, 15))) + '\n');
  const got = a.read(dayRange(at(8, 12))).sort(byStart);
  assert.deepStrictEqual(got.map((i) => i.window), ['w1', 'import-wakatime'], 'a does not see the unflushed buffer of b');
  const own = b.read(dayRange(at(8, 12))).sort(byStart);
  assert.deepStrictEqual(own.map((i) => i.window), ['w1', 'w2', 'import-wakatime']);
  assert.strictEqual(b.windowId, 'w2');
});

test('the window tag is never written to disk, not even by deleteRange', () => {
  const dir = tmpDir();
  const store = new IntervalStore({ dir, windowId: 'w1' });
  store.append(iv(at(8, 10), at(8, 11)));
  store.append(iv(at(9, 10), at(9, 11)));
  store.flush();
  store.deleteRange(dayRange(at(9, 12)));
  const text = fs.readFileSync(path.join(dir, 'intervals-2026-10-w1.jsonl'), 'utf8');
  assert.ok(!text.includes('"window"'), text);
  assert.strictEqual(store.read({ from: at(1, 0), to: at(30, 0) }).length, 1);
});

test('newWindowId yields a fresh filename-safe id on every call', () => {
  const ids = new Set(Array.from({ length: 50 }, () => newWindowId()));
  assert.strictEqual(ids.size, 50);
  assert.ok([...ids].every((id) => /^[0-9a-f]{10}$/.test(id)));
});

test('own data is tagged with the machine; cached data of another machine is read, tagged and replaced wholesale', () => {
  const dir = tmpDir();
  const store = new IntervalStore({ dir, windowId: 'w1', machineId: 'aaaaaaaaaa' });
  store.append(iv(at(8, 10), at(8, 11)));
  store.replaceRemote('bbbbbbbbbb', '2026-10', [iv(at(8, 12), at(8, 13), { window: 'x1' })]);
  const day = dayRange(at(8, 12));
  assert.deepStrictEqual(store.read(day).sort(byStart).map((i) => [i.machine, i.window]), [['aaaaaaaaaa', 'w1'], ['bbbbbbbbbb', 'x1']]);
  store.replaceRemote('bbbbbbbbbb', '2026-10', [iv(at(8, 14), at(8, 15))]);
  assert.deepStrictEqual(store.read(day).filter((i) => i.machine === 'bbbbbbbbbb').map((i) => [i.start, i.window]), [[at(8, 14), '']]);
  assert.deepStrictEqual(store.remoteMonths(), [{ machine: 'bbbbbbbbbb', month: '2026-10' }]);
  assert.deepStrictEqual(store.read(dayRange(at(8, 12, 0, 10))), [], 'other months are not read');
  store.removeRemote('bbbbbbbbbb', '2026-10');
  assert.deepStrictEqual(store.remoteMonths(), []);
});

test('deleting data only touches this machine; exportOwn lists every window of a month with its window id', () => {
  const dir = tmpDir();
  const a = new IntervalStore({ dir, windowId: 'w1', machineId: 'aaaaaaaaaa' });
  const b = new IntervalStore({ dir, windowId: 'w2', machineId: 'aaaaaaaaaa' });
  a.append(iv(at(8, 10), at(8, 11)));
  b.append(iv(at(8, 12), at(8, 13)));
  a.append(iv(at(8, 10, 0, 10), at(8, 11, 0, 10)));
  a.replaceRemote('bbbbbbbbbb', '2026-10', [iv(at(8, 12), at(8, 13))]);
  assert.deepStrictEqual(a.ownMonths(), ['2026-10', '2026-11']);
  assert.deepStrictEqual(a.exportOwn('2026-10').map((i) => i.window).sort(), ['w1']);
  b.flush();
  assert.deepStrictEqual(a.exportOwn('2026-10').map((i) => i.window).sort(), ['w1', 'w2']);
  a.deleteAll();
  assert.deepStrictEqual(a.ownMonths(), []);
  assert.strictEqual(a.read({ from: -Infinity, to: Infinity }).length, 1, 'the other machine survives');
});

test('replaceRemote rejects ids and months that could escape the cache folder', () => {
  const store = new IntervalStore({ dir: tmpDir(), windowId: 'w1' });
  for (const [machine, month] of [['../../x', '2026-10'], ['aaaaaaaaaa', '../2026'], ['AAAAAAAAAA', '2026-10']]) {
    assert.throws(() => store.replaceRemote(machine, month, []), /invalid/);
  }
});

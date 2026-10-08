'use strict';

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { IntervalStore } from '../intervalStore';
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

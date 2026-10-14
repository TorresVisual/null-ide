'use strict';

import assert from 'node:assert';
import * as zlib from 'node:zlib';
import { test } from 'node:test';
import { blobHash, blobName, decodeMonth, encodeMonth, parseBlobName } from '../activityBlob';
import { Interval } from '../types';

const iv = (start: number, over: Partial<Interval> = {}): Interval => ({
  start, end: start + 60_000, project: { key: 'k', name: 'proj' }, language: 'rust', file: 'a.rs', linesAdded: 2, linesRemoved: 1, window: 'w1', ...over,
});
const machine = { id: 'aaaaaaaaaa', name: 'Desk' };

test('round trip keeps intervals with their window id and drops the machine tag', () => {
  const text = encodeMonth(machine, [iv(2000, { machine: 'aaaaaaaaaa' }), iv(1000, { window: 'import-wakatime' })]);
  const blob = decodeMonth(text)!;
  assert.deepStrictEqual([blob.machine, blob.name], ['aaaaaaaaaa', 'Desk']);
  assert.deepStrictEqual(blob.intervals.map((i) => [i.start, i.window, i.machine]), [[1000, 'import-wakatime', undefined], [2000, 'w1', undefined]]);
});

test('equal data gives equal text regardless of input order, so the hash detects changes', () => {
  const a = iv(1000), b = iv(5000, { window: 'w2' });
  assert.strictEqual(blobHash(encodeMonth(machine, [a, b])), blobHash(encodeMonth(machine, [b, a])));
  assert.notStrictEqual(blobHash(encodeMonth(machine, [a])), blobHash(encodeMonth(machine, [a, b])));
});

test('decodeMonth rejects garbage, unknown versions and bad machine ids; bad lines are skipped', () => {
  assert.strictEqual(decodeMonth('not base64 gzip'), undefined);
  const wrap = (s: string) => zlib.gzipSync(s).toString('base64');
  assert.strictEqual(decodeMonth(wrap('{"v":2,"machine":"aaaaaaaaaa"}')), undefined);
  assert.strictEqual(decodeMonth(wrap('{"v":1,"machine":"../x"}')), undefined);
  const ok = decodeMonth(wrap('{"v":1,"machine":"aaaaaaaaaa"}\n{broken\n' + JSON.stringify(iv(1000))))!;
  assert.strictEqual(ok.intervals.length, 1);
  assert.strictEqual(ok.name, 'aaaaaaaaaa');
});

test('blob names round trip and only the exact shape is accepted', () => {
  assert.deepStrictEqual(parseBlobName(blobName('aaaaaaaaaa', '2026-10')), { machine: 'aaaaaaaaaa', month: '2026-10' });
  for (const bad of ['activity__aaaaaaaaaa__2026-10.json', 'activity__../x__2026-10.enc', 'activity__aaaaaaaaaa__2026-1.enc', 'settings.json.enc', 'x/activity__aaaaaaaaaa__2026-10.enc']) {
    assert.strictEqual(parseBlobName(bad), undefined, bad);
  }
});

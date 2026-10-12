'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { parseSnapshot } from '../snapshot';

const valid = {
  schemaVersion: 1, takenAt: 5, appVersion: '1.0.0', initialStartup: true,
  metrics: { a: 1, b: 'x', c: Number.POSITIVE_INFINITY },
  marks: [{ source: 'main', name: 'code/didStartMain', startTime: 10 }, { name: 7 }, null],
  contributions: [{ phase: 2, id: 'x', ms: 3 }, { phase: 'z' }],
  extensions: [{ id: 'p.a', activationEvent: '*', reason: 'p.a', eager: true, startMs: 1, endMs: 2, loadMs: 'nope' }, { id: 5 }],
};

test('parseSnapshot keeps valid entries and drops malformed ones', () => {
  const s = parseSnapshot(valid)!;
  assert.deepStrictEqual(s.metrics, { a: 1 });
  assert.deepStrictEqual(s.marks, [{ source: 'main', name: 'code/didStartMain', startTime: 10 }]);
  assert.deepStrictEqual(s.contributions, [{ phase: 2, id: 'x', ms: 3 }]);
  assert.strictEqual(s.extensions.length, 1);
  assert.strictEqual(s.extensions[0].id, 'p.a');
  assert.strictEqual(s.extensions[0].loadMs, undefined, 'non-numeric timing becomes undefined');
  assert.strictEqual(s.extensions[0].startMs, 1);
});

test('parseSnapshot rejects non-objects and unknown schema versions', () => {
  assert.strictEqual(parseSnapshot(undefined), undefined);
  assert.strictEqual(parseSnapshot('x'), undefined);
  assert.strictEqual(parseSnapshot({ ...valid, schemaVersion: 2 }), undefined);
});

test('parseSnapshot tolerates missing arrays', () => {
  const s = parseSnapshot({ schemaVersion: 1, takenAt: 1, appVersion: '1', initialStartup: false })!;
  assert.deepStrictEqual([s.marks, s.contributions, s.extensions], [[], [], []]);
});

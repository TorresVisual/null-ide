'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { serial } from './serial';

test('serial runs tasks one at a time, in the order they were queued', async () => {
  const run = serial();
  const log: string[] = [];
  const slow = run(async () => { log.push('a:start'); await new Promise(r => setTimeout(r, 20)); log.push('a:end'); });
  const fast = run(async () => { log.push('b'); });
  await Promise.all([slow, fast]);
  assert.deepStrictEqual(log, ['a:start', 'a:end', 'b']);
});

test('serial: a failing task rejects its own caller but not the queue behind it', async () => {
  const run = serial();
  const failed = run(async () => { throw new Error('boom'); });
  const next = run(async () => 'still runs');
  await assert.rejects(failed, /boom/);
  assert.strictEqual(await next, 'still runs');
});

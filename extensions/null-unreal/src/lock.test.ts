import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { LockIo, withLock } from './lock';
import { ResolveError } from './uproject';

// In-memory lock files; `dead` lists the PIDs that are not running; time moves only through sleep().
function fake(initial: Record<string, string> = {}, dead: number[] = [], onSleep?: (files: Record<string, string>) => void) {
  const files = { ...initial };
  let t = 0;
  const io: LockIo = {
    create: (f, c) => (f in files ? false : ((files[f] = c), true)),
    read: (f) => files[f],
    remove: (f) => void delete files[f],
    alive: (pid) => !dead.includes(pid),
    sleep: async (ms) => {
      t += ms;
      onSleep?.(files);
    },
    now: () => t,
    pid: 7,
  };
  return { io, files };
}

test('the lock is held while the work runs and released after it', async () => {
  const { io, files } = fake();
  await withLock('L', io, async () => assert.equal(JSON.parse(files.L).pid, 7));
  assert.ok(!('L' in files));
});

test('the lock is released when the work throws', async () => {
  const { io, files } = fake();
  await assert.rejects(withLock('L', io, async () => { throw new Error('boom'); }), /boom/);
  assert.ok(!('L' in files));
});

test('a lock whose owner is dead is taken over', async () => {
  const { io } = fake({ L: JSON.stringify({ pid: 99 }) }, [99]);
  assert.equal(await withLock('L', io, async () => 'ran'), 'ran');
});

test('an unreadable lock file counts as stale', async () => {
  const { io } = fake({ L: 'not json' });
  assert.equal(await withLock('L', io, async () => 'ran'), 'ran');
});

test('a live owner is waited for, then the work goes ahead', async () => {
  let sleeps = 0;
  const { io } = fake({ L: JSON.stringify({ pid: 99 }) }, [], (files) => {
    if (++sleeps === 3) delete files.L;
  });
  assert.equal(await withLock('L', io, async () => 'ran'), 'ran');
  assert.equal(sleeps, 3);
});

test('waiting past the limit is a resolution error naming the owner', async () => {
  const { io } = fake({ L: JSON.stringify({ pid: 99 }) });
  await assert.rejects(withLock('L', io, async () => 'ran', 2000), (e: Error) => e instanceof ResolveError && e.message.includes('pid 99'));
});

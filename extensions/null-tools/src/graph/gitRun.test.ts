'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { BusyFlag, GitError, makeRunGit } from './gitRun';

test('runGit returns stdout and rejects with git\'s own message', async () => {
  const git = makeRunGit(process.cwd());
  assert.match(await git(['--version']), /^git version/);
  await assert.rejects(
    git(['rev-parse', '--verify', 'definitely-not-a-ref']),
    (err: unknown) => err instanceof GitError && err.message.length > 0,
  );
});

test('runGit sets GIT_EDITOR=true so --continue never opens an editor', async () => {
  assert.strictEqual((await makeRunGit(process.cwd())(['var', 'GIT_EDITOR'])).trim(), 'true');
});

test('BusyFlag refuses a second action and whenIdle waits for the first', async () => {
  const busy = new BusyFlag();
  let release!: () => void;
  const first = busy.run(() => new Promise<string>((resolve) => { release = () => resolve('done'); }));
  assert.strictEqual(busy.busy, true);
  assert.deepStrictEqual(await busy.run(async () => 'second'), { ran: false });

  let idle = false;
  const waiting = busy.whenIdle().then(() => { idle = true; });
  await Promise.resolve();
  assert.strictEqual(idle, false);

  release();
  assert.deepStrictEqual(await first, { ran: true, value: 'done' });
  await waiting;
  assert.strictEqual(idle, true);
  assert.strictEqual(busy.busy, false);
});

test('BusyFlag clears even when the action throws', async () => {
  const busy = new BusyFlag();
  await assert.rejects(busy.run(async () => { throw new Error('boom'); }), /boom/);
  assert.strictEqual(busy.busy, false);
});

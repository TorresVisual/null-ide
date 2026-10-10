'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { GitRun } from './git';
import { applyGlobalIdentity } from './globalIdentity';
import { Account } from './types';

const account: Account = {
  id: 'a1', provider: 'gitlab', host: 'gitlab.com', username: 'me', email: 'me@example.com', authMethod: 'ssh',
};

function fakeGit(globals: Record<string, string>, failOn?: string): { git: GitRun; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRun = async (_cwd, args) => {
    calls.push(args);
    if (args[2] === '--get') { return { code: 0, stdout: `${globals[args[3]] ?? ''}\n`, stderr: '' }; }
    if (args[2] === failOn) { return { code: 1, stdout: '', stderr: 'permission denied' }; }
    globals[args[2]] = args[3];
    return { code: 0, stdout: '', stderr: '' };
  };
  return { git, calls };
}

test('sets name and email globally and says what it replaced', async () => {
  const globals: Record<string, string> = { 'user.name': 'old', 'user.email': 'old@example.com' };
  const { git } = fakeGit(globals);
  assert.strictEqual(
    await applyGlobalIdentity(git, account, '/tmp'),
    'Global git identity is now me <me@example.com> (was old <old@example.com>).',
  );
  assert.deepStrictEqual(globals, { 'user.name': 'me', 'user.email': 'me@example.com' });
});

test('an unset global identity has nothing to report as replaced', async () => {
  const { git } = fakeGit({});
  assert.strictEqual(await applyGlobalIdentity(git, account, '/tmp'), 'Global git identity is now me <me@example.com>.');
});

test('a failing git config surfaces its error', async () => {
  const { git } = fakeGit({}, 'user.email');
  await assert.rejects(applyGlobalIdentity(git, account, '/tmp'), /user\.email failed: permission denied/);
});

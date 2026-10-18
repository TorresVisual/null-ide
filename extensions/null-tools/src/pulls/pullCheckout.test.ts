'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeRunGit } from '../graph/gitRun';
import { checkoutPull } from './pullCheckout';

/** A same-repo PR checks out as its head branch name; a fork PR as pr/<n>. */
const same = (n: number, headRef: string) => ({ number: n, headRef, fork: false });
const fork = (n: number) => ({ number: n, headRef: 'main', fork: true });

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function identity(dir: string): void {
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
}

function commit(dir: string, file: string, content: string): string {
  writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '--', file);
  git(dir, 'commit', '-q', '-m', `edit ${file}`);
  return git(dir, 'rev-parse', 'HEAD');
}

/** A bare `origin`, an `author` clone that publishes `refs/pull/<n>/head` the way GitHub does, and the `reader` that checks out. */
function setup(): { author: string; reader: string; publish: (n: number) => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'pull-checkout-'));
  const origin = path.join(root, 'origin.git');
  const author = path.join(root, 'author');
  const reader = path.join(root, 'reader');
  git(root, 'init', '-q', '--bare', '--initial-branch=main', origin);
  git(root, 'init', '-q', '--initial-branch=main', author);
  identity(author);
  git(author, 'remote', 'add', 'origin', origin);
  commit(author, 'a.txt', '1');
  git(author, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(root, 'clone', '-q', origin, reader);
  identity(reader);
  return { author, reader, publish: (n) => git(author, 'push', '-q', '--force', 'origin', `HEAD:refs/pull/${n}/head`) };
}

test('checkoutPull: a same-repo PR gets its head branch, a fork PR gets pr/<n>', async () => {
  const { author, reader, publish } = setup();
  commit(author, 'b.txt', 'b');
  publish(7);
  publish(8);
  const run = makeRunGit(reader);

  assert.deepStrictEqual(await checkoutPull(run, same(7, 'feat/x')), { ok: true, branch: 'feat/x' });
  assert.strictEqual(git(reader, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feat/x');
  assert.deepStrictEqual(await checkoutPull(run, fork(8)), { ok: true, branch: 'pr/8' });
  assert.strictEqual(git(reader, 'rev-parse', '--abbrev-ref', 'HEAD'), 'pr/8');
});

test('checkoutPull creates the branch at the PR head, then fast-forwards it when the PR gains commits', async () => {
  const { author, reader, publish } = setup();
  const first = commit(author, 'b.txt', 'b');
  publish(7);
  const run = makeRunGit(reader);

  assert.strictEqual((await checkoutPull(run, fork(7))).ok, true);
  assert.strictEqual(git(reader, 'rev-parse', 'HEAD'), first);

  const second = commit(author, 'b.txt', 'bb');
  publish(7);
  assert.strictEqual((await checkoutPull(run, fork(7))).ok, true);
  assert.strictEqual(git(reader, 'rev-parse', 'HEAD'), second);
});

test('checkoutPull: a diverged local branch is left alone', async () => {
  const { author, reader, publish } = setup();
  commit(author, 'b.txt', 'b');
  publish(7);
  const run = makeRunGit(reader);
  await checkoutPull(run, fork(7));
  const mine = commit(reader, 'mine.txt', 'local work');
  commit(author, 'b.txt', 'bb');
  publish(7);

  const result = await checkoutPull(run, fork(7));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(git(reader, 'rev-parse', 'HEAD'), mine);
});

test('checkoutPull: a dirty tree that conflicts is refused with git\'s message and no branch is created', async () => {
  const { author, reader, publish } = setup();
  commit(author, 'a.txt', 'changed upstream');
  publish(7);
  writeFileSync(path.join(reader, 'a.txt'), 'my uncommitted edit');

  const result = await checkoutPull(makeRunGit(reader), fork(7));
  assert.strictEqual(result.ok, false);
  assert.ok(!result.ok && result.message.length > 0);
  assert.strictEqual(git(reader, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.strictEqual(git(reader, 'branch', '--list', 'pr/7'), '');
});

test('checkoutPull: a PR that does not exist is a failure with git\'s message', async () => {
  const { reader } = setup();
  const result = await checkoutPull(makeRunGit(reader), fork(99));
  assert.strictEqual(result.ok, false);
  assert.ok(!result.ok && result.message.length > 0);
});

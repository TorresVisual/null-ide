'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cherryPick, checkout, createBranch, reset, resetImpact, resumeOperation, revert } from './gitActions';
import { GitGraphService } from './gitGraphService';
import { makeRunGit } from './gitRun';

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'graph-actions-'));
  git(dir, 'init', '-q', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  return dir;
}

function commit(dir: string, file: string, content: string, message: string): string {
  writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '--', file);
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

function tools(dir: string) {
  const run = makeRunGit(dir);
  const service = new GitGraphService(run, dir);
  return { run, inProgress: () => service.inProgress() };
}

function expectOk<T>(result: { ok: boolean; message?: string; value?: T }): T {
  assert.ok(result.ok, result.ok ? '' : String(result.message));
  return result.value as T;
}

test('checkout: a branch, a detached sha, and a remote branch that becomes a tracking branch', async () => {
  const dir = initRepo();
  const first = commit(dir, 'a.txt', '1', 'one');
  commit(dir, 'a.txt', '2', 'two');
  git(dir, 'branch', 'dev', first);
  const { run } = tools(dir);

  expectOk(await checkout(run, { kind: 'branch', name: 'dev' }));
  assert.strictEqual(git(dir, 'branch', '--show-current'), 'dev');

  expectOk(await checkout(run, { kind: 'detach', sha: first }));
  assert.strictEqual(git(dir, 'branch', '--show-current'), '');
  assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), first);

  const clone = path.join(mkdtempSync(path.join(tmpdir(), 'graph-clone-')), 'c');
  execFileSync('git', ['clone', '-q', dir, clone]);
  git(dir, 'switch', '-q', '-c', 'feat');
  commit(dir, 'f.txt', 'f', 'feat');
  git(clone, 'fetch', '-q', 'origin');
  expectOk(await checkout(makeRunGit(clone), { kind: 'remote', name: 'origin/feat' }));
  assert.strictEqual(git(clone, 'branch', '--show-current'), 'feat');
});

test('checkout of a dirty tree is refused by git and the message comes back', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'base', 'base');
  git(dir, 'switch', '-q', '-c', 'other');
  commit(dir, 'a.txt', 'other', 'other');
  git(dir, 'switch', '-q', 'main');
  writeFileSync(path.join(dir, 'a.txt'), 'dirty');
  const result = await checkout(tools(dir).run, { kind: 'branch', name: 'other' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'dirty', 'nothing forced');
});

test('createBranch validates the name and switches to the new branch at the sha', async () => {
  const dir = initRepo();
  const first = commit(dir, 'a.txt', '1', 'one');
  commit(dir, 'a.txt', '2', 'two');
  const { run } = tools(dir);
  assert.strictEqual((await createBranch(run, 'bad name', first)).ok, false);
  assert.strictEqual((await createBranch(run, '-x', first)).ok, false);
  expectOk(await createBranch(run, 'feature/x', first));
  assert.strictEqual(git(dir, 'branch', '--show-current'), 'feature/x');
  assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), first);
});

function divergent(dir: string): string {
  commit(dir, 'a.txt', 'base', 'base');
  git(dir, 'switch', '-q', '-c', 'side');
  const side = commit(dir, 's.txt', 'side', 'side file');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'a.txt', 'main', 'main change');
  return side;
}

test('cherryPick applies a clean commit', async () => {
  const dir = initRepo();
  const side = divergent(dir);
  const { run, inProgress } = tools(dir);
  const info = expectOk(await cherryPick(run, inProgress, side));
  assert.strictEqual(info.stopped, false);
  assert.ok(existsSync(path.join(dir, 's.txt')));
});

test('a conflicting cherry-pick stops, and abort restores the tree', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'base', 'base');
  git(dir, 'switch', '-q', '-c', 'side');
  const side = commit(dir, 'a.txt', 'side', 'side change');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'a.txt', 'main', 'main change');
  const { run, inProgress } = tools(dir);

  const info = expectOk(await cherryPick(run, inProgress, side));
  assert.strictEqual(info.stopped, true);
  assert.deepStrictEqual(await inProgress(), { kind: 'cherry-pick' });

  expectOk(await resumeOperation(run, inProgress, 'abort'));
  assert.strictEqual(await inProgress(), null);
  assert.strictEqual(readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'main');
});

test('empty cherry-pick then skip', async () => {
  const dir = initRepo();
  const side = divergent(dir);
  const { run, inProgress } = tools(dir);
  expectOk(await cherryPick(run, inProgress, side));
  const again = expectOk(await cherryPick(run, inProgress, side));
  assert.strictEqual(again.stopped, true, 'the change is already applied, so git stops on an empty pick');
  expectOk(await resumeOperation(run, inProgress, 'skip'));
  assert.strictEqual(await inProgress(), null);
});

test('cherry-picking a merge commit needs a parent number', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'base', 'base');
  git(dir, 'switch', '-q', '-c', 'side');
  commit(dir, 's.txt', 's', 'side');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'm.txt', 'm', 'main');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  const merge = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'switch', '-q', '-c', 'target', 'HEAD~1');
  const { run, inProgress } = tools(dir);

  assert.strictEqual((await cherryPick(run, inProgress, merge)).ok, false);
  const info = expectOk(await cherryPick(run, inProgress, merge, 1));
  assert.strictEqual(info.stopped, false);
});

test('revert: a clean revert, then a conflicting one that can be aborted', async () => {
  const dir = initRepo();
  const first = commit(dir, 'a.txt', 'one', 'one');
  const second = commit(dir, 'a.txt', 'two', 'two');
  commit(dir, 'a.txt', 'three', 'three');
  const { run, inProgress } = tools(dir);

  const conflicted = expectOk(await revert(run, inProgress, second));
  assert.strictEqual(conflicted.stopped, true);
  expectOk(await resumeOperation(run, inProgress, 'abort'));
  assert.strictEqual(await inProgress(), null);

  writeFileSync(path.join(dir, 'b.txt'), 'b');
  git(dir, 'add', '--', 'b.txt');
  git(dir, 'commit', '-q', '-m', 'add b');
  const addB = git(dir, 'rev-parse', 'HEAD');
  const clean = expectOk(await revert(run, inProgress, addB));
  assert.strictEqual(clean.stopped, false);
  assert.ok(!existsSync(path.join(dir, 'b.txt')));
  assert.ok(first);
});

test('resumeOperation fails when nothing is in progress, and a merge cannot be skipped', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'base', 'base');
  const { run, inProgress } = tools(dir);
  assert.strictEqual((await resumeOperation(run, inProgress, 'continue')).ok, false);

  git(dir, 'switch', '-q', '-c', 'side');
  commit(dir, 'a.txt', 'side', 'side');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'a.txt', 'main', 'main');
  try { git(dir, 'merge', 'side'); } catch { /* conflict, expected */ }
  assert.deepStrictEqual(await inProgress(), { kind: 'merge' });
  assert.strictEqual((await resumeOperation(run, inProgress, 'skip')).ok, false);
  expectOk(await resumeOperation(run, inProgress, 'abort'));
});

test('reset soft keeps the index, mixed keeps the files, hard discards both', async () => {
  for (const mode of ['soft', 'mixed', 'hard'] as const) {
    const dir = initRepo();
    const c1 = commit(dir, 'a.txt', '1', 'one');
    commit(dir, 'a.txt', '2', 'two');
    expectOk(await reset(tools(dir).run, mode, c1));
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), c1, mode);
    assert.strictEqual(git(dir, 'diff', '--cached', '--name-only') !== '', mode === 'soft', `${mode}: staged`);
    assert.strictEqual(readFileSync(path.join(dir, 'a.txt'), 'utf8'), mode === 'hard' ? '1' : '2', `${mode}: file`);
  }
});

test('resetImpact counts what leaves the branch, what is left on no other ref, and tracked changes', async () => {
  const dir = initRepo();
  const c1 = commit(dir, 'a.txt', '1', 'one');
  commit(dir, 'a.txt', '2', 'two');
  const c3 = commit(dir, 'a.txt', '3', 'three');
  const { run } = tools(dir);

  assert.deepStrictEqual(expectOk(await resetImpact(run, c1)), { branch: 'main', leaving: 2, orphaned: 2, trackedChanges: 0 });

  git(dir, 'branch', 'keep', c3);
  writeFileSync(path.join(dir, 'a.txt'), 'dirty');
  writeFileSync(path.join(dir, 'untracked.txt'), 'u');
  assert.deepStrictEqual(expectOk(await resetImpact(run, c1)), { branch: 'main', leaving: 2, orphaned: 0, trackedChanges: 1 });
});

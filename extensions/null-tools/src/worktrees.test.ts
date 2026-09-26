'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseWorktreeListPorcelain, getBaseBranch, listWorktrees, createWorktree, listLocalBranches, removeWorktree, mergeWorktreeBack, pruneCandidates, pruneWorktrees, resolveMainWorktreeRoot } from './worktrees';

function normalizeForCompare(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'worktrees-test-'));
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

function commit(dir: string, file: string, message: string): void {
  writeFileSync(path.join(dir, file), file);
  execFileSync('git', ['add', file], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

test('parseWorktreeListPorcelain parses primary, linked, detached, and prunable worktrees', () => {
  const output = [
    'worktree /repo',
    'HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'branch refs/heads/main',
    '',
    'worktree /repo/.claude/worktrees/feature-x',
    'HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'branch refs/heads/feature-x',
    '',
    'worktree /repo/.claude/worktrees/detached-one',
    'HEAD cccccccccccccccccccccccccccccccccccccccc',
    'detached',
    '',
    'worktree /repo/.claude/worktrees/gone',
    'HEAD dddddddddddddddddddddddddddddddddddddddd',
    'branch refs/heads/gone',
    'prunable gitdir file points to non-existent location',
  ].join('\n');

  const entries = parseWorktreeListPorcelain(output, '/repo');
  assert.strictEqual(entries.length, 4);
  assert.deepStrictEqual(entries[0], {
    path: '/repo', branch: 'main',
    head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    isCurrent: true, prunable: false,
  });
  assert.strictEqual(entries[1].branch, 'feature-x');
  assert.strictEqual(entries[1].isCurrent, false);
  assert.strictEqual(entries[2].branch, null);
  assert.strictEqual(entries[3].prunable, true);
});

test('getBaseBranch falls back to main when there is no remote', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  assert.strictEqual(getBaseBranch(dir), 'main');
});

test('listWorktrees reports the primary and a linked worktree with correct branch/status', async () => {
  const dir = initRepo();
  writeFileSync(path.join(dir, '.gitignore'), '.claude/worktrees/\n');
  execFileSync('git', ['add', '.gitignore'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'gitignore'], { cwd: dir });
  commit(dir, 'a.txt', 'initial');
  const wtPath = path.join(dir, '.claude', 'worktrees', 'feature-x');
  execFileSync('git', ['worktree', 'add', '-b', 'feature-x', wtPath], { cwd: dir });
  commit(wtPath, 'b.txt', 'feature work');

  const entries = await listWorktrees(dir);
  assert.strictEqual(entries.length, 2);

  const main = entries.find(e => e.isCurrent)!;
  assert.strictEqual(main.dirty, false);

  const feature = entries.find(e => !e.isCurrent)!;
  assert.strictEqual(feature.branch, 'feature-x');
  assert.strictEqual(feature.dirty, false);
  assert.strictEqual(feature.aheadBase, 1);
  assert.strictEqual(feature.behindBase, 0);
  assert.strictEqual(feature.ahead, 0);
  assert.strictEqual(feature.behind, 0);
});

test('listWorktrees keeps a worktree whose directory was deleted, marked prunable', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const wtPath = path.join(dir, '.claude', 'worktrees', 'to-delete');
  execFileSync('git', ['worktree', 'add', '-b', 'to-delete', wtPath], { cwd: dir });
  fs.rmSync(wtPath, { recursive: true, force: true });

  const entries = await listWorktrees(dir);
  const gone = entries.find(e => !e.isCurrent)!;
  assert.strictEqual(gone.prunable, true);
  assert.strictEqual(gone.dirty, false);
});

test('listWorktrees represents a detached-HEAD worktree with a null branch', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const wtPath = path.join(dir, '.claude', 'worktrees', 'detached-one');
  execFileSync('git', ['worktree', 'add', '--detach', wtPath, head], { cwd: dir });

  const entries = await listWorktrees(dir);
  const detached = entries.find(e => !e.isCurrent)!;
  assert.strictEqual(detached.branch, null);
});

test('getBaseBranch resolves origin/HEAD when a remote is configured', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const bare = mkdtempSync(path.join(tmpdir(), 'worktrees-bare-'));
  execFileSync('git', ['init', '-q', '--bare'], { cwd: bare });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir });
  execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: dir });
  execFileSync('git', ['remote', 'set-head', 'origin', 'main'], { cwd: dir });
  assert.strictEqual(getBaseBranch(dir), 'main');
});

test('createWorktree from scratch creates a branch and worktree under .claude/worktrees', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');

  const result = createWorktree(dir, { kind: 'scratch', description: 'Try a fix' });
  assert.ok(result.ok);
  assert.strictEqual(result.value.branch, 'try-a-fix');
  assert.ok(fs.existsSync(result.value.path));
  assert.match(result.value.path.replace(/\\/g, '/'), /\.claude\/worktrees\/try-a-fix$/);

  const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gitignore, /\.claude\/worktrees/);
});

test('createWorktree fails cleanly when the target directory already exists', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  createWorktree(dir, { kind: 'scratch', description: 'dup' });

  const second = createWorktree(dir, { kind: 'scratch', description: 'dup' });
  assert.strictEqual(second.ok, false);
});

test('createWorktree from an issue uses branchNameForIssue for the branch name', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const result = createWorktree(dir, { kind: 'issue', issueNumber: 88, title: 'Git worktree manager' });
  assert.ok(result.ok);
  assert.strictEqual(result.value.branch, 'issue-88-git-worktree-manager');
});

test('createWorktree from an existing branch reuses it rather than creating a new one', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  execFileSync('git', ['branch', 'existing-feature'], { cwd: dir });

  const result = createWorktree(dir, { kind: 'branch', branch: 'existing-feature' });
  assert.ok(result.ok);
  assert.strictEqual(result.value.branch, 'existing-feature');
});

test('listLocalBranches returns local branch names', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  execFileSync('git', ['branch', 'a-branch'], { cwd: dir });
  execFileSync('git', ['branch', 'b-branch'], { cwd: dir });

  const branches = listLocalBranches(dir);
  assert.ok(branches.includes('main'));
  assert.ok(branches.includes('a-branch'));
  assert.ok(branches.includes('b-branch'));
});

test('removeWorktree deletes the worktree directory and registration', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const created = createWorktree(dir, { kind: 'scratch', description: 'temp' });
  assert.ok(created.ok);

  const result = removeWorktree(dir, created.value.path, false);
  assert.ok(result.ok);
  assert.strictEqual(fs.existsSync(created.value.path), false);
});

test('mergeWorktreeBack refuses when the main repo has uncommitted changes', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const created = createWorktree(dir, { kind: 'scratch', description: 'feature' });
  assert.ok(created.ok);
  writeFileSync(path.join(dir, 'a.txt'), 'dirty change');

  const result = mergeWorktreeBack(dir, created.value.branch, 'main', 'ff-only');
  assert.strictEqual(result.ok, false);
});

test('mergeWorktreeBack fast-forwards when the worktree branch is ahead', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const created = createWorktree(dir, { kind: 'scratch', description: 'feature' });
  assert.ok(created.ok);
  commit(created.value.path, 'b.txt', 'feature work');

  const result = mergeWorktreeBack(dir, created.value.branch, 'main', 'ff-only');
  assert.ok(result.ok);
  assert.strictEqual(result.value.mode, 'ff');
  assert.ok(fs.existsSync(path.join(dir, 'b.txt')));
});

test('mergeWorktreeBack ff-only fails when base has diverged, and mode "merge" succeeds', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const created = createWorktree(dir, { kind: 'scratch', description: 'feature' });
  assert.ok(created.ok);
  commit(created.value.path, 'b.txt', 'feature work');
  commit(dir, 'c.txt', 'main moved on');

  const ffResult = mergeWorktreeBack(dir, created.value.branch, 'main', 'ff-only');
  assert.strictEqual(ffResult.ok, false);

  const mergeResult = mergeWorktreeBack(dir, created.value.branch, 'main', 'merge');
  assert.ok(mergeResult.ok);
  assert.strictEqual(mergeResult.value.mode, 'merge');
});

test('pruneCandidates separates a merged worktree from one with a missing directory', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');

  const merged = createWorktree(dir, { kind: 'scratch', description: 'merged one' });
  assert.ok(merged.ok);
  const missing = createWorktree(dir, { kind: 'scratch', description: 'missing one' });
  assert.ok(missing.ok);

  const mergeResult = mergeWorktreeBack(dir, merged.value.branch, 'main', 'ff-only');
  assert.ok(mergeResult.ok);
  fs.rmSync(missing.value.path, { recursive: true, force: true });

  const { merged: mergedList, missing: missingList } = await pruneCandidates(dir, 'main');
  assert.ok(mergedList.some(e => e.branch === merged.value.branch));
  assert.ok(missingList.some(e => e.prunable));
});

test('pruneWorktrees removes registration for a worktree with a missing directory', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const created = createWorktree(dir, { kind: 'scratch', description: 'to prune' });
  assert.ok(created.ok);
  fs.rmSync(created.value.path, { recursive: true, force: true });

  const result = pruneWorktrees(dir);
  assert.ok(result.ok);
  const stdout = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: dir, encoding: 'utf8' });
  assert.ok(!stdout.includes(created.value.branch));
});

test('createWorktree only commits its own .gitignore edit, never other staged changes', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  writeFileSync(path.join(dir, 'staged.txt'), 'work in progress');
  execFileSync('git', ['add', 'staged.txt'], { cwd: dir });

  const result = createWorktree(dir, { kind: 'scratch', description: 'feature' });
  assert.ok(result.ok);

  const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
  assert.match(status, /^A\s+staged\.txt$/m);
});

test('resolveMainWorktreeRoot resolves a linked worktree path back to the main worktree', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const created = createWorktree(dir, { kind: 'scratch', description: 'linked' });
  assert.ok(created.ok);

  assert.strictEqual(normalizeForCompare(resolveMainWorktreeRoot(created.value.path)), normalizeForCompare(dir));
  assert.strictEqual(normalizeForCompare(resolveMainWorktreeRoot(dir)), normalizeForCompare(dir));
});

test('createWorktree reuses an existing branch when re-creating after a remove', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const first = createWorktree(dir, { kind: 'scratch', description: 'redo' });
  assert.ok(first.ok);
  const removed = removeWorktree(dir, first.value.path, false);
  assert.ok(removed.ok);

  const second = createWorktree(dir, { kind: 'scratch', description: 'redo' });
  assert.ok(second.ok);
  assert.strictEqual(second.value.branch, 'redo');
});

test('mergeWorktreeBack reports reason "dirty" when the main repo has uncommitted changes', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const created = createWorktree(dir, { kind: 'scratch', description: 'feature' });
  assert.ok(created.ok);
  writeFileSync(path.join(dir, 'a.txt'), 'dirty change');

  const result = mergeWorktreeBack(dir, created.value.branch, 'main', 'ff-only');
  assert.strictEqual(result.ok, false);
  assert.strictEqual((result as { reason: string }).reason, 'dirty');
});

test('mergeWorktreeBack reports reason "merge" when ff-only fails because base has diverged', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const created = createWorktree(dir, { kind: 'scratch', description: 'feature' });
  assert.ok(created.ok);
  commit(created.value.path, 'b.txt', 'feature work');
  commit(dir, 'c.txt', 'main moved on');

  const result = mergeWorktreeBack(dir, created.value.branch, 'main', 'ff-only');
  assert.strictEqual(result.ok, false);
  assert.strictEqual((result as { reason: string }).reason, 'merge');
});

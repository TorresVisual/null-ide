'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseWorktreeListPorcelain, getBaseBranch, listWorktrees, createWorktree, listLocalBranches } from './worktrees';

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

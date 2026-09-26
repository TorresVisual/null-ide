'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseWorktreeListPorcelain, getBaseBranch } from './worktrees';

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

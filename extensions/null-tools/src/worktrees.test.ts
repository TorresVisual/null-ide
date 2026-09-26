'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { parseWorktreeListPorcelain } from './worktrees';

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

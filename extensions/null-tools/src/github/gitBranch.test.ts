'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { branchNameForIssue, getLocallyClosedIssueNumbers } from './gitBranch';

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gitBranch-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

function commit(dir: string, file: string, message: string): void {
  writeFileSync(path.join(dir, file), file);
  execFileSync('git', ['add', file], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

test('branchNameForIssue slugifies the title and caps length', () => {
  assert.strictEqual(
    branchNameForIssue(43, 'Add Issues Panel: split view!'),
    'issue-43-add-issues-panel-split-view',
  );
});

test('branchNameForIssue strips shell metacharacters entirely', () => {
  assert.strictEqual(
    branchNameForIssue(7, '; rm -rf ~ && echo pwned $(whoami)'),
    'issue-7-rm-rf-echo-pwned-whoami',
  );
});

test('branchNameForIssue falls back to just the number for an empty slug', () => {
  assert.strictEqual(branchNameForIssue(9, '!!!'), 'issue-9');
});

test('getLocallyClosedIssueNumbers returns empty set with no upstream configured', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'Closes #52');
  assert.deepStrictEqual(getLocallyClosedIssueNumbers(dir), new Set());
});

test('getLocallyClosedIssueNumbers finds closing keywords in unpushed commits', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const bare = mkdtempSync(path.join(tmpdir(), 'gitBranch-bare-'));
  execFileSync('git', ['init', '-q', '--bare'], { cwd: bare });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir });
  execFileSync('git', ['push', '-q', '-u', 'origin', 'HEAD:main'], { cwd: dir });

  assert.deepStrictEqual(getLocallyClosedIssueNumbers(dir), new Set(), 'nothing unpushed yet');

  commit(dir, 'b.txt', 'Resolves #99 and fixes #7');
  assert.deepStrictEqual(getLocallyClosedIssueNumbers(dir), new Set([99, 7]));
});

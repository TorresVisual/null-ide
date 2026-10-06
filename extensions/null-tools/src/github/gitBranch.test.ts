'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BranchIssueTracker, branchNameForIssue, getLocallyClosedIssueNumbers, issueNumberFromBranch } from './gitBranch';

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

test('issueNumberFromBranch reads the number from the scheme branchNameForIssue produces', () => {
  assert.strictEqual(issueNumberFromBranch('issue-106-fix-create'), 106);
  assert.strictEqual(issueNumberFromBranch('issue-7'), 7);
  assert.strictEqual(issueNumberFromBranch(branchNameForIssue(43, 'Add Issues Panel')), 43);
});

test('issueNumberFromBranch rejects names that only look like the scheme', () => {
  for (const name of ['issue-12abc', 'issue-0', 'issue-', 'issue', 'my-issue-12', 'feature/issue-12', 'Issue-12', 'main', '']) {
    assert.strictEqual(issueNumberFromBranch(name), null, name);
  }
  assert.strictEqual(issueNumberFromBranch(undefined), null);
  assert.strictEqual(issueNumberFromBranch('issue-99999999999999999999-x'), null);
});

test('tracker ignores the first HEAD it sees and an unknown previous HEAD', () => {
  const t = new BranchIssueTracker();
  assert.strictEqual(t.onHead('r', 'issue-12-foo'), null, 'window opened on an issue branch');
  const u = new BranchIssueTracker();
  assert.strictEqual(u.onHead('r', undefined), null);
  assert.strictEqual(u.onHead('r', 'issue-12-foo'), null, 'HEAD was still loading');
});

test('tracker offers the issue when HEAD moves onto an issue branch', () => {
  const t = new BranchIssueTracker();
  t.onHead('r', 'main');
  assert.strictEqual(t.onHead('r', 'issue-12-foo'), 12);
});

test('tracker ignores repeat events and non-issue branches', () => {
  const t = new BranchIssueTracker();
  t.onHead('r', 'main');
  assert.strictEqual(t.onHead('r', 'main'), null);
  assert.strictEqual(t.onHead('r', 'feature/x'), null);
  assert.strictEqual(t.onHead('r', 'issue-12-foo'), 12);
  assert.strictEqual(t.onHead('r', 'issue-12-foo'), null, 'status refresh on the same branch');
  assert.strictEqual(t.onHead('r', undefined), null, 'detached HEAD');
});

test('tracker offers each branch once per session, per repo', () => {
  const t = new BranchIssueTracker();
  t.onHead('a', 'main');
  t.onHead('b', 'main');
  assert.strictEqual(t.onHead('a', 'issue-12-foo'), 12);
  t.onHead('a', 'main');
  assert.strictEqual(t.onHead('a', 'issue-12-foo'), null, 'back again');
  assert.strictEqual(t.onHead('b', 'issue-12-foo'), 12, 'same name in another repo');
});

test('tracker skips a branch the panel just created, once', () => {
  const t = new BranchIssueTracker();
  t.onHead('r', 'main');
  t.skip('issue-12-foo');
  assert.strictEqual(t.onHead('r', 'issue-12-foo'), null);
  t.onHead('r', 'main');
  assert.strictEqual(t.onHead('r', 'issue-12-foo'), null, 'still counted as offered');
});

'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { branchNameForIssue } from './gitBranch';

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

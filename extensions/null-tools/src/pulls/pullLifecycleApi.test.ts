'use strict';

import assert from 'node:assert';
import test, { afterEach, mock } from 'node:test';
import { stub } from './httpStub';
import { mergePull, setPullDraft, setPullOpen } from './pullLifecycleApi';

afterEach(() => mock.restoreAll());

test('mergePull sends the method and pins the head the page showed', async () => {
  const calls = stub([{ body: { data: { mergePullRequest: { pullRequest: { merged: true } } } } }]);
  await mergePull('PR_1', 'SQUASH', 'a'.repeat(40), 't');
  assert.match(calls[0].body.query, /mergePullRequest/);
  assert.deepStrictEqual(calls[0].body.variables.input, { pullRequestId: 'PR_1', mergeMethod: 'SQUASH', expectedHeadOid: 'a'.repeat(40) });
});

test('mergePull: a head that moved, or any refusal, rejects with GitHub\'s own words', async () => {
  stub([{ body: { errors: [{ message: 'Head branch was modified. Review and try the merge again.' }] } }]);
  await assert.rejects(mergePull('PR_1', 'MERGE', 'a'.repeat(40), 't'), /Head branch was modified/);
});

test('setPullOpen closes or reopens', async () => {
  const calls = stub([{ body: { data: {} } }]);
  await setPullOpen('PR_1', false, 't');
  await setPullOpen('PR_1', true, 't');
  assert.match(calls[0].body.query, /closePullRequest/);
  assert.match(calls[1].body.query, /reopenPullRequest/);
  assert.deepStrictEqual(calls[1].body.variables.input, { pullRequestId: 'PR_1' });
});

test('setPullDraft converts to a draft or marks ready', async () => {
  const calls = stub([{ body: { data: {} } }]);
  await setPullDraft('PR_1', true, 't');
  await setPullDraft('PR_1', false, 't');
  assert.match(calls[0].body.query, /convertPullRequestToDraft/);
  assert.match(calls[1].body.query, /markPullRequestReadyForReview/);
  assert.deepStrictEqual(calls[0].body.variables.input, { pullRequestId: 'PR_1' });
});

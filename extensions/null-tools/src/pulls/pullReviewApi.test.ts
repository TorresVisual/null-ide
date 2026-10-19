'use strict';

import assert from 'node:assert';
import test, { afterEach, mock } from 'node:test';
import { stub } from './httpStub';
import {
  addReviewThread, discardReview, ensureReview, fetchReviewState, replyInReview, setThreadResolved, submitNewReview, submitReview,
} from './pullReviewApi';

afterEach(() => mock.restoreAll());

const stateData = (reviews: unknown[], over: Record<string, unknown> = {}) => ({
  data: { repository: { pullRequest: { id: 'PR_1', headRefOid: 'a'.repeat(40), viewerDidAuthor: false, reviews: { nodes: reviews }, ...over } } },
});
const pending = { id: 'REV_1', comments: { totalCount: 3 } };
const gqlComment = { databaseId: 9, state: 'PENDING', body: 'hm', createdAt: '2026-10-01T10:00:00Z', author: { login: 'me', avatarUrl: 'https://x/m.png' } };

test('fetchReviewState reads the PR id, head, authorship and the unsent review', async () => {
  const calls = stub([{ body: stateData([pending]) }]);
  assert.deepStrictEqual(await fetchReviewState('o', 'r', 5, 't'), {
    pullId: 'PR_1', headSha: 'a'.repeat(40), viewerIsAuthor: false, reviewId: 'REV_1', comments: 3,
  });
  assert.deepStrictEqual(calls[0].body.variables, { owner: 'o', name: 'r', number: 5 });
  assert.match(calls[0].body.query, /states: \[PENDING\]/);
});

test('fetchReviewState: no unsent review, and a PR that does not exist', async () => {
  stub([{ body: stateData([]) }]);
  assert.deepStrictEqual(
    { ...await fetchReviewState('o', 'r', 5, 't') }, { pullId: 'PR_1', headSha: 'a'.repeat(40), viewerIsAuthor: false, reviewId: null, comments: 0 });
  mock.restoreAll();
  stub([{ body: { data: { repository: { pullRequest: null } } } }]);
  await assert.rejects(fetchReviewState('o', 'r', 404, 't'), /Pull request not found/);
});

test('ensureReview reuses the unsent review and starts one only when there is none', async () => {
  const reuse = stub([{ body: stateData([pending]) }]);
  assert.strictEqual(await ensureReview('o', 'r', 5, 't'), 'REV_1');
  assert.strictEqual(reuse.length, 1, 'no mutation');
  mock.restoreAll();

  const start = stub([{ body: stateData([]) }, { body: { data: { addPullRequestReview: { pullRequestReview: { id: 'REV_2' } } } } }]);
  assert.strictEqual(await ensureReview('o', 'r', 5, 't'), 'REV_2');
  assert.deepStrictEqual(start[1].body.variables, { input: { pullRequestId: 'PR_1', commitOID: 'a'.repeat(40) } });
  assert.ok(!('event' in start[1].body.variables.input), 'no event: the review stays pending');
});

test('addReviewThread: one line, or a range with its start side', async () => {
  const reply = { data: { addPullRequestReviewThread: { thread: { id: 'T9', comments: { nodes: [gqlComment] } } } } };
  const calls = stub([{ body: reply }]);
  const one = await addReviewThread({ reviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 4, side: 'RIGHT' }, 't');
  assert.deepStrictEqual(calls[0].body.variables.input, { pullRequestReviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 4, side: 'RIGHT' });
  assert.strictEqual(one.threadId, 'T9');
  assert.deepStrictEqual(one.comment, { id: 9, body: 'hm', author: 'me', avatar: 'https://x/m.png', createdAt: '2026-10-01T10:00:00Z', pending: true });

  await addReviewThread({ reviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 6, startLine: 4, side: 'LEFT' }, 't');
  assert.deepStrictEqual(calls[1].body.variables.input, {
    pullRequestReviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 6, side: 'LEFT', startLine: 4, startSide: 'LEFT',
  });

  await addReviewThread({ reviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 4, startLine: 4, side: 'RIGHT' }, 't');
  assert.ok(!('startLine' in calls[2].body.variables.input), 'a start line equal to the line is a single line');
});

test('addReviewThread: GitHub returning no thread is an error, not a silent success', async () => {
  stub([{ body: { data: { addPullRequestReviewThread: { thread: null } } } }]);
  await assert.rejects(addReviewThread({ reviewId: 'R', body: 'x', path: 'a', line: 1, side: 'RIGHT' }, 't'), /did not create/);
});

test('replyInReview posts into the pending review', async () => {
  const calls = stub([{ body: { data: { addPullRequestReviewThreadReply: { comment: gqlComment } } } }]);
  const c = await replyInReview('REV_1', 'T9', 'ok', 't');
  assert.deepStrictEqual(calls[0].body.variables.input, { pullRequestReviewId: 'REV_1', pullRequestReviewThreadId: 'T9', body: 'ok' });
  assert.strictEqual(c.pending, true);
});

test('submitReview, submitNewReview, discardReview and setThreadResolved send exactly what they are given', async () => {
  const calls = stub([{ body: { data: {} } }]);
  await submitReview('REV_1', 'REQUEST_CHANGES', 'fix it', 't');
  assert.match(calls[0].body.query, /submitPullRequestReview/);
  assert.deepStrictEqual(calls[0].body.variables.input, { pullRequestReviewId: 'REV_1', event: 'REQUEST_CHANGES', body: 'fix it' });

  await submitNewReview({ pullId: 'PR_1', headSha: 'b'.repeat(40), viewerIsAuthor: false, reviewId: null, comments: 0 }, 'APPROVE', '', 't');
  assert.match(calls[1].body.query, /addPullRequestReview\(/);
  assert.deepStrictEqual(calls[1].body.variables.input, { pullRequestId: 'PR_1', commitOID: 'b'.repeat(40), event: 'APPROVE', body: '' });

  await discardReview('REV_1', 't');
  assert.match(calls[2].body.query, /deletePullRequestReview/);
  assert.deepStrictEqual(calls[2].body.variables.input, { pullRequestReviewId: 'REV_1' });

  await setThreadResolved('T9', true, 't');
  assert.match(calls[3].body.query, /resolveReviewThread/);
  assert.doesNotMatch(calls[3].body.query, /unresolveReviewThread/);
  await setThreadResolved('T9', false, 't');
  assert.match(calls[4].body.query, /unresolveReviewThread/);
  assert.deepStrictEqual(calls[4].body.variables.input, { threadId: 'T9' });
});

test('a GraphQL error from a mutation surfaces GitHub\'s message', async () => {
  stub([{ body: { errors: [{ message: 'Can not approve your own pull request' }] } }]);
  await assert.rejects(submitReview('REV_1', 'APPROVE', '', 't'), /Can not approve your own pull request/);
});

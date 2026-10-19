'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { ActionFacts, pageActions, reviewBodyError, reviewChoices } from './pullActionsModel';

const facts = (over: Partial<ActionFacts> = {}): ActionFacts => ({
  state: 'open', draft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  viewerCanUpdate: true, viewerDidAuthor: false, viewerPermission: 'WRITE',
  mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false, pendingComments: null, ...over,
});

test('an open, clean PR you can write to: everything is on offer', () => {
  assert.deepStrictEqual(pageActions(facts()), {
    review: { available: true, canApprove: true, pending: null },
    merge: { enabled: true, hint: 'Ready to merge.', methods: ['MERGE', 'SQUASH'] },
    state: 'close', draft: 'draft',
  });
});

test('merge is disabled, with the reason, for a draft, conflicts, read access, or no allowed method', () => {
  const merge = (over: Partial<ActionFacts>) => pageActions(facts(over)).merge;
  assert.deepStrictEqual([merge({ draft: true }).enabled, merge({ draft: true }).hint], [false, 'Mark this as ready for review to merge it.']);
  assert.deepStrictEqual([merge({ mergeable: 'CONFLICTING' }).enabled, merge({ mergeable: 'CONFLICTING' }).hint], [false, 'This branch has conflicts that must be resolved first.']);
  assert.deepStrictEqual([merge({ viewerPermission: 'READ' }).enabled, merge({ viewerPermission: 'TRIAGE' }).enabled], [false, false]);
  assert.match(merge({ viewerPermission: 'READ' }).hint, /write access/);
  const none = merge({ mergeCommitAllowed: false, squashMergeAllowed: false, rebaseMergeAllowed: false });
  assert.deepStrictEqual([none.enabled, none.methods, none.hint], [false, [], 'This repository allows no merge method.']);
});

test('merge stays enabled when GitHub only says blocked, behind or unstable: the repository may let you through, GitHub decides', () => {
  for (const status of ['BLOCKED', 'BEHIND', 'UNSTABLE']) {
    const m = pageActions(facts({ mergeStateStatus: status })).merge;
    assert.strictEqual(m.enabled, true, status);
    assert.notStrictEqual(m.hint, '', status);
  }
  assert.strictEqual(pageActions(facts({ mergeStateStatus: 'SOMETHING_NEW' })).merge.hint, '', 'an unknown status says nothing');
  assert.strictEqual(pageActions(facts({ mergeStateStatus: 'SOMETHING_NEW' })).merge.enabled, true);
});

test('merge method order is merge, squash, rebase and only the allowed ones', () => {
  assert.deepStrictEqual(pageActions(facts({ mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: true })).merge.methods, ['SQUASH', 'REBASE']);
});

test('closed and merged PRs: nothing to merge; closed can be reopened, merged is final', () => {
  const closed = pageActions(facts({ state: 'closed' }));
  assert.deepStrictEqual([closed.merge.enabled, closed.merge.hint, closed.state, closed.draft, closed.review.available], [false, '', 'reopen', null, false]);
  const merged = pageActions(facts({ state: 'merged' }));
  assert.deepStrictEqual([merged.merge.enabled, merged.state, merged.draft, merged.review.available], [false, null, null, false]);
});

test('close and draft follow viewerCanUpdate and the current draft state', () => {
  assert.deepStrictEqual([pageActions(facts({ draft: true })).draft, pageActions(facts({ draft: false })).draft], ['ready', 'draft']);
  const readOnly = pageActions(facts({ viewerCanUpdate: false }));
  assert.deepStrictEqual([readOnly.state, readOnly.draft], [null, null]);
});

test('your own PR cannot be approved; a pending review is reported with its comment count', () => {
  assert.strictEqual(pageActions(facts({ viewerDidAuthor: true })).review.canApprove, false);
  assert.strictEqual(pageActions(facts({ pendingComments: 3 })).review.pending, 3);
});

test('reviewChoices: approve and request changes are hidden on your own PR; discard only when something is pending', () => {
  const labels = (s: Parameters<typeof reviewChoices>[0]) => reviewChoices(s).map(o => o.choice);
  assert.deepStrictEqual(labels({ viewerIsAuthor: false, reviewId: null, comments: 0 }), ['COMMENT', 'APPROVE', 'REQUEST_CHANGES']);
  assert.deepStrictEqual(labels({ viewerIsAuthor: true, reviewId: null, comments: 0 }), ['COMMENT']);
  assert.deepStrictEqual(labels({ viewerIsAuthor: false, reviewId: 'R', comments: 2 }), ['COMMENT', 'APPROVE', 'REQUEST_CHANGES', 'DISCARD']);
  assert.match(reviewChoices({ viewerIsAuthor: false, reviewId: 'R', comments: 1 })[0].description, /1 pending comment\b/);
  assert.match(reviewChoices({ viewerIsAuthor: false, reviewId: 'R', comments: 2 })[0].description, /2 pending comments/);
  assert.doesNotMatch(reviewChoices({ viewerIsAuthor: false, reviewId: 'R', comments: 0 })[0].description, /pending/);
});

test('reviewBodyError: requesting changes needs a body; a bare comment needs a body unless comments are pending; approving never does', () => {
  assert.match(reviewBodyError('REQUEST_CHANGES', 5, '')!, /what needs to change/);
  assert.match(reviewBodyError('REQUEST_CHANGES', 0, '   \n')!, /what needs to change/, 'whitespace is empty');
  assert.match(reviewBodyError('COMMENT', 0, '')!, /Write a comment/);
  assert.strictEqual(reviewBodyError('COMMENT', 2, ''), undefined);
  assert.strictEqual(reviewBodyError('APPROVE', 0, ''), undefined);
  assert.strictEqual(reviewBodyError('REQUEST_CHANGES', 0, 'fix x'), undefined);
});

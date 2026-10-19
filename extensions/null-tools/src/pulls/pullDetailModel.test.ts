'use strict';

import assert from 'node:assert';
import test from 'node:test';
import {
  CheckRow, PullPageData, checkRowState, failedRunIds, mapChecks, mapPullPage, safeExternalUrl, statusContextState,
} from './pullDetailModel';

const user = (login: string) => ({ login, avatarUrl: `https://avatars.githubusercontent.com/${login}` });

const gqlPage = (over: Record<string, unknown> = {}): PullPageData => ({
  repository: {
    viewerPermission: 'WRITE', mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false,
    pullRequest: {
      id: 'PR_1', headRefOid: 'c'.repeat(40), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
      viewerCanUpdate: true, viewerDidAuthor: false, pendingReview: { nodes: [] },
      number: 12, title: 'Add x', url: 'https://github.com/o/r/pull/12', state: 'OPEN', isDraft: false,
      createdAt: '2026-10-01T10:00:00Z', bodyHTML: '<p>Hi</p>', headRefName: 'feat/x', baseRefName: 'main',
      isCrossRepository: false, additions: 10, deletions: 2, changedFiles: 3,
      author: user('octocat'),
      labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
      milestone: { title: 'v1' },
      assignees: { nodes: [user('hubot')] },
      reviewRequests: { nodes: [] },
      latestOpinionatedReviews: { nodes: [] },
      commits: {
        totalCount: 1,
        nodes: [{ commit: { oid: 'a'.repeat(40), abbreviatedOid: 'aaaaaaa', messageHeadline: 'wip', committedDate: '2026-10-01T09:00:00Z',
          url: 'https://github.com/o/r/commit/a', author: { name: 'Octo Cat', user: { login: 'octocat' } } } }],
      },
      timelineItems: { totalCount: 0, nodes: [] },
      lastCommit: { nodes: [{ commit: { statusCheckRollup: null } }] },
      ...over,
    },
  },
} as unknown as PullPageData);

test('mapPullPage maps the header, sidebar and commits', () => {
  const p = mapPullPage(gqlPage());
  assert.strictEqual(p.number, 12);
  assert.strictEqual(p.state, 'open');
  assert.deepStrictEqual(p.author, { login: 'octocat', avatar: 'https://avatars.githubusercontent.com/octocat' });
  assert.deepStrictEqual(p.labels, [{ name: 'bug', color: 'd73a4a' }]);
  assert.strictEqual(p.milestone, 'v1');
  assert.deepStrictEqual(p.assignees.map(a => a.login), ['hubot']);
  assert.deepStrictEqual(p.commits, [{
    sha: 'a'.repeat(40), short: 'aaaaaaa', headline: 'wip', author: 'octocat', at: '2026-10-01T09:00:00Z', url: 'https://github.com/o/r/commit/a',
  }]);
  assert.strictEqual(p.commitTotal, 1);
  assert.strictEqual(p.checkState, 'none');
  assert.deepStrictEqual(p.checks, []);
});

test('mapPullPage: merged, closed, a deleted author, a commit by a non-GitHub user', () => {
  assert.strictEqual(mapPullPage(gqlPage({ state: 'MERGED' })).state, 'merged');
  assert.strictEqual(mapPullPage(gqlPage({ state: 'CLOSED' })).state, 'closed');
  assert.strictEqual(mapPullPage(gqlPage({ author: null })).author.login, 'ghost');
  const commits = { totalCount: 1, nodes: [{ commit: { oid: 'b'.repeat(40), abbreviatedOid: 'bbbbbbb', messageHeadline: 'x',
    committedDate: '2026-10-01T09:00:00Z', url: 'u', author: { name: 'Octo Cat', user: null } } }] };
  assert.strictEqual(mapPullPage(gqlPage({ commits })).commits[0].author, 'Octo Cat');
});

test('mapPullPage throws a readable error when the PR does not exist', () => {
  assert.throws(() => mapPullPage({ repository: { pullRequest: null } } as PullPageData), /Pull request not found/);
  assert.throws(() => mapPullPage({ repository: null } as unknown as PullPageData), /Pull request not found/);
});

test('mapPullPage keeps the ids for writes and derives the actions from the page', () => {
  const p = mapPullPage(gqlPage());
  assert.strictEqual(p.id, 'PR_1');
  assert.strictEqual(p.headSha, 'c'.repeat(40));
  assert.deepStrictEqual(p.actions, {
    review: { available: true, canApprove: true, pending: null },
    merge: { enabled: true, hint: 'Ready to merge.', methods: ['MERGE', 'SQUASH'] },
    state: 'close', draft: 'draft',
  });
  const unsent = mapPullPage(gqlPage({ pendingReview: { nodes: [{ id: 'REV_1', comments: { totalCount: 3 } }] } }));
  assert.strictEqual(unsent.actions.review.pending, 3);
  assert.strictEqual(mapPullPage(gqlPage({ viewerDidAuthor: true })).actions.review.canApprove, false);
});

test('mapTimeline: comments, reviews, events; PENDING reviews, unknown types and null nodes are skipped; deleted authors are ghost', () => {
  const nodes = [
    { __typename: 'IssueComment', url: 'u1', createdAt: '2026-10-01T11:00:00Z', bodyHTML: '<p>c</p>', author: user('a') },
    { __typename: 'PullRequestReview', url: 'u2', state: 'APPROVED', createdAt: '2026-10-01T12:00:00Z', bodyHTML: '', author: user('b'), comments: { totalCount: 2 } },
    { __typename: 'PullRequestReview', url: 'u3', state: 'PENDING', createdAt: '2026-10-01T12:30:00Z', bodyHTML: '', author: user('me'), comments: { totalCount: 1 } },
    { __typename: 'PullRequestReview', url: 'u4', state: 'CHANGES_REQUESTED', createdAt: '2026-10-01T13:00:00Z', bodyHTML: '<p>no</p>', author: null, comments: { totalCount: 0 } },
    { __typename: 'MergedEvent', createdAt: '2026-10-02T10:00:00Z', actor: { login: 'maint' } },
    { __typename: 'ClosedEvent', createdAt: '2026-10-02T11:00:00Z', actor: null },
    { __typename: 'ConvertToDraftEvent', createdAt: '2026-10-02T12:00:00Z', actor: { login: 'a' } },
    { __typename: 'SomethingNew', createdAt: '2026-10-02T13:00:00Z' },
    { __typename: 'constructor' },
    null,
  ];
  const timeline = mapPullPage(gqlPage({ timelineItems: { totalCount: 12, nodes } })).timeline;
  assert.deepStrictEqual(timeline.map(i => (i.kind === 'event' ? `event:${i.event}:${i.actor}` : i.kind === 'review' ? `review:${i.verdict}:${i.author.login}` : `comment:${i.author.login}`)), [
    'comment:a', 'review:approved:b', 'review:changes:ghost', 'event:merged:maint', 'event:closed:ghost', 'event:draft:a',
  ]);
  const approved = timeline[1];
  assert.ok(approved.kind === 'review' && approved.comments === 2 && approved.url === 'u2');
});

test('mapPullPage keeps the timeline total so the page can say it is cut off', () => {
  const p = mapPullPage(gqlPage({ timelineItems: { totalCount: 230, nodes: [] }, commits: { totalCount: 130, nodes: [] } }));
  assert.strictEqual(p.timelineTotal, 230);
  assert.strictEqual(p.commitTotal, 130);
});

test('mapReviewers: latest verdicts, a re-request wins over an old verdict, a team has a name instead of a login', () => {
  const p = mapPullPage(gqlPage({
    latestOpinionatedReviews: { nodes: [
      { state: 'APPROVED', author: user('ann') }, { state: 'CHANGES_REQUESTED', author: user('bob') },
      { state: 'DISMISSED', author: user('dee') }, { state: 'COMMENTED', author: null },
    ] },
    reviewRequests: { nodes: [
      { requestedReviewer: { __typename: 'User', login: 'bob', avatarUrl: 'https://a/bob' } },
      { requestedReviewer: { __typename: 'Team', slug: 'core' } },
      { requestedReviewer: null },
    ] },
  }));
  assert.deepStrictEqual(p.reviewers.map(r => `${r.login}:${r.state}`), ['ann:approved', 'bob:pending', 'dee:dismissed', 'core:pending']);
});

test('checkRowState / statusContextState', () => {
  assert.strictEqual(checkRowState('COMPLETED', 'SUCCESS'), 'success');
  for (const c of ['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE']) assert.strictEqual(checkRowState('COMPLETED', c), 'failure', c);
  for (const c of ['NEUTRAL', 'SKIPPED', 'CANCELLED', 'STALE', null]) assert.strictEqual(checkRowState('COMPLETED', c), 'neutral', String(c));
  assert.strictEqual(checkRowState('COMPLETED', 'ACTION_REQUIRED'), 'pending');
  for (const s of ['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING', 'REQUESTED']) assert.strictEqual(checkRowState(s, null), 'pending', s);
  assert.deepStrictEqual(['SUCCESS', 'FAILURE', 'ERROR', 'PENDING', 'EXPECTED', 'WHAT'].map(statusContextState),
    ['success', 'failure', 'failure', 'pending', 'pending', 'neutral']);
});

test('mapChecks: check runs and legacy statuses, failures first, then by name; run id only from Actions checks', () => {
  const rows = mapChecks([
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/o/r/actions/runs/1/job/1', checkSuite: { workflowRun: { databaseId: 1 } } },
    { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/2/job/9', checkSuite: { workflowRun: { databaseId: 2 } } },
    { __typename: 'CheckRun', name: 'app', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: null, checkSuite: { workflowRun: null } },
    { __typename: 'StatusContext', context: 'ci/legacy', state: 'FAILURE', targetUrl: 'https://ci.example/1', description: 'broke' },
    { __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: null, detailsUrl: 'https://x', checkSuite: null },
    { __typename: 'Unknown' },
    null,
  ]);
  assert.deepStrictEqual(rows.map(r => `${r.state}:${r.name}`), ['failure:app', 'failure:ci/legacy', 'failure:test', 'pending:build', 'success:lint']);
  assert.strictEqual(rows.find(r => r.name === 'test')!.runId, 2);
  assert.strictEqual(rows.find(r => r.name === 'app')!.runId, null);
  assert.strictEqual(rows.find(r => r.name === 'ci/legacy')!.description, 'broke');
});

test('mapPullPage reads the rollup: overall state, rows and the total (which may exceed the rows)', () => {
  const rollup = { state: 'FAILURE', contexts: { totalCount: 150, nodes: [
    { __typename: 'CheckRun', name: 't', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://x', checkSuite: { workflowRun: { databaseId: 5 } } },
  ] } };
  const p = mapPullPage(gqlPage({ lastCommit: { nodes: [{ commit: { statusCheckRollup: rollup } }] } }));
  assert.strictEqual(p.checkState, 'failure');
  assert.strictEqual(p.checks.length, 1);
  assert.strictEqual(p.checksTotal, 150);
});

test('failedRunIds: distinct runs of failed rows only; no failures or no run ids means nothing to re-run', () => {
  const row = (state: CheckRow['state'], runId: number | null): CheckRow => ({ name: 'n', state, url: null, runId, description: '' });
  assert.deepStrictEqual(failedRunIds([row('failure', 2), row('failure', 2), row('failure', 3), row('success', 4), row('pending', 5), row('failure', null)]), [2, 3]);
  assert.deepStrictEqual(failedRunIds([row('success', 1), row('neutral', 2)]), []);
  assert.deepStrictEqual(failedRunIds([row('failure', null), row('failure', -1), row('failure', 1.5)]), []);
  assert.deepStrictEqual(failedRunIds([]), []);
});

test('safeExternalUrl allows https only', () => {
  assert.strictEqual(safeExternalUrl('https://github.com/o/r/pull/1'), 'https://github.com/o/r/pull/1');
  for (const bad of ['javascript:alert(1)', 'http://github.com', 'file:///etc/passwd', 'vscode://x', '/relative', '#frag', '', 'not a url', null, undefined, 7]) {
    assert.strictEqual(safeExternalUrl(bad), null, String(bad));
  }
});

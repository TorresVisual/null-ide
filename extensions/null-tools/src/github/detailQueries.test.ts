'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { IssueDetailData, collapseTimeline, mapComment, mapIssueDetail, mapReactions, mapTimelinePage } from './detailQueries';
import { TimelineItem } from './types';

const user = { login: 'octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' };
const groups = [
  { content: 'THUMBS_UP', viewerHasReacted: true, reactors: { totalCount: 2 } },
  { content: 'EYES', viewerHasReacted: false, reactors: { totalCount: 0 } },
];

const commentNode = (over: Record<string, unknown> = {}) => ({
  __typename: 'IssueComment', id: 'IC_1', url: 'https://github.com/o/r/issues/7#issuecomment-1', body: 'Looks **good**',
  bodyHTML: '<p>Looks <strong>good</strong></p>', createdAt: '2026-10-01T11:00:00Z', lastEditedAt: null,
  authorAssociation: 'MEMBER', isMinimized: false, minimizedReason: null, viewerCanUpdate: true, viewerCanDelete: false,
  author: user, reactionGroups: groups, ...over,
});

const issueNode = (over: Record<string, unknown> = {}) => ({
  id: 'I_7', number: 7, title: 'Crash on start', body: 'It crashes', bodyHTML: '<p>It crashes</p>', state: 'OPEN',
  stateReason: null, url: 'https://github.com/o/r/issues/7', createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-02T10:00:00Z', closedAt: null, lastEditedAt: '2026-10-01T10:05:00Z', authorAssociation: 'OWNER',
  viewerCanUpdate: true, author: user, labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
  assignees: { nodes: [user] }, comments: { totalCount: 1 },
  milestone: { number: 2, title: 'v1.0', progressPercentage: 33.3333 }, issueType: { id: 'IT_1', name: 'Bug' },
  subIssuesSummary: { total: 1, completed: 0 },
  subIssues: { nodes: [{ id: 'I_8', number: 8, title: 'Child', state: 'OPEN', stateReason: null, url: 'https://github.com/o/r/issues/8', assignees: { nodes: [user] } }] },
  parent: { number: 3, title: 'Epic', url: 'https://github.com/o/r/issues/3' },
  closedByPullRequestsReferences: { totalCount: 1, nodes: [{ number: 9, title: 'Fix', state: 'MERGED', url: 'https://github.com/o/r/pull/9', isDraft: false }] },
  participants: { nodes: [user] }, reactionGroups: groups,
  timelineItems: { pageInfo: { hasNextPage: true, endCursor: 'cur' }, nodes: [commentNode()] },
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({ repository: { issue: issueNode(over) } }) as unknown as IssueDetailData;

test('mapIssueDetail maps the header, sidebar data and the body as the first post', () => {
  const d = mapIssueDetail(detail(), 'o/r');
  assert.strictEqual(d.id, 'I_7');
  assert.strictEqual(d.issue.number, 7);
  assert.strictEqual(d.issue.state, 'open');
  assert.deepStrictEqual(d.issueType, { id: 'IT_1', name: 'Bug' });
  assert.deepStrictEqual(d.milestone, { number: 2, title: 'v1.0', percent: 33 });
  assert.deepStrictEqual(d.parent, { number: 3, title: 'Epic', url: 'https://github.com/o/r/issues/3' });
  assert.deepStrictEqual(d.subIssues.map(s => [s.id, s.number, s.state]), [['I_8', 8, 'open']]);
  assert.deepStrictEqual(d.linkedPrs, [{ number: 9, title: 'Fix', state: 'merged', isDraft: false, url: 'https://github.com/o/r/pull/9' }]);
  assert.strictEqual(d.participants.length, 1);
  assert.strictEqual(d.post.id, 'I_7');
  assert.strictEqual(d.post.bodyHTML, '<p>It crashes</p>');
  assert.strictEqual(d.post.viewerCanUpdate, true);
  assert.strictEqual(d.post.viewerCanDelete, false);
  assert.strictEqual(d.post.authorAssociation, 'OWNER');
  assert.strictEqual(d.hasMoreTimeline, true);
  assert.strictEqual(d.timelineCursor, 'cur');
});

test('mapIssueDetail copes with a repo without issue types, milestones, parent or linked PRs', () => {
  const d = mapIssueDetail(detail({
    milestone: null, issueType: null, parent: null, subIssuesSummary: null, closedByPullRequestsReferences: null,
    subIssues: { nodes: [] },
  }), 'o/r');
  assert.strictEqual(d.milestone, null);
  assert.strictEqual(d.issueType, null);
  assert.strictEqual(d.parent, null);
  assert.deepStrictEqual(d.linkedPrs, []);
  assert.deepStrictEqual(d.subIssues, []);
});

test('mapIssueDetail throws when the issue does not exist (e.g. the number belongs to a pull request)', () => {
  assert.throws(() => mapIssueDetail({ repository: { issue: null } }, 'o/r'), /not found/);
});

test('a deleted author is shown as ghost on the issue and on comments', () => {
  const d = mapIssueDetail(detail({
    author: null,
    timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [commentNode({ author: null })] },
  }), 'o/r');
  assert.strictEqual(d.post.author.login, 'ghost');
  const c = d.timeline[0];
  assert.strictEqual(c.kind === 'comment' && c.author.login, 'ghost');
});

test('mapComment maps reactions, minimized state and edit rights', () => {
  const post = mapComment(commentNode({ isMinimized: true, minimizedReason: 'OFF_TOPIC' }) as never);
  assert.deepStrictEqual(post.reactions, [
    { content: 'THUMBS_UP', count: 2, viewerHasReacted: true },
    { content: 'EYES', count: 0, viewerHasReacted: false },
  ]);
  assert.strictEqual(post.minimizedReason, 'off_topic');
  assert.strictEqual(mapComment(commentNode() as never).minimizedReason, null);
  assert.deepStrictEqual(mapReactions([]), []);
});

const page = (nodes: unknown[]) => mapTimelinePage({ pageInfo: { hasNextPage: false, endCursor: null }, nodes } as never, 'o/r');
const ev = (typename: string, over: Record<string, unknown> = {}) => ({
  __typename: typename, createdAt: '2026-10-01T12:00:00Z', actor: { login: 'octocat' }, ...over,
});

test('timeline events map to plain data and unknown event types are skipped', () => {
  const { items } = page([
    ev('ClosedEvent', { stateReason: 'NOT_PLANNED', closer: { abbreviatedOid: 'abc1234', url: 'https://github.com/o/r/commit/abc1234' } }),
    ev('ReopenedEvent'),
    ev('RenamedTitleEvent', { previousTitle: 'old', currentTitle: 'new' }),
    ev('AssignedEvent', { assignee: { login: 'hubot' } }),
    ev('MilestonedEvent', { milestoneTitle: 'v1.0' }),
    ev('MentionedEvent'),
    ev('SubscribedEvent'),
  ]);
  assert.deepStrictEqual(items.map(i => i.kind === 'event' ? i.type : 'comment'),
    ['closed', 'reopened', 'renamed', 'assigned', 'milestoned']);
  const closed = items[0];
  assert.ok(closed.kind === 'event' && closed.type === 'closed');
  assert.strictEqual(closed.reason, 'not_planned');
  assert.deepStrictEqual(closed.closer, { text: 'abc1234', url: 'https://github.com/o/r/commit/abc1234' });
});

test('a pull request closer is shown as #n, and a missing closer stays null', () => {
  const { items } = page([
    ev('ClosedEvent', { stateReason: 'COMPLETED', closer: { number: 12, url: 'https://github.com/o/r/pull/12' } }),
    ev('ClosedEvent', { stateReason: null, closer: null }),
  ]);
  const [a, b] = items;
  assert.ok(a.kind === 'event' && a.type === 'closed' && b.kind === 'event' && b.type === 'closed');
  assert.strictEqual(a.closer?.text, '#12');
  assert.strictEqual(b.closer, null);
  assert.strictEqual(b.reason, null);
});

test('cross references show #n in this repo and owner/repo#n elsewhere; a deleted actor is ghost', () => {
  const src = (nameWithOwner: string) => ({
    source: { number: 5, title: 'Related', url: 'https://github.com/x/y/issues/5', repository: { nameWithOwner } },
  });
  const { items } = page([ev('CrossReferencedEvent', src('O/R')), ev('CrossReferencedEvent', { ...src('x/y'), actor: null })]);
  const [a, b] = items;
  assert.ok(a.kind === 'event' && b.kind === 'event' && 'text' in a && 'text' in b);
  assert.strictEqual(a.text, 'Related #5');
  assert.strictEqual(b.text, 'Related x/y#5');
  assert.strictEqual(b.actor, 'ghost');
});

test('a cross reference without a source, or a commit reference without a commit, is dropped', () => {
  assert.deepStrictEqual(page([ev('CrossReferencedEvent', { source: null }), ev('ReferencedEvent', { commit: null })]).items, []);
});

const label = (name: string) => ({ name, color: 'ffffff' });
const labelEvent = (type: 'added' | 'removed', name: string, at: string, actor = 'octocat'): TimelineItem => ({
  kind: 'event', type: 'labels', at, actor, added: type === 'added' ? [label(name)] : [], removed: type === 'removed' ? [label(name)] : [],
});

test('collapseTimeline merges label events by the same actor within 60 seconds', () => {
  const out = collapseTimeline([
    labelEvent('added', 'bug', '2026-10-01T12:00:00Z'),
    labelEvent('added', 'ui', '2026-10-01T12:00:30Z'),
    labelEvent('removed', 'wip', '2026-10-01T12:01:10Z'),
  ]);
  assert.strictEqual(out.length, 1);
  const only = out[0];
  assert.ok(only.kind === 'event' && only.type === 'labels');
  assert.deepStrictEqual(only.added.map(l => l.name), ['bug', 'ui']);
  assert.deepStrictEqual(only.removed.map(l => l.name), ['wip']);
});

test('collapseTimeline keeps label events apart across actors, gaps over a minute, and other events', () => {
  assert.strictEqual(collapseTimeline([
    labelEvent('added', 'a', '2026-10-01T12:00:00Z'), labelEvent('added', 'b', '2026-10-01T12:00:10Z', 'hubot'),
  ]).length, 2);
  assert.strictEqual(collapseTimeline([
    labelEvent('added', 'a', '2026-10-01T12:00:00Z'), labelEvent('added', 'b', '2026-10-01T12:02:00Z'),
  ]).length, 2);
  const reopened: TimelineItem = { kind: 'event', type: 'reopened', at: '2026-10-01T12:00:05Z', actor: 'octocat' };
  assert.strictEqual(collapseTimeline([
    labelEvent('added', 'a', '2026-10-01T12:00:00Z'), reopened, labelEvent('added', 'b', '2026-10-01T12:00:10Z'),
  ]).length, 3);
});

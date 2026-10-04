'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { MetadataData, SearchData, mapMetadata, mapSearchPage } from './githubQueries';

const issueNode = (over: Record<string, unknown> = {}) => ({
  number: 7, title: 'Crash on start', body: 'It crashes', state: 'OPEN', stateReason: null,
  url: 'https://github.com/o/r/issues/7', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z',
  closedAt: null, author: { login: 'octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' },
  labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
  assignees: { nodes: [{ login: 'hubot', avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4' }] },
  comments: { totalCount: 3 }, milestone: { number: 2, title: 'v1.0' }, issueType: { name: 'Bug' },
  subIssuesSummary: { total: 3, completed: 1 }, closedByPullRequestsReferences: { totalCount: 1 },
  ...over,
});

const page = (nodes: unknown[], extra: Record<string, unknown> = {}): SearchData => ({
  search: { pageInfo: { hasNextPage: true, endCursor: 'abc' }, nodes },
  ...extra,
} as SearchData);

test('mapSearchPage maps an open issue to the REST-shaped GithubIssue the rest of the extension uses', () => {
  const result = mapSearchPage(page([issueNode()], { open: { issueCount: 52 }, closed: { issueCount: 58 } }));
  assert.deepStrictEqual(result.items[0], {
    number: 7, title: 'Crash on start', body: 'It crashes', state: 'open', state_reason: null,
    html_url: 'https://github.com/o/r/issues/7',
    labels: [{ name: 'bug', color: 'd73a4a' }],
    assignees: [{ login: 'hubot', avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4' }],
    user: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
    comments: 3, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-02T10:00:00Z', closed_at: null,
    milestone: { number: 2, title: 'v1.0' }, issue_type: 'Bug', sub_issues: { total: 3, completed: 1 }, linked_prs: 1,
  });
  assert.strictEqual(result.hasMore, true);
  assert.strictEqual(result.cursor, 'abc');
  assert.strictEqual(result.openCount, 52);
  assert.strictEqual(result.closedCount, 58);
});

test('mapSearchPage lowercases state and stateReason', () => {
  const closed = mapSearchPage(page([issueNode({ state: 'CLOSED', stateReason: 'NOT_PLANNED', closedAt: '2026-10-03T00:00:00Z' })]));
  assert.strictEqual(closed.items[0].state, 'closed');
  assert.strictEqual(closed.items[0].state_reason, 'not_planned');
  assert.strictEqual(closed.items[0].closed_at, '2026-10-03T00:00:00Z');
});

test('mapSearchPage tolerates a deleted author, null body, missing optional blocks, and zero sub-issues', () => {
  const [issue] = mapSearchPage(page([issueNode({
    author: null, body: null, milestone: null, issueType: null,
    subIssuesSummary: { total: 0, completed: 0 }, closedByPullRequestsReferences: null,
  })])).items;
  assert.deepStrictEqual(issue.user, { login: 'ghost', avatar_url: '' });
  assert.strictEqual(issue.body, '');
  assert.strictEqual(issue.milestone, null);
  assert.strictEqual(issue.issue_type, null);
  assert.strictEqual(issue.sub_issues, null);
  assert.strictEqual(issue.linked_prs, 0);
});

test('mapSearchPage skips non-issue search nodes and reports null counts when none were requested', () => {
  const result = mapSearchPage(page([{}, issueNode()]));
  assert.deepStrictEqual(result.items.map(i => i.number), [7]);
  assert.strictEqual(result.openCount, null);
  assert.strictEqual(result.closedCount, null);
});

test('mapMetadata handles a repo without issue types (issueTypes: null)', () => {
  const data: MetadataData = {
    viewer: { login: 'octocat' },
    repository: {
      labels: { nodes: [{ name: 'bug', color: 'd73a4a', description: 'Something isn\'t working' }] },
      assignableUsers: { nodes: [{ login: 'octocat', avatarUrl: 'https://a/u/1' }] },
      milestones: { nodes: [{ number: 2, title: 'v1.0' }] },
      issueTypes: null,
    },
  };
  assert.deepStrictEqual(mapMetadata(data), {
    labels: [{ name: 'bug', color: 'd73a4a', description: 'Something isn\'t working' }],
    assignees: [{ login: 'octocat', avatar_url: 'https://a/u/1' }],
    milestones: [{ number: 2, title: 'v1.0' }],
    issueTypes: [],
    viewerLogin: 'octocat',
  });
});

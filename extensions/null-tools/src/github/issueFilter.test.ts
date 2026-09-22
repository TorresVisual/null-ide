'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { filterIssues, stripPullRequests } from './issueFilter';
import { GithubIssue } from './types';

function makeIssue(overrides: Partial<GithubIssue>): GithubIssue {
  return {
    number: 1,
    title: 'Untitled',
    body: '',
    state: 'open',
    html_url: 'https://github.com/o/r/issues/1',
    labels: [],
    assignees: [],
    user: { login: 'author', avatar_url: '' },
    comments: 0,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('stripPullRequests removes entries with a pull_request field', () => {
  const issue = makeIssue({ number: 1 });
  const pr = makeIssue({ number: 2, pull_request: { url: 'x' } });
  assert.deepStrictEqual(stripPullRequests([issue, pr]), [issue]);
});

test('filterIssues requires ALL selected labels to be present (AND)', () => {
  const a = makeIssue({ number: 1, labels: [{ name: 'bug', color: 'f00' }] });
  const b = makeIssue({ number: 2, labels: [{ name: 'bug', color: 'f00' }, { name: 'ui', color: '0f0' }] });
  const opts = { labels: ['bug', 'ui'], assignee: 'everyone' as const, query: '', viewerLogin: null };
  assert.deepStrictEqual(filterIssues([a, b], opts), [b]);
});

test('filterIssues "me" never falls back to showing everyone when signed out', () => {
  const a = makeIssue({ number: 1, assignees: [{ login: 'octocat', avatar_url: '' }] });
  const opts = { labels: [], assignee: 'me' as const, query: '', viewerLogin: null };
  assert.deepStrictEqual(filterIssues([a], opts), []);
});

test('filterIssues "me" matches the viewer\'s own assigned issues', () => {
  const mine = makeIssue({ number: 1, assignees: [{ login: 'octocat', avatar_url: '' }] });
  const other = makeIssue({ number: 2, assignees: [{ login: 'someoneelse', avatar_url: '' }] });
  const opts = { labels: [], assignee: 'me' as const, query: '', viewerLogin: 'octocat' };
  assert.deepStrictEqual(filterIssues([mine, other], opts), [mine]);
});

test('filterIssues searches title and body case-insensitively', () => {
  const a = makeIssue({ number: 1, title: 'Crash on startup', body: '' });
  const b = makeIssue({ number: 2, title: 'Unrelated', body: 'reproduces on STARTUP too' });
  const c = makeIssue({ number: 3, title: 'Also unrelated', body: '' });
  const opts = { labels: [], assignee: 'everyone' as const, query: 'startup', viewerLogin: null };
  assert.deepStrictEqual(filterIssues([a, b, c], opts).map(i => i.number), [1, 2]);
});

test('filterIssues with no filters returns everything unchanged', () => {
  const issues = [makeIssue({ number: 1 }), makeIssue({ number: 2 })];
  const opts = { labels: [], assignee: 'everyone' as const, query: '', viewerLogin: null };
  assert.deepStrictEqual(filterIssues(issues, opts), issues);
});

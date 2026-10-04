'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { newestUpdateTime, relevantToViewer, stripPullRequests } from './issueFilter';
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

test('relevantToViewer matches authored or assigned issues, and nothing without a viewer', () => {
  const authored = makeIssue({ number: 1, user: { login: 'octocat', avatar_url: '' } });
  const assigned = makeIssue({ number: 2, assignees: [{ login: 'octocat', avatar_url: '' }] });
  const other = makeIssue({ number: 3 });
  assert.deepStrictEqual(relevantToViewer([authored, assigned, other], 'octocat'), [authored, assigned]);
  assert.deepStrictEqual(relevantToViewer([authored, assigned, other], null), []);
});

test('newestUpdateTime returns the max updated_at, or 0 for an empty list', () => {
  const older = makeIssue({ number: 1, updated_at: '2026-01-01T00:00:00Z' });
  const newer = makeIssue({ number: 2, updated_at: '2026-06-01T00:00:00Z' });
  assert.strictEqual(newestUpdateTime([older, newer]), new Date('2026-06-01T00:00:00Z').getTime());
  assert.strictEqual(newestUpdateTime([]), 0);
});

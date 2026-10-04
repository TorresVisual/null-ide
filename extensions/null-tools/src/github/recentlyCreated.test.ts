'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { mergeRecentlyCreated } from './recentlyCreated';
import { GithubIssue } from './types';

const issue = (number: number, state: 'open' | 'closed' = 'open'): GithubIssue => ({
  number, title: `#${number}`, body: '', state, html_url: '', labels: [], assignees: [],
  user: { login: 'u', avatar_url: '' }, comments: 0, updated_at: '2026-10-04T00:00:00Z',
});

const NOW = 1_000_000;

test('mergeRecentlyCreated puts a fresh issue the search has not indexed yet on top', () => {
  const r = mergeRecentlyCreated([issue(1)], [{ issue: issue(9), at: NOW - 5000 }], 'is:open', NOW);
  assert.deepStrictEqual(r.items.map(i => i.number), [9, 1]);
  assert.deepStrictEqual(r.added.map(i => i.number), [9]);
});

test('mergeRecentlyCreated leaves the page alone once search lists the issue', () => {
  const r = mergeRecentlyCreated([issue(9), issue(1)], [{ issue: issue(9), at: NOW - 5000 }], 'is:open', NOW);
  assert.deepStrictEqual(r.items.map(i => i.number), [9, 1]);
  assert.strictEqual(r.added.length, 0);
});

test('mergeRecentlyCreated ignores entries older than a minute', () => {
  const r = mergeRecentlyCreated([issue(1)], [{ issue: issue(9), at: NOW - 61000 }], 'is:open', NOW);
  assert.deepStrictEqual(r.items.map(i => i.number), [1]);
});

test('mergeRecentlyCreated skips queries the new issue may not match', () => {
  const recent = [{ issue: issue(9), at: NOW - 1000 }];
  assert.strictEqual(mergeRecentlyCreated([], recent, 'is:closed', NOW).items.length, 0);
  assert.strictEqual(mergeRecentlyCreated([], recent, 'is:open label:bug', NOW).items.length, 0);
  assert.strictEqual(mergeRecentlyCreated([], recent, 'is:open crash', NOW).items.length, 0);
  assert.strictEqual(mergeRecentlyCreated([], recent, '', NOW).items.length, 1);
});

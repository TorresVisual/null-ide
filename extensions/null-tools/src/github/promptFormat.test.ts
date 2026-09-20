'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { formatIssueAsPrompt } from './promptFormat';
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
    user: { login: 'author' },
    comments: 0,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('formatIssueAsPrompt includes number, title, body, and link', () => {
  const text = formatIssueAsPrompt(makeIssue({
    number: 43, title: 'Add issues panel', body: 'Some body text',
    html_url: 'https://github.com/x/y/issues/43',
  }));
  assert.strictEqual(
    text,
    '#43 Add issues panel\n\nSome body text\n\nhttps://github.com/x/y/issues/43',
  );
});

test('formatIssueAsPrompt handles an empty body without a dangling blank section', () => {
  const text = formatIssueAsPrompt(makeIssue({
    number: 5, title: 'No description', body: '',
    html_url: 'https://github.com/x/y/issues/5',
  }));
  assert.strictEqual(text, '#5 No description\n\nhttps://github.com/x/y/issues/5');
});

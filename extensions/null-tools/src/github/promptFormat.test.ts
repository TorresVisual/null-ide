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
    user: { login: 'author', avatar_url: '' },
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

test('formatIssueAsPrompt lists comments and local image files between the body and the link', () => {
  const text = formatIssueAsPrompt(
    makeIssue({ number: 7, title: 'Crash', body: 'It crashes', html_url: 'https://github.com/x/y/issues/7' }),
    [
      { author: 'ann', createdAt: '2026-09-25T10:00:00Z', body: 'Same here' },
      { author: 'bob', createdAt: '2026-09-26T08:00:00Z', body: 'Fixed in main\n\nthanks' },
    ],
    ['D:\p\.null\issue-images\a.png']);
  assert.strictEqual(text, [
    '#7 Crash',
    'It crashes',
    '--- Comments ---\n@ann (2026-09-25): Same here\n\n@bob (2026-09-26): Fixed in main\n\nthanks',
    'Images (local files; open with the Read tool):\n- D:\p\.null\issue-images\a.png',
    'https://github.com/x/y/issues/7',
  ].join('\n\n'));
});

test('formatIssueAsPrompt skips empty comments and leaves out sections with nothing in them', () => {
  const text = formatIssueAsPrompt(
    makeIssue({ number: 8, title: 'T', body: '', html_url: 'u' }),
    [{ author: 'a', createdAt: '2026-01-01T00:00:00Z', body: '  ' }], []);
  assert.strictEqual(text, '#8 T\n\nu');
});

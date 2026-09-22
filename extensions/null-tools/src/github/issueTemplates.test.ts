'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { parseIssueTemplate } from './issueTemplates';

test('parseIssueTemplate reads name, title, and labels from frontmatter', () => {
  const raw = [
    '---',
    'name: Bug report',
    "title: 'Bug: '",
    'labels: bug, needs-triage',
    '---',
    'Describe the bug here.',
  ].join('\n');
  assert.deepStrictEqual(parseIssueTemplate(raw, 'bug_report'), {
    name: 'Bug report',
    title: 'Bug: ',
    body: 'Describe the bug here.',
    labels: ['bug', 'needs-triage'],
  });
});

test('parseIssueTemplate falls back to filename and empty fields with no frontmatter', () => {
  assert.deepStrictEqual(parseIssueTemplate('Just a body.', 'blank'), {
    name: 'blank',
    title: '',
    body: 'Just a body.',
    labels: [],
  });
});

test('parseIssueTemplate defaults missing frontmatter fields', () => {
  const raw = ['---', 'about: no name or labels here', '---', 'Body text.'].join('\n');
  assert.deepStrictEqual(parseIssueTemplate(raw, 'feature_request'), {
    name: 'feature_request',
    title: '',
    body: 'Body text.',
    labels: [],
  });
});

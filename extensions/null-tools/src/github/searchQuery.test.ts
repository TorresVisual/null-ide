'use strict';

import assert from 'node:assert';
import test from 'node:test';
import {
  describeQuery, getQualifierValues, hasFreeText, removeQualifier, setQualifier, toApiQuery, toggleQualifier, withState,
} from './searchQuery';

test('getQualifierValues unquotes values and ignores negated and other keys', () => {
  const q = 'is:open label:"good first issue" label:bug -label:wontfix assignee:octocat fix crash';
  assert.deepStrictEqual(getQualifierValues(q, 'label'), ['good first issue', 'bug']);
  assert.deepStrictEqual(getQualifierValues(q, 'LABEL'), ['good first issue', 'bug']);
  assert.deepStrictEqual(getQualifierValues(q, 'milestone'), []);
});

test('toggleQualifier adds, quotes values with spaces, and removes case-insensitively', () => {
  assert.strictEqual(toggleQualifier('is:open', 'label', 'bug'), 'is:open label:bug');
  assert.strictEqual(toggleQualifier('is:open', 'label', 'good first issue'), 'is:open label:"good first issue"');
  assert.strictEqual(toggleQualifier('is:open label:Bug', 'label', 'bug'), 'is:open');
  assert.strictEqual(toggleQualifier('label:"good first issue" x', 'label', 'good first issue'), 'x');
});

test('toggleQualifier twice is the identity', () => {
  const q = 'is:open label:ui fix';
  assert.strictEqual(toggleQualifier(toggleQualifier(q, 'label', 'bug'), 'label', 'bug'), q);
});

test('toggleQualifier leaves a negated token of the same key alone', () => {
  assert.strictEqual(toggleQualifier('-label:bug', 'label', 'bug'), '-label:bug label:bug');
});

test('setQualifier replaces every value of the key and keeps free text', () => {
  assert.strictEqual(setQualifier('is:open assignee:a assignee:b crash', 'assignee', 'c'), 'is:open crash assignee:c');
  assert.strictEqual(setQualifier('is:open', 'sort', 'updated-desc'), 'is:open sort:updated-desc');
});

test('removeQualifier drops the key but keeps negations and free text', () => {
  assert.strictEqual(
    removeQualifier('is:open label:a -label:b "exact phrase" x', 'label'),
    'is:open -label:b "exact phrase" x',
  );
});

test('withState swaps is:open / is:closed and keeps other is: filters', () => {
  assert.strictEqual(withState('is:open label:bug', 'closed'), 'is:closed label:bug');
  assert.strictEqual(withState('label:bug', 'open'), 'is:open label:bug');
  assert.strictEqual(withState('is:open is:locked', 'closed'), 'is:closed is:locked');
});

test('describeQuery reports tab, selected values (@me resolved) and sort', () => {
  const view = describeQuery('is:closed assignee:@me label:bug sort:updated-desc', 'octocat');
  assert.strictEqual(view.state, 'closed');
  assert.deepStrictEqual(view.selected.assignee, ['octocat']);
  assert.deepStrictEqual(view.selected.label, ['bug']);
  assert.strictEqual(view.sort, 'updated-desc');
  assert.strictEqual(describeQuery('', null).state, 'all');
  assert.strictEqual(describeQuery('is:open is:closed', null).state, 'all');
  assert.deepStrictEqual(describeQuery('assignee:@me', null).selected.assignee, ['@me']);
});

test('toApiQuery scopes to the repo and sorts newest-first when there is no text or sort', () => {
  assert.strictEqual(toApiQuery('o/r', 'is:open'), 'repo:o/r is:issue is:open sort:created-desc');
  assert.strictEqual(toApiQuery('o/r', 'is:open crash'), 'repo:o/r is:issue is:open crash');
  assert.strictEqual(toApiQuery('o/r', 'is:open sort:comments-desc'), 'repo:o/r is:issue is:open sort:comments-desc');
  assert.strictEqual(toApiQuery('o/r', ''), 'repo:o/r is:issue sort:created-desc');
});

test('toApiQuery drops repo:/org:/user: so the list cannot leave this repo', () => {
  assert.strictEqual(
    toApiQuery('o/r', 'repo:evil/private org:x -user:y is:open'),
    'repo:o/r is:issue is:open sort:created-desc',
  );
});

test('toApiQuery also drops owner: (it widens the search to every repo of that owner)', () => {
  assert.strictEqual(
    toApiQuery('o/r', 'owner:microsoft is:open'),
    'repo:o/r is:issue is:open sort:created-desc',
  );
});

test('hasFreeText is true only when there is text besides qualifiers', () => {
  assert.strictEqual(hasFreeText('is:open label:"good first issue" sort:updated-desc'), false);
  assert.strictEqual(hasFreeText('is:open crash'), true);
  assert.strictEqual(hasFreeText('"exact phrase"'), true);
  assert.strictEqual(hasFreeText(''), false);
});

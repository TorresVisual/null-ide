'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { draftKey } from './issueDrafts';

test('draftKey names the unsent text per repo and per issue, or the New issue form', () => {
  const repo = { owner: 'TorresVisual', repo: 'null-ide' };
  assert.strictEqual(draftKey(repo, 106), 'null.issues.draft:TorresVisual/null-ide#106');
  assert.strictEqual(draftKey(repo, 'new'), 'null.issues.draft:TorresVisual/null-ide#new');
  assert.notStrictEqual(draftKey(repo, 1), draftKey({ owner: 'TorresVisual', repo: 'other' }, 1));
});

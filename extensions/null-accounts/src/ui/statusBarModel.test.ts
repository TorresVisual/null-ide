'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { statusBarModel } from './statusBarModel';

test('a bound folder shows the account and explains the click', () => {
  const m = statusBarModel('my-repo', {
    id: 'a1', provider: 'github', host: 'github.com', username: 'octo', email: 'o@e.com', authMethod: 'oauth',
  });
  assert.strictEqual(m.text, '$(account) octo');
  assert.match(m.tooltip, /my-repo uses octo@github\.com/);
  assert.match(m.tooltip, /switch/i);
});

test('an unbound folder reads "No account" and invites a choice', () => {
  const m = statusBarModel('my-repo', undefined);
  assert.strictEqual(m.text, '$(account) No account');
  assert.match(m.tooltip, /my-repo has no account/);
});

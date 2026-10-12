import { test } from 'node:test';
import * as assert from 'node:assert';
import { validateCommitMessage } from './commitValidation';

test('valid messages', () => {
  for (const m of [
    'feat: add dark mode',
    'fix(git): handle missing remote',
    'feat(api)!: remove deprecated endpoint',
    'chore: x\n\nbody: with colons\nBREAKING CHANGE: y',
    'Merge branch main into x',
    'fixup! feat: a',
    '',
  ]) assert.strictEqual(validateCommitMessage(m), undefined, m);
});

test('invalid messages explain the fix', () => {
  assert.match(validateCommitMessage('updated the settings page')!, /type: description/);
  assert.match(validateCommitMessage('fix - resolve startup crash')!, /type: description/);
  assert.match(validateCommitMessage('updated: the settings page')!, /Unknown type "updated"/);
  assert.match(validateCommitMessage('feat():x')!, /scope/);
  assert.match(validateCommitMessage('feat:')!, /description/);
  assert.match(validateCommitMessage('feat:add dark mode')!, /space after the colon/);
});

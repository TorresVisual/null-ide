import { test } from 'node:test';
import * as assert from 'node:assert';
import { validateCommitMessage, suggestType } from './commitValidation';

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

test('typos in the type get a suggestion', () => {
  assert.strictEqual(suggestType('feet'), 'feat');
  assert.strictEqual(suggestType('fiz'), 'fix');
  assert.strictEqual(suggestType('Feat'), 'feat');
  assert.strictEqual(suggestType('refacotr'), 'refactor');
  assert.strictEqual(suggestType('feature'), 'feat');
  assert.strictEqual(suggestType('updated'), undefined);
  assert.match(validateCommitMessage('feet: add dark mode')!, /Did you mean "feat"\?/);
  assert.match(validateCommitMessage('Fix: crash')!, /Did you mean "fix"\?/);
});

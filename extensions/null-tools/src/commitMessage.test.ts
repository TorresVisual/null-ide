import { test } from 'node:test';
import * as assert from 'node:assert';
import { heuristicMessage } from './commitMessage';

test('single modified file', () => {
  assert.strictEqual(heuristicMessage('M\tsrc/a.ts\n'), 'chore: update a.ts');
});

test('docs only', () => {
  assert.strictEqual(heuristicMessage('M\tREADME.md\nA\tdocs/x.md\n'), 'docs: update README.md, x.md');
});

test('tests only, all added', () => {
  assert.strictEqual(heuristicMessage('A\tsrc/a.test.ts\n'), 'test: add a.test.ts');
});

test('rename uses new path; many files are counted', () => {
  assert.strictEqual(heuristicMessage('R100\told.ts\tnew.ts\n'), 'chore: update new.ts');
  assert.strictEqual(heuristicMessage('M\ta\nM\tb\nM\tc\nD\td\n'), 'chore: update 4 files');
});

test('empty input', () => {
  assert.strictEqual(heuristicMessage(''), 'chore: update files');
});

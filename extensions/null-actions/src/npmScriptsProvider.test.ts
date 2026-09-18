'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { parseNpmScripts, toActionButtonConfig } from './npmScriptsProvider';

test('parses scripts into buttons', () => {
  const content = JSON.stringify({ scripts: { build: 'tsc', test: 'node --test out' } });
  const buttons = parseNpmScripts(content);
  assert.deepStrictEqual(buttons, [
    { id: 'npm-build', label: 'npm run build', command: 'npm run build' },
    { id: 'npm-test', label: 'npm run test', command: 'npm run test' },
  ]);
});

test('package.json with no scripts field yields no buttons', () => {
  assert.deepStrictEqual(parseNpmScripts(JSON.stringify({ name: 'x' })), []);
});

test('malformed JSON yields no buttons rather than throwing', () => {
  assert.deepStrictEqual(parseNpmScripts('{ not valid json'), []);
});

test('non-string script values are ignored', () => {
  const content = JSON.stringify({ scripts: { build: 'tsc', weird: 123 } });
  const buttons = parseNpmScripts(content);
  assert.strictEqual(buttons.length, 1);
  assert.strictEqual(buttons[0].id, 'npm-build');
});

test('toActionButtonConfig fills in full ActionButtonConfig defaults', () => {
  const config = toActionButtonConfig({ id: 'npm-build', label: 'npm run build', command: 'npm run build' }, 10);
  assert.strictEqual(config.id, 'npm-build');
  assert.strictEqual(config.label, 'npm run build');
  assert.strictEqual(config.command, 'npm run build');
  assert.strictEqual(config.type, 'terminal');
  assert.strictEqual(config.priority, 10);
  assert.strictEqual(config.background, 'none');
  assert.strictEqual(config.saveAll, false);
  assert.strictEqual(config.focus, true);
});

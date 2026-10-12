'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { parseButtonConfigs } from './buttonConfig';

test('parses a minimal valid button, applying defaults', () => {
  const { buttons, errors } = parseButtonConfigs([
    { id: 'build', label: 'Build', command: 'npm run build' },
  ]);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(buttons.length, 1);
  assert.deepStrictEqual(buttons[0], {
    id: 'build',
    label: 'Build',
    icon: undefined,
    type: 'terminal',
    command: 'npm run build',
    args: undefined,
    color: undefined,
    background: 'none',
    tooltip: undefined,
    cwd: undefined,
    saveAll: false,
    focus: true,
    onBusy: 'ask',
    priority: 0,
  });
});

test('undefined setting (never configured) yields empty buttons and no errors', () => {
  const { buttons, errors } = parseButtonConfigs(undefined);
  assert.deepStrictEqual(buttons, []);
  assert.deepStrictEqual(errors, []);
});

test('non-array value is rejected with a single error', () => {
  const { buttons, errors } = parseButtonConfigs({ not: 'an array' });
  assert.deepStrictEqual(buttons, []);
  assert.strictEqual(errors.length, 1);
});

test('entry missing required fields is skipped with an error, valid entries still parse', () => {
  const { buttons, errors } = parseButtonConfigs([
    { id: 'no-label', command: 'echo hi' },
    { id: 'no-command', label: 'No Command' },
    { label: 'No Id', command: 'echo hi' },
    { id: 'ok', label: 'OK', command: 'echo ok' },
  ]);
  assert.strictEqual(buttons.length, 1);
  assert.strictEqual(buttons[0].id, 'ok');
  assert.strictEqual(errors.length, 3);
});

test('duplicate ids: first wins, second is rejected as an error', () => {
  const { buttons, errors } = parseButtonConfigs([
    { id: 'dup', label: 'First', command: 'echo 1' },
    { id: 'dup', label: 'Second', command: 'echo 2' },
  ]);
  assert.strictEqual(buttons.length, 1);
  assert.strictEqual(buttons[0].label, 'First');
  assert.strictEqual(errors.length, 1);
});

test('invalid enum values fall back to their defaults instead of erroring', () => {
  const { buttons, errors } = parseButtonConfigs([
    { id: 'x', label: 'X', command: 'echo x', type: 'bogus', background: 'purple' },
  ]);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(buttons[0].type, 'terminal');
  assert.strictEqual(buttons[0].background, 'none');
});

test('focus defaults to true when omitted, but an explicit false is honored', () => {
  const { buttons } = parseButtonConfigs([
    { id: 'a', label: 'A', command: 'echo a' },
    { id: 'b', label: 'B', command: 'echo b', focus: false },
  ]);
  assert.strictEqual(buttons[0].focus, true);
  assert.strictEqual(buttons[1].focus, false);
});

test('onBusy accepts the known modes and falls back to ask for anything else', () => {
  const { buttons } = parseButtonConfigs([
    { id: 'a', label: 'A', command: 'x', onBusy: 'restart' },
    { id: 'b', label: 'B', command: 'x', onBusy: 'bogus' },
  ]);
  assert.strictEqual(buttons[0].onBusy, 'restart');
  assert.strictEqual(buttons[1].onBusy, 'ask');
});

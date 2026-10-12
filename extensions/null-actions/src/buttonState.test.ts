'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { formatDuration, statusText, statusTooltip } from './buttonState';

test('formatDuration', () => {
  assert.strictEqual(formatDuration(400), '400ms');
  assert.strictEqual(formatDuration(12_400), '12s');
  assert.strictEqual(formatDuration(125_000), '2m 5s');
});

test('statusText: idle keeps the configured icon, running spins, results show icon and duration', () => {
  assert.strictEqual(statusText('Build', 'tools', undefined), '$(tools) Build');
  assert.strictEqual(statusText('Build', undefined, undefined), 'Build');
  assert.strictEqual(statusText('Build', 'tools', { kind: 'running' }), '$(sync~spin) Build');
  assert.strictEqual(statusText('Build', 'tools', { kind: 'passed', exitCode: 0, durationMs: 12_000 }), '$(check) Build 12s');
  assert.strictEqual(statusText('Test', undefined, { kind: 'failed', exitCode: 1, durationMs: 3_000 }), '$(error) Test 3s');
});

test('statusTooltip appends the state to the configured tooltip and carries the exit code', () => {
  assert.strictEqual(statusTooltip('Run tests', undefined), 'Run tests');
  assert.strictEqual(statusTooltip(undefined, { kind: 'running' }), 'Running...');
  const failed = statusTooltip('Run tests', { kind: 'failed', exitCode: 2, durationMs: 1_000 });
  assert.ok(failed?.startsWith('Run tests\n') && failed.includes('exit code 2'));
});

'use strict';

import assert from 'node:assert';
import { test } from 'node:test';

const FOCUS_GROUP_COMMANDS = [
  'workbench.action.focusFirstEditorGroup',
  'workbench.action.focusSecondEditorGroup',
  'workbench.action.focusThirdEditorGroup',
];

function focusCommandFor(viewColumn: number): string | undefined {
  return FOCUS_GROUP_COMMANDS[viewColumn - 1];
}

test('viewColumn 1 maps to the first-group focus command', () => {
  assert.strictEqual(focusCommandFor(1), 'workbench.action.focusFirstEditorGroup');
});

test('viewColumn beyond the known list yields no focus command (single-group case)', () => {
  assert.strictEqual(focusCommandFor(99), undefined);
});

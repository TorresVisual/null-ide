'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { toggleTaskCheckbox } from './taskList';

test('toggleTaskCheckbox checks an unchecked box by index', () => {
  const body = '- [ ] one\n- [ ] two\n- [ ] three';
  assert.strictEqual(toggleTaskCheckbox(body, 1, true), '- [ ] one\n- [x] two\n- [ ] three');
});

test('toggleTaskCheckbox unchecks a checked box by index', () => {
  const body = '- [x] one';
  assert.strictEqual(toggleTaskCheckbox(body, 0, false), '- [ ] one');
});

test('toggleTaskCheckbox skips checkboxes inside fenced code blocks', () => {
  const body = '- [ ] real one\n```\n- [ ] fake\n```\n- [ ] real two';
  assert.strictEqual(
    toggleTaskCheckbox(body, 1, true),
    '- [ ] real one\n```\n- [ ] fake\n```\n- [x] real two',
  );
});

test('toggleTaskCheckbox returns null for an out-of-range index', () => {
  const body = '- [ ] only one';
  assert.strictEqual(toggleTaskCheckbox(body, 3, true), null);
});

'use strict';

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, 'webview-settings-shared.js'), 'utf8'), sandbox);
const d = sandbox as unknown as { escapeHtml(s: unknown): string; escapeAttr(s: unknown): string };

test('escapes every special character', () => {
  assert.strictEqual(d.escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.strictEqual(d.escapeAttr(`a"b'c`), 'a&quot;b&#39;c');
});

test('escapes & first so entities are not double-decoded', () => {
  assert.strictEqual(d.escapeHtml('&lt;'), '&amp;lt;');
});

test('null, undefined and numbers are safe', () => {
  assert.strictEqual(d.escapeHtml(null), '');
  assert.strictEqual(d.escapeAttr(undefined), '');
  assert.strictEqual(d.escapeAttr(0), '0');
});

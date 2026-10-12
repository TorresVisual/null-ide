'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { sanitizeEvent } from '../sanitize';

test('plain events pass through', () => {
  for (const e of ['*', 'onStartupFinished', 'onLanguage:typescript', 'onCommand:null-startup.openReport', 'onView:null.musicView', '']) {
    assert.strictEqual(sanitizeEvent(e), e);
  }
});

test('workspaceContains keeps only its type', () => {
  assert.strictEqual(sanitizeEvent('workspaceContains:**/*.csproj'), 'workspaceContains');
  assert.strictEqual(sanitizeEvent('workspaceContains:C:\\Users\\me\\proj\\x'), 'workspaceContains');
});

test('any event carrying a path keeps only its prefix', () => {
  assert.strictEqual(sanitizeEvent('onFileOpen:/home/me/x'), 'onFileOpen');
  assert.strictEqual(sanitizeEvent('onFileSystem:file'), 'onFileSystem:file');
  assert.strictEqual(sanitizeEvent('onDebugResolve:C:\\a\\b'), 'onDebugResolve');
});

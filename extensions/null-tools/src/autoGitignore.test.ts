'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  isPatternInGitignore,
  getMissingEntries,
  updateGitignoreContent,
  detectArtifactsInRoot,
} from './autoGitignoreStorage';

test('isPatternInGitignore accurately matches exact and directory entries', () => {
  const content = `# Comment\nnode_modules/\n.null/\n/dist/\n*.log`;

  assert.strictEqual(isPatternInGitignore(content, 'node_modules/'), true);
  assert.strictEqual(isPatternInGitignore(content, 'node_modules'), true);
  assert.strictEqual(isPatternInGitignore(content, '.null/'), true);
  assert.strictEqual(isPatternInGitignore(content, 'dist/'), true);
  assert.strictEqual(isPatternInGitignore(content, '*.log'), true);
  assert.strictEqual(isPatternInGitignore(content, '.venv/'), false);
});

test('getMissingEntries returns only artifacts not present in gitignore', () => {
  const existing = `node_modules/\n.null/\n`;
  const detected = ['node_modules/', '.venv/', 'dist/'];

  const missing = getMissingEntries(existing, detected);
  assert.deepStrictEqual(missing, ['.venv/', 'dist/']);
});

test('updateGitignoreContent appends section header and missing entries cleanly', () => {
  const existing = `node_modules/\n`;
  const missing = ['.venv/', 'dist/'];

  const updated = updateGitignoreContent(existing, missing);
  assert.ok(updated.includes('# Added by Null IDE Auto-Gitignore'));
  assert.ok(updated.includes('.venv/'));
  assert.ok(updated.includes('dist/'));
  assert.ok(updated.startsWith('node_modules/\n'));
});

test('updateGitignoreContent does not add section header twice', () => {
  const existing = `node_modules/\n\n# Added by Null IDE Auto-Gitignore\n.venv/\n`;
  const missing = ['dist/'];

  const updated = updateGitignoreContent(existing, missing);
  const count = (updated.match(/# Added by Null IDE Auto-Gitignore/g) || []).length;
  assert.strictEqual(count, 1);
  assert.ok(updated.includes('dist/'));
});

test('detectArtifactsInRoot finds existing artifact directories and files on disk', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-gitignore-test-'));

  try {
    fs.mkdirSync(path.join(tempDir, 'node_modules'));
    fs.mkdirSync(path.join(tempDir, '.venv'));
    fs.writeFileSync(path.join(tempDir, 'app.log'), 'test log');

    const patterns = ['node_modules/', '.venv/', 'dist/', '*.log'];
    const detected = detectArtifactsInRoot(tempDir, patterns);

    assert.ok(detected.includes('node_modules/'));
    assert.ok(detected.includes('.venv/'));
    assert.ok(detected.includes('*.log'));
    assert.strictEqual(detected.includes('dist/'), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

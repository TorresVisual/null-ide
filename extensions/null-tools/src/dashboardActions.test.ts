'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProjectDirectory } from './dashboardActions';

test('createProjectDirectory creates the folder and git-inits it', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'dashboard-newproject-'));
  const target = path.join(parent, 'my-app');
  const result = createProjectDirectory(target);
  assert.deepStrictEqual(result, { ok: true });
  assert.ok(existsSync(path.join(target, '.git')));
});

test('createProjectDirectory fails with a message when the target already exists', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'dashboard-newproject-'));
  const target = path.join(parent, 'my-app');
  mkdirSync(target);
  const result = createProjectDirectory(target);
  assert.strictEqual(result.ok, false);
  assert.match((result as { ok: false; message: string }).message, /EEXIST/);
});

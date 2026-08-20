'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { evaluateWhenClause } from './whenClause';

test('no when clause always passes', () => {
  assert.strictEqual(evaluateWhenClause(undefined, {}), true);
});

test('languages: passes when active language is in the list', () => {
  assert.strictEqual(
    evaluateWhenClause({ languages: ['cpp', 'c'] }, { activeLanguageId: 'cpp' }),
    true,
  );
});

test('languages: fails when active language is not in the list', () => {
  assert.strictEqual(
    evaluateWhenClause({ languages: ['cpp', 'c'] }, { activeLanguageId: 'python' }),
    false,
  );
});

test('languages: fails when there is no active editor at all', () => {
  assert.strictEqual(
    evaluateWhenClause({ languages: ['cpp'] }, {}),
    false,
  );
});

test('folder: passes when folder name matches, fails when it does not', () => {
  assert.strictEqual(evaluateWhenClause({ folder: 'backend' }, { folderName: 'backend' }), true);
  assert.strictEqual(evaluateWhenClause({ folder: 'backend' }, { folderName: 'frontend' }), false);
  assert.strictEqual(evaluateWhenClause({ folder: 'backend' }, {}), false);
});

test('filesExist: passes when every listed file exists under folderPath', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-test-'));
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
  assert.strictEqual(
    evaluateWhenClause({ filesExist: ['Cargo.toml'] }, { folderPath: dir }),
    true,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('filesExist: fails when any listed file is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-test-'));
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
  assert.strictEqual(
    evaluateWhenClause({ filesExist: ['Cargo.toml', 'missing.txt'] }, { folderPath: dir }),
    false,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('filesExist: fails when there is no folderPath to check against', () => {
  assert.strictEqual(evaluateWhenClause({ filesExist: ['Cargo.toml'] }, {}), false);
});

test('multiple conditions all must pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-test-'));
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
  const ctx = { activeLanguageId: 'rust', folderName: 'backend', folderPath: dir };
  assert.strictEqual(
    evaluateWhenClause({ languages: ['rust'], folder: 'backend', filesExist: ['Cargo.toml'] }, ctx),
    true,
  );
  assert.strictEqual(
    evaluateWhenClause({ languages: ['python'], folder: 'backend', filesExist: ['Cargo.toml'] }, ctx),
    false,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

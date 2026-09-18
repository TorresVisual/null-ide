'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectSuggestedButtons } from './projectDetector';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-detect-'));
}

test('empty folder yields no suggestions', () => {
  const dir = tmpDir();
  assert.deepStrictEqual(detectSuggestedButtons(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Cargo.toml yields cargo suggestions', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "x"');
  const suggestions = detectSuggestedButtons(dir);
  assert.ok(suggestions.some(s => s.command === 'cargo run'));
  assert.ok(suggestions.some(s => s.command === 'cargo build'));
  assert.ok(suggestions.some(s => s.command === 'cargo test'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CMakeLists.txt yields cmake suggestions', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'CMakeLists.txt'), 'project(x)');
  const suggestions = detectSuggestedButtons(dir);
  assert.ok(suggestions.some(s => s.command === 'cmake -B build'));
  assert.ok(suggestions.some(s => s.command === 'cmake --build build'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a .csproj file yields dotnet suggestions', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'App.csproj'), '<Project />');
  const suggestions = detectSuggestedButtons(dir);
  assert.ok(suggestions.some(s => s.command === 'dotnet build'));
  assert.ok(suggestions.some(s => s.command === 'dotnet run'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('multiple manifests present yields the union of their suggestions', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
  fs.writeFileSync(path.join(dir, 'CMakeLists.txt'), 'project(x)');
  const suggestions = detectSuggestedButtons(dir);
  assert.ok(suggestions.some(s => s.command === 'cargo run'));
  assert.ok(suggestions.some(s => s.command === 'cmake -B build'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('suggestion ids are unique within one result set', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
  const suggestions = detectSuggestedButtons(dir);
  const ids = suggestions.map(s => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  fs.rmSync(dir, { recursive: true, force: true });
});

'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { detectSuggestedButtons, DetectedProject } from './projectDetector';

const detecting = (...projects: DetectedProject[]) => () => projects;

test('no detected projects yields no suggestions', () => {
  assert.deepStrictEqual(detectSuggestedButtons('/x', detecting()), []);
});

test('Cargo.toml yields cargo suggestions', () => {
  const suggestions = detectSuggestedButtons('/x', detecting({ language: 'rust', manifest: 'Cargo.toml' }));
  assert.ok(suggestions.some(s => s.command === 'cargo run'));
  assert.ok(suggestions.some(s => s.command === 'cargo build'));
  assert.ok(suggestions.some(s => s.command === 'cargo test'));
});

test('CMakeLists.txt yields cmake suggestions', () => {
  const suggestions = detectSuggestedButtons('/x', detecting({ language: 'cpp', manifest: 'CMakeLists.txt' }));
  assert.ok(suggestions.some(s => s.command === 'cmake -B build'));
  assert.ok(suggestions.some(s => s.command === 'cmake --build build'));
});

test('a .csproj yields dotnet suggestions', () => {
  const suggestions = detectSuggestedButtons('/x', detecting({ language: 'dotnet', manifest: '.csproj' }));
  assert.ok(suggestions.some(s => s.command === 'dotnet build'));
  assert.ok(suggestions.some(s => s.command === 'dotnet run'));
});

test('other C++ markers do not suggest cmake commands', () => {
  const suggestions = detectSuggestedButtons('/x', detecting(
    { language: 'cpp', manifest: 'compile_commands.json' },
    { language: 'cpp', manifest: '.clangd' },
    { language: 'node', manifest: 'package.json' },
  ));
  assert.deepStrictEqual(suggestions, []);
});

test('multiple manifests yield the union of their suggestions', () => {
  const suggestions = detectSuggestedButtons('/x', detecting(
    { language: 'rust', manifest: 'Cargo.toml' },
    { language: 'cpp', manifest: 'CMakeLists.txt' },
  ));
  assert.ok(suggestions.some(s => s.command === 'cargo run'));
  assert.ok(suggestions.some(s => s.command === 'cmake -B build'));
});

test('suggestion ids are unique within one result set', () => {
  const suggestions = detectSuggestedButtons('/x', detecting(
    { language: 'rust', manifest: 'Cargo.toml' },
    { language: 'cpp', manifest: 'CMakeLists.txt' },
    { language: 'dotnet', manifest: '.csproj' },
  ));
  const ids = suggestions.map(s => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('the folder path is passed to the detector', () => {
  let seen = '';
  detectSuggestedButtons('/some/folder', p => { seen = p; return []; });
  assert.strictEqual(seen, '/some/folder');
});

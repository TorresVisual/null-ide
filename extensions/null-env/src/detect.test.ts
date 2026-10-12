import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { detectLanguages, detectProjects } from './detect';

const list = (names: string[]) => () => names;

test('an empty folder has no projects and no languages', () => {
  assert.deepEqual(detectProjects('/x', list([])), []);
  assert.deepEqual(detectLanguages('/x', list([])), []);
});

test('each manifest maps to its language', () => {
  assert.deepEqual(detectProjects('/x', list(['Cargo.toml'])), [{ language: 'rust', manifest: 'Cargo.toml' }]);
  assert.deepEqual(detectProjects('/x', list(['CMakeLists.txt'])), [{ language: 'cpp', manifest: 'CMakeLists.txt' }]);
  assert.deepEqual(detectProjects('/x', list(['compile_commands.json'])), [{ language: 'cpp', manifest: 'compile_commands.json' }]);
  assert.deepEqual(detectProjects('/x', list(['.clangd'])), [{ language: 'cpp', manifest: '.clangd' }]);
  assert.deepEqual(detectProjects('/x', list(['package.json'])), [{ language: 'node', manifest: 'package.json' }]);
});

test('a .csproj file of any name is a dotnet project, reported once', () => {
  assert.deepEqual(
    detectProjects('/x', list(['App.csproj', 'Lib.csproj'])),
    [{ language: 'dotnet', manifest: '.csproj' }],
  );
});

test('manifest names match case-insensitively', () => {
  assert.deepEqual(detectProjects('/x', list(['cmakelists.txt'])), [{ language: 'cpp', manifest: 'CMakeLists.txt' }]);
});

test('results follow the table order: Cargo, CMake, then the rest', () => {
  const manifests = detectProjects('/x', list(['CMakeLists.txt', 'Cargo.toml', 'package.json', 'A.csproj'])).map(p => p.manifest);
  assert.deepEqual(manifests, ['Cargo.toml', 'CMakeLists.txt', 'package.json', '.csproj']);
});

test('detectLanguages returns each language once', () => {
  const languages = detectLanguages('/x', list(['CMakeLists.txt', 'compile_commands.json', '.clangd', 'Cargo.toml']));
  assert.deepEqual(languages, ['rust', 'cpp']);
});

test('an unreadable folder yields nothing instead of throwing', () => {
  const boom = () => { throw new Error('ENOENT'); };
  assert.deepEqual(detectProjects('/missing', boom), []);
  assert.deepEqual(detectLanguages('/missing', boom), []);
});

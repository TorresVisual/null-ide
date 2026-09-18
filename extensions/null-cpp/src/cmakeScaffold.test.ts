import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  slugifyToolchainId,
  presetFor,
  presetsJsonContent,
  cmakeListsContent,
  nestedCMakeListsContent,
  appendAddSubdirectory,
} from './cmakeScaffoldContent';
import type { Toolchain } from './toolchainRegistry';

function toolchain(overrides: Partial<Toolchain>): Toolchain {
  return {
    id: 'msvc-17.9.34728-x64',
    kind: 'msvc',
    displayName: 'MSVC 17.9.34728 (x64)',
    compilerPath: 'C:\\VS\\cl.exe',
    arch: 'x64',
    detectedAt: 0,
    ...overrides,
  };
}

test('slugifyToolchainId lowercases and strips non-alphanumeric runs', () => {
  assert.equal(slugifyToolchainId('msvc-17.9.34728-x64'), 'msvc-17-9-34728-x64');
  assert.equal(slugifyToolchainId('wsl-Ubuntu-22.04-gcc'), 'wsl-ubuntu-22-04-gcc');
});

test('presetFor uses Ninja + the raw compiler path for native toolchains', () => {
  const preset = presetFor(toolchain({}));
  assert.equal(preset.generator, 'Ninja');
  assert.equal((preset.cacheVariables as Record<string, unknown>).CMAKE_CXX_COMPILER, 'C:\\VS\\cl.exe');
  assert.equal(preset.binaryDir, '${sourceDir}/build/msvc-17-9-34728-x64-debug');
});

test('presetFor turns on CMAKE_EXPORT_COMPILE_COMMANDS so clangd works even against hand-written CMakeLists.txt', () => {
  const preset = presetFor(toolchain({}));
  assert.equal((preset.cacheVariables as Record<string, unknown>).CMAKE_EXPORT_COMPILE_COMMANDS, 'ON');
});

test('presetFor uses Unix Makefiles for WSL toolchains', () => {
  const preset = presetFor(
    toolchain({ id: 'wsl-Ubuntu-gcc', kind: 'wsl-gcc', compilerPath: '/usr/bin/gcc', wslDistro: 'Ubuntu' })
  );
  assert.equal(preset.generator, 'Unix Makefiles');
});

test('presetsJsonContent emits one configurePreset per toolchain', () => {
  const json = JSON.parse(presetsJsonContent([toolchain({}), toolchain({ id: 'llvm-clang-cl-19.1.0', kind: 'clang' })]));
  assert.equal(json.configurePresets.length, 2);
});

test('cmakeListsContent globs src/ into an executable named after the project', () => {
  const content = cmakeListsContent('MiniGit');
  assert.match(content, /project\(MiniGit CXX\)/);
  assert.match(content, /add_executable\(MiniGit \$\{MINIGIT_SOURCES\}\)/);
});

test('nestedCMakeListsContent emits a library target, not a standalone project', () => {
  const content = nestedCMakeListsContent('Engine');
  assert.doesNotMatch(content, /project\(/);
  assert.match(content, /add_library\(Engine STATIC \$\{ENGINE_SOURCES\}\)/);
});

test('appendAddSubdirectory adds the line once', () => {
  const once = appendAddSubdirectory('cmake_minimum_required(VERSION 3.20)\nproject(App CXX)\n', 'libs/engine');
  assert.match(once, /add_subdirectory\(libs\/engine\)/);

  const twice = appendAddSubdirectory(once, 'libs/engine');
  assert.equal(twice, once);
});

test('appendAddSubdirectory normalizes backslashes to forward slashes', () => {
  const content = appendAddSubdirectory('project(App CXX)\n', 'libs\\engine');
  assert.match(content, /add_subdirectory\(libs\/engine\)/);
});

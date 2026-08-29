import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  parseConfigurePresets,
  resolveAllPresets,
  expandMacros,
  resolveToolchainId,
  inferIsWsl,
  toCMakePreset,
  loadPresets,
  type RawCMakePreset,
} from './presetsModel';
import type { Toolchain } from './toolchainRegistry';

const msvc: Toolchain = {
  id: 'msvc-14.38.33130-x64',
  kind: 'msvc',
  displayName: 'MSVC 14.38.33130 (x64)',
  compilerPath: 'C:\\VS\\VC\\Tools\\MSVC\\14.38.33130\\bin\\Hostx64\\x64\\cl.exe',
  arch: 'x64',
  detectedAt: 0,
};

const clang: Toolchain = {
  id: 'llvm-clang-cl-17.0.3',
  kind: 'clang',
  displayName: 'Clang-cl 17.0.3',
  compilerPath: 'C:\\Program Files\\LLVM\\bin\\clang-cl.exe',
  arch: 'x64',
  detectedAt: 0,
};

test('parseConfigurePresets returns [] for missing/malformed input', () => {
  assert.deepEqual(parseConfigurePresets(undefined), []);
  assert.deepEqual(parseConfigurePresets({}), []);
  assert.deepEqual(parseConfigurePresets({ configurePresets: 'nope' }), []);
});

test('resolveAllPresets merges a single inherits chain', () => {
  const raws: RawCMakePreset[] = [
    { name: 'base', generator: 'Ninja', cacheVariables: { CMAKE_BUILD_TYPE: 'Debug' } },
    { name: 'child', inherits: 'base', binaryDir: 'build/child' },
  ];
  const [, child] = resolveAllPresets(raws);
  assert.equal(child.generator, 'Ninja');
  assert.equal(child.binaryDir, 'build/child');
  assert.equal(child.cacheVariables?.CMAKE_BUILD_TYPE, 'Debug');
});

test('resolveAllPresets gives the first entry of a multi-parent inherits list priority', () => {
  const raws: RawCMakePreset[] = [
    { name: 'a', cacheVariables: { X: '1' } },
    { name: 'b', cacheVariables: { X: '2' } },
    { name: 'child', inherits: ['a', 'b'] },
  ];
  const [, , child] = resolveAllPresets(raws);
  assert.equal(child.cacheVariables?.X, '1');
});

test('resolveAllPresets lets the preset itself override every parent', () => {
  const raws: RawCMakePreset[] = [
    { name: 'base', cacheVariables: { X: '1' } },
    { name: 'child', inherits: 'base', cacheVariables: { X: '2' } },
  ];
  const [, child] = resolveAllPresets(raws);
  assert.equal(child.cacheVariables?.X, '2');
});

test('resolveAllPresets throws on a circular inherits chain', () => {
  const raws: RawCMakePreset[] = [
    { name: 'a', inherits: 'b' },
    { name: 'b', inherits: 'a' },
  ];
  assert.throws(() => resolveAllPresets(raws), /circular/i);
});

test('expandMacros substitutes sourceDir and presetName', () => {
  const result = expandMacros('${sourceDir}/build/${presetName}', {
    sourceDir: 'C:\\proj',
    presetName: 'clang-debug',
  });
  assert.equal(result, 'C:\\proj/build/clang-debug');
});

test('resolveToolchainId matches by compiler executable basename', () => {
  const raw: RawCMakePreset = { name: 'p', cacheVariables: { CMAKE_CXX_COMPILER: 'clang-cl.exe' } };
  assert.equal(resolveToolchainId(raw, [msvc, clang]), clang.id);
});

test('resolveToolchainId returns "" when nothing matches', () => {
  const raw: RawCMakePreset = { name: 'p', cacheVariables: { CMAKE_CXX_COMPILER: 'gcc' } };
  assert.equal(resolveToolchainId(raw, [msvc, clang]), '');
});

test('resolveToolchainId handles {type,value} cache variable objects', () => {
  const raw: RawCMakePreset = {
    name: 'p',
    cacheVariables: { CMAKE_CXX_COMPILER: { type: 'FILEPATH', value: 'clang-cl.exe' } },
  };
  assert.equal(resolveToolchainId(raw, [msvc, clang]), clang.id);
});

test('inferIsWsl respects an explicit vendor opt-in over any heuristic', () => {
  const raw: RawCMakePreset = { name: 'p', generator: 'Visual Studio 17 2022', vendor: { 'null-cpp': { wsl: true } } };
  assert.equal(inferIsWsl(raw), true);
});

test('inferIsWsl infers true for a Ninja/Unix Makefiles preset with a POSIX compiler path', () => {
  const raw: RawCMakePreset = {
    name: 'p',
    generator: 'Ninja',
    cacheVariables: { CMAKE_CXX_COMPILER: '/usr/bin/g++' },
  };
  assert.equal(inferIsWsl(raw), true);
});

test('inferIsWsl is false for a Ninja preset pointed at a native Windows compiler', () => {
  const raw: RawCMakePreset = {
    name: 'p',
    generator: 'Ninja',
    cacheVariables: { CMAKE_CXX_COMPILER: 'C:\\LLVM\\bin\\clang-cl.exe' },
  };
  assert.equal(inferIsWsl(raw), false);
});

test('inferIsWsl is false for a Visual Studio generator regardless of compiler path', () => {
  const raw: RawCMakePreset = { name: 'p', generator: 'Visual Studio 17 2022' };
  assert.equal(inferIsWsl(raw), false);
});

test('toCMakePreset falls back to name for displayName and a default binaryDir', () => {
  const preset = toCMakePreset({ name: 'clang-debug', generator: 'Ninja' }, 'C:\\proj', []);
  assert.equal(preset.displayName, 'clang-debug');
  assert.equal(preset.binaryDir, 'C:\\proj/build/clang-debug');
});

test('loadPresets merges main + user presets and drops hidden ones', () => {
  const main = {
    configurePresets: [
      { name: 'base', hidden: true, generator: 'Ninja' },
      { name: 'clang-debug', inherits: 'base', displayName: 'Clang Debug', cacheVariables: { CMAKE_CXX_COMPILER: 'clang-cl.exe' } },
    ],
  };
  const user = {
    configurePresets: [{ name: 'msvc-debug', generator: 'Visual Studio 17 2022', cacheVariables: { CMAKE_CXX_COMPILER: 'cl.exe' } }],
  };
  const presets = loadPresets(main, user, 'C:\\proj', [msvc, clang]);
  assert.equal(presets.length, 2);
  const clangPreset = presets.find((p) => p.name === 'clang-debug');
  assert.equal(clangPreset?.toolchainId, clang.id);
  assert.equal(clangPreset?.displayName, 'Clang Debug');
  const msvcPreset = presets.find((p) => p.name === 'msvc-debug');
  assert.equal(msvcPreset?.toolchainId, msvc.id);
});

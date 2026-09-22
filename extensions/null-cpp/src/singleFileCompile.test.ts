import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isHeaderFile,
  resolveOutputBinaryPath,
  buildCompileArgs,
} from './singleFileCompileArgs';

test('isHeaderFile correctly identifies header extensions', () => {
  assert.equal(isHeaderFile('test.h'), true);
  assert.equal(isHeaderFile('test.hpp'), true);
  assert.equal(isHeaderFile('test.hxx'), true);
  assert.equal(isHeaderFile('test.hh'), true);
  assert.equal(isHeaderFile('test.inl'), true);
  assert.equal(isHeaderFile('test.HPP'), true);

  assert.equal(isHeaderFile('test.cpp'), false);
  assert.equal(isHeaderFile('test.cc'), false);
  assert.equal(isHeaderFile('test.cxx'), false);
  assert.equal(isHeaderFile('test.c'), false);
});

test('resolveOutputBinaryPath resolves native Windows .exe target', () => {
  const binary = resolveOutputBinaryPath('D:\\proj\\tests\\test_runner.cpp', false);
  assert.equal(binary, 'D:\\proj\\tests\\test_runner.exe');
});

test('resolveOutputBinaryPath resolves WSL target without .exe', () => {
  const binary = resolveOutputBinaryPath('D:\\proj\\tests\\test_runner.cpp', true);
  assert.equal(binary, 'D:\\proj\\tests\\test_runner');
});

test('resolveOutputBinaryPath respects custom output directory', () => {
  const binary = resolveOutputBinaryPath('D:\\proj\\tests\\test_runner.cpp', false, 'D:\\proj\\bin');
  assert.equal(binary, 'D:\\proj\\bin\\test_runner.exe');
});

test('buildCompileArgs constructs default args for a standalone .cpp file', () => {
  const args = buildCompileArgs({
    filePath: 'D:\\proj\\tests\\test_runner.cpp',
    sourceDir: 'D:\\proj',
    outputBinaryPath: 'D:\\proj\\tests\\test_runner.exe',
    isWsl: false,
  });

  assert.deepEqual(args, [
    '-std=c++20',
    '-Wall',
    '-Wextra',
    '-o',
    'D:\\proj\\tests\\test_runner.exe',
    '-ID:\\proj\\tests',
    '-ID:\\proj',
    'D:\\proj\\tests\\test_runner.cpp',
  ]);
});

test('buildCompileArgs enables -fsyntax-only and omits -o for header files', () => {
  const args = buildCompileArgs({
    filePath: 'D:\\proj\\include\\header.hpp',
    sourceDir: 'D:\\proj',
    outputBinaryPath: 'D:\\proj\\include\\header.exe',
    isWsl: false,
  });

  assert.deepEqual(args, [
    '-std=c++20',
    '-Wall',
    '-Wextra',
    '-fsyntax-only',
    '-ID:\\proj\\include',
    '-ID:\\proj',
    'D:\\proj\\include\\header.hpp',
  ]);
});

test('buildCompileArgs respects custom extraArgs', () => {
  const args = buildCompileArgs({
    filePath: 'D:\\proj\\tests\\test_runner.cpp',
    sourceDir: 'D:\\proj',
    extraArgs: ['-std=c++17', '-O2'],
    outputBinaryPath: 'D:\\proj\\tests\\test_runner.exe',
    isWsl: false,
  });

  assert.deepEqual(args, [
    '-std=c++17',
    '-O2',
    '-o',
    'D:\\proj\\tests\\test_runner.exe',
    '-ID:\\proj\\tests',
    '-ID:\\proj',
    'D:\\proj\\tests\\test_runner.cpp',
  ]);
});

test('buildCompileArgs adds extra include directories', () => {
  const args = buildCompileArgs({
    filePath: 'D:\\proj\\tests\\test_runner.cpp',
    sourceDir: 'D:\\proj',
    includeDirs: ['D:\\proj\\include', 'D:\\proj\\src'],
    outputBinaryPath: 'D:\\proj\\tests\\test_runner.exe',
    isWsl: false,
  });

  assert.deepEqual(args, [
    '-std=c++20',
    '-Wall',
    '-Wextra',
    '-o',
    'D:\\proj\\tests\\test_runner.exe',
    '-ID:\\proj\\tests',
    '-ID:\\proj',
    '-ID:\\proj\\include',
    '-ID:\\proj\\src',
    'D:\\proj\\tests\\test_runner.cpp',
  ]);
});

test('buildCompileArgs converts paths to POSIX for WSL', () => {
  const args = buildCompileArgs({
    filePath: 'D:\\proj\\tests\\test_runner.cpp',
    sourceDir: 'D:\\proj',
    includeDirs: ['D:\\proj\\include'],
    outputBinaryPath: 'D:\\proj\\tests\\test_runner',
    isWsl: true,
  });

  assert.deepEqual(args, [
    '-std=c++20',
    '-Wall',
    '-Wextra',
    '-o',
    '/mnt/d/proj/tests/test_runner',
    '-I/mnt/d/proj/tests',
    '-I/mnt/d/proj',
    '-I/mnt/d/proj/include',
    '/mnt/d/proj/tests/test_runner.cpp',
  ]);
});

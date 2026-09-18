import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanDirectoryForCppProject } from './projectDetectionScan';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'null-cpp-detect-'));
}

function write(dir: string, relPath: string, contents = ''): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

test('empty workspace is not a C++ project', () => {
  const dir = tmpDir();
  assert.equal(scanDirectoryForCppProject(dir), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CMakeLists.txt is detected', () => {
  const dir = tmpDir();
  write(dir, 'CMakeLists.txt', 'project(x)');
  assert.equal(scanDirectoryForCppProject(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('compile_commands.json is detected', () => {
  const dir = tmpDir();
  write(dir, 'compile_commands.json', '[]');
  assert.equal(scanDirectoryForCppProject(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('.clangd is detected', () => {
  const dir = tmpDir();
  write(dir, '.clangd', 'CompileFlags:');
  assert.equal(scanDirectoryForCppProject(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('.vcxproj is detected', () => {
  const dir = tmpDir();
  write(dir, 'App.vcxproj', '<Project />');
  assert.equal(scanDirectoryForCppProject(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('meson.build is detected', () => {
  const dir = tmpDir();
  write(dir, 'meson.build', "project('x')");
  assert.equal(scanDirectoryForCppProject(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a Bazel WORKSPACE file is detected', () => {
  const dir = tmpDir();
  write(dir, 'WORKSPACE', '');
  assert.equal(scanDirectoryForCppProject(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a Bazel BUILD.bazel file is detected', () => {
  const dir = tmpDir();
  write(dir, 'BUILD.bazel', '');
  assert.equal(scanDirectoryForCppProject(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a Makefile is detected', () => {
  const dir = tmpDir();
  write(dir, 'Makefile', 'all:\n\techo hi');
  assert.equal(scanDirectoryForCppProject(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a plain .cpp file is detected', () => {
  const dir = tmpDir();
  write(dir, 'src/hello.cpp', 'int main() {}');
  assert.equal(scanDirectoryForCppProject(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a lone .cpp file directly in the root is detected', () => {
  const dir = tmpDir();
  write(dir, 'hello.cpp', 'int main() {}');
  assert.equal(scanDirectoryForCppProject(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a vendored header under third_party is not evidence on its own', () => {
  const dir = tmpDir();
  write(dir, 'third_party/library/foo.hpp', '#pragma once');
  assert.equal(scanDirectoryForCppProject(dir), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a vendored header under node_modules is not evidence on its own', () => {
  const dir = tmpDir();
  write(dir, 'node_modules/some-pkg/native/binding.cpp', '');
  assert.equal(scanDirectoryForCppProject(dir), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a generated .cpp inside a build directory is not evidence', () => {
  const dir = tmpDir();
  write(dir, 'build/CMakeFiles/generated.cpp', '');
  assert.equal(scanDirectoryForCppProject(dir), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a compile_commands.json generated inside a build directory still counts', () => {
  const dir = tmpDir();
  write(dir, 'build/compile_commands.json', '[]');
  assert.equal(scanDirectoryForCppProject(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an unrelated project (only package.json) is not detected', () => {
  const dir = tmpDir();
  write(dir, 'package.json', '{}');
  write(dir, 'src/index.ts', '');
  assert.equal(scanDirectoryForCppProject(dir), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

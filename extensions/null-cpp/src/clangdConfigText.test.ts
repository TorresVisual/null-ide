import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { updateClangdContent } from './clangdConfigText';

test('updateClangdContent creates a fresh file when none exists', () => {
  assert.equal(
    updateClangdContent(undefined, 'C:\\proj\\build\\clang-debug'),
    'CompileFlags:\n  CompilationDatabase: C:/proj/build/clang-debug\n'
  );
});

test('updateClangdContent treats a whitespace-only file as empty', () => {
  assert.equal(
    updateClangdContent('   \n\n', 'C:\\proj\\build'),
    'CompileFlags:\n  CompilationDatabase: C:/proj/build\n'
  );
});

test('updateClangdContent appends a CompileFlags block if the file has other content', () => {
  const existing = 'Diagnostics:\n  UnusedIncludes: Strict\n';
  const result = updateClangdContent(existing, 'C:\\proj\\build');
  assert.equal(result, 'Diagnostics:\n  UnusedIncludes: Strict\nCompileFlags:\n  CompilationDatabase: C:/proj/build\n');
});

test('updateClangdContent inserts CompilationDatabase into an existing CompileFlags block', () => {
  const existing = 'CompileFlags:\n  Add: [-Wall]\nDiagnostics:\n  UnusedIncludes: Strict\n';
  const result = updateClangdContent(existing, 'C:\\proj\\build\\ninja-debug');
  assert.equal(
    result,
    'CompileFlags:\n  Add: [-Wall]\n  CompilationDatabase: C:/proj/build/ninja-debug\nDiagnostics:\n  UnusedIncludes: Strict\n'
  );
});

test('updateClangdContent replaces an existing CompilationDatabase value in place', () => {
  const existing = 'CompileFlags:\n  CompilationDatabase: C:/proj/build/old\n  Add: [-Wall]\n';
  const result = updateClangdContent(existing, 'C:\\proj\\build\\new');
  assert.equal(result, 'CompileFlags:\n  CompilationDatabase: C:/proj/build/new\n  Add: [-Wall]\n');
});

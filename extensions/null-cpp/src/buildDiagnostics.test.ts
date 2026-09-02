import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  parseBuildDiagnosticLine,
  parseBuildOutput,
  resolveDiagnosticPath,
  resolveBuildDiagnostics,
} from './buildDiagnostics';

test('parseBuildDiagnosticLine parses an MSVC error with line and column', () => {
  const d = parseBuildDiagnosticLine('D:\\proj\\src\\main.cpp(10,5): error C2065: \'x\': undeclared identifier');
  assert.deepEqual(d, {
    file: 'D:\\proj\\src\\main.cpp',
    line: 10,
    column: 5,
    severity: 'error',
    message: "C2065: 'x': undeclared identifier",
  });
});

test('parseBuildDiagnosticLine parses an MSVC warning with no column', () => {
  const d = parseBuildDiagnosticLine('D:\\proj\\src\\main.cpp(20): warning C4101: \'y\': unreferenced local variable');
  assert.deepEqual(d, {
    file: 'D:\\proj\\src\\main.cpp',
    line: 20,
    column: 1,
    severity: 'warning',
    message: "C4101: 'y': unreferenced local variable",
  });
});

test('parseBuildDiagnosticLine parses a Clang/GCC error', () => {
  const d = parseBuildDiagnosticLine("/mnt/d/proj/src/main.cpp:10:5: error: use of undeclared identifier 'x'");
  assert.deepEqual(d, {
    file: '/mnt/d/proj/src/main.cpp',
    line: 10,
    column: 5,
    severity: 'error',
    message: "use of undeclared identifier 'x'",
  });
});

test('parseBuildDiagnosticLine returns undefined for a non-diagnostic line', () => {
  assert.equal(parseBuildDiagnosticLine('Building CXX object CMakeFiles/app.dir/main.cpp.o'), undefined);
});

test('parseBuildOutput extracts only the diagnostic lines from mixed build output', () => {
  const output = [
    'Building CXX object CMakeFiles/app.dir/main.cpp.o',
    'D:\\proj\\src\\main.cpp(10,5): error C2065: \'x\': undeclared identifier',
    'ninja: build stopped: subcommand failed.',
  ].join('\r\n');
  const diagnostics = parseBuildOutput(output);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "C2065: 'x': undeclared identifier");
});

test('resolveDiagnosticPath leaves an absolute native Windows path as-is', () => {
  assert.equal(
    resolveDiagnosticPath('D:\\proj\\src\\main.cpp', 'D:\\proj', false, undefined),
    'D:\\proj\\src\\main.cpp'
  );
});

test('resolveDiagnosticPath resolves a relative native path against sourceDir', () => {
  assert.equal(resolveDiagnosticPath('src\\main.cpp', 'D:\\proj', false, undefined), path.resolve('D:\\proj', 'src\\main.cpp'));
});

test('resolveDiagnosticPath translates a WSL /mnt path back to a Windows drive path', () => {
  assert.equal(resolveDiagnosticPath('/mnt/d/proj/src/main.cpp', 'D:\\proj', true, 'Ubuntu'), 'D:\\proj\\src\\main.cpp');
});

test('resolveDiagnosticPath resolves a relative WSL path against sourceDir', () => {
  assert.equal(
    resolveDiagnosticPath('src/main.cpp', 'D:\\proj', true, 'Ubuntu'),
    path.resolve('D:\\proj', 'src\\main.cpp')
  );
});

test('resolveBuildDiagnostics attaches an absolutePath to every parsed diagnostic', () => {
  const output = '/mnt/d/proj/src/main.cpp:10:5: error: use of undeclared identifier \'x\'';
  const diagnostics = resolveBuildDiagnostics(output, 'D:\\proj', true, 'Ubuntu');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].absolutePath, 'D:\\proj\\src\\main.cpp');
});

'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { resolveVariables, VariableContext } from './variableResolver';

test('substitutes each known variable', () => {
  const ctx: VariableContext = {
    workspaceFolder: '/repo',
    file: '/repo/src/a.ts',
    fileBasename: 'a.ts',
    fileDirname: '/repo/src',
    relativeFile: 'src/a.ts',
    selectedText: 'const x = 1;',
    lineNumber: '42',
  };
  assert.strictEqual(resolveVariables('${workspaceFolder}', ctx), '/repo');
  assert.strictEqual(resolveVariables('${file}', ctx), '/repo/src/a.ts');
  assert.strictEqual(resolveVariables('${fileBasename}', ctx), 'a.ts');
  assert.strictEqual(resolveVariables('${fileDirname}', ctx), '/repo/src');
  assert.strictEqual(resolveVariables('${relativeFile}', ctx), 'src/a.ts');
  assert.strictEqual(resolveVariables('${selectedText}', ctx), 'const x = 1;');
  assert.strictEqual(resolveVariables('${lineNumber}', ctx), '42');
});

test('substitutes multiple variables in one template', () => {
  const ctx: VariableContext = { fileBasename: 'a.ts', lineNumber: '3' };
  assert.strictEqual(
    resolveVariables('lint ${fileBasename} --line ${lineNumber}', ctx),
    'lint a.ts --line 3',
  );
});

test('resolves ${env:VAR} from the provided env map', () => {
  const ctx: VariableContext = { env: { FOO: 'bar' } as NodeJS.ProcessEnv };
  assert.strictEqual(resolveVariables('echo ${env:FOO}', ctx), 'echo bar');
});

test('unresolved variable (missing from context) is left as the literal token', () => {
  const ctx: VariableContext = {};
  assert.strictEqual(resolveVariables('open ${file}', ctx), 'open ${file}');
  assert.strictEqual(resolveVariables('echo ${env:MISSING}', ctx), 'echo ${env:MISSING}');
});

test('unknown variable name is left untouched', () => {
  const ctx: VariableContext = { file: '/a.ts' };
  assert.strictEqual(resolveVariables('${notAVariable}', ctx), '${notAVariable}');
});

test('template with no variables passes through unchanged', () => {
  assert.strictEqual(resolveVariables('npm run build', {}), 'npm run build');
});

test('collects known variables it could not resolve, but not shell-style ${NAME}', () => {
  const missing: string[] = [];
  resolveVariables('cp ${file} ${env:NOPE} ${HOME} ${notAVariable}', {}, missing);
  assert.deepStrictEqual(missing, ['${file}', '${env:NOPE}']);
});

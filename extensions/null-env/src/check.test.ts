import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { check, requiredSignature, visibleRequired } from './check';
import type { Finding, Probes } from './types';

function probes(extensions: string[] = [], tools: string[] = []): Probes {
  return { hasExtension: id => extensions.includes(id), hasTool: name => tools.includes(name) };
}

const ALL_EXTENSIONS = [
  'llvm-vs-code-extensions.vscode-clangd', 'ms-vscode.cpptools', 'vadimcn.vscode-lldb',
  'rust-lang.rust-analyzer', 'anthropic.claude-code',
];
const ALL_TOOLS = ['cmake', 'clangd', 'gdb', 'clang-format', 'cargo', 'rustfmt', 'node', 'claude'];

const ids = (findings: Finding[]) => findings.map(f => f.id);

test('everything present means no findings', () => {
  assert.deepEqual(check(['cpp', 'rust', 'node'], probes(ALL_EXTENSIONS, ALL_TOOLS)), []);
});

test('a cmake project with nothing installed names cpptools, CodeLLDB and clangd', () => {
  const found = ids(check(['cpp'], probes()));
  for (const id of ['ext.clangd', 'ext.cpptools', 'ext.codelldb', 'tool.cmake']) {
    assert.ok(found.includes(id), id);
  }
});

test('anyOf is satisfied by a single entry', () => {
  const found = ids(check(['cpp'], probes(ALL_EXTENSIONS, ['cmake', 'clangd', 'clang-format', 'claude', 'gdb'])));
  assert.deepEqual(found, []);
  const lldbOnly = ids(check(['cpp'], probes(ALL_EXTENSIONS, ['cmake', 'clangd', 'clang-format', 'claude', 'lldb'])));
  assert.deepEqual(lldbOnly, []);
});

test('a cargo project without rust-analyzer or rustfmt reports both', () => {
  const found = ids(check(['rust'], probes(['anthropic.claude-code'], ['cargo', 'claude'])));
  assert.deepEqual(found, ['ext.rust-analyzer', 'tool.rustfmt']);
});

test('requirements for languages that are not detected are not reported', () => {
  const found = ids(check(['node'], probes()));
  assert.deepEqual(found, ['tool.node', 'ext.claude-code', 'tool.claude']);
});

test('with no language only the all-language rules apply', () => {
  assert.deepEqual(ids(check([], probes())), ['ext.claude-code', 'tool.claude']);
});

test('a repeated language (multi-root workspace) reports each requirement once', () => {
  const once = ids(check(['cpp'], probes()));
  const twice = ids(check(['cpp', 'cpp'], probes()));
  assert.deepEqual(twice, once);
  assert.equal(new Set(twice).size, twice.length);
});

test('findings carry the fix and omit the language list', () => {
  const [first] = check(['rust'], probes());
  assert.ok(first.fix);
  assert.equal('languages' in first, false);
});

test('only required findings are visible, and a snooze hides them until the set changes', () => {
  const cpp = check(['cpp'], probes(ALL_EXTENSIONS, ALL_TOOLS));
  assert.deepEqual(visibleRequired(cpp, undefined), []);

  const missing = check(['cpp'], probes([], ['cmake', 'clangd', 'gdb', 'clang-format', 'claude']));
  const required = visibleRequired(missing, undefined);
  assert.ok(required.length > 0);
  assert.ok(required.every(f => f.severity === 'required'));

  const snoozed = requiredSignature(missing);
  assert.deepEqual(visibleRequired(missing, snoozed), []);

  // A new required item (cmake) goes missing: the snooze no longer matches and the warning returns.
  const worse = check(['cpp'], probes([], ['clangd', 'gdb', 'clang-format', 'claude']));
  assert.notEqual(requiredSignature(worse), snoozed);
  assert.ok(visibleRequired(worse, snoozed).length > 0);
});

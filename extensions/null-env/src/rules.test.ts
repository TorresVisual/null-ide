import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { RULES, debugExtensionFor } from './rules';

test('requirement ids are unique and every anyOf is non-empty', () => {
  const ids = RULES.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of RULES) {
    assert.ok(r.anyOf.length > 0, r.id);
  }
});

test('an extension requirement installs one of the ids it accepts', () => {
  for (const r of RULES.filter(x => x.kind === 'extension')) {
    assert.equal(r.fix.kind, 'install', r.id);
    if (r.fix.kind === 'install') {
      assert.ok(r.anyOf.includes(r.fix.extensionId), r.id);
    }
  }
});

test('a tool requirement links to a download page', () => {
  for (const r of RULES.filter(x => x.kind === 'tool')) {
    assert.equal(r.fix.kind, 'url', r.id);
    if (r.fix.kind === 'url') {
      assert.match(r.fix.url, /^https:\/\//, r.id);
    }
  }
});

test('the issue-89 requirements are present', () => {
  const ids = new Set(RULES.map(r => r.id));
  for (const id of [
    'ext.clangd', 'ext.cpptools', 'ext.codelldb', 'ext.rust-analyzer', 'ext.claude-code',
    'tool.cmake', 'tool.clangd', 'tool.debugger', 'tool.clang-format',
    'tool.cargo', 'tool.rustfmt', 'tool.node', 'tool.claude',
  ]) {
    assert.ok(ids.has(id), id);
  }
});

test('debugExtensionFor maps the debug types null-cpp emits, and only those', () => {
  assert.deepEqual(debugExtensionFor('lldb'), { extensionId: 'vadimcn.vscode-lldb', label: 'CodeLLDB' });
  assert.deepEqual(debugExtensionFor('cppdbg'), { extensionId: 'ms-vscode.cpptools', label: 'C/C++ (cpptools)' });
  assert.equal(debugExtensionFor('node'), undefined);
  assert.equal(debugExtensionFor('constructor'), undefined);
});

test('the debug type extensions are the same ids the cpp rules install', () => {
  const installs = new Set(RULES.flatMap(r => (r.fix.kind === 'install' ? [r.fix.extensionId] : [])));
  assert.ok(installs.has(debugExtensionFor('lldb')!.extensionId));
  assert.ok(installs.has(debugExtensionFor('cppdbg')!.extensionId));
});

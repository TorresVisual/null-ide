import test from 'node:test';
import assert from 'node:assert/strict';
import { build, main } from './gen-builtins.mjs';

const pkgs = {
  'null-a': { displayName: 'A', description: 'a desc' },
  'null-b': { displayName: 'B', description: 'b desc', extensionDependencies: ['null.null-a', 'ms-vscode.cpptools'] },
};
const read = (id) => pkgs[id];

test('requires come from Null extensionDependencies only', () => {
  const m = build({ builtins: [{ id: 'null-a' }, { id: 'null-b' }] }, read, ['null-a', 'null-b']);
  assert.deepEqual(m.builtins[1].requires, ['null-a']);
  assert.equal(m.schema, 1);
});

test('defaults are on and unlocked; config can override them and add requires', () => {
  const m = build({ builtins: [{ id: 'null-a', default: false, locked: true }, { id: 'null-b', requires: ['null-a'] }] }, read, []);
  assert.deepEqual([m.builtins[0].default, m.builtins[0].locked], [false, true]);
  assert.deepEqual(m.builtins[1].requires, ['null-a']);
  assert.deepEqual([m.builtins[1].default, m.builtins[1].locked], [true, false]);
});

test('an extension folder missing from the config fails the build', () => {
  assert.throws(() => build({ builtins: [{ id: 'null-a' }] }, read, ['null-a', 'null-b']), /null-b is not listed/);
});

test('a third-party entry needs its own label and description', () => {
  assert.throws(() => build({ builtins: [{ id: 'x-ext' }] }, read, []), /x-ext/);
  const m = build({ builtins: [{ id: 'x-ext', label: 'X', description: 'x' }] }, read, []);
  assert.equal(m.builtins[0].label, 'X');
});

test('the real repo config is consistent', () => {
  const m = main();
  const ids = new Set(m.builtins.map((b) => b.id));
  assert.equal(ids.size, m.builtins.length);
  assert.deepEqual(m.builtins.filter((b) => b.locked).map((b) => b.id).sort(), ['null-accounts', 'null-icons', 'null-theme', 'null-tools']);
  for (const b of m.builtins) for (const r of b.requires) assert.ok(ids.has(r), `${b.id} requires unknown ${r}`);
  assert.ok(m.builtins.find((b) => b.id === 'null-format').requires.includes('null-env'));
});

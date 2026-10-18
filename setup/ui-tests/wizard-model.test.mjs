import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// wizard-model.js is a plain script; load it the way the page does and read its globals.
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../ui/wizard-model.js', import.meta.url), 'utf8') + '\nthis.FEATURES = FEATURES;', ctx);
const plain = (x) => JSON.parse(JSON.stringify(x)); // arrays from the vm realm fail deepStrictEqual's prototype check

const B = (id, extra = {}) => ({ id, label: id.toUpperCase(), description: '', default: true, locked: false, requires: [], ...extra });
const chain = [B('core', { locked: true }), B('env'), B('fmt', { requires: ['env'] }), B('deep', { requires: ['fmt'] }), B('music')];

test('ticking a built-in ticks everything it needs, transitively', () => {
  const r = ctx.setBuiltin(chain, ['env', 'fmt', 'deep'], 'deep', true);
  assert.deepEqual(plain(r), { excluded: [], blockedBy: [] });
});

test('unticking a built-in that an included one needs is refused with the dependent named', () => {
  const r = ctx.setBuiltin(chain, [], 'env', false);
  assert.deepEqual(plain(r), { excluded: [], blockedBy: ['FMT'] });
});

test('unticking works once the dependents are off, and is idempotent', () => {
  let r = ctx.setBuiltin(chain, ['deep', 'fmt'], 'env', false);
  assert.deepEqual(plain(r).excluded, ['deep', 'fmt', 'env']);
  r = ctx.setBuiltin(chain, ['env'], 'env', false);
  assert.deepEqual(plain(r).excluded, ['env']);
});

test('core rows and unknown ids never change', () => {
  assert.deepEqual(plain(ctx.setBuiltin(chain, [], 'core', false)), { excluded: [], blockedBy: [] });
  assert.deepEqual(plain(ctx.setBuiltin(chain, [], 'nope', false)), { excluded: [], blockedBy: [] });
});

test('defaults leave off the default-off built-ins, except those an included one needs', () => {
  const list = [B('core', { locked: true }), B('a', { default: false }), B('b', { default: false }), B('c', { requires: ['b'] })];
  assert.deepEqual(plain(ctx.defaultExcluded(list)), ['a']); // b stays because c (default on) needs it
});

test('only settings that differ from the manifest default are sent', () => {
  const defs = [{ key: 'a', default: 13 }, { key: 'b', default: false }, { key: 'c', default: 'x' }];
  assert.deepEqual(plain(ctx.changedSettings(defs, { a: 13, b: true, d: 1 })), { b: true }); // unchanged and unknown keys dropped
  assert.deepEqual(plain(ctx.changedSettings(defs, {})), {});
  assert.deepEqual(plain(ctx.changedSettings(defs, { b: false })), {}); // a deliberate "false" equal to the default is still the default
});

test('pages with nothing to show are skipped', () => {
  const full = { builtins: [B('x')], settings: [{ key: 'k' }], marketplace: [{ id: 'p.q' }] };
  assert.deepEqual(plain(ctx.stepsFor('install', full)), ['welcome', 'options', 'builtins', 'marketplace', 'settings', 'summary']);
  assert.deepEqual(plain(ctx.stepsFor('install', { builtins: [], settings: [], marketplace: [] })), ['welcome', 'options', 'summary']);
  assert.deepEqual(plain(ctx.stepsFor('install', null)), ['welcome', 'options', 'summary']); // release without builtins.json
  assert.deepEqual(plain(ctx.stepsFor('modify', full)), ['options', 'builtins', 'summary']);
  assert.deepEqual(plain(ctx.stepsFor('maintenance', full)), []);
});

const state = (over = {}) => ({
  view: { manifest: { builtins: chain, settings: [{ key: 'editor.fontSize', label: 'Editor font size', default: 13, kind: 'number' }], marketplace: [] } },
  dir: 'C:\\Null', config: { schema: 1, path: true, contextMenu: false, excludedBuiltins: [] },
  excluded: ['music'], settings: {}, extensions: [], deleteData: false, ...over,
});

test('an install job carries the folder, the exclusions and only changed presets', () => {
  const j = plain(ctx.buildJob('install', state({ settings: { 'editor.fontSize': 16 } })));
  assert.equal(j.kind, 'install');
  assert.equal(j.installDir, 'C:\\Null');
  assert.deepEqual(j.config.excludedBuiltins, ['music']);
  assert.equal(j.config.contextMenu, false);
  assert.deepEqual(j.firstRun, { schema: 1, settings: { 'editor.fontSize': 16 }, extensions: [] });
});

test('an untouched settings page sends an empty preset set', () => {
  const j = plain(ctx.buildJob('install', state()));
  assert.deepEqual(j.firstRun.settings, {});
});

test('repair and uninstall carry no choices; uninstall carries the data flag; modify carries no presets', () => {
  assert.equal(ctx.buildJob('repair', state()).config, null);
  const u = plain(ctx.buildJob('uninstall', state({ deleteData: true })));
  assert.deepEqual([u.config, u.firstRun, u.deleteData], [null, null, true]);
  const m = plain(ctx.buildJob('modify', state()));
  assert.deepEqual([m.config.excludedBuiltins, m.firstRun], [['music'], null]);
});

test('the summary names every choice a person made', () => {
  const lines = plain(ctx.summaryLines(state({ settings: { 'editor.fontSize': 16 } })));
  assert.ok(lines.some((l) => l.includes('C:\\Null')));
  assert.ok(lines.some((l) => l.includes('MUSIC'))); // a left-out built-in is named
  assert.ok(lines.some((l) => l.includes('Editor font size') && l.includes('16')));
  assert.ok(lines.some((l) => l.includes('Explorer context menu') && l.includes('off')));
});

test('every config key the page offers exists on the Rust InstallConfig', () => {
  const rust = fs.readFileSync(new URL('../core/src/install_config.rs', import.meta.url), 'utf8');
  for (const [key] of ctx.FEATURES) {
    const snake = key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
    assert.ok(rust.includes(`pub ${snake}: bool`), `${key} is not an InstallConfig field`);
  }
});

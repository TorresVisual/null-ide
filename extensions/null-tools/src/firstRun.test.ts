import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import test from 'node:test';
import { ALLOWED_SETTINGS, FirstRunHost, installAll, parseFirstRun, runFirstRun } from './firstRun';

class FakeHost implements FirstRunHost {
  removed = 0;
  set: [string, unknown][] = [];
  installs: string[] = [];
  logs: string[] = [];
  constructor(
    private text: string | undefined,
    private userValues: string[] = [],
    private opts: { failSet?: string; failInstall?: string[]; hangInstall?: string[] } = {},
  ) {}
  read() { return this.text; }
  remove() { this.removed++; }
  hasUserValue(key: string) { return this.userValues.includes(key); }
  async setSetting(key: string, value: unknown) {
    if (key === this.opts.failSet) { throw new Error('settings.json is invalid'); }
    this.set.push([key, value]);
  }
  async installExtension(id: string) {
    this.installs.push(id);
    if (this.opts.hangInstall?.includes(id)) { return new Promise<void>(() => { /* never settles */ }); }
    if (this.opts.failInstall?.includes(id)) { throw new Error('offline'); }
  }
  log(message: string) { this.logs.push(message); }
}

const file = (o: object) => JSON.stringify({ schema: 1, ...o });

// ── the allowlist is the same list as setup/builtins.config.json ───────────

interface SettingDef { key: string; kind: string; default: unknown; options?: { value: string }[]; min?: number; max?: number }

test('the allowlist matches the settings table the installer validates against', () => {
  // out/ -> null-tools -> extensions -> repo root
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'setup', 'builtins.config.json'), 'utf8'));
  const defs: SettingDef[] = config.settings;
  assert.deepStrictEqual(Object.keys(ALLOWED_SETTINGS).sort(), defs.map(d => d.key).sort());
  for (const d of defs) {
    const rule = ALLOWED_SETTINGS[d.key];
    assert.ok(rule(d.default), `${d.key}: default`);
    for (const o of d.options ?? []) { assert.ok(rule(o.value), `${d.key}=${o.value}`); }
    if (d.kind === 'choice') { assert.ok(!rule('definitely-not-an-option'), d.key); }
    if (d.kind === 'bool') { assert.ok(rule(true) && rule(false) && !rule('true') && !rule(1), d.key); }
    if (d.kind === 'number') {
      assert.ok(rule(d.min) && rule(d.max), `${d.key}: bounds`);
      assert.ok(!rule(d.min! - 1) && !rule(d.max! + 1) && !rule(String(d.min)), `${d.key}: outside`);
    }
    if (d.kind === 'text') { assert.ok(!rule('') && !rule('a\nb') && !rule('x'.repeat(201)), d.key); }
  }
});

// ── parseFirstRun ──────────────────────────────────────────────────────────

test('parseFirstRun reads the schema, tolerates a BOM and drops invalid extension ids', () => {
  const parsed = parseFirstRun('\uFEFF' + file({ settings: { 'files.autoSave': 'afterDelay' }, extensions: ['ms-python.python', '../x', 'a', 7] }));
  assert.deepStrictEqual(parsed, { settings: { 'files.autoSave': 'afterDelay' }, extensions: ['ms-python.python'] });
  assert.deepStrictEqual(parseFirstRun(file({})), { settings: {}, extensions: [] });
});

test('parseFirstRun returns undefined for anything that is not a schema-1 object', () => {
  for (const bad of ['', '{nope', 'null', '[]', '"x"', '{"schema":2}', '{"settings":{}}']) {
    assert.strictEqual(parseFirstRun(bad), undefined, JSON.stringify(bad));
  }
});

// ── runFirstRun ────────────────────────────────────────────────────────────

test('applies allowlisted settings the user has no value for, then deletes the file', async () => {
  const host = new FakeHost(file({ settings: { 'files.autoSave': 'afterDelay', 'editor.fontSize': 15 } }));
  const result = await runFirstRun(host, 50);
  assert.deepStrictEqual(host.set, [['files.autoSave', 'afterDelay'], ['editor.fontSize', 15]]);
  assert.deepStrictEqual(result?.applied, ['files.autoSave', 'editor.fontSize']);
  assert.strictEqual(host.removed, 1);
});

test('never overwrites a value the user already set, even a falsy one', async () => {
  const host = new FakeHost(file({ settings: { 'editor.formatOnSave': true, 'editor.fontSize': 15 } }), ['editor.formatOnSave']);
  const result = await runFirstRun(host, 50);
  assert.deepStrictEqual(host.set, [['editor.fontSize', 15]]);
  assert.deepStrictEqual(result?.kept, ['editor.formatOnSave']);
});

test('ignores keys outside the allowlist, prototype keys and invalid values', async () => {
  const raw = '{"schema":1,"settings":{"__proto__":{"x":1},"constructor":"y","toString":"z",'
    + '"terminal.integrated.shell.windows":"C:\\\\evil.exe","editor.fontSize":"huge","files.autoSave":"afterDelay"}}';
  const host = new FakeHost(raw);
  const result = await runFirstRun(host, 50);
  assert.deepStrictEqual(host.set, [['files.autoSave', 'afterDelay']]);
  assert.deepStrictEqual(result?.applied, ['files.autoSave']);
  assert.strictEqual(host.removed, 1);
});

test('an unusable file is discarded once without throwing or touching anything', async () => {
  for (const bad of ['', '{nope', '{"schema":2,"settings":{"files.autoSave":"off"}}', '[]']) {
    const host = new FakeHost(bad);
    assert.strictEqual(await runFirstRun(host, 50), undefined);
    assert.strictEqual(host.removed, 1, JSON.stringify(bad));
    assert.deepStrictEqual([host.set, host.installs], [[], []]);
  }
});

test('no file means nothing happens', async () => {
  const host = new FakeHost(undefined);
  assert.strictEqual(await runFirstRun(host, 50), undefined);
  assert.deepStrictEqual([host.removed, host.set, host.installs], [0, [], []]);
});

test('a failed settings write keeps the file for the next launch and does not stop the others', async () => {
  const host = new FakeHost(file({ settings: { 'files.autoSave': 'afterDelay', 'editor.fontSize': 15 } }), [], { failSet: 'files.autoSave' });
  const result = await runFirstRun(host, 50);
  assert.deepStrictEqual(result?.failedSettings, ['files.autoSave']);
  assert.deepStrictEqual(host.set, [['editor.fontSize', 15]]);
  assert.strictEqual(host.removed, 0);
});

test('extensions install one at a time in order; a failure or a hang does not stop the rest or keep the file', async () => {
  const host = new FakeHost(
    file({ extensions: ['a.one', 'b.two', 'c.three', 'd.four'] }), [],
    { failInstall: ['b.two'], hangInstall: ['c.three'] },
  );
  const result = await runFirstRun(host, 20);
  assert.deepStrictEqual(host.installs, ['a.one', 'b.two', 'c.three', 'd.four']);
  assert.deepStrictEqual(result?.failedExtensions, ['b.two', 'c.three']);
  assert.strictEqual(host.removed, 1);
  assert.ok(host.logs.some(l => /c\.three.*timed out/.test(l)));
});

test('installAll returns exactly the ids that failed (the Retry path)', async () => {
  const host = new FakeHost(undefined, [], { failInstall: ['x.y'] });
  assert.deepStrictEqual(await installAll(host, ['p.q', 'x.y'], 20), ['x.y']);
  assert.deepStrictEqual(await installAll(host, [], 20), []);
});

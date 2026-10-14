import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { matchesKey } from './settingsFilter';
import { CATEGORIES, CATEGORY_DEFAULTS } from './types';

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const props = pkg.contributes.configuration.properties;

describe('package.json contract', () => {
  it('is a UI-side built-in that depends on null-accounts', () => {
    assert.equal(pkg.publisher, 'null');
    assert.deepEqual(pkg.extensionKind, ['ui']);
    assert.deepEqual(pkg.extensionDependencies, ['null.null-accounts']);
    assert.deepEqual(pkg.activationEvents, ['onStartupFinished']);
    assert.ok(fs.existsSync(path.join(root, pkg.main)), 'main points at a compiled file');
  });

  it('contributes exactly the documented commands', () => {
    const ids = pkg.contributes.commands.map((c: { command: string }) => c.command).sort();
    assert.deepEqual(ids, [
      'null.sync.enable', 'null.sync.resolveConflicts', 'null.sync.restore', 'null.sync.setCategories',
      'null.sync.showStatus', 'null.sync.stop', 'null.sync.syncNow',
    ]);
  });

  it('is off by default and every setting is application-scoped', () => {
    assert.equal(props['null-sync.enabled'].default, false);
    for (const key of Object.keys(props)) assert.equal(props[key].scope, 'application', key);
  });

  it('syncs every category by default except activity, which is opt-in', () => {
    const defaults = props['null-sync.categories'].default;
    assert.deepEqual(Object.keys(defaults), [...CATEGORIES]);
    assert.deepEqual(defaults, CATEGORY_DEFAULTS);
    assert.equal(defaults.activity, false);
  });

  it('excludes machine-specific paths and secrets by default', () => {
    const excluded: string[] = props['null-sync.excludedSettings'].default;
    for (const key of [
      'git.path', 'rust-analyzer.server.path', 'python.defaultInterpreterPath', 'terminal.integrated.defaultProfile.windows',
      'terminal.integrated.profiles.windows', 'http.proxy', 'null-sync.enabled', 'my.apiToken', 'x.SECRET', 'a.password',
      'github.credentialHelper',
    ]) {
      assert.equal(matchesKey(key, excluded), true, key);
    }
    for (const key of ['editor.fontSize', 'workbench.colorTheme', 'files.autoSave']) {
      assert.equal(matchesKey(key, excluded), false, key);
    }
  });
});

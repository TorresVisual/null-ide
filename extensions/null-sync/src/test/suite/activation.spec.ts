import * as assert from 'assert';
import * as vscode from 'vscode';

const COMMANDS = [
  'null.sync.enable', 'null.sync.syncNow', 'null.sync.resolveConflicts', 'null.sync.restore',
  'null.sync.stop', 'null.sync.setCategories', 'null.sync.showStatus',
];

suite('null-sync activation', () => {
  test('activates, exposes its API and registers its commands', async () => {
    const extension = vscode.extensions.getExtension('null.null-sync');
    assert.ok(extension, 'null.null-sync extension not found');
    const api = await extension!.activate();
    assert.strictEqual(extension!.isActive, true);
    assert.strictEqual(typeof api.getStatus, 'function');
    assert.strictEqual(typeof api.syncNow, 'function');
    assert.strictEqual(typeof api.resolveConflict, 'function');
    const registered = await vscode.commands.getCommands(true);
    for (const id of COMMANDS) assert.ok(registered.includes(id), `${id} not registered`);
  });

  test('is off by default: a sync run reports disabled and touches nothing', async () => {
    const api = vscode.extensions.getExtension('null.null-sync')!.exports;
    await api.syncNow();
    assert.strictEqual(api.getStatus().state, 'disabled');
    assert.deepStrictEqual(api.getStatus().conflicts, []);
  });

  test('switched on without setup it says so instead of failing', async () => {
    const config = vscode.workspace.getConfiguration('null-sync');
    await config.update('enabled', true, vscode.ConfigurationTarget.Global);
    try {
      const api = vscode.extensions.getExtension('null.null-sync')!.exports;
      await api.syncNow();
      assert.strictEqual(api.getStatus().state, 'signedOut');
      assert.match(api.getStatus().message, /Enable Settings Sync/);
    } finally {
      await config.update('enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});

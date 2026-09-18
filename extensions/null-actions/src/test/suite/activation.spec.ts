'use strict';

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('null-actions activation', () => {
  test('activates and registers its commands', async () => {
    const extension = vscode.extensions.getExtension('null.null-actions');
    assert.ok(extension, 'null.null-actions extension not found');

    await extension!.activate();
    assert.strictEqual(extension!.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('null-actions.openSettings'), 'null-actions.openSettings not registered');
    assert.ok(commands.includes('null-actions.runButton'), 'null-actions.runButton not registered');
  });
});

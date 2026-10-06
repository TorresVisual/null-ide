'use strict';

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('null-tools activation', () => {
  test('activates and registers its commands', async () => {
    const extension = vscode.extensions.getExtension('null.null-tools');
    assert.ok(extension, 'null.null-tools extension not found');

    await extension!.activate();
    assert.strictEqual(extension!.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    for (const id of ['null.generateCommitMessage', 'null.checkForUpdates', 'null.issues.openFullView']) {
      assert.ok(commands.includes(id), `${id} not registered`);
    }
  });
});

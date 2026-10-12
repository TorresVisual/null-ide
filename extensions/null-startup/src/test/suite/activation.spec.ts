'use strict';

import * as assert from 'assert';
import * as vscode from 'vscode';

// The integration runner uses a vanilla VS Code build, which has no patch 010, so this spec covers
// the degradation path: the extension stays active and quiet, and the report tab still opens.
suite('null-startup', () => {
  test('activates, registers its commands, and copies nothing on a build without the snapshot command', async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('null.null-startup')!.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['null-startup.openReport', 'null-startup.copyReport', 'null-startup.exportReport', 'null-startup.clearHistory']) {
      assert.ok(commands.includes(id), `${id} registered`);
    }
    await vscode.commands.executeCommand('null-startup.openReport');
    await vscode.commands.executeCommand('null-startup.copyReport');
    assert.strictEqual((await vscode.env.clipboard.readText()).includes('Null IDE startup report'), false);
  });
});

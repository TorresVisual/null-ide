'use strict';

import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as vscode from 'vscode';

suite('null-tools pull requests', () => {
  test('registers its commands, reports no-repo for a folder without a GitHub origin, and never serves a hostile null-pr URI', async function () {
    this.timeout(60_000);
    const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
    execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: folder });
    await vscode.extensions.getExtension('null.null-tools')!.activate();

    const commands = await vscode.commands.getCommands(true);
    for (const id of ['null.pulls.refresh', 'null.pulls.open', 'null.pulls.checkout', 'null.pulls.openOnGitHub', 'null.pulls.filter', 'null.pulls.resetFilter']) {
      assert.ok(commands.includes(id), `${id} is registered`);
    }

    const snapshot = await vscode.commands.executeCommand<{ state: string; pulls: number }>('_null.pulls.snapshot');
    assert.deepStrictEqual(snapshot, { state: 'no-repo', pulls: 0 });

    // A traversal path never reaches the network: the provider answers with an empty document.
    const hostile = vscode.Uri.from({ scheme: 'null-pr', path: '/../../etc/passwd', query: 'o=..&r=x&n=1&s=a&h=b&d=LEFT' });
    assert.strictEqual((await vscode.workspace.openTextDocument(hostile)).getText(), '');
  });
});

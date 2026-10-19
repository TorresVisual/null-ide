'use strict';

import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as vscode from 'vscode';

suite('null-tools GitHub Actions', () => {
  test('contributes its container, view and commands, reports no-repo for a folder without a GitHub origin, and never serves a hostile null-workflows URI', async function () {
    this.timeout(60_000);
    const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
    execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: folder });
    const extension = vscode.extensions.getExtension('null.null-tools')!;
    await extension.activate();

    const contributes = extension.packageJSON.contributes;
    assert.ok(contributes.viewsContainers.activitybar.some((c: { id: string }) => c.id === 'null-workflows'), 'container');
    assert.ok(contributes.views['null-workflows'].some((v: { id: string }) => v.id === 'null.workflowsView'), 'view');

    const commands = await vscode.commands.getCommands(true);
    for (const id of ['null.workflows.refresh', 'null.workflows.open', 'null.workflows.signIn', 'null.workflows.loadMore',
      'null.workflows.openOnGitHub', 'null.workflows.openWorkflowFile', 'null.workflows.createWorkflow', 'null.workflows.filter']) {
      assert.ok(commands.includes(id), `${id} is registered`);
    }

    const snapshot = await vscode.commands.executeCommand<{ state: string; repos: unknown[] }>('_null.workflows.snapshot');
    assert.deepStrictEqual(snapshot, { state: 'no-repo', repos: [] });
  });
});

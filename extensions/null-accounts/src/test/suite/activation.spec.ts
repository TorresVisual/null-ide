'use strict';

import * as assert from 'assert';
import * as vscode from 'vscode';
import { NullAccountsApi } from '../../api';

suite('null-accounts activation', () => {
  test('activates and exports a working API', async () => {
    const extension = vscode.extensions.getExtension<NullAccountsApi>('null.null-accounts');
    assert.ok(extension, 'null.null-accounts extension not found');

    const api = await extension!.activate();
    assert.ok(api, 'activate() returned no API');

    // The run uses a fresh --user-data-dir, so no accounts exist yet.
    assert.deepStrictEqual(api.getAccounts(), []);
    assert.strictEqual(api.getAccountForFolder(vscode.Uri.file(process.cwd())), undefined);

    const stranger = { id: 'x', provider: 'github', host: 'github.com', username: 'u', email: 'u@e.com', authMethod: 'oauth' } as const;
    assert.strictEqual(await api.getToken(stranger), undefined);

    // Phase 2: an unbound folder has no account, and a silent token request for an unknown
    // GitHub account (no externalId) resolves undefined instead of prompting or throwing.
    assert.strictEqual(typeof api.ensureAccountForFolder, 'function');
    assert.strictEqual(await api.getToken(stranger, ['repo'], { interactive: false }), undefined);
  });

  test('Phase 3: both commands are registered; the panel opens; switch with no folder resolves', async () => {
    await vscode.extensions.getExtension<NullAccountsApi>('null.null-accounts')!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('null-accounts.open'), 'null-accounts.open not registered');
    assert.ok(commands.includes('null-accounts.switchAccount'), 'null-accounts.switchAccount not registered');

    await vscode.commands.executeCommand('null-accounts.open');
    // The tab model reaches the extension host asynchronously, so poll instead of reading it once.
    const tabLabels = (): string[] => vscode.window.tabGroups.all.flatMap(g => g.tabs.map(t => t.label));
    for (let i = 0; i < 50 && !tabLabels().includes('Null Accounts'); i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(tabLabels().includes('Null Accounts'), `no Accounts tab among: ${tabLabels().join(', ')}`);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

    if (!vscode.workspace.workspaceFolders?.length) {
      // Must show a message and return — not block on it, and not open a quick-pick.
      await vscode.commands.executeCommand('null-accounts.switchAccount');
    }
  });
});

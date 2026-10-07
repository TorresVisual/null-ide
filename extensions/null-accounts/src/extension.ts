'use strict';

import * as vscode from 'vscode';
import { AccountStore } from './accountStore';
import { findAccount, importExisting } from './accountSetup';
import { createApi, NullAccountsApi } from './api';
import { ChangeEmitter } from './changeEmitter';
import { ProjectBinding } from './projectBinding';
import { fetchGithub, GithubProvider } from './providers/github';
import { addGithubAccount, chooseAccountForFolder, PickerDeps } from './ui/accountPicker';
import { bindFolderToAccount } from './ui/accountsMenuActions';
import { registerAccountsMenu } from './ui/accountsMenuController';
import { ADD_ACCOUNT_COMMAND, BIND_COMMAND } from './ui/accountsMenuModel';
import { AccountsPanel } from './ui/accountsPanel';
import { registerStatusBar, SWITCH_COMMAND } from './ui/statusBarController';

const IMPORT_OFFERED_KEY = 'null-accounts.importOffered';

export function activate(context: vscode.ExtensionContext): NullAccountsApi {
  const store = new AccountStore(context.globalState, context.secrets);
  const bindings = new ProjectBinding(context.globalState);
  const github = new GithubProvider({
    getSession: (scopes, options) => vscode.authentication.getSession('github', scopes, options),
    api: fetchGithub,
  });

  // One event for "something changed" (accounts or bindings); the API and, later, the UI listen to it.
  const changed = new ChangeEmitter();
  context.subscriptions.push(
    store.onDidChange(() => {
      void bindings.prune(new Set(store.list().map(a => a.id)));
      changed.fire();
    }),
    bindings.onDidChange(() => changed.fire()),
  );

  const pickerDeps: PickerDeps = { accounts: store, bindings, github };

  const api = createApi({
    accounts: store,
    accountIdForFolder: folder => bindings.accountIdFor(folder.fsPath),
    chooseAccountForFolder: folder => chooseAccountForFolder(pickerDeps, folder),
    tokenProviders: { github }, // Phase 4 adds gitlab
    onDidChange: changed.event,
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('null-accounts.open', () =>
      AccountsPanel.createOrShow({
        accounts: store,
        bindings,
        addGithub: () => addGithubAccount(pickerDeps),
        onDidChange: changed.event,
      })),
    vscode.commands.registerCommand(SWITCH_COMMAND, async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showInformationMessage('Open a folder to choose its account.');
        return;
      }
      await chooseAccountForFolder(pickerDeps, folder.uri);
    }),
    vscode.commands.registerCommand(BIND_COMMAND, async (accountId: unknown) => {
      const result = await bindFolderToAccount(
        { folderPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, accounts: store, bindings },
        accountId,
      );
      if (result === 'no-folder') { void vscode.window.showInformationMessage('Open a folder to choose its account.'); }
      if (result === 'no-account') { void vscode.window.showInformationMessage('That account no longer exists.'); }
    }),
    vscode.commands.registerCommand(ADD_ACCOUNT_COMMAND, async () => { await addGithubAccount(pickerDeps); }),
    registerStatusBar(api),
    registerAccountsMenu(api),
  );

  void offerImport(context, store, bindings, github).catch(() => { /* a failed offer must never break activation */ });
  return api;
}

/** Once: offer to keep an already-signed-in GitHub account instead of silently logging existing users out. */
async function offerImport(
  context: vscode.ExtensionContext,
  store: AccountStore,
  bindings: ProjectBinding,
  github: GithubProvider,
): Promise<void> {
  if (context.globalState.get<boolean>(IMPORT_OFFERED_KEY)) { return; }
  const found = await github.existing().catch(() => undefined);
  if (!found) { return; } // not signed in, or offline: look again next start
  await context.globalState.update(IMPORT_OFFERED_KEY, true);
  if (findAccount(store.list(), found)) { return; }
  const choice = await vscode.window.showInformationMessage(
    `Null IDE now manages GitHub accounts. Import the account you're signed in with (${found.username})?`,
    'Import',
    'Not now',
  );
  if (choice !== 'Import') { return; }
  const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
  await importExisting(found, folders, store, bindings);
}

export function deactivate(): void {}

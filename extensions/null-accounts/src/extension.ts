'use strict';

import * as vscode from 'vscode';
import { AccountStore } from './accountStore';
import { findAccount, importExisting } from './accountSetup';
import { createApi, NullAccountsApi } from './api';
import { ChangeEmitter } from './changeEmitter';
import { ProjectBinding } from './projectBinding';
import { fetchGithub, GithubProvider } from './providers/github';
import { fetchGitlab, fetchPostForm, GitlabProvider, resolveClientId } from './providers/gitlab';
import { addAccount, chooseAccountForFolder, PickerDeps, reauthenticate } from './ui/accountPicker';
import { bindFolderToAccount } from './ui/accountsMenuActions';
import { registerAccountsMenu } from './ui/accountsMenuController';
import { ADD_ACCOUNT_COMMAND, BIND_COMMAND } from './ui/accountsMenuModel';
import { AccountsPanel } from './ui/accountsPanel';
import { registerStatusBar, SWITCH_COMMAND } from './ui/statusBarController';
import { NewAccount } from './types';

const IMPORT_OFFERED_KEY = 'null-accounts.importOffered';

export function activate(context: vscode.ExtensionContext): NullAccountsApi {
  const store = new AccountStore(context.globalState, context.secrets);
  const bindings = new ProjectBinding(context.globalState);
  const github = new GithubProvider({
    getSession: (scopes, options) => vscode.authentication.getSession('github', scopes, options),
    api: fetchGithub,
  });
  const gitlab = new GitlabProvider({
    post: fetchPostForm,
    get: fetchGitlab,
    secrets: { get: id => store.getSecret(id), set: (id, value) => store.setSecret(id, value) },
    clientIdFor: host => {
      const cfg = vscode.workspace.getConfiguration('null-accounts.gitlab');
      return resolveClientId(host, cfg.get('clientId'), cfg.get('hostClientIds'));
    },
    now: Date.now,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    onNeedsReauth: account => {
      void vscode.window
        .showWarningMessage(`Your GitLab sign-in for ${account.username}@${account.host} has expired.`, 'Re-authenticate')
        .then(choice => { if (choice) { return reauthenticate(pickerDeps, account.id); } });
    },
    promptReauth: account => reauthenticate(pickerDeps, account.id),
  });

  // One event for "something changed" (accounts or bindings); the API and, later, the UI listen to it.
  const changed = new ChangeEmitter();
  context.subscriptions.push(
    store.onDidChange(() => {
      void bindings.prune(new Set(store.list().map(a => a.id)));
      changed.fire();
    }),
    bindings.onDidChange(() => changed.fire()),
    gitlab.onDidChange(() => changed.fire()),
  );

  const pickerDeps: PickerDeps = { accounts: store, bindings, github, gitlab };

  const api = createApi({
    accounts: store,
    accountIdForFolder: folder => bindings.accountIdFor(folder.fsPath),
    chooseAccountForFolder: folder => chooseAccountForFolder(pickerDeps, folder),
    tokenProviders: { github, gitlab },
    onDidChange: changed.event,
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('null-accounts.open', () =>
      AccountsPanel.createOrShow({
        accounts: store,
        bindings,
        add: () => addAccount(pickerDeps),
        reauth: id => reauthenticate(pickerDeps, id),
        needsReauth: id => gitlab.needsReauth(id),
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
    vscode.commands.registerCommand(ADD_ACCOUNT_COMMAND, async () => { await addAccount(pickerDeps); }),
    registerStatusBar(api),
    registerAccountsMenu(api),
  );

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    // Integration specs cannot sign in to a provider, so they add and remove accounts through these two commands.
    // Not contributed in package.json and registered only when an extensionTestsPath run hosts the extension:
    // they would otherwise be a prompt-free way to add or delete accounts.
    context.subscriptions.push(
      vscode.commands.registerCommand('null-accounts.test.addAccount', (account: NewAccount, secret?: string) => store.add(account, secret)),
      vscode.commands.registerCommand('null-accounts.test.removeAccount', (id: string) => store.remove(id)),
    );
  }

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

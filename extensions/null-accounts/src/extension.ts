'use strict';

import * as vscode from 'vscode';
import { AccountStore } from './accountStore';
import { findAccount, importExisting } from './accountSetup';
import { createApi, NullAccountsApi } from './api';
import { ChangeEmitter } from './changeEmitter';
import { ProjectBinding } from './projectBinding';
import { fetchGithub, GithubProvider } from './providers/github';
import { chooseAccountForFolder } from './ui/accountPicker';

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

  const api = createApi({
    accounts: store,
    accountIdForFolder: folder => bindings.accountIdFor(folder.fsPath),
    chooseAccountForFolder: folder => chooseAccountForFolder({ accounts: store, bindings, github }, folder),
    tokenProviders: { github }, // Phase 4 adds gitlab
    onDidChange: changed.event,
  });

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

'use strict';

import * as vscode from 'vscode';
import type { NullAccountsApi } from '../api';
import { publishAccountsMenu } from './accountsMenuActions';
import { accountsMenuModel } from './accountsMenuModel';

/** Keeps the `null.accounts.menu` context key (rendered by the workbench Accounts menu) in sync with accounts, bindings and the open folder. */
export function registerAccountsMenu(api: NullAccountsApi): vscode.Disposable {
  const refresh = (): void => {
    void publishAccountsMenu(
      () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        return accountsMenuModel(api.getAccounts(), folder ? api.getAccountForFolder(folder.uri)?.id : undefined);
      },
      (key, value) => vscode.commands.executeCommand('setContext', key, value),
    );
  };
  refresh();
  return vscode.Disposable.from(api.onDidChange(refresh), vscode.workspace.onDidChangeWorkspaceFolders(refresh));
}

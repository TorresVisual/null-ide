'use strict';

import * as vscode from 'vscode';
import type { NullAccountsApi } from '../api';
import { publishAccountsMenu } from './accountsMenuActions';
import { accountsMenuModel, activityAvatar, AVATAR_CONTEXT_KEY } from './accountsMenuModel';

/** Keeps the `null.accounts.menu` context key (rendered by the workbench Accounts menu) in sync with accounts, bindings and the open folder. */
export function registerAccountsMenu(api: NullAccountsApi, avatarOf: (id: string) => string | undefined): vscode.Disposable {
  const setContext = (key: string, value: unknown): Thenable<unknown> => vscode.commands.executeCommand('setContext', key, value);
  const currentId = (): string | undefined => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? api.getAccountForFolder(folder.uri)?.id : undefined;
  };
  const refresh = (): void => {
    void publishAccountsMenu(() => accountsMenuModel(api.getAccounts(), currentId(), avatarOf), setContext);
    void setContext(AVATAR_CONTEXT_KEY, activityAvatar(api.getAccounts(), currentId(), avatarOf));
  };
  refresh();
  return vscode.Disposable.from(api.onDidChange(refresh), vscode.workspace.onDidChangeWorkspaceFolders(refresh));
}

'use strict';

import * as vscode from 'vscode';
import type { NullAccountsApi } from '../api';
import { statusBarModel } from './statusBarModel';

export const SWITCH_COMMAND = 'null-accounts.switchAccount';

/** Shows the first workspace folder's account; click runs `null-accounts.switchAccount`. */
export function registerStatusBar(api: NullAccountsApi): vscode.Disposable {
  const item = vscode.window.createStatusBarItem('null-accounts.account', vscode.StatusBarAlignment.Left, 50);
  item.name = 'Null Accounts';
  item.command = SWITCH_COMMAND;
  const refresh = (): void => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { item.hide(); return; }
    const model = statusBarModel(folder.name, api.getAccountForFolder(folder.uri));
    item.text = model.text;
    item.tooltip = model.tooltip;
    item.show();
  };
  refresh();
  return vscode.Disposable.from(item, api.onDidChange(refresh), vscode.workspace.onDidChangeWorkspaceFolders(refresh));
}

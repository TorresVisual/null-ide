'use strict';

import * as os from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import { KeyUi } from './keyActions';

/** The real editor interactions behind `KeyActions`. */
export const keyUi: KeyUi = {
  async confirm(message, detail, action) {
    return (await vscode.window.showWarningMessage(message, { modal: true, detail }, action)) === action;
  },
  info: (message, ...actions) => Promise.resolve(vscode.window.showInformationMessage(message, ...actions)),
  warn: (message, ...actions) => Promise.resolve(vscode.window.showWarningMessage(message, ...actions)),
  copy: text => Promise.resolve(vscode.env.clipboard.writeText(text)),
  async open(url) { await vscode.env.openExternal(vscode.Uri.parse(url)); },
  async pickKeyFile() {
    const picked = await vscode.window.showOpenDialog({
      title: 'Choose the private SSH key',
      openLabel: 'Use this key',
      canSelectMany: false,
      canSelectFolders: false,
      defaultUri: vscode.Uri.file(path.join(os.homedir(), '.ssh')),
    });
    return picked?.[0]?.fsPath;
  },
};

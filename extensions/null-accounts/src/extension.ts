'use strict';

import * as vscode from 'vscode';
import { AccountStore } from './accountStore';
import { createApi, NullAccountsApi } from './api';

export function activate(context: vscode.ExtensionContext): NullAccountsApi {
  const store = new AccountStore(context.globalState, context.secrets);
  return createApi({
    accounts: store,
    accountIdForFolder: () => undefined,
    chooseAccountForFolder: async () => undefined,
    tokenProviders: {},
    onDidChange: store.onDidChange,
  });
}

export function deactivate(): void {}

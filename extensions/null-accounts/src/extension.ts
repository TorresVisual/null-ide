'use strict';

import * as vscode from 'vscode';
import { AccountStore } from './accountStore';
import { createApi, NullAccountsApi } from './api';

export function activate(context: vscode.ExtensionContext): NullAccountsApi {
  const store = new AccountStore(context.globalState, context.secrets);
  // Phase 2 swaps the resolver for projectBinding and registers the github token provider;
  // Phase 4 adds gitlab. Until then no folder is bound and no provider can issue tokens.
  return createApi({
    accounts: store,
    accountIdForFolder: () => undefined,
    tokenProviders: {},
  });
}

export function deactivate(): void {}

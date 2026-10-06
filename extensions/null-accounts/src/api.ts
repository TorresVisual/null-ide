'use strict';

import type * as vscode from 'vscode';
import { Account, Provider } from './types';

/** Public surface other Null IDE extensions consume via `extensions.getExtension('null.null-accounts')?.exports`. */
export interface NullAccountsApi {
  getAccounts(): Account[];
  getAccountForFolder(folder: vscode.Uri): Account | undefined;
  /**
   * Resolves a token for the account, refreshing if needed. `undefined` if the user cancels
   * re-auth or no token is available. Never throws for auth failure.
   */
  getToken(account: Account, scopes?: string[]): Promise<string | undefined>;
  onDidChange: vscode.Event<void>;
}

/** One per provider (providers/github.ts, providers/gitlab.ts). May throw; the API turns that into `undefined`. */
export interface TokenProvider {
  getToken(account: Account, scopes?: string[]): Promise<string | undefined>;
}

export interface ApiDeps {
  accounts: {
    list(): Account[];
    get(id: string): Account | undefined;
    onDidChange: vscode.Event<void>;
  };
  /** Folder -> bound account id. Backed by projectBinding in Phase 2. */
  accountIdForFolder(folder: vscode.Uri): string | undefined;
  /** Filled in per provider as they land (github: Phase 2, gitlab: Phase 4). */
  tokenProviders: Partial<Record<Provider, TokenProvider>>;
}

export function createApi(deps: ApiDeps): NullAccountsApi {
  return {
    getAccounts: () => deps.accounts.list(),
    getAccountForFolder(folder) {
      const id = deps.accountIdForFolder(folder);
      return id === undefined ? undefined : deps.accounts.get(id);
    },
    async getToken(account, scopes) {
      try {
        return await deps.tokenProviders[account.provider]?.getToken(account, scopes);
      } catch {
        return undefined;
      }
    },
    onDidChange: deps.accounts.onDidChange,
  };
}

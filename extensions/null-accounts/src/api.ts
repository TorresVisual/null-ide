'use strict';

import type * as vscode from 'vscode';
import { Account, Provider } from './types';

export interface TokenOptions {
  /** Allow a sign-in / re-auth prompt. Default false: background callers must never surface UI. */
  interactive?: boolean;
}

/** Public surface other Null IDE extensions consume via `extensions.getExtension('null.null-accounts')?.exports`. */
export interface NullAccountsApi {
  getAccounts(): Account[];
  getAccountForFolder(folder: vscode.Uri): Account | undefined;
  /**
   * The folder's bound account; if it has none, asks the user to pick or add one and binds it.
   * `undefined` if they cancel. Never throws.
   */
  ensureAccountForFolder(folder: vscode.Uri): Promise<Account | undefined>;
  /**
   * Resolves a token for the account, refreshing if needed. `undefined` if no token is available
   * or (with `interactive`) the user cancels re-auth. Never throws for auth failure.
   */
  getToken(account: Account, scopes?: string[], options?: TokenOptions): Promise<string | undefined>;
  onDidChange: vscode.Event<void>;
}

/** One per provider (providers/github.ts, providers/gitlab.ts). May throw; the API turns that into `undefined`. */
export interface TokenProvider {
  getToken(account: Account, scopes?: string[], options?: TokenOptions): Promise<string | undefined>;
}

export interface ApiDeps {
  accounts: {
    list(): Account[];
    get(id: string): Account | undefined;
  };
  /** Folder -> bound account id (projectBinding). */
  accountIdForFolder(folder: vscode.Uri): string | undefined;
  /** Quick-pick an account for the folder and bind it (ui/accountPicker). */
  chooseAccountForFolder(folder: vscode.Uri): Promise<Account | undefined>;
  /** Filled in per provider as they land (github: Phase 2, gitlab: Phase 4). */
  tokenProviders: Partial<Record<Provider, TokenProvider>>;
  /** Fires when accounts or bindings change. */
  onDidChange: vscode.Event<void>;
}

export function createApi(deps: ApiDeps): NullAccountsApi {
  const getAccountForFolder = (folder: vscode.Uri): Account | undefined => {
    const id = deps.accountIdForFolder(folder);
    return id === undefined ? undefined : deps.accounts.get(id);
  };
  return {
    getAccounts: () => deps.accounts.list(),
    getAccountForFolder,
    async ensureAccountForFolder(folder) {
      const bound = getAccountForFolder(folder);
      if (bound) { return bound; }
      try {
        return await deps.chooseAccountForFolder(folder);
      } catch {
        return undefined;
      }
    },
    async getToken(account, scopes, options) {
      // Callers pass an Account they got from this API; trust only the stored copy, never its fields.
      const stored = deps.accounts.get(account.id);
      if (!stored) { return undefined; }
      try {
        return await deps.tokenProviders[stored.provider]?.getToken(stored, scopes, options);
      } catch {
        return undefined;
      }
    },
    onDidChange: deps.onDidChange,
  };
}

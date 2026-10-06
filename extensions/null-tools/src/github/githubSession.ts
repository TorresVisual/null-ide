'use strict';

import type * as vscode from 'vscode';

// null-tools and null-accounts are built separately, so this is a structural copy of the slice of
// NullAccountsApi (extensions/null-accounts/src/api.ts) that null-tools uses.
export interface AccountLike { provider: string; username: string }

export interface AccountsApiLike {
  getAccountForFolder(folder: vscode.Uri): AccountLike | undefined;
  ensureAccountForFolder(folder: vscode.Uri): Promise<AccountLike | undefined>;
  getToken(account: AccountLike, scopes?: string[], options?: { interactive?: boolean }): Promise<string | undefined>;
  onDidChange: vscode.Event<void>;
}

export interface GithubSession { accessToken: string; login: string }

const SCOPES = ['repo'];

/**
 * The token and login of the GitHub account bound to `folder`. Silent callers get `undefined` for an
 * unbound folder; interactive callers are asked to pick or add an account first.
 */
export async function resolveGithubSession(
  api: AccountsApiLike | undefined,
  folder: vscode.Uri | undefined,
  interactive: boolean,
): Promise<GithubSession | undefined> {
  if (!api || !folder) { return undefined; }
  let account = api.getAccountForFolder(folder);
  if (!account && interactive) { account = await api.ensureAccountForFolder(folder); }
  if (account?.provider !== 'github') { return undefined; }
  const accessToken = await api.getToken(account, SCOPES, { interactive });
  return accessToken ? { accessToken, login: account.username } : undefined;
}

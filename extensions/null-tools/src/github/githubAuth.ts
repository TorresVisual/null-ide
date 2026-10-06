'use strict';

import * as vscode from 'vscode';
import { AccountsApiLike, GithubSession, resolveGithubSession } from './githubSession';

/** null-accounts' exported API. null-tools lists it in `extensionDependencies`, so it is active by now. */
export function getAccountsApi(): AccountsApiLike | undefined {
  return vscode.extensions.getExtension<AccountsApiLike>('null.null-accounts')?.exports;
}

export function getGithubSession(createIfNone: boolean): Promise<GithubSession | undefined> {
  return resolveGithubSession(getAccountsApi(), vscode.workspace.workspaceFolders?.[0]?.uri, createIfNone);
}

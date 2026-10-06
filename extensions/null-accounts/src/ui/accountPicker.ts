'use strict';

import path from 'node:path';
import * as vscode from 'vscode';
import { AccountStore } from '../accountStore';
import { addOrReuse } from '../accountSetup';
import { originUrl } from '../git';
import { ProjectBinding } from '../projectBinding';
import { GithubProvider } from '../providers/github';
import { suggestAccount } from '../suggest';
import { Account } from '../types';
import { buildPickItems, PickItem } from './pickItems';

export interface PickerDeps {
  accounts: AccountStore;
  bindings: ProjectBinding;
  github: GithubProvider;
}

/** Signs in to another GitHub account and stores it; resolves the stored one if it was already added. */
export async function addGithubAccount(deps: PickerDeps): Promise<Account | undefined> {
  try {
    const fresh = await deps.github.signIn();
    return fresh ? await addOrReuse(deps.accounts, fresh) : undefined;
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not add the GitHub account: ${(err as Error).message}`);
    return undefined;
  }
}

/** Quick-pick an account for the folder (suggesting one from its origin remote), then bind it. */
export async function chooseAccountForFolder(deps: PickerDeps, folder: vscode.Uri): Promise<Account | undefined> {
  const origin = await originUrl(folder.fsPath);
  const suggested = origin ? suggestAccount(origin, deps.accounts.list()) : undefined;
  const picked = await vscode.window.showQuickPick<PickItem>(buildPickItems(deps.accounts.list(), suggested?.id), {
    placeHolder: `Which account should "${path.basename(folder.fsPath)}" use?`,
  });
  if (!picked) { return undefined; }
  const account = picked.account ?? await addGithubAccount(deps);
  if (!account) { return undefined; }
  await deps.bindings.bind(folder.fsPath, account.id);
  return account;
}

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

/** Quick-pick an account for the folder (suggesting one from its origin remote when unbound), then bind it. */
export async function chooseAccountForFolder(deps: PickerDeps, folder: vscode.Uri): Promise<Account | undefined> {
  const currentId = deps.bindings.accountIdFor(folder.fsPath);
  let suggestedId: string | undefined;
  if (currentId === undefined) {
    const origin = await originUrl(folder.fsPath);
    suggestedId = origin ? suggestAccount(origin, deps.accounts.list())?.id : undefined;
  }
  const picked = await vscode.window.showQuickPick<PickItem>(
    buildPickItems(deps.accounts.list(), { suggestedId, currentId }),
    { placeHolder: `Which account should "${path.basename(folder.fsPath)}" use?` },
  );
  if (!picked) { return undefined; }
  if (picked.action.kind === 'unbind') {
    await deps.bindings.unbind(folder.fsPath);
    return undefined;
  }
  const account = picked.action.kind === 'add' ? await addGithubAccount(deps) : picked.action.account;
  if (!account) { return undefined; }
  await deps.bindings.bind(folder.fsPath, account.id);
  return account;
}

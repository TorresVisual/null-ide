'use strict';

import path from 'node:path';
import * as vscode from 'vscode';
import { normalizeHost } from '../accountInput';
import { AccountStore } from '../accountStore';
import { addOrRefresh, addOrReuse } from '../accountSetup';
import { originUrl } from '../git';
import { ProjectBinding } from '../projectBinding';
import { GithubProvider } from '../providers/github';
import { DeviceFlowUi, GITLAB_COM, GitlabProvider } from '../providers/gitlab';
import { OAuthError } from '../providers/gitlabOAuth';
import { suggestAccount } from '../suggest';
import { Account } from '../types';
import { buildPickItems, PickItem, providerPickItems } from './pickItems';

export interface PickerDeps {
  accounts: AccountStore;
  bindings: ProjectBinding;
  github: GithubProvider;
  gitlab: GitlabProvider;
}

function reportFailure(what: string, err: unknown): void {
  if (err instanceof OAuthError && err.reason === 'cancelled') { return; }
  void vscode.window.showErrorMessage(`Could not ${what}: ${(err as Error).message}`);
}

/** Signs in to another GitHub account and stores it; resolves the stored one if it was already added. */
async function addGithubAccount(deps: PickerDeps): Promise<Account | undefined> {
  try {
    const fresh = await deps.github.signIn();
    return fresh ? await addOrReuse(deps.accounts, fresh) : undefined;
  } catch (err) {
    reportFailure('add the GitHub account', err);
    return undefined;
  }
}

/** A device-flow sign-in behind a cancellable notification: shows the code, copies it, opens the verification page. */
function withDeviceFlow<T>(title: string, run: (ui: DeviceFlowUi) => Promise<T>): Thenable<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    (progress, token) => run({
      show: code => {
        progress.report({ message: `Enter ${code.userCode} in your browser (copied to the clipboard)` });
        void vscode.env.clipboard.writeText(code.userCode);
        void vscode.env.openExternal(vscode.Uri.parse(code.verificationUriComplete ?? code.verificationUri));
      },
      cancelled: () => token.isCancellationRequested,
    }),
  );
}

async function addGitlabAccount(deps: PickerDeps, host: string): Promise<Account | undefined> {
  try {
    const { account, secret } = await withDeviceFlow(`Signing in to ${host}`, ui => deps.gitlab.signIn(host, ui));
    return await addOrRefresh(deps.accounts, account, secret);
  } catch (err) {
    reportFailure('add the GitLab account', err);
    return undefined;
  }
}

async function askSelfHostedHost(): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: 'Self-hosted GitLab',
    prompt: 'Host name of your GitLab server, e.g. git.example.org (https only)',
    validateInput: v => { try { normalizeHost(v); return undefined; } catch (err) { return (err as Error).message; } },
  });
  return value === undefined ? undefined : normalizeHost(value);
}

/** Asks which provider, then signs in and stores the account. `undefined` if the user backs out or sign-in fails. */
export async function addAccount(deps: PickerDeps): Promise<Account | undefined> {
  const picked = await vscode.window.showQuickPick(providerPickItems(), { placeHolder: 'Add an account from…' });
  if (!picked) { return undefined; }
  if (picked.choice === 'github') { return addGithubAccount(deps); }
  const host = picked.choice === 'gitlab' ? GITLAB_COM : await askSelfHostedHost();
  return host ? addGitlabAccount(deps, host) : undefined;
}

/** Signs a GitLab account in again (expired or revoked tokens). Failures are shown, never thrown. */
export async function reauthenticate(deps: PickerDeps, accountId: string): Promise<void> {
  const account = deps.accounts.get(accountId);
  if (!account || account.provider !== 'gitlab') { return; }
  try {
    await withDeviceFlow(`Signing in to ${account.host}`, ui => deps.gitlab.reauthenticate(account, ui));
  } catch (err) {
    reportFailure('re-authenticate', err);
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
  const account = picked.action.kind === 'add' ? await addAccount(deps) : picked.action.account;
  if (!account) { return undefined; }
  await deps.bindings.bind(folder.fsPath, account.id);
  return account;
}

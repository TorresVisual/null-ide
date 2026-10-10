'use strict';

import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import { normalizeHost, validateNewAccount } from '../accountInput';
import { AccountStore } from '../accountStore';
import { addOrRefresh, addOrReuse } from '../accountSetup';
import { originUrl } from '../git';
import { ProjectBinding } from '../projectBinding';
import { GithubProvider } from '../providers/github';
import { DeviceFlowUi, GITLAB_COM, GitlabProvider } from '../providers/gitlab';
import { OAuthError } from '../providers/gitlabOAuth';
import { buildSshAccount, normalizeSshHost } from '../sshAccount';
import { generateKey } from '../sshKeyOps';
import { suggestAccount } from '../suggest';
import { Account } from '../types';
import { KeyActions } from './keyActions';
import { buildPickItems, PickItem, providerPickItems } from './pickItems';

export interface PickerDeps {
  accounts: AccountStore;
  bindings: ProjectBinding;
  github: GithubProvider;
  gitlab: GitlabProvider;
  keys: KeyActions;
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

async function askSelfHostedHost(title = 'Self-hosted GitLab'): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title,
    prompt: 'Host name of your GitLab server, e.g. git.example.org (https only)',
    validateInput: v => { try { normalizeHost(v); return undefined; } catch (err) { return (err as Error).message; } },
  });
  return value === undefined ? undefined : normalizeHost(value);
}

/** A personal access token for a server where no OAuth app can be registered; adding the same account again replaces its token. */
async function addGitlabTokenAccount(deps: PickerDeps): Promise<Account | undefined> {
  const host = await askSelfHostedHost('GitLab host for the access token');
  if (!host) { return undefined; }
  const token = await vscode.window.showInputBox({
    title: `Access token for ${host}`,
    prompt: 'Create one under Edit profile → Access tokens with the api and write_repository scopes (read_api for read-only). If the server requires fine-grained tokens, include the User: Read permission.',
    password: true,
    ignoreFocusOut: true,
  });
  if (!token) { return undefined; }
  try {
    const { account, secret } = await deps.gitlab.signInWithToken(host, token);
    return await addOrRefresh(deps.accounts, account, secret);
  } catch (err) {
    reportFailure('add the GitLab account', err);
    return undefined;
  }
}

const problemOf = (check: (value: string) => unknown) => (value: string): string | undefined => {
  try { check(value); return undefined; } catch (err) { return (err as Error).message; }
};

/** An account that signs in with an SSH key only: no OAuth, no token. Asks for the server, who you are there, and the key file. */
async function addSshAccount(deps: PickerDeps): Promise<Account | undefined> {
  const host = await vscode.window.showInputBox({
    title: 'SSH account: server',
    prompt: 'Host name of the GitLab (or GitHub) server, e.g. gitlab.example.edu — no port',
    validateInput: problemOf(normalizeSshHost),
    ignoreFocusOut: true,
  });
  if (host === undefined) { return undefined; }
  const username = await vscode.window.showInputBox({
    title: `Your username on ${normalizeSshHost(host)}`,
    prompt: 'The name shown on your profile there (it is also used as the git author name)',
    validateInput: v => (v.trim() ? undefined : 'A username is required.'),
    ignoreFocusOut: true,
  });
  if (username === undefined) { return undefined; }
  const email = await vscode.window.showInputBox({
    title: 'Email for commits',
    prompt: 'Written to user.email in projects that use this account',
    validateInput: problemOf(v => validateNewAccount({ provider: 'gitlab', host: 'x.example', username: 'x', email: v, authMethod: 'oauth' })),
    ignoreFocusOut: true,
  });
  if (email === undefined) { return undefined; }
  const mode = await vscode.window.showQuickPick(
    [
      { label: '$(key) Generate a new key', description: 'recommended — no passphrase, kept in ~/.ssh/null-accounts', generate: true },
      { label: '$(file) Use an existing key…', description: 'a private key file you already have', generate: false },
    ],
    { placeHolder: 'Which SSH key should this account use?', ignoreFocusOut: true },
  );
  if (!mode) { return undefined; }
  let keyPath: string;
  if (mode.generate) {
    try {
      keyPath = await generateKey({ home: os.homedir(), host: normalizeSshHost(host), username: username.trim(), email: email.trim() });
    } catch (err) {
      reportFailure('create the SSH key', err);
      return undefined;
    }
  } else {
    const picked = await vscode.window.showOpenDialog({
      title: `Private SSH key for ${normalizeSshHost(host)}`,
      openLabel: 'Use this key',
      canSelectMany: false,
      canSelectFolders: false,
      defaultUri: vscode.Uri.file(path.join(os.homedir(), '.ssh')),
    });
    if (!picked?.length) { return undefined; }
    keyPath = picked[0].fsPath;
  }
  try {
    const account = await deps.accounts.add(buildSshAccount({ host, username, email, keyPath }, os.homedir(), fs.existsSync));
    // A new key is not on the server yet, so testing it now would only fail: offer to put it there first.
    const next = mode.generate ? deps.keys.afterNewKey(account.id) : deps.keys.test(account.id);
    void next.catch(err => reportFailure('finish setting up the key', err));
    return account;
  } catch (err) {
    reportFailure('add the SSH account', err);
    return undefined;
  }
}

/** Asks which provider, then signs in and stores the account. `undefined` if the user backs out or sign-in fails. */
export async function addAccount(deps: PickerDeps): Promise<Account | undefined> {
  const picked = await vscode.window.showQuickPick(providerPickItems(), { placeHolder: 'Add an account from…' });
  if (!picked) { return undefined; }
  if (picked.choice === 'github') { return addGithubAccount(deps); }
  if (picked.choice === 'gitlab-token') { return addGitlabTokenAccount(deps); }
  if (picked.choice === 'ssh') { return addSshAccount(deps); }
  const host = picked.choice === 'gitlab' ? GITLAB_COM : await askSelfHostedHost();
  return host ? addGitlabAccount(deps, host) : undefined;
}

/** Signs a GitLab account in again (expired or revoked tokens). Failures are shown, never thrown. */
export async function reauthenticate(deps: PickerDeps, accountId: string): Promise<void> {
  const account = deps.accounts.get(accountId);
  if (!account || account.provider !== 'gitlab' || account.authMethod !== 'oauth') { return; }
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
    buildPickItems(deps.accounts.list(), { suggestedId, currentId, defaultId: deps.bindings.defaultId() }),
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

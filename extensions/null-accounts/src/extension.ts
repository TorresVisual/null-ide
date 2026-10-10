'use strict';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { AccountStore } from './accountStore';
import { AvatarCache, fetchAvatarImage, fetchAvatarJson } from './avatars';
import { findAccount, importExisting } from './accountSetup';
import { createApi, NullAccountsApi } from './api';
import { ChangeEmitter } from './changeEmitter';
import { applyDefaultAccount } from './defaultAccount';
import { originUrl, runGit } from './git';
import { CredentialSync } from './gitCredentials';
import { describeSkip, GitWiring } from './gitWiring';
import { uploadPublicKey } from './keyUpload';
import { folderKey, ProjectBinding } from './projectBinding';
import { serial } from './serial';
import { fetchGithub, GithubProvider } from './providers/github';
import { fetchGitlab, fetchPostForm, GitlabProvider, resolveClientId } from './providers/gitlab';
import { checkSsh } from './sshCheck';
import { syncSshConfig } from './sshConfig';
import { canSign, deleteManagedKey, generateKey, readPublicKey } from './sshKeyOps';
import { KeyActions } from './ui/keyActions';
import { keyUi } from './ui/keyUi';
import { addAccount, chooseAccountForFolder, PickerDeps, reauthenticate } from './ui/accountPicker';
import { bindFolderToAccount } from './ui/accountsMenuActions';
import { registerAccountsMenu } from './ui/accountsMenuController';
import { ADD_ACCOUNT_COMMAND, BIND_COMMAND } from './ui/accountsMenuModel';
import { AccountsPanel } from './ui/accountsPanel';
import { registerStatusBar, SWITCH_COMMAND } from './ui/statusBarController';
import { NewAccount } from './types';

const IMPORT_OFFERED_KEY = 'null-accounts.importOffered';
// ponytail: GitLab tokens last ~2 h and nothing else wakes the extension for a terminal-only session, so poll;
// the OS-store token can lag a rotation by up to this long. Schedule from the token's expiry if that proves too coarse.
const GIT_SYNC_INTERVAL_MS = 5 * 60_000;

export function activate(context: vscode.ExtensionContext): NullAccountsApi {
  const store = new AccountStore(context.globalState, context.secrets);
  const bindings = new ProjectBinding(context.globalState);
  const github = new GithubProvider({
    getSession: (scopes, options) => vscode.authentication.getSession('github', scopes, options),
    api: fetchGithub,
  });
  const gitlab = new GitlabProvider({
    post: fetchPostForm,
    get: fetchGitlab,
    secrets: { get: id => store.getSecret(id), set: (id, value) => store.setSecret(id, value) },
    clientIdFor: host => {
      const cfg = vscode.workspace.getConfiguration('null-accounts.gitlab');
      return resolveClientId(host, cfg.get('clientId'), cfg.get('hostClientIds'));
    },
    now: Date.now,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    onNeedsReauth: account => {
      void vscode.window
        .showWarningMessage(`Your GitLab sign-in for ${account.username}@${account.host} has expired.`, 'Re-authenticate')
        .then(choice => { if (choice) { return reauthenticate(pickerDeps, account.id); } });
    },
    promptReauth: account => reauthenticate(pickerDeps, account.id),
  });

  // One event for "something changed" (accounts or bindings); the API and, later, the UI listen to it.
  const changed = new ChangeEmitter();
  context.subscriptions.push(
    store.onDidChange(() => {
      void bindings.prune(new Set(store.list().map(a => a.id)));
      changed.fire();
    }),
    bindings.onDidChange(() => changed.fire()),
    gitlab.onDidChange(() => changed.fire()),
  );

  const avatars = new AvatarCache({
    meta: context.globalState,
    accounts: () => store.list(),
    getJson: fetchAvatarJson,
    getImage: fetchAvatarImage,
  });
  context.subscriptions.push(
    store.onDidChange(() => { void avatars.refresh(); }),
    avatars.onDidChange(() => changed.fire()),
  );
  void avatars.refresh();

  const home = os.homedir();
  // `api` is created below; the actions only call it later, from a button.
  const keys = new KeyActions({
    accounts: store,
    getToken: (account, scopes, options) => api.getToken(account, scopes, options),
    ui: keyUi,
    home,
    hostname: os.hostname(),
    now: () => new Date(),
    exists: fs.existsSync,
    generate: input => generateKey({ home, ...input }),
    readPublicKey,
    canSign: file => canSign(file),
    deleteManagedKey: file => deleteManagedKey(file, home),
    upload: uploadPublicKey,
    checkSsh: (host, file) => checkSsh(host, file),
  });
  const pickerDeps: PickerDeps = { accounts: store, bindings, github, gitlab, keys };

  const api = createApi({
    accounts: store,
    accountIdForFolder: folder => bindings.accountIdFor(folder.fsPath),
    chooseAccountForFolder: folder => chooseAccountForFolder(pickerDeps, folder),
    tokenProviders: { github, gitlab },
    onDidChange: changed.event,
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('null-accounts.open', () =>
      AccountsPanel.createOrShow({
        accounts: store,
        bindings,
        keys,
        add: () => addAccount(pickerDeps),
        reauth: id => reauthenticate(pickerDeps, id),
        needsReauth: id => gitlab.needsReauth(id),
        onDidChange: changed.event,
        avatarOf: id => avatars.get(id),
        extensionUri: context.extensionUri,
      })),
    vscode.commands.registerCommand(SWITCH_COMMAND, async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showInformationMessage('Open a folder to choose its account.');
        return;
      }
      await chooseAccountForFolder(pickerDeps, folder.uri);
    }),
    vscode.commands.registerCommand(BIND_COMMAND, async (accountId: unknown) => {
      const result = await bindFolderToAccount(
        { folderPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, accounts: store, bindings },
        accountId,
      );
      if (result === 'no-folder') { void vscode.window.showInformationMessage('Open a folder to choose its account.'); }
      if (result === 'no-account') { void vscode.window.showInformationMessage('That account no longer exists.'); }
    }),
    vscode.commands.registerCommand(ADD_ACCOUNT_COMMAND, async () => { await addAccount(pickerDeps); }),
    registerStatusBar(api),
    registerAccountsMenu(api, id => avatars.get(id)),
  );

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    // Integration specs cannot sign in to a provider, so they add and remove accounts through these two commands.
    // Not contributed in package.json and registered only when an extensionTestsPath run hosts the extension:
    // they would otherwise be a prompt-free way to add or delete accounts.
    context.subscriptions.push(
      vscode.commands.registerCommand('null-accounts.test.addAccount', (account: NewAccount, secret?: string) => store.add(account, secret)),
      vscode.commands.registerCommand('null-accounts.test.removeAccount', (id: string) => store.remove(id)),
    );
  }

  registerDefaultAccount(context, store, bindings);
  registerGitSync(context, store, bindings, changed, api);

  void offerImport(context, store, bindings, github).catch(() => { /* a failed offer must never break activation */ });
  return api;
}

/** Binds each open folder that has never had an account to the default one (see defaultAccount.ts). */
function registerDefaultAccount(context: vscode.ExtensionContext, store: AccountStore, bindings: ProjectBinding): void {
  const queue = serial();
  const apply = (): void => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    void queue(() => applyDefaultAccount({ bindings, accounts: store, originUrl }, folders)).catch(() => { /* a missing default must never break the extension */ });
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(apply),
    bindings.onDidChange(apply), // the default was set or changed
  );
  apply();
}

/** Keeps repo-local git config and the OS credential store in line with the bindings (see gitWiring.ts, gitCredentials.ts). */
function registerGitSync(
  context: vscode.ExtensionContext,
  store: AccountStore,
  bindings: ProjectBinding,
  changed: ChangeEmitter,
  api: NullAccountsApi,
): void {
  const wiring = new GitWiring({
    meta: context.globalState, git: runGit, bindings, accounts: store, exists: fs.existsSync, home: os.homedir(),
  });
  const credentials = new CredentialSync({
    meta: context.globalState, git: runGit, bindings, accounts: store, token: account => api.getToken(account), cwd: os.tmpdir(),
  });
  const warned = new Set<string>();

  const syncGit = async (): Promise<void> => {
    await syncSshConfig(store.list(), os.homedir()).catch(() => { /* ~/.ssh may be read-only; repo-local sshCommand still works */ });
    const outcomes = await wiring.reconcile();
    await credentials.sync();
    const open = new Map((vscode.workspace.workspaceFolders ?? []).map(f => [folderKey(f.uri.fsPath), f.name]));
    for (const outcome of outcomes) {
      const name = open.get(outcome.folder);
      if (outcome.status !== 'skipped' || name === undefined) { continue; } // only folders the user is looking at
      const message = describeSkip(outcome, name);
      const once = `${outcome.folder}|${outcome.reason}|${outcome.detail ?? ''}`;
      if (message && !warned.has(once)) {
        warned.add(once);
        void vscode.window.showWarningMessage(`Null Accounts: ${message}`);
      }
    }
  };
  const trigger = (): void => { void syncGit().catch(() => { /* git wiring must never break the extension */ }); };

  const timer = setInterval(trigger, GIT_SYNC_INTERVAL_MS);
  context.subscriptions.push(
    changed.event(trigger), // accounts, bindings and re-auth state
    store.onDidChangeSecret(trigger), // a refreshed or replaced token
    { dispose: () => clearInterval(timer) },
  );
  trigger();
}

/** Once: offer to keep an already-signed-in GitHub account instead of silently logging existing users out. */
async function offerImport(
  context: vscode.ExtensionContext,
  store: AccountStore,
  bindings: ProjectBinding,
  github: GithubProvider,
): Promise<void> {
  if (context.globalState.get<boolean>(IMPORT_OFFERED_KEY)) { return; }
  const found = await github.existing().catch(() => undefined);
  if (!found) { return; } // not signed in, or offline: look again next start
  await context.globalState.update(IMPORT_OFFERED_KEY, true);
  if (findAccount(store.list(), found)) { return; }
  const choice = await vscode.window.showInformationMessage(
    `Null IDE now manages GitHub accounts. Import the account you're signed in with (${found.username})?`,
    'Import',
    'Not now',
  );
  if (choice !== 'Import') { return; }
  const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
  await importExisting(found, folders, store, bindings);
}

export function deactivate(): void {}

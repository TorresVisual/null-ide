'use strict';

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { validateNewAccount } from '../accountInput';
import { AccountStore } from '../accountStore';
import { runGit } from '../git';
import { applyGlobalIdentity } from '../globalIdentity';
import { ProjectBinding } from '../projectBinding';
import { fingerprintOf } from '../sshKeyOps';
import { Account } from '../types';
import { buildHtml } from './accountsHtml';
import { buildRows, removeConfirmation, ResolveFolder } from './accountsView';
import { KeyActions } from './keyActions';
import { describeKeys } from './keyInfo';
import { parsePanelMessage } from './panelMessages';

export interface PanelDeps {
  accounts: AccountStore;
  bindings: ProjectBinding;
  /** Pick a provider, sign in and store the account (ui/accountPicker `addAccount`). */
  add(): Promise<Account | undefined>;
  /** Sign a GitLab account in again (ui/accountPicker `reauthenticate`). */
  reauth(id: string): Promise<void>;
  /** The account's sign-in has expired (GitlabProvider.needsReauth). */
  needsReauth(id: string): boolean;
  /** Fires when accounts, bindings or re-auth state change. */
  onDidChange: vscode.Event<void>;
  /** The SSH key buttons (ui/keyActions). */
  keys: KeyActions;
}

/** Real-cased path when the folder exists (binding keys are lower-cased on Windows). */
const resolveFolder: ResolveFolder = key => {
  try { return { path: fs.realpathSync.native(key), exists: true }; } catch { return { path: key, exists: false }; }
};

/** The Accounts tab in the main editor area. One at a time; state is re-posted on every change. */
export class AccountsPanel {
  private static current: AccountsPanel | undefined;
  private seq = 0;

  static createOrShow(deps: PanelDeps): void {
    if (AccountsPanel.current) {
      AccountsPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'null-accounts.panel',
      'Null Accounts',
      vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [] },
    );
    AccountsPanel.current = new AccountsPanel(panel, deps);
  }

  private constructor(private readonly panel: vscode.WebviewPanel, private readonly deps: PanelDeps) {
    panel.webview.html = buildHtml(randomBytes(16).toString('hex'));
    const changes = deps.onDidChange(() => void this.postState());
    panel.webview.onDidReceiveMessage(raw => void this.handle(raw));
    panel.onDidDispose(() => {
      changes.dispose();
      AccountsPanel.current = undefined;
    });
  }

  private async postState(): Promise<void> {
    const turn = ++this.seq;
    const accounts = this.deps.accounts.list();
    const keys = await describeKeys(accounts, { home: os.homedir(), exists: fs.existsSync, fingerprintOf: file => fingerprintOf(file) });
    if (turn !== this.seq) { return; } // a newer state is already on its way
    const rows = buildRows(accounts, this.deps.bindings.entries(), resolveFolder, id => this.deps.needsReauth(id), keys);
    void this.panel.webview.postMessage({ type: 'state', rows });
  }

  private async handle(raw: unknown): Promise<void> {
    const msg = parsePanelMessage(raw);
    if (!msg) { return; }
    try {
      switch (msg.type) {
        case 'ready': await this.postState(); break;
        case 'add': await this.deps.add(); break; // the store's change event refreshes the list
        case 'reauth': await this.deps.reauth(msg.id); break;
        case 'unbind': await this.deps.bindings.unbind(msg.key); break;
        case 'remove': await this.remove(msg.id); break;
        case 'editEmail': await this.editEmail(msg.id); break;
        case 'setGlobalIdentity': await this.setGlobalIdentity(msg.id); break;
        case 'generateKey': await this.deps.keys.generate(msg.id); break;
        case 'attachKey': await this.deps.keys.attach(msg.id); break;
        case 'copyPublicKey': await this.deps.keys.copyPublic(msg.id); break;
        case 'uploadKey': await this.deps.keys.upload(msg.id); break;
        case 'testKey': await this.deps.keys.test(msg.id); break;
        case 'setSigning': await this.deps.keys.setSigning(msg.id, msg.on); break;
        case 'removeKey': await this.deps.keys.removeKey(msg.id); break;
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`Null Accounts: ${(err as Error).message}`);
    }
  }

  private async remove(id: string): Promise<void> {
    const account = this.deps.accounts.get(id);
    if (!account) { return; }
    const used = this.deps.bindings.entries().filter(([, accountId]) => accountId === id).length;
    const { message, detail } = removeConfirmation(account, used);
    if (await vscode.window.showWarningMessage(message, { modal: true, detail }, 'Remove') !== 'Remove') { return; }
    await this.deps.accounts.remove(id); // extension.ts prunes the now-dangling bindings
  }

  private async setGlobalIdentity(id: string): Promise<void> {
    const account = this.deps.accounts.get(id);
    if (!account) { return; }
    void vscode.window.showInformationMessage(`Null Accounts: ${await applyGlobalIdentity(runGit, account, os.tmpdir())}`);
  }

  private async editEmail(id: string): Promise<void> {
    const account = this.deps.accounts.get(id);
    if (!account) { return; }
    const email = await vscode.window.showInputBox({
      title: `Email for ${account.username}`,
      prompt: 'Email address for this account',
      value: account.email,
      validateInput: value => {
        try { validateNewAccount({ ...account, email: value }); return undefined; } catch (err) { return (err as Error).message; }
      },
    });
    if (email === undefined || email.trim() === account.email) { return; }
    await this.deps.accounts.update(id, { email });
  }
}

'use strict';

import * as vscode from 'vscode';
import { DiscordPresenceManager } from './discordPresence';

export function registerDiscordPresenceFeature(context: vscode.ExtensionContext): void {
  // globalStorage is shared by every window of this installation, which is how
  // sibling windows agree on who owns the presence.
  const manager = new DiscordPresenceManager(context.globalStorageUri?.fsPath);
  manager.start();

  context.subscriptions.push(manager);

  context.subscriptions.push(
    vscode.commands.registerCommand('null.discord.testConnection', () => manager.testConnection()),
    vscode.window.onDidChangeActiveTextEditor(() => manager.notifyActivity()),
    vscode.window.onDidChangeTextEditorSelection(() => manager.notifyActivity()),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (vscode.window.activeTextEditor?.document === e.document) {
        manager.notifyActivity();
      }
    }),
    vscode.workspace.onDidOpenTextDocument(() => manager.notifyActivity()),
    vscode.workspace.onDidCloseTextDocument(() => manager.notifyActivity()),
    vscode.debug.onDidChangeActiveDebugSession(() => manager.notifyActivity()),
    // Focusing a window makes it the presence owner, and counts as activity so
    // alt-tabbing back from a long break clears the "Idle" state immediately.
    vscode.window.onDidChangeWindowState(state => {
      if (state.focused) {
        manager.notifyFocus();
      }
    }),
    // A different folder means a different repository button and label.
    vscode.workspace.onDidChangeWorkspaceFolders(() => manager.notifyWorkspaceChange()),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('null.discord')) {
        manager.notifyConfigChange();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('null.toggleDiscordPresence', async () => {
      const cfg = vscode.workspace.getConfiguration('null.discord');
      const enabled = cfg.get<boolean>('enabled', true);
      await cfg.update('enabled', !enabled, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(
        `Null: Discord Rich Presence ${enabled ? 'disabled' : 'enabled'}`,
        2500,
      );
    }),
  );
}

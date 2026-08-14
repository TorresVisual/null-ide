'use strict';

import * as vscode from 'vscode';
import { DiscordPresenceManager } from './discordPresence';

export function registerDiscordPresenceFeature(context: vscode.ExtensionContext): void {
  const manager = new DiscordPresenceManager();
  manager.start();

  context.subscriptions.push(manager);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => manager.notifyActivity()),
    vscode.window.onDidChangeTextEditorSelection(() => manager.notifyActivity()),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (vscode.window.activeTextEditor?.document === e.document) {
        manager.notifyActivity();
      }
    }),
    vscode.workspace.onDidOpenTextDocument(() => manager.notifyActivity()),
    vscode.workspace.onDidCloseTextDocument(() => manager.notifyActivity()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => manager.notifyActivity()),
    vscode.debug.onDidChangeActiveDebugSession(() => manager.notifyActivity()),
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

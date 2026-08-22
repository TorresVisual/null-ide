'use strict';

import * as vscode from 'vscode';
import { readButtonConfigs } from './buttonConfigIntegration';
import { VscodeTerminalHost } from './terminalHostIntegration';
import { TerminalRegistry } from './terminalRegistry';
import { StatusBarController } from './statusBarController';
import { runButton } from './runButton';
import { ActionButtonsPanel } from './settingsPanel';

export function activate(context: vscode.ExtensionContext): void {
  const terminalRegistry = new TerminalRegistry(new VscodeTerminalHost());
  const statusBar = new StatusBarController();

  context.subscriptions.push(statusBar);

  // Slightly above the default button priority (0) so this renders just
  // ahead of the user's own buttons -- not pushed to the front of the
  // whole status bar, just leftmost among null-actions' own items.
  const openSettingsItem = vscode.window.createStatusBarItem(
    'null-actions.openSettings',
    vscode.StatusBarAlignment.Left,
    1,
  );
  openSettingsItem.text = '$(gear)';
  openSettingsItem.tooltip = 'Open Action Buttons Settings';
  openSettingsItem.command = 'null-actions.openSettings';
  openSettingsItem.show();
  context.subscriptions.push(openSettingsItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('null-actions.openSettings', () => {
      ActionButtonsPanel.createOrShow(context.extensionUri);
    }),
  );

  function refresh(): void {
    const { buttons } = readButtonConfigs();
    statusBar.update(buttons);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('null-actions.runButton', async (buttonId: string) => {
      const { buttons } = readButtonConfigs();
      const button = buttons.find(b => b.id === buttonId);
      if (!button) { return; }
      await runButton(button, terminalRegistry);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('null-actions')) {
        refresh();
        ActionButtonsPanel.refreshIfOpen();
      }
    }),
  );

  refresh();
}

export function deactivate(): void {}

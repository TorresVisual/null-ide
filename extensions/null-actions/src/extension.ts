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

  context.subscriptions.push(statusBar, terminalRegistry.onDidChangeState((id, state) => statusBar.setState(id, state)));

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

  let knownIds = new Set<string>();
  let lastErrors = '';

  function refresh(): void {
    const { buttons, errors } = readButtonConfigs();
    statusBar.update(buttons);

    const ids = new Set(buttons.map(b => b.id));
    knownIds.forEach(id => { if (!ids.has(id)) { terminalRegistry.forget(id); } });
    knownIds = ids;

    // One warning per distinct problem set, not one per settings change.
    const summary = errors.join('\n');
    if (summary !== lastErrors) {
      lastErrors = summary;
      if (summary) {
        const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : '';
        void vscode.window.showWarningMessage(`Some Null Actions buttons are ignored: ${errors[0]}${more}`, 'Open Settings')
          .then(pick => { if (pick) { void vscode.commands.executeCommand('null-actions.openSettings'); } });
      }
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('null-actions.runButton', async (buttonId: string) => {
      const { buttons } = readButtonConfigs();
      const button = buttons.find(b => b.id === buttonId);
      if (!button) { return; }
      if (statusBar.showsFailure(button.id)) {
        terminalRegistry.show(button.id);
        return;
      }
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

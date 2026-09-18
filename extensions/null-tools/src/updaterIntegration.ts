'use strict';

import * as vscode from 'vscode';
import { AvailableUpdate, checkForUpdate, installUpdate, promptForUpdate } from './updater';

export function registerUpdaterFeature(context: vscode.ExtensionContext): void {
  const updateBar = vscode.window.createStatusBarItem('null.update', vscode.StatusBarAlignment.Right, 1);
  updateBar.text = '$(cloud-download) Update'; updateBar.tooltip = 'Null IDE update available';
  updateBar.command = 'null.installUpdate';
  context.subscriptions.push(updateBar);

  function refreshUpdateButton(): void {
    const update = context.globalState.get<AvailableUpdate>('null.availableUpdate');
    if (update?.latest) {
      updateBar.text    = `$(cloud-download) ${update.latest}`;
      updateBar.tooltip = `Install Null IDE ${update.latest}`;
      updateBar.show();
    } else {
      updateBar.hide();
    }
  }

  context.subscriptions.push(vscode.commands.registerCommand('null.checkForUpdates', async () => {
    try {
      const update = await checkForUpdate(context, false);
      refreshUpdateButton();
      if (update) await promptForUpdate(update);
    } catch (err) {
      vscode.window.showErrorMessage(`Null: update check failed - ${(err as Error).message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.installUpdate', async () => {
    try { await installUpdate(context); }
    catch (err) { vscode.window.showErrorMessage(`Null: update failed - ${(err as Error).message}`); }
  }));

  refreshUpdateButton();
  checkForUpdate(context, true)
    .then(update => { refreshUpdateButton(); if (update) return promptForUpdate(update); })
    .catch(() => { /* startup check — stay silent when offline */ });
}

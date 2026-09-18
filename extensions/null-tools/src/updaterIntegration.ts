'use strict';

import * as vscode from 'vscode';
import { AvailableUpdate, StagedUpdate, checkForUpdate, installUpdate, onStagedUpdateChanged, promptForUpdate } from './updater';

export function registerUpdaterFeature(context: vscode.ExtensionContext): void {
  const updateBar = vscode.window.createStatusBarItem('null.update', vscode.StatusBarAlignment.Right, 1);
  updateBar.command = 'null.installUpdate';
  context.subscriptions.push(updateBar);

  function refreshUpdateButton(): void {
    const update = context.globalState.get<AvailableUpdate>('null.availableUpdate');
    if (!update?.latest) {
      updateBar.hide();
      return;
    }

    const staged = context.globalState.get<StagedUpdate>('null.stagedUpdate');
    const isReady = staged?.version === update.latest && staged.verified;

    if (isReady) {
      updateBar.text    = `$(rocket) Restart to update`;
      updateBar.tooltip  = `Null IDE ${update.latest} is downloaded and ready to install`;
    } else {
      updateBar.text    = `$(cloud-download) ${update.latest}`;
      updateBar.tooltip  = `Downloading Null IDE ${update.latest}…`;
    }
    updateBar.show();
  }

  context.subscriptions.push(onStagedUpdateChanged.event(() => refreshUpdateButton()));

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

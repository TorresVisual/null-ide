'use strict';

import * as vscode from 'vscode';
import { StagedUpdate, acknowledgeUpdate, checkForUpdate, getAvailableUpdate, getUpdateProgress, installUpdate, onStagedUpdateChanged, promptForUpdate } from './updater';
import { canSelfUpdate, releasePageStatus, statusFor } from './updateStatus';

export function registerUpdaterFeature(context: vscode.ExtensionContext): void {
  acknowledgeUpdate(context);

  const updateBar = vscode.window.createStatusBarItem('null.update', vscode.StatusBarAlignment.Right, 1);
  updateBar.command = 'null.installUpdate';
  context.subscriptions.push(updateBar);

  function refreshUpdateButton(): void {
    const update = getAvailableUpdate(context);
    if (!update?.latest) {
      updateBar.hide();
      return;
    }

    const staged = context.globalState.get<StagedUpdate>('null.stagedUpdate');
    const isReady = staged?.version === update.latest && staged.verified;

    const view = canSelfUpdate(process.platform)
      ? statusFor(update.latest, getUpdateProgress(), isReady)
      : releasePageStatus(update.latest);
    updateBar.text = view.text;
    updateBar.tooltip = view.tooltip;
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
  if (vscode.workspace.getConfiguration('null').get<boolean>('updates.check', true)) {
    checkForUpdate(context, true)
      .then(update => { refreshUpdateButton(); if (update) return promptForUpdate(update); })
      .catch(() => { /* startup check — stay silent when offline */ });
  }
}

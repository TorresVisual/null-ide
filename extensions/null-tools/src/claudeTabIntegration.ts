'use strict';

import * as vscode from 'vscode';

const FOCUS_GROUP_COMMANDS = [
  'workbench.action.focusFirstEditorGroup',
  'workbench.action.focusSecondEditorGroup',
  'workbench.action.focusThirdEditorGroup',
  'workbench.action.focusFourthEditorGroup',
  'workbench.action.focusFifthEditorGroup',
  'workbench.action.focusSixthEditorGroup',
  'workbench.action.focusSeventhEditorGroup',
  'workbench.action.focusEighthEditorGroup',
];

interface ClaudeTab {
  label: string;
  viewColumn: vscode.ViewColumn;
  index: number;
}

export function registerClaudeTabFeature(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('null.focusClaudeTab', async () => {
    const claudeTabs: ClaudeTab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      group.tabs.forEach((tab, index) => {
        if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType === 'claudeVSCodePanel') {
          claudeTabs.push({ label: tab.label, viewColumn: group.viewColumn, index });
        }
      });
    }
    if (!claudeTabs.length) {
      vscode.window.showInformationMessage('No open Claude Code tabs.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      claudeTabs.map(tab => ({ label: tab.label, tab })),
      { placeHolder: 'Go to open Claude chat…' },
    );
    if (!pick) return;
    const focusCommand = FOCUS_GROUP_COMMANDS[pick.tab.viewColumn - 1];
    if (focusCommand) await vscode.commands.executeCommand(focusCommand);
    await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', pick.tab.index);
  }));
}

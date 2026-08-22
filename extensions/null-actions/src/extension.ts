'use strict';

import * as vscode from 'vscode';
import { readButtonConfigs } from './buttonConfigIntegration';
import { VscodeTerminalHost } from './terminalHostIntegration';
import { TerminalRegistry } from './terminalRegistry';
import { StatusBarController } from './statusBarController';
import { evaluateWhenClause, WhenClauseContext } from './whenClause';
import { runButton } from './runButton';
import { ActionButtonsPanel } from './settingsPanel';
import { parseNpmScripts, toActionButtonConfig } from './npmScriptsProvider';
import { ActionButtonConfig } from './buttonConfig';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext): void {
  const terminalRegistry = new TerminalRegistry(new VscodeTerminalHost());
  const statusBar = new StatusBarController();

  context.subscriptions.push(statusBar);

  // Highest possible priority so this always renders leftmost among
  // null-actions' own status bar items, regardless of what priority the
  // user's own buttons use.
  const openSettingsItem = vscode.window.createStatusBarItem(
    'null-actions.openSettings',
    vscode.StatusBarAlignment.Left,
    Number.MAX_SAFE_INTEGER,
  );
  openSettingsItem.text = '$(gear) Actions';
  openSettingsItem.tooltip = 'Open Action Buttons Settings';
  openSettingsItem.command = 'null-actions.openSettings';
  openSettingsItem.show();
  context.subscriptions.push(openSettingsItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('null-actions.openSettings', () => {
      ActionButtonsPanel.createOrShow();
    }),
  );

  function loadNpmButtons(): ActionButtonConfig[] {
    const auto = vscode.workspace.getConfiguration().get<boolean>('null-actions.npm.autoLoad', false);
    if (!auto) { return []; }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { return []; }
    const pkgPath = path.join(folder.uri.fsPath, 'package.json');
    if (!fs.existsSync(pkgPath)) { return []; }
    let content: string;
    try {
      content = fs.readFileSync(pkgPath, 'utf8');
    } catch {
      return [];
    }
    return parseNpmScripts(content).map((s, i) => toActionButtonConfig(s, -i));
  }

  function refresh(): void {
    const { buttons } = readButtonConfigs();
    const npmButtons = loadNpmButtons();
    const folder = vscode.workspace.workspaceFolders?.[0];
    const ctx: WhenClauseContext = {
      activeLanguageId: vscode.window.activeTextEditor?.document.languageId,
      folderName: folder?.name,
      folderPath: folder?.uri.fsPath,
    };
    const visible = [...buttons, ...npmButtons].filter(b => evaluateWhenClause(b.when, ctx));
    statusBar.update(visible);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('null-actions.runButton', async (buttonId: string) => {
      const { buttons } = readButtonConfigs();
      const npmButtons = loadNpmButtons();
      const button = [...buttons, ...npmButtons].find(b => b.id === buttonId);
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
    vscode.window.onDidChangeActiveTextEditor(() => refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => refresh()),
  );

  refresh();
}

export function deactivate(): void {}

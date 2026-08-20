'use strict';

import * as vscode from 'vscode';
import { readButtonConfigs } from './buttonConfigIntegration';
import { VscodeTerminalHost } from './terminalHostIntegration';
import { TerminalRegistry } from './terminalRegistry';
import { StatusBarController } from './statusBarController';
import { evaluateWhenClause, WhenClauseContext } from './whenClause';
import { runButton } from './runButton';
import { ActionButtonsViewProvider } from './settingsPanel';
import { parseNpmScripts, toActionButtonConfig } from './npmScriptsProvider';
import { ActionButtonConfig } from './buttonConfig';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext): void {
  const terminalRegistry = new TerminalRegistry(new VscodeTerminalHost());
  const statusBar = new StatusBarController();
  const settingsProvider = new ActionButtonsViewProvider();

  context.subscriptions.push(statusBar);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('null-actions.buttonsView', settingsProvider),
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
        settingsProvider.refresh();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => refresh()),
  );

  refresh();
}

export function deactivate(): void {}

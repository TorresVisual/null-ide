'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { resolveNullNotesExePath } from './nullNotesPath';

export function registerOpenInNullNotesFeature(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('null.openInNullNotes', async (resource?: vscode.Uri) => {
    const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri || path.extname(uri.fsPath).toLowerCase() !== '.md') {
      vscode.window.showWarningMessage('Null IDE: open or select a Markdown file first.');
      return;
    }

    const config  = vscode.workspace.getConfiguration('null');
    const exePath = resolveNullNotesExePath(config.get<string>('nullNotes.exePath', ''), process.env.LOCALAPPDATA ?? '');
    if (!fs.existsSync(exePath)) {
      vscode.window.showErrorMessage(`Null IDE: null-notes.exe not found at "${exePath}". Set null.nullNotes.exePath in settings.`);
      return;
    }

    const workspaceRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? path.dirname(uri.fsPath);
    const child = spawn(exePath, [`--workspace=${workspaceRoot}`, `--select-file=${uri.fsPath}`], { detached: true, stdio: 'ignore' });
    child.unref();
  }));
}

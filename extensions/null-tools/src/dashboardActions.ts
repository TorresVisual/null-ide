'use strict';

import type * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

export function createProjectDirectory(target: string): { ok: true } | { ok: false; message: string } {
  try {
    fs.mkdirSync(target);
    execFileSync('git', ['init'], { cwd: target, timeout: 5000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function runNewProjectFlow(): Promise<void> {
  // Lazy require: keeps this module loadable under plain `node --test` (no
  // `vscode` module outside the Extension Host) so createProjectDirectory
  // stays covered by real unit tests.
  const vscode: typeof import('vscode') = require('vscode');
  const parent = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Choose Parent Folder',
  });
  if (!parent || parent.length === 0) return;

  const name = await vscode.window.showInputBox({
    prompt: 'Project name',
    validateInput: value => (value.trim().length === 0 ? 'Enter a project name.' : undefined),
  });
  if (!name) return;

  const target = path.join(parent[0].fsPath, name.trim());
  const result = createProjectDirectory(target);
  if (!result.ok) {
    vscode.window.showErrorMessage(`Null: failed to create project — ${result.message}`);
    return;
  }
  vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target));
}

let cloneTerminal: vscode.Terminal | undefined;

function getCloneTerminal(vscode: typeof import('vscode')): vscode.Terminal {
  if (!cloneTerminal || cloneTerminal.exitStatus !== undefined) {
    cloneTerminal = vscode.window.createTerminal({ name: 'Null: Clone Repo' });
  }
  return cloneTerminal;
}

export async function runCloneRepoFlow(context: vscode.ExtensionContext): Promise<void> {
  const vscode: typeof import('vscode') = require('vscode');
  const url = await vscode.window.showInputBox({
    prompt: 'Repository URL to clone',
    validateInput: value => (value.trim().length === 0 ? 'Enter a repository URL.' : undefined),
  });
  if (!url) return;

  const parent = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Choose Parent Folder',
  });
  if (!parent || parent.length === 0) return;

  const trimmedUrl = url.trim();
  const folderName = path.basename(trimmedUrl, '.git');
  const target = vscode.Uri.file(path.join(parent[0].fsPath, folderName));

  const terminal = getCloneTerminal(vscode);
  terminal.show();

  // Auto-opens the cloned folder once the clone command exits 0, via the
  // Shell Integration API (stable since VS Code 1.93; this repo targets
  // VSCodium 1.135.06055, well past that). If the user's shell doesn't
  // report shell-integration exit codes (an unusual shell, or the setting
  // disabled), this listener simply never fires -- the clone still
  // completes and the terminal shows the result, the user just needs to
  // click Open Folder afterwards. Accepted degradation, not a bug.
  const subscription = vscode.window.onDidEndTerminalShellExecution(event => {
    if (event.terminal !== terminal) return;
    subscription.dispose();
    if (event.exitCode === 0) {
      vscode.commands.executeCommand('vscode.openFolder', target);
    }
  });
  context.subscriptions.push(subscription);

  terminal.sendText(`git clone "${trimmedUrl}" "${target.fsPath}"`);
}

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

  if (terminal.shellIntegration) {
    // Args passed out-of-band (not interpolated into a shell string), so a
    // clone URL containing shell metacharacters (", $(...), backticks, etc.)
    // can't break out and execute arbitrary commands.
    const execution = terminal.shellIntegration.executeCommand('git', ['clone', trimmedUrl, target.fsPath]);
    const subscription = vscode.window.onDidEndTerminalShellExecution(event => {
      if (event.execution !== execution) return;
      subscription.dispose();
      if (event.exitCode === 0) {
        vscode.commands.executeCommand('vscode.openFolder', target);
      }
    });
    context.subscriptions.push(subscription);
  } else {
    // No Shell Integration active (unusual shell, or the setting disabled):
    // sendText goes straight to the shell as text, so there's no exit-code
    // signal and no out-of-band args -- the clone still runs, it just can't
    // auto-open the folder on completion. Accepted degradation per the
    // design spec, not a bug.
    // ponytail: single-quote escaping is safe for POSIX shells and
    // PowerShell (both treat '...' as fully literal) but not cmd.exe, which
    // isn't VS Code's default integrated shell on Windows. Upgrade path if
    // that changes: detect terminal.shellPath and branch the escaping.
    const singleQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
    terminal.sendText(`git clone ${singleQuote(trimmedUrl)} ${singleQuote(target.fsPath)}`);
  }
}

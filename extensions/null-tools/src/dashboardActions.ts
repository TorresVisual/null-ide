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

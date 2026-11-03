import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { createRunStatusBar } from './statusBar';
import { shimFiles } from './shim';

// Returns the shim folder so the integration spec can check it; nothing else reads the return value.
export function activate(context: vscode.ExtensionContext): { shimDir: string } {
  const shimDir = path.join(context.globalStorageUri.fsPath, 'bin');
  fs.mkdirSync(shimDir, { recursive: true });
  const cliPath = path.join(context.extensionPath, 'out', 'cli.js');
  for (const [name, body] of Object.entries(shimFiles(process.execPath, cliPath))) {
    fs.writeFileSync(path.join(shimDir, name), body);
  }
  context.environmentVariableCollection.prepend('PATH', shimDir + path.delimiter);

  const output = vscode.window.createOutputChannel('Null Unreal');
  registerCommands(context, { cliPath, output, shimPath: path.join(shimDir, 'null-unreal.cmd') });
  context.subscriptions.push(output, createRunStatusBar());
  return { shimDir };
}

export function deactivate(): void {}

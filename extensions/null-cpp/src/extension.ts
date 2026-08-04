import * as vscode from 'vscode';
import { registerSwitchSourceHeader } from './symbolSwitch';
import { registerPairedSplit } from './pairedSplit';
import { registerNewClass } from './scaffold';
import { initializeProjectDetection } from './projectDetection';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const enabled = await initializeProjectDetection();
  await vscode.commands.executeCommand('setContext', 'null-cpp.isCppProject', enabled);

  registerSwitchSourceHeader(context);
  registerPairedSplit(context);
  registerNewClass(context);
}

export function deactivate(): void {}

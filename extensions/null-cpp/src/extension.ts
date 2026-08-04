import * as vscode from 'vscode';
import { registerSwitchSourceHeader } from './symbolSwitch';
import { registerPairedSplit } from './pairedSplit';
import { registerNewClass } from './scaffold';

export function activate(context: vscode.ExtensionContext): void {
  registerSwitchSourceHeader(context);
  registerPairedSplit(context);
  registerNewClass(context);
}

export function deactivate(): void {}

'use strict';

import * as vscode from 'vscode';
import { DashboardEditorProvider } from './dashboard';

export function openDashboard(): Thenable<unknown> {
  return vscode.commands.executeCommand('vscode.openWith', vscode.Uri.from({ scheme: 'null-dashboard', path: '/Dashboard' }), 'null.dashboard');
}

export function registerDashboardFeature(context: vscode.ExtensionContext): void {
  const provider = new DashboardEditorProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('null.dashboard', provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
  );
}

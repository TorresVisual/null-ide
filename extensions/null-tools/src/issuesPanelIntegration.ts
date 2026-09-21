'use strict';

import * as vscode from 'vscode';
import { IssuesStore } from './github/issuesStore';
import { IssuesViewProvider } from './issuesPanel';

export function registerIssuesPanelFeature(context: vscode.ExtensionContext): void {
  const store = new IssuesStore();
  const provider = new IssuesViewProvider(context.extensionUri, store);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('null.issuesView', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.refresh', () => provider.refresh()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.signIn', () => provider.signIn()),
  );
}

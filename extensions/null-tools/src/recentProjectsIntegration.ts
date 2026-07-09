'use strict';

import * as vscode from 'vscode';
import {
  RecentProjectEntry,
  getRecentProjectsFilePath,
  readRecentProjects,
} from './recentProjects';

export function registerRecentProjectsUriHandler(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.window.registerUriHandler({
    async handleUri(uri: vscode.Uri) {
      if (uri.path !== '/recent-projects') { return; }

      let entries: RecentProjectEntry[];
      try {
        entries = readRecentProjects(getRecentProjectsFilePath());
      } catch {
        entries = [];
      }
      if (!entries.length) {
        vscode.window.showInformationMessage('No recent projects tracked yet.');
        return;
      }

      const picked = await vscode.window.showQuickPick(
        entries.map(e => ({ label: e.label, description: e.path, entry: e })),
        { placeHolder: 'Select a recent project to open' },
      );
      if (!picked) { return; }

      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(picked.entry.path), { forceNewWindow: true });
    },
  }));
}

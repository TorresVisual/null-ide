'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import {
  RecentProjectEntry,
  getRecentProjectsFilePath,
  readRecentProjects,
  writeRecentProjectsAtomic,
  upsertEntry,
} from './recentProjects';

export function trackCurrentProject(): void {
  let root: { path: string; isWorkspaceFile: boolean } | undefined;

  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile && workspaceFile.scheme === 'file') {
    root = { path: workspaceFile.fsPath, isWorkspaceFile: true };
  } else {
    const folders = vscode.workspace.workspaceFolders;
    if (folders?.length) {
      root = { path: folders[0].uri.fsPath, isWorkspaceFile: false };
    }
  }
  if (!root) { return; }

  let label = path.basename(root.path);
  if (root.isWorkspaceFile && label.endsWith('.code-workspace')) {
    label = `${label.slice(0, -'.code-workspace'.length)} (Workspace)`;
  }

  try {
    const filePath = getRecentProjectsFilePath();
    const entries = readRecentProjects(filePath);
    const updated = upsertEntry(entries, { path: root.path, label, isWorkspaceFile: root.isWorkspaceFile });
    writeRecentProjectsAtomic(filePath, updated);
  } catch (err) {
    console.error('null-tools: failed to update recent projects list', err);
  }
}

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

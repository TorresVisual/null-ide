'use strict';

import * as vscode from 'vscode';
import {
  DEFAULT_ARTIFACT_PATTERNS,
  processWorkspaceAutoGitignore,
} from './autoGitignoreStorage';

export function registerAutoGitignoreFeature(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Null Auto-Gitignore');
  context.subscriptions.push(output);

  let debounceTimer: NodeJS.Timeout | undefined;

  const runScan = async (showNotification = false) => {
    const config = vscode.workspace.getConfiguration('null.gitignore');
    const enabled = config.get<boolean>('autoUpdate', true);
    if (!enabled) { return; }

    const autoCommit = config.get<boolean>('autoCommit', true);
    const userPatterns = config.get<string[]>('ignoredPatterns', []);
    const patterns = Array.from(new Set([...DEFAULT_ARTIFACT_PATTERNS, ...userPatterns]));

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return; }

    for (const folder of folders) {
      const result = await processWorkspaceAutoGitignore(folder.uri.fsPath, patterns, autoCommit, output);
      if (result.updated && showNotification) {
        const msg = result.committed
          ? `Null IDE: Added ${result.added.join(', ')} to .gitignore and auto-committed.`
          : `Null IDE: Added ${result.added.join(', ')} to .gitignore.`;
        vscode.window.showInformationMessage(msg);
      }
    }
  };

  const debouncedScan = () => {
    if (debounceTimer) { clearTimeout(debounceTimer); }
    debounceTimer = setTimeout(() => runScan(false), 2000);
  };

  // Initial scan on activation
  runScan(false);

  // File watcher for continuous checking when files/folders are created/deleted
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  watcher.onDidCreate(() => debouncedScan());
  watcher.onDidDelete(() => debouncedScan());

  context.subscriptions.push(
    watcher,
    vscode.workspace.onDidChangeWorkspaceFolders(() => runScan(false)),
    vscode.commands.registerCommand('null.autoGitignore', async () => {
      await runScan(true);
      vscode.window.showInformationMessage('Null Auto-Gitignore scan complete.');
    }),
  );
}

'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type FolderTreeLabelResolver = (filePath: string) => string;

export class FolderTreeProvider implements vscode.TreeDataProvider<string> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly folderPath: string | undefined,
    private readonly resolveLabel: FolderTreeLabelResolver,
  ) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  watch(): vscode.Disposable {
    const folderPath = this.folderPath;
    if (!folderPath) {
      return new vscode.Disposable(() => { /* no folder to watch */ });
    }
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folderPath, '*'),
    );
    watcher.onDidCreate(() => this.refresh());
    watcher.onDidDelete(() => this.refresh());
    watcher.onDidChange(() => this.refresh());
    return watcher;
  }

  getTreeItem(filePath: string): vscode.TreeItem {
    const item = new vscode.TreeItem(this.resolveLabel(filePath), vscode.TreeItemCollapsibleState.None);
    item.resourceUri = vscode.Uri.file(filePath);
    item.contextValue = 'nullFolderItem';
    item.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [vscode.Uri.file(filePath)],
    };
    return item;
  }

  getChildren(): string[] {
    const folderPath = this.folderPath;
    if (!folderPath || !fs.existsSync(folderPath)) { return []; }
    return fs.readdirSync(folderPath)
      .map(name => path.join(folderPath, name))
      .filter(p => fs.statSync(p).isFile())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  }
}

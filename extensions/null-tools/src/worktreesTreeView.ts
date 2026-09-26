'use strict';

import * as vscode from 'vscode';
import { WorktreeEntry, listWorktrees } from './worktrees';

export class WorktreeTreeProvider implements vscode.TreeDataProvider<WorktreeEntry> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _entries: WorktreeEntry[] = [];
  private _refreshing = false;

  constructor(private readonly _repoCwd: () => string | null) {
    void this.refresh();
  }

  get entries(): readonly WorktreeEntry[] {
    return this._entries;
  }

  async refresh(): Promise<void> {
    if (this._refreshing) return;
    this._refreshing = true;
    try {
      const cwd = this._repoCwd();
      this._entries = cwd ? await listWorktrees(cwd) : [];
    } catch {
      this._entries = [];
    } finally {
      this._refreshing = false;
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(entry: WorktreeEntry): vscode.TreeItem {
    const isClaudeSession = /[\\/]\.claude[\\/]worktrees[\\/]/.test(entry.path);
    const label = entry.branch ?? `(detached ${entry.head.slice(0, 7)})`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

    const aheadBehind = entry.ahead || entry.behind ? ` ↑${entry.ahead} ↓${entry.behind}` : '';
    item.description = `${entry.dirty ? '●' : ''}${aheadBehind}`.trim() || undefined;

    item.tooltip = new vscode.MarkdownString(
      `**${label}**\n\n${entry.path}\n\n` +
      `Head: \`${entry.head.slice(0, 7)}\`\n\n` +
      (entry.lastCommitSubject ? `Last commit: ${entry.lastCommitSubject} (${entry.lastCommitDate.slice(0, 10)})\n\n` : '') +
      `Ahead/behind base: ↑${entry.aheadBase} ↓${entry.behindBase}` +
      (entry.prunable ? '\n\n_Directory is missing — needs pruning._' : ''),
    );

    item.iconPath = new vscode.ThemeIcon(
      entry.prunable ? 'warning' : isClaudeSession ? 'hubot' : 'source-control',
      entry.isCurrent ? new vscode.ThemeColor('charts.blue') : undefined,
    );
    item.contextValue = 'worktreeEntry';
    item.id = `worktree-${entry.path}`;
    return item;
  }

  getChildren(): WorktreeEntry[] {
    return this._entries;
  }
}

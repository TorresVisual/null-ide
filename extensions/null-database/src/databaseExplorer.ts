'use strict';

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { SqliteSession, TableSummary } from './sqliteDriver';

// ─── Node items ──────────────────────────────────────────────────────────────

type NodeKind = 'connection' | 'database' | 'tables-folder' | 'views-folder' | 'table' | 'view' | 'column' | 'index' | 'empty' | 'databaseConnection';

export interface DbNode {
  kind: NodeKind;
  label: string;
  /** Context value used in package.json when clauses. */
  contextValue: NodeKind;
  iconId: string;
  description?: string;
  tooltip?: string;
  collapsible: vscode.TreeItemCollapsibleState;
  children?: DbNode[];
  // Connection / table identity
  filePath?: string;
  tableName?: string;
  columnName?: string;
}

// ─── Database Connection Registry ────────────────────────────────────────────

export class ConnectionRegistry {
  private static STORAGE_KEY = 'null.database.connections';

  constructor(private readonly state: vscode.Memento) {}

  public getAll(): string[] {
    return (this.state.get<string[]>(ConnectionRegistry.STORAGE_KEY) ?? []).filter(p => p !== '');
  }

  public add(filePath: string): void {
    const existing = this.getAll();
    if (!existing.includes(filePath)) {
      this.state.update(ConnectionRegistry.STORAGE_KEY, [...existing, filePath]);
    }
  }

  public remove(filePath: string): void {
    const existing = this.getAll();
    this.state.update(ConnectionRegistry.STORAGE_KEY, existing.filter(p => p !== filePath));
  }

  public clear(): void {
    this.state.update(ConnectionRegistry.STORAGE_KEY, []);
  }
}

// ─── Tree View Data Provider ──────────────────────────────────────────────────

export class DatabaseExplorerProvider implements vscode.TreeDataProvider<DbNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DbNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Active sessions keyed by absolute file path. */
  private sessions = new Map<string, SqliteSession>();

  constructor(private readonly registry: ConnectionRegistry) {}

  public refresh(node?: DbNode): void {
    // Close cached session for the changed path so we re-open fresh.
    if (node?.filePath) {
      const sess = this.sessions.get(node.filePath);
      if (sess) {
        try { sess.close(); } catch { /* ignore */ }
        this.sessions.delete(node.filePath);
      }
    }
    this._onDidChangeTreeData.fire(node);
  }

  public refreshAll(): void {
    for (const [, sess] of this.sessions) {
      try { sess.close(); } catch { /* ignore */ }
    }
    this.sessions.clear();
    this._onDidChangeTreeData.fire();
  }

  public disposeAll(): void {
    this.refreshAll();
    this._onDidChangeTreeData.dispose();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private openSession(filePath: string): SqliteSession {
    if (!this.sessions.has(filePath)) {
      this.sessions.set(filePath, new SqliteSession(filePath, true /* read-only */));
    }
    return this.sessions.get(filePath)!;
  }

  private buildTableNode(filePath: string, t: TableSummary): DbNode {
    const icon = t.type === 'view' ? 'eye' : 'list-flat';
    return {
      kind: t.type,
      label: t.name,
      contextValue: t.type,
      iconId: icon,
      description: `${t.rowCount} rows`,
      tooltip: t.sql ?? t.name,
      collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      filePath,
      tableName: t.name,
    };
  }

  private buildColumnsForTable(filePath: string, tableName: string): DbNode[] {
    try {
      const sess = this.openSession(filePath);
      const details = sess.getTableDetails(tableName);

      const columnNodes: DbNode[] = details.columns.map(col => {
        const pk = col.primaryKey ? ' 🔑' : '';
        const nullable = !col.notNull && !col.primaryKey ? '?' : '';
        return {
          kind: 'column' as NodeKind,
          label: col.name,
          contextValue: 'column' as NodeKind,
          iconId: 'symbol-field',
          description: `${col.type}${nullable}${pk}`,
          tooltip: `${col.name} ${col.type}${col.notNull ? ' NOT NULL' : ''}${col.primaryKey ? ' PRIMARY KEY' : ''}${col.defaultValue !== null && col.defaultValue !== undefined ? ` DEFAULT ${col.defaultValue}` : ''}`,
          collapsible: vscode.TreeItemCollapsibleState.None,
          filePath,
          tableName,
          columnName: col.name,
        };
      });

      const indexNodes: DbNode[] = details.indexes.map(idx => ({
        kind: 'index' as NodeKind,
        label: idx.name,
        contextValue: 'index' as NodeKind,
        iconId: 'key',
        description: `${idx.unique ? 'UNIQUE · ' : ''}${idx.columns.join(', ')}`,
        collapsible: vscode.TreeItemCollapsibleState.None,
        filePath,
        tableName,
      }));

      return [...columnNodes, ...(indexNodes.length ? indexNodes : [])];
    } catch {
      return [{
        kind: 'empty',
        label: '(error loading columns)',
        contextValue: 'empty',
        iconId: 'warning',
        collapsible: vscode.TreeItemCollapsibleState.None,
      }];
    }
  }

  // ── TreeDataProvider interface ────────────────────────────────────────────

  public getTreeItem(element: DbNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, element.collapsible);
    item.contextValue = element.contextValue;
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = new vscode.ThemeIcon(element.iconId);
    if (element.kind === 'table' || element.kind === 'view') {
      item.command = {
        command: 'null.database.openTable',
        title: 'View Table Data',
        arguments: [element],
      };
    }
    if (element.kind === 'database') {
      item.command = {
        command: 'null.database.open',
        title: 'Open Database',
        arguments: [element.filePath ? vscode.Uri.file(element.filePath) : undefined],
      };
    }
    return item;
  }

  public getChildren(element?: DbNode): vscode.ProviderResult<DbNode[]> {
    // ── Root: show all registered connections ─────────────────────────────
    if (!element) {
      const paths = this.registry.getAll();
      if (paths.length === 0) {
        return [{
          kind: 'empty',
          label: 'No databases. Click + to add one.',
          contextValue: 'empty',
          iconId: 'info',
          collapsible: vscode.TreeItemCollapsibleState.None,
        }];
      }
      return paths.map(fp => {
        const fileName = path.basename(fp);
        let size = '';
        try {
          const bytes = fs.statSync(fp).size;
          size = bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        } catch { /* ignore */ }
        return {
          kind: 'databaseConnection' as NodeKind,
          label: fileName,
          contextValue: 'databaseConnection' as NodeKind,
          iconId: 'database',
          description: size,
          tooltip: fp,
          collapsible: vscode.TreeItemCollapsibleState.Collapsed,
          filePath: fp,
        };
      });
    }

    // ── Connection node: show database contents ───────────────────────────
    if (element.kind === 'databaseConnection' && element.filePath) {
      try {
        const sess = this.openSession(element.filePath);
        const info = sess.getDatabaseInfo();
        const tables = sess.listTablesAndViews();

        const tableList = tables.filter(t => t.type === 'table');
        const viewList = tables.filter(t => t.type === 'view');

        const nodes: DbNode[] = [];

        // Info meta-node
        nodes.push({
          kind: 'empty',
          label: `SQLite ${info.sqliteVersion}`,
          contextValue: 'empty',
          iconId: 'info',
          description: `${info.tableCount} tables · ${info.viewCount} views`,
          collapsible: vscode.TreeItemCollapsibleState.None,
        });

        // Tables folder
        if (tableList.length > 0) {
          nodes.push({
            kind: 'tables-folder',
            label: 'Tables',
            contextValue: 'tables-folder',
            iconId: 'list-flat',
            description: `${tableList.length}`,
            collapsible: vscode.TreeItemCollapsibleState.Expanded,
            filePath: element.filePath,
            children: tableList.map(t => this.buildTableNode(element.filePath!, t)),
          });
        }

        // Views folder
        if (viewList.length > 0) {
          nodes.push({
            kind: 'views-folder',
            label: 'Views',
            contextValue: 'views-folder',
            iconId: 'eye',
            description: `${viewList.length}`,
            collapsible: vscode.TreeItemCollapsibleState.Collapsed,
            filePath: element.filePath,
            children: viewList.map(t => this.buildTableNode(element.filePath!, t)),
          });
        }

        if (tableList.length === 0 && viewList.length === 0) {
          nodes.push({
            kind: 'empty',
            label: '(empty database)',
            contextValue: 'empty',
            iconId: 'circle-slash',
            collapsible: vscode.TreeItemCollapsibleState.None,
          });
        }

        return nodes;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return [{
          kind: 'empty',
          label: `Error: ${msg}`,
          contextValue: 'empty',
          iconId: 'error',
          collapsible: vscode.TreeItemCollapsibleState.None,
        }];
      }
    }

    // ── Folder nodes: return pre-built children ───────────────────────────
    if ((element.kind === 'tables-folder' || element.kind === 'views-folder') && element.children) {
      return element.children;
    }

    // ── Table / View node: return column+index details ────────────────────
    if ((element.kind === 'table' || element.kind === 'view') && element.filePath && element.tableName) {
      return this.buildColumnsForTable(element.filePath, element.tableName);
    }

    return [];
  }
}

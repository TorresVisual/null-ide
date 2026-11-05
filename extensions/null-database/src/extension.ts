'use strict';

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ConnectionRegistry, DatabaseExplorerProvider, DbNode } from './databaseExplorer';
import { DatabasePanel } from './webviewPanel';

const DB_EXTENSIONS = ['.db', '.sqlite', '.sqlite3', '.db3', '.sdb'];

function isDbFile(uri: vscode.Uri): boolean {
  return DB_EXTENSIONS.includes(path.extname(uri.fsPath).toLowerCase());
}

export function activate(context: vscode.ExtensionContext): void {
  // ── Connection registry & tree view ──────────────────────────────────────
  const registry = new ConnectionRegistry(context.globalState);
  const provider = new DatabaseExplorerProvider(registry);

  const treeView = vscode.window.createTreeView('null.databaseExplorer', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  context.subscriptions.push(treeView);
  context.subscriptions.push({ dispose: () => provider.disposeAll() });

  // ── Commands ──────────────────────────────────────────────────────────────

  // Open database (from command palette, explorer context menu, or file)
  context.subscriptions.push(
    vscode.commands.registerCommand('null.database.open', async (uriOrNode?: vscode.Uri | DbNode) => {
      let filePath: string | undefined;

      if (uriOrNode instanceof vscode.Uri) {
        filePath = uriOrNode.fsPath;
      } else if (uriOrNode && 'filePath' in uriOrNode && uriOrNode.filePath) {
        filePath = uriOrNode.filePath;
      } else {
        // Show a file picker
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Open Database',
          filters: { 'SQLite databases': ['db', 'sqlite', 'sqlite3', 'db3', 'sdb'], 'All files': ['*'] },
        });
        if (!uris || !uris.length) { return; }
        filePath = uris[0].fsPath;
      }

      if (!filePath || !fs.existsSync(filePath)) {
        vscode.window.showErrorMessage(`Database file not found: ${filePath}`);
        return;
      }

      registry.add(filePath);
      provider.refreshAll();
      DatabasePanel.createOrFocus(filePath, context);
    })
  );

  // Add database connection (sidebar + button)
  context.subscriptions.push(
    vscode.commands.registerCommand('null.database.addConnection', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: 'Add Database',
        filters: { 'SQLite databases': ['db', 'sqlite', 'sqlite3', 'db3', 'sdb'], 'All files': ['*'] },
      });
      if (!uris || !uris.length) { return; }

      let opened = 0;
      for (const uri of uris) {
        if (!fs.existsSync(uri.fsPath)) {
          vscode.window.showWarningMessage(`File not found: ${uri.fsPath}`);
          continue;
        }
        registry.add(uri.fsPath);
        opened++;
      }

      if (opened > 0) {
        provider.refreshAll();
      }
    })
  );

  // Remove connection
  context.subscriptions.push(
    vscode.commands.registerCommand('null.database.removeConnection', (node?: DbNode) => {
      const fp = node?.filePath;
      if (!fp) { return; }
      registry.remove(fp);
      provider.refreshAll();
    })
  );

  // Refresh explorer
  context.subscriptions.push(
    vscode.commands.registerCommand('null.database.refresh', (node?: DbNode) => {
      if (node) {
        provider.refresh(node);
      } else {
        provider.refreshAll();
      }
    })
  );

  // Open table data in a panel (from tree view)
  context.subscriptions.push(
    vscode.commands.registerCommand('null.database.openTable', async (node?: DbNode) => {
      if (!node?.filePath || !node?.tableName) {
        vscode.window.showErrorMessage('No table selected.');
        return;
      }
      DatabasePanel.createOrFocus(node.filePath, context, { openTable: node.tableName });
    })
  );

  // Open SQL query panel for a table
  context.subscriptions.push(
    vscode.commands.registerCommand('null.database.queryTable', async (node?: DbNode) => {
      if (!node?.filePath) { return; }
      const tableName = node.tableName;
      const panel = DatabasePanel.createOrFocus(node.filePath, context, { openQuery: true });
      if (tableName) {
        panel.openTable(tableName);
      }
    })
  );

  // New blank query
  context.subscriptions.push(
    vscode.commands.registerCommand('null.database.newQuery', (node?: DbNode) => {
      const fp = node?.filePath ?? registry.getAll()[0];
      if (!fp) {
        vscode.window.showErrorMessage('Open a database first.');
        return;
      }
      DatabasePanel.createOrFocus(fp, context, { openQuery: true });
    })
  );

  // Copy table name
  context.subscriptions.push(
    vscode.commands.registerCommand('null.database.copyTableName', (node?: DbNode) => {
      if (node?.tableName) {
        vscode.env.clipboard.writeText(node.tableName);
        vscode.window.setStatusBarMessage(`Copied: ${node.tableName}`, 2000);
      }
    })
  );

  // Export table (opens panel which handles the export dialog)
  context.subscriptions.push(
    vscode.commands.registerCommand('null.database.exportTable', async (node?: DbNode) => {
      if (!node?.filePath || !node?.tableName) { return; }
      const panel = DatabasePanel.createOrFocus(node.filePath, context, { openTable: node.tableName });
      // Give the panel a moment to open before sending the export message
      setTimeout(() => {
        panel.openTable(node.tableName!);
      }, 300);
    })
  );

  // ── Custom editor provider for double-clicking .db files ──────────────────
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'null.database.viewer',
      {
        async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
          return { uri, dispose: () => {} };
        },
        async resolveCustomEditor(document: vscode.CustomDocument, _panel: vscode.WebviewPanel): Promise<void> {
          // Delegate to our panel manager — dispose the VS Code-created panel immediately
          // so our own panel manager takes over.
          _panel.dispose();
          DatabasePanel.createOrFocus(document.uri.fsPath, context);
        },
      },
      {
        webviewOptions: { retainContextWhenHidden: false },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  // ── Auto-add databases found in workspace ─────────────────────────────────
  autoDiscoverWorkspaceDbs(registry, provider);

  // Watch for new .db files dropped into the workspace
  const dbWatcher = vscode.workspace.createFileSystemWatcher('**/*.{db,sqlite,sqlite3,db3,sdb}');
  dbWatcher.onDidCreate(uri => {
    if (!registry.getAll().includes(uri.fsPath)) {
      registry.add(uri.fsPath);
      provider.refreshAll();
    }
  });
  context.subscriptions.push(dbWatcher);
}

function autoDiscoverWorkspaceDbs(registry: ConnectionRegistry, provider: DatabaseExplorerProvider): void {
  const existing = new Set(registry.getAll());
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    // Shallow scan: only look in the workspace root to avoid huge scans
    try {
      const entries = fs.readdirSync(folder.uri.fsPath, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) { continue; }
        const ext = path.extname(e.name).toLowerCase();
        if (!DB_EXTENSIONS.includes(ext)) { continue; }
        const fp = path.join(folder.uri.fsPath, e.name);
        if (!existing.has(fp)) {
          registry.add(fp);
          existing.add(fp);
        }
      }
    } catch { /* non-fatal */ }
  }

  if (registry.getAll().length > 0) {
    provider.refreshAll();
  }
}

export function deactivate(): void {
  DatabasePanel.closeAll();
}

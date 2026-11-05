'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseExplorerProvider = exports.ConnectionRegistry = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs"));
const sqliteDriver_1 = require("./sqliteDriver");
// ─── Database Connection Registry ────────────────────────────────────────────
class ConnectionRegistry {
    state;
    static STORAGE_KEY = 'null.database.connections';
    constructor(state) {
        this.state = state;
    }
    getAll() {
        return (this.state.get(ConnectionRegistry.STORAGE_KEY) ?? []).filter(p => p !== '');
    }
    add(filePath) {
        const existing = this.getAll();
        if (!existing.includes(filePath)) {
            this.state.update(ConnectionRegistry.STORAGE_KEY, [...existing, filePath]);
        }
    }
    remove(filePath) {
        const existing = this.getAll();
        this.state.update(ConnectionRegistry.STORAGE_KEY, existing.filter(p => p !== filePath));
    }
    clear() {
        this.state.update(ConnectionRegistry.STORAGE_KEY, []);
    }
}
exports.ConnectionRegistry = ConnectionRegistry;
// ─── Tree View Data Provider ──────────────────────────────────────────────────
class DatabaseExplorerProvider {
    registry;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    /** Active sessions keyed by absolute file path. */
    sessions = new Map();
    constructor(registry) {
        this.registry = registry;
    }
    refresh(node) {
        // Close cached session for the changed path so we re-open fresh.
        if (node?.filePath) {
            const sess = this.sessions.get(node.filePath);
            if (sess) {
                try {
                    sess.close();
                }
                catch { /* ignore */ }
                this.sessions.delete(node.filePath);
            }
        }
        this._onDidChangeTreeData.fire(node);
    }
    refreshAll() {
        for (const [, sess] of this.sessions) {
            try {
                sess.close();
            }
            catch { /* ignore */ }
        }
        this.sessions.clear();
        this._onDidChangeTreeData.fire();
    }
    disposeAll() {
        this.refreshAll();
        this._onDidChangeTreeData.dispose();
    }
    // ── Helpers ──────────────────────────────────────────────────────────────
    openSession(filePath) {
        if (!this.sessions.has(filePath)) {
            this.sessions.set(filePath, new sqliteDriver_1.SqliteSession(filePath, true /* read-only */));
        }
        return this.sessions.get(filePath);
    }
    buildTableNode(filePath, t) {
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
    buildColumnsForTable(filePath, tableName) {
        try {
            const sess = this.openSession(filePath);
            const details = sess.getTableDetails(tableName);
            const columnNodes = details.columns.map(col => {
                const pk = col.primaryKey ? ' 🔑' : '';
                const nullable = !col.notNull && !col.primaryKey ? '?' : '';
                return {
                    kind: 'column',
                    label: col.name,
                    contextValue: 'column',
                    iconId: 'symbol-field',
                    description: `${col.type}${nullable}${pk}`,
                    tooltip: `${col.name} ${col.type}${col.notNull ? ' NOT NULL' : ''}${col.primaryKey ? ' PRIMARY KEY' : ''}${col.defaultValue !== null && col.defaultValue !== undefined ? ` DEFAULT ${col.defaultValue}` : ''}`,
                    collapsible: vscode.TreeItemCollapsibleState.None,
                    filePath,
                    tableName,
                    columnName: col.name,
                };
            });
            const indexNodes = details.indexes.map(idx => ({
                kind: 'index',
                label: idx.name,
                contextValue: 'index',
                iconId: 'key',
                description: `${idx.unique ? 'UNIQUE · ' : ''}${idx.columns.join(', ')}`,
                collapsible: vscode.TreeItemCollapsibleState.None,
                filePath,
                tableName,
            }));
            return [...columnNodes, ...(indexNodes.length ? indexNodes : [])];
        }
        catch {
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
    getTreeItem(element) {
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
    getChildren(element) {
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
                }
                catch { /* ignore */ }
                return {
                    kind: 'databaseConnection',
                    label: fileName,
                    contextValue: 'databaseConnection',
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
                const nodes = [];
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
                        children: tableList.map(t => this.buildTableNode(element.filePath, t)),
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
                        children: viewList.map(t => this.buildTableNode(element.filePath, t)),
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
            }
            catch (err) {
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
exports.DatabaseExplorerProvider = DatabaseExplorerProvider;
//# sourceMappingURL=databaseExplorer.js.map
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
exports.WorktreeTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
const worktrees_1 = require("./worktrees");
class WorktreeTreeProvider {
    _repoCwd;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    _entries = [];
    _refreshing = false;
    constructor(_repoCwd) {
        this._repoCwd = _repoCwd;
        void this.refresh();
    }
    get entries() {
        return this._entries;
    }
    async refresh() {
        if (this._refreshing)
            return;
        this._refreshing = true;
        try {
            const cwd = this._repoCwd();
            this._entries = cwd ? await (0, worktrees_1.listWorktrees)(cwd) : [];
        }
        catch {
            this._entries = [];
        }
        finally {
            this._refreshing = false;
            this._onDidChangeTreeData.fire();
        }
    }
    getTreeItem(entry) {
        const isClaudeSession = /[\\/]\.claude[\\/]worktrees[\\/]/.test(entry.path);
        const label = entry.branch ?? `(detached ${entry.head.slice(0, 7)})`;
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        const aheadBehind = entry.ahead || entry.behind ? ` ↑${entry.ahead} ↓${entry.behind}` : '';
        item.description = `${entry.dirty ? '●' : ''}${aheadBehind}`.trim() || undefined;
        item.tooltip = new vscode.MarkdownString(`**${label}**\n\n${entry.path}\n\n` +
            `Head: \`${entry.head.slice(0, 7)}\`\n\n` +
            (entry.lastCommitSubject ? `Last commit: ${entry.lastCommitSubject} (${entry.lastCommitDate.slice(0, 10)})\n\n` : '') +
            `Ahead/behind base: ↑${entry.aheadBase} ↓${entry.behindBase}` +
            (entry.prunable ? '\n\n_Directory is missing — needs pruning._' : ''));
        item.iconPath = new vscode.ThemeIcon(entry.prunable ? 'warning' : isClaudeSession ? 'hubot' : 'source-control', entry.isCurrent ? new vscode.ThemeColor('charts.blue') : undefined);
        item.contextValue = 'worktreeEntry';
        item.id = `worktree-${entry.path}`;
        return item;
    }
    getChildren() {
        return this._entries;
    }
}
exports.WorktreeTreeProvider = WorktreeTreeProvider;
//# sourceMappingURL=worktreesTreeView.js.map
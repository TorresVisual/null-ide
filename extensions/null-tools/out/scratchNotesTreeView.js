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
exports.FolderTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class FolderTreeProvider {
    folderPath;
    resolveLabel;
    onDidChangeTreeDataEmitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    constructor(folderPath, resolveLabel) {
        this.folderPath = folderPath;
        this.resolveLabel = resolveLabel;
    }
    refresh() {
        this.onDidChangeTreeDataEmitter.fire();
    }
    watch() {
        const folderPath = this.folderPath;
        if (!folderPath) {
            return new vscode.Disposable(() => { });
        }
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folderPath, '*'));
        watcher.onDidCreate(() => this.refresh());
        watcher.onDidDelete(() => this.refresh());
        watcher.onDidChange(() => this.refresh());
        return watcher;
    }
    getTreeItem(filePath) {
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
    getChildren() {
        const folderPath = this.folderPath;
        if (!folderPath || !fs.existsSync(folderPath)) {
            return [];
        }
        return fs.readdirSync(folderPath)
            .map(name => path.join(folderPath, name))
            .filter(p => fs.statSync(p).isFile())
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    }
}
exports.FolderTreeProvider = FolderTreeProvider;
//# sourceMappingURL=scratchNotesTreeView.js.map
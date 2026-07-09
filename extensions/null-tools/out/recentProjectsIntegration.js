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
exports.trackCurrentProject = trackCurrentProject;
exports.registerRecentProjectsUriHandler = registerRecentProjectsUriHandler;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const recentProjects_1 = require("./recentProjects");
function trackCurrentProject() {
    let root;
    const workspaceFile = vscode.workspace.workspaceFile;
    if (workspaceFile && workspaceFile.scheme === 'file') {
        root = { path: workspaceFile.fsPath, isWorkspaceFile: true };
    }
    else {
        const folders = vscode.workspace.workspaceFolders;
        if (folders?.length) {
            root = { path: folders[0].uri.fsPath, isWorkspaceFile: false };
        }
    }
    if (!root) {
        return;
    }
    let label = path.basename(root.path);
    if (root.isWorkspaceFile && label.endsWith('.code-workspace')) {
        label = `${label.slice(0, -'.code-workspace'.length)} (Workspace)`;
    }
    try {
        const filePath = (0, recentProjects_1.getRecentProjectsFilePath)();
        const entries = (0, recentProjects_1.readRecentProjects)(filePath);
        const updated = (0, recentProjects_1.upsertEntry)(entries, { path: root.path, label, isWorkspaceFile: root.isWorkspaceFile });
        (0, recentProjects_1.writeRecentProjectsAtomic)(filePath, updated);
    }
    catch (err) {
        console.error('null-tools: failed to update recent projects list', err);
    }
}
function registerRecentProjectsUriHandler(context) {
    context.subscriptions.push(vscode.window.registerUriHandler({
        async handleUri(uri) {
            if (uri.path !== '/recent-projects') {
                return;
            }
            let entries;
            try {
                entries = (0, recentProjects_1.readRecentProjects)((0, recentProjects_1.getRecentProjectsFilePath)());
            }
            catch {
                entries = [];
            }
            if (!entries.length) {
                vscode.window.showInformationMessage('No recent projects tracked yet.');
                return;
            }
            const picked = await vscode.window.showQuickPick(entries.map(e => ({ label: e.label, description: e.path, entry: e })), { placeHolder: 'Select a recent project to open' });
            if (!picked) {
                return;
            }
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(picked.entry.path), { forceNewWindow: true });
        },
    }));
}
//# sourceMappingURL=recentProjectsIntegration.js.map
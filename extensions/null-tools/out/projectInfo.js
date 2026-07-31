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
exports.formatProjectBadgeText = formatProjectBadgeText;
exports.formatProjectTooltip = formatProjectTooltip;
exports.registerProjectInfoFeature = registerProjectInfoFeature;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
function formatProjectBadgeText(state) {
    if (!state.projectName) {
        return '$(folder) No Project';
    }
    if (state.branchName) {
        const dirtySuffix = (state.dirtyCount && state.dirtyCount > 0) ? '*' : '';
        return `$(folder) ${state.projectName} (${state.branchName}${dirtySuffix})`;
    }
    if (state.dirtyCount && state.dirtyCount > 0) {
        return `$(folder) ${state.projectName}*`;
    }
    return `$(folder) ${state.projectName}`;
}
function formatProjectTooltip(state) {
    if (!state.projectName || !state.projectPath) {
        return 'Null IDE: No workspace folder open';
    }
    const lines = [
        `Project: ${state.projectName}`,
        `Path: ${state.projectPath}`,
    ];
    if (state.branchName) {
        lines.push(`Git Branch: ${state.branchName}`);
    }
    if (state.dirtyCount !== undefined) {
        lines.push(`Modified Files: ${state.dirtyCount}`);
    }
    lines.push('', 'Click to reveal in Explorer');
    return lines.join('\n');
}
function registerProjectInfoFeature(context) {
    const item = vscode.window.createStatusBarItem('null.projectInfo', vscode.StatusBarAlignment.Left, 10000);
    item.command = 'workbench.view.explorer';
    context.subscriptions.push(item);
    async function updateStatusBar() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            item.text = formatProjectBadgeText({});
            item.tooltip = formatProjectTooltip({});
            item.show();
            return;
        }
        const primaryFolder = folders[0];
        const projectPath = primaryFolder.uri.fsPath;
        const projectName = primaryFolder.name || path.basename(projectPath);
        let branchName;
        let dirtyCount;
        try {
            const gitExt = vscode.extensions.getExtension('vscode.git');
            if (gitExt) {
                const gitApi = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate())?.getAPI(1);
                if (gitApi && gitApi.repositories) {
                    const repo = gitApi.repositories.find((r) => r.rootUri.fsPath === projectPath) || gitApi.repositories[0];
                    if (repo && repo.state) {
                        branchName = repo.state.HEAD?.name;
                        const wt = repo.state.workingTreeChanges || [];
                        const idx = repo.state.indexChanges || [];
                        dirtyCount = wt.length + idx.length;
                    }
                }
            }
        }
        catch {
            // Fall back safely if Git API is unavailable
        }
        const state = {
            projectName,
            projectPath,
            branchName,
            dirtyCount,
        };
        item.text = formatProjectBadgeText(state);
        item.tooltip = formatProjectTooltip(state);
        item.show();
    }
    // Initial update
    updateStatusBar();
    // Listeners
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => updateStatusBar()), vscode.workspace.onDidSaveTextDocument(() => updateStatusBar()));
    // Subscribe to Git state changes if available
    try {
        const gitExt = vscode.extensions.getExtension('vscode.git');
        if (gitExt) {
            const setupGitListeners = (gitApi) => {
                if (!gitApi) {
                    return;
                }
                for (const repo of gitApi.repositories || []) {
                    if (repo.state && typeof repo.state.onDidChange === 'function') {
                        context.subscriptions.push(repo.state.onDidChange(() => updateStatusBar()));
                    }
                }
                if (typeof gitApi.onDidOpenRepository === 'function') {
                    context.subscriptions.push(gitApi.onDidOpenRepository((repo) => {
                        updateStatusBar();
                        if (repo.state && typeof repo.state.onDidChange === 'function') {
                            context.subscriptions.push(repo.state.onDidChange(() => updateStatusBar()));
                        }
                    }));
                }
            };
            if (gitExt.isActive) {
                setupGitListeners(gitExt.exports.getAPI(1));
            }
            else {
                Promise.resolve(gitExt.activate()).then(() => {
                    setupGitListeners(gitExt.exports.getAPI(1));
                }).catch(() => { });
            }
        }
    }
    catch {
        // Ignore Git listener errors
    }
}
//# sourceMappingURL=projectInfo.js.map
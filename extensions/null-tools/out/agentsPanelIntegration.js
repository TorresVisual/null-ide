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
exports.registerAgentsPanelFeature = registerAgentsPanelFeature;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const agentsPanel_1 = require("./agentsPanel");
function registerAgentsPanelFeature(context) {
    const nodePty = (0, agentsPanel_1.loadNodePty)(context.extensionUri.fsPath);
    const agentsProvider = new agentsPanel_1.AgentsViewProvider(context.extensionUri, nodePty, context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('null.agentsView', agentsProvider, {
        webviewOptions: { retainContextWhenHidden: true },
    }));
    context.subscriptions.push({ dispose: () => agentsProvider._saveBuffers() });
    const beforeProvider = new agentsPanel_1.AgentBeforeProvider();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(beforeProvider.scheme, beforeProvider));
    // Track whether the active tab is one of our agent diffs and expose context.
    const updateDiffContext = () => {
        const active = vscode.window.tabGroups.activeTabGroup.activeTab;
        const viewing = active?.input instanceof vscode.TabInputTextDiff &&
            active.input.original.scheme === beforeProvider.scheme;
        vscode.commands.executeCommand('setContext', 'null.viewingProposedDiff', !!viewing);
    };
    context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(updateDiffContext), vscode.window.onDidChangeActiveTextEditor(updateDiffContext));
    context.subscriptions.push(vscode.commands.registerCommand('null.acceptProposedDiff', async () => {
        const active = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (active)
            await vscode.window.tabGroups.close(active);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.rejectProposedDiff', async () => {
        const active = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (!(active?.input instanceof vscode.TabInputTextDiff))
            return;
        const diskUri = active.input.modified;
        await vscode.window.tabGroups.close(active);
        await vscode.commands.executeCommand('null.revertAgentChange', diskUri);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.revertAgentChange', async (uri) => {
        try {
            await vscode.commands.executeCommand('git.revertFile', uri);
        }
        catch {
            try {
                (0, child_process_1.execSync)(`git checkout -- "${uri.fsPath}"`, { cwd: path.dirname(uri.fsPath) });
            }
            catch (err) {
                vscode.window.showErrorMessage(`Null: revert failed — ${err.message}`);
            }
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.agentsPaste', () => agentsProvider.paste()));
    return agentsProvider;
}
//# sourceMappingURL=agentsPanelIntegration.js.map
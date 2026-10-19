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
exports.registerWorkflowsFeature = registerWorkflowsFeature;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const githubApi_1 = require("../github/githubApi");
const githubAuth_1 = require("../github/githubAuth");
const githubSession_1 = require("../github/githubSession");
const pullModel_1 = require("../pulls/pullModel");
const workflowsTreeView_1 = require("./workflowsTreeView");
const MAX_WORKFLOW_FILE_BYTES = 256 * 1024;
function registerWorkflowsFeature(context) {
    const tree = new workflowsTreeView_1.WorkflowsTreeProvider(context.workspaceState);
    const view = vscode.window.createTreeView('null.workflowsView', { treeDataProvider: tree });
    tree.onMessage = message => { view.message = message; };
    const refresh = async () => { await tree.refresh(); };
    async function signIn(node) {
        const slot = tree.slot(node.repo.key);
        if (!slot)
            return;
        // The only interactive call: the user clicked the row for this folder.
        const session = await (0, githubSession_1.resolveGithubSession)((0, githubAuth_1.getAccountsApi)(), slot.folder, true);
        if (session)
            await refresh();
    }
    async function openWorkflowFile(node) {
        const slot = tree.slot(node.repo.key);
        if (node.kind !== 'workflow' || !slot)
            return;
        const local = vscode.Uri.joinPath(slot.folder, node.workflow.path);
        try {
            await vscode.workspace.fs.stat(local);
            await vscode.window.showTextDocument(local);
            return;
        }
        catch { /* not on disk: read it from GitHub */ }
        try {
            const file = await (0, githubApi_1.fetchRepoFile)(slot.owner, slot.repo, 'HEAD', node.workflow.path, slot.token, MAX_WORKFLOW_FILE_BYTES);
            const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content: file.bytes.toString('utf8') });
            await vscode.window.showTextDocument(doc, { preview: true });
        }
        catch (err) {
            void vscode.window.showErrorMessage(`Could not open ${path.posix.basename(node.workflow.path)}: ${(0, pullModel_1.describeFailure)(err)}`);
        }
    }
    context.subscriptions.push(view, vscode.commands.registerCommand('null.workflows.refresh', refresh), vscode.commands.registerCommand('null.workflows.open', () => vscode.commands.executeCommand('null.workflowsView.focus')), vscode.commands.registerCommand('null.workflows.signIn', signIn), vscode.commands.registerCommand('null.workflows.loadMore', async (node) => {
        const slot = tree.slot(node.repo.key);
        if (slot)
            await tree.loadMore(slot);
    }), vscode.commands.registerCommand('null.workflows.openOnGitHub', (node) => {
        const url = node.kind === 'run' ? node.run.url : node.kind === 'job' ? node.job.url
            : node.kind === 'workflow' ? `https://github.com/${node.repo.owner}/${node.repo.repo}/actions/workflows/${path.posix.basename(node.workflow.path)}`
                : node.kind === 'repo' ? `https://github.com/${node.repo.owner}/${node.repo.repo}/actions` : '';
        if (url)
            void vscode.env.openExternal(vscode.Uri.parse(url));
    }), vscode.commands.registerCommand('null.workflows.openWorkflowFile', openWorkflowFile), vscode.commands.registerCommand('null.workflows.createWorkflow', async (node) => {
        const slot = tree.slot(node.repo.key);
        if (!slot)
            return;
        const dir = vscode.Uri.joinPath(slot.folder, '.github', 'workflows');
        try {
            await vscode.workspace.fs.stat(dir);
            await vscode.commands.executeCommand('revealInExplorer', dir);
        }
        catch {
            void vscode.window.showInformationMessage('Create .github/workflows/ in this folder and add a YAML workflow file to it.');
        }
    }), 
    // Test seam for the integration spec (like _null.pulls.snapshot): the view's state and per-repo counts.
    vscode.commands.registerCommand('_null.workflows.snapshot', async () => {
        await tree.ensureLoaded();
        return tree.snapshot();
    }), 
    // Nothing is fetched until the view is first shown.
    view.onDidChangeVisibility(e => { if (e.visible && !tree.loaded)
        void refresh(); }));
    if (view.visible)
        void refresh();
    // Binding or importing an account must show up without a manual refresh, but never wakes a view nobody opened.
    const accountsChanged = (0, githubAuth_1.getAccountsApi)()?.onDidChange(() => { if (tree.loaded)
        void refresh(); });
    if (accountsChanged)
        context.subscriptions.push(accountsChanged);
}
//# sourceMappingURL=workflowsIntegration.js.map
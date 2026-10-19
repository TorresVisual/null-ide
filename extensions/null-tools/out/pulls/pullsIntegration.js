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
exports.registerPullsFeature = registerPullsFeature;
const vscode = __importStar(require("vscode"));
const githubAuth_1 = require("../github/githubAuth");
const gitRun_1 = require("../graph/gitRun");
const pullApi_1 = require("./pullApi");
const pullCheckout_1 = require("./pullCheckout");
const pullContentProvider_1 = require("./pullContentProvider");
const pullDocs_1 = require("./pullDocs");
const pullDiff_1 = require("./pullDiff");
const pullFilter_1 = require("./pullFilter");
const pullFilterMenu_1 = require("./pullFilterMenu");
const pullActions_1 = require("./pullActions");
const pullDetailPanel_1 = require("./pullDetailPanel");
const pullReview_1 = require("./pullReview");
const pullsTreeView_1 = require("./pullsTreeView");
const FOCUS_REFRESH_MIN_MS = 60_000;
function registerPullsFeature(context) {
    const review = new pullReview_1.PullReview(context.globalState);
    const tree = new pullsTreeView_1.PullsTreeProvider(review, context.workspaceState);
    const view = vscode.window.createTreeView('null.pullsView', { treeDataProvider: tree });
    tree.onMessage = message => { view.message = message; };
    let lastRefresh = 0;
    const refresh = async () => { lastRefresh = Date.now(); await tree.refresh(); };
    async function checkout(node) {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (node.kind !== 'pull' || !cwd)
            return;
        const { pull } = node;
        const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Checking out pull request #${pull.number}…` }, () => (0, pullCheckout_1.checkoutPull)((0, gitRun_1.makeRunGit)(cwd, 60_000), pull));
        if (result.ok)
            void vscode.window.showInformationMessage(`On branch ${result.branch}.`);
        else
            void vscode.window.showErrorMessage(`Could not check out #${pull.number}: ${result.message}`);
        if (result.ok)
            await refresh(); // moves the ● marker
    }
    context.subscriptions.push(review, view, vscode.workspace.registerTextDocumentContentProvider(pullDocs_1.PULL_SCHEME, new pullContentProvider_1.PullContentProvider()), vscode.commands.registerCommand('null.pulls.refresh', refresh), vscode.commands.registerCommand('null.pulls.open', () => vscode.commands.executeCommand('null.pullsView.focus')), 
    // Test seam for the integration spec (like _null.graph.snapshot): the view's state and row count.
    vscode.commands.registerCommand('_null.pulls.snapshot', async () => {
        if (!tree.loaded)
            await refresh();
        return { state: tree.state, pulls: (await tree.getChildren()).length };
    }), 
    // Only while the view has been shown, and at most once a minute: coming back to the window picks up new PRs and branch changes.
    vscode.window.onDidChangeWindowState(e => {
        if (e.focused && tree.loaded && view.visible && Date.now() - lastRefresh > FOCUS_REFRESH_MIN_MS)
            void refresh();
    }), vscode.commands.registerCommand('null.pulls.checkout', checkout), vscode.commands.registerCommand('null.pulls.openOnGitHub', (node) => {
        if (node.kind === 'pull')
            void vscode.env.openExternal(vscode.Uri.parse(node.pull.url));
    }), vscode.commands.registerCommand('null.pulls.openFileDiff', (node) => {
        if (node.kind === 'file')
            return (0, pullDiff_1.openPullFileDiff)(node.detail, node.file);
    }), vscode.commands.registerCommand('null.pulls.filter', async () => {
        const ctx = tree.context();
        if (!ctx) {
            void vscode.window.showInformationMessage('Open the Pull Requests view of a folder with a GitHub remote first.');
            return;
        }
        const { owner, repo } = ctx.repo;
        const next = await (0, pullFilterMenu_1.editFilter)(tree.filter, {
            labels: () => (0, pullApi_1.fetchLabelNames)(owner, repo, ctx.token),
            milestones: () => (0, pullApi_1.fetchMilestoneTitles)(owner, repo, ctx.token),
        });
        if (next) {
            lastRefresh = Date.now();
            await tree.setFilter(next);
        }
    }), vscode.commands.registerCommand('null.pulls.resetFilter', async () => {
        lastRefresh = Date.now();
        await tree.setFilter(pullFilter_1.DEFAULT_FILTER);
    }), vscode.commands.registerCommand('null.pulls.openDetail', (node) => {
        const ctx = tree.context();
        if (node.kind === 'pull' && ctx)
            pullDetailPanel_1.PullDetailPanel.show(context.extensionUri, ctx.repo, node.pull);
    }), vscode.commands.registerCommand('null.pulls.finishReview', async (node) => {
        const ctx = tree.context();
        if (node.kind !== 'pull' || !ctx)
            return;
        if (await (0, pullActions_1.finishReview)({ ...ctx.repo, number: node.pull.number }) !== 'cancelled')
            await refresh();
    }), vscode.commands.registerCommand('null.pulls.comment', (reply) => review.submit(reply)), vscode.commands.registerCommand('null.pulls.addToReview', (reply) => review.addToReview(reply)), vscode.commands.registerCommand('null.pulls.resolveThread', (thread) => review.setResolved(thread, true)), vscode.commands.registerCommand('null.pulls.unresolveThread', (thread) => review.setResolved(thread, false)), 
    // Nothing is fetched until the view is first shown, and nothing polls while it is hidden.
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
//# sourceMappingURL=pullsIntegration.js.map
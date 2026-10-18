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
const pullCheckout_1 = require("./pullCheckout");
const pullContentProvider_1 = require("./pullContentProvider");
const pullDocs_1 = require("./pullDocs");
const pullDiff_1 = require("./pullDiff");
const pullReview_1 = require("./pullReview");
const pullsTreeView_1 = require("./pullsTreeView");
const FOCUS_REFRESH_MIN_MS = 60_000;
function registerPullsFeature(context) {
    const review = new pullReview_1.PullReview(context.globalState);
    const tree = new pullsTreeView_1.PullsTreeProvider(review);
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
    }), vscode.commands.registerCommand('null.pulls.comment', (reply) => review.submit(reply)), 
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
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
const gitApi_1 = require("../graph/gitApi");
const pullModel_1 = require("../pulls/pullModel");
const workflowActions_1 = require("./workflowActions");
const workflowFilterMenu_1 = require("./workflowFilterMenu");
const workflowsModel_1 = require("./workflowsModel");
const workflowsTreeView_1 = require("./workflowsTreeView");
const MAX_WORKFLOW_FILE_BYTES = 256 * 1024;
const FOCUS_REFRESH_MIN_MS = 60_000;
function registerWorkflowsFeature(context) {
    const tree = new workflowsTreeView_1.WorkflowsTreeProvider(context.workspaceState);
    const view = vscode.window.createTreeView('null.workflowsView', { treeDataProvider: tree });
    tree.onMessage = message => { view.message = message; };
    let lastRefresh = 0;
    const refresh = async () => { lastRefresh = Date.now(); await tree.refresh(); };
    // One shared timer, only while the view is visible, only while some run is in play.
    let timer;
    const stop = () => { if (timer) {
        clearTimeout(timer);
        timer = undefined;
    } };
    const schedule = (ms) => {
        stop();
        if (ms !== null && view.visible)
            timer = setTimeout(() => void tick(), ms);
    };
    const tick = async () => {
        timer = undefined;
        schedule(await tree.poll());
    };
    const rearm = () => { if (!timer && view.visible && tree.hasActiveRuns())
        schedule(workflowsModel_1.POLL_FAST_MS); };
    const workflowFiles = () => {
        const seen = new Map();
        for (const s of tree.slots())
            for (const w of s.workflows)
                seen.set(path.posix.basename(w.path), w.name);
        return [...seen].map(([file, name]) => ({ file, name }));
    };
    async function applyFilter(next) {
        lastRefresh = Date.now();
        await tree.setFilter(next);
    }
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
    }), vscode.commands.registerCommand('null.workflows.rerunAll', (node) => (0, workflowActions_1.runAction)(tree, node, 'rerunAll')), vscode.commands.registerCommand('null.workflows.rerunFailed', (node) => (0, workflowActions_1.runAction)(tree, node, 'rerunFailed')), vscode.commands.registerCommand('null.workflows.rerunJob', (node) => (0, workflowActions_1.runAction)(tree, node, 'rerunJob')), vscode.commands.registerCommand('null.workflows.cancel', (node) => (0, workflowActions_1.runAction)(tree, node, 'cancel')), vscode.commands.registerCommand('null.workflows.enable', (node) => (0, workflowActions_1.enable)(tree, node)), vscode.commands.registerCommand('null.workflows.dispatch', (node) => (0, workflowActions_1.dispatch)(tree, node)), vscode.commands.registerCommand('null.workflows.filter', async () => {
        if (tree.state !== 'ready') {
            void vscode.window.showInformationMessage('Open the GitHub Actions view of a folder with a GitHub remote first.');
            return;
        }
        const next = await (0, workflowFilterMenu_1.editFilter)(tree.filter, workflowFiles);
        if (next)
            await applyFilter(next);
    }), vscode.commands.registerCommand('null.workflows.filterByWorkflow', async (node) => {
        if (node.kind === 'workflow') {
            const file = path.posix.basename(node.workflow.path);
            if ((0, workflowsModel_1.isWorkflowFile)(file))
                await applyFilter({ ...tree.filter, workflow: file });
        }
    }), 
    // Test seam for the integration spec (like _null.pulls.snapshot): the view's state and per-repo counts.
    vscode.commands.registerCommand('_null.workflows.snapshot', async () => {
        await tree.ensureLoaded();
        return tree.snapshot();
    }), tree.onDidLoad(rearm), 
    // Nothing is fetched until the view is first shown.
    view.onDidChangeVisibility(e => { if (e.visible && !tree.loaded)
        void refresh(); }), view.onDidChangeVisibility(e => { if (e.visible)
        rearm();
    else
        stop(); }), { dispose: stop }, 
    // Coming back to the window picks up new runs, at most once a minute and only while the view is shown.
    vscode.window.onDidChangeWindowState(e => {
        if (e.focused && tree.loaded && view.visible && Date.now() - lastRefresh > FOCUS_REFRESH_MIN_MS)
            void refresh();
    }));
    if (view.visible)
        void refresh();
    // Binding or importing an account must show up without a manual refresh, but never wakes a view nobody opened.
    const accountsChanged = (0, githubAuth_1.getAccountsApi)()?.onDidChange(() => { if (tree.loaded)
        void refresh(); });
    if (accountsChanged)
        context.subscriptions.push(accountsChanged);
    // The branch marker follows vscode.git: one cheap `symbolic-ref` per repo, and a redraw only when a branch really changed.
    void (0, gitApi_1.getGitApi)().then(git => {
        const subs = git.repositories.map(r => r.state.onDidChange(() => { if (view.visible && tree.loaded)
            void tree.refreshBranches(); }));
        context.subscriptions.push(...subs);
    }, () => undefined);
}
//# sourceMappingURL=workflowsIntegration.js.map
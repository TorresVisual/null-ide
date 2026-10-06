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
exports.registerIssuesPanelFeature = registerIssuesPanelFeature;
const vscode = __importStar(require("vscode"));
const issuesStore_1 = require("./github/issuesStore");
const issuesPanel_1 = require("./issuesPanel");
const issueDetailPanel_1 = require("./issueDetailPanel");
const githubRemote_1 = require("./github/githubRemote");
const githubAuth_1 = require("./github/githubAuth");
const githubApi_1 = require("./github/githubApi");
const gitBranch_1 = require("./github/gitBranch");
function registerIssuesPanelFeature(context) {
    const store = new issuesStore_1.IssuesStore(() => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null);
    const provider = new issuesPanel_1.IssuesViewProvider(context.extensionUri, store, context.globalState);
    issueDetailPanel_1.IssueDetailPanel.configure(context.workspaceState, issue => provider.insertCreated(issue));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('null.issuesView', provider, {
        webviewOptions: { retainContextWhenHidden: true },
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.issues.create', () => provider.createIssue()));
    context.subscriptions.push(vscode.commands.registerCommand('null.issues.openFullView', () => provider.openFullView()));
    context.subscriptions.push(vscode.commands.registerCommand('null.issues.refresh', async () => {
        await provider.refresh();
        await refreshIssueCountBar();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.issues.signIn', async () => {
        await provider.signIn();
        await refreshIssueCountBar();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.issues.markRead', () => provider.markRead()));
    context.subscriptions.push(vscode.commands.registerCommand('null.issues.linkFromCommitMessage', linkFromCommitMessage));
    context.subscriptions.push(vscode.commands.registerCommand('null.issues.insertReference', insertIssueReference));
    watchIssueBranches(context, store);
    const countBar = vscode.window.createStatusBarItem('null.issuesCount', vscode.StatusBarAlignment.Left, 4);
    countBar.command = 'null.issuesView.focus';
    context.subscriptions.push(countBar);
    async function refreshIssueCountBar() {
        try {
            const { repo, open, mine } = await store.getOpenCounts();
            countBar.text = mine > 0 ? `$(issues) ${open} (${mine} mine)` : `$(issues) ${open}`;
            countBar.tooltip = `${open} open issue${open === 1 ? '' : 's'} in ${repo.owner}/${repo.repo}`
                + (mine > 0 ? ` (${mine} assigned to you)` : '');
            countBar.show();
        }
        catch {
            countBar.hide(); // no folder, no GitHub remote, signed out, offline: nothing trustworthy to show
        }
    }
    // GitHub's search index lags a few seconds behind writes, so a change waits before re-counting, and bursts collapse.
    let recount;
    const scheduleRecount = () => {
        clearTimeout(recount);
        recount = setTimeout(() => void refreshIssueCountBar(), 3000);
    };
    const REFRESH_MS = 5 * 60 * 1000;
    const poll = setInterval(() => void refreshIssueCountBar(), REFRESH_MS);
    context.subscriptions.push({ dispose: store.onDidChange(scheduleRecount) }, { dispose: () => { clearTimeout(recount); clearInterval(poll); } }, vscode.workspace.onDidChangeWorkspaceFolders(() => refreshIssueCountBar()), vscode.window.onDidChangeWindowState(state => { if (state.focused)
        void refreshIssueCountBar(); }));
    void refreshIssueCountBar();
}
// ponytail: VS Code's SCM input box exposes only `.value` (a string) to
// third-party extensions — there's no public document/URI to register a
// DocumentLinkProvider against (that needs a proposed API the built-in
// GitHub PR/Issues extension gets but we don't). This quick-pick, triggered
// from the SCM title bar, is the documented fallback in the design spec.
async function linkFromCommitMessage() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        void vscode.window.showErrorMessage('Open a folder first.');
        return;
    }
    const cwd = folders[0].uri.fsPath;
    const repo = (0, githubRemote_1.getWorkspaceGithubRepo)(cwd);
    if (!repo) {
        void vscode.window.showInformationMessage('This folder has no GitHub remote.');
        return;
    }
    const scmRepo = await getScmRepo(cwd);
    if (!scmRepo)
        return;
    const message = scmRepo.inputBox.value ?? '';
    const numbers = [...new Set([...message.matchAll(/#(\d+)/g)].map(m => Number(m[1])))];
    if (numbers.length === 0) {
        void vscode.window.showInformationMessage('No issue references (#N) found in the commit message.');
        return;
    }
    let number = numbers[0];
    if (numbers.length > 1) {
        const picked = await vscode.window.showQuickPick(numbers.map(String), { placeHolder: 'Open which referenced issue?' });
        number = picked ? Number(picked) : undefined;
    }
    if (number === undefined)
        return;
    await vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${repo.owner}/${repo.repo}/issues/${number}`));
}
// Reverse of linkFromCommitMessage: pick an open issue and a reference style,
// then insert it into the SCM input box instead of parsing it back out.
async function insertIssueReference() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        void vscode.window.showErrorMessage('Open a folder first.');
        return;
    }
    const cwd = folders[0].uri.fsPath;
    const repo = (0, githubRemote_1.getWorkspaceGithubRepo)(cwd);
    if (!repo) {
        void vscode.window.showInformationMessage('This folder has no GitHub remote.');
        return;
    }
    const scmRepo = await getScmRepo(cwd);
    if (!scmRepo)
        return;
    const session = await (0, githubAuth_1.getGithubSession)(true);
    if (!session)
        return;
    let issues;
    try {
        issues = await (0, githubApi_1.fetchIssues)(repo.owner, repo.repo, 'open', session.accessToken);
    }
    catch (err) {
        void vscode.window.showErrorMessage(`Failed to fetch issues: ${err.message}`);
        return;
    }
    if (issues.length === 0) {
        void vscode.window.showInformationMessage('No open issues found.');
        return;
    }
    const pickedIssue = await vscode.window.showQuickPick(issues.map(issue => ({ label: `#${issue.number}`, description: issue.title, issue })), { placeHolder: 'Reference which issue?' });
    if (!pickedIssue)
        return;
    const n = pickedIssue.issue.number;
    const style = await vscode.window.showQuickPick([
        { label: `#${n}`, description: 'Reference only' },
        { label: `Closes #${n}`, description: 'Closes the issue once this commit reaches the default branch' },
        { label: `Fixes #${n}`, description: 'Fixes the issue once this commit reaches the default branch' },
    ], { placeHolder: 'Reference style?' });
    if (!style)
        return;
    const current = scmRepo.inputBox.value;
    scmRepo.inputBox.value = current ? `${current}\n\n${style.label}` : style.label;
}
async function getScmRepo(cwd) {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt) {
        void vscode.window.showErrorMessage('Built-in git extension not found.');
        return undefined;
    }
    const git = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate()).getAPI(1);
    return git.repositories.find((r) => r.rootUri.fsPath === cwd) ?? git.repositories[0];
}
/** #54: offer to open the issue when the user switches to an `issue-<n>-…` branch. */
function watchIssueBranches(context, store) {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt)
        return;
    const sameRepoAsWorkspace = (root) => {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const mine = cwd ? (0, githubRemote_1.getWorkspaceGithubRepo)(cwd) : null;
        const theirs = (0, githubRemote_1.getWorkspaceGithubRepo)(root);
        return !!mine && !!theirs && mine.owner === theirs.owner && mine.repo === theirs.repo;
    };
    const offer = async (n) => {
        let title;
        try {
            title = (await store.getDetail(n)).issue.title;
        }
        catch {
            return; // signed out, offline, a PR number, a deleted issue: a courtesy prompt stays quiet
        }
        const pick = await vscode.window.showInformationMessage(`Branch refers to #${n}: ${title}`, 'Open', 'Not now');
        if (pick === 'Open')
            await issueDetailPanel_1.IssueDetailPanel.show(context.extensionUri, store, n);
    };
    const watch = (repo) => {
        const root = repo.rootUri.fsPath;
        gitBranch_1.branchIssueTracker.onHead(root, repo.state.HEAD?.name); // records the starting branch
        context.subscriptions.push(repo.state.onDidChange(() => {
            const n = gitBranch_1.branchIssueTracker.onHead(root, repo.state.HEAD?.name);
            if (n !== null && sameRepoAsWorkspace(root))
                void offer(n);
        }));
    };
    void (async () => {
        try {
            const git = (gitExt.isActive ? gitExt.exports : await gitExt.activate()).getAPI(1);
            git.repositories.forEach(watch);
            context.subscriptions.push(git.onDidOpenRepository(watch));
        }
        catch {
            // git extension disabled: no branch prompts
        }
    })();
}
//# sourceMappingURL=issuesPanelIntegration.js.map
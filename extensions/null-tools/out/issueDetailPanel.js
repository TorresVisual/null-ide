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
exports.IssueDetailPanel = void 0;
const vscode = __importStar(require("vscode"));
const webviewUtils_1 = require("./webviewUtils");
const promptFormat_1 = require("./github/promptFormat");
const gitBranch_1 = require("./github/gitBranch");
const taskList_1 = require("./github/taskList");
const issueTemplates_1 = require("./github/issueTemplates");
class IssueDetailPanel {
    extensionUri;
    store;
    static current;
    panel;
    issueNumber = 0;
    creating = false;
    onCreated;
    static async show(extensionUri, store, issueNumber) {
        IssueDetailPanel.open(extensionUri, store);
        await IssueDetailPanel.current.openIssue(issueNumber);
    }
    static async showCreate(extensionUri, store, onCreated) {
        IssueDetailPanel.open(extensionUri, store);
        await IssueDetailPanel.current.openCreate(onCreated);
    }
    static open(extensionUri, store) {
        if (IssueDetailPanel.current) {
            IssueDetailPanel.current.panel.reveal(vscode.ViewColumn.Active);
        }
        else {
            const panel = vscode.window.createWebviewPanel('null-tools.issueDetail', 'Issue', vscode.ViewColumn.Active, {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'lib')],
            });
            panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'github-issues.svg');
            IssueDetailPanel.current = new IssueDetailPanel(panel, extensionUri, store);
        }
    }
    constructor(panel, extensionUri, store) {
        this.extensionUri = extensionUri;
        this.store = store;
        this.panel = panel;
        this.panel.webview.html = this._buildHtml();
        this.panel.webview.onDidReceiveMessage((msg) => this._handleMessage(msg));
        this.panel.onDidDispose(() => {
            IssueDetailPanel.current = undefined;
        });
    }
    async openIssue(issueNumber) {
        this.creating = false;
        this.issueNumber = issueNumber;
        this.panel.title = `Issue #${issueNumber}`;
        await this._sendDetail();
    }
    async openCreate(onCreated) {
        this.creating = true;
        this.onCreated = onCreated;
        this.panel.title = 'New Issue';
        await this._sendDetail();
    }
    async _sendDetail() {
        if (this.creating) {
            let repoLabels, assignableUsers;
            try {
                [repoLabels, assignableUsers] = await Promise.all([
                    this.store.getRepoLabels(),
                    this.store.getAssignableUsers(),
                ]);
            }
            catch (err) {
                this.panel.webview.postMessage({ type: 'issueDetailError', message: err.message });
                return;
            }
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const templates = cwd ? (0, issueTemplates_1.loadIssueTemplates)(cwd) : [];
            this.panel.webview.postMessage({
                type: 'issueDetail',
                issue: null, comments: [], timeline: [], repoLabels, assignableUsers, templates,
                viewerLogin: this.store.getViewerLogin(),
            });
            return;
        }
        const issue = this.store.getByNumber(this.issueNumber);
        if (!issue)
            return;
        let comments, timeline, repoLabels, assignableUsers;
        try {
            [comments, timeline, repoLabels, assignableUsers] = await Promise.all([
                this.store.getComments(this.issueNumber),
                this.store.getTimeline(this.issueNumber),
                this.store.getRepoLabels(),
                this.store.getAssignableUsers(),
            ]);
        }
        catch (err) {
            this.panel.webview.postMessage({ type: 'issueDetailError', message: err.message });
            return;
        }
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const closedLocally = issue.state === 'open' && !!cwd && (0, gitBranch_1.getLocallyClosedIssueNumbers)(cwd).has(issue.number);
        this.panel.webview.postMessage({
            type: 'issueDetail',
            issue: closedLocally ? { ...issue, closedLocally } : issue,
            comments, timeline, repoLabels, assignableUsers,
            viewerLogin: this.store.getViewerLogin(),
        });
    }
    async _handleMessage(msg) {
        switch (msg.type) {
            case 'ready':
                await this._sendDetail();
                break;
            case 'refresh':
                try {
                    await this.store.reloadIssue(this.issueNumber);
                }
                catch (err) {
                    void vscode.window.showErrorMessage(`Failed to refresh issue: ${err.message}`);
                }
                await this._sendDetail();
                break;
            case 'copyAsPrompt': {
                const issue = this.store.getByNumber(this.issueNumber);
                if (!issue)
                    break;
                await vscode.env.clipboard.writeText((0, promptFormat_1.formatIssueAsPrompt)(issue));
                this.panel.webview.postMessage({ type: 'copied' });
                break;
            }
            case 'openInBrowser': {
                const issue = this.store.getByNumber(this.issueNumber);
                if (issue)
                    await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
                break;
            }
            case 'setState': {
                try {
                    await this.store.updateIssue(this.issueNumber, { state: msg.state });
                    await this._sendDetail();
                }
                catch (err) {
                    void vscode.window.showErrorMessage(`Failed to update issue: ${err.message}`);
                }
                break;
            }
            case 'toggleTask': {
                const issue = this.store.getByNumber(this.issueNumber);
                const newBody = issue?.body ? (0, taskList_1.toggleTaskCheckbox)(issue.body, msg.index, msg.checked) : null;
                if (newBody === null)
                    break;
                try {
                    await this.store.updateIssue(this.issueNumber, { body: newBody });
                }
                catch (err) {
                    void vscode.window.showErrorMessage(`Failed to update checkbox: ${err.message}`);
                }
                await this._sendDetail();
                break;
            }
            case 'saveEdit': {
                try {
                    await this.store.updateIssue(this.issueNumber, {
                        title: msg.title, body: msg.body, labels: msg.labels, assignees: msg.assignees,
                    });
                    await this._sendDetail();
                }
                catch (err) {
                    void vscode.window.showErrorMessage(`Failed to save issue: ${err.message}`);
                }
                break;
            }
            case 'createBranch': {
                const issue = this.store.getByNumber(this.issueNumber);
                const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!issue || !cwd)
                    break;
                const result = (0, gitBranch_1.createIssueBranch)(cwd, issue.number, issue.title);
                if (result.ok)
                    void vscode.window.showInformationMessage(`Switched to branch ${result.branch}`);
                else
                    void vscode.window.showErrorMessage(`Failed to create branch: ${result.message}`);
                break;
            }
            case 'createWorktree': {
                const issue = this.store.getByNumber(this.issueNumber);
                if (!issue)
                    break;
                await vscode.commands.executeCommand('null.worktrees.createForIssue', issue.number, issue.title);
                break;
            }
            case 'postComment': {
                try {
                    await this.store.addComment(this.issueNumber, msg.body);
                    await this._sendDetail();
                }
                catch (err) {
                    void vscode.window.showErrorMessage(`Failed to post comment: ${err.message}`);
                    this.panel.webview.postMessage({ type: 'commentPostFailed' });
                }
                break;
            }
            case 'editComment': {
                try {
                    await this.store.updateComment(msg.commentId, msg.body);
                    await this._sendDetail();
                }
                catch (err) {
                    void vscode.window.showErrorMessage(`Failed to update comment: ${err.message}`);
                }
                break;
            }
            case 'deleteComment': {
                const confirmed = await vscode.window.showWarningMessage('Delete this comment?', { modal: true }, 'Delete');
                if (confirmed !== 'Delete')
                    break;
                try {
                    await this.store.deleteComment(this.issueNumber, msg.commentId);
                    await this._sendDetail();
                }
                catch (err) {
                    void vscode.window.showErrorMessage(`Failed to delete comment: ${err.message}`);
                }
                break;
            }
            case 'submitCreate': {
                try {
                    const created = await this.store.createIssue({
                        title: msg.title, body: msg.body, labels: msg.labels, assignees: msg.assignees,
                    });
                    this.onCreated?.();
                    await this.openIssue(created.number);
                }
                catch (err) {
                    void vscode.window.showErrorMessage(`Failed to create issue: ${err.message}`);
                    this.panel.webview.postMessage({ type: 'createFailed' });
                }
                break;
            }
            case 'cancelCreate':
                this.panel.dispose();
                break;
        }
    }
    _buildHtml() {
        const nonce = (0, webviewUtils_1.getNonce)();
        const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', 'issueDetail.js'));
        const markedUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', 'marked.js'));
        const purifyUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', 'purify.min.js'));
        const cssUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', 'issueDetail.css'));
        return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; img-src ${this.panel.webview.cspSource} https://avatars.githubusercontent.com;">
<link rel="stylesheet" href="${cssUri}">
</head><body>
<div id="detail"><div id="empty">Loading…</div></div>
<div id="lightbox" class="hidden"><img id="lightbox-img" src="" alt=""></div>
<script nonce="${nonce}" src="${markedUri}"></script>
<script nonce="${nonce}" src="${purifyUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
    }
}
exports.IssueDetailPanel = IssueDetailPanel;
//# sourceMappingURL=issueDetailPanel.js.map
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
class IssueDetailPanel {
    extensionUri;
    store;
    static current;
    panel;
    issueNumber = 0;
    static async show(extensionUri, store, issueNumber) {
        if (IssueDetailPanel.current) {
            IssueDetailPanel.current.panel.reveal(vscode.ViewColumn.Active);
        }
        else {
            const panel = vscode.window.createWebviewPanel('null-tools.issueDetail', `Issue #${issueNumber}`, vscode.ViewColumn.Active, {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'lib')],
            });
            IssueDetailPanel.current = new IssueDetailPanel(panel, extensionUri, store);
        }
        await IssueDetailPanel.current.open(issueNumber);
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
    async open(issueNumber) {
        this.issueNumber = issueNumber;
        this.panel.title = `Issue #${issueNumber}`;
        await this._sendDetail();
    }
    async _sendDetail() {
        const issue = this.store.getByNumber(this.issueNumber);
        if (!issue)
            return;
        const [comments, repoLabels, assignableUsers] = await Promise.all([
            this.store.getComments(this.issueNumber),
            this.store.getRepoLabels(),
            this.store.getAssignableUsers(),
        ]);
        this.panel.webview.postMessage({ type: 'issueDetail', issue, comments, repoLabels, assignableUsers });
    }
    async _handleMessage(msg) {
        switch (msg.type) {
            case 'ready':
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
            case 'postComment': {
                try {
                    await this.store.addComment(this.issueNumber, msg.body);
                    await this._sendDetail();
                }
                catch (err) {
                    void vscode.window.showErrorMessage(`Failed to post comment: ${err.message}`);
                }
                break;
            }
        }
    }
    _buildHtml() {
        const nonce = (0, webviewUtils_1.getNonce)();
        const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', 'issueDetail.js'));
        const markedUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', 'marked.js'));
        const purifyUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', 'purify.min.js'));
        return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; style-src ${this.panel.webview.cspSource} 'unsafe-inline';">
<style>
  html,body { margin:0; padding:0; height:100%; background:var(--vscode-editor-background); color:var(--vscode-foreground);
              font:13px/1.6 var(--vscode-font-family); }
  #detail { max-width:900px; margin:0 auto; padding:24px; }
  h2 { color:var(--vscode-foreground); display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .state-badge {
    font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.04em;
    padding:2px 8px; border-radius:10px; color:#fff; background:var(--vscode-charts-green,#89d185);
  }
  .state-badge.closed { background:var(--vscode-charts-purple,#b180d7); }
  .label-chip { display:inline-block; padding:0 5px; border-radius:8px; font-size:10px; margin-right:4px; color:#111; }
  .issue-meta { color:var(--vscode-descriptionForeground); font-size:11px; margin:6px 0; }
  .meta-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; color:var(--vscode-descriptionForeground); font-size:12px; margin:8px 0; }
  .avatar {
    width:20px; height:20px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center;
    font-size:9px; font-weight:700; color:#fff; flex-shrink:0;
  }
  .assignees-row { display:flex; align-items:center; gap:6px; margin:10px 0; }
  .assignees-label { text-transform:uppercase; letter-spacing:.06em; color:var(--vscode-descriptionForeground); font-size:10px; }
  .assignee-chip {
    display:inline-flex; align-items:center; gap:5px; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground);
    border-radius:12px; padding:2px 8px 2px 2px; font-size:11px;
  }
  .body-card {
    border:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); border-radius:6px; padding:14px; margin:14px 0;
    background:var(--vscode-editorWidget-background,rgba(128,128,128,.03));
  }
  .body-card, .comment-body { line-height:1.5; word-wrap:break-word; }
  .body-card > *:first-child, .comment-body > *:first-child { margin-top:0; }
  .body-card > *:last-child, .comment-body > *:last-child { margin-bottom:0; }
  .body-card h1, .body-card h2, .body-card h3, .comment-body h1, .comment-body h2, .comment-body h3 {
    border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); padding-bottom:.3em;
  }
  .body-card pre, .comment-body pre {
    background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.08)); padding:10px; border-radius:4px; overflow-x:auto;
  }
  .body-card code, .comment-body code {
    background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.08)); padding:1px 4px; border-radius:3px;
    font-family:var(--vscode-editor-font-family,monospace);
  }
  .body-card pre code, .comment-body pre code { background:none; padding:0; }
  .body-card blockquote, .comment-body blockquote {
    border-left:3px solid var(--vscode-widget-border,rgba(128,128,128,.3)); margin:0; padding:2px 12px; color:var(--vscode-descriptionForeground);
  }
  .body-card a, .comment-body a { color:var(--vscode-textLink-foreground); }
  .body-card table, .comment-body table { border-collapse:collapse; }
  .body-card th, .body-card td, .comment-body th, .comment-body td {
    border:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); padding:4px 8px;
  }
  .body-card ul.contains-task-list, .comment-body ul.contains-task-list { list-style:none; padding-left:.5em; }
  .btn-row { display:flex; gap:8px; margin:14px 0; flex-wrap:wrap; }
  button.btn { border:none; padding:6px 14px; border-radius:4px; cursor:pointer; font:inherit; font-weight:500; }
  button.btn-primary { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
  button.btn-primary:hover { background:var(--vscode-button-hoverBackground); }
  button.btn-secondary { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }
  button.btn-secondary:hover { background:var(--vscode-button-secondaryHoverBackground); }
  button.btn-danger { background:var(--vscode-errorForeground,#f14c4c); color:#fff; }
  button.btn-danger:hover { filter:brightness(1.1); }
  button.btn:disabled { opacity:.5; cursor:default; }
  .edit-form input, .edit-form textarea {
    width:100%; box-sizing:border-box; background:var(--vscode-input-background); color:var(--vscode-input-foreground);
    border:1px solid var(--vscode-input-border,transparent); border-radius:4px; padding:8px; font:inherit; margin-bottom:8px;
  }
  .edit-form input:focus, .edit-form textarea:focus, #comment-input:focus { outline:none; border-color:var(--vscode-focusBorder); }
  .edit-form textarea { min-height:160px; resize:vertical; }
  .picker-group { margin-bottom:10px; }
  .chip-picker { display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; }
  .chip-check { display:inline-flex; align-items:center; gap:4px; font-size:11px; cursor:pointer; }
  .chip-check input { margin:0; }
  h3 { font-size:13px; margin:22px 0 8px; }
  .comment { border-top:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); padding:10px 0; }
  .comment-author { color:var(--vscode-textLink-foreground); font-weight:600; }
  #composer { margin-top:10px; }
  #comment-input {
    width:100%; box-sizing:border-box; min-height:70px; resize:vertical; background:var(--vscode-input-background);
    color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border,transparent); border-radius:4px;
    padding:8px; font:inherit;
  }
  #composer .btn-row { justify-content:flex-end; }
  #empty { padding:20px; color:var(--vscode-descriptionForeground); }
</style></head><body>
<div id="detail"><div id="empty">Loading…</div></div>
<script nonce="${nonce}" src="${markedUri}"></script>
<script nonce="${nonce}" src="${purifyUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
    }
}
exports.IssueDetailPanel = IssueDetailPanel;
//# sourceMappingURL=issueDetailPanel.js.map
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
        const comments = await this.store.getComments(this.issueNumber);
        this.panel.webview.postMessage({ type: 'issueDetail', issue, comments });
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
        }
    }
    _buildHtml() {
        const nonce = (0, webviewUtils_1.getNonce)();
        const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', 'issueDetail.js'));
        return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; style-src ${this.panel.webview.cspSource} 'unsafe-inline';">
<style>
  html,body { margin:0; padding:0; height:100%; background:#181818; color:#ccc;
              font:13px/1.6 'Cascadia Code',Consolas,monospace; }
  #detail { max-width:900px; margin:0 auto; padding:24px; }
  h2 { color:#e0e0e0; }
  .label-chip { display:inline-block; padding:0 5px; border-radius:8px; font-size:10px; margin-right:4px; color:#111; }
  .issue-meta { color:#666; font-size:11px; margin:6px 0; }
  #detail-body { white-space:pre-wrap; margin:16px 0; color:#ccc; }
  .comment { border-top:1px solid #2b2b2b; padding:10px 0; }
  .comment-author { color:#4EC9B0; }
  button.action { background:#0078D4; color:#fff; border:none; padding:6px 12px; border-radius:2px; cursor:pointer; margin-right:6px; font:inherit; }
  button.action:hover { background:#106EBE; }
  #empty { padding:20px; color:#666; }
</style></head><body>
<div id="detail"><div id="empty">Loading…</div></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
    }
}
exports.IssueDetailPanel = IssueDetailPanel;
//# sourceMappingURL=issueDetailPanel.js.map
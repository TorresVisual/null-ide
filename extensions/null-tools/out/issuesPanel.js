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
exports.IssuesViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const webviewUtils_1 = require("./webviewUtils");
const githubAuth_1 = require("./github/githubAuth");
const issueDetailPanel_1 = require("./issueDetailPanel");
class IssuesViewProvider {
    _extensionUri;
    _store;
    _view;
    _state = 'open';
    _filters = { labels: [], assignee: 'everyone', query: '', viewerLogin: null };
    constructor(_extensionUri, _store) {
        this._extensionUri = _extensionUri;
        this._store = _store;
    }
    resolveWebviewView(webviewView) {
        const webview = webviewView.webview;
        this._view = webview;
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'lib')],
        };
        webview.html = this._buildHtml(webview);
        webview.onDidReceiveMessage((msg) => this._handleMessage(msg));
    }
    async refresh() {
        await this._sendIssues();
    }
    async signIn() {
        await (0, githubAuth_1.getGithubSession)(true);
        await this._sendIssues();
    }
    _cwd() {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    }
    async _sendIssues() {
        if (!this._view)
            return;
        const result = await this._store.refresh(this._cwd(), this._state);
        if (result.status !== 'ok') {
            this._view.postMessage({
                type: 'issues',
                status: result.status,
                message: 'message' in result ? result.message : undefined,
            });
            return;
        }
        this._filters = { ...this._filters, viewerLogin: result.viewerLogin };
        this._view.postMessage({ type: 'issues', status: 'ok', issues: this._store.getFiltered(this._filters) });
    }
    async _handleMessage(msg) {
        switch (msg.type) {
            case 'ready':
                this._view?.postMessage({ type: 'init', state: this._state });
                await this._sendIssues();
                break;
            case 'setState':
                this._state = msg.state;
                await this._sendIssues();
                break;
            case 'setFilters':
                this._filters = { ...this._filters, labels: msg.labels, assignee: msg.assignee, query: msg.query };
                this._view?.postMessage({ type: 'issues', status: 'ok', issues: this._store.getFiltered(this._filters) });
                break;
            case 'selectIssue': {
                const issue = this._store.getByNumber(msg.number);
                if (!issue)
                    break;
                await issueDetailPanel_1.IssueDetailPanel.show(this._extensionUri, this._store, msg.number);
                break;
            }
            case 'signIn':
                await this.signIn();
                break;
        }
    }
    _buildHtml(webview) {
        const nonce = (0, webviewUtils_1.getNonce)();
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'issues.js'));
        return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
<style>
  html,body { margin:0; padding:0; height:100%; background:#181818; color:#ccc;
              font:12px/1.5 'Cascadia Code',Consolas,monospace; }
  #app { display:flex; flex-direction:column; height:100%; }
  #toolbar { display:flex; flex-wrap:wrap; gap:6px; padding:8px; border-bottom:1px solid #2b2b2b; flex-shrink:0; }
  #toolbar input, #toolbar select { background:#1e1e1e; border:1px solid #333; color:#ccc; padding:4px 6px; font:inherit; border-radius:2px; }
  #toolbar input { flex:1; min-width:80px; }
  .assignee-btn { background:#1e1e1e; border:1px solid #333; color:#888; padding:4px 8px; cursor:pointer; border-radius:2px; }
  .assignee-btn.active { color:#e0e0e0; border-color:#0078D4; }
  #list { flex:1; overflow-y:auto; }
  .issue-row { padding:8px 10px; border-bottom:1px solid #222; cursor:pointer; }
  .issue-row:hover { background:#1e1e1e; }
  .issue-row.selected { background:#242424; border-left:2px solid #4EC9B0; }
  .issue-num { color:#666; }
  .issue-title { color:#e0e0e0; }
  .issue-meta { color:#666; font-size:11px; margin-top:2px; }
  .label-chip { display:inline-block; padding:0 5px; border-radius:8px; font-size:10px; margin-right:4px; color:#111; }
  button.action { background:#0078D4; color:#fff; border:none; padding:5px 10px; border-radius:2px; cursor:pointer; margin-right:6px; }
  button.action:hover { background:#106EBE; }
  #empty { padding:20px; color:#666; text-align:center; }
</style></head><body>
<div id="app">
  <div id="toolbar">
    <select id="state-select">
      <option value="open">Open</option>
      <option value="closed">Closed</option>
      <option value="all">All</option>
    </select>
    <button class="assignee-btn active" id="assignee-everyone">Everyone</button>
    <button class="assignee-btn" id="assignee-me">Assigned to me</button>
    <input id="label-input" placeholder="labels, comma-separated">
    <input id="search-input" placeholder="Search title &amp; body">
  </div>
  <div id="list"><div id="empty">Loading…</div></div>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
    }
}
exports.IssuesViewProvider = IssuesViewProvider;
//# sourceMappingURL=issuesPanel.js.map
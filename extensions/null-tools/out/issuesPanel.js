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
const githubRemote_1 = require("./github/githubRemote");
const issueDetailPanel_1 = require("./issueDetailPanel");
const gitBranch_1 = require("./github/gitBranch");
const promptFormat_1 = require("./github/promptFormat");
const issueFilter_1 = require("./github/issueFilter");
class IssuesViewProvider {
    _extensionUri;
    _store;
    _globalState;
    _view;
    _webviewView;
    _state = 'open';
    _filters = { labels: [], assignee: 'everyone', query: '', viewerLogin: null };
    constructor(_extensionUri, _store, _globalState) {
        this._extensionUri = _extensionUri;
        this._store = _store;
        this._globalState = _globalState;
    }
    resolveWebviewView(webviewView) {
        const webview = webviewView.webview;
        this._view = webview;
        this._webviewView = webviewView;
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'lib')],
        };
        webview.html = this._buildHtml(webview);
        webview.onDidReceiveMessage((msg) => this._handleMessage(msg));
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible)
                this.markRead();
        });
        if (webviewView.visible)
            this.markRead();
    }
    async refresh() {
        await this._sendIssues();
    }
    /** Advances the per-repo "last seen" watermark to now (or the newest known issue) and clears the badge. */
    markRead() {
        const repo = this._store.getRepo();
        if (!repo)
            return;
        const lastSeen = (0, issueFilter_1.newestUpdateTime)(this._store.getAllIssues()) || Date.now();
        void this._globalState.update(this._lastSeenKey(repo), lastSeen);
        if (this._webviewView)
            this._webviewView.badge = undefined;
    }
    _lastSeenKey(repo) {
        return `null.issues.lastSeen:${repo.owner}/${repo.repo}`;
    }
    _cacheKey(repo, state) {
        return `null.issues.cache:${repo.owner}/${repo.repo}:${state}`;
    }
    /** Paints the last successfully-fetched issue list for this repo/state, if any, before the network call resolves. */
    _paintFromCache(cwd) {
        if (!this._view || !cwd)
            return false;
        const repo = (0, githubRemote_1.getWorkspaceGithubRepo)(cwd);
        if (!repo)
            return false;
        const cached = this._globalState.get(this._cacheKey(repo, this._state));
        if (!cached)
            return false;
        this._store.hydrateFromCache(repo, cached.issues, cached.viewerLogin);
        this._filters = { ...this._filters, viewerLogin: cached.viewerLogin };
        this._view.postMessage({
            type: 'issues',
            status: 'ok',
            issues: this._withClosedLocally(this._store.getFiltered(this._filters)),
            viewerLogin: cached.viewerLogin,
            repoLabels: cached.repoLabels,
        });
        return true;
    }
    // ponytail: resolveWebviewView only fires once the panel has actually been
    // opened (or was left open last session), so the badge can't appear before
    // that first open in a cold session — VS Code gives webview views no way to
    // badge an unresolved container. No workaround worth the UX cost of forcing
    // the panel open.
    _updateUnreadBadge() {
        if (!this._webviewView)
            return;
        const repo = this._store.getRepo();
        if (!repo) {
            this._webviewView.badge = undefined;
            return;
        }
        if (this._webviewView.visible) {
            this.markRead();
            return;
        }
        const key = this._lastSeenKey(repo);
        const lastSeen = this._globalState.get(key, 0);
        const issues = this._store.getAllIssues();
        if (lastSeen === 0) {
            void this._globalState.update(key, (0, issueFilter_1.newestUpdateTime)(issues) || Date.now());
            this._webviewView.badge = undefined;
            return;
        }
        const unread = (0, issueFilter_1.relevantToViewer)(issues, this._filters.viewerLogin)
            .filter(issue => new Date(issue.updated_at).getTime() > lastSeen);
        this._webviewView.badge = unread.length > 0
            ? { value: unread.length, tooltip: `${unread.length} unread issue${unread.length === 1 ? '' : 's'}` }
            : undefined;
    }
    async createIssue() {
        await issueDetailPanel_1.IssueDetailPanel.showCreate(this._extensionUri, this._store, () => this._sendIssues());
    }
    async signIn() {
        await (0, githubAuth_1.getGithubSession)(true);
        await this._sendIssues();
    }
    _cwd() {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    }
    _withClosedLocally(issues) {
        const cwd = this._cwd();
        if (!cwd)
            return issues;
        const closedNumbers = (0, gitBranch_1.getLocallyClosedIssueNumbers)(cwd);
        if (closedNumbers.size === 0)
            return issues;
        return issues.map(issue => issue.state === 'open' && closedNumbers.has(issue.number) ? { ...issue, closedLocally: true } : issue);
    }
    async _sendIssues() {
        if (!this._view)
            return;
        const cwd = this._cwd();
        const hadCache = this._paintFromCache(cwd);
        const result = await this._store.refresh(this._state);
        if (result.status !== 'ok') {
            // Offline/rate-limited: leave the cached list on screen rather than replacing it with an error.
            // Deterministic state changes (signed out, remote removed, no workspace) must still update the
            // UI even if a stale cache exists, or the panel would show issues forever with no way to notice.
            if (!hadCache || result.status !== 'error') {
                this._view.postMessage({
                    type: 'issues',
                    status: result.status,
                    message: 'message' in result ? result.message : undefined,
                });
            }
            return;
        }
        this._filters = { ...this._filters, viewerLogin: result.viewerLogin };
        // A failed label fetch must not blank a list that just loaded fine.
        const repoLabels = await this._store.getRepoLabels().catch(() => []);
        this._view.postMessage({
            type: 'issues',
            status: 'ok',
            issues: this._withClosedLocally(this._store.getFiltered(this._filters)),
            viewerLogin: result.viewerLogin,
            repoLabels,
        });
        void this._globalState.update(this._cacheKey(result.repo, this._state), {
            issues: this._store.getAllIssues(), viewerLogin: result.viewerLogin, repoLabels,
        });
        this._updateUnreadBadge();
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
                // No repoLabels here: this fires on every filter keystroke, and re-fetching them would mean
                // a synchronous git spawn (ensureSession) per keystroke. The webview keeps its last picker.
                this._view?.postMessage({
                    type: 'issues',
                    status: 'ok',
                    issues: this._withClosedLocally(this._store.getFiltered(this._filters)),
                    viewerLogin: this._filters.viewerLogin,
                });
                break;
            case 'selectIssue': {
                const issue = this._store.getByNumber(msg.number);
                if (!issue)
                    break;
                await issueDetailPanel_1.IssueDetailPanel.show(this._extensionUri, this._store, msg.number);
                break;
            }
            case 'createIssue':
                await this.createIssue();
                break;
            case 'signIn':
                await this.signIn();
                break;
            case 'refresh':
                await this._sendIssues();
                break;
            case 'markRead':
                this.markRead();
                break;
            case 'openIssueInBrowser': {
                const issue = this._store.getByNumber(msg.number);
                if (issue)
                    await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
                break;
            }
            case 'createBranchForIssue': {
                const issue = this._store.getByNumber(msg.number);
                const cwd = this._cwd();
                if (!issue || !cwd)
                    break;
                const result = (0, gitBranch_1.createIssueBranch)(cwd, issue.number, issue.title);
                if (result.ok)
                    void vscode.window.showInformationMessage(`Switched to branch ${result.branch}`);
                else
                    void vscode.window.showErrorMessage(`Failed to create branch: ${result.message}`);
                break;
            }
            case 'createWorktreeForIssue': {
                const issue = this._store.getByNumber(msg.number);
                if (!issue)
                    break;
                await vscode.commands.executeCommand('null.worktrees.createForIssue', issue.number, issue.title);
                break;
            }
            case 'copyAsPromptForIssue': {
                const issue = this._store.getByNumber(msg.number);
                if (!issue)
                    break;
                await vscode.env.clipboard.writeText((0, promptFormat_1.formatIssueAsPrompt)(issue));
                this._view?.postMessage({ type: 'copiedIssue', number: msg.number });
                break;
            }
        }
    }
    _buildHtml(webview) {
        const nonce = (0, webviewUtils_1.getNonce)();
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'issues.js'));
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'issueList.css'));
        const sharedCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'issues.css'));
        return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
<link rel="stylesheet" href="${sharedCssUri}">
<link rel="stylesheet" href="${cssUri}">
</head><body>
<div id="app">
  <div id="toolbar">
    <span id="toolbar-title">Issues</span>
    <select id="state-select">
      <option value="open">Open</option>
      <option value="closed">Closed</option>
      <option value="all">All</option>
    </select>
    <div class="toolbar-divider"></div>
    <button class="icon-btn" id="new-issue-btn" title="New issue"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 2v12M2 8h12" stroke-linecap="round"/></svg></button>
    <button class="icon-btn" id="refresh-btn" title="Refresh"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M13 4v3h-3M3 12v-3h3" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 6.5a5 5 0 0 1 9-2M12.5 9.5a5 5 0 0 1-9 2" stroke-linecap="round"/></svg></button>
    <button class="icon-btn" id="mark-read-btn" title="Mark Issues as Read"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 8l3.5 3.5L9 6.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 8l3.5 3.5L15 6.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <div class="toolbar-divider"></div>
    <button class="icon-btn" id="search-toggle-btn" title="Search"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10L14 14" stroke-linecap="round"/></svg></button>
    <button class="icon-btn" id="filter-toggle-btn" title="Filter"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 3h12L9.5 8v4.5L6.5 14V8L2 3z" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  </div>
  <div id="search-bar" class="hidden">
    <input id="search-input" placeholder="Search title &amp; body">
  </div>
  <div id="filter-popover" class="hidden">
    <div>
      <button class="assignee-btn active" id="assignee-everyone">Everyone</button>
      <button class="assignee-btn" id="assignee-me">Assigned to me</button>
    </div>
    <div id="label-picker" class="dropdown-container"><span class="issue-meta">Loading labels…</span></div>
  </div>
  <div id="list"><div id="empty">Loading…</div></div>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
    }
}
exports.IssuesViewProvider = IssuesViewProvider;
//# sourceMappingURL=issuesPanel.js.map
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
const issueFilter_1 = require("./github/issueFilter");
const issuesListController_1 = require("./issuesListController");
/** Owns the sidebar list and, on request, one full-width tab; both are `IssuesListController`s over the same store. */
class IssuesViewProvider {
    _extensionUri;
    _store;
    _globalState;
    _webviewView;
    _fullView;
    _controllers = new Set();
    _badgeItems = [];
    constructor(_extensionUri, _store, _globalState) {
        this._extensionUri = _extensionUri;
        this._store = _store;
        this._globalState = _globalState;
    }
    resolveWebviewView(webviewView) {
        this._webviewView = webviewView;
        const webview = webviewView.webview;
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'lib')],
        };
        webview.html = buildListHtml(webview, this._extensionUri);
        this._attach(webview, true, () => { if (this._webviewView === webviewView)
            this._webviewView = undefined; }, webviewView);
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible)
                this.markRead();
        });
        if (webviewView.visible)
            this.markRead();
    }
    openFullView() {
        if (this._fullView) {
            this._fullView.reveal();
            return;
        }
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const repo = cwd ? (0, githubRemote_1.getWorkspaceGithubRepo)(cwd) : null;
        const panel = vscode.window.createWebviewPanel('null-tools.issuesFull', repo ? `Issues · ${repo.owner}/${repo.repo}` : 'Issues', vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'lib')],
        });
        panel.iconPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'github-issues.svg');
        panel.webview.html = buildListHtml(panel.webview, this._extensionUri);
        this._fullView = panel;
        this._attach(panel.webview, false, () => { this._fullView = undefined; }, panel);
    }
    _attach(webview, compact, onGone, owner) {
        const controller = new issuesListController_1.IssuesListController(webview, this._extensionUri, this._store, this._globalState, this, compact);
        this._controllers.add(controller);
        owner.onDidDispose(() => {
            controller.dispose();
            this._controllers.delete(controller);
            onGone();
        });
    }
    async refresh() {
        await Promise.all([...this._controllers].map(c => c.refresh()));
    }
    async signIn() {
        await (0, githubAuth_1.getGithubSession)(true).then(() => undefined, () => undefined);
        await this.refresh();
    }
    async createIssue() {
        await issueDetailPanel_1.IssueDetailPanel.showCreate(this._extensionUri, this._store, issue => {
            for (const controller of this._controllers)
                controller.insertCreated(issue);
        });
    }
    onDefaultResults(items) {
        this._badgeItems = items;
        this._updateUnreadBadge();
    }
    /** Advances the per-repo "last seen" watermark to now (or the newest known issue) and clears the badge. */
    markRead() {
        const repo = this._store.getRepo();
        if (!repo)
            return;
        const lastSeen = (0, issueFilter_1.newestUpdateTime)(this._badgeItems) || Date.now();
        void this._globalState.update(this._lastSeenKey(repo), lastSeen);
        if (this._webviewView)
            this._webviewView.badge = undefined;
    }
    _lastSeenKey(repo) {
        return `null.issues.lastSeen:${repo.owner}/${repo.repo}`;
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
        if (lastSeen === 0) {
            void this._globalState.update(key, (0, issueFilter_1.newestUpdateTime)(this._badgeItems) || Date.now());
            this._webviewView.badge = undefined;
            return;
        }
        const unread = (0, issueFilter_1.relevantToViewer)(this._badgeItems, this._store.getViewerLogin())
            .filter(issue => new Date(issue.updated_at).getTime() > lastSeen);
        this._webviewView.badge = unread.length > 0
            ? { value: unread.length, tooltip: `${unread.length} unread issue${unread.length === 1 ? '' : 's'}` }
            : undefined;
    }
}
exports.IssuesViewProvider = IssuesViewProvider;
function buildListHtml(webview, extensionUri) {
    const nonce = (0, webviewUtils_1.getNonce)();
    const lib = (file) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'lib', file));
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https://avatars.githubusercontent.com;">
<link rel="stylesheet" href="${lib('issues.css')}">
<link rel="stylesheet" href="${lib('issueList.css')}">
</head><body>
<div id="app">
  <div id="progress" class="hidden"></div>
  <div id="toolbar">
    <span id="toolbar-title">Issues</span>
    <button type="button" class="icon-btn" id="new-issue-btn" title="New issue (c)"></button>
    <button type="button" class="icon-btn" id="refresh-btn" title="Refresh"></button>
    <button type="button" class="icon-btn" id="mark-read-btn" title="Mark Issues as Read"></button>
    <button type="button" class="icon-btn hidden" id="full-view-btn" title="Open in full view"></button>
  </div>
  <div id="searchrow">
    <button type="button" class="gh-btn" id="presets-btn">Filters</button>
    <input id="search-input" placeholder="Search issues (/)" spellcheck="false" autocomplete="off">
  </div>
  <div id="filters">
    <div id="tabs">
      <button type="button" class="tab" id="tab-open"></button>
      <button type="button" class="tab" id="tab-closed"></button>
    </div>
    <div id="dropdowns"></div>
  </div>
  <div id="banner" class="hidden"></div>
  <div id="list">
    <div id="message" class="hidden"></div>
    <div id="rows">${'<div class="skeleton-row"><span></span><span></span></div>'.repeat(6)}</div>
  </div>
  <div id="toast" class="hidden"></div>
</div>
<script nonce="${nonce}" src="${lib('issues.js')}"></script>
</body></html>`;
}
//# sourceMappingURL=issuesPanel.js.map
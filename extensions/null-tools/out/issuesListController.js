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
exports.IssuesListController = exports.DEFAULT_QUERY = void 0;
const vscode = __importStar(require("vscode"));
const githubApi_1 = require("./github/githubApi");
const githubAuth_1 = require("./github/githubAuth");
const gitBranch_1 = require("./github/gitBranch");
const githubRemote_1 = require("./github/githubRemote");
const issuesStore_1 = require("./github/issuesStore");
const promptFormat_1 = require("./github/promptFormat");
const recentlyCreated_1 = require("./github/recentlyCreated");
const searchQuery_1 = require("./github/searchQuery");
const issueDetailPanel_1 = require("./issueDetailPanel");
exports.DEFAULT_QUERY = 'is:open';
/** Query keys the filter bar may edit; anything else from the webview is ignored. */
const EDITABLE_KEYS = new Set(['state', 'label', 'author', 'assignee', 'milestone', 'type', 'sort']);
/**
 * One issue list bound to one webview (the sidebar view or the full tab). It owns the query string, the loaded
 * pages and the paging cursor; the store owns GitHub access and the by-number lookup shared with the detail tab.
 */
class IssuesListController {
    _webview;
    _extensionUri;
    _store;
    _globalState;
    _host;
    _compact;
    _query = exports.DEFAULT_QUERY;
    _items = [];
    _cursor = null;
    _hasMore = false;
    _openCount = null;
    _closedCount = null;
    _cachedViewer = null;
    /** Issues created from this window; kept briefly so a refresh doesn't drop them while GitHub's search lags. */
    _recent = [];
    /** Bumped by every request; a response whose number is no longer current belongs to a superseded query. */
    _seq = 0;
    _loading = false;
    _showingRows = false;
    _rateRetried = false;
    _retryTimer;
    _disposed = false;
    _subscription;
    constructor(_webview, _extensionUri, _store, _globalState, _host, _compact) {
        this._webview = _webview;
        this._extensionUri = _extensionUri;
        this._store = _store;
        this._globalState = _globalState;
        this._host = _host;
        this._compact = _compact;
        this._subscription = _webview.onDidReceiveMessage((msg) => void this._handleMessage(msg));
    }
    dispose() {
        this._disposed = true;
        this._seq++;
        clearTimeout(this._retryTimer);
        this._subscription.dispose();
    }
    /** Re-runs the current query from the first page and refreshes the dropdown metadata. */
    async refresh() {
        void this._loadMetadata(true);
        await this._run(false);
    }
    /**
     * Puts a just-created issue at the top without a search: GitHub's search index lags a few seconds behind, so a
     * refresh straight after creating would not list it. It may not match the active filters; the next real
     * search corrects that.
     */
    insertCreated(issue) {
        this._recent.push({ issue, at: Date.now() });
        this._items = [issue, ...this._items.filter(i => i.number !== issue.number)];
        if (issue.state === 'open' && this._openCount !== null)
            this._openCount++;
        this._showingRows = true;
        this._post(this._resultsMessage(this._items, false));
    }
    _post(message) {
        if (!this._disposed)
            void this._webview.postMessage(message);
    }
    _cwd() {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    }
    _repo() {
        const cwd = this._cwd();
        return cwd ? (0, githubRemote_1.getWorkspaceGithubRepo)(cwd) : null;
    }
    _listCacheKey(repo) {
        return `null.issues.listCache:${repo.owner}/${repo.repo}`;
    }
    _metaCacheKey(repo) {
        return `null.issues.metaCache:${repo.owner}/${repo.repo}`;
    }
    /** Rows for the webview: no bodies (they can be long and the list never shows them), plus the local-close flag. */
    _rows(issues) {
        const cwd = this._cwd();
        const closedLocally = cwd ? (0, gitBranch_1.getLocallyClosedIssueNumbers)(cwd) : new Set();
        return issues.map(({ body: _body, ...row }) => (row.state === 'open' && closedLocally.has(row.number) ? { ...row, closedLocally: true } : row));
    }
    _resultsMessage(items, append, fromCache = false) {
        const viewer = this._store.getViewerLogin() ?? this._cachedViewer;
        return {
            type: 'results',
            query: this._query,
            ...(0, searchQuery_1.describeQuery)(this._query, viewer),
            viewerLogin: viewer,
            items: this._rows(items),
            openCount: this._openCount,
            closedCount: this._closedCount,
            hasMore: this._hasMore,
            append,
            fromCache,
        };
    }
    _metadataMessage(m) {
        return {
            type: 'metadata', labels: m.labels, assignees: m.assignees, milestones: m.milestones,
            types: m.issueTypes, viewerLogin: m.viewerLogin,
        };
    }
    _paintFromCache() {
        if (this._query !== exports.DEFAULT_QUERY)
            return;
        const repo = this._repo();
        if (!repo)
            return;
        const meta = this._globalState.get(this._metaCacheKey(repo));
        if (meta) {
            this._cachedViewer = meta.viewerLogin;
            this._post(this._metadataMessage(meta));
        }
        const cached = this._globalState.get(this._listCacheKey(repo));
        if (!cached)
            return;
        this._store.hydrateFromCache(repo, cached.items);
        this._openCount = cached.openCount;
        this._closedCount = cached.closedCount;
        this._hasMore = false;
        this._showingRows = true;
        this._post(this._resultsMessage(cached.items, false, true));
    }
    async _loadMetadata(force) {
        try {
            const metadata = await this._store.getMetadata(force);
            this._post(this._metadataMessage(metadata));
            const repo = this._store.getRepo();
            if (repo)
                void this._globalState.update(this._metaCacheKey(repo), metadata);
        }
        catch {
            // The dropdowns just stay empty; the list's own request reports whatever is wrong.
        }
    }
    async _run(append) {
        const seq = ++this._seq;
        const query = this._query;
        this._loading = true;
        this._post({ type: 'loading', on: true });
        try {
            const page = await this._store.search(query, append ? this._cursor : null, !append);
            if (seq !== this._seq)
                return;
            const loaded = new Set(this._items.map(i => i.number));
            const fresh = append ? page.items.filter(i => !loaded.has(i.number)) : page.items;
            let added = [];
            if (append) {
                this._items = [...this._items, ...fresh];
            }
            else {
                ({ items: this._items, added } = (0, recentlyCreated_1.mergeRecentlyCreated)(page.items, this._recent, query, Date.now()));
            }
            this._cursor = page.cursor;
            this._hasMore = page.hasMore;
            if (page.openCount !== null) {
                this._openCount = page.openCount;
                this._closedCount = page.closedCount;
                const openAdded = added.filter(i => i.state === 'open').length;
                if (this._openCount !== null)
                    this._openCount += openAdded;
            }
            this._rateRetried = false;
            this._showingRows = true;
            this._post(this._resultsMessage(append ? fresh : this._items, append));
            if (!append && query === exports.DEFAULT_QUERY) {
                const repo = this._store.getRepo();
                if (repo) {
                    void this._globalState.update(this._listCacheKey(repo), {
                        items: this._items, openCount: this._openCount, closedCount: this._closedCount,
                    });
                }
                this._host.onDefaultResults(this._items);
            }
        }
        catch (err) {
            if (seq !== this._seq)
                return;
            this._reportFailure(err);
        }
        finally {
            if (seq === this._seq) {
                this._loading = false;
                this._post({ type: 'loading', on: false });
            }
        }
    }
    _reportFailure(err) {
        if (err instanceof issuesStore_1.SessionError) {
            this._showingRows = false;
            this._post({ type: 'status', kind: err.status });
        }
        else if (err instanceof githubApi_1.ApiError && err.status === 401) {
            this._showingRows = false;
            this._post({ type: 'status', kind: 'signed-out' });
        }
        else if (err instanceof githubApi_1.ApiError && err.retryAt !== null) {
            const willRetry = !this._rateRetried;
            this._post({ type: 'status', kind: 'rate-limited', retryAt: err.retryAt, willRetry });
            if (willRetry) {
                this._rateRetried = true;
                clearTimeout(this._retryTimer);
                const delay = Math.min(Math.max(err.retryAt - Date.now(), 1000), 10 * 60 * 1000);
                this._retryTimer = setTimeout(() => void this.refresh(), delay);
            }
        }
        else {
            const kind = this._showingRows ? 'offline' : 'error';
            this._post({ type: 'status', kind, message: err.message });
        }
    }
    async _handleMessage(msg) {
        switch (msg.type) {
            case 'ready':
                this._post({ type: 'init', query: this._query, compact: this._compact, defaultQuery: exports.DEFAULT_QUERY });
                this._paintFromCache();
                await this.refresh();
                break;
            case 'query':
                this._query = msg.text.trim();
                await this._run(false);
                break;
            case 'editQuery': {
                if (!EDITABLE_KEYS.has(msg.key))
                    break;
                if (msg.key === 'state')
                    this._query = (0, searchQuery_1.withState)(this._query, msg.value === 'closed' ? 'closed' : 'open');
                else if (msg.op === 'toggle' && msg.value)
                    this._query = (0, searchQuery_1.toggleQualifier)(this._query, msg.key, msg.value);
                else if (msg.op === 'set' && msg.value)
                    this._query = (0, searchQuery_1.setQualifier)(this._query, msg.key, msg.value);
                else if (msg.op === 'remove')
                    this._query = (0, searchQuery_1.removeQualifier)(this._query, msg.key);
                await this._run(false);
                break;
            }
            case 'loadMore':
                if (this._hasMore && !this._loading)
                    await this._run(true);
                break;
            case 'open':
                if (this._store.getByNumber(msg.number)) {
                    await issueDetailPanel_1.IssueDetailPanel.show(this._extensionUri, this._store, msg.number, msg.newTab === true);
                }
                break;
            case 'rowAction':
                await this._rowAction(msg.action, msg.number);
                break;
            case 'create':
                await this._host.createIssue();
                break;
            case 'signIn':
                await (0, githubAuth_1.getGithubSession)(true).then(() => undefined, () => undefined);
                await this.refresh();
                break;
            case 'refresh':
                await this.refresh();
                break;
            case 'markRead':
                this._host.markRead();
                break;
            case 'openFullView':
                this._host.openFullView?.();
                break;
        }
    }
    async _rowAction(action, number) {
        const issue = this._store.getByNumber(number);
        if (!issue)
            return;
        switch (action) {
            case 'browser':
                await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
                break;
            case 'branch': {
                const cwd = this._cwd();
                if (!cwd)
                    break;
                const result = (0, gitBranch_1.createIssueBranch)(cwd, issue.number, issue.title);
                if (result.ok)
                    void vscode.window.showInformationMessage(`Switched to branch ${result.branch}`);
                else
                    void vscode.window.showErrorMessage(`Failed to create branch: ${result.message}`);
                break;
            }
            case 'worktree':
                await vscode.commands.executeCommand('null.worktrees.createForIssue', issue.number, issue.title);
                break;
            case 'copyPrompt':
                await vscode.env.clipboard.writeText((0, promptFormat_1.formatIssueAsPrompt)(issue));
                this._post({ type: 'rowActionDone', action, number });
                break;
        }
    }
}
exports.IssuesListController = IssuesListController;
//# sourceMappingURL=issuesListController.js.map
'use strict';

import * as vscode from 'vscode';
import { ApiError } from './github/githubApi';
import { getGithubSession } from './github/githubAuth';
import { createIssueBranch, getLocallyClosedIssueNumbers } from './github/gitBranch';
import { getWorkspaceGithubRepo } from './github/githubRemote';
import { IssuesStore, SessionError } from './github/issuesStore';
import { formatIssueAsPrompt } from './github/promptFormat';
import { RecentIssue, mergeRecentlyCreated } from './github/recentlyCreated';
import { describeQuery, removeQualifier, setQualifier, toggleQualifier, withState } from './github/searchQuery';
import { GithubIssue, GithubRepoRef, RepoMetadata } from './github/types';
import { IssueDetailPanel } from './issueDetailPanel';

export const DEFAULT_QUERY = 'is:open';

/** Query keys the filter bar may edit; anything else from the webview is ignored. */
const EDITABLE_KEYS = new Set(['state', 'label', 'author', 'assignee', 'milestone', 'type', 'sort']);

/** The default query's first page, painted before the network answers. */
interface ListCache { items: GithubIssue[]; openCount: number | null; closedCount: number | null }

/** What a list needs from whoever owns it (the sidebar provider): badge, mark-read, create, full view. */
export interface IssuesListHost {
  /** Called with the first page each time the default query finishes loading, for the unread badge. */
  onDefaultResults(items: GithubIssue[]): void;
  markRead(): void;
  createIssue(): Promise<void>;
  /** Offered by the sidebar only. */
  openFullView?(): void;
}

type InboundMessage =
  | { type: 'ready' }
  | { type: 'query'; text: string }
  | { type: 'editQuery'; op: 'toggle' | 'set' | 'remove'; key: string; value?: string }
  | { type: 'loadMore' }
  | { type: 'open'; number: number; newTab?: boolean }
  | { type: 'rowAction'; action: 'branch' | 'worktree' | 'copyPrompt' | 'browser'; number: number }
  | { type: 'create' }
  | { type: 'signIn' }
  | { type: 'refresh' }
  | { type: 'markRead' }
  | { type: 'openFullView' };

/**
 * One issue list bound to one webview (the sidebar view or the full tab). It owns the query string, the loaded
 * pages and the paging cursor; the store owns GitHub access and the by-number lookup shared with the detail tab.
 */
export class IssuesListController {
  private _query = DEFAULT_QUERY;
  private _items: GithubIssue[] = [];
  private _cursor: string | null = null;
  private _hasMore = false;
  private _openCount: number | null = null;
  private _closedCount: number | null = null;
  private _cachedViewer: string | null = null;
  /** Issues created from this window; kept briefly so a refresh doesn't drop them while GitHub's search lags. */
  private _recent: RecentIssue[] = [];
  /** Bumped by every request; a response whose number is no longer current belongs to a superseded query. */
  private _seq = 0;
  private _loading = false;
  private _showingRows = false;
  private _rateRetried = false;
  private _retryTimer: ReturnType<typeof setTimeout> | undefined;
  private _disposed = false;
  private readonly _subscription: vscode.Disposable;

  constructor(
    private readonly _webview: vscode.Webview,
    private readonly _extensionUri: vscode.Uri,
    private readonly _store: IssuesStore,
    private readonly _globalState: vscode.Memento,
    private readonly _host: IssuesListHost,
    private readonly _compact: boolean,
  ) {
    this._subscription = _webview.onDidReceiveMessage((msg: InboundMessage) => void this._handleMessage(msg));
  }

  dispose(): void {
    this._disposed = true;
    this._seq++;
    clearTimeout(this._retryTimer);
    this._subscription.dispose();
  }

  /** Re-runs the current query from the first page and refreshes the dropdown metadata. */
  async refresh(): Promise<void> {
    void this._loadMetadata(true);
    await this._run(false);
  }

  /**
   * Puts a just-created issue at the top without a search: GitHub's search index lags a few seconds behind, so a
   * refresh straight after creating would not list it. It may not match the active filters; the next real
   * search corrects that.
   */
  insertCreated(issue: GithubIssue): void {
    this._recent.push({ issue, at: Date.now() });
    this._items = [issue, ...this._items.filter(i => i.number !== issue.number)];
    if (issue.state === 'open' && this._openCount !== null) this._openCount++;
    this._showingRows = true;
    this._post(this._resultsMessage(this._items, false));
  }

  private _post(message: unknown): void {
    if (!this._disposed) void this._webview.postMessage(message);
  }

  private _cwd(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  private _repo(): GithubRepoRef | null {
    const cwd = this._cwd();
    return cwd ? getWorkspaceGithubRepo(cwd) : null;
  }

  private _listCacheKey(repo: GithubRepoRef): string {
    return `null.issues.listCache:${repo.owner}/${repo.repo}`;
  }

  private _metaCacheKey(repo: GithubRepoRef): string {
    return `null.issues.metaCache:${repo.owner}/${repo.repo}`;
  }

  /** Rows for the webview: no bodies (they can be long and the list never shows them), plus the local-close flag. */
  private _rows(issues: GithubIssue[]): unknown[] {
    const cwd = this._cwd();
    const closedLocally = cwd ? getLocallyClosedIssueNumbers(cwd) : new Set<number>();
    return issues.map(({ body: _body, ...row }) =>
      (row.state === 'open' && closedLocally.has(row.number) ? { ...row, closedLocally: true } : row));
  }

  private _resultsMessage(items: GithubIssue[], append: boolean, fromCache = false): unknown {
    const viewer = this._store.getViewerLogin() ?? this._cachedViewer;
    return {
      type: 'results',
      query: this._query,
      ...describeQuery(this._query, viewer),
      viewerLogin: viewer,
      items: this._rows(items),
      openCount: this._openCount,
      closedCount: this._closedCount,
      hasMore: this._hasMore,
      append,
      fromCache,
    };
  }

  private _metadataMessage(m: RepoMetadata): unknown {
    return {
      type: 'metadata', labels: m.labels, assignees: m.assignees, milestones: m.milestones,
      types: m.issueTypes, viewerLogin: m.viewerLogin,
    };
  }

  private _paintFromCache(): void {
    if (this._query !== DEFAULT_QUERY) return;
    const repo = this._repo();
    if (!repo) return;
    const meta = this._globalState.get<RepoMetadata>(this._metaCacheKey(repo));
    if (meta) {
      this._cachedViewer = meta.viewerLogin;
      this._post(this._metadataMessage(meta));
    }
    const cached = this._globalState.get<ListCache>(this._listCacheKey(repo));
    if (!cached) return;
    this._store.hydrateFromCache(repo, cached.items);
    this._openCount = cached.openCount;
    this._closedCount = cached.closedCount;
    this._hasMore = false;
    this._showingRows = true;
    this._post(this._resultsMessage(cached.items, false, true));
  }

  private async _loadMetadata(force: boolean): Promise<void> {
    try {
      const metadata = await this._store.getMetadata(force);
      this._post(this._metadataMessage(metadata));
      const repo = this._store.getRepo();
      if (repo) void this._globalState.update(this._metaCacheKey(repo), metadata);
    } catch {
      // The dropdowns just stay empty; the list's own request reports whatever is wrong.
    }
  }

  private async _run(append: boolean): Promise<void> {
    const seq = ++this._seq;
    const query = this._query;
    this._loading = true;
    this._post({ type: 'loading', on: true });
    try {
      const page = await this._store.search(query, append ? this._cursor : null, !append);
      if (seq !== this._seq) return;
      const loaded = new Set(this._items.map(i => i.number));
      const fresh = append ? page.items.filter(i => !loaded.has(i.number)) : page.items;
      let added: GithubIssue[] = [];
      if (append) {
        this._items = [...this._items, ...fresh];
      } else {
        ({ items: this._items, added } = mergeRecentlyCreated(page.items, this._recent, query, Date.now()));
      }
      this._cursor = page.cursor;
      this._hasMore = page.hasMore;
      if (page.openCount !== null) {
        this._openCount = page.openCount;
        this._closedCount = page.closedCount;
        const openAdded = added.filter(i => i.state === 'open').length;
        if (this._openCount !== null) this._openCount += openAdded;
      }
      this._rateRetried = false;
      this._showingRows = true;
      this._post(this._resultsMessage(append ? fresh : this._items, append));
      if (!append && query === DEFAULT_QUERY) {
        const repo = this._store.getRepo();
        if (repo) {
          void this._globalState.update(this._listCacheKey(repo), {
            items: this._items, openCount: this._openCount, closedCount: this._closedCount,
          } satisfies ListCache);
        }
        this._host.onDefaultResults(this._items);
      }
    } catch (err) {
      if (seq !== this._seq) return;
      this._reportFailure(err);
    } finally {
      if (seq === this._seq) {
        this._loading = false;
        this._post({ type: 'loading', on: false });
      }
    }
  }

  private _reportFailure(err: unknown): void {
    if (err instanceof SessionError) {
      this._showingRows = false;
      this._post({ type: 'status', kind: err.status });
    } else if (err instanceof ApiError && err.status === 401) {
      this._showingRows = false;
      this._post({ type: 'status', kind: 'signed-out' });
    } else if (err instanceof ApiError && err.retryAt !== null) {
      const willRetry = !this._rateRetried;
      this._post({ type: 'status', kind: 'rate-limited', retryAt: err.retryAt, willRetry });
      if (willRetry) {
        this._rateRetried = true;
        clearTimeout(this._retryTimer);
        const delay = Math.min(Math.max(err.retryAt - Date.now(), 1000), 10 * 60 * 1000);
        this._retryTimer = setTimeout(() => void this.refresh(), delay);
      }
    } else {
      const kind = this._showingRows ? 'offline' : 'error';
      this._post({ type: 'status', kind, message: (err as Error).message });
    }
  }

  private async _handleMessage(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this._post({ type: 'init', query: this._query, compact: this._compact, defaultQuery: DEFAULT_QUERY });
        this._paintFromCache();
        await this.refresh();
        break;
      case 'query':
        this._query = msg.text.trim();
        await this._run(false);
        break;
      case 'editQuery': {
        if (!EDITABLE_KEYS.has(msg.key)) break;
        if (msg.key === 'state') this._query = withState(this._query, msg.value === 'closed' ? 'closed' : 'open');
        else if (msg.op === 'toggle' && msg.value) this._query = toggleQualifier(this._query, msg.key, msg.value);
        else if (msg.op === 'set' && msg.value) this._query = setQualifier(this._query, msg.key, msg.value);
        else if (msg.op === 'remove') this._query = removeQualifier(this._query, msg.key);
        await this._run(false);
        break;
      }
      case 'loadMore':
        if (this._hasMore && !this._loading) await this._run(true);
        break;
      case 'open':
        if (this._store.getByNumber(msg.number)) {
          await IssueDetailPanel.show(this._extensionUri, this._store, msg.number, msg.newTab === true);
        }
        break;
      case 'rowAction':
        await this._rowAction(msg.action, msg.number);
        break;
      case 'create':
        await this._host.createIssue();
        break;
      case 'signIn':
        await getGithubSession(true).then(() => undefined, () => undefined);
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

  private async _rowAction(action: 'branch' | 'worktree' | 'copyPrompt' | 'browser', number: number): Promise<void> {
    const issue = this._store.getByNumber(number);
    if (!issue) return;
    switch (action) {
      case 'browser':
        await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
        break;
      case 'branch': {
        const cwd = this._cwd();
        if (!cwd) break;
        const result = createIssueBranch(cwd, issue.number, issue.title);
        if (result.ok) void vscode.window.showInformationMessage(`Switched to branch ${result.branch}`);
        else void vscode.window.showErrorMessage(`Failed to create branch: ${result.message}`);
        break;
      }
      case 'worktree':
        await vscode.commands.executeCommand('null.worktrees.createForIssue', issue.number, issue.title);
        break;
      case 'copyPrompt':
        await vscode.env.clipboard.writeText(formatIssueAsPrompt(issue));
        this._post({ type: 'rowActionDone', action, number });
        break;
    }
  }
}

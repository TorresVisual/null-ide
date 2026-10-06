'use strict';

import * as vscode from 'vscode';
import { getNonce } from './webviewUtils';
import { IssuesStore } from './github/issuesStore';
import { getGithubSession } from './github/githubAuth';
import { getWorkspaceGithubRepo } from './github/githubRemote';
import { IssueDetailPanel } from './issueDetailPanel';
import { GithubIssue, GithubRepoRef } from './github/types';
import { newestUpdateTime, relevantToViewer } from './github/issueFilter';
import { IssuesListController, IssuesListHost } from './issuesListController';

/** Owns the sidebar list and, on request, one full-width tab; both are `IssuesListController`s over the same store. */
export class IssuesViewProvider implements vscode.WebviewViewProvider, IssuesListHost {
  private _webviewView?: vscode.WebviewView;
  private _fullView?: vscode.WebviewPanel;
  private readonly _controllers = new Set<IssuesListController>();
  private _badgeItems: GithubIssue[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _store: IssuesStore,
    private readonly _globalState: vscode.Memento,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._webviewView = webviewView;
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'lib')],
    };
    webview.html = buildListHtml(webview, this._extensionUri);
    this._attach(webview, true, () => { if (this._webviewView === webviewView) this._webviewView = undefined; }, webviewView);
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.markRead();
    });
    if (webviewView.visible) this.markRead();
  }

  openFullView(): void {
    if (this._fullView) {
      this._fullView.reveal();
      return;
    }
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const repo = cwd ? getWorkspaceGithubRepo(cwd) : null;
    const panel = vscode.window.createWebviewPanel(
      'null-tools.issuesFull',
      repo ? `Issues · ${repo.owner}/${repo.repo}` : 'Issues',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'lib')],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'github-issues.svg');
    panel.webview.html = buildListHtml(panel.webview, this._extensionUri);
    this._fullView = panel;
    this._attach(panel.webview, false, () => { this._fullView = undefined; }, panel);
  }

  private _attach(
    webview: vscode.Webview, compact: boolean, onGone: () => void, owner: { onDidDispose: vscode.Event<void> },
  ): void {
    const controller = new IssuesListController(webview, this._extensionUri, this._store, this._globalState, this, compact);
    this._controllers.add(controller);
    owner.onDidDispose(() => {
      controller.dispose();
      this._controllers.delete(controller);
      onGone();
    });
  }

  async refresh(): Promise<void> {
    await Promise.all([...this._controllers].map(c => c.refresh()));
  }

  async signIn(): Promise<void> {
    await getGithubSession(true).then(() => undefined, () => undefined);
    await this.refresh();
  }

  async createIssue(): Promise<void> {
    await IssueDetailPanel.showCreate(this._extensionUri, this._store);
  }

  /** The lists show a just-created issue at once instead of waiting for GitHub's search index. */
  insertCreated(issue: GithubIssue): void {
    for (const controller of this._controllers) controller.insertCreated(issue);
  }

  onDefaultResults(items: GithubIssue[]): void {
    this._badgeItems = items;
    this._updateUnreadBadge();
  }

  /** Advances the per-repo "last seen" watermark to now (or the newest known issue) and clears the badge. */
  markRead(): void {
    const repo = this._store.getRepo();
    if (!repo) return;
    const lastSeen = newestUpdateTime(this._badgeItems) || Date.now();
    void this._globalState.update(this._lastSeenKey(repo), lastSeen);
    if (this._webviewView) this._webviewView.badge = undefined;
  }

  private _lastSeenKey(repo: GithubRepoRef): string {
    return `null.issues.lastSeen:${repo.owner}/${repo.repo}`;
  }

  // ponytail: resolveWebviewView only fires once the panel has actually been
  // opened (or was left open last session), so the badge can't appear before
  // that first open in a cold session — VS Code gives webview views no way to
  // badge an unresolved container. No workaround worth the UX cost of forcing
  // the panel open.
  private _updateUnreadBadge(): void {
    if (!this._webviewView) return;
    const repo = this._store.getRepo();
    if (!repo) { this._webviewView.badge = undefined; return; }
    if (this._webviewView.visible) { this.markRead(); return; }

    const key = this._lastSeenKey(repo);
    const lastSeen = this._globalState.get<number>(key, 0);
    if (lastSeen === 0) {
      void this._globalState.update(key, newestUpdateTime(this._badgeItems) || Date.now());
      this._webviewView.badge = undefined;
      return;
    }

    const unread = relevantToViewer(this._badgeItems, this._store.getViewerLogin())
      .filter(issue => new Date(issue.updated_at).getTime() > lastSeen);
    this._webviewView.badge = unread.length > 0
      ? { value: unread.length, tooltip: `${unread.length} unread issue${unread.length === 1 ? '' : 's'}` }
      : undefined;
  }
}

function buildListHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const lib = (file: string): vscode.Uri => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'lib', file));
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
    <div id="searchbox">
      <span id="search-icon"></span>
      <input id="search-input" placeholder="Search issues (/)" spellcheck="false" autocomplete="off">
      <button type="button" id="presets-btn" title="Saved filters"></button>
    </div>
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

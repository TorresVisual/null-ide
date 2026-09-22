'use strict';

import * as vscode from 'vscode';
import { getNonce } from './webviewUtils';
import { IssuesStore } from './github/issuesStore';
import { getGithubSession } from './github/githubAuth';
import { IssueDetailPanel } from './issueDetailPanel';
import { GithubIssue, IssueFilterOptions, IssueState } from './github/types';
import { createIssueBranch, getLocallyClosedIssueNumbers } from './github/gitBranch';
import { formatIssueAsPrompt } from './github/promptFormat';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'setState'; state: IssueState }
  | { type: 'setFilters'; labels: string[]; assignee: 'me' | 'everyone'; query: string }
  | { type: 'selectIssue'; number: number }
  | { type: 'createIssue' }
  | { type: 'signIn' }
  | { type: 'refresh' }
  | { type: 'openIssueInBrowser'; number: number }
  | { type: 'createBranchForIssue'; number: number }
  | { type: 'copyAsPromptForIssue'; number: number };

export class IssuesViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.Webview;
  private _state: IssueState = 'open';
  private _filters: IssueFilterOptions = { labels: [], assignee: 'everyone', query: '', viewerLogin: null };

  constructor(private readonly _extensionUri: vscode.Uri, private readonly _store: IssuesStore) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const webview = webviewView.webview;
    this._view = webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'lib')],
    };
    webview.html = this._buildHtml(webview);
    webview.onDidReceiveMessage((msg: InboundMessage) => this._handleMessage(msg));
  }

  async refresh(): Promise<void> {
    await this._sendIssues();
  }

  async createIssue(): Promise<void> {
    await IssueDetailPanel.showCreate(this._extensionUri, this._store, () => this._sendIssues());
  }

  async signIn(): Promise<void> {
    await getGithubSession(true);
    await this._sendIssues();
  }

  private _cwd(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  private _withClosedLocally(issues: GithubIssue[]): GithubIssue[] {
    const cwd = this._cwd();
    if (!cwd) return issues;
    const closedNumbers = getLocallyClosedIssueNumbers(cwd);
    if (closedNumbers.size === 0) return issues;
    return issues.map(issue =>
      issue.state === 'open' && closedNumbers.has(issue.number) ? { ...issue, closedLocally: true } : issue);
  }

  private async _sendIssues(): Promise<void> {
    if (!this._view) return;
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
    const repoLabels = await this._store.getRepoLabels();
    this._view.postMessage({
      type: 'issues',
      status: 'ok',
      issues: this._withClosedLocally(this._store.getFiltered(this._filters)),
      viewerLogin: result.viewerLogin,
      repoLabels,
    });
  }

  private async _handleMessage(msg: InboundMessage): Promise<void> {
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
        this._view?.postMessage({
          type: 'issues',
          status: 'ok',
          issues: this._withClosedLocally(this._store.getFiltered(this._filters)),
          viewerLogin: this._filters.viewerLogin,
          repoLabels: await this._store.getRepoLabels(),
        });
        break;
      case 'selectIssue': {
        const issue = this._store.getByNumber(msg.number);
        if (!issue) break;
        await IssueDetailPanel.show(this._extensionUri, this._store, msg.number);
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
      case 'openIssueInBrowser': {
        const issue = this._store.getByNumber(msg.number);
        if (issue) await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
        break;
      }
      case 'createBranchForIssue': {
        const issue = this._store.getByNumber(msg.number);
        const cwd = this._cwd();
        if (!issue || !cwd) break;
        const result = createIssueBranch(cwd, issue.number, issue.title);
        if (result.ok) void vscode.window.showInformationMessage(`Switched to branch ${result.branch}`);
        else void vscode.window.showErrorMessage(`Failed to create branch: ${result.message}`);
        break;
      }
      case 'copyAsPromptForIssue': {
        const issue = this._store.getByNumber(msg.number);
        if (!issue) break;
        await vscode.env.clipboard.writeText(formatIssueAsPrompt(issue));
        this._view?.postMessage({ type: 'copiedIssue', number: msg.number });
        break;
      }
    }
  }

  private _buildHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'issues.js'));
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
<style>
  html,body { margin:0; padding:0; height:100%; background:var(--vscode-editor-background); color:var(--vscode-foreground);
              font:12px/1.5 var(--vscode-font-family); }
  #app { display:flex; flex-direction:column; height:100%; }
  #toolbar { display:flex; align-items:center; gap:4px; padding:6px 8px; border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); flex-shrink:0; }
  #toolbar-title { flex:1; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--vscode-descriptionForeground); }
  #toolbar select {
    background:var(--vscode-input-background); border:1px solid var(--vscode-input-border,transparent);
    color:var(--vscode-input-foreground); padding:3px 4px; font:inherit; border-radius:2px;
  }
  #toolbar select:focus { outline:none; border-color:var(--vscode-focusBorder); }
  .icon-btn {
    background:transparent; border:none; color:var(--vscode-foreground); cursor:pointer;
    padding:4px 6px; border-radius:3px; font-size:13px; line-height:1;
  }
  .icon-btn:hover, .icon-btn.active { background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground)); }
  .icon-btn svg { vertical-align:middle; }
  .hidden { display:none !important; }
  #search-bar, #filter-popover {
    padding:8px; border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.2));
    display:flex; flex-direction:column; gap:6px;
  }
  #search-bar input, #filter-popover input {
    background:var(--vscode-input-background); border:1px solid var(--vscode-input-border,transparent);
    color:var(--vscode-input-foreground); padding:4px 6px; font:inherit; border-radius:2px;
  }
  #search-bar input:focus, #filter-popover input:focus { outline:none; border-color:var(--vscode-focusBorder); }
  .assignee-btn {
    background:var(--vscode-button-secondaryBackground); border:1px solid transparent;
    color:var(--vscode-button-secondaryForeground); padding:4px 8px; cursor:pointer; border-radius:2px;
  }
  .assignee-btn:hover { background:var(--vscode-button-secondaryHoverBackground); }
  .assignee-btn.active { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
  #list { flex:1; overflow-y:auto; }
  .issue-row { display:flex; align-items:flex-start; gap:6px; padding:8px 10px; border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.12)); cursor:pointer; }
  .issue-row:hover { background:var(--vscode-list-hoverBackground); }
  .issue-row.selected { background:var(--vscode-list-activeSelectionBackground); color:var(--vscode-list-activeSelectionForeground); }
  .state-dot {
    flex-shrink:0; width:9px; height:9px; margin-top:4px; border-radius:50%;
    background:var(--vscode-charts-green,#89d185);
  }
  .issue-row.closed .state-dot { background:var(--vscode-charts-purple,#b180d7); }
  .issue-main { min-width:0; flex:1; }
  .issue-num { color:var(--vscode-descriptionForeground); }
  .issue-title { font-weight:600; }
  .you-badge {
    display:inline-block; margin-left:5px; padding:0 5px; border-radius:8px; font-size:10px;
    background:var(--vscode-badge-background); color:var(--vscode-badge-foreground);
  }
  .closes-badge {
    display:inline-block; margin-left:5px; padding:0 5px; border-radius:8px; font-size:10px;
    background:var(--vscode-charts-purple,#b180d7); color:#fff;
  }
  .issue-meta { color:var(--vscode-descriptionForeground); font-size:11px; margin-top:2px; }
  .label-chip { display:inline-block; padding:0 5px; border-radius:8px; font-size:10px; margin-right:4px; color:#111; }
  .row-actions { display:flex; gap:2px; opacity:0; flex-shrink:0; }
  .issue-row:hover .row-actions { opacity:1; }
  .row-actions button {
    background:transparent; border:none; cursor:pointer; font-size:12px; padding:2px 4px; border-radius:3px; color:inherit;
  }
  .row-actions button:hover { background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.2)); }
  .chip-picker { display:flex; flex-wrap:wrap; gap:6px; }
  .chip-check { display:inline-flex; align-items:center; gap:4px; font-size:11px; cursor:pointer; }
  .chip-check input { margin:0; }
  button.action { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; padding:5px 10px; border-radius:2px; cursor:pointer; margin-right:6px; font:inherit; }
  button.action:hover { background:var(--vscode-button-hoverBackground); }
  #empty { padding:20px; color:var(--vscode-descriptionForeground); text-align:center; }
</style></head><body>
<div id="app">
  <div id="toolbar">
    <span id="toolbar-title">Issues</span>
    <select id="state-select">
      <option value="open">Open</option>
      <option value="closed">Closed</option>
      <option value="all">All</option>
    </select>
    <button class="icon-btn" id="new-issue-btn" title="New issue">+</button>
    <button class="icon-btn" id="refresh-btn" title="Refresh">↻</button>
    <button class="icon-btn" id="search-toggle-btn" title="Search"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10L14 14" stroke-linecap="round"/></svg></button>
    <button class="icon-btn" id="filter-toggle-btn" title="Filter">⚙</button>
  </div>
  <div id="search-bar" class="hidden">
    <input id="search-input" placeholder="Search title &amp; body">
  </div>
  <div id="filter-popover" class="hidden">
    <div>
      <button class="assignee-btn active" id="assignee-everyone">Everyone</button>
      <button class="assignee-btn" id="assignee-me">Assigned to me</button>
    </div>
    <div id="label-picker" class="chip-picker"><span class="issue-meta">Loading labels…</span></div>
  </div>
  <div id="list"><div id="empty">Loading…</div></div>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
  }
}

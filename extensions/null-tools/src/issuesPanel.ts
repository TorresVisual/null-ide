'use strict';

import * as vscode from 'vscode';
import { getNonce } from './webviewUtils';
import { IssuesStore } from './github/issuesStore';
import { getGithubSession } from './github/githubAuth';
import { IssueDetailPanel } from './issueDetailPanel';
import { IssueFilterOptions, IssueState } from './github/types';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'setState'; state: IssueState }
  | { type: 'setFilters'; labels: string[]; assignee: 'me' | 'everyone'; query: string }
  | { type: 'selectIssue'; number: number }
  | { type: 'signIn' };

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

  async signIn(): Promise<void> {
    await getGithubSession(true);
    await this._sendIssues();
  }

  private _cwd(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
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
    this._view.postMessage({
      type: 'issues',
      status: 'ok',
      issues: this._store.getFiltered(this._filters),
      viewerLogin: result.viewerLogin,
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
          issues: this._store.getFiltered(this._filters),
          viewerLogin: this._filters.viewerLogin,
        });
        break;
      case 'selectIssue': {
        const issue = this._store.getByNumber(msg.number);
        if (!issue) break;
        await IssueDetailPanel.show(this._extensionUri, this._store, msg.number);
        break;
      }
      case 'signIn':
        await this.signIn();
        break;
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
  #toolbar { display:flex; flex-wrap:wrap; gap:6px; padding:8px; border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); flex-shrink:0; }
  #toolbar input, #toolbar select {
    background:var(--vscode-input-background); border:1px solid var(--vscode-input-border,transparent);
    color:var(--vscode-input-foreground); padding:4px 6px; font:inherit; border-radius:2px;
  }
  #toolbar input:focus, #toolbar select:focus { outline:none; border-color:var(--vscode-focusBorder); }
  #toolbar input { flex:1; min-width:80px; }
  .assignee-btn {
    background:var(--vscode-button-secondaryBackground); border:1px solid transparent;
    color:var(--vscode-button-secondaryForeground); padding:4px 8px; cursor:pointer; border-radius:2px;
  }
  .assignee-btn:hover { background:var(--vscode-button-secondaryHoverBackground); }
  .assignee-btn.active { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
  #list { flex:1; overflow-y:auto; }
  .issue-row { display:flex; gap:6px; padding:8px 10px; border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.12)); cursor:pointer; }
  .issue-row:hover { background:var(--vscode-list-hoverBackground); }
  .issue-row.selected { background:var(--vscode-list-activeSelectionBackground); color:var(--vscode-list-activeSelectionForeground); }
  .state-dot {
    flex-shrink:0; width:9px; height:9px; margin-top:4px; border-radius:50%;
    background:var(--vscode-charts-green,#89d185);
  }
  .issue-row.closed .state-dot { background:var(--vscode-charts-purple,#b180d7); }
  .issue-main { min-width:0; }
  .issue-num { color:var(--vscode-descriptionForeground); }
  .issue-title { font-weight:600; }
  .you-badge {
    display:inline-block; margin-left:5px; padding:0 5px; border-radius:8px; font-size:10px;
    background:var(--vscode-badge-background); color:var(--vscode-badge-foreground);
  }
  .issue-meta { color:var(--vscode-descriptionForeground); font-size:11px; margin-top:2px; }
  .label-chip { display:inline-block; padding:0 5px; border-radius:8px; font-size:10px; margin-right:4px; color:#111; }
  button.action { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; padding:5px 10px; border-radius:2px; cursor:pointer; margin-right:6px; font:inherit; }
  button.action:hover { background:var(--vscode-button-hoverBackground); }
  #empty { padding:20px; color:var(--vscode-descriptionForeground); text-align:center; }
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

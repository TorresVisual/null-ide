'use strict';

import * as vscode from 'vscode';
import { getNonce } from './webviewUtils';
import { IssuesStore } from './github/issuesStore';
import { getGithubSession } from './github/githubAuth';
import { formatIssueAsPrompt } from './github/promptFormat';
import { IssueFilterOptions, IssueState } from './github/types';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'setState'; state: IssueState }
  | { type: 'setFilters'; labels: string[]; assignee: 'me' | 'everyone'; query: string }
  | { type: 'selectIssue'; number: number }
  | { type: 'copyAsPrompt'; number: number }
  | { type: 'openInBrowser'; number: number }
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
    this._view.postMessage({ type: 'issues', status: 'ok', issues: this._store.getFiltered(this._filters) });
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
        this._view?.postMessage({ type: 'issues', status: 'ok', issues: this._store.getFiltered(this._filters) });
        break;
      case 'selectIssue': {
        const issue = this._store.getByNumber(msg.number);
        if (!issue) break;
        const comments = await this._store.getComments(msg.number);
        this._view?.postMessage({ type: 'issueDetail', issue, comments });
        break;
      }
      case 'copyAsPrompt': {
        const issue = this._store.getByNumber(msg.number);
        if (!issue) break;
        await vscode.env.clipboard.writeText(formatIssueAsPrompt(issue));
        this._view?.postMessage({ type: 'copied' });
        break;
      }
      case 'openInBrowser': {
        const issue = this._store.getByNumber(msg.number);
        if (issue) await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
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
  html,body { margin:0; padding:0; height:100%; background:#181818; color:#ccc;
              font:12px/1.5 'Cascadia Code',Consolas,monospace; }
  #app { display:flex; flex-direction:column; height:100%; }
  #toolbar { display:flex; flex-wrap:wrap; gap:6px; padding:8px; border-bottom:1px solid #2b2b2b; flex-shrink:0; }
  #toolbar input, #toolbar select { background:#1e1e1e; border:1px solid #333; color:#ccc; padding:4px 6px; font:inherit; border-radius:2px; }
  #toolbar input { flex:1; min-width:80px; }
  .assignee-btn { background:#1e1e1e; border:1px solid #333; color:#888; padding:4px 8px; cursor:pointer; border-radius:2px; }
  .assignee-btn.active { color:#e0e0e0; border-color:#0078D4; }
  #body { flex:1; display:flex; min-height:0; }
  #list { width:45%; overflow-y:auto; border-right:1px solid #2b2b2b; }
  .issue-row { padding:8px 10px; border-bottom:1px solid #222; cursor:pointer; }
  .issue-row:hover { background:#1e1e1e; }
  .issue-row.selected { background:#242424; border-left:2px solid #4EC9B0; }
  .issue-num { color:#666; }
  .issue-title { color:#e0e0e0; }
  .issue-meta { color:#666; font-size:11px; margin-top:2px; }
  .label-chip { display:inline-block; padding:0 5px; border-radius:8px; font-size:10px; margin-right:4px; color:#111; }
  #detail { flex:1; overflow-y:auto; padding:12px; }
  #detail-body { white-space:pre-wrap; margin:10px 0; color:#ccc; }
  .comment { border-top:1px solid #2b2b2b; padding:8px 0; }
  .comment-author { color:#4EC9B0; }
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
  <div id="body">
    <div id="list"><div id="empty">Loading…</div></div>
    <div id="detail"><div id="empty">Select an issue.</div></div>
  </div>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
  }
}

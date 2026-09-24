'use strict';

import * as vscode from 'vscode';
import { getNonce } from './webviewUtils';
import { getRecentProjectsFilePath, readRecentProjects, RecentProjectEntry } from './recentProjects';
import { computeGitStatuses, GitStatus } from './dashboardGitStatus';

type OutboundMessage =
  | { type: 'projects'; projects: RecentProjectEntry[] }
  | { type: 'gitStatus'; path: string; status: GitStatus | null };

type InboundMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openFolder' }
  | { type: 'openProject'; path: string }
  | { type: 'newProject' }
  | { type: 'cloneRepo' };

export class DashboardEditorProvider implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
  ) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  resolveCustomEditor(_document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'lib')],
    };
    panel.webview.html = this._buildHtml(panel.webview);
    panel.webview.onDidReceiveMessage((msg: InboundMessage) => this._handleMessage(msg, panel.webview));
  }

  private _handleMessage(msg: InboundMessage, webview: vscode.Webview): void {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        this._sendProjectsAndStatuses(webview);
        break;
      case 'openFolder':
        vscode.commands.executeCommand('workbench.action.files.openFolder');
        break;
      case 'openProject':
        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(msg.path));
        break;
      // 'newProject' / 'cloneRepo' are handled by Task 4 / Task 5.
    }
  }

  private _sendProjectsAndStatuses(webview: vscode.Webview): void {
    const projects = readRecentProjects(getRecentProjectsFilePath());
    webview.postMessage({ type: 'projects', projects } as OutboundMessage);
    void computeGitStatuses(
      projects.map(p => p.path),
      (path, status) => webview.postMessage({ type: 'gitStatus', path, status } as OutboundMessage),
    );
  }

  private _buildHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', 'dashboard.js'));
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
<style>
  html,body { margin:0; padding:0; height:100%; background:var(--vscode-editor-background); color:var(--vscode-foreground);
              font:13px/1.5 var(--vscode-font-family); }
  #app { display:flex; flex-direction:column; height:100%; padding:24px; gap:16px; box-sizing:border-box; }
  #toolbar { display:flex; align-items:center; gap:8px; }
  #toolbar h1 { font-size:16px; font-weight:600; flex:1; margin:0; }
  button { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none;
           border-radius:4px; padding:6px 12px; cursor:pointer; font:inherit; }
  button:hover { background:var(--vscode-button-hoverBackground); }
  button.secondary { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }
  #cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:12px; overflow:auto; }
  .card { border:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); border-radius:6px; padding:12px; cursor:pointer; }
  .card:hover { background:var(--vscode-list-hoverBackground); }
  .card .label { font-weight:600; }
  .card .path { color:var(--vscode-descriptionForeground); font-size:11px; word-break:break-all; }
  .card .meta { display:flex; gap:8px; margin-top:8px; font-size:11px; color:var(--vscode-descriptionForeground); }
  .card .branch::before { content:"\\2387 "; }
  .card .dirty { color:var(--vscode-gitDecoration-modifiedResourceForeground); }
  #empty { color:var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <h1>Null IDE</h1>
    <button id="refresh" class="secondary">Refresh</button>
    <button id="clone-repo" class="secondary">Clone Repo</button>
    <button id="new-project" class="secondary">New Project</button>
    <button id="open-folder">Open Folder</button>
  </div>
  <div id="cards"></div>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
  }
}

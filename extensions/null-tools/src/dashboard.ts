'use strict';

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { getNonce } from './webviewUtils';
import { detectProjectType } from './projectType';
import {
  findCurrentRecentProject,
  getRecentProjectsFilePath,
  readRecentProjects,
  RecentProjectEntry,
  relocateRecentProject,
  removeRecentProject,
  setRecentProjectPinned,
} from './recentProjects';
import { computeGitStatuses, GitStatus } from './dashboardGitStatus';
import { runNewProjectFlow, runCloneRepoFlow } from './dashboardActions';

type LauncherProject = RecentProjectEntry & { available: boolean; projectType?: string; icon?: string };

type OutboundMessage =
  | { type: 'projects'; projects: LauncherProject[] }
  | { type: 'gitStatus'; path: string; status: GitStatus | null };

type InboundMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openFolder' }
  | { type: 'openProject'; path: string; forceNewWindow?: boolean }
  | { type: 'setPinned'; path: string; pinned: boolean }
  | { type: 'revealProject'; path: string }
  | { type: 'copyProjectPath'; path: string }
  | { type: 'removeProject'; path: string }
  | { type: 'locateProject'; path: string }
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
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'app-icon.svg');
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
      case 'openProject': {
        const entry = this._currentProject(msg.path);
        if (entry && fs.existsSync(entry.path)) vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(entry.path), { forceNewWindow: !!msg.forceNewWindow });
        else this._sendProjectsAndStatuses(webview);
        break;
      }
      case 'setPinned': {
        const entry = this._currentProject(msg.path);
        if (entry) setRecentProjectPinned(getRecentProjectsFilePath(), entry.path, msg.pinned, this._maxItems());
        this._sendProjectsAndStatuses(webview);
        break;
      }
      case 'removeProject': {
        const entry = this._currentProject(msg.path);
        if (entry) removeRecentProject(getRecentProjectsFilePath(), entry.path, this._maxItems());
        this._sendProjectsAndStatuses(webview);
        break;
      }
      case 'revealProject': {
        const entry = this._currentProject(msg.path);
        if (entry) vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(entry.path));
        else this._sendProjectsAndStatuses(webview);
        break;
      }
      case 'copyProjectPath': {
        const entry = this._currentProject(msg.path);
        if (entry) void vscode.env.clipboard.writeText(entry.path);
        else this._sendProjectsAndStatuses(webview);
        break;
      }
      case 'locateProject': {
        const entry = this._currentProject(msg.path);
        if (!entry) { this._sendProjectsAndStatuses(webview); break; }
        void vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Locate Project' }).then(selected => {
          if (!selected?.[0]) return;
          if (!relocateRecentProject(getRecentProjectsFilePath(), entry.path, selected[0].fsPath, this._maxItems())) {
            vscode.window.showErrorMessage('Null: the selected location is not a directory, so the project was not relocated.');
          }
          this._sendProjectsAndStatuses(webview);
        });
        break;
      }
      case 'newProject':
        void runNewProjectFlow();
        break;
      case 'cloneRepo':
        void runCloneRepoFlow(this.context);
        break;
    }
  }

  private _currentProject(requestedPath: string): RecentProjectEntry | undefined {
    return findCurrentRecentProject(getRecentProjectsFilePath(), requestedPath);
  }

  private _maxItems(): number {
    const value = vscode.workspace.getConfiguration('null.recentProjects').get<number>('maxItems', 20);
    return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 20;
  }

  private _sendProjectsAndStatuses(webview: vscode.Webview): void {
    const projects = readRecentProjects(getRecentProjectsFilePath());
    const launcherProjects: LauncherProject[] = projects.map(project => {
      const available = fs.existsSync(project.path);
      return { ...project, available, ...(available ? detectProjectType(project.path) : undefined) };
    });
    webview.postMessage({ type: 'projects', projects: launcherProjects } as OutboundMessage);
    void computeGitStatuses(
      projects.map(p => p.path),
      (path, status) => webview.postMessage({ type: 'gitStatus', path, status } as OutboundMessage),
    );
  }

  private _buildHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const projectionUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', 'recent-projects.js'));
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
  #launcher-controls { display:flex; gap:8px; }
  input, select { background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border); border-radius:3px; padding:6px; font:inherit; }
  button { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none;
           border-radius:4px; padding:6px 12px; cursor:pointer; font:inherit; }
  button:hover { background:var(--vscode-button-hoverBackground); }
  button.secondary { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }
  #cards { overflow:auto; }
  .section-title { font-weight:600; margin:8px 0; }
  .section-projects { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:12px; }
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
  <div id="launcher-controls"><input id="search" aria-label="Search projects" placeholder="Search projects"><select id="sort" aria-label="Sort projects"><option value="lastOpened">Last opened</option><option value="name">Name</option><option value="location">Location</option></select></div>
  <div id="cards"></div>
</div>
<script nonce="${nonce}" src="${projectionUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
  }
}

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
import { withAccounts } from './dashboardAccounts';
import { getAccountsApi } from './github/githubAuth';
import { AvailableUpdate, StagedUpdate, onStagedUpdateChanged } from './updater';
import { DashboardHome, envMissing, homeUpdate, todayMs } from './dashboardHome';

type LauncherProject = RecentProjectEntry & { available: boolean; projectType?: string; icon?: string; account?: string };

type OutboundMessage =
  | { type: 'projects'; projects: LauncherProject[] }
  | { type: 'gitStatus'; path: string; status: GitStatus | null }
  | ({ type: 'home' } & DashboardHome);

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
  | { type: 'cloneRepo' }
  | { type: 'installUpdate' }
  | { type: 'openIssues' }
  | { type: 'openAccounts' }
  | { type: 'openEnv' };

const HOME_REFRESH_MS = 30_000;

/** Required findings from null-env. A command, not exports: null-env runs in the workspace host, this extension in the UI host. */
async function fetchEnvMissing(): Promise<number | undefined> {
  try {
    return envMissing(await vscode.commands.executeCommand<Array<{ severity: string }>>('null.env.getFindings'));
  } catch {
    return undefined;
  }
}

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
    // A bind, rebind or removed account changes a card's label; a visible dashboard shouldn't wait for Refresh.
    const accountsChanged = getAccountsApi()?.onDidChange(() => this._sendProjectsAndStatuses(panel.webview));
    const updateChanged = onStagedUpdateChanged.event(() => this._sendHome(panel.webview));
    // Activity fires on every heartbeat; a minute-resolution readout only needs a slow tick.
    const ticker = setInterval(() => this._sendHome(panel.webview), HOME_REFRESH_MS);
    panel.onDidDispose(() => { accountsChanged?.dispose(); updateChanged.dispose(); clearInterval(ticker); });
  }

  private _handleMessage(msg: InboundMessage, webview: vscode.Webview): void {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        this._sendProjectsAndStatuses(webview);
        this._sendHome(webview);
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
      case 'installUpdate':
        void vscode.commands.executeCommand('null.installUpdate');
        break;
      case 'openIssues':
        void vscode.commands.executeCommand('null.issues.openFullView');
        break;
      case 'openAccounts':
        void vscode.commands.executeCommand('null-accounts.open');
        break;
      case 'openEnv':
        void vscode.commands.executeCommand('null.env.check');
        break;
    }
  }

  private _currentProject(requestedPath: string): RecentProjectEntry | undefined {
    return findCurrentRecentProject(getRecentProjectsFilePath(), requestedPath);
  }

  private _maxItems(): number {
    const value = vscode.workspace.getConfiguration('null.recentProjects').get<number>('maxItems', 50);
    return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 20;
  }

  private _sendProjectsAndStatuses(webview: vscode.Webview): void {
    const projects = readRecentProjects(getRecentProjectsFilePath());
    const accounts = getAccountsApi();
    const launcherProjects: LauncherProject[] = withAccounts(
      projects.map(project => {
        const available = fs.existsSync(project.path);
        return { ...project, available, ...(available ? detectProjectType(project.path) : undefined) };
      }),
      folder => accounts?.getAccountForFolder(vscode.Uri.file(folder)),
    );
    webview.postMessage({ type: 'projects', projects: launcherProjects } as OutboundMessage);
    void computeGitStatuses(
      projects.map(p => p.path),
      (path, status) => webview.postMessage({ type: 'gitStatus', path, status } as OutboundMessage),
    );
  }

  private _sendHome(webview: vscode.Webview): void {
    const state = this.context.globalState;
    const update = homeUpdate(state.get<AvailableUpdate>('null.availableUpdate'), state.get<StagedUpdate>('null.stagedUpdate'));
    const send = (activity: Parameters<typeof todayMs>[0]): void => {
      void fetchEnvMissing().then(missing =>
        webview.postMessage({ type: 'home', update, todayMs: todayMs(activity), envMissing: missing } as OutboundMessage));
    };
    const extension = vscode.extensions.getExtension<Parameters<typeof todayMs>[0]>('null.null-activity');
    if (!extension) send(undefined);
    else if (extension.isActive) send(extension.exports);
    else void extension.activate().then(send, () => send(undefined));
  }

  private _buildHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const projectionUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', 'recent-projects.js'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', 'dashboard.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', 'dashboard.css'));
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src ${webview.cspSource};">
<link rel="stylesheet" href="${styleUri}">
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="i-plus" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></symbol>
  <symbol id="i-clone" viewBox="0 0 16 16"><path d="M8 2.5v7.5M4.75 7 8 10.25 11.25 7M3 13h10"/></symbol>
  <symbol id="i-folder" viewBox="0 0 16 16"><path d="M2 4.5v8h12V6H7.5L6 4.5z"/></symbol>
  <symbol id="i-search" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3.25 3.25"/></symbol>
  <symbol id="i-refresh" viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.75v2.75h-2.75"/></symbol>
  <symbol id="i-pin" viewBox="0 0 16 16"><path d="m9.5 2.5 4 4-1.5.5-2.5 2.5.25 2.25-.75.75L5.75 9.25 2.5 13.5l4.25-3.25L3.75 7.5l.75-.75 2.25.25L9.25 4.5z"/></symbol>
  <symbol id="i-window" viewBox="0 0 16 16"><path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5"/></symbol>
  <symbol id="i-copy" viewBox="0 0 16 16"><path d="M5.5 5.5h7.5V13H5.5zM3 10.5V3h7.5"/></symbol>
  <symbol id="i-x" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8"/></symbol>
  <symbol id="i-branch" viewBox="0 0 16 16"><circle cx="5" cy="3.5" r="1.5"/><circle cx="5" cy="12.5" r="1.5"/><circle cx="11" cy="6" r="1.5"/><path d="M5 5v6M11 7.5c0 2.5-6 1.5-6 4"/></symbol>
  <symbol id="i-warn" viewBox="0 0 16 16"><path d="M8 2.5 14 13H2zM8 6.5v3M8 11.25v.01"/></symbol>
  <symbol id="i-clock" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.25l2 1.25"/></symbol>
  <symbol id="i-issue" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1" fill="currentColor"/></symbol>
  <symbol id="i-user" viewBox="0 0 16 16"><circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c0-3 2.25-4.5 5-4.5s5 1.5 5 4.5"/></symbol>
  <symbol id="i-update" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M8 11V5.5M5.5 8 8 5.5 10.5 8"/></symbol>
</defs></svg>
<div id="app">
  <nav id="rail" aria-label="Start and home">
    <div class="brand">
      <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><circle cx="50" cy="50" r="27"/><path d="M75 25 25 75"/></svg>
      <span>Null IDE</span>
    </div>
    <div class="group">
      <div class="group-title">Start</div>
      <button class="rail-item" id="new-project"><svg class="i"><use href="#i-plus"/></svg><span class="label">New Project</span></button>
      <button class="rail-item" id="clone-repo"><svg class="i"><use href="#i-clone"/></svg><span class="label">Clone Repository</span></button>
      <button class="rail-item" id="open-folder"><svg class="i"><use href="#i-folder"/></svg><span class="label">Open Folder</span></button>
    </div>
    <div class="group">
      <div class="group-title">Home</div>
      <button class="rail-item update" id="update" hidden></button>
      <div class="rail-item" id="today" hidden><svg class="i"><use href="#i-clock"/></svg><span class="label">Today</span><span class="value" id="today-value"></span></div>
      <button class="rail-item" id="env" hidden><svg class="i"><use href="#i-warn"/></svg><span class="label">Environment</span><span class="value" id="env-value"></span></button>
      <button class="rail-item" id="open-issues"><svg class="i"><use href="#i-issue"/></svg><span class="label">Issues</span></button>
      <button class="rail-item" id="open-accounts"><svg class="i"><use href="#i-user"/></svg><span class="label">Accounts</span></button>
    </div>
    <div class="rail-spacer"></div>
    <div class="hints"><kbd>&uarr;</kbd> <kbd>&darr;</kbd> select<br><kbd>Enter</kbd> open<br><kbd>Ctrl</kbd>+<kbd>Enter</kbd> new window<br><kbd>Alt</kbd>+<kbd>P</kbd> pin<br><kbd>Del</kbd> remove</div>
  </nav>
  <main id="main">
    <div id="bar">
      <div class="search"><svg class="i"><use href="#i-search"/></svg><input id="search" role="combobox" aria-expanded="true" aria-controls="list" aria-label="Search projects" placeholder="Search projects" autocomplete="off" spellcheck="false"></div>
      <select id="sort" aria-label="Sort projects"><option value="lastOpened">Last opened</option><option value="name">Name</option><option value="location">Location</option></select>
      <button class="icon-btn" id="refresh" title="Refresh git status" aria-label="Refresh"><svg class="i"><use href="#i-refresh"/></svg></button>
    </div>
    <div id="list" role="listbox" aria-label="Recent projects"></div>
  </main>
</div>
<script nonce="${nonce}" src="${projectionUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
  }
}

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
exports.DashboardEditorProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("node:fs"));
const webviewUtils_1 = require("./webviewUtils");
const projectType_1 = require("./projectType");
const recentProjects_1 = require("./recentProjects");
const dashboardGitStatus_1 = require("./dashboardGitStatus");
const dashboardActions_1 = require("./dashboardActions");
const dashboardAccounts_1 = require("./dashboardAccounts");
const githubAuth_1 = require("./github/githubAuth");
const updater_1 = require("./updater");
const dashboardHome_1 = require("./dashboardHome");
const HOME_REFRESH_MS = 30_000;
class DashboardEditorProvider {
    extensionUri;
    context;
    constructor(extensionUri, context) {
        this.extensionUri = extensionUri;
        this.context = context;
    }
    openCustomDocument(uri) {
        return { uri, dispose: () => { } };
    }
    resolveCustomEditor(_document, panel) {
        panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'app-icon.svg');
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'lib')],
        };
        panel.webview.html = this._buildHtml(panel.webview);
        panel.webview.onDidReceiveMessage((msg) => this._handleMessage(msg, panel.webview));
        // A bind, rebind or removed account changes a card's label; a visible dashboard shouldn't wait for Refresh.
        const accountsChanged = (0, githubAuth_1.getAccountsApi)()?.onDidChange(() => this._sendProjectsAndStatuses(panel.webview));
        const updateChanged = updater_1.onStagedUpdateChanged.event(() => this._sendHome(panel.webview));
        // Activity fires on every heartbeat; a minute-resolution readout only needs a slow tick.
        const ticker = setInterval(() => this._sendHome(panel.webview), HOME_REFRESH_MS);
        panel.onDidDispose(() => { accountsChanged?.dispose(); updateChanged.dispose(); clearInterval(ticker); });
    }
    _handleMessage(msg, webview) {
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
                if (entry && fs.existsSync(entry.path))
                    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(entry.path), { forceNewWindow: !!msg.forceNewWindow });
                else
                    this._sendProjectsAndStatuses(webview);
                break;
            }
            case 'setPinned': {
                const entry = this._currentProject(msg.path);
                if (entry)
                    (0, recentProjects_1.setRecentProjectPinned)((0, recentProjects_1.getRecentProjectsFilePath)(), entry.path, msg.pinned, this._maxItems());
                this._sendProjectsAndStatuses(webview);
                break;
            }
            case 'removeProject': {
                const entry = this._currentProject(msg.path);
                if (entry)
                    (0, recentProjects_1.removeRecentProject)((0, recentProjects_1.getRecentProjectsFilePath)(), entry.path, this._maxItems());
                this._sendProjectsAndStatuses(webview);
                break;
            }
            case 'revealProject': {
                const entry = this._currentProject(msg.path);
                if (entry)
                    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(entry.path));
                else
                    this._sendProjectsAndStatuses(webview);
                break;
            }
            case 'copyProjectPath': {
                const entry = this._currentProject(msg.path);
                if (entry)
                    void vscode.env.clipboard.writeText(entry.path);
                else
                    this._sendProjectsAndStatuses(webview);
                break;
            }
            case 'locateProject': {
                const entry = this._currentProject(msg.path);
                if (!entry) {
                    this._sendProjectsAndStatuses(webview);
                    break;
                }
                void vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Locate Project' }).then(selected => {
                    if (!selected?.[0])
                        return;
                    if (!(0, recentProjects_1.relocateRecentProject)((0, recentProjects_1.getRecentProjectsFilePath)(), entry.path, selected[0].fsPath, this._maxItems())) {
                        vscode.window.showErrorMessage('Null: the selected location is not a directory, so the project was not relocated.');
                    }
                    this._sendProjectsAndStatuses(webview);
                });
                break;
            }
            case 'newProject':
                void (0, dashboardActions_1.runNewProjectFlow)();
                break;
            case 'cloneRepo':
                void (0, dashboardActions_1.runCloneRepoFlow)(this.context);
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
        }
    }
    _currentProject(requestedPath) {
        return (0, recentProjects_1.findCurrentRecentProject)((0, recentProjects_1.getRecentProjectsFilePath)(), requestedPath);
    }
    _maxItems() {
        const value = vscode.workspace.getConfiguration('null.recentProjects').get('maxItems', 20);
        return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 20;
    }
    _sendProjectsAndStatuses(webview) {
        const projects = (0, recentProjects_1.readRecentProjects)((0, recentProjects_1.getRecentProjectsFilePath)());
        const accounts = (0, githubAuth_1.getAccountsApi)();
        const launcherProjects = (0, dashboardAccounts_1.withAccounts)(projects.map(project => {
            const available = fs.existsSync(project.path);
            return { ...project, available, ...(available ? (0, projectType_1.detectProjectType)(project.path) : undefined) };
        }), folder => accounts?.getAccountForFolder(vscode.Uri.file(folder)));
        webview.postMessage({ type: 'projects', projects: launcherProjects });
        void (0, dashboardGitStatus_1.computeGitStatuses)(projects.map(p => p.path), (path, status) => webview.postMessage({ type: 'gitStatus', path, status }));
    }
    _sendHome(webview) {
        const state = this.context.globalState;
        const update = (0, dashboardHome_1.homeUpdate)(state.get('null.availableUpdate'), state.get('null.stagedUpdate'));
        const send = (activity) => {
            void webview.postMessage({ type: 'home', update, todayMs: (0, dashboardHome_1.todayMs)(activity) });
        };
        const extension = vscode.extensions.getExtension('null.null-activity');
        if (!extension)
            send(undefined);
        else if (extension.isActive)
            send(extension.exports);
        else
            void extension.activate().then(send, () => send(undefined));
    }
    _buildHtml(webview) {
        const nonce = (0, webviewUtils_1.getNonce)();
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
exports.DashboardEditorProvider = DashboardEditorProvider;
//# sourceMappingURL=dashboard.js.map
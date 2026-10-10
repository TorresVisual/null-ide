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
        panel.onDidDispose(() => accountsChanged?.dispose());
    }
    _handleMessage(msg, webview) {
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
    _buildHtml(webview) {
        const nonce = (0, webviewUtils_1.getNonce)();
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
exports.DashboardEditorProvider = DashboardEditorProvider;
//# sourceMappingURL=dashboard.js.map
/// <reference path="./webview/settings/protocol.ts" />
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
exports.ActionButtonsPanel = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const buttonConfig_1 = require("./buttonConfig");
const buttonConfigIntegration_1 = require("./buttonConfigIntegration");
const projectDetector_1 = require("./projectDetector");
const envApi_1 = require("./envApi");
const npmScriptsProvider_1 = require("./npmScriptsProvider");
const workspaceFolder_1 = require("./workspaceFolder");
function getNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
class ActionButtonsPanel {
    static current;
    panel;
    extensionUri;
    static createOrShow(extensionUri) {
        if (ActionButtonsPanel.current) {
            ActionButtonsPanel.current.panel.reveal(vscode.ViewColumn.One);
            return;
        }
        const panel = vscode.window.createWebviewPanel('null-actions.settings', 'Action Buttons', vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'lib')],
        });
        ActionButtonsPanel.current = new ActionButtonsPanel(panel, extensionUri);
    }
    static refreshIfOpen() {
        ActionButtonsPanel.current?.postState();
    }
    constructor(panel, extensionUri) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.panel.webview.html = this.getHtml();
        this.panel.webview.onDidReceiveMessage((msg) => {
            if (msg.type === 'ready') {
                this.postState();
            }
            else if (msg.type === 'dirty') {
                this.panel.title = msg.dirty ? 'Action Buttons ●' : 'Action Buttons';
            }
            else if (msg.type === 'save') {
                this.handleSave(msg.buttons);
            }
            else if (msg.type === 'browseFile') {
                this.handleBrowseFile(msg.id);
            }
            else if (msg.type === 'loadNpmScripts') {
                this.handleLoadNpmScripts();
            }
        });
        this.panel.onDidDispose(() => {
            ActionButtonsPanel.current = undefined;
        });
    }
    postState() {
        const { buttons, errors } = (0, buttonConfigIntegration_1.readButtonConfigs)();
        const folder = (0, workspaceFolder_1.activeWorkspaceFolder)();
        const suggestions = folder ? (0, projectDetector_1.detectSuggestedButtons)(folder.uri.fsPath, (0, envApi_1.getEnvApi)().detectProjects) : [];
        this.panel.webview.postMessage({ type: 'init', buttons, suggestions, errors });
    }
    async handleSave(raw) {
        const { buttons, errors } = (0, buttonConfig_1.parseButtonConfigs)(raw);
        if (errors.length > 0) {
            this.panel.webview.postMessage({ type: 'error', errors });
            return;
        }
        await (0, buttonConfigIntegration_1.writeButtonConfigs)(buttons);
        // The canonical buttons let the webview adopt exactly what was written as its saved snapshot.
        this.panel.webview.postMessage({ type: 'saved', buttons });
    }
    async handleBrowseFile(id) {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: 'Select',
        });
        if (!uris || uris.length === 0) {
            return;
        }
        this.panel.webview.postMessage({ type: 'fileSelected', id, path: uris[0].fsPath });
    }
    handleLoadNpmScripts() {
        const folder = (0, workspaceFolder_1.activeWorkspaceFolder)();
        if (!folder) {
            this.panel.webview.postMessage({ type: 'npmScriptsLoaded', buttons: [], errors: ['No workspace folder is open.'] });
            return;
        }
        const pkgPath = path.join(folder.uri.fsPath, 'package.json');
        if (!fs.existsSync(pkgPath)) {
            this.panel.webview.postMessage({ type: 'npmScriptsLoaded', buttons: [], errors: [`No package.json found in ${folder.name}.`] });
            return;
        }
        let content;
        try {
            content = fs.readFileSync(pkgPath, 'utf8');
        }
        catch {
            this.panel.webview.postMessage({ type: 'npmScriptsLoaded', buttons: [], errors: ['Could not read package.json.'] });
            return;
        }
        const scripts = (0, npmScriptsProvider_1.parseNpmScripts)(content);
        const buttons = scripts.map((s, i) => (0, npmScriptsProvider_1.toActionButtonConfig)(s, -i));
        this.panel.webview.postMessage({ type: 'npmScriptsLoaded', buttons, errors: [] });
    }
    getHtml() {
        const nonce = getNonce();
        const webview = this.panel.webview;
        const lib = (file) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "lib", file)).toString();
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Action Buttons</title>
<link rel="stylesheet" href="${lib("settings.css")}">
</head>
<body>
<div id="page">
<header id="page-header">
  <h1><span class="dot"></span>Action Buttons</h1>
  <p class="subtitle">Status bar shortcuts for the commands you run most</p>
</header>
<div id="ignored-banner" class="banner" hidden></div>
<div id="external-banner" class="banner" hidden>Settings changed outside this panel. <button data-action="reload">Reload</button> <button data-action="keep">Keep mine</button></div>
<div id="toolbar">
  <button id="add-btn">+ Add Button</button>
  <button id="load-npm-btn">Load npm scripts</button>
  <button id="save-btn" class="primary">Save All</button>
  <span id="status"></span>
  <span id="undo" hidden></span>
</div>
<section>
<div id="buttons-list"></div>
<div id="empty-state">No buttons yet — add one above, or pick a suggestion below.</div>
</section>
<section id="suggestions-section">
  <h2>Suggested for this project</h2>
  <div id="suggestions-list"></div>
</section>
</div>
<script nonce="${nonce}" src="${lib("colorPicker.js")}"></script>
<script nonce="${nonce}" src="${lib("settings.js")}"></script>
</body>
</html>`;
    }
}
exports.ActionButtonsPanel = ActionButtonsPanel;
//# sourceMappingURL=settingsPanel.js.map
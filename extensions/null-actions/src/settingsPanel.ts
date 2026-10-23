/// <reference path="./webview/settings/protocol.ts" />
'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseButtonConfigs } from './buttonConfig';
import { readButtonConfigs, writeButtonConfigs } from './buttonConfigIntegration';
import { detectSuggestedButtons, SuggestedButton } from './projectDetector';
import { getEnvApi } from './envApi';
import { parseNpmScripts, toActionButtonConfig } from './npmScriptsProvider';
import { activeWorkspaceFolder } from './workspaceFolder';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

type InboundMessage = WebviewToHost;

export class ActionButtonsPanel {
  private static current: ActionButtonsPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;

  static createOrShow(extensionUri: vscode.Uri): void {
    if (ActionButtonsPanel.current) {
      ActionButtonsPanel.current.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'null-actions.settings',
      'Action Buttons',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'lib')],
      },
    );
    ActionButtonsPanel.current = new ActionButtonsPanel(panel, extensionUri);
  }

  static refreshIfOpen(): void {
    ActionButtonsPanel.current?.postState();
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage((msg: InboundMessage) => {
      if (msg.type === 'ready') {
        this.postState();
      } else if (msg.type === 'save') {
        this.handleSave(msg.buttons);
      } else if (msg.type === 'browseFile') {
        this.handleBrowseFile(msg.id);
      } else if (msg.type === 'loadNpmScripts') {
        this.handleLoadNpmScripts();
      }
    });

    this.panel.onDidDispose(() => {
      ActionButtonsPanel.current = undefined;
    });
  }

  private postState(): void {
    const { buttons } = readButtonConfigs();
    const folder = activeWorkspaceFolder();
    const suggestions: SuggestedButton[] = folder ? detectSuggestedButtons(folder.uri.fsPath, getEnvApi().detectProjects) : [];
    this.panel.webview.postMessage({ type: 'init', buttons, suggestions });
  }

  private async handleSave(raw: unknown): Promise<void> {
    const { buttons, errors } = parseButtonConfigs(raw);
    if (errors.length > 0) {
      this.panel.webview.postMessage({ type: 'error', errors });
      return;
    }
    await writeButtonConfigs(buttons);
    this.panel.webview.postMessage({ type: 'saved' });
  }

  private async handleBrowseFile(id: string): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Select',
    });
    if (!uris || uris.length === 0) { return; }
    this.panel.webview.postMessage({ type: 'fileSelected', id, path: uris[0].fsPath });
  }

  private handleLoadNpmScripts(): void {
    const folder = activeWorkspaceFolder();
    if (!folder) {
      this.panel.webview.postMessage({ type: 'npmScriptsLoaded', buttons: [], errors: ['No workspace folder is open.'] });
      return;
    }
    const pkgPath = path.join(folder.uri.fsPath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      this.panel.webview.postMessage({ type: 'npmScriptsLoaded', buttons: [], errors: [`No package.json found in ${folder.name}.`] });
      return;
    }
    let content: string;
    try {
      content = fs.readFileSync(pkgPath, 'utf8');
    } catch {
      this.panel.webview.postMessage({ type: 'npmScriptsLoaded', buttons: [], errors: ['Could not read package.json.'] });
      return;
    }
    const scripts = parseNpmScripts(content);
    const buttons = scripts.map((s, i) => toActionButtonConfig(s, -i));
    this.panel.webview.postMessage({ type: 'npmScriptsLoaded', buttons, errors: [] });
  }

  private getHtml(): string {
    const nonce = getNonce();
    const webview = this.panel.webview;
    const lib = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "lib", file)).toString();
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
<div id="toolbar">
  <button id="add-btn">+ Add Button</button>
  <button id="load-npm-btn">Load npm scripts</button>
  <button id="save-btn" class="primary">Save All</button>
  <span id="status"></span>
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

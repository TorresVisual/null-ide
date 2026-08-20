'use strict';

import * as vscode from 'vscode';
import { parseButtonConfigs } from './buttonConfig';
import { readButtonConfigs, writeButtonConfigs } from './buttonConfigIntegration';
import { detectSuggestedButtons, SuggestedButton } from './projectDetector';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

type InboundMessage =
  | { type: 'ready' }
  | { type: 'save'; buttons: unknown };

export class ActionButtonsViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg: InboundMessage) => {
      if (msg.type === 'ready') {
        this.postState();
      } else if (msg.type === 'save') {
        this.handleSave(msg.buttons);
      }
    });
  }

  refresh(): void {
    this.postState();
  }

  private postState(): void {
    if (!this.view) { return; }
    const { buttons } = readButtonConfigs();
    const folder = vscode.workspace.workspaceFolders?.[0];
    const suggestions: SuggestedButton[] = folder ? detectSuggestedButtons(folder.uri.fsPath) : [];
    this.view.webview.postMessage({ type: 'init', buttons, suggestions });
  }

  private async handleSave(raw: unknown): Promise<void> {
    if (!this.view) { return; }
    const { buttons, errors } = parseButtonConfigs(raw);
    if (errors.length > 0) {
      this.view.webview.postMessage({ type: 'error', errors });
      return;
    }
    await writeButtonConfigs(buttons);
    this.view.webview.postMessage({ type: 'saved' });
  }

  private getHtml(): string {
    const nonce = getNonce();
    return '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
'<meta charset="UTF-8">' +
'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'nonce-' + nonce + '\'; script-src \'nonce-' + nonce + '\';">' +
'<meta name="viewport" content="width=device-width,initial-scale=1">' +
'<title>Action Buttons</title>' +
'<style nonce="' + nonce + '">' +
this.css() +
'</style>' +
'</head>' +
'<body>' +
'<div id="toolbar">' +
'  <button id="add-btn">+ Add Button</button>' +
'  <button id="save-btn" class="primary">Save All</button>' +
'  <span id="status"></span>' +
'</div>' +
'<div id="buttons-list"></div>' +
'<h3>Suggested</h3>' +
'<div id="suggestions-list"></div>' +
'<script nonce="' + nonce + '">' +
this.clientScript() +
'</script>' +
'</body>' +
'</html>';
  }

  private css(): string {
    return '*,*::before,*::after{box-sizing:border-box;}' +
      'body{font-family:var(--vscode-font-family);font-size:12px;color:var(--vscode-foreground);padding:8px;}' +
      '#toolbar{display:flex;gap:8px;align-items:center;margin-bottom:10px;}' +
      'button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:3px;padding:4px 10px;cursor:pointer;}' +
      'button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}' +
      'button:hover{opacity:0.85;}' +
      '.card{border:1px solid var(--vscode-widget-border,rgba(255,255,255,0.1));border-radius:4px;padding:8px;margin-bottom:8px;}' +
      '.row{display:flex;gap:6px;margin-bottom:6px;align-items:center;}' +
      '.row label{width:80px;flex-shrink:0;opacity:0.75;}' +
      '.row input[type=text],.row input[type=number],.row select{flex:1;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:2px;padding:3px 6px;}' +
      '.card-footer{display:flex;gap:6px;justify-content:flex-end;}' +
      '#status{opacity:0.7;}' +
      '.suggestion{display:flex;justify-content:space-between;align-items:center;padding:4px 0;}';
  }

  private clientScript(): string {
    return 'const vscode = acquireVsCodeApi();' +
      'let buttons = [];' +
      'let suggestions = [];' +
      '' +
      'function fieldRow(label, inputHtml) {' +
      '  return "<div class=row><label>" + label + "</label>" + inputHtml + "</div>";' +
      '}' +
      '' +
      'function renderCard(btn, index) {' +
      '  const html =' +
      '    fieldRow("Label", "<input type=text data-field=label data-index=" + index + " value=\\"" + (btn.label || "").replace(/\\"/g, "&quot;") + "\\">") +' +
      '    fieldRow("Command", "<input type=text data-field=command data-index=" + index + " value=\\"" + (btn.command || "").replace(/\\"/g, "&quot;") + "\\">") +' +
      '    fieldRow("Type", "<select data-field=type data-index=" + index + "><option value=terminal" + (btn.type === "terminal" ? " selected" : "") + ">terminal</option><option value=vscode-command" + (btn.type === "vscode-command" ? " selected" : "") + ">vscode-command</option></select>") +' +
      '    fieldRow("Icon", "<input type=text data-field=icon data-index=" + index + " value=\\"" + (btn.icon || "") + "\\" placeholder=tools>") +' +
      '    fieldRow("Color", "<input type=text data-field=color data-index=" + index + " value=\\"" + (btn.color || "") + "\\" placeholder=#ffcc00>") +' +
      '    fieldRow("Background", "<select data-field=background data-index=" + index + "><option value=none" + (btn.background === "none" ? " selected" : "") + ">none</option><option value=warning" + (btn.background === "warning" ? " selected" : "") + ">warning</option><option value=error" + (btn.background === "error" ? " selected" : "") + ">error</option></select>") +' +
      '    fieldRow("Tooltip", "<input type=text data-field=tooltip data-index=" + index + " value=\\"" + (btn.tooltip || "") + "\\">") +' +
      '    fieldRow("Cwd", "<input type=text data-field=cwd data-index=" + index + " value=\\"" + (btn.cwd || "") + "\\" placeholder=${workspaceFolder}>") +' +
      '    fieldRow("Alignment", "<select data-field=alignment data-index=" + index + "><option value=left" + (btn.alignment === "left" ? " selected" : "") + ">left</option><option value=right" + (btn.alignment === "right" ? " selected" : "") + ">right</option></select>") +' +
      '    fieldRow("Priority", "<input type=number data-field=priority data-index=" + index + " value=" + (btn.priority || 0) + ">") +' +
      '    fieldRow("Save all", "<input type=checkbox data-field=saveAll data-index=" + index + (btn.saveAll ? " checked" : "") + ">") +' +
      '    fieldRow("Focus", "<input type=checkbox data-field=focus data-index=" + index + (btn.focus ? " checked" : "") + ">") +' +
      '    fieldRow("Languages", "<input type=text data-field=whenLanguages data-index=" + index + " value=\\"" + ((btn.when && btn.when.languages) || []).join(",") + "\\" placeholder=cpp,c>") +' +
      '    fieldRow("Files exist", "<input type=text data-field=whenFilesExist data-index=" + index + " value=\\"" + ((btn.when && btn.when.filesExist) || []).join(",") + "\\" placeholder=CMakeLists.txt>") +' +
      '    fieldRow("Folder", "<input type=text data-field=whenFolder data-index=" + index + " value=\\"" + ((btn.when && btn.when.folder) || "") + "\\">") +' +
      '    "<div class=card-footer>" +' +
      '    "<button data-action=up data-index=" + index + ">Up</button>" +' +
      '    "<button data-action=down data-index=" + index + ">Down</button>" +' +
      '    "<button data-action=delete data-index=" + index + ">Delete</button>" +' +
      '    "</div>";' +
      '  const div = document.createElement("div");' +
      '  div.className = "card";' +
      '  div.innerHTML = html;' +
      '  return div;' +
      '}' +
      '' +
      'function render() {' +
      '  const list = document.getElementById("buttons-list");' +
      '  list.innerHTML = "";' +
      '  buttons.forEach(function(btn, i) { list.appendChild(renderCard(btn, i)); });' +
      '' +
      '  const sList = document.getElementById("suggestions-list");' +
      '  sList.innerHTML = "";' +
      '  suggestions.forEach(function(s) {' +
      '    const row = document.createElement("div");' +
      '    row.className = "suggestion";' +
      '    row.innerHTML = "<span>" + s.label + "</span><button data-action=add-suggestion data-id=" + s.id + ">+ Add</button>";' +
      '    sList.appendChild(row);' +
      '  });' +
      '}' +
      '' +
      'function fieldToButtons(index, field, value) {' +
      '  const btn = buttons[index];' +
      '  if (field === "whenLanguages" || field === "whenFilesExist" || field === "whenFolder") {' +
      '    btn.when = btn.when || {};' +
      '    if (field === "whenLanguages") { btn.when.languages = value ? value.split(",").map(function(s){return s.trim();}).filter(Boolean) : undefined; }' +
      '    if (field === "whenFilesExist") { btn.when.filesExist = value ? value.split(",").map(function(s){return s.trim();}).filter(Boolean) : undefined; }' +
      '    if (field === "whenFolder") { btn.when.folder = value || undefined; }' +
      '    return;' +
      '  }' +
      '  btn[field] = value;' +
      '}' +
      '' +
      'document.addEventListener("input", function(e) {' +
      '  const t = e.target;' +
      '  const field = t.getAttribute("data-field");' +
      '  if (!field) { return; }' +
      '  const index = parseInt(t.getAttribute("data-index"), 10);' +
      '  let value = t.type === "checkbox" ? t.checked : t.value;' +
      '  if (t.type === "number") { value = parseFloat(t.value) || 0; }' +
      '  fieldToButtons(index, field, value);' +
      '});' +
      '' +
      'document.addEventListener("click", function(e) {' +
      '  const t = e.target;' +
      '  const action = t.getAttribute("data-action");' +
      '  if (!action) { return; }' +
      '  const index = parseInt(t.getAttribute("data-index"), 10);' +
      '  if (action === "delete") { buttons.splice(index, 1); render(); }' +
      '  if (action === "up" && index > 0) { const tmp = buttons[index - 1]; buttons[index - 1] = buttons[index]; buttons[index] = tmp; render(); }' +
      '  if (action === "down" && index < buttons.length - 1) { const tmp = buttons[index + 1]; buttons[index + 1] = buttons[index]; buttons[index] = tmp; render(); }' +
      '  if (action === "add-suggestion") {' +
      '    const id = t.getAttribute("data-id");' +
      '    const s = suggestions.find(function(x) { return x.id === id; });' +
      '    if (s) {' +
      '      buttons.push({ id: s.id, label: s.label, command: s.command, icon: s.icon, type: "terminal", background: "none", alignment: "left", priority: 0, saveAll: false, focus: false });' +
      '      render();' +
      '    }' +
      '  }' +
      '});' +
      '' +
      'document.getElementById("add-btn").addEventListener("click", function() {' +
      '  buttons.push({ id: "button-" + Date.now(), label: "New Button", command: "", type: "terminal", background: "none", alignment: "left", priority: 0, saveAll: false, focus: false });' +
      '  render();' +
      '});' +
      '' +
      'document.getElementById("save-btn").addEventListener("click", function() {' +
      '  vscode.postMessage({ type: "save", buttons: buttons });' +
      '});' +
      '' +
      'window.addEventListener("message", function(event) {' +
      '  const msg = event.data;' +
      '  if (msg.type === "init") {' +
      '    buttons = msg.buttons;' +
      '    suggestions = msg.suggestions;' +
      '    render();' +
      '  } else if (msg.type === "saved") {' +
      '    document.getElementById("status").textContent = "Saved";' +
      '    setTimeout(function() { document.getElementById("status").textContent = ""; }, 1500);' +
      '  } else if (msg.type === "error") {' +
      '    document.getElementById("status").textContent = "Error: " + msg.errors.join("; ");' +
      '  }' +
      '});' +
      '' +
      'vscode.postMessage({ type: "ready" });';
  }
}

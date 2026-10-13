'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseButtonConfigs } from './buttonConfig';
import { readButtonConfigs, writeButtonConfigs } from './buttonConfigIntegration';
import { detectSuggestedButtons, SuggestedButton } from './projectDetector';
import { getEnvApi } from './envApi';
import { parseNpmScripts, toActionButtonConfig } from './npmScriptsProvider';

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
  | { type: 'save'; buttons: unknown }
  | { type: 'browseFile'; index: number }
  | { type: 'loadNpmScripts' };

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
        this.handleBrowseFile(msg.index);
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
    const folder = vscode.workspace.workspaceFolders?.[0];
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

  private async handleBrowseFile(index: number): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Select',
    });
    if (!uris || uris.length === 0) { return; }
    this.panel.webview.postMessage({ type: 'fileSelected', index, path: uris[0].fsPath });
  }

  private handleLoadNpmScripts(): void {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.panel.webview.postMessage({ type: 'npmScriptsLoaded', buttons: [], errors: ['No workspace folder is open.'] });
      return;
    }
    const pkgPath = path.join(folder.uri.fsPath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      this.panel.webview.postMessage({ type: 'npmScriptsLoaded', buttons: [], errors: ['No package.json found in the workspace root.'] });
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
    const cspSource = this.panel.webview.cspSource;
    const colorPickerUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'lib', 'colorPicker.js'),
    );
    return '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
'<meta charset="UTF-8">' +
'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'nonce-' + nonce + '\'; script-src ' + cspSource + ' \'nonce-' + nonce + '\';">' +
'<meta name="viewport" content="width=device-width,initial-scale=1">' +
'<title>Action Buttons</title>' +
'<style nonce="' + nonce + '">' +
this.css() +
'</style>' +
'</head>' +
'<body>' +
'<div id="page">' +
'<header id="page-header">' +
'  <h1><span class="dot"></span>Action Buttons</h1>' +
'  <p class="subtitle">Status bar shortcuts for the commands you run most</p>' +
'</header>' +
'<div id="toolbar">' +
'  <button id="add-btn">+ Add Button</button>' +
'  <button id="load-npm-btn">Load npm scripts</button>' +
'  <button id="save-btn" class="primary">Save All</button>' +
'  <span id="status"></span>' +
'</div>' +
'<section>' +
'<div id="buttons-list"></div>' +
'<div id="empty-state">No buttons yet — add one above, or pick a suggestion below.</div>' +
'</section>' +
'<section id="suggestions-section">' +
'  <h2>Suggested for this project</h2>' +
'  <div id="suggestions-list"></div>' +
'</section>' +
'</div>' +
'<script nonce="' + nonce + '" src="' + colorPickerUri.toString() + '"></script>' +
'<script nonce="' + nonce + '">' +
this.clientScript() +
'</script>' +
'</body>' +
'</html>';
  }

  private css(): string {
    return '*,*::before,*::after{box-sizing:border-box;}' +
      ':root{--mono:var(--vscode-editor-font-family,"Geist Mono","JetBrains Mono","Cascadia Code",ui-monospace,monospace);}' +
      'body{font-family:var(--vscode-font-family);font-size:12px;line-height:1.5;color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;}' +
      '#page{max-width:640px;margin:0 auto;padding:28px 26px 60px;}' +
      '' +
      '#page-header{margin-bottom:22px;}' +
      '#page-header h1{display:flex;align-items:center;gap:9px;font-family:var(--mono);font-size:19px;font-weight:600;letter-spacing:.01em;margin:0 0 5px;}' +
      '#page-header .dot{width:8px;height:8px;flex-shrink:0;border-radius:50%;background:var(--vscode-focusBorder);box-shadow:0 0 10px var(--vscode-focusBorder);}' +
      '#page-header .subtitle{margin:0;color:var(--vscode-descriptionForeground);font-size:12px;}' +
      '' +
      '#toolbar{display:flex;gap:8px;align-items:center;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--vscode-widget-border,rgba(255,255,255,.08));}' +
      'button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:4px;padding:5px 12px;cursor:pointer;font-size:12px;font-family:inherit;transition:transform .12s ease,filter .12s ease;}' +
      'button:hover{filter:brightness(1.12);transform:translateY(-1px);}' +
      'button:active{transform:translateY(0);}' +
      'button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}' +
      '' +
      '#status{font-size:11px;padding:3px 9px;border-radius:9px;opacity:0;transform:translateY(-2px);transition:opacity .18s ease,transform .18s ease;}' +
      '#status.visible{opacity:1;transform:translateY(0);}' +
      '#status.ok{color:#8fd19e;background:rgba(63,185,80,.15);}' +
      '#status.err{color:#f2a3a3;background:rgba(224,90,90,.15);}' +
      '' +
      'section{margin-bottom:26px;}' +
      '' +
      '#empty-state{display:none;text-align:center;padding:30px 18px;color:var(--vscode-descriptionForeground);font-size:12px;border:1px dashed var(--vscode-widget-border,rgba(255,255,255,.14));border-radius:8px;}' +
      '#empty-state.visible{display:block;}' +
      '' +
      '.card{background:var(--vscode-editorWidget-background,rgba(255,255,255,.02));border:1px solid var(--vscode-widget-border,rgba(255,255,255,.08));border-radius:7px;margin-bottom:9px;overflow:hidden;animation:card-in .22s ease both;}' +
      '@keyframes card-in{from{opacity:0;transform:translateY(3px);}to{opacity:1;transform:translateY(0);}}' +
      '' +
      '.card-header{display:flex;align-items:center;gap:9px;padding:9px 12px;cursor:pointer;user-select:none;}' +
      '.card-header:hover{background:rgba(255,255,255,.03);}' +
      '.chevron{display:inline-block;flex-shrink:0;width:9px;font-size:9px;opacity:.55;transition:transform .15s ease;}' +
      '.card.collapsed .chevron{transform:rotate(-90deg);}' +
      '.card-title{font-weight:600;flex-shrink:0;}' +
      '.card-summary{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono);font-size:11px;color:var(--vscode-descriptionForeground);}' +
      '' +
      '.card-body{max-height:960px;opacity:1;padding:2px 13px 13px;transition:max-height .22s ease,opacity .16s ease,padding .22s ease;}' +
      '.card.collapsed .card-body{max-height:0;opacity:0;padding-top:0;padding-bottom:0;pointer-events:none;}' +
      '' +
      '.field-section{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--vscode-focusBorder);opacity:.85;margin:14px 0 6px;}' +
      '.field-section:first-of-type{margin-top:2px;}' +
      '' +
      '.row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:7px;align-items:center;}' +
      '.row label{width:82px;flex:0 0 82px;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--vscode-descriptionForeground);}' +
      '.row input[type=text],.row input[type=number],.row select{flex:1 1 110px;min-width:0;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:4px;padding:4px 8px;font-size:12px;font-family:inherit;transition:border-color .12s ease;}' +
      '.row input[data-field=command]{font-family:var(--mono);}' +
      '.row input:focus,.row select:focus{outline:none;border-color:var(--vscode-focusBorder);}' +
      '.row button{flex:0 0 auto;}' +
      '.color-swatch{width:28px;height:26px;flex:0 0 28px;padding:0;border:1px solid var(--vscode-input-border,rgba(255,255,255,.2));border-radius:4px;cursor:pointer;transition:transform .12s ease,box-shadow .12s ease;}' +
      '.color-swatch:hover{transform:translateY(0) scale(1.06);box-shadow:0 0 0 2px var(--vscode-focusBorder);}' +
      '' +
      '.null-color-popover{position:fixed;z-index:1000;background:#1c1c22;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:14px;box-shadow:0 8px 28px rgba(0,0,0,.5);}' +
      '.null-color-canvas{display:block;cursor:crosshair;touch-action:none;}' +
      '.null-color-canvas:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px;}' +
      '' +
      '.card-footer{display:flex;gap:6px;justify-content:flex-end;margin-top:9px;padding-top:9px;border-top:1px solid var(--vscode-widget-border,rgba(255,255,255,.06));}' +
      '.card-footer button[data-action=delete]{color:#f2a3a3;}' +
      '' +
      '#suggestions-section h2{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--vscode-descriptionForeground);margin:0 0 8px;}' +
      '#suggestions-list{border:1px dashed var(--vscode-widget-border,rgba(255,255,255,.14));border-radius:7px;padding:2px 12px;}' +
      '#suggestions-list:empty{display:none;}' +
      '.suggestion{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--vscode-widget-border,rgba(255,255,255,.05));}' +
      '.suggestion:last-child{border-bottom:none;}' +
      '.suggestion-label{font-family:var(--mono);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}';
  }

  private clientScript(): string {
    return 'const vscode = acquireVsCodeApi();' +
      'let buttons = [];' +
      'let suggestions = [];' +
      'let collapsedIds = null;' +
      '' +
      // Curated subset of codicon names -- not the full ~500-icon set, just
      // ones plausibly useful on an action button. The Icon field stays a
      // free-text input (any codicon name works), this only powers the
      // dropdown suggestions via <datalist>.
      'const ICON_OPTIONS = ["play","debug-start","stop-circle","refresh","sync","tools","gear","terminal","terminal-cmd","git-branch","git-commit","git-merge","cloud-upload","cloud-download","package","beaker","bug","rocket","database","server","server-process","globe","link","link-external","file-code","file-binary","folder","save","save-all","trash","search","filter","list-unordered","checklist","zap","flame","gift","star-full","heart","warning","error","info","question","arrow-up","arrow-down","arrow-right","arrow-left","chevron-right","debug-rerun","debug-restart","clear-all","export","desktop-download","key","lock","unlock","shield","pulse","graph-line","dashboard","tag","milestone","history","comment","mail","bell","wrench","combine","split-horizontal","notebook","code","symbol-method","circuit-board","layers","publish","repo-push","repo-pull","versions"];' +
      'const ICON_OPTIONS_HTML = ICON_OPTIONS.map(function(name) { return "<option value=" + name + ">"; }).join("");' +
      '' +
      'function escapeHtml(s) {' +
      '  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");' +
      '}' +
      '' +
      'function colorSwatchValue(color) {' +
      '  return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#ffffff";' +
      '}' +
      '' +
      'function fieldRow(label, inputHtml, id) {' +
      '  return "<div class=row><label for=" + id + ">" + label + "</label>" + inputHtml + "</div>";' +
      '}' +
      '' +
      'function renderCard(btn, index) {' +
      '  const collapsed = collapsedIds.has(btn.id);' +
      '  const header =' +
      '    "<div class=card-header data-action=toggle data-index=" + index + " tabindex=0 role=button aria-expanded=" + (!collapsed) + ">" +' +
      '    "<span class=chevron>\\u25BC</span>" +' +
      '    "<span class=card-title>" + escapeHtml(btn.label || "(untitled)") + "</span>" +' +
      '    "<span class=card-summary>" + escapeHtml(btn.command || "") + "</span>" +' +
      '    "</div>";' +
      '' +
      '  const div = document.createElement("div");' +
      '  div.className = collapsed ? "card collapsed" : "card";' +
      '  div.style.animationDelay = (index * 25) + "ms";' +
      '' +
      '  const argsDisplay = btn.type === "vscode-command" ? "flex" : "none";' +
      '  const body =' +
      '    fieldRow("Label", "<input type=text id=field-label-" + index + " data-field=label data-index=" + index + " value=\\"" + (btn.label || "").replace(/\\"/g, "&quot;") + "\\">", "field-label-" + index) +' +
      '    "<div class=field-section>Behavior</div>" +' +
      '    fieldRow("Command", "<input type=text id=field-command-" + index + " data-field=command data-index=" + index + " value=\\"" + (btn.command || "").replace(/\\"/g, "&quot;") + "\\"><button data-action=browse data-index=" + index + ">Browse a file...</button>", "field-command-" + index) +' +
      '    fieldRow("Type", "<select id=field-type-" + index + " data-field=type data-index=" + index + "><option value=terminal" + (btn.type === "terminal" ? " selected" : "") + ">terminal</option><option value=vscode-command" + (btn.type === "vscode-command" ? " selected" : "") + ">vscode-command</option></select>", "field-type-" + index) +' +
      '    "<div class=\\"row args-row\\" data-index=" + index + " style=\\"display:" + argsDisplay + "\\"><label for=field-args-" + index + ">Args</label><input type=text id=field-args-" + index + " data-field=args data-index=" + index + " value=\\"" + ((btn.args || []).join(",")) + "\\" placeholder=arg1,arg2></div>" +' +
      '    fieldRow("Cwd", "<input type=text id=field-cwd-" + index + " data-field=cwd data-index=" + index + " value=\\"" + (btn.cwd || "") + "\\" placeholder=${workspaceFolder}>", "field-cwd-" + index) +' +
      '    fieldRow("Save all", "<input type=checkbox id=field-saveAll-" + index + " data-field=saveAll data-index=" + index + (btn.saveAll ? " checked" : "") + ">", "field-saveAll-" + index) +' +
      '    fieldRow("Focus", "<input type=checkbox id=field-focus-" + index + " data-field=focus data-index=" + index + (btn.focus !== false ? " checked" : "") + ">", "field-focus-" + index) +' +
      '    fieldRow("If running", "<select id=field-onBusy-" + index + " data-field=onBusy data-index=" + index + ">" + ["ask", "restart", "show", "run"].map(function(m){return "<option value=" + m + ((btn.onBusy || "ask") === m ? " selected" : "") + ">" + m + "</option>";}).join("") + "</select>", "field-onBusy-" + index) +' +
      '    "<div class=field-section>Appearance</div>" +' +
      '    fieldRow("Icon", "<input type=text id=field-icon-" + index + " list=icon-list-" + index + " data-field=icon data-index=" + index + " value=\\"" + (btn.icon || "") + "\\" placeholder=tools><datalist id=icon-list-" + index + ">" + ICON_OPTIONS_HTML + "</datalist>", "field-icon-" + index) +' +
      '    fieldRow("Color", "<button type=button class=color-swatch data-action=swatch data-index=" + index + " style=\\"background:" + colorSwatchValue(btn.color) + "\\" title=\\"Open color picker\\"></button><input type=text id=field-color-" + index + " data-field=color data-index=" + index + " value=\\"" + (btn.color || "") + "\\" placeholder=#ffcc00>", "field-color-" + index) +' +
      '    fieldRow("Background", "<select id=field-background-" + index + " data-field=background data-index=" + index + "><option value=none" + (btn.background === "none" ? " selected" : "") + ">none</option><option value=warning" + (btn.background === "warning" ? " selected" : "") + ">warning</option><option value=error" + (btn.background === "error" ? " selected" : "") + ">error</option></select>", "field-background-" + index) +' +
      '    fieldRow("Tooltip", "<input type=text id=field-tooltip-" + index + " data-field=tooltip data-index=" + index + " value=\\"" + (btn.tooltip || "") + "\\">", "field-tooltip-" + index) +' +
      '    fieldRow("Priority", "<input type=number id=field-priority-" + index + " data-field=priority data-index=" + index + " value=" + (btn.priority || 0) + ">", "field-priority-" + index) +' +
      '    "<div class=card-footer>" +' +
      '    "<button data-action=up data-index=" + index + ">Up</button>" +' +
      '    "<button data-action=down data-index=" + index + ">Down</button>" +' +
      '    "<button data-action=delete data-index=" + index + ">Delete</button>" +' +
      '    "</div>";' +
      '  div.innerHTML = header + "<div class=card-body>" + body + "</div>";' +
      '  return div;' +
      '}' +
      '' +
      'function render() {' +
      '  if (collapsedIds === null) { collapsedIds = new Set(buttons.map(function(b) { return b.id; })); }' +
      '  const list = document.getElementById("buttons-list");' +
      '  list.innerHTML = "";' +
      '  buttons.forEach(function(btn, i) { list.appendChild(renderCard(btn, i)); });' +
      '  document.getElementById("empty-state").classList.toggle("visible", buttons.length === 0);' +
      '' +
      '  const sList = document.getElementById("suggestions-list");' +
      '  sList.innerHTML = "";' +
      '  suggestions.forEach(function(s) {' +
      '    const row = document.createElement("div");' +
      '    row.className = "suggestion";' +
      '    row.innerHTML = "<span class=suggestion-label>" + escapeHtml(s.label) + "</span><button data-action=add-suggestion data-id=" + s.id + ">+ Add</button>";' +
      '    sList.appendChild(row);' +
      '  });' +
      '  document.getElementById("suggestions-section").style.display = suggestions.length ? "" : "none";' +
      '}' +
      '' +
      'function fieldToButtons(index, field, value) {' +
      '  const btn = buttons[index];' +
      '  if (field === "args") { btn.args = value ? value.split(",").map(function(s){return s.trim();}).filter(Boolean) : undefined; return; }' +
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
      '  if (field === "color" && /^#[0-9a-fA-F]{6}$/.test(value)) {' +
      '    const swatch = document.querySelector("[data-action=swatch][data-index=" + index + "]");' +
      '    if (swatch) { swatch.style.background = value; }' +
      '  }' +
      '  if (field === "type") {' +
      '    const argsRow = document.querySelector(".args-row[data-index=" + index + "]");' +
      '    if (argsRow) { argsRow.style.display = value === "vscode-command" ? "flex" : "none"; }' +
      '  }' +
      '});' +
      '' +
      'document.addEventListener("click", function(e) {' +
      '  const t = e.target.closest("[data-action]");' +
      '  if (!t) { return; }' +
      '  const action = t.getAttribute("data-action");' +
      '  const index = parseInt(t.getAttribute("data-index"), 10);' +
      '  if (action === "toggle") {' +
      '    const btn = buttons[index];' +
      '    if (collapsedIds.has(btn.id)) { collapsedIds.delete(btn.id); } else { collapsedIds.add(btn.id); }' +
      '    render();' +
      '  }' +
      '  if (action === "browse") { vscode.postMessage({ type: "browseFile", index: index }); }' +
      '  if (action === "swatch") {' +
      '    const btn = buttons[index];' +
      '    NullColorPicker.toggle(t, btn.color || "#3fa9f5", function(hex) {' +
      '      btn.color = hex;' +
      '      t.style.background = hex;' +
      '      const textInput = document.querySelector("input[data-field=color][data-index=" + index + "]");' +
      '      if (textInput) { textInput.value = hex; }' +
      '    });' +
      '  }' +
      '  if (action === "delete") { buttons.splice(index, 1); render(); }' +
      '  if (action === "up" && index > 0) { const tmp = buttons[index - 1]; buttons[index - 1] = buttons[index]; buttons[index] = tmp; render(); }' +
      '  if (action === "down" && index < buttons.length - 1) { const tmp = buttons[index + 1]; buttons[index + 1] = buttons[index]; buttons[index] = tmp; render(); }' +
      '  if (action === "add-suggestion") {' +
      '    const id = t.getAttribute("data-id");' +
      '    const s = suggestions.find(function(x) { return x.id === id; });' +
      '    if (s) {' +
      '      buttons.push({ id: s.id, label: s.label, command: s.command, icon: s.icon, type: "terminal", background: "none", priority: 0, saveAll: false, focus: true });' +
      '      render();' +
      '    }' +
      '  }' +
      '});' +
      '' +
      'document.addEventListener("keydown", function(e) {' +
      '  if (e.key !== "Enter" && e.key !== " ") { return; }' +
      '  const t = e.target.closest("[data-action=toggle]");' +
      '  if (!t) { return; }' +
      '  e.preventDefault();' +
      '  t.click();' +
      '});' +
      '' +
      'document.getElementById("add-btn").addEventListener("click", function() {' +
      '  buttons.push({ id: "button-" + Date.now(), label: "New Button", command: "", type: "terminal", background: "none", priority: 0, saveAll: false, focus: true });' +
      '  render();' +
      '});' +
      '' +
      'document.getElementById("load-npm-btn").addEventListener("click", function() {' +
      '  vscode.postMessage({ type: "loadNpmScripts" });' +
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
      '    const el = document.getElementById("status");' +
      '    el.textContent = "\\u2713 Saved";' +
      '    el.className = "visible ok";' +
      '    setTimeout(function() { el.className = ""; }, 1600);' +
      '  } else if (msg.type === "error") {' +
      '    const el = document.getElementById("status");' +
      '    el.textContent = "Error: " + msg.errors.join("; ");' +
      '    el.className = "visible err";' +
      '  } else if (msg.type === "fileSelected") {' +
      '    const path = msg.path.indexOf(" ") >= 0 ? "\\"" + msg.path + "\\"" : msg.path;' +
      '    buttons[msg.index].command = path;' +
      '    render();' +
      '  } else if (msg.type === "npmScriptsLoaded") {' +
      '    if (msg.errors && msg.errors.length) {' +
      '      const el = document.getElementById("status");' +
      '      el.textContent = msg.errors.join("; ");' +
      '      el.className = "visible err";' +
      '    } else {' +
      '      const existingIds = new Set(buttons.map(function(b) { return b.id; }));' +
      '      msg.buttons.forEach(function(b) {' +
      '        if (!existingIds.has(b.id)) { buttons.push(b); existingIds.add(b.id); }' +
      '      });' +
      '      render();' +
      '    }' +
      '  }' +
      '});' +
      '' +
      'vscode.postMessage({ type: "ready" });';
  }
}

'use strict';

import * as vscode from 'vscode';
import { getNonce } from './webviewUtils';

export function showWelcomePage(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    'null.welcome', 'Welcome to Null IDE', vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: false },
  );

  const nonce = getNonce();
  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Welcome to Null IDE</title>
<style nonce="${nonce}">
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1f1f1f; color: rgba(255,255,255,0.75);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    font-size: 13px; display: flex; flex-direction: column; align-items: center;
    justify-content: center; min-height: 100vh; padding: 40px 24px; gap: 0; }
  .hero { display: flex; flex-direction: column; align-items: center; gap: 16px; margin-bottom: 48px; }
  .logo svg { display: block; }
  @keyframes wc-circle { from { stroke-dashoffset: 170 } to { stroke-dashoffset: 0 } }
  @keyframes wc-slash  { from { stroke-dashoffset: 71  } to { stroke-dashoffset: 0 } }
  .logo circle { stroke-dasharray: 170; stroke-dashoffset: 170; animation: wc-circle 1s ease-out 0.1s forwards; }
  .logo .slash  { stroke-dasharray: 71;  stroke-dashoffset: 71;  animation: wc-slash  0.6s ease-out 0.55s forwards; }
  h1 { font-family: "Geist Mono","JetBrains Mono","Cascadia Code",ui-monospace,monospace;
    font-size: 22px; font-weight: 400; letter-spacing: 0.25em; color: rgba(255,255,255,0.9); }
  .sub { font-size: 12px; color: rgba(255,255,255,0.35); letter-spacing: 0.1em; }
  .shortcuts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 32px;
    max-width: 480px; width: 100%; margin-bottom: 40px; }
  .shortcut { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 10px 14px; background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07); border-radius: 6px; }
  .shortcut-label { color: rgba(255,255,255,0.55); font-size: 12px; }
  .shortcut-key { font-family: "Geist Mono","JetBrains Mono",ui-monospace,monospace;
    font-size: 11px; color: rgba(255,255,255,0.35); white-space: nowrap; }
  .actions { display: flex; gap: 10px; }
  button { padding: 9px 20px; border-radius: 6px; border: none; font-size: 12px; cursor: pointer;
    font-family: inherit; letter-spacing: 0.03em; transition: opacity 0.15s ease; }
  button:hover { opacity: 0.85; }
  .btn-primary { background: #0078D4; color: #fff; }
  .btn-secondary { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7);
    border: 1px solid rgba(255,255,255,0.1); }
</style>
</head>
<body>
<div class="hero">
  <div class="logo">
    <svg viewBox="0 0 100 100" width="72" height="72">
      <circle cx="50" cy="50" r="27" fill="none" stroke="white" stroke-width="7" stroke-linecap="round"/>
      <path class="slash" d="M75,25L25,75" fill="none" stroke="white" stroke-width="7" stroke-linecap="round"/>
    </svg>
  </div>
  <h1>null ide</h1>
  <p class="sub">your minimal code editor</p>
</div>
<div class="shortcuts">
  <div class="shortcut"><span class="shortcut-label">Command palette</span><span class="shortcut-key">Ctrl+Shift+P</span></div>
  <div class="shortcut"><span class="shortcut-label">Generate commit</span><span class="shortcut-key">Ctrl+Shift+Alt+G</span></div>
  <div class="shortcut"><span class="shortcut-label">Toggle terminal</span><span class="shortcut-key">Ctrl+\`</span></div>
  <div class="shortcut"><span class="shortcut-label">Quick open file</span><span class="shortcut-key">Ctrl+P</span></div>
  <div class="shortcut"><span class="shortcut-label">Close welcome</span><span class="shortcut-key">Ctrl+W</span></div>
</div>
<div class="actions">
  <button class="btn-primary" id="open-file">Open a folder</button>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('open-file').addEventListener('click', () => vscode.postMessage({ command: 'openFolder' }));
</script>
</body>
</html>`;

  panel.webview.onDidReceiveMessage(
    (msg: { command: string }) => {
      if (msg.command === 'openFolder') {
        vscode.commands.executeCommand('workbench.action.files.openFolder');
      }
    },
    undefined,
    context.subscriptions,
  );
}

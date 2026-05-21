'use strict';

const vscode = require('vscode');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const { execSync, spawn } = require('child_process');

const UPDATE_REPO = 'TorresVisual/null-ide';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const output = vscode.window.createOutputChannel('Null IDE Updates');

// ── Commit message generator ───────────────────────────────────────────────

const PROMPT =
  'Output ONLY a single git commit message for the staged diff below. ' +
  'No explanation. No preamble. No code block fences. No bullet points. No quotes. ' +
  'Use conventional commit format: type: short description ' +
  '(imperative mood, under 72 chars). ' +
  'Types: feat, fix, chore, refactor, docs, style, test. ' +
  'Your entire response must be exactly one line -- the commit message itself.\n\n' +
  'Staged diff:\n';

function getStagedDiff(cwd) {
  try {
    const staged = execSync('git diff --staged', { cwd, encoding: 'utf8', timeout: 10000 });
    if (staged.trim()) return staged;
    return execSync('git diff HEAD', { cwd, encoding: 'utf8', timeout: 10000 });
  } catch {
    return '';
  }
}

function runClaude(diff, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['--print'], { cwd, shell: true, windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.stdin.write(PROMPT + diff);
    child.stdin.end();
    const timer = setTimeout(() => { child.kill(); reject(new Error('claude timed out after 30 s')); }, 30000);
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        const msg = out.trim();
        if (msg) resolve(msg);
        else reject(new Error(`claude produced no output (stderr: ${err.trim() || 'none'})`));
      } else {
        reject(new Error(err.trim() || `claude exited with code ${code}`));
      }
    });
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getNonce() {
  let t = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) t += c[Math.floor(Math.random() * c.length)];
  return t;
}

// Load node-pty only from the extension's own node_modules (safe ABI, rebuilt via setup.ps1).
function loadNodePty(extensionPath) {
  try {
    const mod = require(path.join(extensionPath, 'node_modules', 'node-pty'));
    if (typeof mod.spawn === 'function') return mod;
  } catch (_) {}
  return null;
}

function getInstallDir(context) {
  const candidates = getInstallDirCandidates(context);
  return candidates[0] || path.dirname(process.execPath);
}

function getInstallDirCandidates(context) {
  const candidates = [path.dirname(process.execPath)];

  if (process.resourcesPath) {
    candidates.push(path.resolve(process.resourcesPath, '..'));
  }

  if (context?.extensionPath) {
    candidates.push(path.resolve(context.extensionPath, '..', '..', '..', '..'));
  }

  return [...new Set(candidates.map(candidate => path.resolve(candidate)))];
}

function getUpdaterScriptPath(context) {
  for (const installDir of getInstallDirCandidates(context)) {
    const installUpdater = path.join(installDir, 'resources', 'app', 'null-updater', 'update-null-ide.ps1');
    if (fs.existsSync(installUpdater)) return installUpdater;
  }

  const repoUpdater = path.resolve(context.extensionPath, '..', '..', 'scripts', 'update-null-ide.ps1');
  if (fs.existsSync(repoUpdater)) return repoUpdater;

  return null;
}

function getInstallMetadata(context) {
  const candidates = [];

  for (const installDir of getInstallDirCandidates(context)) {
    candidates.push(
      path.join(installDir, '.null-ide-install.json'),
      path.join(installDir, 'resources', 'app', '.null-ide-install.json')
    );
  }

  if (process.resourcesPath) {
    candidates.push(
      path.resolve(process.resourcesPath, '..', '.null-ide-install.json'),
      path.join(process.resourcesPath, 'app', '.null-ide-install.json')
    );
  }

  for (const metadataPath of [...new Set(candidates)]) {
    try {
      output.appendLine(`Reading install metadata from ${metadataPath}`);
      const raw = fs.readFileSync(metadataPath, 'utf8').replace(/^\uFEFF/, '');
      return JSON.parse(raw);
    } catch (err) {
      output.appendLine(`Could not read install metadata at ${metadataPath}: ${err.message}`);
    }
  }

  return null;
}

function getCurrentVersion(context) {
  const metadata = getInstallMetadata(context);
  if (metadata?.version) return String(metadata.version);

  return 'local';
}

function getUpdateRepo(context) {
  return getInstallMetadata(context)?.repo || UPDATE_REPO;
}

function trimVersionTag(tag) {
  return String(tag || '').replace(/^v/i, '');
}

function compareVersionTags(left, right) {
  const leftParts = trimVersionTag(left).split(/[.-]/).map(part => Number.parseInt(part, 10));
  const rightParts = trimVersionTag(right).split(/[.-]/).map(part => Number.parseInt(part, 10));

  if (leftParts.some(Number.isNaN) || rightParts.some(Number.isNaN)) {
    return String(left) === String(right) ? 0 : -1;
  }

  const count = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < count; i++) {
    const diff = (leftParts[i] || 0) - (rightParts[i] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Null-IDE',
    };

    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const req = https.get(url, {
      headers,
    }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          let detail = '';
          try {
            const parsed = JSON.parse(body);
            detail = parsed?.message ? `: ${parsed.message}` : '';
          } catch (_) {}
          reject(new Error(`GitHub returned ${res.statusCode}${detail}`));
        });
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(err); }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('GitHub request timed out'));
    });
  });
}

async function getLatestRelease(repo) {
  return requestJson(`https://api.github.com/repos/${repo}/releases/latest`);
}

function hasWindowsPackage(release) {
  return Array.isArray(release.assets) &&
    release.assets.some(asset => /^(null-ide-win32-x64.*\.zip|NullIDESetup.*\.exe)$/i.test(asset.name));
}

async function checkForUpdate(context, silent) {
  const now = Date.now();
  const lastCheck = context.globalState.get('null.lastUpdateCheck', 0);
  if (silent && now - lastCheck < UPDATE_CHECK_INTERVAL_MS) {
    output.appendLine(`Skipping startup update check; last check was ${new Date(lastCheck).toISOString()}.`);
    return null;
  }

  await context.globalState.update('null.lastUpdateCheck', now);

  const current = getCurrentVersion(context);
  const repo = getUpdateRepo(context);
  output.appendLine(`Checking for updates from ${repo}. Current version: ${current}`);
  const release = await getLatestRelease(repo);
  const latest = String(release.tag_name || '');
  const hasPackage = hasWindowsPackage(release);
  output.appendLine(`Latest release: ${latest || '(none)'}. Windows package: ${hasPackage ? 'yes' : 'no'}`);

  if (!latest || !hasPackage || compareVersionTags(latest, current) <= 0) {
    await context.globalState.update('null.availableUpdate', undefined);
    await vscode.commands.executeCommand('setContext', 'nullUpdateAvailable', false);
    if (!silent) {
      const packageNote = hasPackage ? '' : ' No Windows package was found on the latest release.';
      vscode.window.showInformationMessage(`Null IDE is up to date (${current}; latest ${latest || 'unknown'}).${packageNote}`);
    }
    return null;
  }

  const update = {
    repo,
    current,
    latest,
    url: release.html_url,
    checkedAt: new Date().toISOString(),
  };

  await context.globalState.update('null.availableUpdate', update);
  await vscode.commands.executeCommand('setContext', 'nullUpdateAvailable', true);
  output.appendLine(`Update available: ${current} -> ${latest}`);
  return update;
}

async function promptForUpdate(update) {
  const action = await vscode.window.showInformationMessage(
    `Null IDE ${update.latest} is available. You are running ${update.current}.`,
    'Update Now',
    'Release Notes',
    'Later'
  );

  if (action === 'Update Now') {
    await vscode.commands.executeCommand('null.installUpdate');
  } else if (action === 'Release Notes' && update.url) {
    await vscode.env.openExternal(vscode.Uri.parse(update.url));
  }
}

async function installUpdate(context) {
  const update = context.globalState.get('null.availableUpdate') || await checkForUpdate(context, false);
  if (!update) return;

  const updater = getUpdaterScriptPath(context);
  if (!updater) {
    vscode.window.showErrorMessage('Null IDE updater script was not found in this installation.');
    return;
  }

  const installer = path.join(path.dirname(updater), 'install-null-ide.ps1');
  if (!fs.existsSync(installer)) {
    vscode.window.showErrorMessage('Null IDE installer script was not found in this installation.');
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Install Null IDE ${update.latest}? The IDE will close, update, and reopen.`,
    { modal: true },
    'Restart and Update'
  );
  if (choice !== 'Restart and Update') return;

  const updaterDir = path.join(
    process.env.TEMP || process.env.TMP || getInstallDir(context),
    `null-ide-updater-${Date.now()}`
  );
  fs.mkdirSync(updaterDir, { recursive: true });
  const stagedUpdater = path.join(updaterDir, 'update-null-ide.ps1');
  fs.copyFileSync(updater, stagedUpdater);
  fs.copyFileSync(installer, path.join(updaterDir, 'install-null-ide.ps1'));

  const installDir = getInstallDir(context);

  // Build a tiny launcher script that uses Start-Process to create a new,
  // independent console window. This ensures the updater survives the IDE's
  // process group / job object being torn down on quit.
  const launcherPath = path.join(updaterDir, 'launcher.ps1');
  const psArgList = [
    '-NoLogo', '-ExecutionPolicy', 'Bypass',
    '-File', stagedUpdater,
    '-Repo', update.repo,
    '-InstallDir', installDir,
    '-Force',       // skip redundant version re-check; extension already verified
    '-WaitForExit',
    '-Launch',
  ].map(a => `'${a.replace(/'/g, "''")}'`).join(', ');
  fs.writeFileSync(launcherPath, `Start-Process -FilePath powershell.exe -ArgumentList @(${psArgList}) -WindowStyle Normal\n`, 'utf8');

  const child = spawn('powershell.exe', [
    '-NoLogo', '-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', launcherPath,
  ], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  setTimeout(() => vscode.commands.executeCommand('workbench.action.quit'), 500);
}

// ── AI Agents sidebar panel ────────────────────────────────────────────────

const AGENTS = {
  claude: { label: 'claude', cmd: 'claude' },
  agy:    { label: 'agy',    cmd: 'agy'    },
  codex:  { label: 'codex',  cmd: 'codex'  },
};

const MAX_SCROLLBACK_BYTES = 300 * 1024;

class AgentsViewProvider {
  constructor(extensionUri, nodePty, context) {
    this._extensionUri = extensionUri;
    this._nodePty      = nodePty;   // null if not set up yet
    this._context      = context;
    this._view         = null;
    this._pty          = null;
    this._agent        = 'claude';
    this._buffers      = { claude: '', agy: '', codex: '' };
    this._saveTimer    = null;
    this._loadBuffers();
  }

  _scrollbackDir() {
    return path.join(this._context.globalStorageUri.fsPath, 'scrollback');
  }

  _loadBuffers() {
    const dir = this._scrollbackDir();
    for (const agent of Object.keys(this._buffers)) {
      try {
        this._buffers[agent] = fs.readFileSync(path.join(dir, `${agent}.bin`), 'utf8');
      } catch {}
    }
  }

  _saveBuffers() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    const dir = this._scrollbackDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const [agent, buf] of Object.entries(this._buffers)) {
        const p = path.join(dir, `${agent}.bin`);
        if (buf) {
          fs.writeFileSync(p, buf, 'utf8');
        } else {
          try { fs.unlinkSync(p); } catch {}
        }
      }
    } catch {}
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveBuffers(), 5000);
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'lib')],
    };

    if (!this._nodePty) {
      webviewView.webview.html = this._buildSetupHtml(webviewView.webview);
      webviewView.webview.onDidReceiveMessage(msg => {
        if (msg.type === 'install') this._runSetup();
      });
      return;
    }

    webviewView.webview.html = this._buildTermHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(msg => {
      switch (msg.type) {
        case 'ready':   this._start(webviewView.webview, msg.agent || 'claude', msg.cols || 80, msg.rows || 24); break;
        case 'input':   this._pty?.write(msg.data); break;
        case 'copy':    vscode.env.clipboard.writeText(msg.text ?? ''); break;
        case 'paste':        vscode.env.clipboard.readText().then(text => { if (text) this._pty?.write(text.replace(/[\r\n]+$/, '')); }); break;
        case 'focusChange':  vscode.commands.executeCommand('setContext', 'null.agentsFocused', msg.focused); break;
        case 'resize':  this._pty?.resize(msg.cols, msg.rows); break;
        case 'launch':  this._restart(webviewView.webview, msg.agent, msg.cols || 80, msg.rows || 24, false); break;
        case 'restart': this._restart(webviewView.webview, this._agent, msg.cols || 80, msg.rows || 24, true); break;
      }
    });
    webviewView.onDidDispose(() => {
      clearTimeout(this._saveTimer);
      this._saveBuffers();
      this._kill();
      vscode.commands.executeCommand('setContext', 'null.agentsFocused', false);
    });
  }

  _runSetup() {
    const setupScript = path.join(this._extensionUri.fsPath, 'setup.ps1');
    const term = vscode.window.createTerminal({
      name: 'null-tools setup',
      cwd:  this._extensionUri.fsPath,
      shellPath: 'powershell.exe',
      shellArgs: ['-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', setupScript],
    });
    term.show();
  }

  _kill() {
    if (this._pty) { try { this._pty.kill(); } catch (_) {} this._pty = null; }
  }

  paste() {
    vscode.env.clipboard.readText().then(text => { if (text) this._pty?.write(text.replace(/[\r\n]+$/, '')); });
  }

  _restart(webview, agent, cols, rows, fresh) {
    if (fresh) this._buffers[agent] = '';
    this._kill();
    this._start(webview, agent, cols, rows);
  }

  _start(webview, agent, cols, rows) {
    this._agent = agent;
    const cfg = AGENTS[agent] ?? AGENTS.claude;
    const folders = vscode.workspace.workspaceFolders;
    const cwd = folders?.[0]?.uri?.fsPath ?? process.env.USERPROFILE ?? '.';
    const env = { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '3', COLORTERM: 'truecolor' };

    // Use cmd.exe so .cmd wrappers (npm-installed CLIs) resolve correctly.
    const shell = process.env.ComSpec || 'cmd.exe';
    let proc;
    try {
      proc = this._nodePty.spawn(shell, ['/c', cfg.cmd], { name: 'xterm-256color', cols, rows, cwd, env });
    } catch (err) {
      webview.postMessage({ type: 'error', message: err.message });
      return;
    }

    this._pty = proc;
    webview.postMessage({ type: 'started', agent, restore: this._buffers[agent] || null });

    proc.onData(data => {
      const combined = this._buffers[agent] + data;
      this._buffers[agent] = combined.length > MAX_SCROLLBACK_BYTES
        ? combined.slice(combined.length - MAX_SCROLLBACK_BYTES)
        : combined;
      this._scheduleSave();
      webview.postMessage({ type: 'data', text: data });
    });
    proc.onExit(({ exitCode }) => {
      this._pty = null;
      this._saveBuffers();
      webview.postMessage({ type: 'exit', code: exitCode });
    });
  }

  // ── HTML builders ──────────────────────────────────────────────────────

  _buildSetupHtml(webview) {
    const nonce = getNonce();
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { margin:0; padding:24px 16px; background:#181818; color:#888;
         font:12px/1.6 'Cascadia Code',Consolas,monospace; }
  .logo { display:flex; align-items:center; gap:10px; margin-bottom:20px;
          padding-bottom:16px; border-bottom:1px solid #2b2b2b; }
  .logo span { font-size:13px; color:#e0e0e0; letter-spacing:.06em; }
  h3 { color:#ccc; font-size:12px; margin:0 0 8px; font-weight:600; letter-spacing:.04em; }
  p  { margin:0 0 16px; color:#555; font-size:11px; line-height:1.7; }
  button { width:100%; padding:8px 12px; background:#0078D4; color:#fff; border:none;
           border-radius:2px; cursor:pointer; font:11px/1 inherit; letter-spacing:.04em; }
  button:hover { background:#106EBE; }
  code { background:#1e1e1e; border:1px solid #2b2b2b; border-radius:2px;
         padding:2px 5px; font-size:11px; color:#9CDCFE; }
</style></head><body>
<div class="logo">
  <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="#777" stroke-width="1.5" stroke-linecap="round">
    <circle cx="8" cy="8" r="5"/><line x1="11.5" y1="4.5" x2="4.5" y2="11.5"/>
  </svg>
  <span>ai agents</span>
</div>
<h3>setup required</h3>
<p>The embedded terminal needs <code>node-pty</code> rebuilt for this IDE's Electron version.<br>
Click below to run the setup in a terminal — takes ~30 s.</p>
<button id="btn">Install dependencies</button>
<p style="margin-top:16px">Or run manually:<br><code>cd extensions/null-tools</code><br><code>pwsh -File setup.ps1</code></p>
<p>Then reload the window (<code>Ctrl+Shift+P</code> → <em>Reload Window</em>).</p>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('btn').addEventListener('click', () => vscode.postMessage({ type: 'install' }));
</script></body></html>`;
  }

  _buildTermHtml(webview) {
    const xtermJs  = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'xterm.js'));
    const xtermCss = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'xterm.css'));
    const fitJs    = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'xterm-addon-fit.js'));
    const agentsJs = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'agents.js'));

    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; connect-src ${webview.cspSource};">
<link rel="stylesheet" href="${xtermCss}">
<style>
  html,body { margin:0; padding:0; width:100%; height:100%; background:#181818;
              overflow:hidden; display:flex; flex-direction:column; }
  #tabs { display:flex; gap:1px; background:#111; flex-shrink:0; padding:0 4px; }
  .tab {
    padding:5px 12px; background:transparent; border:none; cursor:pointer;
    font:11px/1 'Cascadia Code',Consolas,monospace; color:#666;
    border-bottom:2px solid transparent; letter-spacing:.04em;
  }
  .tab:hover { color:#aaa; }
  .tab.active { color:#e0e0e0; border-bottom-color:#0078D4; }
  #wrap { flex:1; min-height:0; position:relative; }
  #term { width:100%; height:100%; }
  .xterm { padding:4px 6px; }
  #banner {
    display:none; flex-shrink:0; background:#252526; border-top:1px solid #333;
    padding:5px 10px; align-items:center; gap:8px;
    font:11px/1 'Cascadia Code',Consolas,monospace; color:#888;
  }
  #banner-msg { flex:1; }
  #restart-btn {
    padding:3px 12px; background:#0078D4; color:#fff; border:none;
    border-radius:2px; cursor:pointer; font:11px/1 inherit; white-space:nowrap;
  }
  #restart-btn:hover { background:#106EBE; }
</style></head><body>
<div id="tabs">
  <button class="tab active" data-agent="claude">claude</button>
  <button class="tab"        data-agent="agy">agy</button>
  <button class="tab"        data-agent="codex">codex</button>
</div>
<div id="wrap"><div id="term"></div></div>
<div id="banner">
  <span id="banner-msg"></span>
  <button id="restart-btn">restart</button>
</div>
<script src="${xtermJs}"></script>
<script src="${fitJs}"></script>
<script src="${agentsJs}"></script>
</body></html>`;
  }
}

// ── Activation ─────────────────────────────────────────────────────────────

function activate(context) {
  const bar = vscode.window.createStatusBarItem('null.gen', vscode.StatusBarAlignment.Right, 0);
  bar.text = '$(sparkle)';
  bar.tooltip = 'Null: generate commit message';
  bar.command = 'null.generateCommitMessage';
  bar.show();
  context.subscriptions.push(bar);

  const updateBar = vscode.window.createStatusBarItem('null.update', vscode.StatusBarAlignment.Right, 1);
  updateBar.text = '$(cloud-download) Update';
  updateBar.tooltip = 'Null IDE update available';
  updateBar.command = 'null.installUpdate';
  context.subscriptions.push(updateBar);

  function refreshUpdateButton() {
    const update = context.globalState.get('null.availableUpdate');
    if (update?.latest) {
      updateBar.text = `$(cloud-download) ${update.latest}`;
      updateBar.tooltip = `Install Null IDE ${update.latest}`;
      updateBar.show();
    } else {
      updateBar.hide();
    }
  }

  const cmd = vscode.commands.registerCommand('null.generateCommitMessage', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) { vscode.window.showErrorMessage('Open a folder first.'); return; }
    const cwd = folders[0].uri.fsPath;
    const diff = getStagedDiff(cwd);
    if (!diff.trim()) { vscode.window.showWarningMessage('No changes found (nothing staged or committed).'); return; }
    let message;
    try {
      await vscode.window.withProgress(
        { location: { viewId: 'workbench.scm' }, title: 'Generating commit message...' },
        async () => { message = await runClaude(diff, cwd); }
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Null: commit message generation failed — ${err.message}`);
      return;
    }
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt) { vscode.window.showErrorMessage('Built-in git extension not found.'); return; }
    const git  = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate()).getAPI(1);
    const repo = git.repositories.find(r => r.rootUri.fsPath === cwd) ?? git.repositories[0];
    if (repo) { repo.inputBox.value = message; vscode.commands.executeCommand('workbench.view.scm'); }
  });
  context.subscriptions.push(cmd);

  const checkUpdatesCmd = vscode.commands.registerCommand('null.checkForUpdates', async () => {
    try {
      const update = await checkForUpdate(context, false);
      refreshUpdateButton();
      if (update) await promptForUpdate(update);
    } catch (err) {
      vscode.window.showErrorMessage(`Null: update check failed - ${err.message}`);
    }
  });
  context.subscriptions.push(checkUpdatesCmd);

  const installUpdateCmd = vscode.commands.registerCommand('null.installUpdate', async () => {
    try {
      await installUpdate(context);
    } catch (err) {
      vscode.window.showErrorMessage(`Null: update failed - ${err.message}`);
    }
  });
  context.subscriptions.push(installUpdateCmd);

  refreshUpdateButton();
  checkForUpdate(context, true)
    .then(update => {
      refreshUpdateButton();
      if (update) return promptForUpdate(update);
    })
    .catch(() => {
      // Startup update checks should never make the IDE noisy when offline.
    });

  const nodePty      = loadNodePty(context.extensionUri.fsPath);
  const agentsProvider = new AgentsViewProvider(context.extensionUri, nodePty, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('null.agentsView', agentsProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );
  context.subscriptions.push({ dispose: () => agentsProvider._saveBuffers() });

  context.subscriptions.push(
    vscode.commands.registerCommand('null.agentsPaste', () => agentsProvider.paste())
  );
}

function deactivate() {}

module.exports = { activate, deactivate };

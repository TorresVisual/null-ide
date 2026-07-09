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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const https = __importStar(require("https"));
const child_process_1 = require("child_process");
const ollama = __importStar(require("./ollama"));
const claudeHistory_1 = require("./claudeHistory");
const recentProjectsIntegration_1 = require("./recentProjectsIntegration");
const UPDATE_REPO = 'TorresVisual/null-ide';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const output = vscode.window.createOutputChannel('Null IDE Updates');
// ── Commit message generator ───────────────────────────────────────────────
const PROMPT = 'Output ONLY a single git commit message for the staged diff below. ' +
    'No explanation. No preamble. No code block fences. No bullet points. No quotes. ' +
    'Use conventional commit format: type: short description ' +
    '(imperative mood, under 72 chars). ' +
    'Types: feat, fix, chore, refactor, docs, style, test. ' +
    'Your entire response must be exactly one line -- the commit message itself.\n\n' +
    'Staged diff:\n';
function getStagedDiff(cwd) {
    try {
        const staged = (0, child_process_1.execSync)('git diff --staged', { cwd, encoding: 'utf8', timeout: 10000 });
        if (staged.trim())
            return staged;
        return (0, child_process_1.execSync)('git diff HEAD', { cwd, encoding: 'utf8', timeout: 10000 });
    }
    catch {
        return '';
    }
}
function runClaude(diff, cwd) {
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)('claude', ['--print'], { cwd, shell: true, windowsHide: true });
        let out = '', err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.stdin.write(PROMPT + diff);
        child.stdin.end();
        const timer = setTimeout(() => { child.kill(); reject(new Error('claude timed out after 30 s')); }, 30000);
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
                const msg = out.trim();
                if (msg)
                    resolve(msg);
                else
                    reject(new Error(`claude produced no output (stderr: ${err.trim() || 'none'})`));
            }
            else {
                reject(new Error(err.trim() || `claude exited with code ${code}`));
            }
        });
    });
}
// ── Helpers ────────────────────────────────────────────────────────────────
function getNonce() {
    let t = '';
    const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++)
        t += c[Math.floor(Math.random() * c.length)];
    return t;
}
// Load node-pty only from the extension's own node_modules (safe ABI, rebuilt via setup.ps1).
function loadNodePty(extensionPath) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(path.join(extensionPath, 'node_modules', 'node-pty'));
        if (typeof mod.spawn === 'function')
            return mod;
    }
    catch (_) { }
    return null;
}
function getInstallDirCandidates(context) {
    const candidates = [path.dirname(process.execPath)];
    if (process.resourcesPath) {
        candidates.push(path.resolve(process.resourcesPath, '..'));
    }
    if (context?.extensionPath) {
        candidates.push(path.resolve(context.extensionPath, '..', '..', '..', '..'));
    }
    return [...new Set(candidates.map(c => path.resolve(c)))];
}
function getInstallDir(context) {
    const candidates = getInstallDirCandidates(context);
    return candidates[0] || path.dirname(process.execPath);
}
function getUpdaterScriptPath(context) {
    for (const installDir of getInstallDirCandidates(context)) {
        const p = path.join(installDir, 'resources', 'app', 'null-updater', 'update-null-ide.ps1');
        if (fs.existsSync(p))
            return p;
    }
    const repoUpdater = path.resolve(context.extensionPath, '..', '..', 'scripts', 'update-null-ide.ps1');
    if (fs.existsSync(repoUpdater))
        return repoUpdater;
    return null;
}
function getInstallMetadata(context) {
    const candidates = [];
    for (const installDir of getInstallDirCandidates(context)) {
        candidates.push(path.join(installDir, '.null-ide-install.json'), path.join(installDir, 'resources', 'app', '.null-ide-install.json'));
    }
    if (process.resourcesPath) {
        candidates.push(path.resolve(process.resourcesPath, '..', '.null-ide-install.json'), path.join(process.resourcesPath, 'app', '.null-ide-install.json'));
    }
    for (const metadataPath of [...new Set(candidates)]) {
        try {
            output.appendLine(`Reading install metadata from ${metadataPath}`);
            const raw = fs.readFileSync(metadataPath, 'utf8').replace(/^﻿/, '');
            return JSON.parse(raw);
        }
        catch (err) {
            output.appendLine(`Could not read install metadata at ${metadataPath}: ${err.message}`);
        }
    }
    return null;
}
function getCurrentVersion(context) {
    const metadata = getInstallMetadata(context);
    if (metadata?.version)
        return String(metadata.version);
    return 'local';
}
function getUpdateRepo(context) {
    return getInstallMetadata(context)?.repo || UPDATE_REPO;
}
function trimVersionTag(tag) {
    return String(tag || '').replace(/^v/i, '');
}
function compareVersionTags(left, right) {
    const leftParts = trimVersionTag(left).split(/[.-]/).map(p => Number.parseInt(p, 10));
    const rightParts = trimVersionTag(right).split(/[.-]/).map(p => Number.parseInt(p, 10));
    if (leftParts.some(Number.isNaN) || rightParts.some(Number.isNaN)) {
        return String(left) === String(right) ? 0 : -1;
    }
    const count = Math.max(leftParts.length, rightParts.length);
    for (let i = 0; i < count; i++) {
        const diff = (leftParts[i] || 0) - (rightParts[i] || 0);
        if (diff !== 0)
            return diff;
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
        const req = https.get(url, { headers }, res => {
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    let detail = '';
                    try {
                        const parsed = JSON.parse(body);
                        detail = parsed?.message ? `: ${parsed.message}` : '';
                    }
                    catch (_) { }
                    reject(new Error(`GitHub returned ${res.statusCode}${detail}`));
                });
                return;
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                }
                catch (err) {
                    reject(err);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(new Error('GitHub request timed out')); });
    });
}
async function getLatestRelease(repo) {
    return requestJson(`https://api.github.com/repos/${repo}/releases/latest`);
}
function hasWindowsPackage(release) {
    return Array.isArray(release.assets) &&
        release.assets.some(a => /^(null-ide-win32-x64.*\.zip|NullIDESetup.*\.exe)$/i.test(a.name));
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
        repo, current, latest,
        url: release.html_url,
        checkedAt: new Date().toISOString(),
    };
    await context.globalState.update('null.availableUpdate', update);
    await vscode.commands.executeCommand('setContext', 'nullUpdateAvailable', true);
    output.appendLine(`Update available: ${current} -> ${latest}`);
    return update;
}
async function promptForUpdate(update) {
    const action = await vscode.window.showInformationMessage(`Null IDE ${update.latest} is available. You are running ${update.current}.`, 'Update Now', 'Release Notes', 'Later');
    if (action === 'Update Now') {
        await vscode.commands.executeCommand('null.installUpdate');
    }
    else if (action === 'Release Notes' && update.url) {
        await vscode.env.openExternal(vscode.Uri.parse(update.url));
    }
}
async function installUpdate(context) {
    const update = context.globalState.get('null.availableUpdate')
        || await checkForUpdate(context, false);
    if (!update)
        return;
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
    const choice = await vscode.window.showWarningMessage(`Install Null IDE ${update.latest}? The IDE will close, update, and reopen.`, { modal: true }, 'Restart and Update');
    if (choice !== 'Restart and Update')
        return;
    const updaterDir = path.join(process.env.TEMP || process.env.TMP || getInstallDir(context), `null-ide-updater-${Date.now()}`);
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
        '-Force', '-WaitForExit', '-Launch',
    ].map(a => `'${a.replace(/'/g, "''")}'`).join(', ');
    fs.writeFileSync(launcherPath, `Start-Process -FilePath powershell.exe -ArgumentList @(${psArgList}) -WindowStyle Normal\n`, 'utf8');
    const child = (0, child_process_1.spawn)('powershell.exe', [
        '-NoLogo', '-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', launcherPath,
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => vscode.commands.executeCommand('workbench.action.quit'), 500);
}
// ── Agent file watcher ────────────────────────────────────────────────────
const WATCH_IGNORE = /[/\\](\.git|node_modules|out|dist|\.vscodium)[/\\]|\.(?:map|log|bin)$/;
// Serves "before" content for vscode.diff — snapshots open docs at PTY start.
class AgentBeforeProvider {
    scheme = 'null-agent-before';
    _byPath = new Map();
    _idToPath = new Map();
    _counter = 0;
    _wsRoot = '';
    setWsRoot(p) { this._wsRoot = p; }
    snapshot() {
        for (const doc of vscode.workspace.textDocuments) {
            if (!doc.isUntitled)
                this._byPath.set(doc.uri.fsPath, doc.getText());
        }
    }
    snapshotFromGit(fsPath) {
        if (this._byPath.has(fsPath))
            return;
        let content = '';
        if (this._wsRoot) {
            try {
                const rel = path.relative(this._wsRoot, fsPath).replace(/\\/g, '/');
                content = (0, child_process_1.execSync)(`git show HEAD:"${rel}"`, { cwd: this._wsRoot, encoding: 'utf8', timeout: 5000 });
            }
            catch { }
        }
        this._byPath.set(fsPath, content);
    }
    has(fsPath) { return this._byPath.has(fsPath); }
    makeUri(diskUri) {
        const id = this._counter++;
        this._idToPath.set(id, diskUri.fsPath);
        return vscode.Uri.from({ scheme: this.scheme, path: `/${id}/${path.basename(diskUri.fsPath)}` });
    }
    provideTextDocumentContent(uri) {
        const id = parseInt(uri.path.split('/')[1], 10);
        const fsPath = this._idToPath.get(id);
        return fsPath ? (this._byPath.get(fsPath) ?? '') : '';
    }
    clear() {
        this._byPath.clear();
        this._idToPath.clear();
        this._counter = 0;
    }
}
class AgentFileWatcher {
    _watcher;
    _running = false;
    _pending = new Set();
    _debounce = null;
    _userSaving = new Set();
    _termApproved = new Map();
    _before;
    constructor(wsRoot, before) {
        this._before = before;
        this._watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(wsRoot, '**/*'), false, false, true);
        this._watcher.onDidCreate(uri => this._onChange(uri));
        this._watcher.onDidChange(uri => this._onChange(uri));
    }
    setRunning(on) {
        this._running = on;
        if (on) {
            this._before.clear();
            this._before.snapshot();
        }
        else {
            clearTimeout(this._debounce);
            this._debounce = null;
            this._pending.clear();
        }
    }
    markUserSave(fsPath) {
        this._userSaving.add(fsPath);
        setTimeout(() => this._userSaving.delete(fsPath), 1000);
    }
    markTerminalApproval(fsPath) {
        this._termApproved.set(fsPath, Date.now());
        setTimeout(() => this._termApproved.delete(fsPath), 15_000);
    }
    _onChange(uri) {
        if (!this._running)
            return;
        if (!vscode.workspace.getConfiguration('null.agentFileWatch').get('enabled', true))
            return;
        if (WATCH_IGNORE.test(uri.fsPath))
            return;
        if (this._userSaving.has(uri.fsPath))
            return;
        const approvedAt = this._termApproved.get(uri.fsPath);
        if (approvedAt && Date.now() - approvedAt < 15_000) {
            this._termApproved.delete(uri.fsPath);
            return;
        }
        this._pending.add(uri.fsPath);
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this._flush(), 500);
    }
    _flush() {
        this._debounce = null;
        if (this._pending.size === 0)
            return;
        const allUris = [...this._pending].map(p => vscode.Uri.file(p));
        this._pending.clear();
        for (const diskUri of allUris) {
            // Ensure a before-snapshot exists: open-doc snapshot first, git HEAD as fallback.
            this._before.snapshotFromGit(diskUri.fsPath);
            const baseName = path.basename(diskUri.fsPath);
            const beforeUri = this._before.makeUri(diskUri);
            vscode.commands.executeCommand('vscode.diff', beforeUri, diskUri, `✻ Agent · ${baseName}`);
        }
    }
    dispose() {
        clearTimeout(this._debounce);
        this._watcher.dispose();
    }
}
// ── AI Agents sidebar panel ────────────────────────────────────────────────
const AGENTS = {
    claude: { label: 'claude', cmd: 'claude' },
    agy: { label: 'agy', cmd: 'agy' },
    codex: { label: 'codex', cmd: 'codex' },
    ollama: { label: 'ollama', cmd: null },
};
const MAX_SCROLLBACK_BYTES = 300 * 1024;
const MAX_SCROLLBACK_LINES = 2000;
class AgentsViewProvider {
    _extensionUri;
    _nodePty;
    _context;
    _view = null;
    _ptys = {};
    _buffers = {};
    _saveTimer = null;
    _currentSessionId = {};
    _firstInput = {};
    _sessionSaveIntervals = {};
    _tabs = [];
    _activeTabId = null;
    _claudeHistory = null;
    _fileWatcher = null;
    setFileWatcher(w) { this._fileWatcher = w; }
    constructor(extensionUri, nodePty, context) {
        this._extensionUri = extensionUri;
        this._nodePty = nodePty;
        this._context = context;
        // Restore tab list from previous session, or default to a single claude tab.
        const saved = context.globalState.get('null.agentTabs');
        if (saved && Array.isArray(saved.tabs) && saved.tabs.length > 0) {
            this._tabs = saved.tabs;
            this._activeTabId = saved.activeId || saved.tabs[0].id;
        }
        else {
            this._tabs = [{ id: 'claude-1', type: 'claude', label: 'claude' }];
            this._activeTabId = 'claude-1';
        }
        this._loadBuffers();
    }
    _newTab(type) {
        // Find the lowest number not already in use so closed tabs free up their number.
        const used = new Set(this._tabs
            .filter(t => t.type === type)
            .map(t => { const m = t.id.match(/^[a-z]+-(\d+)$/); return m ? +m[1] : 0; }));
        let n = 1;
        while (used.has(n))
            n++;
        const label = n === 1 ? type : `${type} ${n}`;
        return { id: `${type}-${n}`, type, label };
    }
    _saveTabs() {
        this._context.globalState.update('null.agentTabs', {
            tabs: this._tabs, activeId: this._activeTabId,
        });
    }
    _scrollbackDir() {
        return path.join(this._context.globalStorageUri.fsPath, 'scrollback');
    }
    _loadBuffers() {
        const dir = this._scrollbackDir();
        for (const tab of this._tabs) {
            try {
                this._buffers[tab.id] = fs.readFileSync(path.join(dir, `${tab.id}.bin`), 'utf8');
            }
            catch { }
        }
    }
    _saveBuffers() {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
        const dir = this._scrollbackDir();
        try {
            fs.mkdirSync(dir, { recursive: true });
            for (const [termId, buf] of Object.entries(this._buffers)) {
                const p = path.join(dir, `${termId}.bin`);
                if (buf) {
                    fs.writeFileSync(p, buf, 'utf8');
                }
                else {
                    try {
                        fs.unlinkSync(p);
                    }
                    catch { }
                }
            }
        }
        catch { }
    }
    _scheduleSave() {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._saveBuffers(), 5000);
    }
    _historyDir(agentType) {
        return path.join(this._scrollbackDir(), agentType);
    }
    _getHistory(agentType) {
        try {
            return JSON.parse(fs.readFileSync(path.join(this._historyDir(agentType), 'index.json'), 'utf8'));
        }
        catch {
            return [];
        }
    }
    static _getPreview(buf) {
        const clean = buf
            .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
            .replace(/\x1b[PX^_][^\x1b]*(?:\x07|\x1b\\)/g, '')
            .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, '')
            .replace(/\x1b[\x20-\x7e]/g, '')
            .replace(/\x1b/g, '')
            .replace(/[\x80-\x9f]/g, '')
            .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, '')
            .replace(/\r/g, '')
            .trim();
        const lines = clean.split('\n').filter(l => {
            const t = l.trim();
            return t.length > 2 && !/^[>$#%❯→]\s/.test(t) && !/^[─━═\-=_]{3,}/.test(t) && /[a-zA-Z0-9]/.test(t);
        });
        return lines.slice(-8).join('\n').slice(0, 280);
    }
    _saveSession(webview, termId, clearBuffer) {
        const buf = this._buffers[termId];
        if (!buf)
            return;
        const id = this._currentSessionId[termId];
        if (!id)
            return;
        const tab = this._tabs.find(t => t.id === termId);
        const agentType = tab?.type || 'claude';
        const dir = this._historyDir(agentType);
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `${id}.bin`), buf, 'utf8');
            const index = this._getHistory(agentType);
            const now = new Date().toISOString();
            const rawFirst = (this._firstInput[termId] || '').trim();
            const first = rawFirst.replace(/[\x00-\x1f\x7f]/g, '').trim();
            const d = new Date();
            const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
            const name = first.length >= 3 ? first.slice(0, 60)
                : `${agentType} · ${mon} ${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            const preview = AgentsViewProvider._getPreview(buf);
            const existing = index.findIndex(s => s.id === id);
            if (existing >= 0) {
                index[existing] = { id, savedAt: now, name, preview, running: !clearBuffer };
            }
            else {
                index.push({ id, savedAt: now, name, preview, running: !clearBuffer });
                while (index.length > 50) {
                    const removed = index.shift();
                    try {
                        fs.unlinkSync(path.join(dir, `${removed.id}.bin`));
                    }
                    catch { }
                }
            }
            fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index), 'utf8');
            if (clearBuffer) {
                this._buffers[termId] = '';
                delete this._currentSessionId[termId];
                this._saveBuffers();
            }
            webview?.postMessage({ type: 'sessionSaved', agentType, sessions: index });
        }
        catch { }
    }
    _captureFirstInput(termId, data) {
        if (this._firstInput[termId + '_done'])
            return;
        let acc = this._firstInput[termId] || '';
        for (let i = 0; i < data.length; i++) {
            const ch = data[i];
            if (ch === '\r' || ch === '\n') {
                this._firstInput[termId] = acc.trim();
                this._firstInput[termId + '_done'] = true;
                return;
            }
            if (ch === '\x7f' || ch === '\x08') {
                acc = acc.slice(0, -1);
            }
            else if (ch === '\x1b') {
                i += data[i + 1] === '[' ? (i += 2, data.slice(i).search(/[a-zA-Z~]/) + 1) : 1;
            }
            else if (ch >= ' ') {
                acc += ch;
            }
        }
        this._firstInput[termId] = acc;
    }
    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'lib')],
        };
        if (!this._nodePty) {
            webviewView.webview.html = this._buildSetupHtml(webviewView.webview);
            webviewView.webview.onDidReceiveMessage((msg) => {
                if (msg.type === 'install')
                    this._runSetup();
            });
            return;
        }
        webviewView.webview.html = this._buildTermHtml(webviewView.webview);
        const webview = webviewView.webview;
        // Initialise Claude Code session history index for the current workspace.
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (wsRoot) {
            this._claudeHistory = new claudeHistory_1.ClaudeHistoryIndex(wsRoot);
            this._claudeHistory.build().then((sessions) => {
                webview.postMessage({ type: 'claudeHistory', sessions });
            });
            this._claudeHistory.watch((sessions) => {
                webview.postMessage({ type: 'claudeHistory', sessions });
            });
        }
        webviewView.webview.onDidReceiveMessage((msg) => {
            switch (msg.type) {
                case 'ready': {
                    const types = [...new Set(this._tabs.map(t => t.type))];
                    const sessionsByType = {};
                    types.forEach(type => { sessionsByType[type] = this._getHistory(type); });
                    const runningTabs = Object.keys(this._ptys).filter(k => !!this._ptys[k]);
                    const sessionNames = {};
                    for (const [termId, sessionId] of Object.entries(this._currentSessionId)) {
                        const tab = this._tabs.find(t => t.id === termId);
                        const entry = tab ? (sessionsByType[tab.type] || []).find(s => s.id === sessionId) : undefined;
                        if (entry?.name) {
                            sessionNames[termId] = entry.name;
                        }
                    }
                    webview.postMessage({ type: 'initTabs', tabs: this._tabs, activeId: this._activeTabId, sessionsByType, runningTabs, sessionNames });
                    break;
                }
                case 'launch':
                    this._activeTabId = msg.termId;
                    this._start(webview, msg.termId, msg.agentType, msg.cols || 80, msg.rows || 24);
                    break;
                case 'spawn': {
                    const tab = this._newTab(msg.agentType);
                    this._tabs.push(tab);
                    this._saveTabs();
                    webview.postMessage({ type: 'tabCreated', id: tab.id, agentType: tab.type, label: tab.label });
                    break;
                }
                case 'close': {
                    const termId = msg.termId;
                    this._killTerm(termId);
                    this._buffers[termId] = '';
                    this._saveBuffers();
                    delete this._buffers[termId];
                    this._tabs = this._tabs.filter(t => t.id !== termId);
                    if (this._activeTabId === termId)
                        this._activeTabId = this._tabs[0]?.id ?? null;
                    this._saveTabs();
                    break;
                }
                case 'input':
                    this._ptys[msg.termId]?.write(msg.data);
                    this._captureFirstInput(msg.termId, msg.data);
                    break;
                case 'loadSession': {
                    const loadTab = this._tabs.find(t => t.id === msg.termId);
                    const loadType = msg.agentType || loadTab?.type || 'claude';
                    let content = null;
                    try {
                        content = fs.readFileSync(path.join(this._historyDir(loadType), `${msg.sessionId}.bin`), 'utf8');
                    }
                    catch { }
                    webview.postMessage({ type: 'sessionContent', termId: msg.termId, content });
                    break;
                }
                case 'copy':
                    vscode.env.clipboard.writeText(msg.text ?? '');
                    break;
                case 'paste':
                    vscode.env.clipboard.readText().then(text => {
                        if (text)
                            this._ptys[msg.termId]?.write(text.replace(/[\r\n]+$/, ''));
                    });
                    break;
                case 'resize':
                    this._ptys[msg.termId]?.resize(msg.cols, msg.rows);
                    break;
                case 'restart':
                    this._restart(webview, msg.termId, msg.agentType, msg.cols || 80, msg.rows || 24);
                    break;
                case 'resumeClaudeSession': {
                    const tab = this._newTab('claude');
                    this._tabs.push(tab);
                    this._saveTabs();
                    webview.postMessage({ type: 'tabCreated', id: tab.id, agentType: 'claude', label: 'claude' });
                    this._start(webview, tab.id, 'claude', msg.cols, msg.rows, msg.sessionId);
                    break;
                }
            }
        });
        webviewView.onDidChangeVisibility(() => {
            if (!webviewView.visible)
                this._saveBuffers();
        });
        webviewView.onDidDispose(() => {
            clearTimeout(this._saveTimer);
            this._saveBuffers();
            this._kill();
            this._claudeHistory?.dispose();
        });
    }
    _runSetup() {
        const setupScript = path.join(this._extensionUri.fsPath, 'setup.ps1');
        const term = vscode.window.createTerminal({
            name: 'null-tools setup',
            cwd: this._extensionUri.fsPath,
            shellPath: 'powershell.exe',
            shellArgs: ['-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', setupScript],
        });
        term.show();
    }
    _killTerm(termId) {
        clearTimeout(this._sessionSaveIntervals[termId]);
        delete this._sessionSaveIntervals[termId];
        if (this._ptys[termId]) {
            this._saveBuffers();
            try {
                this._ptys[termId].kill();
            }
            catch (_) { }
            this._ptys[termId] = null;
            if (!Object.values(this._ptys).some(p => p !== null))
                this._fileWatcher?.setRunning(false);
        }
    }
    _kill() {
        for (const termId of Object.keys(this._ptys))
            this._killTerm(termId);
    }
    paste() {
        if (!this._activeTabId)
            return;
        vscode.env.clipboard.readText().then(text => {
            if (text)
                this._ptys[this._activeTabId]?.write(text.replace(/[\r\n]+$/, ''));
        });
    }
    writeToActive(text) {
        if (!this._activeTabId || !this._ptys[this._activeTabId])
            return false;
        this._ptys[this._activeTabId].write(text);
        return true;
    }
    writeToTerm(termId, text) {
        if (!this._ptys[termId])
            return false;
        this._ptys[termId].write(text);
        return true;
    }
    activeTabType() {
        return this._tabs.find(t => t.id === this._activeTabId)?.type ?? null;
    }
    getOrCreateOllamaTab() {
        const existing = this._tabs.find(t => t.type === 'ollama');
        if (existing)
            return existing.id;
        const tab = this._newTab('ollama');
        this._tabs.push(tab);
        this._saveTabs();
        this._view?.webview.postMessage({ type: 'tabCreated', id: tab.id, agentType: tab.type, label: tab.label });
        return tab.id;
    }
    _restart(webview, termId, agentType, cols, rows) {
        this._buffers[termId] = '';
        delete this._currentSessionId[termId];
        delete this._firstInput[termId];
        delete this._firstInput[termId + '_done'];
        clearTimeout(this._sessionSaveIntervals[termId]);
        delete this._sessionSaveIntervals[termId];
        this._killTerm(termId);
        this._start(webview, termId, agentType, cols, rows);
    }
    _start(webview, termId, agentType, cols, rows, resumeId) {
        if (this._ptys[termId]) {
            webview.postMessage({ type: 'resumed', termId });
            return;
        }
        this._currentSessionId[termId] = String(Date.now());
        delete this._firstInput[termId];
        delete this._firstInput[termId + '_done'];
        const cfg = AGENTS[agentType] ?? AGENTS['claude'];
        const spawnCmd = agentType === 'ollama'
            ? `ollama run ${vscode.workspace.getConfiguration('null.ollama').get('model', 'llama3.2')}`
            : resumeId
                ? `${cfg.cmd} --resume ${resumeId}`
                : cfg.cmd;
        const folders = vscode.workspace.workspaceFolders;
        const cwd = folders?.[0]?.uri?.fsPath ?? process.env.USERPROFILE ?? '.';
        const env = { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '3', COLORTERM: 'truecolor' };
        // Use cmd.exe so .cmd wrappers (npm-installed CLIs) resolve correctly.
        const shell = process.env.ComSpec || 'cmd.exe';
        let proc;
        try {
            proc = this._nodePty.spawn(shell, ['/c', spawnCmd], { name: 'xterm-256color', cols, rows, cwd, env });
        }
        catch (err) {
            webview.postMessage({ type: 'error', termId, message: err.message });
            return;
        }
        this._ptys[termId] = proc;
        this._fileWatcher?.setRunning(true);
        webview.postMessage({ type: 'started', termId, restore: this._buffers[termId] || null, sessions: this._getHistory(agentType) });
        proc.onData(data => {
            const combined = (this._buffers[termId] || '') + data;
            if (combined.length > MAX_SCROLLBACK_BYTES) {
                const lines = combined.split('\n');
                const kept = lines.slice(Math.max(0, lines.length - MAX_SCROLLBACK_LINES)).join('\n');
                this._buffers[termId] = kept.length > MAX_SCROLLBACK_BYTES
                    ? kept.slice(kept.length - MAX_SCROLLBACK_BYTES) : kept;
            }
            else {
                this._buffers[termId] = combined;
            }
            this._scheduleSave();
            webview.postMessage({ type: 'data', termId, text: data });
            // Detect files Claude Code is about to edit via terminal approval so the
            // watcher can suppress the redundant diff that would otherwise open.
            if (this._fileWatcher && cwd) {
                const stripped = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
                const pat = /(?:Edit|Create|Write|Update)[ \t]+([^ \t\r\n"']+)/g;
                let m;
                while ((m = pat.exec(stripped)) !== null) {
                    const rel = m[1].trim();
                    if (!rel.includes('..') && rel.length > 0) {
                        this._fileWatcher.markTerminalApproval(path.join(cwd, rel));
                    }
                }
            }
        });
        proc.onExit(({ exitCode }) => {
            this._ptys[termId] = null;
            if (!Object.values(this._ptys).some(p => p !== null))
                this._fileWatcher?.setRunning(false);
            webview.postMessage({ type: 'exit', termId, code: exitCode });
        });
    }
    // ── HTML builders ──────────────────────────────────────────────────────
    _buildSetupHtml(_webview) {
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
        const xtermJs = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'xterm.js'));
        const xtermCss = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'xterm.css'));
        const fitJs = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'xterm-addon-fit.js'));
        const agentsJs = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'agents.js'));
        const soundsJs = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'null-sounds.js'));
        return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; connect-src ${webview.cspSource};">
<link rel="stylesheet" href="${xtermCss}">
<style>
  html,body { margin:0; padding:0; width:100%; height:100%; background:#181818;
              overflow:hidden; display:flex; flex-direction:column; }
  /* Row 1: agent type selector */
  #type-bar { display:flex; align-items:stretch; background:#0d0d0d; flex-shrink:0;
    border-bottom:1px solid #1a1a1a; }
  .type-btn { padding:7px 14px; background:transparent; border:none; cursor:pointer;
    font:11px/1 'Cascadia Code',Consolas,monospace; color:#444; flex-shrink:0;
    border-bottom:2px solid transparent; letter-spacing:.04em; }
  .type-btn:hover { color:#999; }
  .type-btn.active { color:#e0e0e0; border-bottom-color:#4EC9B0; }
  /* Row 2: session tab bar */
  #session-bar { display:flex; align-items:stretch; background:#111; flex-shrink:0; }
  #tab-list { display:flex; align-items:stretch; overflow-x:auto; scrollbar-width:none; flex:1; min-width:0; }
  #tab-list::-webkit-scrollbar { display:none; }
  .tab { display:flex; align-items:center; gap:5px; padding:5px 10px 5px 12px;
    background:transparent; border:none; cursor:pointer;
    font:11px/1 'Cascadia Code',Consolas,monospace; color:#666;
    border-bottom:2px solid transparent; letter-spacing:.04em; flex-shrink:0; white-space:nowrap; }
  .tab:hover { color:#aaa; }
  .tab.active { color:#e0e0e0; border-bottom-color:#0078D4; }
  .tab-close { font-size:12px; line-height:1; color:#555; opacity:0; border-radius:2px; padding:1px 2px; }
  .tab:hover .tab-close, .tab.active .tab-close { opacity:1; }
  .tab-close:hover { color:#e05555; background:#2a2a2a; }
  #history-btn { padding:5px 10px; background:transparent; border:none; cursor:pointer;
    font:13px/1 'Cascadia Code',Consolas,monospace; color:#555; flex-shrink:0; }
  #history-btn:hover { color:#aaa; }
  #history-btn.active { color:#4EC9B0; }
  #add-btn { padding:5px 10px; background:transparent; border:none; cursor:pointer;
    font:11px/1 'Cascadia Code',Consolas,monospace; color:#555; flex-shrink:0; }
  #add-btn:hover { color:#aaa; }
  /* Row 3: title bar */
  #title-bar { padding:3px 10px; background:#0f0f0f; border-bottom:1px solid #1a1a1a;
    flex-shrink:0; display:flex; align-items:center; min-height:20px; }
  #sess-title { font:10px/1 'Cascadia Code',Consolas,monospace; color:#555;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  /* Row 4: content area */
  #content { display:flex; flex-direction:column; flex:1; min-height:0; }
  /* history view */
  #history-view { display:none; flex-direction:column; flex:1; min-height:0; overflow:hidden; }
  #history-header { padding:8px 10px 6px; flex-shrink:0; }
  #sessions-list { flex:1; overflow-y:auto; }
  .sess-item { padding:10px 12px; border-bottom:1px solid #1e1e1e; cursor:pointer; }
  .sess-item:hover { background:#1e1e1e; }
  .sess-running-item { border-left:2px solid #4EC9B0; }
  .sess-row1 { display:flex; justify-content:space-between; align-items:baseline; }
  .sess-name { font:11px/1.5 'Cascadia Code',Consolas,monospace; color:#ccc;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }
  .sess-dot { display:inline-block; width:6px; height:6px; border-radius:50%;
    background:#4EC9B0; margin-right:5px; vertical-align:middle; }
  .sess-time { font:10px/1 'Cascadia Code',Consolas,monospace; color:#666;
    flex-shrink:0; margin-left:8px; }
  .sess-preview { font:10px/1.5 'Cascadia Code',Consolas,monospace; color:#555;
    white-space:pre-wrap; word-break:break-all; overflow:hidden; max-height:2.5em;
    margin-top:2px; }
  .sess-meta { font:9px/1.6 'Cascadia Code',Consolas,monospace; color:#4a4a4a;
    margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sess-branch { color:#3a7a6a; }
  #sessions-empty { padding:24px 12px; color:#3a3a3a; text-align:center;
    font:11px/1.8 'Cascadia Code',Consolas,monospace; }
  .cc-section-header { padding:10px 12px 4px; font:9px/1 'Cascadia Code',Consolas,monospace;
    color:#555; letter-spacing:.08em; text-transform:uppercase; flex-shrink:0;
    border-top:1px solid #1e1e1e; }
  .cc-section-header:first-child { border-top:none; }
  .date-group-header { padding:5px 12px 2px; font:9px/1 'Cascadia Code',Consolas,monospace;
    color:#3a3a3a; letter-spacing:.05em; }
  #sess-search { width:100%; box-sizing:border-box; padding:5px 8px;
    background:#111; border:1px solid #2b2b2b; border-radius:2px; color:#ccc;
    font:11px/1 'Cascadia Code',Consolas,monospace; outline:none; }
  #sess-search:focus { border-color:#0078D4; }
  #sess-search::placeholder { color:#3a3a3a; }
  /* terminal area */
  #wrap { flex:1; min-height:0; }
  .term-pane { display:none; width:100%; height:100%; }
  .term-pane.active { display:block; }
  .xterm { padding:4px 6px; }
  #banner { display:none; flex-shrink:0; background:#1e1e1e; border-top:1px solid #2b2b2b;
    padding:5px 10px; align-items:center; gap:8px;
    font:11px/1 'Cascadia Code',Consolas,monospace; }
  #banner-msg { color:#555; flex:1; }
  #new-session-btn { padding:2px 10px; background:#0078D4; color:#fff; border:none;
    border-radius:2px; cursor:pointer; font:11px/1 inherit; white-space:nowrap; }
  #new-session-btn:hover { background:#106EBE; }
</style></head><body>
<div id="type-bar">
  <button class="type-btn active" data-type="claude">claude</button>
  <button class="type-btn" data-type="agy">agy</button>
  <button class="type-btn" data-type="codex">codex</button>
  <button class="type-btn" data-type="ollama">ollama</button>
</div>
<div id="session-bar">
  <div id="tab-list"></div>
  <button id="history-btn" title="Session history">/</button>
  <button id="add-btn" title="New session">+</button>
</div>
<div id="title-bar">
  <span id="sess-title"></span>
</div>
<div id="content">
  <div id="history-view">
    <div id="history-header">
      <input id="sess-search" type="text" placeholder="filter sessions..." spellcheck="false" autocomplete="off">
    </div>
    <div id="sessions-list"></div>
  </div>
  <div id="wrap"></div>
  <div id="banner">
    <span id="banner-msg"></span>
    <button id="new-session-btn">new session</button>
  </div>
</div>
<script src="${xtermJs}"></script>
<script src="${fitJs}"></script>
<script src="${agentsJs}"></script>
<script src="${soundsJs}"></script>
</body></html>`;
    }
}
// ── Sound manager ──────────────────────────────────────────────────────────
class SoundManager {
    _provider = null;
    _enabled;
    constructor() {
        this._enabled = vscode.workspace.getConfiguration('null.soundDesign').get('enabled', true);
    }
    attach(agentsProvider) { this._provider = agentsProvider; }
    post(name) {
        if (!this._enabled)
            return;
        this._provider?._view?.webview.postMessage({ type: 'playSound', name });
    }
    toggle() {
        this._enabled = !this._enabled;
        vscode.workspace.getConfiguration('null.soundDesign').update('enabled', this._enabled, true);
        return this._enabled;
    }
}
// ── AI quick-fix code actions ──────────────────────────────────────────────
class NullCodeActionsProvider {
    _agents;
    constructor(_agents) {
        this._agents = _agents;
    }
    provideCodeActions(document, _range, context) {
        const diag = context.diagnostics[0];
        if (!diag)
            return [];
        const action = new vscode.CodeAction('Fix with AI (null)', vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diag];
        action.command = {
            command: 'null._fixWithAI', title: 'Fix with AI (null)', arguments: [document, diag],
        };
        return [action];
    }
}
// ── Welcome page ───────────────────────────────────────────────────────────
function showWelcomePage(context) {
    const panel = vscode.window.createWebviewPanel('null.welcome', 'Welcome to Null IDE', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: false });
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
  <div class="shortcut"><span class="shortcut-label">Open AI Agents</span><span class="shortcut-key">Ctrl+Shift+Alt+A</span></div>
  <div class="shortcut"><span class="shortcut-label">Generate commit</span><span class="shortcut-key">Ctrl+Shift+Alt+G</span></div>
  <div class="shortcut"><span class="shortcut-label">Toggle terminal</span><span class="shortcut-key">Ctrl+\`</span></div>
  <div class="shortcut"><span class="shortcut-label">Quick open file</span><span class="shortcut-key">Ctrl+P</span></div>
  <div class="shortcut"><span class="shortcut-label">Close welcome</span><span class="shortcut-key">Ctrl+W</span></div>
</div>
<div class="actions">
  <button class="btn-primary" id="open-agents">Open AI Agents</button>
  <button class="btn-secondary" id="open-file">Open a folder</button>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('open-agents').addEventListener('click', () => vscode.postMessage({ command: 'openAgents' }));
  document.getElementById('open-file').addEventListener('click', () => vscode.postMessage({ command: 'openFolder' }));
</script>
</body>
</html>`;
    panel.webview.onDidReceiveMessage((msg) => {
        if (msg.command === 'openAgents') {
            vscode.commands.executeCommand('workbench.view.extension.null-agents');
        }
        else if (msg.command === 'openFolder') {
            vscode.commands.executeCommand('workbench.action.files.openFolder');
        }
    }, undefined, context.subscriptions);
}
// ── Activation ─────────────────────────────────────────────────────────────
function activate(context) {
    const bar = vscode.window.createStatusBarItem('null.gen', vscode.StatusBarAlignment.Right, 0);
    bar.text = '$(sparkle)';
    bar.tooltip = 'Null: generate commit message';
    bar.command = 'null.generateCommitMessage';
    bar.show();
    context.subscriptions.push(bar);
    (0, recentProjectsIntegration_1.trackCurrentProject)();
    (0, recentProjectsIntegration_1.registerRecentProjectsUriHandler)(context);
    const updateBar = vscode.window.createStatusBarItem('null.update', vscode.StatusBarAlignment.Right, 1);
    updateBar.text = '$(cloud-download) Update';
    updateBar.tooltip = 'Null IDE update available';
    updateBar.command = 'null.installUpdate';
    context.subscriptions.push(updateBar);
    const sounds = new SoundManager();
    const soundBar = vscode.window.createStatusBarItem('null.sound', vscode.StatusBarAlignment.Right, -1);
    soundBar.text = '$(unmute)';
    soundBar.tooltip = 'Null: toggle sound design';
    soundBar.command = 'null.toggleSoundDesign';
    soundBar.show();
    context.subscriptions.push(soundBar);
    function refreshUpdateButton() {
        const update = context.globalState.get('null.availableUpdate');
        if (update?.latest) {
            updateBar.text = `$(cloud-download) ${update.latest}`;
            updateBar.tooltip = `Install Null IDE ${update.latest}`;
            updateBar.show();
        }
        else {
            updateBar.hide();
        }
    }
    context.subscriptions.push(vscode.commands.registerCommand('null.generateCommitMessage', async () => {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
            vscode.window.showErrorMessage('Open a folder first.');
            return;
        }
        const cwd = folders[0].uri.fsPath;
        const diff = getStagedDiff(cwd);
        if (!diff.trim()) {
            vscode.window.showWarningMessage('No changes found (nothing staged or committed).');
            return;
        }
        let message;
        try {
            await vscode.window.withProgress({ location: { viewId: 'workbench.scm' }, title: 'Generating commit message...' }, async () => { message = await runClaude(diff, cwd); });
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null: commit message generation failed — ${err.message}`);
            return;
        }
        const gitExt = vscode.extensions.getExtension('vscode.git');
        if (!gitExt) {
            vscode.window.showErrorMessage('Built-in git extension not found.');
            return;
        }
        const git = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate()).getAPI(1);
        const repo = git.repositories.find((r) => r.rootUri.fsPath === cwd) ?? git.repositories[0];
        if (repo && message) {
            repo.inputBox.value = message;
            vscode.commands.executeCommand('workbench.view.scm');
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.checkForUpdates', async () => {
        try {
            const update = await checkForUpdate(context, false);
            refreshUpdateButton();
            if (update)
                await promptForUpdate(update);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null: update check failed - ${err.message}`);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.installUpdate', async () => {
        try {
            await installUpdate(context);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null: update failed - ${err.message}`);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.clearWebviewCache', async () => {
        const appData = process.env.APPDATA;
        if (!appData) {
            vscode.window.showErrorMessage('Null: cannot locate %APPDATA%.');
            return;
        }
        const userDataDir = path.join(appData, 'Null');
        const targets = ['Cache', 'CachedData', 'Code Cache', 'WebStorage'];
        const cleared = [], failed = [];
        for (const name of targets) {
            const p = path.join(userDataDir, name);
            try {
                if (fs.existsSync(p))
                    fs.rmSync(p, { recursive: true, force: true });
                cleared.push(name);
            }
            catch {
                failed.push(name);
            }
        }
        const detail = cleared.length ? `Cleared: ${cleared.join(', ')}.` : 'Nothing to clear.';
        const warning = failed.length ? ` Could not delete: ${failed.join(', ')}.` : '';
        const choice = await vscode.window.showInformationMessage(`${detail}${warning} Reload window to apply.`, 'Reload Now');
        if (choice === 'Reload Now')
            vscode.commands.executeCommand('workbench.action.reloadWindow');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.showWelcome', () => showWelcomePage(context)));
    if (!context.globalState.get('null.welcomeShown')) {
        context.globalState.update('null.welcomeShown', true);
        showWelcomePage(context);
    }
    refreshUpdateButton();
    checkForUpdate(context, true)
        .then(update => { refreshUpdateButton(); if (update)
        return promptForUpdate(update); })
        .catch(() => { });
    const nodePty = loadNodePty(context.extensionUri.fsPath);
    const agentsProvider = new AgentsViewProvider(context.extensionUri, nodePty, context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('null.agentsView', agentsProvider, {
        webviewOptions: { retainContextWhenHidden: true },
    }));
    context.subscriptions.push({ dispose: () => agentsProvider._saveBuffers() });
    const beforeProvider = new AgentBeforeProvider();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(beforeProvider.scheme, beforeProvider));
    // Track whether the active tab is one of our agent diffs and expose context.
    const updateDiffContext = () => {
        const active = vscode.window.tabGroups.activeTabGroup.activeTab;
        const viewing = active?.input instanceof vscode.TabInputTextDiff &&
            active.input.original.scheme === beforeProvider.scheme;
        vscode.commands.executeCommand('setContext', 'null.viewingProposedDiff', !!viewing);
    };
    context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(updateDiffContext), vscode.window.onDidChangeActiveTextEditor(updateDiffContext));
    context.subscriptions.push(vscode.commands.registerCommand('null.acceptProposedDiff', async () => {
        const active = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (active)
            await vscode.window.tabGroups.close(active);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.rejectProposedDiff', async () => {
        const active = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (!(active?.input instanceof vscode.TabInputTextDiff))
            return;
        const diskUri = active.input.modified;
        await vscode.window.tabGroups.close(active);
        await vscode.commands.executeCommand('null.revertAgentChange', diskUri);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.revertAgentChange', async (uri) => {
        try {
            await vscode.commands.executeCommand('git.revertFile', uri);
        }
        catch {
            try {
                (0, child_process_1.execSync)(`git checkout -- "${uri.fsPath}"`, { cwd: path.dirname(uri.fsPath) });
            }
            catch (err) {
                vscode.window.showErrorMessage(`Null: revert failed — ${err.message}`);
            }
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.agentsPaste', () => agentsProvider.paste()));
    // ── Ollama status bar ──────────────────────────────────────────────────────
    const ollamaBar = vscode.window.createStatusBarItem('null.ollama', vscode.StatusBarAlignment.Right, -2);
    ollamaBar.text = `∅ ${vscode.workspace.getConfiguration('null.ollama').get('model', 'llama3.2')}`;
    ollamaBar.tooltip = 'Null: Switch Ollama model';
    ollamaBar.command = 'null.ollamaModel';
    ollamaBar.show();
    context.subscriptions.push(ollamaBar);
    context.subscriptions.push(vscode.commands.registerCommand('null.ollamaModel', async () => {
        const alive = await ollama.isAlive();
        if (!alive) {
            vscode.window.showErrorMessage('Ollama is not running. Start it with: ollama serve');
            return;
        }
        const available = await ollama.models();
        if (!available.length) {
            vscode.window.showWarningMessage('No Ollama models installed. Run: ollama pull llama3.2');
            return;
        }
        const current = vscode.workspace.getConfiguration('null.ollama').get('model', 'llama3.2');
        const picked = await vscode.window.showQuickPick(available.map(m => ({ label: m, description: m === current ? '(current)' : undefined })), { placeHolder: 'Select Ollama model' });
        if (!picked)
            return;
        await vscode.workspace.getConfiguration('null.ollama').update('model', picked.label, true);
        ollamaBar.text = `∅ ${picked.label}`;
        vscode.window.setStatusBarMessage(`Ollama model → ${picked.label}`, 2000);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.ollamaChat', async () => {
        const question = await vscode.window.showInputBox({ prompt: 'Ask Ollama', placeHolder: 'What would you like to know?' });
        if (!question)
            return;
        const editor = vscode.window.activeTextEditor;
        let ctx = '';
        if (editor) {
            const sel = editor.selection;
            const text = !sel.isEmpty ? editor.document.getText(sel) : editor.document.getText().slice(0, 32768);
            ctx = `\n\n--- context: ${vscode.workspace.asRelativePath(editor.document.uri)} (${editor.document.languageId}) ---\n${text}\n---`;
        }
        const termId = agentsProvider.getOrCreateOllamaTab();
        agentsProvider.writeToTerm(termId, question + ctx + '\r');
        vscode.commands.executeCommand('workbench.view.extension.null-agents');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.ollamaReview', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Open a file to review.');
            return;
        }
        const file = vscode.workspace.asRelativePath(editor.document.uri);
        const lang = editor.document.languageId;
        const code = editor.document.getText().slice(0, 32768);
        const wsFolders = vscode.workspace.workspaceFolders;
        let diff = '';
        if (wsFolders?.length) {
            try {
                diff = (0, child_process_1.execSync)('git diff HEAD', { cwd: wsFolders[0].uri.fsPath, encoding: 'utf8', timeout: 5000 }).slice(0, 2048);
            }
            catch { }
        }
        const prompt = `Review this ${lang} file (${file}) for bugs, security issues, and improvements:\n\n` +
            `\`\`\`${lang}\n${code}\n\`\`\`` +
            (diff ? `\n\nRecent changes (git diff HEAD):\n\`\`\`diff\n${diff}\n\`\`\`` : '') + '\r';
        const termId = agentsProvider.getOrCreateOllamaTab();
        agentsProvider.writeToTerm(termId, prompt);
        vscode.commands.executeCommand('workbench.view.extension.null-agents');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.insertPromptTemplate', async () => {
        const templates = vscode.workspace.getConfiguration('null')
            .get('promptTemplates', []);
        if (!templates.length) {
            vscode.window.showWarningMessage('No prompt templates configured. Add them in Settings → null.promptTemplates.');
            return;
        }
        const picked = await vscode.window.showQuickPick(templates.map(t => ({ label: t.label, description: t.text.slice(0, 60).replace(/\n/g, '↵'), _text: t.text })), { placeHolder: 'Select a prompt template' });
        if (!picked)
            return;
        if (!agentsProvider.writeToActive(picked._text)) {
            vscode.window.showWarningMessage('No active agent terminal. Open an agent tab first.');
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.injectContext', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Open a file first.');
            return;
        }
        const file = vscode.workspace.asRelativePath(editor.document.uri);
        const lang = editor.document.languageId;
        const sel = editor.selection;
        const maxBytes = agentsProvider.activeTabType() === 'ollama' ? 32768 : 8192;
        const text = !sel.isEmpty ? editor.document.getText(sel) : editor.document.getText().slice(0, maxBytes);
        const wsFolders = vscode.workspace.workspaceFolders;
        let diff = '';
        if (wsFolders?.length) {
            try {
                diff = (0, child_process_1.execSync)('git diff --staged', { cwd: wsFolders[0].uri.fsPath, encoding: 'utf8', timeout: 5000 }).slice(0, 2048);
            }
            catch { }
        }
        const block = `--- context: ${file} (${lang}) ---\n${text}\n---` +
            (diff ? `\n\n--- staged changes ---\n${diff}\n---` : '') + '\n';
        if (!agentsProvider.writeToActive(block)) {
            vscode.window.showWarningMessage('No active agent terminal. Open an agent tab first.');
        }
        else {
            vscode.commands.executeCommand('workbench.view.extension.null-agents');
        }
    }));
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ pattern: '**' }, new NullCodeActionsProvider(agentsProvider), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
    context.subscriptions.push(vscode.commands.registerCommand('null._fixWithAI', (document, diag) => {
        const file = vscode.workspace.asRelativePath(document.uri);
        const lang = document.languageId;
        const line = diag.range.start.line;
        const start = Math.max(0, line - 10);
        const end = Math.min(document.lineCount - 1, line + 10);
        const snippet = document.getText(new vscode.Range(start, 0, end, document.lineAt(end).text.length));
        const block = `--- fix with AI: ${file}:${line + 1} (${lang}) ---\n` +
            `Error: ${diag.message}\n\n` +
            `Code (lines ${start + 1}–${end + 1}):\n${snippet}\n---\n`;
        if (!agentsProvider.writeToActive(block)) {
            vscode.window.showWarningMessage('No active agent terminal. Open an agent tab first.');
        }
        else {
            vscode.commands.executeCommand('workbench.view.extension.null-agents');
        }
    }));
    sounds.attach(agentsProvider);
    context.subscriptions.push(vscode.commands.registerCommand('null.toggleSoundDesign', () => {
        const on = sounds.toggle();
        soundBar.text = on ? '$(unmute)' : '$(mute)';
        vscode.window.setStatusBarMessage(`Sound design ${on ? 'on' : 'off'}`, 2000);
    }));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => sounds.post('save')));
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(() => sounds.post('open')));
    const plansDir = path.join(os.homedir(), '.claude', 'plans');
    const plansWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(plansDir), '*.md'), false, true, true);
    plansWatcher.onDidCreate((uri) => {
        setTimeout(() => {
            if (vscode.workspace.getConfiguration('null').get('plans.autoOpen', true)) {
                vscode.window.showTextDocument(uri);
            }
        }, 500);
    });
    context.subscriptions.push(plansWatcher);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map
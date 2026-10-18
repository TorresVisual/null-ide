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
exports.onStagedUpdateChanged = void 0;
exports.getUpdateProgress = getUpdateProgress;
exports.findInstall = findInstall;
exports.getAvailableUpdate = getAvailableUpdate;
exports.checkForUpdate = checkForUpdate;
exports.promptForUpdate = promptForUpdate;
exports.installUpdate = installUpdate;
exports.acknowledgeUpdate = acknowledgeUpdate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const https = __importStar(require("https"));
const os = __importStar(require("os"));
const readline = __importStar(require("readline"));
const child_process_1 = require("child_process");
const versionComparison_1 = require("./versionComparison");
const updateStatus_1 = require("./updateStatus");
const UPDATE_REPO = 'TorresVisual/null-ide';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const output = vscode.window.createOutputChannel('Null IDE Updates');
exports.onStagedUpdateChanged = new vscode.EventEmitter();
let latestProgress;
function getUpdateProgress() { return latestProgress; }
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
/** The install that ships `setup\null-setup.exe`; undefined when running from a dev checkout. */
function findInstall(context) {
    for (const installDir of getInstallDirCandidates(context)) {
        const setupExe = path.join(installDir, 'setup', 'null-setup.exe');
        if (fs.existsSync(setupExe))
            return { installDir, setupExe };
    }
    return undefined;
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
function formatNetworkError(err) {
    const msg = err.message || '';
    if (msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN')) {
        return new Error('Unable to resolve api.github.com. Please check your internet connection or proxy settings.');
    }
    if (msg.includes('ETIMEDOUT') || msg.includes('timed out')) {
        return new Error('Connection to api.github.com timed out.');
    }
    if (msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET')) {
        return new Error('Connection to api.github.com was refused or reset.');
    }
    return err;
}
async function requestJson(url, retries = 2) {
    let lastError = new Error('Unknown network error');
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
        try {
            return await new Promise((resolve, reject) => {
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
        catch (err) {
            lastError = formatNetworkError(err);
            // Don't retry HTTP 4xx/5xx status errors, only network/connect errors.
            if (err.message?.startsWith('GitHub returned')) {
                throw lastError;
            }
        }
    }
    throw lastError;
}
async function getLatestRelease(repo) {
    return requestJson(`https://api.github.com/repos/${repo}/releases/latest`);
}
/** The remembered update, or undefined once the running version is already at or past it. */
function getAvailableUpdate(context) {
    const update = context.globalState.get('null.availableUpdate');
    if (!update?.latest)
        return undefined;
    if (!(0, updateStatus_1.isStillAvailable)(update.latest, getCurrentVersion(context))) {
        void context.globalState.update('null.availableUpdate', undefined);
        void context.globalState.update('null.stagedUpdate', undefined);
        void vscode.commands.executeCommand('setContext', 'nullUpdateAvailable', false);
        return undefined;
    }
    return update;
}
let prefetching; // version being downloaded by this window's null-setup
/** Downloads and verifies the release in the background; installing only ever starts from the user's click. */
function startPrefetch(context, update) {
    if (!(0, updateStatus_1.canSelfUpdate)(process.platform))
        return;
    const staged = context.globalState.get('null.stagedUpdate');
    if (prefetching === update.latest || (staged?.version === update.latest && staged.verified))
        return;
    if (!(0, updateStatus_1.isSafeTag)(update.latest)) {
        output.appendLine(`Refusing to prefetch unexpected tag "${update.latest}".`);
        return;
    }
    const install = findInstall(context);
    if (!install) {
        output.appendLine('null-setup.exe not found next to this install; skipping the background download.');
        return;
    }
    prefetching = update.latest;
    latestProgress = { state: 'checking' };
    exports.onStagedUpdateChanged.fire();
    const child = (0, child_process_1.spawn)(install.setupExe, ['prefetch', '--repo', update.repo, '--version', update.latest, '--install-dir', install.installDir], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    readline.createInterface({ input: child.stdout }).on('line', line => {
        const p = (0, updateStatus_1.parseProgressLine)(line);
        if (!p) {
            output.appendLine(line);
            return;
        }
        latestProgress = p;
        if (p.state === 'ready') {
            void context.globalState.update('null.stagedUpdate', { version: update.latest, verified: true });
        }
        if (p.state === 'failed')
            output.appendLine(`Background download failed: ${p.message}${p.log ? ` (log: ${p.log})` : ''}`);
        exports.onStagedUpdateChanged.fire();
    });
    child.on('error', err => {
        output.appendLine(`Could not start null-setup: ${err.message}`);
        latestProgress = { state: 'failed', message: err.message };
        prefetching = undefined;
        exports.onStagedUpdateChanged.fire();
    });
    child.on('close', () => { prefetching = undefined; });
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
    const hasPackage = (0, updateStatus_1.hasPlatformPackage)(process.platform, release.assets);
    output.appendLine(`Latest release: ${latest || '(none)'}. Package for ${process.platform}: ${hasPackage ? 'yes' : 'no'}`);
    if (!latest || !hasPackage || (0, versionComparison_1.compareVersionTags)(latest, current) <= 0) {
        await context.globalState.update('null.availableUpdate', undefined);
        await context.globalState.update('null.stagedUpdate', undefined);
        await vscode.commands.executeCommand('setContext', 'nullUpdateAvailable', false);
        latestProgress = undefined;
        exports.onStagedUpdateChanged.fire();
        if (!silent) {
            const packageNote = hasPackage ? '' : ' No package for this platform was found on the latest release.';
            vscode.window.showInformationMessage(`Null IDE is up to date (${current}; latest ${latest || 'unknown'}).${packageNote}`);
        }
        return null;
    }
    const update = {
        repo, current, latest,
        url: release.html_url,
        checkedAt: new Date().toISOString(),
        releaseNotes: release.body,
    };
    await context.globalState.update('null.availableUpdate', update);
    await vscode.commands.executeCommand('setContext', 'nullUpdateAvailable', true);
    output.appendLine(`Update available: ${current} -> ${latest}`);
    startPrefetch(context, update);
    return update;
}
function truncateReleaseNotes(notes) {
    if (!notes)
        return undefined;
    return notes.length > 600 ? notes.slice(0, 600) + '…' : notes;
}
async function promptForUpdate(update) {
    const buttons = (0, updateStatus_1.canSelfUpdate)(process.platform)
        ? ['Update Now', 'Release Notes', 'Later']
        : ['Open Release Page', 'Later'];
    const action = await vscode.window.showInformationMessage(`Null IDE ${update.latest} is available. You are running ${update.current}.`, { detail: truncateReleaseNotes(update.releaseNotes) }, ...buttons);
    if (action === 'Update Now' || action === 'Open Release Page') {
        await vscode.commands.executeCommand('null.installUpdate');
    }
    else if (action === 'Release Notes' && update.url) {
        await vscode.env.openExternal(vscode.Uri.parse(update.url));
    }
}
async function installUpdate(context) {
    const update = getAvailableUpdate(context) || await checkForUpdate(context, false);
    if (!update)
        return;
    if (!(0, updateStatus_1.canSelfUpdate)(process.platform)) {
        if (update.url)
            await vscode.env.openExternal(vscode.Uri.parse(update.url));
        return;
    }
    const install = findInstall(context);
    if (!install) {
        vscode.window.showErrorMessage('Null IDE: null-setup.exe was not found in this installation, so it cannot update itself. Reinstall from the latest release.');
        return;
    }
    if (!(0, updateStatus_1.isSafeTag)(update.latest)) {
        vscode.window.showErrorMessage(`Null IDE: unexpected release tag "${update.latest}".`);
        return;
    }
    const choice = await vscode.window.showWarningMessage(`Install Null IDE ${update.latest}? The IDE will close, update, and reopen.`, { modal: true, detail: truncateReleaseNotes(update.releaseNotes) }, 'Restart and Update');
    if (choice !== 'Restart and Update')
        return;
    const child = (0, child_process_1.spawn)(install.setupExe, ['update', '--repo', update.repo, '--version', update.latest, '--install-dir', install.installDir, '--launch'], 
    // cwd must not be the install dir (the extension host's): a process inside it blocks renaming it.
    { detached: true, stdio: 'ignore', cwd: os.tmpdir() });
    const started = await new Promise(resolve => {
        child.once('spawn', () => resolve(true));
        child.once('error', err => {
            vscode.window.showErrorMessage(`Null IDE: could not start the updater: ${err.message}`);
            resolve(false);
        });
    });
    if (!started)
        return;
    child.unref();
    await context.globalState.update('null.stagedUpdate', undefined);
    await context.globalState.update('null.availableUpdate', undefined);
    latestProgress = undefined;
    exports.onStagedUpdateChanged.fire();
    // null-setup asks every window of this install to close; quitting here just makes that instant.
    setTimeout(() => vscode.commands.executeCommand('workbench.action.quit'), 1000);
}
/** After an update the new IDE proves it started by writing the marker; null-setup then removes the old copy. */
function acknowledgeUpdate(context) {
    const install = findInstall(context);
    if (!install)
        return;
    const journal = path.join(path.dirname(install.installDir), '.null-update-journal.json');
    let text;
    try {
        text = fs.readFileSync(journal, 'utf8');
    }
    catch {
        return;
    }
    if (!(0, updateStatus_1.shouldAcknowledge)(text))
        return; // a Started journal belongs to an update still in progress
    try {
        fs.writeFileSync(path.join(install.installDir, '.null-ready'), String(Date.now()));
        (0, child_process_1.spawn)(install.setupExe, ['recover', '--install-dir', install.installDir], { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.tmpdir() }).unref();
        output.appendLine('Acknowledged the completed update.');
    }
    catch (err) {
        output.appendLine(`Could not acknowledge the update: ${err.message}`);
    }
}
//# sourceMappingURL=updater.js.map
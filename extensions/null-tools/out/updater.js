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
exports.checkForUpdate = checkForUpdate;
exports.promptForUpdate = promptForUpdate;
exports.installUpdate = installUpdate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const https = __importStar(require("https"));
const crypto = __importStar(require("crypto"));
const child_process_1 = require("child_process");
const versionComparison_1 = require("./versionComparison");
const UPDATE_REPO = 'TorresVisual/null-ide';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const output = vscode.window.createOutputChannel('Null IDE Updates');
exports.onStagedUpdateChanged = new vscode.EventEmitter();
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
function getUpdaterExePath(context) {
    for (const installDir of getInstallDirCandidates(context)) {
        const p = path.join(installDir, 'resources', 'app', 'null-updater', 'null-updater.exe');
        if (fs.existsSync(p))
            return p;
    }
    const repoExe = path.resolve(context.extensionPath, '..', '..', 'updater', 'build', 'Release', 'null-updater.exe');
    if (fs.existsSync(repoExe))
        return repoExe;
    return null;
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
function requestText(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Null-IDE' } }, res => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                requestText(res.headers.location).then(resolve, reject);
                return;
            }
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                reject(new Error(`Request failed: HTTP ${res.statusCode}`));
                return;
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve(body));
        }).on('error', reject);
    });
}
function downloadToFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const file = fs.createWriteStream(destPath);
        https.get(url, { headers: { 'User-Agent': 'Null-IDE' } }, res => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                fs.unlink(destPath, () => {
                    downloadToFile(res.headers.location, destPath).then(resolve, reject);
                });
                return;
            }
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                file.close();
                reject(new Error(`Download failed: HTTP ${res.statusCode}`));
                return;
            }
            res.on('data', (chunk) => hash.update(chunk));
            res.on('error', reject);
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve(hash.digest('hex')));
            });
        }).on('error', reject);
    });
}
async function getLatestRelease(repo) {
    return requestJson(`https://api.github.com/repos/${repo}/releases/latest`);
}
function findZipAsset(release) {
    const zipPattern = /^null-ide-win32-x64(-[^/\\]+)?\.zip$/i;
    return release.assets.find(a => zipPattern.test(a.name)) || null;
}
function findSha256AssetUrl(release, zipAssetName) {
    const sidecar = release.assets.find(a => a.name === `${zipAssetName}.sha256`);
    return sidecar?.browser_download_url;
}
function hasWindowsPackage(release) {
    return Array.isArray(release.assets) &&
        release.assets.some(a => /^(null-ide-win32-x64(-[^/\\]+)?\.zip|NullIDESetup.*\.exe)$/i.test(a.name));
}
function stagingRoot() {
    return path.join(os.tmpdir(), 'null-ide-update-staged');
}
async function stageUpdateInBackground(context, update) {
    if (!update.assetUrl || !update.assetName)
        return;
    const existing = context.globalState.get('null.stagedUpdate');
    if (existing?.version === update.latest && existing.verified && fs.existsSync(existing.zipPath)) {
        return; // already staged and verified
    }
    try {
        const versionDir = path.join(stagingRoot(), update.latest);
        fs.rmSync(stagingRoot(), { recursive: true, force: true });
        fs.mkdirSync(versionDir, { recursive: true });
        const zipPath = path.join(versionDir, update.assetName);
        output.appendLine(`Background-downloading ${update.assetName} to ${zipPath}`);
        const actualSha256 = await downloadToFile(update.assetUrl, zipPath);
        let verified = true;
        if (update.sha256Url) {
            const expected = (await requestText(update.sha256Url)).trim().split(/\s+/)[0]?.toLowerCase();
            verified = expected === actualSha256.toLowerCase();
            if (!verified) {
                output.appendLine(`Checksum mismatch for ${update.assetName}: expected ${expected}, got ${actualSha256}`);
                fs.rmSync(versionDir, { recursive: true, force: true });
                return;
            }
        }
        else {
            output.appendLine(`No .sha256 sidecar found for ${update.assetName}; staging without verification.`);
        }
        const staged = { version: update.latest, zipPath, verified };
        await context.globalState.update('null.stagedUpdate', staged);
        await vscode.commands.executeCommand('setContext', 'nullUpdateStaged', true);
        exports.onStagedUpdateChanged.fire();
        output.appendLine(`Update ${update.latest} staged and ready to install.`);
    }
    catch (err) {
        output.appendLine(`Background staging failed: ${err.message}`);
    }
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
    if (!latest || !hasPackage || (0, versionComparison_1.compareVersionTags)(latest, current) <= 0) {
        await context.globalState.update('null.availableUpdate', undefined);
        await context.globalState.update('null.stagedUpdate', undefined);
        await vscode.commands.executeCommand('setContext', 'nullUpdateAvailable', false);
        await vscode.commands.executeCommand('setContext', 'nullUpdateStaged', false);
        exports.onStagedUpdateChanged.fire();
        if (!silent) {
            const packageNote = hasPackage ? '' : ' No Windows package was found on the latest release.';
            vscode.window.showInformationMessage(`Null IDE is up to date (${current}; latest ${latest || 'unknown'}).${packageNote}`);
        }
        return null;
    }
    const asset = findZipAsset(release);
    const update = {
        repo, current, latest,
        url: release.html_url,
        checkedAt: new Date().toISOString(),
        releaseNotes: release.body,
        assetUrl: asset?.browser_download_url,
        assetName: asset?.name,
        assetSize: asset?.size,
        sha256Url: asset ? findSha256AssetUrl(release, asset.name) : undefined,
    };
    await context.globalState.update('null.availableUpdate', update);
    await vscode.commands.executeCommand('setContext', 'nullUpdateAvailable', true);
    output.appendLine(`Update available: ${current} -> ${latest}`);
    void stageUpdateInBackground(context, update);
    return update;
}
function truncateReleaseNotes(notes) {
    if (!notes)
        return undefined;
    return notes.length > 600 ? notes.slice(0, 600) + '…' : notes;
}
async function promptForUpdate(update) {
    const action = await vscode.window.showInformationMessage(`Null IDE ${update.latest} is available. You are running ${update.current}.`, { detail: truncateReleaseNotes(update.releaseNotes) }, 'Update Now', 'Release Notes', 'Later');
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
    const updaterExe = getUpdaterExePath(context);
    const updaterScript = getUpdaterScriptPath(context);
    if (!updaterExe && !updaterScript) {
        vscode.window.showErrorMessage('Null IDE updater was not found in this installation.');
        return;
    }
    const choice = await vscode.window.showWarningMessage(`Install Null IDE ${update.latest}? The IDE will close, update, and reopen.`, { modal: true, detail: truncateReleaseNotes(update.releaseNotes) }, 'Restart and Update');
    if (choice !== 'Restart and Update')
        return;
    const updaterDir = path.join(process.env.TEMP || process.env.TMP || getInstallDir(context), `null-ide-updater-${Date.now()}`);
    fs.mkdirSync(updaterDir, { recursive: true });
    const installDir = getInstallDir(context);
    const launcherPath = path.join(updaterDir, 'launcher.cmd');
    const cmdQ = (s) => `"${s.replace(/"/g, '""')}"`;
    const staged = context.globalState.get('null.stagedUpdate');
    const hasStagedZip = !!staged && staged.version === update.latest && staged.verified && fs.existsSync(staged.zipPath);
    let launchCmd;
    if (updaterExe) {
        const stagedExe = path.join(updaterDir, 'null-updater.exe');
        fs.copyFileSync(updaterExe, stagedExe);
        const args = [
            cmdQ(stagedExe),
            '--repo', cmdQ(update.repo),
            '--version', cmdQ(update.latest),
            '--install-dir', cmdQ(installDir),
            '--wait', '--launch',
        ];
        if (hasStagedZip) {
            args.push('--zip-path', cmdQ(staged.zipPath));
        }
        launchCmd = args.join(' ');
    }
    else {
        const stagedUpdater = path.join(updaterDir, 'update-null-ide.ps1');
        const installer = path.join(path.dirname(updaterScript), 'install-null-ide.ps1');
        fs.copyFileSync(updaterScript, stagedUpdater);
        if (fs.existsSync(installer)) {
            fs.copyFileSync(installer, path.join(updaterDir, 'install-null-ide.ps1'));
        }
        launchCmd = `powershell.exe -NoLogo -ExecutionPolicy Bypass -WindowStyle Normal -File ${cmdQ(stagedUpdater)} -Repo ${cmdQ(update.repo)} -InstallDir ${cmdQ(installDir)} -Force -WaitForExit -Launch`;
    }
    fs.writeFileSync(launcherPath, `@echo off\r\nstart "Null IDE Update" ${launchCmd}\r\n`, 'utf8');
    const child = (0, child_process_1.spawn)('cmd.exe', ['/c', launcherPath], { detached: true, stdio: 'ignore' });
    child.unref();
    await context.globalState.update('null.stagedUpdate', undefined);
    exports.onStagedUpdateChanged.fire();
    setTimeout(() => vscode.commands.executeCommand('workbench.action.quit'), 1000);
}
//# sourceMappingURL=updater.js.map
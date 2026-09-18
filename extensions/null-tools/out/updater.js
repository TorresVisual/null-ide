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
exports.checkForUpdate = checkForUpdate;
exports.promptForUpdate = promptForUpdate;
exports.installUpdate = installUpdate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const https = __importStar(require("https"));
const child_process_1 = require("child_process");
const UPDATE_REPO = 'TorresVisual/null-ide';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const output = vscode.window.createOutputChannel('Null IDE Updates');
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
//# sourceMappingURL=updater.js.map
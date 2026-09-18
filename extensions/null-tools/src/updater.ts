'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { spawn } from 'child_process';

// Electron adds resourcesPath to the Node process object; @types/node doesn't know about it.
declare global {
  namespace NodeJS {
    interface Process { resourcesPath?: string; }
  }
}

const UPDATE_REPO = 'TorresVisual/null-ide';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const output = vscode.window.createOutputChannel('Null IDE Updates');

interface InstallMetadata {
  version: string;
  repo: string;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  assets: { name: string }[];
}

export interface AvailableUpdate {
  repo: string;
  current: string;
  latest: string;
  url: string;
  checkedAt: string;
}

function getInstallDirCandidates(context: vscode.ExtensionContext): string[] {
  const candidates = [path.dirname(process.execPath)];

  if (process.resourcesPath) {
    candidates.push(path.resolve(process.resourcesPath, '..'));
  }

  if (context?.extensionPath) {
    candidates.push(path.resolve(context.extensionPath, '..', '..', '..', '..'));
  }

  return [...new Set(candidates.map(c => path.resolve(c)))];
}

function getInstallDir(context: vscode.ExtensionContext): string {
  const candidates = getInstallDirCandidates(context);
  return candidates[0] || path.dirname(process.execPath);
}

function getUpdaterScriptPath(context: vscode.ExtensionContext): string | null {
  for (const installDir of getInstallDirCandidates(context)) {
    const p = path.join(installDir, 'resources', 'app', 'null-updater', 'update-null-ide.ps1');
    if (fs.existsSync(p)) return p;
  }

  const repoUpdater = path.resolve(context.extensionPath, '..', '..', 'scripts', 'update-null-ide.ps1');
  if (fs.existsSync(repoUpdater)) return repoUpdater;

  return null;
}

function getInstallMetadata(context: vscode.ExtensionContext): InstallMetadata | null {
  const candidates: string[] = [];

  for (const installDir of getInstallDirCandidates(context)) {
    candidates.push(
      path.join(installDir, '.null-ide-install.json'),
      path.join(installDir, 'resources', 'app', '.null-ide-install.json'),
    );
  }

  if (process.resourcesPath) {
    candidates.push(
      path.resolve(process.resourcesPath, '..', '.null-ide-install.json'),
      path.join(process.resourcesPath, 'app', '.null-ide-install.json'),
    );
  }

  for (const metadataPath of [...new Set(candidates)]) {
    try {
      output.appendLine(`Reading install metadata from ${metadataPath}`);
      const raw = fs.readFileSync(metadataPath, 'utf8').replace(/^﻿/, '');
      return JSON.parse(raw) as InstallMetadata;
    } catch (err) {
      output.appendLine(`Could not read install metadata at ${metadataPath}: ${(err as Error).message}`);
    }
  }

  return null;
}

function getCurrentVersion(context: vscode.ExtensionContext): string {
  const metadata = getInstallMetadata(context);
  if (metadata?.version) return String(metadata.version);
  return 'local';
}

function getUpdateRepo(context: vscode.ExtensionContext): string {
  return getInstallMetadata(context)?.repo || UPDATE_REPO;
}

function trimVersionTag(tag: string | undefined | null): string {
  return String(tag || '').replace(/^v/i, '');
}

function compareVersionTags(left: string, right: string): number {
  const leftParts  = trimVersionTag(left).split(/[.-]/).map(p => Number.parseInt(p, 10));
  const rightParts = trimVersionTag(right).split(/[.-]/).map(p => Number.parseInt(p, 10));

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

function requestJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
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
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          let detail = '';
          try {
            const parsed = JSON.parse(body) as { message?: string };
            detail = parsed?.message ? `: ${parsed.message}` : '';
          } catch (_) {}
          reject(new Error(`GitHub returned ${res.statusCode}${detail}`));
        });
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body) as T); }
        catch (err) { reject(err); }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('GitHub request timed out')); });
  });
}

async function getLatestRelease(repo: string): Promise<GithubRelease> {
  return requestJson<GithubRelease>(`https://api.github.com/repos/${repo}/releases/latest`);
}

function hasWindowsPackage(release: GithubRelease): boolean {
  return Array.isArray(release.assets) &&
    release.assets.some(a => /^(null-ide-win32-x64.*\.zip|NullIDESetup.*\.exe)$/i.test(a.name));
}

export async function checkForUpdate(
  context: vscode.ExtensionContext,
  silent: boolean,
): Promise<AvailableUpdate | null> {
  const now = Date.now();
  const lastCheck = context.globalState.get<number>('null.lastUpdateCheck', 0);
  if (silent && now - lastCheck < UPDATE_CHECK_INTERVAL_MS) {
    output.appendLine(`Skipping startup update check; last check was ${new Date(lastCheck).toISOString()}.`);
    return null;
  }

  await context.globalState.update('null.lastUpdateCheck', now);

  const current = getCurrentVersion(context);
  const repo    = getUpdateRepo(context);
  output.appendLine(`Checking for updates from ${repo}. Current version: ${current}`);
  const release    = await getLatestRelease(repo);
  const latest     = String(release.tag_name || '');
  const hasPackage = hasWindowsPackage(release);
  output.appendLine(`Latest release: ${latest || '(none)'}. Windows package: ${hasPackage ? 'yes' : 'no'}`);

  if (!latest || !hasPackage || compareVersionTags(latest, current) <= 0) {
    await context.globalState.update('null.availableUpdate', undefined);
    await vscode.commands.executeCommand('setContext', 'nullUpdateAvailable', false);
    if (!silent) {
      const packageNote = hasPackage ? '' : ' No Windows package was found on the latest release.';
      vscode.window.showInformationMessage(
        `Null IDE is up to date (${current}; latest ${latest || 'unknown'}).${packageNote}`,
      );
    }
    return null;
  }

  const update: AvailableUpdate = {
    repo, current, latest,
    url: release.html_url,
    checkedAt: new Date().toISOString(),
  };

  await context.globalState.update('null.availableUpdate', update);
  await vscode.commands.executeCommand('setContext', 'nullUpdateAvailable', true);
  output.appendLine(`Update available: ${current} -> ${latest}`);
  return update;
}

export async function promptForUpdate(update: AvailableUpdate): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    `Null IDE ${update.latest} is available. You are running ${update.current}.`,
    'Update Now', 'Release Notes', 'Later',
  );

  if (action === 'Update Now') {
    await vscode.commands.executeCommand('null.installUpdate');
  } else if (action === 'Release Notes' && update.url) {
    await vscode.env.openExternal(vscode.Uri.parse(update.url));
  }
}

export async function installUpdate(context: vscode.ExtensionContext): Promise<void> {
  const update = context.globalState.get<AvailableUpdate>('null.availableUpdate')
    || await checkForUpdate(context, false);
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
    { modal: true }, 'Restart and Update',
  );
  if (choice !== 'Restart and Update') return;

  const updaterDir = path.join(
    process.env.TEMP || process.env.TMP || getInstallDir(context),
    `null-ide-updater-${Date.now()}`,
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
    '-Force', '-WaitForExit', '-Launch',
  ].map(a => `'${a.replace(/'/g, "''")}'`).join(', ');
  fs.writeFileSync(
    launcherPath,
    `Start-Process -FilePath powershell.exe -ArgumentList @(${psArgList}) -WindowStyle Normal\n`,
    'utf8',
  );

  const child = spawn('powershell.exe', [
    '-NoLogo', '-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', launcherPath,
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  setTimeout(() => vscode.commands.executeCommand('workbench.action.quit'), 500);
}

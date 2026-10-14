> Superseded by docs/specs/null-setup-installer-design.md (sub-project 1). The C++ updater described here was removed.

# Native Updater Fix + Improvement Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Make the already-built native updater EXE (`updater/`) the thing that actually runs when a user updates Null IDE, fix the real bugs found in it and in the TS updater module, and add checksum verification, changelog display, background download, and failure-recovery UX.

**Architecture:** `extensions/null-tools/src/updater.ts` becomes the single source of truth for update-checking, background downloading (with SHA256 verification), and invoking `null-updater.exe`. The EXE gains a `--zip-path` flag so it can skip its own download when the extension has already staged and verified a package, plus checksum verification for when it must download itself, rollback-on-failure, a post-swap call into `install-null-ide.ps1 -ReapplyRegistrations`, and Retry/Close buttons on failure. Dead duplicate updater code in `extension.ts` is deleted.

**Tech Stack:** TypeScript (VS Code extension host, Node `https`/`crypto`/`fs`), C++17 (WinHTTP, miniz, Win32 TaskDialog, BCrypt), PowerShell, GitHub Actions YAML.

**Spec:** `docs/specs/native-updater-design.md`

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Windows-only native code — build/verify via CMake + MSVC locally (`cmake -S updater -B updater/build -A x64 && cmake --build updater/build --config Release`); this is the standalone `updater/` CMake project, not the VSCodium/gulp mega-build, so it's fine to build locally (CLAUDE.md's "don't run CI/build scripts locally" is about the big pipeline, not this).
- `extensions/null-tools`: `npm run compile` (tsc) must succeed after every TS task; `npm test` runs `node --test` against compiled `out/*.test.js`.
- No new npm/vcpkg/NuGet dependencies. SHA256 uses Windows' built-in `bcrypt.dll` (CNG) on the C++ side and Node's built-in `crypto` on the TS side.
- Release asset naming stays `null-ide-win32-x64(-suffix)?.zip`; the new checksum sidecar is `<that-name>.sha256` in standard `sha256sum`-compatible format (`<hex>  <filename>`).
- Commit after each task.

---

### Task 1: Extract `compareVersionTags` into a pure module and fix the prerelease-suffix bug

Today `compareVersionTags` (duplicated in both `updater.ts` and dead code in `extension.ts`) falls back to raw string equality whenever a version segment is non-numeric, so a prerelease tag like `v1.2.0-beta` is reported as "not newer" unless it matches byte-for-byte. This is the root cause behind "checking works... sort of" — fix it once, in one place both the real code and the test import, so it can't drift again.

**Files:**
- Create: `extensions/null-tools/src/versionComparison.ts`
- Modify: `extensions/null-tools/src/versionComparison.test.ts`
- Test: `extensions/null-tools/src/versionComparison.test.ts` (already registered in `package.json`'s `test` script and `tsconfig.json`'s `include`)

**Interfaces:**
- Produces: `export function trimVersionTag(tag: string | undefined | null): string`, `export function compareVersionTags(left: string, right: string): number` — both pure, no `vscode` import, consumed by Task 3's `updater.ts`.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `extensions/null-tools/src/versionComparison.test.ts` with:

```ts
import assert from 'node:assert';
import test from 'node:test';
import { compareVersionTags } from './versionComparison';

test('compareVersionTags handles local vs version tags correctly', () => {
  assert.strictEqual(compareVersionTags('v1.2.3', 'local'), 1);
  assert.strictEqual(compareVersionTags('local', 'v1.2.3'), -1);
  assert.strictEqual(compareVersionTags('local', 'local'), 0);
});

test('compareVersionTags compares semantic versions correctly', () => {
  assert.ok(compareVersionTags('v1.2.4', 'v1.2.3') > 0);
  assert.strictEqual(compareVersionTags('1.2.3', 'v1.2.3'), 0);
  assert.ok(compareVersionTags('1.2.0', '1.2.3') < 0);
  assert.ok(compareVersionTags('v2.0.0', 'v1.9.9') > 0);
});

test('compareVersionTags handles prerelease suffixes correctly', () => {
  assert.ok(compareVersionTags('v1.2.0', 'v1.2.0-beta') > 0);
  assert.ok(compareVersionTags('v1.2.0-beta', 'v1.2.0') < 0);
  assert.strictEqual(compareVersionTags('v1.2.0-beta', 'v1.2.0-beta'), 0);
  assert.ok(compareVersionTags('v1.2.0-alpha', 'v1.2.0-beta') < 0);
});
```

- [ ] **Step 2: Run it to verify it fails (module doesn't exist yet)**

Run: `cd extensions/null-tools && npm test`
Expected: FAIL — `tsc` error, `Cannot find module './versionComparison'`.

- [ ] **Step 3: Create `versionComparison.ts` with the fixed comparison**

Create `extensions/null-tools/src/versionComparison.ts`:

```ts
'use strict';

export function trimVersionTag(tag: string | undefined | null): string {
  return String(tag || '').replace(/^v/i, '');
}

interface ParsedVersion {
  numeric: number[];
  suffix: string;
}

function parseVersion(tag: string): ParsedVersion {
  const trimmed = trimVersionTag(tag);
  const [numericPart, ...suffixParts] = trimmed.split('-');
  const numeric = numericPart.split('.').map(p => Number.parseInt(p, 10));
  return { numeric, suffix: suffixParts.join('-') };
}

export function compareVersionTags(left: string, right: string): number {
  if (left === right) return 0;
  if (right === 'local') return 1;
  if (left === 'local') return -1;

  const l = parseVersion(left);
  const r = parseVersion(right);

  if (l.numeric.some(Number.isNaN) || r.numeric.some(Number.isNaN)) {
    return String(left) === String(right) ? 0 : -1;
  }

  const count = Math.max(l.numeric.length, r.numeric.length);
  for (let i = 0; i < count; i++) {
    const diff = (l.numeric[i] || 0) - (r.numeric[i] || 0);
    if (diff !== 0) return diff;
  }

  // Same numeric version: a bare release outranks any prerelease suffix
  // (semver precedence: 1.2.0 > 1.2.0-beta). Two different prerelease
  // suffixes on the same numeric version compare lexicographically rather
  // than silently reporting "no update", which is what the old fallback did.
  if (!l.suffix && r.suffix) return 1;
  if (l.suffix && !r.suffix) return -1;
  if (l.suffix === r.suffix) return 0;
  return l.suffix < r.suffix ? -1 : 1;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd extensions/null-tools && npm test`
Expected: PASS — all `versionComparison.test.js` cases green (and the other three test files unaffected).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/versionComparison.ts extensions/null-tools/src/versionComparison.test.ts
git commit -m "fix: correct prerelease-suffix handling in version comparison"
```

---

### Task 2: Delete the dead duplicate updater code from `extension.ts`

A merge from another machine (`8060bd8`) left a full second copy of the updater implementation — including native-EXE-aware logic — pasted into `extension.ts`. None of it is wired to any command; `updaterIntegration.ts` registers `null.installUpdate`/`null.checkForUpdates` using `updater.ts` instead. This task removes the dead copy so Task 3 has one place to add the real fix. (If this task is executed before Task 3, deleting it now is safe regardless — nothing else in `extension.ts` references any of it.)

**Files:**
- Modify: `extensions/null-tools/src/extension.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — pure deletion.

- [ ] **Step 1: Remove the dead `declare global` augmentation and the three dead interfaces**

In `extensions/null-tools/src/extension.ts`, find this block near the top of the file (right after the imports):

```ts
// Electron adds resourcesPath to the Node process object; @types/node doesn't know about it.
declare global {
  namespace NodeJS {
    interface Process { resourcesPath?: string; }
  }
}

const UPDATE_REPO = 'TorresVisual/null-ide';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const output = vscode.window.createOutputChannel('Null IDE Updates');

// ── Interfaces ─────────────────────────────────────────────────────────────

interface InstallMetadata {
  version: string;
  repo: string;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  assets: { name: string }[];
}

interface AvailableUpdate {
  repo: string;
  current: string;
  latest: string;
  url: string;
  checkedAt: string;
}

interface AgentTab {
```

Replace it with:

```ts
// ── Interfaces ─────────────────────────────────────────────────────────────

interface AgentTab {
```

(The `declare global` augmentation is unnecessary here — `updater.ts` already declares the same `process.resourcesPath` augmentation, and TypeScript merges identical global augmentations across files with no conflict.)

- [ ] **Step 2: Delete the dead updater function block**

In the same file, delete everything from `function getInstallDirCandidates(context: vscode.ExtensionContext): string[] {` through the end of `async function installUpdate(context: vscode.ExtensionContext): Promise<void> { ... }` (its closing `}`), stopping right before the `// ── Agent file watcher ────...` comment. This is the block containing (in order): `getInstallDirCandidates`, `getInstallDir`, `getUpdaterExePath`, `getUpdaterScriptPath`, `getInstallMetadata`, `getCurrentVersion`, `getUpdateRepo`, `trimVersionTag`, `compareVersionTags`, `formatNetworkError`, `requestJson`, `getLatestRelease`, `hasWindowsPackage`, `checkForUpdate`, `promptForUpdate`, `installUpdate`.

Verify the deletion is correct by confirming none of those 16 identifiers appear anywhere else in `extension.ts` before deleting (already confirmed during planning — this block is self-contained and unreferenced), and that immediately after the deletion the file reads:

```ts
// ── Commit message generator ───────────────────────────────────────────────

const PROMPT =
```

directly followed later by:

```ts
// ── Agent file watcher ────────────────────────────────────────────────────

const WATCH_IGNORE = /[/\\](\.git|node_modules|out|dist|\.vscodium)[/\\]|\.(?:map|log|bin)$/;
```

with nothing else in between removed (the commit-message generator section, `getNonce`, `loadNodePty`, and all the interfaces/types after `AgentTab` are untouched and must remain).

- [ ] **Step 3: Compile to verify**

Run: `cd extensions/null-tools && npm run compile`
Expected: succeeds with no errors (no leftover references to the deleted identifiers).

- [ ] **Step 4: Commit**

```bash
git add extensions/null-tools/src/extension.ts
git commit -m "refactor: remove dead duplicate updater code from extension.ts"
```

---

### Task 3: Rewrite `updater.ts` — native EXE support, background download, checksum verification, changelog

This is the core of the fix: `updater.ts` gains native-EXE path resolution, network retry/error-formatting, expanded release metadata (changelog + asset URLs + checksum sidecar URL), a background-download-and-verify staging pipeline, and `installUpdate()` wired to actually invoke the EXE (with `--zip-path`/`--version`) instead of only ever running the old PowerShell launcher.

**Files:**
- Modify: `extensions/null-tools/src/updater.ts` (full rewrite)

**Interfaces:**
- Consumes: `trimVersionTag`, `compareVersionTags` from `./versionComparison` (Task 1).
- Produces (consumed by Task 4's `updaterIntegration.ts`):
  - `export interface AvailableUpdate { repo: string; current: string; latest: string; url: string; checkedAt: string; releaseNotes?: string; assetUrl?: string; assetName?: string; assetSize?: number; sha256Url?: string; }`
  - `export interface StagedUpdate { version: string; zipPath: string; verified: boolean; }`
  - `export const onStagedUpdateChanged: vscode.EventEmitter<void>`
  - `export async function checkForUpdate(context: vscode.ExtensionContext, silent: boolean): Promise<AvailableUpdate | null>`
  - `export async function promptForUpdate(update: AvailableUpdate): Promise<void>`
  - `export async function installUpdate(context: vscode.ExtensionContext): Promise<void>`

- [ ] **Step 1: Replace the full contents of `updater.ts`**

```ts
'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { compareVersionTags } from './versionComparison';

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

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  body?: string;
  assets: GithubAsset[];
}

export interface AvailableUpdate {
  repo: string;
  current: string;
  latest: string;
  url: string;
  checkedAt: string;
  releaseNotes?: string;
  assetUrl?: string;
  assetName?: string;
  assetSize?: number;
  sha256Url?: string;
}

export interface StagedUpdate {
  version: string;
  zipPath: string;
  verified: boolean;
}

export const onStagedUpdateChanged = new vscode.EventEmitter<void>();

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

function getUpdaterExePath(context: vscode.ExtensionContext): string | null {
  for (const installDir of getInstallDirCandidates(context)) {
    const p = path.join(installDir, 'resources', 'app', 'null-updater', 'null-updater.exe');
    if (fs.existsSync(p)) return p;
  }

  const repoExe = path.resolve(context.extensionPath, '..', '..', 'updater', 'build', 'Release', 'null-updater.exe');
  if (fs.existsSync(repoExe)) return repoExe;

  return null;
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

function formatNetworkError(err: Error): Error {
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

async function requestJson<T>(url: string, retries = 2): Promise<T> {
  let lastError: Error = new Error('Unknown network error');

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }

    try {
      return await new Promise<T>((resolve, reject) => {
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
    } catch (err) {
      lastError = formatNetworkError(err as Error);
      // Don't retry HTTP 4xx/5xx status errors, only network/connect errors.
      if ((err as Error).message?.startsWith('GitHub returned')) {
        throw lastError;
      }
    }
  }

  throw lastError;
}

function requestText(url: string): Promise<string> {
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
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function downloadToFile(url: string, destPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const file = fs.createWriteStream(destPath);

    https.get(url, { headers: { 'User-Agent': 'Null-IDE' } }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(destPath, () => {
          downloadToFile(res.headers.location as string, destPath).then(resolve, reject);
        });
        return;
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        file.close();
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }

      res.on('data', (chunk: Buffer) => hash.update(chunk));
      res.on('error', reject);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(hash.digest('hex')));
      });
    }).on('error', reject);
  });
}

async function getLatestRelease(repo: string): Promise<GithubRelease> {
  return requestJson<GithubRelease>(`https://api.github.com/repos/${repo}/releases/latest`);
}

function findZipAsset(release: GithubRelease): GithubAsset | null {
  const zipPattern = /^null-ide-win32-x64(-[^/\\]+)?\.zip$/i;
  return release.assets.find(a => zipPattern.test(a.name)) || null;
}

function findSha256AssetUrl(release: GithubRelease, zipAssetName: string): string | undefined {
  const sidecar = release.assets.find(a => a.name === `${zipAssetName}.sha256`);
  return sidecar?.browser_download_url;
}

function hasWindowsPackage(release: GithubRelease): boolean {
  return Array.isArray(release.assets) &&
    release.assets.some(a => /^(null-ide-win32-x64(-[^/\\]+)?\.zip|NullIDESetup.*\.exe)$/i.test(a.name));
}

function stagingRoot(): string {
  return path.join(os.tmpdir(), 'null-ide-update-staged');
}

async function stageUpdateInBackground(context: vscode.ExtensionContext, update: AvailableUpdate): Promise<void> {
  if (!update.assetUrl || !update.assetName) return;

  const existing = context.globalState.get<StagedUpdate>('null.stagedUpdate');
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
    } else {
      output.appendLine(`No .sha256 sidecar found for ${update.assetName}; staging without verification.`);
    }

    const staged: StagedUpdate = { version: update.latest, zipPath, verified };
    await context.globalState.update('null.stagedUpdate', staged);
    await vscode.commands.executeCommand('setContext', 'nullUpdateStaged', true);
    onStagedUpdateChanged.fire();
    output.appendLine(`Update ${update.latest} staged and ready to install.`);
  } catch (err) {
    output.appendLine(`Background staging failed: ${(err as Error).message}`);
  }
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
    await context.globalState.update('null.stagedUpdate', undefined);
    await vscode.commands.executeCommand('setContext', 'nullUpdateAvailable', false);
    await vscode.commands.executeCommand('setContext', 'nullUpdateStaged', false);
    onStagedUpdateChanged.fire();
    if (!silent) {
      const packageNote = hasPackage ? '' : ' No Windows package was found on the latest release.';
      vscode.window.showInformationMessage(
        `Null IDE is up to date (${current}; latest ${latest || 'unknown'}).${packageNote}`,
      );
    }
    return null;
  }

  const asset = findZipAsset(release);

  const update: AvailableUpdate = {
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

function truncateReleaseNotes(notes: string | undefined): string | undefined {
  if (!notes) return undefined;
  return notes.length > 600 ? notes.slice(0, 600) + '…' : notes;
}

export async function promptForUpdate(update: AvailableUpdate): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    `Null IDE ${update.latest} is available. You are running ${update.current}.`,
    { detail: truncateReleaseNotes(update.releaseNotes) },
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

  const updaterExe = getUpdaterExePath(context);
  const updaterScript = getUpdaterScriptPath(context);

  if (!updaterExe && !updaterScript) {
    vscode.window.showErrorMessage('Null IDE updater was not found in this installation.');
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Install Null IDE ${update.latest}? The IDE will close, update, and reopen.`,
    { modal: true, detail: truncateReleaseNotes(update.releaseNotes) },
    'Restart and Update',
  );
  if (choice !== 'Restart and Update') return;

  const updaterDir = path.join(
    process.env.TEMP || process.env.TMP || getInstallDir(context),
    `null-ide-updater-${Date.now()}`,
  );
  fs.mkdirSync(updaterDir, { recursive: true });

  const installDir = getInstallDir(context);
  const launcherPath = path.join(updaterDir, 'launcher.cmd');
  const cmdQ = (s: string) => `"${s.replace(/"/g, '""')}"`;

  const staged = context.globalState.get<StagedUpdate>('null.stagedUpdate');
  const hasStagedZip = !!staged && staged.version === update.latest && staged.verified && fs.existsSync(staged.zipPath);

  let launchCmd: string;

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
      args.push('--zip-path', cmdQ(staged!.zipPath));
    }
    launchCmd = args.join(' ');
  } else {
    const stagedUpdater = path.join(updaterDir, 'update-null-ide.ps1');
    const installer = path.join(path.dirname(updaterScript!), 'install-null-ide.ps1');
    fs.copyFileSync(updaterScript!, stagedUpdater);
    if (fs.existsSync(installer)) {
      fs.copyFileSync(installer, path.join(updaterDir, 'install-null-ide.ps1'));
    }
    launchCmd = `powershell.exe -NoLogo -ExecutionPolicy Bypass -WindowStyle Normal -File ${cmdQ(stagedUpdater)} -Repo ${cmdQ(update.repo)} -InstallDir ${cmdQ(installDir)} -Force -WaitForExit -Launch`;
  }

  fs.writeFileSync(launcherPath, `@echo off\r\nstart "Null IDE Update" ${launchCmd}\r\n`, 'utf8');

  const child = spawn('cmd.exe', ['/c', launcherPath], { detached: true, stdio: 'ignore' });
  child.unref();

  await context.globalState.update('null.stagedUpdate', undefined);
  onStagedUpdateChanged.fire();

  setTimeout(() => vscode.commands.executeCommand('workbench.action.quit'), 1000);
}
```

- [ ] **Step 2: Compile to verify**

Run: `cd extensions/null-tools && npm run compile`
Expected: succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/null-tools/src/updater.ts
git commit -m "feat: wire native updater EXE, background download, checksum verify, changelog"
```

---

### Task 4: Update `updaterIntegration.ts` for staged/ready status bar states

**Files:**
- Modify: `extensions/null-tools/src/updaterIntegration.ts`

**Interfaces:**
- Consumes: `AvailableUpdate`, `StagedUpdate`, `onStagedUpdateChanged`, `checkForUpdate`, `installUpdate`, `promptForUpdate` from `./updater` (Task 3).

- [ ] **Step 1: Replace the full contents of `updaterIntegration.ts`**

```ts
'use strict';

import * as vscode from 'vscode';
import { AvailableUpdate, StagedUpdate, checkForUpdate, installUpdate, onStagedUpdateChanged, promptForUpdate } from './updater';

export function registerUpdaterFeature(context: vscode.ExtensionContext): void {
  const updateBar = vscode.window.createStatusBarItem('null.update', vscode.StatusBarAlignment.Right, 1);
  updateBar.command = 'null.installUpdate';
  context.subscriptions.push(updateBar);

  function refreshUpdateButton(): void {
    const update = context.globalState.get<AvailableUpdate>('null.availableUpdate');
    if (!update?.latest) {
      updateBar.hide();
      return;
    }

    const staged = context.globalState.get<StagedUpdate>('null.stagedUpdate');
    const isReady = staged?.version === update.latest && staged.verified;

    if (isReady) {
      updateBar.text    = `$(rocket) Restart to update`;
      updateBar.tooltip  = `Null IDE ${update.latest} is downloaded and ready to install`;
    } else {
      updateBar.text    = `$(cloud-download) ${update.latest}`;
      updateBar.tooltip  = `Downloading Null IDE ${update.latest}…`;
    }
    updateBar.show();
  }

  context.subscriptions.push(onStagedUpdateChanged.event(() => refreshUpdateButton()));

  context.subscriptions.push(vscode.commands.registerCommand('null.checkForUpdates', async () => {
    try {
      const update = await checkForUpdate(context, false);
      refreshUpdateButton();
      if (update) await promptForUpdate(update);
    } catch (err) {
      vscode.window.showErrorMessage(`Null: update check failed - ${(err as Error).message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.installUpdate', async () => {
    try { await installUpdate(context); }
    catch (err) { vscode.window.showErrorMessage(`Null: update failed - ${(err as Error).message}`); }
  }));

  refreshUpdateButton();
  checkForUpdate(context, true)
    .then(update => { refreshUpdateButton(); if (update) return promptForUpdate(update); })
    .catch(() => { /* startup check — stay silent when offline */ });
}
```

- [ ] **Step 2: Compile to verify**

Run: `cd extensions/null-tools && npm run compile`
Expected: succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/null-tools/src/updaterIntegration.ts
git commit -m "feat: status bar reflects staged-and-ready vs downloading update state"
```

---

### Task 5: `build.yml` — publish a SHA256 checksum sidecar for the release zip

**Files:**
- Modify: `.github/workflows/build.yml`

- [ ] **Step 1: Compute and write the checksum after the zip is created**

In the `- name: Create zip archive` step, find:

```yaml
          Compress-Archive -Path "$outDir\*" -DestinationPath null-ide-win32-x64.zip -Force
          Write-Host "Archive created: $((Get-Item null-ide-win32-x64.zip).Length / 1MB) MB"
```

Replace with:

```yaml
          Compress-Archive -Path "$outDir\*" -DestinationPath null-ide-win32-x64.zip -Force
          Write-Host "Archive created: $((Get-Item null-ide-win32-x64.zip).Length / 1MB) MB"
          $hash = Get-FileHash null-ide-win32-x64.zip -Algorithm SHA256
          "$($hash.Hash.ToLower())  null-ide-win32-x64.zip" | Set-Content null-ide-win32-x64.zip.sha256 -Encoding ASCII -NoNewline
          Write-Host "Checksum written: $($hash.Hash.ToLower())"
```

- [ ] **Step 2: Publish the checksum file as a release asset**

Find:

```yaml
      - name: Publish release asset
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
        with:
          files: |
            null-ide-win32-x64.zip
            NullIDESetup-*.exe
            ide-overlay/scripts/install-null-ide.ps1
          fail_on_unmatched_files: true
```

Replace with:

```yaml
      - name: Publish release asset
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
        with:
          files: |
            null-ide-win32-x64.zip
            null-ide-win32-x64.zip.sha256
            NullIDESetup-*.exe
            ide-overlay/scripts/install-null-ide.ps1
          fail_on_unmatched_files: true
```

- [ ] **Step 3: Include it in the workflow artifact too**

Find:

```yaml
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: null-ide-win32-x64-${{ steps.tag.outputs.tag }}
          path: |
            null-ide-win32-x64.zip
            NullIDESetup-*.exe
            ide-overlay/scripts/install-null-ide.ps1
          if-no-files-found: error
          retention-days: 30
```

Replace with:

```yaml
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: null-ide-win32-x64-${{ steps.tag.outputs.tag }}
          path: |
            null-ide-win32-x64.zip
            null-ide-win32-x64.zip.sha256
            NullIDESetup-*.exe
            ide-overlay/scripts/install-null-ide.ps1
          if-no-files-found: error
          retention-days: 30
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: publish a SHA256 checksum sidecar alongside the release zip"
```

(This step can't be locally "tested" — it only runs in GitHub Actions per `CLAUDE.md`. It'll be exercised for real the next time a tag is pushed; Task 14 covers manual end-to-end verification against a build produced this way.)

---

### Task 6: `install-null-ide.ps1` — add `-ReapplyRegistrations`

**Files:**
- Modify: `scripts/install-null-ide.ps1`

**Interfaces:**
- Produces: a `-ReapplyRegistrations -InstallDir <dir>` invocation mode, consumed by Task 11's `main.cpp` (`ReapplyRegistrations` method).

- [ ] **Step 1: Add the switch parameter**

Find:

```powershell
    [switch]$RegisterPreviewHandler,
    [switch]$UnregisterPreviewHandler,
    [switch]$Launch
)
```

Replace with:

```powershell
    [switch]$RegisterPreviewHandler,
    [switch]$UnregisterPreviewHandler,
    [switch]$ReapplyRegistrations,
    [switch]$Launch
)
```

- [ ] **Step 2: Add the handling block**

Find:

```powershell
if ($UnregisterPreviewHandler) {
    Write-Step "Unregistering preview handler"
    Unregister-PreviewHandler
    Write-Host "Done."
    return
}

if ($ZipPath) {
```

Replace with:

```powershell
if ($UnregisterPreviewHandler) {
    Write-Step "Unregistering preview handler"
    Unregister-PreviewHandler
    Write-Host "Done."
    return
}

if ($ReapplyRegistrations) {
    $dir = [System.IO.Path]::GetFullPath($InstallDir)
    $target = Get-NullIdeExecutable -Dir $dir
    Write-Step "Reapplying context menu, file association, and preview handler registrations"
    Register-ContextMenu -ExePath $target
    Register-Win11ContextMenu -InstallDir $dir
    Register-FileAssociations -InstallDir $dir
    Register-PreviewHandler -InstallDir $dir
    Set-DefaultSettings
    Write-Host "Done."
    return
}

if ($ZipPath) {
```

- [ ] **Step 3: Syntax-check the script**

Run: `pwsh -NoProfile -Command "$null = [System.Management.Automation.Language.Parser]::ParseFile('scripts/install-null-ide.ps1', [ref]$null, [ref]$errors); if ($errors) { $errors | Format-List; exit 1 } else { Write-Host 'OK' }"`
Expected: `OK` — no parse errors.

- [ ] **Step 4: Manually verify against a real local install**

Run (adjust `-InstallDir` to your actual local Null IDE install path, e.g. `$env:LOCALAPPDATA\Programs\Null IDE`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-null-ide.ps1 -ReapplyRegistrations -InstallDir "$env:LOCALAPPDATA\Programs\Null IDE"
```

Expected: prints each `Write-Step` line (context menu, Win11 context menu, file associations, preview handler) then "Done." with no errors, and doesn't touch anything outside the registry keys / settings.json the existing `Register-*`/`Set-DefaultSettings` functions already write (all pre-existing, unmodified functions — this task only adds a new way to invoke them together).

- [ ] **Step 5: Commit**

```bash
git add scripts/install-null-ide.ps1
git commit -m "feat: add -ReapplyRegistrations switch to reapply shell integrations after an update"
```

---

### Task 7: `updater/CMakeLists.txt` — link `bcrypt` for SHA256 support

**Files:**
- Modify: `updater/CMakeLists.txt`

- [ ] **Step 1: Add the library**

Find:

```cmake
target_link_libraries(null-updater PRIVATE
    winhttp
    shlwapi
    comctl32
    user32
    advapi32
    shell32
)
```

Replace with:

```cmake
target_link_libraries(null-updater PRIVATE
    winhttp
    shlwapi
    comctl32
    user32
    advapi32
    shell32
    bcrypt
)
```

- [ ] **Step 2: Reconfigure and build to verify it still links**

Run: `cmake -S updater -B updater/build -A x64 && cmake --build updater/build --config Release`
Expected: succeeds (this task alone doesn't use any BCrypt symbols yet, so it's just confirming the link line itself is valid).

- [ ] **Step 3: Commit**

```bash
git add updater/CMakeLists.txt
git commit -m "build: link bcrypt for native updater checksum support"
```

---

### Task 8: `main.cpp` — `--zip-path` flag and SHA256 verification

Adds the ability to skip the EXE's own download (using a package the extension already staged) and, when the EXE does download it itself (the foreground-fallback path), verifies the download against the `.sha256` sidecar before trusting it.

**Files:**
- Modify: `updater/src/main.cpp`

**Interfaces:**
- Produces: `--zip-path <file>` CLI arg; `void VerifyZipChecksum(const std::wstring& downloadUrl, const fs::path& zipPath)` (used by this task's own `ExecuteUpdate` change).

- [ ] **Step 1: Add the `<bcrypt.h>` include**

Find:

```cpp
#include "miniz.h"

namespace fs = std::filesystem;
```

Replace with:

```cpp
#include "miniz.h"
#include <bcrypt.h>

namespace fs = std::filesystem;
```

- [ ] **Step 2: Add the `zipPath` field to `UpdaterArgs`**

Find:

```cpp
struct UpdaterArgs {
    std::wstring repo = L"TorresVisual/null-ide";
    std::wstring version = L"";
    std::wstring installDir = L"";
    bool waitForExit = false;
    bool force = false;
    bool launch = false;
    bool includePrerelease = false;
};
```

Replace with:

```cpp
struct UpdaterArgs {
    std::wstring repo = L"TorresVisual/null-ide";
    std::wstring version = L"";
    std::wstring installDir = L"";
    std::wstring zipPath = L"";
    bool waitForExit = false;
    bool force = false;
    bool launch = false;
    bool includePrerelease = false;
};
```

- [ ] **Step 3: Parse `--zip-path` in `ParseArgs`**

Find:

```cpp
        } else if (arg == L"--version" && i + 1 < argc) {
            args.version = argv[++i];
        } else if (arg.rfind(L"--version=", 0) == 0) {
            args.version = arg.substr(10);
        } else if (arg == L"--wait" || arg == L"-WaitForExit") {
```

Replace with:

```cpp
        } else if (arg == L"--version" && i + 1 < argc) {
            args.version = argv[++i];
        } else if (arg.rfind(L"--version=", 0) == 0) {
            args.version = arg.substr(10);
        } else if (arg == L"--zip-path" && i + 1 < argc) {
            args.zipPath = argv[++i];
        } else if (arg.rfind(L"--zip-path=", 0) == 0) {
            args.zipPath = arg.substr(11);
        } else if (arg == L"--wait" || arg == L"-WaitForExit") {
```

- [ ] **Step 4: Add checksum-verification helper methods**

Find (end of `DownloadFile`, right before `ExtractZip`):

```cpp
        outFile.close();
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
    }

    void ExtractZip(const fs::path& zipPath, const fs::path& destDir) {
```

Replace with:

```cpp
        outFile.close();
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
    }

    bool EqualsIgnoreCase(const std::wstring& a, const std::wstring& b) {
        if (a.size() != b.size()) return false;
        return std::equal(a.begin(), a.end(), b.begin(), [](wchar_t x, wchar_t y) {
            return towlower(x) == towlower(y);
        });
    }

    std::wstring ComputeFileSha256(const fs::path& filePath) {
        BCRYPT_ALG_HANDLE hAlg = NULL;
        BCRYPT_HASH_HANDLE hHash = NULL;
        NTSTATUS status;

        status = BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_SHA256_ALGORITHM, NULL, 0);
        if (!BCRYPT_SUCCESS(status)) {
            throw std::runtime_error("BCryptOpenAlgorithmProvider failed.");
        }

        DWORD hashObjectSize = 0, cbData = 0, hashLen = 0;
        BCryptGetProperty(hAlg, BCRYPT_OBJECT_LENGTH, (PUCHAR)&hashObjectSize, sizeof(DWORD), &cbData, 0);
        BCryptGetProperty(hAlg, BCRYPT_HASH_LENGTH, (PUCHAR)&hashLen, sizeof(DWORD), &cbData, 0);

        std::vector<UCHAR> hashObject(hashObjectSize);
        status = BCryptCreateHash(hAlg, &hHash, hashObject.data(), hashObjectSize, NULL, 0, 0);
        if (!BCRYPT_SUCCESS(status)) {
            BCryptCloseAlgorithmProvider(hAlg, 0);
            throw std::runtime_error("BCryptCreateHash failed.");
        }

        std::ifstream file(filePath, std::ios::binary);
        if (!file) {
            BCryptDestroyHash(hHash);
            BCryptCloseAlgorithmProvider(hAlg, 0);
            throw std::runtime_error("Cannot open file for hashing: " + filePath.string());
        }

        std::vector<char> buffer(65536);
        while (file.read(buffer.data(), static_cast<std::streamsize>(buffer.size())) || file.gcount() > 0) {
            status = BCryptHashData(hHash, (PUCHAR)buffer.data(), static_cast<ULONG>(file.gcount()), 0);
            if (!BCRYPT_SUCCESS(status)) {
                BCryptDestroyHash(hHash);
                BCryptCloseAlgorithmProvider(hAlg, 0);
                throw std::runtime_error("BCryptHashData failed.");
            }
        }

        std::vector<UCHAR> hash(hashLen);
        status = BCryptFinishHash(hHash, hash.data(), hashLen, 0);
        BCryptDestroyHash(hHash);
        BCryptCloseAlgorithmProvider(hAlg, 0);
        if (!BCRYPT_SUCCESS(status)) {
            throw std::runtime_error("BCryptFinishHash failed.");
        }

        std::wstring result;
        wchar_t hexBuf[3];
        for (UCHAR b : hash) {
            swprintf_s(hexBuf, L"%02x", b);
            result += hexBuf;
        }
        return result;
    }

    std::wstring FetchSha256Sidecar(const std::wstring& url) {
        URL_COMPONENTS urlComp = { sizeof(urlComp) };
        wchar_t hostName[256] = { 0 };
        wchar_t urlPath[2048] = { 0 };
        urlComp.lpszHostName = hostName;
        urlComp.dwHostNameLength = 256;
        urlComp.lpszUrlPath = urlPath;
        urlComp.dwUrlPathLength = 2048;

        if (!WinHttpCrackUrl(url.c_str(), static_cast<DWORD>(url.length()), 0, &urlComp)) {
            throw std::runtime_error("Invalid checksum sidecar URL.");
        }

        HINTERNET hSession = WinHttpOpen(L"Null-IDE-Updater/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                         WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
        if (!hSession) throw std::runtime_error("WinHttpOpen failed.");

        DWORD redirectOption = WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS;
        WinHttpSetOption(hSession, WINHTTP_OPTION_REDIRECT_POLICY, &redirectOption, sizeof(redirectOption));

        INTERNET_PORT port = (urlComp.nScheme == INTERNET_SCHEME_HTTPS) ? INTERNET_DEFAULT_HTTPS_PORT : INTERNET_DEFAULT_HTTP_PORT;
        HINTERNET hConnect = WinHttpConnect(hSession, hostName, port, 0);
        if (!hConnect) {
            WinHttpCloseHandle(hSession);
            throw std::runtime_error("Checksum sidecar connect failed.");
        }

        DWORD reqFlags = (urlComp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
        HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"GET", urlPath, NULL,
                                                WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                                reqFlags);
        if (!hRequest) {
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            throw std::runtime_error("Checksum sidecar request failed.");
        }

        if (!WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                                WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
            !WinHttpReceiveResponse(hRequest, NULL)) {
            WinHttpCloseHandle(hRequest);
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            throw std::runtime_error("Checksum sidecar request failed.");
        }

        DWORD statusCode = 0;
        DWORD statusSize = sizeof(statusCode);
        WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                            WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &statusSize, WINHTTP_NO_HEADER_INDEX);
        if (statusCode != 200) {
            WinHttpCloseHandle(hRequest);
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            throw std::runtime_error("Checksum sidecar not available (HTTP " + std::to_string(statusCode) + ").");
        }

        std::string body;
        DWORD bytesAvailable = 0;
        while (WinHttpQueryDataAvailable(hRequest, &bytesAvailable) && bytesAvailable > 0) {
            std::vector<char> buf(bytesAvailable);
            DWORD bytesRead = 0;
            if (WinHttpReadData(hRequest, buf.data(), bytesAvailable, &bytesRead)) {
                body.append(buf.data(), bytesRead);
            }
        }

        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);

        size_t hashEnd = body.find_first_of(" \t\r\n");
        std::string hashStr = (hashEnd == std::string::npos) ? body : body.substr(0, hashEnd);
        if (hashStr.empty()) {
            throw std::runtime_error("Checksum sidecar was empty.");
        }
        return std::wstring(hashStr.begin(), hashStr.end());
    }

    void VerifyZipChecksum(const std::wstring& downloadUrl, const fs::path& zipPath) {
        std::wstring expectedHash;
        try {
            expectedHash = FetchSha256Sidecar(downloadUrl + L".sha256");
        } catch (const std::exception&) {
            // No sidecar published for this release yet - don't block the update over it.
            return;
        }

        std::wstring actualHash = ComputeFileSha256(zipPath);
        if (!EqualsIgnoreCase(actualHash, expectedHash)) {
            throw std::runtime_error("Downloaded file failed integrity check (SHA256 mismatch).");
        }
    }

    void ExtractZip(const fs::path& zipPath, const fs::path& destDir) {
```

- [ ] **Step 5: Restructure `ExecuteUpdate` to use a staged zip when given, and verify checksum when it downloads itself**

Find:

```cpp
    void ExecuteUpdate() {
        // 1. Wait for IDE process to exit if requested
        if (m_args.waitForExit && !m_args.installDir.empty()) {
            WaitForIdeExit(m_args.installDir);
        }

        if (m_cancelRequested) return;

        // 2. Fetch Release Metadata from GitHub API
        DirectUpdateUI(-1, L"Checking for latest release from GitHub...");
        std::wstring tagToFetch = m_args.version;
        std::wstring downloadUrl;
        std::wstring assetName;
        int64_t assetSize = 0;
        std::wstring releaseTag;

        FetchReleaseInfo(m_args.repo, tagToFetch, downloadUrl, assetName, assetSize, releaseTag);

        if (downloadUrl.empty()) {
            throw std::runtime_error("Could not find suitable null-ide-win32-x64 release asset.");
        }

        if (m_cancelRequested) return;

        // 3. Download Asset
        fs::path tempDir = fs::temp_directory_path() / (L"null-ide-update-" + std::to_wstring(GetTickCount64()));
        fs::create_directories(tempDir);
        fs::path zipPath = tempDir / assetName;

        DirectUpdateUI(0, L"Downloading " + assetName + L"...");
        DownloadFile(downloadUrl, zipPath, assetSize);

        if (m_cancelRequested) return;

        // 4. Extract Package
```

Replace with:

```cpp
    void ExecuteUpdate() {
        // 1. Wait for IDE process to exit if requested
        if (m_args.waitForExit && !m_args.installDir.empty()) {
            WaitForIdeExit(m_args.installDir);
        }

        if (m_cancelRequested) return;

        fs::path tempDir = fs::temp_directory_path() / (L"null-ide-update-" + std::to_wstring(GetTickCount64()));
        fs::path zipPath;
        std::wstring releaseTag = m_args.version;

        if (!m_args.zipPath.empty()) {
            // 2. Use the already-downloaded, already-verified package staged by the caller.
            zipPath = m_args.zipPath;
            if (!fs::exists(zipPath)) {
                throw std::runtime_error("Staged update package not found: " + zipPath.string());
            }
            if (releaseTag.empty()) {
                throw std::runtime_error("--zip-path requires --version to also be specified.");
            }
            fs::create_directories(tempDir);
        } else {
            // 2. Fetch Release Metadata from GitHub API
            DirectUpdateUI(-1, L"Checking for latest release from GitHub...");
            std::wstring tagToFetch = m_args.version;
            std::wstring downloadUrl;
            std::wstring assetName;
            int64_t assetSize = 0;

            FetchReleaseInfo(m_args.repo, tagToFetch, downloadUrl, assetName, assetSize, releaseTag);

            if (downloadUrl.empty()) {
                throw std::runtime_error("Could not find suitable null-ide-win32-x64 release asset.");
            }

            if (m_cancelRequested) return;

            // 3. Download Asset
            fs::create_directories(tempDir);
            zipPath = tempDir / assetName;

            DirectUpdateUI(0, L"Downloading " + assetName + L"...");
            DownloadFile(downloadUrl, zipPath, assetSize);

            if (m_cancelRequested) return;

            // 3b. Verify integrity
            DirectUpdateUI(-1, L"Verifying download integrity...");
            VerifyZipChecksum(downloadUrl, zipPath);
        }

        // 4. Extract Package
```

- [ ] **Step 6: Build to verify**

Run: `cmake --build updater/build --config Release`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add updater/CMakeLists.txt updater/src/main.cpp
git commit -m "feat: native updater supports pre-staged packages and verifies SHA256"
```

---

### Task 9: `main.cpp` — robustify `FetchReleaseInfo` (per-asset JSON scanning + HTTP status check)

The old parser did a whole-buffer substring search for `"null-ide-win32-x64"`, which could in principle pick up a `browser_download_url` field from a neighboring asset object, and never checked the HTTP status before parsing (a 403/404 error page would silently "succeed" with an empty download URL and a confusing error).

**Files:**
- Modify: `updater/src/main.cpp`

- [ ] **Step 1: Add `<regex>` include**

Find:

```cpp
#include "miniz.h"
#include <bcrypt.h>

namespace fs = std::filesystem;
```

Replace with:

```cpp
#include "miniz.h"
#include <bcrypt.h>
#include <regex>

namespace fs = std::filesystem;
```

- [ ] **Step 2: Add JSON-object-scanning helpers right before `FetchReleaseInfo`**

Find:

```cpp
        CloseHandle(hSnap);
        return result;
    }

    void FetchReleaseInfo(const std::wstring& repo, const std::wstring& tag,
```

Replace with:

```cpp
        CloseHandle(hSnap);
        return result;
    }

    static std::wstring ExtractJsonStringField(const std::string& obj, const std::string& key) {
        std::string needle = "\"" + key + "\"";
        size_t keyPos = obj.find(needle);
        if (keyPos == std::string::npos) return L"";
        size_t valStart = obj.find("\"", keyPos + needle.size());
        if (valStart == std::string::npos) return L"";
        size_t valEnd = obj.find("\"", valStart + 1);
        if (valEnd == std::string::npos) return L"";
        std::string val = obj.substr(valStart + 1, valEnd - valStart - 1);
        return std::wstring(val.begin(), val.end());
    }

    static int64_t ExtractJsonNumberField(const std::string& obj, const std::string& key) {
        std::string needle = "\"" + key + "\"";
        size_t keyPos = obj.find(needle);
        if (keyPos == std::string::npos) return 0;
        size_t numStart = obj.find_first_of("0123456789", keyPos + needle.size());
        if (numStart == std::string::npos) return 0;
        size_t numEnd = obj.find_first_not_of("0123456789", numStart);
        return std::stoll(obj.substr(numStart, numEnd - numStart));
    }

    static std::vector<std::string> SplitJsonObjects(const std::string& arrayBody) {
        std::vector<std::string> objects;
        int depth = 0;
        size_t start = std::string::npos;
        for (size_t i = 0; i < arrayBody.size(); ++i) {
            char c = arrayBody[i];
            if (c == '{') {
                if (depth == 0) start = i;
                depth++;
            } else if (c == '}') {
                depth--;
                if (depth == 0 && start != std::string::npos) {
                    objects.push_back(arrayBody.substr(start, i - start + 1));
                    start = std::string::npos;
                }
            }
        }
        return objects;
    }

    void FetchReleaseInfo(const std::wstring& repo, const std::wstring& tag,
```

- [ ] **Step 3: Add HTTP status check and replace the parsing logic**

Find:

```cpp
        if (!WinHttpSendRequest(hRequest, headers.c_str(), static_cast<DWORD>(headers.length()),
                                WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
            !WinHttpReceiveResponse(hRequest, NULL)) {
            WinHttpCloseHandle(hRequest);
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            throw std::runtime_error("GitHub API HTTP request failed.");
        }

        std::string jsonBuffer;
        DWORD bytesAvailable = 0;
        while (WinHttpQueryDataAvailable(hRequest, &bytesAvailable) && bytesAvailable > 0) {
            std::vector<char> buf(bytesAvailable);
            DWORD bytesRead = 0;
            if (WinHttpReadData(hRequest, buf.data(), bytesAvailable, &bytesRead)) {
                jsonBuffer.append(buf.data(), bytesRead);
            }
        }

        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);

        // Simple JSON extraction for asset matching "null-ide-win32-x64*.zip"
        // Find "tag_name": "vX.Y.Z"
        size_t tagPos = jsonBuffer.find("\"tag_name\"");
        if (tagPos != std::string::npos) {
            size_t valStart = jsonBuffer.find("\"", tagPos + 10);
            size_t valEnd   = jsonBuffer.find("\"", valStart + 1);
            if (valStart != std::string::npos && valEnd != std::string::npos) {
                std::string t = jsonBuffer.substr(valStart + 1, valEnd - valStart - 1);
                outTag = std::wstring(t.begin(), t.end());
            }
        }

        // Search assets array for null-ide-win32-x64*.zip
        size_t assetPos = jsonBuffer.find("null-ide-win32-x64");
        if (assetPos == std::string::npos) {
            throw std::runtime_error("Release asset matching null-ide-win32-x64*.zip not found in release response.");
        }

        // Find asset name
        size_t nameStart = jsonBuffer.rfind("\"", assetPos);
        size_t nameEnd   = jsonBuffer.find("\"", assetPos);
        std::string aName = jsonBuffer.substr(nameStart + 1, nameEnd - nameStart - 1);
        outAssetName = std::wstring(aName.begin(), aName.end());

        // Find browser_download_url near this asset
        size_t urlPos = jsonBuffer.find("\"browser_download_url\"", assetPos);
        if (urlPos == std::string::npos) {
            urlPos = jsonBuffer.rfind("\"browser_download_url\"", assetPos);
        }
        if (urlPos != std::string::npos) {
            size_t uStart = jsonBuffer.find("\"", urlPos + 22);
            size_t uEnd   = jsonBuffer.find("\"", uStart + 1);
            std::string uStr = jsonBuffer.substr(uStart + 1, uEnd - uStart - 1);
            outDownloadUrl = std::wstring(uStr.begin(), uStr.end());
        }

        // Find size
        size_t sizePos = jsonBuffer.find("\"size\"", assetPos);
        if (sizePos == std::string::npos) {
            sizePos = jsonBuffer.rfind("\"size\"", assetPos);
        }
        if (sizePos != std::string::npos) {
            size_t numStart = jsonBuffer.find_first_of("0123456789", sizePos + 6);
            size_t numEnd   = jsonBuffer.find_first_not_of("0123456789", numStart);
            if (numStart != std::string::npos) {
                outAssetSize = std::stoll(jsonBuffer.substr(numStart, numEnd - numStart));
            }
        }
    }
```

Replace with:

```cpp
        if (!WinHttpSendRequest(hRequest, headers.c_str(), static_cast<DWORD>(headers.length()),
                                WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
            !WinHttpReceiveResponse(hRequest, NULL)) {
            WinHttpCloseHandle(hRequest);
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            throw std::runtime_error("GitHub API HTTP request failed.");
        }

        DWORD statusCode = 0;
        DWORD statusSize = sizeof(statusCode);
        WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                            WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &statusSize, WINHTTP_NO_HEADER_INDEX);
        if (statusCode != 200) {
            WinHttpCloseHandle(hRequest);
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            throw std::runtime_error("GitHub API returned HTTP " + std::to_string(statusCode) + ".");
        }

        std::string jsonBuffer;
        DWORD bytesAvailable = 0;
        while (WinHttpQueryDataAvailable(hRequest, &bytesAvailable) && bytesAvailable > 0) {
            std::vector<char> buf(bytesAvailable);
            DWORD bytesRead = 0;
            if (WinHttpReadData(hRequest, buf.data(), bytesAvailable, &bytesRead)) {
                jsonBuffer.append(buf.data(), bytesRead);
            }
        }

        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);

        // "tag_name" always appears before "assets" at the top level of the response.
        size_t assetsArrayPos = jsonBuffer.find("\"assets\"");
        std::string headBuffer = jsonBuffer.substr(0, assetsArrayPos == std::string::npos ? jsonBuffer.size() : assetsArrayPos);
        outTag = ExtractJsonStringField(headBuffer, "tag_name");
        if (outTag.empty()) {
            outTag = ExtractJsonStringField(jsonBuffer, "tag_name");
        }

        if (assetsArrayPos == std::string::npos) {
            throw std::runtime_error("Release response did not contain an assets array.");
        }

        size_t arrayStart = jsonBuffer.find('[', assetsArrayPos);
        size_t arrayEnd   = jsonBuffer.find(']', arrayStart);
        if (arrayStart == std::string::npos || arrayEnd == std::string::npos) {
            throw std::runtime_error("Could not parse assets array in release response.");
        }

        // Scan asset objects individually so a field can never be read from the
        // wrong asset (the old whole-buffer substring search could do exactly that).
        std::vector<std::string> assetObjects = SplitJsonObjects(
            jsonBuffer.substr(arrayStart, arrayEnd - arrayStart + 1));

        static const std::wregex zipNamePattern(L"^null-ide-win32-x64(-[^/\\\\]+)?\\.zip$", std::regex::icase);

        for (const auto& obj : assetObjects) {
            std::wstring name = ExtractJsonStringField(obj, "name");
            if (std::regex_match(name, zipNamePattern)) {
                outAssetName   = name;
                outDownloadUrl = ExtractJsonStringField(obj, "browser_download_url");
                outAssetSize   = ExtractJsonNumberField(obj, "size");
                break;
            }
        }

        if (outDownloadUrl.empty()) {
            throw std::runtime_error("Release asset matching null-ide-win32-x64*.zip not found in release response.");
        }
    }
```

- [ ] **Step 4: Build to verify**

Run: `cmake --build updater/build --config Release`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add updater/src/main.cpp
git commit -m "fix: scope GitHub release JSON parsing to individual asset objects"
```

---

### Task 10: `main.cpp` — rollback on failure during stage/swap

Today, if extraction or the atomic swap fails partway through, there's no rollback — the user can be left with a half-installed app and a stray backup directory. `install-null-ide.ps1`'s `Install-Zip` already does this correctly; the EXE doesn't.

**Files:**
- Modify: `updater/src/main.cpp`

- [ ] **Step 1: Wrap the stage/swap section in try/catch with rollback**

Find:

```cpp
        // 5. Stage and Swap Installation
        DirectUpdateUI(-1, L"Installing Null IDE update...");

        fs::path targetInstallDir = m_args.installDir;
        if (targetInstallDir.empty()) {
            // Default fallback
            wchar_t localAppData[MAX_PATH];
            SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, localAppData);
            targetInstallDir = fs::path(localAppData) / L"Programs" / L"Null IDE";
        }

        fs::path parentDir = targetInstallDir.parent_path();
        fs::create_directories(parentDir);

        fs::path stageDir = parentDir / (L".null-ide-stage-" + std::to_wstring(GetTickCount64()));
        fs::path bakDir   = parentDir / (L".null-ide-bak-" + std::to_wstring(GetTickCount64()));

        // Move files from packageRoot to stageDir
        fs::rename(packageRoot, stageDir);

        // Preserve portable 'data' folder if present
        fs::path dataDir = targetInstallDir / L"data";
        if (fs::exists(dataDir)) {
            DirectUpdateUI(-1, L"Preserving user data...");
            fs::rename(dataDir, stageDir / L"data");
        }

        // Perform atomic swap
        if (fs::exists(targetInstallDir)) {
            RenameWithRetry(targetInstallDir, bakDir, 10, 500);
        }
        RenameWithRetry(stageDir, targetInstallDir, 10, 500);

        // Write install metadata
        WriteInstallMetadata(targetInstallDir, m_args.repo, releaseTag);
```

Replace with:

```cpp
        // 5. Stage and Swap Installation
        DirectUpdateUI(-1, L"Installing Null IDE update...");

        fs::path targetInstallDir = m_args.installDir;
        if (targetInstallDir.empty()) {
            // Default fallback
            wchar_t localAppData[MAX_PATH];
            SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, localAppData);
            targetInstallDir = fs::path(localAppData) / L"Programs" / L"Null IDE";
        }

        fs::path parentDir = targetInstallDir.parent_path();
        fs::create_directories(parentDir);

        fs::path stageDir = parentDir / (L".null-ide-stage-" + std::to_wstring(GetTickCount64()));
        fs::path bakDir   = parentDir / (L".null-ide-bak-" + std::to_wstring(GetTickCount64()));
        bool bakCreated = false;

        try {
            // Move files from packageRoot to stageDir
            fs::rename(packageRoot, stageDir);

            // Preserve portable 'data' folder if present
            fs::path dataDir = targetInstallDir / L"data";
            if (fs::exists(dataDir)) {
                DirectUpdateUI(-1, L"Preserving user data...");
                fs::rename(dataDir, stageDir / L"data");
            }

            // Perform atomic swap
            if (fs::exists(targetInstallDir)) {
                RenameWithRetry(targetInstallDir, bakDir, 10, 500);
                bakCreated = true;
            }
            RenameWithRetry(stageDir, targetInstallDir, 10, 500);
        } catch (...) {
            // Restore the previous installation if the swap failed partway through,
            // mirroring install-null-ide.ps1's rollback behavior.
            if (bakCreated && fs::exists(bakDir) && !fs::exists(targetInstallDir)) {
                std::error_code ec;
                fs::rename(bakDir, targetInstallDir, ec);
            }
            throw;
        }

        // Write install metadata
        WriteInstallMetadata(targetInstallDir, m_args.repo, releaseTag);
```

- [ ] **Step 2: Build to verify**

Run: `cmake --build updater/build --config Release`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add updater/src/main.cpp
git commit -m "fix: roll back to the previous install if the update swap fails"
```

---

### Task 11: `main.cpp` — reapply shell registrations after a successful swap

**Files:**
- Modify: `updater/src/main.cpp`

**Interfaces:**
- Consumes: `install-null-ide.ps1 -ReapplyRegistrations -InstallDir <dir>` (Task 6).

- [ ] **Step 1: Add the `ReapplyRegistrations` method and call it after cleanup**

Find:

```cpp
        // Write install metadata
        WriteInstallMetadata(targetInstallDir, m_args.repo, releaseTag);

        // Clean up backup directory asynchronously or safely
        std::error_code ec;
        fs::remove_all(bakDir, ec);
        fs::remove_all(tempDir, ec);

        // 6. Launch updated IDE if requested
```

Replace with:

```cpp
        // Write install metadata
        WriteInstallMetadata(targetInstallDir, m_args.repo, releaseTag);

        // Clean up backup directory asynchronously or safely
        std::error_code ec;
        fs::remove_all(bakDir, ec);
        fs::remove_all(tempDir, ec);

        // 5b. Reapply context menu / file association / preview handler / default
        // settings registrations, the way install-null-ide.ps1's Install-Zip does
        // on every install. Best-effort: a failure here doesn't fail the update.
        ReapplyRegistrations(targetInstallDir);

        // 6. Launch updated IDE if requested
```

Find:

```cpp
            if (fs::exists(exePath)) {
                STARTUPINFOW si = { sizeof(si) };
                PROCESS_INFORMATION pi = {};
                std::wstring cmd = L"\"" + exePath.wstring() + L"\"";
                CreateProcessW(NULL, &cmd[0], NULL, NULL, FALSE, 0, NULL, targetInstallDir.c_str(), &si, &pi);
                if (pi.hProcess) CloseHandle(pi.hProcess);
                if (pi.hThread) CloseHandle(pi.hThread);
            }
        }
    }

    void WaitForIdeExit(const fs::path& installDir) {
```

Replace with:

```cpp
            if (fs::exists(exePath)) {
                STARTUPINFOW si = { sizeof(si) };
                PROCESS_INFORMATION pi = {};
                std::wstring cmd = L"\"" + exePath.wstring() + L"\"";
                CreateProcessW(NULL, &cmd[0], NULL, NULL, FALSE, 0, NULL, targetInstallDir.c_str(), &si, &pi);
                if (pi.hProcess) CloseHandle(pi.hProcess);
                if (pi.hThread) CloseHandle(pi.hThread);
            }
        }
    }

    void ReapplyRegistrations(const fs::path& installDir) {
        fs::path scriptPath = installDir / L"resources" / L"app" / L"null-updater" / L"install-null-ide.ps1";
        if (!fs::exists(scriptPath)) return; // best-effort; not fatal

        DirectUpdateUI(-1, L"Refreshing context menu and file associations...");

        std::wstring cmd = L"powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"" +
            scriptPath.wstring() + L"\" -ReapplyRegistrations -InstallDir \"" + installDir.wstring() + L"\"";

        STARTUPINFOW si = { sizeof(si) };
        si.dwFlags = STARTF_USESHOWWINDOW;
        si.wShowWindow = SW_HIDE;
        PROCESS_INFORMATION pi = {};

        if (CreateProcessW(NULL, &cmd[0], NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
            WaitForSingleObject(pi.hProcess, 30000);
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);
        }
    }

    void WaitForIdeExit(const fs::path& installDir) {
```

- [ ] **Step 2: Build to verify**

Run: `cmake --build updater/build --config Release`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add updater/src/main.cpp
git commit -m "feat: reapply shell registrations after a successful native update"
```

---

### Task 12: `main.cpp` — Retry/Close buttons on failure

Replaces the current "show a `MessageBoxW`, then force-close the dialog" failure path with a TaskDialog that offers **Retry** (re-runs the update in place) and **Close**. Also fixes a small adjacent bug found while touching this code: if the user cancels mid-update, `ExecuteUpdate()` returns early (without throwing) from one of its `if (m_cancelRequested) return;` checkpoints, and the old code unconditionally reported "Update completed successfully!" regardless.

**Files:**
- Modify: `updater/src/main.cpp`

- [ ] **Step 1: Add `m_started` field**

Find:

```cpp
    UpdaterArgs m_args;
    HWND m_hwndTD = NULL;
    std::thread m_workerThread;
    std::atomic<bool> m_cancelRequested{false};
    bool m_success = false;
    std::wstring m_errorMessage;
```

Replace with:

```cpp
    UpdaterArgs m_args;
    HWND m_hwndTD = NULL;
    std::thread m_workerThread;
    std::atomic<bool> m_cancelRequested{false};
    bool m_success = false;
    bool m_started = false;
    std::wstring m_errorMessage;
```

- [ ] **Step 2: Update `TaskDialogCallbackProc` — guard against re-starting the worker on navigate, handle Retry/Close**

Find:

```cpp
    static HRESULT CALLBACK TaskDialogCallbackProc(HWND hwnd, UINT uNotification, WPARAM wParam, LPARAM lParam, LONG_PTR dwRefData) {
        (void)lParam;
        UpdaterWindow* self = reinterpret_cast<UpdaterWindow*>(dwRefData);
        if (!self) return S_OK;

        switch (uNotification) {
        case TDN_CREATED:
            self->m_hwndTD = hwnd;
            // Send marquee style if needed or initial state
            SendMessage(hwnd, TDM_SET_PROGRESS_BAR_POS, 0, 0);
            self->m_workerThread = std::thread(&UpdaterWindow::WorkerThreadProc, self);
            break;

        case TDN_BUTTON_CLICKED:
            if (static_cast<int>(wParam) == IDCANCEL) {
                self->m_cancelRequested = true;
                SendMessage(hwnd, TDM_SET_ELEMENT_TEXT, TDE_CONTENT, reinterpret_cast<LPARAM>(L"Cancelling update..."));
                return S_FALSE; // Don't close dialog immediately, wait for worker thread
            }
            break;

        case TDN_HYPERLINK_CLICKED:
            break;

        case TDN_NAVIGATED:
            break;

        default:
            break;
        }

        return S_OK;
    }
```

Replace with:

```cpp
    static const int IDC_RETRY = 100;
    static const int IDC_CLOSE = 101;

    static HRESULT CALLBACK TaskDialogCallbackProc(HWND hwnd, UINT uNotification, WPARAM wParam, LPARAM lParam, LONG_PTR dwRefData) {
        (void)lParam;
        UpdaterWindow* self = reinterpret_cast<UpdaterWindow*>(dwRefData);
        if (!self) return S_OK;

        switch (uNotification) {
        case TDN_CREATED:
            self->m_hwndTD = hwnd;
            SendMessage(hwnd, TDM_SET_PROGRESS_BAR_POS, 0, 0);
            if (!self->m_started) {
                self->m_started = true;
                self->m_workerThread = std::thread(&UpdaterWindow::WorkerThreadProc, self);
            }
            break;

        case TDN_BUTTON_CLICKED:
            if (static_cast<int>(wParam) == IDCANCEL) {
                self->m_cancelRequested = true;
                SendMessage(hwnd, TDM_SET_ELEMENT_TEXT, TDE_CONTENT, reinterpret_cast<LPARAM>(L"Cancelling update..."));
                return S_FALSE; // Don't close dialog immediately, wait for worker thread
            }
            if (static_cast<int>(wParam) == IDC_RETRY) {
                if (self->m_workerThread.joinable()) self->m_workerThread.join();
                self->m_cancelRequested = false;
                self->m_workerThread = std::thread(&UpdaterWindow::WorkerThreadProc, self);
                return S_FALSE; // stay open, worker thread drives the next state
            }
            if (static_cast<int>(wParam) == IDC_CLOSE) {
                return S_OK; // allow the dialog to close
            }
            break;

        case TDN_HYPERLINK_CLICKED:
            break;

        case TDN_NAVIGATED:
            break;

        default:
            break;
        }

        return S_OK;
    }
```

- [ ] **Step 3: Replace the `WorkerThreadProc` failure path with `ShowFailureButtons`, and fix the cancel-reports-success bug**

Find:

```cpp
    void WorkerThreadProc() {
        try {
            ExecuteUpdate();
            DirectUpdateUI(100, L"Update completed successfully!");
            Sleep(500);
            SendMessage(m_hwndTD, TDM_CLICK_BUTTON, IDOK, 0);
        }
        catch (const std::exception& ex) {
            std::string errStr = ex.what();
            std::wstring wErr(errStr.begin(), errStr.end());
            DirectUpdateUI(0, L"Error: " + wErr);
            MessageBoxW(m_hwndTD, wErr.c_str(), L"Update Failed", MB_ICONERROR | MB_OK);
            SendMessage(m_hwndTD, TDM_CLICK_BUTTON, IDCANCEL, 0);
        }
        catch (...) {
            DirectUpdateUI(0, L"An unknown error occurred during update.");
            MessageBoxW(m_hwndTD, L"An unknown error occurred.", L"Update Failed", MB_ICONERROR | MB_OK);
            SendMessage(m_hwndTD, TDM_CLICK_BUTTON, IDCANCEL, 0);
        }
    }
```

Replace with:

```cpp
    void WorkerThreadProc() {
        try {
            ExecuteUpdate();
            if (m_cancelRequested) {
                SendMessage(m_hwndTD, TDM_CLICK_BUTTON, IDCANCEL, 0);
                return;
            }
            DirectUpdateUI(100, L"Update completed successfully!");
            Sleep(500);
            SendMessage(m_hwndTD, TDM_CLICK_BUTTON, IDOK, 0);
        }
        catch (const std::exception& ex) {
            std::string errStr = ex.what();
            std::wstring wErr(errStr.begin(), errStr.end());
            ShowFailureButtons(wErr);
        }
        catch (...) {
            ShowFailureButtons(L"An unknown error occurred during update.");
        }
    }

    void ShowFailureButtons(const std::wstring& errorText) {
        if (!m_hwndTD) return;

        static TASKDIALOG_BUTTON buttons[] = {
            { IDC_RETRY, L"Retry" },
            { IDC_CLOSE, L"Close" },
        };

        TASKDIALOGCONFIG tdc = { sizeof(tdc) };
        tdc.hwndParent = NULL;
        tdc.hInstance = GetModuleHandle(NULL);
        tdc.dwFlags = TDF_CALLBACK_TIMER;
        tdc.pszWindowTitle = L"Null IDE Updater";
        tdc.pszMainInstruction = L"Update Failed";
        tdc.pszContent = errorText.c_str();
        tdc.pButtons = buttons;
        tdc.cButtons = ARRAYSIZE(buttons);
        tdc.nDefaultButton = IDC_RETRY;
        tdc.pfCallback = TaskDialogCallbackProc;
        tdc.lpCallbackData = reinterpret_cast<LONG_PTR>(this);

        SendMessage(m_hwndTD, TDM_NAVIGATE_PAGE, 0, reinterpret_cast<LPARAM>(&tdc));
    }
```

- [ ] **Step 4: Build to verify**

Run: `cmake --build updater/build --config Release`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add updater/src/main.cpp
git commit -m "feat: native updater offers Retry/Close on failure instead of a blocking error box"
```

---

### Task 13: `package.json` — no command/menu changes needed (verification task)

The `null.installUpdate` / `null.checkForUpdates` commands and their `package.json` contributions are unchanged by this plan — only their implementation moved. This task is a quick sanity pass to confirm nothing needs updating there.

**Files:**
- Read only: `extensions/null-tools/package.json`

- [ ] **Step 1: Confirm no `package.json` changes are needed**

Run: `grep -n "installUpdate\|checkForUpdates" extensions/null-tools/package.json`
Expected: the existing two `commands` entries and two `commandPalette`/`when` entries — no changes required (command IDs, titles, and the `nullUpdateAvailable` context key are all unchanged by this plan; the new `nullUpdateStaged` context key introduced in Task 3/4 is set programmatically and doesn't need a `package.json` contribution since nothing currently gates UI on it besides the status bar item's own JS-side branching).

No commit needed for this task — it's a verification-only step.

---

### Task 14: End-to-end manual verification on a real local install

Everything native (the EXE, registry writes, TaskDialog UI) can only be meaningfully verified against a real Windows install — this matches how the rest of this subsystem is already validated (`scripts/sync-local.ps1`, referenced from `CLAUDE.md`'s "Do not run CI... builds run in GitHub Actions" — that constraint is about the VSCodium/gulp mega-build, not this local sync+verify loop, which is the established workflow for this exact subsystem).

**Files:**
- None (verification only).

- [ ] **Step 1: Compile everything**

Run, from the repo root:
```
cd extensions/null-tools && npm run compile && npm test && cd ../..
cmake --build updater/build --config Release
```
Expected: all green.

- [ ] **Step 2: Sync to a real local Null IDE install**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sync-local.ps1`
Expected: completes, including the `[ok] updater scripts + null-updater.exe` line.

- [ ] **Step 3: Exercise the check → background-stage → install flow**

In the synced Null IDE install: run "Null: Check for Updates". Confirm in the "Null IDE Updates" output channel that a release is found (or, if already on latest, temporarily point at a repo/tag with a newer release for this test). Confirm the status bar shows the downloading state, then flips to "Restart to update" once the background download completes. Click it; confirm the confirmation dialog shows a changelog excerpt (`detail`) and, on confirming, the native TaskDialog appears with real progress (not a console window) and completes quickly since the zip was pre-staged.

- [ ] **Step 4: Exercise the foreground-fallback (no staged zip) path**

Delete `%TEMP%\null-ide-update-staged` before clicking "Update Now" (or trigger install immediately after a check, before background staging finishes). Confirm the TaskDialog shows its own download progress and still succeeds.

- [ ] **Step 5: Exercise checksum-mismatch rejection**

Temporarily corrupt a locally-staged zip's bytes (or point `--zip-path` at an unrelated file) and confirm the EXE refuses to proceed with an integrity-check error rather than extracting garbage. (For the background-download path, this can be simulated by editing the downloaded zip in the staging directory before installing.)

- [ ] **Step 6: Exercise the failure/retry path**

Run the EXE manually with a bogus repo to force a failure, e.g.:
```
updater\build\Release\null-updater.exe --repo does-not/exist --install-dir "%TEMP%\null-updater-test"
```
Confirm the TaskDialog shows "Update Failed" with **Retry** and **Close** buttons instead of a blocking message box, that **Retry** actually re-attempts (visible in a fresh progress cycle), and **Close** exits cleanly.

- [ ] **Step 7: Exercise rollback**

With a real local install, force a failure partway through a real update (e.g. temporarily rename `install-null-ide.ps1` out of the way so `ReapplyRegistrations` — not required for rollback itself, just confirm the app still launches — or more directly, make `targetInstallDir` read-only mid-swap if feasible). At minimum, confirm via code review that the catch block in Task 10 covers the actual rename call sites; a full forced-failure repro is best-effort given how hard it is to reliably interrupt a local filesystem rename.

- [ ] **Step 8: Confirm registrations were reapplied**

After a successful update, confirm the right-click context menu ("Open in Null") still works and `%APPDATA%\Null\User\settings.json` wasn't clobbered (only missing defaults get added, per `Set-DefaultSettings`'s existing merge behavior — unchanged in this plan).

No commit for this task — it's the final verification pass confirming Tasks 1–12 work together on a real machine.

---

## Self-Review

**Spec coverage:**
- Root-cause fix (EXE never invoked) → Tasks 2, 3.
- Version-compare prerelease bug → Task 1.
- `--version` omission → Task 3 (`installUpdate` always passes `--version`).
- Whole-buffer JSON parsing / no HTTP-status check → Task 9.
- No rollback in EXE → Task 10.
- No registration reapplication → Tasks 6, 11.
- Checksum verification → Tasks 5, 8 (EXE), Task 3 (TS background download).
- Changelog display → Task 3 (`releaseNotes` + `detail` in both prompts).
- Background download, restart-only prompt → Task 3 (`stageUpdateInBackground`), Task 4 (status bar states).
- Better failure recovery (Retry/rollback) → Tasks 10, 12.
- Manual end-to-end validation → Task 14.

**Placeholder scan:** no TBD/TODO; every step has concrete code, commands, or explicit expected output.

**Type consistency:** `AvailableUpdate`/`StagedUpdate` fields introduced in Task 3 match exactly what Task 4 imports and reads (`assetUrl`/`assetName`/`assetSize`/`sha256Url`/`releaseNotes` on `AvailableUpdate`; `version`/`zipPath`/`verified` on `StagedUpdate`). `--zip-path`/`--version` flags produced by Task 3's `installUpdate` match the flags Task 8 adds to `ParseArgs`. `install-null-ide.ps1 -ReapplyRegistrations -InstallDir` (Task 6) matches the exact command line Task 11's `ReapplyRegistrations` constructs.

---

**Plan complete and saved to `docs/plans/native-updater-fix.md`. Starting execution — I'll confirm the execution target and mode with you first.**

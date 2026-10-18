# Linux Build and Release Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Ship an officially supported Linux x64 Null IDE (`tar.gz` + `.deb`) from the existing GitHub Actions release workflow, without changing how the Windows release works.

**Architecture:** A new `build-linux` job in `build.yml` repeats the platform-neutral overlay steps of `build-windows`, runs VS Code's own `gulp vscode-linux-x64` plus its deb tasks, rewrites Microsoft's Debian templates with a tested script, smoke-tests both artifacts, and uploads them to the same release. `null-tools` gets the small platform fixes Linux needs (data directory, updater). Windows assets are renamed to the same `null-ide-<platform>-x64-<tag>.<ext>` scheme in a separate commit.

**Tech Stack:** GitHub Actions (`ubuntu-22.04`), bash + PowerShell, Node `node:test`, TypeScript (`null-tools`), Rust (`setup/core` test only), `dpkg-deb`, `xvfb`.

**Spec:** [docs/specs/linux-build-design.md](../specs/linux-build-design.md)

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Work on branch `linux-build` (the agreed workflow); nothing merges to `main` before a green Linux run. **Never push**; the user pushes and dispatches the workflow, you read results with `gh run view --log-failed`.
- Commit after each task with the repo's Conventional Commit style; new commits only, no `--no-verify`, no amend. End every commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- `extensions/*/out/` is tracked: after editing `src/`, run `npm run compile` in that extension and commit the refreshed `out/` as `chore: refresh null-tools compiled output`. Never hand-edit `out/`. A new test file must be added to the `test` script in `package.json`.
- Formats: `tar.gz` and `.deb`, **x64 only**. Not in scope: `.rpm`, AppImage, Flatpak/Snap, apt repository, arm64, Linux auto-update.
- Asset names: `null-ide-<platform>-x64-<tag>.<ext>`. Windows: `null-ide-win32-x64-<tag>.zip` + `.zip.sha256`. Linux: `null-ide-linux-x64-<tag>.tar.gz`, `.tar.gz.sha256`, `null-ide-linux-x64-<tag>.deb`. `<tag>` is the release tag on tag builds and the VSCodium tag on manual runs.
- `.deb`: `Package: null-ide`; binary and install dir stay `null` (`/usr/bin/null`, `/usr/share/null`); `Maintainer: Null IDE <TorresVisual@users.noreply.github.com>`. Never use the user's personal email in published artifacts.
- The `build-windows` job is not edited except for the asset rename in Task 1. A Linux failure must never block the Windows release.
- Runner `ubuntu-22.04`; `workflow_dispatch` gets a boolean input `build_linux` (default true); tag pushes always build both.
- Do not run `scripts/build-local.ps1` (it takes tens of minutes) except where a step says so; Linux cannot be validated locally, so CI is the verification.
- After code changes run `graphify update .` once at the end (Task 7).

## Review Focus

Failure modes the spec implies that no single feature test covers; each has a test in the owning task.

1. A Linux start with `%APPDATA%` unset must open the dashboard, not throw (Task 2: `nullDataDir` tests).
2. Two project folders differing only in letter case are different projects on Linux (Task 2: `normalizeRecentProjectPath` test).
3. A release now carries Windows and Linux assets side by side; each platform must pick only its own package, never `.sha256` or `.deb` by mistake (Task 1: Rust test; Task 3: `hasPlatformPackage` tests).
4. A Linux install without `.null-ide-install.json` reports version `local` and offers an update on every start (Task 6 writes it; Task 5 smoke asserts it).
5. Upstream template drift must fail the Linux job rather than ship Microsoft's apt repository registration (Task 4: drift tests; Task 5: forbidden-string and `apt` round-trip checks).
6. A hostile or odd release tag must not reach a shell as code (Task 6: tag values go through `env:`, never interpolated into `run:`).

## File Structure

| File | Responsibility |
|---|---|
| `.github/workflows/build.yml` | Windows asset rename (Task 1); new `build_linux` input and `build-linux` job (Task 6) |
| `scripts/build-local.ps1`, `scripts/fake-release.mjs` | Follow the Windows asset rename |
| `setup/core/tests/release.rs` | Pins that the Windows updater still finds its zip in a mixed release |
| `extensions/null-tools/src/dataDir.ts` (+test) | Per-OS Null user-data folder |
| `extensions/null-tools/src/recentProjects.ts`, `extension.ts` | Use `nullDataDir`; case-sensitive paths off Windows |
| `extensions/null-tools/src/updateStatus.ts` (+test) | Pure platform logic for the updater |
| `extensions/null-tools/src/updater.ts`, `updaterIntegration.ts` | Linux: release-page link instead of null-setup |
| `scripts/linux-deb-metadata.mjs` (+test) | Rewrites VS Code's Debian templates for Null |
| `scripts/linux-smoke.sh` | CI smoke test of tarball and `.deb` |
| `README.md`, `docs/wiki/*`, `docs/linux-verification.md`, `CLAUDE.md`, `extensions/null-tools/CLAUDE.md` | Docs |

---

### Task 1: Rename Windows release assets (separate, revertible commit)

**Files:**
- Modify: `.github/workflows/build.yml` (Windows job: "Create zip archive", "Publish release asset", "Upload artifact")
- Modify: `scripts/build-local.ps1:811-814`
- Modify: `scripts/fake-release.mjs:23`
- Modify: `README.md:61`, `docs/wiki/Getting-Started.md:21`, `docs/wiki/Development.md:42`, `CLAUDE.md:60`
- Test: `setup/core/tests/release.rs`

**Interfaces:**
- Consumes: `release.rs::from_json` and `is_zip_name` (`starts_with("null-ide-win32-x64") && ends_with(".zip")`), `null-tools` `hasWindowsPackage` regex `^null-ide-win32-x64(-[^/\\]+)?\.zip$` — both already accept a suffix, so no updater code changes.
- Produces: Windows assets `null-ide-win32-x64-<tag>.zip` / `.zip.sha256`, where `<tag>` follows the same rule the `Stage the setup stub` step already uses.

- [ ] **Step 1: Pin the updater's behaviour in a mixed release**

Append to `setup/core/tests/release.rs`:

```rust
#[test]
fn a_versioned_windows_zip_is_found_among_the_linux_assets() {
    let v = json!({ "tag_name": "v2", "assets": [
        { "name": "null-ide-linux-x64-v2.tar.gz", "browser_download_url": "http://h/tgz", "size": 9 },
        { "name": "null-ide-linux-x64-v2.tar.gz.sha256", "browser_download_url": "http://h/tgz.sha256", "size": 90 },
        { "name": "null-ide-linux-x64-v2.deb", "browser_download_url": "http://h/deb", "size": 9 },
        { "name": "null-ide-win32-x64-v2.zip", "browser_download_url": "http://h/zip", "size": 1234 },
        { "name": "null-ide-win32-x64-v2.zip.sha256", "browser_download_url": "http://h/zip.sha256", "size": 90 }
    ]});
    let r = from_json(&v, "v2").unwrap();
    assert_eq!((r.zip_name.as_str(), r.zip_size), ("null-ide-win32-x64-v2.zip", 1234));
    assert_eq!(r.zip_url, "http://h/zip");
    assert_eq!(r.sha256_url, "http://h/zip.sha256");
}
```

- [ ] **Step 2: Run it**

Run (from `setup/`): `cargo test --locked -p null-setup-core --test release`
Expected: PASS (this pins existing behaviour, so there is no red phase). If `cargo` is not installed locally, skip; CI runs it in "Test null-setup".

- [ ] **Step 3: Rename in the workflow**

In the `Create zip archive` step replace the body so the file name carries the version (keep the `$outDir` check):

```yaml
      - name: Create zip archive
        shell: pwsh
        run: |
          Write-Host "Contents of workspace root:"
          Get-ChildItem -Directory | Select-Object -ExpandProperty Name
          $outDir = "VSCode-win32-x64"
          if (-not (Test-Path $outDir)) {
            Write-Error "Build output directory '$outDir' not found"
            exit 1
          }
          $version = '${{ github.ref_name }}'
          if ('${{ github.ref_type }}' -ne 'tag') {
            $version = '${{ steps.tag.outputs.tag }}'
          }
          $zip = "null-ide-win32-x64-$version.zip"
          Compress-Archive -Path "$outDir\*" -DestinationPath $zip -Force
          Write-Host "Archive created: $((Get-Item $zip).Length / 1MB) MB"
          $hash = Get-FileHash $zip -Algorithm SHA256
          "$($hash.Hash.ToLower())  $zip" | Set-Content "$zip.sha256" -Encoding ASCII -NoNewline
          Write-Host "Checksum written: $($hash.Hash.ToLower())"
```

In both `files:` / `path:` lists (`Publish release asset`, `Upload artifact`) replace the two lines

```
            null-ide-win32-x64.zip
            null-ide-win32-x64.zip.sha256
```

with

```
            null-ide-win32-x64-*.zip
            null-ide-win32-x64-*.zip.sha256
```

- [ ] **Step 4: Rename in the local tooling**

`scripts/build-local.ps1` lines 811-814 become:

```powershell
$zipName = "null-ide-win32-x64-$buildVersion.zip"
$zipPath = Join-Path $WorkspaceDir $zipName
Compress-Archive -Path "$OutDir\*" -DestinationPath $zipPath -Force
$hash = Get-FileHash $zipPath -Algorithm SHA256
"$($hash.Hash.ToLower())  $zipName" | Set-Content "$zipPath.sha256" -Encoding ASCII -NoNewline
```

(keep the following `Write-Host "Archive: ..."` line unchanged). `scripts/fake-release.mjs:23` becomes:

```js
const name = `null-ide-win32-x64-${tag}.zip`;
```

- [ ] **Step 5: Update the docs that name the zip**

Replace `null-ide-win32-x64.zip` with `null-ide-win32-x64-<tag>.zip` in `README.md:61`, `docs/wiki/Getting-Started.md:21`, `docs/wiki/Development.md:42` and `CLAUDE.md:60` (leave historical plans/specs untouched).

- [ ] **Step 6: Verify and commit**

Run: `grep -rnF "null-ide-win32-x64.zip" .github scripts README.md CLAUDE.md docs/wiki --exclude-dir=node_modules`
Expected: no output.
Run: `node --check scripts/fake-release.mjs`
Expected: no output.

```bash
git add .github/workflows/build.yml scripts/build-local.ps1 scripts/fake-release.mjs README.md CLAUDE.md docs/wiki setup/core/tests/release.rs
git commit -m "ci: version the Windows release assets as null-ide-win32-x64-<tag>.zip"
```

---

### Task 2: `null-tools` data directory (fixes the dashboard on Linux)

**Files:**
- Create: `extensions/null-tools/src/dataDir.ts`
- Create: `extensions/null-tools/src/dataDir.test.ts`
- Modify: `extensions/null-tools/src/recentProjects.ts:19-27`
- Modify: `extensions/null-tools/src/extension.ts:89-93`
- Modify: `extensions/null-tools/src/recentProjects.test.ts` (append)
- Modify: `extensions/null-tools/package.json` (`test` script: append `out/dataDir.test.js`)

**Interfaces:**
- Produces: `nullDataDir(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, home?: string): string` (throws `Error('Cannot locate %APPDATA%.')` on win32 without `APPDATA`); `normalizeRecentProjectPath(value: string, platform?: NodeJS.Platform): string`.

- [ ] **Step 1: Write the failing tests**

`extensions/null-tools/src/dataDir.test.ts`:

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { nullDataDir } from './dataDir';

test('Windows uses %APPDATA%\\Null', () => {
  assert.equal(
    nullDataDir({ APPDATA: 'C:\\Users\\ada\\AppData\\Roaming' }, 'win32', 'C:\\Users\\ada'),
    'C:\\Users\\ada\\AppData\\Roaming\\Null',
  );
});

test('Windows without %APPDATA% is an error, not a guess', () => {
  assert.throws(() => nullDataDir({}, 'win32', 'C:\\Users\\ada'), /APPDATA/);
});

test('Linux defaults to ~/.config/Null, with no APPDATA involved', () => {
  assert.equal(nullDataDir({}, 'linux', '/home/ada'), '/home/ada/.config/Null');
});

test('Linux honours XDG_CONFIG_HOME, and ignores an empty one', () => {
  assert.equal(nullDataDir({ XDG_CONFIG_HOME: '/data/cfg' }, 'linux', '/home/ada'), '/data/cfg/Null');
  assert.equal(nullDataDir({ XDG_CONFIG_HOME: '' }, 'linux', '/home/ada'), '/home/ada/.config/Null');
});
```

Append to `extensions/null-tools/src/recentProjects.test.ts` (add `normalizeRecentProjectPath` to its import list from `./recentProjects`):

```ts
test('paths differing only in case are the same project on Windows but not on Linux', () => {
  const a = path.resolve('Work', 'App');
  const b = path.resolve('work', 'app');
  assert.equal(normalizeRecentProjectPath(a, 'win32'), normalizeRecentProjectPath(b, 'win32'));
  assert.notEqual(normalizeRecentProjectPath(a, 'linux'), normalizeRecentProjectPath(b, 'linux'));
});
```

- [ ] **Step 2: Run to verify they fail**

Run (in `extensions/null-tools`): `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './dataDir'` and `normalizeRecentProjectPath` has no second parameter.

- [ ] **Step 3: Implement**

`extensions/null-tools/src/dataDir.ts`:

```ts
'use strict';

import * as os from 'os';
import * as path from 'path';

/** Electron's userData folder for this app: %APPDATA%\Null on Windows, $XDG_CONFIG_HOME/Null (~/.config/Null) elsewhere. */
export function nullDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  if (platform === 'win32') {
    if (!env.APPDATA) { throw new Error('Cannot locate %APPDATA%.'); }
    return path.win32.join(env.APPDATA, 'Null');
  }
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, '.config'), 'Null');
}
```

In `recentProjects.ts` add `import { nullDataDir } from './dataDir';` and replace the two functions:

```ts
export function getRecentProjectsFilePath(): string {
  return path.join(nullDataDir(), 'null-recent-projects.json');
}

export function normalizeRecentProjectPath(value: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = path.resolve(value);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}
```

In `extension.ts` add `import { nullDataDir } from './dataDir';` and replace

```ts
    const appData = process.env.APPDATA;
    if (!appData) { vscode.window.showErrorMessage('Null: cannot locate %APPDATA%.'); return; }
    const userDataDir = path.join(appData, 'Null');
```

with

```ts
    let userDataDir: string;
    try { userDataDir = nullDataDir(); }
    catch (err) { vscode.window.showErrorMessage(`Null: ${(err as Error).message}`); return; }
```

Add `out/dataDir.test.js` to the end of the `test` script's `node --test` list in `package.json`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test` (in `extensions/null-tools`)
Expected: PASS, including the 5 new tests.

- [ ] **Step 5: Commit source, then compiled output**

```bash
git add extensions/null-tools/src extensions/null-tools/package.json
git commit -m "fix(null-tools): resolve the Null data folder per OS so the dashboard works on Linux"
npm run compile --prefix extensions/null-tools
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output"
```

---

### Task 3: `null-tools` updater on Linux

**Files:**
- Modify: `extensions/null-tools/src/updateStatus.ts` (append)
- Modify: `extensions/null-tools/src/updateStatus.test.ts` (import + append)
- Modify: `extensions/null-tools/src/updater.ts` (import, `hasWindowsPackage`, `startPrefetch`, `checkForUpdate`, `promptForUpdate`, `installUpdate`)
- Modify: `extensions/null-tools/src/updaterIntegration.ts`

**Interfaces:**
- Produces (in `updateStatus.ts`): `hasPlatformPackage(platform: NodeJS.Platform, assets: readonly { name: string }[] | undefined): boolean`; `canSelfUpdate(platform: NodeJS.Platform): boolean` (true only for `win32`); `releasePageStatus(version: string): StatusView`.
- Consumes: `StatusView` (already exported from `updateStatus.ts`).

- [ ] **Step 1: Write the failing tests**

Add `canSelfUpdate, hasPlatformPackage, releasePageStatus` to the import on line 3 of `updateStatus.test.ts`, then append:

```ts
const assets = (...names: string[]) => names.map(name => ({ name }));

test('hasPlatformPackage picks each platform\'s own package, never a sidecar or the deb', () => {
  const release = assets(
    'null-ide-win32-x64-v2.zip', 'null-ide-win32-x64-v2.zip.sha256',
    'null-ide-linux-x64-v2.tar.gz', 'null-ide-linux-x64-v2.tar.gz.sha256', 'null-ide-linux-x64-v2.deb',
  );
  assert.strictEqual(hasPlatformPackage('win32', release), true);
  assert.strictEqual(hasPlatformPackage('linux', release), true);
  assert.strictEqual(hasPlatformPackage('win32', assets('null-ide-win32-x64.zip')), true);
  assert.strictEqual(hasPlatformPackage('win32', assets('null-ide-win32-x64-v2.zip.sha256', 'null-ide-linux-x64-v2.tar.gz')), false);
  assert.strictEqual(hasPlatformPackage('linux', assets('null-ide-linux-x64-v2.tar.gz.sha256', 'null-ide-linux-x64-v2.deb', 'null-ide-win32-x64-v2.zip')), false);
});

test('hasPlatformPackage is false for unknown platforms and missing asset lists', () => {
  assert.strictEqual(hasPlatformPackage('darwin', assets('null-ide-win32-x64-v2.zip')), false);
  assert.strictEqual(hasPlatformPackage('linux', undefined), false);
});

test('only Windows installs can replace themselves', () => {
  assert.strictEqual(canSelfUpdate('win32'), true);
  assert.strictEqual(canSelfUpdate('linux'), false);
});

test('the Linux status button points at the release page', () => {
  const view = releasePageStatus('v2');
  assert.match(view.text, /v2/);
  assert.match(view.tooltip, /release page/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run (in `extensions/null-tools`): `npx tsc -p tsconfig.json`
Expected: FAIL — the three names are not exported from `./updateStatus`.

- [ ] **Step 3: Implement the pure part**

Append to `updateStatus.ts`:

```ts
const PACKAGE_ASSETS: Partial<Record<NodeJS.Platform, RegExp>> = {
  win32: /^null-ide-win32-x64(-[^/\\]+)?\.zip$/i,
  linux: /^null-ide-linux-x64(-[^/\\]+)?\.tar\.gz$/i,
};

/** Whether a release carries the package this platform installs (the Linux .deb is a convenience, not what the updater checks). */
export function hasPlatformPackage(platform: NodeJS.Platform, assets: readonly { name: string }[] | undefined): boolean {
  const pattern = PACKAGE_ASSETS[platform];
  return !!pattern && Array.isArray(assets) && assets.some(a => pattern.test(a.name));
}

/** Only the Windows install ships null-setup, so only it can download, swap and restart itself. */
export function canSelfUpdate(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

/** Linux installs update by hand, so the status button just points at the release. */
export function releasePageStatus(version: string): StatusView {
  return { text: `$(cloud-download) ${version}`, tooltip: `Null IDE ${version} is available. Click to open the release page.` };
}
```

- [ ] **Step 4: Wire it into the updater**

`updater.ts`:

1. Import line becomes
   `import { Progress, canSelfUpdate, hasPlatformPackage, isSafeTag, isStillAvailable, parseProgressLine, shouldAcknowledge } from './updateStatus';`
2. Delete the whole `hasWindowsPackage` function.
3. First line of `startPrefetch`: `if (!canSelfUpdate(process.platform)) return;`
4. In `checkForUpdate` replace the `hasPackage` / log / message lines:

```ts
  const hasPackage = hasPlatformPackage(process.platform, release.assets);
  output.appendLine(`Latest release: ${latest || '(none)'}. Package for ${process.platform}: ${hasPackage ? 'yes' : 'no'}`);
```
   and `const packageNote = hasPackage ? '' : ' No Windows package was found on the latest release.';` becomes
   `const packageNote = hasPackage ? '' : ' No package for this platform was found on the latest release.';`
5. `promptForUpdate` becomes:

```ts
export async function promptForUpdate(update: AvailableUpdate): Promise<void> {
  const buttons = canSelfUpdate(process.platform)
    ? ['Update Now', 'Release Notes', 'Later']
    : ['Open Release Page', 'Later'];
  const action = await vscode.window.showInformationMessage(
    `Null IDE ${update.latest} is available. You are running ${update.current}.`,
    { detail: truncateReleaseNotes(update.releaseNotes) },
    ...buttons,
  );

  if (action === 'Update Now' || action === 'Open Release Page') {
    await vscode.commands.executeCommand('null.installUpdate');
  } else if (action === 'Release Notes' && update.url) {
    await vscode.env.openExternal(vscode.Uri.parse(update.url));
  }
}
```
6. In `installUpdate`, directly after `if (!update) return;` add:

```ts
  if (!canSelfUpdate(process.platform)) {
    if (update.url) await vscode.env.openExternal(vscode.Uri.parse(update.url));
    return;
  }
```

`updaterIntegration.ts`: change the import to `import { canSelfUpdate, releasePageStatus, statusFor } from './updateStatus';` and replace `const view = statusFor(update.latest, getUpdateProgress(), isReady);` with

```ts
    const view = canSelfUpdate(process.platform)
      ? statusFor(update.latest, getUpdateProgress(), isReady)
      : releasePageStatus(update.latest);
```

- [ ] **Step 5: Run to verify they pass**

Run: `npm test` (in `extensions/null-tools`)
Expected: PASS.

- [ ] **Step 6: Commit source, then compiled output**

```bash
git add extensions/null-tools/src
git commit -m "feat(null-tools): on Linux the updater points at the release page instead of null-setup"
npm run compile --prefix extensions/null-tools
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output"
```

---

### Task 4: Debian template rewrite script

**Files:**
- Create: `scripts/linux-deb-metadata.mjs`
- Test: `scripts/linux-deb-metadata.test.mjs`

**Interfaces:**
- Produces: `patchPostinst(text)`, `patchPostrm(text)`, `patchTemplates(text)`, `patchControl(text)`, `patchAppdata(text)` — each returns the rewritten text, preserves the input's line endings, and throws when an expected anchor is missing; `applyToTree(vscodeSrcDir)` rewrites the five files under `<dir>/resources/linux/`. CLI: `node scripts/linux-deb-metadata.mjs <vscode-src>`.

- [ ] **Step 1: Write the failing tests**

`scripts/linux-deb-metadata.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyToTree, patchAppdata, patchControl, patchPostinst, patchPostrm, patchTemplates } from './linux-deb-metadata.mjs';

const FORBIDDEN = /packages\.microsoft\.com|microsoft\.gpg|add-microsoft-repo/i;

const POSTINST = [
  '#!/usr/bin/env bash', '#', '# Copyright (c) Microsoft Corporation. All rights reserved.', '',
  'rm -f /usr/bin/@@NAME@@', 'ln -s /usr/share/@@NAME@@/bin/@@NAME@@ /usr/bin/@@NAME@@', '',
  'if [ "@@NAME@@" != "code-oss" ]; then',
  '\t# Register apt repository',
  '\tCODE_TRUSTED_PART=/usr/share/keyrings/microsoft.gpg',
  '\techo "URIs: https://packages.microsoft.com/repos/code"',
  'fi', '',
].join('\n');

const POSTRM = [
  '#!/bin/bash', '', 'rm -f /usr/bin/@@NAME@@', '',
  'RET=true', 'if [ -e /usr/share/debconf/confmodule ]; then', '\tdb_get @@NAME@@/add-microsoft-repo || true', 'fi', '',
].join('\n');

const CONTROL = [
  'Package: @@NAME@@', 'Version: @@VERSION@@', 'Depends: @@DEPENDS@@',
  'Maintainer: Microsoft Corporation <vscode-linux@microsoft.com>',
  'Homepage: https://code.visualstudio.com/',
  'Provides: visual-studio-@@NAME@@', 'Conflicts: visual-studio-@@NAME@@', 'Replaces: visual-studio-@@NAME@@',
  'Description: Code editing. Redefined.',
  ' Visual Studio Code is a new choice of tool.',
  ' instructions and FAQ.', '',
].join('\n');

const APPDATA = [
  '<component type="desktop">',
  '\t<name>@@NAME_LONG@@</name>',
  '\t<url type="homepage">https://code.visualstudio.com</url>',
  '\t<summary>Visual Studio Code. Code editing. Redefined.</summary>',
  '\t<description>',
  '\t\t<p>Visual Studio Code is a new choice of tool. See https://code.visualstudio.com/docs/setup/linux for installation instructions and FAQ.</p>',
  '\t</description>',
  '\t<screenshots>',
  '\t\t<screenshot type="default"><image>https://code.visualstudio.com/x.png</image></screenshot>',
  '\t</screenshots>',
  '</component>', '',
].join('\n');

test('postinst loses the Microsoft repository block but keeps the symlink and the license header', () => {
  const out = patchPostinst(POSTINST);
  assert.doesNotMatch(out, FORBIDDEN);
  assert.match(out, /ln -s \/usr\/share\/@@NAME@@\/bin\/@@NAME@@ \/usr\/bin\/@@NAME@@\n$/);
  assert.match(out, /Copyright \(c\) Microsoft Corporation/);
});

test('postrm loses the repository cleanup and debconf purge', () => {
  const out = patchPostrm(POSTRM);
  assert.doesNotMatch(out, FORBIDDEN);
  assert.doesNotMatch(out, /db_/);
  assert.match(out, /rm -f \/usr\/bin\/@@NAME@@\n$/);
});

test('the debconf template is emptied', () => {
  assert.equal(patchTemplates('Template: @@NAME@@/add-microsoft-repo\nType: boolean\n'), '');
});

test('control is renamed to null-ide, re-owned and loses the visual-studio aliases', () => {
  const out = patchControl(CONTROL);
  assert.match(out, /^Package: null-ide$/m);
  assert.match(out, /^Maintainer: Null IDE <TorresVisual@users\.noreply\.github\.com>$/m);
  assert.match(out, /^Homepage: https:\/\/github\.com\/TorresVisual\/null-ide$/m);
  assert.doesNotMatch(out, /visual-studio|Visual Studio|code\.visualstudio|Microsoft/);
  assert.match(out, /^Version: @@VERSION@@$/m);
  assert.match(out, /^Description: Null IDE/m);
  assert.ok(out.endsWith('\n'));
});

test('appdata is rebranded and drops the VS Code screenshot', () => {
  const out = patchAppdata(APPDATA);
  assert.doesNotMatch(out, /Visual Studio|code\.visualstudio|screenshot/);
  assert.match(out, /<url type="homepage">https:\/\/github\.com\/TorresVisual\/null-ide<\/url>/);
  assert.match(out, /<name>@@NAME_LONG@@<\/name>/);
});

test('CRLF checkouts keep their line endings', () => {
  const out = patchPostinst(POSTINST.replace(/\n/g, '\r\n'));
  assert.doesNotMatch(out, FORBIDDEN);
  assert.ok(out.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(out), 'every newline must stay CRLF');
});

test('upstream drift fails loudly instead of shipping the old behaviour', () => {
  assert.throws(() => patchPostinst('echo hi\n'), /postinst/);
  assert.throws(() => patchPostrm('echo hi\n'), /postrm/);
  assert.throws(() => patchTemplates('Template: other\n'), /templates/);
  assert.throws(() => patchControl('Package: other\n'), /control/);
  assert.throws(() => patchAppdata('<component/>\n'), /appdata/);
  assert.throws(() => patchPostinst('if [ "@@NAME@@" != "code-oss" ]; then\n\techo nothing\nfi\n'), /postinst/);
});

// vscode-src is inside the repo on a dev machine and a sibling of ide-overlay/ in CI.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realTemplates = [path.join(root, 'vscode-src'), path.join(root, '..', 'vscode-src')]
  .map(d => path.join(d, 'resources', 'linux'))
  .find(d => fs.existsSync(path.join(d, 'debian', 'postinst.template')));
test('the real VS Code templates, when present, rewrite cleanly', { skip: !realTemplates }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deb-meta-'));
  try {
    fs.cpSync(realTemplates, path.join(tmp, 'resources', 'linux'), { recursive: true });
    applyToTree(tmp);
    for (const f of ['postinst', 'postrm', 'templates', 'control'].map(n => path.join(tmp, 'resources', 'linux', 'debian', `${n}.template`))) {
      assert.doesNotMatch(fs.readFileSync(f, 'utf8'), FORBIDDEN, f);
    }
    assert.match(fs.readFileSync(path.join(tmp, 'resources', 'linux', 'debian', 'control.template'), 'utf8'), /^Package: null-ide\r?$/m);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
```

Note: in CI the checkout is `ide-overlay/` next to `vscode-src/`, so the test finds the real templates there too (via `../vscode-src`); it copies them to a temp dir, but the CI step still runs it **before** the script rewrites the real tree, because afterwards the anchors are gone.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/linux-deb-metadata.test.mjs`
Expected: FAIL — `Cannot find module './linux-deb-metadata.mjs'`.

- [ ] **Step 3: Implement**

`scripts/linux-deb-metadata.mjs`:

```js
#!/usr/bin/env node
// Rewrites VS Code's Debian packaging templates for Null IDE (#119).
// The stock postinst registers Microsoft's apt repository and signing key for any app name but
// "code-oss"; VSCodium neutralises that in prepare_vscode.sh, which Null's pipelines never run.
// Every rewrite throws when its anchor is missing, so upstream template drift fails the build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAINTAINER = 'Null IDE <TorresVisual@users.noreply.github.com>';
const HOMEPAGE = 'https://github.com/TorresVisual/null-ide';
const DESCRIPTION = `Description: Null IDE, a telemetry-free code editor based on VSCodium
 Null IDE is a code editor built on VSCodium, the telemetry-free build of
 VS Code. Documentation and release notes are at ${HOMEPAGE}.
`;

/** Runs `fn` on LF text and restores the original line endings. */
function keepEol(text, fn) {
  const crlf = text.includes('\r\n');
  const out = fn(text.replace(/\r\n/g, '\n'));
  return crlf ? out.replace(/\n/g, '\r\n') : out;
}

function swap(text, pattern, replacement, file) {
  const found = typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
  if (!found) throw new Error(`${file}: ${pattern} not found; the template changed upstream`);
  return text.replace(pattern, () => replacement);
}

/** Drops everything from the first line starting with `startLine`, after checking it is the block we mean to remove. */
function cutFrom(text, startLine, mustContain, file) {
  const lines = text.split('\n');
  const i = lines.findIndex(l => l.startsWith(startLine));
  if (i < 0) throw new Error(`${file}: no line starting with ${JSON.stringify(startLine)}; the template changed upstream`);
  if (!lines.slice(i).join('\n').includes(mustContain)) {
    throw new Error(`${file}: the block from ${JSON.stringify(startLine)} no longer mentions ${mustContain}; the template changed upstream`);
  }
  return lines.slice(0, i).join('\n').replace(/\n+$/, '') + '\n';
}

export const patchPostinst = text => keepEol(text, s =>
  cutFrom(s, 'if [ "@@NAME@@" != "code-oss" ]', 'packages.microsoft.com', 'postinst.template'));

export const patchPostrm = text => keepEol(text, s =>
  cutFrom(s, 'RET=true', 'add-microsoft-repo', 'postrm.template'));

export function patchTemplates(text) {
  if (!text.includes('add-microsoft-repo')) throw new Error('templates.template: no add-microsoft-repo question; the template changed upstream');
  return '';
}

export function patchControl(text) {
  return keepEol(text, s => {
    const f = 'control.template';
    s = swap(s, 'Package: @@NAME@@\n', 'Package: null-ide\n', f);
    s = swap(s, /^Maintainer: .*$/m, `Maintainer: ${MAINTAINER}`, f);
    s = swap(s, /^Homepage: .*$/m, `Homepage: ${HOMEPAGE}`, f);
    s = swap(s, /^Provides: visual-studio-@@NAME@@\nConflicts: visual-studio-@@NAME@@\nReplaces: visual-studio-@@NAME@@\n/m, '', f);
    const at = s.search(/^Description:/m);
    if (at < 0) throw new Error(`${f}: no Description field; the template changed upstream`);
    if (!s.slice(at).split('\n').slice(1).every(l => l === '' || l.startsWith(' '))) {
      throw new Error(`${f}: Description is no longer the last field; the template changed upstream`);
    }
    return s.slice(0, at) + DESCRIPTION;
  });
}

export function patchAppdata(text) {
  return keepEol(text, s => {
    const f = 'code.appdata.xml';
    s = swap(s, '<url type="homepage">https://code.visualstudio.com</url>', `<url type="homepage">${HOMEPAGE}</url>`, f);
    s = swap(s, '<summary>Visual Studio Code. Code editing. Redefined.</summary>', '<summary>Null IDE. A code editor built on VSCodium.</summary>', f);
    s = swap(s, /<p>Visual Studio Code is[^\n]*<\/p>/, `<p>Null IDE is a code editor built on VSCodium, the telemetry-free build of VS Code. See ${HOMEPAGE} for installation instructions and release notes.</p>`, f);
    return swap(s, /\n\t<screenshots>[\s\S]*?<\/screenshots>/, '', f);
  });
}

export function applyToTree(vscodeSrc) {
  const linux = path.join(vscodeSrc, 'resources', 'linux');
  const edits = [
    ['debian/postinst.template', patchPostinst],
    ['debian/postrm.template', patchPostrm],
    ['debian/templates.template', patchTemplates],
    ['debian/control.template', patchControl],
    ['code.appdata.xml', patchAppdata],
  ];
  for (const [rel, fn] of edits) {
    const file = path.join(linux, rel);
    fs.writeFileSync(file, fn(fs.readFileSync(file, 'utf8')));
    console.log(`rewrote ${rel}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error('usage: linux-deb-metadata.mjs <vscode-src>'); process.exit(2); }
  applyToTree(process.argv[2]);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test scripts/linux-deb-metadata.test.mjs`
Expected: PASS (8 tests; the real-template test runs on this machine because `../vscode-src` exists). Note: the `drift` assertion `patchPostinst(... echo nothing ...)` must throw because the block lacks `packages.microsoft.com`.

- [ ] **Step 5: Commit**

```bash
git add scripts/linux-deb-metadata.mjs scripts/linux-deb-metadata.test.mjs
git commit -m "feat(linux): rewrite VS Code's Debian templates so the deb never registers Microsoft's apt repo"
```

---

### Task 5: Linux smoke test script

**Files:**
- Create: `scripts/linux-smoke.sh`

**Interfaces:**
- Consumes: the tarball and deb produced by Task 6, the overlay checkout (for the built-in extension list) and the expected release version.
- Produces: exit 0 only when every check passes; failures print `::error::smoke: …`. CLI: `scripts/linux-smoke.sh <tarball> <deb> <overlay-dir> <version>`.

- [ ] **Step 1: Write the script**

`scripts/linux-smoke.sh` (must be LF; `.gitattributes` already forces it for `*.sh`):

```bash
#!/usr/bin/env bash
# Smoke test for the Linux release artifacts (#119); runs in the build-linux CI job.
# Usage: linux-smoke.sh <tarball> <deb> <overlay-dir> <version>
set -euo pipefail

tarball=$(realpath "$1"); deb=$(realpath "$2"); overlay=$(realpath "$3"); version=$4
work=$(mktemp -d)
app_pid=
cleanup() {
  [ -z "$app_pid" ] || kill "$app_pid" 2>/dev/null || true
  pkill -f "$work/app/null" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
fail() { echo "::error::smoke: $*" >&2; exit 1; }
step() { echo "── $*"; }

# ── tarball ────────────────────────────────────────────────────────────────
step "tarball layout"
app="$work/app"; mkdir "$app"; tar -xzf "$tarball" -C "$app"
[ -x "$app/null" ] || fail "no executable 'null' at the tarball root"
[ -x "$app/bin/null" ] || fail "no bin/null launcher"
node -e '
  const [dir, version] = process.argv.slice(1);
  const p = require(dir + "/resources/app/product.json");
  const m = require(dir + "/.null-ide-install.json");
  if (p.applicationName !== "null") throw new Error("applicationName=" + p.applicationName);
  if (m.version !== version) throw new Error("install metadata version=" + m.version + ", expected " + version);
' "$app" "$version" || fail "product.json or .null-ide-install.json is wrong"

step "built-in extensions"
missing=()
for d in "$overlay"/extensions/null-*/; do
  name=$(basename "$d")
  [ -f "$app/resources/app/extensions/$name/package.json" ] || missing+=("$name")
done
for name in code-spell-checker open-remote-wsl open-remote-ssh; do
  [ -f "$app/resources/app/extensions/$name/package.json" ] || missing+=("$name")
done
[ "${#missing[@]}" -eq 0 ] || fail "missing built-in extensions: ${missing[*]}"

step "CLI"
"$app/bin/null" --version || fail "null --version failed"

step "launch under xvfb"
mkdir "$work/ud" "$work/ext" "$work/project"
xvfb-run -a "$app/null" --no-sandbox --disable-gpu --user-data-dir "$work/ud" --extensions-dir "$work/ext" "$work/project" &
app_pid=$!
sleep 25
kill -0 "$app_pid" 2>/dev/null || fail "the app exited within 25 seconds"
[ -d "$work/ud/logs" ] || fail "the app wrote no logs"
if grep -rE "Activating extension '[^']+' failed" "$work/ud/logs"; then fail "an extension failed to activate (lines above)"; fi
kill "$app_pid" 2>/dev/null || true; app_pid=
pkill -f "$app/null" 2>/dev/null || true

# ── deb ────────────────────────────────────────────────────────────────────
step "deb metadata"
ctl="$work/ctl"; mkdir "$ctl"; dpkg-deb -e "$deb" "$ctl"
# capture first: `cmd | grep -q` can SIGPIPE the writer and trip pipefail
info=$(dpkg-deb -I "$deb")
grep -q "^ Package: null-ide$" <<<"$info" || fail "the deb's package name is not null-ide"
if grep -rEi "packages\.microsoft\.com|microsoft\.gpg|add-microsoft-repo" "$ctl"; then fail "the deb still registers Microsoft's apt repository"; fi
if grep -qi "^Maintainer:.*microsoft" "$ctl/control"; then fail "the deb's maintainer is Microsoft"; fi

step "install / remove / purge"
sudo apt-get install -y "$deb"
[ -x /usr/bin/null ] || fail "/usr/bin/null missing after install"
[ -f /usr/share/applications/null.desktop ] || fail "desktop entry missing"
files=$(dpkg -L null-ide)
grep -q "pixmaps/null.png" <<<"$files" || fail "icon missing"
/usr/bin/null --version >/dev/null || fail "the installed null --version failed"
if [ -e /usr/share/keyrings/microsoft.gpg ] || [ -e /etc/apt/sources.list.d/vscode.sources ]; then fail "Microsoft's apt repository was registered"; fi
sudo apt-get remove -y null-ide
[ ! -e /usr/bin/null ] || fail "/usr/bin/null remains after remove"
sudo apt-get purge -y null-ide

echo "smoke: all checks passed"
```

- [ ] **Step 2: Syntax-check and mark executable**

Run: `bash -n scripts/linux-smoke.sh && git update-index --chmod=+x --add scripts/linux-smoke.sh`
Expected: no output. (The script itself can only run on Linux in CI; if `shellcheck` is installed run `shellcheck scripts/linux-smoke.sh` and fix findings.)

- [ ] **Step 3: Commit**

```bash
git add scripts/linux-smoke.sh
git commit -m "ci(linux): smoke test for the tarball and deb"
```

---

### Task 6: The `build-linux` job

**Files:**
- Modify: `.github/workflows/build.yml` (`workflow_dispatch.inputs`; append a `build-linux` job after `build-windows`)

**Interfaces:**
- Consumes: `scripts/linux-deb-metadata.mjs` and its test (Task 4), `scripts/linux-smoke.sh` (Task 5), `scripts/merge-json.js`, the overlay patches, extensions, icons and workbench assets.
- Produces: artifacts `null-ide-linux-x64-<tag>.tar.gz`, `.tar.gz.sha256`, `null-ide-linux-x64-<tag>.deb`, uploaded to the release (tag builds) and as workflow artifact `null-ide-linux-x64-<vscodium tag>`.

Linux cannot be exercised locally; this task is verified by YAML validity here and by the CI run in Task 8.

- [ ] **Step 1: Add the dispatch input**

Under `on.workflow_dispatch.inputs`, after `use_esbuild`, add:

```yaml
      build_linux:
        description: 'Also build the Linux x64 packages (tag pushes always build them)'
        type: boolean
        default: true
```

- [ ] **Step 2: Add the job header, prep and patch steps**

Append at the end of `build.yml` (two-space indent like the rest; this is the first half of the job):

```yaml
  # ── Linux x64: same overlay, packaged as tar.gz + .deb (#119) ─────────────
  # Independent of build-windows: a failure here never blocks the Windows release.
  build-linux:
    name: Build Linux x64
    if: github.event_name != 'workflow_dispatch' || github.event.inputs.build_linux != 'false'
    runs-on: ubuntu-22.04
    timeout-minutes: 150
    permissions:
      contents: write
    env:
      VSCODE_ARCH: x64
      npm_config_arch: x64
      VSCODE_SKIP_NODE_VERSION_CHECK: '1'
      VSCODE_SYSROOT_PREFIX: '-glibc-2.28-gcc-10.5.0'
    steps:
      - uses: actions/checkout@v4
        with:
          path: ide-overlay

      - name: Free disk space
        run: sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /opt/hostedtoolcache/CodeQL

      - name: Install system packages
        run: |
          sudo apt-get update -y
          sudo apt-get install -y libkrb5-dev libx11-dev libxkbfile-dev libsecret-1-dev fakeroot dpkg-dev xvfb python-is-python3 \
            libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxtst6

      - name: Resolve tags
        id: tag
        shell: bash
        env:
          INPUT_TAG: ${{ github.event.inputs.vscodium_tag }}
          REF_TYPE: ${{ github.ref_type }}
          REF_NAME: ${{ github.ref_name }}
        run: |
          tag="$INPUT_TAG"
          [ -n "$tag" ] || tag=$(tr -d '[:space:]' < ide-overlay/VSCODIUM_TAG)
          # asset version: the pushed tag on tag builds, else the VSCodium tag (same rule as the Windows job)
          if [ "$REF_TYPE" = tag ]; then version="$REF_NAME"; else version="$tag"; fi
          echo "tag=$tag" >> "$GITHUB_OUTPUT"
          echo "version=$version" >> "$GITHUB_OUTPUT"

      - name: Clone VSCodium and VS Code
        shell: bash
        env:
          TAG: ${{ steps.tag.outputs.tag }}
        run: |
          git clone https://github.com/VSCodium/vscodium --depth=1 --branch "$TAG" vscodium-src
          ms_tag=$(jq -r .tag vscodium-src/upstream/stable.json)
          echo "MS_TAG=$ms_tag" >> "$GITHUB_ENV"
          git clone https://github.com/microsoft/vscode --depth=1 --branch "$ms_tag" vscode-src

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: 'vscode-src/.nvmrc'
          cache: 'npm'
          cache-dependency-path: vscode-src/package-lock.json

      - name: Restore VS Code node_modules cache
        id: vscode-node-modules-cache
        uses: actions/cache/restore@v4
        with:
          path: |
            vscode-src/node_modules
            vscode-src/build/node_modules
            vscode-src/build/*/node_modules
            vscode-src/extensions/node_modules
            vscode-src/extensions/*/node_modules
            vscode-src/extensions/*/server/node_modules
            vscode-src/remote/node_modules
            vscode-src/remote/web/node_modules
            vscode-src/test/*/node_modules
            vscode-src/test/integration/browser/node_modules
            vscode-src/.vscode/extensions/*/node_modules
            vscode-src/.build/sysroots
          key: ${{ runner.os }}-vscode-node-modules-linux-v1-${{ steps.tag.outputs.tag }}-${{ env.MS_TAG }}-${{ hashFiles('vscode-src/package-lock.json') }}

      - name: Apply VSCodium patches
        # Same set VSCodium's prepare_vscode.sh / package_bin.sh apply for a Linux client, with its
        # !!PLACEHOLDER!! values filled in the way utils.sh apply_patch does (Null's values).
        shell: bash
        working-directory: vscode-src
        env:
          USE_ESBUILD: ${{ github.event.inputs.use_esbuild }}
          RELEASE_VERSION: ${{ steps.tag.outputs.tag }}
        run: |
          skip=()
          # VSCodium forces tsc transpilation (35+ min, huge heap); skipping keeps upstream's esbuild path.
          [ "$USE_ESBUILD" = false ] || skip+=(00-build-disable-esbuild.patch)
          for dir in patches patches/linux patches/linux/client; do
            for p in $(ls ../vscodium-src/$dir/*.patch | sort); do
              name=$(basename "$p")
              if [[ " ${skip[*]:-} " == *" $name "* ]]; then continue; fi
              echo "Applying: $dir/$name"
              sed -e 's|!!APP_NAME!!|Null|g' -e 's|!!APP_NAME_LC!!|null|g' \
                  -e 's|!!ASSETS_REPOSITORY!!|TorresVisual/null-ide|g' -e 's|!!BINARY_NAME!!|null|g' \
                  -e 's|!!GH_REPO_PATH!!|TorresVisual/null-ide|g' -e 's|!!GLOBAL_DIRNAME!!|null|g' \
                  -e 's|!!ORG_NAME!!|Null|g' -e "s|!!RELEASE_VERSION!!|$RELEASE_VERSION|g" \
                  -e 's|!!TUNNEL_APP_NAME!!|null-tunnel|g' "$p" | git apply --ignore-whitespace -
            done
          done

      - name: Apply overlay patches
        shell: bash
        working-directory: vscode-src
        run: |
          for p in $(ls ../ide-overlay/patches/*.patch | sort); do
            echo "Applying overlay patch: $(basename "$p")"
            git apply --ignore-whitespace "$p" || { echo "::error::Overlay patch $(basename "$p") does not apply"; exit 1; }
          done

      - name: Merge product.json overlay
        run: node ide-overlay/scripts/merge-json.js vscode-src/product.json ide-overlay/product.json vscode-src/product.json
```

- [ ] **Step 3: Add extension, bundling and asset steps**

Continue the job:

```yaml
      - name: Compile extensions
        shell: bash
        run: |
          npm ci --prefix ide-overlay/extensions/null-markdown
          npm run build --prefix ide-overlay/extensions/null-markdown
          for ext in null-tools null-cpp null-actions null-accounts null-format null-music null-activity null-startup null-env null-sync; do
            (cd "ide-overlay/extensions/$ext" && npm ci --ignore-scripts && npm run compile)
          done

      - name: Copy built-in extensions
        shell: bash
        run: |
          for ext in null-theme null-tools null-icons null-markdown null-cpp null-actions null-accounts null-format null-music null-activity null-startup null-env null-sync; do
            cp -r "ide-overlay/extensions/$ext" vscode-src/extensions/
          done
          # CLAUDE.md files are agent notes, not extension content
          rm -f vscode-src/extensions/null-*/CLAUDE.md
```

Then **copy these three `build-windows` steps verbatim** (they are platform-neutral PowerShell; Ubuntu runners ship `pwsh`, and each already declares `shell: pwsh`), inserting them in this order directly after `Copy built-in extensions`:

1. `Bundle Code Spell Checker as built-in extension` (build-windows lines 251-299)
2. `Bundle open-remote (WSL + SSH) as built-in extensions` (lines 301-337)
3. `Inject custom assets into workbench.html` (lines 367-379)

Then add the Linux-specific asset step:

```yaml
      - name: Replace icons and copy workbench assets
        shell: bash
        run: |
          # Title bar logo, the Linux package/window icon (pixmaps/null.png), and the injected CSS/JS
          cp ide-overlay/icons/icon.svg vscode-src/src/vs/workbench/browser/media/code-icon.svg
          cp ide-overlay/icons/icon.png vscode-src/resources/linux/code.png
          wb=vscode-src/src/vs/code/electron-browser/workbench
          cp ide-overlay/workbench/custom.css "$wb/null-custom.css"
          cp ide-overlay/workbench/splash.js  "$wb/null-splash.js"
```

NOTE: `Inject custom assets into workbench.html` must run **after** the `cp` above (it edits `workbench.html` only, so order versus the copies does not matter, but keep both before `npm ci`).

- [ ] **Step 4: Add install, build and metadata steps**

Continue the job:

```yaml
      - name: Install dependencies
        if: steps.vscode-node-modules-cache.outputs.cache-hit != 'true'
        shell: bash
        working-directory: vscode-src
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          # setup-env.sh downloads the sysroot and exports the CC/CXX/LDFLAGS the native modules need
          source ./build/azure-pipelines/linux/setup-env.sh
          npm ci --prefer-offline --no-audit --fund=false

      - name: Save VS Code node_modules cache
        if: steps.vscode-node-modules-cache.outputs.cache-hit != 'true'
        uses: actions/cache/save@v4
        with:
          path: |
            vscode-src/node_modules
            vscode-src/build/node_modules
            vscode-src/build/*/node_modules
            vscode-src/extensions/node_modules
            vscode-src/extensions/*/node_modules
            vscode-src/extensions/*/server/node_modules
            vscode-src/remote/node_modules
            vscode-src/remote/web/node_modules
            vscode-src/test/*/node_modules
            vscode-src/test/integration/browser/node_modules
            vscode-src/.vscode/extensions/*/node_modules
            vscode-src/.build/sysroots
          key: ${{ steps.vscode-node-modules-cache.outputs.cache-primary-key }}
```

Then **copy these two `build-windows` steps verbatim** after `Save VS Code node_modules cache`: `Install @anthropic-ai/sdk (required by VS Code agentHost source)` and `Remove agentHost files that import @github/copilot-sdk` (lines 417-463; both platform-neutral). Then:

```yaml
      - name: Build
        shell: bash
        working-directory: vscode-src
        env:
          NODE_OPTIONS: --max-old-space-size=8192
          VSCODE_QUALITY: stable
          # build/lib/fetch.ts sends this as HTTP Basic, so it must be user:token
          GITHUB_TOKEN: x-access-token:${{ secrets.GITHUB_TOKEN }}
        run: |
          source ./build/azure-pipelines/linux/setup-env.sh
          npx gulp vscode-linux-x64

      - name: Fetch VSCodium server commit hash
        id: vscodium-commit
        shell: bash
        env:
          TAG: ${{ steps.tag.outputs.tag }}
        run: |
          curl -fsSL -o reh.tar.gz "https://github.com/VSCodium/vscodium/releases/download/$TAG/vscodium-reh-linux-x64-$TAG.tar.gz"
          mkdir server-extract
          tar -xzf reh.tar.gz -C server-extract ./product.json 2>/dev/null || tar -xzf reh.tar.gz -C server-extract product.json
          commit=$(node -p 'require("./server-extract/product.json").commit')
          echo "VSCodium server commit: $commit"
          echo "commit=$commit" >> "$GITHUB_OUTPUT"
          rm -rf reh.tar.gz server-extract

      - name: Stamp product.json and install metadata
        # Before the deb is built: the deb copies VSCode-linux-x64. Without .null-ide-install.json
        # null-tools reports version "local" and offers an update on every start.
        shell: bash
        env:
          TAG: ${{ steps.tag.outputs.tag }}
          VERSION: ${{ steps.tag.outputs.version }}
          COMMIT: ${{ steps.vscodium-commit.outputs.commit }}
          REPO: ${{ github.repository }}
          IS_TAG: ${{ github.ref_type == 'tag' }}
        run: |
          node -e '
            const fs = require("fs");
            const e = process.env;
            const f = "VSCode-linux-x64/resources/app/product.json";
            const p = JSON.parse(fs.readFileSync(f, "utf8"));
            p.version = e.TAG;
            p.commit = e.COMMIT;
            p.release = e.IS_TAG === "true" ? e.VERSION : e.TAG;
            p.serverDownloadUrlTemplate = "https://github.com/TorresVisual/null-ide/releases/download/${release}/null-reh-${os}-${arch}.tar.gz";
            p.webviewContentExternalBaseUrlTemplate = "https://{{uuid}}.vscode-cdn.net/stable/" + e.COMMIT + "/out/vs/workbench/contrib/webview/browser/pre/";
            fs.writeFileSync(f, JSON.stringify(p, null, 2));
            fs.writeFileSync("VSCode-linux-x64/.null-ide-install.json",
              JSON.stringify({ repo: e.REPO, version: e.VERSION, installedAt: null, installDir: null }, null, 2));
          '

      - name: Fix letterpress and workbench overlay files in the build output
        shell: bash
        run: |
          media=VSCode-linux-x64/resources/app/out/media
          for v in letterpress-dark letterpress-hcDark; do cp ide-overlay/workbench/letterpress-dark.svg "$media/$v.svg"; done
          for v in letterpress-light letterpress-hcLight; do cp ide-overlay/workbench/letterpress-light.svg "$media/$v.svg"; done
          wb=VSCode-linux-x64/resources/app/out/vs/code/electron-browser/workbench
          [ -d "$wb" ] || { echo "::error::Build output workbench directory not found: $wb"; exit 1; }
          cp ide-overlay/workbench/custom.css "$wb/null-custom.css"
          cp ide-overlay/workbench/splash.js  "$wb/null-splash.js"
```

- [ ] **Step 5: Add packaging, smoke and publish steps**

Finish the job:

```yaml
      - name: Test and apply Debian template rewrite
        shell: bash
        run: |
          # The test reads the pristine templates, so it must run before the rewrite.
          node --test ide-overlay/scripts/linux-deb-metadata.test.mjs
          node ide-overlay/scripts/linux-deb-metadata.mjs vscode-src

      - name: Build the deb
        shell: bash
        working-directory: vscode-src
        run: |
          npx gulp vscode-linux-x64-prepare-deb
          npx gulp vscode-linux-x64-build-deb

      - name: Package artifacts
        shell: bash
        env:
          VERSION: ${{ steps.tag.outputs.version }}
        run: |
          debs=(vscode-src/.build/linux/deb/amd64/deb/null-ide_*.deb)
          [ "${#debs[@]}" -eq 1 ] || { echo "::error::expected exactly one deb, found ${#debs[@]}"; exit 1; }
          mv "${debs[0]}" "null-ide-linux-x64-$VERSION.deb"
          tar -czf "null-ide-linux-x64-$VERSION.tar.gz" -C VSCode-linux-x64 .
          sha256sum "null-ide-linux-x64-$VERSION.tar.gz" > "null-ide-linux-x64-$VERSION.tar.gz.sha256"
          ls -l null-ide-linux-x64-*

      - name: Smoke test
        shell: bash
        env:
          VERSION: ${{ steps.tag.outputs.version }}
        run: bash ide-overlay/scripts/linux-smoke.sh "null-ide-linux-x64-$VERSION.tar.gz" "null-ide-linux-x64-$VERSION.deb" ide-overlay "$VERSION"

      - name: Publish release assets
        if: startsWith(github.ref, 'refs/tags/')
        shell: bash
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAG: ${{ github.ref_name }}
        run: |
          # Whichever job reaches the release first creates it; only build-windows ever sets the body.
          gh release create "$TAG" --title "$TAG" --notes "" --repo "$GITHUB_REPOSITORY" || true
          gh release upload "$TAG" null-ide-linux-x64-*.tar.gz null-ide-linux-x64-*.tar.gz.sha256 null-ide-linux-x64-*.deb --clobber --repo "$GITHUB_REPOSITORY"

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: null-ide-linux-x64-${{ steps.tag.outputs.tag }}
          path: |
            null-ide-linux-x64-*.tar.gz
            null-ide-linux-x64-*.tar.gz.sha256
            null-ide-linux-x64-*.deb
          if-no-files-found: error
          retention-days: 30
```

- [ ] **Step 6: Validate the workflow syntax**

Run: `node -e "require('child_process'); const y=require('fs').readFileSync('.github/workflows/build.yml','utf8'); console.log(y.split('\n').length+' lines')"` and, if `actionlint` is installed, `actionlint .github/workflows/build.yml`; otherwise `npx --yes yaml-lint .github/workflows/build.yml`.
Expected: no syntax errors. Also confirm the verbatim-copied steps appear exactly once in `build-linux`: `grep -c "Bundle Code Spell Checker" .github/workflows/build.yml` → `2` (one per job).

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci(linux): build, smoke-test and release a Linux x64 tar.gz and deb"
```

---

### Task 7: Documentation

**Files:**
- Create: `docs/wiki/Linux.md`
- Create: `docs/linux-verification.md`
- Modify: `docs/wiki/_Sidebar.md`, `docs/wiki/Getting-Started.md`, `docs/wiki/Development.md`, `README.md`, `CLAUDE.md`, `extensions/null-tools/CLAUDE.md`, `docs/specs/linux-build-design.md` (status line)

- [ ] **Step 1: Write the wiki page**

`docs/wiki/Linux.md` must cover, in this order: supported formats (x64 `.tar.gz`, `.deb`) and baseline (glibc 2.28+, i.e. Debian 10 / Ubuntu 20.04 and newer); **Install**: `sudo apt install ./null-ide-linux-x64-<tag>.deb` (installs to `/usr/share/null`, `/usr/bin/null`, desktop entry and `null://` handler) and the tarball (`mkdir null-ide && tar -xzf null-ide-linux-x64-<tag>.tar.gz -C null-ide && ./null-ide/null`, verify with `sha256sum -c`); **Launch**: `null .`; **Uninstall**: `sudo apt remove null-ide` (`purge` too), tarball: delete the folder, and note that `~/.config/Null` (settings, extensions) is kept; **Updating**: manual — the status-bar button opens the release page; **Runtime dependencies** the `.deb` declares automatically (GTK 3, NSS, libsecret, libnotify, X11 libs) and the sandbox note (Ubuntu 24.04+ restricts unprivileged user namespaces: if the window does not open run `./null --no-sandbox` or install the `.deb`, whose package sets up the sandbox helper); **Known limitations**: Ports view and Open in Null Notes are Windows-only, no self-update, no Explorer/Windows shell integration, first-run wizard choices are Windows-only; **Troubleshooting** pointer to `Troubleshooting.md`. Add `- [Linux](Linux)` to `_Sidebar.md` and a one-line pointer in `Getting-Started.md`.

- [ ] **Step 2: Write the manual verification checklist**

`docs/linux-verification.md`: a table the user runs once on a real distro (WSL2 with WSLg covers rows 1-9 but not 10-12). Columns: `#`, `Check`, `Expected`, `Result`. Rows: 1 install the `.deb` with `apt install` (no Microsoft repo added: `ls /etc/apt/sources.list.d`); 2 `null --version` prints the VSCodium version; 3 `null .` opens a window with the Null Dark theme and the Null Dashboard; 4 open a file, edit, save, undo; 5 integrated terminal opens `$SHELL`, `echo $TERM_PROGRAM`, run `ls`; 6 install an extension from the marketplace (e.g. clangd) and see it activate; 7 Settings → change a setting, restart, it persists in `~/.config/Null`; 8 open a C++ project: Alt+O switches header/source (null-cpp); 9 Null: Check for Updates shows the release-page prompt, no error; 10 application menu entry and icon present; 11 `xdg-open` a `null://` URL reaches the app; 12 `sudo apt remove null-ide` removes `/usr/bin/null` and the menu entry. Each failing row becomes a GitHub issue.

- [ ] **Step 3: Update README, CLAUDE.md and the spec**

- `README.md` Install section: add a `### Linux` subsection linking `docs/wiki/Linux.md` with the two install commands from Step 1.
- `docs/wiki/Development.md`: add a "Linux build" paragraph (job name, formats, smoke test, `build_linux` input).
- `CLAUDE.md`: in "Project Overview" replace "Windows desktop code editor" with "desktop code editor (Windows, plus a Linux x64 tar.gz/deb)"; in "How the Build Works" add a **Linux** note: `build-linux` job, `ubuntu-22.04`, VSCodium `patches/` + `patches/linux/` (+`client/`) with `!!PLACEHOLDER!!` substitution, `gulp vscode-linux-x64` + deb tasks, `scripts/linux-deb-metadata.mjs` (removes Microsoft's apt repo registration), `scripts/linux-smoke.sh`, assets `null-ide-linux-x64-<tag>.{tar.gz,deb}` and the Windows asset rename; in "Repository Layout/scripts" mention both new scripts.
- `extensions/null-tools/CLAUDE.md`: append to the **In-app updater** row: "On Linux the updater only checks for `null-ide-linux-x64-*.tar.gz` and opens the release page (`canSelfUpdate`); `nullDataDir()` is the per-OS Null user-data folder."
- `docs/specs/linux-build-design.md`: change `Status: design, awaiting review.` to `Status: implemented (see docs/plans/linux-build.md); manual verification in docs/linux-verification.md.`

- [ ] **Step 4: Refresh the knowledge graph**

Run: `graphify update .`
Expected: completes without error (AST-only).

- [ ] **Step 5: Commit**

```bash
git add docs README.md CLAUDE.md extensions/null-tools/CLAUDE.md
git commit -m "docs(linux): install, uninstall and verification guides; document the Linux build"
```

---

### Task 8: First CI run, iteration and Windows regression check

No new files; this task is the verification loop the spec calls for. It needs the user to push, because commits here never push.

- [ ] **Step 1: Ask the user to push and dispatch**

Ask the user to run:

```bash
git push -u origin linux-build
gh workflow run build.yml --ref linux-build -f build_linux=true
```

- [ ] **Step 2: Watch and read failures**

Run: `gh run list --workflow build.yml --branch linux-build --limit 1` then `gh run view <id> --log-failed`.
Expected on the first pass: failures are likely in `Build` (sysroot/gulp environment), `Apply VSCodium patches` or `Smoke test`. Fix each in the file that owns it, commit as `fix(ci): …`, ask the user to push again, repeat. Known candidates, in the order they will appear: a VSCodium Linux patch that conflicts with an overlay patch (009 safe-mode vs `patches/linux/00-log-use-state-home.patch`); `python` missing for `setup-env.sh`; `getDependencies` needing sysroot variables during `prepare-deb`; an empty `DEBIAN/templates` rejected by `apt-get install`; Electron needing `--no-sandbox` flags in the launch test; an extension logging `Activating extension … failed` on Linux.

- [ ] **Step 3: Confirm the Windows job**

When the run is green, check the `Build Windows x64` job of the same run: it must be green and its artifact must contain `null-ide-win32-x64-<tag>.zip` (+ `.sha256`), `builtins.json`, `NullIDESetup-*.exe`, `null-reh-linux-*.tar.gz`. Run `gh run download <id> -n null-ide-win32-x64-<vscodium tag>` and `unzip -l` the zip to confirm `null.exe` is at its root.

- [ ] **Step 4: Tag-path rehearsal**

Ask the user to push a throwaway tag (e.g. `v0.0.0-linux-test`, deleted afterwards) or use `scripts/repush-tag.ps1`, and confirm: one release with all Windows and Linux assets, release notes present, no duplicate releases. Delete the test release and tag.

- [ ] **Step 5: Hand the manual checklist to the user**

Give the user `docs/linux-verification.md` and the built `.deb`/tarball. Record the results in the file's Result column, file one issue per failing row, and only then ask whether to merge `linux-build` into `main`.

- [ ] **Step 6: Acceptance criteria check**

Tick against issue #119: built and packaged on Linux (green `build-linux`); documented format available (`Linux.md`); integrated into the release workflow (Step 4); artifacts alongside Windows (Step 4); icons / desktop entry / launch (smoke + checklist 10-11); core editor, terminal, extensions tested (checklist 3-8); dependencies documented (`Linux.md`); Windows still works (Step 3).

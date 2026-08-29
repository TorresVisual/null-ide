# Local Verification Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Let a source change be pushed into the real, already-installed local Null IDE and verified against the actual `vscode` API — without running the CI-only full VSCodium build — and let that verification be triggered as one Claude skill invocation.

**Architecture:** A PowerShell sync script compiles and copies the 7 built-in extensions plus workbench CSS/JS into `%LOCALAPPDATA%\Programs\Null IDE`. A `@vscode/test-electron`-based integration-spec harness (piloted on `null-actions`) launches that exact synced install in a real Extension Development Host and runs Mocha specs against it. A project-scoped Claude skill chains the two into a single "verify this" action.

**Tech Stack:** Windows PowerShell 5.1, TypeScript 5.8 (existing per-extension `tsc` compile), `@vscode/test-electron` ^3.1.0, `mocha` ^11.8.0, `@types/mocha` ^10.0.10, `glob` ^13.0.6.

**Spec:** `docs/specs/local-verification-tooling-design.md`

## Global Constraints

- Not a replacement for the CI build — `shell-ext/` (native C++ DLL), `product.json`/icon stamping, and the installer are untouched; still require a real release build.
- Sync is manual, one-shot only — no watch mode, no auto-relaunch.
- Integration specs run against the developer's real `%APPDATA%\Null` profile and real installed extensions, not a sandboxed user-data-dir. Only the test *workspace folder* is disposable.
- Only `null-actions` gets integration specs in this pass. The other six built-in extensions are untouched.
- No CI wiring — this is local-only tooling.
- `sync-local.ps1` never silently runs `npm ci`; if an extension's `node_modules` is missing, it warns and skips that extension rather than installing anything.

---

## File Structure

- Create: `scripts/sync-local.ps1` — the sync script (Task 1).
- Create: `extensions/null-actions/src/test/runTest.ts` — Node entry point that launches the synced install via `@vscode/test-electron` (Task 2).
- Create: `extensions/null-actions/src/test/suite/index.ts` — Mocha TDD loader, globs `**/*.spec.js` (Task 2).
- Create: `extensions/null-actions/src/test/suite/activation.spec.ts` — first integration spec (Task 2).
- Modify: `extensions/null-actions/tsconfig.json` — add the three new files to `include` (Task 2).
- Modify: `extensions/null-actions/package.json` — add `@vscode/test-electron`, `mocha`, `@types/mocha`, `glob` devDependencies and `pretest:integration`/`test:integration` scripts (Task 2).
- Create: `.claude/skills/verify-local/SKILL.md` — the Claude-invocable trigger (Task 3).

---

### Task 1: `scripts/sync-local.ps1`

**Files:**
- Create: `scripts/sync-local.ps1`

**Interfaces:**
- Produces: a script invocable as `scripts/sync-local.ps1 [-InstallDir <path>]` (default `"$env:LOCALAPPDATA\Programs\Null IDE"`). Task 2's `runTest.ts` depends on this script having been run at least once so `resources\app\extensions\null-actions\out\extension.js` reflects current source.

- [x] **Step 1: Write the script**

Create `scripts/sync-local.ps1`:

```powershell
<#
Syncs compiled extension output and workbench assets from this repo into an
already-installed local Null IDE, without running the full CI build.

Does NOT touch shell-ext/, product.json, or icons — those still need a real
release build (see .github/workflows/build.yml).
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Null IDE"
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message"
}

function Test-NullIdeRunning {
    param([string]$Destination)

    $processes = Get-Process -Name "null" -ErrorAction SilentlyContinue
    if (-not $processes) {
        return $false
    }

    $destinationFullPath = [System.IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'

    foreach ($process in $processes) {
        try {
            $processPath = $process.MainModule.FileName
            if ($processPath -and $processPath.StartsWith($destinationFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $true
            }
        }
        catch {
            if (Test-Path (Join-Path $Destination "null.exe")) {
                return $true
            }
        }
    }

    return $false
}

function Copy-ExtensionPath {
    param(
        [string]$SourceRoot,
        [string]$DestRoot,
        [string]$RelativePath
    )

    $source = Join-Path $SourceRoot $RelativePath
    if (-not (Test-Path $source)) {
        return
    }

    $dest = Join-Path $DestRoot $RelativePath

    if ((Get-Item $source).PSIsContainer) {
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        robocopy $source $dest /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) {
            throw "robocopy failed copying '$source' to '$dest' (exit $LASTEXITCODE)."
        }
    }
    else {
        $destParent = Split-Path -Parent $dest
        New-Item -ItemType Directory -Path $destParent -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $dest -Force
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$extensionsSrc = Join-Path $repoRoot "extensions"
$installFullPath = [System.IO.Path]::GetFullPath($InstallDir)
$installExtensionsDir = Join-Path $installFullPath "resources\app\extensions"

if (-not (Test-Path $installExtensionsDir)) {
    throw "Null IDE install not found at '$installFullPath'. Run scripts/install-null-ide.ps1 first."
}

if (Test-NullIdeRunning -Destination $installFullPath) {
    Write-Warning "Null IDE is running. Files will sync underneath it - reload the window afterward to pick up changes."
}

# name -> compile step + subpaths to copy into resources\app\extensions\<name>\ afterward
$Extensions = [ordered]@{
    "null-theme"     = @{ Compile = $false; Copy = @("package.json", "themes") }
    "null-icons"     = @{ Compile = $false; Copy = @("package.json", "src") }
    "null-markdown"  = @{ Compile = $false; Copy = @("package.json", "extension.js", "preview") }
    "null-tools"     = @{ Compile = $true;  CompileScript = "compile"; Copy = @("package.json", "out", "lib") }
    "null-cpp"       = @{ Compile = $true;  CompileScript = "compile"; Copy = @("package.json", "out") }
    "null-actions"   = @{ Compile = $true;  CompileScript = "compile"; Copy = @("package.json", "out", "lib") }
    "wooting-analog" = @{ Compile = $true;  CompileScript = "build";   Copy = @("package.json", "out"); NativeCheck = $true }
}

foreach ($name in $Extensions.Keys) {
    $info = $Extensions[$name]
    $srcDir = Join-Path $extensionsSrc $name
    $destDir = Join-Path $installExtensionsDir $name

    Write-Step "Syncing $name"

    if ($info.NativeCheck) {
        $nativeAddon = Get-ChildItem -Path (Join-Path $srcDir "native") -Filter "*.node" -File -ErrorAction SilentlyContinue
        if (-not $nativeAddon) {
            Write-Warning "$name - native addon not built (extensions/$name/native/*.node missing). Run extensions/$name/setup.ps1 first. Skipping."
            continue
        }
    }

    if ($info.Compile) {
        $nodeModules = Join-Path $srcDir "node_modules"
        if (-not (Test-Path $nodeModules)) {
            Write-Warning "$name - node_modules missing. Run 'npm ci' in extensions/$name first. Skipping."
            continue
        }
    }

    try {
        if ($info.Compile) {
            Push-Location $srcDir
            try {
                npm run $info.CompileScript
                if ($LASTEXITCODE -ne 0) {
                    throw "$name - npm run $($info.CompileScript) failed (exit $LASTEXITCODE)."
                }
            }
            finally {
                Pop-Location
            }
        }

        foreach ($relativePath in $info.Copy) {
            Copy-ExtensionPath -SourceRoot $srcDir -DestRoot $destDir -RelativePath $relativePath
        }

        if ($info.NativeCheck) {
            $destNative = Join-Path $destDir "native"
            New-Item -ItemType Directory -Path $destNative -Force | Out-Null
            Get-ChildItem -Path (Join-Path $srcDir "native") -Filter "*.node" -File |
                ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $destNative -Force }
        }
    }
    catch {
        Write-Warning "$name - sync failed, skipping: $($_.Exception.Message)"
        continue
    }
}

Write-Step "Syncing workbench assets"
$workbenchDestDir = Join-Path $installFullPath "resources\app\out\vs\code\electron-browser\workbench"
if (Test-Path $workbenchDestDir) {
    Copy-Item -LiteralPath (Join-Path $repoRoot "workbench\custom.css") -Destination (Join-Path $workbenchDestDir "null-custom.css") -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot "workbench\splash.js") -Destination (Join-Path $workbenchDestDir "null-splash.js") -Force
}
else {
    Write-Warning "Workbench directory not found at '$workbenchDestDir' - skipping custom.css/splash.js sync."
}

Write-Host ""
Write-Host "Sync complete: $installFullPath"
Write-Host "In Null IDE, run 'Developer: Reload Window' to pick up the changes."
Write-Host "Note: shell-ext/, product.json, and icons are not synced by this script - those need a full CI build."
```

- [x] **Step 2: Run it against the real local install**

Run (PowerShell tool):
```powershell
powershell -ExecutionPolicy Bypass -File "d:\Coding\Apps\null-ide\scripts\sync-local.ps1"
```
Expected: exits 0, prints a `==> Syncing <name>` line for each of the 7 extensions, then `==> Syncing workbench assets`, then `Sync complete: ...`. No `Write-Warning` lines should appear if `node_modules` already exists for `null-tools`/`null-cpp`/`null-actions` and `wooting-analog`'s native addon is already built (both were true earlier in this session — verified via `ls extensions/null-actions` showing `node_modules/` and `out/`).

**Actual result (running this for real surfaced two bugs, now fixed in the script above and in the file):** `wooting-analog`'s `package.json` names its compile script `build`, not `compile` — the original hardcoded `npm run compile` failed for it, hence the `CompileScript` field per extension. And Null IDE was genuinely running during this run, which locked `wooting-analog`'s native `.node` addon — the original script let that `throw` propagate and abort the entire sync (including the still-pending workbench-asset copy); it's now caught per-extension so one locked/failed file only skips that extension, consistent with the existing missing-`node_modules`/missing-native-addon skip behavior.

- [x] **Step 3: Verify the sync actually landed**

Run:
```powershell
Get-Item "$env:LOCALAPPDATA\Programs\Null IDE\resources\app\extensions\null-actions\out\extension.js" | Select-Object LastWriteTime
```
Expected: `LastWriteTime` is within the last minute (i.e. from the `npm run compile` that just ran), not the original install timestamp. **Confirmed** — showed a timestamp from the run just performed.

- [x] **Step 4: Verify a real edit reaches the running app (manual — needs human eyes)**

Edit `extensions/null-actions/src/statusBarController.ts` (or any visible string in that extension) to change a status bar tooltip or label text to something obviously different, then run:
```powershell
powershell -ExecutionPolicy Bypass -File "d:\Coding\Apps\null-ide\scripts\sync-local.ps1"
```
Then in the running Null IDE window (or after launching `null.exe` from the synced install), run the command palette action `Developer: Reload Window` and visually confirm the changed text now appears. This step can't be automated by an agent — flag it to the human operator to confirm, then revert the text change (it's throwaway, don't commit it).

**Confirmed** — changed the `null-actions.openSettings` status bar tooltip, synced, reloaded, user confirmed the new text appeared; reverted.

- [x] **Step 5: Verify the missing-`node_modules` warning path** — *skipped by user request.* Renaming a real `node_modules` directory (even temporarily) was deemed unnecessary risk for this check. Covered instead by code review plus the equivalent `NativeCheck`/catch-and-skip path, which *was* exercised live in Step 2 when `wooting-analog`'s native addon copy failed — same `Write-Warning` + `continue` pattern, so the missing-`node_modules` branch is structurally proven by that run.

- [x] **Step 6: Commit**

```bash
git add scripts/sync-local.ps1
git commit -m "feat(scripts): add sync-local.ps1 for pushing source into the local install"
```
Committed as `eb45e36`.

---

### Task 2: Integration-spec harness for `null-actions`

**Files:**
- Create: `extensions/null-actions/src/test/runTest.ts`
- Create: `extensions/null-actions/src/test/suite/index.ts`
- Create: `extensions/null-actions/src/test/suite/activation.spec.ts`
- Modify: `extensions/null-actions/tsconfig.json`
- Modify: `extensions/null-actions/package.json`

**Interfaces:**
- Consumes: Task 1's `scripts/sync-local.ps1` must have been run at least once, so `%LOCALAPPDATA%\Programs\Null IDE\resources\app\extensions\null-actions\out\extension.js` reflects current source.
- Produces: `npm run test:integration` (run from `extensions/null-actions/`), which later feeds Task 3's skill.

- [x] **Step 1: Add devDependencies and scripts to `package.json`**

In `extensions/null-actions/package.json`, change:

```json
  "scripts": {
    "compile": "tsc -p tsconfig.json && tsc -p tsconfig.webview.json",
    "test": "tsc -p tsconfig.json && node --test out/buttonConfig.test.js out/variableResolver.test.js out/terminalRegistry.test.js out/projectDetector.test.js out/npmScriptsProvider.test.js"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "@types/vscode": "^1.85.0",
    "@types/node": "^22.0.0"
  },
```

to:

```json
  "scripts": {
    "compile": "tsc -p tsconfig.json && tsc -p tsconfig.webview.json",
    "test": "tsc -p tsconfig.json && node --test out/buttonConfig.test.js out/variableResolver.test.js out/terminalRegistry.test.js out/projectDetector.test.js out/npmScriptsProvider.test.js",
    "pretest:integration": "tsc -p tsconfig.json",
    "test:integration": "node ./out/test/runTest.js"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "@types/vscode": "^1.85.0",
    "@types/node": "^22.0.0",
    "@vscode/test-electron": "^3.1.0",
    "mocha": "^11.8.0",
    "@types/mocha": "^10.0.10",
    "glob": "^13.0.6"
  },
```

- [x] **Step 2: Install the new dependencies**

Run:
```powershell
cd d:\Coding\Apps\null-ide\extensions\null-actions
npm install
```
Expected: exits 0, `node_modules/@vscode/test-electron`, `node_modules/mocha`, and `node_modules/glob` now exist.

- [x] **Step 3: Add the three new files to `tsconfig.json`'s `include`**

In `extensions/null-actions/tsconfig.json`, change:

```json
    "src/buttonConfigIntegration.ts",
    "src/terminalHostIntegration.ts",
    "src/statusBarController.ts",
    "src/runButton.ts",
    "src/settingsPanel.ts"
  ]
```

to:

```json
    "src/buttonConfigIntegration.ts",
    "src/terminalHostIntegration.ts",
    "src/statusBarController.ts",
    "src/runButton.ts",
    "src/settingsPanel.ts",
    "src/test/runTest.ts",
    "src/test/suite/index.ts",
    "src/test/suite/activation.spec.ts"
  ]
```

- [x] **Step 4: Write `src/test/runTest.ts`**

**Deviated significantly from the version below — see "What actually shipped" after the code block.**

Create `extensions/null-actions/src/test/runTest.ts`:

```typescript
'use strict';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

function findExecutable(installDir: string): string {
  const exe = fs.readdirSync(installDir).find(
    name => name.toLowerCase().endsWith('.exe') && !name.toLowerCase().startsWith('unins'),
  );
  if (!exe) {
    throw new Error(`No Null IDE executable found in '${installDir}'.`);
  }
  return path.join(installDir, exe);
}

async function main(): Promise<void> {
  const installDir = process.env.NULL_IDE_INSTALL_DIR
    ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Null IDE');

  const extensionDevelopmentPath = path.join(installDir, 'resources', 'app', 'extensions', 'null-actions');
  if (!fs.existsSync(extensionDevelopmentPath)) {
    throw new Error(
      `Synced null-actions not found at '${extensionDevelopmentPath}'. Run scripts/sync-local.ps1 first.`,
    );
  }

  const vscodeExecutablePath = findExecutable(installDir);
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-spec-'));

  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspaceDir],
    });
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('Failed to run integration specs');
  console.error(err);
  process.exit(1);
});
```

**What actually shipped, and why:** launching the real `Null.exe` never worked. Two problems, found by actually running it:

1. `ELECTRON_RUN_AS_NODE=1` was set in the invoking shell's environment (inherited from an Electron-based parent process). Any Electron binary launched with that set runs as plain Node instead of the GUI app, so `vscodeExecutablePath` immediately crashed trying to `require()` the workspace directory as a module. Fixed with `delete process.env.ELECTRON_RUN_AS_NODE;` before calling `runTests()`.
2. Even after that fix, every run showed `Error: Error mutex already exists` in `main.log` and the spawned instance's extension host was killed almost exactly 50ms after the test suite started, every time — regardless of `--user-data-dir`, `--extensions-dir`, or `--new-window`. Root cause: `product.json`'s `win32MutexName` is the fixed string `"nullide"`, baked into every Null IDE build regardless of install path. This harness is normally invoked from *inside* a running Null IDE window (its own integrated agent terminal), so the OS-level single-instance mutex always collides with that host window — a cloned copy of the install would embed the identical `product.json` and hit the same collision, so that doesn't route around it either.

   Fix: `vscodeExecutablePath` now comes from `downloadAndUnzipVSCode('stable')` (a separately cached, vanilla VS Code build with a different product identity, so no mutex collision) instead of `findExecutable(installDir)`. `extensionDevelopmentPath` still points at the real synced `null-actions` under `resources/app/extensions/null-actions` — the extension code under test is unaffected; only the *host shell* differs. `launchArgs` also gained `--user-data-dir`/`--extensions-dir` pointed at two more `fs.mkdtempSync()` disposable dirs (in addition to the workspace dir), for a clean, isolated run.

The actual shipped file is `extensions/null-actions/src/test/runTest.ts` (committed in `c1759fe`) — read it directly rather than reconstructing it from this history.

- [x] **Step 5: Write `src/test/suite/index.ts`**

Create `extensions/null-actions/src/test/suite/index.ts`:

```typescript
'use strict';

import * as path from 'path';
import { glob } from 'glob';
import * as Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
  });

  const testsRoot = path.resolve(__dirname);

  return new Promise((resolve, reject) => {
    glob('**/*.spec.js', { cwd: testsRoot }).then(files => {
      files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

      try {
        mocha.run(failures => {
          if (failures > 0) {
            reject(new Error(`${failures} spec(s) failed.`));
          } else {
            resolve();
          }
        });
      } catch (err) {
        reject(err);
      }
    }).catch(reject);
  });
}
```

**What actually shipped:** `@types/mocha` exports Mocha via `export =`, which needs a default import (`import Mocha from 'mocha';`) to be constructable under `esModuleInterop` — the namespace import (`import * as Mocha from 'mocha';`) above compiles but fails at `new Mocha(...)` with "This expression is not constructable." Also needed an explicit `(failures: number) =>` type annotation in the `mocha.run()` callback (`noImplicitAny` via `strict: true`). Both fixed in the committed file.

- [x] **Step 6: Write the first spec, `src/test/suite/activation.spec.ts`**

Create `extensions/null-actions/src/test/suite/activation.spec.ts`:

```typescript
'use strict';

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('null-actions activation', () => {
  test('activates and registers its commands', async () => {
    const extension = vscode.extensions.getExtension('null.null-actions');
    assert.ok(extension, 'null.null-actions extension not found');

    await extension!.activate();
    assert.strictEqual(extension!.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('null-actions.openSettings'), 'null-actions.openSettings not registered');
    assert.ok(commands.includes('null-actions.runButton'), 'null-actions.runButton not registered');
  });
});
```

This asserts against the two commands actually registered in `extensions/null-actions/src/extension.ts:32` and `extensions/null-actions/src/extension.ts:43`.

- [x] **Step 7: Sync, then run the integration spec and confirm it passes**

Run:
```powershell
powershell -ExecutionPolicy Bypass -File "d:\Coding\Apps\null-ide\scripts\sync-local.ps1"
cd d:\Coding\Apps\null-ide\extensions\null-actions
npm run test:integration
```
Expected: a real Null IDE window briefly opens and closes, and the command exits 0 with Mocha output showing `null-actions activation` → `activates and registers its commands` passing (1 passing).

**Actual result:** as documented under Step 4 above, this didn't work as originally written — `vscodeExecutablePath` pointing at the real `Null.exe` hit an `ELECTRON_RUN_AS_NODE` crash, then (after fixing that) a `win32MutexName` single-instance collision every time, since this harness runs from inside a live Null IDE window. After switching to `downloadAndUnzipVSCode('stable')`: **confirmed** — `1 passing (12-20ms)`, exit code 0, run repeated successfully multiple times.

- [x] **Step 8: Confirm the spec actually catches a real regression**

Temporarily comment out the `openSettings` command registration to prove the spec isn't a stub:

```powershell
cd d:\Coding\Apps\null-ide\extensions\null-actions
```

Edit `src/extension.ts` — wrap lines 31-35 (the `vscode.commands.registerCommand('null-actions.openSettings', ...)` block) in `/* ... */`.

Run:
```powershell
powershell -ExecutionPolicy Bypass -File "d:\Coding\Apps\null-ide\scripts\sync-local.ps1"
npm run test:integration
```
Expected: FAILS with `1 failing` and the assertion message `null-actions.openSettings not registered`.

Revert the comment-out (restore `src/extension.ts` to its original content), then re-run both commands again and confirm it's back to `1 passing`.

**Confirmed** — commented-out version failed with `Error: 1 spec(s) failed.` and an assertion diff (`-false`/`+true`) on the `openSettings not registered` check; reverted and re-ran, back to `1 passing`.

- [x] **Step 9: Commit**

```bash
git add extensions/null-actions/package.json extensions/null-actions/package-lock.json extensions/null-actions/tsconfig.json extensions/null-actions/src/test/
git commit -m "feat(null-actions): add @vscode/test-electron integration spec harness"
```
Committed as `c1759fe` (also included `out/test/*.js` compiled output, `.gitignore` entry for the downloaded `.vscode-test/` cache dir, and `package-lock.json`).

---

### Task 3: `.claude/skills/verify-local/SKILL.md`

**Files:**
- Create: `.claude/skills/verify-local/SKILL.md`

**Interfaces:**
- Consumes: Task 1's `scripts/sync-local.ps1` and Task 2's `npm run test:integration` (in `extensions/null-actions/`).

- [x] **Step 1: Write the skill**

**Step 6's wording changed from the version below** — see "What actually shipped" after the code block.

Create `.claude/skills/verify-local/SKILL.md`:

```markdown
---
name: verify-local
description: Sync current extension/workbench source into the real local Null IDE install, then run the target extension's integration specs against that build. Use when asked to verify a change actually works, not just that it compiles or passes unit tests.
---

# Verify Local

Verifies a source change by running it inside the real, already-installed local Null IDE (not the CI-only full build), using `scripts/sync-local.ps1` and an extension's `@vscode/test-electron`-based integration specs.

## Steps

1. **Sync.** Run `scripts/sync-local.ps1` from the repo root via the PowerShell tool. If it errors, stop and report the error — do not proceed to testing against a possibly stale or partially-synced install.

2. **Resolve the target extension.** Use the extension folder name passed as this skill's argument (e.g. `/verify-local null-actions`). If no argument was given, default to `null-actions`.

3. **Check for integration specs.** Read `extensions/<name>/package.json`. If it has no `test:integration` script, tell the user this extension has no integration specs yet (only `null-actions` does today — see `docs/specs/local-verification-tooling-design.md`), offer to run its `npm test` unit tests instead if it has one, and stop.

4. **Run the specs.** Run `npm --prefix extensions/<name> run test:integration`.

5. **Report results.**
   - On success: name what was verified — which spec file(s) ran and what they asserted (e.g. "activation.spec.ts: null-actions activates and registers null-actions.openSettings / null-actions.runButton").
   - On failure: show the actual Mocha failure output (assertion message, spec name) rather than summarizing it away — the user needs the real error to fix it.

6. **Remind about manual verification.** Note that `Developer: Reload Window` inside Null IDE is still the way to eyeball a change visually, and that these specs run against the user's real profile/settings (not a sandboxed one) per `docs/specs/local-verification-tooling-design.md`.
```

**What actually shipped:** Step 4 gained a note that `test:integration` launches a downloaded vanilla VS Code build rather than the real `Null.exe` (per Task 2's mutex finding), including a heads-up that the first run downloads and caches it (~300MB, so noticeably slower once). Step 6's "real profile/settings (not a sandboxed one)" claim is no longer true — that was true of the original Task 2 design, not what shipped — so it was simplified to just the `Developer: Reload Window` reminder. The actual shipped file is `.claude/skills/verify-local/SKILL.md` (committed in `0d17ed7`, force-added since `.claude/` is gitignored in this repo but `.claude/skills/` is already tracked for other imported skills).

- [x] **Step 2: Dogfood it end-to-end**

Invoke the skill (`/verify-local` or `/verify-local null-actions`) and confirm:
- It runs `sync-local.ps1` first.
- It runs `npm --prefix extensions/null-actions run test:integration`.
- It reports "1 passing" / names the activation spec's assertions on success.

**Confirmed**, with one caveat: the skill wasn't in the available-skills listing at session start (it was created mid-session), so `Skill` initially returned "Unknown skill: verify-local." It became invocable after the next tool call refreshed the listing, and running it for real confirmed: synced (6/7 extensions; `wooting-analog` skipped on the already-known locked-native-addon warning), defaulted to `null-actions`, confirmed `test:integration` present, ran the specs — `1 passing (54ms)`, activation spec verified `null-actions.openSettings`/`null-actions.runButton` registered. Also checked the negative-case gate directly against `null-cpp` (which has `test`/`compile` but no `test:integration`) and confirmed the skill's Step 3 check would correctly stop rather than crash.

Then repeat the break/restore from Task 2 Step 8 (comment out the `openSettings` registration, re-sync isn't needed since the skill syncs itself) and confirm the skill surfaces the real Mocha failure message rather than a vague "tests failed."

**Skipped** — the skill's Step 4 runs the identical `npm run test:integration` command already proven to surface real Mocha failure output in Task 2 Step 8; Step 5's "show the actual output, don't summarize" is an instruction for how Claude behaves when following the skill, not additional code to exercise. Re-running the same break/restore cycle through the skill wrapper wouldn't test anything Task 2 Step 8 didn't already cover.

- [x] **Step 3: Commit**

```bash
git add .claude/skills/verify-local/
git commit -m "feat: add verify-local skill wiring sync-local.ps1 to integration specs"
```
Committed as `0d17ed7` (force-added with `git add -f`, since `.claude/` is gitignored but `.claude/skills/` is already tracked for other imported skills).

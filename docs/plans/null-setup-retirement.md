# Null Setup, Sub-project 2c-3: `Null: Setup` and Retiring Inno Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Close sub-project 2: the IDE gets a **Null: Setup** command (Features launcher, "setup" group) that opens the existing wizard on its Modify page for the running install; the Inno installer and `scripts/install-null-ide.ps1` are deleted from the repo, the pipeline, the local scripts and the docs; the README documents the stub installer as the only installer; the known first-run gap from 2c-2 is fixed.

**Architecture:** No new installer logic and no new webview. `Null: Setup` is one `null-tools` command that spawns `<install>\setup\null-setup.exe wizard --install-dir <dir> --intent modify` detached (the 2c-2 wizard already shows the saved choices pre-filled and applies them through `modify` / `repair`). Retirement is deletion plus the references to the deleted files; the only code change in `setup/` is that `install` saves the first-run choices even when a registration warns.

**Tech Stack:** Rust (`setup/app`, no new crates), TypeScript in `extensions/null-tools` (no new dependencies), GitHub Actions (`build.yml`), PowerShell (`build-local.ps1`, `sync-local.ps1`), Markdown.

**Spec:** `docs/specs/null-setup-installer-design.md` — "State and files", "First launch" (`Null: Setup` paragraph), "Release pipeline changes" (last bullet), sequencing entry **2c-3**, "Open risks" (last bullet). Predecessors: `docs/plans/null-setup-wizard.md` (2c-2, provides `wizard --intent modify`, `Mode::Wizard`, `is_partial`), `docs/plans/null-setup-registrations.md` (2b, ported the script to Rust), `docs/plans/null-setup-first-run.md` (2c-1).

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

- Supported Windows (spec): Windows 11 and Windows 10 22H2. **Do not write "Windows 10 22H2 supported" anywhere user-facing until runbook rows were actually run there** (Task 5). If no Windows 10 machine is available the README says what was verified, not more.
- Non-goals (spec): offline installer, migrating existing installs, code signing, a prerelease channel, a WebView2 bootstrapper. "The only current user reinstalls once by hand; the old paths are deleted in the same release with no transition hop."
- `Null: Setup` is listed in the Features launcher (spec) — a `nullWorkspace.features` entry in `null-tools`' `package.json`, category `setup`.
- Changes that need file changes go through `null-setup modify` (spec). The window picks `modify` vs `repair` itself (`install_config::builtins_changed`); null-tools never decides.
- Nothing in `setup/` or the extensions may read `install-null-ide.ps1` after Task 3 (the only reader today is `setup/core/tests/shell_assoc.rs`).
- Keep `Null.VisualElementsManifest.xml` (spec: "if still needed for the Win10 tile"); it is.
- Conventions: `out/` of `null-tools` is tracked — after editing `src/` run `npm run compile` and commit the refreshed `out/` as `chore: refresh null-tools compiled output`; never hand-edit `out/`. A new `*.test.js` must be added to the `test` script in `package.json` (this plan adds none). Rust: run Cargo from `setup/`. Commit style `feat(setup): …`, `feat(tools): …`, `build: …`, `docs: …`; end messages with the attribution trailer the harness specifies. Do not push.
- Do not run `scripts/build-local.ps1` (tens of minutes; CLAUDE.md). Edits to it are checked by parsing and by grep.

## Review Focus

Inputs the spec implies but a happy-path run never meets, most likely first. Each has a check in the task named in brackets.

1. **A machine that still has the Inno install** — `Settings → Apps → Null IDE` shows the old entry; the new stub pointed at the same folder refuses ("not empty"); Inno's uninstaller leaves `%APPDATA%\Null` (its script has no `[UninstallDelete]`). The README must say: uninstall the old one first, your settings stay. [Task 4 README, Task 5 runbook row 5]
2. **`Null: Setup` where there is no installer to talk to** — a dev checkout, or any host where `setup\null-setup.exe` is missing, must show one clear message and not throw or spawn a bad path. A *portable zip* extracted by hand has `setup\null-setup.exe` and a marker with `installDir: null`; the command must either work or fail with the wizard's own message, never hang. [Task 2 guard, Task 5 rows 2 and 3]
3. **Install folder with spaces and non-ASCII** (`C:\Users\Zoë B\Null IDE`) reaching the wizard through `spawn` — passed as one argv element, never through a shell. [Task 2 Rust pin test, Task 5 row 4]
4. **Registration warning during `install`** — files are in place, the wizard shows the warning, and the user's chosen presets are *still* written to `first-run.json` (today they are lost). Also the reverse: presets cannot be saved *and* a registration warned → one message with both, still `is_partial`. [Task 1 tests]
5. **A release asset path that no longer exists** — `softprops/action-gh-release` has `fail_on_unmatched_files: true`, so one leftover `install-null-ide.ps1` or `NullIDEInno-*.exe` line fails the *tag* build after 40 minutes. A grep sweep must be empty before the commit. [Task 3 Step 8]

Also covered: the Rust file-association table loses its parity test against the script but keeps its structural tests [Task 3 Step 6]; a running IDE blocks a built-in change from `Null: Setup` and the wizard shows its existing "still running" panel [Task 5 row 6].

---

## File Structure

```
setup/app/src/cli.rs                          # MODIFY install saves first-run choices even after a registration warning; merge()
setup/app/src/args.rs                         # MODIFY one pin test: the exact argv null-tools sends
setup/core/tests/shell_assoc.rs               # MODIFY drop the script parity test
extensions/null-tools/
├── src/setupIntegration.ts                   # NEW   null.setup.open
├── src/extension.ts                          # MODIFY register it
├── src/featureManifests.test.ts              # MODIFY expected "setup" group
├── package.json                              # MODIFY command + nullWorkspace feature entry
└── out/                                      # REFRESH (tracked)
icons/Null.VisualElementsManifest.xml         # MOVED from installer/
installer/null-ide.iss                        # DELETE
scripts/install-null-ide.ps1                  # DELETE
.github/workflows/build.yml                   # MODIFY drop Inno steps, payload script and release-asset lines
scripts/build-local.ps1                       # MODIFY drop Inno, -SkipInstaller, payload script
scripts/sync-local.ps1                        # MODIFY drop the script copy, new manifest path
README.md, docs/index.html, CLAUDE.md         # MODIFY
.claude/agents/security-reviewer.md           # MODIFY
.claude/product-audit/ARCHITECTURE.md, FEATURES.md   # MODIFY
docs/specs/null-setup-installer-design.md     # MODIFY mark 2c-3
docs/specs/null-setup-wizard-runbook.md       # MODIFY Null: Setup rows, Windows 10 column
```

Already gone before this plan (verified with `git ls-files`): `updater/` and `scripts/update-null-ide.ps1`. The only tracked leftovers are `installer/null-ide.iss`, `installer/Null.VisualElementsManifest.xml` and `scripts/install-null-ide.ps1`.

**Decisions made here (flag if you disagree):**

| Decision | Choice | Why |
|---|---|---|
| What `Null: Setup` is | Spawns the 2c-2 wizard on Modify; no in-IDE webview | The wizard already shows the saved choices pre-filled and runs `modify`/`repair`. A second UI for the same data is the "two settings systems" the spec rules out. `ponytail:` build an in-IDE page when someone needs to edit choices without leaving the IDE. |
| First-run presets in `Null: Setup` | Not shown | `first-run.json` is deleted after the first start; the values then live in normal Settings, which is where the spec sends "anything else". |
| IDE keeps running | The command does not quit the IDE | `modify` of registrations only keeps it running; a built-in change makes the window show its "close Null IDE" panel. |
| `Null.VisualElementsManifest.xml` | `git mv` to `icons/` | `installer/` would hold one XML file; `icons/` is where CI already copies the other tile assets from by explicit name. |
| `shell_assoc.rs` parity test | Delete `script_table` and `the_table_matches_the_script` | Their only job was proving the port equals the script. The Rust table is now the single source; the two structural tests stay. |
| README one-liner (`irm … \| iex`) | Removed, not replaced | It fetched the deleted script. The stub is a normal download; `ponytail:` add a stub-fetching one-liner if asked. |
| Old-installer users | README note, no code | Spec: one manual reinstall, no transition hop. |

---

### Task 1: Install keeps the first-run choices when a registration warns

Fixes the "Known gap kept from 2a" listed in `docs/plans/null-setup-wizard.md`: `deploy()` returns `Err("installed, but some registrations failed…")` and `dispatch` returned before `first_run::save_from_file`.

**Files:**
- Modify: `setup/app/src/cli.rs` (`dispatch`, tests)

**Interfaces:**
- Consumes: `is_partial(&Error) -> bool` (same file), `first_run::save_from_file(&Path, &Path, &Path) -> Result<()>`, `first_run::dir() -> Result<PathBuf>`.
- Produces: private `fn merge(deployed: Result<()>, saved: std::result::Result<(), String>) -> Result<()>`. Error texts keep the `installed, but` prefix so `is_partial` and the wizard's finish-page warning keep working.

- [ ] **Step 1: Write the failing tests** — in the `tests` module of `setup/app/src/cli.rs` append:

```rust
    fn text(r: Result<()>) -> String { r.unwrap_err().to_string() }

    #[test]
    fn merge_reports_each_outcome_and_both_when_both_failed() {
        assert!(merge(Ok(()), Ok(())).is_ok());
        let only_saved = merge(Ok(()), Err("disk full".into()));
        assert_eq!(text(only_saved), "installed, but the first-run choices were not saved: disk full");
        let only_deployed = merge(Err(Error::Other("installed, but some registrations failed: apps".into())), Ok(()));
        assert_eq!(text(only_deployed), "installed, but some registrations failed: apps");
        let both = merge(Err(Error::Other("installed, but some registrations failed: apps".into())), Err("disk full".into()));
        let both = text(both);
        assert!(both.starts_with("installed, but some registrations failed: apps"));
        assert!(both.ends_with("the first-run choices were not saved: disk full"));
        assert!(is_partial(&Error::Other(both)));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run (from `setup/`): `cargo test --locked -p null-setup merge_reports`
Expected: FAIL — "cannot find function `merge`".

- [ ] **Step 3: Implement** — in `cli.rs` add above `dispatch`:

```rust
/// The install result and the hand-over of the first-run choices are separate outcomes; neither may hide the other.
fn merge(deployed: Result<()>, saved: std::result::Result<(), String>) -> Result<()> {
    match (deployed, saved) {
        (Ok(()), Ok(())) => Ok(()),
        (Ok(()), Err(b)) => Err(Error::Other(format!("installed, but the first-run choices were not saved: {b}"))),
        (Err(a), Ok(())) => Err(a),
        (Err(a), Err(b)) => Err(Error::Other(format!("{a}; the first-run choices were not saved: {b}"))),
    }
}
```

and replace the `Mode::Install` arm of `dispatch` with:

```rust
        Mode::Install => {
            let cfg = load_config(a)?.unwrap_or_default();
            let deployed = deploy(a, Kind::Install, a.tag.clone(), Some(cfg), ctx);
            // A registration warning still means the files are in place, so the choices can be handed over.
            // Anything else failed before or during the swap: nothing is installed, so there is nothing to hand them to.
            if deployed.as_ref().is_err_and(|e| !is_partial(e)) {
                return deployed;
            }
            let saved = match &a.first_run {
                Some(f) => first_run::save_from_file(&a.install_dir, f, &first_run::dir()?).map_err(|e| e.to_string()),
                None => Ok(()),
            };
            merge(deployed, saved)
        }
```

(`first_run::dir()?` failing returns a plain error after a successful install; the wizard shows it as a failure. That is the same behavior as before for that rare case and is left alone.)

- [ ] **Step 4: Run to verify it passes**

Run (from `setup/`): `cargo test --locked -p null-setup`
Expected: PASS, including the existing `only_the_installed_but_messages_count_as_partial_success`.

- [ ] **Step 5: Commit**

```bash
git add setup/app/src/cli.rs
git commit -m "fix(setup): install hands over the first-run choices even when a registration warns"
```

---

### Task 2: `Null: Setup`

**Files:**
- Create: `extensions/null-tools/src/setupIntegration.ts`
- Modify: `extensions/null-tools/src/extension.ts` (import at the other `register…Feature` imports near line 26; call next to `registerFirstRunFeature(context);` near line 57)
- Modify: `extensions/null-tools/package.json` (`nullWorkspace.features`, `contributes.commands`)
- Modify: `extensions/null-tools/src/featureManifests.test.ts` (expected groups)
- Modify: `setup/app/src/args.rs` (one test)
- Refresh: `extensions/null-tools/out/`

**Interfaces:**
- Consumes: `findInstall(context: vscode.ExtensionContext): { installDir: string; setupExe: string } | undefined` (exported from `updater.ts`).
- Produces: command `null.setup.open`; feature id `setup` in category `setup`.

- [ ] **Step 1: Write the failing check** — in `featureManifests.test.ts` change the expected last group to:

```ts
      ['setup', ['Null Setup', 'Environment Check', 'Actions Settings', 'Formatting Settings']],
```

and in `setup/app/src/args.rs` `tests` module append (it pins existing behavior, so it passes at once; its job is to fail if `args.rs` ever stops accepting what null-tools sends):

```rust
    #[test]
    fn the_arguments_null_tools_sends_for_null_setup_parse() {
        // Same list as extensions/null-tools/src/setupIntegration.ts; a path with spaces and a non-ASCII letter is one element.
        let argv = ["wizard", "--install-dir", "C:\\Users\\Zoë B\\Null IDE", "--intent", "modify"];
        let a = parse(argv.map(String::from)).unwrap();
        assert_eq!(a.mode, Mode::Wizard);
        assert!(matches!(a.intent, Intent::Modify));
        assert!(a.install_dir_given);
        assert_eq!(a.install_dir, PathBuf::from("C:\\Users\\Zoë B\\Null IDE"));
    }
```

- [ ] **Step 2: Run to verify the right one fails**

Run: `cd extensions/null-tools && npm test` → FAIL in `the real manifests declare exactly the agreed launcher entries` (no "Null Setup" yet).
Run (from `setup/`): `cargo test --locked -p null-setup the_arguments_null_tools_sends` → PASS.

- [ ] **Step 3: Implement** — `extensions/null-tools/src/setupIntegration.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import * as os from 'os';
import { spawn } from 'child_process';
import { findInstall } from './updater';

/** `Null: Setup`: the installer window on its Modify page, pre-filled from the install's saved choices. */
export function registerSetupFeature(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('null.setup.open', () => {
    const install = findInstall(context);
    if (!install) {
      void vscode.window.showInformationMessage('Null: Setup needs an installed Null IDE; setup\\null-setup.exe was not found next to this one.');
      return;
    }
    // Keep in step with the args.rs test `the_arguments_null_tools_sends_for_null_setup_parse`.
    // argv array, no shell: a folder with spaces stays one argument. cwd must not be inside the install, or a repair cannot rename it.
    const child = spawn(install.setupExe, ['wizard', '--install-dir', install.installDir, '--intent', 'modify'], {
      detached: true,
      stdio: 'ignore',
      cwd: os.tmpdir(),
    });
    child.once('error', err => void vscode.window.showErrorMessage(`Null: could not start Null Setup: ${err.message}`));
    child.unref();
  }));
}
```

In `extension.ts` add `import { registerSetupFeature } from './setupIntegration';` after the `registerFirstRunFeature` import and `registerSetupFeature(context);` after `registerFirstRunFeature(context);`.

In `package.json`: add to `contributes.commands` (after `null.installUpdate`)

```json
      {
        "command": "null.setup.open",
        "title": "Null: Setup",
        "icon": "$(settings-gear)"
      },
```

and to `nullWorkspace.features` (`order` 5 sorts it before Environment Check's 10)

```json
      { "id": "setup", "label": "Null Setup", "category": "setup", "icon": "settings-gear",
        "command": "null.setup.open", "description": "Shortcuts, built-ins, uninstall", "order": 5 },
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd extensions/null-tools && npm test`
Expected: PASS (`featureManifests` also checks that `null.setup.open` is declared in some `contributes.commands`).

- [ ] **Step 5: Commit the source**

```bash
git add extensions/null-tools/src extensions/null-tools/package.json setup/app/src/args.rs
git commit -m "feat(tools): Null: Setup opens the installer window on Modify"
```

- [ ] **Step 6: Refresh and commit the compiled output**

```bash
cd extensions/null-tools && npm run compile && cd ../..
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output"
```

---

### Task 3: Retire Inno and the registration script

One task because `shell_assoc.rs` `include_str!`s the script (deleting it alone breaks `cargo test`) and the pipeline lists both files as release assets (deleting them alone fails the tag build).

**Files:**
- Move: `installer/Null.VisualElementsManifest.xml` → `icons/Null.VisualElementsManifest.xml`
- Delete: `installer/null-ide.iss`, `scripts/install-null-ide.ps1`
- Modify: `.github/workflows/build.yml`, `scripts/build-local.ps1`, `scripts/sync-local.ps1`, `setup/core/tests/shell_assoc.rs`

**Interfaces:** none (deletion). After this task no file in the repo names `install-null-ide`, `null-ide.iss`, `NullIDEInno`, `ISCC` or `SkipInstaller`.

- [ ] **Step 1: Move the tile manifest and repoint its three readers**

```bash
git mv installer/Null.VisualElementsManifest.xml icons/Null.VisualElementsManifest.xml
```

- `build.yml` (≈ line 544): `ide-overlay/installer/Null.VisualElementsManifest.xml` → `ide-overlay/icons/Null.VisualElementsManifest.xml`
- `scripts/build-local.ps1` (≈ line 653): `"installer/Null.VisualElementsManifest.xml"` → `"icons/Null.VisualElementsManifest.xml"`
- `scripts/sync-local.ps1` (≈ line 724): `"installer\Null.VisualElementsManifest.xml"` → `"icons\Null.VisualElementsManifest.xml"`

CI copies icons by explicit file name (`icon.ico`, `icon_150x150.png`, `file-assoc/*.ico`, …), none by `icons/*`, so the extra file in `icons/` is inert there; confirm with `grep -n "icons/\*" .github/workflows/build.yml scripts/*.ps1` (expected: only `file-assoc/*.ico`).

- [ ] **Step 2: `build.yml`** —
  - In step "Prepare installer payload" delete the comment and the three lines that create `resources/app/null-updater` and copy the script (the block starting `# Registration script, run by null-setup…` through `Copy-Item ide-overlay/scripts/install-null-ide.ps1 $payloadDir -Force`, plus the now-unused `$payloadDir` line). Rename the step to `Prepare release payload`.
  - Delete the steps `Install Inno Setup` and `Build Windows installer` entirely.
  - In `Stage the setup stub` the comment stays true; no change.
  - In both file lists (`Publish release asset` and `Upload artifact`) delete the lines `NullIDEInno-*.exe` and `ide-overlay/scripts/install-null-ide.ps1`.

- [ ] **Step 3: `scripts/build-local.ps1`** —
  - Header: remove `installer/null-ide.iss,` from the "iterating on" sentence (line ≈ 8), the `.PARAMETER SkipInstaller` paragraph (≈ 42-43) and the `Inno Setup 6` prerequisite line (≈ 62).
  - Remove `[switch]$SkipInstaller,` from `param(` (≈ 78).
  - Remove the `$iscc = …` detection block and the `if (-not $SkipInstaller -and -not $iscc) { throw … }` check (≈ 203-216) and, inside `if ($PublishRelease)`, the `if ($SkipInstaller) { throw … }` block (≈ 222-224).
  - Remove the three lines that create `resources/app/null-updater` and copy the script (≈ 812-814, under `Write-Step "Preparing installer payload"`; rename that step text to `"Preparing release payload"`).
  - Remove the whole `if (-not $SkipInstaller) { … } else { … }` block (≈ 842-856) and the `$installer` variable.
  - Fix the stub comment to `# The Rust setup stub is the downloadable installer (NullIDESetup-<version>.exe).` and drop `$installer.FullName` and `(Join-Path $RepoRoot "scripts/install-null-ide.ps1")` from `$releaseFiles`, leaving `@($zipPath, "$zipPath.sha256", $builtinsJson, $stub)`.
  - Check there is no other use of the removed variables: `grep -n -E "iscc|Inno|SkipInstaller|\\\$installer\b|null-updater" scripts/build-local.ps1` → empty.

- [ ] **Step 4: `scripts/sync-local.ps1`** — in section `# 4. UPDATER` ("Syncing null-setup"): delete the `$updaterDir` assignment, its `New-Item`, and the `Copy-Item … install-null-ide.ps1 $updaterDir` call; change the two messages to `"  [ok] setup\null-setup.exe"` and drop the `else`-branch line `"  [ok] registration script"` (keep the `Write-Warning "null-setup.exe not built"`). Read ≈ lines 630-675 first and keep the `$setupDir` / `$nullSetupExe` logic untouched. `grep -n "null-updater\|install-null-ide\|updaterDir" scripts/sync-local.ps1` → empty.

- [ ] **Step 5: Both scripts still parse**

```powershell
foreach ($f in 'scripts/build-local.ps1','scripts/sync-local.ps1') {
  $e = $null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $f), [ref]$null, [ref]$e) | Out-Null
  "$f : $($e.Count) parse errors"
}
```
Expected: `0 parse errors` for both.

- [ ] **Step 6: `setup/core/tests/shell_assoc.rs`** — delete `type Row`, `fn script_table` and `fn the_table_matches_the_script`. The `use` line at the top stays: `prog_ids_are_stable` still uses `TABLE`, `prog_id` and `all_extensions`. The file keeps `extensions_are_unique_in_first_appearance_order` and `prog_ids_are_stable`.

- [ ] **Step 7: Delete the retired files**

```bash
git rm installer/null-ide.iss scripts/install-null-ide.ps1
```
(`installer/` is now empty and disappears.)

- [ ] **Step 8: Whole-tree checks**

From `setup/`: `cargo test --locked -p null-setup-core -p null-setup` → PASS.
From the repo root, the sweep (Review Focus 5) — expected: **no lines** except documentation that Task 4 rewrites (list them and make sure only README.md, docs/, CLAUDE.md, `.claude/` appear):

```bash
git grep -n -I -E "install-null-ide|null-ide\.iss|NullIDEInno|ISCC|SkipInstaller|Inno Setup|null-updater" -- . ':!docs/plans' ':!docs/specs' ':!graphify-out' ':!patches/009-safe-mode.patch'
```

(`patches/009-safe-mode.patch` mentions VS Code's own "Check if Inno Setup is running" code; it is upstream context, leave it. `setup/core/src/shell/assoc.rs` has the file type description "Inno Setup Script" for `.iss` files; that is a user-facing association name, leave it.)

- [ ] **Step 9: Commit**

```bash
git add -A installer icons scripts setup/core/tests .github
git commit -m "build: retire the Inno installer and install-null-ide.ps1; null-setup is the only installer"
```

---

### Task 4: Documentation

**Files:** `README.md`, `docs/index.html`, `CLAUDE.md`, `.claude/agents/security-reviewer.md`, `.claude/product-audit/ARCHITECTURE.md`, `.claude/product-audit/FEATURES.md`, `docs/specs/null-setup-installer-design.md`

- [ ] **Step 1: `README.md`**
  - Line 10 badge row: `… · C++ · Inno Setup` → `… · C++ · Rust`.
  - Replace lines 18-22 (the `irm … | iex` block and the "Or download" line) with:

    > Download `NullIDESetup-<version>.exe` from the [latest release](https://github.com/TorresVisual/null-ide/releases/latest) and run it. The installer is not code-signed, so Windows SmartScreen may ask you to confirm; the SHA256 check only guards against a corrupted or truncated download, not against a compromised release.

  - Replace the whole `### Installer (recommended)` and `### PowerShell` subsections (lines 57-76) with:

    ```markdown
    ### Installer

    Run `NullIDESetup-<version>.exe` from the [latest release](https://github.com/TorresVisual/null-ide/releases/latest). The wizard downloads the newest release and lets you pick the install folder, shortcuts, `PATH` entry, Explorer context menu, file associations, which built-in extensions to keep and a few starting settings (theme, font, auto save, format on save, update check, menu bar). **Use recommended defaults** skips ahead.

    The install is per-user (`%LOCALAPPDATA%\Programs\Null IDE` by default) and needs no administrator rights, apart from one optional approval for the Windows 11 context-menu certificate. It needs the WebView2 runtime (part of Windows 11; Windows 10 22H2 has it too).

    Run the installer again, or use Settings → Apps → Null IDE, for **Modify**, **Repair** and **Uninstall**. Inside the IDE, **Null: Setup** opens the same window on Modify. Uninstall keeps `%APPDATA%\Null` (settings, extensions) unless you tick the box to delete it.

    A portable `null-ide-win32-x64.zip` (with a `.sha256`) is attached to each release; extracting it registers nothing, run **Null: Setup** from the extracted copy to add shortcuts and the context menu.

    #### Coming from the Inno Setup installer (v1.0.17 and earlier)

    Uninstall the old copy first (Settings → Apps → Null IDE); the new installer refuses a folder that is not empty. Your settings and extensions in `%APPDATA%\Null` are not touched by that uninstall. Those older versions cannot update themselves to this one.
    ```

    **Before writing the last paragraph, check the portable-zip sentence**: run Runbook row 3 (Task 5) or, if it was not run, delete that sentence. Do not describe behavior that was not seen.
  - `### Updating`: the last sentence ("Installs from before the `null-setup` updater cannot update themselves once…") moves into the new "Coming from…" paragraph; delete it here.
  - Line 126 (`Building`): `packages the ZIP and Inno Setup installer` → `packages the ZIP and the setup stub (`NullIDESetup-<version>.exe`)`.
  - Development tree (lines 138-148): delete the `installer/` line; add `setup/             null-setup: installer, wizard and updater (Rust + Tauri)`; `scripts/` description → `Local dev helpers and build scripts`.
  - Scripts table (line 155): `to iterate on `build.yml`, `shell-ext/`, `installer/`, or patches. Slow (tens of minutes); needs Node, Rust, CMake, VS2022, Inno Setup 6` → `to iterate on `build.yml`, `shell-ext/`, `setup/`, or patches. Slow (tens of minutes); needs Node, Rust, CMake and VS2022`.

- [ ] **Step 2: `docs/index.html`** — delete the `<!-- PowerShell -->` `install-card` block (≈ lines 623-634) that shows `scripts\install-null-ide.ps1`. Open the page's install section in a browser (or read the surrounding `install-grid` CSS) to confirm the remaining card(s) still lay out; if the grid expects two cards, change the first card's title/body to the stub download rather than leaving a hole.

- [ ] **Step 3: `CLAUDE.md`** —
  - Overview bullet: "Releases publish a portable ZIP and the setup stub (`NullIDESetup-<version>.exe`; the Inno installer remains as `NullIDEInno-<version>.exe` until 2c-3)" → "Releases publish a portable ZIP and the setup stub (`NullIDESetup-<version>.exe`)".
  - Repository layout: delete the `installer/` entry (both lines); under `icons/` add "(also `Null.VisualElementsManifest.xml`, the Win10 tile metadata)"; `scripts/` line → `fake-release.mjs, gen-builtins.mjs, merge-json.js, convert-icons.js, build-local.ps1 (CI mirror), sync-local.ps1 + reload-local.ps1 (fast local iteration)`.
  - Build step 11: remove "and `install-null-ide.ps1` in `resources/app/null-updater/` (still shipped for Inno and the README install; `null-setup` registers natively)" → "`null-setup` registers natively"; step 12: drop "and Inno Setup → `NullIDEInno-<version>.exe` (until 2c-3)".
  - Delete the sections `### scripts/install-null-ide.ps1` and `### installer/null-ide.iss`.
  - `setup/` section: in the Installer-engine paragraph replace "`install-null-ide.ps1` is no longer called by `null-setup` but is still shipped for Inno and the README one-liner until 2c-3 deletes it with Inno." with "The PowerShell registration script and the Inno installer are gone; `shell/assoc.rs` is the only file-association table." In the Wizard paragraph, delete "The Inno installer is still built, now as `NullIDEInno-<version>.exe`, until 2c-3." and add: "**`Null: Setup`** (sub-project 2c-3; `null-tools/src/setupIntegration.ts`, Features launcher group *setup*) spawns `<install>\setup\null-setup.exe wizard --install-dir <dir> --intent modify` detached; there is no second UI. `install` saves `first-run.json` even when a registration warned (`cli::merge`). Plan `docs/plans/null-setup-retirement.md`."
  - null-tools table: add a row `| **Null: Setup** | \`null.setup.open\` (\`setupIntegration.ts\`) opens the installer window on Modify; the same window handles Repair/Uninstall |`.
  - Scope Constraints: `scripts/build-local.ps1 … needs Node, Rust, CMake, VS2022, and Inno Setup 6` → drop "and Inno Setup 6"; "`installer/`" in its "things sync-local can't reach" list → "`setup/`".
  - First-run row in the null-tools table: no change.

- [ ] **Step 4: Agent and audit docs** —
  - `.claude/agents/security-reviewer.md`: description and item 2: remove `installer/null-ide.iss`; delete item 3 and the `**Installer script (install-null-ide.ps1):**` checklist (line ≈ 34 and its bullets); renumber. Keep the `setup/core/src/shell/` and `trust-cert` items.
  - `.claude/product-audit/ARCHITECTURE.md` (≈ lines 96-98, 120-125): drop the two bullets for `install-null-ide.ps1` and `null-ide.iss`, and rewrite the updater paragraph to the `null-setup` flow in one sentence each (it still describes `update-null-ide.ps1` fallback).
  - `.claude/product-audit/FEATURES.md` (lines 7 and 11): `Installer (Inno + portable ZIP)` → `Installer (null-setup wizard + portable ZIP)`, location `setup/`; `File associations + preview handler` location → `setup/core/src/shell/`.

- [ ] **Step 5: Spec status** — in `docs/specs/null-setup-installer-design.md` change the 2c-3 bullet to start `- **2c-3 \`Null: Setup\` and retirement** (\`docs/plans/null-setup-retirement.md\`):` and replace "the in-IDE page that shows and edits the saved choices" with "the in-IDE command that opens the wizard on Modify". Line 115 ("Delete the Inno Setup install step…"): append " Done in 2c-3; `Null.VisualElementsManifest.xml` moved to `icons/`."

- [ ] **Step 6: Check and commit**

```bash
git grep -n -I -E "install-null-ide|null-ide\.iss|NullIDEInno|ISCC|SkipInstaller|null-updater|Inno" -- README.md CLAUDE.md docs/index.html .claude
```
Expected: only the `Coming from the Inno Setup installer` heading/sentences in README, and the `.iss` association name; nothing else.

```bash
git add README.md CLAUDE.md docs .claude
git commit -m "docs: null-setup is the only installer; document Null: Setup and the move off Inno"
```

---

### Task 5: Real-machine runbook, Windows 10, release gate

This task needs a person at a machine. The agent prepares the rows and runs the local checks; the matrix itself is the user's.

**Files:**
- Modify: `docs/specs/null-setup-wizard-runbook.md`

- [ ] **Step 1: Add the `Null: Setup` and migration rows** — append to the table in `docs/specs/null-setup-wizard-runbook.md` (continue numbering at 21; the file's header already says "Run on Windows 11 and Windows 10 22H2"):

```markdown
| 21 | Installed IDE (stub install): Command Palette → **Null: Setup**; also Features view → Null Setup | Wizard opens on Modify, pre-filled with the install's choices, IDE keeps running |
| 22 | Same, change only the Start Menu shortcut, apply | Shortcut changes; IDE did not close; no "still running" panel |
| 23 | Same, in a folder `C:\Users\<you>\Zoë B\Null IDE` (install there first) | Window opens on that install; Apply works |
| 24 | Extract `null-ide-win32-x64.zip` by hand, run `null.exe`, **Null: Setup** | Opens Modify for that copy, or the wizard's own "not installed" message; no hang, no crash. Record which. |
| 25 | Dev checkout (`sync-local` is not used): Extension Development Host → **Null: Setup** | One information message, no error |
| 26 | Modify with the IDE running: tick/untick a built-in, Apply | "Null IDE is still running" panel (row 12 behavior); **Close Null IDE** applies the change and offers Launch |
| 27 | Machine with an Inno-installed v1.0.17: run the stub, default folder | Install is refused ("not empty"/"already installed") with a sentence; nothing changed |
| 28 | Same machine: Settings → Apps → uninstall old, then run the stub, then check `%APPDATA%\Null` | Old uninstall keeps `%APPDATA%\Null`; the stub installs; settings/extensions are still there |
| 29 | Install with the Win11 context-menu feature on a machine where the sparse package cannot register, with a preset (font size 16) | Finish page shows the registration warning **and** `first-run.json` exists with `editor.fontSize` (Task 1) |
```

To force the registration warning in row 29, make the sparse package fail to register, for example by ticking the Windows 11 context-menu feature on a Windows 10 VM, where it is unsupported. If that is not possible, mark the row "not run" with the reason; Task 1's unit test is then the only evidence.

- [ ] **Step 2: Local gate** — all must be green, report the actual output:

```bash
cd setup && cargo test --locked -p null-setup-core -p null-setup && cargo build --release --locked -p null-setup && cd ..
node --test setup/ui-tests/wizard-model.test.mjs scripts/gen-builtins.test.mjs
cd extensions/null-tools && npm test && cd ../..
git grep -n -I -E "install-null-ide|null-ide\.iss|NullIDEInno|ISCC|SkipInstaller" -- . ':!docs' ':!graphify-out' ':!README.md' ':!CLAUDE.md' ':!.claude'
```
Expected: tests pass; the final grep prints nothing.

- [ ] **Step 3: Hand over the manual matrix** — tell the user: run rows 1-29 on Windows 11 with a release build (`cargo build --release` copy of `null-setup.exe`, `scripts/fake-release.mjs`), then rows 1-2, 11-17, 21-22 on Windows 10 22H2. They record results in the table's header note (date, OS build, build used, rows skipped and why), as the other runbooks do. If no Windows 10 machine exists, say so in that note and leave the README sentence about Windows 10 as "WebView2 ships with Windows 10 22H2" without claiming it was tested.

- [ ] **Step 4: Refresh the graph and commit**

```bash
graphify update .
git add docs
git commit -m "docs: runbook rows for Null: Setup, the Inno migration and the first-run hand-over"
```

---

## Self-review (done while writing)

- **Spec coverage (2c-3 bullet, "Release pipeline changes" last bullet, "Open risks" last bullet):** `Null: Setup` in the Features launcher (T2); calls `null-setup modify` for file changes (T2 → wizard Modify, T5 rows 21-22, 26); delete Inno step, `installer/null-ide.iss`, `scripts/install-null-ide.ps1` (T3), `updater/` and `update-null-ide.ps1` (already gone, noted); keep `Null.VisualElementsManifest.xml` (T3 Step 1); update `build-local.ps1` (T3 Step 3) and README install instructions (T4 Step 1); Windows 10 22H2 matrix (T5 Steps 1 and 3, honest about being a person's job); "keep the last Inno installer and zip available for the one reinstall" (v1.0.17 stays on its GitHub Release; README says where old installs come from — T4); the 2c-2 known gap (T1).
- **Placeholders:** none. The edits to `build.yml`, `build-local.ps1`, `sync-local.ps1`, README and CLAUDE.md name the exact lines/blocks; the line numbers are approximate on purpose (the files change) and every block is identified by its text. Task 3 Steps 5 and 8 and Task 4 Step 6 are mechanical checks that catch a missed edit.
- **Type consistency:** `merge(Result<()>, Result<(), String>) -> Result<()>` (T1) matches its call in `dispatch`; `is_partial` keeps matching because every `merge` message starts with `installed, but`. The argv in `setupIntegration.ts` (T2) is byte-for-byte the list in the `args.rs` pin test; `findInstall` is the exported name in `updater.ts`; the feature id `setup` / command `null.setup.open` agree in `package.json`, the test and the TS file.
- **Not in this plan:** an in-IDE webview for the saved choices; editing first-run presets after the first start; a stub-fetching PowerShell one-liner; an offline installer; code signing. Each is a "when someone asks" item.

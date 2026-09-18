# Native Updater: Fix + Improve

## Problem

`updater/src/main.cpp` is a fully-implemented native Win32 updater (WinHTTP download,
miniz extraction, TaskDialog progress UI) that CI already builds and bundles into every
release (`resources/app/null-updater/null-updater.exe`, see `build.yml:597-616`). It is
never invoked.

A merge from another machine (`8060bd8 fix: missing changes from other pc`) added
native-EXE-aware updater logic (`getUpdaterExePath`, retry/error-formatting for the
GitHub API, an improved `compareVersionTags`) directly into `extensions/null-tools/src/extension.ts`,
but never wired it to a command. The live `null.installUpdate` command is still
registered in `updaterIntegration.ts`, which calls the old `installUpdate` in
`updater.ts` — a module with zero knowledge the EXE exists. Result: clicking
"Update Now" always runs the old PowerShell-launcher flow; the EXE ships but is dead
weight.

Secondary bugs found while reading both implementations, all still present in the code
that will become live:

- `compareVersionTags` (both copies) falls back to raw string equality when any version
  segment is non-numeric (e.g. a prerelease tag like `v1.2.0-beta`), so such a release is
  reported as "not newer" unless the tag string matches byte-for-byte.
- The EXE-invocation code never passes `--version`, so the EXE re-resolves "latest"
  itself instead of installing the exact version the user confirmed in the dialog —
  a race if a newer release lands between check and install.
- `main.cpp`'s GitHub JSON parsing does whole-buffer substring search rather than
  scanning within asset object boundaries, and never checks the HTTP status before
  parsing (a rate-limited/404 response silently "succeeds" with an empty download URL).
- `main.cpp`'s `ExecuteUpdate` has no rollback on exception after the backup rename —
  if extraction or the swap fails partway, the user can be left with a half-installed
  app and a stray `.null-ide-bak-*` directory. The PowerShell installer already does
  this correctly (`install-null-ide.ps1`'s `Install-Zip` catch block); the EXE doesn't.
- The EXE only does file swap + metadata write. It doesn't re-run context-menu /
  file-association / preview-handler / default-settings registration the way
  `install-null-ide.ps1`'s `Install-Zip` does on every install — so updating via the
  native path would silently stop refreshing those registrations across releases.

## Goals

1. Make the native EXE the actual path `null.installUpdate` runs, foreground and background.
2. Fix the bugs above.
3. Add, per explicit request: checksum verification, changelog display, background
   download (restart-only-prompt), and better failure recovery (retry, rollback).

## Non-goals

- No new UI framework/webview. Changelog and progress reuse existing native surfaces
  (VS Code modal `detail`, the EXE's own TaskDialog).
- No delta/binary-diff updates — full zip swap, as today.
- No change to the Inno Setup installer's fresh-install path (`install-null-ide.ps1`
  without `-ReapplyRegistrations` is unaffected).

## Architecture

Background downloading could live in the EXE (a headless `--download-only` mode running
detached) or in the TS extension (reusing the `https` logic it already has for update
checks). **Decision: TS does the background download.**

Rationale:
- The extension host process already runs continuously; a background download there
  needs no detached-child-process lifecycle management across IDE restarts.
- The EXE only needs one new flag (`--zip-path <file>`) to skip its own fetch and go
  straight to verify+extract+swap.
- Checksum verification happens naturally where the bytes are already streaming
  (`crypto.createHash('sha256')` during download), rather than needing a second pass.

The EXE keeps its own download+verify capability as the foreground fallback for
"Update Now" clicked before the background download has finished, or if the
background download failed/was skipped (e.g. offline at check time, then briefly
online only when the user manually triggers install).

### Flow

1. **Check** (existing, `checkForUpdate`): also fetches the release's `body` (changelog
   text) and the `.sha256` sidecar URL. Stored on `AvailableUpdate`.
2. **Background stage**: extension starts streaming the zip to
   `%TEMP%\null-ide-update-staged\<version>\<asset-name>`, computing SHA256 as it
   streams. Status bar shows a quiet "Downloading update…" state — no interruption to
   the user. State (`version`, `zipPath`, `sha256`, `verified`) is persisted in
   `context.globalState` so a restart mid-download resumes correctly (existing partial
   file is discarded and restarted; there's no resumable-range download, that's out of
   scope).
3. **Ready**: once verified, status bar flips to "Restart to update". Clicking shows a
   modal (`vscode.window.showInformationMessage(..., { modal: true, detail })`) with
   the version and a changelog excerpt (`release.body`, truncated to ~600 chars) —
   this is a native VS Code modal capability, no new UI surface.
4. **Confirm → install**: extension spawns
   `null-updater.exe --zip-path <staged.zip> --version <tag> --repo <repo> --install-dir <dir> --wait --launch`
   (staged zip already verified, so the EXE trusts it and skips its own checksum pass
   in this case). The EXE shows its TaskDialog with real progress for the (fast,
   no-download) extract+swap phase. After a successful swap, before declaring done, it
   shells out once to
   `powershell -File install-null-ide.ps1 -ReapplyRegistrations -InstallDir <dir>`
   to refresh context-menu/file-assoc/preview-handler/default-settings, then relaunches
   `null.exe` and exits. Extension quits the old process shortly after spawning.
5. **Fallback**: if no staged zip exists yet (background download still running, failed,
   or was skipped), the extension omits `--zip-path` and the EXE runs its own
   fetch-latest-release → download → verify-checksum → extract → swap path, same as
   step 4 from "extract+swap" onward, just with the download visible in its own
   progress bar.
6. **Failure at any point in the EXE**: TaskDialog switches to an error state with
   **Retry** and **Close** buttons (custom `TASKDIALOG_BUTTON`s replacing the current
   blocking `MessageBoxW` + forced close). Retry re-runs `ExecuteUpdate` in the same
   process. On any exception after the backup rename has happened, the backup is always
   renamed back to the install dir before the error is surfaced (mirrors the existing
   PowerShell rollback).

### Staged-download storage

`%TEMP%\null-ide-update-staged\<version>\` — versioned subdirectory so a newly-detected
version invalidates any older staged download (old dir is deleted, new download starts).
Chosen over `%LOCALAPPDATA%` because it's already used for the same purpose by the
existing PowerShell flow (`updaterDir` under `%TEMP%`) and gets cleaned by the OS
naturally if abandoned.

## Changes by file

### `extensions/null-tools/src/extension.ts`
Delete the dead duplicate block added by the other-machine merge: `getUpdaterExePath`,
the second `checkForUpdate`/`installUpdate`/`promptForUpdate`, `formatNetworkError`,
the second `compareVersionTags`/`requestJson`/`trimVersionTag`/`getUpdaterScriptPath`/
`getInstallDir`/`getInstallDirCandidates`/`getInstallMetadata`/`getCurrentVersion`/
`getUpdateRepo`/`hasWindowsPackage`/`getLatestRelease`. None of it is referenced by any
command registration — `updater.ts` already has (and keeps) equivalents.

### `extensions/null-tools/src/updater.ts` (becomes the sole updater implementation)
- Port from the dead `extension.ts` code: native-EXE path resolution
  (`getUpdaterExePath`, checked before falling back to the PS script), retry + network
  error formatting in `requestJson`, the `left === right` / `'local'` fast paths in
  `compareVersionTags`.
- Fix the real bug: replace the NaN-fallback string-equality compare with a proper
  per-segment compare — numeric prefix compared numerically, then any non-numeric
  suffix (e.g. `-beta`, `-rc.1`) compared as a tail string only when the numeric prefixes
  are equal, so `v1.2.0-beta` vs `v1.2.0` correctly resolves (treat a bare version as
  newer than the same version with a prerelease suffix — standard semver precedence),
  and two different prerelease tags on the same numeric version still compare
  (lexicographic) rather than silently reporting "no update".
- `AvailableUpdate` gains `releaseNotes?: string` (from `release.body`, present when
  the check ran) and `sha256Url?: string` (asset's sibling `.sha256`, resolved by name
  convention `<asset>.sha256` from the same release's asset list).
- New: background staging logic — `stageUpdateInBackground()` triggered right after a
  new update is detected (both on the silent startup check and on manual
  "Check for Updates"), downloading via `https` with incremental SHA256, persisting
  progress/result in `globalState` under a versioned key, exposed via a
  `null.availableUpdate.staged` boolean the status bar reads to switch its label.
- `installUpdate()`: resolves the staged zip path if present and verified, builds the
  EXE argument list (`--zip-path` included/omitted accordingly, `--version` always
  included), otherwise falls back to the existing PS-script launcher path only if the
  EXE truly can't be found (keeps today's behavior as a last-resort safety net, not the
  default).
- `promptForUpdate()`: modal gains `detail: update.releaseNotes` (truncated) when present.

### `extensions/null-tools/src/updaterIntegration.ts`
Minor: status bar label distinguishes "available" (not yet staged) vs "ready to
install" (staged + verified) states — two text/tooltip variants driven off the new
`globalState` flag, same command wiring otherwise.

### `updater/src/main.cpp`
- `ParseArgs`: add `--zip-path`.
- `ExecuteUpdate`: if `zip-path` given, skip `FetchReleaseInfo` + `DownloadFile`
  entirely and use the given file (still calls `FetchReleaseInfo` in a lightweight
  metadata-only mode *only if* `--version` wasn't also given — but per the flow above,
  the caller always passes both, so this is a defensive fallback, not the common case).
- `FetchReleaseInfo`: replace whole-buffer substring scan with scanning restricted to
  each `{...}` object inside the `assets` array (split on top-level object boundaries,
  track brace depth) so field extraction can't cross into a neighboring asset; check
  the WinHTTP response status code before parsing and throw a message that includes it
  (e.g. `GitHub API returned 403` instead of a generic "asset not found").
- New `FetchAndVerifySha256`: if no `--zip-path` was given (EXE did its own download),
  fetch `<downloadUrl>.sha256`, compute SHA256 of the downloaded file via
  `BCryptHashData` (`bcrypt.dll`, already part of Windows, no new dependency), compare;
  throw a clear "downloaded file failed integrity check" error on mismatch rather than
  proceeding.
- `ExecuteUpdate`: wrap the stage/swap section so that if `bakDir` was created and a
  later step throws, `bakDir` is renamed back to `targetInstallDir` before the
  exception propagates (mirrors `install-null-ide.ps1`'s catch block).
- After a successful swap, before declaring success: `CreateProcessW` a hidden
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <installDir>\resources\app\null-updater\install-null-ide.ps1 -ReapplyRegistrations -InstallDir <installDir>`
  and wait for it to exit (best-effort — log/ignore a non-zero exit rather than failing
  the whole update over a registration hiccup).
- `TaskDialogCallbackProc` / `WorkerThreadProc`: on failure, instead of `MessageBoxW`
  followed by a forced `IDCANCEL` click, reconfigure the TaskDialog with custom
  `TASKDIALOG_BUTTON`s (`Retry`, `Close`) via `TDM_CLICK_BUTTON`/button-array update,
  and handle `TDN_BUTTON_CLICKED` for `Retry` by resetting state and re-invoking
  `ExecuteUpdate` on a fresh worker thread instead of closing the dialog.

### `scripts/install-null-ide.ps1`
New `-ReapplyRegistrations` switch, handled alongside the existing early-return
switches (`-RegisterContextMenu` etc.): runs `Register-ContextMenu`,
`Register-Win11ContextMenu`, `Register-FileAssociations`, `Register-PreviewHandler`,
and `Set-DefaultSettings` against `-InstallDir`, in that order, then returns. No new
logic — just a single switch that chains the existing functions instead of requiring
four separate invocations.

### `.github/workflows/build.yml`
One extra line in the "Create zip archive" step: after `Compress-Archive`, run
`Get-FileHash null-ide-win32-x64.zip -Algorithm SHA256` and write
`<hash>  null-ide-win32-x64.zip` to `null-ide-win32-x64.zip.sha256`, uploaded to the
release alongside the zip and installer (standard `sha256sum`-compatible format).

## Error handling

- Background download failure (network blip, disk full, checksum mismatch): logged to
  the existing "Null IDE Updates" output channel, staged state cleared, status bar
  falls back to "Update available" (unstaged) — user can still click through to the
  EXE's own foreground download path.
- EXE-side failure: TaskDialog Retry/Close as described; rollback restores the previous
  install on any failure after the backup rename.
- Registration reapplication failure: non-fatal, logged only — the update itself has
  already succeeded by that point.

## Testing

- `versionComparison.test.ts` (already exists, currently only covers the `'local'`
  cases): extend with cases for prerelease suffixes (`v1.2.0-beta` vs `v1.2.0`,
  `v1.2.0-alpha` vs `v1.2.0-beta`) to lock in the fixed comparison behavior — this is
  the one existing automated test surface for this subsystem, no new framework needed.
- Everything else here is only meaningfully testable against a real Windows install
  (native EXE, registry writes, TaskDialog) — per `CLAUDE.md`, CI builds run in GitHub
  Actions, not locally; local validation goes through `scripts/sync-local.ps1` +
  manual exercise of an actual install, same as the rest of this subsystem already
  requires.

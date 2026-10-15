# Null Setup: Installer, First-Run Setup and Updater (#130)

Related: #12 and #120 (updater reported broken, never reproduced), #90 (import from VS Code), #23 (null-sync). Supersedes `native-updater-design.md` once sub-project 1 ships.

## Problem

Install and update are spread over four moving parts: the Inno Setup script, `scripts/install-null-ide.ps1` (999 lines), the native `updater/` (C++, 953 lines) and `scripts/update-null-ide.ps1`, all driven by `extensions/null-tools/src/updater.ts`. The native updater rework of 2026-09-19 implemented its whole spec, yet #12 and #120 still report failures, and nobody has reproduced one. Users also cannot choose built-in extensions, marketplace extensions or settings during installation, and cannot change install-time choices later without reinstalling.

## Goals and non-goals

Goals: one tested install/update pipeline; a personalizing wizard; updates that never lose user data and roll back on failure; install choices that can be changed later.

Non-goals:
- Delta updates, macOS/Linux installers, a second settings system.
- An offline (embedded-payload) installer (a later add: pass the zip as an argument).
- Auto-installing marketplace extensions on updates.
- Migrating existing installs. The only current user reinstalls once by hand; the old paths are deleted in the same release with no transition hop.
- Code signing. The README documents the SmartScreen prompt; SHA256 only guards against corruption or truncation, not a compromised release.
- A prerelease update channel (stable only; `-IncludePrerelease` is dropped).
- A WebView2 bootstrapper or console fallback.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Installer technology | Rust core + Tauri (WebView2) UI, replacing Inno Setup | HTML/CSS/TS wizard that can follow `DESIGN.md`; Rust is already on the CI runner (`build.yml:84`); one binary replaces four moving parts |
| Payload | Small online stub; downloads the release zip, verifies SHA256 | Install and update share one fetch, verify, stage and swap path |
| Built-in selection | Unchecked built-ins are left off disk | Built-ins are discovered by scanning `resources/app/extensions/` (copied in `build.yml:233-245`); this avoids the private `state.vscdb` enablement state |
| Locked "Core" built-ins | `null-tools`, `null-accounts`, `null-theme`, `null-icons` | `null-tools` hosts the updater, dashboard, `Null: Setup` and first-run consumer and depends on `null-accounts`; `product.json` names `null-theme`/`null-icons` as defaults |
| Personalization UI | The wizard (system and extension choices) and `Null: Setup` in the IDE (change later) | One saved choice set, two entry points |
| Download timing | Headless `prefetch` right after a release is detected; installs only start from an explicit click | Keeps "Restart to update" instant, as the current background staging does |
| Supported Windows | Windows 11 and Windows 10 22H2 (both ship WebView2) | Revisit if other developers start using it |
| UAC | Only a fresh install or `modify` may elevate; `update` and `repair` never do | No surprise admin prompt mid-update |

## Architecture

New directory `setup/`: a Rust workspace with `core` (library, no UI, `cargo test`) and `app` (Tauri shell plus the TS UI under `setup/ui/`). Output: `null-setup.exe`.

Modes:

| Mode | Purpose |
|---|---|
| default (no install found) | Wizard, then fresh install |
| `prefetch --version <tag>` | Headless: resolve, download and verify the release zip into the updates cache; no window |
| `update --version <tag> --wait --launch` | Called by null-tools; progress window; uses the prefetched zip if present, else downloads; verify, stage, swap, relaunch |
| `modify` | Wizard pre-filled from `install-config.json` |
| `repair` | Reinstall the current version with the saved choices |
| `uninstall` | Remove files, registrations, PATH entry and the Add/Remove Programs entry |

An installed copy lives at `<installDir>\setup\null-setup.exe`. `update` runs from a temp copy so the install directory can be replaced.

`core` modules:
- `release`: resolves the release (tag, zip asset, `.sha256` sidecar, `builtins.json`) for an exact tag, and reports HTTP status in errors.
- `download`: resumable download into `%LOCALAPPDATA%\Null\updates\<version>\`, streaming SHA256, size check against `Content-Length`; a single-writer lock file so concurrent checks or a `prefetch` and an `update` cannot delete a download in progress. Old versions' caches are removed once an update succeeds.
- `swap`: journaled directory swap (see Update safety).
- `procs`: finds running `null.exe` processes of this install and closes them gracefully, then reports what is still locking files.
- `shell`: ports `Register-*`/`Unregister-*` from `install-null-ide.ps1`: HKCU context menu, Win11 sparse APPX with the self-signed certificate flow, file associations, preview handler, PATH, shortcuts. Each registration is idempotent and individually reversible. Only the certificate step can elevate (see UAC below).
- `config`: reads and writes `install-config.json` and the legacy `.null-ide-install.json`.

## State and files

| File | Owner | Content |
|---|---|---|
| `<installDir>\.null-ide-install.json` | setup | `version`, `repo`, `installedAt`, `installDir`. Unchanged fields, so null-tools keeps reading it |
| `<installDir>\install-config.json` | setup | shell-integration toggles; built-in extension selection; schema version |
| `builtins.json` (in the zip and a release asset) | build | per built-in: `id`, `label`, `description`, `default`, `locked`, `requires[]` (e.g. `null-format` requires `null-env`); plus the marketplace table (empty for now) and the settings table. The wizard reads the manifest of the version being installed |
| `%APPDATA%\Null\null-setup\first-run.json` | setup writes, null-tools consumes | allowlisted settings; marketplace extension ids |
| `%LOCALAPPDATA%\Null\logs\setup-<timestamp>.log` | setup | step-by-step log |

The installer never writes inside `%APPDATA%\Null\User\` (settings, keybindings, snippets, profiles) and never touches extension state. The old `Set-DefaultSettings` seeding is removed; application defaults stay in `product.json → configurationDefaults`, which keeps "application defaults" separate from "user-defined settings".

## Wizard flow

1. Welcome (version, install directory).
2. Installation options: directory, desktop and Start Menu shortcuts, PATH, context menu, file associations, preview handler, Safe Mode shortcut. "Win11 context menu" is on by default with the note "may ask for administrator approval once".
3. Built-in extensions: checklist with descriptions and defaults; the four Core extensions are shown checked and locked; selecting an extension selects its `requires`; deselecting one that others require is blocked with the reason.
4. Marketplace extensions: shown only when the marketplace table has entries (it starts empty, so the page is hidden). The IDE installs them on first launch; the wizard never talks to the marketplace.
5. Settings (optional): six settings: color theme variant, editor font family and size, auto save, format on save, update check on/off, classic vs compact menu bar. Anything else is edited in the normal Settings editor.
6. Summary of all choices; Install. A "Use recommended defaults" button on every page skips ahead.
7. Progress (download, verify, extract, register), then Finish with "Launch Null IDE".

`modify` opens the same pages pre-filled, with only the changed parts applied.

## First launch

null-tools reads `first-run.json` once:
- Settings: set a key only if the user has no value for it; only allowlisted keys.
- Marketplace extensions: installed one at a time with a per-extension timeout. No network or a failure produces one "N extensions could not be installed (Retry)" notification and never blocks anything.
- The file is deleted only after it was processed, so a crash retries on next launch.

`Null: Setup` (listed in the Features launcher) shows the saved choices and edits them; changes that need file changes call `null-setup modify`.

## Update safety

1. null-tools checks on a schedule (existing 6 h throttle) and shows status. On finding a newer stable release it runs `null-setup prefetch --version <tag>`. On the user's explicit click it runs `update --version <tag>` and quits. Nothing installs silently.
2. `null-setup update` resolves the release for exactly that tag, uses the verified prefetched zip or downloads (resumable), verifies SHA256 and zip integrity, extracts to a staging directory beside the install.
3. Close `null.exe` processes; if files stay locked, wait with a visible reason and a Retry button.
4. Journaled swap: write the journal, rename the install directory aside, move the staged directory in, re-apply `install-config.json` (omit unselected built-ins) and registrations.
5. Launch the new `null.exe`; delete the old copy only after null-tools writes a ready marker (or after 30 s alive). Any failure before that renames the old install back and keeps the downloaded zip for retry.
6. A journal found at the next start (power loss mid-swap) is completed or rolled back automatically.

UAC: `update` and `repair` never elevate. If the shell-extension certificate thumbprint is unchanged, the registration is kept. If trust is missing or the thumbprint changed, the update still succeeds, the context menu is reported as "needs re-approval", and a button runs `modify`. Only a fresh install or `modify` may start the elevated certificate import.

States shown by both the window and null-tools' status item: checking, downloading (bytes and speed), verifying, preparing, installing, restarting, up to date, failed with the log path and a "Copy diagnostics" button.

## Uninstall

Removes the app, registrations, the PATH entry and the Add/Remove Programs entry. `%APPDATA%\Null` (settings, extensions, data) is kept by default; the last page has an unchecked "Also delete my settings, extensions and data".

## Release pipeline changes (`build.yml`)

- Build `setup/` with cargo. Nothing is signed; the README documents the SmartScreen prompt and the limits of the SHA256 check.
- Generate `builtins.json` from the extensions' `package.json` descriptions plus a small hand-maintained table of defaults, locks, dependencies, settings and (empty) marketplace entries; include it in the zip and as a release asset.
- Publish `NullIDESetup-<version>.exe` (the stub), the zip and its `.sha256`.
- Delete the Inno Setup install step, `installer/null-ide.iss`, `updater/`, `scripts/update-null-ide.ps1` and `scripts/install-null-ide.ps1` once `shell` in `core` reproduces its registrations. Keep `Null.VisualElementsManifest.xml` if still needed for the Win10 tile. Update `scripts/build-local.ps1` and the README install instructions to match.

## Sequencing

**Sub-project 1: updater reliability.**
1. Reproduce the failure on a real install (old version to new) and write down the root cause. Suspect to check first: `stageUpdateInBackground` removes the staging root on every check while another download may still be writing. If the cause is a contained bug, ship a hotfix on the current path first, then continue; if it points at the architecture, skip the hotfix.
2. Build `setup/core` with `prefetch` and `update` modes, tests, rollback and journal recovery.
3. Switch null-tools to delegate download and install; delete the staging code, `updater/` and the PowerShell update path.
4. Ship; run the manual update matrix (below).

**Sub-project 2: installer and first-run setup.** Wizard UI, `builtins.json`, `install-config.json`, `modify`, `repair`, `uninstall`, the `first-run.json` consumer in null-tools, `Null: Setup`, retire Inno. Too large for one plan, so it ships in three slices:

- **2a installer engine** (`docs/plans/null-setup-installer-engine.md`): `builtins.json` and `install-config.json`, the `install`, `modify`, `repair` and `uninstall` modes as a headless CLI, per-feature registrations (still through `install-null-ide.ps1`), updates that honor the saved choices.
- **2b registrations in Rust**: the `shell` module replaces `install-null-ide.ps1`.
- **2c wizard and first run**: the wizard UI and stub installer, `first-run.json` and its null-tools consumer, `Null: Setup`, the Add/Remove Programs entry, retiring Inno.

Each sub-project and slice gets its own implementation plan.

## Error handling

- Network: retried with backoff (3 attempts); resumable downloads; rate-limited or 4xx responses name the status and the URL.
- Checksum or size mismatch: delete the partial file, retry once, then fail with the expected and actual hashes in the log.
- Locked files or still-running IDE: visible wait with the blocking process names; never kill without an explicit button.
- Missing WebView2 runtime: a native error dialog with the download link. No bootstrapper and no console fallback.
- Disk space is checked before download.
- Registration failures (APPX, preview handler, certificate trust) are non-fatal, reported on the final page and in the log, and repairable with `modify` or `repair`.

## Testing

- `core`: unit tests for release parsing, download resume, lock handling and mismatch handling (local HTTP server), swap and journal recovery (kill the process at each step, assert rollback or completion), dependency resolution of built-ins, config round-trips. All run in CI via `cargo test`.
- null-tools: tests for `first-run.json` consumption (set only when unset, allowlist, partial failure, retry) and for the status-item state mapping, in the existing `node --test` setup.
- Manual matrix, recorded in the PR: fresh install with defaults; fresh install with a customized selection; update with the IDE running; update with a file locked; update with the network cut mid-download; update killed mid-swap; update with the certificate untrusted; `modify` adding and removing a built-in; `uninstall` with and without deleting data. Run on Windows 11 and Windows 10 22H2.

## Open risks

- The unreproduced updater failure may be outside the update path (for example, a version-metadata mismatch). Step 1 of sub-project 1 settles this before any `setup/` code is written.
- Porting the registration logic (APPX, certificate trust, preview handler) from PowerShell to Rust is the largest-risk piece; keep behavior identical and test on a clean machine.
- With a single reinstall as the only migration, the first `null-setup` release has no fallback if the new installer itself is broken; keep the last Inno installer and zip from the previous release available for that one reinstall.

# Safe Mode Design (#18)

## Goal

Launch Null IDE with every Null-owned and user-installed extension disabled, so a user can tell whether a problem comes from an extension, without uninstalling or reconfiguring anything.

## Findings that shape the design

- VS Code already has `--disable-extensions`. It is not persisted (a fresh launch restores extensions) and `windowImpl.load` plumbs it through reloads. It only disables extensions where `!extension.isBuiltin` (`extensionEnablementService._isDisabledInEnv`), so Null's ten built-ins and Code Spell Checker keep running.
- Blocking happens in the enablement service, before the extension host activates anything, so a faulty extension cannot affect a safe-mode startup.
- There is no `--safe-mode` flag, no safe-mode indicator, no startup-failure detector, and no entry point that works without the UI.
- Patch 003 opens `null-dashboard:` on startup; that scheme is served by null-tools, which is disabled in safe mode.
- Crash recovery (#17) lives in null-tools, so it cannot see or help with a startup that is broken by extensions.

## Decisions

- **Scope of "all extensions":** user-installed extensions and Null-owned built-ins (publisher `null`, plus `streetsidesoftware.code-spell-checker`). VS Code's upstream built-ins stay enabled; they provide the default theme, grammars and git, and without them the editor is barely usable.
- **Startup recovery** is a main-process feature, because a broken extension may be the reason no extension code can run.

## Design

One new patch, `patches/009-safe-mode.patch`, against the VS Code source tree. No new extension.

### 1. `--safe-mode`

- `argv.ts` / `argv.d.ts` add a boolean `safe-mode` option (listed in `--help`). `IEnvironmentService` gets `isSafeMode`.
- `_isDisabledInEnv` returns true when `isSafeMode` and the extension is not an upstream built-in: a non-built-in, or a built-in with publisher `null` or id `streetsidesoftware.code-spell-checker`. The resolver-extension exemption is kept.
- `windowImpl` carries `safe-mode` across `reload()` exactly like `disable-extensions` (applied to that load only, not preserved on `currentConfig`).
- Nothing is written to settings or extension state. A launch without the flag is a normal launch.
- Patch 003 gets a guard: when `isSafeMode`, the startup page falls back to the stock Getting Started page.

### 2. Indicator and exit (core)

- A status bar item (shield icon, "Safe Mode", warning background, tooltip "Extensions are disabled") and a "[Safe Mode]" window-title suffix.
- A sticky notification replaces upstream's "temporarily disabled" prompt, with a **Restart Normally** button.
- Commands, registered in core so they exist when extensions are broken: `workbench.action.restartInSafeMode` ("Null: Restart in Safe Mode") and `workbench.action.restartNormally` ("Null: Restart Normally"), both in the Help menu and the Command Palette. Both use the existing `reload()` path.

### 3. Startup recovery (electron-main)

- At launch, increment `startupAttempts` in `safe-mode-state.json` in the user data folder (written atomically).
- Reset it to 0 on a clean quit (`onWillShutdown`) or after the process has stayed up 60 s.
- On a launch that is not safe mode and has `startupAttempts >= 3` (before the increment, i.e. three earlier runs ended without a clean quit or 60 s of uptime), show a native dialog before opening windows: "Null IDE has not started successfully 3 times." with **Start in Safe Mode** / **Start Normally**. The chosen path resets the counter.
- A safe-mode launch never increments the counter and never shows the dialog, so there is no restart loop.
- A missing or corrupt state file counts as 0; recovery must never block startup.
- Ceiling: this detects whole-process failures (crash, hang that is killed, failed launch within 60 s). An extension host that dies later is covered by the manual entry points only.

### 4. Entry points that need no UI

- `scripts/install-null-ide.ps1` creates a Start Menu shortcut "Null IDE (Safe Mode)" running `null.exe --safe-mode`, with the same icon as the main shortcut. It respects `-NoStartMenuShortcut`. No desktop shortcut.
- `README.md` documents `null --safe-mode`.

## Testing

- Pure units with `node --test`: the counter/threshold rules (increment, reset on clean quit and on uptime, threshold at 3, corrupt file) and the extension-ID predicate. The counter module lives in its own file in the patch so it has no Electron imports.
- Shortcut creation is checked by running `install-null-ide.ps1` against a temp directory.
- Behaviour in a real build (flag disables null-tools, indicator, restart commands, startup dialog) is verified by CI or `scripts/build-local.ps1`; `/verify-local` cannot reach a core patch.

## Out of scope

- Disabling upstream built-in extensions.
- Jump List, Explorer or desktop-shortcut entry points.
- Detecting extension-host failures after the 60 s window.
- Persisting safe mode across launches.

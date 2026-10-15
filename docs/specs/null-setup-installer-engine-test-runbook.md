# null-setup installer engine: manual matrix runbook

Companion to `docs/plans/null-setup-installer-engine.md` (Task 9). Record results in the Result column. Reuses the scratch setup of `null-setup-updater-test-runbook.md` (scratch install, fake release server, `NULL_SETUP_API_BASE`).

Automated coverage (all green when this was written): `cargo test --locked -p null-setup-core -p null-setup` (102 tests) and `node --test scripts/gen-builtins.test.mjs` (5 tests). The matrix below covers what they cannot: the real `install-null-ide.ps1 -Register/-Unregister`, real processes, Explorer and the registry.

## Setup

1. Build: `cargo build --release --locked -p null-setup` in `setup/`; the exe is `setup\target\release\null-setup.exe`.
2. Scratch release: take the "new" zip, unzip it, add `builtins.json` at its root (`node scripts\gen-builtins.mjs <unzipped>\builtins.json`), re-zip, recompute the `.sha256`, and serve it with `node scripts\fake-release.mjs --zip <zip> --tag <tag>`. Set `$env:NULL_SETUP_API_BASE = 'http://127.0.0.1:8787'`.
3. Use `Remove-Item -Recurse` on the scratch target between rows. Set `$env:APPDATA = "$env:TEMP\ApData"` for **every** row so your real profile is never involved.
4. Run `null-setup.exe` with its output piped (`... | Out-String`): it is a GUI-subsystem program and prints nothing to an attached console otherwise. Progress is JSON lines; the last line decides.

## Registrations leak to the real machine

`-Register/-Unregister` write the real HKCU keys, the user PATH, the Start Menu `Null IDE` folder and the Desktop shortcut, all under names shared with your daily install. Rows 1, 6, 7, 9, 11 and 14 therefore re-point or delete your real shortcuts, PATH entry, file associations and context menu. After the matrix restore the daily install:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File D:\Coding\Apps\null-ide\scripts\install-null-ide.ps1 -InstallDir "$env:LOCALAPPDATA\Programs\Null IDE" -Register startMenuShortcut,safeModeShortcut,path,contextMenu,fileAssociations,previewHandler -NoElevate
```

## Rows

Command shapes: `null-setup.exe install --version <tag> --install-dir <dir> [--config <file>]`, `modify --install-dir <dir> --config <file>`, `repair --install-dir <dir>`, `uninstall --install-dir <dir> [--delete-data]`, `update --version <tag> --install-dir <dir>`.

| # | Scenario | Expect | Result |
|---|---|---|---|
| 1 | `install` into a new folder with no `--config` | files, `install-config.json` = defaults, `builtins.json` present, Start Menu shortcut + Safe Mode shortcut exist, file associations registered, `<install>\bin` on the user PATH | PASS: defaults config, builtins.json present, Start Menu + Safe Mode shortcuts, associations, `bin` on PATH, Win11 package re-pointed (43 s) |
| 2 | `install` with a config excluding `null-music` and `null-activity` | the two folders are absent, IDE starts, they are missing from `@builtin` | PASS: null-music and null-activity absent, null-env/null-tools present |
| 3 | `install` with a config excluding `null-env` (null-format needs it) | fails with both names in the message; target folder untouched | PASS: `null-env stays installed because null-format needs it`, target folder not created |
| 4 | `install` into a folder holding a text file | refused ("not empty"); the file is untouched | PASS: refused ("not empty"), `precious.txt` untouched |
| 5 | `install` onto the existing scratch install | refused ("already installed") | PASS in unit test `install_refuses_an_existing_install`; not repeated by hand |
| 6 | Update (fake newer tag) on row 2's install | `null-music`/`null-activity` still absent; `install-config.json` unchanged | PASS: v1.0.17 -> v1.0.18 via `update`, both exclusions still absent, install-config.json unchanged |
| 7 | `modify` with only `desktopShortcut: true` and the IDE running | desktop shortcut appears; IDE not closed; no `.null-ide-bak-*` folder was created; only `install-config.json` changed | PASS: with the IDE running (10 processes), modify off/on moved the desktop shortcut, IDE kept running, no `.null-*` folder, only install-config.json changed |
| 8 | `modify` re-adding `null-music` (exclusions now only `null-activity`) | swap happens; `null-music` is back, data kept | PASS: null-music back, null-activity still off, data kept, version unchanged. Without `--force-close` the core still closed the IDE (graceful close within the grace period) and swapped |
| 9 | `modify` with `path: false` | `<install>\bin` leaves the user PATH | PASS: `<install>\bin` left the user PATH |
| 10 | `repair` after deleting `null.exe` from the install | `null.exe` is back, config kept | PASS: Null.exe restored, install-config.json byte-identical, data kept |
| 11 | `uninstall` of a portable scratch install, no `--delete-data` | app gone, `data\` kept, shortcuts, PATH entry, associations and context menu removed | PASS: app, marker, Start Menu folder, desktop shortcut, PATH entry, associations and Win11 package removed; `data\` kept |
| 12 | `uninstall --delete-data` | folder gone, a stand-in `%APPDATA%\Null` is the only user-data target (`$env:APPDATA = "$env:TEMP\ApData"`) | PASS: install folder and the stand-in `APPDATA\Null` removed, `APPDATA\Other` kept |
| 13 | `uninstall` pointed at a normal folder | refused; folder untouched | PASS: refused ("is not a Null IDE install; nothing was removed"), `thesis.txt` kept |
| 14 | Install dir with spaces and non-ASCII (`Null IDE ünï`) for rows 1, 7, 11 | works | PASS: install (row 1), modify (7) and uninstall (11) all ran in `Null IDE ünï` |

## Environment

Windows 11 Pro 10.0.26100, 2026-10-15, release build of `null-setup` after the security-review fixes, scratch release = the pristine build zip with the repo's `install-null-ide.ps1` and a generated `builtins.json`. Windows 10 22H2 stays open.

Notes from the run:
- Launching a scratch IDE from a terminal inside VS Code needs `ELECTRON_RUN_AS_NODE` and `VSCODE_*` removed from the environment, or `Null.exe` runs as Node and exits 0 at once.
- As predicted above, rows 1, 7, 11 and 14 changed the real shortcuts, PATH, file associations and the Win11 package. They were restored from a backup taken before the run (Start Menu `Null IDE.lnk`, Desktop shortcut, user PATH, `install-null-ide.ps1 -Register startMenuShortcut,contextMenu,fileAssociations,previewHandler`).

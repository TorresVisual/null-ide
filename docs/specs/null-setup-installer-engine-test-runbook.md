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
| 1 | `install` into a new folder with no `--config` | files, `install-config.json` = defaults, `builtins.json` present, Start Menu shortcut + Safe Mode shortcut exist, file associations registered, `<install>\bin` on the user PATH | pending |
| 2 | `install` with a config excluding `null-music` and `null-activity` | the two folders are absent, IDE starts, they are missing from `@builtin` | pending |
| 3 | `install` with a config excluding `null-env` (null-format needs it) | fails with both names in the message; target folder untouched | pending |
| 4 | `install` into a folder holding a text file | refused ("not empty"); the file is untouched | pending |
| 5 | `install` onto the existing scratch install | refused ("already installed") | pending |
| 6 | Update (fake newer tag) on row 2's install | `null-music`/`null-activity` still absent; `install-config.json` unchanged | pending |
| 7 | `modify` with only `desktopShortcut: true` and the IDE running | desktop shortcut appears; IDE not closed; no `.null-ide-bak-*` folder was created; only `install-config.json` changed | pending |
| 8 | `modify` re-adding `null-music` (exclusions now only `null-activity`) | swap happens; `null-music` is back, data kept | pending |
| 9 | `modify` with `path: false` | `<install>\bin` leaves the user PATH | pending |
| 10 | `repair` after deleting `null.exe` from the install | `null.exe` is back, config kept | pending |
| 11 | `uninstall` of a portable scratch install, no `--delete-data` | app gone, `data\` kept, shortcuts, PATH entry, associations and context menu removed | pending |
| 12 | `uninstall --delete-data` | folder gone, a stand-in `%APPDATA%\Null` is the only user-data target (`$env:APPDATA = "$env:TEMP\ApData"`) | pending |
| 13 | `uninstall` pointed at a normal folder | refused; folder untouched | pending |
| 14 | Install dir with spaces and non-ASCII (`Null IDE ünï`) for rows 1, 7, 11 | works | pending |

## Environment

Windows 11 only; the Windows 10 22H2 pass stays open.

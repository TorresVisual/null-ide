# File Association & Icons — Design

TODO item: "Better file association management and icons" (`TODO.md`, NULL-Specific Features).

## Problem

Null IDE already has an "Open in Null" Explorer context menu for arbitrary files/folders (`Register-ContextMenu` in `scripts/install-null-ide.ps1`, plus the Win11 `IExplorerCommand` appx in `shell-ext/`). It has no presence, however, in:

1. Windows' native **"Open with..."** picker / right-click "Open with", for any file type.
2. **Settings → Apps → Default apps**, where users could set Null IDE as the default handler for specific file types.
3. **Explorer file icons** — once a user does set Null IDE as default for a type, Explorer would show a generic icon rather than anything branded.

This spec covers registering Null IDE as a discoverable, selectable app for a curated set of code/text file types, each with its own icon matching the in-editor `null-icons` theme.

## Constraints

- No administrator elevation (matches the rest of the installer: `PrivilegesRequired=lowest` in `null-ide.iss`; all association registry entries live under `HKCU`).
- Windows blocks apps from silently becoming the default handler for a file type (UserChoice hash protection, Windows 8+). This feature can only make Null IDE *available*/discoverable — the user still sets defaults themselves via Explorer's "Open with" dialog or Default Apps settings. No workaround is attempted.
- Must work for both install paths this repo supports: the Inno Setup installer (`installer/null-ide.iss`) and the standalone PowerShell installer used for portable ZIP installs/updates (`scripts/install-null-ide.ps1`, also used by the in-app updater).
- Must clean up fully on uninstall.

## Scope: curated extension list

32 icon keys covering 52 extensions, each mapped to an existing `null-icons` source SVG (`extensions/null-icons/src/icons/files/`) — no new artwork required:

| Icon key | Source SVG | Extensions |
|---|---|---|
| `js` | js.svg | .js, .jsx |
| `ts` | ts.svg | .ts, .tsx |
| `python` | python.svg | .py |
| `json` | brackets-yellow.svg | .json |
| `markdown` | markdown.svg | .md |
| `html` | code-orange.svg | .html, .htm |
| `css` | brackets-sky.svg | .css |
| `yaml` | yaml.svg | .yml, .yaml |
| `text` | text.svg | .txt |
| `xml` | xml.svg | .xml |
| `c` | c.svg | .c |
| `h` | h.svg | .h, .hpp, .inl |
| `cplus` | cplus.svg | .cpp, .cc, .cxx, .c++ |
| `csharp` | csharp.svg | .cs |
| `go` | go.svg | .go |
| `rust` | rust.svg | .rs |
| `php` | php.svg | .php |
| `ruby` | ruby.svg | .rb |
| `shell` | shell.svg | .sh, .bash, .ps1 |
| `database` | database.svg | .sql |
| `git` | git.svg | .gitignore, .gitattributes, .gitconfig, .gitmodules |
| `patch` | patch.svg | .patch |
| `cmake` | cmake.svg | .cmake |
| `dart` | dart.svg | .dart |
| `docker` | docker.svg | .dockerfile |
| `notebook` | notebook.svg | .ipynb |
| `csproj` | visual-studio.svg | .csproj |
| `hplus` | hplus.svg | .h++ |
| `java` | java.svg | .java, .jar |
| `lua` | lua.svg | .lua |
| `tex` | tex.svg | .latex |
| `document` (generic, shared by 4 icon keys below via `Icon` override — see Component 2) | document.svg | .cfg, .ini, .config, .code-workspace, .iss, .log |

Not in scope: registering Null IDE for *every* file type (that's already covered by the existing "Open in Null" context menu, which is not being changed). Also not in scope: extensionless filenames (bare `Makefile`, `CMakeLists.txt`) — the registration mechanism below is extension-keyed (`HKCU:\Software\Classes\.<ext>\OpenWithProgids`), which doesn't apply to files with no extension; that would need a different, filename-keyed mechanism and isn't implemented here.

## Component 1: Icon generation

Script `scripts/generate-file-assoc-icons.js`, run manually by a developer (not part of CI, same as `scripts/convert-icons.js`), using the `sharp` / `to-ico` deps already declared in `scripts/package.json`.

- Input: the source SVGs listed above (one entry in the script's `ICONS` map per icon key).
- Output: one multi-size ICO per icon key (16/32/48/256px, same sizing as `convert-icons.js`), written to `icons/file-assoc/<key>.ico`.
- Output files are committed to the repo, like `icons/icon.ico`. Re-run the script by hand if `null-icons`' source SVGs change, or when adding a new icon key.
- Several curated extensions (`.cfg`, `.ini`, `.config`, `.code-workspace`, `.iss`, `.log`) have no themed icon in `null-icons` (it falls back to the generic `document` icon too), so they share the single `document.ico` file rather than each generating a duplicate. `$FileAssocMap` entries for these set an `Icon` override key distinct from their map key — see Component 2.

## Component 2: Registration logic (`scripts/install-null-ide.ps1`)

Single source of truth for the extension → ProgID → icon mapping, expressed as a PowerShell data table at the top of the script (reused for register and unregister).

### `Register-FileAssociations -InstallDir <path>`

For each **icon key**:
- Create ProgID `HKCU:\Software\Classes\NullIDE.AssocFile.<key>`:
  - `(default)` = friendly description (e.g. "JavaScript File")
  - `FriendlyTypeName` = same friendly description (Explorer's Type column/Properties dialog reads `FriendlyTypeName` in preference to `(default)`; it must not be hardcoded to "Null IDE" or every associated file type would show "Null IDE" instead of its own type name)
  - `DefaultIcon\(default)` = `<InstallDir>\resources\file-assoc-icons\<iconKey>.ico,0`, where `<iconKey>` is the map entry's `Icon` override if set, otherwise the icon key itself — this lets multiple icon keys (e.g. `config`, `workspace`, `iss`, `log`) share one underlying `.ico` file (`document.ico`) instead of duplicating identical artwork under different filenames.
  - `shell\open\command\(default)` = `"<InstallDir>\null.exe" "%1"`

For each **extension**:
- `HKCU:\Software\Classes\.<ext>\OpenWithProgids\NullIDE.AssocFile.<key>` = `""` (empty value) — this is what surfaces Null IDE in the "Open with" dialog with its own icon, without altering the current default handler.

App-level registration (once):
- `HKCU:\Software\Classes\Applications\null.exe`:
  - `FriendlyAppName` = "Null IDE"
  - `SupportedTypes` = all curated extensions
  - `shell\open\command\(default)` = `"<InstallDir>\null.exe" "%1"`
- `HKCU:\Software\RegisteredApplications` → value `Null IDE` = `Software\Classes\NullIDE\Capabilities`
- `HKCU:\Software\Classes\NullIDE\Capabilities`:
  - `ApplicationName` = "Null IDE"
  - `ApplicationDescription` = short description
  - `FileAssociations\.<ext>` = `NullIDE.AssocFile.<key>` for every curated extension

This `RegisteredApplications` + `Capabilities` registration is what makes "Null IDE" appear as a single entry under **Settings → Apps → Default apps → Set defaults for an app**, letting users bulk-assign all curated types at once, in addition to the per-file "Open with" entries.

Finally, call `SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0)` via an inline `Add-Type` P/Invoke of `shell32.dll`, so Explorer picks up the new associations immediately without restarting `explorer.exe`.

### `Unregister-FileAssociations`

Removes every key created above (mirrors the existing `Unregister-ContextMenu` shape), then calls `SHChangeNotify` again.

### New switches

- `-RegisterFileAssociations` / `-UnregisterFileAssociations` top-level script switches (parallel to the existing `-RegisterContextMenu` / `-RegisterWin11ContextMenu`), for direct invocation from Inno's `[Run]` / uninstall steps.
- `Install-Zip` gains a `-NoFileAssoc` switch (parallel to `-NoContextMenu`); when not set, `Register-FileAssociations` is called automatically after `Register-ContextMenu` during install/update.

## Component 3: Installer wiring (`installer/null-ide.iss`)

- New `[Tasks]` entry, checked by default:
  ```
  Name: "fileassoc"; Description: "Register Null IDE as an available app for common code file types"; GroupDescription: "Shell integration:"
  ```
- New `[Run]` line, gated on the `fileassoc` task, following the existing Win11-context-menu pattern:
  ```
  Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\resources\app\null-updater\install-null-ide.ps1"" -RegisterFileAssociations -InstallDir ""{app}"""; Flags: runhidden; Tasks: fileassoc; Description: "Registering file associations"
  ```
- `CurUninstallStepChanged` gains an added `Exec` call (alongside the existing appx-removal call) running the bundled ps1 with `-UnregisterFileAssociations -InstallDir "{app}"` before the app directory is removed.

`scripts/update-null-ide.ps1` needs no change — it delegates to `install-null-ide.ps1 -Force`, which re-runs `Register-FileAssociations` as part of `Install-Zip`.

## Component 4: Build pipeline (`.github/workflows/build.yml`)

Add a copy step alongside the existing icon-staging steps to copy `icons/file-assoc/*.ico` into the win32 build output at `resources/file-assoc-icons/`, so the path referenced by `DefaultIcon` in Component 2 exists in the installed app.

## Uninstall correctness

Because association registry entries embed the absolute install path and are written imperatively (not via Inno's declarative `[Registry]` + `uninsdeletekey`), the explicit `-UnregisterFileAssociations` call in `CurUninstallStepChanged` is required — not optional — for clean removal. This is the one place this design must be more careful than the existing declarative context-menu entries.

## Out of scope

- Per-file-type icons or associations beyond the curated 32-icon-key/52-extension list.
- Extensionless filenames (bare `Makefile`, `CMakeLists.txt`, etc.) — see the note under "Scope: curated extension list".
- Any attempt to silently set Null IDE as the default handler (blocked by Windows; not attempted).
- Changes to the existing "Open in Null" context menu or Win11 `IExplorerCommand` shell extension — unrelated and untouched.
- macOS/Linux file associations (Windows-only project per `CLAUDE.md`).

## Testing

Since builds/installers run only in CI (`CLAUDE.md`: "Do not run CI or build scripts locally"), verification of the registration logic itself (registry key shapes, `Register-`/`Unregister-FileAssociations` idempotency) can be exercised locally by running `install-null-ide.ps1 -RegisterFileAssociations -InstallDir <existing local install>` directly and inspecting `HKCU:\Software\Classes` — this doesn't require a build. Full end-to-end verification (installer task, uninstall cleanup, Explorer icon display) requires a release build from CI.

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

20 unique icons covering ~26 extensions, each mapped to an existing `null-icons` source SVG (`extensions/null-icons/src/icons/files/`) — no new artwork required:

| Icon key | Source SVG | Extensions |
|---|---|---|
| `js` | js.svg | .js, .jsx |
| `ts` | ts.svg | .ts, .tsx |
| `python` | python.svg | .py |
| `json` | brackets-yellow.svg | .json |
| `markdown` | markdown.svg | .md |
| `html` | code-orange.svg | .html |
| `css` | brackets-sky.svg | .css |
| `yaml` | yaml.svg | .yml, .yaml |
| `text` | text.svg | .txt |
| `xml` | xml.svg | .xml |
| `c` | c.svg | .c |
| `h` | h.svg | .h, .hpp |
| `cplus` | cplus.svg | .cpp, .cc, .cxx |
| `csharp` | csharp.svg | .cs |
| `go` | go.svg | .go |
| `rust` | rust.svg | .rs |
| `php` | php.svg | .php |
| `ruby` | ruby.svg | .rb |
| `shell` | shell.svg | .sh, .bash, .ps1 |
| `database` | database.svg | .sql |

Not in scope: registering Null IDE for *every* file type (that's already covered by the existing "Open in Null" context menu, which is not being changed).

## Component 1: Icon generation

New script `scripts/generate-file-assoc-icons.js`, run manually by a developer (not part of CI, same as `scripts/convert-icons.js`), using the `sharp` / `to-ico` deps already declared in `scripts/package.json`.

- Input: the 20 source SVGs listed above.
- Output: one multi-size ICO per icon key (16/32/48/256px, same sizing as `convert-icons.js`), written to `icons/file-assoc/<key>.ico`.
- Output files are committed to the repo, like `icons/icon.ico`. Re-run the script by hand if `null-icons`' source SVGs change.

## Component 2: Registration logic (`scripts/install-null-ide.ps1`)

Single source of truth for the extension → ProgID → icon mapping, expressed as a PowerShell data table at the top of the script (reused for register and unregister).

### `Register-FileAssociations -InstallDir <path>`

For each **icon key**:
- Create ProgID `HKCU:\Software\Classes\NullIDE.AssocFile.<key>`:
  - `(default)` = friendly description (e.g. "JavaScript File")
  - `FriendlyTypeName` = "Null IDE"
  - `DefaultIcon\(default)` = `<InstallDir>\resources\file-assoc-icons\<key>.ico,0`
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

- Per-file-type icons or associations beyond the curated 20-icon/~26-extension list.
- Any attempt to silently set Null IDE as the default handler (blocked by Windows; not attempted).
- Changes to the existing "Open in Null" context menu or Win11 `IExplorerCommand` shell extension — unrelated and untouched.
- macOS/Linux file associations (Windows-only project per `CLAUDE.md`).

## Testing

Since builds/installers run only in CI (`CLAUDE.md`: "Do not run CI or build scripts locally"), verification of the registration logic itself (registry key shapes, `Register-`/`Unregister-FileAssociations` idempotency) can be exercised locally by running `install-null-ide.ps1 -RegisterFileAssociations -InstallDir <existing local install>` directly and inspecting `HKCU:\Software\Classes` — this doesn't require a build. Full end-to-end verification (installer task, uninstall cleanup, Explorer icon display) requires a release build from CI.

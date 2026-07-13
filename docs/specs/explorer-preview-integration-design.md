# Explorer Preview Integration — Design

TODO item: "Explorer preview integration" (`TODO.md`, NULL-Specific Features).

## Problem

Windows Explorer's Preview Pane (View → Preview Pane, or Alt+P) shows "No preview available" for almost every code/text file type — `.ts`, `.py`, `.rs`, `.json`, `.md`, etc. — because no preview handler is registered for them on a typical machine. This sits alongside the existing native Windows integrations (`shell-ext/` context menu, jump list, file associations) as another piece of Null IDE feeling native on Windows: selecting a source file in Explorer should show its content, not a blank pane.

This spec covers registering a plain-text preview handler for the same curated set of extensions already used by the file-association feature (`docs/specs/file-association-design.md`).

## Constraints

- No administrator elevation — all registration lives under `HKCU`, matching the rest of the installer (`PrivilegesRequired=lowest` in `null-ide.iss`; all other registry entries already live under `HKCU`).
- Must work for both install paths this repo supports: the Inno Setup installer (`installer/null-ide.iss`) and the standalone PowerShell installer used for portable ZIP installs/updates (`scripts/install-null-ide.ps1`, also used by the in-app updater).
- Must clean up fully on uninstall.
- Unlike file associations (which only add Null IDE to the "Open with" list and deliberately never claim default-app status, per Windows' UserChoice protection), a preview handler registered on an extension affects what **every** app sees in the Explorer preview pane for that file type, not just files associated with Null IDE. Since these extensions currently show no preview at all for anyone, this is a net improvement rather than a hijack. To stay a good citizen: on uninstall, `Unregister-PreviewHandler` only deletes an extension's `shellex` registration if it still points at Null IDE's preview-handler CLSID (in case something else registered over it later) — it never blindly deletes.

## Scope: reuse the file-association extension list

No new curation. The same `$FileAssocMap` already defined in `scripts/install-null-ide.ps1` (32 icon keys / 52 extensions — `.js`, `.ts`, `.py`, `.json`, `.md`, `.html`, `.css`, `.yml`, `.txt`, `.xml`, `.c`, `.h`, `.cpp`, `.cs`, `.go`, `.rs`, `.php`, `.rb`, `.sh`, `.sql`, `.gitignore` family, `.patch`, `.cmake`, `.dart`, `.dockerfile`, `.ipynb`, `.csproj`, `.h++`, `.java`/`.jar`, `.lua`, `.latex`, `.cfg`/`.ini`/`.config`, `.code-workspace`, `.iss`, `.log`) drives which extensions get a preview handler. Keeping the two features in lockstep means "files Null IDE can open" and "files Explorer can preview" stay the same set.

## Preview fidelity: plain monospace text (v1)

The preview pane shows raw file content in a monospace font, no syntax highlighting — similar to Notepad's own preview handler. This keeps the native C++ surface small (no per-language tokenizer/highlighter, no embedded WebView2) and avoids fighting the host pane's light/dark background. Syntax highlighting is an explicit non-goal for this version; it can be revisited later as a separate iteration if wanted.

## Component 1: Native preview handler (extends `shell-ext/`)

No new DLL or CMake target — a second COM class is added to the existing `null_explorer_command.dll`:

- New source, e.g. `shell-ext/src/preview_handler.cc`, implementing `IPreviewHandler`, `IPreviewHandlerVisuals`, `IObjectWithSite`, `IOleWindow`, and `IInitializeWithFile`.
- `SetWindow`/`SetRect` position a child control inside the host-provided `HWND`.
- `DoPreview` creates a read-only, multiline `Edit` control (`ES_READONLY | ES_MULTILINE | WS_VSCROLL`), monospace font (Cascadia Mono, falling back to Consolas), and fills it with the file's text:
  - Reads the file, detects encoding (UTF-8 BOM, UTF-16 LE BOM, else assumed UTF-8), converts to UTF-16 for `SetWindowText`.
  - **Binary guard:** samples the first ~8 KB; if it contains a NUL byte, shows a static "No preview available for this file" label instead of raw bytes.
  - **Size guard:** truncates at a fixed cap (256 KB or ~5,000 lines, whichever comes first) and appends a trailing "… truncated — open in Null IDE to view the full file" line.
- No theming: uses default system control colors rather than forcing the `null-theme` dark palette, so it doesn't clash with the host pane's own light/dark mode.
- `Unregister`/cleanup: no runtime state to clean up beyond registry keys (Component 2) — the control is destroyed when the host tears down the preview.

## Component 2: Registration (classic per-user COM, not AppX)

Preview handlers predate the Windows 11 "unpackaged apps need package identity for the new context menu" requirement (`windows.fileExplorerContextMenus`, used by the existing `IExplorerCommand`/`AppxManifest.xml` setup). Explorer's Preview Pane host resolves preview handlers via plain registry lookups, so this feature does **not** need the sparse-package/COM-surrogate machinery in `shell-ext/AppxManifest.xml` — a simpler, purely registry-based registration works and still requires no admin elevation:

- `HKCU:\Software\Classes\CLSID\{PreviewHandlerCLSID}\InprocServer32` → path to `null_explorer_command.dll`, `ThreadingModel=Apartment`
- `HKCU:\Software\Classes\CLSID\{PreviewHandlerCLSID}` `(default)` → `"Null IDE Preview Handler"`
- `HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers\{PreviewHandlerCLSID}` → `"Null IDE Preview Handler"` (the approved-handlers allow-list; honored at `HKCU` scope)
- For each extension in `$FileAssocMap`: `HKCU:\Software\Classes\<ext>\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}` → `{PreviewHandlerCLSID}`

New functions in `scripts/install-null-ide.ps1`, mirroring `Register-FileAssociations`/`Unregister-FileAssociations`:

- **`Register-PreviewHandler -InstallDir`** — writes the keys above. Idempotent (safe to re-run on update). Called immediately after the existing `Register-FileAssociations -InstallDir $destinationFullPath` call site(s) in the install/update flow.
- **`Unregister-PreviewHandler`** — for each extension, reads the current `shellex` value and deletes it only if it still equals `{PreviewHandlerCLSID}` (see Constraints); removes the `CLSID` and `PreviewHandlers` allow-list entries unconditionally (those are exclusively Null IDE's). Called immediately after the existing `Unregister-FileAssociations` call site in the uninstall flow.
- Reuses `Send-ShellChangeNotification` (already invoked by `Register-FileAssociations`) so Explorer picks up the change without a manual restart.
- `installer/null-ide.iss` needs no new logic beyond what already delegates to `install-null-ide.ps1`; whether uninstall needs an explicit `[UninstallRun]` entry or already falls through the shared uninstall helper will be confirmed at plan/implementation time by reading the current `.iss` uninstall section.

## Testing / Verification

No automated test can drive Explorer's Preview Pane UI, and per `CLAUDE.md` the build only runs in CI (not locally). Verification is manual, against a CI-built install:

1. Install Null IDE, open File Explorer, select a `.ts`/`.py`/`.json` file, toggle Preview Pane (Alt+P) → expect readable monospace text matching the file's content.
2. Select a file just over the size cap → expect truncated content plus the "open in Null IDE" trailing line.
3. Select a file with injected NUL bytes (renamed to a covered extension) → expect the "No preview available" label, not raw/garbled bytes.
4. Uninstall → confirm the `CLSID`, `PreviewHandlers`, and per-extension `shellex` keys are gone (or, for any extension where the `shellex` value no longer matches Null IDE's CLSID, confirm it was left untouched) and Explorer falls back to "No preview available."

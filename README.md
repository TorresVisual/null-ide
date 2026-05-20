# Null IDE

A custom IDE distribution built on VSCodium, with an Null Dark theme,
pre-configured for C/C++ and Python development, and Claude Code integration.

## Prerequisites

- Windows 11
- [Node.js 20](https://nodejs.org/) (for the `scripts/merge-json.js` build utility)
- A GitHub repository with Actions enabled (for CI builds)
- `git` available in your terminal

## Building

Builds run in GitHub Actions on a `windows-latest` runner — you do not build locally.

1. Push a tag to trigger a release build:
   ```powershell
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. Or trigger manually: **Actions → Build Null IDE → Run workflow**.
3. Download the artifact `null-ide-win32-x64-<tag>.zip` from the workflow run.

## Running the IDE

1. Extract `null-ide-win32-x64-*.zip` to a folder of your choice.
2. Run `null.exe` (or whatever the compiled binary name resolves to).

The Null Dark theme is active by default. Recommended extensions are prompted on
first launch.

## Installing and updating

Tagged builds publish `null-ide-win32-x64.zip` to the matching GitHub Release.

Install the latest release:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-null-ide.ps1
```

Install from a ZIP you already downloaded:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-null-ide.ps1 `
  -ZipPath .\null-ide-win32-x64.zip `
  -InstallDir "$env:LOCALAPPDATA\Programs\Null IDE"
```

Update an existing script-managed install:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\update-null-ide.ps1
```

The default install path is `%LOCALAPPDATA%\Programs\Null IDE`. The scripts do
not modify PATH, the registry, or any VS Code/VSCodium install. If a release is
private, set `GITHUB_TOKEN` before running the scripts.

## Claude Code integration

Claude Code is available via the integrated terminal:

```
Ctrl+` to open a terminal, then type: claude
```

A dedicated terminal profile is pre-configured so you can also open one directly:
**Terminal → New Terminal → Claude Code**

### Keyboard shortcut

`Ctrl+Shift+A` — opens a new terminal panel and launches `claude`.

## Installing extensions

### Open VSX (default)

The IDE is configured to use the [Open VSX Registry](https://open-vsx.org/) by default:

1. Open the Extensions panel (`Ctrl+Shift+X`).
2. Search and install normally.

Or from the command line:
```powershell
null.exe --install-extension <publisher.extension-id>
```

### Microsoft Marketplace (optional override)

Microsoft's marketplace is not enabled by default. To use it for a session, set the
following environment variable **before** launching the IDE:

```powershell
$env:EXTENSIONS_GALLERY = '{"serviceUrl":"https://marketplace.visualstudio.com/_apis/public/gallery","cacheUrl":"https://vscode.blob.core.windows.net/gallery/index","itemUrl":"https://marketplace.visualstudio.com/items"}'
.\null.exe
```

> This is a per-session opt-in. It is not set automatically anywhere in this repo.

## Developing patches

To add or modify workbench behaviour, write patches against the VS Code source and place
them in `patches/`. See [`patches/README.md`](patches/README.md) for the full workflow.

## Bumping the upstream VSCodium version

The scheduled CI job (Mondays, 06:00 UTC) checks for new VSCodium releases and opens a
PR automatically if one is found. Review the PR, verify patches apply cleanly, then merge.

To bump manually, edit `VSCODIUM_TAG` in `.github/workflows/build.yml`.

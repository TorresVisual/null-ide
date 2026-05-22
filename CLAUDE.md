# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**Null IDE** is a custom Windows desktop code editor built on VSCodium (itself a fork of VS Code with Microsoft telemetry removed). It ships with its own binary name, branding, built-in extensions, and an automated GitHub Actions release pipeline.

Key characteristics:
- Binary name: `null.exe` — accessible from the terminal as `null .`
- Built on VSCodium, which strips Microsoft telemetry from VS Code
- Three built-in extensions bundled at build time: `null-theme`, `null-icons`, `null-tools`
- CI builds on `windows-latest`; the developer authors source changes locally
- Releases publish a portable ZIP and an Inno Setup installer to GitHub Releases
- The in-app updater (`null-tools`) checks GitHub Releases on startup and can self-update

## Repository Layout

```
├── .github/workflows/
│   └── build.yml              # Build, package, and release pipeline
├── extensions/
│   ├── null-icons/            # Built-in file icon theme (null-icons)
│   ├── null-theme/            # Built-in color theme (Null Dark)
│   └── null-tools/            # Built-in productivity extension
│       ├── extension.js       # Main extension entry point
│       ├── package.json       # Contributes commands, views, keybindings
│       ├── setup.ps1          # Rebuilds node-pty for the installed Electron version
│       ├── lib/               # xterm.js, xterm-addon-fit.js, agents.js (webview assets)
│       └── node_modules/      # node-pty (native; must be rebuilt via setup.ps1)
├── icons/                     # Source icons used by the build
│   ├── icon.svg               # Master vector (∅ symbol, dark rounded square)
│   ├── icon.ico               # Windows multi-size ICO
│   ├── icon.png               # 1024×1024 PNG
│   ├── icon_150x150.png       # Win32 tile PNG
│   ├── icon_70x70.png         # Win32 tile PNG (small)
│   └── icon.icns              # macOS (not used in current CI, kept for future)
├── installer/
│   ├── null-ide.iss           # Inno Setup script → NullIDESetup-<version>.exe
│   └── Null.VisualElementsManifest.xml  # Win10 tile metadata
├── patches/                   # Git-format patches — currently empty
├── scripts/
│   ├── convert-icons.js       # SVG → PNG/ICO/ICNS via sharp, to-ico, png2icons
│   ├── merge-json.js          # Deep-merges product.json overlay (our values win)
│   ├── install-null-ide.ps1   # Downloads from GitHub Releases or installs a local ZIP
│   └── update-null-ide.ps1    # Checks latest release tag, delegates to installer
├── workbench/
│   ├── custom.css             # Injected as null-custom.css into workbench.html
│   ├── splash.js              # Runs in <head> before the workbench (no Node/AMD)
│   ├── letterpress-dark.svg   # Empty-editor watermark — dark variant (∅ symbol)
│   └── letterpress-light.svg  # Empty-editor watermark — light variant
├── docs/
│   └── index.html             # GitHub Pages homepage
└── product.json               # Deep-merged into vscode/product.json before build
```

## How the Build Works

The entire build runs in GitHub Actions on a `windows-latest` runner — do **not** try to run it locally.

1. Clone VSCodium at `VSCODIUM_TAG` and VS Code at the matching `MS_TAG`.
2. Apply VSCodium's own patches against the VS Code source tree.
3. Apply any patches in `patches/` (currently none).
4. Deep-merge `product.json` overlay into `vscode-src/product.json`.
5. Copy built-in extensions (`null-theme`, `null-icons`, `null-tools`) into `vscode-src/extensions/`.
6. Replace upstream icons with files from `icons/`.
7. Copy `workbench/custom.css` → `null-custom.css` and `workbench/splash.js` → `null-splash.js` into the source tree.
8. Inject `<link>` and `<script>` tags into `workbench.html` pointing at those files.
9. `npm ci && npx gulp vscode-win32-x64` produces `VSCode-win32-x64/`.
10. Stamp version, commit hash, and server URL into the build output's `product.json`.
11. Replace letterpress SVGs in the build output with the null-symbol versions.
12. Run `rcedit` to stamp the custom icon into `null.exe`.
13. Bundle `install-null-ide.ps1` and `update-null-ide.ps1` into `resources/app/null-updater/`.
14. `Compress-Archive` → `null-ide-win32-x64.zip`.
15. Inno Setup → `NullIDESetup-<version>.exe`.
16. Both artifacts are uploaded to the GitHub Release (tag builds) and as workflow artifacts.

## Built-in Extensions

### null-theme (`extensions/null-theme/`)
Standard VS Code color theme extension. Set as the default via `product.json → defaultColorTheme`.

Palette:
- Background: `#0d0d1a` – `#1a1a2e`
- Accent teal: `#00b4d8` / `#0077b6`
- Accent indigo: `#4361ee` / `#3a0ca3`
- Font: Geist Mono, JetBrains Mono (fallback: Cascadia Code)

### null-icons (`extensions/null-icons/`)
Built-in file icon theme. Set as the default via `product.json → defaultIconTheme`. Contains SVG icons for a wide range of file types and folder types.

### null-tools (`extensions/null-tools/`)
Activated on `onStartupFinished`. Provides:

| Feature | Details |
|---|---|
| **AI Agents panel** | Secondary sidebar webview running xterm.js with node-pty; tabs for `claude`, `agy`, `codex` |
| **Commit message generation** | `null.generateCommitMessage` — runs `claude --print` with staged diff; sets SCM input box |
| **In-app updater** | Checks GitHub Releases on startup; shows status bar button; self-updates via PowerShell |
| **Scrollback persistence** | Terminal buffers (up to 300 KB each) saved to globalStorage, restored on reload |
| **Context paste** | `null.agentsPaste` command and `Ctrl+V` keybinding inside the agents webview |

**node-pty note:** The AI Agents terminal requires `node-pty` native addon rebuilt for the exact Electron ABI. After a fresh install or IDE update, run `setup.ps1` in `extensions/null-tools/` if the panel shows the setup screen.

## Workbench Assets

`workbench/custom.css` and `workbench/splash.js` are injected into `workbench.html` at build time. They run in the Electron renderer process.

Constraints for `splash.js`:
- Runs in `<head>` before VS Code's workbench initialises
- `require` (Node.js) is **not** available (contextIsolation)
- The AMD loader is **not** available (VS Code 1.99+ uses ESM)
- Only DOM APIs and synchronous script execution are safe

## Installer and Scripts

### `scripts/install-null-ide.ps1`
- Installs from a GitHub Release (latest by default) or a local ZIP (`-ZipPath`)
- Per-user install to `%LOCALAPPDATA%\Programs\Null IDE` — no administrator elevation required
- Creates desktop and Start Menu shortcuts
- Registers "Open in Null" and "Open Folder in Null" context menu entries in `HKCU`
- Adds the install directory to the user's `PATH` (so `null .` works in new terminals)
- Seeds default settings into `%APPDATA%\Null\User\settings.json`
- Writes `.null-ide-install.json` (repo, version, timestamp) for the in-app updater

### `scripts/update-null-ide.ps1`
- Reads `.null-ide-install.json` to determine the current version and target repo
- Fetches the latest GitHub Release tag and compares versions
- Delegates to `install-null-ide.ps1` with `-Force` when an update is available
- Used by the in-app update flow: the extension stages the scripts to `%TEMP%`, launches them detached, then quits so files can be replaced

### `installer/null-ide.iss`
Inno Setup script that builds `NullIDESetup-<version>.exe`. The installer runs `install-null-ide.ps1` with the bundled ZIP — it does not duplicate the installation logic.

## Patches

The `patches/` directory is currently **empty**. All workbench customisations are handled by direct file injection (CSS/JS copy + `workbench.html` string replacement) rather than git-format patches, which proved fragile across VS Code version bumps.

To add a patch against the VS Code source:
```bash
cd vscode-src
# Make the change, commit it
git add -p && git commit -m "feat: describe change"
git format-patch HEAD~1 -o ../patches/
```

Patches apply **after** VSCodium's own patches, against the VS Code commit at `MS_TAG`. When rebasing to a new upstream, re-export with `git format-patch`.

## Updating the Upstream Version

1. The scheduled CI job (Mondays 06:00 UTC) opens a PR automatically if VSCodium has a new release.
2. To bump manually: edit `VSCODIUM_TAG` in `.github/workflows/build.yml`.
3. Verify any patches in `patches/` still apply cleanly against the new MS tag.

## Key Build Variables (`build.yml`)

| Variable | Purpose |
|---|---|
| `VSCODIUM_TAG` | VSCodium release tag to build against |
| `APP_NAME` | Binary name (`null`) |
| `APP_NAME_LONG` | Display name (`Null IDE`) |

## product.json Overlay

Values in `product.json` are deep-merged (our values win) over the VSCodium/VS Code defaults. Key fields set here:

- `nameShort`, `nameLong`, `applicationName` — branding
- `extensionsGallery` — VS Marketplace service URLs
- `defaultColorTheme`, `defaultIconTheme` — point to built-in extensions
- `configurationDefaults` — seed user settings (telemetry off, custom theme, etc.)
- `enableTelemetry: false`
- `reportIssueUrl`, `releaseNotesUrl` — point to this repo

## CI Pipeline Triggers

```yaml
on:
  workflow_dispatch:       # Manual run; optionally override vscodium_tag
  push:
    tags: ['v*']          # Tag a release → builds and publishes to GitHub Releases
  schedule:
    - cron: '0 6 * * 1'  # Monday 06:00 UTC — upstream version check only
```

## Scope Constraints

- Work only inside `D:\Coding\Apps\null-ide\` and its subdirectories.
- Do not touch system PATH, registry, or any existing VS Code/VSCodium installation outside this repo's installer scripts.
- Do not run CI or build scripts locally — patches are authored here; builds run in GitHub Actions.
- Do not set the Microsoft extension gallery env var silently; document it in the README only.

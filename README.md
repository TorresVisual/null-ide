<div align="center">

<img src="icons/icon.png" alt="Null IDE" width="128" />

# Null IDE

**A minimal, opinionated code editor for Windows.**
Fully assembled out of the box, with zero telemetry.

VSCodium · Electron · TypeScript · C++ · Inno Setup

[Website](https://torresvisual.github.io/null-ide/) · [Releases](https://github.com/TorresVisual/null-ide/releases/latest)

</div>

Null IDE is built on [VSCodium](https://vscodium.com) and ships with a dark theme, icon pack, GitHub Issues, formatters, C++ navigation, and native Explorer integration already in place.

```powershell
irm https://github.com/TorresVisual/null-ide/releases/latest/download/install-null-ide.ps1 | iex
```

Or download `NullIDESetup-<version>.exe` from the [latest release](https://github.com/TorresVisual/null-ide/releases/latest).

> Null IDE is a personal daily-driver editor developed in the open. It is Windows-only (x64) and tracks upstream VSCodium via an automated release pipeline.

---

## Features

### Built-in extensions

| Extension | What it does |
|---|---|
| **null-theme** | *Null Dark* color theme: deep navy backgrounds, teal and indigo accents, Geist Mono |
| **null-icons** | File and folder icon theme |
| **null-tools** | Project dashboard, GitHub Issues, commit message generation, worktrees, scratch files and notes, port manager, Discord Rich Presence, in-app updater |
| **null-markdown** | Markdown preview with GFM, Mermaid, KaTeX math, and GitHub-style alerts |
| **null-format** | Prettier (in-process), rustfmt, and clang-format; project config files win over built-in defaults |
| **null-cpp** | Symbol-aware header/source switching (`Alt+O`), paired split editors, `.hpp`/`.cpp` class scaffolding, on top of clangd |
| **null-actions** | Configurable status-bar buttons that run shell commands or VS Code commands |
| **Code Spell Checker** | Bundled [`streetsidesoftware.code-spell-checker`](https://marketplace.visualstudio.com/items?itemName=streetsidesoftware.code-spell-checker) |

### Highlights

- **Project dashboard** opens on startup as a recent-project launcher: search, sort, pin and manage projects, with best-effort Git/type details alongside New Project, Clone Repo, and Open Folder.
- **GitHub Issues** in its own activity-bar view and a full-width tab, with github.com-style search, filters, an issue detail tab, and issue creation and commenting. Sign in from the view.
- **Commit messages** from your staged diff with `Ctrl+Shift+Alt+G` (uses the [`claude`](https://claude.com/claude-code) CLI, which must be installed separately).
- **Git worktrees** view: create (including one per issue), open in a new window, merge back, prune.
- **`null .`** opens the current folder from any terminal.
- **"Open in Null"** in the Win11 Explorer context menu via a native `IExplorerCommand` shell extension.
- **Self-updating**: checks GitHub Releases on startup and updates without elevation.

---

## Install

### Installer (recommended)

Run `NullIDESetup-<version>.exe` from the [latest release](https://github.com/TorresVisual/null-ide/releases/latest).

The install is per-user (`%LOCALAPPDATA%\Programs\Null IDE`) and needs no administrator rights. It registers the context menu, adds `null` to your `PATH`, creates shortcuts, and seeds default settings.

### PowerShell

```powershell
# Latest release
powershell -ExecutionPolicy Bypass -File scripts\install-null-ide.ps1

# From a ZIP you already downloaded
powershell -ExecutionPolicy Bypass -File scripts\install-null-ide.ps1 -ZipPath .\null-ide-win32-x64.zip

# To a custom location
powershell -ExecutionPolicy Bypass -File scripts\install-null-ide.ps1 -InstallDir "D:\Tools\NullIDE"
```

A portable `null-ide-win32-x64.zip` (with a `.sha256`) is also attached to each release.

### Updating

A status-bar button appears when a new release is available (checked on startup, at most every 6 hours). Click it and the IDE closes, updates, and reopens. You can also run **Null: Check for Updates** from the command palette, or:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\update-null-ide.ps1
```

---

## Usage

```
null .                      # open the current folder
null C:\path\to\project     # open a specific folder
null README.md              # open a file
```

Open a new terminal after installing so the `PATH` change takes effect. In Explorer, right-click a file or folder (or a folder's background) and choose **Open in Null**.

### Extensions

Null IDE uses the VS Marketplace. Install extensions from the Extensions view (`Ctrl+Shift+X`) or the CLI:

```
null --install-extension <publisher.extension-id>
```

Extensions are checked for updates at startup and every few hours, and update automatically (`extensions.autoCheckUpdates` / `extensions.autoUpdate`). Extensions installed from a local `.vsix` are pinned and never auto-update; uninstall and reinstall them from the Marketplace to unpin.

Suggested on first launch: `llvm-vs-code-extensions.vscode-clangd`, `twxs.cmake`, `ms-python.python`.

---

## Privacy

`enableTelemetry` is `false` in `product.json`, and no usage data is sent anywhere. The only network calls are:

- Extension gallery lookups (VS Marketplace), on user action
- The GitHub Releases API for update checks
- GitHub API calls from the Issues view, only after you sign in
- Discord Rich Presence, only if enabled via `null.discord.*`

---

## Building

Release builds run in GitHub Actions on a `windows-2022` runner. Don't try to build the full editor locally.

The pipeline clones VSCodium and the matching VS Code source at the pinned `VSCODIUM_TAG`, applies VSCodium's patches and those in [`patches/`](patches/), merges the [`product.json`](product.json) overlay, compiles and copies the built-in extensions, swaps in icons and workbench assets, builds with `npx gulp vscode-win32-x64`, builds and signs the shell extension, then packages the ZIP and Inno Setup installer.

```powershell
git tag v1.2.3
git push origin v1.2.3     # builds and publishes a GitHub Release
```

Or run **Actions → Build Null IDE → Run workflow** manually. A scheduled job (Mondays 06:00 UTC) opens a PR when VSCodium ships a new release; to bump by hand, edit [`VSCODIUM_TAG`](VSCODIUM_TAG).

## Development

```
extensions/        Built-in extensions (TypeScript sources in src/, compiled to out/ in CI)
shell-ext/         Win11 IExplorerCommand DLL + sparse APPX manifest (CMake + MSVC)
patches/           Patches against the VS Code source tree
installer/         Inno Setup script
scripts/           Install/update scripts and local dev helpers
workbench/         custom.css and splash.js injected into workbench.html
icons/             Source icons
docs/              GitHub Pages site, roadmap, design specs
product.json       Branding/config overlay merged into VS Code's product.json
archive/           Retired code, not built
```

Day-to-day extension and workbench work doesn't need the full build:

| Script | Use for |
|---|---|
| `scripts/sync-local.ps1` | Sync compiled extensions and workbench assets into an installed Null IDE, then reload the window |
| `scripts/build-local.ps1` | Mirror the CI build to iterate on `build.yml`, `shell-ext/`, `installer/`, or patches. Slow (tens of minutes); needs Node, Rust, CMake, VS2022, Inno Setup 6 |

Extensions are compiled with `npm ci && npm run compile` in each extension directory. Edit the TypeScript in `src/`, not the generated `out/` files.

See [CLAUDE.md](CLAUDE.md) for a deeper tour of the architecture and [docs/ROADMAP.md](docs/ROADMAP.md) for planned work such as the C++ development layer.

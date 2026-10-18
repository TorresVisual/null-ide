<div align="center">

<img src="icons/icon.png" alt="Null IDE" width="128" />

# Null IDE

**A minimal, opinionated code editor for Windows.**
Fully assembled out of the box, with zero telemetry.

VSCodium · Electron · TypeScript · C++ · Rust

[Website](https://torresvisual.github.io/null-ide/) · [Releases](https://github.com/TorresVisual/null-ide/releases/latest)

</div>

Null IDE is built on [VSCodium](https://vscodium.com) and ships with a dark theme, icon pack, GitHub Issues, formatters, C++ navigation, and native Explorer integration already in place.

Download `NullIDESetup-<version>.exe` from the [latest release](https://github.com/TorresVisual/null-ide/releases/latest) and run it. The installer is not code-signed, so Windows SmartScreen may ask you to confirm; the SHA256 check only guards against a corrupted or truncated download, not against a compromised release.

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

### Installer

Run `NullIDESetup-<version>.exe` from the [latest release](https://github.com/TorresVisual/null-ide/releases/latest). The wizard downloads the newest release and lets you pick the install folder, shortcuts, `PATH` entry, Explorer context menu, file associations, which built-in extensions to keep and a few starting settings (theme, font, auto save, format on save, update check, menu bar). **Use recommended defaults** skips ahead.

The install is per-user (`%LOCALAPPDATA%\Programs\Null IDE` by default) and needs no administrator rights, apart from one optional approval for the Windows 11 context-menu certificate. It needs the WebView2 runtime (part of Windows 11; Windows 10 22H2 ships it too).

Run the installer again, or use Settings → Apps → Null IDE, for **Modify**, **Repair** and **Uninstall**. Inside the IDE, **Null: Setup** opens the same window on Modify. Uninstall keeps `%APPDATA%\Null` (settings, extensions) unless you tick the box to delete it.

A portable `null-ide-win32-x64.zip` (with a `.sha256`) is also attached to each release.

#### Coming from the Inno Setup installer (v1.0.17 and earlier)

Uninstall the old copy first (Settings → Apps → Null IDE); the new installer refuses a folder that is not empty. Your settings and extensions in `%APPDATA%\Null` are not touched by that uninstall. Those older versions cannot update themselves to this one.

### Updating

A status-bar button appears when a new release is available (checked on startup, at most every 6 hours). Click it and the IDE closes, updates, and reopens. You can also run **Null: Check for Updates** from the command palette.

---

## Usage

```
null .                      # open the current folder
null C:\path\to\project     # open a specific folder
null README.md              # open a file
null --safe-mode            # start with all extensions disabled (also: Start Menu > Null IDE (Safe Mode))
```

Open a new terminal after installing so the `PATH` change takes effect. In Explorer, right-click a file or folder (or a folder's background) and choose **Open in Null**.

Safe Mode disables installed extensions and Null IDE's built-in extensions without changing them; use **Restart Normally** (status bar, notification or Help menu) to come back. Null IDE also offers Safe Mode on its own after three failed starts in a row.

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

The pipeline clones VSCodium and the matching VS Code source at the pinned `VSCODIUM_TAG`, applies VSCodium's patches and those in [`patches/`](patches/), merges the [`product.json`](product.json) overlay, compiles and copies the built-in extensions, swaps in icons and workbench assets, builds with `npx gulp vscode-win32-x64`, builds and signs the shell extension, then packages the ZIP and the setup stub (`NullIDESetup-<version>.exe`).

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
setup/             null-setup: installer, wizard and updater (Rust + Tauri)
scripts/           Local dev helpers and build scripts
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
| `scripts/build-local.ps1` | Mirror the CI build to iterate on `build.yml`, `shell-ext/`, `setup/`, or patches. Slow (tens of minutes); needs Node, Rust, CMake and VS2022 |

Extensions are compiled with `npm ci && npm run compile` in each extension directory. Edit the TypeScript in `src/`, not the generated `out/` files.

See [CLAUDE.md](CLAUDE.md) for a deeper tour of the architecture and [docs/ROADMAP.md](docs/ROADMAP.md) for planned work such as the C++ development layer.

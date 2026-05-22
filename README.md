# Null IDE

A minimal, opinionated code editor for Windows — built on VSCodium, shipped with an AI agents panel, a dark theme, and a full icon pack.
[Website](https://torresvisual.github.io/null-ide/)

```powershell
irm https://github.com/TorresVisual/null-ide/releases/latest/download/install-null-ide.ps1 | iex
```

Or download `NullIDESetup-<version>.exe` from the [latest release](https://github.com/TorresVisual/null-ide/releases/latest).

---

## What's inside

| | |
|---|---|
| **Null Dark theme** | Deep navy backgrounds, teal and indigo accents, Geist Mono font |
| **null-icons** | Custom file and folder icon set |
| **AI Agents panel** | Embedded terminals for `claude`, `agy`, and `codex` in the secondary sidebar |
| **Claude commit messages** | One keystroke generates a conventional commit message from your staged diff |
| **Terminal command** | `null .` opens the current folder from any terminal |
| **Context menu** | "Open in Null" on files and folders in Explorer |
| **Self-updating** | Checks GitHub Releases on startup; installs updates without elevation |

---

## Install

### Installer (recommended)

Download `NullIDESetup-<version>.exe` from the [latest release](https://github.com/TorresVisual/null-ide/releases/latest) and run it.

The installer is per-user (`%LOCALAPPDATA%\Programs\Null IDE`) — no administrator rights required. It registers the context menu, adds `null` to your `PATH`, creates shortcuts, and seeds default settings.

### PowerShell one-liner

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-null-ide.ps1
```

Install from a ZIP you already downloaded:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-null-ide.ps1 `
  -ZipPath .\null-ide-win32-x64.zip
```

To a custom location:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-null-ide.ps1 `
  -InstallDir "D:\Tools\NullIDE"
```

### Updating

Null IDE checks for updates on every startup. When one is available, a button appears in the status bar — click it, confirm, and the IDE will close, update, and reopen automatically.

To update manually from the command palette: **Null: Check for Updates**.

Or from a terminal:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\update-null-ide.ps1
```

---

## Usage

### Open from the terminal

After install, `null` is on your user `PATH`. Open any terminal and run:

```
null .                          # open current folder
null C:\path\to\project         # open a specific folder
null README.md                  # open a file
```

> Open a new terminal window after install for `PATH` changes to take effect.

### Open from Explorer

Right-click any file or folder and choose **Open in Null** or **Open Folder in Null**.

Right-click inside a folder (on the background) and choose **Open Folder in Null**.

### AI Agents panel

The secondary sidebar contains an **AI Agents** panel with embedded terminals for `claude`, `agy`, and `codex`. Switch between them using the tabs at the top.

- Scrollback is persisted across reloads (up to 300 KB per agent)
- Paste with `Ctrl+V` while the terminal is focused
- The panel requires `node-pty` built for the current Electron version. If you see a setup screen, click **Install dependencies** (takes ~30 seconds, then reload the window)

### Claude commit messages

Press `Ctrl+Shift+Alt+G` (or click `$(sparkle)` in the status bar, or use the sparkle icon above the SCM commit box) to generate a conventional commit message from your staged diff via `claude --print`. The message is written directly into the commit input box.

### Extensions

The IDE connects to the VS Marketplace by default. Install extensions normally via `Ctrl+Shift+X` or from the terminal:

```
null --install-extension <publisher.extension-id>
```

Recommended extensions are suggested on first launch:

| Purpose | ID |
|---|---|
| C/C++ IntelliSense | `llvm-vs-code-extensions.vscode-clangd` |
| CMake | `twxs.cmake` |
| Python | `ms-python.python` |
| GitLens | `eamodio.gitlens` |

---

## Build

Builds run in GitHub Actions on a `windows-latest` runner — you do not build locally.

Trigger a release build by pushing a version tag:

```powershell
git tag v1.2.3
git push origin v1.2.3
```

Or trigger manually: **Actions → Build Null IDE → Run workflow**.

The pipeline checks out VSCodium and VS Code at the pinned tags, applies patches, merges `product.json`, copies built-in extensions and icons, builds with `npx gulp vscode-win32-x64`, packages a ZIP and an Inno Setup installer, and publishes both to the GitHub Release.

### Upstream version

The scheduled CI job (Mondays 06:00 UTC) checks for new VSCodium releases and opens a PR automatically. To bump manually, edit `VSCODIUM_TAG` in `.github/workflows/build.yml`.

---

## Development

### Repository layout

```
extensions/null-theme/      Color theme (Null Dark)
extensions/null-icons/      File icon theme
extensions/null-tools/      AI agents, commit gen, updater
icons/                      Source SVG → ICO/PNG/ICNS
installer/null-ide.iss      Inno Setup script
patches/                    git-format patches (currently empty)
scripts/                    Install/update PowerShell scripts
workbench/custom.css        Injected CSS into workbench.html
workbench/splash.js         Runs in <head> before workbench init
workbench/letterpress-*.svg Empty-editor watermarks (∅ symbol)
product.json                Branding/config overlay
docs/index.html             GitHub Pages homepage
```

### Editing the theme

Edit `extensions/null-theme/themes/null-dark.json` directly and copy to your local install to preview:

```powershell
Copy-Item extensions\null-theme -Destination "$env:LOCALAPPDATA\Programs\Null IDE\resources\app\extensions\null-theme" -Recurse -Force
```

Then reload the window (`Ctrl+Shift+P` → *Reload Window*).

### Editing workbench CSS

Edit `workbench/custom.css`, then copy to the local install:

```powershell
Copy-Item workbench\custom.css "$env:LOCALAPPDATA\Programs\Null IDE\resources\app\out\vs\code\electron-browser\workbench\null-custom.css" -Force
```

Reload the window to see changes.

### Adding a patch

```bash
cd vscode-src
# make changes, then:
git add -p && git commit -m "feat: describe change"
git format-patch HEAD~1 -o ../patches/
```

Patches apply after VSCodium's patches, against the VS Code commit at `MS_TAG`.

### Rebuilding node-pty (AI Agents panel)

After changing the Electron version or on a fresh clone:

```powershell
cd extensions\null-tools
pwsh -File setup.ps1
```

Then reload the window.

---

## Privacy

Null IDE has telemetry fully disabled (`enableTelemetry: false` in `product.json`). No usage data is sent anywhere. The only network calls are:

- Extension gallery lookups (VS Marketplace, only on user action)
- GitHub Releases API (startup update check, once every 6 hours)

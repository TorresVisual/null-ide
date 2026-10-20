<a id="readme-top"></a>

<p align="center">
  <a href="https://github.com/TorresVisual/null-ide/releases/latest"><img src="https://img.shields.io/github/v/release/TorresVisual/null-ide?style=for-the-badge" alt="Release"></a>
  <a href="https://github.com/TorresVisual/null-ide/stargazers"><img src="https://img.shields.io/github/stars/TorresVisual/null-ide.svg?style=for-the-badge" alt="Stargazers"></a>
  <a href="https://github.com/TorresVisual/null-ide/network/members"><img src="https://img.shields.io/github/forks/TorresVisual/null-ide.svg?style=for-the-badge" alt="Forks"></a>
  <a href="https://github.com/TorresVisual/null-ide/issues"><img src="https://img.shields.io/github/issues/TorresVisual/null-ide.svg?style=for-the-badge" alt="Issues"></a>
</p>

<br />
<div align="center">
  <a href="https://github.com/TorresVisual/null-ide">
    <img src="icons/icon.png" alt="Null IDE" width="128" height="128">
  </a>

<h3 align="center">Null IDE</h3>

  <p align="center">
    A minimal, opinionated code editor for Windows and Linux.
    <br />
    Fully assembled out of the box, with zero telemetry.
    <br />
    <br />
    <a href="https://github.com/TorresVisual/null-ide/wiki"><strong>Explore the wiki »</strong></a>
    <br />
    <br />
    <a href="https://torresvisual.github.io/null-ide/">Website</a>
    &middot;
    <a href="https://github.com/TorresVisual/null-ide/releases/latest">Download</a>
    &middot;
    <a href="https://github.com/TorresVisual/null-ide/issues/new?template=bug_report.md">Report Bug</a>
    &middot;
    <a href="https://github.com/TorresVisual/null-ide/issues/new?template=feature_request.md">Request Feature</a>
  </p>
</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
        <li><a href="#built-in-extensions">Built-in Extensions</a></li>
        <li><a href="#highlights">Highlights</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
        <li><a href="#updating">Updating</a></li>
      </ul>
    </li>
    <li>
      <a href="#usage">Usage</a>
      <ul>
        <li><a href="#extensions">Extensions</a></li>
      </ul>
    </li>
    <li><a href="#privacy">Privacy</a></li>
    <li>
      <a href="#building">Building</a>
      <ul>
        <li><a href="#repository-layout">Repository Layout</a></li>
        <li><a href="#local-development">Local Development</a></li>
      </ul>
    </li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## About The Project

Null IDE is built on [VSCodium](https://vscodium.com) and ships with a dark theme, icon pack, GitHub Issues, formatters, C++ navigation, and native Explorer integration already in place.

> Null IDE is a personal daily-driver editor developed in the open. It targets Windows x64, with a Linux x64 build, and tracks upstream VSCodium via an automated release pipeline.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![VSCodium][VSCodium-badge]][VSCodium-url]
* [![Electron][Electron-badge]][Electron-url]
* [![TypeScript][TypeScript-badge]][TypeScript-url]
* [![C++][Cpp-badge]][Cpp-url]
* [![Rust][Rust-badge]][Rust-url]
* [![Tauri][Tauri-badge]][Tauri-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built-in Extensions

| Extension | What it does |
|---|---|
| **null-theme** | *Null Dark* color theme: deep navy backgrounds, teal and indigo accents, Geist Mono |
| **null-icons** | File and folder icon theme |
| **null-tools** | Project dashboard, GitHub Issues, pull requests and Actions, commit graph, commit message generation, worktrees, scratch files and notes, port manager, Discord Rich Presence, in-app updater |
| **null-markdown** | Markdown preview with GFM, Mermaid, KaTeX math, and GitHub-style alerts |
| **null-format** | Prettier (in-process), rustfmt, and clang-format; project config files win over built-in defaults |
| **null-cpp** | Symbol-aware header/source switching (`Alt+O`), paired split editors, `.hpp`/`.cpp` class scaffolding, on top of clangd |
| **null-actions** | Configurable status-bar buttons that run shell commands or VS Code commands |
| **null-accounts** | GitHub, GitLab and SSH account manager; bind a folder to an account |
| **null-env** | Environment check: finds missing companion extensions and CLI tools |
| **null-music** | Local-file music player |
| **null-activity** | Local-only activity tracking and dashboard |
| **null-startup** | Startup profiler |
| **null-sync** | Encrypted cross-device sync through one secret GitHub Gist (off by default) |
| **Code Spell Checker** | Bundled [`streetsidesoftware.code-spell-checker`](https://marketplace.visualstudio.com/items?itemName=streetsidesoftware.code-spell-checker) |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Highlights

- **Project dashboard** opens on startup as a recent-project launcher: search, sort, pin and manage projects, with best-effort Git/type details alongside New Project, Clone Repo, and Open Folder.
- **GitHub Issues** in its own activity-bar view and a full-width tab, with github.com-style search, filters, an issue detail tab, and issue creation and commenting. Sign in from the view.
- **Pull requests** next to Issues: review changed files in a diff, comment, resolve threads, check out a PR and merge it.
- **GitHub Actions** in its own activity-bar view: workflow runs, jobs and steps, logs in a tab, and re-run, cancel and run-workflow actions.
- **Commit messages** from your staged diff with `Ctrl+Shift+Alt+G` (uses the [`claude`](https://claude.com/claude-code) CLI, which must be installed separately).
- **Git worktrees** view: create (including one per issue), open in a new window, merge back, prune.
- **`null .`** opens the current folder from any terminal.
- **"Open in Null"** in the Win11 Explorer context menu via a native `IExplorerCommand` shell extension.
- **Self-updating**: checks GitHub Releases on startup and updates without elevation.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites

* **Windows 10 22H2 or Windows 11 (x64)**, with the WebView2 runtime (part of Windows 11; Windows 10 22H2 ships it too). No administrator rights are needed, apart from one optional approval for the Windows 11 context-menu certificate.
* **Linux x64** (Debian/Ubuntu `.deb`, or any distro via the `.tar.gz`). See [docs/wiki/Linux.md](docs/wiki/Linux.md) for runtime dependencies and limitations.

### Installation

#### Windows installer

1. Download `NullIDESetup-<version>.exe` from the [latest release](https://github.com/TorresVisual/null-ide/releases/latest) and run it. The installer is not code-signed, so Windows SmartScreen may ask you to confirm; the SHA256 check only guards against a corrupted or truncated download, not against a compromised release.
2. The wizard downloads the newest release and lets you pick the install folder, shortcuts, `PATH` entry, Explorer context menu, file associations, which built-in extensions to keep and a few starting settings (theme, font, auto save, format on save, update check, menu bar). **Use recommended defaults** skips ahead.
3. The install is per-user (`%LOCALAPPDATA%\Programs\Null IDE` by default).

Run the installer again, or use Settings → Apps → Null IDE, for **Modify**, **Repair** and **Uninstall**. Inside the IDE, **Null: Setup** opens the same window on Modify. Uninstall keeps `%APPDATA%\Null` (settings, extensions) unless you tick the box to delete it.

A portable `null-ide-win32-x64-<tag>.zip` (with a `.sha256`) is also attached to each release.

**Coming from the Inno Setup installer (v1.0.17 and earlier)?** Uninstall the old copy first (Settings → Apps → Null IDE); the new installer refuses a folder that is not empty. Your settings and extensions in `%APPDATA%\Null` are not touched by that uninstall. Those older versions cannot update themselves to this one.

#### Linux

Linux x64 packages are attached to each release: a `.deb` and a `.tar.gz`.

```bash
sudo apt install ./null-ide-linux-x64-<tag>.deb          # installs the null command
# or, without installing:
mkdir null-ide && tar -xzf null-ide-linux-x64-<tag>.tar.gz -C null-ide && ./null-ide/null
```

Linux installs update manually: the status-bar button opens the release page.

### Updating

A status-bar button appears when a new release is available (checked on startup, at most every 6 hours). Click it and the IDE closes, updates, and reopens. You can also run **Null: Check for Updates** from the command palette.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

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

_For more, see the [wiki](https://github.com/TorresVisual/null-ide/wiki)._

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Privacy

`enableTelemetry` is `false` in `product.json`, and no usage data is sent anywhere. The only network calls are:

- Extension gallery lookups (VS Marketplace), on user action
- The GitHub Releases API for update checks
- GitHub API calls from the Issues, Pull Requests and GitHub Actions views, only after you sign in
- GitHub and GitLab API calls from the account manager, only for accounts you add
- Sync and activity badges (GitHub Gists), only if you turn them on
- Discord Rich Presence, only if enabled via `null.discord.*`

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Building

Release builds run in GitHub Actions on a `windows-2022` runner. Don't try to build the full editor locally.

The pipeline clones VSCodium and the matching VS Code source at the pinned `VSCODIUM_TAG`, applies VSCodium's patches and those in [`patches/`](patches/), merges the [`product.json`](product.json) overlay, compiles and copies the built-in extensions, swaps in icons and workbench assets, builds with `npx gulp vscode-win32-x64`, builds and signs the shell extension, then packages the ZIP and the setup stub (`NullIDESetup-<version>.exe`).

```powershell
git tag v1.2.3
git push origin v1.2.3     # builds and publishes a GitHub Release
```

Or run **Actions → Build Null IDE → Run workflow** manually. A scheduled job (Mondays 06:00 UTC) opens a PR when VSCodium ships a new release; to bump by hand, edit [`VSCODIUM_TAG`](VSCODIUM_TAG).

### Repository Layout

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

### Local Development

Day-to-day extension and workbench work doesn't need the full build:

| Script | Use for |
|---|---|
| `scripts/sync-local.ps1` | Sync compiled extensions and workbench assets into an installed Null IDE, then reload the window |
| `scripts/build-local.ps1` | Mirror the CI build to iterate on `build.yml`, `shell-ext/`, `setup/`, or patches. Slow (tens of minutes); needs Node, Rust, CMake and VS2022 |

Extensions are compiled with `npm ci && npm run compile` in each extension directory. Edit the TypeScript in `src/`, not the generated `out/` files.

See [CLAUDE.md](CLAUDE.md) for a deeper tour of the architecture.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

Planned work, such as the C++ development layer (CMake, toolchain and debugger orchestration on top of clangd), is tracked in [docs/ROADMAP.md](docs/ROADMAP.md).

See the [open issues](https://github.com/TorresVisual/null-ide/issues) for a full list of proposed features (and known issues).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an [issue](https://github.com/TorresVisual/null-ide/issues/new?template=feature_request.md) with the tag "enhancement".

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

TorresVisual - [@TorresVisual](https://github.com/TorresVisual)

Project Link: [https://github.com/TorresVisual/null-ide](https://github.com/TorresVisual/null-ide)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

* [VSCodium](https://vscodium.com), the telemetry-free VS Code build Null IDE is based on
* [Visual Studio Code](https://github.com/microsoft/vscode), the upstream editor

<p align="right">(<a href="#readme-top">back to top</a>)</p>

[release-shield]: https://img.shields.io/github/v/release/TorresVisual/null-ide?style=for-the-badge
[release-url]: https://github.com/TorresVisual/null-ide/releases/latest
[forks-shield]: https://img.shields.io/github/forks/TorresVisual/null-ide.svg?style=for-the-badge
[forks-url]: https://github.com/TorresVisual/null-ide/network/members
[stars-shield]: https://img.shields.io/github/stars/TorresVisual/null-ide.svg?style=for-the-badge
[stars-url]: https://github.com/TorresVisual/null-ide/stargazers
[issues-shield]: https://img.shields.io/github/issues/TorresVisual/null-ide.svg?style=for-the-badge
[issues-url]: https://github.com/TorresVisual/null-ide/issues
[VSCodium-badge]: https://img.shields.io/badge/VSCodium-2F80ED?style=for-the-badge&logo=vscodium&logoColor=white
[VSCodium-url]: https://vscodium.com
[Electron-badge]: https://img.shields.io/badge/Electron-2B2E3A?style=for-the-badge&logo=electron&logoColor=9FEAF9
[Electron-url]: https://www.electronjs.org
[TypeScript-badge]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org
[Cpp-badge]: https://img.shields.io/badge/C%2B%2B-00599C?style=for-the-badge&logo=cplusplus&logoColor=white
[Cpp-url]: https://isocpp.org
[Rust-badge]: https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white
[Rust-url]: https://www.rust-lang.org
[Tauri-badge]: https://img.shields.io/badge/Tauri-24C8D8?style=for-the-badge&logo=tauri&logoColor=white
[Tauri-url]: https://tauri.app

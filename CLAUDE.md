# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**Null IDE** is a custom Windows desktop code editor built on VSCodium (itself a fork of VS Code with Microsoft telemetry removed). It ships with its own binary name, branding, built-in extensions, and an automated GitHub Actions release pipeline.

Key characteristics:
- Binary name: `null.exe` — accessible from the terminal as `null .`
- Built on VSCodium, which strips Microsoft telemetry from VS Code
- Eight built-in extensions bundled at build time: `null-theme`, `null-icons`, `null-tools`, `null-markdown`, `null-cpp`, `null-actions`, `null-accounts`, `null-format`
- **Code Spell Checker** (`streetsidesoftware.code-spell-checker`) bundled as a ninth built-in extension; version pinned via `CSPELL_TAG` env var in `build.yml`
- CI builds on `windows-2022`; the developer authors source changes locally
- Releases publish a portable ZIP and an Inno Setup installer to GitHub Releases
- The in-app updater (`null-tools`) checks GitHub Releases on startup and can self-update
- Win11 Explorer context menu provided by a native IExplorerCommand DLL (`shell-ext/`) built with CMake + MSVC

## Repository Layout

```
├── .github/workflows/
│   └── build.yml              # Build, package, and release pipeline
├── extensions/
│   ├── null-icons/            # Built-in file icon theme (null-icons)
│   ├── null-theme/            # Built-in color theme (Null Dark)
│   ├── null-markdown/         # Enhanced markdown preview (GFM, Mermaid, KaTeX, GitHub Alerts)
│   ├── null-format/           # Built-in code formatter (Prettier in-process, rustfmt, clang-format)
│   ├── null-tools/             # Built-in productivity extension
│   │   ├── src/                # TypeScript source (extension.ts, commitMessage.ts, dashboard.ts, ...)
│   │   ├── out/                # Compiled JS output (extension.js — built during CI)
│   │   ├── package.json        # Contributes commands, views, keybindings, settings
│   │   └── lib/                # marked.js, dashboard.js, issues.js (webview assets)
│   ├── null-cpp/               # Symbol-aware C++ header/source navigation, paired editors, scaffolding
│   │   ├── src/                # TypeScript source (extension.ts, symbolSwitch.ts, pairedSplit.ts, scaffold.ts)
│   │   └── out/                # Compiled JS output (built during CI)
│   ├── null-actions/           # Status bar action buttons (shell/vscode commands)
│   │   ├── src/                # TypeScript source (buttonConfig.ts, terminalRegistry.ts, statusBarController.ts, settingsPanel.ts...)
│   │   └── out/                # Compiled JS output (built during CI)
│   └── null-accounts/          # GitHub/GitLab account manager and token API
│       ├── src/                # TypeScript source (accountStore.ts, accountInput.ts, api.ts, extension.ts, projectBinding.ts, suggest.ts, providers/github.ts, ui/)
│       └── out/                # Compiled JS output (built during CI)
├── archive/
│   └── wooting-analog/        # Archived, not built by CI — depth-sensitive key actions for Wooting keyboards
├── shell-ext/                 # Win11 native Explorer context menu extension
│   ├── src/                   # C++ IExplorerCommand implementation
│   ├── deps/wil/              # Microsoft WIL headers (fetched by CI)
│   └── AppxManifest.xml       # Sparse APPX manifest (ExternalLocation install)
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
├── patches/                   # Git-format patches applied against the VS Code source tree
├── scripts/
│   ├── convert-icons.js       # SVG → PNG/ICO/ICNS via sharp, to-ico, png2icons
│   ├── merge-json.js          # Deep-merges product.json overlay (our values win)
│   ├── install-null-ide.ps1   # Downloads from GitHub Releases or installs a local ZIP
│   ├── update-null-ide.ps1    # Checks latest release tag, delegates to installer
│   └── build-local.ps1        # Mirrors build.yml's build-windows job for local iteration
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

The entire build runs in GitHub Actions on a `windows-2022` runner — do **not** try to run it locally.

1. Clone VSCodium at `VSCODIUM_TAG` and VS Code at the matching `MS_TAG`.
2. Apply VSCodium's own patches against the VS Code source tree.
3. Apply any patches in `patches/` (currently none).
4. Deep-merge `product.json` overlay into `vscode-src/product.json`.
5. Install `null-markdown` npm dependencies (`npm ci --prefix extensions/null-markdown`).
6. Compile `null-tools` TypeScript (`npm ci && npm run compile` in `extensions/null-tools/`).
7. Compile `null-cpp` TypeScript (`npm ci && npm run compile` in `extensions/null-cpp/`).
8. Compile `null-actions` TypeScript (`npm ci && npm run compile` in `extensions/null-actions/`).
9. Compile `null-accounts` TypeScript (`npm ci && npm run compile` in `extensions/null-accounts/`).
10. Compile `null-format` TypeScript (`npm ci && npm run compile` in `extensions/null-format/`).
11. Copy all eight built-in extensions (`null-theme`, `null-icons`, `null-tools`, `null-markdown`, `null-cpp`, `null-actions`, `null-accounts`, `null-format`) into `vscode-src/extensions/`.
12. Replace upstream icons with files from `icons/`.
13. Copy `workbench/custom.css` → `null-custom.css` and `workbench/splash.js` → `null-splash.js` into the source tree.
14. Inject `<link>` and `<script>` tags into `workbench.html` pointing at those files.
15. `npm ci && npx gulp vscode-win32-x64` produces `VSCode-win32-x64/`.
16. Build Win11 shell extension: fetch WIL headers, compile DLL with CMake + MSVC, pack and sign sparse APPX (`null-shell-ext.appx`).
17. Stamp version, commit hash, and server URL into the build output's `product.json`.
18. Replace letterpress SVGs in the build output with the null-symbol versions.
19. Run `rcedit` to stamp the custom icon into `null.exe`.
20. Bundle `install-null-ide.ps1` and `update-null-ide.ps1` into `resources/app/null-updater/`.
21. `Compress-Archive` → `null-ide-win32-x64.zip`.
22. Inno Setup → `NullIDESetup-<version>.exe`.
23. Both artifacts are uploaded to the GitHub Release (tag builds) and as workflow artifacts.

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

### null-markdown (`extensions/null-markdown/`)
Enhanced markdown preview activated on `onLanguage:markdown`. Provides:
- GitHub Flavored Markdown (GFM), task lists, emoji, footnotes
- Mermaid diagram rendering (flowcharts, sequence, Gantt, etc.)
- KaTeX math rendering (inline `$...$` and block `$$...$$`)
- GitHub-style alert blocks (`> [!NOTE]`, `> [!WARNING]`, etc.)

Keybindings: `Ctrl+Shift+V` and `Ctrl+K V` open the preview (same as VS Code default).

### null-format (`extensions/null-format/`)
In-box code formatting provider for JS/TS/web, Rust, and C/C++. Activated per language.
- **Prettier (in-process)**: Formats JavaScript, TypeScript, JSX, TSX, JSON, JSONC, CSS, SCSS, Less, HTML, YAML, and Markdown.
- **rustfmt**: Formats Rust source files (`rustfmt --emit stdout`).
- **clang-format**: Formats C, C++, and CUDA source files.
- **Editable Default Configs**: Exposes editable fallback configurations directly in settings (`null-format.prettier.defaultConfig`, `null-format.rustfmt.defaultConfig`, `null-format.clangFormat.defaultConfig`). If a project contains its own configuration file (`.prettierrc`, `rustfmt.toml`, `.clang-format`), project-level config takes precedence automatically.

### null-tools (`extensions/null-tools/`)
Written in TypeScript (`src/`), compiled to `out/` during CI. Activated on `onStartupFinished`. Provides:

| Feature | Details |
|---|---|
| **Project dashboard** | Custom editor (`null.dashboard`, `viewType`); opened on startup and via Help > Welcome (see `patches/003-*` and `004-*`); recent-project cards with async git status, New Project, Clone Repo |
| **GitHub Issues panel** | Own activity-bar view (`null-issues`) plus a full-width tab (`null.issues.openFullView`); GraphQL search with a github.com-style query box, Open/Closed counts, filter dropdowns, sort, presets, paging and keyboard navigation; github.com-style issue tab (server-rendered markdown timeline with events, reactions, sub-issues, linked PRs, a metadata sidebar with optimistic pickers, close reasons, one tab per issue); a Write/Preview composer (toolbar, shortcuts, @/# autocomplete, drafts kept per issue) for comments and edits, a New issue tab (template chooser, sidebar pickers, Create more, sub-issue creation), image attach (paste, drop or toolbar; committed to an orphan `null-issue-assets` branch) with thumbnails cached in `.null/issue-images/`, *Copy as prompt* with comments and local image paths, sign-in, mark-as-read, issue templates, link/insert issue references in commit messages, an "open this issue?" prompt when you switch to an `issue-<n>-…` branch; signs in through null-accounts (`githubAuth.ts` → `githubSession.ts`); `null-tools` declares `extensionDependencies: ["null.null-accounts"]` |
| **Commit message generation** | `null.generateCommitMessage` (`Ctrl+Shift+Alt+G`) — runs `claude --print` with staged diff; sets SCM input box |
| **In-app updater** | Checks GitHub Releases on startup; shows status bar button; self-updates via PowerShell |
| **Discord Rich Presence** | `discordRpcClient.ts` (IPC pipe / WebSocket transport), `discordPresence.ts` (activity building), `presenceOwnership.ts` (one window publishes), `discordAppInfo.ts` (Developer Portal diagnostics). Configured via `null.discord.*`; `null.discord.testConnection` reports setup problems |

### null-cpp (`extensions/null-cpp/`)
Symbol-aware C/C++ header/source switching, auto-paired split editors with scroll sync, and `.hpp`/`.cpp` class scaffolding, layered on top of the (separately installed) `llvm-vs-code-extensions.vscode-clangd` extension. Activated on `onStartupFinished`; features gate on `null-cpp.isCppProject`, set by scanning for `CMakeLists.txt`, `compile_commands.json`, `.clangd`, or C/C++ source files (`null-cpp.projectDetection.override` can force this). `Alt+O` triggers symbol-aware header/source switching. See `docs/specs/null-cpp-extension-design.md`.

CMake/toolchain/build/debug orchestration on top of this (the "C++ development layer") is planned but not yet built — see `docs/ROADMAP.md` for the phased delivery plan and `docs/c++-development.md` for the original vision doc.

### null-actions (`extensions/null-actions/`)
Status-bar buttons that run shell commands (via a dedicated, deterministically-reused terminal per button — identity is keyed by button id, never by command text, so window reloads and folder reopens don't spawn duplicate terminals) or VS Code API commands. Configured through a settings panel opened via the `$(gear) Actions` status bar item or the `null-actions.openSettings` command (opens as a `WebviewPanel` in the main editor area, not a sidebar view), or directly via the `null-actions.buttons` setting. Supports variable substitution (`${workspaceFolder}`, `${file}`, `${selectedText}`, etc.), priority-ordered status bar placement, an Affinity-style canvas color picker for the button text color, and project-type-detection suggestions (`Cargo.toml`, `CMakeLists.txt`, `*.csproj`, or a one-click "Load npm scripts" button that writes each `package.json` script in as a real persisted button). See `docs/specs/null-actions-design.md`.

### null-accounts (`extensions/null-accounts/`)
GitHub/GitLab account manager (issue #102). Activated on `onStartupFinished`; exports `NullAccountsApi` (`getAccounts`, `getAccountForFolder`, `ensureAccountForFolder`, `getToken`, `onDidChange`) via `extensions.getExtension('null.null-accounts')?.exports`. Account metadata lives in `globalState`, secrets in `SecretStorage` under `null-accounts/<id>`; `Account.host` is a bare lowercase hostname. `getToken(account, scopes?, { interactive? })` is silent unless `interactive` is true. **Status: GitHub + project binding** — the GitHub provider wraps VS Code's built-in `github` session (`Account.externalId` is the session's account id; tokens stay with VS Code), folders bind to an account in `globalState` (`projectBinding.ts`) with an origin-based suggestion (`suggest.ts`), `ensureAccountForFolder` opens a pick/add quick-pick, and a one-time prompt imports the account VS Code was already signed in with. The Issues panel in null-tools resolves its token through the API. The accounts webview, GitLab, and git wiring land in later phases. Design: `docs/specs/null-accounts-design.md`; phase plans: `docs/plans/null-accounts-phase*.md`.

### wooting-analog — archived (`archive/wooting-analog/`)
Depth-sensitive key actions for Wooting hall-effect keyboards (napi-rs Rust addon loading `wooting_analog_sdk.dll`). No longer bundled by the build; moved out of `extensions/` and out of `build.yml`/`build-local.ps1`/`sync-local.ps1`. Source is kept for reference — see git history prior to its move for the full built-in-extension writeup.

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

## Win11 Shell Extension (`shell-ext/`)

Native C++ COM in-process server implementing `IExplorerCommand` for the Win11 Explorer context menu; packed as a self-signed sparse APPX. See [shell-ext/CLAUDE.md](shell-ext/CLAUDE.md) for the build sequence and the cold-start AUMID gotcha.

## Patches

Workbench chrome customisations (CSS/JS injection, icon swaps) are handled by direct file injection rather than patches — that proved fragile across VS Code version bumps. `patches/` is for changes that must touch VS Code's own source (a workbench.ts startup hook, a type fix upstream doesn't ship):

- `001-jumplist-recent-projects.patch` — sources the Win taskbar jump list's Recent Projects from null-tools
- `002-fix-claude-copilotapi-types.patch` — restores Anthropic SDK typing in `copilotApiService.ts`
- `003-null-dashboard-startup.patch` — opens the Null Dashboard on startup
- `004-null-dashboard-help-welcome.patch` — wires the dashboard into Help > Welcome
- `006-settings-toc-split-extensions.patch` — splits the Settings editor's Extensions node into Null / Installed Extensions / Built-in Extensions sections

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
- Full builds normally run in GitHub Actions, not locally. `scripts/build-local.ps1` is the exception: it mirrors the `build-windows` job for iterating on `build.yml`, `shell-ext/`, `installer/`, or the VSCodium/VS Code patch/merge steps — things `scripts/sync-local.ps1` can't reach. Don't run it without being asked; it takes tens of minutes and needs Node, Rust, CMake, VS2022, and Inno Setup 6 installed (see the script's header for the full list).
- Do not set the Microsoft extension gallery env var silently; document it in the README only.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

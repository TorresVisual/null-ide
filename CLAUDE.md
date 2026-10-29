# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**Null IDE** is a custom desktop code editor (Windows, plus a Linux x64 tar.gz/deb) built on VSCodium (itself a fork of VS Code with Microsoft telemetry removed). It ships with its own binary name, branding, built-in extensions, and an automated GitHub Actions release pipeline.

Key characteristics:
- Binary name: `null.exe` — accessible from the terminal as `null .`
- Built on VSCodium, which strips Microsoft telemetry from VS Code
- Fourteen built-in extensions bundled at build time: `null-theme`, `null-icons`, `null-tools`, `null-markdown`, `null-cpp`, `null-actions`, `null-accounts`, `null-format`, `null-music`, `null-activity`, `null-startup`, `null-env`, `null-sync`, `null-devcontainer`
- **Code Spell Checker** (`streetsidesoftware.code-spell-checker`) bundled as a fourteenth built-in extension; version pinned via `CSPELL_TAG` env var in `build.yml`
- **Remote development** (#85): `jeanp413.open-remote-wsl` / `open-remote-ssh` bundled as built-ins (Open VSX VSIXes, versions pinned via `OPEN_REMOTE_*_VERSION` in `build.yml`, mirrored in `build-local.ps1`). They connect to a Null-repacked VSCodium REH server: CI appends the workspace-side built-ins (`null-env`, `null-cpp`, `null-format`, `null-actions`, `null-markdown`, Code Spell Checker) to the stock tarball via `tar @archive` (keeps exec bits) and publishes `null-reh-linux-{x64,arm64}.tar.gz` on the Null release; `release` in the stamped `product.json` is that release's tag. `serverApplicationName` stays `codium-server` (the launcher script inside the tarball), `serverDataFolderName` is `.null-server`. The remote caches a server per VSCodium commit, so a built-in change without a VSCodium bump needs `~/.null-server/bin/<commit>` deleted. Machine-local extensions (`null-tools`, `null-accounts`, `null-music`, `null-startup`, `null-activity`, `null-sync`) declare `extensionKind: ["ui"]`. Not yet verified end to end in a CI-built package; non-tag builds publish no server
- CI builds on `windows-2022` (and `ubuntu-22.04` for Linux); the developer authors source changes locally
- Releases publish a portable ZIP and the setup stub (`NullIDESetup-<version>.exe`) to GitHub Releases
- The in-app updater (`null-tools`) checks GitHub Releases on startup and can self-update
- Win11 Explorer context menu provided by a native IExplorerCommand DLL (`shell-ext/`) built with CMake + MSVC

## Repository Layout

```
├── .github/workflows/
│   └── build.yml              # Build, package, and release pipeline
├── extensions/                # One dir per built-in extension (see "Built-in Extensions"); each has src/ and a tracked out/
├── archive/
│   └── wooting-analog/        # Archived, not built by CI — depth-sensitive key actions for Wooting keyboards
├── setup/                     # null-setup (Rust workspace: core + Tauri app); update/prefetch/recover, headless install modes and the wizard window
├── launcher/                  # null_launcher.exe: standalone project picker started by the jump list (Rust lib + Tauri shell + plain JS page); see launcher/CLAUDE.md
├── shell-ext/                 # Win11 native Explorer context menu extension
│   ├── widgets/               # null_widgets.exe: desktop widgets host (CTest-covered core + Win32/Direct2D shell)
│   ├── src/                   # C++ IExplorerCommand implementation
│   ├── deps/wil/              # Microsoft WIL headers (fetched by CI)
│   └── AppxManifest.xml       # Sparse APPX manifest (ExternalLocation install)
├── icons/                     # Source icons used by the build (icon.svg is the master); also Null.VisualElementsManifest.xml (Win10 tile metadata)
├── patches/                   # Git-format patches applied against the VS Code source tree
├── scripts/                   # check-widgets.ps1 (manual run for the desktop widgets), fake-release.mjs, gen-builtins.mjs, merge-json.js, convert-icons.js, linux-deb-metadata.mjs (Debian template rewrite), linux-smoke.sh (Linux artifact smoke test), build-local.ps1 (CI mirror), sync-local.ps1 + reload-local.ps1 (fast local iteration)
├── workbench/
│   ├── custom.css             # Injected as null-custom.css into workbench.html
│   ├── splash.js              # Runs in <head> before the workbench (no Node/AMD)
│   ├── letterpress-dark.svg   # Empty-editor watermark — dark variant (∅ symbol)
│   └── letterpress-light.svg  # Empty-editor watermark — light variant
├── docs/                      # specs/, plans/, ROADMAP.md; wiki/ is the GitHub Wiki source (publish with /wiki-sync); index.html is the GitHub Pages homepage
└── product.json               # Deep-merged into vscode/product.json before build
```

## How the Build Works

The entire build runs in GitHub Actions on a `windows-2022` runner — do **not** try to run it locally.

1. Clone VSCodium at `VSCODIUM_TAG` and VS Code at the matching `MS_TAG`.
2. Apply VSCodium's own patches, then every `patches/*.patch` in name order (`git apply --ignore-whitespace`).
3. Deep-merge `product.json` overlay into `vscode-src/product.json`.
4. `npm ci --prefix extensions/null-markdown` and `npm run build` in it (esbuild bundles the Markdown Editor webview); `npm ci && npm run compile` in each other TS extension (`null-tools`, `null-cpp`, `null-actions`, `null-accounts`, `null-format`, `null-music`, `null-activity`, `null-startup`, `null-env`, `null-sync`, `null-devcontainer`).
5. Copy all fourteen built-in extensions into `vscode-src/extensions/` (their `CLAUDE.md` files are deleted after the copy); bundle Code Spell Checker from `CSPELL_TAG`.
6. Replace upstream icons with files from `icons/`.
7. Copy `workbench/custom.css` → `null-custom.css` and `workbench/splash.js` → `null-splash.js` into the source tree; inject `<link>` / `<script>` tags into `workbench.html`.
8. `npm ci && npx gulp vscode-win32-x64` produces `VSCode-win32-x64/`.
9. Build Win11 shell extension: fetch WIL headers, compile DLL with CMake + MSVC, pack and sign sparse APPX (`null-shell-ext.appx`). Run CTest (the desktop widgets host's tests) and copy `null_widgets.exe` to the install root.
10. Stamp version, commit hash, and server URL into the build output's `product.json`; replace letterpress SVGs; `rcedit` the icon into `null.exe`.
11. Build `setup/` with cargo (`cargo test`, then `cargo build --release`); ship `null-setup.exe` as `setup/null-setup.exe`; `null-setup` registers natively.
12. Test and build `launcher/` (`cargo test --locked`, `node --test launcher/ui-tests/launcher-model.test.mjs`, `cargo build --release --locked`); `null_launcher.exe` is copied into the install root next to `null.exe` (patch 001 starts it from the jump list).
13. `Compress-Archive` → `null-ide-win32-x64-<tag>.zip`; the setup stub → `NullIDESetup-<version>.exe`; all uploaded to the GitHub Release (tag builds) and as workflow artifacts. The release body comes from `scripts/release-notes.mjs` (highlights from `docs/specs/` + `docs/plans/` added since the previous `v*` tag, then commits grouped by Conventional Commit type); `node --test scripts/release-notes.test.mjs` covers its pure parts.

### Linux (`build-linux` job)

- Runs on `ubuntu-22.04`, parallel to `build-windows`; a Linux failure never blocks the Windows release. `workflow_dispatch` input `build_linux` (default true); tag pushes always build it.
- Applies `patches/` plus VSCodium's `patches/linux/` and `patches/linux/client/` (with `!!PLACEHOLDER!!` values substituted by `sed`), then the overlay `patches/`.
- Packages with VS Code's own `gulp vscode-linux-x64` and the `vscode-linux-x64-prepare-deb` / `-build-deb` tasks. `scripts/linux-deb-metadata.mjs` rewrites the Debian templates so the deb never registers Microsoft's apt repository; it throws on upstream drift.
- `scripts/linux-smoke.sh` installs, launches and removes both artifacts before publishing.
- Assets: `null-ide-linux-x64-<tag>.tar.gz` (+ `.sha256`) and `null-ide-linux-x64-<tag>.deb`. Windows assets are `null-ide-win32-x64-<tag>.zip` (+ `.sha256`). Only x64; no rpm, AppImage, arm64 or Linux self-update.

## Built-in Extensions
Conventions for every extension with a `src/`:
- `out/` is tracked in git. After editing `src/`, run `npm run compile` in that extension and commit the refreshed `out/` (repo uses `chore: refresh <ext> compiled output` commits). Never hand-edit `out/`.
- `npm test` runs an explicit list of `out/**/*.test.js` files in `package.json`'s `test` script; a new test file is silently skipped until added there.

### null-theme (`extensions/null-theme/`)
Default color theme (Null Dark) via `product.json → defaultColorTheme`. Fonts: Geist Mono, JetBrains Mono, Cascadia Code.

### null-icons (`extensions/null-icons/`)
Built-in file icon theme. Set as the default via `product.json → defaultIconTheme`. Contains SVG icons for a wide range of file types and folder types.

### null-markdown (`extensions/null-markdown/`)
Enhanced markdown preview (GFM, Mermaid, KaTeX, GitHub alerts) plus the Markdown Editor, a live-preview `CustomTextEditorProvider` that is the default view of `.md` files. The webview is bundled by `npm run build` into the tracked `lib/editor.js`; `node_modules` come from `npm ci --prefix` in CI and `sync-local.ps1` does not copy them. Details: [`extensions/null-markdown/CLAUDE.md`](extensions/null-markdown/CLAUDE.md).

### null-format (`extensions/null-format/`)
Prettier (in-process), rustfmt and clang-format formatting providers. Editable fallback configs are `null-format.{prettier,rustfmt,clangFormat}.defaultConfig`; a project's own `.prettierrc` / `rustfmt.toml` / `.clang-format` always wins.

### null-music (`extensions/null-music/`)
Local-file music player. The extension host owns all state; sound comes from an `<audio>` element in the sidebar webview. No provider abstraction — do not add one. Details: [`extensions/null-music/CLAUDE.md`](extensions/null-music/CLAUDE.md).

### null-activity (`extensions/null-activity/`)
Local-only activity tracking (dashboard, git statistics, badges, WakaTime import, multi-machine sync) derived from an append-only per-window interval log. Deletion is deliberately not on `NullActivityApi`; the only network code is `gistHttp.ts`. Details: [`extensions/null-activity/CLAUDE.md`](extensions/null-activity/CLAUDE.md).

### null-startup (`extensions/null-startup/`)
Startup profiler. Reads data through the internal command `_null.startup.snapshot` added by patch 010; on a build without the patch nothing is recorded. Details: [`extensions/null-startup/CLAUDE.md`](extensions/null-startup/CLAUDE.md).

### null-env (`extensions/null-env/`)
Environment check, workspace-side. `null-format`, `null-actions` and `null-cpp` declare `extensionDependencies: ["null.null-env"]` and use its exports with no fallback; `null-tools` (UI host) reads findings through the command `null.env.getFindings`. Details: [`extensions/null-env/CLAUDE.md`](extensions/null-env/CLAUDE.md).

### null-sync (`extensions/null-sync/`)
Cross-device sync through one encrypted secret Gist, reached via null-accounts. `extensionKind: ["ui"]`, off by default, no UI (it exposes `NullSyncApi`). The passphrase cannot be recovered. Details: [`extensions/null-sync/CLAUDE.md`](extensions/null-sync/CLAUDE.md).

### null-devcontainer (`extensions/null-devcontainer/`)
Quick-and-dirty dev containers (no Microsoft extension). `extensionKind: ["ui"]`, a `resolvers`-proposal remote-authority resolver for `dev-container+<hex of local folder>`. Supports `image`, `initializeCommand` (run through `sh -c`, so Windows needs Git's `sh`), `runArgs`, `remoteUser`, `containerEnv`, `workspaceFolder` and `customizations.vscode.extensions`; nothing else. Details: [`extensions/null-devcontainer/CLAUDE.md`](extensions/null-devcontainer/CLAUDE.md).

### null-tools (`extensions/null-tools/`)
TypeScript, activated on `onStartupFinished`. Project dashboard, GitHub Issues panel, GitHub pull requests review, GitHub Actions, commit message generation/validation, in-app updater, Discord Rich Presence, Null: Setup, crash recovery, first-run choices, the Null Workspace Features hub and the commit graph. Depends on null-accounts (`extensionDependencies`); webview code in `src/webview/` compiles through separate `tsconfig.webview-*.json` projects into `lib/`. Details: [`extensions/null-tools/CLAUDE.md`](extensions/null-tools/CLAUDE.md).

### null-cpp (`extensions/null-cpp/`)
Symbol-aware C/C++ header/source switching (`Alt+O`), paired split editors, class scaffolding and the CMake/Make toolbar, layered on the separately installed clangd extension. Features gate on `null-cpp.isCppProject`. Details: [`extensions/null-cpp/CLAUDE.md`](extensions/null-cpp/CLAUDE.md).

### null-actions (`extensions/null-actions/`)
Status-bar buttons that run shell commands or VS Code commands. Terminal identity is keyed by button id, never by command text. Configured through `null-actions.buttons` or the settings panel. Details: [`extensions/null-actions/CLAUDE.md`](extensions/null-actions/CLAUDE.md).

### null-accounts (`extensions/null-accounts/`)
GitHub/GitLab/SSH account manager. Exports `NullAccountsApi` (`getToken` is silent unless `interactive`); secrets live in `SecretStorage`, never in settings. Binding a folder to an account wires repo-local git config, credentials and SSH keys. Details: [`extensions/null-accounts/CLAUDE.md`](extensions/null-accounts/CLAUDE.md).

## Workbench Assets

`workbench/custom.css` and `workbench/splash.js` are injected into `workbench.html` at build time. They run in the Electron renderer process.

Constraints for `splash.js`:
- Runs in `<head>` before VS Code's workbench initialises
- `require` (Node.js) is **not** available (contextIsolation)
- The AMD loader is **not** available (VS Code 1.99+ uses ESM)
- Only DOM APIs and synchronous script execution are safe

## Installer and Scripts

### `setup/` (null-setup)
`null-setup.exe` (Rust workspace: `core` + Tauri `app`) is the updater and the only installer; `NullIDESetup-<version>.exe` is a copy that opens the wizard. Core logic and tests are in `setup/core` (`cargo test -p null-setup-core`). Run the headless modes from a copy outside the install dir: started from `<install>\setup\null-setup.exe` the process relocates itself and exits 0 at once. Details: [`setup/CLAUDE.md`](setup/CLAUDE.md).

## Win11 Shell Extension (`shell-ext/`)

Native C++ COM in-process server implementing `IExplorerCommand` for the Win11 Explorer context menu; packed as a self-signed sparse APPX. See [shell-ext/CLAUDE.md](shell-ext/CLAUDE.md) for the build sequence and the cold-start AUMID gotcha.

## Patches

Workbench chrome customisations (CSS/JS injection, icon swaps) are handled by direct file injection rather than patches — that proved fragile across VS Code version bumps. `patches/` is for changes that must touch VS Code's own source (a workbench.ts startup hook, a type fix upstream doesn't ship):

- `001-jumplist-recent-projects.patch` — sources the Win taskbar jump list's Recent Projects from null-tools
- `002-fix-claude-copilotapi-types.patch` — restores Anthropic SDK typing in `copilotApiService.ts`
- `003-null-dashboard-startup.patch` — opens the Null Dashboard on startup
- `004-null-dashboard-help-welcome.patch` — wires the dashboard into Help > Welcome
- `005-claude-code-command-center-button.patch` — restores the icon and chevron on the command-center Claude split button
- `006-settings-toc-split-extensions.patch` — splits the Settings editor's Extensions node into Null / Installed Extensions / Built-in Extensions sections
- `007-accounts-menu-null-accounts.patch` — the Accounts menu lists null-accounts' accounts (read from the `null.accounts.menu` context key, each row with its round `data:` picture or provider glyph, the host dimmed after the name, and a "Project: <folder>" heading) and drops VS Code's provider-session and Settings Sync / Copilot / Edit Sessions / tunnel rows; the activity-bar Accounts button shows the picture under `null.accounts.avatar`
- `008-git-commit-message-check.patch` — `smartCommit` calls `null.commitMessage.check` (null-tools) and aborts with its reason; no-op when null-tools is absent
- `009-safe-mode.patch` — `--safe-mode`: the enablement check disables user extensions and Null-owned built-ins (`isDisabledInSafeMode`); core status bar item, `[Safe Mode]` title suffix and Restart in Safe Mode / Restart Normally commands; `reload({ safeMode })`; main-process failed-start counter (`safe-mode-state.json`, offers safe mode after 3 failed starts). Pure parts have `node --test patches/test/*.test.mjs`. Design `docs/specs/safe-mode-design.md`
- `010-startup-snapshot.patch` — stamps extension activations (`activationStartedAt` / `activationEndedAt`) and registers the internal command `_null.startup.snapshot` for null-startup; the pure builder is covered by `node --test patches/test/*.test.mjs`
- `011-compile-cache-rm-retries.patch` — retries the temp-dir cleanup in `build/lib/nodeCompileCache.ts` (VS Code 1.140+ launches the built app to generate the Node compile cache; on Windows the extension host still holds `exthost.log`, so the first `rm` fails with EBUSY and fails the whole gulp build)
- `012-color-ring-picker.patch` — core's color picker (editor hover and the standalone picker, the only two users of `ColorPickerWidget`) shows a hue ring + inscribed saturation/lightness triangle (`colorPickerRing.ts`) instead of the saturation box and hue strip; the opacity strip stays. The ring owns its hue because HSL has none at greys. Pure math has `node --test patches/test/*.test.mjs`. Design `docs/specs/core-color-picker-design.md`; not yet visually verified in a CI build

To add a patch against the VS Code source:
```bash
cd vscode-src
# Make the change, commit it
git add -p && git commit -m "feat: describe change"
git format-patch HEAD~1 -o ../patches/
```

Patches apply **after** VSCodium's own patches, against the VS Code commit at `MS_TAG`. When rebasing to a new upstream, re-export with `git format-patch`.

## Updating the Upstream Version

1. The separate `.github/workflows/upstream-check.yml` workflow (Mondays 06:00 UTC, or manual dispatch) opens a PR automatically if VSCodium has a new release (needs repo setting Actions → "Allow GitHub Actions to create and approve pull requests"). The PR body says whether all patches apply against the new MS tag; a failing check opens it as a draft.
2. To bump manually: edit the root `VSCODIUM_TAG` file (or pass `vscodium_tag` when dispatching `build.yml`).
3. Verify any patches in `patches/` still apply cleanly against the new MS tag.

VSCodium trails VS Code by several releases, so the same workflow's `vscode-releases` job also opens a *Review VS Code 1.x release notes* issue for each VS Code stable release after `Last reviewed` in `docs/vscode-tracking.md` (#115). `/vscode-watch` triages those (Backport / Adapt / Wait / N/A) into that tracker; a bump PR asks you to reconcile rows up to its `MS_TAG`.

## Key Build Variables (`build.yml`)

| Variable | Purpose |
|---|---|
| `VSCODIUM_TAG` (root file, not an env var) | VSCodium release tag to build against |
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
```

## Scope Constraints

- Work only inside `D:\Coding\Apps\null-ide\` and its subdirectories.
- Do not touch system PATH, registry, or any existing VS Code/VSCodium installation outside this repo's installer scripts.
- Full builds normally run in GitHub Actions, not locally. `scripts/build-local.ps1` is the exception: it mirrors the `build-windows` job for iterating on `build.yml`, `shell-ext/`, `setup/`, or the VSCodium/VS Code patch/merge steps — things `scripts/sync-local.ps1` can't reach. Don't run it without being asked; it takes tens of minutes and needs Node, Rust, CMake, VS2022 installed (see the script's header for the full list).
- Iterate locally with `scripts/sync-local.ps1` (pushes compiled extensions + workbench assets into an installed Null IDE), then `scripts/reload-local.ps1` — `Developer: Reload Window` still serves cached `null-custom.css` / `null-splash.js`. The `/verify-local` skill chains both with the integration specs.
- Do not set the Microsoft extension gallery env var silently; document it in the README only.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

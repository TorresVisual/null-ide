# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**Null IDE** is a custom Windows desktop code editor built on VSCodium (itself a fork of VS Code with Microsoft telemetry removed). It ships with its own binary name, branding, built-in extensions, and an automated GitHub Actions release pipeline.

Key characteristics:
- Binary name: `null.exe` — accessible from the terminal as `null .`
- Built on VSCodium, which strips Microsoft telemetry from VS Code
- Ten built-in extensions bundled at build time: `null-theme`, `null-icons`, `null-tools`, `null-markdown`, `null-cpp`, `null-actions`, `null-accounts`, `null-format`, `null-music`, `null-activity`
- **Code Spell Checker** (`streetsidesoftware.code-spell-checker`) bundled as an eleventh built-in extension; version pinned via `CSPELL_TAG` env var in `build.yml`
- CI builds on `windows-2022`; the developer authors source changes locally
- Releases publish a portable ZIP and an Inno Setup installer to GitHub Releases
- The in-app updater (`null-tools`) checks GitHub Releases on startup and can self-update
- Win11 Explorer context menu provided by a native IExplorerCommand DLL (`shell-ext/`) built with CMake + MSVC

## Repository Layout

```
├── .github/workflows/
│   └── build.yml              # Build, package, and release pipeline
├── extensions/                # One dir per built-in extension (see "Built-in Extensions"); each has src/ and a tracked out/
├── archive/
│   └── wooting-analog/        # Archived, not built by CI — depth-sensitive key actions for Wooting keyboards
├── shell-ext/                 # Win11 native Explorer context menu extension
│   ├── src/                   # C++ IExplorerCommand implementation
│   ├── deps/wil/              # Microsoft WIL headers (fetched by CI)
│   └── AppxManifest.xml       # Sparse APPX manifest (ExternalLocation install)
├── icons/                     # Source icons used by the build (icon.svg is the master)
├── installer/
│   ├── null-ide.iss           # Inno Setup script → NullIDESetup-<version>.exe
│   └── Null.VisualElementsManifest.xml  # Win10 tile metadata
├── patches/                   # Git-format patches applied against the VS Code source tree
├── scripts/                   # install/update-null-ide.ps1, merge-json.js, convert-icons.js, build-local.ps1 (CI mirror), sync-local.ps1 + reload-local.ps1 (fast local iteration)
├── workbench/
│   ├── custom.css             # Injected as null-custom.css into workbench.html
│   ├── splash.js              # Runs in <head> before the workbench (no Node/AMD)
│   ├── letterpress-dark.svg   # Empty-editor watermark — dark variant (∅ symbol)
│   └── letterpress-light.svg  # Empty-editor watermark — light variant
├── docs/                      # specs/, plans/, ROADMAP.md; index.html is the GitHub Pages homepage
└── product.json               # Deep-merged into vscode/product.json before build
```

## How the Build Works

The entire build runs in GitHub Actions on a `windows-2022` runner — do **not** try to run it locally.

1. Clone VSCodium at `VSCODIUM_TAG` and VS Code at the matching `MS_TAG`.
2. Apply VSCodium's own patches, then every `patches/*.patch` in name order (`git apply --ignore-whitespace`).
3. Deep-merge `product.json` overlay into `vscode-src/product.json`.
4. `npm ci --prefix extensions/null-markdown`; `npm ci && npm run compile` in each other TS extension (`null-tools`, `null-cpp`, `null-actions`, `null-accounts`, `null-format`, `null-music`, `null-activity`).
5. Copy all ten built-in extensions into `vscode-src/extensions/`; bundle Code Spell Checker from `CSPELL_TAG`.
6. Replace upstream icons with files from `icons/`.
7. Copy `workbench/custom.css` → `null-custom.css` and `workbench/splash.js` → `null-splash.js` into the source tree; inject `<link>` / `<script>` tags into `workbench.html`.
8. `npm ci && npx gulp vscode-win32-x64` produces `VSCode-win32-x64/`.
9. Build Win11 shell extension: fetch WIL headers, compile DLL with CMake + MSVC, pack and sign sparse APPX (`null-shell-ext.appx`).
10. Stamp version, commit hash, and server URL into the build output's `product.json`; replace letterpress SVGs; `rcedit` the icon into `null.exe`.
11. Bundle `install-null-ide.ps1` and `update-null-ide.ps1` into `resources/app/null-updater/`.
12. `Compress-Archive` → `null-ide-win32-x64.zip`; Inno Setup → `NullIDESetup-<version>.exe`; both uploaded to the GitHub Release (tag builds) and as workflow artifacts.

## Built-in Extensions
Conventions for every extension with a `src/`:
- `out/` is tracked in git. After editing `src/`, run `npm run compile` in that extension and commit the refreshed `out/` (repo uses `chore: refresh <ext> compiled output` commits). Never hand-edit `out/`.
- `npm test` runs an explicit list of `out/**/*.test.js` files in `package.json`'s `test` script; a new test file is silently skipped until added there.

### null-theme (`extensions/null-theme/`)
Default color theme (Null Dark) via `product.json → defaultColorTheme`. Fonts: Geist Mono, JetBrains Mono, Cascadia Code.

### null-icons (`extensions/null-icons/`)
Built-in file icon theme. Set as the default via `product.json → defaultIconTheme`. Contains SVG icons for a wide range of file types and folder types.

### null-markdown (`extensions/null-markdown/`)
Enhanced markdown preview (GFM, Mermaid, KaTeX, GitHub alerts) on `onLanguage:markdown`. Its `node_modules` come from `npm ci --prefix` in CI and are not synced by `sync-local.ps1`.

### null-format (`extensions/null-format/`)
Prettier (in-process), rustfmt and clang-format formatting providers. Editable fallback configs are `null-format.{prettier,rustfmt,clangFormat}.defaultConfig`; a project's own `.prettierrc` / `rustfmt.toml` / `.clang-format` always wins.

### null-music (`extensions/null-music/`)
Local-file music player: activity-bar view `null.musicView`, status bar item, `Ctrl+Alt+…` media keybindings. The extension host owns all state — `Library` (folders + `.m3u8`, tags and cover art via the in-house `library/tagReader.ts`, JSON cache in `globalStorageUri`), `Queue` (history-aware shuffle, play next/add), `Player` (single position clock, paused session restore under `globalState` key `null-music.session`) and an `AudioOutput`. Sound comes from an `<audio>` element in the sidebar webview (`WebviewAudioOutput`): commands reveal the view and wait for its `ready`, and closing the view stops playback. `isPlaying` is true only after the output reports `play`. There is no provider abstraction; do not add one. The sidebar UI is vanilla TS in `src/webview/music/` (`module: none`, no imports; `tsconfig.webview-music.json` compiles it into the tracked `lib/music.js`, and `lib/music.css` is hand-written — the only hand-edited file in `lib/`). Pure `dom.ts`/`model.ts` are also compiled by `tsconfig.webview-music-shared.json` so `node --test` can load them through `vm` (top-level `function` declarations only). Host and webview share the typed `HostToWebview`/`WebviewToHost` unions in `protocol.ts` (the host pulls them in with a triple-slash reference); `MusicViewController` publishes `player`/`queue`/`library`/`liked` snapshots and the webview only sends intents. Rows carry `data-vscode-context` and the manifest's `webview/context` menu contributes the `null-music.track.*` commands. `sync-local.ps1` copies `lib/`. Designs: `docs/specs/null-music-engine-design.md`, `docs/specs/null-music-player-ui-design.md`; plans: `docs/plans/null-music-engine.md`, `docs/plans/null-music-player-ui.md`.

### null-activity (`extensions/null-activity/`)
Local-only activity tracking (issue #113; engine, dashboard, git statistics, badges and WakaTime import). Activated on `onStartupFinished`; returns `NullActivityApi` (`getIntervals`, `getDailyStats`, `getProjectStats`, `getLanguageStats`, `getSessions`, `recordActivity`, `start/pause/endSession`, `onDidChange`) from `activate`. Deletion is deliberately not on the API. Everything is derived from an append-only interval log: `intervals-YYYY-MM-<windowId>.jsonl` under `globalStorageUri`, one file per window session so concurrent windows never clobber each other; `stats.ts` merges and clips overlaps. `Tracker` is a pure state machine over `Heartbeat`s with an injected clock (close rule: a heartbeat within `idleTimeout` (default 900 s, WakaTime's 15 min) of the last one extends the interval and a closing heartbeat ends it at its own time; closes with no heartbeat — focus loss, pause, shutdown — end at the last heartbeat, so idle time is never credited); only `heartbeatSource.ts`, `statusBar.ts`, `commands.ts` and `extension.ts` import `vscode`. Heartbeats count only while the window is focused and for edits to any open file or untitled document (agent edits to background files count, attributed to the edited file); terminal activity is shell-integration command start/end (no keystroke API exists). Project key is the normalized git remote (worktree-aware), falling back to the folder path. `null-activity.enabled` is the master switch. The only network code is `gistHttp.ts` (opt-in badge publishing); the engine, dashboard and git code have none. The **Coding Activity dashboard** (`null-activity.openDashboard`; the status bar item opens it) is one reused `WebviewPanel` in `dashboardPanel.ts`, fed by the pure `dashboardModel.ts` (`buildDashboardModel` over `NullActivityApi`, plus `parseWebviewMessage` for untrusted webview messages); the CSP shell is `dashboardHtml.ts`. The vanilla-TS UI in `src/webview/dashboard/` (`module: none`, no imports) compiles via `tsconfig.webview-dashboard.json` into the tracked `lib/dashboard.js`; `tsconfig.webview-dashboard-shared.json` compiles `protocol.ts`/`dom.ts`/`model.ts` for the `vm` tests; `lib/dashboard.css` is hand-written; `tsconfig.json` excludes `src/webview`. `sync-local.ps1` copies `lib`. It is read-only (no delete buttons) and adds no engine API. **Git statistics** (`gitLog.ts` pure parser, `gitStatsService.ts` with injected deps and a 60 s per-repo cache, `gitExec.ts` the only place that spawns git): the dashboard shows your commits, distinct files and lines +/− per project and in total. Only commits whose author email equals the repo's `user.email`, on local branches, no merges, for projects in the *open workspace folders* matched by project key (the interval log stores no folder paths, so other projects show "—"); nothing runs in an untrusted workspace. `DashboardPanel` posts the model at once with cached numbers, loads in the background and posts again; the log, `NullActivityApi` and `ActivityService` are unchanged. **Badges** (`badgeModel.ts` + `badgeSvg.ts` pure: total time, average per active day and top language, flat shields-style SVG; `gistClient.ts` + `badgePublisher.ts` with injected deps and no `vscode`; `badgeCommands.ts` is the `vscode` glue): `null-activity.saveBadges` writes the three SVGs to a folder; `null-activity.publishBadges` publishes them to one secret Gist through null-accounts (`getToken(account, ['gist'], …)`, github.com accounts only) after a one-time consent modal, remembers `{ gistId, accountId, owner, hash }` in `globalState` (`null-activity.badge`) and copies the README Markdown. `null-activity.badge.autoPublish` (default off) only refreshes that Gist hourly with a silent token, skips unchanged content, and does nothing while `null-activity.enabled` is off. **WakaTime import** (`wakatimeImport.ts` pure: `convertExport` turns the wakatime.com export's heartbeats into intervals using the export's own `user.timeout`, 15 min when absent; `languageMap.ts` pure name table; `wakatimeProjects.ts` matches each project to a local git repo through `projectIdentity.repoRoot`, else keeps the WakaTime name; `importCommand.ts` is the `vscode` glue): `null-activity.importWakaTime` writes `intervals-YYYY-MM-import-wakatime.jsonl` through `IntervalStore.replaceWindow` via the internal `ActivityService.replaceImported` (not on `NullActivityApi`), so re-importing replaces the previous import and `deleteRange` / `deleteAll` cover it. All categories count; imported lines are 0. Passing a file URI to the command skips its dialogs (used by `import.spec.ts`). Designs: `docs/specs/null-activity-engine-design.md`, `docs/specs/null-activity-dashboard-design.md`, `docs/specs/null-activity-git-design.md`, `docs/specs/null-activity-badge-design.md`, `docs/specs/null-activity-wakatime-import-design.md`; plans: `docs/plans/null-activity-engine.md`, `docs/plans/null-activity-dashboard.md`, `docs/plans/null-activity-git.md`, `docs/plans/null-activity-badge.md`, `docs/plans/null-activity-wakatime-import.md`. Integration specs: `npm run test:integration` (via `/verify-local null-activity`).

### null-tools (`extensions/null-tools/`)
Written in TypeScript (`src/`). Activated on `onStartupFinished`. Provides:

| Feature | Details |
|---|---|
| **Project dashboard** | Custom editor (`null.dashboard`, `viewType`); opened on startup and via Help > Welcome (see `patches/003-*` and `004-*`); recent-project cards with async git status, New Project, Clone Repo |
| **GitHub Issues panel** | Activity-bar view (`null-issues`), a full-width tab (`null.issues.openFullView`) and one tab per issue; GraphQL search, composer with per-issue drafts, image attach (committed to an orphan `null-issue-assets` branch, thumbnails cached in `.null/issue-images/`), *Copy as prompt*, and an "open this issue?" prompt when you switch to an `issue-<n>-…` branch. Signs in through null-accounts (`githubAuth.ts` → `githubSession.ts`); `null-tools` declares `extensionDependencies: ["null.null-accounts"]`. Webview code in `src/webview/` is compiled by separate `tsconfig.webview-*.json` projects into `lib/` |
| **Commit message generation** | `null.generateCommitMessage` (`Ctrl+Shift+Alt+G`) — runs `claude --print` with staged diff; sets SCM input box |
| **In-app updater** | Checks GitHub Releases on startup; shows status bar button; self-updates via PowerShell |
| **Discord Rich Presence** | `discordRpcClient.ts` (IPC pipe / WebSocket transport), `discordPresence.ts` (activity building), `presenceOwnership.ts` (one window publishes), `discordAppInfo.ts` (Developer Portal diagnostics). Configured via `null.discord.*`; `null.discord.testConnection` reports setup problems |

### null-cpp (`extensions/null-cpp/`)
Symbol-aware C/C++ header/source switching, auto-paired split editors with scroll sync, and `.hpp`/`.cpp` class scaffolding, layered on top of the (separately installed) `llvm-vs-code-extensions.vscode-clangd` extension. Activated on `onStartupFinished`; features gate on `null-cpp.isCppProject`, set by scanning for `CMakeLists.txt`, `compile_commands.json`, `.clangd`, or C/C++ source files (`null-cpp.projectDetection.override` can force this). `Alt+O` triggers symbol-aware header/source switching. See `docs/specs/null-cpp-extension-design.md`.

CMake/toolchain/build/debug orchestration on top of this (the "C++ development layer") is planned but not yet built — see `docs/ROADMAP.md` for the phased delivery plan and `docs/c++-development.md` for the original vision doc.

### null-actions (`extensions/null-actions/`)
Status-bar buttons that run shell commands (via a dedicated, deterministically-reused terminal per button — identity is keyed by button id, never by command text, so window reloads and folder reopens don't spawn duplicate terminals) or VS Code API commands. Configured through a settings panel opened via the `$(gear) Actions` status bar item or the `null-actions.openSettings` command (opens as a `WebviewPanel` in the main editor area, not a sidebar view), or directly via the `null-actions.buttons` setting. Supports variable substitution (`${workspaceFolder}`, `${file}`, `${selectedText}`, etc.), priority-ordered status bar placement, an Affinity-style canvas color picker for the button text color, and project-type-detection suggestions (`Cargo.toml`, `CMakeLists.txt`, `*.csproj`, or a one-click "Load npm scripts" button that writes each `package.json` script in as a real persisted button). See `docs/specs/null-actions-design.md`.

### null-accounts (`extensions/null-accounts/`)
GitHub/GitLab account manager (issue #102). Activated on `onStartupFinished`; exports `NullAccountsApi` (`getAccounts`, `getAccountForFolder`, `ensureAccountForFolder`, `getToken`, `onDidChange`) via `extensions.getExtension('null.null-accounts')?.exports`. Account metadata lives in `globalState`, secrets in `SecretStorage` under `null-accounts/<id>`; `Account.host` is a bare lowercase hostname. `getToken(account, scopes?, { interactive? })` is silent unless `interactive` is true. The GitHub provider wraps VS Code's built-in `github` session (`Account.externalId` is the session's account id; tokens stay with VS Code). GitLab accounts (gitlab.com and self-hosted) sign in through an OAuth device flow (`providers/gitlabOAuth.ts` protocol, `providers/gitlab.ts` provider): tokens live in `SecretStorage` as one JSON string, refresh is single-flight, and an account whose sign-in was refused is flagged "needs re-auth" (Accounts panel button + one-time notification). The OAuth application ID comes from `null-accounts.gitlab.clientId` (gitlab.com, shipped default) or `null-accounts.gitlab.hostClientIds` (self-hosted); both are application-scoped settings. Servers that disallow user OAuth apps use a personal access token instead ("GitLab with an access token…"): validated against `/user`, stored raw in `SecretStorage`, `authMethod: 'https'`, never refreshed. Binding a folder wires git (`gitPlan.ts` → `gitWiring.ts` for repo-local `user.name` (the account's optional `gitName`, else its username) / `user.email` / `credential.https://<host>.username` / `core.sshCommand`, `gitCredentials.ts` for the token in the OS credential store via `git credential approve|reject`): it reconciles against the bindings on every change, every refreshed token and every 5 minutes; unbinding restores the values it replaced; global git config is touched only by the Accounts panel's "Set as global git identity" button (`globalIdentity.ts`: `user.name` / `user.email`). SSH-key accounts (Add Account → "SSH key…", for servers such as a university GitLab; `sshAccount.ts`) have no token — `api.getToken` returns `undefined` for them — and are tested once with `ssh -T` when added (`sshCheck.ts`); a failed test warns but still saves. Folder→account bindings live in `globalState` (`projectBinding.ts`). One account can be the default (`null-accounts.defaultAccount`, a switch on its Accounts-panel card): `defaultAccount.ts` binds each open folder that has never had an account to the account matching its origin remote, else to the default — once per folder (`defaultAdopted`), so "use no account" sticks. Profile pictures (`avatars.ts`): fetched once per account from github.com (`/<user>.png`) or the account's GitLab host (`/api/v4/users?username=`), kept as small `data:` URIs in `globalState` (`null-accounts.avatars`) and used by the panel (CSP `img-src data:`), the Accounts menu and the activity-bar button; a missing picture falls back to the initial. The panel tab icon is `media/accounts-{light,dark}.svg`. The Accounts menu (activity-bar avatar) is published as the context key `null.accounts.menu` (`ui/accountsMenuController.ts`) and rendered by patch 007. SSH keys (design `docs/specs/null-accounts-ssh-keys-design.md`): any account may carry a private key (`sshKeyPath`; required for `ssh` accounts, which have no token), shown in the Accounts panel with its fingerprint (`sshKeyOps.ts`, `ui/keyActions.ts`, `ui/keyInfo.ts`). Null IDE generates passphrase-less ed25519 keys under `~/.ssh/null-accounts/` (`generateKey`; only keys inside that folder are ever deleted — `isManagedKey`), uploads the public key through the account's token (`keyUpload.ts`: GitHub `write:public_key` + `write:ssh_signing_key`, GitLab `api`; a token-less account copies it and opens the server's key page instead), and `signCommits` writes `gpg.format=ssh` / `user.signingkey` (the private key path) / `commit.gpgsign` into the repo after `canSign` proves the key signs with no prompt. There is no ssh-agent or passphrase support. So that plain `git clone` and other tools find the key too, `sshConfig.ts` keeps `~/.ssh/null-accounts/config` (one `Host` block per hostname, `IdentitiesOnly yes`) in line with the accounts and adds a single marked `Include null-accounts/config` line at the top of `~/.ssh/config` (removed again when no account has a key). Integration spec `signing.spec.ts` makes a real signed commit. Designs: `docs/specs/null-accounts-design.md`, `docs/specs/null-accounts-menu-design.md`; phase plans: `docs/plans/null-accounts-phase*.md`.

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
- `005-claude-code-command-center-button.patch` — restores the icon and chevron on the command-center Claude split button
- `006-settings-toc-split-extensions.patch` — splits the Settings editor's Extensions node into Null / Installed Extensions / Built-in Extensions sections
- `007-accounts-menu-null-accounts.patch` — the Accounts menu lists null-accounts' accounts (read from the `null.accounts.menu` context key, each row with its round `data:` picture or provider glyph, the host dimmed after the name, and a "Project: <folder>" heading) and drops VS Code's provider-session and Settings Sync / Copilot / Edit Sessions / tunnel rows; the activity-bar Accounts button shows the picture under `null.accounts.avatar`

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
- Full builds normally run in GitHub Actions, not locally. `scripts/build-local.ps1` is the exception: it mirrors the `build-windows` job for iterating on `build.yml`, `shell-ext/`, `installer/`, or the VSCodium/VS Code patch/merge steps — things `scripts/sync-local.ps1` can't reach. Don't run it without being asked; it takes tens of minutes and needs Node, Rust, CMake, VS2022, and Inno Setup 6 installed (see the script's header for the full list).
- Iterate locally with `scripts/sync-local.ps1` (pushes compiled extensions + workbench assets into an installed Null IDE), then `scripts/reload-local.ps1` — `Developer: Reload Window` still serves cached `null-custom.css` / `null-splash.js`. The `/verify-local` skill chains both with the integration specs.
- Do not set the Microsoft extension gallery env var silently; document it in the README only.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

# Configuration

Null IDE uses the normal VS Code settings UI (`Ctrl+,`) and `settings.json`. User data lives in `%APPDATA%\Null`. Settings from the sections below appear under their own headings in the Settings editor, with Null's extensions grouped apart from installed ones.

Settings that are listed here are only the ones worth knowing; search the Settings editor for `null` for the full set.

## Updates

| Setting | Default | Meaning |
|---|---|---|
| `null.updates.check` | `true` | Check for a new release when the IDE starts. **Null: Check for Updates** always works. |

Extension updates follow the standard `extensions.autoCheckUpdates` and `extensions.autoUpdate` settings.

## Formatting

A project's own config file always wins. The `defaultConfig` settings apply only when none is found.

| Setting | Default | Meaning |
|---|---|---|
| `null-format.prettier.enable` | `true` | Prettier for JS, TS, JSON, CSS, HTML, YAML, Markdown |
| `null-format.prettier.configPath` | empty | Explicit Prettier config file |
| `null-format.prettier.defaultConfig` | object | Fallback Prettier options |
| `null-format.clangFormat.enable` / `.path` / `.configPath` / `.defaultConfig` | on / auto | clang-format for C, C++, CUDA |
| `null-format.rustfmt.enable` / `.path` / `.configPath` / `.defaultConfig` | on / auto | rustfmt for Rust (TOML fallback config) |

## C/C++

| Setting | Default | Meaning |
|---|---|---|
| `null-cpp.projectDetection.override` | `auto` | Force null-cpp features on or off for a workspace |
| `null-cpp.autoPairSplit.enabled` | `true` | Open the header/source counterpart beside a C/C++ file |
| `null-cpp.scrollSync.enabled` | `true` | Sync scrolling between paired editors |
| `null-cpp.pairedSplit.autoCloseCounterpart` | `false` | Closing one half closes the other |
| `null-cpp.toolbar.enabled` | `true` | CMake build/run/debug status-bar buttons |
| `null-cpp.compile.clangArgs` | `-std=c++20 -Wall -Wextra` | Arguments for single-file compiles |
| `null-cpp.compile.clangPath` | empty | clang++ path; empty means detect on `PATH` |
| `null-cpp.scaffold.showInExplorer` | `true` | **New C++ Class...** in the Explorer menu |

## Git, commits and projects

| Setting | Default | Meaning |
|---|---|---|
| `null.commitMessage.useClaude` | `true` | Generate messages with the Claude CLI; off builds a basic message from the diff |
| `null.commitMessage.validation` | `warn` | Check messages against Conventional Commits |
| `null.recentProjects.maxItems` | `20` | Unpinned projects kept in the launcher |
| `null.gitignore.autoUpdate` / `.autoCommit` | `true` | Auto-scan for build artifacts, and commit the `.gitignore` change |
| `null.worktrees.copyFilesGlob` | `[]` | Untracked setup files (such as `.env`) to copy into a new worktree |
| `null.ports.refreshInterval` | `5` | Seconds between port scans; `0` turns scanning off |
| `null.ports.filterDevOnly` | `true` | Show only recognised dev servers |

## Desktop widgets

| Setting | Default | Meaning |
|---|---|---|
| `null.widgets.enabled` | `false` | Write the widgets' data file while the IDE runs. Off deletes it. Set by **Null: Set Up Widgets**. |
| `null.widgets.repos` | `[]` | Repositories (and the account they were picked under) whose issues and pull requests are shown. Private titles appear on the desktop. |

## Claude Code helpers

| Setting | Default | Meaning |
|---|---|---|
| `null.claude.followAlong` | `false` | Reveal each file Claude Code edits |
| `null.claude.followAlongSplitView` | `false` | Open those files in the second editor pane |
| `null.recovery.enabled` | `true` | Offer to reopen Claude Code conversations after a crash |
| `null.plans.autoOpen` | `false` | Open new Claude Code plan files as Markdown preview |

## Discord Rich Presence

Needs `null.discord.clientId` (the Application ID from the Discord Developer Portal).

| Setting | Default | Meaning |
|---|---|---|
| `null.discord.enabled` | `true` | Master switch |
| `null.discord.transport` | `auto` | `auto`, `ipc` or `websocket`; change it if presence fails to connect |
| `null.discord.privacyMode` | `false` | Hide file names and show a generic "Editing code" |
| `null.discord.showFileName` / `showWorkspace` / `showDebug` / `showRepositoryButton` | `true` | What the presence shows |
| `null.discord.idleTimeoutSec` | `300` | Seconds before the idle presence; `0` disables |

## Action buttons

`null-actions.buttons` is an array of status-bar buttons. Edit it in the Action Buttons panel or directly in `settings.json`.

## Activity, startup, sync, music

| Setting | Default | Meaning |
|---|---|---|
| `null-activity.enabled` | `true` | Collect local activity data; off stops collection immediately |
| `null-activity.idleTimeout` | `900` | Seconds without input before time stops counting |
| `null-activity.sessionGap` | `15` | Minutes of inactivity that end a session |
| `null-startup.enabled` / `.retention` / `.slowExtensionMs` | on / `20` / `100` | Startup reports kept, and the "slow" threshold |
| `null-sync.enabled` | `false` | Cross-device sync |
| `null-sync.categories` | all on | What this device syncs |
| `null-sync.excludedSettings` | path-like globs | Settings that stay on this device |
| `null-music.statusBar.*`, `null-music.notifications.showOnSongChange`, `null-music.local.supportedExtensions` | see UI | Player display and scanned file types |

## Starting defaults

The installer wizard and `product.json` seed a few settings on first run (theme, font, auto save, format on save, update check, menu bar). They are ordinary user settings afterwards; change them any time. **Null: Setup** reopens the wizard on Modify.

## Safe Mode

`null --safe-mode` (or Start Menu → Null IDE (Safe Mode)) starts with extensions disabled. See [Troubleshooting](Troubleshooting#the-ide-misbehaves-after-an-extension-change).

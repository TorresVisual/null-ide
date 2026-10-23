# Features

Everything below ships in the box as a built-in extension. For the extension list see [Extensions](Extensions); for the settings see [Configuration](Configuration).

## Look and feel

- **Null Dark** color theme (deep navy backgrounds, teal and indigo accents) and the **Null** file and folder icon theme, both on by default.
- Fonts: Geist Mono, JetBrains Mono, Cascadia Code.

## Projects and Git

| Feature | What it does |
|---|---|
| **Project dashboard** | Opens on startup as a recent-project launcher. Search, sort, pin and manage projects, with best-effort Git and project-type details. Also **New Project**, **Clone Repo**, **Open Folder**. Run **Null: Open Dashboard** any time. |
| **Project launcher** | Windows only. **More Recent Projects...** in the taskbar jump list opens a small picker with every tracked project (up to `null.recentProjects.maxItems`, plus all pinned), without touching a running Null window. Type to filter, `Up`/`Down` to move, `Enter` to open, `Ctrl+P` to pin or unpin, `Delete` to remove an unpinned entry, `Esc` to close. Missing folders are marked and cannot be opened. If WebView2 is missing, the jump list falls back to the dashboard. |
| **GitHub Issues** | Its own activity-bar view and a full-width tab, with github.com-style search and filters, an issue detail tab, issue creation and commenting. Sign in from the view (**Null: Sign in to GitHub**). |
| **Commit messages** | `Ctrl+Shift+Alt+G` generates a message from your staged diff. Uses the [`claude`](https://claude.com/claude-code) CLI, which you install separately. Messages can also be checked against Conventional Commits. |
| **Pull requests** | **Null: Show Pull Requests** lists the open pull requests of a github.com repository in the GitHub view. Open a PR to see its changed files in a diff, read and write review comments, resolve threads, check out the PR branch, and merge, close, reopen or mark it draft from the detail tab. Filter by state, your own PRs, review requests, drafts, label and milestone. Sign in first; not available in remote windows. |
| **GitHub Actions** | **Null: Show GitHub Actions** opens its own activity-bar view of a github.com repository's workflow runs, with jobs and steps under each run. Click a job or step to read its log in a tab; **Show Failure Log** jumps to the failing step, and `file:line` references in errors link to your files. Re-run, cancel, enable and run (dispatch) workflows from the context menu, and filter runs to the current branch, your own runs, failed runs only or one workflow. Runs refresh while any is in progress. The checks in a pull request tab link to their run and failure log. Sign in first; not available in remote windows. |
| **Commit graph** | **Null: Open Commit Graph**, with checkout, branch, cherry-pick, revert, reset and **Null: Pull** from the toolbar and context menu. |
| **Git worktrees** | Create (including one per issue), open in a new window, merge back, prune. |
| **Accounts** | GitHub, GitLab and SSH identities. Bind a folder to an account and its repo-local Git config, credentials and SSH keys are wired up. Tokens live in SecretStorage, never in settings. |
| **Auto-gitignore** | **Null: Auto-Scan & Update .gitignore** adds build artifacts it finds. |

## Writing code

| Feature | What it does |
|---|---|
| **Formatting** | Prettier (in-process), rustfmt and clang-format. A project's own `.prettierrc`, `rustfmt.toml` or `.clang-format` always wins over the built-in defaults. |
| **C/C++** | `Alt+O` switches header/source by symbol. Paired split editors, **New C++ Class...** scaffolding, and a CMake/Make toolbar. Layered on the separately installed clangd extension. |
| **Markdown** | Live-preview Markdown Editor is the default view of `.md` files. Preview supports GFM, Mermaid, KaTeX and GitHub alerts. `Ctrl+Shift+V` opens the preview, `Ctrl+Shift+Alt+P` exports PDF, `Ctrl+Shift+Alt+S` opens slides. |
| **Spell checking** | Bundled Code Spell Checker. |
| **Action buttons** | Status-bar buttons that run a shell command or a VS Code command. **Null Actions: Open Settings** opens a panel to add, reorder and edit them; unsaved changes are marked in the panel title. |
| **Color picker** | Color pickers in the editor (hover on a color, **Show or Focus Standalone Color Picker**) use a hue ring with a saturation/lightness triangle instead of the stock square and strip. The opacity strip is unchanged. |
| **Scratch files and notes** | **Null: New Scratch File**, **Null: New Note**, **Null: Run Scratch File**. |
| **Ports** | A panel of listening dev-server ports, with open in browser, copy URL and kill process. |
| **Environment check** | Finds missing companion extensions and CLI tools per project and fixes them in one click. |

## Around the editor

| Feature | What it does |
|---|---|
| **Explorer integration** | `null .` in any terminal, and **Open in Null** in the Windows 11 Explorer context menu (Windows only). |
| **Desktop widgets** | Projects, Issues and Pull Requests as borderless cards on the Windows desktop. Opt in with **Null: Set Up Widgets** (pick an account and repositories), or tick **Desktop widgets** in the installer to start them at login. The IDE writes the data to `%LOCALAPPDATA%Nullwidgetssnapshot.json` and `null_widgets.exe` only reads it; click a row to open it, drag to move, right-click for Refresh, Lock and Hide. **Null: Refresh Widgets** refreshes now. Private issue and pull request titles appear on the desktop. Windows only; tested on Windows 11. |
| **Self-update** | Checks GitHub Releases on startup and updates without elevation. On Linux the status-bar button opens the release page instead. |
| **Safe Mode** | `null --safe-mode` disables installed and Null-owned extensions without changing them. **Restart Normally** brings you back. Offered automatically after three failed starts in a row. |
| **Crash recovery** | After an unexpected exit, offers to reopen the Claude Code conversations that were open. |
| **Follow Along** | **Null: Toggle Follow Claude Code's Edits Live** reveals each file Claude Code edits. |
| **Discord Rich Presence** | Off until you give it a Discord application ID. File and workspace names can be hidden. |
| **Music player** | Local-file player with folders, playlists, search and a status-bar display. `Ctrl+Alt+Space` plays or pauses. |
| **Activity tracking** | Local-only coding time, projects, languages and sessions, with a dashboard. Nothing leaves your machine unless you publish a badge or enable sync yourself. |
| **Startup profiler** | Startup phases and extension activation times, with comparison between launches. |
| **Sync** | Encrypted sync of settings, keybindings, snippets and the extension list through one secret GitHub Gist. Off by default. **The passphrase cannot be recovered.** |
| **Remote development** | Remote - WSL and Remote - SSH are bundled. |

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Alt+O` | Switch header/source (C/C++) |
| `Ctrl+Shift+Alt+G` | Generate commit message |
| `Ctrl+Shift+V` / `Ctrl+K V` | Markdown preview |
| `Ctrl+Shift+Alt+P` | Export Markdown to PDF |
| `Ctrl+Shift+Alt+S` | Markdown slides |
| `Ctrl+Alt+Space`, `Ctrl+Alt+Left/Right` | Music: play/pause, previous, next |
| `Ctrl+Alt+Up/Down` | Music: volume |
| `Ctrl+Alt+L`, `Ctrl+Alt+M` | Music: like track, focus the player |
| `Ctrl+Shift+A` | New terminal with profile |

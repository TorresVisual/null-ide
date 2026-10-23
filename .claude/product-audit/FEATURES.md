# Feature Inventory

## Install & Configure

| Capability | Status | Location | Notes |
|---|---|---|---|
| Installer (null-setup wizard + portable ZIP) | Implemented | setup/ | per-user, no elevation |
| Package managers | Missing | — | winget #13 open; scoop/choco not planned |
| In-app updater | Implemented (Windows) | null-tools/src/updater.ts, setup/ | #120 closed; Linux build links to the release page instead |
| Explorer context menu (Win11) | Implemented | shell-ext/ | sparse APPX |
| File associations + preview handler | Implemented | setup/core/src/shell/ | |
| Import from VS Code/Cursor | Missing | — | #90 |
| Companion extension/toolchain check | Implemented | null-env | #89; no Python rule (#142) |
| Settings sync | Implemented | null-sync | #23; encrypted Gist, off by default |
| Workspace trust | Implemented (#97 closed) | product.json, null-tools | recheck if guards still inert |

## Workspace

| Capability | Status | Location | Notes |
|---|---|---|---|
| Project dashboard / recent projects | Implemented | null-tools/src/dashboard*.ts | keyboard-first launcher, search/grouping, account per card (2026-10 redesign); #83 |
| Jumplist recent projects | Implemented | patches/001 | |
| New project / clone | Implemented | dashboardActions.ts | |
| Scratch files & notes | Implemented | scratchNotes*.ts | |
| Project metadata (.null/) | Missing | — | #39 |
| Crash recovery / safe mode | Implemented | patch 009, null-tools | #17 #18 |
| Remote WSL/SSH | Implemented (unverified in CI build) | open-remote-* built-ins, REH tarball | #85 |

## Editing & Languages

| Capability | Status | Location | Notes |
|---|---|---|---|
| Formatting (Prettier/rustfmt/clang-format) | Implemented | null-format | |
| Spell check | Implemented | cspell built-in | |
| Markdown preview/PDF/slides | Implemented | null-markdown | |
| C/C++ navigation, header/source, scaffolding | Implemented | null-cpp | needs clangd ext |
| Rust language server | Recommended + env-checked | product.json, null-env | #91 debug synthesis open |
| Java | Missing | — | #134 |
| Python | Partial (recommended only) | product.json | no env check, no Pylance-free server, no run buttons: #142 |

## Build / Run / Test / Debug

| Capability | Status | Location | Notes |
|---|---|---|---|
| CMake/Make configure/build/run | Implemented | null-cpp | |
| Build diagnostics → Problems | Implemented | buildDiagnostics.ts | |
| C++ debug | Implemented | debugConfigSynth.ts | needs cpptools/CodeLLDB installed manually |
| Action buttons | Implemented | null-actions | #81 run state, #95 Problems matchers |
| Ports view | Implemented | portsTreeView.ts | #33 auto-open |
| Test explorer | Inherited (API) | — | #82/#93 not planned |
| Compiler Explorer | Missing | — | #86 |

## Git & Review

| Capability | Status | Location | Notes |
|---|---|---|---|
| Commit / branch / diff | Inherited | — | |
| AI commit message | Implemented | commitMessage.ts | #5 fallback |
| Hunk staging UI | Inherited (basic) | — | #7 |
| Commit graph / rebase / Null: Pull | Implemented | null-tools commit graph | #87 |
| Secret scan before commit | Missing | — | #34 |
| GitHub issues | Implemented | issuesPanel.ts | |
| Pull requests (list, review, merge, checks) | Implemented | null-tools | #92 #117 |
| GitHub Actions view, logs, dispatch | Implemented | null-tools | #132 |
| GitLab issues / MRs | Missing | — | accounts exist; pull-requests-design Phase 6 "later", no issue |
| Git accounts, per-folder identity, SSH keys, commit signing | Implemented | null-accounts | #102 |
| Git worktrees | Implemented | null-tools/src/worktrees*.ts | #88 closed |

## AI

| Capability | Status | Location | Notes |
|---|---|---|---|
| Claude Code extension | Inherited-by-install | — | only AI workflow; not recommended/bundled (#89 comment) |
| Claude command-center button | Implemented | patches/005 | #98 |
| Follow Claude's edits in editor | Implemented | null-tools/src/followAlong*.ts | #99 |
| Claude line provenance hover | Implemented | null-tools/src/whyIsThisHere*.ts | #100 |
| Continue button outside the extension | Implemented | null-tools | #111 |
| AI Agents panel / Ollama / sound / "Fix with AI" | Removed | — | e3301b1, #84; #41 not planned |

## Activity, Media & Settings (added 2026-10-11)

| Capability | Status | Location | Notes |
|---|---|---|---|
| Coding-time tracking, dashboard, git stats, badges, WakaTime import | Implemented | null-activity | #113 |
| Local music player | Implemented | null-music | #112 |
| Settings TOC split (Null / Installed / Built-in) | Implemented | patches/006 | #108 |
| Extension update checks on by default | Implemented | product.json | #110 |
| Markdown hybrid editor view | Implemented | null-markdown | #114; follow-ups #138-#140 |
| Wiki / user docs | Implemented | docs/wiki | #122 |
| Linux build (tar.gz + deb) | Implemented, x64 only | build.yml build-linux | #119; no Linux self-update |
| Startup profiler | Implemented | null-startup, patch 010 | #19 |
| Desktop widgets | Implemented (opt-in) | shell-ext/widgets, null-tools | #141 |

# Feature Inventory

## Install & Configure

| Capability | Status | Location | Notes |
|---|---|---|---|
| Installer (null-setup wizard + portable ZIP) | Implemented | setup/ | per-user, no elevation |
| Package managers (winget/scoop/choco) | Missing | — | #13 #14 #15 |
| In-app updater | Partial | null-tools/src/updater.ts, setup/ | native EXE, checksum, rollback; but check is startup-only and silent on failure (#120, #12) |
| Explorer context menu (Win11) | Implemented | shell-ext/ | sparse APPX |
| File associations + preview handler | Implemented | setup/core/src/shell/ | |
| Import from VS Code/Cursor | Missing | — | #90 |
| Companion extension/toolchain check | Missing | — | #89 |
| Settings sync | Missing | — | #23 |
| Workspace trust | Disabled | product.json | #97; makes `isTrusted` guards inert |

## Workspace

| Capability | Status | Location | Notes |
|---|---|---|---|
| Project dashboard / recent projects | Implemented | null-tools/src/dashboard*.ts | keyboard-first launcher, search/grouping, account per card (2026-10 redesign); #83 |
| Jumplist recent projects | Implemented | patches/001 | |
| New project / clone | Implemented | dashboardActions.ts | |
| Scratch files & notes | Implemented | scratchNotes*.ts | |
| Project metadata (.null/) | Missing | — | #39 |
| Crash recovery / safe mode | Inherited/Missing | — | #17 #18 |
| Remote WSL/SSH | Missing | — | #85 |

## Editing & Languages

| Capability | Status | Location | Notes |
|---|---|---|---|
| Formatting (Prettier/rustfmt/clang-format) | Implemented | null-format | |
| Spell check | Implemented | cspell built-in | |
| Markdown preview/PDF/slides | Implemented | null-markdown | |
| C/C++ navigation, header/source, scaffolding | Implemented | null-cpp | needs clangd ext |
| Rust language server | Missing (not bundled/recommended) | — | covered by toolchain-check candidate |
| Python | Inherited-by-install | product.json recommendations | |

## Build / Run / Test / Debug

| Capability | Status | Location | Notes |
|---|---|---|---|
| CMake/Make configure/build/run | Implemented | null-cpp | |
| Build diagnostics → Problems | Implemented | buildDiagnostics.ts | |
| C++ debug | Implemented | debugConfigSynth.ts | needs cpptools/CodeLLDB installed manually |
| Action buttons | Implemented | null-actions | #81 run state |
| Ports view | Implemented | portsTreeView.ts | #33 auto-open |
| Test explorer | Inherited (API) | — | CTest #82 |
| Compiler Explorer | Missing | — | #86 |

## Git & Review

| Capability | Status | Location | Notes |
|---|---|---|---|
| Commit / branch / diff | Inherited | — | |
| AI commit message | Implemented | commitMessage.ts | #5 fallback |
| Hunk staging UI | Inherited (basic) | — | #7 |
| Commit graph / rebase | Missing | — | #87 |
| Secret scan before commit | Missing | — | #34 |
| GitHub issues | Implemented | issuesPanel.ts | |
| Pull requests (list/review) | Missing | — | #92 (first slice) / #117 (umbrella) |
| GitLab issues / MRs | Missing | — | accounts exist (null-accounts), no panel; noted in #117 comment |
| Git accounts, per-folder identity, SSH keys, commit signing | Implemented | null-accounts | #102 |
| Git worktrees | Implemented | null-tools/src/worktrees*.ts | #88 closed |

## AI

| Capability | Status | Location | Notes |
|---|---|---|---|
| Claude Code extension | Inherited-by-install | — | only AI workflow; not recommended/bundled (#89 comment) |
| Claude command-center button | Implemented | patches/005 | #98 |
| Follow Claude's edits in editor | Implemented | null-tools/src/followAlong*.ts | #99 |
| Claude line provenance hover | Implemented | null-tools/src/whyIsThisHere*.ts | #100 |
| Continue button outside the extension | Missing | — | #111 |
| AI Agents panel / Ollama / sound / "Fix with AI" | Removed | — | e3301b1, #84; #41 not planned |

## Activity, Media & Settings (added 2026-10-11)

| Capability | Status | Location | Notes |
|---|---|---|---|
| Coding-time tracking, dashboard, git stats, badges, WakaTime import | Implemented | null-activity | #113 |
| Local music player | Implemented | null-music | #112 |
| Settings TOC split (Null / Installed / Built-in) | Implemented | patches/006 | #108 |
| Extension update checks on by default | Implemented | product.json | #110 |
| Markdown hybrid editor view | Missing | — | #114 |
| Wiki / user docs | Missing | — | #122 |
| Linux build | Missing | — | #119 (revived after #28 was closed) |

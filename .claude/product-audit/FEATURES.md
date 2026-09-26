# Feature Inventory

## Install & Configure

| Capability | Status | Location | Notes |
|---|---|---|---|
| Installer (Inno + portable ZIP) | Implemented | installer/, scripts/install-null-ide.ps1 | per-user, no elevation |
| Package managers (winget/scoop/choco) | Missing | — | #13 #14 #15 |
| In-app updater | Implemented | null-tools/src/updater.ts, updater/src/main.cpp | native EXE, checksum, rollback, retry UX — see ARCHITECTURE.md; #12 likely stale, commented |
| Explorer context menu (Win11) | Implemented | shell-ext/ | sparse APPX |
| File associations + preview handler | Implemented | install-null-ide.ps1 | |
| Import from VS Code/Cursor | Missing | — | #90 |
| Companion extension/toolchain check | Missing | — | #89 |
| Settings sync | Missing | — | #23 |
| Workspace trust | Disabled | product.json | deliberate; security candidate |

## Workspace

| Capability | Status | Location | Notes |
|---|---|---|---|
| Project dashboard / recent projects | Implemented | null-tools/src/dashboard*.ts | git status per card; #83 |
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
| Worktrees | Missing | — | #88 |
| Secret scan before commit | Missing | — | #34 |
| GitHub issues | Implemented | issuesPanel.ts | |
| Pull requests (list/review) | Missing | — | #92 |

## AI

| Capability | Status | Location | Notes |
|---|---|---|---|
| Claude Code extension | Inherited-by-install | — | only AI workflow; not recommended/bundled (#89 comment) |
| Claude command-center button | Missing | — | #98 (core patch) |
| Follow Claude's edits in editor | Missing | — | #99 |
| Claude line provenance hover | Missing | — | #100 |
| AI Agents panel / Ollama / sound / "Fix with AI" | Removed | — | e3301b1, #84; #41 not planned |

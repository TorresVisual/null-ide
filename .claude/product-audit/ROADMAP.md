# Product Opportunities

## Foundation

### Environment check: companion extensions + toolchains per project
Status: issue created
Issue: #89
Why: null-cpp needs clangd/cpptools/CodeLLDB but no longer declares them
(1f7c00b); fresh installs fail at Debug with no guidance. Rust has no LSP path.
2026-09-26: scope comment added — also the Claude Code extension (only AI
workflow, prerequisite of #98–#100, not in extensionRecommendations) and the
`claude` CLI that commit-message generation shells out to.

### Import settings/keybindings/snippets/extensions from VS Code / Cursor
Status: issue created
Issue: #90
Why: installer only seeds defaults; migration is the main acquisition path.

### Workspace trust hardening
Status: issue created (#97)
Why: null-tools' `disableRestrictedMode()` re-disables trust on every
activation, overriding a user's explicit opt-in; Clone Repo + `runOn:
folderOpen` tasks run untrusted code on open.

### Package managers / updater
Status: winget/scoop/choco issues exist (#13–#15). Updater itself (#12) is
likely already fixed by the native-EXE rewrite — see ARCHITECTURE.md
"Updater" section; commented on #12 2026-09-25, not closed pending a
real-install smoke test.

## Core IDE

### Project metadata as source of truth
Status: issue exists (#39)

### Remote WSL/SSH
Status: issue exists (#85)

## Developer Workflow

### Pull requests in GitHub panel (list, checkout, review diff, comment)
Status: issue created (#92)

### Test explorer for non-C++ (cargo test, npm test)
Status: issue created (#93); CTest itself is #82.

### Rust run/debug (cargo + CodeLLDB) parity with null-cpp
Status: issue created (#91)

### Git: graph #87, worktrees #88, hunk staging #7, secret scan #34
Status: issues exist

### New Project templates wired to existing scaffolders
Status: issue created (#94)
Why: dashboard New Project = empty dir + git init; null-cpp scaffolders and
autoGitignore exist but are disconnected from it.

### Build output → Problems for non-C++ action buttons
Status: issue created (#95)
Why: buttons use sendText, so cargo/tsc/eslint errors never reach Problems.

### CI status (GitHub Actions) for HEAD
Status: issue created (#96)
Why: Commit → Push → CI loop leaves the IDE.

## Advanced

### Editor-first Claude Code integration
Status: issues exist (#98 command-center button, #99 follow edits live,
#100 line provenance hover), filed by the maintainer 2026-09-26.
Why: replaces the removed AI Agents panel / #41. Don't propose a native
agent UI or panel again; new AI items should sit on top of the extension
(transcripts, URI handler `vscode://anthropic.claude-code/open?session=`).

### Compiler Explorer (#86), process panel (#37)
Status: issues exist

## Polish

### Floating terminal #11
Status: issue exists (#10 distraction-free and #29 explorer redesign closed
by the maintainer 2026-09-25)

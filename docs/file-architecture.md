# File Architecture Proposal

**Status:** PROPOSAL — not yet approved, nothing has been changed.

## Stack

Windows desktop app built as a VSCodium/VS Code fork:
- **TypeScript, multi-extension monorepo** — seven built-in extensions under `extensions/`, each its own VS Code extension (`package.json` + `src/` + compiled `out/`), following the standard VS Code extension layout.
- **Native C++** — `shell-ext/` is a CMake + MSVC project (Win11 `IExplorerCommand` COM DLL).
- **PowerShell + Node build/release tooling** — `scripts/`, plus a GitHub Actions pipeline (`.github/workflows/build.yml`) that is the only place full builds run.

The relevant conventions this proposal reasons from: VS Code extensions keep `src/` flat with one file per feature/provider and colocated `*.test.ts` files (already the norm here); repo-root should hold only top-level config and entry points, with dev/release tooling living in `scripts/`; and — this repo's own established idiom — `null-tools` already splits several features into a `<feature>.ts` (logic) + `<feature>Integration.ts` (activation wiring) pair (`autoGitignore(Storage)?.ts`, `discordPresence.ts` + `discordPresenceIntegration.ts`, `portsIntegration.ts`, `recentProjects.ts` + `recentProjectsIntegration.ts`, `scratchNotes*.ts` + `scratchNotesIntegration.ts`).

## Current structure

```
extensions/
  null-icons/src/icons/...   286 files, flat asset tree — fine for an icon theme, not touched
  null-cpp/src/*.ts          25 files, flat, well-sized (largest is 357 lines) — not touched
  null-actions/src/*.ts      flat, well-sized, has its own webview/ and test/ subfolders — not touched
  wooting-analog/            small, well-scoped — not touched
  null-tools/src/extension.ts   1653 lines — see Change 1 below
scripts/                     documented in CLAUDE.md; already has sync-local.ps1, install/update scripts, icon/json tooling
rcedit-tool/                 root-level, one-package npm project, only referenced (commented out) from copy.ps1
shell-ext-build/             65 files — CMake build output (CMakeCache.txt, .vcxproj, CMakeFiles/, Release/, x64/)
appx-validate-stage/         4 files — staged AppxManifest.xml + Assets/*.png
test-new.appx                root-level binary APPX package
test.md                      root-level markdown exercising every null-markdown feature (task lists, KaTeX, Mermaid, alerts, footnotes, emoji)
copy.ps1                     root-level, 262-line local-install sync script
push-tag.ps1 / repush-tag.ps1  root-level release-tagging helpers
```

Two things stood out while reading, not just listing:

1. **`.gitignore` already says `shell-ext-build/` should never be committed** ("Build inputs cloned by CI — never commit"), but 65 files under it are tracked anyway — added in the `feat: identity branding` commit and touched again by a commit literally titled `gh`. `appx-validate-stage/` (same commit) and `test-new.appx` / `test.md` (a later, separate commit) are the same pattern: build/manual-test output that ended up in a real commit and was never cleaned up. Together these are ~70 files — about 9% of the repo's tracked files — that are pure noise for anyone reading the tree, and they contradict the project's own stated intent.
2. **`extension.ts` in `null-tools` is 1653 lines** and is the only file in the whole repo anywhere near that size. Everything else — including other large single-purpose files like `discordPresence.ts` (786 lines) — is one coherent subsystem. `extension.ts` is not: it contains the commit-message generator, the entire self-update flow (version checks, GitHub release polling, staging and spawning the detached PowerShell updater), the AI Agents webview panel (terminal management, node-pty wiring, scrollback persistence — 600+ lines in one class), a sound manager, a code-actions provider, and the welcome page, all before `activate()` even starts. The codebase already knows how to avoid this — five other features in the same directory follow a `<feature>.ts` + `<feature>Integration.ts` split — these six just never got the same treatment.

## Proposed structure

```
extensions/null-tools/src/
  extension.ts                 activate()/deactivate() + thin command registration only
  commitMessage.ts             getStagedDiff, runClaude
  updater.ts                   version/install-dir helpers, checkForUpdate, promptForUpdate, installUpdate
  updaterIntegration.ts        wiring: status bar item, startup check, command registration
  agentsPanel.ts               AgentBeforeProvider, AgentFileWatcher, AgentsViewProvider
  agentsPanelIntegration.ts    wiring: view registration, command registration
  soundManager.ts              SoundManager
  codeActions.ts               NullCodeActionsProvider
  welcomePage.ts                showWelcomePage

scripts/
  sync-local.ps1                <- absorbs copy.ps1's icon/product.json/exe-icon steps as opt-in flags
  push-tag.ps1                  <- moved from root
  repush-tag.ps1                <- moved from root
  rcedit-tool/                  <- moved from root rcedit-tool/

extensions/null-markdown/fixtures/
  preview-smoke-test.md         <- moved from root test.md

(deleted / untracked, already covered by .gitignore or a new rule)
  shell-ext-build/
  appx-validate-stage/
  test-new.appx
  copy.ps1                      <- deleted once its steps are merged into scripts/sync-local.ps1
```

## Changes and why

### 1. Stop tracking build/manual-test artifacts (`shell-ext-build/`, `appx-validate-stage/`, `test-new.appx`)
- **What:** `git rm -r --cached shell-ext-build/ appx-validate-stage/` and `git rm --cached test-new.appx`; add `appx-validate-stage/` to `.gitignore` (a rule for `shell-ext-build/` already exists but was bypassed).
- **Why:** A repo's tracked tree is implicitly "this is source, read it to understand the project." Build output and one-off validation artifacts that got swept into a commit violate that — they're the largest single group of files in the repo outside the extensions themselves, and the project's own `.gitignore` already agrees they don't belong. This isn't a style preference, it's fixing a contradiction between stated intent and actual state.
- **Files affected:** ~70 files removed from tracking (kept on disk, just untracked).

### 2. Split `null-tools/src/extension.ts` along the codebase's existing feature/Integration pattern
- **What:** Extract the updater subsystem, the AI Agents panel, the sound manager, the code-actions provider, the welcome page, and commit-message generation into their own files, following the exact `<feature>.ts` + `<feature>Integration.ts` split already used for `autoGitignore`, `discordPresence`, `ports`, `recentProjects`, and `scratchNotes` in the same directory.
- **Why:** This is Single Responsibility Principle at the file level — "more than one reason to change." Today, a bug in the self-update flow and a bug in the agents terminal panel both mean editing the same 1653-line file, and `git blame`/diff review on either has to wade through the other five features to find the relevant hunk. Using the pattern already established in the same folder (rather than inventing a new one) means this isn't a new convention to learn — it's applying the one the codebase already taught itself.
- **Files affected:** `extensions/null-tools/src/extension.ts` (shrinks to activation wiring only) plus 8 new files carved out of it.

### 3. Merge `copy.ps1` into `scripts/sync-local.ps1`, colocate remaining tooling into `scripts/`
- **What:** Fold `copy.ps1`'s extra steps (win32 icon stamping, `VisualElementsManifest`, `product.json` merge, and the commented-out `.exe` icon stamp via `rcedit-tool/`) into `scripts/sync-local.ps1` as opt-in flags (e.g. `-Full` or individual `-Icons`/`-ProductJson`/`-ExeIcon` switches), so there's one script with one set of behaviors instead of two overlapping ones. Delete `copy.ps1` once its behavior is absorbed. Move `push-tag.ps1`, `repush-tag.ps1`, and `rcedit-tool/` into `scripts/`.
- **Why:** Resolved with the user: `copy.ps1`'s extra steps are still needed, but there's no reason for them to live in a second, undocumented, root-level script that silently drifts from `sync-local.ps1` over time. One script with flags keeps the `verify-local` skill's default fast path unchanged while still exposing the fuller sync as an explicit, discoverable option. `scripts/` is also the documented home for this tooling (CLAUDE.md's repo layout table) — root should hold only true repo-level files (`CLAUDE.md`, `README.md`, `product.json`, `VSCODIUM_TAG`, `build.sh`).
- **Files affected:** `scripts/sync-local.ps1` (gains flag-gated steps), `copy.ps1` (deleted), `push-tag.ps1` / `repush-tag.ps1` / `rcedit-tool/` (moved into `scripts/`); `rcedit-tool/`'s relative path reference needs updating for its new location.

### 4. Move `test.md` into `extensions/null-markdown/` as a fixture
- **What:** `git mv test.md extensions/null-markdown/fixtures/preview-smoke-test.md` (or similar).
- **Why:** Its content — task lists, KaTeX, Mermaid, GitHub alerts, footnotes, emoji — maps exactly to `null-markdown`'s feature list (per CLAUDE.md). This is a manual verification fixture for that extension that landed at repo root instead of inside it. Unlike the artifacts in Change 1, this file has real ongoing value; it just belongs next to the feature it exercises, not floating at root looking like stray scratch output.
- **Files affected:** 1 file moved; nothing references it by path today (grep turned up no hits), so no reference fixes needed.

## Considered and deferred

- **`extensions/null-icons/src/` (286 files) and `icons/file-assoc/`, `icons/ipc/`** — large but flat, single-purpose asset directories. This is the expected, idiomatic shape for an icon theme; splitting further would add navigation overhead for no benefit. Not touched.
- **`discordPresence.ts` (786 lines), `discordRpcClient.ts` (593 lines), `webview/agents.ts` (727 lines)** — large, but each is one coherent subsystem (Discord activity building, Discord IPC transport, the agents webview's client-side JS respectively). Size alone isn't the smell the skill cares about; mixed responsibility is, and these don't have it. Not touched.
- **`patches/` containing 2 patches while CLAUDE.md says "currently empty"** — real, but it's a documentation-staleness issue (a job for `sync-agent-docs`), not a file-architecture issue. Flagging it here so it doesn't get lost, not folding it into this proposal.

---
Review this proposal. Reply with feedback to revise it, or approve it to move to the execution plan.

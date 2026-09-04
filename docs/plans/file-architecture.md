# File Architecture Execution Plan

**Status:** PLAN — not yet executed.
Source: docs/file-architecture.md

Verify commands use `npm --prefix extensions/null-tools run compile` (plain `tsc`, the same command `scripts/sync-local.ps1` and `setup.ps1` already run locally) — this is ordinary local type-checking, not the prohibited full CI/VSCodium build.

## Step 1: Stop tracking build/manual-test artifacts
- `git rm -r --cached shell-ext-build/`
- `git rm -r --cached appx-validate-stage/`
- `git rm --cached test-new.appx`
- Add `appx-validate-stage/` to `.gitignore` (a `shell-ext-build/` rule already exists — this closes the same gap for the other artifact directory)
- Reference updates needed: none — grep confirms nothing in `.github/workflows/build.yml`, `scripts/`, or docs references these paths by name.
- Verify: `git status` shows the three paths as untracked (not staged-for-delete-then-gone — files stay on disk); `git ls-files | grep -E 'shell-ext-build|appx-validate-stage|test-new.appx'` returns nothing.

## Step 2: Move `test.md` into `extensions/null-markdown/` as a fixture
- `git mv test.md extensions/null-markdown/fixtures/preview-smoke-test.md`
- Reference updates needed: none — grep confirms nothing references `test.md` by path.
- Verify: `git ls-files | grep test.md` shows only the new path; open the file in Null IDE's markdown preview to confirm it still renders (task lists, KaTeX, Mermaid, alerts, footnotes, emoji) — this is a manual check since it's a preview fixture, not something `tsc` covers.

## Step 3: Extract shared webview helper (`webviewUtils.ts`)
- Create `extensions/null-tools/src/webviewUtils.ts` containing `getNonce()` (currently `extension.ts:141`), exported.
- Remove `getNonce()` from `extension.ts`; keep both current call sites (`AgentsViewProvider`, `showWelcomePage`) working by importing from the new file for now (both still live in `extension.ts` at this point — this step only moves the helper, Steps 4 and 9 move its callers).
- Reference updates needed: `extension.ts` gains `import { getNonce } from './webviewUtils'`.
- Verify: `npm --prefix extensions/null-tools run compile`

## Step 4: Extract `agentsPanel.ts` + `agentsPanelIntegration.ts`
- Create `extensions/null-tools/src/agentsPanel.ts` containing `AgentBeforeProvider`, `AgentFileWatcher`, `AgentsViewProvider` (`extension.ts:423-1163`) and `loadNodePty()` (`extension.ts:149`, its only call site is inside `activate()` to construct the provider — moves here since it's now local setup for this feature). Export `AgentsViewProvider` (needed by Steps 5 and 6) and a registration entry point.
- Create `extensions/null-tools/src/agentsPanelIntegration.ts` containing the view registration and the agent-panel-related command registrations currently inline in `activate()` (`null.acceptProposedDiff`, `null.rejectProposedDiff`, `null.agentsPaste`, the webview-cache-clear command, prompt-template/inject-context commands — check each against what `AgentsViewProvider` actually owns before moving), following the same shape as `registerDiscordPresenceFeature` / `registerPortsFeature` in the same directory.
- `extension.ts`'s `activate()` calls the new registration function instead of constructing `AgentsViewProvider` inline.
- Reference updates needed: `webviewUtils.ts` import for `getNonce`; `extension.ts` imports the new registration function.
- Verify: `npm --prefix extensions/null-tools run compile`

## Step 5: Extract `soundManager.ts`
- Create `extensions/null-tools/src/soundManager.ts` containing `SoundManager` (`extension.ts:1165-1185`), importing `AgentsViewProvider` from `./agentsPanel`.
- `extension.ts` imports `SoundManager` from the new file; the `null.toggleSoundDesign` command registration stays in `extension.ts` (or moves to `agentsPanelIntegration.ts` if that reads more naturally once Step 4 is done — decide at execution time, it's a one-line call either way).
- Verify: `npm --prefix extensions/null-tools run compile`

## Step 6: Extract `codeActions.ts`
- Create `extensions/null-tools/src/codeActions.ts` containing `NullCodeActionsProvider` (`extension.ts:1189-1207`), importing `AgentsViewProvider` from `./agentsPanel`.
- `extension.ts` imports it for the `vscode.languages.registerCodeActionsProvider` call in `activate()`.
- Verify: `npm --prefix extensions/null-tools run compile`

## Step 7: Extract `commitMessage.ts`
- Create `extensions/null-tools/src/commitMessage.ts` containing `getStagedDiff()` and `runClaude()` (`extension.ts:107-138`).
- `extension.ts` imports both for the `null.generateCommitMessage` command registration.
- Verify: `npm --prefix extensions/null-tools run compile`

## Step 8: Extract `updater.ts` + `updaterIntegration.ts`
- Create `extensions/null-tools/src/updater.ts` containing the `InstallMetadata`/version-check interfaces, `UPDATE_REPO`, `UPDATE_CHECK_INTERVAL_MS`, the shared `output` channel, and every updater function (`getInstallDirCandidates` through `installUpdate`, `extension.ts:149-416` minus `loadNodePty` which Step 4 already claimed).
- Create `extensions/null-tools/src/updaterIntegration.ts` containing the startup check call and the `null.checkForUpdates` / `null.installUpdate` command registrations currently inline in `activate()`.
- `extension.ts` imports the registration function only.
- Reference updates needed: none outside this file — confirmed `output`/`UPDATE_REPO`/`UPDATE_CHECK_INTERVAL_MS` have no external readers (grep results above).
- Verify: `npm --prefix extensions/null-tools run compile`. Given this is the self-update code path (staging and launching a detached PowerShell process) — the same surface the `security-reviewer` agent watches — also run that agent against the diff for this step before moving on, since a refactor here is exactly the kind of change it's meant to catch.

## Step 9: Extract `welcomePage.ts`
- Create `extensions/null-tools/src/welcomePage.ts` containing `showWelcomePage()` (`extension.ts:1211-1301`), importing `getNonce` from `./webviewUtils`.
- `extension.ts` imports it for the `null.showWelcome` command registration.
- Verify: `npm --prefix extensions/null-tools run compile`

## Step 10: Final tidy of `extension.ts`
- Confirm what remains is: imports, `disableRestrictedMode()`, `ensureWindowTitleFormat()` (small standalone settings helpers — leave in `extension.ts`, they're not big enough to warrant their own file), `activate()`, `deactivate()`.
- Remove now-unused imports (`https`, `execSync` if no longer referenced directly, etc.).
- Verify: `npm --prefix extensions/null-tools run compile`; `wc -l extensions/null-tools/src/extension.ts` to confirm the size dropped from 1653 lines to roughly 250-350.

## Step 11: Merge `copy.ps1` into `scripts/sync-local.ps1`
- Add opt-in switches to `scripts/sync-local.ps1` (e.g. `-Full`, or separate `-Icons` / `-ProductJson` / `-ExeIcon`) covering `copy.ps1`'s extra steps: win32 icon stamping, `VisualElementsManifest` copy, `product.json` merge (reuse `scripts/merge-json.js`, which `copy.ps1` currently reimplements inline in PowerShell — worth using the existing script instead of duplicating the merge logic), and the commented-out `.exe` icon stamp via `rcedit-tool/`.
- Update the script's header comment (it currently says "Does NOT touch shell-ext/, product.json, or icons" — that's no longer true when the new flags are passed).
- `git rm copy.ps1`.
- Reference updates needed: none found — grep confirms nothing else invokes `copy.ps1`.
- Verify: run `scripts/sync-local.ps1` with no flags against a local install (default fast path unchanged — this is the one the `verify-local` skill depends on, so it must keep working exactly as before); then run it with the new full-sync flag(s) and confirm `product.json`, win32 icons, and `VisualElementsManifest` land in the install dir as `copy.ps1` used to produce them.

## Step 12: Colocate remaining root tooling into `scripts/`
- `git mv push-tag.ps1 scripts/push-tag.ps1`
- `git mv repush-tag.ps1 scripts/repush-tag.ps1`
- `git mv rcedit-tool scripts/rcedit-tool`
- Reference updates needed: `scripts/sync-local.ps1`'s new exe-icon-stamp step (from Step 11) must point at `rcedit-tool`'s new path (`scripts/rcedit-tool/node_modules/rcedit/bin/rcedit.exe` relative to `scripts/`, not `../rcedit-tool/...` relative to root).
- Verify: `git ls-files | grep -E '^(push-tag|repush-tag)\.ps1$|^rcedit-tool/'` returns nothing (confirms nothing left at old root paths); re-run Step 11's full-sync verify to confirm the relocated `rcedit-tool` path still resolves.

---
Say "execute" to run this plan, or give feedback to revise it.

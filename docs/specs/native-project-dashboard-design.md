# Native Project Dashboard — Design

## Problem

VS Code's stock Welcome/Getting Started page opens by default on startup and
carries no Null-specific value — it's generic upstream marketing/onboarding
content. A NULL-branded dashboard showing recent projects (with live git
status) and quick actions (New Project, Clone Repo, Open Folder) would make
startup useful instead of decorative.

Tracking issue: https://github.com/TorresVisual/null-ide/issues/38

## Background

The Welcome page isn't a webview an extension can simply override — what
opens on startup is decided by a core workbench contribution
(`workbench.contrib.welcomeGettingStarted`'s startup-page logic, which reads
the `workbench.startupEditor` setting and constructs `GettingStartedInput`
directly). There's no extension API to intercept or replace that decision,
so — unlike `workbench/custom.css`/`splash.js`, which only overlay the
existing shell — reaching it requires a source patch, per this repo's
`patches/` workflow (`patches/README.md`), already used for
`001-jumplist-recent-projects.patch`.

`extensions/null-tools/src/recentProjects.ts` already reads
`<userDataRoot>/null-recent-projects.json`, maintained by the main-process
patch from `001-jumplist-recent-projects.patch`'s `addRecentlyOpened()`
hook. This is the dashboard's recent-projects data source — no new IPC or
tracking logic needed for that part.

## Scope (v1)

In scope:
- Recent-projects cards: label, path, last-opened timestamp (data already
  available), git branch + uncommitted-changes indicator (computed async).
- Manual refresh of git status (no auto-refresh-on-focus).
- Quick actions: Open Folder (existing native command), New Project (mkdir +
  `git init`, no templates), Clone Repo (URL + folder prompt, runs in a
  terminal).

Out of scope for v1:
- "Last build status" — no existing convention in this repo for what that
  means for an arbitrary folder; would need its own design. Deferred to a
  follow-up issue.
- Pinned projects, project-type template picker for New Project — not
  requested for v1.
- Unregistering/removing the stock `GettingStartedInput`/editor — it stays
  registered; specific walkthroughs (e.g. opened via an extension's
  recommendation) still resolve to `GettingStartedInput` as before. Only the
  no-argument case — startup, and the bare Help > Welcome menu/Command
  Palette action — now opens the dashboard instead (`patches/004-null-dashboard-help-welcome.patch`).

## Architecture & Data Flow

The patch surface is kept to the single smallest touchpoint: the startup
decision. Everything else — UI, git shelling, New Project, Clone Repo — is
implemented entirely in the `null-tools` extension, the same way the
existing AI Agents panel (xterm.js + `postMessage`) is built.

An alternative considered and rejected: replicate a full `EditorPane`/
`EditorInput` class pair in core (mirroring `GettingStartedEditor`). Rejected
because it multiplies the patch surface (new contrib folder, new registration
boilerplate) for content that's fundamentally cards + buttons, and every
upstream VSCodium bump would need rebasing across more files for no
functional benefit over the smaller patch.

### VS Code core patch (`patches/003-null-dashboard-startup.patch`)

- Locate the startup-page contribution's decision point (the function that,
  based on `workbench.startupEditor`, currently constructs
  `GettingStartedInput` and opens it via `IEditorService`).
- Replace that one construction with opening a resource URI on a new
  `null-dashboard:` scheme instead (e.g.
  `URI.from({ scheme: 'null-dashboard', path: '/Dashboard' })`) via the same
  `IEditorService.openEditor(...)` call.
- No new class registration in core — resolution for that scheme is owned
  entirely by `null-tools`' `CustomEditorProvider` (see below). VS Code's
  editor-resolver service already lazily activates the extension owning an
  unregistered custom-editor scheme the first time such a URI is opened —
  the same mechanism that lets custom editors work in a brand-new empty
  window before anything else has activated — so this doesn't require
  `null-tools` to activate any earlier than its current `onStartupFinished`
  event.
- `GettingStartedInput`/`GettingStartedEditor` registration is untouched.
- No local `vscode-src/` checkout exists in this repo (builds run in CI
  only). Authoring this patch requires temporarily cloning VS Code at the
  pinned `MS_TAG` to find the exact call site and confirm the exact
  service/API names against that source, then generate the patch via
  `git format-patch`, per the existing `patches/` workflow.

### null-tools side (extension host, TypeScript)

New module `extensions/null-tools/src/dashboard.ts`:

- `vscode.window.registerCustomEditorProvider('null.dashboard', ...)`
  (readonly), activated on `onStartupFinished` (already null-tools' existing
  activation event — no new activation event needed).
- Webview content built the same way the AI Agents panel's webview assets
  are (`lib/`-style bundling), rendering the card grid.
- Card list: `recentProjects.readRecentProjects(recentProjects.getRecentProjectsFilePath())` —
  reused as-is. Cards render immediately with label/path/timestamp.
- Git status: after initial render, one batched pass over the recent-projects
  list with bounded concurrency (a small manual queue, e.g. 4 in flight at a
  time — no new dependency), shelling out per project following the existing
  pattern in `extensions/null-tools/src/github/gitBranch.ts`
  (`execFileSync('git', [...], { cwd, encoding: 'utf8', timeout: 5000 })`):
  - `git rev-parse --abbrev-ref HEAD` → branch name.
  - `git status --porcelain` → non-empty output = dirty indicator.
  - A project that isn't a git repo, or whose call throws/times out, is
    skipped (card just shows no badge) — never fails the batch or blocks
    other cards.
  - Results post to the webview per-card via `postMessage` as each resolves,
    not all-at-once, so the UI fills in progressively.
- A header refresh button re-runs the same batched pass (matches the chosen
  "compute once, manual refresh only" behavior — no focus-triggered or
  polling refresh).
- New Project action: webview → `postMessage` → extension-host handler:
  `vscode.window.showOpenDialog` (parent folder) → `vscode.window.showInputBox`
  (project name) → `fs.mkdirSync(target)` → `execFileSync('git', ['init'], { cwd: target })`
  → `vscode.commands.executeCommand('vscode.openFolder', Uri.file(target))`.
- Clone Repo action: webview → `postMessage` → `vscode.window.showInputBox`
  (repo URL) → `vscode.window.showOpenDialog` (parent folder) → reuse/create
  a dedicated terminal (same one-terminal-per-action convention as
  `null-actions`' `terminalRegistry.ts`, keyed by a fixed id so repeated
  clicks reuse it) → send `git clone <url> <target>` → on the terminal
  process exiting 0, open the cloned folder via the same `vscode.openFolder`
  command. Failure is just visible terminal output — no custom parsing.
- Open Folder action: existing native folder-open command, no new code.

## Error Handling

- Git status failures are per-card and silent (badge omitted); never block
  other cards or fail the batch — covered above.
- New Project: `mkdirSync`/`git init` failures surface via
  `vscode.window.showErrorMessage` with the underlying error text; nothing
  opens on failure.
- Clone Repo: failures are ordinary `git clone` stderr in the terminal; no
  custom error UI.
- Missing/corrupt `null-recent-projects.json`: already handled by
  `readRecentProjects` (catches and returns `[]`) — dashboard just renders
  an empty state.

## Testing / Verification

- The one genuinely non-trivial piece of new logic is the bounded-concurrency
  git-status batch (a loop + concurrency cap + per-item failure isolation).
  Gets a small `dashboard.test.ts` unit test, mirroring the existing
  `github/gitBranch.test.ts` pattern: asserts the concurrency cap is
  respected, and that one failing `execFileSync` call doesn't block or fail
  the others.
- New Project / Clone Repo are thin dialog/command orchestration with no
  branching logic worth unit testing — consistent with how other
  UI-orchestration commands in `null-tools` (`agentsPaste`, `injectContext`)
  are tested today: not at all, verified manually.
- The `startupPage.ts` core patch isn't unit-testable; verified via CI build
  + manual check (fresh window opens the dashboard instead of the stock
  Welcome page), same verification path used for
  `001-jumplist-recent-projects.patch`.
- Manual verification path (no local VS Code build is possible per
  `CLAUDE.md`):
  1. Trigger a `workflow_dispatch` CI build.
  2. Install the resulting ZIP or installer.
  3. Open a fresh window; confirm the Null dashboard opens instead of the
     stock Welcome page.
  4. Confirm recent-project cards appear immediately, and git branch/dirty
     badges fill in shortly after for git-tracked entries.
  5. Click the refresh button; confirm badges recompute.
  6. Run New Project; confirm the folder is created, `git init`'d, and
     opened.
  7. Run Clone Repo against a real URL; confirm the terminal clones and the
     folder opens on success.
  8. Confirm "Help: Welcome" in the Command Palette and Help menu now opens
     the Null dashboard, and that opening a specific extension walkthrough
     still opens the stock Getting Started page.

## Out of Scope

- Build status per project.
- Pinned projects.
- New Project template/type picker.
- Auto-refresh of git status on window focus or a timer.
- Unregistering the stock Welcome/Getting Started contribution.

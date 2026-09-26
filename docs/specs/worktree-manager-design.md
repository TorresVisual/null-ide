# Git Worktree Manager (`null-tools`) — Design

Implements [issue #88](https://github.com/TorresVisual/null-ide/issues/88).

## Problem

The maintainer runs several Claude Code sessions in parallel against the same
repo, each needing an isolated checkout. Today that means `git worktree add`
by hand, then manually tracking which worktree is which, whether it's dirty
or ahead/behind, whether its branch has been merged, and cleaning up
afterwards. This is exactly the kind of bookkeeping `null-tools` already
automates for other repetitive dev-loop tasks (Ports panel, GitHub Issues
panel, recent-project git status).

## Scope

In scope: a worktree tree view in `null-tools`; create a worktree from a
GitHub issue, from an existing branch, or from scratch; open a worktree in a
new window / reveal in Explorer / open a terminal there; merge a worktree's
branch back into the base branch and offer cleanup; prune worktrees whose
branch is merged or whose directory is gone; optionally copy a configured
glob of untracked setup files into new worktrees.

Out of scope: worktree support for non-Git repos; a UI for arbitrary
`git worktree move`/relocate (not requested); auto-polling refresh (see
below); multi-root workspace fan-out (operates on `workspaceFolders[0]`,
consistent with `issuesPanel.ts` / `issueDetailPanel.ts`).

## Reuse (existing code this builds on)

- `branchNameForIssue` (`src/github/gitBranch.ts`) — already defines the
  `issue-<n>-<slug>` branch-naming convention for issue #54. The "new
  worktree from issue" flow reuses this function unchanged rather than
  inventing a second naming scheme.
- `slugify` (`src/scratchNotesStorage.ts`) — reused for naming worktrees
  created "from scratch" (turns the user's free-text description into a
  branch/directory slug).
- `computeGitStatuses` (`src/dashboardGitStatus.ts`) — the bounded-concurrency
  batch-fetch helper used by the dashboard's recent-project git status. Its
  signature is genericized from a hardcoded `GitStatus` return type to
  `computeGitStatuses<T = GitStatus>(...)`, a backward-compatible change,
  so `worktrees.ts` can reuse it to enrich each worktree with ahead/behind +
  last-commit data without a second copy of the concurrency logic.
- `vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true })`
  — the exact "open in new window" pattern already used by
  `recentProjectsIntegration.ts`.
- The Ports feature's three-file shape (`portsTreeView.ts` /
  `portsIntegration.ts`) as the structural template for the tree view +
  command registration; see Architecture below for why worktrees also gets a
  fourth, vscode-free data module.

## Architecture

```
extensions/null-tools/src/
├── worktrees.ts            — pure git-data layer, no `vscode` import:
│                              parsing, ahead/behind, base-branch detection,
│                              create/remove/merge/prune operations.
│                              Unit-tested with real temp git repos
│                              (same style as gitBranch.test.ts).
├── worktreesTreeView.ts     — WorktreeTreeProvider implements
│                              vscode.TreeDataProvider<WorktreeEntry>,
│                              modeled on portsTreeView.ts's PortsTreeProvider.
└── worktreesIntegration.ts — registerWorktreesFeature(context): commands,
                               settings, view registration, modeled on
                               portsIntegration.ts.
```

Ports combines data-fetch and tree-provider in one file because a port scan
is a few regexes over `netstat`/`tasklist` output. Worktree management is
meatier — porcelain parsing, two sets of ahead/behind counts, base-branch
auto-detection with fallback, and three mutating git operations (create,
merge, prune) that each have edge cases worth a unit test — so it gets its
own `vscode`-free module, matching how `dashboardGitStatus.ts` is split out
from `dashboard.ts` for the same reason.

### Data model (`worktrees.ts`)

```ts
export interface WorktreeEntry {
  path: string;
  branch: string | null;       // null when detached HEAD
  head: string;                 // commit sha
  isCurrent: boolean;           // matches workspaceFolders[0]
  dirty: boolean;
  ahead: number; behind: number;         // vs upstream (if any)
  aheadBase: number; behindBase: number; // vs the detected base branch
  lastCommitSubject: string;
  lastCommitDate: string;       // ISO, from `git log -1 --format=%cI`
  prunable: boolean;            // git worktree list --porcelain "prunable" flag
}
```

### Key functions (`worktrees.ts`)

- `listWorktrees(repoCwd): Promise<WorktreeEntry[]>` — runs
  `git worktree list --porcelain`, parses each entry's `worktree`/`HEAD`/
  `branch`/`prunable` lines, then uses `computeGitStatuses` to enrich each
  path concurrently with dirty state, ahead/behind vs upstream, ahead/behind
  vs base branch, and last-commit subject/date. A path that fails to enrich
  (removed directory) still appears with `prunable: true` and blank status
  fields, never dropped from the list.
- `getBaseBranch(repoCwd): Promise<string>` — tries
  `git symbolic-ref refs/remotes/origin/HEAD`, strips the `origin/` prefix;
  on failure (no remote, detached) falls back to `main` if it exists, else
  `master`, else the repo's current branch.
- `createWorktree(repoCwd, opts): Promise<Result<{ path: string }>>` — opts
  is one of `{ kind: 'issue', issueNumber, title }` (branch via
  `branchNameForIssue`), `{ kind: 'branch', branch }` (existing branch,
  `git worktree add <path> <branch>`), or `{ kind: 'scratch', description }`
  (new branch via `slugify`, `git worktree add -b <branch> <path>`). Path is
  always `../<repo-dir-name>-<branch-slug>`, sibling to the repo, per the
  issue's own convention — no path prompt (confirmed with maintainer).
  After a successful `add`, copies files per `copyFilesGlob` (see below).
- `removeWorktree(repoCwd, worktreePath, force): Promise<Result<void>>` —
  `git worktree remove [--force] <path>`.
- `mergeWorktreeBack(repoCwd, entry, baseBranch): Promise<Result<{ mode: 'ff' | 'merge' }>>`
  — refuses if the main repo's working tree (`repoCwd`, not the worktree) is
  dirty. Checks out `baseBranch` in `repoCwd`, tries
  `git merge --ff-only <entry.branch>`; on failure, the caller (integration
  layer) confirms with the user before retrying as a plain `git merge`. Does
  **not** remove the worktree or branch itself — the integration layer offers
  that as a separate confirmed follow-up step, so a merge failure never
  leaves you without your working branch.
- `pruneCandidates(repoCwd, baseBranch): Promise<{ merged: WorktreeEntry[]; missing: WorktreeEntry[] }>`
  — `merged` = worktrees whose branch appears in
  `git branch --merged <baseBranch>`; `missing` = entries whose `prunable`
  flag is set. `pruneWorktrees(repoCwd)` runs `git worktree prune` for the
  `missing` set; branch deletion for the `merged` set is a separate,
  confirmed step in the integration layer (never silent).
- `copySetupFiles(sourceCwd, destCwd, globs: string[]): Promise<void>` — for
  each glob, `vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(sourceCwd), glob))`
  (VS Code's search honors an arbitrary `RelativePattern` base outside the
  open workspace folders), then copies matches to the same relative path
  under `destCwd`, creating parent directories as needed. No new dependency
  for glob matching — this is the "native platform feature" rung, not a
  hand-rolled matcher. Lives in `worktreesIntegration.ts` (the one function
  in this feature that needs `vscode`, since `findFiles` is a `vscode` API),
  called from the integration layer right after `createWorktree` succeeds.

### Tree view (`worktreesTreeView.ts`)

`WorktreeTreeProvider` — same shape as `PortsTreeProvider`: holds
`_entries: WorktreeEntry[]`, exposes `refresh()`, fires
`onDidChangeTreeData`. `getTreeItem` renders label = branch name (or short
SHA if detached), description = ahead/behind glyphs (`↑2 ↓1`) + dirty dot,
tooltip = full path/head/last-commit, `contextValue = 'worktreeEntry'` (plus
`'worktreeEntryCurrent'` when `isCurrent`, so the current worktree's context
menu can hide "Open in New Window"/"Remove"). No auto-refresh timer (unlike
Ports' `startAutoRefresh`) — worktree state changes far less often than open
ports, and shelling out `git worktree list` plus per-path enrichment across
potentially several worktrees is heavier than a port scan. Refresh is
triggered on activation, the manual Refresh command, and after every
mutating command (create/remove/merge/prune) fires.

### Commands & UI (`worktreesIntegration.ts`)

New tree view `null.worktreesView` added to the existing `null-workspace`
activity-bar container (alongside Scratch/Notes/Ports — not a new
container).

| Command | Where | Behavior |
|---|---|---|
| `null.worktrees.new` | view/title | QuickPick: From Issue (delegates to the Issues panel's issue list) / From Branch (QuickPick of local+remote branches) / From Scratch (input box for a description) |
| `null.worktrees.refresh` | view/title | `provider.refresh()` |
| `null.worktrees.prune` | view/title | Runs `pruneCandidates`, shows a multi-select QuickPick of merged/missing entries, confirms, then prunes + deletes selected branches |
| `null.worktrees.openInNewWindow` | item context | `vscode.openFolder` with `forceNewWindow: true` |
| `null.worktrees.revealInExplorer` | item context | `vscode.commands.executeCommand('revealFileInOS', uri)` |
| `null.worktrees.openTerminal` | item context | `vscode.window.createTerminal({ cwd: entry.path })` |
| `null.worktrees.mergeBack` | item context | Confirms, calls `mergeWorktreeBack`, on success offers "Remove worktree and delete branch" |
| `null.worktrees.remove` | item context | Confirms (warns if dirty), calls `removeWorktree` |

Settings (contributed under `null.worktrees.*`, same convention as
`null.ports.*`):
- `null.worktrees.copyFilesGlob: string[]` (default `[]`) — glob patterns
  copied into every new worktree, e.g. `[".env", ".claude/settings.local.json"]`.

### Issues panel integration

`issuesPanel.ts` and `issueDetailPanel.ts` each get a new message type
`createWorktreeForIssue` / `createWorktree`, mirroring their existing
`createBranchForIssue` / `createBranch` handlers exactly, but calling
`createWorktree(cwd, { kind: 'issue', issueNumber, title })` and, on success,
opening the new worktree in a new window (with a "Stay here" alternative via
`showInformationMessage` action button, since unlike the existing
branch-checkout flow this doesn't touch the current window's checkout at
all). `webview/issues.ts` and `webview/issueDetail.ts` get a matching button
next to the existing "Create Branch for Issue" button.

## Error handling

Every git-shelling function returns a `Result<T> = { ok: true; value: T } | { ok: false; message: string }`
(matching the existing `createIssueBranch` return shape) rather than
throwing — the integration layer is the only place that shows
`showErrorMessage`/`showInformationMessage`, keeping `worktrees.ts` UI-free
and easy to unit test. Destructive confirmations (`remove`, `mergeBack`
removal follow-up, `prune` branch deletion) always use
`showWarningMessage(..., { modal: true }, 'Delete'/'Remove')`, matching
`portsIntegration.ts`'s `killProcess` pattern.

## Testing

`worktrees.test.ts` (real temp git repos via `execFileSync`, same style as
`gitBranch.test.ts` / `dashboardGitStatus.test.ts`, no mocking of git
itself):
- `listWorktrees` parses `--porcelain` output for a repo with 2+ worktrees,
  reports correct branch/dirty/ahead-behind for each.
- `getBaseBranch` finds `origin/HEAD` when a remote exists; falls back to
  `main`/`master` when it doesn't.
- `createWorktree` for each of the three `kind`s produces the expected
  branch name and sibling directory; fails cleanly (returns `ok: false`,
  doesn't throw) if the target directory already exists.
- `mergeWorktreeBack` refuses when `repoCwd` is dirty; succeeds via
  fast-forward when possible; the ff-only merge fails cleanly when the base
  branch has diverged (caller decides whether to retry as a real merge).
- `pruneCandidates` correctly separates a merged-branch worktree from one
  whose directory was deleted out from under it.

`computeGitStatuses`'s existing test suite in `dashboardGitStatus.test.ts`
covers the genericized helper already (its tests don't depend on the
concrete `GitStatus` type); no new tests needed there beyond confirming the
existing suite still passes after the type-parameter change.

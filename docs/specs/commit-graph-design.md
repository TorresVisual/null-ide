# Native commit graph — design

Issue: #87 (first of two sub-projects; the interactive rebase editor gets its own spec, plan and build afterwards).

## Goal

Browse and act on git history inside Null IDE: a lane-drawn commit graph in an editor tab, reachable from the activity bar, with commit file lists, native diffs and the common history actions. No terminal, no paid GitLens graph.

## Scope

**In (v1):** graph tab, activity-bar recent-commits list, file list per commit, native diff, actions (checkout, create branch, cherry-pick, revert, reset soft/mixed/hard, copy SHA), paging for large repos, stashes, tags, HEAD, keyboard navigation.

**Out (v1):** interactive rebase (sub-project 2), branch/author filter, search, multi-root repo picker, multi-select actions, a working-tree ("uncommitted changes") row (the SCM view covers it), hunk staging (#7), branch→issue link (#54), any push or other remote-rewriting operation.

**Assumptions:**
- Lives in `extensions/null-tools`. Acts on the worktree of the first workspace folder, resolved with `git rev-parse --show-toplevel` (not `resolveMainWorktreeRoot`): history is shared across worktrees, but HEAD, the dirty state and the in-progress markers belong to the worktree the user is looking at, so actions never touch a checkout that is not open.
- Git runs through async `execFile` (see "Git execution"). The built-in `vscode.git` API is used only for `git:` diff URIs and as a repo-change trigger.
- **Remote windows:** `null-tools` is `extensionKind: ["ui"]`. If the workspace folder's scheme is not `file`, the tab and tree show a welcome state ("Commit Graph isn't available in remote windows yet") and spawn no git. Known limit.
- **Untrusted workspaces:** checked at runtime (`workspace.isTrusted`, re-evaluated on `onDidGrantWorkspaceTrust`); the manifest capability is per extension and would disable all of `null-tools`. A repo's `.git/config` can run code (`core.fsmonitor`, hooks), so tab and tree show a welcome state with a "Trust Workspace" button and spawn no git, as `null-activity` does.

## Architecture

The host owns all state and layout; the webview renders and sends intents (the same split as `null-music` and `null-activity`).

New files under `extensions/null-tools/src/graph/`:

| File | Role |
|---|---|
| `protocol.ts` | Shared message and row types; a global script (no imports or exports) so the webview bundle can compile it |
| `gitRun.ts` | The one `runGit(cwd, args)` wrapper (see "Git execution") and the per-repo busy flag |
| `gitLog.ts` | Pure parser for `git log --date-order --decorate=full -z --format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s` over `--branches --tags --remotes HEAD <stash SHAs>` (`%P` already carries the parents; `--decorate=full` tells local branches from remotes in `%D`) |
| `graphLayout.ts` | Pure `GraphLayouter`; `layoutPage(commits)` returns rows `{ sha, lane, laneCount, edges[{from,to,color}], refs }`; active-lane state persists across pages |
| `gitGraphService.ts` | Injected deps (`runGit`, repo root): `loadPage(n)`, `refs()` (`for-each-ref` + `stash list`), `fingerprint()` (returns `{ hash, inProgress }`), `inProgress()`, `commitDetail(sha)`, `commitFiles(sha)` |
| `gitActions.ts` | The actions below, returning `Result<T>` like `worktrees.ts` |
| `graphMessages.ts` | Pure typed message unions and `parseWebviewMessage` (validation, see "Validation") |
| `commitGraphPanel.ts` | Single reused `WebviewPanel` (`null.commitGraph`), nonce CSP, `ready` handshake |
| `graphTreeView.ts` | Activity-bar TreeView `null.graphView` |
| `graphSession.ts` | Repo resolution, the shared service, fingerprint watching and action serialization |
| `graphCommands.ts` | Command handlers and their prompts |
| `graphDiff.ts` | Diff URIs and the empty document |
| `gitApi.ts` | The slice of the built-in `vscode.git` API the graph uses |
| `commitGraphHtml.ts` | The webview's CSP shell |
| `graphIntegration.ts` | `registerGraphFeature(context)`, called from `extension.ts` next to the worktrees and issues features |

Webview: `src/webview/commitGraph.ts` (vanilla TS, `module: none`, no imports) compiled by a new `tsconfig.webview-commit-graph.json` to the tracked `lib/commitGraph.js`; `lib/commitGraph.css` is hand-written. It reuses `src/webview/shared/dom.ts`, `time.ts` and `octicons.ts`. `package.json`'s `compile` script gains the new tsconfig.

One `GitGraphService` instance per repo root is shared by the tab and the tree so a repo change causes one `git log`, not two. It is created on demand.

### Lazy start

`registerGraphFeature` only registers commands, the view and the panel serializer at activation. The tree loads on its first `onDidChangeVisibility(true)`; the change subscription starts with the first consumer (tree visible or tab open) and stops when none remains.

### Git execution

`runGit` is always async and sets: `cwd`, an explicit `maxBuffer`, a 15 s timeout, env `GIT_OPTIONAL_LOCKS=0` (background reads never take `index.lock`, so they cannot make the user's own commit fail), `GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true` (so `--continue` never blocks on an editor) and `LC_ALL=C`. It passes `-c core.quotepath=off`, uses `-z` wherever paths are listed and puts `--` before paths and refs.

A per-repo busy flag serializes actions: while one runs, other actions are refused and the refresh waits for it.

## Data and layout

- Pages of 500 commits via `-n 500 --skip=N`, `--date-order` (parent-safe and roughly newest-first; `--topo-order` would let one old branch fill page 1). The tree uses the same `loadPage(50)`, so its SHAs are always in page 1 of the graph.
- Ref set is explicit: `--branches --tags --remotes HEAD` plus stash SHAs. `--all` is not used: it pulls in `refs/notes/*`, `refs/pull/*`, `refs/original/*` and `refs/replace/*`.
- **Repo-change detection:** the `vscode.git` repo's `state.onDidChange` (debounced) is only a trigger. `fingerprint()` hashes `HEAD`, `for-each-ref` and `stash list`; a reload happens only if it changed, because the event also fires on every working-tree status change. The same check runs when the tab regains focus after more than 60 s hidden (as the issue tabs do), which also catches commits from another worktree or the terminal. A stale layout is never spliced into: a change resets the layouter and reloads from the top.
- **State across a reload:** the webview keeps `selectedSha` and the sha of the first visible row (with its offset). After a `reset` rows message it restores both if the sha is in the new rows, else falls back to the top.
- Lane rules: a commit takes the lane of the first child waiting for it, else opens a new lane. The first parent inherits the lane. Extra (merge) parents take an existing waiting lane or open one. Freed lanes are reused. Colors are assigned per lane index from `--vscode-charts-*` variables; a branch can change color when its lane is reused (known limit).
- **Stashes:** every stash is shown. SHAs come from `git stash list --format=%H` and are added as log tips (the `refs/stash` ref alone only reaches `stash@{0}`). Each is labeled `stash@{n}` by position and keeps only its first parent (the index and untracked parents are dropped), so it draws as one node.

## Panel and webview

- Host to webview: `rows {rows, hasMore, reset}`, `detail {sha, …}`, `files {sha, files}` (the 500-file cap is applied in the webview), `state {inProgress}`, `focus`, `loadError`, `unavailable`. Webview to host: `ready`, `loadMore`, `select(sha)`, `goto(sha)`, `openDiff(sha, file)`, `refresh`, `banner(action)`, `manageTrust`. There is no `action` message (see "Actions").
- Virtualized list: fixed 24 px rows, a scroll-height spacer, a render window of visible+20 rows; each row is one inline SVG lane segment plus an HTML line (ref pills, subject, author, relative date). Near the bottom the webview sends `loadMore`.
- **Lane column** is capped at 10 lanes (about 120 px). Lanes beyond the cap are clipped with a "+N" marker; the commit's own lane is always drawn.
- **Detail pane** below the list, loaded on `select`: `git show -s` gives the full message body, the committer if it differs from the author, and the parent SHAs (each clickable, scrolling the list to it). The file list comes from `diff-tree -z --name-status -r -M <sha>^ <sha>` (`--root` for a root commit; merge commits diff against the first parent), capped at 500 files with "N more — show all". Every response carries the sha and the webview drops any that no longer matches the selection. A click on a file sends `openDiff`; the host opens `vscode.diff` with `git:` URIs for `<sha>^` and `<sha>` (an empty document for the root commit side, and for the missing side of added and deleted files).
- **In-progress banner:** when `.git/MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` or `rebase-merge/` exists (resolved through `git rev-parse --git-path`, so linked worktrees work), a persistent banner at the top of the tab names the operation and offers Continue, Skip and Abort (for rebase and merge, only what applies). The tree gets the same state through the context key below.
- **Accessibility:** the list container is `role="listbox"` with `aria-activedescendant`; rows are `role="option"` with an `aria-label` of subject, author and date; the lane SVG is `aria-hidden`. Up/Down/PageUp/PageDown/Home/End move the selection and scroll it into view; Enter selects the first changed file and opens its diff. The selection math is pure and lives in the `vm`-tested virtualization file.
- Commit messages and ref names are untrusted: `textContent` only, never `innerHTML`. Subjects are plain text, so marked and DOMPurify are not needed for v1.

### Validation

Every command handler and `parseWebviewMessage` validate their input: a sha must match `^[0-9a-f]{40}$`; a ref must be in the latest `refs()` snapshot; a file path must be in the commit's file list; paths and refs follow `--`. Anything else is dropped.

## Actions and safety

All go through `gitActions.ts`; failures surface as a toast with git's stderr, from both the tab and the tree.

The tab uses `data-vscode-context` on rows and the manifest's `webview/context` menu (as `null-music` does), so one `null.graph.*` command contribution serves the tab and the tree with the same ids, titles and `when` clauses. Commands receive the sha from the context argument. The context key `null.graph.operationInProgress` disables the items; the banner explains why.

| Action | Command | Guard |
|---|---|---|
| Checkout | `git checkout <ref>` / `git switch --track <remote/branch>` | A commit with several refs shows a QuickPick (local branches, then remote, then tags). A remote-only branch becomes a tracking branch. Tags and a bare SHA detach HEAD after a one-line warning. A dirty tree makes git refuse; its message is shown, nothing is forced. |
| Create branch here | `git switch -c <name> <sha>` | Name validated with `git check-ref-format --branch`. |
| Cherry-pick | `git cherry-pick [-m <n>] <sha>` | For a merge commit, ask which parent (QuickPick of the parents, default 1). On conflict or an empty result the banner offers Continue / Skip / Abort. |
| Revert | `git revert --no-edit [-m <n>] <sha>` | Same merge-parent picker and banner as cherry-pick. |
| Reset soft/mixed/hard | `git reset --<mode> <sha>` | Modal naming the mode and the cost: "N commits will no longer be on `<branch>` (M of them on no other branch or tag)", computed with `rev-list HEAD ^<sha>` against `--not --exclude=<current> --branches --tags --remotes`. Hard states that those M commits are then recoverable only through the reflog, and is confirmed again when tracked files are modified, listing the count (untracked files are never touched by `reset --hard`). |
| Pull | `git fetch`, then `git pull --ff-only`; when the branch has diverged, `git rebase @{u}` or `git merge --no-edit @{u}` | Command only: a button in the sidebar view's title and one in the Commit Graph tab's title bar, no row context. A branch without an upstream, or already up to date, gets a one-line message. A diverged branch follows git's config: `branch.<name>.rebase` over `pull.rebase` (`true` rebases, `false` merges), and `pull.ff=only` runs nothing and says so. `pull.rebase=merges` runs `git rebase --rebase-merges @{u}` without the modal, keeping local merge commits. When the config does not decide (unset, `interactive`), a modal names the local and incoming commit counts with Rebase / Merge; dismissing it runs nothing. Always Rebase and Always Merge on that modal write `pull.rebase` (or an unreadable `branch.<name>.rebase`) into the repository's own git config, never the global one, before the operation runs. No `--autostash`: a dirty tree makes git refuse and its message is shown. Conflicts stop the operation and the banner offers Continue / Skip / Abort. |
| Copy SHA | clipboard | Full SHA. |

Banner buttons run `git <op> --continue` (with `GIT_EDITOR=true`), `--skip` or `--abort`.

Rules for all actions:
- Act only on the repo the graph displays.
- No force flags, no push.
- Graph and tree refresh after every action.
- Actions are disabled, with an explanation, while another operation is in progress.
- No "Interactive rebase from here" placeholder in v1; sub-project 2 adds it.

## Activity-bar entry

- `null.graphView` lives in the existing `null-workspace` container (collapsed by default); there is no separate graph container. `media/commit-graph.svg` is the tab icon.
- One TreeView `null.graphView`: the first 50 commits of the shared listing (host data, no layout). Label is the subject; description is author, relative date and ref badges. Clicking runs `null.graph.open` with that SHA, which opens or focuses the tab, scrolls to and selects the commit.
- View title buttons: Open Commit Graph (`$(git-commit)`) and Refresh. `view/item/context` carries the actions. `viewsWelcome` covers "not a git repository", remote windows and untrusted workspaces.
- Commands: `null.graph.open`, `null.graph.refresh`, `null.graph.checkout`, `createBranch`, `cherryPick`, `revert`, `reset.soft|mixed|hard`, `copySha`, `continue`, `skip`, `abort`.
- **Features launcher:** a `develop` entry for `null.graph.open` in `package.json`'s `nullWorkspace.features` (`featureManifests.test.ts` checks the command exists).
- Committed outputs per repo convention: `lib/commitGraph.js`, `lib/commitGraph.css` and refreshed `out/`.

## Errors

Git failures return `Result` and show a toast with stderr. A missing git binary, a non-repo folder, a remote window or an untrusted workspace gives the welcome state, not an exception. A failed page load keeps the existing rows and offers a retry.

## Testing

Unit (`node --test`; every file added to the explicit list in `package.json`'s `test` script):
- `graph/gitLog.test.ts`: normal and root commits, merges, subjects with quotes/newlines/unicode, ref decoration (`HEAD -> main, tag: v1, origin/x`), stash first-parent only.
- `graph/graphLayout.test.ts`: linear, branch and merge, octopus, lane reuse after a merge, two pages equal one page.
- `graph/graphMessages.test.ts`: sha/ref/path validation, rejected `-`-prefixed input.
- `graph/gitActions.test.ts`: real `git` in a temp repo (as `worktrees.test.ts`): cherry-pick (including a merge with `-m`), conflicting revert, empty cherry-pick then `--skip`, soft/mixed/hard reset and the unreachable-commit count, in-progress detection in a linked worktree, fingerprint change on commit and no change on a file edit.
- Webview virtualization and keyboard-selection math in a small file compiled by a shared tsconfig and loaded via `vm`, as in `null-music`/`null-activity`.

Integration (`npm run test:integration`): open the panel on a fixture repo, send `ready`, check the first `rows` message (count, HEAD marker), and that `openDiff` opens a diff editor. The spec reads and drives the tab through the internal commands `_null.graph.snapshot` and `_null.graph.dispatch`.

Done means: `npm test` green, compile clean, a `CLAUDE.md` section for the feature (and a `docs/ROADMAP.md` note if the graph is listed there), and `/verify-local null-tools` shows the graph opening, paging, and a cherry-pick working in a real Null IDE build.

## Hook for sub-project 2

The `webview/context` menu contributions and the in-progress detection and banner are the points the rebase editor extends: it adds "Interactive rebase from here…" and reuses the rebase-in-progress state.

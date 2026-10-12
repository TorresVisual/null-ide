# Native commit graph — design

Issue: #87 (first of two sub-projects; the interactive rebase editor gets its own spec, plan and build afterwards).

## Goal

Browse and act on git history inside Null IDE: a lane-drawn commit graph in an editor tab, reachable from the activity bar, with commit file lists, native diffs and the common history actions. No terminal, no paid GitLens graph.

## Scope

**In (v1):** graph tab, activity-bar recent-commits list, file list per commit, native diff, actions (checkout, create branch, cherry-pick, revert, reset soft/mixed/hard, copy SHA), paging for large repos, stashes, tags, HEAD.

**Out (v1):** interactive rebase (sub-project 2), branch/author filter, search, multi-root repo picker, hunk staging (#7), branch→issue link (#54), any push or other remote-rewriting operation.

**Assumptions:** lives in `extensions/null-tools`; acts on the first workspace folder resolved to its main worktree root (`resolveMainWorktreeRoot`); git runs through `execFile`, as in `worktrees.ts`; the built-in `vscode.git` API is used only for `git:` diff URIs and repo-change events.

## Architecture

The host owns all state and layout; the webview renders and sends intents (the same split as `null-music` and `null-activity`).

New files under `extensions/null-tools/src/graph/`:

| File | Role |
|---|---|
| `gitLog.ts` | Pure parser for `git log --all --topo-order --parents -z --format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s` |
| `graphLayout.ts` | Pure `GraphLayouter`; `layoutPage(commits)` returns rows `{ sha, lane, laneCount, edges[{from,to,color}], refs }`; active-lane state persists across pages |
| `gitGraphService.ts` | Injected deps (`runGit`, repo root): `loadPage(n)`, `refs()` (`for-each-ref` + `stash list`), `commitFiles(sha)` (`diff-tree --name-status -r -M`) |
| `gitActions.ts` | The actions below, returning `Result<T>` like `worktrees.ts` |
| `commitGraphPanel.ts` | Single reused `WebviewPanel` (`null.commitGraph`), nonce CSP, `ready` handshake, typed message unions |
| `graphTreeView.ts` | Activity-bar TreeView `null.graphView` |
| `graphIntegration.ts` | `registerGraphFeature(context)`, called from `extension.ts` next to the worktrees and issues features |

Webview: `src/webview/commitGraph.ts` (vanilla TS, `module: none`, no imports) compiled by a new `tsconfig.webview-commit-graph.json` to the tracked `lib/commitGraph.js`; `lib/commitGraph.css` is hand-written. It reuses `shared/dom.ts`, `time.ts` and `octicons.ts`. `package.json`'s `compile` script gains the new tsconfig.

One `GitGraphService` instance per repo root is shared by the tab and the tree so a repo change causes one `git log`, not two.

## Data and layout

- Pages of 500 commits via `-n 500 --skip=N`. Any repo change (HEAD, refs, new commit; debounced from the `vscode.git` repo's `state.onDidChange`) resets the layouter and reloads from the top; a stale layout is never spliced into.
- Lane rules: a commit takes the lane of the first child waiting for it, else opens a new lane. The first parent inherits the lane. Extra (merge) parents take an existing waiting lane or open one. Freed lanes are reused. Colors are assigned per lane index.
- Stashes: `--all` includes `refs/stash`. The stash's second parent (index commit) is dropped so it draws as one node labeled `stash@{n}`.

## Panel and webview

- Host to webview: `rows {rows, hasMore, reset}`, `refs`, `files {sha, files}`. Webview to host: `ready`, `loadMore`, `select(sha)`, `openDiff(sha, file)`, `action(kind, sha)`, `refresh`.
- The tab reloads from the top on repo changes and when it regains focus after more than 60 s hidden (as the issue tabs do).
- Virtualized list: fixed 24 px rows, a scroll-height spacer, a render window of visible+20 rows; each row is one inline SVG lane segment plus an HTML line (ref pills, subject, author, relative date). Near the bottom the webview sends `loadMore`.
- Detail pane below the list: metadata and changed files. A click on a file sends `openDiff`; the host opens `vscode.diff` with `git:` URIs for `<sha>^` and `<sha>`. Root commit diffs against an empty document; merge commits diff against the first parent.
- Commit messages and ref names are untrusted: `textContent` only, never `innerHTML`. Subjects are plain text, so marked and DOMPurify are not needed for v1.

## Actions and safety

All go through `gitActions.ts`; failures surface as a toast with git's stderr, from both the tab and the tree.

| Action | Command | Guard |
|---|---|---|
| Checkout | `git checkout <ref>` | Branch ref switches. Bare SHA gives detached HEAD after a one-line warning. A dirty tree makes git refuse; its message is shown, nothing is forced. |
| Create branch here | `git switch -c <name> <sha>` | Name validated with `git check-ref-format --branch`. |
| Cherry-pick | `git cherry-pick <sha>` | On conflict: message to resolve in the merge editor, with Continue/Abort buttons (`--continue` / `--abort`). |
| Revert | `git revert --no-edit <sha>` | Merge commits need `-m 1`; ask first. Conflicts handled as for cherry-pick. |
| Reset soft/mixed/hard | `git reset --<mode> <sha>` | Modal naming the mode and the commits that become unreachable. Hard is confirmed again when the tree is dirty, listing how many files would be lost. |
| Copy SHA | clipboard | Full SHA. |

Rules for all actions:
- Act only on the repo the graph displays.
- No force flags, no push.
- Graph and tree refresh after every action.
- Actions are disabled, with an explanation, while another operation is in progress (`.git/MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `rebase-merge/`).
- No "Interactive rebase from here" placeholder in v1; sub-project 2 adds it.

## Activity-bar entry

- New `viewsContainers.activitybar` container `null-graph` ("Commit Graph") with `media/commit-graph.svg`, separate from `null-workspace`.
- One TreeView `null.graphView`: the last 50 commits (host data, no layout). Label is the subject; description is author, relative date and ref badges. Clicking runs `null.graph.open` with that SHA, which opens or focuses the tab, scrolls to and selects the commit.
- View title buttons: Open Commit Graph (`$(git-commit)`) and Refresh. `view/item/context` carries the actions. `viewsWelcome` covers "not a git repository".
- Commands: `null.graph.open`, `null.graph.refresh`, `null.graph.checkout`, `createBranch`, `cherryPick`, `revert`, `reset.soft|mixed|hard`, `copySha`. The same ids serve the tab (via messages) and the tree.
- Committed outputs per repo convention: `lib/commitGraph.js`, `lib/commitGraph.css` and refreshed `out/`.

## Errors

Git failures return `Result` and show a toast with stderr. A missing git binary or a non-repo folder gives the welcome state, not an exception. A failed page load keeps the existing rows and offers a retry.

## Testing

Unit (`node --test`; every file added to the explicit list in `package.json`'s `test` script):
- `graph/gitLog.test.ts`: normal and root commits, merges, subjects with quotes/newlines/unicode, ref decoration (`HEAD -> main, tag: v1, origin/x`), stash index-parent removal.
- `graph/graphLayout.test.ts`: linear, branch and merge, octopus, lane reuse after a merge, two pages equal one page.
- `graph/gitActions.test.ts`: real `git` in a temp repo (as `worktrees.test.ts`): cherry-pick, conflicting revert, soft/mixed/hard reset, in-progress detection.
- Webview virtualization math in a small file compiled by a shared tsconfig and loaded via `vm`, as in `null-music`/`null-activity`.

Integration (`npm run test:integration`): open the panel on a fixture repo, send `ready`, check the first `rows` message (count, HEAD marker), and that `openDiff` opens a diff editor.

Done means: `npm test` green, compile clean, and `/verify-local null-tools` shows the graph opening, paging, and a cherry-pick working in a real Null IDE build.

## Hook for sub-project 2

The context-menu action registry and the in-progress-operation detection are the points the rebase editor extends: it adds "Interactive rebase from here…" and reuses the rebase-in-progress state.

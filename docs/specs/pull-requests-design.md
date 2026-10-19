# Pull Requests — Design

Issues: **#92** (first slice, "GitHub Pull Requests in the Issues panel") and **#117** (umbrella, "Manage Pull Requests Inside Null IDE"). #92 is Phase 1 below; #117 stays open as the umbrella and its acceptance checklist is mapped onto the phases at the end.

## Decisions

1. **GitHub first, GitLab last.** The Issues panel is GitHub.com-only today (`github/githubApi.ts`, `githubAuth.ts`) and there is no GitLab client. A provider interface is not introduced until GitLab is actually built (Phase 6); Phases 1–5 call the GitHub client directly.
2. **Native surfaces, not a new webview.** The PR list is a `TreeView` (`null.pullsView`, in the `null-issues` activity-bar container under the Issues webview). A PR expands to its changed files; a file opens in the stock diff editor (`vscode.diff`). Line comments use the VS Code Comments API (`createCommentController`). This is what #117 asks for ("reuse the existing editor and diff viewer") and it is much smaller than rendering diffs in a webview. #92's "same webview architecture" is deliberately not followed for the list/diff; the one place a webview is justified is the PR detail page (Phase 2: description, conversation, checks), which reuses the issue-detail webview conventions.
3. **No git needed to read a PR.** File contents at the merge base and at the head commit come from the GitHub Contents API (`fetchRepoFile`, already used for issue images) through a `null-pr:` `TextDocumentContentProvider`. Only *checkout* touches git (`git fetch origin pull/<n>/head`, which also works for fork PRs).
4. **Left side = merge base.** GitHub diffs a PR from the merge base, not from the base branch tip; the merge base is read from `GET /compare/{base}...{head}`. `LEFT`-side comment lines refer to that version.
5. **Reuse** `githubSession.ts`/`githubAuth.ts` (token via null-accounts), `githubRemote.ts` (repo from `origin`), `requestGraphql`/`requestJson` (rate-limit-aware `ApiError`), `graph/gitRun.ts` (`makeRunGit`) and `graph/graphDiff.ts` (empty-document side).
6. **Code lives in `extensions/null-tools/src/pulls/`**, pure model/API files first, `vscode` glue in a few thin files, mirroring `src/graph/`.
7. **Container and lazy loading.** The `null-issues` activity-bar container keeps its id and icon but is retitled "GitHub"; Issues stays visible, Pull Requests is `collapsed`. Nothing is fetched until the PR view is first shown, and nothing polls while it is hidden.
8. **Repo = `origin` of the first folder**, nothing else. If `origin` is a fork the tree shows the fork's own PRs; no parent lookup, no `upstream`, no multi-root.
9. **Gating mirrors the commit graph** (`classifyWorkspace` from `graph/graphMessages.ts`): no folder, remote window and untrusted workspace show a welcome message and do nothing. Further `null.pulls.state` values: `not-a-repo`, `no-repo` (`origin` is not github.com), `signed-out` (Sign in button), `error` (rate limit / offline, with Try Again), `empty` (no open PRs), `ready`. A failure of a later action (comment, checkout) is a toast carrying the GitHub or git message verbatim.
10. **Refresh** is the title-bar button, a window-focus refresh throttled to once a minute (only while the view is loaded), and a refresh after a checkout. No timer until Phase 5.
11. **Tree rows.** A PR shows `#n title`, the CI/draft icon, and `●` in its description (pinned to the top) when it is the head of the checked-out branch. Its files are a flat list sorted by path: status letter (A/M/D/R) + directory + `+n −m`, and `💬 n` when the file has threads. No folder nesting, no "viewed" state.
12. **Threads.** Shown only on the `null-pr:` documents of a diff (no working-tree overlay, also after checkout). Resolved threads are collapsed with state Resolved (read-only). Outdated threads are not shown; their count is in the PR's tooltip. Reply and new thread only: no edit, no delete.
13. **Comments post immediately.** The first successful post shows a one-time notice (`globalState`) that comments are sent at once and notify the author, with an *Open on GitHub* action (the way to delete a mistake until Phase 3). A multi-line selection sends `start_line`..`line` on one side; if GitHub answers 422 (range crosses hunks), the comment is retried on the first line only.
14. **Checkout.** Same-repo PR: local branch = the PR's head branch name; fork PR (or a head name git would read as an option): `pr/<n>`. `git fetch origin pull/<n>/head`, then create the branch at `FETCH_HEAD` or fast-forward an existing one, never anything else. A dirty tree that conflicts makes git refuse; its message is shown and nothing else happens.
15. **Large and binary files.** Each side is capped at 2 MB. Binary or over-cap content is replaced by the one-line placeholder `Binary or too large to show — open the pull request on GitHub.` so `vscode.diff` always opens.
16. **No feature flag.** A hub entry (`nullWorkspace.features`), `extensions/null-tools/CLAUDE.md` and the root `CLAUDE.md` are updated in the same change as the code; the wiki is synced afterwards with `/wiki-sync`.
17. **The detail tab is read-only, with one write.** No PR-level comment composer, no labels/reviewer editing (Phase 4), no review submit/merge in Phase 2. The Phase 2 write is *Re-run failed jobs*; Phase 3 adds the review and lifecycle actions (decisions 24–32). The page says so and offers *Open on GitHub*.
18. **No inline review threads on the detail page.** They stay in the diff editor (Phase 1). A review in the conversation shows its verdict, body and "n inline comments" with a link to GitHub. Outdated threads are not counted on the page (they stay in the tree tooltip).
19. **One tab per PR**, opened from the tree row (inline icon + context menu). It reloads on focus after 60 s and has a refresh button. Check-out from the tab runs the tree's own `null.pulls.checkout`.
20. **Checks come from `statusCheckRollup.contexts`** (first 100): `CheckRun`s and legacy `StatusContext`s, failures first, each with a link to GitHub's own log page (`detailsUrl` / `targetUrl`). No log fetching.
21. **Re-run failed jobs** posts `actions/runs/{id}/rerun-failed-jobs` once per distinct workflow run among failed rows. The host recomputes the run ids from the page it loaded; the webview sends no ids. GitHub refusals (run still running, token without Actions write) are shown verbatim in a toast.
22. **Filter = search qualifiers, kept per workspace.** States: Open (`is:open`), Merged (`is:merged`), Closed (`is:closed is:unmerged`), All. Persisted in `workspaceState` as `null.pulls.filter`; a stored value that does not parse falls back field by field. Label/milestone names containing `"`, `\` or a control character are never put in a query (and not offered).
23. **Merged/closed rows** get a merge / closed icon (purple / red) instead of the CI colour, and a filter that matches nothing shows its own welcome text with *Change Filters* / *Reset Filters*.
24. **Two buttons in the diff comment widget.** **Add Review Comment** (primary) puts the comment in the viewer's pending review, starting one on first use; **Comment Now** is the existing immediate post (renamed from *Comment*, behaviour unchanged). Pending comments carry the label `Pending` and are visible only to their author, as on github.com.
25. **The pending review is read from GitHub every time** (`ReviewState`), never kept in memory: a review submitted or deleted on github.com in the meantime cannot go stale. A viewer has at most one pending review per PR.
26. **Finish review = one QuickPick + one InputBox.** Choices: *Comment*, *Approve*, *Request changes* (the last two hidden on your own PR) and *Discard pending review* (only when one exists). The body is single-line (the InputBox's limit); it is required for *Request changes*, and for *Comment* when no comments are pending. With no pending review the chosen event submits a body-only review in one call.
27. **Resolve / Unresolve** is a button in the thread's title bar, offered only when GitHub's `viewerCanResolve` / `viewerCanUnresolve` says so. It takes effect at once and is not part of the review.
28. **Lifecycle actions live in the detail tab only**: *Review* / *Finish review (n)*, *Merge*, *Convert to draft* / *Ready for review*, *Close* / *Reopen*. *Finish review* and *Discard* are also on the tree row's context menu (`null.pulls.finishReview`), because that is where a review in the diff editors naturally ends. The webview sends only an action name; the host re-checks it against its own loaded `PullPage.actions` and supplies every id and sha.
29. **Merge** asks for a method only when the repository allows more than one, then shows a modal confirmation naming the PR, base and method. It sends `expectedHeadOid` = the head the page showed, so a push in between makes GitHub refuse. Default commit message (no editing), the head branch is not deleted by Null (the repository's own setting applies). Merge queues and auto-merge are not driven: GitHub's refusal is shown.
30. **Eligibility is advisory.** The page disables only what is certain: not open, draft (merge), merge conflicts, no write access, no merge method allowed, approving your own PR. Everything else GitHub refuses (required checks, branch protection, stale head) is shown verbatim in a toast, as in decision 9.
31. **Still no PR-level comment composer** and no edit/delete of comments (decision 17's list shrinks to those two). The tab's footer says conversation comments are written on GitHub.
32. **After every write** the tab reloads and the tree refreshes (`null.pulls.refresh`), so a merged or closed PR leaves the Open list and the state icon changes. A cancelled dialog changes nothing and only re-enables the buttons.

## Known limits of Phase 3

- The review body is a single-line InputBox.
- No PR-level comment composer and no edit or delete of comments (decision 31).
- Merge uses GitHub's default commit message, does not delete the head branch, and does not drive merge queues or auto-merge.
- Resolving a thread is immediate and is not part of the review.
- Outdated threads still cannot be replied to or resolved from the editor.
- The pending review is per viewer and per PR, found by asking GitHub each time (one extra request per action).

## Known limits of Phase 2

- The first 100 commits, 100 conversation items and 100 checks are shown; the page says when it is cut off. No paging yet.
- The filter pickers offer the first 100 labels and milestones.
- Filter facets combine with AND only: no free-text search, one label, one milestone.
- No inline review threads on the detail page (decision 18).
- No PR-level comment composer yet (decision 31).

## Phases

| Phase | Delivers | Plan |
|---|---|---|
| 1 — Review (#92) | Open-PR tree with CI/draft icon, changed files, native diff, inline review threads with reply and new line comments, checkout, open on GitHub | `docs/plans/pull-requests-phase1-review.md` |
| 2 — Detail & checks | PR detail webview (description, PR-level conversation, commits, reviewers, labels, milestone, check list with log links, rerun failed jobs); list filters/sorting (Open/Closed/Merged, mine, review requested, draft, label, milestone) by changing the search `q` | `docs/plans/pull-requests-phase2-detail-checks.md` |
| 3 — Review lifecycle & actions | Pending review (start → submit), approve / request changes, resolve threads, merge (method choice), close/reopen, draft ↔ ready | `docs/plans/pull-requests-phase3-review-lifecycle.md` |
| 4 — Authoring | Create PR from the current branch (prefill from an `issue-<n>` branch), edit title/body/base, reviewers, labels, update branch | later |
| 5 — Notifications | Review requested, new review comment, changes requested, approved, CI failure, merged/closed; configurable (`null.pulls.notifications.*`), polling reuses the issues-panel cadence | later |
| 6 — GitLab | Extract a `PullProvider` interface from the GitHub implementation, add a GitLab merge-request client (null-accounts already holds the tokens) | later |

Later phases get their own plan when they start (the repo's convention: `github-issues-panel-v2-phase*.md`), because their shape depends on what Phase 1 teaches.

## Mapping of #117's acceptance criteria

| Criterion | Phase |
|---|---|
| Pull Requests view, PRs for current repo | 1 |
| View changed files and diffs | 1 |
| View comments and review discussions | 1 (inline threads), 2 (PR-level conversation) |
| Add line comments / reply | 1 |
| Checkout PR branches | 1 |
| Support GitHub; integrate with account management; respect provider permissions | 1 (GitHub errors such as 403/422 are shown verbatim; token from null-accounts) |
| View PR details, commits | 2 |
| View CI/check status | 1 (summary icon), 2 (list + logs) |
| Manage labels, assign reviewers | 2 (read), 4 (write) |
| Approve, request changes, resolve conversations | 3 |
| Close/reopen, merge | 3 |
| Create/edit PR | 4 |
| Support GitLab | 6 |
| Notifications (optional in the issue) | 5 |

## Known limits of Phase 1 (each marked `ponytail:` in code)

- Lists the 50 most recently updated open PRs; no cursor paging.
- Review threads: first 100 threads, first 50 comments each; outdated threads (no current line) are not shown, only counted.
- Comments post immediately (no pending review) until Phase 3; no edit or delete.
- Only `origin` of the first folder; no `upstream`, no multi-root, nothing in remote or untrusted windows.
- No fake-GitHub test seam exists (`api.github.com` is hardcoded), so the integration spec covers registration, states and URI hardening, not PR data; the live check is manual.

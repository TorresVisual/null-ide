# Pull Requests — Design

Issues: **#92** (first slice, "GitHub Pull Requests in the Issues panel") and **#117** (umbrella, "Manage Pull Requests Inside Null IDE"). #92 is Phase 1 below; #117 stays open as the umbrella and its acceptance checklist is mapped onto the phases at the end.

## Decisions

1. **GitHub first, GitLab last.** The Issues panel is GitHub.com-only today (`github/githubApi.ts`, `githubAuth.ts`) and there is no GitLab client. A provider interface is not introduced until GitLab is actually built (Phase 6); Phases 1–5 call the GitHub client directly.
2. **Native surfaces, not a new webview.** The PR list is a `TreeView` (`null.pullsView`, in the `null-issues` activity-bar container under the Issues webview). A PR expands to its changed files; a file opens in the stock diff editor (`vscode.diff`). Line comments use the VS Code Comments API (`createCommentController`). This is what #117 asks for ("reuse the existing editor and diff viewer") and it is much smaller than rendering diffs in a webview. #92's "same webview architecture" is deliberately not followed for the list/diff; the one place a webview is justified is the PR detail page (Phase 2: description, conversation, checks), which reuses the issue-detail webview conventions.
3. **No git needed to read a PR.** File contents at the merge base and at the head commit come from the GitHub Contents API (`fetchRepoFile`, already used for issue images) through a `null-pr:` `TextDocumentContentProvider`. Only *checkout* touches git (`git fetch origin pull/<n>/head`, which also works for fork PRs).
4. **Left side = merge base.** GitHub diffs a PR from the merge base, not from the base branch tip; the merge base is read from `GET /compare/{base}...{head}`. `LEFT`-side comment lines refer to that version.
5. **Reuse** `githubSession.ts`/`githubAuth.ts` (token via null-accounts), `githubRemote.ts` (repo from `origin`), `requestGraphql`/`requestJson` (rate-limit-aware `ApiError`), `graph/gitRun.ts` (`makeRunGit`) and `graph/graphDiff.ts` (empty-document side).
6. **Code lives in `extensions/null-tools/src/pulls/`**, pure model/API files first, `vscode` glue in a few thin files, mirroring `src/graph/`.

## Phases

| Phase | Delivers | Plan |
|---|---|---|
| 1 — Review (#92) | Open-PR tree with CI/draft icon, changed files, native diff, inline review threads with reply and new line comments, checkout, open on GitHub | `docs/plans/pull-requests-phase1-review.md` |
| 2 — Detail & checks | PR detail webview (description, PR-level conversation, commits, reviewers, labels, milestone, check list with log links, rerun failed jobs); list filters/sorting (Open/Closed/Merged, mine, review requested, draft, label, milestone) by changing the search `q` | write when Phase 1 ships |
| 3 — Review lifecycle & actions | Pending review (start → submit), approve / request changes, resolve threads, merge (method choice), close/reopen, draft ↔ ready | later |
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
- Review threads: first 100 threads, first 50 comments each; outdated threads (no current line) are not shown.
- A multi-line selection comments on its first line only; comments post immediately (no pending review) until Phase 3.
- Fork PRs: the head commit is read through the base repo's Contents API (GitHub serves PR commits from the base repo's object store). If that proves false in manual verification (plan Task 6), the fallback is `git fetch origin pull/<n>/head` plus `git show`.

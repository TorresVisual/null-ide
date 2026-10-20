# GitHub Actions — Design

Status: implemented (plans: `docs/plans/github-actions.md`, `docs/plans/github-actions-logs.md`).

Issue: **#132** (GitHub Actions Integration). Builds on the Pull Requests work (#92, #117): same module shape, same GitHub client, same auth helpers.

Naming: the feature is called **workflows** in code (`null.workflows.*`, `src/workflows/`, `null-workflows:`) so nothing collides with the `null-actions` extension (status-bar buttons). The user-facing title is "GitHub Actions".

## Decisions

1. **Native, in null-tools.** New module `extensions/null-tools/src/workflows/`, mirroring `src/pulls/`: pure model files, a thin REST wrapper, then a few `vscode` glue files. No new extension; `GitHub.vscode-github-actions` is neither bundled nor required. Reason: null-accounts binds a *folder* to an account, so the token must come from that binding (`resolveGithubSession(api, folder.uri, …)`), where the official extension would use VS Code's one global GitHub session; and the feature must follow Null's own UI conventions. Sign-in is **not** the reason: patch 007 only changes the Accounts menu and leaves `vscode.authentication` intact. The official extension's concrete limitations were not inspected; if it turns out to cover the whole issue, revisit this decision.
2. **Its own activity-bar entry.** New container `null-workflows` (title "GitHub Actions", icon `media/github-actions.svg` + `-dark` variant, drawn like `github-issues.svg`) holding one tree view `null.workflowsView`. It is not placed in `null-issues` or `null-workspace`. A `nullWorkspace.features` entry (id `workflows`) lets the Features hub launch it.
3. **No status bar item.** Nothing is added to the status bar. (#96's HEAD-status idea never shipped and stays out of scope here.)
4. **GitHub only, REST only.** Everything uses `requestJson` from `github/githubApi.ts`. Runs, jobs, workflows and all mutations are REST. One new helper follows the single redirect of the job-log endpoint (see "Log redirect").
5. **Repos = every workspace folder whose `origin` is on github.com**, via `getWorkspaceGithubRepo`. Each qualifying folder is a root node `owner/repo` with its own Runs and Workflows groups; with exactly one qualifying folder the root node is omitted and its groups are the roots. Duplicate repos (two folders, same `origin`) are shown once, under the first folder.
6. **Tokens per folder.** Each folder's token comes from `resolveGithubSession(getAccountsApi(), folder.uri, false)`. `getGithubSession` in `githubAuth.ts` (hardcoded to the first folder) is not used and not changed. Silent calls never prompt: a folder without a session shows a root node with one child row, **Sign in to GitHub for this folder**, and only clicking it runs the interactive sign-in for that folder.
7. **Gating mirrors Pull Requests:** `classifyWorkspace` from `graph/graphMessages.ts`; nothing runs or polls in remote windows or untrusted workspaces. Whole-view state is the `null.workflows.state` context key with `viewsWelcome` content for the cases where no folder qualifies: `no-folder`, `remote`, `untrusted`, `not-a-repo`, `no-git`, `no-repo` (no `origin` on github.com), `error` (Try Again). Per-folder conditions (signed out, no workflows, API errors) are rows inside the tree, see "Error and empty handling". `ready` otherwise.
8. **Lazy and visibility-bound.** Nothing is fetched until the view is first shown; polling and refresh-on-focus (at most once a minute, like Pulls) only happen while the view is visible.
9. **No settings in v1.** No `null.workflows.*` or `null-workflows.*` configuration. Poll intervals and page size are constants; add a setting when there is a concrete need.
10. **Dependency: `yaml`.** Added to null-tools `dependencies` (zero-dependency YAML 1.2 parser). CI copies each extension folder including `node_modules`, so no bundling change is needed. The plan includes a size check of the shipped extension.

## Surfaces

### The tree (`null.workflowsView`)

Per repo, two groups:

- **Runs.** The 30 most recent runs (`GET /repos/{o}/{r}/actions/runs?per_page=30`), subject to the filter. Row: status icon, run title (`display_title`), description `branch · short-sha · event · duration · #run_number`, plus ` · attempt N` only when the attempt is above 1. The run for the checked-out branch is marked. A run expands to its **jobs** (`GET …/runs/{id}/jobs`), a job expands to its **steps** (from the job payload; no extra request). Failed jobs and steps carry the error icon, and a failed run's failed jobs expand automatically. A **Load more** row at the end fetches the next page.
- **Workflows.** `GET …/actions/workflows` (first 100; the group description says "first 100" when more exist). Row: workflow name, description its path. **Open workflow file** opens the YAML in the folder when `<folder>/<path>` exists, otherwise the file from the Contents API (`fetchRepoFile`) as a read-only document. **Disabled** workflows (`state` other than `active`) show dimmed with description "disabled" and an **Enable workflow** action (`PUT …/workflows/{id}/enable`, modal-confirmed); dispatch and re-run are hidden for them. Workflows that are active and dispatchable get **Run workflow** (see "Detecting `workflow_dispatch`").

Status icons (ThemeIcon + theme colour): queued/waiting/pending (clock), in progress (spinning sync), success (pass), failure/timed_out/startup_failure (error), cancelled (circle-slash), skipped/neutral (debug-step-over), action_required (warning). One pure function over `status` + `conclusion` so run, job and step rows agree.

### Filter

A title-bar button opens one menu, stored in `workspaceState` as `null.workflows.filter` and applied to every repo: **Current branch** (per repo, from its own checked-out branch), **My runs** (`actor` = the session's login), **Failed only** (`status=failure`), **Workflow** (picked from the repo's workflows; also reachable as **Filter runs by this workflow** in a workflow row's context menu), and **Reset**. An active filter is shown in `view.description`. There is no separate "show runs of this workflow" mode; it is this filter value.

### Logs

- A `null-workflows:` `TextDocumentContentProvider` (like `null-pr:`) serves read-only log documents, **one tab per job**, reused when the same job is opened again. URIs are built and validated by one pure file (`workflowLogDocs.ts`) so a hostile URI cannot name another repo or a path outside `owner/repo/jobId`.
- Opening a **job** shows the whole job log; opening a **step** shows that step's segment, found by the `##[group]` / step markers. If segments cannot be matched, the step opens the full job log at the nearest step heading, never an error.
- Timestamps GitHub prefixes to each line are stripped (step rows show durations from the job payload); `##[error]` lines are kept; `##[group]` lines become `▶ title`.
- **Size:** logs over 5 MB are cut from the front, and line 1 becomes "Log truncated (showing last 5 MB). Open on GitHub for the full log." as a link to the job's page.
- **Failure inspection:** **Show failure log** on a failed run/job opens the first failed step's log. `##[error]` lines and annotation paths (`path:line`, `path(line,col)`, relative to the repo root) become document links through a `DocumentLinkProvider` for the scheme; a link opens the workspace file at that line when it exists inside the folder. Paths that do not resolve inside the folder are not linked.
- **Live logs are best-effort until verified.** GitHub's docs do not say whether the job-log endpoint serves a growing log for a job that is still running (the `gh` CLI refuses before asking), and this is unproven. The design therefore does not depend on it. While a job is queued or in progress the log document shows the job's steps with status and duration from the job payload, refreshed on the normal poll, and appends log text if the endpoint returns any. A 404 or empty answer shows "Logs appear when the job finishes" and is retried on the poll. The document fires `onDidChange` on each refresh; polling stops when the job completes or the document closes. **Observed (2026-10-20, `actions-playground.yml`):** while a job was in progress, `GET …/jobs/{id}/logs` answered 302 with a signed URL on `productionresultssa11.blob.core.windows.net`; the signed URL itself returned 404 (a 215-byte XML error) on all three samples taken 8 s apart during the 30 s "Slow output" step, so no partial log is available. The log document therefore shows the steps and "Logs appear when the job finishes." until the job completes.

### Management actions

Context-menu and inline buttons, shown by `when` clauses on `viewItem` values the tree sets from the row's own state; the host **re-reads the run** before acting and refuses (with the reason) if the state changed, like `runAction` in `pulls/`.

| Action | Endpoint | Offered when | Confirm |
|---|---|---|---|
| Re-run all jobs | `POST …/runs/{id}/rerun` | run completed | modal |
| Re-run failed jobs | `POST …/runs/{id}/rerun-failed-jobs` | run completed with a failed job | no |
| Re-run job | `POST …/jobs/{id}/rerun` | job completed | no |
| Cancel run | `POST …/runs/{id}/cancel` | run queued/in progress | modal |
| Run workflow | `POST …/workflows/{id}/dispatches` | workflow active and dispatchable | inputs flow |
| Enable workflow | `PUT …/workflows/{id}/enable` | workflow disabled | modal |
| Open on GitHub | `vscode.env.openExternal` | always | no |

- **Run workflow:** QuickPick of the repo's branches from the API (`GET …/branches`, first 100), the current branch first when it exists on the remote, and any typed ref accepted (so a tag or a branch beyond 100 works). Then one InputBox (QuickPick for `choice`, boolean pick for `boolean`) per `workflow_dispatch` input, read from the workflow YAML at the chosen ref (`fetchRepoFile`). Required inputs are enforced; defaults are prefilled. After a 204 the tree refreshes after 3 s (GitHub does not return the new run id) and polls.
- API refusals (409 already running, 403 no write permission or Actions disabled, 422 workflow lacks the trigger) are shown verbatim in a toast; the tree refreshes either way.

### Pull request integration

The PR detail tab already lists checks with status and a link and offers *Re-run failed jobs*. This work adds only: for a check that belongs to a workflow run (the model already carries `runId`), a **Show in GitHub Actions** link that reveals the run in `null.workflowsView` (command `null.workflows.revealRun` with owner, repo and run id) and, for failed checks, a **Show failure log** link. Nothing else in `pulls/` changes, apart from the PR detail HTML builders and their tests. The reveal fetches the run by id if it is not among the loaded ones and shows it under a "Pinned" row until the next refresh.

## Data flow, refresh and polling

- `WorkflowsTreeProvider` owns the loaded runs/workflows per repo and the whole-view state; `getChildren` only fetches when expanding a run or job.
- **Polling** uses one shared timer, runs only while the view is visible, and only for repos that currently have a `queued`/`in_progress`/`waiting` run (jobs of expanded in-progress runs, and an open log's job, ride the same tick). Interval 10 s; once a run has been active for over 10 minutes the interval backs off to 30 s. A rate-limit `ApiError` suspends polling until its `retryAt` and shows the reset time in `view.message`; other errors back off 10 s → 30 s → 60 s and the repo's root shows an error row after three failures. The token is shared with Pull Requests and Issues, so the cap matters.
- Refresh on window focus (max once a minute), on `null.workflows.refresh`, and after any action. Branch changes (`vscode.git` change event) only re-mark the current-branch run; they never refetch.

## Error and empty handling

Per-folder conditions are rows inside that folder's node, so one failing repo does not blank the others.

| Situation | Behaviour |
|---|---|
| No session | Root node for the folder with the **Sign in to GitHub for this folder** row; never a silent empty tree |
| 401 | Same sign-in row (token stale) |
| 403, rate limit | `view.message` with the reset time; polling suspended |
| 403 (permission) on an action | toast: needs write access / Actions permission; tree refreshed |
| 404 on logs | "Logs are no longer available (GitHub keeps them 90 days) or you lack access." |
| 404 on the repo | Error row: the repo is private and the account has no access, or it was renamed |
| Network failure | Error row with Try Again (whole-view `error` when it is the only repo) |
| Repo with Actions but zero workflows | Row "No workflows yet" with **Create workflow**, which reveals `.github/workflows/` in the explorer when it exists |
| Run with zero jobs yet (just queued) | Row shows "Waiting for jobs…" and is polled |

## Files

`src/workflows/` (pure unless noted): `workflowsModel.ts` (status mapping, durations, row descriptions, tree shaping, action eligibility, filter → query), `workflowsApi.ts` (REST wrappers over `requestJson`; `fetchJobLog` follows the log redirect), `jobLog.ts` (strip timestamps, split steps, extract annotations/paths, front-truncate), `workflowLogDocs.ts` (URI build/validate), `dispatchInputs.ts` (parse `workflow_dispatch` inputs with `yaml`), and `vscode` glue: `workflowsTreeView.ts`, `workflowLogProvider.ts`, `workflowCommands.ts` (QuickPick/InputBox/modal flows, filter menu), `workflowsIntegration.ts` (registration, polling, state key; `registerWorkflowsFeature` called from `extension.ts` next to `registerPullsFeature`). Only the glue files import `vscode`.

## Log redirect

`GET /repos/{o}/{r}/actions/jobs/{id}/logs` answers 302 with a signed URL on another host that expires after about a minute. The existing `request()` does not follow redirects and sends the token on every request. `fetchJobLog` makes the first call, reads `Location`, and requests it at once with **no** `Authorization` header (never forward the token cross-host), a 30 s timeout and a 5 MB cap (front-truncated, see Logs). Run-level log archives (`…/runs/{id}/logs`, a zip) are not used.

## Detecting `workflow_dispatch`

The workflows API does not say which workflows are dispatchable. Per refresh of a Workflows group the host reads each active workflow file (`fetchRepoFile` at the default branch, in parallel, max 20) and parses it with `yaml`: `on` may be a string, a list or a map, and the key may parse as boolean `true` under YAML 1.1 rules, so `dispatchInputs.ts` checks both `on` and `true`. `inputs` yields name, `description`, `required`, `default`, `type`, `options`. A file that cannot be read or parsed means "not dispatchable" for that workflow — the action is hidden, not an error. Inputs are read again at the *chosen ref* when a dispatch starts.

## Testing

- Unit (`npm test`; every new file added to the explicit list in `package.json`): `workflowsModel`, `jobLog` (real-shaped fixtures: groups, errors, timestamps, a 5 MB+ log), `workflowLogDocs` (rejects traversal and foreign repos), `dispatchInputs` (string/list/map `on:`, anchors, each input type, garbage), `workflowsApi` against `httpStub.ts` (log redirect without the auth header, rate-limit `ApiError`, rerun/cancel/dispatch/enable paths and bodies).
- Integration (`npm run test:integration` via `/verify-local null-tools`): the test seam `_null.workflows.snapshot` returns `{ state, repos: [{ runs, workflows }] }`; the spec checks the container and view are contributed, the welcome states for an untrusted/non-GitHub folder, and the command set. It makes no live GitHub calls.
- **Manual verification workflow:** the plan adds a temporary `.github/workflows/actions-playground.yml` (`workflow_dispatch` with a string, a choice and a boolean input; a short job that sleeps and prints grouped output; a step that fails when told to). It needs no secrets and finishes in under a minute; it exercises input parsing, live logs, failure inspection, cancel and re-run, and is deleted after verification.
- `featureManifests.test.ts` already checks every `nullWorkspace.features` command exists. The plan also updates `extensions/null-tools/CLAUDE.md`, the root `CLAUDE.md` extension notes where they list null-tools features, and the wiki (`/wiki-sync`).

## Out of scope

GitLab CI; editing or validating workflow YAML (language tooling covers it); artifacts, caches, secrets, variables, environments, deployment approvals; a status bar item; settings; webhooks or any push channel (polling only).

### Known limits

- Only the first 100 workflows of a repo are listed.
- Step segmentation of a job log is a marker heuristic validated against logs captured from a real run (`realLog.fixture.ts`); when it cannot place a step it falls back to the full log.
- Live logs: GitHub serves nothing for a running job (observed above), so a running job shows its steps and "Logs appear when the job finishes."

## Acceptance mapping (#132)

| Criterion | Where |
|---|---|
| Browse runs | Runs group per repo, filter, Load more |
| Run details, jobs, steps, logs | run → job → step rows, `null-workflows:` log documents |
| Monitor running, failure information | polling, auto-expanded failures, Show failure log, error-line links; live logs best-effort pending verification |
| Management actions | re-run all/failed/job, cancel, dispatch, enable |
| PR checks | existing PR detail checks + reveal-in-Actions and failure-log links |
| Discover and open workflow files | Workflows group |
| Auth, permission, API failure handling | per-folder sign-in row, state keys, error table |
| Existing functionality preserved | `GitHub.vscode-github-actions` untouched; PR re-run unchanged |
| Null conventions | own activity-bar container, pure/glue split, tracked `out/` |

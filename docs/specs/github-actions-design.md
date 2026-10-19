# GitHub Actions — Design

Issue: **#132** (GitHub Actions Integration). Builds on the Pull Requests work (#92, #117): same module shape, same GitHub client, same auth.

## Decisions

1. **Native, in null-tools.** New module `extensions/null-tools/src/actions/`, mirroring `src/pulls/`: pure model files, a thin REST wrapper, then a few `vscode` glue files. No new extension, and `GitHub.vscode-github-actions` is neither bundled nor required. Reasons: Null's patch 007 hides VS Code's GitHub auth sessions (that extension signs in through them), and the feature must use null-accounts. Not verified on a Null build; revisit only if the official extension is shown to work there.
2. **Its own activity-bar entry.** New container `null-workflows` (title "GitHub Actions", icon `media/github-actions.svg` + `-dark` variant, drawn like `github-issues.svg`) holding one tree view `null.actionsView`. It is not placed in `null-issues` or `null-workspace`. The view id is registered in a `nullWorkspace.features` entry so the hub launches it.
3. **No status bar item.** Nothing is added to the status bar. (#96's HEAD-status item is out of scope for this issue.)
4. **GitHub only, REST only.** Everything uses `requestJson` from `github/githubApi.ts`. GraphQL is not needed; runs, jobs, workflows and all mutations are REST. One new helper follows the single redirect of the job-log endpoint (see "Log redirect").
5. **Repo = `origin` of the first workspace folder**, via `getWorkspaceGithubRepo`. Multi-root workspaces use the first folder; the tree title shows `owner/repo` so this is visible. Satisfies "respect the active repository context" with the same limit as Pull Requests.
6. **Gating mirrors Pull Requests:** `classifyWorkspace` from `graph/graphMessages.ts`; nothing runs or polls in remote windows, untrusted workspaces, folders without a git repo, or `origin`s not on github.com. State is the `null.actions.state` context key with `viewsWelcome` content: `no-folder`, `remote`, `untrusted`, `not-a-repo`, `no-git`, `no-repo`, `signed-out` (Sign in button), `error` (Try Again), `no-workflows`, `ready`.
7. **Lazy and visibility-bound.** Nothing is fetched until the view is first shown; polling and refresh-on-focus (at most once a minute, like Pulls) only happen while the view is visible.

## Surfaces

### The tree (`null.actionsView`)

Two root groups:

- **Runs.** The 30 most recent runs of the repo (`GET /repos/{o}/{r}/actions/runs?per_page=30`). Row: status icon, run title (`display_title`), description `branch · short-sha · event · duration`. The run for the checked-out branch is marked. A run expands to its **jobs** (`GET …/runs/{id}/jobs`), a job expands to its **steps** (from the job payload; no extra request). Failed jobs and steps are marked with the error icon, and a failed run's failed jobs expand automatically.
- **Workflows.** `GET …/actions/workflows`, active ones. Row: workflow name, description its path. **Open workflow file** opens the YAML in the workspace when `<folder>/<path>` exists, otherwise the file from the Contents API through the existing read-only content approach (`fetchRepoFile`). Workflows whose YAML has a `workflow_dispatch` trigger (see "Detecting workflow_dispatch") get **Run workflow**. Per-workflow run history is a context action, **Show runs** (`…/workflows/{id}/runs`), which replaces the Runs list until **Reset** is pressed.

Status icons (ThemeIcon + theme colour) for: queued/waiting/pending (clock), in progress (spinning sync), success (pass), failure/timed_out/startup_failure (error), cancelled (circle-slash), skipped/neutral (debug-step-over), action_required (warning). The mapping is one pure function over `status` + `conclusion` so run, job and step rows agree.

### Logs

- A `null-actions:` `TextDocumentContentProvider` (like `null-pr:`) serves read-only log documents. URIs are built and validated by one pure file (`actionLogDocs.ts`) so a hostile URI cannot name another repo or a path outside `owner/repo/jobId`.
- Opening a **job** shows the whole job log; opening a **step** shows that step's segment, found by the `##[group]` / step markers in the job log. If segments cannot be matched, the step opens the full job log scrolled to the nearest step heading, never an error.
- Timestamps GitHub prefixes to each line are stripped, `##[error]` lines are kept, `##[group]` lines become `▶ title`.
- **Live logs:** while the job is queued or in progress, the open document re-fetches every 5 s and fires `onDidChange` (VS Code keeps the scroll position for a virtual document; the editor follows the end only when the user is already at the end). It stops when the job completes, the document closes, or the view is hidden and no log is open.
- **Failure inspection:** **Show failure log** on a failed run/job opens the first failed step's log. Lines of the form `##[error]…`, or GitHub annotation paths (`path:line` / `path(line,col)` relative to the repo root) become document links through a `DocumentLinkProvider` for the scheme; the link opens the workspace file at that line when it exists. Paths that do not resolve inside the first folder are not linked.

### Management actions

Context-menu and inline buttons, shown by `when` clauses on `viewItem` values the tree sets from the row's own state; the host **re-reads the run** before acting and refuses (with the reason) if the state changed, like `runAction` in `pulls/`.

| Action | Endpoint | Offered when |
|---|---|---|
| Re-run all jobs | `POST …/runs/{id}/rerun` | run completed |
| Re-run failed jobs | `POST …/runs/{id}/rerun-failed-jobs` | run completed with a failed job |
| Re-run job | `POST …/jobs/{id}/rerun` | job completed |
| Cancel run | `POST …/runs/{id}/cancel` | run queued/in progress |
| Run workflow | `POST …/workflows/{id}/dispatches` | workflow has `workflow_dispatch` |
| Open on GitHub | `vscode.env.openExternal` | always |

- Cancel and re-run-all confirm in a modal; re-run-failed and job re-run do not.
- **Run workflow:** QuickPick of branches (default: current branch), then one InputBox (or QuickPick for `choice`, boolean pick for `boolean`) per `inputs` entry of `workflow_dispatch`, read from the workflow YAML at the chosen ref (`fetchRepoFile`). Required inputs are enforced; defaults are prefilled. After a 204 the tree refreshes on a 3 s delay (GitHub does not return the new run id) and polls.
- API refusals (409 already running, 403 no write permission or Actions disabled, 422 workflow lacks the trigger) are shown verbatim in a toast; the tree refreshes either way.

### Pull request integration

The PR detail tab already lists checks with status and a link and offers *Re-run failed jobs*. This work adds only: for a check that belongs to a workflow run (the model already carries `runId`), a **Show in GitHub Actions** link that reveals the run in `null.actionsView` (command `null.actions.revealRun` with the run id) and a **Show failure log** link for failed checks. Nothing else in `pulls/` changes. The reveal fetches the run by id if it is not among the 30 loaded, and shows it at the top under a "Pinned" row until the next refresh.

## Data flow, refresh and polling

- `ActionsTreeProvider` owns the loaded runs/workflows and the state; the view (`getChildren`) never fetches on its own except to expand a run/job.
- Polling: while any run in the list is `queued`/`in_progress`/`waiting` **and** the view is visible, refresh the runs list every 10 s (jobs of expanded in-progress runs with it). Stop when none is active or the view is hidden. A rate-limit `ApiError` suspends polling until its `retryAt` and shows the reset time in `view.message`; other errors back off 10 s → 30 s → 60 s and set `error` after three failures.
- Refresh on window focus (max once a minute), on `null.actions.refresh`, and after any action. Branch changes (`vscode.git` change event) only re-mark the current-branch run; they never refetch.
- Pagination: only the first page of runs is loaded; a **Load more** row at the end of Runs fetches the next page (`page=2…`). Workflows load up to 100 (one page), enough for the realistic case; if more exist the group description says "first 100".

## Error and empty handling

| Situation | Behaviour |
|---|---|
| No token / 401 | `signed-out` welcome with Sign in (null-accounts), never a silent empty tree |
| 403, rate limit | `view.message` with the reset time; polling suspended |
| 403 (permission) on an action | toast: needs `actions: write` / repo write access; tree refreshed |
| 404 on logs | "Logs are no longer available (GitHub keeps them 90 days) or you lack access." |
| 404 on the repo | `no-repo`-style message: the repo is private and the account has no access, or it was renamed |
| Network failure | `error` state with Try Again |
| Repo with Actions but zero workflows | `no-workflows` welcome, with **Create workflow** opening `.github/workflows/` in the explorer when it exists |
| Run with zero jobs yet (just queued) | Row shows "Waiting for jobs…" and is polled |

## Files

`src/actions/` (pure unless noted): `actionsModel.ts` (status mapping, durations, row descriptions, tree shaping, action eligibility), `actionsApi.ts` (REST wrappers over `requestJson`; `fetchRunLog` follows the log redirect), `jobLog.ts` (strip timestamps, split steps, extract annotations/paths), `actionLogDocs.ts` (URI build/validate), `dispatchInputs.ts` (parse `workflow_dispatch` inputs from YAML), and `vscode` glue: `actionsTreeView.ts`, `actionLogProvider.ts`, `actionCommands.ts` (QuickPick/InputBox/modal flows), `actionsIntegration.ts` (registration, polling, state key; `registerActionsFeature` called from `extension.ts` next to `registerPullsFeature`). Only the glue files import `vscode`.

## Log redirect

`GET /repos/{o}/{r}/actions/jobs/{id}/logs` answers 302 with a short-lived signed URL on another host. The existing `request()` does not follow redirects and sends the token on every request. The new `fetchRunLog` makes the first call, reads `Location`, and requests it with **no** `Authorization` header (never forward the token cross-host), a 30 s timeout and a 5 MB cap (larger logs are truncated from the front with a notice line, since the failure is almost always at the end). Run-level log archives (`…/runs/{id}/logs`, a zip) are not used.

## Detecting `workflow_dispatch`

The workflows API does not say which workflows are dispatchable. The host reads each workflow file once per refresh of the Workflows group (`fetchRepoFile` at the default branch, in parallel, max 20) and checks the `on:` key (string, list, or map containing `workflow_dispatch`) with a small tolerant parser in `dispatchInputs.ts`. A failure to read or parse a file means "not dispatchable" for that workflow — the action is hidden, not an error. A real YAML dependency is not added: only `on:` and the `inputs:` block (name, `description`, `required`, `default`, `type`, `options`) are read, and the parser's tested ceiling is the ordinary block-style files GitHub's own templates produce; flow-style `on: { workflow_dispatch: … }` is supported for the simple case and anything else degrades to "no inputs", which the dispatch POST still accepts.

## Testing

- Unit (`npm test`, files added to the explicit list in `package.json`): `actionsModel`, `jobLog` (incl. real-shaped log fixtures with groups, errors, timestamps), `actionLogDocs` (rejects traversal and foreign repos), `dispatchInputs` (string/list/map `on:`, inputs of each type, garbage), `actionsApi` against `httpStub.ts` (log redirect without the auth header, rate-limit `ApiError`, rerun/cancel/dispatch paths and bodies).
- Integration (`npm run test:integration` via `/verify-local null-tools`): the test seam `_null.actions.snapshot` returns `{ state, runs, workflows }`; the spec checks the container and view are contributed, the welcome states for an untrusted/non-GitHub folder, and the command set. Live GitHub calls are not made by the spec.
- `featureManifests.test.ts` already checks every `nullWorkspace.features` command exists.

## Out of scope

GitLab CI; editing or validating workflow YAML (language tooling covers it); artifacts, caches, secrets, variables, environments, deployment approvals; multi-root repository switching; a status bar item; webhooks or any push channel (polling only).

## Acceptance mapping (#132)

| Criterion | Where |
|---|---|
| Browse runs | Runs group, Load more |
| Run details, jobs, steps, logs | run → job → step rows, `null-actions:` log documents |
| Monitor running, failure information | polling, auto-expanded failures, Show failure log, error-line links |
| Management actions | re-run all/failed/job, cancel, dispatch |
| PR checks | existing PR detail checks + reveal-in-Actions and failure-log links |
| Discover and open workflow files | Workflows group |
| Auth, permission, API failure handling | state keys and error table |
| Existing functionality preserved | `GitHub.vscode-github-actions` untouched; PR re-run unchanged |
| Null conventions | own activity-bar container, pure/glue split, tracked `out/` |

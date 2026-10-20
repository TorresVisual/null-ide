# GitHub Actions Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** In `null-tools`, add a native "GitHub Actions" activity-bar view (#132) that browses workflow runs, jobs, steps and workflows per workspace repo, opens job/step logs as read-only documents, follows running jobs by polling, and offers re-run / cancel / dispatch / enable, plus two links from the PR detail tab's checks.

**Architecture:** A new `src/workflows/` module that mirrors `src/pulls/`: pure model files (`workflowsModel`, `workflowsApi` over `requestJson`, `jobLog`, `workflowLogDocs`, `dispatchInputs`) that are unit-tested with `node:test`, and a few `vscode` glue files (`workflowsTreeView`, `workflowLogProvider`, `workflowCommands`, `workflowsIntegration`). Tokens come per folder through `resolveGithubSession`; the job-log endpoint's single redirect is followed by hand without forwarding the token.

**Tech Stack:** TypeScript (commonjs), `node:test` with a mocked `https.request`, VS Code TreeView / TextDocumentContentProvider / DocumentLinkProvider / QuickPick, GitHub REST, `yaml` (new dependency).

**Spec:** `docs/specs/github-actions-design.md` (decisions 1–10, Surfaces, Log redirect, Detecting `workflow_dispatch`). Read it first; this plan does not repeat its rationale.

> **Status:** Tasks 2, 3, 5, 6, 7, 8 and 10 are done. Tasks 1 (the probe and fixtures), 4 and 9 are superseded by `docs/plans/github-actions-logs.md`; run that next. Tasks 11 and 12 below stay valid and follow it.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Everything lives in `extensions/null-tools`; run all commands from that directory (`cd extensions/null-tools`) unless a step says otherwise.
- Naming: `workflows` in code (`null.workflows.*`, `src/workflows/`, `null-workflows:`), never `actions` (collides with the `null-actions` extension). User-facing title: "GitHub Actions".
- GitHub only, REST only, `requestJson` from `github/githubApi.ts`. No new extension, no settings (`null.workflows.*` / `null-workflows.*` configuration is out), no status bar item.
- Tokens per folder: `resolveGithubSession(getAccountsApi(), folder.uri, false)`. `getGithubSession` (first folder only) is not used and not changed. Silent calls never prompt; only an explicit click (sign-in row, or a write action) may use `interactive: true`.
- Gating mirrors Pull Requests: `classifyWorkspace` from `graph/graphMessages.ts`; nothing runs or polls in remote windows or untrusted workspaces. Nothing is fetched until the view is first shown; polling and focus-refresh (max once a minute) only while the view is visible.
- Only the glue files import `vscode`: `workflowsTreeView.ts`, `workflowLogProvider.ts`, `workflowCommands.ts`, `workflowsIntegration.ts`.
- `out/` and `lib/*.js` are tracked build output; never hand-edit them. Intermediate tasks stage only the source files they name (running `npm test` rewrites `out/`; leave that dirty). Task 12 runs `npm run compile` and commits the refreshed output as `chore: refresh null-tools compiled output`.
- Every new `*.test.ts` must be added to **both** `tsconfig.json`'s `include` and the explicit `node --test` list in `package.json`'s `test` script, or it is silently skipped. A new `src/test/suite/*.spec.ts` goes into `tsconfig.json`'s `include` only (the integration runner globs `*.spec.js`).
- Commit style: `feat(null-tools): …` / `test(null-tools): …` / `docs: …`. Do not push (Task 1 asks the user to push; do not do it yourself).
- Log limits from the spec: 5 MB cap cut from the front, 30 s timeout, signed log URL requested with **no** `Authorization` header. Polling: 10 s, 30 s once a run is active over 10 minutes; errors back off 10 → 30 → 60 s; a rate-limit `ApiError` suspends polling until its `retryAt`.

## Review Focus

Inputs and conditions the spec implies but a happy-path test would miss, most likely first. Each has a pinned test in the task named in brackets:

1. **A hostile `null-workflows:` URI** (`..` owner, extra path segments, non-numeric job id, foreign repo, `step=abc`) must never reach the network; the provider answers with an empty document. [Task 5 `parseLogDoc rejects…`; Task 7 integration spec]
2. **The signed log URL on another host must never receive the token**, and a missing `Location` header, a non-https `Location`, a 404, or a 6 MB body must each end in a clear result (error text or front-truncation), not a hang or a crash. [Task 3 `fetchJobLog…`]
3. **Logs that do not look like the happy path**: no timestamps, `\r\n` line endings, `##[group]` nesting, empty log, a log whose segment count does not match the job's steps (skipped steps), a step number that does not exist. A step must fall back to the full log at the nearest heading, never an error. [Task 4 `locateStep…`, `cleanLog…`, `renderJobDoc…`]
4. **Workflow YAML shapes**: `on:` as string / list / map, `on:` with no inputs (`workflow_dispatch:` is `null`), anchors/aliases, `inputs` entries that are not maps, a choice without options, garbage and empty text. None may throw; an unreadable file means "not dispatchable". [Task 6]
5. **State changed between render and click**: a run that finished while its Cancel button was on screen, a job re-run offered for a job still running, and the same repo open as two workspace folders (shown once, under the first folder). The host re-reads before acting and refuses with the reason. [Task 2 `refusal…`, `dedupeRepos`; Task 10]

---

### Task 1: Probe the live-log endpoint and capture a real log

The spec says the whole log-streaming design hinges on one unproven fact: whether `GET …/actions/jobs/{id}/logs` serves a growing log while the job runs. This task answers that with the real API and saves a real log as a test fixture. It has no code; it ends with a spec edit.

**Files:**
- Create: `.github/workflows/actions-playground.yml` (temporary; deleted in Task 12)
- Modify: `docs/specs/github-actions-design.md` (record the observation under "Logs", bullet "Live logs are best-effort until verified")
- Create: `extensions/null-tools/src/workflows/realLog.fixture.ts` (captured log, used by Task 4)

- [ ] **Step 1: Create the playground workflow** — `.github/workflows/actions-playground.yml`:

```yaml
name: Actions Playground
on:
  workflow_dispatch:
    inputs:
      who:
        description: Who to greet
        required: true
        default: world
        type: string
      flavor:
        description: Pick one
        type: choice
        options: [vanilla, chocolate]
        default: vanilla
      fail:
        description: Fail the last step
        type: boolean
        default: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Greet
        run: echo "hello ${{ inputs.who }} (${{ inputs.flavor }})"
      - name: Slow output
        run: |
          echo "::group::Counting"
          for i in 1 2 3 4 5 6; do echo "tick $i"; sleep 5; done
          echo "::endgroup::"
      - name: Warn and error
        run: |
          echo "::warning file=src/a.ts,line=3,col=4::Something odd"
          echo "src/a.ts(3,4): error TS2304: Cannot find name 'x'."
      - name: Maybe fail
        if: ${{ inputs.fail }}
        run: |
          echo "::error::Told to fail"
          exit 1
  second:
    runs-on: ubuntu-latest
    steps:
      - run: echo "second job"
```

- [ ] **Step 2: Ask the user to push it.** The workflow file must exist on the repo's default branch before it can be dispatched, and this plan never pushes. Stop and ask: "Please commit and push `.github/workflows/actions-playground.yml` to the default branch (or tell me a branch that is allowed), then say when it is on GitHub." Commit it first:

```bash
git add .github/workflows/actions-playground.yml
git commit -m "chore: add temporary actions playground workflow for #132"
```

- [ ] **Step 3: Dispatch it and probe mid-run.** Use the `gh` CLI (authenticated) and curl, so the probe does not depend on the code being built:

```bash
gh workflow run actions-playground.yml -f who=probe -f fail=true
sleep 8
RUN=$(gh run list --workflow actions-playground.yml --limit 1 --json databaseId -q '.[0].databaseId')
JOB=$(gh api repos/TorresVisual/null-ide/actions/runs/$RUN/jobs -q '.jobs[] | select(.name=="build") | .id')
echo "run=$RUN job=$JOB"
# While "Slow output" is running (about 30 s window): ask for the log by hand.
curl -s -i -H "Authorization: Bearer $(gh auth token)" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/TorresVisual/null-ide/actions/jobs/$JOB/logs | head -20
```

Record: the status code (302 / 404 / other), and — following the `Location` header with a second `curl -s -i "<location>"` (no auth header) — whether the body contains the lines printed so far (`tick 1`…) or is empty/404. Repeat once more 10 s later to see whether the body grows. Also record the `Location` host.

- [ ] **Step 4: Capture the finished log.** After the run completes (it fails on purpose), save the log:

```bash
curl -s -L -H "Authorization: Bearer $(gh auth token)" https://api.github.com/repos/TorresVisual/null-ide/actions/jobs/$JOB/logs -o /tmp/real-job.log
```

(`-L` here is only for capture; it forwards the header cross-host, which the product code must never do.) Open `/tmp/real-job.log` and check these assumptions that Task 4's step segmentation depends on, writing down any that are wrong:
1. Every line starts with an ISO timestamp and a space (`2026-…Z `).
2. Each `run:`/`uses:` step begins with a `##[group]Run …` line followed later by `##[endgroup]`.
3. Post steps begin with a plain `Post job cleanup.` line; the last step begins with `Cleaning up orphan processes`.
4. The first step ("Set up job") has no `##[group]Run` marker.
5. `::group::Counting` appears as `##[group]Counting`.
6. A skipped step (the `Maybe fail` step in a run with `fail=false`) writes nothing.
7. `##[error]Told to fail` and `##[error]Process completed with exit code 1.` appear for the failing step.

Dispatch once more with `-f fail=false` and capture it too if item 6 needs the skipped-step check.

- [ ] **Step 5: Save the fixture.** Create `src/workflows/realLog.fixture.ts` exporting the captured text (the failing run's log, trimmed to the lines needed, keeping timestamps) and the job's steps from `gh api repos/TorresVisual/null-ide/actions/jobs/$JOB -q '.steps'`:

```ts
'use strict';

// Captured from a real run of .github/workflows/actions-playground.yml (Task 1 of the GitHub Actions plan).
export const REAL_LOG = [
  // paste the captured lines here, one string per line, timestamps included
].join('\n');

export const REAL_STEPS: Array<{ number: number; name: string; status: string; conclusion: string | null }> = [
  // paste from `gh api …/jobs/$JOB -q '.steps'` (number, name, status, conclusion)
];
```

If the real log contradicts an assumption in item 1–7, note the correction at the top of the fixture file; Task 4 adapts `STEP_MARKER` to it.

- [ ] **Step 6: Record the observation in the spec.** Replace the sentence "**The first task of the plan runs the playground workflow and records what the endpoint returns mid-run**; the log-streaming code is built to that observation." in `docs/specs/github-actions-design.md` with a short "Observed (YYYY-MM-DD): …" paragraph stating the status, whether mid-run text was returned, and whether it grew. If the endpoint **does** serve a growing log, Task 9's live refresh keeps appending log text; if it does not, nothing changes (the design already does not depend on it).

- [ ] **Step 7: Commit**

```bash
git add docs/specs/github-actions-design.md extensions/null-tools/src/workflows/realLog.fixture.ts
git commit -m "docs: record live-log probe result for GitHub Actions (#132)"
```

(`realLog.fixture.ts` is compiled only if a test imports it; Task 4 does, and adds it to `tsconfig.json`.)

---

### Task 2: Workflows model (pure)

**Files:**
- Create: `extensions/null-tools/src/workflows/workflowsModel.ts`
- Create: `extensions/null-tools/src/workflows/workflowsModel.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Produces (`workflowsModel.ts`), all later tasks rely on these exact names:
  - Types: `WorkflowRun { id; workflowId; title; status; conclusion: string|null; branch; sha; event; number; attempt; startedAt: string|null; updatedAt; url; actor }`, `WorkflowStep { number; name; status; conclusion; startedAt; completedAt }`, `WorkflowJob { id; name; status; conclusion; startedAt; completedAt; url; steps: WorkflowStep[] }`, `Workflow { id; name; path; state }`, `RepoRef { key; owner; repo }`, `Glyph { icon; color? }`.
  - Mappers: `mapRun(raw)`, `mapJob(raw)`, `mapWorkflow(raw)` (raw = REST JSON), `githubUrl(v): string` (only `https://github.com/…`, else `''`).
  - `statusIcon(status, conclusion): Glyph`, `isActive({status}): boolean`, `isFailed({status, conclusion}): boolean`, `formatDuration(ms)`, `elapsed(start, end, now)`, `runDescription(run, now)`.
  - Actions: `type RunAction = 'rerunAll' | 'rerunFailed' | 'cancel' | 'rerunJob'`, `runActions(run): RunAction[]`, `refusal(action, target): string | null`, `runContext(run)`, `jobContext(job)`, `stepContext(step)`, `workflowContext(workflow, dispatchable)`, `actionFailureText(err)`.
  - Filter: `RunFilter { branch; mine; failed; workflow: string|null }`, `DEFAULT_FILTER`, `parseFilter(raw)`, `isDefaultFilter(f)`, `describeFilter(f)`, `filterRows(f)`, `isWorkflowFile(v)`, `PAGE_SIZE = 30`, `runsPath(owner, repo, f, ctx: {branch: string|null; login: string|null}, page)`.
  - Tree: `WfNode` (union below), `nodeId(node)`, `describeNode(node, ctx: {now:number; branch: string|null}): NodeView`, `NodeView { id; label; description?; tooltip?; icon: Glyph; collapsible: 'none'|'collapsed'|'expanded'; context: string }`, `dedupeRepos<T extends {repo: RepoRef}>(items: T[]): T[]`, `mergeRuns(fresh, old)`.
  - Misc: `pollDelay(input)`, `POLL_FAST_MS`, `POLL_SLOW_MS`, `branchChoices(branches, current)`, `isPlausibleRef(ref)`, `mapLimit(items, limit, fn)`.

- [ ] **Step 1: Write the failing test** — create `src/workflows/workflowsModel.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import {
  DEFAULT_FILTER, PAGE_SIZE, RepoRef, WfNode, WorkflowJob, WorkflowRun, branchChoices, dedupeRepos, describeFilter, describeNode,
  elapsed, filterRows, formatDuration, isActive, isDefaultFilter, isFailed, isPlausibleRef, isWorkflowFile, mapJob, mapLimit,
  mapRun, mergeRuns, nodeId, parseFilter, pollDelay, refusal, runActions, runContext, runDescription, runsPath, statusIcon,
  workflowContext,
} from './workflowsModel';
import { ApiError } from '../github/githubApi';
import { actionFailureText } from './workflowsModel';

const repo: RepoRef = { key: 'o/r', owner: 'o', repo: 'r' };
const run = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: 1, workflowId: 9, title: 'Fix it', status: 'completed', conclusion: 'success', branch: 'main', sha: 'abcdef1234567',
  event: 'push', number: 42, attempt: 1, startedAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:01:05Z',
  url: 'https://github.com/o/r/actions/runs/1', actor: 'octocat', ...over,
});
const job = (over: Partial<WorkflowJob> = {}): WorkflowJob => ({
  id: 5, name: 'build', status: 'completed', conclusion: 'success', startedAt: '2026-10-01T10:00:00Z',
  completedAt: '2026-10-01T10:00:30Z', url: 'https://github.com/o/r/actions/runs/1/job/5', steps: [], ...over,
});

test('statusIcon: one function for run, job and step rows', () => {
  assert.deepStrictEqual(statusIcon('completed', 'success'), { icon: 'pass', color: 'charts.green' });
  for (const c of ['failure', 'timed_out', 'startup_failure']) assert.strictEqual(statusIcon('completed', c).icon, 'error', c);
  assert.strictEqual(statusIcon('completed', 'cancelled').icon, 'circle-slash');
  assert.strictEqual(statusIcon('completed', 'skipped').icon, 'debug-step-over');
  assert.strictEqual(statusIcon('completed', 'neutral').icon, 'debug-step-over');
  assert.strictEqual(statusIcon('completed', 'action_required').icon, 'warning');
  assert.strictEqual(statusIcon('in_progress', null).icon, 'sync~spin');
  for (const s of ['queued', 'waiting', 'pending', 'requested']) assert.strictEqual(statusIcon(s, null).icon, 'clock', s);
  assert.strictEqual(statusIcon('who-knows', null).icon, 'circle-outline');
});

test('isActive / isFailed', () => {
  assert.ok(isActive({ status: 'queued' }) && isActive({ status: 'in_progress' }) && isActive({ status: 'waiting' }));
  assert.ok(!isActive({ status: 'completed' }) && !isActive({ status: '' }), 'an unknown status must not poll forever');
  assert.ok(isFailed({ status: 'completed', conclusion: 'timed_out' }));
  assert.ok(!isFailed({ status: 'completed', conclusion: 'cancelled' }) && !isFailed({ status: 'in_progress', conclusion: null }));
});

test('durations', () => {
  assert.strictEqual(formatDuration(0), '0s');
  assert.strictEqual(formatDuration(45_000), '45s');
  assert.strictEqual(formatDuration(65_000), '1m 5s');
  assert.strictEqual(formatDuration(3_725_000), '1h 2m');
  assert.strictEqual(formatDuration(-5), '0s');
  assert.strictEqual(elapsed(null, null, 0), '');
  assert.strictEqual(elapsed('2026-10-01T10:00:00Z', '2026-10-01T10:00:30Z', 0), '30s');
  const now = Date.parse('2026-10-01T10:02:00Z');
  assert.strictEqual(elapsed('2026-10-01T10:00:00Z', null, now), '2m 0s');
  assert.strictEqual(elapsed('garbage', null, now), '');
});

test('runDescription: attempt only above 1, duration from updatedAt when finished', () => {
  const now = Date.parse('2026-10-01T11:00:00Z');
  assert.strictEqual(runDescription(run(), now), 'main · abcdef1 · push · 1m 5s · #42');
  assert.strictEqual(runDescription(run({ attempt: 3 }), now), 'main · abcdef1 · push · 1m 5s · #42 · attempt 3');
  const active = runDescription(run({ status: 'in_progress', conclusion: null }), Date.parse('2026-10-01T10:00:10Z'));
  assert.strictEqual(active, 'main · abcdef1 · push · 10s · #42');
});

test('mapRun / mapJob tolerate missing fields and refuse non-github urls', () => {
  const r = mapRun({ id: 7, workflow_id: 3, display_title: 'T', status: 'queued', head_branch: 'x', head_sha: 'a'.repeat(40),
    event: 'push', run_number: 5, html_url: 'javascript:alert(1)', created_at: '2026-10-01T10:00:00Z' });
  assert.strictEqual(r.url, '');
  assert.strictEqual(r.attempt, 1);
  assert.strictEqual(r.actor, '');
  assert.strictEqual(r.startedAt, '2026-10-01T10:00:00Z');
  assert.strictEqual(r.title, 'T');
  assert.strictEqual(mapRun({ id: 1, name: 'CI', html_url: 'https://github.com/o/r/actions/runs/1' }).title, 'CI');
  const j = mapJob({ id: 1, name: 'b', status: 'completed', conclusion: 'failure', steps: [{ number: 1, name: 's', status: 'completed', conclusion: 'failure' }, null] });
  assert.strictEqual(j.steps.length, 1, 'a null step is dropped');
  assert.strictEqual(j.steps[0].conclusion, 'failure');
  assert.deepStrictEqual(mapJob({ id: 2, name: 'x' }).steps, []);
});

test('runActions: what each run state offers', () => {
  assert.deepStrictEqual(runActions(run()), ['rerunAll']);
  assert.deepStrictEqual(runActions(run({ conclusion: 'failure' })), ['rerunAll', 'rerunFailed']);
  assert.deepStrictEqual(runActions(run({ status: 'in_progress', conclusion: null })), ['cancel']);
  assert.deepStrictEqual(runActions(run({ status: 'queued', conclusion: null })), ['cancel']);
  assert.deepStrictEqual(runActions(run({ conclusion: 'cancelled' })), ['rerunAll']);
});

test('refusal: the host re-reads the target and refuses a stale click with the reason', () => {
  const finished = { status: 'completed', conclusion: 'success' };
  const running = { status: 'in_progress', conclusion: null };
  assert.strictEqual(refusal('cancel', running), null);
  assert.match(refusal('cancel', finished)!, /already finished/);
  assert.strictEqual(refusal('rerunAll', finished), null);
  assert.match(refusal('rerunAll', running)!, /still running/);
  assert.match(refusal('rerunFailed', finished)!, /no failed jobs/);
  assert.strictEqual(refusal('rerunFailed', { status: 'completed', conclusion: 'failure' }), null);
  assert.match(refusal('rerunJob', running)!, /still running/);
  assert.strictEqual(refusal('rerunJob', finished), null);
});

test('context values are space-separated tokens the when-clauses match', () => {
  assert.strictEqual(runContext(run({ conclusion: 'failure' })), 'run failed rerunAll rerunFailed');
  assert.strictEqual(runContext(run({ status: 'queued', conclusion: null })), 'run cancel');
  assert.strictEqual(workflowContext({ id: 1, name: 'ci', path: '.github/workflows/ci.yml', state: 'active' }, true), 'workflow dispatch');
  assert.strictEqual(workflowContext({ id: 1, name: 'ci', path: 'p', state: 'active' }, false), 'workflow');
  assert.strictEqual(workflowContext({ id: 1, name: 'ci', path: 'p', state: 'disabled_manually' }, true), 'workflow enable');
});

test('actionFailureText keeps GitHub\'s words and explains a 403', () => {
  assert.strictEqual(actionFailureText(new ApiError('GitHub API 409: Workflow is already running', 409)), 'GitHub API 409: Workflow is already running');
  assert.match(actionFailureText(new ApiError('GitHub API 403: Resource not accessible', 403)), /write access/);
  assert.strictEqual(actionFailureText(new Error('boom')), 'boom');
});

test('filter: parse falls back field by field, query follows the filter', () => {
  for (const junk of [undefined, null, 'x', 7, [], {}]) assert.deepStrictEqual(parseFilter(junk), DEFAULT_FILTER);
  assert.deepStrictEqual(parseFilter({ branch: 'yes', mine: true, failed: 1, workflow: '../../x' }), { ...DEFAULT_FILTER, mine: true });
  assert.deepStrictEqual(parseFilter({ workflow: 'ci.yml' }), { ...DEFAULT_FILTER, workflow: 'ci.yml' });
  assert.ok(isDefaultFilter(DEFAULT_FILTER) && !isDefaultFilter({ ...DEFAULT_FILTER, failed: true }));
  assert.strictEqual(describeFilter(DEFAULT_FILTER), '');
  assert.strictEqual(describeFilter({ branch: true, mine: true, failed: true, workflow: 'ci.yml' }), 'Current branch · My runs · Failed only · ci.yml');
  assert.ok(isWorkflowFile('ci.yml') && isWorkflowFile('a-b_c.yaml'));
  for (const bad of ['', 'ci', '../ci.yml', 'a/b.yml', 'ci.yml?x=1', 'x'.repeat(200) + '.yml']) assert.ok(!isWorkflowFile(bad), bad);
  assert.deepStrictEqual(filterRows(DEFAULT_FILTER).map(r => r.id), ['branch', 'mine', 'failed', 'workflow']);
});

test('runsPath: page size, optional qualifiers, workflow-scoped endpoint, encoding', () => {
  const ctx = { branch: 'feat/x y', login: 'octo cat' };
  assert.strictEqual(runsPath('o', 'r', DEFAULT_FILTER, ctx, 1), `/repos/o/r/actions/runs?per_page=${PAGE_SIZE}&page=1`);
  assert.strictEqual(
    runsPath('o', 'r', { branch: true, mine: true, failed: true, workflow: null }, ctx, 2),
    `/repos/o/r/actions/runs?per_page=${PAGE_SIZE}&page=2&branch=feat%2Fx%20y&actor=octo%20cat&status=failure`);
  assert.strictEqual(
    runsPath('o', 'r', { ...DEFAULT_FILTER, workflow: 'ci.yml' }, ctx, 1),
    `/repos/o/r/actions/workflows/ci.yml/runs?per_page=${PAGE_SIZE}&page=1`);
  assert.strictEqual(runsPath('o', 'r', { ...DEFAULT_FILTER, branch: true, mine: true }, { branch: null, login: null }, 1),
    `/repos/o/r/actions/runs?per_page=${PAGE_SIZE}&page=1`, 'no branch (detached) or login: the qualifier is simply dropped');
});

test('nodeId is stable and unique per row kind', () => {
  const r = run(); const j = job();
  const ids = [
    nodeId({ kind: 'repo', repo }), nodeId({ kind: 'signin', repo }), nodeId({ kind: 'group', repo, group: 'runs' }),
    nodeId({ kind: 'group', repo, group: 'workflows' }), nodeId({ kind: 'run', repo, run: r }), nodeId({ kind: 'job', repo, run: r, job: j }),
    nodeId({ kind: 'step', repo, run: r, job: j, step: { number: 2, name: 's', status: 'completed', conclusion: 'success', startedAt: null, completedAt: null } }),
    nodeId({ kind: 'workflow', repo, workflow: { id: 9, name: 'ci', path: 'p', state: 'active' }, dispatchable: false }),
    nodeId({ kind: 'more', repo }),
  ];
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.strictEqual(nodeId({ kind: 'run', repo, run: { ...r, status: 'in_progress' } }), nodeId({ kind: 'run', repo, run: r }), 'a status change keeps the id, so the row stays expanded');
});

test('describeNode: run rows mark the checked-out branch, failed jobs expand by themselves', () => {
  const now = Date.parse('2026-10-01T11:00:00Z');
  const failedRun = run({ conclusion: 'failure' });
  const v = describeNode({ kind: 'run', repo, run: failedRun }, { now, branch: 'main' });
  assert.strictEqual(v.label, 'Fix it');
  assert.ok(v.description!.startsWith('● '), 'checked-out branch marked');
  assert.strictEqual(v.collapsible, 'collapsed');
  assert.strictEqual(v.icon.icon, 'error');
  assert.strictEqual(v.context, 'run failed rerunAll rerunFailed');
  assert.ok(!describeNode({ kind: 'run', repo, run: failedRun }, { now, branch: 'other' }).description!.startsWith('●'));
  const failedJob = describeNode({ kind: 'job', repo, run: failedRun, job: job({ conclusion: 'failure' }) }, { now, branch: null });
  assert.strictEqual(failedJob.collapsible, 'expanded');
  assert.strictEqual(describeNode({ kind: 'job', repo, run: failedRun, job: job() }, { now, branch: null }).collapsible, 'collapsed');
  assert.strictEqual(failedJob.context, 'job failed rerunJob');
  const step = describeNode({ kind: 'step', repo, run: failedRun, job: job(), step: { number: 3, name: 'Test', status: 'completed', conclusion: 'failure', startedAt: '2026-10-01T10:00:00Z', completedAt: '2026-10-01T10:00:12Z' } }, { now, branch: null });
  assert.deepStrictEqual([step.label, step.description, step.collapsible, step.context], ['Test', '12s', 'none', 'step failed']);
  const wf = describeNode({ kind: 'workflow', repo, workflow: { id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'disabled_manually' }, dispatchable: false }, { now, branch: null });
  assert.strictEqual(wf.description, 'disabled');
  assert.strictEqual(wf.context, 'workflow enable');
});

test('dedupeRepos keeps the first folder of a repo that is open twice, case-insensitively', () => {
  const a = { repo: { key: 'o/r', owner: 'o', repo: 'r' }, folder: 'a' };
  const b = { repo: { key: 'o/r', owner: 'O', repo: 'R' }, folder: 'b' };
  const c = { repo: { key: 'o/other', owner: 'o', repo: 'other' }, folder: 'c' };
  assert.deepStrictEqual(dedupeRepos([a, b, c]).map(x => x.folder), ['a', 'c']);
});

test('mergeRuns: fresh page first, older loaded pages kept, no duplicates', () => {
  const r = (id: number) => run({ id });
  assert.deepStrictEqual(mergeRuns([r(5), r(4), r(3)], [r(4), r(3), r(2), r(1)]).map(x => x.id), [5, 4, 3, 2, 1]);
  assert.deepStrictEqual(mergeRuns([], [r(1)]).map(x => x.id), [1]);
});

test('pollDelay: 10 s, 30 s for old runs, back-off on errors, rate limit wins', () => {
  const now = 1_000_000_000;
  const base = { now, failures: 0, retryAt: null as number | null };
  assert.strictEqual(pollDelay({ ...base, oldestActiveSince: now - 60_000 }), 10_000);
  assert.strictEqual(pollDelay({ ...base, oldestActiveSince: now - 11 * 60_000 }), 30_000);
  assert.strictEqual(pollDelay({ ...base, oldestActiveSince: null }), 10_000);
  assert.deepStrictEqual([1, 2, 3, 9].map(failures => pollDelay({ ...base, failures, oldestActiveSince: now })), [10_000, 30_000, 60_000, 60_000]);
  assert.strictEqual(pollDelay({ ...base, retryAt: now + 120_000, oldestActiveSince: now }), 120_000);
  assert.strictEqual(pollDelay({ ...base, retryAt: now - 5, oldestActiveSince: now }), 10_000);
});

test('branchChoices puts the checked-out branch first only when it exists remotely; isPlausibleRef', () => {
  assert.deepStrictEqual(branchChoices(['main', 'dev', 'feat'], 'feat'), ['feat', 'main', 'dev']);
  assert.deepStrictEqual(branchChoices(['main', 'dev'], 'local-only'), ['main', 'dev']);
  assert.deepStrictEqual(branchChoices(['main'], null), ['main']);
  for (const ok of ['main', 'v1.2.3', 'feat/x']) assert.ok(isPlausibleRef(ok), ok);
  for (const bad of ['', '  ', 'a b', 'a..b', '-x', 'a\nb', 'a~b', 'a^b', 'a:b', 'x'.repeat(300)]) assert.ok(!isPlausibleRef(bad), JSON.stringify(bad));
});

test('mapLimit runs at most `limit` at once and keeps result order', async () => {
  let running = 0; let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async n => {
    running++; peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 5));
    running--;
    return n * 2;
  });
  assert.deepStrictEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.strictEqual(peak, 3);
  assert.deepStrictEqual(await mapLimit([], 3, async () => 1), []);
});
```

- [ ] **Step 2: Register the test and see it fail.** In `tsconfig.json`'s `include` add `"src/workflows/workflowsModel.test.ts"` (after the last `src/pulls/…` entry). In `package.json`'s `test` script, append ` out/workflows/workflowsModel.test.js` to the `node --test` list.

Run: `npm test`
Expected: FAIL — `tsc` reports `Cannot find module './workflowsModel'`.

- [ ] **Step 3: Write the implementation** — create `src/workflows/workflowsModel.ts`:

```ts
'use strict';

import { ApiError } from '../github/githubApi';

type Raw = Record<string, any>;

export interface WorkflowRun {
  id: number; workflowId: number; title: string; status: string; conclusion: string | null;
  branch: string; sha: string; event: string; number: number; attempt: number;
  startedAt: string | null; updatedAt: string; url: string; actor: string;
}
export interface WorkflowStep { number: number; name: string; status: string; conclusion: string | null; startedAt: string | null; completedAt: string | null }
export interface WorkflowJob {
  id: number; name: string; status: string; conclusion: string | null;
  startedAt: string | null; completedAt: string | null; url: string; steps: WorkflowStep[];
}
export interface Workflow { id: number; name: string; path: string; state: string }
export interface RepoRef { key: string; owner: string; repo: string }
export interface Glyph { icon: string; color?: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Only github.com pages are ever opened from a payload; anything else becomes ''. */
export const githubUrl = (v: unknown): string => (typeof v === 'string' && v.startsWith('https://github.com/') ? v : '');

export function mapRun(r: Raw): WorkflowRun {
  return {
    id: r.id, workflowId: r.workflow_id, title: str(r.display_title) || str(r.name), status: str(r.status),
    conclusion: strOrNull(r.conclusion), branch: str(r.head_branch), sha: str(r.head_sha), event: str(r.event),
    number: r.run_number, attempt: typeof r.run_attempt === 'number' ? r.run_attempt : 1,
    startedAt: strOrNull(r.run_started_at) ?? strOrNull(r.created_at), updatedAt: str(r.updated_at),
    url: githubUrl(r.html_url), actor: str(r.actor?.login),
  };
}

export function mapJob(j: Raw): WorkflowJob {
  const steps = (Array.isArray(j.steps) ? j.steps : []).filter((s: unknown) => typeof s === 'object' && s !== null).map((s: Raw): WorkflowStep => ({
    number: s.number, name: str(s.name), status: str(s.status), conclusion: strOrNull(s.conclusion),
    startedAt: strOrNull(s.started_at), completedAt: strOrNull(s.completed_at),
  }));
  return {
    id: j.id, name: str(j.name), status: str(j.status), conclusion: strOrNull(j.conclusion),
    startedAt: strOrNull(j.started_at), completedAt: strOrNull(j.completed_at), url: githubUrl(j.html_url), steps,
  };
}

export const mapWorkflow = (w: Raw): Workflow => ({ id: w.id, name: str(w.name), path: str(w.path), state: str(w.state) });

// ── status ──────────────────────────────────────────────────────────────────

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

export const isActive = (s: { status: string }): boolean => ACTIVE.has(s.status);
export const isFailed = (s: { status: string; conclusion: string | null }): boolean =>
  s.status === 'completed' && s.conclusion !== null && FAILED.has(s.conclusion);

/** The one icon function for run, job and step rows, so they always agree. */
export function statusIcon(status: string, conclusion: string | null): Glyph {
  if (status === 'completed') {
    if (conclusion === 'success') return { icon: 'pass', color: 'charts.green' };
    if (conclusion !== null && FAILED.has(conclusion)) return { icon: 'error', color: 'charts.red' };
    if (conclusion === 'cancelled') return { icon: 'circle-slash' };
    if (conclusion === 'action_required') return { icon: 'warning', color: 'charts.yellow' };
    return { icon: 'debug-step-over' }; // skipped, neutral, stale
  }
  if (status === 'in_progress') return { icon: 'sync~spin', color: 'charts.yellow' };
  if (ACTIVE.has(status)) return { icon: 'clock' };
  return { icon: 'circle-outline' };
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Time between two ISO timestamps (`end` null = still running, measured to `now`); '' when it cannot be told. */
export function elapsed(start: string | null, end: string | null, now: number): string {
  if (!start) return '';
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : now;
  return Number.isNaN(from) || Number.isNaN(to) ? '' : formatDuration(to - from);
}

export function runDescription(run: WorkflowRun, now: number): string {
  const duration = elapsed(run.startedAt, isActive(run) ? null : run.updatedAt, now);
  const parts = [run.branch, run.sha.slice(0, 7), run.event, duration, `#${run.number}`].filter(Boolean);
  if (run.attempt > 1) parts.push(`attempt ${run.attempt}`);
  return parts.join(' · ');
}

// ── actions ─────────────────────────────────────────────────────────────────

export type RunAction = 'rerunAll' | 'rerunFailed' | 'cancel' | 'rerunJob';

export function runActions(run: { status: string; conclusion: string | null }): RunAction[] {
  if (isActive(run)) return ['cancel'];
  if (run.status !== 'completed') return [];
  return isFailed(run) ? ['rerunAll', 'rerunFailed'] : ['rerunAll'];
}

/** Why `action` cannot be done to `target` as it is *now* (the host re-reads it first), or null when it can. */
export function refusal(action: RunAction, target: { status: string; conclusion: string | null }): string | null {
  switch (action) {
    case 'cancel': return isActive(target) ? null : 'It already finished.';
    case 'rerunAll': case 'rerunJob': return target.status === 'completed' ? null : 'It is still running.';
    case 'rerunFailed':
      if (target.status !== 'completed') return 'It is still running.';
      return isFailed(target) ? null : 'It has no failed jobs.';
  }
}

export const runContext = (run: WorkflowRun): string =>
  ['run', ...(isFailed(run) ? ['failed'] : []), ...runActions(run)].join(' ');
export const jobContext = (job: WorkflowJob): string =>
  ['job', ...(isFailed(job) ? ['failed'] : []), ...(job.status === 'completed' ? ['rerunJob'] : [])].join(' ');
export const stepContext = (step: WorkflowStep): string => (isFailed(step) ? 'step failed' : 'step');
export const workflowContext = (w: Workflow, dispatchable: boolean): string =>
  ['workflow', ...(w.state !== 'active' ? ['enable'] : dispatchable ? ['dispatch'] : [])].join(' ');

/** GitHub's own words, plus a hint for a plain 403 (rate limits carry `retryAt` and are not a permission problem). */
export function actionFailureText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403 && err.retryAt === null) return `${err.message} — this needs write access to the repository and Actions enabled.`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// ── filter ──────────────────────────────────────────────────────────────────

/** Stored per workspace and applied to every repo. `workflow` is a file name (`ci.yml`), which the API accepts as a workflow id. */
export interface RunFilter { branch: boolean; mine: boolean; failed: boolean; workflow: string | null }
export const DEFAULT_FILTER: RunFilter = { branch: false, mine: false, failed: false, workflow: null };
export const PAGE_SIZE = 30;

export const isWorkflowFile = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._-]{1,100}\.ya?ml$/.test(v);

export function parseFilter(raw: unknown): RunFilter {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    branch: o.branch === true, mine: o.mine === true, failed: o.failed === true,
    workflow: isWorkflowFile(o.workflow) ? o.workflow : null,
  };
}

export const isDefaultFilter = (f: RunFilter): boolean => !f.branch && !f.mine && !f.failed && f.workflow === null;

export function describeFilter(f: RunFilter): string {
  return [f.branch && 'Current branch', f.mine && 'My runs', f.failed && 'Failed only', f.workflow].filter(Boolean).join(' · ');
}

export type FilterRowId = 'branch' | 'mine' | 'failed' | 'workflow';
export function filterRows(f: RunFilter): Array<{ id: FilterRowId; label: string; description: string }> {
  const on = (v: boolean): string => (v ? 'on' : 'off');
  return [
    { id: 'branch', label: 'Current branch', description: on(f.branch) },
    { id: 'mine', label: 'My runs', description: on(f.mine) },
    { id: 'failed', label: 'Failed only', description: on(f.failed) },
    { id: 'workflow', label: 'Workflow', description: f.workflow ?? 'any' },
  ];
}

/** REST path of one page of runs. A qualifier whose value is unknown (detached HEAD, no login) is dropped. */
export function runsPath(owner: string, repo: string, f: RunFilter, ctx: { branch: string | null; login: string | null }, page: number): string {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions`;
  const head = f.workflow ? `${base}/workflows/${encodeURIComponent(f.workflow)}/runs` : `${base}/runs`;
  const q = [`per_page=${PAGE_SIZE}`, `page=${page}`];
  if (f.branch && ctx.branch) q.push(`branch=${encodeURIComponent(ctx.branch)}`);
  if (f.mine && ctx.login) q.push(`actor=${encodeURIComponent(ctx.login)}`);
  if (f.failed) q.push('status=failure');
  return `${head}?${q.join('&')}`;
}

// ── tree rows ───────────────────────────────────────────────────────────────

export type WfNode =
  | { kind: 'repo'; repo: RepoRef }
  | { kind: 'signin'; repo: RepoRef }
  | { kind: 'error'; repo: RepoRef; text: string }
  | { kind: 'note'; repo: RepoRef; text: string; id: string; command?: string }
  | { kind: 'group'; repo: RepoRef; group: 'runs' | 'workflows' }
  | { kind: 'run'; repo: RepoRef; run: WorkflowRun }
  | { kind: 'job'; repo: RepoRef; run: WorkflowRun; job: WorkflowJob }
  | { kind: 'step'; repo: RepoRef; run: WorkflowRun; job: WorkflowJob; step: WorkflowStep }
  | { kind: 'workflow'; repo: RepoRef; workflow: Workflow; dispatchable: boolean }
  | { kind: 'more'; repo: RepoRef };

export function nodeId(n: WfNode): string {
  const k = n.repo.key;
  switch (n.kind) {
    case 'repo': return `wf:${k}`;
    case 'signin': return `wf:${k}/signin`;
    case 'error': return `wf:${k}/error`;
    case 'note': return `wf:${k}/note/${n.id}`;
    case 'group': return `wf:${k}/${n.group}`;
    case 'run': return `wf:${k}/run/${n.run.id}`;
    case 'job': return `wf:${k}/run/${n.run.id}/job/${n.job.id}`;
    case 'step': return `wf:${k}/run/${n.run.id}/job/${n.job.id}/step/${n.step.number}`;
    case 'workflow': return `wf:${k}/workflow/${n.workflow.id}`;
    case 'more': return `wf:${k}/more`;
  }
}

export interface NodeView {
  id: string; label: string; description?: string; tooltip?: string; icon: Glyph;
  collapsible: 'none' | 'collapsed' | 'expanded'; context: string;
}

/** View data for the rows that come straight from API payloads; the glue turns it into a TreeItem. */
export function describeNode(n: WfNode, ctx: { now: number; branch: string | null }): NodeView {
  const id = nodeId(n);
  switch (n.kind) {
    case 'run': {
      const current = ctx.branch !== null && n.run.branch === ctx.branch;
      return {
        id, label: n.run.title, description: `${current ? '● ' : ''}${runDescription(n.run, ctx.now)}`,
        tooltip: `${n.run.title}\n#${n.run.number} by ${n.run.actor || 'unknown'}\n${n.run.conclusion ?? n.run.status}`,
        icon: statusIcon(n.run.status, n.run.conclusion), collapsible: 'collapsed', context: runContext(n.run),
      };
    }
    case 'job':
      return {
        id, label: n.job.name, description: elapsed(n.job.startedAt, n.job.completedAt, ctx.now),
        icon: statusIcon(n.job.status, n.job.conclusion),
        collapsible: isFailed(n.job) ? 'expanded' : 'collapsed', context: jobContext(n.job),
      };
    case 'step':
      return {
        id, label: n.step.name, description: elapsed(n.step.startedAt, n.step.completedAt, ctx.now),
        icon: statusIcon(n.step.status, n.step.conclusion), collapsible: 'none', context: stepContext(n.step),
      };
    case 'workflow': {
      const disabled = n.workflow.state !== 'active';
      return {
        id, label: n.workflow.name, description: disabled ? 'disabled' : n.workflow.path,
        tooltip: `${n.workflow.name}\n${n.workflow.path}${disabled ? `\n${n.workflow.state}` : ''}`,
        icon: { icon: 'file-code', color: disabled ? 'disabledForeground' : undefined }, collapsible: 'none',
        context: workflowContext(n.workflow, n.dispatchable),
      };
    }
    default:
      throw new Error(`describeNode does not describe "${n.kind}" rows`);
  }
}

/** One repo per `owner/repo`, case-insensitively; the first folder wins. */
export function dedupeRepos<T extends { repo: RepoRef }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(i => {
    const key = i.repo.key.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A fresh first page over the runs already loaded: the page replaces its own rows, older pages stay. */
export function mergeRuns(fresh: WorkflowRun[], old: WorkflowRun[]): WorkflowRun[] {
  const ids = new Set(fresh.map(r => r.id));
  return [...fresh, ...old.filter(r => !ids.has(r.id))];
}

// ── polling and small helpers ───────────────────────────────────────────────

export const POLL_FAST_MS = 10_000;
export const POLL_SLOW_MS = 30_000;
const SLOW_AFTER_MS = 10 * 60_000;
const BACKOFF = [10_000, 30_000, 60_000];

/** Delay until the next poll. `retryAt` (a rate limit) wins when it is later than the normal delay. */
export function pollDelay(i: { oldestActiveSince: number | null; now: number; failures: number; retryAt: number | null }): number {
  const base = i.failures > 0
    ? BACKOFF[Math.min(i.failures, BACKOFF.length) - 1]
    : i.oldestActiveSince !== null && i.now - i.oldestActiveSince > SLOW_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS;
  return i.retryAt !== null && i.retryAt - i.now > base ? i.retryAt - i.now : base;
}

export function branchChoices(branches: string[], current: string | null): string[] {
  return current !== null && branches.includes(current) ? [current, ...branches.filter(b => b !== current)] : [...branches];
}

/** Loose check for a ref the user typed; GitHub gives the final verdict (422). */
export function isPlausibleRef(ref: string): boolean {
  return ref.length > 0 && ref.length <= 250 && !/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(ref) && !ref.includes('..') && !ref.startsWith('-');
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, including the new `workflowsModel.test.js` (all earlier suites still pass).

- [ ] **Step 5: Commit**

```bash
git add src/workflows/workflowsModel.ts src/workflows/workflowsModel.test.ts tsconfig.json package.json
git commit -m "feat(null-tools): add the GitHub Actions workflows model"
```

---

### Task 3: REST wrappers and the log redirect

**Files:**
- Create: `extensions/null-tools/src/workflows/workflowsApi.ts`
- Create: `extensions/null-tools/src/workflows/workflowsApi.test.ts`
- Modify: `extensions/null-tools/src/github/githubApi.ts` (export `RawResponse`, `request` as `requestRaw`, `failure` as `apiFailure`)
- Modify: `extensions/null-tools/src/pulls/httpStub.ts` (record request headers; allow raw bodies and response headers)
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Consumes: `requestJson`, `ApiError`, `formatApiError` (`github/githubApi.ts`); `runsPath`, `mapRun`, `mapJob`, `mapWorkflow`, `RunFilter` (Task 2).
- Produces (`workflowsApi.ts`):
  - `listRuns(owner, repo, filter: RunFilter, ctx: {branch: string|null; login: string|null}, page: number, token): Promise<{ runs: WorkflowRun[]; total: number }>`
  - `getRun(owner, repo, runId, token): Promise<WorkflowRun>`, `listJobs(owner, repo, runId, token): Promise<WorkflowJob[]>`, `getJob(owner, repo, jobId, token): Promise<WorkflowJob>`
  - `listWorkflows(owner, repo, token): Promise<{ workflows: Workflow[]; total: number }>`
  - `listBranches(owner, repo, token): Promise<string[]>`, `getDefaultBranch(owner, repo, token): Promise<string>`
  - `rerunRun`, `rerunFailedJobs`, `cancelRun` `(owner, repo, runId, token): Promise<void>`; `rerunJob(owner, repo, jobId, token)`; `enableWorkflow(owner, repo, workflowId, token)`; `dispatchWorkflow(owner, repo, workflowId, ref, inputs: Record<string,string>, token): Promise<void>`
  - `interface JobLog { text: string; truncated: boolean }`, `const LOG_CAP = 5 * 1024 * 1024`, `fetchJobLog(owner, repo, jobId, token, cap = LOG_CAP): Promise<JobLog>`

- [ ] **Step 1: Export the raw transport and extend the stub.** In `src/github/githubApi.ts`, change `interface RawResponse` to `export interface RawResponse`, and add after the `failure` function (line 79):

```ts
/** For callers that must see the status and headers themselves (a redirect they follow by hand). */
export { request as requestRaw, failure as apiFailure };
```

Replace the whole of `src/pulls/httpStub.ts` with this version (same behaviour for existing callers; adds request headers, response headers and raw bodies):

```ts
'use strict';

import { EventEmitter } from 'node:events';
import https from 'node:https';
import { mock } from 'node:test';

export interface Call { url: string; method: string; headers: Record<string, string>; body?: any }
/** `raw` is sent as-is (use '' for an empty body); otherwise `body` is JSON-encoded. */
export interface Canned { status?: number; body?: unknown; raw?: string; headers?: Record<string, string> }

/** Answers each https.request with the next canned response (the last one repeats) and records what was asked. */
export function stub(responses: Canned[]): Call[] {
  const calls: Call[] = [];
  mock.method(https, 'request', (url: string, opts: { method: string; headers?: Record<string, string> }, onResponse: (res: unknown) => void) => {
    const call: Call = { url, method: opts.method, headers: opts.headers ?? {} };
    calls.push(call);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return Object.assign(new EventEmitter(), {
      setTimeout() {}, destroy() {},
      write(payload: string) { call.body = JSON.parse(payload); },
      end() {
        const res = Object.assign(new EventEmitter(), { statusCode: next.status ?? 200, headers: next.headers ?? {}, setEncoding() {} });
        onResponse(res);
        const text = next.raw ?? JSON.stringify(next.body);
        if (text) res.emit('data', text);
        res.emit('end');
      },
    });
  });
  return calls;
}
```

Run: `npm test`
Expected: PASS (existing pulls tests use `stub` unchanged).

- [ ] **Step 2: Write the failing test** — create `src/workflows/workflowsApi.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test, { afterEach, mock } from 'node:test';
import { ApiError } from '../github/githubApi';
import { stub } from '../pulls/httpStub';
import {
  cancelRun, dispatchWorkflow, enableWorkflow, fetchJobLog, getDefaultBranch, listBranches, listJobs, listRuns, listWorkflows,
  rerunFailedJobs, rerunJob, rerunRun,
} from './workflowsApi';
import { DEFAULT_FILTER } from './workflowsModel';

afterEach(() => mock.restoreAll());

const ctx = { branch: 'main', login: 'me' };

test('listRuns sends the filter and maps the payload', async () => {
  const calls = stub([{ body: { total_count: 41, workflow_runs: [{ id: 1, workflow_id: 2, display_title: 'T', status: 'completed', conclusion: 'success', run_number: 9, html_url: 'https://github.com/o/r/actions/runs/1' }] } }]);
  const res = await listRuns('o', 'r', { ...DEFAULT_FILTER, failed: true }, ctx, 2, 'tok');
  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/actions/runs?per_page=30&page=2&status=failure');
  assert.strictEqual(calls[0].headers.Authorization, 'Bearer tok');
  assert.strictEqual(res.total, 41);
  assert.strictEqual(res.runs[0].title, 'T');
});

test('jobs, workflows and branches use the latest attempt and the first 100', async () => {
  const calls = stub([
    { body: { jobs: [{ id: 5, name: 'b', status: 'completed', steps: [] }] } },
    { body: { total_count: 120, workflows: [{ id: 3, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' }] } },
    { body: [{ name: 'main' }, { name: 'dev' }] },
    { body: { default_branch: 'trunk' } },
  ]);
  assert.strictEqual((await listJobs('o', 'r', 77, 't'))[0].id, 5);
  const wf = await listWorkflows('o', 'r', 't');
  assert.deepStrictEqual([wf.total, wf.workflows[0].name], [120, 'CI']);
  assert.deepStrictEqual(await listBranches('o', 'r', 't'), ['main', 'dev']);
  assert.strictEqual(await getDefaultBranch('o', 'r', 't'), 'trunk');
  assert.deepStrictEqual(calls.map(c => c.url), [
    'https://api.github.com/repos/o/r/actions/runs/77/jobs?filter=latest&per_page=100',
    'https://api.github.com/repos/o/r/actions/workflows?per_page=100',
    'https://api.github.com/repos/o/r/branches?per_page=100',
    'https://api.github.com/repos/o/r',
  ]);
});

test('management calls hit the documented endpoints with the right verb and body', async () => {
  const calls = stub([{ status: 201, raw: '' }]);
  await rerunRun('o', 'r', 1, 't');
  await rerunFailedJobs('o', 'r', 2, 't');
  await rerunJob('o', 'r', 3, 't');
  await cancelRun('o', 'r', 4, 't');
  await enableWorkflow('o', 'r', 5, 't');
  await dispatchWorkflow('o', 'r', 6, 'main', {}, 't');
  await dispatchWorkflow('o', 'r', 6, 'v1', { who: 'me', fail: 'false' }, 't');
  assert.deepStrictEqual(calls.map(c => `${c.method} ${c.url.replace('https://api.github.com/repos/o/r/actions/', '')}`), [
    'POST runs/1/rerun', 'POST runs/2/rerun-failed-jobs', 'POST jobs/3/rerun', 'POST runs/4/cancel',
    'PUT workflows/5/enable', 'POST workflows/6/dispatches', 'POST workflows/6/dispatches',
  ]);
  assert.deepStrictEqual(calls[5].body, { ref: 'main' }, 'no inputs key when there are none');
  assert.deepStrictEqual(calls[6].body, { ref: 'v1', inputs: { who: 'me', fail: 'false' } });
});

test('a refusal keeps GitHub\'s words in the ApiError', async () => {
  stub([{ status: 409, body: { message: 'Workflow is already running' } }]);
  await assert.rejects(rerunRun('o', 'r', 1, 't'), (e: unknown) => e instanceof ApiError && e.status === 409 && /already running/.test(e.message));
});

test('fetchJobLog follows the redirect and never sends the token to the second host', async () => {
  const calls = stub([
    { status: 302, raw: '', headers: { location: 'https://logs.example.net/signed?sig=abc' } },
    { raw: '2026-10-01T10:00:00.0000000Z hello\n' },
  ]);
  const log = await fetchJobLog('o', 'r', 9, 'secret-token');
  assert.strictEqual(log.text, '2026-10-01T10:00:00.0000000Z hello\n');
  assert.strictEqual(log.truncated, false);
  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/actions/jobs/9/logs');
  assert.strictEqual(calls[0].headers.Authorization, 'Bearer secret-token');
  assert.strictEqual(calls[1].url, 'https://logs.example.net/signed?sig=abc');
  assert.strictEqual(calls[1].headers.Authorization, undefined, 'the token stays on api.github.com');
  assert.ok(!JSON.stringify(calls[1].headers).includes('secret-token'));
});

test('fetchJobLog: bad redirects, missing logs and big logs end in a clear result', async () => {
  stub([{ status: 302, raw: '' }]);
  await assert.rejects(fetchJobLog('o', 'r', 9, 't'), /did not say where/);
  mock.restoreAll();

  stub([{ status: 302, raw: '', headers: { location: 'http://insecure.example/log' } }]);
  await assert.rejects(fetchJobLog('o', 'r', 9, 't'), /https/);
  mock.restoreAll();

  stub([{ status: 404, body: { message: 'Not Found' } }]);
  await assert.rejects(fetchJobLog('o', 'r', 9, 't'), (e: unknown) => e instanceof ApiError && e.status === 404);
  mock.restoreAll();

  stub([{ status: 302, raw: '', headers: { location: 'https://logs.example.net/x' } }, { status: 403, raw: '<Error>expired</Error>' }]);
  await assert.rejects(fetchJobLog('o', 'r', 9, 't'), (e: unknown) => e instanceof ApiError && e.status === 403);
  mock.restoreAll();

  const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  stub([{ status: 302, raw: '', headers: { location: 'https://logs.example.net/x' } }, { raw: lines }]);
  const big = await fetchJobLog('o', 'r', 9, 't', 200);
  assert.strictEqual(big.truncated, true);
  assert.ok(big.text.length <= 200);
  assert.ok(big.text.endsWith('line 99'), 'the end of the log is what survives');
  assert.ok(/^line \d+/.test(big.text), 'the cut lands on a line boundary');
});

test('fetchJobLog accepts a log served directly with 200', async () => {
  stub([{ raw: 'direct\n' }]);
  assert.deepStrictEqual(await fetchJobLog('o', 'r', 9, 't'), { text: 'direct\n', truncated: false });
});
```

- [ ] **Step 3: Register the test and see it fail.** Add `"src/workflows/workflowsApi.test.ts"` to `tsconfig.json`'s `include` and ` out/workflows/workflowsApi.test.js` to the `node --test` list in `package.json`.

Run: `npm test`
Expected: FAIL — `Cannot find module './workflowsApi'`.

- [ ] **Step 4: Write the implementation** — create `src/workflows/workflowsApi.ts`:

```ts
'use strict';

import * as https from 'https';
import { ApiError, apiFailure, formatApiError, requestJson, requestRaw } from '../github/githubApi';
import {
  RunFilter, Workflow, WorkflowJob, WorkflowRun, mapJob, mapRun, mapWorkflow, runsPath,
} from './workflowsModel';

type Raw = Record<string, any>;

const repoPath = (owner: string, repo: string): string => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

export async function listRuns(
  owner: string, repo: string, filter: RunFilter, ctx: { branch: string | null; login: string | null }, page: number, token: string | null,
): Promise<{ runs: WorkflowRun[]; total: number }> {
  const res = await requestJson<{ total_count: number; workflow_runs: Raw[] }>(runsPath(owner, repo, filter, ctx, page), token);
  return { runs: res.workflow_runs.map(mapRun), total: res.total_count };
}

export async function getRun(owner: string, repo: string, runId: number, token: string | null): Promise<WorkflowRun> {
  return mapRun(await requestJson<Raw>(`${repoPath(owner, repo)}/actions/runs/${runId}`, token));
}

export async function listJobs(owner: string, repo: string, runId: number, token: string | null): Promise<WorkflowJob[]> {
  const res = await requestJson<{ jobs: Raw[] }>(`${repoPath(owner, repo)}/actions/runs/${runId}/jobs?filter=latest&per_page=100`, token);
  return res.jobs.map(mapJob);
}

export async function getJob(owner: string, repo: string, jobId: number, token: string | null): Promise<WorkflowJob> {
  return mapJob(await requestJson<Raw>(`${repoPath(owner, repo)}/actions/jobs/${jobId}`, token));
}

// ponytail: first 100 only (the group says so); add Link-header paging if a repo ever has more workflows than that.
export async function listWorkflows(owner: string, repo: string, token: string | null): Promise<{ workflows: Workflow[]; total: number }> {
  const res = await requestJson<{ total_count: number; workflows: Raw[] }>(`${repoPath(owner, repo)}/actions/workflows?per_page=100`, token);
  return { workflows: res.workflows.map(mapWorkflow), total: res.total_count };
}

export async function listBranches(owner: string, repo: string, token: string | null): Promise<string[]> {
  const res = await requestJson<Array<{ name: string }>>(`${repoPath(owner, repo)}/branches?per_page=100`, token);
  return res.map(b => b.name);
}

export async function getDefaultBranch(owner: string, repo: string, token: string | null): Promise<string> {
  return (await requestJson<{ default_branch: string }>(repoPath(owner, repo), token)).default_branch;
}

const post = (owner: string, repo: string, tail: string, token: string | null, method: 'POST' | 'PUT' = 'POST', body: unknown = {}): Promise<void> =>
  requestJson<void>(`${repoPath(owner, repo)}/actions/${tail}`, token, method, body);

export const rerunRun = (o: string, r: string, runId: number, t: string | null): Promise<void> => post(o, r, `runs/${runId}/rerun`, t);
export const rerunFailedJobs = (o: string, r: string, runId: number, t: string | null): Promise<void> => post(o, r, `runs/${runId}/rerun-failed-jobs`, t);
export const rerunJob = (o: string, r: string, jobId: number, t: string | null): Promise<void> => post(o, r, `jobs/${jobId}/rerun`, t);
export const cancelRun = (o: string, r: string, runId: number, t: string | null): Promise<void> => post(o, r, `runs/${runId}/cancel`, t);
export const enableWorkflow = (o: string, r: string, id: number, t: string | null): Promise<void> => post(o, r, `workflows/${id}/enable`, t, 'PUT');

export function dispatchWorkflow(
  owner: string, repo: string, workflowId: number, ref: string, inputs: Record<string, string>, token: string | null,
): Promise<void> {
  const body = Object.keys(inputs).length > 0 ? { ref, inputs } : { ref };
  return post(owner, repo, `workflows/${workflowId}/dispatches`, token, 'POST', body);
}

// ── job logs ────────────────────────────────────────────────────────────────

export interface JobLog { text: string; truncated: boolean }
/** Cap in characters (close enough to bytes for a text log). */
export const LOG_CAP = 5 * 1024 * 1024;

/** Keeps the last `cap` characters, starting at a line boundary. */
function clip(text: string, cap: number, alreadyCut = false): JobLog {
  if (text.length <= cap && !alreadyCut) return { text, truncated: false };
  const tail = text.length > cap ? text.slice(-cap) : text;
  const nl = tail.indexOf('\n');
  return { text: nl >= 0 ? tail.slice(nl + 1) : tail, truncated: true }; // the first line is cut mid-way: drop it
}

/**
 * `GET …/jobs/{id}/logs` answers 302 with a signed URL on another host that expires within about a minute. The first call
 * carries the token; the second is made at once and carries **no** Authorization header (the URL is its own credential, and
 * the token must never leave api.github.com).
 */
export async function fetchJobLog(owner: string, repo: string, jobId: number, token: string | null, cap: number = LOG_CAP): Promise<JobLog> {
  const first = await requestRaw(`${repoPath(owner, repo)}/actions/jobs/${jobId}/logs`, token, 'GET');
  if (first.status >= 300 && first.status < 400) {
    const location = first.headers.location;
    if (!location) throw new ApiError('GitHub did not say where the log is.', first.status);
    return fetchLogText(location, cap);
  }
  if (first.status < 200 || first.status >= 300) throw apiFailure(first);
  return clip(first.body, cap);
}

function fetchLogText(url: string, cap: number): Promise<JobLog> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new ApiError('GitHub sent an invalid log address.', 0));
      return;
    }
    if (target.protocol !== 'https:') {
      reject(new ApiError('Logs are only fetched over https.', 0));
      return;
    }
    const req = https.request(target.href, { method: 'GET', headers: { 'User-Agent': 'Null-IDE', Accept: '*/*' } }, res => {
      const status = res.statusCode ?? 0;
      let data = '';
      let dropped = false;
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        data += chunk;
        if (data.length > cap * 2) { // never hold more than twice the cap while a huge log streams in
          data = data.slice(-cap);
          dropped = true;
        }
      });
      res.on('end', () => {
        if (status < 200 || status >= 300) reject(new ApiError(formatApiError(status, data.slice(0, 2000)), status));
        else resolve(clip(data, cap, dropped));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('Log request timed out')));
    req.end();
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS. If `fetchJobLog … clear result` fails on the `403` case, check that `formatApiError(403, '<Error>expired</Error>')` returns the `GitHub API 403` prefix (a non-JSON body is fine) and that the `ApiError` carries `status === 403`.

- [ ] **Step 6: Commit**

```bash
git add src/workflows/workflowsApi.ts src/workflows/workflowsApi.test.ts src/github/githubApi.ts src/pulls/httpStub.ts tsconfig.json package.json
git commit -m "feat(null-tools): add GitHub Actions REST wrappers and the log redirect"
```

---

### Task 4: Job log text (pure)

**Files:**
- Create: `extensions/null-tools/src/workflows/jobLog.ts`
- Create: `extensions/null-tools/src/workflows/jobLog.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json`

**Interfaces:**
- Consumes: `WorkflowJob`, `WorkflowStep`, `isActive`, `elapsed` (Task 2); `REAL_LOG`, `REAL_STEPS` (Task 1 fixture).
- Produces (`jobLog.ts`):
  - `cleanLog(raw: string): string[]` — lines without timestamps; `##[group]x` → `▶ x`; `##[endgroup]` dropped; trailing blank lines dropped.
  - `segmentLog(lines: string[]): Array<{ start: number; end: number }>`
  - `locateStep(lines, steps: WorkflowStep[], stepNumber: number): { start: number; end: number; exact: boolean }`
  - `pathRefs(line: string): PathRef[]` with `PathRef { path; line: number; col: number | null; start: number; end: number }`; `repoRelative(path: string): string | null`
  - Messages: `TRUNCATED_NOTICE`, `NOT_YET_NOTICE`, `GONE_NOTICE`
  - `renderJobDoc(i: { job: WorkflowJob; log: string | null; truncated: boolean; step: number | null; gone: boolean; now: number }): string`
  - `firstFailedStep(job): WorkflowStep | undefined`

- [ ] **Step 1: Write the failing test** — create `src/workflows/jobLog.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import {
  GONE_NOTICE, NOT_YET_NOTICE, TRUNCATED_NOTICE, cleanLog, firstFailedStep, locateStep, pathRefs, renderJobDoc, repoRelative, segmentLog,
} from './jobLog';
import { WorkflowJob, WorkflowStep } from './workflowsModel';
import { REAL_LOG, REAL_STEPS } from './realLog.fixture';

const ts = '2026-10-01T10:00:00.1234567Z ';
const step = (number: number, name: string, conclusion: string | null = 'success', status = 'completed'): WorkflowStep =>
  ({ number, name, status, conclusion, startedAt: '2026-10-01T10:00:00Z', completedAt: '2026-10-01T10:00:02Z' });
const job = (steps: WorkflowStep[], over: Partial<WorkflowJob> = {}): WorkflowJob => ({
  id: 5, name: 'build', status: 'completed', conclusion: 'success', startedAt: '2026-10-01T10:00:00Z',
  completedAt: '2026-10-01T10:00:30Z', url: 'https://github.com/o/r/actions/runs/1/job/5', steps, ...over,
});

const LOG = [
  `${ts}Current runner version: '2.300.0'`,
  `${ts}##[group]Operating System`,
  `${ts}Ubuntu`,
  `${ts}##[endgroup]`,
  `${ts}##[group]Run echo hi`,
  `${ts}echo hi`,
  `${ts}##[endgroup]`,
  `${ts}hi`,
  `${ts}##[group]Run make`,
  `${ts}make`,
  `${ts}##[endgroup]`,
  `${ts}##[error]Process completed with exit code 2.`,
  `${ts}Post job cleanup.`,
  `${ts}Cleaning up orphan processes`,
].join('\n');

test('cleanLog strips timestamps, turns groups into headings and drops endgroup', () => {
  const lines = cleanLog(LOG);
  assert.strictEqual(lines[0], "Current runner version: '2.300.0'");
  assert.strictEqual(lines[1], '▶ Operating System');
  assert.ok(!lines.some(l => l.includes('##[endgroup]') || /^\d{4}-/.test(l)));
  assert.ok(lines.includes('##[error]Process completed with exit code 2.'), '##[error] lines are kept');
});

test('cleanLog tolerates no timestamps, CRLF, a BOM and trailing blank lines', () => {
  assert.deepStrictEqual(cleanLog('a\r\nb\r\n\r\n'), ['a', 'b']);
  assert.deepStrictEqual(cleanLog('\uFEFF2026-10-01T10:00:00Zx\nplain'), ['x', 'plain']);
  assert.deepStrictEqual(cleanLog(''), []);
});

test('segmentLog splits at step markers; the first segment is the set-up step', () => {
  const lines = cleanLog(LOG);
  const segs = segmentLog(lines);
  assert.strictEqual(segs.length, 5);
  assert.deepStrictEqual(segs[0], { start: 0, end: 3 });
  assert.strictEqual(lines[segs[1].start], '▶ Run echo hi');
  assert.strictEqual(segs[4].end, lines.length);
});

test('locateStep: exact when segments and logged steps line up, a skipped step writes nothing', () => {
  const lines = cleanLog(LOG);
  const steps = [step(1, 'Set up job'), step(2, 'a'), step(3, 'skipped one', 'skipped'), step(4, 'b', 'failure'), step(5, 'Post x'), step(6, 'Complete job')];
  const a = locateStep(lines, steps, 2);
  assert.strictEqual(a.exact, true);
  assert.strictEqual(lines[a.start], '▶ Run echo hi');
  const b = locateStep(lines, steps, 4);
  assert.strictEqual(lines[b.start], '▶ Run make');
  assert.ok(lines.slice(b.start, b.end).includes('##[error]Process completed with exit code 2.'));
});

test('locateStep: a mismatch or a bad step number falls back to the full log at the nearest heading, never throws', () => {
  const lines = cleanLog(LOG);
  const fewer = locateStep(lines, [step(1, 'x'), step(2, 'y')], 2);
  assert.strictEqual(fewer.exact, false);
  assert.strictEqual(fewer.end, lines.length);
  const missing = locateStep(lines, [step(1, 'x')], 99);
  assert.strictEqual(missing.exact, false);
  assert.strictEqual(missing.start, 0);
  assert.deepStrictEqual(locateStep([], [step(1, 'x')], 1), { start: 0, end: 0, exact: true });
});

test('real captured log: the markers the plan assumed hold (Task 1)', () => {
  const lines = cleanLog(REAL_LOG);
  assert.ok(lines.length > 0);
  assert.ok(!lines.some(l => /^\d{4}-\d\d-\d\dT/.test(l)), 'every timestamp was stripped');
  const segs = segmentLog(lines);
  const logged = REAL_STEPS.filter(s => s.conclusion !== 'skipped');
  assert.strictEqual(segs.length, logged.length, 'one segment per step that wrote a log');
});

test('pathRefs: path:line:col and path(line,col), nothing from urls or windows paths', () => {
  assert.deepStrictEqual(pathRefs('##[error]src/a.ts(3,4): error TS2304'), [{ path: 'src/a.ts', line: 3, col: 4, start: 9, end: 22 }]);
  assert.deepStrictEqual(pathRefs('src/b.c:10:5: error: x').map(r => [r.path, r.line, r.col]), [['src/b.c', 10, 5]]);
  assert.deepStrictEqual(pathRefs('lib/c.py:7 failed').map(r => [r.path, r.line, r.col]), [['lib/c.py', 7, null]]);
  assert.deepStrictEqual(pathRefs('see https://example.com/a.js:3 for more'), []);
  assert.deepStrictEqual(pathRefs('D:\\a\\r\\r\\src\\x.ts:3'), []);
  assert.deepStrictEqual(pathRefs('plain text, nothing here 12:30'), []);
});

test('repoRelative refuses anything that could leave the repo', () => {
  assert.strictEqual(repoRelative('src/a.ts'), 'src/a.ts');
  assert.strictEqual(repoRelative('./src/a.ts'), 'src/a.ts');
  assert.strictEqual(repoRelative('/home/runner/work/repo/repo/src/a.ts'), 'src/a.ts');
  for (const bad of ['../etc/passwd', 'a/../../b', '/etc/passwd', '', 'a//b', '/home/runner/work/repo/repo/../x']) assert.strictEqual(repoRelative(bad), null, bad);
});

test('renderJobDoc: a finished job shows the cleaned log, or the step segment', () => {
  const steps = [step(1, 'Set up job'), step(2, 'a'), step(3, 'b', 'failure'), step(4, 'Post x'), step(5, 'Complete job')];
  const whole = renderJobDoc({ job: job(steps), log: LOG, truncated: false, step: null, gone: false, now: 0 });
  assert.ok(whole.includes('▶ Run make') && whole.includes('hi'));
  const one = renderJobDoc({ job: job(steps), log: LOG, truncated: false, step: 3, gone: false, now: 0 });
  assert.ok(one.startsWith('▶ Run make') && !one.includes('echo hi'));
});

test('renderJobDoc: truncation notice is line 1; no log says why', () => {
  const t = renderJobDoc({ job: job([]), log: 'x\ny', truncated: true, step: null, gone: false, now: 0 });
  assert.strictEqual(t.split('\n')[0], TRUNCATED_NOTICE);
  assert.ok(renderJobDoc({ job: job([]), log: null, truncated: false, step: null, gone: true, now: 0 }).includes(GONE_NOTICE));
  assert.ok(renderJobDoc({ job: job([]), log: '', truncated: false, step: null, gone: false, now: 0 }).length > 0, 'an empty finished log is not an empty document');
});

test('renderJobDoc: a running job shows its steps and waits for the log', () => {
  const running = job([step(1, 'Set up job'), step(2, 'Slow', null, 'in_progress'), step(3, 'Later', null, 'queued')], { status: 'in_progress', conclusion: null, completedAt: null });
  const none = renderJobDoc({ job: running, log: null, truncated: false, step: null, gone: false, now: Date.parse('2026-10-01T10:00:10Z') });
  assert.ok(none.includes('build') && none.includes('Slow') && none.includes(NOT_YET_NOTICE));
  const some = renderJobDoc({ job: running, log: `${ts}tick 1`, truncated: false, step: null, gone: false, now: 0 });
  assert.ok(some.includes('tick 1') && !some.includes(NOT_YET_NOTICE));
});

test('firstFailedStep', () => {
  assert.strictEqual(firstFailedStep(job([step(1, 'a'), step(2, 'b', 'failure'), step(3, 'c', 'failure')]))?.number, 2);
  assert.strictEqual(firstFailedStep(job([step(1, 'a')])), undefined);
});
```

- [ ] **Step 2: Register the test and see it fail.** Add to `tsconfig.json`'s `include`: `"src/workflows/jobLog.test.ts"`, `"src/workflows/realLog.fixture.ts"`; add ` out/workflows/jobLog.test.js` to the `node --test` list.

Run: `npm test`
Expected: FAIL — `Cannot find module './jobLog'`.

- [ ] **Step 3: Write the implementation** — create `src/workflows/jobLog.ts`. The step markers below encode Task 1's assumptions 2–4; if the captured log disagreed, change `STEP_MARKER` (and the synthetic `LOG` in the test) to what the real log shows before moving on — the `real captured log` test is the arbiter.

```ts
'use strict';

import { WorkflowJob, WorkflowStep, elapsed, isActive, isFailed } from './workflowsModel';

export const TRUNCATED_NOTICE = 'Log truncated (showing last 5 MB). Open on GitHub for the full log.';
export const NOT_YET_NOTICE = 'Logs appear when the job finishes.';
export const GONE_NOTICE = 'Logs are no longer available (GitHub keeps them 90 days) or you lack access.';

const TIMESTAMP = /^\uFEFF?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;

/** Log lines for display: no timestamps (step rows show durations), `##[group]x` as `▶ x`, `##[endgroup]` gone. */
export function cleanLog(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.replace(TIMESTAMP, '').replace(/^\uFEFF/, '');
    if (text.startsWith('##[endgroup]')) continue;
    out.push(text.startsWith('##[group]') ? `▶ ${text.slice('##[group]'.length)}` : text);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

/**
 * Where each step's text begins: the first step ("Set up job") starts the log; every `run:`/`uses:` step opens a
 * `##[group]Run …` group, post steps open with "Post job cleanup." and the last step with "Cleaning up orphan processes".
 * A user's own `::group::` does not match, so it stays inside its step.
 */
const STEP_MARKER = /^(▶ Run |Post job cleanup\.$|Cleaning up orphan processes$)/;

export function segmentLog(lines: string[]): Array<{ start: number; end: number }> {
  const starts = [0];
  lines.forEach((l, i) => { if (i > 0 && STEP_MARKER.test(l)) starts.push(i); });
  return starts.map((start, i) => ({ start, end: starts[i + 1] ?? lines.length }));
}

/**
 * The lines of one step. Exact only when the log splits into as many segments as there are steps that wrote anything
 * (a skipped step writes nothing); otherwise the whole log from the nearest heading, so a step never ends in an error.
 */
export function locateStep(lines: string[], steps: WorkflowStep[], stepNumber: number): { start: number; end: number; exact: boolean } {
  const logged = steps.filter(s => s.conclusion !== 'skipped');
  const segments = segmentLog(lines);
  const index = logged.findIndex(s => s.number === stepNumber);
  if (index >= 0 && segments.length === logged.length) return { ...segments[index], exact: true };
  const nearest = segments[Math.min(Math.max(index, 0), segments.length - 1)];
  return { start: nearest.start, end: lines.length, exact: false };
}

export const firstFailedStep = (job: WorkflowJob): WorkflowStep | undefined => job.steps.find(isFailed);

// ── file references in error lines ──────────────────────────────────────────

export interface PathRef { path: string; line: number; col: number | null; start: number; end: number }

// The lookbehind keeps urls (`https://h/a.js:3`) and windows paths (`\x.ts:3`) from yielding a bogus relative path.
const BEFORE = String.raw`(?<![\\\w./@:-])`;
const FILE = String.raw`([\w./@-]+\.\w+)`;
const COLON = new RegExp(`${BEFORE}${FILE}:(\\d+)(?::(\\d+))?`, 'g');
const PAREN = new RegExp(`${BEFORE}${FILE}\\((\\d+)(?:,(\\d+))?\\)`, 'g');

export function pathRefs(text: string): PathRef[] {
  const out: PathRef[] = [];
  for (const re of [COLON, PAREN]) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      out.push({ path: m[1], line: Number(m[2]), col: m[3] ? Number(m[3]) : null, start: m.index, end: m.index + m[0].length });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const RUNNER_WORKSPACE = /^\/home\/runner\/work\/[^/]+\/[^/]+\//;

/** A path inside the repo (the Linux runner's workspace prefix removed), or null for anything that could leave it. */
export function repoRelative(p: string): string | null {
  const rel = p.replace(RUNNER_WORKSPACE, '').replace(/^\.\//, '');
  if (!rel || rel.startsWith('/') || rel.split('/').some(s => s === '' || s === '..')) return null;
  return rel;
}

// ── the document ────────────────────────────────────────────────────────────

const MARK: Record<string, string> = { success: '✓', failure: '✗', timed_out: '✗', startup_failure: '✗', cancelled: '⊘', skipped: '–', in_progress: '…' };
const mark = (s: WorkflowStep): string => MARK[s.status === 'completed' ? s.conclusion ?? '' : s.status] ?? '·';

function stepSummary(job: WorkflowJob, now: number): string[] {
  return [
    `${job.name} — ${job.status === 'completed' ? job.conclusion ?? 'completed' : job.status.replace('_', ' ')}`,
    ...job.steps.map(s => `  ${mark(s)} ${s.name} ${elapsed(s.startedAt, s.completedAt, now)}`.trimEnd()),
  ];
}

export interface DocInput { job: WorkflowJob; log: string | null; truncated: boolean; step: number | null; gone: boolean; now: number }

/** The text of a `null-workflows:` document. Line 1 is the truncation notice when the front of the log was cut. */
export function renderJobDoc(i: DocInput): string {
  let lines = i.log !== null ? cleanLog(i.log) : [];
  if (i.step !== null && lines.length > 0) {
    const at = locateStep(lines, i.job.steps, i.step);
    lines = lines.slice(at.start, at.end);
  }
  const live = isActive(i.job);
  const out: string[] = [];
  if (i.truncated) out.push(TRUNCATED_NOTICE);
  if (live) {
    out.push(...stepSummary(i.job, i.now), '');
    out.push(...(lines.length > 0 ? lines : [NOT_YET_NOTICE]));
  } else if (lines.length > 0) {
    out.push(...lines);
  } else {
    out.push(i.gone ? GONE_NOTICE : '(This job wrote no log.)');
  }
  return out.join('\n');
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS. If `real captured log` fails, the real log disagrees with `STEP_MARKER`: adjust the regex to the observed markers (and the synthetic `LOG` to match), then re-run.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/jobLog.ts src/workflows/jobLog.test.ts src/workflows/realLog.fixture.ts tsconfig.json package.json
git commit -m "feat(null-tools): add GitHub Actions job log parsing"
```

---

### Task 5: Log document URIs (pure)

**Files:**
- Create: `extensions/null-tools/src/workflows/workflowLogDocs.ts`
- Create: `extensions/null-tools/src/workflows/workflowLogDocs.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json`

**Interfaces:**
- Produces: `WORKFLOW_SCHEME = 'null-workflows'`, `interface LogDocRef { owner: string; repo: string; jobId: number; step: number | null }`, `logDocParts(ref: LogDocRef, label: string): { scheme: string; path: string; query: string }`, `parseLogDoc(uriPath: string, query: string): LogDocRef | null`.

- [ ] **Step 1: Write the failing test** — create `src/workflows/workflowLogDocs.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { WORKFLOW_SCHEME, logDocParts, parseLogDoc } from './workflowLogDocs';

test('a job and a step round-trip, and the label only decorates the tab title', () => {
  const job = logDocParts({ owner: 'o', repo: 'r', jobId: 5, step: null }, 'build / x 86');
  assert.strictEqual(job.scheme, WORKFLOW_SCHEME);
  assert.strictEqual(job.path, '/o/r/5/build-x-86.log');
  assert.strictEqual(job.query, '');
  assert.deepStrictEqual(parseLogDoc(job.path, job.query), { owner: 'o', repo: 'r', jobId: 5, step: null });
  const step = logDocParts({ owner: 'o', repo: 'r', jobId: 5, step: 3 }, 'build: Run tests');
  assert.strictEqual(step.query, 'step=3');
  assert.deepStrictEqual(parseLogDoc(step.path, step.query), { owner: 'o', repo: 'r', jobId: 5, step: 3 });
});

test('the label is sanitised and never empty', () => {
  assert.strictEqual(logDocParts({ owner: 'o', repo: 'r', jobId: 1, step: null }, '../../etc').path, '/o/r/1/etc.log');
  assert.strictEqual(logDocParts({ owner: 'o', repo: 'r', jobId: 1, step: null }, '///').path, '/o/r/1/job.log');
  assert.ok(logDocParts({ owner: 'o', repo: 'r', jobId: 1, step: null }, 'x'.repeat(500)).path.length < 100);
});

test('parseLogDoc rejects anything that is not exactly /owner/repo/jobId/label.log', () => {
  const bad: Array<[string, string]> = [
    ['/../../etc/passwd', ''],
    ['/o/r/5', ''],
    ['/o/r/5/x.log/extra', ''],
    ['/o/r/abc/x.log', ''],
    ['/o/r/-1/x.log', ''],
    ['/o/r/0/x.log', ''],
    ['/o/r/5.5/x.log', ''],
    ['/o/r/99999999999999999999/x.log', ''],
    ['/../r/5/x.log', ''],
    ['/./r/5/x.log', ''],
    ['/o/../5/x.log', ''],
    ['/o/r r/5/x.log', ''],
    ['/o%2Fx/r/5/x.log', ''],
    ['/o/r/5/x.txt', ''],
    ['/o/r/5/../x.log', ''],
    ['/o/r/5/x.log', 'step=abc'],
    ['/o/r/5/x.log', 'step=0'],
    ['/o/r/5/x.log', 'step=1&step=2'],
    ['/o/r/5/x.log', 'step=1&evil=1'],
    ['/o/r/5/x.log', 'evil=1'],
    ['', ''],
  ];
  for (const [p, q] of bad) assert.strictEqual(parseLogDoc(p, q), null, `${p}?${q}`);
});
```

- [ ] **Step 2: Register the test and see it fail.** Add `"src/workflows/workflowLogDocs.test.ts"` to `tsconfig.json` and ` out/workflows/workflowLogDocs.test.js` to the `package.json` test list.

Run: `npm test`
Expected: FAIL — `Cannot find module './workflowLogDocs'`.

- [ ] **Step 3: Write the implementation** — create `src/workflows/workflowLogDocs.ts`:

```ts
'use strict';

/** URI scheme of a job's log (or one step of it); served by `WorkflowLogProvider` from the Actions API. */
export const WORKFLOW_SCHEME = 'null-workflows';

export interface LogDocRef { owner: string; repo: string; jobId: number; step: number | null }

const NAME = /^[A-Za-z0-9._-]+$/;
const dotsOnly = (s: string): boolean => /^\.+$/.test(s);
const MAX_STEP = 1000;

/** The URI parts for a log. `label` only gives the tab a readable title; it is sanitised and never read back. */
export function logDocParts(ref: LogDocRef, label: string): { scheme: string; path: string; query: string } {
  const clean = label.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'job';
  return {
    scheme: WORKFLOW_SCHEME,
    path: `/${ref.owner}/${ref.repo}/${ref.jobId}/${clean}.log`,
    query: ref.step === null ? '' : `step=${ref.step}`,
  };
}

/** The reference a document URI encodes, or null when anything about it is off (it then never reaches the network). */
export function parseLogDoc(uriPath: string, query: string): LogDocRef | null {
  const parts = uriPath.split('/');
  if (parts.length !== 5 || parts[0] !== '') return null;
  const [, owner, repo, id, file] = parts;
  if (!NAME.test(owner) || dotsOnly(owner) || !NAME.test(repo) || dotsOnly(repo)) return null;
  if (!/^[1-9]\d{0,14}$/.test(id)) return null;
  if (!/^[A-Za-z0-9._-]+\.log$/.test(file) || dotsOnly(file.slice(0, -4))) return null;

  let step: number | null = null;
  if (query !== '') {
    const params = new URLSearchParams(query);
    const keys = [...params.keys()];
    if (keys.length !== 1 || keys[0] !== 'step' || params.getAll('step').length !== 1) return null;
    const raw = params.get('step')!;
    if (!/^[1-9]\d{0,3}$/.test(raw) || Number(raw) > MAX_STEP) return null;
    step = Number(raw);
  }
  return { owner, repo, jobId: Number(id), step };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/workflowLogDocs.ts src/workflows/workflowLogDocs.test.ts tsconfig.json package.json
git commit -m "feat(null-tools): add validated null-workflows log document URIs"
```

---

### Task 6: Dispatch inputs from workflow YAML (pure)

**Files:**
- Create: `extensions/null-tools/src/workflows/dispatchInputs.ts`
- Create: `extensions/null-tools/src/workflows/dispatchInputs.test.ts`
- Modify: `extensions/null-tools/package.json` (dependency `yaml`, test registration), `extensions/null-tools/package-lock.json` (via `npm install`), `extensions/null-tools/tsconfig.json`

**Interfaces:**
- Produces: `type InputType = 'string' | 'boolean' | 'choice' | 'number' | 'environment'`, `interface DispatchInput { name; description: string; required: boolean; default: string | null; type: InputType; options: string[] }`, `parseDispatch(text: string): { dispatchable: boolean; inputs: DispatchInput[] }` (never throws), `validateInput(input: DispatchInput, value: string): string | undefined`.

- [ ] **Step 1: Add the dependency and check what ships**

```bash
npm install yaml@^2 --save
du -sh node_modules/yaml
```

Expected: `package.json` gets `"yaml": "^2.x.y"` under `dependencies` (next to `ws`), `package-lock.json` updates, and `node_modules/yaml` is well under 2 MB. CI copies each extension folder including `node_modules`, so no bundling change is needed; record the size in the commit message.

- [ ] **Step 2: Write the failing test** — create `src/workflows/dispatchInputs.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { parseDispatch, validateInput } from './dispatchInputs';

test('on: as a string, a list and a map', () => {
  assert.deepStrictEqual(parseDispatch('on: workflow_dispatch\njobs: {}'), { dispatchable: true, inputs: [] });
  assert.deepStrictEqual(parseDispatch('on: [push, workflow_dispatch]'), { dispatchable: true, inputs: [] });
  assert.deepStrictEqual(parseDispatch('on:\n  push:\n  workflow_dispatch:\n'), { dispatchable: true, inputs: [] });
  assert.deepStrictEqual(parseDispatch('on:\n  push:\n    branches: [main]\n'), { dispatchable: false, inputs: [] });
  assert.deepStrictEqual(parseDispatch('on: push'), { dispatchable: false, inputs: [] });
});

test('the on key may parse as boolean true (YAML 1.1 readers)', () => {
  assert.strictEqual(parseDispatch('true:\n  workflow_dispatch:\n').dispatchable, true);
});

test('each input type, with defaults, options and required', () => {
  const out = parseDispatch(`
on:
  workflow_dispatch:
    inputs:
      who:
        description: Who to greet
        required: true
        default: world
      flavor:
        type: choice
        options: [vanilla, chocolate]
        default: vanilla
      loud:
        type: boolean
        default: true
      count:
        type: number
        default: 3
      env:
        type: environment
`);
  assert.strictEqual(out.dispatchable, true);
  assert.deepStrictEqual(out.inputs, [
    { name: 'who', description: 'Who to greet', required: true, default: 'world', type: 'string', options: [] },
    { name: 'flavor', description: '', required: false, default: 'vanilla', type: 'choice', options: ['vanilla', 'chocolate'] },
    { name: 'loud', description: '', required: false, default: 'true', type: 'boolean', options: [] },
    { name: 'count', description: '', required: false, default: '3', type: 'number', options: [] },
    { name: 'env', description: '', required: false, default: null, type: 'environment', options: [] },
  ]);
});

test('anchors and aliases resolve', () => {
  const out = parseDispatch(`
x-in: &in
  description: shared
  required: true
on:
  workflow_dispatch:
    inputs:
      a: *in
      b:
        <<: *in
        description: own
`);
  assert.deepStrictEqual(out.inputs.map(i => [i.name, i.description, i.required]), [['a', 'shared', true], ['b', 'own', true]]);
});

test('garbage never throws and means not dispatchable', () => {
  for (const text of ['', '   ', ':::', '- a\n- b', '[unclosed', 'on: [', 'null', '42', '\u0000\u0001', 'a: &x [*x]', 'on: {'.repeat(50)]) {
    assert.deepStrictEqual(parseDispatch(text), { dispatchable: false, inputs: [] }, JSON.stringify(text));
  }
  assert.deepStrictEqual(parseDispatch('x'.repeat(2_000_000)), { dispatchable: false, inputs: [] }, 'oversized files are not parsed');
});

test('odd input entries are skipped or defaulted, not fatal', () => {
  const out = parseDispatch(`
on:
  workflow_dispatch:
    inputs:
      ok: {}
      notamap: 5
      nul:
      weird:
        type: banana
        options: not-a-list
        required: maybe
      choice-no-options:
        type: choice
`);
  assert.deepStrictEqual(out.inputs.map(i => [i.name, i.type, i.options.length, i.required]), [
    ['ok', 'string', 0, false], ['nul', 'string', 0, false], ['weird', 'string', 0, false], ['choice-no-options', 'choice', 0, false],
  ]);
});

test('validateInput: required, numbers, choices, booleans', () => {
  const base = { name: 'x', description: '', required: false, default: null, options: [] as string[] };
  assert.match(validateInput({ ...base, required: true, type: 'string' }, '  ')!, /required/i);
  assert.strictEqual(validateInput({ ...base, type: 'string' }, ''), undefined);
  assert.match(validateInput({ ...base, type: 'number' }, 'abc')!, /number/i);
  assert.strictEqual(validateInput({ ...base, type: 'number' }, '4.5'), undefined);
  assert.strictEqual(validateInput({ ...base, type: 'number' }, ''), undefined);
  assert.match(validateInput({ ...base, type: 'choice', options: ['a', 'b'] }, 'c')!, /one of/i);
  assert.strictEqual(validateInput({ ...base, type: 'choice', options: ['a', 'b'] }, 'a'), undefined);
});
```

- [ ] **Step 3: Register the test and see it fail.** Add `"src/workflows/dispatchInputs.test.ts"` to `tsconfig.json`; add ` out/workflows/dispatchInputs.test.js` to the `package.json` test list.

Run: `npm test`
Expected: FAIL — `Cannot find module './dispatchInputs'`.

- [ ] **Step 4: Write the implementation** — create `src/workflows/dispatchInputs.ts`:

```ts
'use strict';

import { parse } from 'yaml';

export type InputType = 'string' | 'boolean' | 'choice' | 'number' | 'environment';
export interface DispatchInput {
  name: string; description: string; required: boolean; default: string | null; type: InputType; options: string[];
}

const TYPES: ReadonlySet<string> = new Set<InputType>(['string', 'boolean', 'choice', 'number', 'environment']);
const MAX_BYTES = 1_000_000;
const MAX_INPUTS = 50;

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Whether a workflow file has a `workflow_dispatch` trigger, and its inputs. `on` may be a string, a list or a map, and
 * a YAML 1.1 reader turns the key into boolean `true`, so both spellings are read. Anything unreadable is "not dispatchable".
 */
export function parseDispatch(text: string): { dispatchable: boolean; inputs: DispatchInput[] } {
  const none = { dispatchable: false, inputs: [] as DispatchInput[] };
  if (text.length > MAX_BYTES) return none;
  let doc: unknown;
  try {
    doc = parse(text, { merge: true });
  } catch {
    return none;
  }
  if (!isMap(doc)) return none;
  const on = doc.on ?? doc.true;
  if (on === 'workflow_dispatch') return { dispatchable: true, inputs: [] };
  if (Array.isArray(on)) return { dispatchable: on.includes('workflow_dispatch'), inputs: [] };
  if (!isMap(on) || !('workflow_dispatch' in on)) return none;

  const trigger = on.workflow_dispatch;
  const raw = isMap(trigger) && isMap(trigger.inputs) ? trigger.inputs : {};
  const inputs: DispatchInput[] = [];
  for (const [name, spec] of Object.entries(raw)) {
    if (inputs.length >= MAX_INPUTS) break;
    const s: Record<string, unknown> | null = spec === null || spec === undefined ? {} : isMap(spec) ? spec : null;
    if (s === null) continue; // an entry that is a number or a list is not an input
    const type: InputType = typeof s.type === 'string' && TYPES.has(s.type) ? (s.type as InputType) : 'string';
    inputs.push({
      name,
      description: typeof s.description === 'string' ? s.description : '',
      required: s.required === true,
      default: s.default === undefined || s.default === null ? null : String(s.default),
      type,
      options: Array.isArray(s.options) ? s.options.map(String) : [],
    });
  }
  return { dispatchable: true, inputs };
}

/** InputBox validation for one value; undefined means fine. */
export function validateInput(input: DispatchInput, value: string): string | undefined {
  if (input.required && value.trim() === '') return `${input.name} is required.`;
  if (value === '') return undefined;
  if (input.type === 'number' && Number.isNaN(Number(value))) return `${input.name} must be a number.`;
  if (input.type === 'choice' && !input.options.includes(value)) return `${input.name} must be one of: ${input.options.join(', ')}.`;
  return undefined;
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS. The `'a: &x [*x]'` and `'on: {'.repeat(50)` cases rely on `yaml` throwing or returning a non-map; if one returns a surprising map shape, the `isMap(doc)` / `'workflow_dispatch' in on` guards already treat it as not dispatchable.

- [ ] **Step 6: Commit**

```bash
git add src/workflows/dispatchInputs.ts src/workflows/dispatchInputs.test.ts package.json package-lock.json tsconfig.json
git commit -m "feat(null-tools): read workflow_dispatch inputs from workflow YAML (yaml dependency, <size> in node_modules)"
```

(Replace `<size>` with the `du -sh` result.)

---

### Task 7: The GitHub Actions view — browse runs and workflows

This task makes the feature visible: the activity-bar entry, the tree with per-folder state, Load more, Open on GitHub, Open workflow file, the sign-in row, the Features hub entry, and an integration spec. Polling, filters, logs and management actions come in later tasks.

**Files:**
- Create: `extensions/null-tools/src/workflows/workflowsTreeView.ts`
- Create: `extensions/null-tools/src/workflows/workflowsIntegration.ts`
- Create: `extensions/null-tools/media/github-actions.svg`, `extensions/null-tools/media/github-actions-dark.svg`
- Create: `extensions/null-tools/src/test/suite/workflows.spec.ts`
- Modify: `extensions/null-tools/src/extension.ts` (register next to `registerPullsFeature`)
- Modify: `extensions/null-tools/package.json` (container, view, welcome texts, commands, menus, feature entry)
- Modify: `extensions/null-tools/src/featureManifests.test.ts` (new launcher entry)
- Modify: `extensions/null-tools/tsconfig.json` (`src/test/suite/workflows.spec.ts`)

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces (`workflowsTreeView.ts`):
  - `type WorkflowsState = 'no-folder' | 'remote' | 'untrusted' | 'not-a-repo' | 'no-git' | 'no-repo' | 'error' | 'ready'`
  - `interface RepoSlot extends RepoRef { folder: vscode.Uri; token: string | null; login: string | null; branch: string | null; runs: WorkflowRun[]; runsTotal: number; runsPage: number; workflows: Workflow[]; workflowsTotal: number; dispatchable: Map<number, boolean>; jobs: Map<number, WorkflowJob[]>; pinned: WorkflowRun | null; failures: number; retryAt: number | null; error: string | null }`
  - `class WorkflowsTreeProvider implements vscode.TreeDataProvider<WfNode>` with: `loaded`, `state`, `filter`, `onMessage`, `onDidLoad: vscode.Event<void>` (fires after every refresh/reload/poll), `slots(): RepoSlot[]`, `slot(key: string): RepoSlot | undefined`, `slotForRepo(owner, repo): RepoSlot | undefined`, `refresh(): Promise<void>`, `ensureLoaded(): Promise<void>`, `reloadRuns(slot): Promise<void>`, `loadMore(slot): Promise<void>`, `setFilter(next): Promise<void>`, `getParent(node)`, `snapshot()`.
- Produces (`workflowsIntegration.ts`): `registerWorkflowsFeature(context: vscode.ExtensionContext): void`.

- [ ] **Step 1: Write the failing integration spec** — create `src/test/suite/workflows.spec.ts`:

```ts
'use strict';

import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as vscode from 'vscode';

suite('null-tools GitHub Actions', () => {
  test('contributes its container, view and commands, reports no-repo for a folder without a GitHub origin, and never serves a hostile null-workflows URI', async function () {
    this.timeout(60_000);
    const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
    execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: folder });
    const extension = vscode.extensions.getExtension('null.null-tools')!;
    await extension.activate();

    const contributes = extension.packageJSON.contributes;
    assert.ok(contributes.viewsContainers.activitybar.some((c: { id: string }) => c.id === 'null-workflows'), 'container');
    assert.ok(contributes.views['null-workflows'].some((v: { id: string }) => v.id === 'null.workflowsView'), 'view');

    const commands = await vscode.commands.getCommands(true);
    for (const id of ['null.workflows.refresh', 'null.workflows.open', 'null.workflows.signIn', 'null.workflows.loadMore',
      'null.workflows.openOnGitHub', 'null.workflows.openWorkflowFile', 'null.workflows.createWorkflow']) {
      assert.ok(commands.includes(id), `${id} is registered`);
    }

    const snapshot = await vscode.commands.executeCommand<{ state: string; repos: unknown[] }>('_null.workflows.snapshot');
    assert.deepStrictEqual(snapshot, { state: 'no-repo', repos: [] });
  });
});
```

Add `"src/test/suite/workflows.spec.ts"` to `tsconfig.json`'s `include` (next to `pulls.spec.ts`).

- [ ] **Step 2: Update the launcher-entry test** so it fails for the right reason. In `src/featureManifests.test.ts`, change the `develop` row to `['develop', ['Dashboard', 'GitHub Issues', 'Pull Requests', 'GitHub Actions', 'Commit Graph', 'Music Player']],`.

Run: `npm test`
Expected: FAIL in `featureManifests.test.js` (no GitHub Actions entry yet).

- [ ] **Step 3: Add the icons.** `media/github-actions.svg` (play triangle in a ring, black, same header and style as `github-issues.svg`):

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100%" height="100%" viewBox="0 0 16 16" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linecap:round;stroke-linejoin:round;">
    <circle cx="8" cy="8" r="6.25" style="fill:none;stroke:black;stroke-width:1.5px;"/>
    <path d="M6.5 5.5L10.5 8L6.5 10.5Z" style="fill:black;stroke:none;"/>
</svg>
```

`media/github-actions-dark.svg`: identical with `black` → `white` (the same relation as `github-issues-dark.svg`; nothing consumes the dark variant yet, it is there because the spec names it).

- [ ] **Step 4: Write the tree provider** — create `src/workflows/workflowsTreeView.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import { fetchRepoFile, ApiError } from '../github/githubApi';
import { getAccountsApi } from '../github/githubAuth';
import { getWorkspaceGithubRepo } from '../github/githubRemote';
import { resolveGithubSession } from '../github/githubSession';
import { GitError, makeRunGit } from '../graph/gitRun';
import { classifyWorkspace } from '../graph/graphMessages';
import { describeFailure } from '../pulls/pullModel';
import { parseDispatch } from './dispatchInputs';
import * as api from './workflowsApi';
import {
  RepoRef, RunFilter, WfNode, Workflow, WorkflowJob, WorkflowRun, dedupeRepos, describeFilter, describeNode, isActive,
  isDefaultFilter, mapLimit, mergeRuns, nodeId, parseFilter,
} from './workflowsModel';

/** What the view shows; every value except `ready` has a welcome message in package.json (`null.workflows.state`). */
export type WorkflowsState = 'no-folder' | 'remote' | 'untrusted' | 'not-a-repo' | 'no-git' | 'no-repo' | 'error' | 'ready';

export interface RepoSlot extends RepoRef {
  folder: vscode.Uri;
  token: string | null;
  login: string | null;
  branch: string | null;
  runs: WorkflowRun[]; runsTotal: number; runsPage: number;
  workflows: Workflow[]; workflowsTotal: number;
  /** Workflow id → has a `workflow_dispatch` trigger (read from the YAML at the default branch). */
  dispatchable: Map<number, boolean>;
  /** Run id → its jobs, once the run has been expanded. */
  jobs: Map<number, WorkflowJob[]>;
  /** A run revealed from the PR tab that is not among the loaded ones; dropped on the next refresh. */
  pinned: WorkflowRun | null;
  /** Consecutive failed fetches (back-off input); three show an error row. */
  failures: number;
  retryAt: number | null;
  error: string | null;
}

const FILTER_KEY = 'null.workflows.filter';
const MAX_WORKFLOW_BYTES = 256 * 1024;
const DETECT_PARALLEL = 20;
const group = (repo: RepoRef, g: 'runs' | 'workflows'): WfNode => ({ kind: 'group', repo, group: g });
const ref = (s: RepoSlot): RepoRef => ({ key: s.key, owner: s.owner, repo: s.repo });

export class WorkflowsTreeProvider implements vscode.TreeDataProvider<WfNode> {
  private readonly emitter = new vscode.EventEmitter<WfNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly loadedEmitter = new vscode.EventEmitter<void>();
  readonly onDidLoad = this.loadedEmitter.event;
  private all: RepoSlot[] = [];
  private refreshing: Promise<void> | null = null;

  loaded = false;
  state: WorkflowsState = 'no-folder';
  filter: RunFilter;
  /** The tree's one-line detail: a rate-limit notice, otherwise the active filter. */
  onMessage: (message: string | undefined) => void = () => undefined;

  constructor(private readonly store: vscode.Memento) {
    this.filter = parseFilter(store.get(FILTER_KEY));
  }

  slots(): RepoSlot[] { return this.all; }
  slot(key: string): RepoSlot | undefined { return this.all.find(s => s.key === key); }
  slotForRepo(owner: string, repo: string): RepoSlot | undefined {
    return this.slot(`${owner}/${repo}`.toLowerCase()) ?? this.all.find(s => s.owner === owner && s.repo === repo);
  }

  async setFilter(next: RunFilter): Promise<void> {
    this.filter = next;
    await this.store.update(FILTER_KEY, isDefaultFilter(next) ? undefined : next);
    await this.refresh();
  }

  ensureLoaded(): Promise<void> {
    return this.loaded ? (this.refreshing ?? Promise.resolve()) : this.refresh();
  }

  /** Concurrent callers (a visibility event and a command) share one fetch. */
  refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    this.loaded = true;
    const resolved = await this.resolve();
    this.state = resolved.state;
    this.all = resolved.slots;
    if (this.state === 'ready') await Promise.all(this.all.map(s => this.load(s)));
    // One repo and it failed outright: the whole view says so (with Try Again); several repos each show their own row.
    if (this.state === 'ready' && this.all.length === 1 && this.all[0].failures > 0 && this.all[0].runs.length === 0) this.state = 'error';
    void vscode.commands.executeCommand('setContext', 'null.workflows.state', this.state);
    this.publish();
  }

  private publish(): void {
    this.onMessage(this.message());
    this.emitter.fire(undefined);
    this.loadedEmitter.fire();
  }

  private message(): string | undefined {
    const now = Date.now();
    const limited = this.all.find(s => s.retryAt !== null && s.retryAt > now);
    const parts = [limited ? limited.error : undefined, isDefaultFilter(this.filter) ? undefined : describeFilter(this.filter)];
    return parts.filter(Boolean).join(' — ') || undefined;
  }

  /** Everything that decides whether any repo can be listed at all: workspace kind, git, a github.com `origin`. */
  private async resolve(): Promise<{ state: WorkflowsState; slots: RepoSlot[] }> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const blocked = classifyWorkspace({ folderScheme: folders[0]?.uri.scheme, trusted: vscode.workspace.isTrusted });
    if (blocked) return { state: blocked, slots: [] };
    const found: Array<{ repo: RepoRef; slot: RepoSlot }> = [];
    let sawRepo = false;
    let gitMissing = false;
    for (const folder of folders.filter(f => f.uri.scheme === 'file')) {
      const git = makeRunGit(folder.uri.fsPath);
      try {
        await git(['rev-parse', '--is-inside-work-tree']);
      } catch (err) {
        if (err instanceof GitError && err.code === 'ENOENT') gitMissing = true;
        continue;
      }
      sawRepo = true;
      const origin = getWorkspaceGithubRepo(folder.uri.fsPath);
      if (!origin) continue;
      const branch = await git(['symbolic-ref', '--short', '-q', 'HEAD']).then(out => out.trim() || null, () => null);
      const repo: RepoRef = { key: `${origin.owner}/${origin.repo}`.toLowerCase(), owner: origin.owner, repo: origin.repo };
      found.push({ repo, slot: this.newSlot(repo, folder.uri, branch) });
    }
    const slots = dedupeRepos(found).map(f => f.slot);
    if (slots.length > 0) return { state: 'ready', slots };
    return { state: gitMissing ? 'no-git' : sawRepo ? 'no-repo' : 'not-a-repo', slots: [] };
  }

  private newSlot(repo: RepoRef, folder: vscode.Uri, branch: string | null): RepoSlot {
    return {
      ...repo, folder, token: null, login: null, branch, runs: [], runsTotal: 0, runsPage: 1, workflows: [], workflowsTotal: 0,
      dispatchable: new Map(), jobs: new Map(), pinned: null, failures: 0, retryAt: null, error: null,
    };
  }

  private ctx(s: RepoSlot): { branch: string | null; login: string | null } { return { branch: s.branch, login: s.login }; }

  private async load(slot: RepoSlot): Promise<void> {
    const session = await resolveGithubSession(getAccountsApi(), slot.folder, false);
    slot.token = session?.accessToken ?? null;
    slot.login = session?.login ?? null;
    if (!slot.token) return; // the sign-in row; never a silent empty tree
    try {
      const [runs, workflows] = await Promise.all([
        api.listRuns(slot.owner, slot.repo, this.filter, this.ctx(slot), 1, slot.token),
        api.listWorkflows(slot.owner, slot.repo, slot.token),
      ]);
      slot.runs = runs.runs; slot.runsTotal = runs.total; slot.runsPage = 1;
      slot.workflows = workflows.workflows; slot.workflowsTotal = workflows.total;
      slot.error = null; slot.failures = 0; slot.retryAt = null;
      void this.detectDispatchable(slot);
    } catch (err) {
      this.fail(slot, err);
    }
  }

  /** Records a failed fetch on the slot: a stale token becomes the sign-in row, a rate limit suspends polling, the rest back off. */
  fail(slot: RepoSlot, err: unknown): void {
    if (err instanceof ApiError && err.status === 401) { slot.token = null; return; }
    if (err instanceof ApiError && err.retryAt !== null) {
      slot.retryAt = err.retryAt;
      slot.error = describeFailure(err);
      return;
    }
    slot.failures++;
    slot.error = err instanceof ApiError && err.status === 404
      ? 'GitHub cannot see this repository: it is private and this account has no access, or it was renamed.'
      : describeFailure(err);
  }

  /** Reads each active workflow file at the default branch (max 20 at a time) to learn which can be dispatched. */
  private async detectDispatchable(slot: RepoSlot): Promise<void> {
    let ref: string;
    try {
      ref = await api.getDefaultBranch(slot.owner, slot.repo, slot.token);
    } catch {
      return;
    }
    await mapLimit(slot.workflows.filter(w => w.state === 'active'), DETECT_PARALLEL, async w => {
      try {
        const file = await fetchRepoFile(slot.owner, slot.repo, ref, w.path, slot.token, MAX_WORKFLOW_BYTES);
        slot.dispatchable.set(w.id, parseDispatch(file.bytes.toString('utf8')).dispatchable);
      } catch {
        slot.dispatchable.set(w.id, false); // unreadable means "not dispatchable": the action is hidden, not an error
      }
    });
    this.emitter.fire(undefined);
  }

  /** Re-fetches the first page of runs and merges it over what is loaded; keeps expanded jobs and loaded pages. */
  async reloadRuns(slot: RepoSlot): Promise<void> {
    if (!slot.token) return;
    try {
      const wasActive = new Set(slot.runs.filter(isActive).map(r => r.id));
      const fresh = await api.listRuns(slot.owner, slot.repo, this.filter, this.ctx(slot), 1, slot.token);
      slot.runs = mergeRuns(fresh.runs, slot.runs);
      slot.runsTotal = fresh.total;
      slot.error = null; slot.failures = 0; slot.retryAt = null;
      // Jobs of expanded runs that are in play, or just finished, ride the same tick; finished runs' jobs never change.
      const stale = [...slot.jobs.keys()].filter(id => wasActive.has(id) || slot.runs.some(r => r.id === id && isActive(r)));
      await Promise.all(stale.map(async id => { slot.jobs.set(id, await api.listJobs(slot.owner, slot.repo, id, slot.token)); }));
    } catch (err) {
      this.fail(slot, err);
    }
    this.publish();
  }

  async loadMore(slot: RepoSlot): Promise<void> {
    if (!slot.token) return;
    try {
      const next = await api.listRuns(slot.owner, slot.repo, this.filter, this.ctx(slot), slot.runsPage + 1, slot.token);
      slot.runsPage++;
      slot.runs = mergeRuns(slot.runs, next.runs);
      slot.runsTotal = next.total;
    } catch (err) {
      this.fail(slot, err);
    }
    this.publish();
  }

  /** The branch can change without a refetch: only the ● marker moves. */
  async refreshBranches(): Promise<void> {
    let changed = false;
    for (const s of this.all) {
      const branch = await makeRunGit(s.folder.fsPath)(['symbolic-ref', '--short', '-q', 'HEAD']).then(o => o.trim() || null, () => null);
      if (branch !== s.branch) { s.branch = branch; changed = true; }
    }
    if (changed) this.emitter.fire(undefined);
  }

  hasActiveRuns(): boolean { return this.all.some(s => s.token !== null && s.runs.some(isActive)); }

  /** Shows `run` under a "Pinned" position of its repo until the next refresh (used by Reveal from the PR tab). */
  pin(slot: RepoSlot, run: WorkflowRun): void {
    if (!slot.runs.some(r => r.id === run.id)) slot.pinned = run;
    this.emitter.fire(undefined);
  }

  snapshot(): { state: WorkflowsState; repos: Array<{ runs: number; workflows: number }> } {
    return { state: this.state, repos: this.all.map(s => ({ runs: s.runs.length, workflows: s.workflows.length })) };
  }

  // ── TreeDataProvider ──────────────────────────────────────────────────────

  getParent(node: WfNode): WfNode | undefined {
    const repo = node.repo;
    // With one repo the root node is omitted, so its groups are the roots.
    const top: WfNode | undefined = this.all.length > 1 ? { kind: 'repo', repo } : undefined;
    switch (node.kind) {
      case 'repo': return undefined;
      case 'group': case 'signin': case 'error': return top;
      case 'note': return node.id === 'no-workflows' ? group(repo, 'workflows') : group(repo, 'runs');
      case 'run': case 'more': return group(repo, 'runs');
      case 'workflow': return group(repo, 'workflows');
      case 'job': return { kind: 'run', repo, run: node.run };
      case 'step': return { kind: 'job', repo, run: node.run, job: node.job };
    }
  }

  getTreeItem(node: WfNode): vscode.TreeItem {
    const state = (c: 'none' | 'collapsed' | 'expanded'): vscode.TreeItemCollapsibleState =>
      c === 'none' ? vscode.TreeItemCollapsibleState.None
        : c === 'collapsed' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded;
    const slot = this.slot(node.repo.key);
    switch (node.kind) {
      case 'run': case 'job': case 'step': case 'workflow': {
        const view = describeNode(node, { now: Date.now(), branch: slot?.branch ?? null });
        const item = new vscode.TreeItem(view.label, state(view.collapsible));
        item.id = view.id;
        item.description = view.description;
        item.tooltip = view.tooltip;
        item.iconPath = new vscode.ThemeIcon(view.icon.icon, view.icon.color ? new vscode.ThemeColor(view.icon.color) : undefined);
        item.contextValue = view.context;
        if (node.kind === 'job' || node.kind === 'step') item.command = { command: 'null.workflows.openLog', title: 'Open Log', arguments: [node] };
        if (node.kind === 'workflow') item.command = { command: 'null.workflows.openWorkflowFile', title: 'Open Workflow File', arguments: [node] };
        return item;
      }
      case 'repo': {
        const item = new vscode.TreeItem(`${node.repo.owner}/${node.repo.repo}`, vscode.TreeItemCollapsibleState.Expanded);
        item.id = nodeId(node);
        item.iconPath = new vscode.ThemeIcon('repo');
        item.contextValue = 'repo';
        return item;
      }
      case 'signin': {
        const item = new vscode.TreeItem('Sign in to GitHub for this folder');
        item.id = nodeId(node);
        item.iconPath = new vscode.ThemeIcon('account');
        item.command = { command: 'null.workflows.signIn', title: 'Sign In', arguments: [node] };
        return item;
      }
      case 'error': {
        const item = new vscode.TreeItem(node.text);
        item.id = nodeId(node);
        item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
        item.description = 'Try Again';
        item.command = { command: 'null.workflows.refresh', title: 'Try Again' };
        return item;
      }
      case 'note': {
        const item = new vscode.TreeItem(node.text);
        item.id = nodeId(node);
        item.iconPath = new vscode.ThemeIcon('info');
        item.contextValue = 'note';
        if (node.command) item.command = { command: node.command, title: node.text, arguments: [node] };
        return item;
      }
      case 'group': {
        const runs = node.group === 'runs';
        const item = new vscode.TreeItem(runs ? 'Runs' : 'Workflows', runs ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
        item.id = nodeId(node);
        item.iconPath = new vscode.ThemeIcon(runs ? 'history' : 'file-code');
        if (!runs && slot && slot.workflowsTotal > slot.workflows.length) item.description = `first ${slot.workflows.length}`;
        return item;
      }
      case 'more': {
        const item = new vscode.TreeItem('Load more…');
        item.id = nodeId(node);
        item.iconPath = new vscode.ThemeIcon('ellipsis');
        item.command = { command: 'null.workflows.loadMore', title: 'Load More', arguments: [node] };
        return item;
      }
    }
  }

  async getChildren(node?: WfNode): Promise<WfNode[]> {
    if (!node) {
      if (this.state !== 'ready') return [];
      if (this.all.length === 1) return this.repoChildren(this.all[0]);
      return this.all.map(s => ({ kind: 'repo', repo: ref(s) }));
    }
    const slot = this.slot(node.repo.key);
    if (!slot) return [];
    switch (node.kind) {
      case 'repo': return this.repoChildren(slot);
      case 'group': return node.group === 'runs' ? this.runNodes(slot) : this.workflowNodes(slot);
      case 'run': return this.jobNodes(slot, node);
      case 'job': return node.job.steps.map(step => ({ kind: 'step', repo: node.repo, run: node.run, job: node.job, step }));
      default: return [];
    }
  }

  private repoChildren(slot: RepoSlot): WfNode[] {
    const repo = ref(slot);
    if (!slot.token) return [{ kind: 'signin', repo }];
    if (slot.error && slot.runs.length === 0 && slot.workflows.length === 0) return [{ kind: 'error', repo, text: slot.error }];
    const rows: WfNode[] = [group(repo, 'runs'), group(repo, 'workflows')];
    return slot.failures >= 3 && slot.error ? [{ kind: 'error', repo, text: slot.error }, ...rows] : rows;
  }

  private runNodes(slot: RepoSlot): WfNode[] {
    const repo = ref(slot);
    const rows: WfNode[] = [];
    if (slot.pinned) rows.push({ kind: 'run', repo, run: slot.pinned });
    rows.push(...slot.runs.map((run): WfNode => ({ kind: 'run', repo, run })));
    if (slot.runs.length === 0 && !slot.pinned) rows.push({ kind: 'note', repo, id: 'no-runs', text: isDefaultFilter(this.filter) ? 'No runs yet' : 'No runs match the filter' });
    if (slot.runs.length < slot.runsTotal) rows.push({ kind: 'more', repo });
    return rows;
  }

  private workflowNodes(slot: RepoSlot): WfNode[] {
    const repo = ref(slot);
    if (slot.workflows.length === 0) return [{ kind: 'note', repo, id: 'no-workflows', text: 'No workflows yet', command: 'null.workflows.createWorkflow' }];
    return slot.workflows.map((workflow): WfNode => ({ kind: 'workflow', repo, workflow, dispatchable: slot.dispatchable.get(workflow.id) === true }));
  }

  private async jobNodes(slot: RepoSlot, node: Extract<WfNode, { kind: 'run' }>): Promise<WfNode[]> {
    let jobs = slot.jobs.get(node.run.id);
    if (!jobs) {
      try {
        jobs = await api.listJobs(slot.owner, slot.repo, node.run.id, slot.token);
        slot.jobs.set(node.run.id, jobs);
      } catch (err) {
        this.fail(slot, err);
        return [{ kind: 'note', repo: node.repo, id: `jobs-${node.run.id}`, text: `Could not load jobs: ${describeFailure(err)}` }];
      }
    }
    if (jobs.length === 0) return [{ kind: 'note', repo: node.repo, id: `jobs-${node.run.id}`, text: 'Waiting for jobs…' }];
    return jobs.map((job): WfNode => ({ kind: 'job', repo: node.repo, run: node.run, job }));
  }
}
```

- [ ] **Step 5: Write the integration glue** — create `src/workflows/workflowsIntegration.ts`:

```ts
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { fetchRepoFile } from '../github/githubApi';
import { getAccountsApi } from '../github/githubAuth';
import { resolveGithubSession } from '../github/githubSession';
import { describeFailure } from '../pulls/pullModel';
import { WfNode } from './workflowsModel';
import { WorkflowsTreeProvider } from './workflowsTreeView';

const MAX_WORKFLOW_FILE_BYTES = 256 * 1024;

export function registerWorkflowsFeature(context: vscode.ExtensionContext): void {
  const tree = new WorkflowsTreeProvider(context.workspaceState);
  const view = vscode.window.createTreeView<WfNode>('null.workflowsView', { treeDataProvider: tree });
  tree.onMessage = message => { view.message = message; };
  let lastRefresh = 0;
  const refresh = async (): Promise<void> => { lastRefresh = Date.now(); await tree.refresh(); };

  async function signIn(node: WfNode): Promise<void> {
    const slot = tree.slot(node.repo.key);
    if (!slot) return;
    // The only interactive call: the user clicked the row for this folder.
    const session = await resolveGithubSession(getAccountsApi(), slot.folder, true);
    if (session) await refresh();
  }

  async function openWorkflowFile(node: WfNode): Promise<void> {
    const slot = tree.slot(node.repo.key);
    if (node.kind !== 'workflow' || !slot) return;
    const local = vscode.Uri.joinPath(slot.folder, node.workflow.path);
    try {
      await vscode.workspace.fs.stat(local);
      await vscode.window.showTextDocument(local);
      return;
    } catch { /* not on disk: read it from GitHub */ }
    try {
      const file = await fetchRepoFile(slot.owner, slot.repo, 'HEAD', node.workflow.path, slot.token, MAX_WORKFLOW_FILE_BYTES);
      const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content: file.bytes.toString('utf8') });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not open ${path.posix.basename(node.workflow.path)}: ${describeFailure(err)}`);
    }
  }

  context.subscriptions.push(
    view,
    vscode.commands.registerCommand('null.workflows.refresh', refresh),
    vscode.commands.registerCommand('null.workflows.open', () => vscode.commands.executeCommand('null.workflowsView.focus')),
    vscode.commands.registerCommand('null.workflows.signIn', signIn),
    vscode.commands.registerCommand('null.workflows.loadMore', async (node: WfNode) => {
      const slot = tree.slot(node.repo.key);
      if (slot) await tree.loadMore(slot);
    }),
    vscode.commands.registerCommand('null.workflows.openOnGitHub', (node: WfNode) => {
      const url = node.kind === 'run' ? node.run.url : node.kind === 'job' ? node.job.url
        : node.kind === 'workflow' ? `https://github.com/${node.repo.owner}/${node.repo.repo}/actions/workflows/${path.posix.basename(node.workflow.path)}`
          : node.kind === 'repo' ? `https://github.com/${node.repo.owner}/${node.repo.repo}/actions` : '';
      if (url) void vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.commands.registerCommand('null.workflows.openWorkflowFile', openWorkflowFile),
    vscode.commands.registerCommand('null.workflows.createWorkflow', async (node: WfNode) => {
      const slot = tree.slot(node.repo.key);
      if (!slot) return;
      const dir = vscode.Uri.joinPath(slot.folder, '.github', 'workflows');
      try {
        await vscode.workspace.fs.stat(dir);
        await vscode.commands.executeCommand('revealInExplorer', dir);
      } catch {
        void vscode.window.showInformationMessage('Create .github/workflows/ in this folder and add a YAML workflow file to it.');
      }
    }),
    // Test seam for the integration spec (like _null.pulls.snapshot): the view's state and per-repo counts.
    vscode.commands.registerCommand('_null.workflows.snapshot', async () => {
      await tree.ensureLoaded();
      return tree.snapshot();
    }),
    // Nothing is fetched until the view is first shown.
    view.onDidChangeVisibility(e => { if (e.visible && !tree.loaded) void refresh(); }),
  );
  if (view.visible) void refresh();

  // Binding or importing an account must show up without a manual refresh, but never wakes a view nobody opened.
  const accountsChanged = getAccountsApi()?.onDidChange(() => { if (tree.loaded) void refresh(); });
  if (accountsChanged) context.subscriptions.push(accountsChanged);
}
```

Note on `openWorkflowFile` ref: `fetchRepoFile(…, 'HEAD', …)` — the Contents API accepts a ref name; if `HEAD` is rejected in the manual check (Task 12), pass `slot.branch ?? await api.getDefaultBranch(...)` instead.

- [ ] **Step 6: Register in `extension.ts`.** In `src/extension.ts` add the import after the `registerPullsFeature` import (line 16): `import { registerWorkflowsFeature } from './workflows/workflowsIntegration';` and the call after `registerPullsFeature(context);` (line 139): `  registerWorkflowsFeature(context);`.

- [ ] **Step 7: Contribute everything in `package.json`.**

a) `nullWorkspace.features`: append
```json
      { "id": "workflows", "label": "GitHub Actions", "category": "develop", "icon": "play-circle",
        "command": "null.workflows.open", "description": "Browse workflow runs, logs and actions", "order": 27 }
```
(`order: 27` places it between Pull Requests, 25, and Commit Graph, 30, as the test expects.)

b) `contributes.commands`: append
```json
      { "command": "null.workflows.open", "title": "Null: Show GitHub Actions" },
      { "command": "null.workflows.refresh", "title": "Null: Refresh GitHub Actions", "icon": "$(refresh)" },
      { "command": "null.workflows.signIn", "title": "Null: Sign in to GitHub for GitHub Actions" },
      { "command": "null.workflows.loadMore", "title": "Null: Load More Workflow Runs" },
      { "command": "null.workflows.openOnGitHub", "title": "Open on GitHub", "icon": "$(link-external)" },
      { "command": "null.workflows.openWorkflowFile", "title": "Open Workflow File", "icon": "$(go-to-file)" },
      { "command": "null.workflows.createWorkflow", "title": "Create Workflow" }
```

c) `viewsContainers.activitybar`: append `{ "id": "null-workflows", "title": "GitHub Actions", "icon": "media/github-actions.svg" }`.

d) `views`: add `"null-workflows": [ { "id": "null.workflowsView", "name": "GitHub Actions", "visibility": "visible" } ]`.

e) `viewsWelcome`: append (one entry per state; the same wording as the Pull Requests ones where the case is the same)
```json
      { "view": "null.workflowsView", "contents": "Open a folder to see its GitHub Actions.\n[Open Folder](command:workbench.action.files.openFolder)", "when": "null.workflows.state == no-folder" },
      { "view": "null.workflowsView", "contents": "GitHub Actions isn't available in remote windows yet.", "when": "null.workflows.state == remote" },
      { "view": "null.workflowsView", "contents": "GitHub Actions doesn't run in an untrusted workspace.\n[Manage Workspace Trust](command:workbench.trust.manage)", "when": "null.workflows.state == untrusted" },
      { "view": "null.workflowsView", "contents": "The open folder is not a Git repository.\n[Initialize Repository](command:git.init)", "when": "null.workflows.state == not-a-repo" },
      { "view": "null.workflowsView", "contents": "Git was not found. Install Git and reload the window.", "when": "null.workflows.state == no-git" },
      { "view": "null.workflowsView", "contents": "No open folder has an `origin` remote on github.com.", "when": "null.workflows.state == no-repo" },
      { "view": "null.workflowsView", "contents": "Could not load GitHub Actions.\n[Try Again](command:null.workflows.refresh)", "when": "null.workflows.state == error" }
```

f) `menus."view/title"`: append `{ "command": "null.workflows.refresh", "when": "view == null.workflowsView", "group": "navigation@2" }`.

g) `menus."view/item/context"`: append
```json
        { "command": "null.workflows.openOnGitHub", "when": "view == null.workflowsView && viewItem =~ /^(run|job|workflow|repo)/", "group": "inline@9" },
        { "command": "null.workflows.openOnGitHub", "when": "view == null.workflowsView && viewItem =~ /^(run|job|workflow|repo)/", "group": "9_github@0" },
        { "command": "null.workflows.openWorkflowFile", "when": "view == null.workflowsView && viewItem =~ /^workflow/", "group": "1_workflow@0" }
```

h) `menus."commandPalette"`: append `{ "command": "null.workflows.signIn", "when": "false" }, { "command": "null.workflows.loadMore", "when": "false" }, { "command": "null.workflows.openOnGitHub", "when": "false" }, { "command": "null.workflows.openWorkflowFile", "when": "false" }, { "command": "null.workflows.createWorkflow", "when": "false" }` (they need a tree node; `open` and `refresh` stay palette-visible).

- [ ] **Step 8: Run unit tests, then the integration spec**

Run: `npm test`
Expected: PASS (including `featureManifests.test.js`).

Run: `npm run test:integration`
Expected: PASS for `null-tools GitHub Actions` (it launches a VS Code test host; if that is not available on this machine, run the `/verify-local null-tools` skill instead, which runs the same specs against the installed Null IDE).

- [ ] **Step 9: Commit**

```bash
git add src/workflows/workflowsTreeView.ts src/workflows/workflowsIntegration.ts src/extension.ts src/test/suite/workflows.spec.ts src/featureManifests.test.ts media/github-actions.svg media/github-actions-dark.svg package.json tsconfig.json
git commit -m "feat(null-tools): add the GitHub Actions view with runs, jobs, steps and workflows"
```

---

### Task 8: Polling, focus refresh and the filter

**Files:**
- Modify: `extensions/null-tools/src/workflows/workflowsTreeView.ts` (add `poll()`)
- Create: `extensions/null-tools/src/workflows/workflowFilterMenu.ts`
- Modify: `extensions/null-tools/src/workflows/workflowsIntegration.ts`
- Modify: `extensions/null-tools/package.json`
- Modify: `extensions/null-tools/src/test/suite/workflows.spec.ts`

**Interfaces:**
- Consumes: `pollDelay`, `POLL_FAST_MS`, `isActive`, `filterRows`, `DEFAULT_FILTER`, `isWorkflowFile` (Task 2).
- Produces: `WorkflowsTreeProvider.poll(): Promise<number | null>` (ms until the next tick, `null` when nothing is active); `editFilter(current: RunFilter, workflowFiles: () => Array<{ file: string; name: string }>): Promise<RunFilter | undefined>` in `workflowFilterMenu.ts`; commands `null.workflows.filter`, `null.workflows.filterByWorkflow`.

- [ ] **Step 1: Extend the integration spec first.** In `workflows.spec.ts`, add `'null.workflows.filter'` to the registered-commands list in the existing test.

Run: `npm run test:integration`
Expected: FAIL — `null.workflows.filter is registered`.

- [ ] **Step 2: Add `poll()` to the tree.** In `workflowsTreeView.ts`, add the imports `POLL_FAST_MS, pollDelay` to the model import list and this method inside `WorkflowsTreeProvider` (after `hasActiveRuns`):

```ts
  /**
   * One polling tick: re-fetch the repos that have a run in play (and are not rate-limited), then say when to come back.
   * null = nothing is active, stop the timer.
   */
  async poll(): Promise<number | null> {
    const now = Date.now();
    const live = this.all.filter(s => s.token !== null && s.runs.some(isActive));
    if (live.length === 0) return null;
    await Promise.all(live.filter(s => (s.retryAt ?? 0) <= now).map(s => this.reloadRuns(s)));
    const stillLive = this.all.filter(s => s.token !== null && s.runs.some(isActive));
    if (stillLive.length === 0) return null;
    const since = Math.min(...stillLive.flatMap(s => s.runs.filter(isActive).map(r => Date.parse(r.startedAt ?? r.updatedAt) || now)));
    const retryAt = stillLive.reduce<number | null>((m, s) => (s.retryAt !== null && (m === null || s.retryAt > m) ? s.retryAt : m), null);
    return pollDelay({
      oldestActiveSince: Number.isFinite(since) ? since : null, now: Date.now(),
      failures: Math.max(...stillLive.map(s => s.failures)), retryAt,
    });
  }
```

(`POLL_FAST_MS` is used by the integration; import only what `workflowsTreeView.ts` uses to avoid unused-import errors — `pollDelay` here; drop `POLL_FAST_MS` from this file.)

- [ ] **Step 3: Write the filter menu** — create `src/workflows/workflowFilterMenu.ts` (native QuickPick glue, like `pullFilterMenu.ts`; its logic lives in the already-tested `filterRows`/`parseFilter`):

```ts
'use strict';

import * as vscode from 'vscode';
import { DEFAULT_FILTER, FilterRowId, RunFilter, filterRows } from './workflowsModel';

const APPLY = '$(check) Apply';
const RESET = '$(discard) Reset';

/** One menu: toggle a facet and it comes back; Apply returns the draft, Escape returns undefined (no change). */
export async function editFilter(
  current: RunFilter, workflowFiles: () => Array<{ file: string; name: string }>,
): Promise<RunFilter | undefined> {
  let draft = { ...current };
  for (;;) {
    const rows = filterRows(draft).map(r => ({ label: r.label, description: r.description, id: r.id as FilterRowId | 'apply' | 'reset' }));
    const picked = await vscode.window.showQuickPick(
      [...rows, { label: RESET, description: '', id: 'reset' as const }, { label: APPLY, description: '', id: 'apply' as const }],
      { title: 'Filter GitHub Actions runs', placeHolder: 'Pick a facet to change, then Apply' },
    );
    if (!picked) return undefined;
    switch (picked.id) {
      case 'apply': return draft;
      case 'reset': draft = { ...DEFAULT_FILTER }; break;
      case 'branch': draft = { ...draft, branch: !draft.branch }; break;
      case 'mine': draft = { ...draft, mine: !draft.mine }; break;
      case 'failed': draft = { ...draft, failed: !draft.failed }; break;
      case 'workflow': {
        const files = workflowFiles();
        const choice = await vscode.window.showQuickPick(
          [{ label: 'Any workflow', file: null as string | null, description: '' }, ...files.map(f => ({ label: f.name, file: f.file as string | null, description: f.file }))],
          { title: 'Show runs of one workflow' },
        );
        if (choice) draft = { ...draft, workflow: choice.file };
        break;
      }
    }
  }
}
```

- [ ] **Step 4: Wire polling, focus refresh and the filter commands into `workflowsIntegration.ts`.** Add `const FOCUS_REFRESH_MIN_MS = 60_000;` at the top of the file (next to `MAX_WORKFLOW_FILE_BYTES`) and, inside `registerWorkflowsFeature` before `context.subscriptions.push(`:

```ts
  // One shared timer, only while the view is visible, only while some run is in play.
  let timer: NodeJS.Timeout | undefined;
  const stop = (): void => { if (timer) { clearTimeout(timer); timer = undefined; } };
  const schedule = (ms: number | null): void => {
    stop();
    if (ms !== null && view.visible) timer = setTimeout(() => void tick(), ms);
  };
  const tick = async (): Promise<void> => {
    timer = undefined;
    schedule(await tree.poll());
  };
  const rearm = (): void => { if (!timer && view.visible && tree.hasActiveRuns()) schedule(POLL_FAST_MS); };

  const workflowFiles = (): Array<{ file: string; name: string }> => {
    const seen = new Map<string, string>();
    for (const s of tree.slots()) for (const w of s.workflows) seen.set(path.posix.basename(w.path), w.name);
    return [...seen].map(([file, name]) => ({ file, name }));
  };
  async function applyFilter(next: RunFilter): Promise<void> {
    lastRefresh = Date.now();
    await tree.setFilter(next);
  }
```

and add to the imports: `import { POLL_FAST_MS, RunFilter, isWorkflowFile } from './workflowsModel';` and `import { editFilter } from './workflowFilterMenu';`.

Add to the `context.subscriptions.push(` list:

```ts
    tree.onDidLoad(rearm),
    view.onDidChangeVisibility(e => { if (e.visible) rearm(); else stop(); }),
    { dispose: stop },
    // Coming back to the window picks up new runs, at most once a minute and only while the view is shown.
    vscode.window.onDidChangeWindowState(e => {
      if (e.focused && tree.loaded && view.visible && Date.now() - lastRefresh > FOCUS_REFRESH_MIN_MS) void refresh();
    }),
    vscode.commands.registerCommand('null.workflows.filter', async () => {
      if (tree.state !== 'ready') {
        void vscode.window.showInformationMessage('Open the GitHub Actions view of a folder with a GitHub remote first.');
        return;
      }
      const next = await editFilter(tree.filter, workflowFiles);
      if (next) await applyFilter(next);
    }),
    vscode.commands.registerCommand('null.workflows.filterByWorkflow', async (node: WfNode) => {
      if (node.kind === 'workflow') {
        const file = path.posix.basename(node.workflow.path);
        if (isWorkflowFile(file)) await applyFilter({ ...tree.filter, workflow: file });
      }
    }),
```

Keep Task 7's `view.onDidChangeVisibility(e => { if (e.visible && !tree.loaded) void refresh(); })` listener; the new one above is a second listener on the same event (both run), so first show loads the tree and then `tree.onDidLoad` arms the timer.

The branch marker follows `vscode.git`: add after the account listener

```ts
  void getGitApi().then(git => {
    const subs = git.repositories.map(r => r.state.onDidChange(() => { if (view.visible && tree.loaded) void tree.refreshBranches(); }));
    context.subscriptions.push(...subs);
  }, () => undefined);
```

with `import { getGitApi } from '../graph/gitApi';`. (`refreshBranches` runs one cheap `git symbolic-ref` per repo and only fires a redraw when a branch really changed; it never refetches.)

- [ ] **Step 5: Contribute the filter in `package.json`.**
- `commands`: `{ "command": "null.workflows.filter", "title": "Null: Filter GitHub Actions Runs", "icon": "$(filter)" }`, `{ "command": "null.workflows.filterByWorkflow", "title": "Filter Runs by This Workflow", "icon": "$(filter)" }`
- `menus."view/title"`: `{ "command": "null.workflows.filter", "when": "view == null.workflowsView && null.workflows.state == ready", "group": "navigation@1" }`
- `menus."view/item/context"`: `{ "command": "null.workflows.filterByWorkflow", "when": "view == null.workflowsView && viewItem =~ /^workflow/", "group": "1_workflow@1" }`
- `menus."commandPalette"`: `{ "command": "null.workflows.filterByWorkflow", "when": "false" }`

- [ ] **Step 6: Run the checks**

Run: `npm test` then `npm run test:integration`
Expected: PASS (the new command is registered; `pollDelay`, `filterRows`, `parseFilter` were already pinned in Task 2).

- [ ] **Step 7: Commit**

```bash
git add src/workflows/workflowsTreeView.ts src/workflows/workflowFilterMenu.ts src/workflows/workflowsIntegration.ts src/test/suite/workflows.spec.ts package.json
git commit -m "feat(null-tools): poll running workflow runs and add the run filter"
```

---

### Task 9: Log documents, failure inspection and file links

**Files:**
- Create: `extensions/null-tools/src/workflows/workflowLogProvider.ts`
- Modify: `extensions/null-tools/src/workflows/workflowsIntegration.ts`
- Modify: `extensions/null-tools/package.json`
- Modify: `extensions/null-tools/src/test/suite/workflows.spec.ts`

**Interfaces:**
- Consumes: `fetchJobLog`, `getJob`, `listJobs` (Task 3); `renderJobDoc`, `pathRefs`, `repoRelative`, `firstFailedStep`, `TRUNCATED_NOTICE` (Task 4); `logDocParts`, `parseLogDoc`, `WORKFLOW_SCHEME` (Task 5).
- Produces: `class WorkflowLogProvider implements vscode.TextDocumentContentProvider, vscode.DocumentLinkProvider` with `constructor(ctx: { tokenFor(owner, repo): string | null; folderFor(owner, repo): vscode.Uri | undefined })`, `refreshLive(): void`, `hasLive(): boolean`, `forget(uri): void`; commands `null.workflows.openLog` (job/step node), `null.workflows.showFailureLog` (run/job node), `null.workflows.showRunFailure` (owner, repo, runId — used by Task 11).

- [ ] **Step 1: Extend the integration spec first.** In the existing test add, before the final `snapshot` assertion:

```ts
    // A traversal path never reaches the network: the provider answers with an empty document.
    for (const hostile of [
      vscode.Uri.from({ scheme: 'null-workflows', path: '/../../etc/passwd' }),
      vscode.Uri.from({ scheme: 'null-workflows', path: '/o/r/abc/x.log' }),
      vscode.Uri.from({ scheme: 'null-workflows', path: '/o/r/5/x.log', query: 'step=abc' }),
    ]) {
      assert.strictEqual((await vscode.workspace.openTextDocument(hostile)).getText(), '', hostile.toString());
    }
```

and add `'null.workflows.openLog'`, `'null.workflows.showFailureLog'`, `'null.workflows.showRunFailure'` to the registered-commands list.

Run: `npm run test:integration`
Expected: FAIL — no content provider for `null-workflows`.

- [ ] **Step 2: Write the provider** — create `src/workflows/workflowLogProvider.ts`:

```ts
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { ApiError } from '../github/githubApi';
import { describeFailure } from '../pulls/pullModel';
import { JobLog, fetchJobLog, getJob } from './workflowsApi';
import { TRUNCATED_NOTICE, pathRefs, renderJobDoc, repoRelative } from './jobLog';
import { parseLogDoc } from './workflowLogDocs';
import { isActive } from './workflowsModel';

const MAX_LINKS = 200;

export interface LogContext {
  tokenFor(owner: string, repo: string): string | null;
  folderFor(owner: string, repo: string): vscode.Uri | undefined;
}

const insideFolder = (folder: string, target: string): boolean => {
  const rel = path.relative(folder, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * Serves `null-workflows:` documents: one read-only tab per job (or per step). A job that is still running shows its steps
 * and whatever log text the endpoint returns, is refreshed on the poll tick, and stops being refreshed once it completes.
 */
export class WorkflowLogProvider implements vscode.TextDocumentContentProvider, vscode.DocumentLinkProvider {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;
  /** Documents whose job has not finished, by uri string. */
  private readonly live = new Map<string, vscode.Uri>();
  /** The job's page on GitHub, for the truncation notice's link. */
  private readonly pages = new Map<string, string>();

  constructor(private readonly ctx: LogContext) {}

  hasLive(): boolean { return this.live.size > 0; }
  refreshLive(): void { for (const uri of this.live.values()) this.changed.fire(uri); }
  forget(uri: vscode.Uri): void {
    this.live.delete(uri.toString());
    this.pages.delete(uri.toString());
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const ref = parseLogDoc(uri.path, uri.query);
    if (!ref) return '';
    const token = this.ctx.tokenFor(ref.owner, ref.repo);
    const key = uri.toString();
    try {
      const job = await getJob(ref.owner, ref.repo, ref.jobId, token);
      if (isActive(job)) this.live.set(key, uri); else this.live.delete(key);
      if (job.url) this.pages.set(key, job.url);
      let log: JobLog | null = null;
      let gone = false;
      try {
        log = await fetchJobLog(ref.owner, ref.repo, ref.jobId, token);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) gone = true;
        else if (!isActive(job)) throw err; // a running job's log is best-effort
      }
      return renderJobDoc({ job, log: log?.text ?? null, truncated: log?.truncated ?? false, step: ref.step, gone: gone && !isActive(job), now: Date.now() });
    } catch (err) {
      this.live.delete(key);
      return `Could not load this log: ${describeFailure(err)}`;
    }
  }

  /** Links `##[error]`/`##[warning]` lines' `path:line` and `path(line,col)` to workspace files that exist, and the truncation notice to GitHub. */
  async provideDocumentLinks(doc: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
    const ref = parseLogDoc(doc.uri.path, doc.uri.query);
    if (!ref) return [];
    const out: vscode.DocumentLink[] = [];
    const page = this.pages.get(doc.uri.toString());
    if (page && doc.lineCount > 0 && doc.lineAt(0).text === TRUNCATED_NOTICE) out.push(new vscode.DocumentLink(doc.lineAt(0).range, vscode.Uri.parse(page)));
    const folder = this.ctx.folderFor(ref.owner, ref.repo);
    if (!folder) return out;
    const exists = new Map<string, boolean>();
    for (let i = 0; i < doc.lineCount && out.length < MAX_LINKS; i++) {
      const text = doc.lineAt(i).text;
      if (!/##\[(error|warning)\]|\b(error|warning|fatal)\b/i.test(text)) continue;
      for (const r of pathRefs(text)) {
        const rel = repoRelative(r.path);
        if (!rel) continue;
        const target = vscode.Uri.joinPath(folder, rel);
        if (!insideFolder(folder.fsPath, target.fsPath)) continue;
        let ok = exists.get(target.fsPath);
        if (ok === undefined) {
          ok = await vscode.workspace.fs.stat(target).then(() => true, () => false);
          exists.set(target.fsPath, ok);
        }
        if (ok) out.push(new vscode.DocumentLink(new vscode.Range(i, r.start, i, r.end), target.with({ fragment: `L${r.line}${r.col ? `,${r.col}` : ''}` })));
      }
    }
    return out;
  }
}
```

- [ ] **Step 3: Register the provider, log opening and failure inspection in `workflowsIntegration.ts`.** Add imports:

```ts
import { listJobs } from './workflowsApi';
import { firstFailedStep } from './jobLog';
import { WORKFLOW_SCHEME, logDocParts } from './workflowLogDocs';
import { WorkflowLogProvider } from './workflowLogProvider';
import { isFailed } from './workflowsModel';
```

Inside `registerWorkflowsFeature`, before `context.subscriptions.push(`:

```ts
  const logs = new WorkflowLogProvider({
    tokenFor: (owner, repo) => tree.slotForRepo(owner, repo)?.token ?? null,
    folderFor: (owner, repo) => tree.slotForRepo(owner, repo)?.folder,
  });

  async function openLog(owner: string, repo: string, jobId: number, jobName: string, step: { number: number; name: string } | null): Promise<void> {
    const parts = logDocParts({ owner, repo, jobId, step: step?.number ?? null }, step ? `${jobName}-${step.name}` : jobName);
    await vscode.window.showTextDocument(vscode.Uri.from(parts), { preview: true });
  }

  /** The first failed step's log of the first failed job; the whole job log when no step is marked failed. */
  async function showFailure(slot: NonNullable<ReturnType<typeof tree.slot>>, runId: number): Promise<void> {
    try {
      const jobs = slot.jobs.get(runId) ?? await listJobs(slot.owner, slot.repo, runId, slot.token);
      slot.jobs.set(runId, jobs);
      const failedJob = jobs.find(isFailed);
      if (!failedJob) {
        void vscode.window.showInformationMessage('No failed job in this run.');
        return;
      }
      const step = firstFailedStep(failedJob);
      await openLog(slot.owner, slot.repo, failedJob.id, failedJob.name, step ? { number: step.number, name: step.name } : null);
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not open the failure log: ${describeFailure(err)}`);
    }
  }
```

Add to the push list:

```ts
    vscode.workspace.registerTextDocumentContentProvider(WORKFLOW_SCHEME, logs),
    vscode.languages.registerDocumentLinkProvider({ scheme: WORKFLOW_SCHEME }, logs),
    vscode.workspace.onDidCloseTextDocument(d => { if (d.uri.scheme === WORKFLOW_SCHEME) logs.forget(d.uri); }),
    vscode.commands.registerCommand('null.workflows.openLog', async (node: WfNode) => {
      if (node.kind === 'job') await openLog(node.repo.owner, node.repo.repo, node.job.id, node.job.name, null);
      else if (node.kind === 'step') await openLog(node.repo.owner, node.repo.repo, node.job.id, node.job.name, node.step);
    }),
    vscode.commands.registerCommand('null.workflows.showFailureLog', async (node: WfNode) => {
      const slot = tree.slot(node.repo.key);
      if (!slot) return;
      if (node.kind === 'run') await showFailure(slot, node.run.id);
      else if (node.kind === 'job' || node.kind === 'step') await openLog(node.repo.owner, node.repo.repo, node.job.id, node.job.name, node.kind === 'step' ? node.step : (firstFailedStep(node.job) ?? null));
    }),
    // Called by the PR tab (Task 11): the host, not the webview, supplies owner, repo and run id from its own page.
    vscode.commands.registerCommand('null.workflows.showRunFailure', async (owner: string, repo: string, runId: number) => {
      if (!Number.isSafeInteger(runId) || runId <= 0) return;
      await tree.ensureLoaded();
      const slot = tree.slotForRepo(owner, repo);
      if (slot) await showFailure(slot, runId);
      else void vscode.window.showInformationMessage('Open a folder of this repository to see its GitHub Actions.');
    }),
```

Make the existing poll `tick` also refresh live logs and keep the timer alive for them: change `schedule(await tree.poll());` to

```ts
    const next = await tree.poll();
    logs.refreshLive();
    schedule(next ?? (logs.hasLive() ? POLL_FAST_MS : null));
```

and `rearm` to `if (!timer && view.visible && (tree.hasActiveRuns() || logs.hasLive())) schedule(POLL_FAST_MS);`.

- [ ] **Step 4: Contribute the commands in `package.json`.**
- `commands`: `{ "command": "null.workflows.openLog", "title": "Open Log" }`, `{ "command": "null.workflows.showFailureLog", "title": "Show Failure Log", "icon": "$(error)" }`, `{ "command": "null.workflows.showRunFailure", "title": "Null: Show Workflow Run Failure Log" }`
- `menus."view/item/context"`: `{ "command": "null.workflows.openLog", "when": "view == null.workflowsView && viewItem =~ /^(job|step)/", "group": "2_log@0" }`, `{ "command": "null.workflows.showFailureLog", "when": "view == null.workflowsView && viewItem =~ /^(run|job|step) failed/", "group": "inline@0" }`, `{ "command": "null.workflows.showFailureLog", "when": "view == null.workflowsView && viewItem =~ /^(run|job|step) failed/", "group": "2_log@1" }`
- `menus."commandPalette"`: `{ "command": "null.workflows.openLog", "when": "false" }, { "command": "null.workflows.showFailureLog", "when": "false" }, { "command": "null.workflows.showRunFailure", "when": "false" }`

(The `viewItem` tokens are `run failed …`, `job failed …`, `step failed`, so `/^(run|job|step) failed/` matches only failed rows.)

- [ ] **Step 5: Run the checks**

Run: `npm test` then `npm run test:integration`
Expected: PASS (hostile URIs return `''` because `parseLogDoc` yields `null`).

- [ ] **Step 6: Commit**

```bash
git add src/workflows/workflowLogProvider.ts src/workflows/workflowsIntegration.ts src/test/suite/workflows.spec.ts package.json
git commit -m "feat(null-tools): open job and step logs as documents, with failure inspection"
```

---

### Task 10: Management actions — re-run, cancel, enable, dispatch

**Files:**
- Create: `extensions/null-tools/src/workflows/workflowActions.ts`
- Modify: `extensions/null-tools/src/workflows/workflowsIntegration.ts`
- Modify: `extensions/null-tools/package.json`
- Modify: `extensions/null-tools/src/test/suite/workflows.spec.ts`

**Interfaces:**
- Consumes: `refusal`, `actionFailureText`, `branchChoices`, `isPlausibleRef`, `RunAction` (Task 2); `rerunRun`, `rerunFailedJobs`, `rerunJob`, `cancelRun`, `enableWorkflow`, `dispatchWorkflow`, `getRun`, `getJob`, `listBranches` (Task 3); `parseDispatch`, `validateInput`, `DispatchInput` (Task 6).
- Produces (`workflowActions.ts`): `runAction(tree, node, action): Promise<void>`, `enable(tree, node)`, `dispatch(tree, node)`; commands `null.workflows.rerunAll`, `rerunFailed`, `rerunJob`, `cancel`, `enable`, `dispatch`.

Behaviour contract (spec "Management actions"): the host **re-reads** the run/job before acting and refuses with the reason if the state changed; Re-run all, Cancel and Enable are modal-confirmed; API refusals (409, 403, 422) are shown verbatim in a toast; the tree refreshes either way.

- [ ] **Step 1: Extend the integration spec first.** Add `'null.workflows.rerunAll', 'null.workflows.rerunFailed', 'null.workflows.rerunJob', 'null.workflows.cancel', 'null.workflows.enable', 'null.workflows.dispatch'` to the registered-commands list.

Run: `npm run test:integration`
Expected: FAIL — those commands are not registered.

- [ ] **Step 2: Write the actions** — create `src/workflows/workflowActions.ts`. The decision logic (`refusal`, `actionFailureText`, `validateInput`, `branchChoices`, `isPlausibleRef`) is already unit-tested; this file is only prompts and calls.

```ts
'use strict';

import * as vscode from 'vscode';
import { fetchRepoFile } from '../github/githubApi';
import { getAccountsApi } from '../github/githubAuth';
import { resolveGithubSession } from '../github/githubSession';
import { DispatchInput, parseDispatch, validateInput } from './dispatchInputs';
import * as api from './workflowsApi';
import { RunAction, WfNode, actionFailureText, branchChoices, isPlausibleRef, refusal } from './workflowsModel';
import { RepoSlot, WorkflowsTreeProvider } from './workflowsTreeView';

const MAX_WORKFLOW_BYTES = 256 * 1024;
const DISPATCH_REFRESH_MS = 3000; // GitHub does not return the new run id, so look again shortly

/** The token for a write: the one the tree has, or an interactive sign-in for this folder. */
async function writeToken(slot: RepoSlot): Promise<string | null> {
  if (slot.token) return slot.token;
  const session = await resolveGithubSession(getAccountsApi(), slot.folder, true);
  slot.token = session?.accessToken ?? null;
  return slot.token;
}

const LABELS: Record<RunAction, string> = {
  rerunAll: 'Re-run all jobs', rerunFailed: 'Re-run failed jobs', rerunJob: 'Re-run job', cancel: 'Cancel run',
};
const CONFIRM: Partial<Record<RunAction, string>> = { rerunAll: 'Re-run all jobs of this run?', cancel: 'Cancel this run?' };

/** Re-reads the target, refuses a stale click with the reason, confirms where the spec says so, then calls the API. */
export async function runAction(tree: WorkflowsTreeProvider, node: WfNode, action: RunAction): Promise<void> {
  const slot = tree.slot(node.repo.key);
  if (!slot || (node.kind !== 'run' && node.kind !== 'job')) return;
  const token = await writeToken(slot);
  if (!token) return;
  const { owner, repo } = slot;
  const id = node.kind === 'run' ? node.run.id : node.job.id;
  try {
    const fresh = node.kind === 'run' ? await api.getRun(owner, repo, id, token) : await api.getJob(owner, repo, id, token);
    const reason = refusal(action, fresh);
    if (reason) {
      void vscode.window.showWarningMessage(`${LABELS[action]}: ${reason}`);
      await tree.reloadRuns(slot);
      return;
    }
    const question = CONFIRM[action];
    if (question && !await vscode.window.showWarningMessage(question, { modal: true }, LABELS[action])) return;
    switch (action) {
      case 'rerunAll': await api.rerunRun(owner, repo, id, token); break;
      case 'rerunFailed': await api.rerunFailedJobs(owner, repo, id, token); break;
      case 'rerunJob': await api.rerunJob(owner, repo, id, token); break;
      case 'cancel': await api.cancelRun(owner, repo, id, token); break;
    }
    void vscode.window.showInformationMessage(`${LABELS[action]}: requested.`);
  } catch (err) {
    void vscode.window.showErrorMessage(`${LABELS[action]}: ${actionFailureText(err)}`);
  }
  slot.jobs.clear(); // a re-run starts a new attempt: reload jobs when the rows are opened again
  await tree.reloadRuns(slot);
}

export async function enable(tree: WorkflowsTreeProvider, node: WfNode): Promise<void> {
  const slot = tree.slot(node.repo.key);
  if (!slot || node.kind !== 'workflow') return;
  const token = await writeToken(slot);
  if (!token) return;
  if (!await vscode.window.showWarningMessage(`Enable the workflow "${node.workflow.name}"?`, { modal: true }, 'Enable')) return;
  try {
    await api.enableWorkflow(slot.owner, slot.repo, node.workflow.id, token);
    void vscode.window.showInformationMessage(`${node.workflow.name} is enabled.`);
  } catch (err) {
    void vscode.window.showErrorMessage(`Enable workflow: ${actionFailureText(err)}`);
  }
  await tree.refresh();
}

/** A branch (or any typed ref), then one prompt per `workflow_dispatch` input read from the YAML at that ref. */
async function pickRef(slot: RepoSlot, token: string, title: string): Promise<string | undefined> {
  const branches = await api.listBranches(slot.owner, slot.repo, token).catch(() => [] as string[]);
  const choices = branchChoices(branches, slot.branch);
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem>();
  qp.title = title;
  qp.placeholder = 'Branch or tag to run on (type to use any ref)';
  const base: vscode.QuickPickItem[] = choices.map(label => ({ label }));
  qp.items = base;
  qp.onDidChangeValue(value => {
    const typed = value.trim();
    qp.items = typed && !choices.includes(typed) && isPlausibleRef(typed) ? [{ label: typed, description: 'use this ref' }, ...base] : base;
  });
  return new Promise<string | undefined>(resolve => {
    qp.onDidAccept(() => { resolve(qp.selectedItems[0]?.label); qp.hide(); });
    qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
    qp.show();
  });
}

async function askInput(workflow: string, input: DispatchInput): Promise<string | undefined> {
  const title = `${workflow}: ${input.name}`;
  if (input.type === 'boolean' || input.type === 'choice') {
    const options = input.type === 'boolean' ? ['true', 'false'] : input.options;
    const items = options.map(label => ({ label, description: label === input.default ? 'default' : '' }));
    return (await vscode.window.showQuickPick(items, { title, placeHolder: input.description || input.name }))?.label;
  }
  return vscode.window.showInputBox({
    title, prompt: input.description || undefined, value: input.default ?? '',
    validateInput: v => validateInput(input, v),
  });
}

export async function dispatch(tree: WorkflowsTreeProvider, node: WfNode): Promise<void> {
  const slot = tree.slot(node.repo.key);
  if (!slot || node.kind !== 'workflow') return;
  const token = await writeToken(slot);
  if (!token) return;
  const { workflow } = node;
  const ref = await pickRef(slot, token, `Run ${workflow.name}`);
  if (!ref) return;
  let inputs: DispatchInput[];
  try {
    const file = await fetchRepoFile(slot.owner, slot.repo, ref, workflow.path, token, MAX_WORKFLOW_BYTES);
    const parsed = parseDispatch(file.bytes.toString('utf8'));
    if (!parsed.dispatchable) {
      void vscode.window.showWarningMessage(`${workflow.name} has no workflow_dispatch trigger at ${ref}.`);
      return;
    }
    inputs = parsed.inputs;
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not read ${workflow.path} at ${ref}: ${actionFailureText(err)}`);
    return;
  }
  const values: Record<string, string> = {};
  for (const input of inputs) {
    const value = await askInput(workflow.name, input);
    if (value === undefined) return; // Escape anywhere cancels the whole dispatch
    if (value !== '') values[input.name] = value;
  }
  try {
    await api.dispatchWorkflow(slot.owner, slot.repo, workflow.id, ref, values, token);
    void vscode.window.showInformationMessage(`Started ${workflow.name} on ${ref}.`);
  } catch (err) {
    void vscode.window.showErrorMessage(`Run workflow: ${actionFailureText(err)}`);
  }
  setTimeout(() => void tree.reloadRuns(slot), DISPATCH_REFRESH_MS);
}
```

- [ ] **Step 3: Register the commands in `workflowsIntegration.ts`.** Add `import { dispatch, enable, runAction } from './workflowActions';` and to the push list:

```ts
    vscode.commands.registerCommand('null.workflows.rerunAll', (node: WfNode) => runAction(tree, node, 'rerunAll')),
    vscode.commands.registerCommand('null.workflows.rerunFailed', (node: WfNode) => runAction(tree, node, 'rerunFailed')),
    vscode.commands.registerCommand('null.workflows.rerunJob', (node: WfNode) => runAction(tree, node, 'rerunJob')),
    vscode.commands.registerCommand('null.workflows.cancel', (node: WfNode) => runAction(tree, node, 'cancel')),
    vscode.commands.registerCommand('null.workflows.enable', (node: WfNode) => enable(tree, node)),
    vscode.commands.registerCommand('null.workflows.dispatch', (node: WfNode) => dispatch(tree, node)),
```

- [ ] **Step 4: Contribute them in `package.json`.**
- `commands`:
```json
      { "command": "null.workflows.rerunAll", "title": "Re-run All Jobs", "icon": "$(debug-rerun)" },
      { "command": "null.workflows.rerunFailed", "title": "Re-run Failed Jobs" },
      { "command": "null.workflows.rerunJob", "title": "Re-run Job", "icon": "$(debug-rerun)" },
      { "command": "null.workflows.cancel", "title": "Cancel Run", "icon": "$(debug-stop)" },
      { "command": "null.workflows.enable", "title": "Enable Workflow" },
      { "command": "null.workflows.dispatch", "title": "Run Workflow…", "icon": "$(play)" }
```
- `menus."view/item/context"` (the `viewItem` tokens come from `runContext`/`jobContext`/`workflowContext`, matched as whole words):
```json
        { "command": "null.workflows.cancel", "when": "view == null.workflowsView && viewItem =~ /(^| )cancel( |$)/", "group": "inline@1" },
        { "command": "null.workflows.rerunAll", "when": "view == null.workflowsView && viewItem =~ /(^| )rerunAll( |$)/", "group": "inline@2" },
        { "command": "null.workflows.dispatch", "when": "view == null.workflowsView && viewItem =~ /(^| )dispatch( |$)/", "group": "inline@1" },
        { "command": "null.workflows.cancel", "when": "view == null.workflowsView && viewItem =~ /(^| )cancel( |$)/", "group": "3_manage@0" },
        { "command": "null.workflows.rerunAll", "when": "view == null.workflowsView && viewItem =~ /(^| )rerunAll( |$)/", "group": "3_manage@1" },
        { "command": "null.workflows.rerunFailed", "when": "view == null.workflowsView && viewItem =~ /(^| )rerunFailed( |$)/", "group": "3_manage@2" },
        { "command": "null.workflows.rerunJob", "when": "view == null.workflowsView && viewItem =~ /(^| )rerunJob( |$)/", "group": "3_manage@3" },
        { "command": "null.workflows.dispatch", "when": "view == null.workflowsView && viewItem =~ /(^| )dispatch( |$)/", "group": "3_manage@4" },
        { "command": "null.workflows.enable", "when": "view == null.workflowsView && viewItem =~ /(^| )enable( |$)/", "group": "3_manage@5" }
```
- `menus."commandPalette"`: add `{ "command": "<id>", "when": "false" }` for each of the six commands.

- [ ] **Step 5: Run the checks**

Run: `npm test` then `npm run test:integration`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/workflows/workflowActions.ts src/workflows/workflowsIntegration.ts src/test/suite/workflows.spec.ts package.json
git commit -m "feat(null-tools): re-run, cancel, enable and dispatch workflows from the view"
```

---

### Task 11: Pull request tab — "Show in GitHub Actions" and "Show failure log"

**Files:**
- Modify: `extensions/null-tools/src/webview/pullDetailHtml.ts` (check rows)
- Modify: `extensions/null-tools/src/webview/pullDetail.ts` (click handler)
- Modify: `extensions/null-tools/lib/pullDetail.css` (hand-written; the link-style buttons)
- Modify: `extensions/null-tools/src/pulls/pullDetailPanel.ts` (two inbound messages)
- Modify: `extensions/null-tools/src/webviewPullDetail.test.ts`
- Modify: `extensions/null-tools/src/workflows/workflowsIntegration.ts` (`null.workflows.revealRun`)
- Modify: `extensions/null-tools/package.json`, `extensions/null-tools/src/test/suite/workflows.spec.ts`

**Interfaces:**
- Consumes: the page's `checks[i].runId` and `.state` (already modelled); `tree.pin`, `tree.ensureLoaded`, `tree.slotForRepo`, `api.getRun` (Tasks 3 and 7).
- Produces: webview messages `{ type: 'showRun', index: number }` and `{ type: 'showFailure', index: number }`; command `null.workflows.revealRun(owner: string, repo: string, runId: number)`.

The webview never supplies ids: it sends the check's index, and the host looks the run id up in the page it loaded itself (the same rule as *Re-run failed jobs*).

- [ ] **Step 1: Write the failing test.** In `src/webviewPullDetail.test.ts`, after the `checks: names and links are escaped…` test add:

```ts
test('checks: runs offer Show in GitHub Actions, failed runs also Show failure log; legacy statuses offer neither', () => {
  const out = html.pullPageHtml(page({
    checks: [check({ name: 'unit', state: 'failure', runId: 7 }), check({ name: 'lint', state: 'success', runId: 8 }), check({ name: 'legacy', state: 'failure', runId: null })],
    checksTotal: 3,
  }));
  assert.ok(out.includes('data-act="show-run" data-check="0"'));
  assert.ok(out.includes('data-act="show-failure" data-check="0"'));
  assert.ok(out.includes('data-act="show-run" data-check="1"'));
  assert.ok(!out.includes('data-act="show-failure" data-check="1"'), 'a passing run has no failure log');
  assert.ok(!out.includes('data-check="2"'), 'a legacy status belongs to no workflow run');
  assert.ok(!/data-(run|id)/.test(out), 'run ids never go into the page for the webview to send back');
});
```

Run: `npm test`
Expected: FAIL on the new assertions.

- [ ] **Step 2: Render the links.** In `src/webview/pullDetailHtml.ts`, in `pullChecksHtml`, replace the row template's link line. The map callback gets an index and the actions live in one span (the first of them gets the `margin-left:auto`):

```ts
  const rows = p.checks.map((c, i) => {
    const run = c.runId !== null
      ? `<button type="button" class="check-link" data-act="show-run" data-check="${i}">Show in GitHub Actions</button>`
        + (c.state === 'failure' ? `<button type="button" class="check-link" data-act="show-failure" data-check="${i}">Show failure log</button>` : '')
      : '';
    return `<div class="check-row">
      <span class="check-dot check-${c.state}" title="${PULL_CHECK_TEXT[c.state]}"></span>
      <span class="check-name">${escapeHtml(c.name)}</span>
      <span class="muted">${escapeHtml(c.description)}</span>
      <span class="check-actions">${c.url ? `<a class="check-link" href="${escapeHtml(c.url)}">Details</a>` : ''}${run}</span>
    </div>`;
  }).join('');
```

In `lib/pullDetail.css` replace the `.check-link { margin-left:auto; }` rule (line 26) with:

```css
.check-actions { margin-left:auto; display:flex; gap:10px; }
button.check-link { background:none; border:0; padding:0; font:inherit; cursor:pointer; }
```

(The `.check-link, .commit-row a` colour rule on line 25 and the hover rule on line 27 stay and already style the buttons.)

- [ ] **Step 3: Send the messages from the webview.** In `src/webview/pullDetail.ts`, add to the `switch (button?.dataset.act)` (next to `case 'rerun'`):

```ts
      case 'show-run': case 'show-failure':
        // Only the position of the check goes out; the host looks the run up in the page it loaded itself.
        post({ type: button?.dataset.act === 'show-run' ? 'showRun' : 'showFailure', index: Number(button?.dataset.check) });
        break;
```

- [ ] **Step 4: Handle them in the host.** In `src/pulls/pullDetailPanel.ts`, extend `InboundMessage` with `| { type: 'showRun' | 'showFailure'; index: number }` and add the case in `handle`:

```ts
      case 'showRun':
      case 'showFailure': {
        const check = Number.isInteger(msg.index) ? this.page?.checks[msg.index] : undefined;
        if (!check || check.runId === null || (msg.type === 'showFailure' && check.state !== 'failure')) break;
        void vscode.commands.executeCommand(
          msg.type === 'showRun' ? 'null.workflows.revealRun' : 'null.workflows.showRunFailure', this.repo.owner, this.repo.repo, check.runId);
        break;
      }
```

- [ ] **Step 5: Add `null.workflows.revealRun`** in `workflowsIntegration.ts` (push list):

```ts
    // Called by the PR tab: reveal a run in the view, fetching it by id when it is not among the loaded ones.
    vscode.commands.registerCommand('null.workflows.revealRun', async (owner: string, repo: string, runId: number) => {
      if (!Number.isSafeInteger(runId) || runId <= 0) return;
      await vscode.commands.executeCommand('null.workflowsView.focus');
      await tree.ensureLoaded();
      const slot = tree.slotForRepo(owner, repo);
      if (!slot?.token) {
        void vscode.window.showInformationMessage('Open a folder of this repository, signed in to GitHub, to see its GitHub Actions.');
        return;
      }
      try {
        const run = slot.runs.find(r => r.id === runId) ?? await getRun(slot.owner, slot.repo, runId, slot.token);
        tree.pin(slot, run);
        await view.reveal({ kind: 'run', repo: { key: slot.key, owner: slot.owner, repo: slot.repo }, run }, { select: true, focus: true, expand: true });
      } catch (err) {
        void vscode.window.showErrorMessage(`Could not show run ${runId}: ${describeFailure(err)}`);
      }
    }),
```

with `import { getRun, listJobs } from './workflowsApi';` (replace the `listJobs`-only import from Task 9).

- [ ] **Step 6: Contribute and extend the spec.** `package.json`: `commands` `{ "command": "null.workflows.revealRun", "title": "Null: Show Workflow Run in GitHub Actions" }`; `menus."commandPalette"` `{ "command": "null.workflows.revealRun", "when": "false" }`. Add `'null.workflows.revealRun'` to the registered-commands list in `workflows.spec.ts`.

- [ ] **Step 7: Run the checks**

Run: `npm test` then `npm run compile` (the `pullDetail.js` bundle changed) then `npm run test:integration`
Expected: PASS; `lib/pullDetail.js` changed.

- [ ] **Step 8: Commit**

```bash
git add src/webview/pullDetailHtml.ts src/webview/pullDetail.ts src/pulls/pullDetailPanel.ts src/webviewPullDetail.test.ts src/workflows/workflowsIntegration.ts lib/pullDetail.css package.json src/test/suite/workflows.spec.ts
git commit -m "feat(null-tools): link PR checks to the GitHub Actions view and failure logs"
```

(`lib/pullDetail.js` is committed with the compiled output in Task 12.)

---

### Task 12: Verify in the real app, document, refresh output, clean up

**Files:**
- Modify: `extensions/null-tools/CLAUDE.md` (new table row)
- Modify: `CLAUDE.md` (root: null-tools feature list)
- Modify: `docs/specs/github-actions-design.md` (status, deviations found while building)
- Delete: `.github/workflows/actions-playground.yml`
- Modify: `extensions/null-tools/out/**`, `extensions/null-tools/lib/pullDetail.js` (compiled, via `npm run compile`)

- [ ] **Step 1: Verify in the real app.** Run the `/verify-local` skill for `null-tools` (it syncs into the installed Null IDE, reloads, and runs the integration specs). Then, in a window opened on a clone of this repo (signed in through null-accounts) with the playground workflow on the default branch, check each:

1. **Activity bar:** a "GitHub Actions" entry with its own icon; the Features hub (Null Workspace) lists "GitHub Actions" under *develop* and launches the view.
2. **Welcome states:** an empty window → "Open a folder…"; a folder without git → "not a Git repository"; a repo whose `origin` is not github.com → the no-`origin` text; a restricted (untrusted) folder → the trust text, with no network traffic.
3. **Signed out:** a folder with no bound account shows the root node with one **Sign in to GitHub for this folder** row (never a silent empty tree); clicking it runs the interactive sign-in and loads the repo.
4. **Runs:** the 30 latest runs with status icon, `branch · sha · event · duration · #n`, ● on the run of the checked-out branch, **Load more…** at the end. A run expands to jobs, a job to steps; a failed job opens expanded. Attempt shows only above 1.
5. **Workflows:** names with paths; "first 100" appears only for >100; **Open workflow file** opens the local YAML, or (after renaming the local folder's file away) the GitHub copy as a read-only document — if the `HEAD` ref was rejected, switch to the default-branch ref as noted in Task 7 Step 5.
6. **Dispatch:** *Run workflow…* appears only on the playground workflow (and other `workflow_dispatch` workflows), not on `build.yml`. It asks branch (current branch first; typing a tag works), then `who`, `flavor` (choice), `fail` (boolean); required enforced, defaults prefilled. After the 204 the new run appears within a few seconds and polls (status icon spins) until it completes; polling stops when nothing is active.
7. **Live logs:** while the playground job runs, open the job: it shows the steps with status and, per Task 1's observation, either appended log text or "Logs appear when the job finishes." Once the job completes the tab shows the full log and stops refreshing.
8. **Logs:** open a finished job (timestamps stripped, `▶` headings, `##[error]` kept) and each step (its own segment; for a run with skipped steps the fallback opens the full log at the nearest heading). **Show failure log** on the failing run (dispatch with `fail=true`) opens the failing step; `src/a.ts(3,4)` on the `##[error]`/error lines is a link only if `src/a.ts` exists in the folder (create one to see it), and a `../x` path is never linked.
9. **Truncation:** open a job with a >5 MB log if you have one (or skip and rely on Task 3's test); line 1 is the truncation notice and links to the job's page.
10. **Actions:** *Re-run all* and *Cancel* ask for confirmation, *Re-run failed jobs* and *Re-run job* do not; cancel a run mid-flight; click *Cancel* on a run that finished a moment ago (open the context menu, let it finish, click) → "It already finished." warning, no API call; *Enable workflow* on a workflow you disabled by hand. Try one action on a repo where you lack write access → GitHub's text plus the write-access hint.
11. **Filter:** title-bar button → toggle *Current branch*, *My runs*, *Failed only*, pick a *Workflow*, *Apply*; the view description shows the filter; it survives a window reload; **Filter runs by this workflow** from a workflow row; *Reset*.
12. **Two folders, one repo:** add the same clone twice as workspace folders → the repo appears once. Two different repos → two root nodes, each with its own Runs/Workflows; one failing (e.g. rename the remote so it 404s) leaves the other intact.
13. **PR tab:** open a PR with a workflow run: checks with a run show **Show in GitHub Actions** (reveals and selects the run, pinned if not loaded) and, when failed, **Show failure log** (opens the log); a legacy status shows neither; **Re-run failed jobs** still works.
14. **Rate limit / offline:** go offline, press Refresh → error row with Try Again (whole-view `error` text with one repo); polling backs off.

Fix any defect found before continuing (write a failing test first where the defect is in a pure file).

- [ ] **Step 2: Remove the playground and record deviations.** Delete the temporary workflow and ask the user to push the deletion along with the rest:

```bash
git rm .github/workflows/actions-playground.yml
```

In `docs/specs/github-actions-design.md` add, at the top under the title, `Status: implemented (plan: docs/plans/github-actions.md).` and under "Out of scope" add a short "Known limits" list covering what the build ended with (first 100 workflows; step segmentation is a heuristic that falls back to the full log; live logs per Task 1's observation).

- [ ] **Step 3: Document the feature.** In `extensions/null-tools/CLAUDE.md`, add a table row after the **Pull Requests** row:

```markdown
| **GitHub Actions** | `src/workflows/` (#132; named `workflows` in code so it never collides with the `null-actions` extension): the `null.workflowsView` tree in its own `null-workflows` activity-bar container. Per workspace folder whose `origin` is on github.com (same repo twice = once): Runs (30 latest, filter in `workspaceState` as `null.workflows.filter`, Load more) expanding to jobs and steps, and Workflows (dispatchable ones found by parsing the YAML with `yaml`). Tokens come per folder from `resolveGithubSession(…, folder.uri, false)`; a folder without a session shows a **Sign in** row. Logs open as `null-workflows:` documents (`workflowLogProvider.ts`; URIs built and validated by `workflowLogDocs.ts`); `fetchJobLog` follows the log redirect by hand and never sends the token to the second host; `jobLog.ts` strips timestamps and finds step segments with a marker heuristic that falls back to the full log. Polling is one shared timer while the view is visible (10 s, 30 s after 10 min, error back-off, rate limit suspends). Actions (`workflowActions.ts`) re-read the run before acting and refuse a stale click. Pure: `workflowsModel`, `workflowsApi` (over `requestJson`), `jobLog`, `workflowLogDocs`, `dispatchInputs`; only the glue files import `vscode`. The PR detail tab links checks to the view (`null.workflows.revealRun`, `null.workflows.showRunFailure`). Test seam `_null.workflows.snapshot`. Design `docs/specs/github-actions-design.md`; plan `docs/plans/github-actions.md` |
```

In the root `CLAUDE.md`, change the **null-tools** section's feature list sentence to include "GitHub Actions" (after "GitHub pull requests review").

- [ ] **Step 4: Refresh the compiled output and the graph, then commit**

```bash
cd extensions/null-tools && npm run compile && npm test && cd ../..
graphify update .
git add extensions/null-tools/CLAUDE.md CLAUDE.md docs/specs/github-actions-design.md
git commit -m "docs: document GitHub Actions integration (#132)"
git add extensions/null-tools/out extensions/null-tools/lib
git commit -m "chore: refresh null-tools compiled output"
```

(The playground deletion from Step 2 is already staged by `git rm`, so it goes into the first commit.) If `git status` shows nothing for `out`/`lib`, it was already committed; skip that commit. Then run `/wiki-sync` as a separate step (a new view, a new activity-bar entry and a Features hub entry are user-facing).

- [ ] **Step 5: Close the loop on GitHub** — ask first (outward-facing), then comment on #132: "Implemented: native GitHub Actions view (runs, jobs, steps, logs, polling, re-run/cancel/dispatch/enable, PR check links). Plan: `docs/plans/github-actions.md`." Close the issue only if the user says so.

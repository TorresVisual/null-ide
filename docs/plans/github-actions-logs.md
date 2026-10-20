# GitHub Actions Logs Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Finish the log half of the GitHub Actions view (#132): clicking a job or step opens its log as a read-only `null-workflows:` document, a failed run/job offers **Show failure log**, `path:line` references in error lines are links, and a job that is still running is followed on the poll tick.

**Architecture:** One pure file (`jobLog.ts`: strip timestamps, find step segments, extract file references, render a document) tested against logs captured from a real run, then one `vscode` glue file (`workflowLogProvider.ts`) registered from `workflowsIntegration.ts`. The URI scheme (`workflowLogDocs.ts`), the redirect-following `fetchJobLog` and `getJob` already exist and are not touched.

**Tech Stack:** TypeScript (commonjs), `node:test`, VS Code `TextDocumentContentProvider` / `DocumentLinkProvider`, GitHub REST via the existing `workflowsApi.ts`.

**Spec:** `docs/specs/github-actions-design.md` ("Logs", "Log redirect"). **Continues** `docs/plans/github-actions.md`: its Tasks 2, 3, 5, 6, 7, 8 and 10 are done (commits `056bbd6` … `aa318e8`). This plan replaces that plan's Task 1 (the unfinished part), Task 4 and Task 9, with changes found by reading the code as it is now. Its Tasks 11 (PR tab links) and 12 (verify, document, clean up) come **after** this plan and are unchanged except for the notes under "After this plan".

**Why now:** the tree already gives every job and step row `command: null.workflows.openLog` (`workflowsTreeView.ts:303`), but nothing registers that command, so clicking a job or step currently does nothing useful.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Everything lives in `extensions/null-tools`; run `npm` commands from that directory. `git` commands in the steps are written for the repo root.
- Naming: `workflows` in code, never `actions` (collides with the `null-actions` extension).
- GitHub REST only, through `workflowsApi.ts`. The signed log URL is requested with **no** `Authorization` header (already implemented in `fetchJobLog`; do not add another log fetch path).
- Log limits from the spec: 5 MB cap cut from the front (`LOG_CAP`), line 1 of a truncated log is "Log truncated (showing last 5 MB). Open on GitHub for the full log." linking to the job's page.
- Only the glue files import `vscode`: `workflowLogProvider.ts` here, plus the existing `workflowsIntegration.ts`. `jobLog.ts` must stay pure.
- Polling stays one shared timer, only while the view is visible (spec decision 8). The log provider never starts its own timer.
- `out/` and `lib/*.js` are tracked build output; never hand-edit them. Intermediate tasks stage only the source files they name (running `npm test` rewrites `out/`; leave that dirty). The refreshed output is committed by the old plan's Task 12.
- Every new `*.test.ts` goes into **both** `tsconfig.json`'s `include` and the explicit `node --test` list in `package.json`'s `test` script, or it is silently skipped.
- Commit style: `feat(null-tools): …` / `test(null-tools): …` / `docs: …`. End every commit message with the `Co-Authored-By` line the session gives you. Do not push.
- The Bash tool halves doubled backslashes in command text. Put anything with regex or Windows-path backslashes in a file written with the Write tool, not in a shell heredoc.

## Review Focus

Conditions the spec implies that a happy-path test would miss, most likely first. Each has a pinned test in the task named in brackets:

1. **A hostile `null-workflows:` URI** (`..` owner, non-numeric job id, `step=abc`) must answer with an empty document and never reach the network. [Task 3 integration spec; `parseLogDoc` unit tests already exist]
2. **Logs that do not look like the happy path**: no timestamps, `\r\n`, a BOM, an empty log, a user's own `::group::`, a step number that does not exist. A step must fall back to the full log, never throw. [Task 2 `cleanLog…`, `locateStep…`]
3. **A job that is running or was never logged**: queued steps must not break step matching, and a 404 / empty answer says "Logs appear when the job finishes." (running) or the 90-day notice (finished) rather than showing an error. [Task 2 `locateStep: a running job…`, `renderJobDoc…`]
4. **Error-line paths that point outside the repo** (`../x`, absolute paths, a URL ending in `:3`, a Windows path) must never become links. [Task 2 `pathRefs…`, `repoRelative…`]
5. **A skipped step** writes no log text, so the segment count is one short of the step count; that must be an exact match on the right steps, not a silent shift by one. [Task 2 `real captured logs…` against the skipped-step capture]

---

### Task 1: Probe the live-log endpoint and capture real logs

The spec says the live-log design hinges on one unproven fact: whether `GET …/actions/jobs/{id}/logs` serves text while the job is still running. This task answers it against the real API and saves two real logs as fixtures for Task 2. The playground workflow (`.github/workflows/actions-playground.yml`) is already on `origin/main` (commit `934be14`), so nothing needs creating or pushing. `gh` is authenticated as `TorresVisual`.

This dispatches two real workflow runs on the repo's Actions. They take about a minute each, need no secrets, and are the same runs the old plan's Task 12 would trigger. **Ask the user before dispatching.**

**Files:**
- Create: `extensions/null-tools/src/workflows/realLog.fixture.ts` (generated by a script, not typed by hand)
- Modify: `docs/specs/github-actions-design.md` (the "Live logs are best-effort until verified" bullet, line 42)

- [ ] **Step 1: Probe the endpoint while the job runs.** One script (it takes about 1.5 minutes). It dispatches the failing variant, waits until the "Slow output" step (a 30 s window) is running, then asks for the log three times 8 s apart, following the redirect by hand without the token, like the product code:

```bash
P=/tmp/actions-probe; R=TorresVisual/null-ide; mkdir -p $P
BEFORE=$(gh run list --workflow actions-playground.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh workflow run actions-playground.yml -f who=probe -f fail=true
for i in $(seq 1 30); do
  RUN=$(gh run list --workflow actions-playground.yml --limit 1 --json databaseId -q '.[0].databaseId')
  [ -n "$RUN" ] && [ "$RUN" != "$BEFORE" ] && break; sleep 2
done
[ "$RUN" = "$BEFORE" ] && { echo "no new run appeared"; exit 1; }
for i in $(seq 1 40); do
  JOB=$(gh api repos/$R/actions/runs/$RUN/jobs -q '.jobs[] | select(.name=="build") | select(any(.steps[]; .name=="Slow output" and .status=="in_progress")) | .id')
  [ -n "$JOB" ] && break; sleep 2
done
echo "run=$RUN job=$JOB" | tee $P/ids.txt
TOKEN=$(gh auth token)
for n in 1 2 3; do
  echo "--- sample $n"
  curl -s -o /dev/null -D $P/h$n.txt -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" https://api.github.com/repos/$R/actions/jobs/$JOB/logs
  head -1 $P/h$n.txt
  LOC=$(grep -i '^location:' $P/h$n.txt | tr -d '\r' | cut -d' ' -f2-)
  if [ -n "$LOC" ]; then
    echo "redirect host: $(echo "$LOC" | cut -d/ -f3)"
    curl -s -o $P/b$n.txt -w "second request: HTTP %{http_code}, %{size_download} bytes\n" "$LOC"
    tail -n 2 $P/b$n.txt
  fi
  sleep 8
done
```

If `JOB` is empty after the loop (the step window was missed), rerun the script; the run it dispatched is harmless.

Write down for each sample: the first response's status line, the redirect host, the second request's status and size, and whether the last lines changed between samples (`tick 1`, `tick 2`, …).

- [ ] **Step 2: Capture the finished failing run.** Wait for the run, then save its log and steps (`gh api` follows the redirect itself and drops the token on the second host; do not use `curl -L` with the header):

```bash
P=/tmp/actions-probe; R=TorresVisual/null-ide
read RUN JOB < <(sed -E 's/run=([0-9]+) job=([0-9]+)/\1 \2/' $P/ids.txt)
gh run watch $RUN --exit-status > /dev/null || true
gh api repos/$R/actions/jobs/$JOB/logs > $P/fail.log
gh api repos/$R/actions/jobs/$JOB -q '[.steps[] | {number, name, status, conclusion}]' > $P/fail.steps.json
wc -l $P/fail.log; cat $P/fail.steps.json
```

- [ ] **Step 3: Capture a run with a skipped step.** The `Maybe fail` step is skipped when `fail=false`:

```bash
P=/tmp/actions-probe; R=TorresVisual/null-ide
BEFORE=$(gh run list --workflow actions-playground.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh workflow run actions-playground.yml -f who=skip -f fail=false
for i in $(seq 1 30); do
  RUN=$(gh run list --workflow actions-playground.yml --limit 1 --json databaseId -q '.[0].databaseId')
  [ "$RUN" != "$BEFORE" ] && break; sleep 2
done
gh run watch $RUN --exit-status > /dev/null || true
JOB=$(gh api repos/$R/actions/runs/$RUN/jobs -q '.jobs[] | select(.name=="build") | .id')
gh api repos/$R/actions/jobs/$JOB/logs > $P/skip.log
gh api repos/$R/actions/jobs/$JOB -q '[.steps[] | {number, name, status, conclusion}]' > $P/skip.steps.json
cat $P/skip.steps.json
```

- [ ] **Step 4: Check the assumptions Task 2's step matching rests on.** Open `/tmp/actions-probe/fail.log` and `skip.log` and note any that is wrong (Task 2 Step 3 adapts `STEP_MARKER` to what you find):
1. Every line starts with an ISO timestamp and a space (`2026-…Z `); the first line may have a BOM.
2. Each `run:` step begins with a `##[group]Run …` line followed later by `##[endgroup]`.
3. The last step ("Complete job") begins with `Cleaning up orphan processes`. (This workflow has no `uses:` steps, so there are no `Post job cleanup.` lines.)
4. The first step ("Set up job") has no `##[group]Run` marker; its groups are named `Operating System`, `Runner Image`, `GITHUB_TOKEN Permissions` and so on.
5. The workflow's own `::group::Counting` appears as `##[group]Counting`.
6. In `skip.log` the skipped step "Maybe fail" writes nothing, and `skip.steps.json` lists it with `"conclusion": "skipped"`.
7. In `fail.log` `##[error]Told to fail` and `##[error]Process completed with exit code 1.` appear for the failing step, and the `Warn and error` step prints `src/a.ts(3,4): error TS2304 …` and a `##[warning]` line.

- [ ] **Step 5: Generate the fixture.** Save this script with the Write tool as `/tmp/actions-probe/mkfixture.cjs` (it avoids backslashes on purpose), then run it from the repo root:

```js
const fs = require('fs');
const [, , failLog, failSteps, skipLog, skipSteps, out] = process.argv;
const CR = String.fromCharCode(13);
const text = f => JSON.stringify(fs.readFileSync(f, 'utf8').split(CR).join(''));
const steps = f => JSON.stringify(JSON.parse(fs.readFileSync(f, 'utf8')), null, 2);
fs.writeFileSync(out, [
  "'use strict';",
  '',
  '// Captured from real runs of .github/workflows/actions-playground.yml (docs/plans/github-actions-logs.md, Task 1).',
  '// REAL_*: the run dispatched with fail=true. SKIPPED_*: fail=false, so the "Maybe fail" step was skipped.',
  'export interface FixtureStep { number: number; name: string; status: string; conclusion: string | null }',
  '',
  `export const REAL_LOG = ${text(failLog)};`,
  `export const REAL_STEPS: FixtureStep[] = ${steps(failSteps)};`,
  '',
  `export const SKIPPED_LOG = ${text(skipLog)};`,
  `export const SKIPPED_STEPS: FixtureStep[] = ${steps(skipSteps)};`,
  '',
].join('\n'));
```

```bash
P=/tmp/actions-probe
node $P/mkfixture.cjs $P/fail.log $P/fail.steps.json $P/skip.log $P/skip.steps.json extensions/null-tools/src/workflows/realLog.fixture.ts
head -c 600 extensions/null-tools/src/workflows/realLog.fixture.ts
```

Expected: a TypeScript file exporting four constants. If assumptions 1–7 above found a difference, add a `// NOTE:` line under the header comment naming it.

- [ ] **Step 6: Record the observation in the spec.** In `docs/specs/github-actions-design.md`, replace the sentence "**The first task of the plan runs the playground workflow and records what the endpoint returns mid-run**; the log-streaming code is built to that observation." with one paragraph of this shape, keeping exactly the true alternative in each brace pair:

```markdown
**Observed (2026-10-20, `actions-playground.yml`):** while a job was in progress, `GET …/jobs/{id}/logs` answered {302 with a signed URL on `<host>` | 404 | <other status>}; {the signed URL returned the lines printed so far and the body grew between samples | the signed URL returned an empty body | it returned a fixed prefix that did not grow}. The log document therefore {appends the returned text on every poll | shows the steps and "Logs appear when the job finishes." until the job completes}.
```

- [ ] **Step 7: Commit**

```bash
git add docs/specs/github-actions-design.md extensions/null-tools/src/workflows/realLog.fixture.ts
git commit -m "docs: record live-log probe result and capture real logs for GitHub Actions (#132)"
```

(`realLog.fixture.ts` compiles because Task 2's test imports it.)

---

### Task 2: Job log text (pure)

**Files:**
- Create: `extensions/null-tools/src/workflows/jobLog.ts`
- Create: `extensions/null-tools/src/workflows/jobLog.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Consumes: `WorkflowJob`, `WorkflowStep`, `elapsed`, `isActive`, `isFailed` from `workflowsModel.ts`; the four fixture constants from Task 1.
- Produces (`jobLog.ts`), all Task 3 relies on these exact names:
  - `cleanLog(raw: string): string[]`
  - `segmentLog(lines: string[]): Array<{ start: number; end: number }>`
  - `locateStep(lines: string[], steps: WorkflowStep[], stepNumber: number): { start: number; end: number; exact: boolean }`
  - `interface PathRef { path: string; line: number; col: number | null; start: number; end: number }`, `pathRefs(text: string): PathRef[]`, `repoRelative(p: string): string | null`
  - `TRUNCATED_NOTICE`, `NOT_YET_NOTICE`, `GONE_NOTICE`
  - `interface DocInput { job: WorkflowJob; log: string | null; truncated: boolean; step: number | null; gone: boolean; now: number }`, `renderJobDoc(i: DocInput): string`
  - `firstFailedStep(job: WorkflowJob): WorkflowStep | undefined`

- [ ] **Step 1: Write the failing test** — create `src/workflows/jobLog.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import {
  GONE_NOTICE, NOT_YET_NOTICE, TRUNCATED_NOTICE, cleanLog, firstFailedStep, locateStep, pathRefs, renderJobDoc, repoRelative, segmentLog,
} from './jobLog';
import { WorkflowJob, WorkflowStep } from './workflowsModel';
import { REAL_LOG, REAL_STEPS, SKIPPED_LOG, SKIPPED_STEPS } from './realLog.fixture';

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
  assert.deepStrictEqual(cleanLog('﻿2026-10-01T10:00:00Zx\nplain'), ['x', 'plain']);
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

test('locateStep: a running job\'s not-yet-started steps do not break the match', () => {
  const lines = cleanLog(LOG.split('\n').slice(0, 8).join('\n'));
  const steps = [step(1, 'Set up job'), step(2, 'a', null, 'in_progress'), step(3, 'b', null, 'queued'), step(4, 'Complete job', null, 'queued')];
  const at = locateStep(lines, steps, 2);
  assert.strictEqual(at.exact, true);
  assert.strictEqual(lines[at.start], '▶ Run echo hi');
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

test('real captured logs: one segment per step that wrote a log, and every such step resolves exactly (Task 1)', () => {
  for (const [name, log, steps] of [['failing run', REAL_LOG, REAL_STEPS], ['run with a skipped step', SKIPPED_LOG, SKIPPED_STEPS]] as const) {
    const lines = cleanLog(log);
    assert.ok(lines.length > 0, name);
    assert.ok(!lines.some(l => /^\d{4}-\d\d-\d\dT/.test(l)), `${name}: every timestamp was stripped`);
    const full: WorkflowStep[] = steps.map(s => ({ ...s, startedAt: null, completedAt: null }));
    const logged = full.filter(s => s.conclusion !== 'skipped');
    assert.strictEqual(segmentLog(lines).length, logged.length, `${name}: one segment per step that wrote a log`);
    for (const s of logged) assert.ok(locateStep(lines, full, s.number).exact, `${name}: step ${s.number} (${s.name}) resolves exactly`);
  }
  assert.ok(SKIPPED_STEPS.some(s => s.conclusion === 'skipped'), 'the skipped-step capture really has a skipped step');
  assert.ok(cleanLog(REAL_LOG).some(l => l.startsWith('##[error]')), 'the failing capture keeps its ##[error] lines');
});

test('pathRefs: path:line:col and path(line,col), nothing from urls or windows paths', () => {
  assert.deepStrictEqual(pathRefs('##[error]src/a.ts(3,4): error TS2304'), [{ path: 'src/a.ts', line: 3, col: 4, start: 9, end: 22 }]);
  assert.deepStrictEqual(pathRefs('src/b.c:10:5: error: x').map(r => [r.path, r.line, r.col]), [['src/b.c', 10, 5]]);
  assert.deepStrictEqual(pathRefs('lib/c.py:7 failed').map(r => [r.path, r.line, r.col]), [['lib/c.py', 7, null]]);
  assert.deepStrictEqual(pathRefs('see https://example.com/a.js:3 for more'), []);
  assert.deepStrictEqual(pathRefs(['D:', 'a', 'r', 'r', 'src', 'x.ts:3'].join(String.fromCharCode(92))), []);
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
  const gone404 = renderJobDoc({ job: running, log: null, truncated: false, step: null, gone: true, now: 0 });
  assert.ok(gone404.includes(NOT_YET_NOTICE) && !gone404.includes(GONE_NOTICE), 'a 404 on a running job is "not yet", never "no longer available"');
});

test('firstFailedStep', () => {
  assert.strictEqual(firstFailedStep(job([step(1, 'a'), step(2, 'b', 'failure'), step(3, 'c', 'failure')]))?.number, 2);
  assert.strictEqual(firstFailedStep(job([step(1, 'a')])), undefined);
});
```

- [ ] **Step 2: Register the test and see it fail.** In `tsconfig.json`'s `include`, append `"src/workflows/jobLog.test.ts"` after `"src/workflows/dispatchInputs.test.ts"`. In `package.json`'s `test` script, replace `out/workflows/dispatchInputs.test.js"` with `out/workflows/dispatchInputs.test.js out/workflows/jobLog.test.js"`.

Run: `npm test`
Expected: FAIL — `tsc` reports `Cannot find module './jobLog'`.

- [ ] **Step 3: Write the implementation** — create `src/workflows/jobLog.ts` (use the Write tool; it contains regexes). `STEP_MARKER` encodes Task 1's assumptions 2–4; if the captured logs disagreed, change it (and the synthetic `LOG` in the test) to what they show — the `real captured logs` test is the arbiter.

```ts
'use strict';

import { WorkflowJob, WorkflowStep, elapsed, isActive, isFailed } from './workflowsModel';

export const TRUNCATED_NOTICE = 'Log truncated (showing last 5 MB). Open on GitHub for the full log.';
export const NOT_YET_NOTICE = 'Logs appear when the job finishes.';
export const GONE_NOTICE = 'Logs are no longer available (GitHub keeps them 90 days) or you lack access.';

const TIMESTAMP = /^﻿?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;

/** Log lines for display: no timestamps (step rows show durations), `##[group]x` as `▶ x`, `##[endgroup]` gone. */
export function cleanLog(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.replace(TIMESTAMP, '').replace(/^﻿/, '');
    if (text.startsWith('##[endgroup]')) continue;
    out.push(text.startsWith('##[group]') ? `▶ ${text.slice('##[group]'.length)}` : text);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

/**
 * Where each step's text begins: the first step ("Set up job") starts the log; every `run:`/`uses:` step opens a
 * `##[group]Run …` group, post steps open with "Post job cleanup." and the last step with "Cleaning up orphan processes".
 * A user's own `::group::` does not match, so it stays inside its step. (A user group literally named "Run …" would
 * add a segment; `locateStep` then sees a count mismatch and falls back to the full log.)
 */
const STEP_MARKER = /^(▶ Run |Post job cleanup\.$|Cleaning up orphan processes$)/;

export function segmentLog(lines: string[]): Array<{ start: number; end: number }> {
  const starts = [0];
  lines.forEach((l, i) => { if (i > 0 && STEP_MARKER.test(l)) starts.push(i); });
  return starts.map((start, i) => ({ start, end: starts[i + 1] ?? lines.length }));
}

/** A step that has written, or is writing, log text: not skipped, and already started. */
const wroteLog = (s: WorkflowStep): boolean => s.conclusion !== 'skipped' && (s.status === 'completed' || s.status === 'in_progress');

/**
 * The lines of one step. Exact only when the log splits into as many segments as there are steps that wrote anything
 * (a skipped or not-yet-started step writes nothing); otherwise the whole log from the nearest heading, so a step never
 * ends in an error.
 */
export function locateStep(lines: string[], steps: WorkflowStep[], stepNumber: number): { start: number; end: number; exact: boolean } {
  const logged = steps.filter(wroteLog);
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
Expected: PASS, including `jobLog.test.js` (all earlier suites still pass). If `real captured logs` fails, the real log disagrees with `STEP_MARKER`: print `segmentLog(cleanLog(REAL_LOG))` starts against `REAL_STEPS`, adjust the regex to the observed markers (and the synthetic `LOG` to match), re-run.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/workflows/jobLog.ts extensions/null-tools/src/workflows/jobLog.test.ts extensions/null-tools/tsconfig.json extensions/null-tools/package.json
git commit -m "feat(null-tools): add GitHub Actions job log parsing"
```

---

### Task 3: Log documents, failure inspection and file links

**Files:**
- Create: `extensions/null-tools/src/workflows/workflowLogProvider.ts`
- Modify: `extensions/null-tools/src/workflows/workflowsIntegration.ts`
- Modify: `extensions/null-tools/package.json`
- Modify: `extensions/null-tools/src/test/suite/workflows.spec.ts`

**Interfaces:**
- Consumes: `fetchJobLog`, `getJob`, `listJobs`, `JobLog` (`workflowsApi.ts`); `renderJobDoc`, `pathRefs`, `repoRelative`, `firstFailedStep`, `TRUNCATED_NOTICE` (Task 2); `logDocParts`, `parseLogDoc`, `WORKFLOW_SCHEME` (`workflowLogDocs.ts`); `RepoSlot` with `.token`, `.folder`, `.jobs`, `.owner`, `.repo`, `tree.slot(key)`, `tree.slotForRepo(owner, repo)`, `tree.ensureLoaded()`, `tree.poll(): Promise<number | null>`, `tree.hasActiveRuns()` (`workflowsTreeView.ts`).
- Produces:
  - `class WorkflowLogProvider implements vscode.TextDocumentContentProvider, vscode.DocumentLinkProvider` with `constructor(ctx: LogContext)`, `hasLive(): boolean`, `refreshLive(): void`, `forget(uri: vscode.Uri): void`; `interface LogContext { tokenFor(owner, repo): string | null; folderFor(owner, repo): vscode.Uri | undefined }`
  - Commands `null.workflows.openLog` (job/step node), `null.workflows.showFailureLog` (run/job/step node), `null.workflows.showRunFailure(owner: string, repo: string, runId: number)` (called by the old plan's Task 11).

- [ ] **Step 1: Extend the integration spec first.** In `src/test/suite/workflows.spec.ts`, add the three commands to the registered list by replacing `'null.workflows.enable', 'null.workflows.dispatch']) {` with:

```ts
      'null.workflows.enable', 'null.workflows.dispatch', 'null.workflows.openLog', 'null.workflows.showFailureLog',
      'null.workflows.showRunFailure']) {
```

and insert before `const snapshot = …`:

```ts
    // A hostile URI never reaches the network: the provider answers with an empty document.
    for (const hostile of [
      vscode.Uri.from({ scheme: 'null-workflows', path: '/../../etc/passwd' }),
      vscode.Uri.from({ scheme: 'null-workflows', path: '/o/r/abc/x.log' }),
      vscode.Uri.from({ scheme: 'null-workflows', path: '/o/r/5/x.log', query: 'step=abc' }),
    ]) {
      assert.strictEqual((await vscode.workspace.openTextDocument(hostile)).getText(), '', hostile.toString());
    }
```

Run: `/verify-local null-tools` (syncs into the installed Null IDE and runs the integration specs).
Expected: FAIL — the commands are not registered and there is no content provider for `null-workflows`.

- [ ] **Step 2: Write the provider** — create `src/workflows/workflowLogProvider.ts`:

```ts
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { ApiError } from '../github/githubApi';
import { describeFailure } from '../pulls/pullModel';
import { TRUNCATED_NOTICE, pathRefs, renderJobDoc, repoRelative } from './jobLog';
import { parseLogDoc } from './workflowLogDocs';
import { JobLog, fetchJobLog, getJob } from './workflowsApi';
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
 * and whatever log text the endpoint returns, is refreshed on the poll tick, and stops being refreshed once it completes
 * or its tab closes. The provider has no timer of its own.
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

  /** Links `path:line` and `path(line,col)` in error/warning lines to workspace files that exist, and the truncation notice to GitHub. */
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

- [ ] **Step 3: Register the provider and the commands in `workflowsIntegration.ts`.**

Imports — replace `import { POLL_FAST_MS, RunFilter, WfNode, isWorkflowFile } from './workflowsModel';` and `import { WorkflowsTreeProvider } from './workflowsTreeView';` with, and add the others in alphabetical position:

```ts
import { firstFailedStep } from './jobLog';
import { WORKFLOW_SCHEME, logDocParts } from './workflowLogDocs';
import { WorkflowLogProvider } from './workflowLogProvider';
import { listJobs } from './workflowsApi';
import { POLL_FAST_MS, RunFilter, WfNode, isFailed, isWorkflowFile } from './workflowsModel';
import { RepoSlot, WorkflowsTreeProvider } from './workflowsTreeView';
```

After the `const refresh = …` line add the provider and its helpers (`rearm` is declared a few lines later; it is only called at run time, after both exist):

```ts
  const logs = new WorkflowLogProvider({
    tokenFor: (owner, repo) => tree.slotForRepo(owner, repo)?.token ?? null,
    folderFor: (owner, repo) => tree.slotForRepo(owner, repo)?.folder,
  });

  async function openLog(owner: string, repo: string, jobId: number, jobName: string, step: { number: number; name: string } | null): Promise<void> {
    const parts = logDocParts({ owner, repo, jobId, step: step?.number ?? null }, step ? `${jobName}-${step.name}` : jobName);
    await vscode.window.showTextDocument(vscode.Uri.from(parts), { preview: true });
    rearm(); // the document of a running job is now live: make sure the poll timer is running for it
  }

  /** The first failed step's log of the first failed job; the whole job log when no step is marked failed. */
  async function showFailure(slot: RepoSlot, runId: number): Promise<void> {
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

Replace the poll `tick` and `rearm` so live logs refresh on the same tick and keep the timer alive:

```ts
  const tick = async (): Promise<void> => {
    timer = undefined;
    const next = await tree.poll();
    logs.refreshLive();
    schedule(next ?? (logs.hasLive() ? POLL_FAST_MS : null));
  };
  const rearm = (): void => { if (!timer && view.visible && (tree.hasActiveRuns() || logs.hasLive())) schedule(POLL_FAST_MS); };
```

Add to the `context.subscriptions.push(` list (after the `null.workflows.createWorkflow` registration):

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
      else if (node.kind === 'job') await openLog(node.repo.owner, node.repo.repo, node.job.id, node.job.name, firstFailedStep(node.job) ?? null);
      else if (node.kind === 'step') await openLog(node.repo.owner, node.repo.repo, node.job.id, node.job.name, node.step);
    }),
    // Called by the PR tab (old plan Task 11): the host, not the webview, supplies owner, repo and run id from its own page.
    vscode.commands.registerCommand('null.workflows.showRunFailure', async (owner: string, repo: string, runId: number) => {
      if (!Number.isSafeInteger(runId) || runId <= 0) return;
      await tree.ensureLoaded();
      const slot = tree.slotForRepo(owner, repo);
      if (slot) await showFailure(slot, runId);
      else void vscode.window.showInformationMessage('Open a folder of this repository to see its GitHub Actions.');
    }),
```

- [ ] **Step 4: Contribute the commands in `package.json`.**
  - `contributes.commands`: replace `{ "command": "null.workflows.dispatch", "title": "Run Workflow…", "icon": "$(play)" }` with the same line followed by `,` and three entries: `{ "command": "null.workflows.openLog", "title": "Open Log" }`, `{ "command": "null.workflows.showFailureLog", "title": "Show Failure Log", "icon": "$(error)" }`, `{ "command": "null.workflows.showRunFailure", "title": "Null: Show Workflow Run Failure Log" }`.
  - `menus."view/item/context"`: after the entry ending `"group": "3_manage@5" }` add (with a comma between):
    - `{ "command": "null.workflows.openLog", "when": "view == null.workflowsView && viewItem =~ /^(job|step)/", "group": "2_log@0" }`
    - `{ "command": "null.workflows.showFailureLog", "when": "view == null.workflowsView && viewItem =~ /^(run|job|step) failed/", "group": "inline@0" }`
    - `{ "command": "null.workflows.showFailureLog", "when": "view == null.workflowsView && viewItem =~ /^(run|job|step) failed/", "group": "2_log@1" }`
  - `menus."commandPalette"`: after `{ "command": "null.workflows.dispatch", "when": "false" },` add `{ "command": "null.workflows.openLog", "when": "false" },`, `{ "command": "null.workflows.showFailureLog", "when": "false" },`, `{ "command": "null.workflows.showRunFailure", "when": "false" },`.

(The `viewItem` tokens the model sets are `run failed …`, `job failed …`, `step failed`, so `/^(run|job|step) failed/` matches only failed rows.)

- [ ] **Step 5: Run the checks**

Run: `npm test`, then `/verify-local null-tools`.
Expected: PASS. The three hostile URIs open as empty documents (`parseLogDoc` yields `null`), and the new commands are registered.

- [ ] **Step 6: Try it by hand** (this needs the real app, so it is a short smoke test, not the full old-plan Task 12 checklist). In the installed Null IDE on a clone of this repo signed in through null-accounts: open the GitHub Actions view, click a finished job (tab named `<job>.log`, no timestamps, `▶` headings), click a step (its own segment, or the full log if the job has skipped steps), click **Show failure log** on the failed playground run (opens the failing step), and confirm `src/a.ts(3,4)` in that log is a link only when `src/a.ts` exists in the folder. Fix any defect with a failing unit test first when it lives in `jobLog.ts`.

- [ ] **Step 7: Commit**

```bash
git add extensions/null-tools/src/workflows/workflowLogProvider.ts extensions/null-tools/src/workflows/workflowsIntegration.ts extensions/null-tools/src/test/suite/workflows.spec.ts extensions/null-tools/package.json
git commit -m "feat(null-tools): open job and step logs as documents, with failure inspection"
```

---

## After this plan

Continue with `docs/plans/github-actions.md`, **Task 11** (PR tab links, which calls `null.workflows.showRunFailure` from Task 3 above) and **Task 12** (verify, document, refresh output, clean up), with these changes:

- Task 12 Step 1, items 7–9 (live logs, logs, truncation) are the full version of Task 3 Step 6; skip what is already verified, and use Task 1's recorded observation for the live-log expectation.
- Task 12 Step 2 deletes `.github/workflows/actions-playground.yml`; the fixtures already hold what the tests need, so deleting it loses nothing.
- Task 12 Step 3's `extensions/null-tools/CLAUDE.md` row should say `jobLog.ts` is validated against logs captured from the playground workflow (`realLog.fixture.ts`).

## Self-review

- **Spec coverage ("Logs" section):** one tab per job, reused (`parseLogDoc`/`logDocParts` URIs are stable per job+step, Task 3); job vs step segment with full-log fallback (Task 2 `locateStep`); timestamps stripped, `##[error]` kept, groups as `▶` (Task 2 `cleanLog`); 5 MB front-truncation notice with a link to the job page (existing `fetchJobLog` + Task 3 `provideDocumentLinks`); **Show failure log** and `path:line` / `path(line,col)` links limited to files inside the folder (Task 2 `repoRelative`, Task 3 `insideFolder` + `stat`); live logs best-effort with a poll refresh and "Logs appear when the job finishes." (Task 2 `renderJobDoc`, Task 3 tick); probe recorded in the spec (Task 1). The PR tab links and the docs remain in the old plan's Tasks 11–12.
- **Placeholders:** none; the only fill-ins are the observed values in Task 1 Step 6, which cannot be known before the probe.
- **Names:** `openLog`, `showFailure`, `showRunFailure`, `refreshLive`, `hasLive`, `forget`, `renderJobDoc`, `locateStep`, `firstFailedStep` are spelled identically in every task that uses them.

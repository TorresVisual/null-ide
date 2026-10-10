# Null Activity Git Statistics Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Show your commits, files changed and lines added/removed next to tracked time in the Coding Activity dashboard, per open project and in total.

**Architecture:** A pure parser (`gitLog.ts`) turns `git log --numstat` output into `GitTotals`. `GitStatsService` (no `vscode` import, injected deps) finds the repos of the open workspace folders, runs git via `execGit`, and caches per repo and range for 60 s. `DashboardPanel` posts the model immediately with any cached git data, loads in the background when stale, and posts again. The webview only renders the optional `model.git`.

**Tech Stack:** TypeScript, `node --test`, `child_process.execFile`, vanilla-TS webview (`module: none`).

**Spec:** `docs/specs/null-activity-git-design.md`

All commands run from `extensions/null-activity/` unless a step says otherwise.

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

- No network code; git is only read. Run it with `execFile('git', args, …)`, never through a shell.
- Every git call: `GIT_OPTIONAL_LOCKS=0`, 15 s timeout, 32 MB output cap, `windowsHide: true`.
- Only commits whose author email equals the repo's `git config --get user.email`; exact, case-insensitive match done in the parser.
- Local branches only (`--branches`), `--no-merges`, `--no-renames`, `--numstat`. Distinct file paths. Binary files (`-`) count as a file and add no lines.
- Cache TTL 60 000 ms per `(repo key, from, to)`; failures are cached too.
- Untrusted workspaces (`vscode.workspace.isTrusted === false`) spawn nothing.
- Only the open workspace folders are queried. No change to `Interval`, the interval log, `NullActivityApi` or `ActivityService`. No new setting.
- Webview code: `module: none`, no imports, all text through `h()` (never `innerHTML`), no inline `style` attributes.
- Never hand-edit `out/` or `lib/dashboard.js`. Refresh them in the final chore commit (`chore: refresh null-activity compiled output`). `lib/dashboard.css` is hand-written.
- A new test file does nothing until it is added to the `test` script in `package.json`.
- Commit messages end with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` trailer. Never skip hooks, never push, never amend.

## Review Focus

Inputs the spec implies that a person will hit; each has a test in the task named.

1. A workspace folder that is not a repo, or where git exits non-zero: that project shows "—", other projects keep their numbers (Task 2, `one failing repo…`).
2. Author email in a different case, or a different address that contains yours as a substring: the first counts, the second does not (Task 1, `author match…`).
3. File names with spaces, and `\r\n` line endings in git's output on Windows (Task 1, `paths with spaces and CRLF`).
4. A commit of yours on a local branch that is not checked out, next to a commit by someone else on the checked-out branch (Task 2, real-git test).
5. An untrusted workspace, and a repo with no `user.email`: no process is spawned for the first, no git lines for the second (Task 2, `untrusted…`, `no user.email…`).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/protocol.ts` | modify | `GitTotals`, `DashboardGit`, `Share.key?`, `DashboardModel.git?` |
| `src/gitLog.ts` | create | Pure `gitLogArgs`, `parseGitLog` |
| `src/gitExec.ts` | create | `execGit(args, cwd)` — the only place that spawns git |
| `src/gitStatsService.ts` | create | Repo discovery, caching, in-flight dedupe, assembling `DashboardGit` |
| `src/dashboardModel.ts` | modify | `git?` parameter, `key` on project shares |
| `src/dashboardPanel.ts` | modify | Own a `GitStatsService`, load in background, re-post |
| `src/webview/dashboard/model.ts` | modify | `formatGit` |
| `src/webview/dashboard/breakdown.ts` | modify | Git line under project names, `renderGitLine` |
| `src/webview/dashboard/main.ts` | modify | Git line under the total |
| `lib/dashboard.css` | modify | Styles for the git lines |
| `src/test/gitLog.test.ts`, `gitStatsService.test.ts`, `gitStatsService.git.test.ts` | create | Tests |
| `src/test/dashboardModel.test.ts`, `dashboardWebviewModel.test.ts` | modify | Tests |
| `package.json` | modify | Register the three new test files |
| `../../CLAUDE.md` | modify | One paragraph sentence |

---

### Task 1: Protocol types and the git log parser

**Files:**
- Modify: `src/protocol.ts`
- Create: `src/gitLog.ts`
- Test: `src/test/gitLog.test.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `DateRange` from `./types`.
- Produces: global types `GitTotals`, `DashboardGit`; `gitLogArgs(range: DateRange, email: string): string[]`; `parseGitLog(stdout: string, email: string, range: DateRange): GitTotals`.

- [ ] **Step 1: Add the shared types**

In `src/protocol.ts`, add `key` to `Share`:

```ts
interface Share {
  name: string;
  ms: number;
  /** Rounded; a list of shares sums to 100 ± rounding. */
  percent: number;
  /** Project rows only (not "Other"): the project key git results are matched on. */
  key?: string;
}
```

Add, above `DashboardModel`:

```ts
interface GitTotals {
  commits: number;
  /** Distinct paths touched. */
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

interface DashboardGit {
  /** Sum over `byProject`. */
  totals: GitTotals;
  /** Keyed by `Share.key`. Only projects that have a git result. */
  byProject: Record<string, GitTotals>;
}
```

and the last field of `DashboardModel`:

```ts
  /** Newest first, max 50. */
  sessions: SessionRow[];
  /** Absent until a load has finished, and when nothing resolved. */
  git?: DashboardGit;
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/test/gitLog.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { gitLogArgs, parseGitLog } from '../gitLog';
import { ALL_TIME } from '../stats';

const EMAIL = 'me@example.com';
const range = { from: Date.parse('2026-10-05T00:00:00Z'), to: Date.parse('2026-10-12T00:00:00Z') };
const sec = (iso: string) => Date.parse(iso) / 1000;
/** What `--format=@%ct%x09%ae` prints for one commit: header, blank line, numstat lines. */
const commit = (iso: string, email: string, ...stats: string[]) => `@${sec(iso)}\t${email}\n\n${stats.join('\n')}\n`;
const ZERO = { commits: 0, filesChanged: 0, linesAdded: 0, linesRemoved: 0 };

test('sums commits and lines; a file touched twice counts once', () => {
  const out = commit('2026-10-06T10:00:00Z', EMAIL, '3\t1\ta.ts', '2\t0\tb.ts') + commit('2026-10-07T10:00:00Z', EMAIL, '5\t2\ta.ts');
  assert.deepStrictEqual(parseGitLog(out, EMAIL, range), { commits: 2, filesChanged: 2, linesAdded: 10, linesRemoved: 3 });
});

test('author match is exact and case-insensitive; other authors contribute nothing', () => {
  const out =
    commit('2026-10-06T10:00:00Z', 'ME@Example.com', '1\t0\ta.ts') +
    commit('2026-10-06T11:00:00Z', 'xme@example.com', '100\t100\tb.ts') +
    commit('2026-10-06T12:00:00Z', 'me@example.com.au', '100\t100\tc.ts');
  assert.deepStrictEqual(parseGitLog(out, EMAIL, range), { commits: 1, filesChanged: 1, linesAdded: 1, linesRemoved: 0 });
});

test('range is half-open: a commit at `from` counts, one at `to` does not', () => {
  const out = commit('2026-10-05T00:00:00Z', EMAIL, '1\t0\ta.ts') + commit('2026-10-12T00:00:00Z', EMAIL, '1\t0\tb.ts') + commit('2026-10-04T23:59:59Z', EMAIL, '1\t0\tc.ts');
  assert.deepStrictEqual(parseGitLog(out, EMAIL, range), { commits: 1, filesChanged: 1, linesAdded: 1, linesRemoved: 0 });
});

test('binary files count as a changed file but add no lines', () => {
  const out = commit('2026-10-06T10:00:00Z', EMAIL, '-\t-\tlogo.png', '4\t1\ta.ts');
  assert.deepStrictEqual(parseGitLog(out, EMAIL, range), { commits: 1, filesChanged: 2, linesAdded: 4, linesRemoved: 1 });
});

test('paths with spaces and CRLF line endings', () => {
  const out = commit('2026-10-06T10:00:00Z', EMAIL, '2\t0\tmy docs/read me.md', '1\t1\tunicodé/ü.ts').replace(/\n/g, '\r\n');
  assert.deepStrictEqual(parseGitLog(out, EMAIL, range), { commits: 1, filesChanged: 2, linesAdded: 3, linesRemoved: 1 });
});

test('empty output, garbage and torn lines give zeros and never throw', () => {
  assert.deepStrictEqual(parseGitLog('', EMAIL, range), ZERO);
  assert.deepStrictEqual(parseGitLog('warning: something\nnot a header\n', EMAIL, range), ZERO);
  assert.deepStrictEqual(parseGitLog('@nonsense\tme@example.com\n1\t0\ta.ts\n', EMAIL, range), ZERO);
  const torn = commit('2026-10-06T10:00:00Z', EMAIL, '1\t0\ta.ts') + '@1790';
  assert.deepStrictEqual(parseGitLog(torn, EMAIL, range), { commits: 1, filesChanged: 1, linesAdded: 1, linesRemoved: 0 });
});

test('gitLogArgs: bounded range adds --since/--until in seconds, ALL_TIME adds neither', () => {
  const bounded = gitLogArgs(range, EMAIL);
  assert.ok(bounded.includes(`--since=${sec('2026-10-05T00:00:00Z')}`));
  assert.ok(bounded.includes(`--until=${sec('2026-10-12T00:00:00Z')}`));
  for (const flag of ['--branches', '--no-merges', '--no-renames', '--numstat', '-F', `--author=${EMAIL}`]) assert.ok(bounded.includes(flag), flag);
  const all = gitLogArgs(ALL_TIME, EMAIL);
  assert.ok(!all.some((a) => a.startsWith('--since') || a.startsWith('--until')));
});
```

Register it: in `package.json` change the end of the `test` script from `out/test/dashboardHtml.test.js"` to `out/test/dashboardHtml.test.js out/test/gitLog.test.js"`.

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test`
Expected: FAIL at compile — `Cannot find module '../gitLog'`.

- [ ] **Step 4: Implement `src/gitLog.ts`**

```ts
/// <reference path="./protocol.ts" />
'use strict';

import { DateRange } from './types';

/** Arguments for `git` (after the binary). `--author` only narrows the output; parseGitLog does the exact match. */
export function gitLogArgs(range: DateRange, email: string): string[] {
  const args = [
    '--no-pager', 'log', '--branches', '--no-merges', '--no-renames', '--numstat',
    '-F', `--author=${email}`, '--format=@%ct%x09%ae',
  ];
  if (range.from > 0) args.push(`--since=${Math.floor(range.from / 1000)}`);
  if (range.to < Number.MAX_SAFE_INTEGER) args.push(`--until=${Math.ceil(range.to / 1000)}`);
  return args;
}

/**
 * Parses the output of gitLogArgs: a `@<unix seconds>\t<email>` header per commit followed by
 * `<added>\t<removed>\t<path>` lines (`-` for binary files). Counts only commits by `email`
 * whose committer time is in [from, to); anything unparseable is skipped.
 */
export function parseGitLog(stdout: string, email: string, range: DateRange): GitTotals {
  const want = email.trim().toLowerCase();
  const files = new Set<string>();
  let commits = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  let counting = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('@')) {
      const [seconds, author] = line.slice(1).split('\t');
      const ts = Number(seconds) * 1000;
      counting = author?.trim().toLowerCase() === want && Number.isFinite(ts) && ts >= range.from && ts < range.to;
      if (counting) commits++;
      continue;
    }
    if (!counting) continue;
    const stat = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!stat) continue;
    files.add(stat[3]);
    if (stat[1] !== '-') linesAdded += Number(stat[1]);
    if (stat[2] !== '-') linesRemoved += Number(stat[2]);
  }
  return { commits, filesChanged: files.size, linesAdded, linesRemoved };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npm test`
Expected: PASS, including the 7 new `gitLog` tests; nothing else regressed.

- [ ] **Step 6: Commit** (from the repo root)

```bash
git add extensions/null-activity/src/protocol.ts extensions/null-activity/src/gitLog.ts extensions/null-activity/src/test/gitLog.test.ts extensions/null-activity/package.json
git commit -m "feat(null-activity): parse git log numstat into commit totals"
```

---

### Task 2: git runner and `GitStatsService`

**Files:**
- Create: `src/gitExec.ts`, `src/gitStatsService.ts`
- Test: `src/test/gitStatsService.test.ts`, `src/test/gitStatsService.git.test.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `gitLogArgs`, `parseGitLog` (Task 1); `GitTotals`, `DashboardGit` (global); `DateRange`.
- Produces:
  - `execGit(args: string[], cwd: string): Promise<string>` (rejects on non-zero exit, timeout or output over the cap)
  - `type GitExec = (args: string[], cwd: string) => Promise<string>`
  - `GIT_TTL_MS = 60_000`
  - `interface GitStatsDeps { folders(): string[]; trusted(): boolean; resolveKey(folder: string): string; exec: GitExec; now(): number; log(message: string): void }`
  - `class GitStatsService { constructor(deps: GitStatsDeps); peek(range: DateRange): { fresh: boolean; git?: DashboardGit }; load(range: DateRange): Promise<DashboardGit | undefined> }` — `load` never rejects.

- [ ] **Step 1: Write the failing unit tests**

Create `src/test/gitStatsService.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { GIT_TTL_MS, GitExec, GitStatsService } from '../gitStatsService';

const R1 = { from: Date.parse('2026-10-05T00:00:00Z'), to: Date.parse('2026-10-12T00:00:00Z') };
const R2 = { from: Date.parse('2026-10-12T00:00:00Z'), to: Date.parse('2026-10-19T00:00:00Z') };
const COMMIT = `@${Date.parse('2026-10-06T10:00:00Z') / 1000}\tme@example.com\n\n4\t1\tx.ts\n`;
const ONE = { commits: 1, filesChanged: 1, linesAdded: 4, linesRemoved: 1 };

function setup(over: { folders?: string[]; trusted?: boolean; exec?: GitExec; keys?: Record<string, string> } = {}) {
  const calls: { args: string[]; cwd: string }[] = [];
  const logs: string[] = [];
  const clock = { now: 1_000_000 };
  const inner: GitExec = over.exec ?? (async (args) => (args[0] === 'config' ? 'me@example.com\n' : COMMIT));
  const service = new GitStatsService({
    folders: () => over.folders ?? ['/a'],
    trusted: () => over.trusted ?? true,
    resolveKey: (folder) => over.keys?.[folder] ?? folder,
    exec: async (args, cwd) => {
      calls.push({ args, cwd });
      return inner(args, cwd);
    },
    now: () => clock.now,
    log: (message) => logs.push(message),
  });
  return { service, calls, logs, clock };
}

test('totals per project key, summed', async () => {
  const { service } = setup({ folders: ['/a', '/b'], keys: { '/a': 'ka', '/b': 'kb' } });
  const git = await service.load(R1);
  assert.deepStrictEqual(git, {
    totals: { commits: 2, filesChanged: 2, linesAdded: 8, linesRemoved: 2 },
    byProject: { ka: ONE, kb: ONE },
  });
});

test('two folders with the same key are one repo, queried once', async () => {
  const { service, calls } = setup({ folders: ['/a', '/b'], keys: { '/a': 'k', '/b': 'k' } });
  const git = await service.load(R1);
  assert.deepStrictEqual(git, { totals: ONE, byProject: { k: ONE } });
  assert.strictEqual(calls.length, 2); // config + log
});

test('untrusted workspace: nothing is spawned and nothing is returned', async () => {
  const { service, calls } = setup({ trusted: false });
  assert.deepStrictEqual(service.peek(R1), { fresh: true, git: undefined });
  assert.strictEqual(await service.load(R1), undefined);
  assert.strictEqual(calls.length, 0);
});

test('no user.email: the repo is dropped and the problem is logged once', async () => {
  const { service, logs, clock } = setup({
    exec: async (args) => {
      if (args[0] === 'config') throw new Error('exit 1');
      return COMMIT;
    },
  });
  assert.strictEqual(await service.load(R1), undefined);
  clock.now += GIT_TTL_MS;
  assert.strictEqual(await service.load(R1), undefined);
  assert.strictEqual(logs.length, 1);
});

test('one failing repo does not affect another', async () => {
  const { service } = setup({
    folders: ['/bad', '/good'],
    exec: async (args, cwd) => {
      if (cwd === '/bad') throw new Error('fatal: not a git repository');
      return args[0] === 'config' ? 'me@example.com\n' : COMMIT;
    },
  });
  const git = await service.load(R1);
  assert.deepStrictEqual(git, { totals: ONE, byProject: { '/good': ONE } });
});

test('cache: reused inside the TTL, stale after it, and stale data is still returned by peek', async () => {
  const { service, calls, clock } = setup();
  await service.load(R1);
  assert.strictEqual(calls.length, 2);
  clock.now += GIT_TTL_MS - 1;
  assert.strictEqual(service.peek(R1).fresh, true);
  await service.load(R1);
  assert.strictEqual(calls.length, 2);
  clock.now += 1;
  const stale = service.peek(R1);
  assert.strictEqual(stale.fresh, false);
  assert.deepStrictEqual(stale.git, { totals: ONE, byProject: { '/a': ONE } });
  await service.load(R1);
  assert.strictEqual(calls.length, 4);
});

test('concurrent loads of the same range share one read', async () => {
  const { service, calls } = setup();
  const [a, b] = await Promise.all([service.load(R1), service.load(R1)]);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(calls.length, 2);
});

test('ranges are cached separately', async () => {
  const { service } = setup();
  await service.load(R1);
  assert.deepStrictEqual(service.peek(R2), { fresh: false, git: undefined });
});
```

Create `src/test/gitStatsService.git.test.ts` (the only test that runs real git):

```ts
'use strict';

import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { execGit } from '../gitExec';
import { GitStatsService } from '../gitStatsService';
import { ALL_TIME } from '../stats';

const skip = spawnSync('git', ['--version']).status !== 0 && 'git is not on PATH';

function git(cwd: string, args: string[], env: Record<string, string> = {}): void {
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
}

function commit(cwd: string, files: Record<string, string>, iso: string, author: string): void {
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(cwd, name), text);
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', 'c'], {
    GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso,
    GIT_AUTHOR_NAME: 'T', GIT_COMMITTER_NAME: 'T', GIT_AUTHOR_EMAIL: author, GIT_COMMITTER_EMAIL: author,
  });
}

test('real repository: own commits only, local branches included, windowed by committer time', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-git-'));
  try {
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'me@example.com']);
    git(dir, ['config', 'user.name', 'T']);
    git(dir, ['config', 'core.autocrlf', 'false']);
    commit(dir, { 'a.txt': '1\n2\n3\n' }, '2026-10-05T10:00:00Z', 'me@example.com');
    commit(dir, { 'a.txt': '1\n2\n3b\n4\n5\n', 'b.txt': 'x\n' }, '2026-10-06T10:00:00Z', 'me@example.com');
    commit(dir, { 'c.txt': 'c\n' }, '2026-10-06T11:00:00Z', 'other@example.com');
    git(dir, ['checkout', '-q', '-b', 'side']);
    commit(dir, { 'd.txt': '1\n2\n3\n4\n' }, '2026-10-07T10:00:00Z', 'me@example.com');
    git(dir, ['checkout', '-q', 'main']); // `side` is no longer checked out

    const service = new GitStatsService({
      folders: () => [dir], trusted: () => true, resolveKey: () => 'repo', exec: execGit, now: () => Date.now(), log: () => {},
    });
    const all = await service.load(ALL_TIME);
    assert.deepStrictEqual(all?.byProject.repo, { commits: 3, filesChanged: 3, linesAdded: 11, linesRemoved: 1 });

    const oct6 = { from: Date.parse('2026-10-06T00:00:00Z'), to: Date.parse('2026-10-07T00:00:00Z') };
    const day = await service.load(oct6);
    assert.deepStrictEqual(day?.byProject.repo, { commits: 1, filesChanged: 2, linesAdded: 4, linesRemoved: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a folder that is not a repository yields no result and does not throw', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-nogit-'));
  try {
    const service = new GitStatsService({
      folders: () => [dir], trusted: () => true, resolveKey: () => 'none', exec: execGit, now: () => Date.now(), log: () => {},
    });
    assert.strictEqual(await service.load(ALL_TIME), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

Register both: append ` out/test/gitStatsService.test.js out/test/gitStatsService.git.test.js` after `out/test/gitLog.test.js` in the `test` script.

Note for the second test: a temp dir under `os.tmpdir()` may itself sit inside a git repo on some machines (e.g. a repo at the user's home). If it does, `git config --get user.email` still works and `git log` would walk that outer repo. Create the temp dir with `fs.mkdtempSync` as shown and, if this test fails for that reason, set `GIT_CEILING_DIRECTORIES` to the temp dir's parent in `execGit`'s caller for the test only — do not change `execGit`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL at compile — `Cannot find module '../gitStatsService'` / `'../gitExec'`.

- [ ] **Step 3: Implement `src/gitExec.ts`**

```ts
'use strict';

import { execFile } from 'child_process';

/** The only place that spawns git. No shell; read-only use, so never take optional locks. Rejects on a non-zero exit, timeout or output over the cap. */
export function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, timeout: 15_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}
```

- [ ] **Step 4: Implement `src/gitStatsService.ts`**

```ts
/// <reference path="./protocol.ts" />
'use strict';

import { gitLogArgs, parseGitLog } from './gitLog';
import { DateRange } from './types';

export const GIT_TTL_MS = 60_000;

export type GitExec = (args: string[], cwd: string) => Promise<string>;

export interface GitStatsDeps {
  /** fsPaths of the open workspace folders. */
  folders(): string[];
  trusted(): boolean;
  /** `resolveProject(folder).key`, so results match `Share.key`. */
  resolveKey(folder: string): string;
  exec: GitExec;
  now(): number;
  log(message: string): void;
}

interface Entry {
  at: number;
  /** Undefined when the repo could not be read; kept so a broken repo is not retried every second. */
  totals?: GitTotals;
}

function assemble(found: Map<string, GitTotals | undefined>): DashboardGit | undefined {
  const byProject: Record<string, GitTotals> = {};
  const totals: GitTotals = { commits: 0, filesChanged: 0, linesAdded: 0, linesRemoved: 0 };
  for (const [key, t] of found) {
    if (!t) continue;
    byProject[key] = t;
    totals.commits += t.commits;
    totals.filesChanged += t.filesChanged;
    totals.linesAdded += t.linesAdded;
    totals.linesRemoved += t.linesRemoved;
  }
  return Object.keys(byProject).length > 0 ? { totals, byProject } : undefined;
}

/** Git statistics for the repos of the open workspace folders. No `vscode` import: everything arrives through `deps`. */
export class GitStatsService {
  // ponytail: one entry per (repo, range) ever asked for; the dashboard has five ranges, so this stays tiny.
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Entry>>();
  private readonly warned = new Set<string>();

  constructor(private readonly deps: GitStatsDeps) {}

  /** Cached numbers for `range` (possibly stale, so the UI does not flicker) and whether a reload is due. */
  peek(range: DateRange): { fresh: boolean; git?: DashboardGit } {
    const now = this.deps.now();
    const found = new Map<string, GitTotals | undefined>();
    let fresh = true;
    for (const key of this.repos().keys()) {
      const entry = this.entries.get(entryKey(key, range));
      if (!entry || now - entry.at >= GIT_TTL_MS) fresh = false;
      found.set(key, entry?.totals);
    }
    return { fresh, git: assemble(found) };
  }

  /** Reads whatever is missing or stale. Never rejects: a repo that cannot be read is simply left out. */
  async load(range: DateRange): Promise<DashboardGit | undefined> {
    const found = new Map<string, GitTotals | undefined>();
    await Promise.all(
      [...this.repos()].map(async ([key, folder]) => {
        found.set(key, (await this.entry(key, folder, range)).totals);
      }),
    );
    return assemble(found);
  }

  /** key -> first folder, for the open folders. Empty in an untrusted workspace. */
  private repos(): Map<string, string> {
    const repos = new Map<string, string>();
    if (!this.deps.trusted()) return repos;
    for (const folder of this.deps.folders()) {
      const key = this.deps.resolveKey(folder);
      if (!repos.has(key)) repos.set(key, folder);
    }
    return repos;
  }

  private entry(key: string, folder: string, range: DateRange): Promise<Entry> {
    const id = entryKey(key, range);
    const hit = this.entries.get(id);
    if (hit && this.deps.now() - hit.at < GIT_TTL_MS) return Promise.resolve(hit);
    let pending = this.inflight.get(id);
    if (!pending) {
      pending = this.read(key, folder, range)
        .then((totals) => {
          const entry: Entry = { at: this.deps.now(), totals };
          this.entries.set(id, entry);
          return entry;
        })
        .finally(() => this.inflight.delete(id));
      this.inflight.set(id, pending);
    }
    return pending;
  }

  private async read(key: string, folder: string, range: DateRange): Promise<GitTotals | undefined> {
    try {
      const email = (await this.deps.exec(['config', '--get', 'user.email'], folder)).trim();
      if (!email) throw new Error('no user.email');
      return parseGitLog(await this.deps.exec(gitLogArgs(range, email), folder), email, range);
    } catch (err) {
      if (!this.warned.has(key)) {
        this.warned.add(key);
        this.deps.log(`git stats: skipped ${folder} (${err instanceof Error ? err.message : String(err)})`);
      }
      return undefined;
    }
  }
}

function entryKey(key: string, range: DateRange): string {
  return `${key}|${range.from}|${range.to}`;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npm test`
Expected: PASS, including 8 service tests and the 2 real-git tests (they report as skipped only if `git` is missing).

- [ ] **Step 6: Commit**

```bash
git add extensions/null-activity/src/gitExec.ts extensions/null-activity/src/gitStatsService.ts extensions/null-activity/src/test/gitStatsService.test.ts extensions/null-activity/src/test/gitStatsService.git.test.ts extensions/null-activity/package.json
git commit -m "feat(null-activity): git stats service with per-repo cache"
```

---

### Task 3: Carry git data and project keys in the dashboard model

**Files:**
- Modify: `src/dashboardModel.ts` (`toShares` at line 138, `buildDashboardModel` at line 146)
- Test: `src/test/dashboardModel.test.ts`

**Interfaces:**
- Consumes: `DashboardGit`, `Share.key` (Task 1).
- Produces: `toShares(items: { name: string; ms: number; key?: string }[], totalMs: number): Share[]`; `buildDashboardModel(api, range, now, enabled, git?: DashboardGit): DashboardModel`.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/dashboardModel.test.ts`:

```ts
test('git is passed through; only project rows carry a key, never "Other"', () => {
  const git = {
    totals: { commits: 1, filesChanged: 1, linesAdded: 2, linesRemoved: 3 },
    byProject: { k0: { commits: 1, filesChanged: 1, linesAdded: 2, linesRemoved: 3 } },
  };
  const data = Array.from({ length: 9 }, (_, i) => iv(at(8, 1 + i), at(8, 1 + i, 30), { project: { key: `k${i}`, name: `p${i}` } }));
  const model = buildDashboardModel(source(data), 'today', NOW, true, git);
  assert.strictEqual(model.git, git);
  assert.strictEqual(model.projects[7].name, 'Other');
  assert.strictEqual(model.projects[7].key, undefined);
  assert.ok(model.projects.slice(0, 7).every((p) => /^k\d$/.test(p.key ?? '')));
  assert.ok(model.languages.every((l) => l.key === undefined));
});

test('without git data the model has no git field', () => {
  assert.ok(!('git' in build([iv(at(8, 10), at(8, 11))], 'today')));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL at compile — `Expected 4 arguments, but got 5`.

- [ ] **Step 3: Implement**

In `src/dashboardModel.ts`, replace `toShares`:

```ts
/** Ranks by time, keeps at most MAX_SHARES rows (the last one "Other" when folding) and rounds percents. `key` is passed through on kept rows. */
export function toShares(items: { name: string; ms: number; key?: string }[], totalMs: number): Share[] {
  const ranked = items.filter((i) => i.ms > 0).sort((a, b) => b.ms - a.ms);
  const shown = ranked.length > MAX_SHARES ? ranked.slice(0, MAX_SHARES - 1) : ranked;
  const rest = ranked.slice(shown.length).reduce((n, i) => n + i.ms, 0);
  if (rest > 0) shown.push({ name: 'Other', ms: rest });
  return shown.map((i) => ({
    name: i.name,
    ms: i.ms,
    percent: totalMs > 0 ? Math.round((i.ms / totalMs) * 100) : 0,
    ...(i.key !== undefined ? { key: i.key } : {}),
  }));
}
```

Change the signature and the return of `buildDashboardModel`:

```ts
export function buildDashboardModel(
  api: DashboardSource,
  range: DashboardRange,
  now: number,
  enabled: boolean,
  git?: DashboardGit,
): DashboardModel {
```

```ts
    projects: toShares(projects.map((p) => ({ name: p.project.name, ms: p.ms, key: p.project.key })), totalMs),
```

and at the end of the returned object, after `sessions: …`:

```ts
    ...(git ? { git } : {}),
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test`
Expected: PASS (the existing share tests map to `[name, ms, percent]`, so the new `key` does not disturb them).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src/dashboardModel.ts extensions/null-activity/src/test/dashboardModel.test.ts
git commit -m "feat(null-activity): carry git totals and project keys in the dashboard model"
```

---

### Task 4: Panel loads git data in the background

**Files:**
- Modify: `src/dashboardPanel.ts`

**Interfaces:**
- Consumes: `GitStatsService`, `execGit` (Task 2); `buildDashboardModel(…, git?)`, `rangeFor` (Task 3 / existing).
- Produces: nothing new for later tasks; the model posted to the webview now carries `git` when available.

This file imports `vscode` and has no unit test (same as before); verification is the compile plus the manual check in Task 6.

- [ ] **Step 1: Edit imports and fields**

Replace the import block:

```ts
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ActivityService } from './activityService';
import { buildDashboardModel, isDashboardRange, parseWebviewMessage, rangeFor } from './dashboardModel';
import { getDashboardHtml } from './dashboardHtml';
import { execGit } from './gitExec';
import { GitStatsService } from './gitStatsService';
import { resolveProject } from './projectIdentity';
import { DateRange } from './types';
```

Add two fields below `private openDisposables…`:

```ts
  private readonly gitStats: GitStatsService;
  /** `from:to` of the git load in progress, so the 1 s push throttle does not start a second one. */
  private loadingGit: string | undefined;
```

At the end of the constructor body (after `this.range = …`), add:

```ts
    this.gitStats = new GitStatsService({
      folders: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
      trusted: () => vscode.workspace.isTrusted,
      resolveKey: (folder) => resolveProject(folder).key,
      exec: execGit,
      now: () => Date.now(),
      log: (message) => this.log(message),
    });
```

- [ ] **Step 2: Replace `push()` and add `refreshGit()`**

```ts
  /** Builds and posts a snapshot; does nothing while the tab is hidden or closed. A failure keeps the previous model on screen. */
  private push(): void {
    const panel = this.panel;
    if (!panel || !panel.visible) return;
    this.lastPush = Date.now();
    try {
      const now = Date.now();
      const dateRange = rangeFor(this.range, now);
      // Stale numbers are better than none: they stay on screen while a reload runs.
      const { fresh, git } = this.gitStats.peek(dateRange);
      const message: HostToWebview = {
        type: 'model',
        model: buildDashboardModel(this.service, this.range, now, this.service.enabled, git),
      };
      void panel.webview.postMessage(message);
      if (!fresh) void this.refreshGit(dateRange);
    } catch (err) {
      this.log(`dashboard: could not build the model (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  /**
   * Loads git data for `range`, then pushes again for whatever range is selected by then: the load only
   * warms the cache, so a range change mid-load can never show another range's numbers. `load` never
   * rejects and stores failures too, so this cannot loop.
   */
  private async refreshGit(range: DateRange): Promise<void> {
    const id = `${range.from}:${range.to}`;
    if (this.loadingGit === id) return;
    this.loadingGit = id;
    try {
      await this.gitStats.load(range);
    } finally {
      if (this.loadingGit === id) this.loadingGit = undefined;
    }
    if (this.panel) this.push();
  }
```

- [ ] **Step 3: Compile**

Run: `npm test`
Expected: PASS (compiles `dashboardPanel.ts`; no new tests).

- [ ] **Step 4: Commit**

```bash
git add extensions/null-activity/src/dashboardPanel.ts
git commit -m "feat(null-activity): load git statistics in the dashboard panel"
```

---

### Task 5: Render git lines in the webview

**Files:**
- Modify: `src/webview/dashboard/model.ts`, `src/webview/dashboard/breakdown.ts`, `src/webview/dashboard/main.ts`, `lib/dashboard.css`
- Test: `src/test/dashboardWebviewModel.test.ts`

**Interfaces:**
- Consumes: `GitTotals`, `DashboardGit`, `Share.key`, `DashboardModel.git` (Task 1, via `protocol.ts`).
- Produces: `formatGit(t: GitTotals): { text: string; added: string; removed: string }`; `renderGitLine(t: GitTotals): HTMLElement`; `renderBreakdown(title, shares, git?)`.

- [ ] **Step 1: Write the failing test**

In `src/test/dashboardWebviewModel.test.ts`, add to the `w` cast type (after `nextIndex(...)`):

```ts
  formatGit(t: { commits: number; filesChanged: number; linesAdded: number; linesRemoved: number }): { text: string; added: string; removed: string };
```

Append:

```ts
test('formatGit: singular and plural, thousands separators, zero lines', () => {
  assert.deepStrictEqual(plain(w.formatGit({ commits: 1, filesChanged: 1, linesAdded: 0, linesRemoved: 0 })), {
    text: '1 commit · 1 file', added: '+0', removed: '−0',
  });
  assert.deepStrictEqual(plain(w.formatGit({ commits: 12, filesChanged: 40, linesAdded: 1234567, linesRemoved: 89 })), {
    text: '12 commits · 40 files', added: '+1,234,567', removed: '−89',
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `w.formatGit is not a function`.

- [ ] **Step 3: Implement `formatGit`**

Append to `src/webview/dashboard/model.ts`:

```ts
/** "7 commits · 12 files" plus the signed line counts, split so the UI can colour them. */
function formatGit(t: GitTotals): { text: string; added: string; removed: string } {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return {
    text: `${count(t.commits, 'commit', 'commits')} · ${count(t.filesChanged, 'file', 'files')}`,
    added: `+${t.linesAdded.toLocaleString('en-US')}`,
    removed: `−${t.linesRemoved.toLocaleString('en-US')}`,
  };
}
```

- [ ] **Step 4: Render it**

Replace `src/webview/dashboard/breakdown.ts`:

```ts
'use strict';

/** "7 commits · 12 files +512 −120", with the line counts coloured. */
function renderGitLine(t: GitTotals): HTMLElement {
  const f = formatGit(t);
  return h('span', { class: 'git' }, `${f.text} `, h('span', { class: 'add' }, f.added), ' ', h('span', { class: 'del' }, f.removed));
}

/** Under a project name: its git numbers, "—" when it has none, nothing when it has no commits in the range. */
function projectGitCell(share: Share, git: DashboardGit): HTMLElement | null {
  if (share.key === undefined) return null;
  if (!Object.prototype.hasOwnProperty.call(git.byProject, share.key)) {
    return h('span', { class: 'git', title: 'No git data for this project (not open, or git unavailable)' }, '—');
  }
  const totals = git.byProject[share.key];
  return totals.commits > 0 ? renderGitLine(totals) : null;
}

/** One card: a ranked list of name, proportional bar (relative to the largest row), duration and percent. `git` adds a line under project names. */
function renderBreakdown(title: string, shares: Share[], git?: DashboardGit): HTMLElement {
  const widths = barScale(shares.map((share) => share.ms), 100, 0);
  const rows = shares.map((share, i) => {
    const fillBar = h('div', { class: 'fill' });
    fillBar.style.setProperty('width', `${widths[i]}%`);
    const name = h('span', { class: 'name', title: share.name }, share.name);
    const gitCell = git ? projectGitCell(share, git) : null;
    return h(
      'li',
      { class: 'row' },
      gitCell ? h('div', { class: 'namecell' }, name, gitCell) : name,
      h('div', { class: 'track' }, fillBar),
      h('span', { class: 'dur' }, formatDuration(share.ms)),
      h('span', { class: 'pct' }, formatPercent(share.percent, share.ms)),
    );
  });
  return h('section', { class: 'card' }, h('h2', null, title), h('ul', { class: 'rows' }, ...rows));
}
```

In `src/webview/dashboard/main.ts`, change the projects call in `renderBody`:

```ts
    h('div', { class: 'columns' }, renderBreakdown('Projects', model.projects, model.git), renderBreakdown('Languages', model.languages)),
```

and the total section in `render`:

```ts
    h(
      'section',
      { class: 'total' },
      h('div', { class: 'total-value' }, formatDuration(model.totalMs)),
      h('div', { class: 'total-label' }, model.rangeLabel),
      model.git && model.git.totals.commits > 0 ? h('div', { class: 'total-git' }, renderGitLine(model.git.totals)) : null,
    ),
```

Append to `lib/dashboard.css` (hand-written file):

```css
.namecell {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.git {
  color: var(--muted);
  font-size: 0.85em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.git .add {
  color: var(--vscode-charts-green, #388a34);
}

.git .del {
  color: var(--vscode-charts-red, #e51400);
}

.total-git {
  margin-top: 4px;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npm test`
Expected: PASS. The test script also runs `tsc -p tsconfig.webview-dashboard.json`, which rewrites `lib/dashboard.js` — expected, committed in Task 6.

- [ ] **Step 6: Commit** (source and hand-written CSS only; `lib/dashboard.js` waits for Task 6)

```bash
git add extensions/null-activity/src/webview extensions/null-activity/src/test/dashboardWebviewModel.test.ts extensions/null-activity/lib/dashboard.css
git commit -m "feat(null-activity): show git statistics in the dashboard"
```

---

### Task 6: Docs, compiled output and verification

**Files:**
- Modify: `../../CLAUDE.md` (null-activity paragraph)
- Refresh: `out/`, `lib/dashboard.js`

**Interfaces:** none.

- [ ] **Step 1: Update CLAUDE.md**

In the null-activity paragraph, change `(issue #113; engine and dashboard — git stats, badge and WakaTime import are later specs)` to `(issue #113; engine, dashboard and git statistics — badge and WakaTime import are later specs)`.

Before `Designs:` add this sentence:

```
**Git statistics** (`gitLog.ts` pure parser, `gitStatsService.ts` with injected deps and a 60 s per-repo cache, `gitExec.ts` the only place that spawns git): the dashboard shows your commits, distinct files and lines +/− per project and in total. Only commits whose author email equals the repo's `user.email`, on local branches, no merges, for projects in the *open workspace folders* matched by project key (the interval log stores no folder paths, so other projects show "—"); nothing runs in an untrusted workspace. `DashboardPanel` posts the model at once with cached numbers, loads in the background and posts again; the log, `NullActivityApi` and `ActivityService` are unchanged.
```

and extend the designs/plans lists with `docs/specs/null-activity-git-design.md` and `docs/plans/null-activity-git.md`.

- [ ] **Step 2: Rebuild and run everything**

Run: `npm run compile && npm test`
Expected: PASS, no type errors.

- [ ] **Step 3: Verify in the real app**

Run (from the repo root): `/verify-local null-activity` — it syncs into the installed Null IDE and runs the integration specs.
Expected: all existing specs pass.

Then by hand in that Null IDE, with a repo open that has commits of yours today: open the dashboard (status bar clock). Expected: within a moment the Projects row for that repo shows `N commits · N files +X −Y` and the total shows the same line. Also check: switch ranges quickly (no flash of wrong numbers); open a second folder that is not a repo (its row shows "—" only if it was tracked); restricted-mode workspace shows no git lines.

- [ ] **Step 4: Refresh the graph**

Run (from the repo root): `graphify update .`

- [ ] **Step 5: Commit** (two commits, per the repo's conventions)

```bash
git add CLAUDE.md
git commit -m "docs: document null-activity git statistics"
git add extensions/null-activity/out extensions/null-activity/lib/dashboard.js
git commit -m "chore: refresh null-activity compiled output"
```

---

## Self-Review

- **Spec coverage:** counting rules (Task 1 parser + args), open-folders-only and key matching (Task 2 `repos()`, Task 3 `key`), cache/TTL/in-flight/failure handling (Task 2), untrusted workspace (Task 2), data model and flow including stale-while-revalidate and range switching (Tasks 1, 3, 4), UI rules for the total, project rows, "—", hidden-when-empty and plural forms (Task 5), tests listed in the spec (Tasks 1, 2, 3, 5), repository wiring (`package.json` in Tasks 1–2, CLAUDE.md in Task 6). The "hide all dashes when nothing resolved" rule holds because `git` is absent from the model when `byProject` is empty, so `renderBreakdown` gets `git === undefined`.
- **Deviations from the spec, deliberate:** `gitLogArgs` takes the email (needed for `--author`); the service API is `peek`/`load` (the spec was updated to match). The spec's per-panel `cached(range)` became `peek`.
- **Type consistency:** `GitTotals`, `DashboardGit`, `Share.key`, `DashboardModel.git` are defined once in `protocol.ts` (Task 1) and used by name afterwards; `GitExec`, `GIT_TTL_MS`, `GitStatsDeps`, `peek`, `load`, `execGit`, `formatGit`, `renderGitLine`, `projectGitCell` match across tasks.
- **Placeholders:** none.

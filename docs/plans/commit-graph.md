# Native Commit Graph Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** A lane-drawn commit graph tab plus an activity-bar recent-commits list in `null-tools`, with commit details, native diffs and the common history actions (issue #87, sub-project 1).

**Architecture:** The extension host owns all state and layout (`src/graph/`): pure parsers and a lane layouter, a git service with injected `runGit`, an actions module returning `Result<T>`, a `GraphSession` that resolves the repo, detects changes by fingerprint and serializes actions, and thin `vscode` glue (panel, tree, commands). The webview is vanilla TS (`module: none`, no imports) that only renders and sends intents; its pure math lives in a small file that `node --test` loads through `vm`.

**Tech Stack:** TypeScript (commonjs host, `module: none` webview), `child_process.execFile`, `node:test` + real `git` in temp repos, mocha integration spec on vanilla VS Code, built-in `vscode.git` API (only for `toGitUri` and repo-change events).

**Spec:** `docs/specs/commit-graph-design.md` (read it first; this plan lists the places where implementation details refine it in Task 12).

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

- Everything lives in `extensions/null-tools`; run all commands from that directory (`cd extensions/null-tools`).
- `out/` and `lib/` are tracked; never hand-edit `out/` or `lib/commitGraph.js`. `lib/commitGraph.css` is hand-written.
- Every new `*.test.ts` must be added to **both** `tsconfig.json`'s `include` and the explicit `node --test` list in `package.json`'s `test` script, or it is silently skipped.
- Webview code: `module: none`, no imports, top-level `function` declarations for anything a test loads through `vm`; commit messages and ref names are untrusted, so use `textContent` only, never `innerHTML` (the static octicon strings are the only exception).
- Webview CSP is `default-src 'none'; style-src ${cspSource}; script-src 'nonce-…'`: set styles through `element.style.x = …` (CSSOM), never through a `style="…"` attribute string.
- Git: async `execFile` only, via the one `runGit` wrapper; `--` before refs/paths; no force flags, no push; sha must match `^[0-9a-f]{40}$`.
- Acts on the worktree of the first workspace folder (`git rev-parse --show-toplevel`); not `resolveMainWorktreeRoot`.
- Page size 500, row height 24 px, lane column cap 10, palette of 6 `--vscode-charts-*` colors, detail file list capped at 500 rows (in the webview).
- Commit style: `feat(null-tools): …` / `test(null-tools): …`, then a separate `chore: refresh null-tools compiled output` commit for `out/` and `lib/` (the repo convention). Do not push.

## Review Focus

Failure modes the spec implies but a happy-path test would miss, most likely first. Each has a pinned test in the task named in brackets:

1. **Repository with no commits** — `git log … HEAD` errors; the graph must show an empty list, not an error toast. [Task 4 `loadPage on an empty repository`; Task 8 empty-state text]
2. **Stash with an untracked-files commit (`git stash -u`, three parents) and several stashes** — only the stash node may appear, labeled by position; its index/untracked helper commits must not show up as rows. [Task 2 `applyStashes`, Task 4 `stashes`]
3. **File names with spaces, unicode and a leading dash** (`a b.txt`, `é.txt`, `-dash.txt`) in the commit file list and in `openDiff` validation. [Task 2 `parseNameStatus`, Task 4 `commitFiles`, Task 6 `parseWebviewMessage`]
4. **Linked worktree** — `.git` is a file, so the in-progress markers must be found through `git rev-parse --git-path`, and a cherry-pick in the worktree must not mark the main checkout as busy. [Task 4 `inProgress in a linked worktree`]
5. **Cherry-pick that becomes empty** — git stops with `CHERRY_PICK_HEAD` set; neither `--continue` nor `--abort` is the right move, `--skip` must work and clear the state. [Task 5 `empty cherry-pick then skip`]

---

### Task 1: Shared protocol types and the `runGit` wrapper

**Files:**
- Create: `extensions/null-tools/src/graph/protocol.ts`
- Create: `extensions/null-tools/src/graph/gitRun.ts`
- Create: `extensions/null-tools/src/graph/gitRun.test.ts`
- Modify: `extensions/null-tools/tsconfig.json` (include list)
- Modify: `extensions/null-tools/package.json` (`test` script)

**Interfaces:**
- Produces:
  - `protocol.ts`: global (no import/export) interfaces `GraphRefLabel`, `GraphEdge`, `GraphRow`, `GraphDetail`, `GraphFile`, `GraphInProgress`, type `GraphOperationKind`, `GraphUnavailableReason`, unions `GraphHostToWebview`, `GraphWebviewToHost`.
  - `gitRun.ts`: `type RunGit = (args: string[]) => Promise<string>`; `class GitError extends Error { stderr: string; code: number | string | undefined }`; `makeRunGit(cwd: string, timeoutMs = 15_000): RunGit`; `class BusyFlag { get busy(): boolean; run<T>(fn): Promise<{ran: true; value: T} | {ran: false}>; whenIdle(): Promise<void> }`.

- [ ] **Step 1: Create the protocol file**

`src/graph/protocol.ts` has no imports or exports on purpose: it is a global script so the webview bundle (`module: none`) can compile it, and the host pulls it in with `/// <reference path="./protocol.ts" />`.

```ts
// Types shared by the extension host and the Commit Graph webview. No imports or exports: this is a global
// script so the webview bundle (module: none) can compile it; host files pull it in with a triple-slash reference.

interface GraphRefLabel {
  name: string;
  kind: 'head' | 'branch' | 'remote' | 'tag' | 'stash';
  /** The checked-out branch, or the detached HEAD label. */
  current?: boolean;
}

/** One drawn segment inside a 24 px row. pass: lane runs through; in: top of the row -> node; out: node -> bottom. */
interface GraphEdge {
  kind: 'pass' | 'in' | 'out';
  from: number;
  to: number;
  /** Lane index modulo the palette size; the webview maps it to a --vscode-charts-* variable. */
  color: number;
}

interface GraphRow {
  sha: string;
  parents: string[];
  lane: number;
  laneCount: number;
  edges: GraphEdge[];
  refs: GraphRefLabel[];
  subject: string;
  author: string;
  /** Unix seconds. */
  time: number;
}

interface GraphDetail {
  sha: string;
  parents: string[];
  author: string;
  authorEmail: string;
  authorTime: number;
  committer: string;
  committerEmail: string;
  committerTime: number;
  message: string;
}

interface GraphFile {
  /** Single git status letter: A M D R C T U. */
  status: string;
  path: string;
  oldPath?: string;
}

type GraphOperationKind = 'cherry-pick' | 'revert' | 'merge' | 'rebase';
interface GraphInProgress { kind: GraphOperationKind }
type GraphUnavailableReason = 'no-folder' | 'remote' | 'untrusted' | 'not-a-repo' | 'no-git';

type GraphHostToWebview =
  | { type: 'rows'; rows: GraphRow[]; hasMore: boolean; reset: boolean }
  | { type: 'detail'; detail: GraphDetail }
  | { type: 'files'; sha: string; files: GraphFile[] }
  | { type: 'state'; inProgress: GraphInProgress | null }
  | { type: 'focus'; sha: string }
  | { type: 'loadError'; message: string; retry: 'refresh' | 'loadMore' }
  | { type: 'unavailable'; reason: GraphUnavailableReason };

type GraphWebviewToHost =
  | { type: 'ready' }
  | { type: 'loadMore' }
  | { type: 'refresh' }
  | { type: 'select'; sha: string }
  | { type: 'goto'; sha: string }
  | { type: 'openDiff'; sha: string; file: string }
  | { type: 'banner'; action: 'continue' | 'skip' | 'abort' }
  | { type: 'manageTrust' };
```

- [ ] **Step 2: Write the failing test**

`src/graph/gitRun.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { BusyFlag, GitError, makeRunGit } from './gitRun';

test('runGit returns stdout and rejects with git\'s own message', async () => {
  const git = makeRunGit(process.cwd());
  assert.match(await git(['--version']), /^git version/);
  await assert.rejects(
    git(['rev-parse', '--verify', 'definitely-not-a-ref']),
    (err: unknown) => err instanceof GitError && err.message.length > 0,
  );
});

test('runGit sets GIT_EDITOR=true so --continue never opens an editor', async () => {
  assert.strictEqual((await makeRunGit(process.cwd())(['var', 'GIT_EDITOR'])).trim(), 'true');
});

test('BusyFlag refuses a second action and whenIdle waits for the first', async () => {
  const busy = new BusyFlag();
  let release!: () => void;
  const first = busy.run(() => new Promise<string>((resolve) => { release = () => resolve('done'); }));
  assert.strictEqual(busy.busy, true);
  assert.deepStrictEqual(await busy.run(async () => 'second'), { ran: false });

  let idle = false;
  const waiting = busy.whenIdle().then(() => { idle = true; });
  await Promise.resolve();
  assert.strictEqual(idle, false);

  release();
  assert.deepStrictEqual(await first, { ran: true, value: 'done' });
  await waiting;
  assert.strictEqual(idle, true);
  assert.strictEqual(busy.busy, false);
});

test('BusyFlag clears even when the action throws', async () => {
  const busy = new BusyFlag();
  await assert.rejects(busy.run(async () => { throw new Error('boom'); }), /boom/);
  assert.strictEqual(busy.busy, false);
});
```

- [ ] **Step 3: Register the test (tsconfig + package.json) and run it to see it fail**

In `tsconfig.json`, append `"src/graph/gitRun.test.ts"` to the `include` array (before `"src/test/runTest.ts"`). In `package.json`, append ` out/graph/gitRun.test.js` to the end of the `node --test …` list in the `test` script.

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './gitRun'`.

- [ ] **Step 4: Implement `gitRun.ts`**

```ts
'use strict';

import { execFile } from 'child_process';

export type RunGit = (args: string[]) => Promise<string>;

export class GitError extends Error {
  constructor(message: string, readonly stderr: string, readonly code: number | string | undefined) {
    super(message);
    this.name = 'GitError';
  }
}

// GIT_OPTIONAL_LOCKS=0: background reads never take index.lock, so they cannot make the user's own commit fail.
// GIT_EDITOR=true: `--continue` never blocks on an editor. LC_ALL=C: stable English messages.
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', LC_ALL: 'C' };

/** The only place the graph spawns git. Reads use the 15 s default; actions pass a longer timeout. */
export function makeRunGit(cwd: string, timeoutMs = 15_000): RunGit {
  return (args) => new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', ...args],
      { cwd, env: { ...process.env, ...GIT_ENV }, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (!err) { resolve(stdout); return; }
        const text = [stderr, stdout].map((s) => s.trim()).filter(Boolean).join('\n') || err.message;
        reject(new GitError(text, stderr, (err as NodeJS.ErrnoException).code));
      },
    );
  });
}

/** One action at a time per repo. Reads wait for the running action with whenIdle(). */
export class BusyFlag {
  private current: Promise<unknown> | undefined;

  get busy(): boolean {
    return this.current !== undefined;
  }

  async run<T>(fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
    if (this.current) return { ran: false };
    const running = fn();
    this.current = running;
    try {
      return { ran: true, value: await running };
    } finally {
      this.current = undefined;
    }
  }

  async whenIdle(): Promise<void> {
    while (this.current) {
      try { await this.current; } catch { /* the action reports its own failure */ }
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/graph/gitRun.test.js`
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/graph/protocol.ts src/graph/gitRun.ts src/graph/gitRun.test.ts tsconfig.json package.json
git commit -m "feat(null-tools): add graph protocol types and the runGit wrapper (#87)"
```

---

### Task 2: Log parser, stash handling, name-status parser, age formatter

**Files:**
- Create: `extensions/null-tools/src/graph/gitLog.ts`
- Create: `extensions/null-tools/src/graph/gitLog.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Consumes: `GraphRefLabel`, `GraphFile` (protocol.ts).
- Produces:
  - `interface LogCommit { sha: string; parents: string[]; author: string; email: string; time: number; refs: GraphRefLabel[]; subject: string }`
  - `interface StashInfo { sha: string; parents: string[] }`
  - `const LOG_FORMAT: string`
  - `parseDecoration(text: string): GraphRefLabel[]`
  - `parseLog(output: string): LogCommit[]`
  - `applyStashes(commits: LogCommit[], stashes: StashInfo[]): LogCommit[]`
  - `parseNameStatus(output: string): GraphFile[]`
  - `formatAge(time: number, now: number): string`

- [ ] **Step 1: Write the failing test**

`src/graph/gitLog.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { LogCommit, applyStashes, formatAge, parseDecoration, parseLog, parseNameStatus } from './gitLog';

const sha = (c: string): string => c.repeat(40);
const record = (fields: string[]): string => fields.join('\x1f');

test('parseLog: a merge, a commit with awkward characters, and a root commit', () => {
  const out = [
    record([sha('a'), `${sha('b')} ${sha('c')}`, 'Ann', 'ann@x.io', '1700000000',
      'HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main, refs/remotes/origin/HEAD', 'Merge x']),
    record([sha('b'), sha('d'), 'Bob', 'bob@x.io', '1699999999', '', 'Fix "quotes" and \'ticks\' — ünïcode ✓']),
    record([sha('d'), '', 'Cy', 'cy@x.io', '1', '', 'root']),
  ].join('\0') + '\0';

  const commits = parseLog(out);
  assert.strictEqual(commits.length, 3);
  assert.deepStrictEqual(commits[0].parents, [sha('b'), sha('c')]);
  assert.deepStrictEqual(commits[0].refs, [
    { name: 'main', kind: 'branch', current: true },
    { name: 'v1', kind: 'tag' },
    { name: 'origin/main', kind: 'remote' },
  ]);
  assert.strictEqual(commits[1].subject, 'Fix "quotes" and \'ticks\' — ünïcode ✓');
  assert.strictEqual(commits[1].author, 'Bob');
  assert.deepStrictEqual(commits[2].parents, []);
  assert.strictEqual(commits[2].time, 1);
});

test('parseLog ignores empty and malformed records', () => {
  assert.deepStrictEqual(parseLog(''), []);
  assert.deepStrictEqual(parseLog('garbage\0\0'), []);
});

test('parseDecoration: detached HEAD, plain branches; notes, pull refs and refs/stash are ignored', () => {
  assert.deepStrictEqual(
    parseDecoration('HEAD, refs/heads/dev, refs/notes/commits, refs/pull/1/head, refs/stash'),
    [{ name: 'HEAD', kind: 'head', current: true }, { name: 'dev', kind: 'branch', current: false }],
  );
  assert.deepStrictEqual(parseDecoration(''), []);
});

function commit(shaValue: string, parents: string[], subject: string): LogCommit {
  return { sha: shaValue, parents, author: 'a', email: 'e', time: 1, refs: [], subject };
}

test('applyStashes labels stashes by position, keeps the first parent and drops index/untracked commits', () => {
  const base = sha('1');
  const commits = [
    commit(sha('s'), [base, sha('i'), sha('u')], 'On main: wip'),
    commit(sha('i'), [base], 'index on main'),
    commit(sha('u'), [], 'untracked files on main'),
    commit(base, [], 'base'),
    commit(sha('t'), [base, sha('j')], 'On main: older'),
    commit(sha('j'), [base], 'index on main'),
  ];
  const out = applyStashes(commits, [
    { sha: sha('s'), parents: [base, sha('i'), sha('u')] },
    { sha: sha('t'), parents: [base, sha('j')] },
  ]);
  assert.deepStrictEqual(out.map((c) => c.sha), [sha('s'), base, sha('t')]);
  assert.deepStrictEqual(out[0].parents, [base]);
  assert.deepStrictEqual(out[0].refs, [{ name: 'stash@{0}', kind: 'stash' }]);
  assert.deepStrictEqual(out[2].refs, [{ name: 'stash@{1}', kind: 'stash' }]);
});

test('applyStashes with no stashes returns the commits unchanged', () => {
  const commits = [commit(sha('a'), [], 'x')];
  assert.deepStrictEqual(applyStashes(commits, []), commits);
});

test('parseNameStatus: spaces, unicode, a leading dash, renames', () => {
  assert.deepStrictEqual(
    parseNameStatus('M\0a b.txt\0A\0dir/é.txt\0R100\0old.txt\0new.txt\0D\0-dash.txt\0'),
    [
      { status: 'M', path: 'a b.txt' },
      { status: 'A', path: 'dir/é.txt' },
      { status: 'R', oldPath: 'old.txt', path: 'new.txt' },
      { status: 'D', path: '-dash.txt' },
    ],
  );
  assert.deepStrictEqual(parseNameStatus(''), []);
});

test('formatAge', () => {
  const now = 10_000_000;
  const ago = (s: number): string => formatAge(now - s, now);
  assert.strictEqual(ago(30), 'now');
  assert.strictEqual(ago(300), '5m');
  assert.strictEqual(ago(7200), '2h');
  assert.strictEqual(ago(3 * 86400), '3d');
  assert.strictEqual(ago(21 * 86400), '3w');
  assert.strictEqual(ago(90 * 86400), '3mo');
  assert.strictEqual(ago(800 * 86400), '2y');
  assert.strictEqual(formatAge(now + 500, now), 'now');
});
```

- [ ] **Step 2: Register the test and run it to see it fail**

Add `"src/graph/gitLog.test.ts"` to `tsconfig.json` `include` and ` out/graph/gitLog.test.js` to the `test` script.

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './gitLog'`.

- [ ] **Step 3: Implement `gitLog.ts`**

```ts
/// <reference path="./protocol.ts" />
'use strict';

export interface LogCommit {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  /** Unix seconds. */
  time: number;
  refs: GraphRefLabel[];
  subject: string;
}

export interface StashInfo {
  sha: string;
  parents: string[];
}

/** Fields are separated by \x1f; with `-z` git ends each record with NUL. The subject is last so it may hold anything. */
export const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s';

function labelFor(full: string, current: boolean): GraphRefLabel | undefined {
  if (full.startsWith('refs/heads/')) return { name: full.slice('refs/heads/'.length), kind: 'branch', current };
  if (full.startsWith('refs/remotes/')) {
    const name = full.slice('refs/remotes/'.length);
    return name.endsWith('/HEAD') ? undefined : { name, kind: 'remote' };
  }
  if (full.startsWith('refs/tags/')) return { name: full.slice('refs/tags/'.length), kind: 'tag' };
  return undefined; // refs/stash (labeled from the stash list), notes, pull refs, ...
}

/** Parses `%D` produced with `--decorate=full`. */
export function parseDecoration(text: string): GraphRefLabel[] {
  const refs: GraphRefLabel[] = [];
  for (const raw of text.split(', ')) {
    const item = raw.trim();
    if (!item) continue;
    let label: GraphRefLabel | undefined;
    if (item === 'HEAD') label = { name: 'HEAD', kind: 'head', current: true };
    else if (item.startsWith('HEAD -> ')) label = labelFor(item.slice('HEAD -> '.length), true);
    else if (item.startsWith('tag: ')) label = labelFor(item.slice('tag: '.length), false);
    else label = labelFor(item, false);
    if (label) refs.push(label);
  }
  return refs;
}

export function parseLog(output: string): LogCommit[] {
  const commits: LogCommit[] = [];
  for (const record of output.split('\0')) {
    if (!record) continue;
    const f = record.split('\x1f');
    if (f.length < 7) continue;
    commits.push({
      sha: f[0].trim(),
      parents: f[1] ? f[1].split(' ') : [],
      author: f[2],
      email: f[3],
      time: Number(f[4]) || 0,
      refs: parseDecoration(f[5]),
      subject: f.slice(6).join('\x1f'),
    });
  }
  return commits;
}

/**
 * Stash commits have an index commit (and with -u an untracked-files commit) as extra parents. Those helper commits
 * are dropped from the list, and each stash keeps its first parent only and is labeled `stash@{n}` by position.
 */
export function applyStashes(commits: LogCommit[], stashes: StashInfo[]): LogCommit[] {
  if (stashes.length === 0) return commits;
  const position = new Map(stashes.map((s, n) => [s.sha, n]));
  const helpers = new Set(stashes.flatMap((s) => s.parents.slice(1)));
  return commits
    .filter((c) => !helpers.has(c.sha))
    .map((c) => {
      const n = position.get(c.sha);
      return n === undefined ? c : { ...c, parents: c.parents.slice(0, 1), refs: [{ name: `stash@{${n}}`, kind: 'stash' as const }] };
    });
}

/** Parses `diff-tree -z --name-status`: `STATUS\0path\0`, renames and copies carry two paths. */
export function parseNameStatus(output: string): GraphFile[] {
  const tokens = output.split('\0');
  const files: GraphFile[] = [];
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i++];
    if (!status) continue;
    const letter = status[0];
    if (letter === 'R' || letter === 'C') {
      const oldPath = tokens[i++];
      files.push({ status: letter, oldPath, path: tokens[i++] });
    } else {
      files.push({ status: letter, path: tokens[i++] });
    }
  }
  return files;
}

/** Short relative age for the tree: now, 5m, 2h, 3d, 3w, 3mo, 2y. */
export function formatAge(time: number, now: number): string {
  const seconds = Math.max(0, now - time);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/graph/gitLog.test.js`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graph/gitLog.ts src/graph/gitLog.test.ts tsconfig.json package.json
git commit -m "feat(null-tools): add the commit log parser and stash handling (#87)"
```

---

### Task 3: Lane layout

**Files:**
- Create: `extensions/null-tools/src/graph/graphLayout.ts`
- Create: `extensions/null-tools/src/graph/graphLayout.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Consumes: `LogCommit` (gitLog.ts), `GraphRow`, `GraphEdge` (protocol.ts).
- Produces: `class GraphLayouter { reset(): void; layoutPage(commits: LogCommit[]): GraphRow[] }`; `const PALETTE_SIZE = 6`. Edge order within a row is always: all `pass` edges, then `in` edges, then `out` edges.

- [ ] **Step 1: Write the failing test**

`src/graph/graphLayout.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { LogCommit } from './gitLog';
import { GraphLayouter } from './graphLayout';

function c(sha: string, parents: string[]): LogCommit {
  return { sha, parents, author: 'a', email: 'e', time: 1, refs: [], subject: sha };
}

test('a linear history stays in lane 0', () => {
  const rows = new GraphLayouter().layoutPage([c('c3', ['c2']), c('c2', ['c1']), c('c1', [])]);
  assert.deepStrictEqual(rows.map((r) => r.lane), [0, 0, 0]);
  assert.deepStrictEqual(rows.map((r) => r.laneCount), [1, 1, 1]);
  assert.deepStrictEqual(rows[0].edges, [{ kind: 'out', from: 0, to: 0, color: 0 }]);
  assert.deepStrictEqual(rows[1].edges, [{ kind: 'in', from: 0, to: 0, color: 0 }, { kind: 'out', from: 0, to: 0, color: 0 }]);
  assert.deepStrictEqual(rows[2].edges, [{ kind: 'in', from: 0, to: 0, color: 0 }]);
});

test('a merge opens a second lane and the fork point joins them again', () => {
  // M merges A and B, both of which sit on R.
  const rows = new GraphLayouter().layoutPage([c('M', ['A', 'B']), c('A', ['R']), c('B', ['R']), c('R', [])]);
  assert.deepStrictEqual(rows.map((r) => r.lane), [0, 0, 1, 0]);
  assert.deepStrictEqual(rows.map((r) => r.laneCount), [2, 2, 2, 2]);
  assert.deepStrictEqual(rows[0].edges, [
    { kind: 'out', from: 0, to: 0, color: 0 },
    { kind: 'out', from: 0, to: 1, color: 1 },
  ]);
  assert.deepStrictEqual(rows[1].edges, [
    { kind: 'pass', from: 1, to: 1, color: 1 },
    { kind: 'in', from: 0, to: 0, color: 0 },
    { kind: 'out', from: 0, to: 0, color: 0 },
  ]);
  assert.deepStrictEqual(rows[3].edges, [
    { kind: 'in', from: 0, to: 0, color: 0 },
    { kind: 'in', from: 1, to: 0, color: 1 },
  ]);
});

test('an octopus merge opens one lane per extra parent', () => {
  const rows = new GraphLayouter().layoutPage([c('M', ['A', 'B', 'C'])]);
  assert.strictEqual(rows[0].laneCount, 3);
  assert.deepStrictEqual(rows[0].edges.map((e) => [e.kind, e.from, e.to]), [['out', 0, 0], ['out', 0, 1], ['out', 0, 2]]);
});

test('a lane freed by a root commit is reused by the next new tip', () => {
  const rows = new GraphLayouter().layoutPage([c('X1', ['P1', 'P2']), c('P2', []), c('Y', []), c('P1', [])]);
  assert.strictEqual(rows[1].lane, 1);
  assert.strictEqual(rows[2].lane, 1, 'Y reuses the lane P2 freed');
});

test('colors repeat after the palette size', () => {
  const parents = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const rows = new GraphLayouter().layoutPage([c('M', parents)]);
  assert.deepStrictEqual(rows[0].edges.map((e) => e.color), [0, 1, 2, 3, 4, 5, 0]);
});

test('two pages lay out exactly like one page, and reset() starts over', () => {
  const history = [
    c('M', ['A', 'B']), c('A', ['R']), c('B', ['R']), c('N', ['Q']), c('R', ['Q']), c('Q', []),
  ];
  const whole = new GraphLayouter().layoutPage(history);
  for (let split = 1; split < history.length; split++) {
    const layouter = new GraphLayouter();
    const rows = [...layouter.layoutPage(history.slice(0, split)), ...layouter.layoutPage(history.slice(split))];
    assert.deepStrictEqual(rows, whole, `split at ${split}`);
  }
  const layouter = new GraphLayouter();
  layouter.layoutPage(history.slice(0, 2));
  layouter.reset();
  assert.deepStrictEqual(layouter.layoutPage(history), whole);
});
```

- [ ] **Step 2: Register the test and run it to see it fail**

Add `"src/graph/graphLayout.test.ts"` to `tsconfig.json` `include` and ` out/graph/graphLayout.test.js` to the `test` script.

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './graphLayout'`.

- [ ] **Step 3: Implement `graphLayout.ts`**

```ts
/// <reference path="./protocol.ts" />
'use strict';

import { LogCommit } from './gitLog';

export const PALETTE_SIZE = 6;

/**
 * Assigns each commit a lane. `lanes[i]` is the sha lane i is waiting for (the next commit expected there), or null.
 * A commit takes the leftmost lane waiting for it, else a free lane; its first parent inherits that lane and extra
 * (merge) parents take a lane already waiting for them or open one. State carries across pages, so pages must be
 * fed in order and reset() must be called before a reload from the top.
 */
export class GraphLayouter {
  private lanes: Array<string | null> = [];

  reset(): void {
    this.lanes = [];
  }

  layoutPage(commits: LogCommit[]): GraphRow[] {
    return commits.map((commit) => this.layoutOne(commit));
  }

  private freeSlot(): number {
    const free = this.lanes.indexOf(null);
    return free === -1 ? this.lanes.length : free;
  }

  private layoutOne(commit: LogCommit): GraphRow {
    const lanes = this.lanes;
    const before = lanes.length;
    const edges: GraphEdge[] = [];

    lanes.forEach((waitingFor, i) => {
      if (waitingFor !== null && waitingFor !== commit.sha) edges.push({ kind: 'pass', from: i, to: i, color: i % PALETTE_SIZE });
    });

    const waiting: number[] = [];
    lanes.forEach((waitingFor, i) => { if (waitingFor === commit.sha) waiting.push(i); });
    const lane = waiting.length > 0 ? waiting[0] : this.freeSlot();
    for (const w of waiting) edges.push({ kind: 'in', from: w, to: lane, color: w % PALETTE_SIZE });
    for (const w of waiting) lanes[w] = null;
    if (lane >= lanes.length) lanes[lane] = null;

    const [first, ...rest] = commit.parents;
    if (first !== undefined) {
      lanes[lane] = first;
      edges.push({ kind: 'out', from: lane, to: lane, color: lane % PALETTE_SIZE });
    }
    for (const parent of rest) {
      let target = lanes.indexOf(parent);
      if (target === -1) {
        target = this.freeSlot();
        lanes[target] = parent;
      }
      edges.push({ kind: 'out', from: lane, to: target, color: target % PALETTE_SIZE });
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    return {
      sha: commit.sha,
      parents: commit.parents,
      lane,
      laneCount: Math.max(before, lanes.length, lane + 1),
      edges,
      refs: commit.refs,
      subject: commit.subject,
      author: commit.author,
      time: commit.time,
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/graph/graphLayout.test.js`
Expected: 6 tests PASS. If the merge test fails on edge order or `laneCount`, re-trace the algorithm by hand against the expected rows in the test before changing either.

- [ ] **Step 5: Commit**

```bash
git add src/graph/graphLayout.ts src/graph/graphLayout.test.ts tsconfig.json package.json
git commit -m "feat(null-tools): add the commit graph lane layouter (#87)"
```

---

### Task 4: Git graph service (paging, refs, fingerprint, detail, files, in-progress)

**Files:**
- Create: `extensions/null-tools/src/graph/gitGraphService.ts`
- Create: `extensions/null-tools/src/graph/gitGraphService.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Consumes: `RunGit`, `GitError`, `makeRunGit` (gitRun.ts); `LOG_FORMAT`, `LogCommit`, `StashInfo`, `applyStashes`, `parseLog`, `parseNameStatus` (gitLog.ts).
- Produces:
  - `const PAGE_SIZE = 500`
  - `interface RefInfo { name: string; kind: 'branch' | 'remote' | 'tag'; sha: string }`
  - `interface LogPage { commits: LogCommit[]; rawCount: number; hasMore: boolean }`
  - `type RootResult = { ok: true; root: string } | { ok: false; reason: 'no-git' | 'not-a-repo' }`
  - `resolveRepoRoot(folder: string): Promise<RootResult>`
  - `class GitGraphService { constructor(git: RunGit, root: string); readonly root: string; stashes(): Promise<StashInfo[]>; loadPage(skip: number, count?: number): Promise<LogPage>; refs(): Promise<RefInfo[]>; fingerprint(): Promise<{ hash: string; inProgress: GraphInProgress | null }>; inProgress(): Promise<GraphInProgress | null>; commitDetail(sha: string): Promise<GraphDetail>; commitFiles(sha: string, parent?: string): Promise<GraphFile[]> }`

- [ ] **Step 1: Write the failing test**

`src/graph/gitGraphService.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitGraphService, resolveRepoRoot } from './gitGraphService';
import { makeRunGit } from './gitRun';

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'graph-service-'));
  git(dir, 'init', '-q', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  return dir;
}

function commit(dir: string, file: string, content: string, message: string): string {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '--', file);
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

const service = (dir: string): GitGraphService => new GitGraphService(makeRunGit(dir), dir);
const real = (p: string): string => realpathSync.native(p).toLowerCase();

test('loadPage pages through history and labels HEAD, tags and branches', async () => {
  const dir = initRepo();
  const shas = [1, 2, 3, 4, 5].map((n) => commit(dir, 'a.txt', String(n), `commit ${n}`));
  git(dir, 'tag', 'v1', shas[1]);
  git(dir, 'branch', 'dev', shas[2]);

  const first = await service(dir).loadPage(0, 3);
  assert.deepStrictEqual(first.commits.map((x) => x.subject), ['commit 5', 'commit 4', 'commit 3']);
  assert.strictEqual(first.hasMore, true);
  assert.strictEqual(first.rawCount, 3);
  assert.deepStrictEqual(first.commits[0].refs, [{ name: 'main', kind: 'branch', current: true }]);
  assert.deepStrictEqual(first.commits[2].refs, [{ name: 'dev', kind: 'branch', current: false }]);

  const second = await service(dir).loadPage(3, 3);
  assert.deepStrictEqual(second.commits.map((x) => x.subject), ['commit 2', 'commit 1']);
  assert.strictEqual(second.hasMore, false);
  assert.deepStrictEqual(second.commits[0].refs, [{ name: 'v1', kind: 'tag' }]);
});

test('loadPage on an empty repository returns an empty page instead of failing', async () => {
  const dir = initRepo();
  assert.deepStrictEqual(await service(dir).loadPage(0), { commits: [], rawCount: 0, hasMore: false });
});

test('a detached HEAD gets its own label and the branch is no longer current', async () => {
  const dir = initRepo();
  const first = commit(dir, 'a.txt', '1', 'one');
  commit(dir, 'a.txt', '2', 'two');
  git(dir, 'checkout', '-q', '--detach', first);
  const page = await service(dir).loadPage(0);
  const byRef = (name: string) => page.commits.find((x) => x.refs.some((r) => r.name === name))!;
  assert.deepStrictEqual(byRef('HEAD').refs, [{ name: 'HEAD', kind: 'head', current: true }]);
  assert.deepStrictEqual(byRef('main').refs, [{ name: 'main', kind: 'branch', current: false }]);
});

test('refs lists branches, remotes and tags, with annotated tags peeled to their commit', async () => {
  const dir = initRepo();
  const sha = commit(dir, 'a.txt', '1', 'one');
  git(dir, 'tag', '-a', 'v2', '-m', 'annotated');
  git(dir, 'update-ref', 'refs/remotes/origin/main', sha);
  git(dir, 'update-ref', 'refs/remotes/origin/HEAD', sha);
  const refs = await service(dir).refs();
  assert.deepStrictEqual(
    refs.map((r) => [r.name, r.kind, r.sha]).sort(),
    [['main', 'branch', sha], ['origin/main', 'remote', sha], ['v2', 'tag', sha]],
  );
});

test('stashes appear once each, labeled by position, without their index/untracked helper commits', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'base', 'base');
  writeFileSync(path.join(dir, 'a.txt'), 'older');
  git(dir, 'stash');
  writeFileSync(path.join(dir, 'a.txt'), 'newer');
  writeFileSync(path.join(dir, 'untracked.txt'), 'u');
  git(dir, 'stash', '-u');

  const page = await service(dir).loadPage(0);
  const subjects = page.commits.map((x) => x.subject);
  assert.ok(!subjects.some((s) => s.startsWith('index on') || s.startsWith('untracked files on')), subjects.join(' | '));
  const stashes = page.commits.filter((x) => x.refs.some((r) => r.kind === 'stash'));
  assert.deepStrictEqual(stashes.map((x) => x.refs[0].name).sort(), ['stash@{0}', 'stash@{1}']);
  assert.ok(stashes.every((x) => x.parents.length === 1));
});

test('fingerprint changes on a commit or a branch switch, not on a file edit', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', '1', 'one');
  const svc = service(dir);
  const base = (await svc.fingerprint()).hash;

  writeFileSync(path.join(dir, 'a.txt'), 'edited but not committed');
  writeFileSync(path.join(dir, 'new.txt'), 'untracked');
  assert.strictEqual((await svc.fingerprint()).hash, base);

  git(dir, 'switch', '-q', '-c', 'other');
  const switched = (await svc.fingerprint()).hash;
  assert.notStrictEqual(switched, base);

  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'two');
  assert.notStrictEqual((await svc.fingerprint()).hash, switched);
});

function conflictingCherryPick(dir: string): void {
  commit(dir, 'a.txt', 'base', 'base');
  git(dir, 'switch', '-q', '-c', 'side');
  commit(dir, 'a.txt', 'side', 'side change');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'a.txt', 'main', 'main change');
}

test('inProgress sees a stopped cherry-pick, and the fingerprint reports it', async () => {
  const dir = initRepo();
  conflictingCherryPick(dir);
  const svc = service(dir);
  assert.strictEqual(await svc.inProgress(), null);
  try { git(dir, 'cherry-pick', 'side'); } catch { /* conflict, expected */ }
  assert.deepStrictEqual(await svc.inProgress(), { kind: 'cherry-pick' });
  assert.deepStrictEqual((await svc.fingerprint()).inProgress, { kind: 'cherry-pick' });
});

test('inProgress in a linked worktree is found through --git-path and stays local to that worktree', async () => {
  const dir = initRepo();
  conflictingCherryPick(dir);
  const linked = path.join(mkdtempSync(path.join(tmpdir(), 'graph-linked-')), 'wt');
  git(dir, 'worktree', 'add', '-q', '-b', 'wt', linked, 'main');
  try { git(linked, 'cherry-pick', 'side'); } catch { /* conflict, expected */ }
  assert.deepStrictEqual(await service(linked).inProgress(), { kind: 'cherry-pick' });
  assert.strictEqual(await service(dir).inProgress(), null);
});

test('commitDetail returns the full message, both identities and the parents', async () => {
  const dir = initRepo();
  const first = commit(dir, 'a.txt', '1', 'one');
  writeFileSync(path.join(dir, 'a.txt'), '2');
  git(dir, 'add', '--', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'Second', '-m', 'Body line one\nBody line two');
  const sha = git(dir, 'rev-parse', 'HEAD');
  const detail = await service(dir).commitDetail(sha);
  assert.strictEqual(detail.sha, sha);
  assert.deepStrictEqual(detail.parents, [first]);
  assert.strictEqual(detail.author, 'Test');
  assert.strictEqual(detail.committerEmail, 'test@example.com');
  assert.strictEqual(detail.message, 'Second\n\nBody line one\nBody line two');
});

test('commitFiles: root commit, rename + modify, and a merge against its first parent; odd file names survive', async () => {
  const dir = initRepo();
  writeFileSync(path.join(dir, 'a b.txt'), 'content that is long enough to detect a rename\n'.repeat(5));
  writeFileSync(path.join(dir, 'é.txt'), 'x');
  writeFileSync(path.join(dir, '-dash.txt'), 'y');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'root');
  const root = git(dir, 'rev-parse', 'HEAD');

  const svc = service(dir);
  const rootFiles = await svc.commitFiles(root);
  assert.deepStrictEqual(rootFiles.map((f) => [f.status, f.path]).sort(), [['A', '-dash.txt'], ['A', 'a b.txt'], ['A', 'é.txt']]);

  git(dir, 'mv', 'a b.txt', 'c.txt');
  writeFileSync(path.join(dir, 'é.txt'), 'changed');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'rename');
  const second = git(dir, 'rev-parse', 'HEAD');
  const renamed = await svc.commitFiles(second, root);
  assert.deepStrictEqual(renamed.map((f) => [f.status, f.path, f.oldPath]).sort(), [['M', 'é.txt', undefined], ['R', 'c.txt', 'a b.txt']]);

  git(dir, 'switch', '-q', '-c', 'side');
  commit(dir, 's.txt', 's', 'side');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'm.txt', 'm', 'main');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  const merge = git(dir, 'rev-parse', 'HEAD');
  const parents = (await svc.commitDetail(merge)).parents;
  assert.strictEqual(parents.length, 2);
  assert.deepStrictEqual((await svc.commitFiles(merge, parents[0])).map((f) => [f.status, f.path]), [['A', 's.txt']]);
});

test('resolveRepoRoot finds the top level from a subfolder and reports a plain folder', async () => {
  const dir = initRepo();
  mkdirSync(path.join(dir, 'sub'));
  const found = await resolveRepoRoot(path.join(dir, 'sub'));
  assert.ok(found.ok);
  if (found.ok) assert.strictEqual(real(found.root), real(dir));
  assert.deepStrictEqual(await resolveRepoRoot(mkdtempSync(path.join(tmpdir(), 'graph-plain-'))), { ok: false, reason: 'not-a-repo' });
});
```

- [ ] **Step 2: Register the test and run it to see it fail**

Add `"src/graph/gitGraphService.test.ts"` to `tsconfig.json` `include` and ` out/graph/gitGraphService.test.js` to the `test` script.

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './gitGraphService'`.

- [ ] **Step 3: Implement `gitGraphService.ts`**

```ts
/// <reference path="./protocol.ts" />
'use strict';

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { LOG_FORMAT, LogCommit, StashInfo, applyStashes, parseLog, parseNameStatus } from './gitLog';
import { GitError, RunGit, makeRunGit } from './gitRun';

export const PAGE_SIZE = 500;

export interface RefInfo {
  name: string;
  kind: 'branch' | 'remote' | 'tag';
  /** The commit the ref points at (annotated tags are peeled). */
  sha: string;
}

export interface LogPage {
  commits: LogCommit[];
  /** Commits git returned before stash helper commits were dropped; the next page starts at skip + rawCount. */
  rawCount: number;
  hasMore: boolean;
}

export type RootResult = { ok: true; root: string } | { ok: false; reason: 'no-git' | 'not-a-repo' };

const OPERATION_MARKERS: Array<[string, GraphOperationKind]> = [
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['MERGE_HEAD', 'merge'],
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
];

const NO_HEAD = /ambiguous argument 'HEAD'|does not have any commits|bad default revision/;

export async function resolveRepoRoot(folder: string): Promise<RootResult> {
  try {
    const out = await makeRunGit(folder)(['rev-parse', '--show-toplevel']);
    return { ok: true, root: path.normalize(out.trim()) };
  } catch (err) {
    return { ok: false, reason: err instanceof GitError && err.code === 'ENOENT' ? 'no-git' : 'not-a-repo' };
  }
}

export class GitGraphService {
  constructor(private readonly git: RunGit, readonly root: string) {}

  async stashes(): Promise<StashInfo[]> {
    const out = await this.git(['stash', 'list', '--format=%H%x1f%P']);
    return out.split('\n').filter(Boolean).map((line) => {
      const [sha, parents] = line.split('\x1f');
      return { sha, parents: parents ? parents.split(' ') : [] };
    });
  }

  /** `--date-order` is parent-safe and roughly newest-first (`--topo-order` lets one old branch fill page 1). */
  async loadPage(skip: number, count: number = PAGE_SIZE): Promise<LogPage> {
    const stashes = await this.stashes();
    const run = (withHead: boolean) => this.git([
      'log', '--date-order', '--decorate=full', '-z', `--format=${LOG_FORMAT}`, `--skip=${skip}`, '-n', String(count),
      '--branches', '--tags', '--remotes', ...(withHead ? ['HEAD'] : []), ...stashes.map((s) => s.sha), '--',
    ]);
    let out: string;
    try {
      out = await run(true);
    } catch (err) {
      if (!(err instanceof GitError) || !NO_HEAD.test(err.message)) throw err;
      try { out = await run(false); } catch { out = ''; } // unborn HEAD: nothing (or only other refs) to show
    }
    const raw = parseLog(out);
    return { commits: applyStashes(raw, stashes), rawCount: raw.length, hasMore: raw.length === count };
  }

  async refs(): Promise<RefInfo[]> {
    const out = await this.git([
      'for-each-ref', '--format=%(refname)%1f%(objectname)%1f%(*objectname)', 'refs/heads', 'refs/remotes', 'refs/tags',
    ]);
    const refs: RefInfo[] = [];
    for (const line of out.split('\n')) {
      if (!line) continue;
      const [full, object, peeled] = line.split('\x1f');
      const sha = peeled || object;
      if (full.startsWith('refs/heads/')) refs.push({ name: full.slice('refs/heads/'.length), kind: 'branch', sha });
      else if (full.startsWith('refs/remotes/') && !full.endsWith('/HEAD')) refs.push({ name: full.slice('refs/remotes/'.length), kind: 'remote', sha });
      else if (full.startsWith('refs/tags/')) refs.push({ name: full.slice('refs/tags/'.length), kind: 'tag', sha });
    }
    return refs;
  }

  private async attempt(args: string[]): Promise<string> {
    try { return (await this.git(args)).trim(); } catch { return ''; }
  }

  /** A hash of everything the graph shows plus the in-progress state; a working-tree edit does not change it. */
  async fingerprint(): Promise<{ hash: string; inProgress: GraphInProgress | null }> {
    const [refs, head, branch, stash, inProgress] = await Promise.all([
      this.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags']),
      this.attempt(['rev-parse', '--verify', '--quiet', 'HEAD']),
      this.attempt(['symbolic-ref', '--quiet', 'HEAD']),
      this.git(['stash', 'list', '--format=%H']),
      this.inProgress(),
    ]);
    const hash = crypto.createHash('sha1').update([refs, head, branch, stash, inProgress?.kind ?? ''].join('\n--\n')).digest('hex');
    return { hash, inProgress };
  }

  /** Markers are resolved through --git-path so a linked worktree (where .git is a file) reads its own state. */
  async inProgress(): Promise<GraphInProgress | null> {
    const out = await this.git(['rev-parse', ...OPERATION_MARKERS.flatMap(([name]) => ['--git-path', name])]);
    const paths = out.split('\n').filter(Boolean);
    for (let i = 0; i < OPERATION_MARKERS.length; i++) {
      if (paths[i] && fs.existsSync(path.resolve(this.root, paths[i]))) return { kind: OPERATION_MARKERS[i][1] };
    }
    return null;
  }

  async commitDetail(sha: string): Promise<GraphDetail> {
    const out = await this.git(['show', '-s', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B', sha, '--']);
    const f = out.split('\x1f');
    return {
      sha: f[0].trim(),
      parents: f[1] ? f[1].split(' ') : [],
      author: f[2],
      authorEmail: f[3],
      authorTime: Number(f[4]) || 0,
      committer: f[5],
      committerEmail: f[6],
      committerTime: Number(f[7]) || 0,
      message: f.slice(8).join('\x1f').trim(),
    };
  }

  /** Files changed against `parent` (the first parent for a merge); a root commit passes no parent and diffs against nothing. */
  async commitFiles(sha: string, parent?: string): Promise<GraphFile[]> {
    const base = ['diff-tree', '-z', '--no-commit-id', '--name-status', '-r', '-M'];
    const out = await this.git(parent ? [...base, parent, sha, '--'] : [...base, '--root', sha, '--']);
    return parseNameStatus(out);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/graph/gitGraphService.test.js`
Expected: 11 tests PASS. Two things to check if one fails: `%D` must honour `--decorate=full` (the ref-label assertions prove it on your git version), and `git stash list --format=%H%x1f%P` must split cleanly on `\x1f`.

- [ ] **Step 5: Commit**

```bash
git add src/graph/gitGraphService.ts src/graph/gitGraphService.test.ts tsconfig.json package.json
git commit -m "feat(null-tools): add the git graph service (#87)"
```

---

### Task 5: Git actions

**Files:**
- Create: `extensions/null-tools/src/graph/gitActions.ts`
- Create: `extensions/null-tools/src/graph/gitActions.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Consumes: `Result<T>` from `../worktrees`; `RunGit` (gitRun.ts); `GraphInProgress`, `GraphOperationKind` (protocol.ts).
- Produces:
  - `type CheckoutTarget = { kind: 'branch'; name: string } | { kind: 'remote'; name: string } | { kind: 'detach'; sha: string }`
  - `interface StoppedInfo { stopped: boolean; message: string }`
  - `interface ResetImpact { branch: string | null; leaving: number; orphaned: number; trackedChanges: number }`
  - `checkout(git, target): Promise<Result<void>>`
  - `createBranch(git, name, sha): Promise<Result<void>>`
  - `cherryPick(git, inProgress, sha, parent?): Promise<Result<StoppedInfo>>`
  - `revert(git, inProgress, sha, parent?): Promise<Result<StoppedInfo>>`
  - `resumeOperation(git, inProgress, action: 'continue' | 'skip' | 'abort'): Promise<Result<StoppedInfo>>`
  - `reset(git, mode: 'soft' | 'mixed' | 'hard', sha): Promise<Result<void>>`
  - `resetImpact(git, sha): Promise<Result<ResetImpact>>`
  - where `inProgress` is `() => Promise<GraphInProgress | null>`.

- [ ] **Step 1: Write the failing test**

`src/graph/gitActions.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cherryPick, checkout, createBranch, reset, resetImpact, resumeOperation, revert } from './gitActions';
import { GitGraphService } from './gitGraphService';
import { makeRunGit } from './gitRun';

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'graph-actions-'));
  git(dir, 'init', '-q', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  return dir;
}

function commit(dir: string, file: string, content: string, message: string): string {
  writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '--', file);
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

function tools(dir: string) {
  const run = makeRunGit(dir);
  const service = new GitGraphService(run, dir);
  return { run, inProgress: () => service.inProgress() };
}

function expectOk<T>(result: { ok: boolean; message?: string; value?: T }): T {
  assert.ok(result.ok, result.ok ? '' : String(result.message));
  return result.value as T;
}

test('checkout: a branch, a detached sha, and a remote branch that becomes a tracking branch', async () => {
  const dir = initRepo();
  const first = commit(dir, 'a.txt', '1', 'one');
  commit(dir, 'a.txt', '2', 'two');
  git(dir, 'branch', 'dev', first);
  const { run } = tools(dir);

  expectOk(await checkout(run, { kind: 'branch', name: 'dev' }));
  assert.strictEqual(git(dir, 'branch', '--show-current'), 'dev');

  expectOk(await checkout(run, { kind: 'detach', sha: first }));
  assert.strictEqual(git(dir, 'branch', '--show-current'), '');
  assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), first);

  const clone = path.join(mkdtempSync(path.join(tmpdir(), 'graph-clone-')), 'c');
  execFileSync('git', ['clone', '-q', dir, clone]);
  git(dir, 'switch', '-q', '-c', 'feat');
  commit(dir, 'f.txt', 'f', 'feat');
  git(clone, 'fetch', '-q', 'origin');
  expectOk(await checkout(makeRunGit(clone), { kind: 'remote', name: 'origin/feat' }));
  assert.strictEqual(git(clone, 'branch', '--show-current'), 'feat');
});

test('checkout of a dirty tree is refused by git and the message comes back', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'base', 'base');
  git(dir, 'switch', '-q', '-c', 'other');
  commit(dir, 'a.txt', 'other', 'other');
  git(dir, 'switch', '-q', 'main');
  writeFileSync(path.join(dir, 'a.txt'), 'dirty');
  const result = await checkout(tools(dir).run, { kind: 'branch', name: 'other' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'dirty', 'nothing forced');
});

test('createBranch validates the name and switches to the new branch at the sha', async () => {
  const dir = initRepo();
  const first = commit(dir, 'a.txt', '1', 'one');
  commit(dir, 'a.txt', '2', 'two');
  const { run } = tools(dir);
  assert.strictEqual((await createBranch(run, 'bad name', first)).ok, false);
  assert.strictEqual((await createBranch(run, '-x', first)).ok, false);
  expectOk(await createBranch(run, 'feature/x', first));
  assert.strictEqual(git(dir, 'branch', '--show-current'), 'feature/x');
  assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), first);
});

function divergent(dir: string): string {
  commit(dir, 'a.txt', 'base', 'base');
  git(dir, 'switch', '-q', '-c', 'side');
  const side = commit(dir, 's.txt', 'side', 'side file');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'a.txt', 'main', 'main change');
  return side;
}

test('cherryPick applies a clean commit', async () => {
  const dir = initRepo();
  const side = divergent(dir);
  const { run, inProgress } = tools(dir);
  const info = expectOk(await cherryPick(run, inProgress, side));
  assert.strictEqual(info.stopped, false);
  assert.ok(existsSync(path.join(dir, 's.txt')));
});

test('a conflicting cherry-pick stops, and abort restores the tree', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'base', 'base');
  git(dir, 'switch', '-q', '-c', 'side');
  const side = commit(dir, 'a.txt', 'side', 'side change');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'a.txt', 'main', 'main change');
  const { run, inProgress } = tools(dir);

  const info = expectOk(await cherryPick(run, inProgress, side));
  assert.strictEqual(info.stopped, true);
  assert.deepStrictEqual(await inProgress(), { kind: 'cherry-pick' });

  expectOk(await resumeOperation(run, inProgress, 'abort'));
  assert.strictEqual(await inProgress(), null);
  assert.strictEqual(readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'main');
});

test('empty cherry-pick then skip', async () => {
  const dir = initRepo();
  const side = divergent(dir);
  const { run, inProgress } = tools(dir);
  expectOk(await cherryPick(run, inProgress, side));
  const again = expectOk(await cherryPick(run, inProgress, side));
  assert.strictEqual(again.stopped, true, 'the change is already applied, so git stops on an empty pick');
  expectOk(await resumeOperation(run, inProgress, 'skip'));
  assert.strictEqual(await inProgress(), null);
});

test('cherry-picking a merge commit needs a parent number', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'base', 'base');
  git(dir, 'switch', '-q', '-c', 'side');
  commit(dir, 's.txt', 's', 'side');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'm.txt', 'm', 'main');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  const merge = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'switch', '-q', '-c', 'target', 'HEAD~1');
  const { run, inProgress } = tools(dir);

  assert.strictEqual((await cherryPick(run, inProgress, merge)).ok, false);
  const info = expectOk(await cherryPick(run, inProgress, merge, 1));
  assert.strictEqual(info.stopped, false);
});

test('revert: a clean revert, then a conflicting one that can be aborted', async () => {
  const dir = initRepo();
  const first = commit(dir, 'a.txt', 'one', 'one');
  const second = commit(dir, 'a.txt', 'two', 'two');
  commit(dir, 'a.txt', 'three', 'three');
  const { run, inProgress } = tools(dir);

  const conflicted = expectOk(await revert(run, inProgress, second));
  assert.strictEqual(conflicted.stopped, true);
  expectOk(await resumeOperation(run, inProgress, 'abort'));
  assert.strictEqual(await inProgress(), null);

  writeFileSync(path.join(dir, 'b.txt'), 'b');
  git(dir, 'add', '--', 'b.txt');
  git(dir, 'commit', '-q', '-m', 'add b');
  const addB = git(dir, 'rev-parse', 'HEAD');
  const clean = expectOk(await revert(run, inProgress, addB));
  assert.strictEqual(clean.stopped, false);
  assert.ok(!existsSync(path.join(dir, 'b.txt')));
  assert.ok(first);
});

test('resumeOperation fails when nothing is in progress, and a merge cannot be skipped', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'base', 'base');
  const { run, inProgress } = tools(dir);
  assert.strictEqual((await resumeOperation(run, inProgress, 'continue')).ok, false);

  git(dir, 'switch', '-q', '-c', 'side');
  commit(dir, 'a.txt', 'side', 'side');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'a.txt', 'main', 'main');
  try { git(dir, 'merge', 'side'); } catch { /* conflict, expected */ }
  assert.deepStrictEqual(await inProgress(), { kind: 'merge' });
  assert.strictEqual((await resumeOperation(run, inProgress, 'skip')).ok, false);
  expectOk(await resumeOperation(run, inProgress, 'abort'));
});

test('reset soft keeps the index, mixed keeps the files, hard discards both', async () => {
  for (const mode of ['soft', 'mixed', 'hard'] as const) {
    const dir = initRepo();
    const c1 = commit(dir, 'a.txt', '1', 'one');
    commit(dir, 'a.txt', '2', 'two');
    expectOk(await reset(tools(dir).run, mode, c1));
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), c1, mode);
    assert.strictEqual(git(dir, 'diff', '--cached', '--name-only') !== '', mode === 'soft', `${mode}: staged`);
    assert.strictEqual(readFileSync(path.join(dir, 'a.txt'), 'utf8'), mode === 'hard' ? '1' : '2', `${mode}: file`);
  }
});

test('resetImpact counts what leaves the branch, what is left on no other ref, and tracked changes', async () => {
  const dir = initRepo();
  const c1 = commit(dir, 'a.txt', '1', 'one');
  commit(dir, 'a.txt', '2', 'two');
  const c3 = commit(dir, 'a.txt', '3', 'three');
  const { run } = tools(dir);

  assert.deepStrictEqual(expectOk(await resetImpact(run, c1)), { branch: 'main', leaving: 2, orphaned: 2, trackedChanges: 0 });

  git(dir, 'branch', 'keep', c3);
  writeFileSync(path.join(dir, 'a.txt'), 'dirty');
  writeFileSync(path.join(dir, 'untracked.txt'), 'u');
  assert.deepStrictEqual(expectOk(await resetImpact(run, c1)), { branch: 'main', leaving: 2, orphaned: 0, trackedChanges: 1 });
});
```

- [ ] **Step 2: Register the test and run it to see it fail**

Add `"src/graph/gitActions.test.ts"` to `tsconfig.json` `include` and ` out/graph/gitActions.test.js` to the `test` script.

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './gitActions'`.

- [ ] **Step 3: Implement `gitActions.ts`**

```ts
/// <reference path="./protocol.ts" />
'use strict';

import { Result } from '../worktrees';
import { RunGit } from './gitRun';

export type CheckoutTarget =
  | { kind: 'branch'; name: string }
  | { kind: 'remote'; name: string }
  | { kind: 'detach'; sha: string };

export interface StoppedInfo {
  /** True when git stopped mid-operation (conflict or empty pick) and the operation is still in progress. */
  stopped: boolean;
  message: string;
}

export interface ResetImpact {
  branch: string | null;
  /** Commits that stop being on the current branch. */
  leaving: number;
  /** Of those, commits no other branch, tag or remote ref contains. */
  orphaned: number;
  /** Tracked files with changes; `reset --hard` would overwrite them (untracked files are never touched). */
  trackedChanges: number;
}

type InProgress = () => Promise<GraphInProgress | null>;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (message: string): Result<never> => ({ ok: false, message });
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function run(git: RunGit, args: string[]): Promise<Result<void>> {
  try {
    await git(args);
    return ok(undefined);
  } catch (err) {
    return fail(messageOf(err));
  }
}

export function checkout(git: RunGit, target: CheckoutTarget): Promise<Result<void>> {
  switch (target.kind) {
    case 'branch': return run(git, ['checkout', target.name, '--']);
    case 'remote': return run(git, ['switch', '--track', target.name]);
    case 'detach': return run(git, ['checkout', '--detach', target.sha]);
  }
}

export async function createBranch(git: RunGit, name: string, sha: string): Promise<Result<void>> {
  if (!name || name.startsWith('-')) return fail(`"${name}" is not a valid branch name.`);
  try {
    await git(['check-ref-format', '--branch', name]);
  } catch {
    return fail(`"${name}" is not a valid branch name.`);
  }
  return run(git, ['switch', '-c', name, sha]);
}

/** Runs a cherry-pick/revert/continue/skip/abort. A non-zero exit with the operation still in progress is a stop, not a failure. */
async function sequencer(git: RunGit, inProgress: InProgress, args: string[]): Promise<Result<StoppedInfo>> {
  try {
    const out = await git(args);
    return ok({ stopped: false, message: out.trim() });
  } catch (err) {
    if (await inProgress()) return ok({ stopped: true, message: messageOf(err) });
    return fail(messageOf(err));
  }
}

const parentArgs = (parent?: number): string[] => (parent ? ['-m', String(parent)] : []);

export function cherryPick(git: RunGit, inProgress: InProgress, sha: string, parent?: number): Promise<Result<StoppedInfo>> {
  return sequencer(git, inProgress, ['cherry-pick', ...parentArgs(parent), sha]);
}

export function revert(git: RunGit, inProgress: InProgress, sha: string, parent?: number): Promise<Result<StoppedInfo>> {
  return sequencer(git, inProgress, ['revert', '--no-edit', ...parentArgs(parent), sha]);
}

export async function resumeOperation(
  git: RunGit,
  inProgress: InProgress,
  action: 'continue' | 'skip' | 'abort',
): Promise<Result<StoppedInfo>> {
  const operation = await inProgress();
  if (!operation) return fail('No operation is in progress.');
  if (operation.kind === 'merge' && action === 'skip') return fail('A merge cannot be skipped; continue or abort it.');
  return sequencer(git, inProgress, [operation.kind, `--${action}`]);
}

export function reset(git: RunGit, mode: 'soft' | 'mixed' | 'hard', sha: string): Promise<Result<void>> {
  return run(git, ['reset', `--${mode}`, sha, '--']);
}

async function count(git: RunGit, args: string[]): Promise<number> {
  return Number((await git(args)).trim()) || 0;
}

export async function resetImpact(git: RunGit, sha: string): Promise<Result<ResetImpact>> {
  try {
    let branch: string | null = null;
    try { branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() || null; } catch { /* detached */ }
    const leaving = await count(git, ['rev-list', '--count', 'HEAD', '--not', sha]);
    // After --not every later ref is negated; --exclude (before the glob) keeps the current branch from hiding its own commits.
    const orphaned = await count(git, [
      'rev-list', '--count', 'HEAD', '--not', sha, ...(branch ? [`--exclude=${branch}`] : []), '--branches', '--tags', '--remotes',
    ]);
    let trackedChanges = 0;
    try { trackedChanges = (await git(['diff', '--name-only', '-z', 'HEAD'])).split('\0').filter(Boolean).length; } catch { /* no commits */ }
    return ok({ branch, leaving, orphaned, trackedChanges });
  } catch (err) {
    return fail(messageOf(err));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/graph/gitActions.test.js`
Expected: 11 tests PASS. If the empty-cherry-pick test fails because git exits 0 or leaves no `CHERRY_PICK_HEAD`, check `git --version`; on a git that never stops on an empty pick, change the test to create the empty case with `git cherry-pick --keep-redundant-commits`-free flow and tell the user instead of loosening the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/graph/gitActions.ts src/graph/gitActions.test.ts tsconfig.json package.json
git commit -m "feat(null-tools): add commit graph git actions (#87)"
```

---

### Task 6: Message validation and workspace availability

**Files:**
- Create: `extensions/null-tools/src/graph/graphMessages.ts`
- Create: `extensions/null-tools/src/graph/graphMessages.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Consumes: `GraphWebviewToHost`, `GraphUnavailableReason` (protocol.ts).
- Produces: `isSha(value: unknown): value is string`; `shaFromArg(arg: unknown): string | undefined`; `parseWebviewMessage(raw: unknown): GraphWebviewToHost | undefined`; `classifyWorkspace(input: { folderScheme: string | undefined; trusted: boolean }): GraphUnavailableReason | undefined`; `unavailableText(reason: GraphUnavailableReason): string`.

- [ ] **Step 1: Write the failing test**

`src/graph/graphMessages.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { classifyWorkspace, isSha, parseWebviewMessage, shaFromArg, unavailableText } from './graphMessages';

const sha = 'a'.repeat(40);

test('isSha accepts only 40 lowercase hex characters', () => {
  assert.strictEqual(isSha(sha), true);
  for (const bad of ['', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), '--upload-pack=x', `${sha}\n`, 42, null, undefined, {}]) {
    assert.strictEqual(isSha(bad), false, String(bad));
  }
});

test('shaFromArg takes a sha string or an object carrying one (tree element, webview context)', () => {
  assert.strictEqual(shaFromArg(sha), sha);
  assert.strictEqual(shaFromArg({ sha, webviewSection: 'commit' }), sha);
  assert.strictEqual(shaFromArg({ sha: '-x' }), undefined);
  assert.strictEqual(shaFromArg(undefined), undefined);
  assert.strictEqual(shaFromArg('HEAD'), undefined);
});

test('parseWebviewMessage keeps well-formed messages and drops everything else', () => {
  assert.deepStrictEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'loadMore', extra: 1 }), { type: 'loadMore' });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'refresh' }), { type: 'refresh' });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'manageTrust' }), { type: 'manageTrust' });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'select', sha }), { type: 'select', sha });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'goto', sha }), { type: 'goto', sha });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'banner', action: 'skip' }), { type: 'banner', action: 'skip' });
  assert.deepStrictEqual(
    parseWebviewMessage({ type: 'openDiff', sha, file: 'dir/a b é.txt' }),
    { type: 'openDiff', sha, file: 'dir/a b é.txt' },
  );
  assert.deepStrictEqual(parseWebviewMessage({ type: 'openDiff', sha, file: '-dash.txt' }), { type: 'openDiff', sha, file: '-dash.txt' });

  const rejected: unknown[] = [
    null, 'ready', 42, [], {}, { type: 'nope' },
    { type: 'select', sha: '--upload-pack=x' }, { type: 'select' }, { type: 'goto', sha: 'HEAD' },
    { type: 'openDiff', sha, file: '' }, { type: 'openDiff', sha, file: 'a\0b' }, { type: 'openDiff', sha, file: 'x'.repeat(5000) },
    { type: 'openDiff', sha: 'zz', file: 'a.txt' }, { type: 'banner', action: 'nuke' },
  ];
  for (const raw of rejected) assert.strictEqual(parseWebviewMessage(raw), undefined, JSON.stringify(raw));
});

test('classifyWorkspace: no folder, remote, untrusted, otherwise available', () => {
  assert.strictEqual(classifyWorkspace({ folderScheme: undefined, trusted: true }), 'no-folder');
  assert.strictEqual(classifyWorkspace({ folderScheme: 'vscode-remote', trusted: true }), 'remote');
  assert.strictEqual(classifyWorkspace({ folderScheme: 'file', trusted: false }), 'untrusted');
  assert.strictEqual(classifyWorkspace({ folderScheme: 'file', trusted: true }), undefined);
});

test('unavailableText has a sentence for every reason', () => {
  for (const reason of ['no-folder', 'remote', 'untrusted', 'not-a-repo', 'no-git'] as const) {
    assert.ok(unavailableText(reason).length > 10, reason);
  }
});
```

- [ ] **Step 2: Register the test and run it to see it fail**

Add `"src/graph/graphMessages.test.ts"` to `tsconfig.json` `include` and ` out/graph/graphMessages.test.js` to the `test` script.

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './graphMessages'`.

- [ ] **Step 3: Implement `graphMessages.ts`**

```ts
/// <reference path="./protocol.ts" />
'use strict';

const SHA = /^[0-9a-f]{40}$/;
const MAX_PATH = 4096;

export function isSha(value: unknown): value is string {
  return typeof value === 'string' && SHA.test(value);
}

/** The sha from a command argument: a bare sha, or an object that carries one (tree element, webview context). */
export function shaFromArg(arg: unknown): string | undefined {
  if (isSha(arg)) return arg;
  if (typeof arg === 'object' && arg !== null) {
    const sha = (arg as { sha?: unknown }).sha;
    if (isSha(sha)) return sha;
  }
  return undefined;
}

/** Validates an untrusted webview message; returns a fresh object holding only the known fields. */
export function parseWebviewMessage(raw: unknown): GraphWebviewToHost | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'ready':
    case 'loadMore':
    case 'refresh':
    case 'manageTrust':
      return { type: m.type };
    case 'select':
    case 'goto':
      return isSha(m.sha) ? { type: m.type, sha: m.sha } : undefined;
    case 'openDiff':
      if (!isSha(m.sha) || typeof m.file !== 'string') return undefined;
      if (m.file.length === 0 || m.file.length > MAX_PATH || m.file.includes('\0')) return undefined;
      return { type: 'openDiff', sha: m.sha, file: m.file };
    case 'banner':
      return m.action === 'continue' || m.action === 'skip' || m.action === 'abort' ? { type: 'banner', action: m.action } : undefined;
    default:
      return undefined;
  }
}

/** Why the graph cannot run here, or undefined when it can (the repo itself is checked with git afterwards). */
export function classifyWorkspace(input: { folderScheme: string | undefined; trusted: boolean }): GraphUnavailableReason | undefined {
  if (input.folderScheme === undefined) return 'no-folder';
  if (input.folderScheme !== 'file') return 'remote';
  if (!input.trusted) return 'untrusted';
  return undefined;
}

export function unavailableText(reason: GraphUnavailableReason): string {
  switch (reason) {
    case 'no-folder': return 'Open a folder to see its commit history.';
    case 'remote': return "Commit Graph isn't available in remote windows yet.";
    case 'untrusted': return "Commit Graph doesn't run in an untrusted workspace.";
    case 'not-a-repo': return 'The open folder is not a Git repository.';
    case 'no-git': return 'Git was not found. Install Git and reload the window.';
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/graph/graphMessages.test.js`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graph/graphMessages.ts src/graph/graphMessages.test.ts tsconfig.json package.json
git commit -m "feat(null-tools): validate commit graph webview messages (#87)"
```

---

### Task 7: Webview model (virtualization and keyboard math)

**Files:**
- Create: `extensions/null-tools/src/webview/commitGraphModel.ts`
- Create: `extensions/null-tools/src/webviewCommitGraph.test.ts`
- Modify: `extensions/null-tools/tsconfig.webview-shared.json` (add the model to `include`)
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Produces (all top-level `function` declarations, no imports, so `vm` can read them off the sandbox and the webview bundle can call them): `graphRowHeight(): number`, `graphLaneCap(): number`, `graphLaneColumn(lane: number): number`, `graphHiddenLanes(laneCount: number): number`, `graphLaneColorVar(color: number): string`, `graphVisibleRange(scrollTop: number, viewportHeight: number, rowCount: number): { start: number; end: number }`, `graphMoveSelection(index: number, key: string, pageRows: number, count: number): number`, `graphScrollToReveal(scrollTop: number, viewportHeight: number, index: number): number`, `graphAnchorAfterReset(anchorSha: string | null, offset: number, rows: Array<{ sha: string }>): number | null`, `graphNeedsMore(scrollTop: number, viewportHeight: number, rowCount: number, hasMore: boolean): boolean`.

- [ ] **Step 1: Write the failing test**

`src/webviewCommitGraph.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Built by `tsc -p tsconfig.webview-shared.json`; top-level functions of the plain-script webview files land on the sandbox.
const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);
const model = sandbox as unknown as {
  graphRowHeight(): number;
  graphLaneColumn(lane: number): number;
  graphHiddenLanes(laneCount: number): number;
  graphLaneColorVar(color: number): string;
  graphVisibleRange(scrollTop: number, viewportHeight: number, rowCount: number): { start: number; end: number };
  graphMoveSelection(index: number, key: string, pageRows: number, count: number): number;
  graphScrollToReveal(scrollTop: number, viewportHeight: number, index: number): number;
  graphAnchorAfterReset(anchorSha: string | null, offset: number, rows: Array<{ sha: string }>): number | null;
  graphNeedsMore(scrollTop: number, viewportHeight: number, rowCount: number, hasMore: boolean): boolean;
};

test('rows are 24 px tall', () => {
  assert.strictEqual(model.graphRowHeight(), 24);
});

test('graphVisibleRange renders the visible rows plus 20 on each side, clamped to the list', () => {
  assert.deepStrictEqual({ ...model.graphVisibleRange(0, 240, 1000) }, { start: 0, end: 30 });
  assert.deepStrictEqual({ ...model.graphVisibleRange(2400, 240, 1000) }, { start: 80, end: 130 });
  assert.deepStrictEqual({ ...model.graphVisibleRange(0, 240, 5) }, { start: 0, end: 5 });
  assert.deepStrictEqual({ ...model.graphVisibleRange(0, 240, 0) }, { start: 0, end: 0 });
});

test('graphMoveSelection handles every navigation key and clamps at both ends', () => {
  const move = model.graphMoveSelection;
  assert.strictEqual(move(-1, 'ArrowDown', 5, 100), 0);
  assert.strictEqual(move(0, 'ArrowUp', 5, 100), 0);
  assert.strictEqual(move(10, 'ArrowDown', 5, 100), 11);
  assert.strictEqual(move(10, 'ArrowUp', 5, 100), 9);
  assert.strictEqual(move(50, 'PageDown', 9, 100), 59);
  assert.strictEqual(move(50, 'PageUp', 9, 100), 41);
  assert.strictEqual(move(95, 'PageDown', 9, 100), 99);
  assert.strictEqual(move(50, 'Home', 9, 100), 0);
  assert.strictEqual(move(50, 'End', 9, 100), 99);
  assert.strictEqual(move(99, 'ArrowDown', 5, 100), 99);
  assert.strictEqual(move(3, 'x', 5, 100), 3);
  assert.strictEqual(move(3, 'ArrowDown', 5, 0), -1);
});

test('graphScrollToReveal scrolls only as far as needed', () => {
  assert.strictEqual(model.graphScrollToReveal(0, 240, 10), 24);
  assert.strictEqual(model.graphScrollToReveal(100, 240, 0), 0);
  assert.strictEqual(model.graphScrollToReveal(0, 240, 5), 0);
});

test('graphAnchorAfterReset keeps the same commit at the same offset, else gives up', () => {
  const rows = [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }];
  assert.strictEqual(model.graphAnchorAfterReset('c', 5, rows), 53);
  assert.strictEqual(model.graphAnchorAfterReset('gone', 5, rows), null);
  assert.strictEqual(model.graphAnchorAfterReset(null, 0, rows), null);
});

test('graphNeedsMore asks when within ten rows of the end and more exists', () => {
  assert.strictEqual(model.graphNeedsMore(0, 240, 10, true), true);
  assert.strictEqual(model.graphNeedsMore(0, 240, 500, true), false);
  assert.strictEqual(model.graphNeedsMore(11000, 800, 500, true), true);
  assert.strictEqual(model.graphNeedsMore(11000, 800, 500, false), false);
});

test('lane helpers cap the drawn column, count the hidden lanes and wrap colors', () => {
  assert.strictEqual(model.graphLaneColumn(3), 3);
  assert.strictEqual(model.graphLaneColumn(15), 9);
  assert.strictEqual(model.graphHiddenLanes(10), 0);
  assert.strictEqual(model.graphHiddenLanes(12), 2);
  assert.strictEqual(model.graphLaneColorVar(0), 'var(--vscode-charts-red)');
  assert.strictEqual(model.graphLaneColorVar(6), model.graphLaneColorVar(0));
});
```

- [ ] **Step 2: Register the test and run it to see it fail**

Add `"src/webviewCommitGraph.test.ts"` to `tsconfig.json` `include` and ` out/webviewCommitGraph.test.js` to the `test` script. Add `"src/webview/commitGraphModel.ts"` to the `include` array of `tsconfig.webview-shared.json`.

Run: `npx tsc -p tsconfig.json; npx tsc -p tsconfig.webview-shared.json; node --test out/webviewCommitGraph.test.js`
Expected: FAIL — `TS6053: File … commitGraphModel.ts not found` (the model does not exist yet).

- [ ] **Step 3: Implement `src/webview/commitGraphModel.ts`**

```ts
'use strict';

// Pure helpers for the Commit Graph webview. Top-level function declarations only (no imports, no top-level
// const) so node --test can load this file through vm and the webview bundle can call them directly.

const GRAPH_PALETTE = [
  'var(--vscode-charts-red)', 'var(--vscode-charts-orange)', 'var(--vscode-charts-yellow)',
  'var(--vscode-charts-green)', 'var(--vscode-charts-blue)', 'var(--vscode-charts-purple)',
];

function graphRowHeight(): number { return 24; }
function graphLaneCap(): number { return 10; }

/** The column a lane is drawn in: lanes past the cap share the last column. */
function graphLaneColumn(lane: number): number {
  return Math.min(lane, graphLaneCap() - 1);
}

function graphHiddenLanes(laneCount: number): number {
  return Math.max(0, laneCount - graphLaneCap());
}

function graphLaneColorVar(color: number): string {
  return GRAPH_PALETTE[color % GRAPH_PALETTE.length];
}

/** Rows to render: the visible ones plus 20 on each side. */
function graphVisibleRange(scrollTop: number, viewportHeight: number, rowCount: number): { start: number; end: number } {
  const h = graphRowHeight();
  const start = Math.max(0, Math.floor(scrollTop / h) - 20);
  const end = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / h) + 20);
  return { start, end: Math.max(start, end) };
}

/** The selected index after a navigation key; -1 means nothing selected; unknown keys leave it unchanged. */
function graphMoveSelection(index: number, key: string, pageRows: number, count: number): number {
  if (count === 0) return -1;
  let next = index;
  if (key === 'ArrowDown') next = index + 1;
  else if (key === 'ArrowUp') next = index - 1;
  else if (key === 'PageDown') next = index + pageRows;
  else if (key === 'PageUp') next = index - pageRows;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = count - 1;
  else return index;
  return Math.max(0, Math.min(count - 1, next));
}

/** The scrollTop that brings row `index` fully into view with the least movement. */
function graphScrollToReveal(scrollTop: number, viewportHeight: number, index: number): number {
  const h = graphRowHeight();
  const top = index * h;
  const bottom = top + h;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return bottom - viewportHeight;
  return scrollTop;
}

/** After a reload from the top: the scrollTop that puts the anchor commit at the same offset, or null if it is gone. */
function graphAnchorAfterReset(anchorSha: string | null, offset: number, rows: Array<{ sha: string }>): number | null {
  if (anchorSha === null) return null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sha === anchorSha) return i * graphRowHeight() + offset;
  }
  return null;
}

/** True when the viewport is within ten rows of the end of the loaded rows and more exist. */
function graphNeedsMore(scrollTop: number, viewportHeight: number, rowCount: number, hasMore: boolean): boolean {
  if (!hasMore) return false;
  const h = graphRowHeight();
  return scrollTop + viewportHeight >= rowCount * h - 10 * h;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsc -p tsconfig.json && npx tsc -p tsconfig.webview-shared.json && node --test out/webviewCommitGraph.test.js`
Expected: 7 tests PASS. Also run the existing shared tests to confirm nothing collided: `node --test out/webviewShared.test.js out/webviewList.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/commitGraphModel.ts src/webviewCommitGraph.test.ts tsconfig.webview-shared.json tsconfig.json package.json
git commit -m "feat(null-tools): add the commit graph webview model (#87)"
```

---

### Task 8: Webview UI (bundle, styles, HTML shell)

**Files:**
- Create: `extensions/null-tools/src/webview/commitGraph.ts`
- Create: `extensions/null-tools/lib/commitGraph.css`
- Create: `extensions/null-tools/tsconfig.webview-commit-graph.json`
- Create: `extensions/null-tools/src/graph/commitGraphHtml.ts`
- Modify: `extensions/null-tools/package.json` (`compile` script)
- Generated and committed: `extensions/null-tools/lib/commitGraph.js`

**Interfaces:**
- Consumes: the model functions (Task 7), `reconcile` (`webview/shared/dom.ts`), `relativeTime` (`shared/time.ts`), `octicon` (`shared/octicons.ts`), protocol types (Task 1). All are globals inside the bundle.
- Produces: `getCommitGraphHtml(nonce: string, cspSource: string, scriptUri: string, styleUri: string): string`; the bundle posts `GraphWebviewToHost` messages and handles `GraphHostToWebview` messages; rows carry `data-vscode-context='{"webviewSection":"commit","sha":"<sha>","preventDefaultContextMenuItems":true}'`.

There is no unit test for the DOM code (the pure math is covered in Task 7; the end-to-end check is Task 11 and `/verify-local`). The compile is the gate here.

- [ ] **Step 1: Create the tsconfig**

`tsconfig.webview-commit-graph.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "none",
    "lib": ["ES2017", "DOM"],
    "outFile": "./lib/commitGraph.js",
    "strict": true,
    "sourceMap": false,
    "skipLibCheck": true
  },
  "include": [
    "src/graph/protocol.ts",
    "src/webview/shared/octicons.ts",
    "src/webview/shared/time.ts",
    "src/webview/shared/dom.ts",
    "src/webview/commitGraphModel.ts",
    "src/webview/commitGraph.ts"
  ]
}
```

In `package.json`, extend the `compile` script: append ` && tsc -p tsconfig.webview-commit-graph.json`.

- [ ] **Step 2: Create the HTML shell**

`src/graph/commitGraphHtml.ts`:

```ts
'use strict';

/** The whole UI is built by lib/commitGraph.js; this page only sets the CSP and loads it. */
export function getCommitGraphHtml(nonce: string, cspSource: string, scriptUri: string, styleUri: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Commit Graph</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
```

- [ ] **Step 3: Write the webview bundle**

`src/webview/commitGraph.ts` (functions such as `reconcile`, `relativeTime`, `octicon` and the `graph*` helpers come from the other files in the same bundle; only `acquireVsCodeApi` needs declaring):

```ts
'use strict';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

(function main(): void {
  const vscode = acquireVsCodeApi();
  const send = (message: GraphWebviewToHost): void => vscode.postMessage(message);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const LANE_WIDTH = 12;
  const FILE_CAP = 500;

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]));
    return node;
  }
  const isoOf = (seconds: number): string => new Date(seconds * 1000).toISOString();

  const app = document.getElementById('app') as HTMLElement;
  const banner = el('div', 'banner hidden');
  const notice = el('div', 'notice hidden');
  const list = el('div', 'list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Commits');
  list.tabIndex = 0;
  const spacer = el('div', 'spacer');
  const windowEl = el('div', 'window');
  const empty = el('div', 'empty hidden', 'No commits yet.');
  list.append(spacer, windowEl, empty);
  const detail = el('div', 'detail');
  app.append(banner, notice, list, detail);

  let rows: GraphRow[] = [];
  let hasMore = false;
  let loadingMore = false;
  let selectedSha: string | null = null;
  let detailData: GraphDetail | null = null;
  let detailFiles: GraphFile[] | null = null;
  let showAllFiles = false;
  let selectTimer: number | undefined;

  const indexOfSha = (sha: string | null): number => (sha === null ? -1 : rows.findIndex((r) => r.sha === sha));

  // ---- rows -------------------------------------------------------------------------------------------------

  function laneSvg(row: GraphRow): SVGElement {
    const columns = Math.min(row.laneCount, graphLaneCap());
    const width = columns * LANE_WIDTH + 8;
    const svg = svgEl('svg', { class: 'lanes', width, height: graphRowHeight(), 'aria-hidden': 'true' });
    const x = (lane: number): number => graphLaneColumn(lane) * LANE_WIDTH + 8;
    const mid = graphRowHeight() / 2;
    for (const e of row.edges) {
      const stroke = graphLaneColorVar(e.color);
      if (e.kind === 'pass') {
        if (e.from >= graphLaneCap()) continue;
        svg.appendChild(svgEl('line', { x1: x(e.from), y1: 0, x2: x(e.from), y2: graphRowHeight(), stroke, 'stroke-width': 2 }));
      } else if (e.kind === 'in') {
        svg.appendChild(svgEl('path', { d: `M ${x(e.from)} 0 C ${x(e.from)} 8, ${x(e.to)} 4, ${x(e.to)} ${mid}`, stroke, fill: 'none', 'stroke-width': 2 }));
      } else {
        svg.appendChild(svgEl('path', { d: `M ${x(e.from)} ${mid} C ${x(e.to)} 20, ${x(e.to)} 16, ${x(e.to)} ${graphRowHeight()}`, stroke, fill: 'none', 'stroke-width': 2 }));
      }
    }
    const merge = row.parents.length > 1;
    svg.appendChild(svgEl('circle', {
      cx: x(row.lane), cy: mid, r: 4,
      fill: merge ? 'var(--vscode-editor-background)' : graphLaneColorVar(row.lane), stroke: graphLaneColorVar(row.lane), 'stroke-width': 2,
    }));
    const hidden = graphHiddenLanes(row.laneCount);
    if (hidden > 0) {
      const label = svgEl('text', { x: width - 2, y: mid + 4, 'text-anchor': 'end', class: 'hidden-lanes' });
      label.textContent = `+${hidden}`;
      svg.appendChild(label);
    }
    return svg;
  }

  function rowElement(row: GraphRow): HTMLElement {
    const node = el('div', 'row');
    node.id = `row-${row.sha}`;
    node.dataset.sha = row.sha;
    node.setAttribute('role', 'option');
    node.setAttribute('aria-label', `${row.subject}, ${row.author}, ${relativeTime(isoOf(row.time))}`);
    node.setAttribute('data-vscode-context', JSON.stringify({ webviewSection: 'commit', sha: row.sha, preventDefaultContextMenuItems: true }));
    const line = el('div', 'line');
    for (const ref of row.refs) {
      const pill = el('span', `pill pill-${ref.kind}${ref.current ? ' current' : ''}`, ref.name);
      pill.title = `${ref.kind}: ${ref.name}`;
      line.appendChild(pill);
    }
    line.appendChild(el('span', 'subject', row.subject));
    line.appendChild(el('span', 'author', row.author));
    const when = el('span', 'when', relativeTime(isoOf(row.time)));
    when.title = new Date(row.time * 1000).toLocaleString();
    line.appendChild(when);
    node.append(laneSvg(row), line);
    return node;
  }

  function markSelection(): void {
    for (const child of Array.from(windowEl.children) as HTMLElement[]) {
      const on = child.dataset.sha === selectedSha;
      child.classList.toggle('selected', on);
      child.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    if (selectedSha) list.setAttribute('aria-activedescendant', `row-${selectedSha}`);
    else list.removeAttribute('aria-activedescendant');
  }

  function render(): void {
    const range = graphVisibleRange(list.scrollTop, list.clientHeight, rows.length);
    spacer.style.height = `${rows.length * graphRowHeight()}px`;
    windowEl.style.transform = `translateY(${range.start * graphRowHeight()}px)`;
    reconcile(windowEl, rows.slice(range.start, range.end), (r) => r.sha, rowElement);
    empty.classList.toggle('hidden', rows.length > 0);
    markSelection();
  }

  function maybeLoadMore(): void {
    if (!loadingMore && graphNeedsMore(list.scrollTop, list.clientHeight, rows.length, hasMore)) {
      loadingMore = true;
      send({ type: 'loadMore' });
    }
  }

  // ---- selection and detail ---------------------------------------------------------------------------------

  function selectSha(sha: string, reveal: boolean): void {
    selectedSha = sha;
    detailData = null;
    detailFiles = null;
    showAllFiles = false;
    const index = indexOfSha(sha);
    if (reveal && index >= 0) list.scrollTop = graphScrollToReveal(list.scrollTop, list.clientHeight, index);
    render();
    renderDetail();
    window.clearTimeout(selectTimer);
    selectTimer = window.setTimeout(() => send({ type: 'select', sha }), 100);
  }

  function renderDetail(): void {
    detail.textContent = '';
    if (!selectedSha) {
      detail.appendChild(el('div', 'placeholder', 'Select a commit to see its changes.'));
      return;
    }
    if (!detailData) {
      detail.appendChild(el('div', 'placeholder', 'Loading…'));
      return;
    }
    const d = detailData;
    const [headline, ...bodyLines] = d.message.split('\n');
    detail.appendChild(el('div', 'detail-subject', headline));
    const body = bodyLines.join('\n').trim();
    if (body) detail.appendChild(el('pre', 'detail-body', body));

    const meta = el('div', 'meta');
    meta.appendChild(el('span', '', `${d.author} <${d.authorEmail}> · ${new Date(d.authorTime * 1000).toLocaleString()}`));
    if (d.committer !== d.author || d.committerEmail !== d.authorEmail) {
      meta.appendChild(el('span', '', `committed by ${d.committer} <${d.committerEmail}>`));
    }
    const shaLine = el('span', 'sha', d.sha);
    meta.appendChild(shaLine);
    if (d.parents.length > 0) {
      const parents = el('span', 'parents', d.parents.length > 1 ? 'Parents: ' : 'Parent: ');
      for (const parent of d.parents) {
        const link = el('button', 'link', parent.slice(0, 7));
        link.addEventListener('click', () => send({ type: 'goto', sha: parent }));
        parents.appendChild(link);
      }
      meta.appendChild(parents);
    }
    detail.appendChild(meta);

    if (!detailFiles) {
      detail.appendChild(el('div', 'placeholder', 'Loading files…'));
      return;
    }
    const files = showAllFiles ? detailFiles : detailFiles.slice(0, FILE_CAP);
    const fileList = el('div', 'files');
    for (const file of files) {
      const item = el('button', `file status-${file.status}`);
      item.appendChild(el('span', 'status', file.status));
      item.appendChild(el('span', 'path', file.oldPath ? `${file.oldPath} → ${file.path}` : file.path));
      item.addEventListener('click', () => send({ type: 'openDiff', sha: d.sha, file: file.path }));
      fileList.appendChild(item);
    }
    detail.appendChild(fileList);
    if (!showAllFiles && detailFiles.length > FILE_CAP) {
      const more = el('button', 'link', `${detailFiles.length - FILE_CAP} more — show all`);
      more.addEventListener('click', () => { showAllFiles = true; renderDetail(); });
      detail.appendChild(more);
    }
    if (detailFiles.length === 0) detail.appendChild(el('div', 'placeholder', 'No file changes.'));
  }

  // ---- banner and notices -----------------------------------------------------------------------------------

  function renderBanner(inProgress: GraphInProgress | null): void {
    banner.textContent = '';
    banner.classList.toggle('hidden', inProgress === null);
    if (!inProgress) return;
    banner.appendChild(el('span', 'banner-text', `${inProgress.kind} in progress — finish or abort it before other actions.`));
    const actions: Array<'continue' | 'skip' | 'abort'> = inProgress.kind === 'merge' ? ['continue', 'abort'] : ['continue', 'skip', 'abort'];
    for (const action of actions) {
      const button = el('button', 'banner-button', action[0].toUpperCase() + action.slice(1));
      button.addEventListener('click', () => send({ type: 'banner', action }));
      banner.appendChild(button);
    }
  }

  function showNotice(message: string, retry?: 'refresh' | 'loadMore'): void {
    notice.textContent = '';
    notice.classList.remove('hidden');
    notice.appendChild(el('span', '', message));
    if (retry) {
      const button = el('button', 'banner-button', 'Retry');
      button.addEventListener('click', () => {
        notice.classList.add('hidden');
        if (retry === 'loadMore') { loadingMore = true; send({ type: 'loadMore' }); } else send({ type: 'refresh' });
      });
      notice.appendChild(button);
    }
  }

  function showUnavailable(reason: GraphUnavailableReason): void {
    app.textContent = '';
    const text: Record<GraphUnavailableReason, string> = {
      'no-folder': 'Open a folder to see its commit history.',
      remote: "Commit Graph isn't available in remote windows yet.",
      untrusted: "Commit Graph doesn't run in an untrusted workspace.",
      'not-a-repo': 'The open folder is not a Git repository.',
      'no-git': 'Git was not found. Install Git and reload the window.',
    };
    const box = el('div', 'unavailable');
    box.appendChild(el('p', '', text[reason]));
    if (reason === 'untrusted') {
      const button = el('button', 'banner-button', 'Manage Workspace Trust');
      button.addEventListener('click', () => send({ type: 'manageTrust' }));
      box.appendChild(button);
    }
    app.appendChild(box);
  }

  // ---- events -----------------------------------------------------------------------------------------------

  windowEl.addEventListener('click', (event) => {
    const row = (event.target as Element).closest('.row') as HTMLElement | null;
    if (row?.dataset.sha) { list.focus(); selectSha(row.dataset.sha, false); }
  });

  list.addEventListener('scroll', () => { render(); maybeLoadMore(); });
  window.addEventListener('resize', () => { render(); maybeLoadMore(); });

  list.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const first = detailFiles?.[0];
      if (detailData && first) send({ type: 'openDiff', sha: detailData.sha, file: first.path });
      event.preventDefault();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const page = Math.max(1, Math.floor(list.clientHeight / graphRowHeight()) - 1);
    const next = graphMoveSelection(indexOfSha(selectedSha), event.key, page, rows.length);
    if (next >= 0 && rows[next].sha !== selectedSha) selectSha(rows[next].sha, true);
  });

  window.addEventListener('message', (event) => {
    const message = event.data as GraphHostToWebview;
    switch (message.type) {
      case 'rows': {
        loadingMore = false;
        notice.classList.add('hidden');
        hasMore = message.hasMore;
        if (message.reset) {
          const first = Math.floor(list.scrollTop / graphRowHeight());
          const anchor = rows[first]?.sha ?? null;
          const offset = list.scrollTop - first * graphRowHeight();
          rows = message.rows;
          list.scrollTop = graphAnchorAfterReset(anchor, offset, rows) ?? 0;
          if (selectedSha && indexOfSha(selectedSha) < 0) { selectedSha = null; renderDetail(); }
        } else {
          rows = rows.concat(message.rows);
        }
        render();
        maybeLoadMore();
        break;
      }
      case 'focus': {
        if (indexOfSha(message.sha) >= 0) selectSha(message.sha, true);
        break;
      }
      case 'detail':
        if (message.detail.sha === selectedSha) { detailData = message.detail; renderDetail(); }
        break;
      case 'files':
        if (message.sha === selectedSha) { detailFiles = message.files; renderDetail(); }
        break;
      case 'state':
        renderBanner(message.inProgress);
        break;
      case 'loadError':
        loadingMore = false;
        showNotice(message.message, message.retry);
        break;
      case 'unavailable':
        showUnavailable(message.reason);
        break;
    }
  });

  renderDetail();
  send({ type: 'ready' });
})();
```

- [ ] **Step 4: Write the stylesheet**

`lib/commitGraph.css` (hand-written; the only hand-edited file in `lib/` for this feature):

```css
html, body { height: 100%; margin: 0; padding: 0; }
body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-size) var(--vscode-font-family); }
.hidden { display: none !important; }
#app { display: flex; flex-direction: column; height: 100vh; }
button { font: inherit; color: inherit; }

.banner, .notice { display: flex; align-items: center; gap: 8px; padding: 6px 12px; flex-shrink: 0; }
.banner { background: var(--vscode-inputValidation-warningBackground); border-bottom: 1px solid var(--vscode-inputValidation-warningBorder); }
.notice { background: var(--vscode-inputValidation-errorBackground); border-bottom: 1px solid var(--vscode-inputValidation-errorBorder); }
.banner-text { flex: 1; }
.banner-button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 0; padding: 2px 10px; cursor: pointer; }
.banner-button:hover { background: var(--vscode-button-secondaryHoverBackground); }

.list { position: relative; flex: 1 1 60%; min-height: 120px; overflow-y: auto; outline: none; }
.list:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.spacer { width: 1px; }
.window { position: absolute; top: 0; left: 0; right: 0; }
.empty, .placeholder, .unavailable { padding: 16px; color: var(--vscode-descriptionForeground); }
.unavailable { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }

.row { display: flex; align-items: center; height: 24px; cursor: default; white-space: nowrap; }
.row:hover { background: var(--vscode-list-hoverBackground); }
.row.selected { background: var(--vscode-list-inactiveSelectionBackground); }
.list:focus .row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.lanes { flex-shrink: 0; }
.hidden-lanes { font-size: 9px; fill: var(--vscode-descriptionForeground); }
.line { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; padding-right: 12px; }
.subject { overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto; min-width: 0; }
.author, .when { color: var(--vscode-descriptionForeground); flex-shrink: 0; }
.author { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }

.pill { flex-shrink: 0; border-radius: 9px; padding: 0 7px; font-size: 11px; line-height: 16px; border: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, transparent)); background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.pill-tag { background: transparent; color: var(--vscode-charts-yellow); border-color: var(--vscode-charts-yellow); }
.pill-remote { background: transparent; color: var(--vscode-descriptionForeground); border-color: var(--vscode-descriptionForeground); }
.pill-stash { background: transparent; color: var(--vscode-charts-purple); border-color: var(--vscode-charts-purple); }
.pill.current { background: var(--vscode-charts-blue); color: var(--vscode-editor-background); border-color: var(--vscode-charts-blue); font-weight: 600; }

.detail { flex: 1 1 40%; min-height: 80px; overflow-y: auto; border-top: 1px solid var(--vscode-panel-border); padding: 8px 12px; }
.detail-subject { font-weight: 600; margin-bottom: 4px; }
.detail-body { margin: 4px 0 8px; white-space: pre-wrap; font: inherit; color: var(--vscode-descriptionForeground); }
.meta { display: flex; flex-direction: column; gap: 2px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; font-size: 12px; }
.sha { font-family: var(--vscode-editor-font-family); user-select: all; }
.link { background: none; border: 0; padding: 0 4px; color: var(--vscode-textLink-foreground); cursor: pointer; font-family: var(--vscode-editor-font-family); }
.link:hover { text-decoration: underline; }
.files { display: flex; flex-direction: column; }
.file { display: flex; gap: 8px; background: none; border: 0; padding: 2px 4px; text-align: left; cursor: pointer; }
.file:hover { background: var(--vscode-list-hoverBackground); }
.file .status { width: 1.2em; text-align: center; font-weight: 600; }
.status-A .status { color: var(--vscode-gitDecoration-addedResourceForeground); }
.status-M .status { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
.status-D .status { color: var(--vscode-gitDecoration-deletedResourceForeground); }
.status-R .status, .status-C .status { color: var(--vscode-gitDecoration-renamedResourceForeground, var(--vscode-gitDecoration-modifiedResourceForeground)); }
.path { overflow: hidden; text-overflow: ellipsis; }
```

- [ ] **Step 5: Compile and check**

Run: `npm run compile`
Expected: exits 0 and writes `lib/commitGraph.js`. If TypeScript reports a duplicate global (for example two files declaring the same top-level name), rename the new `graph*` or local symbol, not the shared one. Open `lib/commitGraph.js` and confirm `acquireVsCodeApi()` appears once and no `import`/`require` is present.

- [ ] **Step 6: Commit**

```bash
git add src/webview/commitGraph.ts src/graph/commitGraphHtml.ts lib/commitGraph.css lib/commitGraph.js tsconfig.webview-commit-graph.json package.json
git commit -m "feat(null-tools): add the commit graph webview (#87)"
```

---

### Task 9: Host session and panel

**Files:**
- Create: `extensions/null-tools/src/graph/gitApi.ts`
- Create: `extensions/null-tools/src/graph/graphSession.ts`
- Create: `extensions/null-tools/src/graph/graphDiff.ts`
- Create: `extensions/null-tools/src/graph/commitGraphPanel.ts`

**Interfaces:**
- Consumes: Tasks 1–6 modules, `getCommitGraphHtml` (Task 8), `Result` from `../worktrees`.
- Produces:
  - `gitApi.ts`: `interface GitApi { repositories: Array<{ rootUri: vscode.Uri; state: { onDidChange: vscode.Event<void> } }>; onDidOpenRepository: vscode.Event<unknown>; toGitUri(uri: vscode.Uri, ref: string): vscode.Uri }`; `getGitApi(): Promise<GitApi>`; `findRepository(api, root): GitApi['repositories'][number] | undefined`.
  - `graphSession.ts`: `type Availability = { ok: true; root: string; service: GitGraphService; read: RunGit; act: RunGit } | { ok: false; reason: GraphUnavailableReason }`; `class GraphSession implements vscode.Disposable { readonly busy: BusyFlag; readonly onDidChange: vscode.Event<void>; availability(): Promise<Availability>; acquire(): vscode.Disposable; invalidate(): void; prime(): Promise<void>; checkNow(force?: boolean): Promise<void>; runAction<T>(fn: (a: ReadyAvailability) => Promise<Result<T>>, opts?: { duringOperation?: boolean }): Promise<Result<T>>; dispose(): void }` where `ReadyAvailability = Extract<Availability, { ok: true }>`. Sets context keys `null.graph.state` (`ready` or a `GraphUnavailableReason`) and `null.graph.operationInProgress`.
  - `graphDiff.ts`: `registerEmptyDocument(context): void`; `openFileDiff(root, sha, parent, file): Promise<void>`.
  - `commitGraphPanel.ts`: `class CommitGraphPanel implements vscode.Disposable { constructor(context, session); reveal(sha?: string): Promise<void>; handleRaw(raw: unknown): Promise<void>; snapshot(): { rowCount: number; headSha: string | undefined; detailSha: string | undefined; open: boolean } ; dispose(): void }`.

These files import `vscode`, so they have no `node --test` unit test (the repo convention: pure logic is tested, `vscode` glue is verified by the integration spec in Task 11). The compile is the gate.

- [ ] **Step 1: `gitApi.ts`**

```ts
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';

/** The slice of the built-in vscode.git API (v1) the graph uses. */
export interface GitApi {
  repositories: Array<{ rootUri: vscode.Uri; state: { onDidChange: vscode.Event<void> } }>;
  onDidOpenRepository: vscode.Event<unknown>;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

export async function getGitApi(): Promise<GitApi> {
  const extension = vscode.extensions.getExtension('vscode.git');
  if (!extension) throw new Error('The built-in git extension was not found.');
  const exports = extension.isActive ? extension.exports : await extension.activate();
  return exports.getAPI(1) as GitApi;
}

const same = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export function findRepository(api: GitApi, root: string): GitApi['repositories'][number] | undefined {
  return api.repositories.find((repo) => same(repo.rootUri.fsPath, root));
}
```

- [ ] **Step 2: `graphSession.ts`**

```ts
/// <reference path="./protocol.ts" />
'use strict';

import * as vscode from 'vscode';
import { Result } from '../worktrees';
import { GitGraphService, resolveRepoRoot } from './gitGraphService';
import { BusyFlag, RunGit, makeRunGit } from './gitRun';
import { findRepository, getGitApi } from './gitApi';
import { classifyWorkspace, unavailableText } from './graphMessages';

export type Availability =
  | { ok: true; root: string; service: GitGraphService; read: RunGit; act: RunGit }
  | { ok: false; reason: GraphUnavailableReason };
export type ReadyAvailability = Extract<Availability, { ok: true }>;

const CHANGE_DEBOUNCE_MS = 500;
const ACTION_TIMEOUT_MS = 120_000;

/**
 * One per window. Resolves which repo the graph shows, shares one GitGraphService between the tab and the tree,
 * detects repository changes by fingerprint (the vscode.git event only triggers a check), and serializes actions.
 */
export class GraphSession implements vscode.Disposable {
  readonly busy = new BusyFlag();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  private cached: Promise<Availability> | undefined;
  private consumers = 0;
  private watchers: vscode.Disposable[] = [];
  private lastFingerprint: string | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private readonly always: vscode.Disposable[];

  constructor() {
    this.always = [
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.invalidate()),
    ];
  }

  availability(): Promise<Availability> {
    return (this.cached ??= this.resolve());
  }

  private async resolve(): Promise<Availability> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const reason = classifyWorkspace({ folderScheme: folder?.uri.scheme, trusted: vscode.workspace.isTrusted });
    if (reason) return this.publish({ ok: false, reason });
    const found = await resolveRepoRoot(folder!.uri.fsPath);
    if (!found.ok) return this.publish({ ok: false, reason: found.reason });
    const read = makeRunGit(found.root);
    return this.publish({ ok: true, root: found.root, service: new GitGraphService(read, found.root), read, act: makeRunGit(found.root, ACTION_TIMEOUT_MS) });
  }

  private publish(availability: Availability): Availability {
    void vscode.commands.executeCommand('setContext', 'null.graph.state', availability.ok ? 'ready' : availability.reason);
    return availability;
  }

  /** Forget the resolved repo (folders, trust or `git init` changed) and tell viewers to reload. */
  invalidate(): void {
    this.cached = undefined;
    this.lastFingerprint = undefined;
    this.stopWatching();
    if (this.consumers > 0) void this.startWatching();
    this.changed.fire();
  }

  /** A viewer (tab or visible tree) registers while it is showing; the change subscription runs only while one exists. */
  acquire(): vscode.Disposable {
    if (++this.consumers === 1) void this.startWatching();
    let released = false;
    return {
      dispose: () => {
        if (released) return;
        released = true;
        if (--this.consumers === 0) this.stopWatching();
      },
    };
  }

  private async startWatching(): Promise<void> {
    try {
      const availability = await this.availability();
      const api = await getGitApi();
      if (this.consumers === 0) return;
      const trigger = () => {
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.checkNow(), CHANGE_DEBOUNCE_MS);
      };
      if (!availability.ok) {
        this.watchers.push(api.onDidOpenRepository(() => this.invalidate()));
        return;
      }
      const repo = findRepository(api, availability.root);
      this.watchers.push(repo ? repo.state.onDidChange(trigger) : api.onDidOpenRepository(trigger));
    } catch {
      // No git extension: viewers still work, they just refresh on focus and after actions.
    }
  }

  private stopWatching(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = undefined;
    for (const watcher of this.watchers.splice(0)) watcher.dispose();
  }

  private async fingerprint(): Promise<string | undefined> {
    const availability = await this.availability();
    if (!availability.ok) return undefined;
    const { hash, inProgress } = await availability.service.fingerprint();
    void vscode.commands.executeCommand('setContext', 'null.graph.operationInProgress', inProgress !== null);
    return hash;
  }

  /** Records the current fingerprint after a viewer loaded, without announcing a change. */
  async prime(): Promise<void> {
    try { this.lastFingerprint = await this.fingerprint(); } catch { /* transient git failure */ }
  }

  /** Announces a change when the fingerprint differs from the last one seen (or always with `force`). */
  async checkNow(force = false): Promise<void> {
    try {
      const hash = await this.fingerprint();
      if (hash === undefined) return;
      const changed = this.lastFingerprint !== undefined && hash !== this.lastFingerprint;
      this.lastFingerprint = hash;
      if (force || changed) this.changed.fire();
    } catch {
      // A transient failure keeps the last view; the next trigger retries.
    }
  }

  /** Runs one history-changing action: one at a time, refused during another operation unless allowed. */
  async runAction<T>(
    fn: (availability: ReadyAvailability) => Promise<Result<T>>,
    opts: { duringOperation?: boolean } = {},
  ): Promise<Result<T>> {
    const availability = await this.availability();
    if (!availability.ok) return { ok: false, message: unavailableText(availability.reason) };
    if (!opts.duringOperation) {
      const operation = await availability.service.inProgress();
      if (operation) return { ok: false, message: `A ${operation.kind} is in progress. Continue or abort it first.` };
    }
    const outcome = await this.busy.run(() => fn(availability));
    if (!outcome.ran) return { ok: false, message: 'Another Commit Graph action is still running.' };
    await this.checkNow(true);
    return outcome.value;
  }

  dispose(): void {
    this.stopWatching();
    for (const d of this.always) d.dispose();
    this.changed.dispose();
  }
}
```

- [ ] **Step 3: `graphDiff.ts`**

```ts
/// <reference path="./protocol.ts" />
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { getGitApi } from './gitApi';

const EMPTY_SCHEME = 'null-graph-empty';

/** Serves an empty document for the missing side of an added, deleted or root-commit diff. */
export function registerEmptyDocument(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(EMPTY_SCHEME, { provideTextDocumentContent: () => '' }),
  );
}

/** Opens a native diff of `file` between `parent` and `sha` (no parent = root commit). */
export async function openFileDiff(root: string, sha: string, parent: string | undefined, file: GraphFile): Promise<void> {
  const api = await getGitApi();
  const empty = vscode.Uri.from({ scheme: EMPTY_SCHEME, path: `/${file.path}` });
  const left = !parent || file.status === 'A'
    ? empty
    : api.toGitUri(vscode.Uri.file(path.join(root, file.oldPath ?? file.path)), parent);
  const right = file.status === 'D' ? empty : api.toGitUri(vscode.Uri.file(path.join(root, file.path)), sha);
  const title = `${path.basename(file.path)} (${parent ? parent.slice(0, 7) : 'empty'} ↔ ${sha.slice(0, 7)})`;
  await vscode.commands.executeCommand('vscode.diff', left, right, title);
}
```

- [ ] **Step 4: `commitGraphPanel.ts`**

```ts
/// <reference path="./protocol.ts" />
'use strict';

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { getCommitGraphHtml } from './commitGraphHtml';
import { PAGE_SIZE } from './gitGraphService';
import { GraphLayouter } from './graphLayout';
import { parseWebviewMessage } from './graphMessages';
import { openFileDiff } from './graphDiff';
import { GraphSession, ReadyAvailability } from './graphSession';

const VIEW_TYPE = 'null.commitGraph';
const STALE_AFTER_MS = 60_000;
const MAX_FOCUS_PAGES = 20;

/** Owns the single, reused Commit Graph tab. The webview renders; every decision and every git call happens here. */
export class CommitGraphPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private lease: vscode.Disposable | undefined;
  private disposables: vscode.Disposable[] = [];
  private readonly layouter = new GraphLayouter();
  private rows: GraphRow[] = [];
  private nextSkip = 0;
  private hasMore = false;
  private generation = 0;
  private loading: Promise<void> | undefined;
  private ready = false;
  private pendingFocus: string | undefined;
  private hiddenAt: number | undefined;
  private detailCache: { sha: string; parent: string | undefined; files: GraphFile[] } | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly session: GraphSession) {}

  async reveal(sha?: string): Promise<void> {
    if (sha) this.pendingFocus = sha;
    if (this.panel) {
      this.panel.reveal();
      if (sha && this.ready) await this.flushFocus();
      return;
    }
    const lib = vscode.Uri.joinPath(this.context.extensionUri, 'lib');
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Commit Graph', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [lib],
    });
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'commit-graph.svg');
    this.panel = panel;
    this.ready = false;
    const asset = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, file)).toString();
    panel.webview.html = getCommitGraphHtml(crypto.randomBytes(16).toString('base64'), panel.webview.cspSource, asset('commitGraph.js'), asset('commitGraph.css'));

    this.lease = this.session.acquire();
    this.disposables.push(
      panel.webview.onDidReceiveMessage((raw) => void this.handleRaw(raw)),
      this.session.onDidChange(() => { if (this.ready) void this.reload(); }),
      panel.onDidChangeViewState((e) => {
        if (!e.webviewPanel.visible) { this.hiddenAt = Date.now(); return; }
        if (this.hiddenAt !== undefined && Date.now() - this.hiddenAt > STALE_AFTER_MS) void this.session.checkNow();
        this.hiddenAt = undefined;
      }),
      panel.onDidDispose(() => this.closed()),
    );
  }

  dispose(): void {
    this.panel?.dispose();
    this.closed();
  }

  private closed(): void {
    this.panel = undefined;
    this.ready = false;
    this.generation++;
    this.rows = [];
    this.detailCache = undefined;
    this.lease?.dispose();
    this.lease = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
  }

  /** Test seam (`_null.graph.snapshot`): what the tab currently holds. */
  snapshot(): { open: boolean; rowCount: number; headSha: string | undefined; detailSha: string | undefined } {
    return {
      open: this.panel !== undefined,
      rowCount: this.rows.length,
      headSha: this.rows.find((r) => r.refs.some((ref) => ref.current))?.sha,
      detailSha: this.detailCache?.sha,
    };
  }

  private post(message: GraphHostToWebview): void {
    void this.panel?.webview.postMessage(message);
  }

  /** Entry point for webview messages and for the `_null.graph.dispatch` test seam; untrusted input is validated first. */
  async handleRaw(raw: unknown): Promise<void> {
    const message = parseWebviewMessage(raw);
    if (!message) return;
    switch (message.type) {
      case 'ready':
        this.ready = true;
        await this.reload();
        break;
      case 'refresh': await this.reload(); break;
      case 'loadMore': await this.loadMore(); break;
      case 'select': await this.sendDetail(message.sha); break;
      case 'goto': await this.focus(message.sha); break;
      case 'openDiff': await this.openDiff(message.sha, message.file); break;
      case 'banner': await vscode.commands.executeCommand(`null.graph.${message.action}`); break;
      case 'manageTrust': await vscode.commands.executeCommand('workbench.trust.manage'); break;
    }
  }

  private async reload(): Promise<void> {
    const generation = ++this.generation;
    const availability = await this.session.availability();
    if (!availability.ok) { this.post({ type: 'unavailable', reason: availability.reason }); return; }
    try {
      await this.session.busy.whenIdle();
      const page = await availability.service.loadPage(0, PAGE_SIZE);
      if (generation !== this.generation) return;
      this.layouter.reset();
      this.rows = this.layouter.layoutPage(page.commits);
      this.nextSkip = page.rawCount;
      this.hasMore = page.hasMore;
      this.post({ type: 'rows', rows: this.rows, hasMore: this.hasMore, reset: true });
      this.post({ type: 'state', inProgress: await availability.service.inProgress() });
      void this.session.prime();
      await this.flushFocus();
    } catch (err) {
      if (generation === this.generation) this.post({ type: 'loadError', message: errorText(err), retry: 'refresh' });
    }
  }

  private loadMore(): Promise<void> {
    return (this.loading ??= this.doLoadMore().finally(() => { this.loading = undefined; }));
  }

  private async doLoadMore(): Promise<void> {
    const generation = this.generation;
    const availability = await this.session.availability();
    if (!availability.ok || !this.hasMore) return;
    try {
      const page = await availability.service.loadPage(this.nextSkip, PAGE_SIZE);
      if (generation !== this.generation) return;
      const fresh = this.layouter.layoutPage(page.commits);
      this.rows.push(...fresh);
      this.nextSkip += page.rawCount;
      this.hasMore = page.hasMore;
      this.post({ type: 'rows', rows: fresh, hasMore: this.hasMore, reset: false });
    } catch (err) {
      if (generation === this.generation) this.post({ type: 'loadError', message: errorText(err), retry: 'loadMore' });
    }
  }

  private async flushFocus(): Promise<void> {
    const sha = this.pendingFocus;
    this.pendingFocus = undefined;
    if (sha) await this.focus(sha);
  }

  /** Loads further pages until the commit is in the list (bounded), then asks the webview to select it. */
  private async focus(sha: string): Promise<void> {
    for (let pages = 0; !this.rows.some((r) => r.sha === sha) && this.hasMore && pages < MAX_FOCUS_PAGES; pages++) {
      await this.loadMore();
    }
    if (this.rows.some((r) => r.sha === sha)) this.post({ type: 'focus', sha });
    else void vscode.window.showInformationMessage('Commit Graph: that commit is not in the loaded history.');
  }

  private async sendDetail(sha: string): Promise<void> {
    const availability = await this.session.availability();
    if (!availability.ok) return;
    try {
      const detail = await availability.service.commitDetail(sha);
      this.post({ type: 'detail', detail });
      const parent = detail.parents[0];
      const files = await availability.service.commitFiles(sha, parent);
      this.detailCache = { sha, parent, files };
      this.post({ type: 'files', sha, files });
    } catch (err) {
      void vscode.window.showErrorMessage(`Commit Graph: ${errorText(err)}`);
    }
  }

  private async openDiff(sha: string, filePath: string): Promise<void> {
    const cache = this.detailCache;
    const file = cache?.sha === sha ? cache.files.find((f) => f.path === filePath) : undefined;
    if (!cache || !file) return; // only files the host itself listed for this commit
    const availability: ReadyAvailability | undefined = await this.session.availability().then((a) => (a.ok ? a : undefined));
    if (!availability) return;
    try {
      await openFileDiff(availability.root, sha, cache.parent, file);
    } catch (err) {
      void vscode.window.showErrorMessage(`Commit Graph: ${errorText(err)}`);
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

- [ ] **Step 5: Compile**

The new files are not yet imported by `extension.ts`, so `tsc -p tsconfig.json` would skip them. Compile them explicitly to catch errors now:

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit --target ES2022 --module commonjs --lib ES2022 --strict --esModuleInterop --skipLibCheck --types node src/graph/commitGraphPanel.ts`
Expected: exits 0. (Task 10 wires them into the program so the normal compile covers them from then on.)

- [ ] **Step 6: Commit**

```bash
git add src/graph/gitApi.ts src/graph/graphSession.ts src/graph/graphDiff.ts src/graph/commitGraphPanel.ts
git commit -m "feat(null-tools): add the commit graph session and panel (#87)"
```

---

### Task 10: Tree view, commands, manifest and wiring

**Files:**
- Create: `extensions/null-tools/src/graph/graphTreeView.ts`
- Create: `extensions/null-tools/src/graph/graphCommands.ts`
- Create: `extensions/null-tools/src/graph/graphIntegration.ts`
- Create: `extensions/null-tools/media/commit-graph.svg`
- Modify: `extensions/null-tools/src/extension.ts` (import + one call next to `registerWorktreesFeature`)
- Modify: `extensions/null-tools/package.json` (contributions, launcher entry)
- Modify: `extensions/null-tools/src/featureManifests.test.ts` (expected launcher list)

**Interfaces:**
- Consumes: Task 9 classes, Task 5 actions, Task 6 `shaFromArg`.
- Produces: `registerGraphFeature(context: vscode.ExtensionContext): void`; commands `null.graph.open|refresh|checkout|createBranch|cherryPick|revert|reset.soft|reset.mixed|reset.hard|copySha|continue|skip|abort`; internal test commands `_null.graph.snapshot` and `_null.graph.dispatch`; view `null.graphView`; context keys `null.graph.state`, `null.graph.operationInProgress`.

- [ ] **Step 1: `graphTreeView.ts`**

```ts
/// <reference path="./protocol.ts" />
'use strict';

import * as vscode from 'vscode';
import { formatAge } from './gitLog';
import { GraphSession } from './graphSession';

export interface GraphTreeElement {
  sha: string;
  subject: string;
  author: string;
  time: number;
  refs: GraphRefLabel[];
}

const TREE_COMMITS = 50;

/** The first 50 commits of the shared listing, loaded only while the view is visible. */
export class GraphTreeProvider implements vscode.TreeDataProvider<GraphTreeElement>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private elements: GraphTreeElement[] = [];
  private lease: vscode.Disposable | undefined;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly session: GraphSession) {
    this.subscription = session.onDidChange(() => { if (this.lease) void this.load(); });
  }

  setVisible(visible: boolean): void {
    if (visible && !this.lease) {
      this.lease = this.session.acquire();
      void this.load();
    } else if (!visible && this.lease) {
      this.lease.dispose();
      this.lease = undefined;
    }
  }

  private async load(): Promise<void> {
    const availability = await this.session.availability();
    if (!availability.ok) {
      this.elements = [];
    } else {
      try {
        await this.session.busy.whenIdle();
        const page = await availability.service.loadPage(0, TREE_COMMITS);
        this.elements = page.commits.map((c) => ({ sha: c.sha, subject: c.subject, author: c.author, time: c.time, refs: c.refs }));
        void this.session.prime();
      } catch {
        this.elements = []; // keep the view quiet; the tab shows load errors with a retry
      }
    }
    this.emitter.fire();
  }

  getTreeItem(element: GraphTreeElement): vscode.TreeItem {
    const item = new vscode.TreeItem(element.subject, vscode.TreeItemCollapsibleState.None);
    const badges = element.refs.map((r) => r.name).join(' ');
    item.description = [element.author, formatAge(element.time, Date.now() / 1000), badges].filter(Boolean).join(' · ');
    item.tooltip = `${element.sha}\n${element.author}`;
    item.iconPath = new vscode.ThemeIcon('git-commit');
    item.contextValue = 'graphCommit';
    item.id = element.sha;
    item.command = { command: 'null.graph.open', title: 'Open Commit Graph', arguments: [element.sha] };
    return item;
  }

  getChildren(): GraphTreeElement[] {
    return this.elements;
  }

  dispose(): void {
    this.lease?.dispose();
    this.subscription.dispose();
    this.emitter.dispose();
  }
}
```

- [ ] **Step 2: `graphCommands.ts`**

```ts
/// <reference path="./protocol.ts" />
'use strict';

import * as vscode from 'vscode';
import { Result } from '../worktrees';
import {
  CheckoutTarget, StoppedInfo, checkout, cherryPick, createBranch, reset, resetImpact, resumeOperation, revert,
} from './gitActions';
import { GitGraphService } from './gitGraphService';
import { CommitGraphPanel } from './commitGraphPanel';
import { shaFromArg } from './graphMessages';
import { GraphSession } from './graphSession';

function report(result: Result<unknown>): boolean {
  if (!result.ok) void vscode.window.showErrorMessage(`Commit Graph: ${result.message}`);
  return result.ok;
}

/** A stopped cherry-pick/revert/merge/rebase is not an error: say what to do and offer the next step. */
async function reportOperation(result: Result<StoppedInfo>, label: string): Promise<void> {
  if (!report(result) || !result.ok || !result.value.stopped) return;
  const firstLine = result.value.message.split('\n').find((l) => l.trim()) ?? '';
  const choice = await vscode.window.showWarningMessage(
    `${label} stopped: ${firstLine} Resolve conflicts in the merge editor, then continue.`,
    'Continue', 'Skip', 'Abort',
  );
  if (choice) await vscode.commands.executeCommand(`null.graph.${choice.toLowerCase()}`);
}

/** For a merge commit: which parent to replay against. 0 = not a merge, null = cancelled. */
async function pickMergeParent(service: GitGraphService, sha: string, verb: string): Promise<number | null> {
  const detail = await service.commitDetail(sha);
  if (detail.parents.length < 2) return 0;
  const picked = await vscode.window.showQuickPick(
    detail.parents.map((parent, i) => ({ label: `Parent ${i + 1}`, description: parent.slice(0, 7), number: i + 1 })),
    { placeHolder: `${sha.slice(0, 7)} is a merge commit. ${verb} relative to which parent?` },
  );
  return picked ? picked.number : null;
}

async function checkoutFlow(session: GraphSession, sha: string): Promise<void> {
  const availability = await session.availability();
  if (!availability.ok) return;
  const refs = (await availability.service.refs()).filter((r) => r.sha === sha);
  type Item = vscode.QuickPickItem & { target: CheckoutTarget };
  const items: Item[] = [
    ...refs.filter((r) => r.kind === 'branch').map((r): Item => ({ label: r.name, description: 'branch', target: { kind: 'branch', name: r.name } })),
    ...refs.filter((r) => r.kind === 'remote').map((r): Item => ({ label: r.name, description: 'remote branch — creates a tracking branch', target: { kind: 'remote', name: r.name } })),
    ...refs.filter((r) => r.kind === 'tag').map((r): Item => ({ label: r.name, description: 'tag — detached HEAD', target: { kind: 'detach', sha } })),
  ];
  let target: CheckoutTarget;
  if (items.length === 1 && items[0].target.kind !== 'detach') {
    target = items[0].target;
  } else {
    items.push({ label: `Detached HEAD at ${sha.slice(0, 7)}`, target: { kind: 'detach', sha } });
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Check out…' });
    if (!picked) return;
    target = picked.target;
  }
  if (target.kind === 'detach') {
    const choice = await vscode.window.showWarningMessage(
      'This detaches HEAD: commits made here belong to no branch until you create one.', 'Detach HEAD',
    );
    if (choice !== 'Detach HEAD') return;
  }
  report(await session.runAction((a) => checkout(a.act, target)));
}

async function createBranchFlow(session: GraphSession, sha: string): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: `New branch at ${sha.slice(0, 7)}`,
    validateInput: (value) => (!value || value.startsWith('-') || /\s/.test(value) ? 'Enter a valid branch name (no spaces)' : undefined),
  });
  if (name) report(await session.runAction((a) => createBranch(a.act, name, sha)));
}

async function replayFlow(session: GraphSession, sha: string, kind: 'cherry-pick' | 'revert'): Promise<void> {
  const availability = await session.availability();
  if (!availability.ok) return;
  const parent = await pickMergeParent(availability.service, sha, kind === 'revert' ? 'Revert' : 'Cherry-pick');
  if (parent === null) return;
  const result = await session.runAction((a) => {
    const inProgress = () => a.service.inProgress();
    const number = parent || undefined;
    return kind === 'revert' ? revert(a.act, inProgress, sha, number) : cherryPick(a.act, inProgress, sha, number);
  });
  await reportOperation(result, kind === 'revert' ? 'Revert' : 'Cherry-pick');
}

async function resetFlow(session: GraphSession, sha: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
  const availability = await session.availability();
  if (!availability.ok) return;
  const impact = await resetImpact(availability.read, sha);
  if (!report(impact) || !impact.ok) return;
  const { branch, leaving, orphaned, trackedChanges } = impact.value;
  const where = branch ?? 'the detached HEAD';
  const lines = [leaving === 0 ? `No commits leave ${where}.` : `${leaving} commit${leaving === 1 ? '' : 's'} will no longer be on ${where}.`];
  if (orphaned > 0) {
    lines.push(`${orphaned} of them ${orphaned === 1 ? 'is' : 'are'} on no other branch or tag${mode === 'hard' ? ' and can only be recovered through the reflog afterwards' : ''}.`);
  }
  if (mode === 'soft') lines.push('Changes stay staged.');
  if (mode === 'mixed') lines.push('Changes stay in your working tree, unstaged.');
  const button = `Reset (${mode})`;
  const choice = await vscode.window.showWarningMessage(`Reset ${where} (${mode}) to ${sha.slice(0, 7)}?`, { modal: true, detail: lines.join('\n') }, button);
  if (choice !== button) return;
  if (mode === 'hard' && trackedChanges > 0) {
    const discard = 'Discard changes and reset';
    const again = await vscode.window.showWarningMessage(
      `${trackedChanges} modified file${trackedChanges === 1 ? '' : 's'} will be overwritten and lost.`,
      { modal: true, detail: 'A hard reset replaces the working tree with the target commit.' }, discard,
    );
    if (again !== discard) return;
  }
  report(await session.runAction((a) => reset(a.act, mode, sha)));
}

export function registerGraphCommands(context: vscode.ExtensionContext, session: GraphSession, panel: CommitGraphPanel): void {
  const register = (id: string, handler: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  const withSha = (fn: (sha: string) => Promise<void>) => async (arg?: unknown) => {
    const sha = shaFromArg(arg);
    if (sha) await fn(sha);
  };

  register('null.graph.open', (arg?: unknown) => panel.reveal(shaFromArg(arg)));
  register('null.graph.refresh', () => session.invalidate());
  register('null.graph.copySha', withSha(async (sha) => { await vscode.env.clipboard.writeText(sha); }));
  register('null.graph.checkout', withSha((sha) => checkoutFlow(session, sha)));
  register('null.graph.createBranch', withSha((sha) => createBranchFlow(session, sha)));
  register('null.graph.cherryPick', withSha((sha) => replayFlow(session, sha, 'cherry-pick')));
  register('null.graph.revert', withSha((sha) => replayFlow(session, sha, 'revert')));
  for (const mode of ['soft', 'mixed', 'hard'] as const) {
    register(`null.graph.reset.${mode}`, withSha((sha) => resetFlow(session, sha, mode)));
  }
  for (const action of ['continue', 'skip', 'abort'] as const) {
    register(`null.graph.${action}`, async () => {
      const result = await session.runAction((a) => resumeOperation(a.act, () => a.service.inProgress(), action), { duringOperation: true });
      await reportOperation(result, 'Operation');
    });
  }

  // Internal seams for the integration spec; they run the same code paths as the webview.
  register('_null.graph.snapshot', () => panel.snapshot());
  register('_null.graph.dispatch', (raw: unknown) => panel.handleRaw(raw));
}
```

- [ ] **Step 3: `graphIntegration.ts`**

```ts
'use strict';

import * as vscode from 'vscode';
import { CommitGraphPanel } from './commitGraphPanel';
import { registerGraphCommands } from './graphCommands';
import { registerEmptyDocument } from './graphDiff';
import { GraphSession } from './graphSession';
import { GraphTreeProvider } from './graphTreeView';

/** Registration only: nothing spawns git until the tab or the tree is shown. */
export function registerGraphFeature(context: vscode.ExtensionContext): void {
  const session = new GraphSession();
  const panel = new CommitGraphPanel(context, session);
  const tree = new GraphTreeProvider(session);
  const view = vscode.window.createTreeView('null.graphView', { treeDataProvider: tree });
  view.onDidChangeVisibility((e) => tree.setVisible(e.visible), undefined, context.subscriptions);
  tree.setVisible(view.visible);

  registerEmptyDocument(context);
  registerGraphCommands(context, session, panel);
  context.subscriptions.push(session, panel, tree, view);
}
```

- [ ] **Step 4: Icon**

`media/commit-graph.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="8" r="1.5"/><path d="M4 4.5v7M5.5 8h5"/></svg>
```

- [ ] **Step 5: Wire into `extension.ts`**

Add next to the worktrees import: `import { registerGraphFeature } from './graph/graphIntegration';`, and next to `registerWorktreesFeature(context);` (line ~150) add `registerGraphFeature(context);`.

- [ ] **Step 6: Manifest (`package.json`)**

Make these edits (keep existing entries; add, do not replace):

1. Top-level `nullWorkspace.features`: add after the `issues` entry
   `{ "id": "graph", "label": "Commit Graph", "category": "develop", "icon": "git-commit", "command": "null.graph.open", "description": "Browse and act on git history", "order": 30 }`.
2. `contributes.viewsContainers.activitybar`: add `{ "id": "null-graph", "title": "Commit Graph", "icon": "media/commit-graph.svg" }`.
3. `contributes.views`: add `"null-graph": [ { "id": "null.graphView", "name": "Recent Commits" } ]`.
4. `contributes.viewsWelcome` (new array):

```json
[
  { "view": "null.graphView", "contents": "The open folder is not a Git repository.\n[Initialize Repository](command:git.init)", "when": "null.graph.state == not-a-repo" },
  { "view": "null.graphView", "contents": "Git was not found. Install Git and reload the window.", "when": "null.graph.state == no-git" },
  { "view": "null.graphView", "contents": "Commit Graph isn't available in remote windows yet.", "when": "null.graph.state == remote" },
  { "view": "null.graphView", "contents": "Commit Graph doesn't run in an untrusted workspace.\n[Manage Workspace Trust](command:workbench.trust.manage)", "when": "null.graph.state == untrusted" },
  { "view": "null.graphView", "contents": "Open a folder to see its commit history.\n[Open Folder](command:workbench.action.files.openFolder)", "when": "null.graph.state == no-folder" }
]
```

5. `contributes.commands`: add

```json
{ "command": "null.graph.open", "title": "Null: Open Commit Graph", "icon": "$(git-commit)" },
{ "command": "null.graph.refresh", "title": "Null: Refresh Commit Graph", "icon": "$(refresh)" },
{ "command": "null.graph.checkout", "title": "Checkout…" },
{ "command": "null.graph.createBranch", "title": "Create Branch Here…" },
{ "command": "null.graph.cherryPick", "title": "Cherry-pick" },
{ "command": "null.graph.revert", "title": "Revert" },
{ "command": "null.graph.reset.soft", "title": "Reset (soft)…" },
{ "command": "null.graph.reset.mixed", "title": "Reset (mixed)…" },
{ "command": "null.graph.reset.hard", "title": "Reset (hard)…" },
{ "command": "null.graph.copySha", "title": "Copy SHA" },
{ "command": "null.graph.continue", "title": "Null: Continue Git Operation" },
{ "command": "null.graph.skip", "title": "Null: Skip Git Operation Step" },
{ "command": "null.graph.abort", "title": "Null: Abort Git Operation" }
```

6. `contributes.submenus` (new array): `[ { "id": "null.graph.resetMenu", "label": "Reset Current Branch To Here" } ]`.
7. `contributes.menus`:
   - `view/title`: `{ "command": "null.graph.open", "when": "view == null.graphView", "group": "navigation@1" }` and `{ "command": "null.graph.refresh", "when": "view == null.graphView", "group": "navigation@2" }`.
   - `view/item/context` and `webview/context` (the same entries, different `when` prefix). With `T` = `view == null.graphView && viewItem == graphCommit` for the tree and `W` = `webviewId == 'null.commitGraph' && webviewSection == 'commit'` for the tab, add:

```json
{ "command": "null.graph.checkout",     "when": "T && !null.graph.operationInProgress", "group": "1_ops@1" },
{ "command": "null.graph.createBranch", "when": "T && !null.graph.operationInProgress", "group": "1_ops@2" },
{ "command": "null.graph.cherryPick",   "when": "T && !null.graph.operationInProgress", "group": "2_edit@1" },
{ "command": "null.graph.revert",       "when": "T && !null.graph.operationInProgress", "group": "2_edit@2" },
{ "submenu": "null.graph.resetMenu",    "when": "T && !null.graph.operationInProgress", "group": "2_edit@3" },
{ "command": "null.graph.copySha",      "when": "T", "group": "3_copy@1" }
```

   (write each entry twice, once with `T` expanded and once with `W` expanded).
   - `null.graph.resetMenu`: `[ { "command": "null.graph.reset.soft", "group": "1@1" }, { "command": "null.graph.reset.mixed", "group": "1@2" }, { "command": "null.graph.reset.hard", "group": "1@3" } ]`.
   - `commandPalette`: hide the commands that need a sha: `{ "command": "<id>", "when": "false" }` for `checkout`, `createBranch`, `cherryPick`, `revert`, `reset.soft`, `reset.mixed`, `reset.hard`, `copySha`; and `{ "command": "null.graph.continue|skip|abort", "when": "null.graph.operationInProgress" }`.

- [ ] **Step 7: Update the launcher test**

In `src/featureManifests.test.ts`, the expected `develop` list becomes `['Dashboard', 'GitHub Issues', 'Commit Graph', 'Music Player']`.

- [ ] **Step 8: Compile and run the whole unit suite**

Run: `npm test`
Expected: compile clean (the new host files are now in the program through `extension.ts`), all tests PASS, including `featureManifests.test.js`'s "every launcher command is declared" check for `null.graph.open`.

Also validate the manifest parses: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` → no output.

- [ ] **Step 9: Commit**

```bash
git add src/graph/graphTreeView.ts src/graph/graphCommands.ts src/graph/graphIntegration.ts media/commit-graph.svg src/extension.ts package.json src/featureManifests.test.ts
git commit -m "feat(null-tools): register the commit graph view, commands and launcher entry (#87)"
```

---

### Task 11: Integration spec

**Files:**
- Create: `extensions/null-tools/src/test/suite/graph.spec.ts`
- Modify: `extensions/null-tools/tsconfig.json` (include `src/test/suite/graph.spec.ts`)

**Interfaces:**
- Consumes: commands `null.graph.open`, `_null.graph.snapshot`, `_null.graph.dispatch`, `git.openRepository`.

The runner (`runTest.ts`) opens an empty temp folder as the workspace, in a vanilla VS Code with trust disabled. The spec turns that folder into a fixture repo.

- [ ] **Step 1: Write the spec**

```ts
'use strict';

import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface Snapshot { open: boolean; rowCount: number; headSha: string | undefined; detailSha: string | undefined }

async function waitFor<T>(read: () => Thenable<T>, done: (value: T) => boolean, what: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

suite('null-tools commit graph', () => {
  test('opens on a fixture repo, loads its commits with the HEAD marker, and opens a diff for a changed file', async function () {
    this.timeout(60_000);
    const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: folder, encoding: 'utf8' }).trim();
    git('init', '-q', '--initial-branch=main');
    git('config', 'user.email', 'spec@example.com');
    git('config', 'user.name', 'Spec');
    git('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(folder, 'a.txt'), 'one');
    git('add', '--', 'a.txt');
    git('commit', '-q', '-m', 'first');
    fs.writeFileSync(path.join(folder, 'a.txt'), 'two');
    fs.writeFileSync(path.join(folder, 'b.txt'), 'b');
    git('add', '-A');
    git('commit', '-q', '-m', 'second');
    const head = git('rev-parse', 'HEAD');

    await vscode.extensions.getExtension('null.null-tools')!.activate();
    await vscode.commands.executeCommand('git.openRepository', folder);
    await vscode.commands.executeCommand('null.graph.open');

    const loaded = await waitFor(
      () => vscode.commands.executeCommand<Snapshot>('_null.graph.snapshot'),
      (s) => s.rowCount >= 2,
      'the first rows message',
    );
    assert.strictEqual(loaded.rowCount, 2);
    assert.strictEqual(loaded.headSha, head, 'the checked-out branch is marked on the HEAD commit');

    await vscode.commands.executeCommand('_null.graph.dispatch', { type: 'select', sha: head });
    await waitFor(
      () => vscode.commands.executeCommand<Snapshot>('_null.graph.snapshot'),
      (s) => s.detailSha === head,
      'the commit file list',
    );

    await vscode.commands.executeCommand('_null.graph.dispatch', { type: 'openDiff', sha: head, file: 'b.txt' });
    await waitFor(
      async () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => t.input instanceof vscode.TabInputTextDiff),
      (found) => found,
      'a diff editor',
    );
  });

  test('a message the host did not list is ignored instead of opening anything', async function () {
    this.timeout(20_000);
    const before = vscode.window.tabGroups.all.flatMap((g) => g.tabs).length;
    await vscode.commands.executeCommand('_null.graph.dispatch', { type: 'openDiff', sha: 'f'.repeat(40), file: 'not-listed.txt' });
    await vscode.commands.executeCommand('_null.graph.dispatch', { type: 'select', sha: '--upload-pack=x' });
    assert.strictEqual(vscode.window.tabGroups.all.flatMap((g) => g.tabs).length, before);
  });
});
```

- [ ] **Step 2: Register and compile**

Add `"src/test/suite/graph.spec.ts"` to the `include` of `tsconfig.json`.

Run: `npm run compile`
Expected: exits 0.

- [ ] **Step 3: Run the integration suite against the synced install**

This needs a Null IDE install and `scripts/sync-local.ps1` (see the `/verify-local` skill). Run: `/verify-local null-tools` (it syncs, then runs `npm run test:integration`).
Expected: `activation.spec.ts` and both `graph.spec.ts` tests pass. If the diff tab never appears, check in order: `git.openRepository` resolved (the git extension must know the repo before `git:` URIs resolve), the `select` dispatch produced a non-empty `detailSha`, then the `_null.graph.dispatch` command registration. Do not weaken the assertions.

- [ ] **Step 4: Commit**

```bash
git add src/test/suite/graph.spec.ts tsconfig.json
git commit -m "test(null-tools): add the commit graph integration spec (#87)"
```

---

### Task 12: Docs, spec reconciliation, compiled output, manual verification

**Files:**
- Modify: `d:\Coding\Apps\null-ide\CLAUDE.md` (null-tools feature table row)
- Modify: `docs/specs/commit-graph-design.md` (reconcile with what was built)
- Modify: `docs/ROADMAP.md` only if it lists the commit graph
- Generated: `extensions/null-tools/out/**`, `extensions/null-tools/lib/commitGraph.js`

- [ ] **Step 1: Add the feature row to `CLAUDE.md`**

In the `### null-tools` table, add this row after **Null Workspace hub**:

```
| **Commit graph** | `src/graph/` (#87): lane-drawn history in one reused tab (`null.graph.open`, `null.commitGraph`) and an activity-bar list (`null.graphView`, container `null-graph`, first 50 commits). Acts on the first folder's own worktree (`git rev-parse --show-toplevel`), never the main worktree; nothing runs in remote windows or untrusted workspaces (welcome states via the `null.graph.state` context key). The host owns everything: pure `gitLog.ts` / `graphLayout.ts` / `graphMessages.ts`, `gitGraphService.ts` (paging with `--date-order` over `--branches --tags --remotes HEAD` plus stash SHAs, fingerprint, detail, files), `gitActions.ts` (`Result<T>`; cherry-pick/revert/continue/skip/abort, reset with impact counts), `gitRun.ts` (the only `execFile`: `GIT_OPTIONAL_LOCKS=0`, `GIT_EDITOR=true`, `BusyFlag`), `graphSession.ts` (shared service; the `vscode.git` change event only triggers a fingerprint check; runs actions one at a time). Only `graphSession`, `commitGraphPanel`, `graphTreeView`, `graphCommands`, `graphDiff`, `gitApi` and `graphIntegration` import `vscode`. Webview (`src/webview/commitGraph.ts`, `module: none`, compiled by `tsconfig.webview-commit-graph.json` into the tracked `lib/commitGraph.js`; `lib/commitGraph.css` is hand-written); its pure math is `commitGraphModel.ts`, loaded by tests through `webview-shared.js`. Context menus use `data-vscode-context` + `webview/context`, so one `null.graph.*` command set serves tab and tree; the key `null.graph.operationInProgress` disables them and a banner offers Continue/Skip/Abort. Internal test seams: `_null.graph.snapshot`, `_null.graph.dispatch`. Design `docs/specs/commit-graph-design.md`; plan `docs/plans/commit-graph.md`. Integration spec: `npm run test:integration` (via `/verify-local null-tools`) |
```

- [ ] **Step 2: Reconcile the spec with the build**

Edit `docs/specs/commit-graph-design.md` so it matches what the plan builds (these are refinements found while planning; keep the rest unchanged):
- **Untrusted workspaces:** replace "declared unsupported via `capabilities.untrustedWorkspaces`" with "checked at runtime (`workspace.isTrusted`, re-evaluated on `onDidGrantWorkspaceTrust`); the manifest capability is per extension and would disable all of `null-tools`".
- **File table:** add `protocol.ts` (shared message and row types, a global script), `graphSession.ts` (repo resolution, shared service, fingerprint watching, action serialization), `graphCommands.ts` (command handlers and prompts), `graphDiff.ts` (diff URIs and the empty document), `gitApi.ts`, `commitGraphHtml.ts`.
- **`gitLog.ts` command:** drop `--parents` (`%P` already carries the parents) and add `--decorate=full` (needed to tell local branches from remotes in `%D`).
- **Messages:** host to webview gains `focus`, `loadError`, `unavailable` and loses `refs`; `files` is `{sha, files}` (the 500-file cap is applied in the webview); webview to host gains `goto`, `banner`, `manageTrust`.
- **Diff:** the empty document is also used for the missing side of added and deleted files.
- **Service API:** `fingerprint()` returns `{ hash, inProgress }`; add `inProgress()` and `commitDetail(sha)`.
- **Testing:** list the internal commands `_null.graph.snapshot` and `_null.graph.dispatch` the integration spec uses.

- [ ] **Step 3: ROADMAP**

Run: `grep -n -i "graph" docs/ROADMAP.md`
If the commit graph is listed, mark it done with a link to the design and plan; if nothing matches, leave the file alone.

- [ ] **Step 4: Full verification before claiming done**

Run, from `extensions/null-tools`: `npm run compile && npm test`
Expected: compile clean, every test passes, including the 7 new test files.

Then run `/verify-local null-tools`. Expected: integration specs pass.

Manual check in the synced Null IDE (the spec's "done" bar; report each as observed, not assumed):
1. Open a repo, click the Commit Graph activity-bar icon: the list shows the last 50 commits; click one: the tab opens with that commit selected.
2. Scroll to the bottom of a repo with more than 500 commits: the next page loads and the lanes continue without a seam.
3. Select a commit, click a changed file: a native diff opens. Try the root commit and a merge commit.
4. Right-click a commit: Cherry-pick one onto another branch; make a conflicting one: the banner appears with Continue/Skip/Abort, the menu items are disabled, Abort restores the tree.
5. Open a folder that is not a repo, an untrusted folder, and a remote window (if available): the tree shows the matching welcome text and no `git` process is spawned.

- [ ] **Step 5: Refresh compiled output and commit**

```bash
git add ../../CLAUDE.md ../../docs/specs/commit-graph-design.md ../../docs/ROADMAP.md
git commit -m "docs: document the commit graph and reconcile its spec (#87)"
git add out lib
git commit -m "chore: refresh null-tools compiled output"
```

(`git add ../../docs/ROADMAP.md` is a no-op when the file was not changed.)

- [ ] **Step 6: Update the knowledge graph**

Run: `graphify update .` (from the repo root) as the repo's CLAUDE.md asks after code changes. Do not commit `graphify-out/` unless it is already tracked.

---

## Self-review notes (already applied)

- **Spec coverage:** goal/scope (Tasks 8–10), architecture files (Tasks 1–10; the extra files `protocol.ts`, `graphSession.ts`, `graphCommands.ts`, `graphDiff.ts`, `gitApi.ts`, `commitGraphHtml.ts` are reconciled into the spec in Task 12), data and layout incl. stash/date-order/explicit refs/fingerprint/anchor (Tasks 2–4, 8, 9), panel/webview incl. virtualization, lane cap, detail pane, banner, accessibility (Tasks 7–9), validation (Task 6), actions and safety table (Task 5, 10), activity-bar entry, launcher, welcome states (Task 10), errors (Tasks 4, 8, 9), testing and "done means" (Tasks 11, 12).
- **Spec deviations the user should know about** (all listed in Task 12 Step 2): untrusted handling is a runtime check, not a manifest capability; `--parents` dropped and `--decorate=full` added; webview applies the 500-file cap; a few extra messages; empty document also for added/deleted files.
- **Types:** `Availability`/`ReadyAvailability` (`root`, `service`, `read`, `act`), `StoppedInfo`, `ResetImpact`, `CheckoutTarget`, `LogPage`, `RefInfo` and every `graph*` model function name are used identically across tasks.

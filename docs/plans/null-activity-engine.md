# Null Activity Engine Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Add a built-in extension `null-activity` that tracks coding activity locally (active time, projects, languages, files, sessions) into an append-only interval log, with privacy controls, a public API and a status-bar readout.

**Architecture:** Pure classes (`Tracker`, `IntervalStore`, `stats`, `projectIdentity`, `ActivityService`, `privacy`) with injected clocks and directories so `node --test` covers them without VS Code. Only `heartbeatSource.ts`, `statusBar.ts`, `commands.ts` and `extension.ts` import `vscode`. Every statistic is derived from JSONL interval files under `globalStorageUri`.

**Tech Stack:** TypeScript (commonjs, ES2022, strict), Node `fs`/`crypto`/`path`, `node --test` over compiled `out/test/*.test.js`, `@vscode/test-electron` + Mocha for the one integration spec. No runtime dependencies.

**Spec:** [docs/specs/null-activity-engine-design.md](../specs/null-activity-engine-design.md)

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

- All work is under `extensions/null-activity/`, plus `.github/workflows/build.yml`, `scripts/sync-local.ps1`, `scripts/build-local.ps1`, `CLAUDE.md` and this plan. Do not stage the unrelated pre-existing change to `extensions/null-music/media/music.svg`.
- Engine only: no dashboard UI, git statistics, badge, Gist publishing, WakaTime import or cloud sync.
- No SQLite, no native module, no runtime dependencies, no network code. Only `devDependencies` are added.
- Settings: `null-activity.enabled` (default `true`), `null-activity.idleTimeout` (seconds, default 120), `null-activity.sessionGap` (minutes, default 15). No other configuration.
- Storage: one JSON object per line in `intervals-YYYY-MM-<windowId>.jsonl` under `context.globalStorageUri`; month of `start`, local time; intervals crossing a month end are split.
- Week starts Monday; day boundaries use local time. Workspace-less windows use project key `"(no folder)"`.
- Not stored: file contents, diffs, source text. Files are workspace-relative paths only (basename when outside the workspace).
- `out/` is tracked: never hand-edit it; after editing `src/`, run `npm run compile` and commit the refreshed `out/` in a separate `chore: refresh null-activity compiled output` commit.
- A new `*.test.ts` is silently skipped until its `out/test/<name>.test.js` is added to the `test` script in `package.json`.
- Commits: new commits only, never amend, never `--no-verify`, never push. End each commit message with the `Co-Authored-By` trailer the session specifies.
- Do not run `scripts/build-local.ps1`. Full builds run in CI.

## Review Focus

Failure modes the spec implies but the happy-path tests would miss, most likely first. Each has a test in the task that owns the code.

1. **Sleep/wake or clock jump with the window focused** — the first heartbeat after hours of sleep must not credit the gap; a backwards clock never yields negative or inflated time. (Task 2, `tracker.test.ts`)
2. **Work crossing local midnight, a week boundary, a month end or a DST change** — daily/weekly/monthly buckets split the interval and the pieces sum to the original. (Task 3 `stats.test.ts`, Task 4 `intervalStore.test.ts`)
3. **Deleting a range while an interval is open** — the open interval must not reappear after deletion. (Task 6, `activityService.test.ts`)
4. **Hand-edited nonsense settings** (`0`, negative, `NaN`, a string, a huge number) — clamped to sane values, never a zero idle timeout. (Task 6, `activityService.test.ts`)
5. **Unwritable or corrupt storage** — storage dir is a file, a torn last line, a garbage file: tracking continues in memory, nothing throws, other files still load, the write retries later. (Task 4, `intervalStore.test.ts`)

---

### Task 1: Scaffold the extension and wire it into CI and local sync

**Files:**
- Create: `extensions/null-activity/package.json`, `extensions/null-activity/tsconfig.json`, `extensions/null-activity/src/extension.ts`, `extensions/null-activity/src/emitter.ts`, `extensions/null-activity/src/types.ts`, `extensions/null-activity/package-lock.json` (generated)
- Modify: `.github/workflows/build.yml:158-176`, `scripts/sync-local.ps1:274-283`, `scripts/build-local.ps1:361,378`

**Interfaces:**
- Produces: `types.ts` exports `ProjectRef`, `ResolvedProject`, `Interval`, `Heartbeat`, `DateRange`, `ProjectStat`, `LanguageStat`, `DailyStat`, `Session`, `NullActivityApi`; `emitter.ts` exports `Disposable`, `Event<T>`, `Emitter<T>`.

- [ ] **Step 1: Create `extensions/null-activity/package.json`**

```json
{
  "name": "null-activity",
  "displayName": "Null Activity",
  "description": "Private, local-only coding activity tracking for Null IDE — active time, projects, languages and sessions",
  "version": "1.0.0",
  "publisher": "null",
  "license": "MIT",
  "engines": { "vscode": "^1.93.0" },
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "null-activity.showTrackedData", "title": "Null Activity: Show Tracked Data" },
      { "command": "null-activity.deleteRange", "title": "Null Activity: Delete Tracked Data for a Range…" },
      { "command": "null-activity.deleteAll", "title": "Null Activity: Delete All Tracked Data…" }
    ],
    "configuration": {
      "title": "Null Activity",
      "properties": {
        "null-activity.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Track coding activity locally. Turning this off stops collection immediately; existing data stays until you delete it."
        },
        "null-activity.idleTimeout": {
          "type": "number",
          "default": 120,
          "minimum": 10,
          "maximum": 3600,
          "description": "Seconds without interaction before time stops counting."
        },
        "null-activity.sessionGap": {
          "type": "number",
          "default": 15,
          "minimum": 1,
          "maximum": 1440,
          "description": "Minutes of inactivity that end a session."
        }
      }
    }
  },
  "scripts": {
    "compile": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "@types/vscode": "^1.93.0",
    "@types/node": "^22.0.0",
    "@vscode/test-electron": "^3.1.0",
    "mocha": "^11.8.0",
    "@types/mocha": "^10.0.10",
    "glob": "^13.0.6"
  }
}
```

(`test` and the integration scripts are added in Tasks 2 and 9.)

- [ ] **Step 2: Create `extensions/null-activity/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./out",
    "rootDir": "./src",
    "strict": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `src/emitter.ts`**

```ts
'use strict';

export interface Disposable {
  dispose(): void;
}

export type Event<T> = (listener: (e: T) => void) => Disposable;

export class Emitter<T> {
  private readonly listeners = new Set<(e: T) => void>();

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  };

  fire(e: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(e);
      } catch (err) {
        console.error('Null Activity: listener failed', err);
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
```

- [ ] **Step 4: Create `src/types.ts`**

```ts
'use strict';

import { Event } from './emitter';

export interface ProjectRef {
  key: string;
  name: string;
}

export interface ResolvedProject extends ProjectRef {
  branch?: string;
}

export interface Interval {
  start: number; // epoch ms
  end: number; // epoch ms, > start
  project: ProjectRef;
  language: string; // languageId, '' for terminal/unknown
  file?: string; // workspace-relative path
  branch?: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface Heartbeat {
  ts: number;
  file?: string;
  language: string;
  workspace?: string; // workspace folder fsPath
  isWrite: boolean;
  linesAdded: number;
  linesRemoved: number;
}

/** Half-open, epoch ms. */
export interface DateRange {
  from: number;
  to: number;
}

export interface ProjectStat {
  project: ProjectRef;
  ms: number;
  files: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface LanguageStat {
  language: string;
  ms: number;
}

/** `day` is the local `YYYY-MM-DD` of the bucket start (day, week or month). */
export interface DailyStat {
  day: string;
  ms: number;
}

export interface Session {
  start: number;
  end: number;
  durationMs: number;
  projects: ProjectRef[];
  languages: string[];
  files: string[];
}

export interface NullActivityApi {
  startSession(): void;
  pauseSession(): void;
  endSession(): void;
  recordActivity(h: Heartbeat): void;
  getProjectStats(range: DateRange): ProjectStat[];
  getLanguageStats(range: DateRange): LanguageStat[];
  getDailyStats(range: DateRange): DailyStat[];
  getSessions(range: DateRange): Session[];
  getIntervals(range: DateRange): Interval[];
  readonly onDidChange: Event<void>;
}
```

- [ ] **Step 5: Create the stub `src/extension.ts`**

```ts
'use strict';

import * as vscode from 'vscode';

export function activate(_context: vscode.ExtensionContext): void {}

export function deactivate(): void {}
```

- [ ] **Step 6: Install and compile**

Run: `cd extensions/null-activity && npm install && npm run compile`
Expected: `package-lock.json` created; `out/extension.js`, `out/types.js`, `out/emitter.js` exist; no tsc errors.

- [ ] **Step 7: Wire into `.github/workflows/build.yml`**

After the `Compile null-music TypeScript` step (line ~163) insert:

```yaml
      - name: Compile null-activity TypeScript
        shell: pwsh
        run: |
          Set-Location ide-overlay/extensions/null-activity
          npm ci --ignore-scripts
          npm run compile
```

In `Copy built-in extensions`, after the `null-music` line add:

```yaml
          Copy-Item -Recurse -Force ide-overlay/extensions/null-activity   vscode-src/extensions/
```

- [ ] **Step 8: Wire into `scripts/sync-local.ps1`**

After the `"null-music" = @{ ... }` entry (before the closing `}` at line 285) add:

```powershell
    "null-activity" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out"
        )
    }
```

- [ ] **Step 9: Wire into `scripts/build-local.ps1`**

Append `, "null-activity"` to the two arrays at lines 361 (compile list) and 378 (copy list), after `"null-music"`.

- [ ] **Step 10: Commit**

```bash
git add extensions/null-activity/package.json extensions/null-activity/package-lock.json extensions/null-activity/tsconfig.json extensions/null-activity/src .github/workflows/build.yml scripts/sync-local.ps1 scripts/build-local.ps1
git commit -m "feat(null-activity): scaffold extension and wire into CI and local sync"
git add extensions/null-activity/out
git commit -m "chore: refresh null-activity compiled output"
```

---

### Task 2: Tracker (state machine over heartbeats)

**Files:**
- Create: `extensions/null-activity/src/tracker.ts`, `extensions/null-activity/src/test/tracker.test.ts`
- Modify: `extensions/null-activity/package.json` (add `test` script)

**Interfaces:**
- Consumes: `Heartbeat`, `Interval`, `ResolvedProject` from `types.ts`.
- Produces:
  - `class Tracker { constructor(opts: TrackerOptions); heartbeat(h: Heartbeat): void; setFocused(focused: boolean): void; setActive(active: boolean): void; tick(): void; closeOpen(): void; peek(): Interval | undefined }`
  - `interface TrackerOptions { clock: () => number; idleTimeoutMs: () => number; resolveProject: (workspace: string | undefined) => ResolvedProject; onInterval: (interval: Interval) => void }`
  - `lineDelta(changes): { linesAdded: number; linesRemoved: number }`

Close rule (one rule, used everywhere): closing at time `t` ends the interval at `t` if `last <= t <= last + idleTimeout`, otherwise at `last`. Zero-length intervals are dropped. A context change (workspace/language/file) closes at the new heartbeat's time.

- [ ] **Step 1: Write the failing test `src/test/tracker.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Tracker, lineDelta } from '../tracker';
import { Heartbeat, Interval } from '../types';

const IDLE = 120_000;

function setup() {
  let now = 0;
  let resolved = 0;
  const out: Interval[] = [];
  const tracker = new Tracker({
    clock: () => now,
    idleTimeoutMs: () => IDLE,
    resolveProject: (w) => {
      resolved++;
      return { key: w ?? '(no folder)', name: 'proj', branch: 'main' };
    },
    onInterval: (i) => out.push(i),
  });
  return { tracker, out, at: (ms: number) => { now = ms; }, resolveCount: () => resolved };
}

function hb(ts: number, over: Partial<Heartbeat> = {}): Heartbeat {
  return { ts, language: 'typescript', file: 'a.ts', workspace: '/w', isWrite: false, linesAdded: 0, linesRemoved: 0, ...over };
}

test('heartbeats within the idle timeout merge into one interval closed by tick()', () => {
  const { tracker, out, at, resolveCount } = setup();
  tracker.heartbeat(hb(1_000, { linesAdded: 2 }));
  tracker.heartbeat(hb(61_000, { linesAdded: 3, linesRemoved: 1 }));
  tracker.heartbeat(hb(100_000));
  assert.strictEqual(out.length, 0);
  at(100_000 + IDLE + 1);
  tracker.tick();
  assert.deepStrictEqual(out, [
    { start: 1_000, end: 100_000, project: { key: '/w', name: 'proj' }, language: 'typescript', file: 'a.ts', branch: 'main', linesAdded: 5, linesRemoved: 1 },
  ]);
  assert.strictEqual(resolveCount(), 1, 'project resolved once per interval, not per heartbeat');
});

test('a gap longer than the idle timeout closes at the last heartbeat and opens a new interval', () => {
  const { tracker, out } = setup();
  tracker.heartbeat(hb(0));
  tracker.heartbeat(hb(10_000));
  tracker.heartbeat(hb(10_000 + IDLE + 1));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].start, 0);
  assert.strictEqual(out[0].end, 10_000);
  tracker.heartbeat(hb(10_000 + IDLE + 1_001));
  assert.strictEqual(tracker.peek()?.start, 10_000 + IDLE + 1);
  assert.strictEqual(tracker.peek()?.end, 10_000 + IDLE + 1_001);
});

test('a lone heartbeat that goes stale produces no interval', () => {
  const { tracker, out, at } = setup();
  tracker.heartbeat(hb(0));
  at(IDLE + 1);
  tracker.tick();
  assert.strictEqual(out.length, 0);
  assert.strictEqual(tracker.peek(), undefined);
});

test('tick() only closes when the gap is strictly greater than the idle timeout', () => {
  const { tracker, out, at } = setup();
  tracker.heartbeat(hb(0));
  tracker.heartbeat(hb(10_000));
  at(10_000 + IDLE);
  tracker.tick();
  assert.strictEqual(out.length, 0);
  at(10_000 + IDLE + 1);
  tracker.tick();
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 10_000]]);
});

test('switching file, language or project closes at the switch and re-resolves the project', () => {
  const changes: Partial<Heartbeat>[] = [{ file: 'b.ts' }, { language: 'json' }, { workspace: '/other' }];
  for (const change of changes) {
    const { tracker, out, at, resolveCount } = setup();
    tracker.heartbeat(hb(0));
    tracker.heartbeat(hb(30_000, { ...change, linesAdded: 4 }));
    assert.strictEqual(out.length, 1, JSON.stringify(change));
    assert.deepStrictEqual([out[0].start, out[0].end], [0, 30_000]);
    assert.strictEqual(resolveCount(), 2);
    at(40_000);
    tracker.closeOpen();
    assert.deepStrictEqual([out[1].start, out[1].end, out[1].linesAdded], [30_000, 40_000, 4]);
  }
});

test('focus loss closes the interval; heartbeats while unfocused are ignored', () => {
  const { tracker, out, at } = setup();
  tracker.heartbeat(hb(0));
  tracker.heartbeat(hb(10_000));
  at(40_000);
  tracker.setFocused(false);
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 40_000]]);
  tracker.heartbeat(hb(50_000));
  tracker.setFocused(true);
  tracker.heartbeat(hb(60_000));
  tracker.heartbeat(hb(70_000));
  at(70_000);
  tracker.closeOpen();
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 40_000], [60_000, 70_000]]);
});

test('focus loss after a long silence ends at the last heartbeat, not at the loss', () => {
  const { tracker, out, at } = setup();
  tracker.heartbeat(hb(0));
  tracker.heartbeat(hb(10_000));
  at(10_000 + IDLE + 5_000);
  tracker.setFocused(false);
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 10_000]]);
});

test('a clock that jumps backwards never yields negative or inflated time', () => {
  const { tracker, out, at } = setup();
  tracker.heartbeat(hb(100_000));
  tracker.heartbeat(hb(150_000));
  tracker.heartbeat(hb(50_000));
  tracker.heartbeat(hb(60_000));
  at(60_000);
  tracker.closeOpen();
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[100_000, 150_000], [50_000, 60_000]]);
  assert.ok(out.every((i) => i.end > i.start));
});

test('sleep/wake: a heartbeat hours later does not credit the gap', () => {
  const { tracker, out } = setup();
  tracker.heartbeat(hb(0));
  tracker.heartbeat(hb(5_000));
  tracker.heartbeat(hb(8 * 3_600_000));
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 5_000]]);
});

test('setActive(false) closes the open interval and ignores heartbeats until re-enabled', () => {
  const { tracker, out, at } = setup();
  tracker.heartbeat(hb(0));
  tracker.heartbeat(hb(10_000));
  at(20_000);
  tracker.setActive(false);
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 20_000]]);
  tracker.heartbeat(hb(30_000));
  tracker.setActive(true);
  tracker.heartbeat(hb(40_000));
  tracker.heartbeat(hb(50_000));
  at(50_000);
  tracker.closeOpen();
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 20_000], [40_000, 50_000]]);
});

test('peek() reports the open interval up to the last heartbeat without closing it', () => {
  const { tracker, out } = setup();
  assert.strictEqual(tracker.peek(), undefined);
  tracker.heartbeat(hb(0));
  assert.strictEqual(tracker.peek(), undefined, 'a single heartbeat has no duration yet');
  tracker.heartbeat(hb(5_000));
  assert.deepStrictEqual([tracker.peek()?.start, tracker.peek()?.end], [0, 5_000]);
  assert.strictEqual(out.length, 0);
});

test('lineDelta counts inserted newlines and removed lines', () => {
  const range = (a: number, b: number) => ({ start: { line: a }, end: { line: b } });
  assert.deepStrictEqual(lineDelta([{ text: 'a\nb\n', range: range(3, 3) }]), { linesAdded: 2, linesRemoved: 0 });
  assert.deepStrictEqual(lineDelta([{ text: '', range: range(3, 5) }]), { linesAdded: 0, linesRemoved: 2 });
  assert.deepStrictEqual(lineDelta([{ text: 'x\r\ny', range: range(4, 4) }]), { linesAdded: 1, linesRemoved: 0 });
  assert.deepStrictEqual(
    lineDelta([{ text: 'a\n', range: range(0, 0) }, { text: '', range: range(9, 10) }]),
    { linesAdded: 1, linesRemoved: 1 },
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd extensions/null-activity && npx tsc -p tsconfig.json && node --test out/test/tracker.test.js`
Expected: FAIL — tsc error `Cannot find module '../tracker'`.

- [ ] **Step 3: Write `src/tracker.ts`**

```ts
'use strict';

import { Heartbeat, Interval, ResolvedProject } from './types';

export interface TrackerOptions {
  clock: () => number;
  idleTimeoutMs: () => number;
  resolveProject: (workspace: string | undefined) => ResolvedProject;
  onInterval: (interval: Interval) => void;
}

interface OpenInterval {
  start: number;
  last: number;
  workspace: string | undefined;
  language: string;
  file: string | undefined;
  project: ResolvedProject;
  linesAdded: number;
  linesRemoved: number;
}

export class Tracker {
  private open: OpenInterval | undefined;
  private focused = true;
  private active = true;

  constructor(private readonly opts: TrackerOptions) {}

  heartbeat(h: Heartbeat): void {
    if (!this.active || !this.focused) return;
    const o = this.open;
    const sameContext = !!o && o.workspace === h.workspace && o.language === h.language && o.file === h.file;
    if (o && sameContext && h.ts >= o.last && h.ts - o.last <= this.opts.idleTimeoutMs()) {
      o.last = h.ts;
      o.linesAdded += h.linesAdded;
      o.linesRemoved += h.linesRemoved;
      return;
    }
    this.close(h.ts);
    this.open = {
      start: h.ts,
      last: h.ts,
      workspace: h.workspace,
      language: h.language,
      file: h.file,
      project: this.opts.resolveProject(h.workspace),
      linesAdded: h.linesAdded,
      linesRemoved: h.linesRemoved,
    };
  }

  setFocused(focused: boolean): void {
    if (!focused) this.close(this.opts.clock());
    this.focused = focused;
  }

  setActive(active: boolean): void {
    if (!active) this.close(this.opts.clock());
    this.active = active;
  }

  /** Closes a stale interval even when no new heartbeat arrives. */
  tick(): void {
    const o = this.open;
    const now = this.opts.clock();
    if (o && now - o.last > this.opts.idleTimeoutMs()) this.close(now);
  }

  closeOpen(): void {
    this.close(this.opts.clock());
  }

  /** The in-progress interval up to its last heartbeat, for live readouts. */
  peek(): Interval | undefined {
    const o = this.open;
    return o && o.last > o.start ? this.toInterval(o, o.last) : undefined;
  }

  private close(t: number): void {
    const o = this.open;
    if (!o) return;
    this.open = undefined;
    const end = t < o.last || t - o.last > this.opts.idleTimeoutMs() ? o.last : t;
    if (end <= o.start) return;
    this.opts.onInterval(this.toInterval(o, end));
  }

  private toInterval(o: OpenInterval, end: number): Interval {
    return {
      start: o.start,
      end,
      project: { key: o.project.key, name: o.project.name },
      language: o.language,
      ...(o.file !== undefined ? { file: o.file } : {}),
      ...(o.project.branch ? { branch: o.project.branch } : {}),
      linesAdded: o.linesAdded,
      linesRemoved: o.linesRemoved,
    };
  }
}

interface TextChange {
  text: string;
  range: { start: { line: number }; end: { line: number } };
}

/** Lines added = newlines inserted; lines removed = lines spanned by the replaced range. */
export function lineDelta(changes: readonly TextChange[]): { linesAdded: number; linesRemoved: number } {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const c of changes) {
    for (let i = c.text.indexOf('\n'); i !== -1; i = c.text.indexOf('\n', i + 1)) linesAdded++;
    linesRemoved += c.range.end.line - c.range.start.line;
  }
  return { linesAdded, linesRemoved };
}
```

- [ ] **Step 4: Add the `test` script to `package.json`**

In `"scripts"` add: `"test": "tsc -p tsconfig.json && node --test out/test/tracker.test.js"`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix extensions/null-activity test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-activity/src extensions/null-activity/package.json
git commit -m "feat(null-activity): tracker state machine over heartbeats"
git add extensions/null-activity/out
git commit -m "chore: refresh null-activity compiled output"
```

---

### Task 3: Stats (pure aggregation)

**Files:**
- Create: `extensions/null-activity/src/stats.ts`, `extensions/null-activity/src/test/stats.test.ts`
- Modify: `extensions/null-activity/package.json` (append `out/test/stats.test.js` to `test`)

**Interfaces:**
- Consumes: types from `types.ts`.
- Produces (all in `stats.ts`):
  - `type Period = 'day' | 'week' | 'month'`
  - `periodStart(ts: number, p: Period): number`, `nextPeriodStart(ts: number, p: Period): number`, `dayKey(ts: number): string`
  - `dayRange(now: number): DateRange`, `lastDaysRange(now: number, days: number): DateRange`, `monthRange(now: number): DateRange`, `ALL_TIME: DateRange`
  - `mergeClip(intervals: readonly Interval[]): Interval[]`, `sliceInterval(i: Interval, from: number, to: number): Interval | undefined`, `normalizeIntervals(intervals: readonly Interval[], range: DateRange): Interval[]`
  - `periodStats(intervals, range, period): DailyStat[]`, `projectStats(intervals, range): ProjectStat[]`, `languageStats(intervals, range): LanguageStat[]`, `sessions(intervals, range, gapMs): Session[]`, `formatDuration(ms: number): string`

All aggregators call `normalizeIntervals` themselves (merge across windows, clip to range), so they are safe on raw input. Lines stay with the piece that contains the interval's `start`.

- [ ] **Step 1: Write the failing test `src/test/stats.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import {
  dayKey, dayRange, formatDuration, languageStats, lastDaysRange, mergeClip, monthRange, nextPeriodStart,
  normalizeIntervals, periodStart, periodStats, projectStats, sessions,
} from '../stats';
import { Interval } from '../types';

const MIN = 60_000;
/** Local time; month is zero-based and defaults to October 2026 (Thu 8 Oct 2026). */
const at = (day: number, h: number, m = 0, month = 9) => new Date(2026, month, day, h, m).getTime();
const iv = (start: number, end: number, over: Partial<Interval> = {}): Interval => ({
  start, end, project: { key: 'k', name: 'proj' }, language: 'typescript', file: 'a.ts', linesAdded: 0, linesRemoved: 0, ...over,
});

test('weeks start on Monday and months on the 1st (local time)', () => {
  assert.strictEqual(periodStart(at(4, 12), 'week'), at(28, 0, 0, 8)); // Sun 4 Oct -> Mon 28 Sep
  assert.strictEqual(periodStart(at(5, 0), 'week'), at(5, 0)); // Monday stays
  assert.strictEqual(periodStart(at(8, 23, 59), 'week'), at(5, 0));
  assert.strictEqual(nextPeriodStart(at(8, 9), 'week'), at(12, 0));
  assert.strictEqual(periodStart(at(31, 23, 59), 'month'), at(1, 0));
  assert.strictEqual(nextPeriodStart(at(31, 23, 59), 'month'), at(1, 0, 0, 10));
  assert.strictEqual(dayKey(at(8, 0)), '2026-10-08');
});

test('day boundaries are local midnights even across DST changes', () => {
  let ts = new Date(2026, 0, 1).getTime();
  for (let n = 0; n < 365; n++) {
    const next = nextPeriodStart(ts, 'day');
    assert.ok(next - ts >= 23 * 3_600_000 && next - ts <= 25 * 3_600_000);
    assert.notStrictEqual(dayKey(next), dayKey(ts));
    ts = next;
  }
});

test('range helpers cover today, the last N days and the month', () => {
  assert.deepStrictEqual(dayRange(at(8, 15)), { from: at(8, 0), to: at(9, 0) });
  assert.deepStrictEqual(lastDaysRange(at(8, 15), 7), { from: at(2, 0), to: at(9, 0) });
  assert.deepStrictEqual(monthRange(at(8, 15)), { from: at(1, 0), to: at(1, 0, 0, 10) });
});

test('mergeClip drops duplicates and clips overlaps so two windows never double-count', () => {
  const a = iv(at(8, 10), at(8, 10, 10));
  const b = iv(at(8, 10, 5), at(8, 10, 15));
  const inside = iv(at(8, 10, 2), at(8, 10, 4));
  const merged = mergeClip([b, a, a, inside]);
  assert.deepStrictEqual(merged.map((i) => [i.start, i.end]), [[at(8, 10), at(8, 10, 10)], [at(8, 10, 10), at(8, 10, 15)]]);
  assert.strictEqual(projectStats([a, b], dayRange(at(8, 12)))[0].ms, 15 * MIN);
});

test('an interval crossing midnight is split per day; lines stay with the day it started', () => {
  const i = iv(at(7, 23, 30), at(8, 0, 30), { linesAdded: 4 });
  const days = periodStats([i], { from: at(1, 0), to: at(31, 0) }, 'day');
  assert.deepStrictEqual(days, [{ day: '2026-10-07', ms: 30 * MIN }, { day: '2026-10-08', ms: 30 * MIN }]);
  const oct8 = projectStats([i], dayRange(at(8, 12)))[0];
  assert.deepStrictEqual([oct8.ms, oct8.linesAdded], [30 * MIN, 0]);
  assert.strictEqual(projectStats([i], dayRange(at(7, 12)))[0].linesAdded, 4);
});

test('week buckets start on Monday; month buckets split at month end', () => {
  const sun = iv(at(4, 10), at(4, 11));
  const mon = iv(at(5, 10), at(5, 11));
  assert.deepStrictEqual(periodStats([sun, mon], { from: at(1, 0), to: at(31, 0) }, 'week'), [
    { day: '2026-09-28', ms: 60 * MIN },
    { day: '2026-10-05', ms: 60 * MIN },
  ]);
  const crossing = iv(at(31, 23, 30), at(1, 0, 30, 10));
  assert.deepStrictEqual(periodStats([crossing], { from: at(1, 0), to: at(30, 0, 0, 10) }, 'month'), [
    { day: '2026-10-01', ms: 30 * MIN },
    { day: '2026-11-01', ms: 30 * MIN },
  ]);
});

test('normalizeIntervals clips to the range', () => {
  const got = normalizeIntervals([iv(at(8, 9), at(8, 11), { linesAdded: 5 })], { from: at(8, 10), to: at(8, 12) });
  assert.deepStrictEqual(got.map((i) => [i.start, i.end, i.linesAdded]), [[at(8, 10), at(8, 11), 0]]);
});

test('projectStats groups by key, counts distinct files, uses the latest name and sorts by time', () => {
  const day = dayRange(at(8, 12));
  const p1 = { key: 'p1', name: 'old-name' };
  const stats = projectStats(
    [
      iv(at(8, 9), at(8, 10), { project: p1, file: 'a.ts', linesAdded: 2, linesRemoved: 1 }),
      iv(at(8, 11), at(8, 11, 30), { project: { key: 'p1', name: 'new-name' }, file: 'b.ts', linesAdded: 1 }),
      iv(at(8, 12), at(8, 12, 10), { project: { key: 'p2', name: 'other' }, file: undefined }),
    ],
    { from: at(8, 0), to: at(9, 0) },
  );
  assert.deepStrictEqual(stats, [
    { project: { key: 'p1', name: 'new-name' }, ms: 90 * MIN, files: 2, linesAdded: 3, linesRemoved: 1 },
    { project: { key: 'p2', name: 'other' }, ms: 10 * MIN, files: 0, linesAdded: 0, linesRemoved: 0 },
  ]);
  assert.ok(day.to > day.from);
});

test('languageStats sums time per language, largest first', () => {
  assert.deepStrictEqual(
    languageStats(
      [iv(at(8, 9), at(8, 9, 10)), iv(at(8, 10), at(8, 10, 30), { language: 'rust' }), iv(at(8, 11), at(8, 11, 5))],
      dayRange(at(8, 12)),
    ),
    [{ language: 'rust', ms: 30 * MIN }, { language: 'typescript', ms: 15 * MIN }],
  );
});

test('sessions split on gaps over sessionGap; a gap of exactly sessionGap stays in one', () => {
  const a = iv(at(8, 9), at(8, 9, 30), { file: 'a.ts' });
  const b = iv(at(8, 9, 40), at(8, 10), { file: 'b.ts', language: 'rust' });
  const c = iv(at(8, 10, 16), at(8, 10, 30), { project: { key: 'p2', name: 'two' } });
  const d = iv(at(8, 10, 45), at(8, 11));
  const got = sessions([a, b, c, d], dayRange(at(8, 12)), 15 * MIN);
  assert.strictEqual(got.length, 2);
  assert.deepStrictEqual([got[0].start, got[0].end, got[0].durationMs], [at(8, 9), at(8, 10), 50 * MIN]);
  assert.deepStrictEqual(got[0].languages, ['typescript', 'rust']);
  assert.deepStrictEqual(got[0].files, ['a.ts', 'b.ts']);
  assert.deepStrictEqual([got[1].start, got[1].end, got[1].durationMs], [at(8, 10, 16), at(8, 11), 29 * MIN]);
  assert.deepStrictEqual(got[1].projects.map((p) => p.key), ['p2', 'k']);
});

test('formatDuration', () => {
  assert.strictEqual(formatDuration(0), '0m');
  assert.strictEqual(formatDuration(59_000), '0m');
  assert.strictEqual(formatDuration(12 * MIN), '12m');
  assert.strictEqual(formatDuration((4 * 60 + 32) * MIN), '4h 32m');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd extensions/null-activity && npx tsc -p tsconfig.json && node --test out/test/stats.test.js`
Expected: FAIL — `Cannot find module '../stats'`.

- [ ] **Step 3: Write `src/stats.ts`**

```ts
'use strict';

import { DailyStat, DateRange, Interval, LanguageStat, ProjectRef, ProjectStat, Session } from './types';

export type Period = 'day' | 'week' | 'month';

export const ALL_TIME: DateRange = { from: 0, to: Number.MAX_SAFE_INTEGER };

export function periodStart(ts: number, p: Period): number {
  const d = new Date(ts);
  if (p === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const daysBack = p === 'week' ? (d.getDay() + 6) % 7 : 0; // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack).getTime();
}

export function nextPeriodStart(ts: number, p: Period): number {
  const s = new Date(periodStart(ts, p));
  if (p === 'month') return new Date(s.getFullYear(), s.getMonth() + 1, 1).getTime();
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + (p === 'week' ? 7 : 1)).getTime();
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayRange(now: number): DateRange {
  return { from: periodStart(now, 'day'), to: nextPeriodStart(now, 'day') };
}

/** Today plus the previous `days - 1` days. */
export function lastDaysRange(now: number, days: number): DateRange {
  const to = nextPeriodStart(now, 'day');
  const d = new Date(to);
  return { from: new Date(d.getFullYear(), d.getMonth(), d.getDate() - days).getTime(), to };
}

export function monthRange(now: number): DateRange {
  return { from: periodStart(now, 'month'), to: nextPeriodStart(now, 'month') };
}

/**
 * Sorts intervals from every window and clips overlaps so concurrent windows (or a clock
 * jump) never double-count. Idempotent. Lines of a fully covered interval are dropped; this
 * only happens for the few ms two windows overlap at a focus hand-over.
 */
export function mergeClip(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  let cursor = -Infinity;
  for (const i of sorted) {
    if (i.end <= cursor) continue;
    out.push(i.start < cursor ? { ...i, start: cursor } : i);
    cursor = i.end;
  }
  return out;
}

/** The part of `i` inside [from, to). Lines are kept only when the piece contains `i.start`. */
export function sliceInterval(i: Interval, from: number, to: number): Interval | undefined {
  const start = Math.max(i.start, from);
  const end = Math.min(i.end, to);
  if (end <= start) return undefined;
  const keepsLines = start === i.start;
  return { ...i, start, end, linesAdded: keepsLines ? i.linesAdded : 0, linesRemoved: keepsLines ? i.linesRemoved : 0 };
}

export function normalizeIntervals(intervals: readonly Interval[], range: DateRange): Interval[] {
  return mergeClip(intervals).flatMap((i) => sliceInterval(i, range.from, range.to) ?? []);
}

function* pieces(i: Interval, p: Period): Generator<Interval> {
  for (let from = i.start; from < i.end; ) {
    const to = nextPeriodStart(from, p);
    const piece = sliceInterval(i, from, Math.min(to, i.end));
    if (piece) yield piece;
    from = to;
  }
}

/** Time per day, week or month. `day` is the local `YYYY-MM-DD` of the bucket start. */
export function periodStats(intervals: readonly Interval[], range: DateRange, period: Period): DailyStat[] {
  const totals = new Map<number, number>();
  for (const i of normalizeIntervals(intervals, range)) {
    for (const piece of pieces(i, period)) {
      const key = periodStart(piece.start, period);
      totals.set(key, (totals.get(key) ?? 0) + piece.end - piece.start);
    }
  }
  return [...totals].sort((a, b) => a[0] - b[0]).map(([key, ms]) => ({ day: dayKey(key), ms }));
}

export function projectStats(intervals: readonly Interval[], range: DateRange): ProjectStat[] {
  const by = new Map<string, { project: ProjectRef; ms: number; files: Set<string>; linesAdded: number; linesRemoved: number }>();
  for (const i of normalizeIntervals(intervals, range)) {
    let s = by.get(i.project.key);
    if (!s) by.set(i.project.key, (s = { project: i.project, ms: 0, files: new Set(), linesAdded: 0, linesRemoved: 0 }));
    s.project = i.project; // intervals arrive in time order, so the latest name wins
    s.ms += i.end - i.start;
    s.linesAdded += i.linesAdded;
    s.linesRemoved += i.linesRemoved;
    if (i.file) s.files.add(i.file);
  }
  return [...by.values()]
    .map((s) => ({ project: s.project, ms: s.ms, files: s.files.size, linesAdded: s.linesAdded, linesRemoved: s.linesRemoved }))
    .sort((a, b) => b.ms - a.ms);
}

export function languageStats(intervals: readonly Interval[], range: DateRange): LanguageStat[] {
  const by = new Map<string, number>();
  for (const i of normalizeIntervals(intervals, range)) by.set(i.language, (by.get(i.language) ?? 0) + i.end - i.start);
  return [...by].map(([language, ms]) => ({ language, ms })).sort((a, b) => b.ms - a.ms);
}

/** Consecutive intervals with gaps <= gapMs form one session; duration is the sum of interval time. */
export function sessions(intervals: readonly Interval[], range: DateRange, gapMs: number): Session[] {
  const groups: { session: Session; projects: Map<string, ProjectRef>; languages: Set<string>; files: Set<string> }[] = [];
  for (const i of normalizeIntervals(intervals, range)) {
    let g = groups[groups.length - 1];
    if (!g || i.start - g.session.end > gapMs) {
      g = {
        session: { start: i.start, end: i.end, durationMs: 0, projects: [], languages: [], files: [] },
        projects: new Map(),
        languages: new Set(),
        files: new Set(),
      };
      groups.push(g);
    }
    g.session.end = i.end;
    g.session.durationMs += i.end - i.start;
    g.projects.set(i.project.key, i.project);
    if (i.language) g.languages.add(i.language);
    if (i.file) g.files.add(i.file);
  }
  return groups.map((g) => ({ ...g.session, projects: [...g.projects.values()], languages: [...g.languages], files: [...g.files] }));
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
```

- [ ] **Step 4: Register the test**

Append ` out/test/stats.test.js` to the `test` script in `package.json`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix extensions/null-activity test`
Expected: all PASS. If the `projectStats` ordering assertion for sessions' `projects` (`['p2', 'k']`) fails, check that `c` (project p2) precedes `d` (default project `k`) in time — it does (10:16 < 10:45).

- [ ] **Step 6: Commit**

```bash
git add extensions/null-activity/src extensions/null-activity/package.json
git commit -m "feat(null-activity): stats aggregation (periods, projects, languages, sessions)"
git add extensions/null-activity/out
git commit -m "chore: refresh null-activity compiled output"
```

---

### Task 4: Interval store (append-only JSONL)

**Files:**
- Create: `extensions/null-activity/src/intervalStore.ts`, `extensions/null-activity/src/test/intervalStore.test.ts`
- Modify: `extensions/null-activity/package.json` (append `out/test/intervalStore.test.js`)

**Interfaces:**
- Consumes: `Interval`, `DateRange` (types); `nextPeriodStart` (stats).
- Produces:
  - `class IntervalStore { constructor(opts: IntervalStoreOptions); append(i: Interval): void; flush(): void; read(range: DateRange): Interval[]; deleteRange(range: DateRange): void; deleteAll(): void }`
  - `interface IntervalStoreOptions { dir: string; windowId: string; maxBuffered?: number; log?: (message: string) => void }`
  - `monthKey(ts: number): string` (`YYYY-MM`, local)
  - `append`/`flush` never throw (failures are logged, the buffer is kept and retried). `deleteRange`/`deleteAll` throw on I/O failure so the command can tell the user.
  - `read` returns raw (unclipped) intervals overlapping the range from every window's files plus this store's unflushed buffer.

Design notes baked into the code: each flush chunk starts with `\n` so a torn last line from an earlier crash cannot swallow the first new line (blank lines are skipped on read); `deleteRange` removes any interval that overlaps the range (privacy-favouring: it can over-delete at most one interval at each edge); a rewrite races with another window's append only if both happen within milliseconds.

- [ ] **Step 1: Write the failing test `src/test/intervalStore.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { IntervalStore } from '../intervalStore';
import { dayRange } from '../stats';
import { Interval } from '../types';

const at = (day: number, h: number, m = 0, month = 9) => new Date(2026, month, day, h, m).getTime();
const iv = (start: number, end: number, over: Partial<Interval> = {}): Interval => ({
  start, end, project: { key: 'k', name: 'proj' }, language: 'typescript', file: 'a.ts', linesAdded: 0, linesRemoved: 0, ...over,
});
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-store-'));
const byStart = (a: Interval, b: Interval) => a.start - b.start;

test('append + flush + read round-trips and merges the files of two windows', () => {
  const dir = tmpDir();
  const a = new IntervalStore({ dir, windowId: 'w1' });
  const b = new IntervalStore({ dir, windowId: 'w2' });
  a.append(iv(at(8, 10), at(8, 11)));
  b.append(iv(at(8, 12), at(8, 13)));
  a.flush();
  b.flush();
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['intervals-2026-10-w1.jsonl', 'intervals-2026-10-w2.jsonl']);
  const got = a.read(dayRange(at(8, 12))).sort(byStart);
  assert.deepStrictEqual(got.map((i) => i.start), [at(8, 10), at(8, 12)]);
  assert.deepStrictEqual(a.read(dayRange(at(9, 12))), [], 'other days are filtered out');
});

test('unflushed intervals are readable', () => {
  const store = new IntervalStore({ dir: tmpDir(), windowId: 'w1' });
  store.append(iv(at(8, 10), at(8, 11)));
  assert.strictEqual(store.read(dayRange(at(8, 12))).length, 1);
});

test('a torn last line is skipped and a later append to the same file is still readable', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'intervals-2026-10-old.jsonl'), JSON.stringify(iv(at(8, 9), at(8, 10))) + '\n{"start":5,"en');
  const store = new IntervalStore({ dir, windowId: 'old' });
  assert.strictEqual(store.read(dayRange(at(8, 12))).length, 1);
  store.append(iv(at(8, 11), at(8, 12)));
  store.flush();
  assert.strictEqual(new IntervalStore({ dir, windowId: 'other' }).read(dayRange(at(8, 12))).length, 2);
});

test('a corrupt file never blocks the others', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'intervals-2026-10-bad.jsonl'), '\u0000\u0000 garbage\nnull\n[]\n{"start":"x"}\n{"start":5,"end":3}\n');
  const store = new IntervalStore({ dir, windowId: 'w1' });
  store.append(iv(at(8, 10), at(8, 11)));
  store.flush();
  assert.strictEqual(store.read(dayRange(at(8, 12))).length, 1);
});

test('an interval crossing a month end is split across two files; lines stay on the first piece', () => {
  const dir = tmpDir();
  const store = new IntervalStore({ dir, windowId: 'w1' });
  store.append(iv(at(31, 23, 50), at(1, 0, 10, 10), { linesAdded: 3 }));
  store.flush();
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['intervals-2026-10-w1.jsonl', 'intervals-2026-11-w1.jsonl']);
  const got = store.read({ from: at(1, 0), to: at(30, 0, 0, 10) }).sort(byStart);
  assert.deepStrictEqual(
    got.map((i) => [i.start, i.end, i.linesAdded]),
    [[at(31, 23, 50), at(1, 0, 0, 10), 3], [at(1, 0, 0, 10), at(1, 0, 10, 10), 0]],
  );
});

test('deleteRange removes overlapping intervals (flushed and buffered) and empty files', () => {
  const dir = tmpDir();
  const store = new IntervalStore({ dir, windowId: 'w1' });
  store.append(iv(at(7, 10), at(7, 11)));
  store.append(iv(at(8, 10), at(8, 11)));
  store.append(iv(at(8, 23, 30), at(9, 0, 30)));
  store.append(iv(at(9, 10), at(9, 11)));
  store.flush();
  store.append(iv(at(8, 14), at(8, 15))); // still buffered
  store.deleteRange(dayRange(at(8, 12)));
  const left = store.read({ from: 0, to: Number.MAX_SAFE_INTEGER }).sort(byStart);
  assert.deepStrictEqual(left.map((i) => i.start), [at(7, 10), at(9, 10)]);

  const loneDir = tmpDir();
  const lone = new IntervalStore({ dir: loneDir, windowId: 'w1' });
  lone.append(iv(at(8, 10), at(8, 11)));
  lone.flush();
  lone.deleteRange(dayRange(at(8, 12)));
  assert.deepStrictEqual(fs.readdirSync(loneDir), []);
});

test('deleteAll removes every file and the buffer', () => {
  const dir = tmpDir();
  const a = new IntervalStore({ dir, windowId: 'w1' });
  const b = new IntervalStore({ dir, windowId: 'w2' });
  a.append(iv(at(8, 10), at(8, 11)));
  b.append(iv(at(9, 10), at(9, 11)));
  b.flush();
  a.flush();
  a.append(iv(at(10, 10), at(10, 11)));
  a.deleteAll();
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  assert.deepStrictEqual(a.read({ from: 0, to: Number.MAX_SAFE_INTEGER }), []);
});

test('an unwritable storage dir logs, keeps the data in memory, never throws, and retries', () => {
  const dir = path.join(tmpDir(), 'blocked');
  fs.writeFileSync(dir, 'a file where the directory should be');
  const logs: string[] = [];
  const store = new IntervalStore({ dir, windowId: 'w1', log: (m) => logs.push(m) });
  store.append(iv(at(8, 10), at(8, 11)));
  assert.doesNotThrow(() => store.flush());
  assert.ok(logs.length > 0);
  assert.strictEqual(store.read(dayRange(at(8, 12))).length, 1, 'still readable from memory');
  fs.rmSync(dir);
  store.flush();
  assert.strictEqual(fs.readdirSync(dir).length, 1, 'retried successfully');
});

test('the in-memory buffer is capped, dropping the oldest', () => {
  const dir = path.join(tmpDir(), 'blocked');
  fs.writeFileSync(dir, 'x');
  const store = new IntervalStore({ dir, windowId: 'w1', maxBuffered: 2, log: () => {} });
  store.append(iv(at(8, 10), at(8, 11)));
  store.append(iv(at(8, 12), at(8, 13)));
  store.append(iv(at(8, 14), at(8, 15)));
  const got = store.read(dayRange(at(8, 12))).sort(byStart);
  assert.deepStrictEqual(got.map((i) => i.start), [at(8, 12), at(8, 14)]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd extensions/null-activity && npx tsc -p tsconfig.json && node --test out/test/intervalStore.test.js`
Expected: FAIL — `Cannot find module '../intervalStore'`.

- [ ] **Step 3: Write `src/intervalStore.ts`**

```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { nextPeriodStart } from './stats';
import { DateRange, Interval } from './types';

const FILE_RE = /^intervals-(\d{4})-(\d{2})-.+\.jsonl$/;
const DEFAULT_MAX_BUFFERED = 5_000;
const EVERYTHING: DateRange = { from: -Infinity, to: Infinity };

export interface IntervalStoreOptions {
  dir: string;
  windowId: string;
  maxBuffered?: number;
  log?: (message: string) => void;
}

export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parseInterval(line: string): Interval | undefined {
  try {
    const v = JSON.parse(line);
    if (
      Number.isFinite(v.start) && Number.isFinite(v.end) && v.end > v.start &&
      typeof v.project?.key === 'string' && typeof v.project?.name === 'string' && typeof v.language === 'string'
    ) {
      return { ...v, linesAdded: Number(v.linesAdded) || 0, linesRemoved: Number(v.linesRemoved) || 0 };
    }
  } catch {
    // torn or corrupt line
  }
  return undefined;
}

const overlaps = (i: Interval, r: DateRange) => i.end > r.from && i.start < r.to;

export class IntervalStore {
  private buffer: Interval[] = [];

  constructor(private readonly opts: IntervalStoreOptions) {}

  /** Splits at local month boundaries; lines stay on the first piece. */
  append(interval: Interval): void {
    let piece = interval;
    for (;;) {
      const boundary = nextPeriodStart(piece.start, 'month');
      if (piece.end <= boundary) {
        this.push(piece);
        return;
      }
      this.push({ ...piece, end: boundary });
      piece = { ...piece, start: boundary, linesAdded: 0, linesRemoved: 0 };
    }
  }

  /**
   * Appends buffered intervals to this window's monthly files. Sync on purpose so `dispose`
   * can flush. ponytail: one file per window session per month; add compaction if file count matters.
   */
  flush(): void {
    if (this.buffer.length === 0) return;
    try {
      fs.mkdirSync(this.opts.dir, { recursive: true });
    } catch (err) {
      this.fail(err);
      return;
    }
    const byMonth = new Map<string, Interval[]>();
    for (const i of this.buffer) {
      const key = monthKey(i.start);
      byMonth.set(key, [...(byMonth.get(key) ?? []), i]);
    }
    const remaining: Interval[] = [];
    for (const [month, items] of byMonth) {
      // The leading newline isolates a torn last line left by an earlier crash.
      const chunk = '\n' + items.map((i) => JSON.stringify(i)).join('\n') + '\n';
      try {
        fs.appendFileSync(this.fileFor(month), chunk);
      } catch (err) {
        this.fail(err);
        remaining.push(...items);
      }
    }
    this.buffer = remaining;
  }

  read(range: DateRange): Interval[] {
    const out: Interval[] = [];
    for (const name of this.listFiles(range)) out.push(...this.parseFile(path.join(this.opts.dir, name)));
    out.push(...this.buffer);
    return out.filter((i) => overlaps(i, range));
  }

  /**
   * Drops every interval overlapping the range, so it can over-delete one interval at each edge.
   * ponytail: rewriting another window's file can race with its append; acceptable for a manual action.
   */
  deleteRange(range: DateRange): void {
    this.flush();
    this.buffer = this.buffer.filter((i) => !overlaps(i, range));
    for (const name of this.listFiles(range)) {
      const file = path.join(this.opts.dir, name);
      this.rewrite(file, this.parseFile(file).filter((i) => !overlaps(i, range)));
    }
  }

  deleteAll(): void {
    this.buffer = [];
    for (const name of this.listFiles(EVERYTHING)) fs.rmSync(path.join(this.opts.dir, name), { force: true });
  }

  private push(i: Interval): void {
    this.buffer.push(i);
    const max = this.opts.maxBuffered ?? DEFAULT_MAX_BUFFERED;
    if (this.buffer.length > max) {
      this.buffer.splice(0, this.buffer.length - max);
      this.opts.log?.(`Interval buffer full (${max}); dropped the oldest unsaved intervals.`);
    }
  }

  private fileFor(month: string): string {
    return path.join(this.opts.dir, `intervals-${month}-${this.opts.windowId}.jsonl`);
  }

  private listFiles(range: DateRange): string[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.opts.dir);
    } catch {
      return [];
    }
    return names.filter((name) => {
      const m = FILE_RE.exec(name);
      if (!m) return false;
      const start = new Date(Number(m[1]), Number(m[2]) - 1, 1).getTime();
      return nextPeriodStart(start, 'month') > range.from && start < range.to;
    });
  }

  private parseFile(file: string): Interval[] {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      this.fail(err);
      return [];
    }
    return text.split('\n').flatMap((line) => (line.trim() ? parseInterval(line) ?? [] : []));
  }

  private rewrite(file: string, intervals: Interval[]): void {
    if (intervals.length === 0) {
      fs.rmSync(file, { force: true });
      return;
    }
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, intervals.map((i) => JSON.stringify(i) + '\n').join(''));
    fs.renameSync(tmp, file);
  }

  private fail(err: unknown): void {
    this.opts.log?.(`Storage error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

- [ ] **Step 4: Register the test and run**

Append ` out/test/intervalStore.test.js` to the `test` script, then run `npm --prefix extensions/null-activity test`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src extensions/null-activity/package.json
git commit -m "feat(null-activity): append-only JSONL interval store"
git add extensions/null-activity/out
git commit -m "chore: refresh null-activity compiled output"
```

---

### Task 5: Project identity

**Files:**
- Create: `extensions/null-activity/src/projectIdentity.ts`, `extensions/null-activity/src/test/projectIdentity.test.ts`
- Modify: `extensions/null-activity/package.json` (append `out/test/projectIdentity.test.js`)

**Interfaces:**
- Consumes: `ResolvedProject` (types).
- Produces: `resolveProject(folder: string | undefined): ResolvedProject`, `normalizeRemote(url: string): string`, `NO_FOLDER = '(no folder)'`.

Key = normalized git remote (`origin`, else the first remote) so renaming a folder does not split history; otherwise the normalized folder path. Name = folder basename. Walks up from the folder to find `.git`; handles `.git` files (worktrees: config via `commondir`, branch via the worktree's own `HEAD`).

- [ ] **Step 1: Write the failing test `src/test/projectIdentity.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { NO_FOLDER, normalizeRemote, resolveProject } from '../projectIdentity';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-proj-'));

function repo(root: string, remotes: Record<string, string>, head = 'ref: refs/heads/main\n'): void {
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), head);
  const sections = Object.entries(remotes).map(([name, url]) => `[remote "${name}"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/${name}/*\n`);
  fs.writeFileSync(path.join(root, '.git', 'config'), `[core]\n\tbare = false\n${sections.join('')}`);
}

test('normalizeRemote makes ssh, https and credentialed urls identical', () => {
  const want = 'github.com/torres/null-ide';
  for (const url of [
    'git@github.com:Torres/Null-IDE.git',
    'https://github.com/Torres/null-ide.git',
    'https://user:tok@github.com/torres/null-ide',
    'ssh://git@github.com/torres/null-ide.git/',
  ]) {
    assert.strictEqual(normalizeRemote(url), want, url);
  }
});

test('no folder', () => {
  assert.deepStrictEqual(resolveProject(undefined), { key: NO_FOLDER, name: NO_FOLDER });
});

test('a folder without git is keyed by its normalized path', () => {
  const dir = path.join(tmpDir(), 'proj');
  fs.mkdirSync(dir);
  const want = path.resolve(dir).replace(/\\/g, '/');
  const r = resolveProject(dir);
  assert.strictEqual(r.key, process.platform === 'win32' ? want.toLowerCase() : want);
  assert.strictEqual(r.name, 'proj');
  assert.strictEqual(r.branch, undefined);
});

test('git without a remote falls back to the path and still reports the branch', () => {
  const dir = path.join(tmpDir(), 'local-only');
  repo(dir, {});
  const r = resolveProject(dir);
  const want = path.resolve(dir).replace(/\\/g, '/');
  assert.strictEqual(r.key, process.platform === 'win32' ? want.toLowerCase() : want);
  assert.strictEqual(r.branch, 'main');
});

test('ssh and https checkouts of the same repo share a key; origin wins over other remotes', () => {
  const base = tmpDir();
  repo(path.join(base, 'one'), { upstream: 'https://github.com/other/fork.git', origin: 'git@github.com:Torres/null-ide.git' });
  repo(path.join(base, 'two'), { origin: 'https://github.com/torres/null-ide.git' });
  assert.strictEqual(resolveProject(path.join(base, 'one')).key, 'github.com/torres/null-ide');
  assert.strictEqual(resolveProject(path.join(base, 'two')).key, 'github.com/torres/null-ide');
});

test('renaming the folder keeps the key and changes only the name', () => {
  const base = tmpDir();
  repo(path.join(base, 'before'), { origin: 'git@github.com:o/r.git' });
  const before = resolveProject(path.join(base, 'before'));
  fs.renameSync(path.join(base, 'before'), path.join(base, 'after'));
  const after = resolveProject(path.join(base, 'after'));
  assert.strictEqual(after.key, before.key);
  assert.deepStrictEqual([before.name, after.name], ['before', 'after']);
});

test('a detached HEAD has no branch', () => {
  const dir = path.join(tmpDir(), 'det');
  repo(dir, { origin: 'git@github.com:o/r.git' }, '0123456789abcdef0123456789abcdef01234567\n');
  assert.strictEqual(resolveProject(dir).branch, undefined);
});

test('a subfolder walks up to the repo; the name is the subfolder', () => {
  const base = tmpDir();
  repo(path.join(base, 'mono'), { origin: 'git@github.com:o/mono.git' });
  const sub = path.join(base, 'mono', 'packages', 'app');
  fs.mkdirSync(sub, { recursive: true });
  const r = resolveProject(sub);
  assert.deepStrictEqual([r.key, r.name], ['github.com/o/mono', 'app']);
});

test('a git worktree (.git file) uses the common config and its own HEAD', () => {
  const base = tmpDir();
  const main = path.join(base, 'main');
  repo(main, { origin: 'git@github.com:o/r.git' });
  const wtGit = path.join(main, '.git', 'worktrees', 'wt');
  fs.mkdirSync(wtGit, { recursive: true });
  fs.writeFileSync(path.join(wtGit, 'HEAD'), 'ref: refs/heads/issue-1-x\n');
  fs.writeFileSync(path.join(wtGit, 'commondir'), '../..\n');
  const wt = path.join(base, 'wt');
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${wtGit}\n`);
  assert.deepStrictEqual(resolveProject(wt), { key: 'github.com/o/r', name: 'wt', branch: 'issue-1-x' });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd extensions/null-activity && npx tsc -p tsconfig.json && node --test out/test/projectIdentity.test.js`
Expected: FAIL — `Cannot find module '../projectIdentity'`.

- [ ] **Step 3: Write `src/projectIdentity.ts`**

```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { ResolvedProject } from './types';

export const NO_FOLDER = '(no folder)';

/** `git@host:Owner/Repo.git`, `https://user:tok@host/owner/repo` and friends all map to `host/owner/repo`. */
export function normalizeRemote(url: string): string {
  let u = url.trim();
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/\/)(.+)$/.exec(u);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    u = `${scp[1]}/${scp[2]}`;
  } else {
    u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]+@/, '');
  }
  return u.replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

function normalizePath(folder: string): string {
  const p = path.resolve(folder).replace(/\\/g, '/');
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function findGitDirs(start: string): { gitDir: string; commonDir: string } | undefined {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const dotGit = path.join(dir, '.git');
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(dotGit);
    } catch {
      stat = undefined;
    }
    if (stat?.isDirectory()) return { gitDir: dotGit, commonDir: dotGit };
    if (stat?.isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readText(dotGit) ?? '');
      if (m) {
        const gitDir = path.resolve(dir, m[1].trim());
        const common = readText(path.join(gitDir, 'commondir'))?.trim();
        return { gitDir, commonDir: common ? path.resolve(gitDir, common) : gitDir };
      }
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

function remoteUrl(config: string): string | undefined {
  const urls = new Map<string, string>();
  let section: string | undefined;
  for (const line of config.split(/\r?\n/)) {
    const header = /^\s*\[remote "([^"]+)"\]/.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    if (/^\s*\[/.test(line)) {
      section = undefined;
      continue;
    }
    const url = section && !urls.has(section) ? /^\s*url\s*=\s*(.+?)\s*$/.exec(line) : null;
    if (section && url) urls.set(section, url[1]);
  }
  return urls.get('origin') ?? urls.values().next().value;
}

/** Called when the tracker opens an interval, never per heartbeat. */
export function resolveProject(folder: string | undefined): ResolvedProject {
  if (!folder) return { key: NO_FOLDER, name: NO_FOLDER };
  const name = path.basename(folder) || folder;
  const git = findGitDirs(folder);
  const remote = git ? remoteUrl(readText(path.join(git.commonDir, 'config')) ?? '') : undefined;
  const branch = git ? /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(readText(path.join(git.gitDir, 'HEAD')) ?? '')?.[1] : undefined;
  return {
    key: remote ? normalizeRemote(remote) : normalizePath(folder),
    name,
    ...(branch ? { branch } : {}),
  };
}
```

- [ ] **Step 4: Register the test and run**

Append ` out/test/projectIdentity.test.js` to the `test` script; run `npm --prefix extensions/null-activity test`.
Expected: all PASS. (The "no git" test assumes the OS temp dir is not inside a git repo.)

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src extensions/null-activity/package.json
git commit -m "feat(null-activity): project identity from git remote with path fallback"
git add extensions/null-activity/out
git commit -m "chore: refresh null-activity compiled output"
```

---

### Task 6: Activity service (public API)

**Files:**
- Create: `extensions/null-activity/src/activityService.ts`, `extensions/null-activity/src/test/activityService.test.ts`
- Modify: `extensions/null-activity/package.json` (append `out/test/activityService.test.js`)

**Interfaces:**
- Consumes: `Tracker` (Task 2), `IntervalStore` (Task 4), `stats` (Task 3), `ResolvedProject`, `Emitter`.
- Produces:
  - `interface ActivitySettings { enabled: boolean; idleTimeoutMs: number; sessionGapMs: number }`
  - `normalizeSettings(raw: { enabled?: unknown; idleTimeout?: unknown; sessionGap?: unknown }): ActivitySettings` (idle 10–3600 s default 120; gap 1–1440 min default 15; `enabled` false only when literally `false`)
  - `interface ActivityServiceOptions { store: IntervalStore; resolveProject: (workspace: string | undefined) => ResolvedProject; settings: () => ActivitySettings; clock?: () => number }`
  - `class ActivityService implements NullActivityApi` with extra members: `readonly enabled: boolean` (getter), `refresh(): void`, `setFocused(f: boolean): void`, `tick(): void`, `flush(): void`, `getMonthlyTotals(): DailyStat[]`, `deleteRange(range: DateRange): void`, `deleteAll(): void`, `dispose(): void`.

Reads are cached per range for 15 s and invalidated on any change (the TTL picks up other windows' writes). Live data = stored intervals + `tracker.peek()`.

- [ ] **Step 1: Write the failing test `src/test/activityService.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { ActivityService, ActivitySettings, normalizeSettings } from '../activityService';
import { IntervalStore } from '../intervalStore';
import { dayRange } from '../stats';
import { Heartbeat } from '../types';

const MIN = 60_000;
const at = (day: number, h: number, m = 0, s = 0) => new Date(2026, 9, day, h, m, s).getTime();
const hb = (ts: number, over: Partial<Heartbeat> = {}): Heartbeat => ({
  ts, language: 'typescript', file: 'a.ts', workspace: '/w', isWrite: false, linesAdded: 0, linesRemoved: 0, ...over,
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-svc-'));
  let now = at(8, 9);
  const settings: ActivitySettings = { enabled: true, idleTimeoutMs: 2 * MIN, sessionGapMs: 15 * MIN };
  const service = new ActivityService({
    store: new IntervalStore({ dir, windowId: 'w1' }),
    clock: () => now,
    settings: () => settings,
    resolveProject: (w) => ({ key: w ?? '(no folder)', name: 'proj' }),
  });
  return { service, settings, dir, at: (t: number) => { now = t; } };
}

const day = dayRange(at(8, 12));

test('the open interval is visible through the API; closing fires onDidChange and refreshes reads', () => {
  const { service } = setup();
  let changes = 0;
  service.onDidChange(() => changes++);
  service.recordActivity(hb(at(8, 9)));
  service.recordActivity(hb(at(8, 9, 1)));
  assert.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 9), at(8, 9, 1)]]);
  assert.strictEqual(changes, 0);
  service.recordActivity(hb(at(8, 9, 30), { file: 'b.ts' })); // gap > idle: closes at the last heartbeat
  assert.strictEqual(changes, 1);
  assert.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 9), at(8, 9, 1)]]);
});

test('daily, project, language, session and monthly stats are derived from the log', () => {
  const { service } = setup();
  service.recordActivity(hb(at(8, 9), { linesAdded: 3 }));
  service.recordActivity(hb(at(8, 9, 10)));
  service.recordActivity(hb(at(8, 9, 11), { language: 'rust', file: 'b.rs' }));
  service.recordActivity(hb(at(8, 9, 15), { language: 'rust', file: 'b.rs' }));
  service.endSession();
  assert.deepStrictEqual(service.getDailyStats(day), [{ day: '2026-10-08', ms: 15 * MIN }]);
  assert.deepStrictEqual(service.getLanguageStats(day).map((l) => l.language).sort(), ['rust', 'typescript']);
  const [project] = service.getProjectStats(day);
  assert.deepStrictEqual([project.ms, project.files, project.linesAdded], [15 * MIN, 2, 3]);
  assert.strictEqual(service.getSessions(day).length, 1);
  assert.deepStrictEqual(service.getMonthlyTotals(), [{ day: '2026-10-01', ms: 15 * MIN }]);
});

test('turning the master switch off closes the open interval and stops collection', () => {
  const { service, settings, at: setNow } = setup();
  service.recordActivity(hb(at(8, 9)));
  service.recordActivity(hb(at(8, 9, 1)));
  setNow(at(8, 9, 2));
  settings.enabled = false;
  service.refresh();
  assert.strictEqual(service.enabled, false);
  assert.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 9), at(8, 9, 2)]]);
  service.recordActivity(hb(at(8, 9, 3)));
  service.startSession(); // no-op while disabled
  service.recordActivity(hb(at(8, 9, 4)));
  service.recordActivity(hb(at(8, 9, 5)));
  assert.strictEqual(service.getIntervals(day).length, 1);
  settings.enabled = true;
  service.refresh();
  service.recordActivity(hb(at(8, 9, 10)));
  service.recordActivity(hb(at(8, 9, 11)));
  assert.strictEqual(service.getIntervals(day).length, 2);
});

test('pauseSession stops counting until startSession', () => {
  const { service, at: setNow } = setup();
  service.recordActivity(hb(at(8, 9)));
  setNow(at(8, 9, 1));
  service.pauseSession();
  service.recordActivity(hb(at(8, 9, 2)));
  service.recordActivity(hb(at(8, 9, 3)));
  assert.strictEqual(service.getIntervals(day).length, 1);
  service.startSession();
  service.recordActivity(hb(at(8, 9, 4)));
  service.recordActivity(hb(at(8, 9, 5)));
  assert.strictEqual(service.getIntervals(day).length, 2);
});

test('deleting a range while an interval is open does not bring the interval back', () => {
  const { service, at: setNow } = setup();
  service.recordActivity(hb(at(8, 9)));
  service.recordActivity(hb(at(8, 9, 1)));
  setNow(at(8, 9, 1, 30));
  service.deleteRange(day);
  assert.deepStrictEqual(service.getIntervals(day), []);
  service.recordActivity(hb(at(8, 9, 2)));
  service.recordActivity(hb(at(8, 9, 3)));
  assert.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 9, 2), at(8, 9, 3)]]);
  service.deleteAll();
  assert.deepStrictEqual(service.getIntervals(day), []);
});

test('normalizeSettings clamps nonsense to sane values', () => {
  const d = { enabled: true, idleTimeoutMs: 120_000, sessionGapMs: 15 * MIN };
  assert.deepStrictEqual(normalizeSettings({}), d);
  assert.deepStrictEqual(normalizeSettings({ enabled: false }), { ...d, enabled: false });
  assert.strictEqual(normalizeSettings({ idleTimeout: 0 }).idleTimeoutMs, 10_000);
  assert.strictEqual(normalizeSettings({ idleTimeout: -5 }).idleTimeoutMs, 10_000);
  assert.strictEqual(normalizeSettings({ idleTimeout: Number.NaN }).idleTimeoutMs, 120_000);
  assert.strictEqual(normalizeSettings({ idleTimeout: 'abc' }).idleTimeoutMs, 120_000);
  assert.strictEqual(normalizeSettings({ idleTimeout: 1e9 }).idleTimeoutMs, 3_600_000);
  assert.strictEqual(normalizeSettings({ sessionGap: 0 }).sessionGapMs, MIN);
  assert.strictEqual(normalizeSettings({ sessionGap: 1e9 }).sessionGapMs, 1_440 * MIN);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd extensions/null-activity && npx tsc -p tsconfig.json && node --test out/test/activityService.test.js`
Expected: FAIL — `Cannot find module '../activityService'`.

- [ ] **Step 3: Write `src/activityService.ts`**

```ts
'use strict';

import { Emitter, Event } from './emitter';
import { IntervalStore } from './intervalStore';
import { ALL_TIME, languageStats, normalizeIntervals, periodStats, projectStats, sessions } from './stats';
import { Tracker } from './tracker';
import {
  DailyStat, DateRange, Heartbeat, Interval, LanguageStat, NullActivityApi, ProjectStat, ResolvedProject, Session,
} from './types';

const CACHE_TTL_MS = 15_000;

export interface ActivitySettings {
  enabled: boolean;
  idleTimeoutMs: number;
  sessionGapMs: number;
}

export interface ActivityServiceOptions {
  store: IntervalStore;
  resolveProject: (workspace: string | undefined) => ResolvedProject;
  settings: () => ActivitySettings;
  clock?: () => number;
}

export function normalizeSettings(raw: { enabled?: unknown; idleTimeout?: unknown; sessionGap?: unknown }): ActivitySettings {
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    enabled: raw.enabled !== false,
    idleTimeoutMs: num(raw.idleTimeout, 120, 10, 3_600) * 1_000,
    sessionGapMs: num(raw.sessionGap, 15, 1, 1_440) * 60_000,
  };
}

export class ActivityService implements NullActivityApi {
  private readonly changed = new Emitter<void>();
  readonly onDidChange: Event<void> = this.changed.event;

  private readonly tracker: Tracker;
  private readonly clock: () => number;
  private cfg: ActivitySettings;
  private paused = false;
  private cache = new Map<string, { at: number; intervals: Interval[] }>();

  constructor(private readonly opts: ActivityServiceOptions) {
    this.clock = opts.clock ?? Date.now;
    this.cfg = { ...opts.settings() };
    this.tracker = new Tracker({
      clock: this.clock,
      idleTimeoutMs: () => this.cfg.idleTimeoutMs,
      resolveProject: opts.resolveProject,
      onInterval: (interval) => {
        opts.store.append(interval);
        this.dataChanged();
      },
    });
    this.refresh();
  }

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  /** Re-reads settings; call on configuration change. Disabling closes the open interval immediately. */
  refresh(): void {
    this.cfg = { ...this.opts.settings() };
    this.tracker.setActive(this.cfg.enabled && !this.paused);
  }

  startSession(): void {
    this.paused = false;
    this.refresh();
  }

  pauseSession(): void {
    this.paused = true;
    this.refresh();
  }

  endSession(): void {
    this.tracker.closeOpen();
    this.opts.store.flush();
  }

  recordActivity(h: Heartbeat): void {
    this.tracker.heartbeat(h);
  }

  setFocused(focused: boolean): void {
    this.tracker.setFocused(focused);
  }

  tick(): void {
    this.tracker.tick();
  }

  flush(): void {
    this.opts.store.flush();
  }

  /** Merged across windows, clipped to the range, including the in-progress interval. */
  getIntervals(range: DateRange): Interval[] {
    const key = `${range.from}:${range.to}`;
    let hit = this.cache.get(key);
    if (!hit || this.clock() - hit.at >= CACHE_TTL_MS) {
      hit = { at: this.clock(), intervals: this.opts.store.read(range) };
      this.cache.set(key, hit);
    }
    const open = this.tracker.peek();
    return normalizeIntervals(open ? [...hit.intervals, open] : hit.intervals, range);
  }

  getProjectStats(range: DateRange): ProjectStat[] {
    return projectStats(this.getIntervals(range), range);
  }

  getLanguageStats(range: DateRange): LanguageStat[] {
    return languageStats(this.getIntervals(range), range);
  }

  getDailyStats(range: DateRange): DailyStat[] {
    return periodStats(this.getIntervals(range), range, 'day');
  }

  getSessions(range: DateRange): Session[] {
    return sessions(this.getIntervals(range), range, this.cfg.sessionGapMs);
  }

  getMonthlyTotals(): DailyStat[] {
    return periodStats(this.getIntervals(ALL_TIME), ALL_TIME, 'month');
  }

  /** Closes the open interval first so it is deleted with the rest instead of reappearing. */
  deleteRange(range: DateRange): void {
    this.tracker.closeOpen();
    this.opts.store.deleteRange(range);
    this.dataChanged();
  }

  deleteAll(): void {
    this.tracker.closeOpen();
    this.opts.store.deleteAll();
    this.dataChanged();
  }

  dispose(): void {
    this.endSession();
    this.changed.dispose();
  }

  private dataChanged(): void {
    this.cache.clear();
    this.changed.fire();
  }
}
```

- [ ] **Step 4: Register the test and run**

Append ` out/test/activityService.test.js` to the `test` script; run `npm --prefix extensions/null-activity test`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src extensions/null-activity/package.json
git commit -m "feat(null-activity): activity service with public API, settings and deletion"
git add extensions/null-activity/out
git commit -m "chore: refresh null-activity compiled output"
```

---

### Task 7: Privacy helpers

**Files:**
- Create: `extensions/null-activity/src/privacy.ts`, `extensions/null-activity/src/test/privacy.test.ts`
- Modify: `extensions/null-activity/package.json` (append `out/test/privacy.test.js`)

**Interfaces:**
- Consumes: `dayRange`, `lastDaysRange`, `monthRange`, `nextPeriodStart`, `formatDuration` (stats); `DateRange`, `DailyStat`.
- Produces: `type RangeChoice = 'today' | 'last7' | 'month'`; `choiceRange(choice, now): DateRange`; `parseDay(text): number | undefined` (local midnight of a real `YYYY-MM-DD`); `customRange(fromText, toText): DateRange | undefined` (end day inclusive, `undefined` if invalid or reversed); `trackedDataReport(info: { storageDir: string; enabled: boolean; months: DailyStat[] }): string`.

- [ ] **Step 1: Write the failing test `src/test/privacy.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { choiceRange, customRange, parseDay, trackedDataReport } from '../privacy';

const at = (day: number, h = 0, month = 9) => new Date(2026, month, day, h).getTime();

test('choiceRange', () => {
  const now = at(8, 15);
  assert.deepStrictEqual(choiceRange('today', now), { from: at(8), to: at(9) });
  assert.deepStrictEqual(choiceRange('last7', now), { from: at(2), to: at(9) });
  assert.deepStrictEqual(choiceRange('month', now), { from: at(1), to: at(1, 0, 10) });
});

test('parseDay accepts only real YYYY-MM-DD dates', () => {
  assert.strictEqual(parseDay('2026-10-08'), at(8));
  for (const bad of ['2026-02-31', '2026-13-01', 'abc', '2026-1-1', '', ' 2026-10-08']) {
    assert.strictEqual(parseDay(bad), undefined, bad);
  }
});

test('customRange includes the end day and rejects reversed or invalid input', () => {
  assert.deepStrictEqual(customRange('2026-10-05', '2026-10-07'), { from: at(5), to: at(8) });
  assert.deepStrictEqual(customRange('2026-10-05', '2026-10-05'), { from: at(5), to: at(6) });
  assert.strictEqual(customRange('2026-10-07', '2026-10-05'), undefined);
  assert.strictEqual(customRange('nope', '2026-10-05'), undefined);
});

test('trackedDataReport lists fields, storage, state and monthly totals', () => {
  const text = trackedDataReport({
    storageDir: 'C:\\store',
    enabled: true,
    months: [{ day: '2026-09-01', ms: 125 * 60_000 }, { day: '2026-10-01', ms: 5 * 60_000 }],
  });
  for (const needle of ['C:\\store', 'on', 'git branch', 'Never recorded', 'no network', '2026-09  2h 5m', '2026-10  5m']) {
    assert.ok(text.includes(needle), needle);
  }
  assert.ok(trackedDataReport({ storageDir: 'x', enabled: false, months: [] }).includes('(no data yet)'));
  assert.ok(trackedDataReport({ storageDir: 'x', enabled: false, months: [] }).includes('Tracking: off'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd extensions/null-activity && npx tsc -p tsconfig.json && node --test out/test/privacy.test.js`
Expected: FAIL — `Cannot find module '../privacy'`.

- [ ] **Step 3: Write `src/privacy.ts`**

```ts
'use strict';

import { dayRange, formatDuration, lastDaysRange, monthRange, nextPeriodStart } from './stats';
import { DailyStat, DateRange } from './types';

export type RangeChoice = 'today' | 'last7' | 'month';

export function choiceRange(choice: RangeChoice, now: number): DateRange {
  if (choice === 'today') return dayRange(now);
  if (choice === 'last7') return lastDaysRange(now, 7);
  return monthRange(now);
}

/** Local midnight of a real `YYYY-MM-DD` date, otherwise undefined. */
export function parseDay(text: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date.getTime() : undefined;
}

/** `to` is an inclusive day. */
export function customRange(fromText: string, toText: string): DateRange | undefined {
  const from = parseDay(fromText);
  const toDay = parseDay(toText);
  if (from === undefined || toDay === undefined || toDay < from) return undefined;
  return { from, to: nextPeriodStart(toDay, 'day') };
}

export function trackedDataReport(info: { storageDir: string; enabled: boolean; months: DailyStat[] }): string {
  const totals = info.months.length
    ? info.months.map((m) => `  ${m.day.slice(0, 7)}  ${formatDuration(m.ms)}`).join('\n')
    : '  (no data yet)';
  return [
    'Null Activity — tracked data',
    '',
    'Recorded for each stretch of activity:',
    '  start and end time, project (git remote URL, or folder path when there is no remote,',
    '  plus the folder name), language, file (path relative to the workspace), git branch,',
    '  lines added and removed.',
    '',
    'Never recorded: file contents, diffs, or source text.',
    'Nothing leaves this machine: Null Activity has no network code.',
    '',
    `Storage: ${info.storageDir}`,
    `Tracking: ${info.enabled ? 'on' : 'off'} (setting null-activity.enabled)`,
    '',
    'Totals by month:',
    totals,
    '',
    'Delete data with "Null Activity: Delete Tracked Data for a Range…" or "Null Activity: Delete All Tracked Data…".',
    '',
  ].join('\n');
}
```

- [ ] **Step 4: Register the test and run**

Append ` out/test/privacy.test.js` to the `test` script; run `npm --prefix extensions/null-activity test`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src extensions/null-activity/package.json
git commit -m "feat(null-activity): privacy helpers (ranges, date parsing, tracked-data report)"
git add extensions/null-activity/out
git commit -m "chore: refresh null-activity compiled output"
```

---

### Task 8: VS Code wiring (heartbeat source, status bar, commands, activation)

**Files:**
- Create: `extensions/null-activity/src/heartbeatSource.ts`, `extensions/null-activity/src/statusBar.ts`, `extensions/null-activity/src/commands.ts`
- Modify: `extensions/null-activity/src/extension.ts` (replace the stub)

These four files import `vscode` and are exercised by the integration spec in Task 9, not by `node --test`.

**Interfaces:**
- Consumes: `ActivityService` (Task 6), `lineDelta` (Task 2), `resolveProject` (Task 5), `IntervalStore` (Task 4), `privacy` (Task 7), `dayRange`/`formatDuration` (Task 3).
- Produces: `startHeartbeatSource(service): vscode.Disposable`; `class StatusBar { constructor(service); update(): void; dispose(): void }`; `registerCommands(context, service, storageDir): void`; `activate(context): NullActivityApi`.

Deliberate limits to keep in the code comments: the stable API exposes no terminal keystrokes, so terminal activity is shell-integration command start/end plus active-terminal changes; only edits to the active editor's document count (background refactor edits are ignored).

- [ ] **Step 1: Write `src/heartbeatSource.ts`**

```ts
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { ActivityService } from './activityService';
import { lineDelta } from './tracker';

const TRACKED_SCHEMES = new Set(['file', 'untitled']);

const isTracked = (doc: vscode.TextDocument | undefined): doc is vscode.TextDocument =>
  !!doc && TRACKED_SCHEMES.has(doc.uri.scheme);

function contextOf(doc: vscode.TextDocument | undefined): { file?: string; language: string; workspace?: string } {
  const folder = (doc && vscode.workspace.getWorkspaceFolder(doc.uri)) ?? vscode.workspace.workspaceFolders?.[0];
  const workspace = folder?.uri.fsPath;
  const language = doc?.languageId ?? '';
  if (doc?.uri.scheme !== 'file') return { language, workspace };
  const rel = folder ? path.relative(folder.uri.fsPath, doc.uri.fsPath) : '';
  const inside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  return { file: (inside ? rel : path.basename(doc.uri.fsPath)).replace(/\\/g, '/'), language, workspace };
}

/**
 * Turns VS Code events into heartbeats. The stable API exposes no terminal keystrokes, so terminal
 * activity is shell-integration command start/end plus active-terminal changes. Only edits to the
 * active editor's document count, so background refactors do not switch the tracked file.
 */
export function startHeartbeatSource(service: ActivityService): vscode.Disposable {
  const send = (
    doc: vscode.TextDocument | undefined,
    extra: { isWrite?: boolean; linesAdded?: number; linesRemoved?: number } = {},
  ): void =>
    service.recordActivity({ ts: Date.now(), ...contextOf(doc), isWrite: false, linesAdded: 0, linesRemoved: 0, ...extra });
  const active = () => vscode.window.activeTextEditor?.document;

  return vscode.Disposable.from(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length > 0 && e.document === active() && isTracked(e.document)) {
        send(e.document, lineDelta(e.contentChanges));
      }
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (isTracked(e.textEditor.document)) send(e.textEditor.document);
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (isTracked(e.textEditor.document)) send(e.textEditor.document);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (isTracked(editor?.document)) send(editor!.document);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isTracked(doc)) send(doc, { isWrite: true });
    }),
    vscode.window.onDidChangeActiveTerminal(() => send(undefined)),
    vscode.window.onDidStartTerminalShellExecution(() => send(undefined)),
    vscode.window.onDidEndTerminalShellExecution(() => send(undefined)),
    vscode.debug.onDidStartDebugSession(() => send(active())),
    vscode.debug.onDidTerminateDebugSession(() => send(active())),
    vscode.window.onDidChangeWindowState((state) => service.setFocused(state.focused)),
  );
}
```

- [ ] **Step 2: Write `src/statusBar.ts`**

```ts
'use strict';

import * as vscode from 'vscode';
import { ActivityService } from './activityService';
import { dayRange, formatDuration } from './stats';

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  private readonly subscription: { dispose(): void };
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly service: ActivityService) {
    this.item.command = 'null-activity.showTrackedData';
    this.subscription = service.onDidChange(() => this.update());
    this.timer = setInterval(() => this.update(), 60_000);
    this.update();
    this.item.show();
  }

  update(): void {
    if (!this.service.enabled) {
      this.item.text = '$(clock) Off';
      this.item.tooltip = 'Null Activity: tracking is off (setting null-activity.enabled)';
      return;
    }
    const ms = this.service.getDailyStats(dayRange(Date.now())).reduce((n, d) => n + d.ms, 0);
    this.item.text = `$(clock) ${formatDuration(ms)}`;
    this.item.tooltip = 'Null Activity: time tracked today. Click to see what is recorded.';
  }

  dispose(): void {
    clearInterval(this.timer);
    this.subscription.dispose();
    this.item.dispose();
  }
}
```

- [ ] **Step 3: Write `src/commands.ts`**

```ts
'use strict';

import * as vscode from 'vscode';
import { ActivityService } from './activityService';
import { RangeChoice, choiceRange, customRange, parseDay, trackedDataReport } from './privacy';

const SCHEME = 'null-activity';

interface RangePick extends vscode.QuickPickItem {
  id: RangeChoice | 'custom';
}

export function registerCommands(context: vscode.ExtensionContext, service: ActivityService, storageDir: string): void {
  const report = () => trackedDataReport({ storageDir, enabled: service.enabled, months: service.getMonthlyTotals() });

  context.subscriptions.push(
    // A content provider is read-only by construction; a fresh query per call forces a fresh read.
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: report }),

    vscode.commands.registerCommand('null-activity.showTrackedData', async () => {
      const uri = vscode.Uri.from({ scheme: SCHEME, path: '/Tracked data.txt', query: String(Date.now()) });
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
    }),

    vscode.commands.registerCommand('null-activity.deleteRange', async () => {
      const picks: RangePick[] = [
        { label: 'Today', id: 'today' },
        { label: 'Last 7 days', id: 'last7' },
        { label: 'This month', id: 'month' },
        { label: 'Custom…', id: 'custom' },
      ];
      const pick = await vscode.window.showQuickPick(picks, { placeHolder: 'Delete tracked activity for…' });
      if (!pick) return;

      let range;
      let label = pick.label.toLowerCase();
      if (pick.id === 'custom') {
        const validateInput = (v: string) => (parseDay(v) === undefined ? 'Use YYYY-MM-DD' : undefined);
        const from = await vscode.window.showInputBox({ prompt: 'First day to delete (YYYY-MM-DD)', validateInput });
        if (!from) return;
        const to = await vscode.window.showInputBox({ prompt: 'Last day to delete, inclusive (YYYY-MM-DD)', value: from, validateInput });
        if (!to) return;
        range = customRange(from, to);
        if (!range) {
          void vscode.window.showErrorMessage('Null Activity: the last day is before the first day.');
          return;
        }
        label = `${from} to ${to}`;
      } else {
        range = choiceRange(pick.id, Date.now());
      }

      const answer = await vscode.window.showWarningMessage(
        `Delete tracked activity for ${label}? This cannot be undone.`,
        { modal: true },
        'Delete',
      );
      if (answer !== 'Delete') return;
      try {
        service.deleteRange(range);
        void vscode.window.showInformationMessage(`Null Activity: deleted tracked activity for ${label}.`);
      } catch (err) {
        void vscode.window.showErrorMessage(`Null Activity: could not delete data (${err instanceof Error ? err.message : String(err)}).`);
      }
    }),

    vscode.commands.registerCommand('null-activity.deleteAll', async () => {
      const answer = await vscode.window.showWarningMessage(
        'Delete ALL tracked activity? This cannot be undone.',
        { modal: true },
        'Delete All',
      );
      if (answer !== 'Delete All') return;
      try {
        service.deleteAll();
        void vscode.window.showInformationMessage('Null Activity: all tracked activity deleted.');
      } catch (err) {
        void vscode.window.showErrorMessage(`Null Activity: could not delete data (${err instanceof Error ? err.message : String(err)}).`);
      }
    }),
  );
}
```

- [ ] **Step 4: Replace `src/extension.ts`**

```ts
'use strict';

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ActivityService, ActivitySettings, normalizeSettings } from './activityService';
import { registerCommands } from './commands';
import { startHeartbeatSource } from './heartbeatSource';
import { IntervalStore } from './intervalStore';
import { resolveProject } from './projectIdentity';
import { StatusBar } from './statusBar';
import { NullActivityApi } from './types';

function readSettings(): ActivitySettings {
  const cfg = vscode.workspace.getConfiguration('null-activity');
  return normalizeSettings({ enabled: cfg.get('enabled'), idleTimeout: cfg.get('idleTimeout'), sessionGap: cfg.get('sessionGap') });
}

export function activate(context: vscode.ExtensionContext): NullActivityApi {
  const output = vscode.window.createOutputChannel('Null Activity');
  const storageDir = context.globalStorageUri.fsPath;
  const windowId = crypto.createHash('sha1').update(vscode.env.sessionId).digest('hex').slice(0, 10);

  const store = new IntervalStore({ dir: storageDir, windowId, log: (message) => output.appendLine(message) });
  const service = new ActivityService({ store, resolveProject, settings: readSettings });
  service.setFocused(vscode.window.state.focused);
  const statusBar = new StatusBar(service);

  const timers = [setInterval(() => service.tick(), 15_000), setInterval(() => service.flush(), 30_000)];

  context.subscriptions.push(
    output,
    service,
    statusBar,
    startHeartbeatSource(service),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('null-activity')) {
        service.refresh();
        statusBar.update();
      }
    }),
    { dispose: () => timers.forEach(clearInterval) },
  );
  registerCommands(context, service, storageDir);

  // Expose the read/session API only; deletion stays behind the user-confirmed commands.
  return {
    startSession: () => service.startSession(),
    pauseSession: () => service.pauseSession(),
    endSession: () => service.endSession(),
    recordActivity: (h) => service.recordActivity(h),
    getProjectStats: (r) => service.getProjectStats(r),
    getLanguageStats: (r) => service.getLanguageStats(r),
    getDailyStats: (r) => service.getDailyStats(r),
    getSessions: (r) => service.getSessions(r),
    getIntervals: (r) => service.getIntervals(r),
    onDidChange: service.onDidChange,
  };
}

export function deactivate(): void {}
```

- [ ] **Step 5: Compile and run the unit tests**

Run: `npm --prefix extensions/null-activity run compile && npm --prefix extensions/null-activity test`
Expected: no tsc errors; all unit tests PASS. If tsc reports that `onDidStartTerminalShellExecution` is missing, `@types/vscode` resolved below 1.93 — run `npm install @types/vscode@^1.93.0 --save-dev` in the extension.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-activity/src extensions/null-activity/package.json extensions/null-activity/package-lock.json
git commit -m "feat(null-activity): wire heartbeat source, status bar, commands and activation"
git add extensions/null-activity/out
git commit -m "chore: refresh null-activity compiled output"
```

---

### Task 9: Integration spec (event wiring)

**Files:**
- Create: `extensions/null-activity/src/test/runTest.ts`, `extensions/null-activity/src/test/suite/index.ts`, `extensions/null-activity/src/test/suite/activation.spec.ts`
- Modify: `extensions/null-activity/package.json` (add integration scripts)

**Interfaces:**
- Consumes: the exported `NullActivityApi`; `scripts/sync-local.ps1` must have synced the extension into the installed Null IDE (Task 1, Step 8).

The status-bar text cannot be read from the extension host, so the spec asserts the interval through the API and the tracked-data report; the status bar's text is `formatDuration` over the same data, covered by the unit tests.

- [ ] **Step 1: Add scripts to `package.json`**

```json
    "pretest:integration": "tsc -p tsconfig.json",
    "test:integration": "node ./out/test/runTest.js"
```

(Add after `test`, keeping valid JSON commas.)

- [ ] **Step 2: Write `src/test/runTest.ts`**

```ts
'use strict';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';

async function main(): Promise<void> {
  const installDir = process.env.NULL_IDE_INSTALL_DIR
    ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Null IDE');

  const extensionDevelopmentPath = path.join(installDir, 'resources', 'app', 'extensions', 'null-activity');
  if (!fs.existsSync(extensionDevelopmentPath)) {
    throw new Error(`Synced null-activity not found at '${extensionDevelopmentPath}'. Run scripts/sync-local.ps1 first.`);
  }

  // Null IDE's own executable can't host this run: its fixed win32MutexName collides with the
  // already-running Null IDE window. A vanilla VS Code build loads the exact synced extension code.
  const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-spec-workspace-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-spec-userdata-'));
  const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-spec-extensions-'));

  // Inherited from an Electron parent (e.g. an IDE terminal), it would run Electron as plain Node.
  delete process.env.ELECTRON_RUN_AS_NODE;

  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspaceDir, '--user-data-dir', userDataDir, '--extensions-dir', extensionsDir],
    });
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(extensionsDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Failed to run integration specs');
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Write `src/test/suite/index.ts`**

```ts
'use strict';

import * as path from 'path';
import { glob } from 'glob';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true });
  const testsRoot = path.resolve(__dirname);

  return new Promise((resolve, reject) => {
    glob('**/*.spec.js', { cwd: testsRoot }).then((files) => {
      files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));
      try {
        mocha.run((failures: number) => (failures > 0 ? reject(new Error(`${failures} spec(s) failed.`)) : resolve()));
      } catch (err) {
        reject(err);
      }
    }).catch(reject);
  });
}
```

- [ ] **Step 4: Write `src/test/suite/activation.spec.ts`**

```ts
'use strict';

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { NullActivityApi } from '../../types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite('null-activity', () => {
  test('activates, exports the API and registers the privacy commands', async () => {
    const api = await vscode.extensions.getExtension<NullActivityApi>('null.null-activity')!.activate();
    assert.strictEqual(typeof api.getIntervals, 'function');
    assert.strictEqual('deleteAll' in api, false, 'deletion must not be part of the public API');
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['null-activity.showTrackedData', 'null-activity.deleteRange', 'null-activity.deleteAll']) {
      assert.ok(commands.includes(id), `${id} not registered`);
    }
  });

  test('editing a file records an interval that the tracked-data report reflects', async function () {
    this.timeout(30_000);
    if (!vscode.window.state.focused) this.skip(); // heartbeats only count while the window is focused

    const api = await vscode.extensions.getExtension<NullActivityApi>('null.null-activity')!.activate();
    const file = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'activity-spec.txt');
    fs.writeFileSync(file, '');

    const before = Date.now();
    const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    await editor.edit((b) => b.insert(new vscode.Position(0, 0), 'hello\n'));
    await sleep(200);
    await editor.edit((b) => b.insert(new vscode.Position(0, 0), 'world\n'));

    const mine = api
      .getIntervals({ from: before - 60_000, to: Date.now() + 60_000 })
      .filter((i) => i.file === 'activity-spec.txt');
    assert.ok(mine.length > 0, 'no interval recorded for the edited file');
    assert.ok(mine.every((i) => i.end > i.start));
    assert.strictEqual(mine[0].language, 'plaintext');
    assert.ok(mine.reduce((n, i) => n + i.linesAdded, 0) >= 2, 'expected the two inserted lines to be counted');

    await vscode.commands.executeCommand('null-activity.showTrackedData');
    const doc = vscode.window.activeTextEditor!.document;
    assert.strictEqual(doc.uri.scheme, 'null-activity');
    assert.ok(doc.getText().includes('Totals by month'));
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });
});
```

- [ ] **Step 5: Compile**

Run: `npm --prefix extensions/null-activity run compile`
Expected: no tsc errors.

- [ ] **Step 6: Sync and run the integration spec**

Use the `verify-local` skill with argument `null-activity` (it runs `scripts/sync-local.ps1`, then `npm --prefix extensions/null-activity run test:integration`).
Expected: both specs pass. If the second reports as pending (skipped), the host window was not focused — rerun with the VS Code test window in the foreground. If it fails with no interval recorded, add `console.log(api.getIntervals({ from: 0, to: Date.now() + 60_000 }))` to see whether heartbeats arrive, then check the `e.document === active()` guard in `heartbeatSource.ts`.

- [ ] **Step 7: Commit**

```bash
git add extensions/null-activity/src extensions/null-activity/package.json
git commit -m "test(null-activity): integration spec for event wiring"
git add extensions/null-activity/out
git commit -m "chore: refresh null-activity compiled output"
```

---

### Task 10: Documentation

**Files:**
- Modify: `CLAUDE.md` (lines ~12, 13, 53, 54; new section after the `null-music` section)

- [ ] **Step 1: Update the extension counts and lists in `CLAUDE.md`**

- Line 12: `Nine built-in extensions` → `Ten built-in extensions`; append `` `null-activity` `` to the list.
- Line 13: `bundled as a tenth built-in extension` → `bundled as an eleventh built-in extension`.
- Line 53: append `` `null-activity` `` to the list of TS extensions compiled in CI.
- Line 54: `Copy all nine built-in extensions` → `Copy all ten built-in extensions`.

- [ ] **Step 2: Add the section after `### null-music`**

```markdown
### null-activity (`extensions/null-activity/`)
Local-only activity tracking (issue #113; engine only — dashboard, git stats, badge and WakaTime import are later specs). Activated on `onStartupFinished`; returns `NullActivityApi` (`getIntervals`, `getDailyStats`, `getProjectStats`, `getLanguageStats`, `getSessions`, `recordActivity`, `start/pause/endSession`, `onDidChange`) from `activate`. Deletion is deliberately not on the API. Everything is derived from an append-only interval log: `intervals-YYYY-MM-<windowId>.jsonl` under `globalStorageUri`, one file per window session so concurrent windows never clobber each other; `stats.ts` merges and clips overlaps. `Tracker` is a pure state machine over `Heartbeat`s with an injected clock (one close rule: end at the closing time if within `idleTimeout` of the last heartbeat, else at the last heartbeat); only `heartbeatSource.ts`, `statusBar.ts`, `commands.ts` and `extension.ts` import `vscode`. Heartbeats count only while the window is focused and only for edits to the active editor; terminal activity is shell-integration command start/end (no keystroke API exists). Project key is the normalized git remote (worktree-aware), falling back to the folder path. `null-activity.enabled` is the master switch. No network code. Design: `docs/specs/null-activity-engine-design.md`; plan: `docs/plans/null-activity-engine.md`. Integration spec: `npm run test:integration` (via `/verify-local null-activity`).
```

- [ ] **Step 3: Refresh the knowledge graph**

Run: `graphify update .`
If `git status` shows tracked changes under `graphify-out/`, commit them as `chore: refresh graphify output`; otherwise nothing to do.

- [ ] **Step 4: Final verification**

Run: `npm --prefix extensions/null-activity test` — all unit tests PASS.
Run: `git status --short` — only the pre-existing `extensions/null-music/media/music.svg` change remains.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the null-activity extension"
```

---

## Self-Review

- **Spec coverage:** data model → Task 1 `types.ts`; tracker (idle, focus, project/language/file switch, clock jump, `tick()`, disabled) → Task 2; stats (merge/clip, sessions, day/week/month, Monday, local days) → Task 3; store (buffered flush, torn line, month split, delete, cap, never throws) → Task 4; project identity → Task 5; service + API + `onDidChange` + lazy cache → Task 6; privacy master switch, commands, report → Tasks 6–8; status bar → Task 8; heartbeat source → Task 8; settings → Tasks 1 and 6; integration spec → Task 9; repository wiring (CI, sync-local, build-local, CLAUDE.md) → Tasks 1 and 10.
- **Deviations from the spec, on purpose:** (1) terminal "input" is shell-execution start/end because VS Code's stable API has no terminal keystroke event; (2) the integration spec checks the interval via the API and the tracked-data report rather than the status-bar text, which the extension host cannot read; (3) the cache is per-range with a 15 s TTL instead of a per-month index, so other windows' writes show up; (4) engines raised to `^1.93.0` for the shell-execution events (the bundled VS Code is far newer).
- **Type consistency:** `closeOpen`, `peek`, `setActive`, `setFocused`, `tick` (Tracker) match their uses in `ActivityService`; `ALL_TIME`, `normalizeIntervals`, `periodStats`, `nextPeriodStart` (stats) match imports in the store, service and privacy; `ResolvedProject` lives in `types.ts` and is imported by tracker, identity and service.
- **Placeholder scan:** none.

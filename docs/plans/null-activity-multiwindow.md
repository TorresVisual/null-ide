# Null Activity Multi-Window Counting Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Parallel windows and agent sessions all count: an unfocused window keeps recording, per-project and per-language numbers sum each window's own time, and the headline total and sessions stay the wall-clock union.

**Architecture:** Drop the focus gate in `Tracker`. Give every extension-host launch its own random window id (today `env.sessionId` is shared by all windows of one app launch, so they all append to one file) and have `IntervalStore.read` tag each interval with its window. `stats.ts` gains `attributedIntervals` (merge per window, then sum; a WakaTime import only fills gaps the live windows left) used by `projectStats`/`languageStats`/session contents, while `normalizeIntervals` (union) stays behind daily/monthly totals, hourly bars and session durations. `ActivityService` passes un-merged tagged intervals into the stats functions.

**Tech Stack:** TypeScript, `node --test`. No new dependency.

**Spec:** none written (the user skipped it). Design decisions were agreed in chat and are recorded under "Decisions" below; engine background is in `docs/specs/null-activity-engine-design.md`.

All commands run from `extensions/null-activity/` unless a step says otherwise.

## Decisions (agreed in chat, 2026-10-11)

- Every window or agent session extends its own heartbeat independently, focused or not.
- Per-project / per-language numbers **sum** across windows (three agents × 10 min = 30 min on the project table).
- The headline total (`getDailyStats`, `getMonthlyTotals`, dashboard `totalMs`, hourly bars) and session durations use the **union** of all windows' time (three agents × 10 min = 10 min).
- A WakaTime import records the same activity Null IDE saw itself: it is clipped against live windows (live wins) and only fills gaps.
- Out of scope: cross-window staleness (up to ~45 s), deletion racing with other windows, file compaction, counting typing in the Claude chat panel (VS Code has no event for it).

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

- `out/` is tracked: after editing `src/`, run `npm run compile` and commit the refreshed `out/` in its own `chore: refresh null-activity compiled output` commit. Never hand-edit `out/`.
- `npm test` runs an explicit list of `out/test/*.test.js` files; this plan adds no new test file, so the list stays unchanged.
- `NullActivityApi` (`types.ts`) keeps its method list; the only type change is the optional `Interval.window` field.
- The interval log format on disk is unchanged (`window` is never written; legacy files stay readable).
- Do not push. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A window that goes silent while unfocused must still stop at its last heartbeat (idle time is never credited) — Task 1 test.
2. Legacy / untagged intervals (no `window`) behave as one window, exactly like today — Task 3 test.
3. A WakaTime import fully covered by live data contributes nothing; one with a live interval in the middle splits into two pieces — Task 3 tests.
4. A session spanning three parallel projects lists all three projects, but its duration is the union — Task 3 test.
5. An unflushed own interval is tagged with this window's id, and `deleteRange` never persists the `window` tag into a file — Task 2 tests.

---

### Task 1: Tracker counts unfocused windows

**Files:**
- Modify: `src/tracker.ts:25-31,53-56`
- Modify: `src/activityService.ts:91-93`
- Modify: `src/heartbeatSource.ts:60`
- Modify: `src/extension.ts:28`
- Modify: `src/test/tracker.test.ts:93-116`
- Modify: `src/test/suite/activation.spec.ts:24`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Tracker` and `ActivityService` no longer have `setFocused`. Heartbeats are accepted whenever `active` is true.

- [ ] **Step 1: Replace the two focus tests**

In `src/test/tracker.test.ts` replace the two tests at lines 93-116 (`focus loss closes the interval…` and `focus loss after a long silence…`) with:

```ts
test('a window that is never focused still accrues time, and a long silence is not credited', () => {
  const { tracker, out, at } = setup();
  tracker.heartbeat(hb(0));
  tracker.heartbeat(hb(10_000));
  at(10_000 + IDLE + 5_000);
  tracker.closeOpen();
  assert.deepStrictEqual(out.map((i) => [i.start, i.end]), [[0, 10_000]], 'ends at the last heartbeat, not at the closing time');
});
```

- [ ] **Step 2: Run to confirm the old API is what still compiles**

Run: `npx tsc -p tsconfig.json && node --test out/test/tracker.test.js`
Expected: PASS (the new test passes against the old code too, because it never calls `setFocused`; the removal below is verified by the compiler in Step 4).

- [ ] **Step 3: Remove the focus gate**

`src/tracker.ts`: delete `private focused = true;` (line 25), change line 31 to
```ts
    if (!this.active) return;
```
and delete the whole `setFocused` method (lines 53-56, including the blank line after it).

`src/activityService.ts`: delete the `setFocused` method (lines 91-93 and one blank line).

`src/heartbeatSource.ts`: delete line 60 (`vscode.window.onDidChangeWindowState(...)`).

`src/extension.ts`: delete line 28 (`service.setFocused(vscode.window.state.focused);`).

`src/test/suite/activation.spec.ts`: delete line 24 (`if (!vscode.window.state.focused) this.skip(); // heartbeats only count while the window is focused`).

- [ ] **Step 4: Compile and run the unit tests**

Run: `npm test`
Expected: PASS, and `tsc` reports no reference to `setFocused` (any leftover caller is a compile error — fix it by deleting the call).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src
git commit -m "feat(null-activity): count heartbeats from unfocused windows"
```

---

### Task 2: One log file per window, intervals tagged with their window

**Files:**
- Modify: `src/types.ts:14-23`
- Modify: `src/intervalStore.ts:8,96-101,160` (+ new exports)
- Modify: `src/extension.ts:3,24-26`
- Test: `src/test/intervalStore.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `Interval.window?: string` — set by `IntervalStore.read`, never persisted.
  - `IntervalStore.windowId: string` (getter).
  - `newWindowId(): string` exported from `intervalStore.ts` — 10 lowercase hex chars, unique per call.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/intervalStore.test.ts` (and extend the import to `import { IntervalStore, newWindowId } from '../intervalStore';`):

```ts
test('read tags every interval with its window: files by file name, the unflushed buffer with its own id', () => {
  const dir = tmpDir();
  const a = new IntervalStore({ dir, windowId: 'w1' });
  const b = new IntervalStore({ dir, windowId: 'w2' });
  a.append(iv(at(8, 10), at(8, 11)));
  a.flush();
  b.append(iv(at(8, 12), at(8, 13)));
  fs.writeFileSync(path.join(dir, 'intervals-2026-10-import-wakatime.jsonl'), JSON.stringify(iv(at(8, 14), at(8, 15))) + '\n');
  const got = a.read(dayRange(at(8, 12))).sort(byStart);
  assert.deepStrictEqual(got.map((i) => i.window), ['w1', 'import-wakatime'], 'a does not see the unflushed buffer of b');
  const own = b.read(dayRange(at(8, 12))).sort(byStart);
  assert.deepStrictEqual(own.map((i) => i.window), ['w1', 'w2', 'import-wakatime']);
  assert.strictEqual(b.windowId, 'w2');
});

test('the window tag is never written to disk, not even by deleteRange', () => {
  const dir = tmpDir();
  const store = new IntervalStore({ dir, windowId: 'w1' });
  store.append(iv(at(8, 10), at(8, 11)));
  store.append(iv(at(9, 10), at(9, 11)));
  store.flush();
  store.deleteRange(dayRange(at(9, 12)));
  const text = fs.readFileSync(path.join(dir, 'intervals-2026-10-w1.jsonl'), 'utf8');
  assert.ok(!text.includes('"window"'), text);
  assert.strictEqual(store.read({ from: at(1, 0), to: at(30, 0) }).length, 1);
});

test('newWindowId yields a fresh filename-safe id on every call', () => {
  const ids = new Set(Array.from({ length: 50 }, () => newWindowId()));
  assert.strictEqual(ids.size, 50);
  assert.ok([...ids].every((id) => /^[0-9a-f]{10}$/.test(id)));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc -p tsconfig.json; node --test out/test/intervalStore.test.js`
Expected: FAIL / compile error — `newWindowId` and `windowId`/`window` do not exist.

- [ ] **Step 3: Implement**

`src/types.ts`: add to `Interval` after `linesRemoved`:
```ts
  window?: string; // set when read back from the log (the file name's window id), never persisted
```

`src/intervalStore.ts`:
- add `import * as crypto from 'crypto';` with the other imports.
- change `FILE_RE` to capture the window: `const FILE_RE = /^intervals-(\d{4})-(\d{2})-(.+)\.jsonl$/;`
- add after `monthKey`:
```ts
/** A fresh id per extension-host launch. `env.sessionId` is shared by every window of one app launch, so it cannot tell windows apart. */
export const newWindowId = (): string => crypto.randomBytes(5).toString('hex');
```
- inside the class add `get windowId(): string { return this.opts.windowId; }` right after the constructor.
- replace `read` with:
```ts
  read(range: DateRange): Interval[] {
    const out: Interval[] = [];
    for (const name of this.listFiles(range)) {
      const window = FILE_RE.exec(name)![3];
      for (const i of this.parseFile(path.join(this.opts.dir, name))) out.push({ ...i, window });
    }
    for (const i of this.buffer) out.push({ ...i, window: this.opts.windowId });
    return out.filter((i) => overlaps(i, range));
  }
```
(`deleteRange` keeps using `parseFile` directly, so tags are never rewritten.)

`src/extension.ts`: remove `import * as crypto from 'crypto';`, change the `IntervalStore` import to `import { IntervalStore, newWindowId } from './intervalStore';`, replace the `windowId` line with `const windowId = newWindowId();`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src
git commit -m "feat(null-activity): one log file and window tag per window"
```

---

### Task 3: Per-window attribution in stats

**Files:**
- Modify: `src/stats.ts:3,94-137`
- Test: `src/test/stats.test.ts`

**Interfaces:**
- Consumes: `Interval.window` (Task 2), `WAKATIME_WINDOW_ID` from `./wakatimeImport` (no import cycle: it only imports `languageMap`, `projectIdentity`, `types`).
- Produces: `attributedIntervals(intervals: readonly Interval[], range: DateRange): Interval[]` — sorted by start, clipped to `range`, overlaps removed *within* a window only, import pieces only where no live window has data. `projectStats`, `languageStats` use it; `sessions` takes its projects/languages/files from it but keeps union durations; `periodStats` and `normalizeIntervals` are unchanged (union).

- [ ] **Step 1: Write the failing tests**

In `src/test/stats.test.ts` add `attributedIntervals` to the `../stats` import and add `import { WAKATIME_WINDOW_ID } from '../wakatimeImport';`. Append:

```ts
const proj = (key: string) => ({ key, name: key.toUpperCase() });

test('three parallel windows: projects and languages sum, the daily total and session duration stay the union', () => {
  const day = dayRange(at(8, 12));
  const data = ['a', 'b', 'c'].map((w) => iv(at(8, 10), at(8, 10, 10), { window: w, project: proj(w) }));
  assert.deepStrictEqual(projectStats(data, day).map((p) => p.ms), [10 * MIN, 10 * MIN, 10 * MIN]);
  assert.strictEqual(languageStats(data, day)[0].ms, 30 * MIN);
  assert.deepStrictEqual(periodStats(data, day, 'day'), [{ day: '2026-10-08', ms: 10 * MIN }]);
  const [session] = sessions(data, day, 15 * MIN);
  assert.strictEqual(session.durationMs, 10 * MIN);
  assert.deepStrictEqual(session.projects.map((p) => p.name), ['A', 'B', 'C']);
});

test('intervals without a window behave as one window: overlaps are still clipped', () => {
  const day = dayRange(at(8, 12));
  const data = [iv(at(8, 10), at(8, 10, 10)), iv(at(8, 10, 5), at(8, 10, 15), { project: proj('k2') })];
  assert.deepStrictEqual(projectStats(data, day).map((p) => [p.project.key, p.ms]), [['k', 10 * MIN], ['k2', 5 * MIN]]);
});

test('a WakaTime import only fills the gaps live windows left', () => {
  const day = dayRange(at(8, 12));
  const live = iv(at(8, 10, 5), at(8, 10, 10), { window: 'w1', project: proj('live'), linesAdded: 7 });
  const imported = iv(at(8, 10), at(8, 10, 20), { window: WAKATIME_WINDOW_ID, project: proj('imp') });
  const by = Object.fromEntries(projectStats([live, imported], day).map((p) => [p.project.key, p]));
  assert.strictEqual(by.live.ms, 5 * MIN);
  assert.strictEqual(by.live.linesAdded, 7);
  assert.strictEqual(by.imp.ms, 15 * MIN, '10:00-10:05 and 10:10-10:20');
  assert.deepStrictEqual(attributedIntervals([live, imported], day).map((i) => [i.project.key, i.start, i.end]), [
    ['imp', at(8, 10), at(8, 10, 5)],
    ['live', at(8, 10, 5), at(8, 10, 10)],
    ['imp', at(8, 10, 10), at(8, 10, 20)],
  ]);
  assert.deepStrictEqual(periodStats([live, imported], day, 'day'), [{ day: '2026-10-08', ms: 20 * MIN }]);
});

test('an import completely covered by live windows contributes nothing', () => {
  const day = dayRange(at(8, 12));
  const live = iv(at(8, 10), at(8, 11), { window: 'w1', project: proj('live') });
  const imported = iv(at(8, 10, 10), at(8, 10, 40), { window: WAKATIME_WINDOW_ID, project: proj('imp') });
  assert.deepStrictEqual(projectStats([live, imported], day).map((p) => p.project.key), ['live']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc -p tsconfig.json; node --test out/test/stats.test.js`
Expected: FAIL / compile error — `attributedIntervals` does not exist.

- [ ] **Step 3: Implement**

`src/stats.ts`: add `import { WAKATIME_WINDOW_ID } from './wakatimeImport';` below the `types` import. Insert after `normalizeIntervals` (line 71):

```ts
/** The parts of `imported` (merged, sorted) that no interval of `cover` (merged, sorted) touches. */
function fillGaps(imported: readonly Interval[], cover: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let c = 0;
  for (const i of imported) {
    while (c < cover.length && cover[c].end <= i.start) c++;
    let from = i.start;
    for (let j = c; j < cover.length && cover[j].start < i.end; j++) {
      if (cover[j].start > from) out.push(sliceInterval(i, from, cover[j].start)!);
      from = Math.max(from, cover[j].end);
    }
    if (from < i.end) out.push(sliceInterval(i, from, i.end)!);
  }
  return out;
}

/**
 * The per-project / per-language view: overlaps are removed only inside one window, so three parallel
 * windows with 10 min each give 30 min (the union view, `normalizeIntervals`, gives 10). A WakaTime import
 * records the same activity Null IDE saw itself, so it only fills the gaps the live windows left.
 */
export function attributedIntervals(intervals: readonly Interval[], range: DateRange): Interval[] {
  const byWindow = new Map<string, Interval[]>();
  const imported: Interval[] = [];
  for (const i of intervals) {
    if (i.window === WAKATIME_WINDOW_ID) {
      imported.push(i);
      continue;
    }
    const key = i.window ?? '';
    const list = byWindow.get(key);
    if (list) list.push(i);
    else byWindow.set(key, [i]);
  }
  const live = [...byWindow.values()].flatMap(mergeClip);
  const all = [...live, ...fillGaps(mergeClip(imported), mergeClip(live))];
  return all
    .flatMap((i) => sliceInterval(i, range.from, range.to) ?? [])
    .sort((a, b) => a.start - b.start || a.end - b.end);
}
```

In `projectStats` and `languageStats` replace `normalizeIntervals(intervals, range)` with `attributedIntervals(intervals, range)`.

Replace `sessions` with (durations from the union, contents from the attributed view):

```ts
/** Consecutive intervals with gaps <= gapMs form one session; duration is the union time, contents list every window's projects. */
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
  }
  let at = 0;
  for (const i of attributedIntervals(intervals, range)) {
    while (at < groups.length && groups[at].session.end <= i.start) at++;
    const g = groups[at];
    if (!g) break;
    g.projects.set(i.project.key, i.project);
    if (i.language) g.languages.add(i.language);
    if (i.file) g.files.add(i.file);
  }
  return groups.map((g) => ({ ...g.session, projects: [...g.projects.values()], languages: [...g.languages], files: [...g.files] }));
}
```

(Every attributed piece starts inside the union's coverage, so the group found by the moving index always contains `i.start`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS, including the pre-existing `stats`, `dashboardModel` and `activityService` tests (untagged data is one window).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src
git commit -m "feat(null-activity): sum per-window time in project and language stats"
```

---

### Task 4: Service and dashboard use the two views

**Files:**
- Modify: `src/activityService.ts:5,103-134`
- Modify: `src/dashboardModel.ts:159-183`
- Test: `src/test/activityService.test.ts`, `src/test/dashboardModel.test.ts`

**Interfaces:**
- Consumes: `IntervalStore.windowId`, tagged `read` (Task 2); `attributedIntervals`-based stats (Task 3).
- Produces: `ActivityService.getIntervals` still returns the union; `getProjectStats`/`getLanguageStats` sum per window; `DashboardModel.totalMs` is the union, `projects`/`languages` percents are relative to the summed project time.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/activityService.test.ts`:

```ts
test('another window\'s time is summed per project but shares one headline total', () => {
  const { service, dir, settings } = setup();
  settings.idleTimeoutMs = 20 * MIN;
  service.refresh();
  const other = new IntervalStore({ dir, windowId: 'w2' });
  other.append({ start: at(8, 9), end: at(8, 9, 10), project: { key: '/x', name: 'x' }, language: 'rust', file: 'b.rs', linesAdded: 0, linesRemoved: 0 });
  other.flush();
  service.recordActivity(hb(at(8, 9)));
  service.recordActivity(hb(at(8, 9, 10)));
  service.endSession();
  assert.deepStrictEqual(service.getProjectStats(day).map((p) => p.ms), [10 * MIN, 10 * MIN]);
  assert.deepStrictEqual(service.getLanguageStats(day).map((l) => l.language).sort(), ['rust', 'typescript']);
  assert.deepStrictEqual(service.getDailyStats(day), [{ day: '2026-10-08', ms: 10 * MIN }]);
  assert.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 9), at(8, 9, 10)]]);
});

test('the open interval of this window is summed with other windows too', () => {
  const { service, dir } = setup();
  const other = new IntervalStore({ dir, windowId: 'w2' });
  other.append({ start: at(8, 9), end: at(8, 9, 1), project: { key: '/x', name: 'x' }, language: 'rust', linesAdded: 0, linesRemoved: 0 });
  other.flush();
  service.recordActivity(hb(at(8, 9)));
  service.recordActivity(hb(at(8, 9, 1)));
  assert.deepStrictEqual(service.getProjectStats(day).map((p) => p.ms), [MIN, MIN]);
});
```

Append to `src/test/dashboardModel.test.ts`:

```ts
test('parallel windows: the total is the union, the shares are relative to the summed project time', () => {
  const data = ['a', 'b', 'c'].map((w) => iv(at(8, 10), at(8, 10, 10), { window: w, project: { key: w, name: w } }));
  const model = build(data, 'today');
  assert.strictEqual(model.totalMs, 10 * MIN);
  assert.strictEqual(sum(model.bars), 10 * MIN);
  assert.deepStrictEqual(model.projects.map((p) => [p.ms, p.percent]), [[10 * MIN, 33], [10 * MIN, 33], [10 * MIN, 33]]);
  assert.deepStrictEqual(model.sessions.map((s) => [s.ms, s.projects]), [[10 * MIN, ['a', 'b', 'c']]]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx tsc -p tsconfig.json; node --test out/test/activityService.test.js out/test/dashboardModel.test.js`
Expected: FAIL — the service still feeds union-clipped intervals into `projectStats` (first test sees 10 + 0), and `totalMs` is the project sum (30 min in the dashboard test).

- [ ] **Step 3: Implement**

`src/activityService.ts` — replace `getIntervals` and the five stat methods (lines 103-134) with:

```ts
  /** Un-merged intervals of every window, tagged with their window, plus this window's open interval. */
  private raw(range: DateRange): Interval[] {
    const key = `${range.from}:${range.to}`;
    let hit = this.cache.get(key);
    if (!hit || this.clock() - hit.at >= CACHE_TTL_MS) {
      hit = { at: this.clock(), intervals: this.opts.store.read(range) };
      this.cache.set(key, hit);
    }
    const open = this.tracker.peek();
    return open ? [...hit.intervals, { ...open, window: this.opts.store.windowId }] : hit.intervals;
  }

  /** Union of every window, clipped to the range, including the in-progress interval. */
  getIntervals(range: DateRange): Interval[] {
    return normalizeIntervals(this.raw(range), range);
  }

  getProjectStats(range: DateRange): ProjectStat[] {
    return projectStats(this.raw(range), range);
  }

  getLanguageStats(range: DateRange): LanguageStat[] {
    return languageStats(this.raw(range), range);
  }

  getDailyStats(range: DateRange): DailyStat[] {
    return periodStats(this.raw(range), range, 'day');
  }

  getSessions(range: DateRange): Session[] {
    return sessions(this.raw(range), range, this.cfg.sessionGapMs);
  }

  getMonthlyTotals(): DailyStat[] {
    return periodStats(this.raw(ALL_TIME), ALL_TIME, 'month');
  }
```

`src/dashboardModel.ts` — in `buildDashboardModel` replace the `totalMs` line (160) with:

```ts
  // Projects sum each window's time (parallel windows can exceed wall-clock time); the headline is the union.
  const attributedMs = projects.reduce((n, p) => n + p.ms, 0);
  const totalMs = api.getDailyStats(r).reduce((n, d) => n + d.ms, 0);
```

and in the returned object change the two `toShares(..., totalMs)` calls (projects and languages) to `toShares(..., attributedMs)`. Leave `totalMs` itself in the model.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS (all earlier dashboard tests use untagged data, where the union and the sum are equal).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src
git commit -m "feat(null-activity): union headline totals, summed per-window project stats"
```

---

### Task 5: Docs, compiled output, verification

**Files:**
- Modify: `CLAUDE.md` (null-activity section)
- Modify: `docs/specs/null-activity-engine-design.md:24,45,56,59`
- Refresh: `extensions/null-activity/out/`

- [ ] **Step 1: Update CLAUDE.md**

In the null-activity section replace
`Heartbeats count only while the window is focused and for edits to any open file or untitled document`
with
`Heartbeats count whether or not the window is focused (parallel agent windows each extend their own interval) and for edits to any open file or untitled document`,
and replace
`one file per window session so concurrent windows never clobber each other; \`stats.ts\` merges and clips overlaps`
with
`one file per window (random id per extension-host launch, never \`env.sessionId\`, which all windows of one app launch share) so concurrent windows never clobber each other; \`stats.ts\` keeps two views: the headline (daily/monthly totals, hourly bars, session durations, dashboard \`totalMs\`) is the union of all windows, while per-project and per-language numbers sum each window's own time via \`attributedIntervals\` (a WakaTime import only fills gaps live windows left)`.
Also change "close rule: … closes with no heartbeat — focus loss, pause, shutdown —" to "closes with no heartbeat — pause, shutdown —".

- [ ] **Step 2: Update the engine design doc**

In `docs/specs/null-activity-engine-design.md`: line 24 drop "while the Null IDE window is focused" and "focus loss," from the closes-without-heartbeat list; line 45 say the file name's `<windowId>` is a random id per window; line 56 drop "on window focus loss,"; line 59 add "per-project/language stats sum windows, the headline total is the union".

- [ ] **Step 3: Full test run and compiled output**

Run: `npm test && npm run compile`
Expected: all tests PASS; `git status` shows only `src/`, `out/` changes under `extensions/null-activity/`.

- [ ] **Step 4: Verify in a real window**

Run the `/verify-local null-activity` skill (syncs into the installed Null IDE and runs the integration specs; `activation.spec.ts` no longer skips when unfocused). Then, with two Null IDE windows open on different projects and an agent editing in the unfocused one, open the Coding Activity dashboard for Today and confirm: the project table lists both projects with their own time, the headline total is not larger than wall-clock time, and `globalStorage/null.null-activity/` holds one `intervals-<month>-<id>.jsonl` per window. Compare one day against WakaTime.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/specs/null-activity-engine-design.md
git commit -m "docs: document multi-window counting in null-activity"
git add extensions/null-activity/out
git commit -m "chore: refresh null-activity compiled output"
```

---

## Self-Review

**Coverage:** unfocused heartbeats → Task 1; real window identity + tagging → Task 2; sum-per-project / union-headline / import fills gaps → Tasks 3-4; sessions list all projects → Task 3; docs, compiled output, real-window check → Task 5. Out-of-scope items are listed under Decisions.

**Placeholders:** none.

**Type consistency:** `Interval.window`, `IntervalStore.windowId`, `newWindowId`, `attributedIntervals(intervals, range)`, `ActivityService.raw` are named the same in every task.

**Known trade-offs:** unfocused windows also count background churn on open files (`git pull`, formatters); a new log file per window launch (and per reload) grows the file count until compaction is added (`ponytail:` note already in `intervalStore.ts`).

# Null Activity Dashboard Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Add a read-only **Coding Activity** dashboard to `null-activity`: one editor-tab webview showing total time, an activity graph, project and language breakdowns and a sessions list for a chosen range (Today, Yesterday, This week, This month, All time).

**Architecture:** A pure view-model (`dashboardModel.ts`) turns the existing `NullActivityApi` / `stats.ts` data into a `DashboardModel`. A thin `dashboardPanel.ts` owns the single reused `WebviewPanel`, pushes model snapshots and handles typed intents. The UI is vanilla TypeScript compiled with `module: none` into a tracked `lib/dashboard.js` (the `null-music` pattern); it renders with DOM and inline SVG and holds no data logic. The engine is not touched.

**Tech Stack:** TypeScript (commonjs/ES2022 host, `module: none`/ES2017 webview), VS Code `WebviewPanel`, `node --test` over compiled `out/test/*.test.js` (webview helpers loaded through `node:vm`), `@vscode/test-electron` + Mocha for one integration spec. No runtime dependencies, no chart library, no network code.

**Spec:** [docs/specs/null-activity-dashboard-design.md](../specs/null-activity-dashboard-design.md)

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

- Work only under `extensions/null-activity/`, plus `scripts/sync-local.ps1`, `CLAUDE.md` and this plan. `build.yml` already compiles null-activity with `npm run compile`; do not edit it. Do not run `scripts/build-local.ps1`.
- Engine untouched: no changes to `activityService.ts`, `tracker.ts`, `intervalStore.ts`, `stats.ts` or the `NullActivityApi` shape. Deletion is not exposed in the dashboard.
- No chart library, no runtime dependencies, no network code. `null-activity` gains no dependency on other Null extensions.
- Ranges are presets only: `today | yesterday | week | month | all`; week starts Monday; day boundaries are local time. Default `today`; last choice persisted in `workspaceState` key `null-activity.dashboard.range`.
- Webview security: CSP `default-src 'none'`, nonce'd script, `localResourceRoots` limited to the extension's `lib/`, no remote resources, all text inserted through text nodes / `textContent`, never `innerHTML`, never inline `style` attributes (use `el.style.setProperty`).
- Push cadence: first model after `ready`, new model after `setRange`, on `onDidChange` throttled to one push per second, every 60 s while visible; nothing is recomputed while hidden. `retainContextWhenHidden` stays off.
- Limits: projects/languages max 8 rows (remainder folded into `Other`), sessions newest first, max 50. Empty language `''` is shown as `Terminal / other`.
- `out/` and `lib/dashboard.js` are tracked and generated: never hand-edit them. `lib/dashboard.css` is the only hand-edited file in `lib/`. Refresh generated output in one final `chore: refresh null-activity compiled output` commit (Task 7); in every other task stage only the source paths listed.
- A new `*.test.ts` is silently skipped until its `out/test/<name>.test.js` is added to the `test` script in `package.json`.
- Webview files under `src/webview/dashboard/` use top-level `function` declarations only, no imports/exports (`module: none`); all of them share one global scope, so function names must be unique across files and must not shadow `h` / `s`.
- Commits: new commits only, never amend, never `--no-verify`, never push. End each commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Run all `npm` commands from `extensions/null-activity/`.

## Review Focus

Failure modes the spec implies but a straight reading of the tasks would not pin down, most likely first:

1. An interval that crosses midnight must be split between the two days, not credited to one (Task 1 test `an interval across midnight…`).
2. DST change days (23 h / 25 h) must still sum to the total, with the repeated hour merged into one bar (Task 1 DST tests).
3. Project names, languages and file paths containing markup (`"><img onerror=…>`) must stay inert text (Task 2 `h()` test).
4. Malformed or hostile webview messages (`null`, wrong types, `setRange` with a bad range, extra fields) must be ignored (Task 1 `parseWebviewMessage` tests).
5. Years of history under **All time**: monthly bars are gap-filled, count equals the number of months, and the sum equals `totalMs` (Task 1 long-history test).

Also pinned: the CSP never contains `unsafe-inline` / `unsafe-eval` (Task 4 `dashboardHtml` test).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/protocol.ts` | Create | Global types only: `DashboardRange`, `DashboardBar`, `Share`, `SessionRow`, `DashboardModel`, `HostToWebview`, `WebviewToHost` |
| `src/dashboardModel.ts` | Create | Pure: `buildDashboardModel`, `rangeFor`, `hourlyStats`, `toShares`, `isDashboardRange`, `parseWebviewMessage` |
| `src/dashboardHtml.ts` | Create | Pure: `getDashboardHtml(nonce, cspSource, scriptUri, styleUri)` (the CSP lives here so it is unit-testable) |
| `src/dashboardPanel.ts` | Create | `vscode`: single reused panel, snapshot pushes, throttle/timer, intent handling |
| `src/webview/dashboard/dom.ts` | Create | `h()` (HTML) and `s()` (SVG) element builders |
| `src/webview/dashboard/model.ts` | Create | Pure formatting/scaling helpers |
| `src/webview/dashboard/graph.ts` | Create | `renderGraph(model)` |
| `src/webview/dashboard/breakdown.ts` | Create | `renderBreakdown(title, shares)` |
| `src/webview/dashboard/sessions.ts` | Create | `renderSessions(rows)` |
| `src/webview/dashboard/main.ts` | Create | Page assembly, tabs, banner, messaging |
| `tsconfig.webview-dashboard.json` | Create | Compiles the webview to `lib/dashboard.js` |
| `tsconfig.webview-dashboard-shared.json` | Create | Compiles `protocol/dom/model` to `out/webview-dashboard-shared.js` for `vm` tests |
| `lib/dashboard.css` | Create | Hand-written styles |
| `src/test/dashboardModel.test.ts` | Create | Model + message-parsing tests |
| `src/test/dashboardWebviewModel.test.ts` | Create | Webview helper tests via `vm` |
| `src/test/dashboardHtml.test.ts` | Create | CSP test |
| `src/test/suite/dashboard.spec.ts` | Create | One integration spec |
| `tsconfig.json` | Modify | Exclude `src/webview` from the host program |
| `package.json` | Modify | Command contribution, `compile` / `test` scripts |
| `src/commands.ts`, `src/statusBar.ts`, `src/extension.ts` | Modify | Register `openDashboard`, rebind status bar click, construct panel |
| `../../scripts/sync-local.ps1` | Modify | Copy `lib` for null-activity |
| `../../CLAUDE.md` | Modify | Update the null-activity paragraph |

---

### Task 1: Protocol types and the dashboard view-model

**Files:**
- Create: `src/protocol.ts`, `src/dashboardModel.ts`, `src/test/dashboardModel.test.ts`
- Modify: `package.json` (`test` script)

**Interfaces:**
- Consumes: from `stats.ts` — `ALL_TIME`, `dayKey`, `dayRange`, `monthRange`, `nextPeriodStart`, `normalizeIntervals`, `periodStart`, `periodStats`; from `types.ts` — `DateRange`, `Interval`, `NullActivityApi`.
- Produces (used by Task 4):
  - `type DashboardSource = Pick<NullActivityApi, 'getIntervals' | 'getProjectStats' | 'getLanguageStats' | 'getDailyStats' | 'getSessions'>`
  - `buildDashboardModel(api: DashboardSource, range: DashboardRange, now: number, enabled: boolean): DashboardModel`
  - `isDashboardRange(v: unknown): v is DashboardRange`
  - `parseWebviewMessage(raw: unknown): WebviewToHost | undefined`
  - `rangeFor(range: DashboardRange, now: number): DateRange`, `hourlyStats(intervals, range): number[]` (24 entries), `toShares(items, totalMs): Share[]`
  - Global types from `protocol.ts` (also consumed by Tasks 2–4).

- [ ] **Step 1: Create the protocol types**

Create `src/protocol.ts`:

```ts
'use strict';

// Types only, shared by the host (via `/// <reference path>`) and the webview bundle.
// No imports/exports: this file is a global script (module: none).

type DashboardRange = 'today' | 'yesterday' | 'week' | 'month' | 'all';

interface DashboardBar {
  label: string;
  startMs: number;
  ms: number;
}

interface Share {
  name: string;
  ms: number;
  /** Rounded; a list of shares sums to 100 ± rounding. */
  percent: number;
}

interface SessionRow {
  start: number;
  end: number;
  ms: number;
  projects: string[];
  languages: string[];
  files: string[];
}

interface DashboardModel {
  range: DashboardRange;
  /** "Today", "Mon 5 – Sun 11 Oct", ... */
  rangeLabel: string;
  /** `null-activity.enabled` */
  enabled: boolean;
  totalMs: number;
  bars: DashboardBar[];
  barUnit: 'hour' | 'day' | 'month';
  /** Ranked, max 8, remainder folded into "Other". */
  projects: Share[];
  languages: Share[];
  /** Newest first, max 50. */
  sessions: SessionRow[];
}

type HostToWebview = { type: 'model'; model: DashboardModel };

type WebviewToHost =
  | { type: 'ready' }
  | { type: 'setRange'; range: DashboardRange }
  | { type: 'enableTracking' }
  | { type: 'showTrackedData' }
  | { type: 'openSettings' };
```

- [ ] **Step 2: Write the failing test**

Create `src/test/dashboardModel.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import {
  DashboardSource, MAX_SESSIONS, TERMINAL_LABEL, buildDashboardModel, hourlyStats, isDashboardRange, parseWebviewMessage, rangeFor,
} from '../dashboardModel';
import { ALL_TIME, languageStats, normalizeIntervals, periodStats, projectStats, sessions } from '../stats';
import { Interval } from '../types';

// Set after the imports and before any Date is used: boundaries and DST are then the same on every machine.
process.env.TZ = 'Europe/Vienna';
const tzApplied = { skip: new Date(Date.UTC(2026, 6, 1)).getTimezoneOffset() !== -120 && 'process.env.TZ is not honoured here' };

const MIN = 60_000;
const HOUR = 3_600_000;
/** Local time; month is zero-based and defaults to October 2026 (Thu 8 Oct 2026). */
const at = (day: number, h: number, m = 0, month = 9) => new Date(2026, month, day, h, m).getTime();
const NOW = at(8, 15);
const iv = (start: number, end: number, over: Partial<Interval> = {}): Interval => ({
  start, end, project: { key: 'k', name: 'proj' }, language: 'typescript', file: 'a.ts', linesAdded: 0, linesRemoved: 0, ...over,
});
/** The same derivations ActivityService performs, minus the store. */
const source = (intervals: Interval[], gapMs = 15 * MIN): DashboardSource => ({
  getIntervals: (r) => normalizeIntervals(intervals, r),
  getProjectStats: (r) => projectStats(intervals, r),
  getLanguageStats: (r) => languageStats(intervals, r),
  getDailyStats: (r) => periodStats(intervals, r, 'day'),
  getSessions: (r) => sessions(intervals, r, gapMs),
});
const build = (intervals: Interval[], range: DashboardRange, now = NOW, enabled = true) =>
  buildDashboardModel(source(intervals), range, now, enabled);
const sum = (bars: { ms: number }[]) => bars.reduce((n, b) => n + b.ms, 0);

test('rangeFor: Monday week start, month end, yesterday and all time', () => {
  assert.deepStrictEqual(rangeFor('today', NOW), { from: at(8, 0), to: at(9, 0) });
  assert.deepStrictEqual(rangeFor('yesterday', NOW), { from: at(7, 0), to: at(8, 0) });
  assert.deepStrictEqual(rangeFor('week', NOW), { from: at(5, 0), to: at(12, 0) });
  assert.deepStrictEqual(rangeFor('week', at(11, 23, 59)), { from: at(5, 0), to: at(12, 0) }); // Sunday belongs to the week that began Monday
  assert.deepStrictEqual(rangeFor('month', NOW), { from: at(1, 0), to: at(1, 0, 0, 10) });
  assert.deepStrictEqual(rangeFor('all', NOW), ALL_TIME);
});

test('range labels', () => {
  assert.strictEqual(build([], 'today').rangeLabel, 'Today');
  assert.strictEqual(build([], 'yesterday').rangeLabel, 'Yesterday');
  assert.strictEqual(build([], 'week').rangeLabel, 'Mon 5 – Sun 11 Oct');
  assert.strictEqual(build([], 'week', at(30, 12, 0, 8)).rangeLabel, 'Mon 28 Sep – Sun 4 Oct');
  assert.strictEqual(build([], 'month').rangeLabel, 'October 2026');
  assert.strictEqual(build([], 'all').rangeLabel, 'All time');
});

test('an interval across midnight is split between the two days (hourly bars)', () => {
  const data = [iv(at(7, 23, 30), at(8, 0, 30))];
  const today = build(data, 'today');
  const yesterday = build(data, 'yesterday');
  assert.strictEqual(today.barUnit, 'hour');
  assert.strictEqual(today.bars.length, 24);
  assert.strictEqual(today.bars[0].ms, 30 * MIN);
  assert.strictEqual(today.bars[0].label, '00:00');
  assert.strictEqual(today.bars[0].startMs, at(8, 0));
  assert.strictEqual(today.totalMs, 30 * MIN);
  assert.strictEqual(yesterday.bars[23].ms, 30 * MIN);
  assert.strictEqual(yesterday.bars[23].startMs, at(7, 23));
  assert.strictEqual(yesterday.totalMs, 30 * MIN);
});

test('fall-back day: 25 hours, the repeated hour is merged into one bar, bars sum to the total', tzApplied, () => {
  const day = rangeFor('today', Date.UTC(2026, 9, 25, 12)); // Sun 25 Oct 2026, 03:00 CEST -> 02:00 CET
  assert.strictEqual(day.to - day.from, 25 * HOUR);
  const out = hourlyStats([iv(day.from, day.to)], day);
  assert.strictEqual(out.length, 24);
  assert.strictEqual(out[2], 2 * HOUR);
  assert.ok(out.filter((_, i) => i !== 2).every((ms) => ms === HOUR));
  assert.strictEqual(out.reduce((n, ms) => n + ms, 0), 25 * HOUR);
  const model = build([iv(day.from, day.to)], 'today', Date.UTC(2026, 9, 25, 12));
  assert.strictEqual(sum(model.bars), model.totalMs);
  assert.strictEqual(model.totalMs, 25 * HOUR);
});

test('spring-forward day: 23 hours, the missing hour is an empty bar, bars sum to the total', tzApplied, () => {
  const day = rangeFor('today', Date.UTC(2026, 2, 29, 12)); // Sun 29 Mar 2026, 02:00 CET -> 03:00 CEST
  assert.strictEqual(day.to - day.from, 23 * HOUR);
  const out = hourlyStats([iv(day.from, day.to)], day);
  assert.strictEqual(out[2], 0);
  assert.strictEqual(out.reduce((n, ms) => n + ms, 0), 23 * HOUR);
});

test('overlapping windows are not double-counted', () => {
  const data = [iv(at(8, 10), at(8, 10, 10)), iv(at(8, 10, 5), at(8, 10, 15), { project: { key: 'k2', name: 'other' } })];
  const model = build(data, 'today');
  assert.strictEqual(model.totalMs, 15 * MIN);
  assert.strictEqual(sum(model.bars), 15 * MIN);
  assert.strictEqual(model.bars[10].ms, 15 * MIN);
  assert.deepStrictEqual(model.projects.map((p) => [p.name, p.ms, p.percent]), [['proj', 10 * MIN, 67], ['other', 5 * MIN, 33]]);
});

test('more than eight projects: top seven stay, the rest fold into "Other"; percents add up', () => {
  const data = Array.from({ length: 9 }, (_, n) =>
    iv(at(8, n + 1), at(8, n + 1, 10), { project: { key: `p${n}`, name: `p${n}` } }));
  const { projects } = build(data, 'today');
  assert.strictEqual(projects.length, 8);
  assert.strictEqual(projects[7].name, 'Other');
  assert.strictEqual(projects[7].ms, 20 * MIN);
  assert.deepStrictEqual(projects.map((p) => p.percent), [11, 11, 11, 11, 11, 11, 11, 22]);
});

test('exactly eight projects are all shown without "Other"', () => {
  const data = Array.from({ length: 8 }, (_, n) =>
    iv(at(8, n + 1), at(8, n + 1, 10), { project: { key: `p${n}`, name: `p${n}` } }));
  const { projects } = build(data, 'today');
  assert.strictEqual(projects.length, 8);
  assert.ok(projects.every((p) => p.name !== 'Other'));
});

test('the empty language is labelled "Terminal / other"', () => {
  const { languages } = build([iv(at(8, 9), at(8, 9, 30), { language: '', file: undefined })], 'today');
  assert.deepStrictEqual(languages.map((l) => l.name), [TERMINAL_LABEL]);
});

test('an empty range has zeroed bars and no lists', () => {
  const week = build([], 'week');
  assert.strictEqual(week.totalMs, 0);
  assert.strictEqual(week.bars.length, 7);
  assert.ok(week.bars.every((b) => b.ms === 0));
  assert.deepStrictEqual([week.projects, week.languages, week.sessions], [[], [], []]);
  assert.deepStrictEqual(build([], 'all').bars, []);
});

test('week and month use one bar per local day, zero-filled', () => {
  const data = [iv(at(7, 10), at(7, 10, 30))]; // Wed 7 Oct
  const week = build(data, 'week');
  assert.strictEqual(week.barUnit, 'day');
  assert.strictEqual(week.bars.length, 7);
  assert.strictEqual(week.bars[0].startMs, at(5, 0));
  assert.strictEqual(week.bars[0].label, 'Mon 5 Oct');
  assert.strictEqual(week.bars[2].ms, 30 * MIN);
  assert.strictEqual(sum(week.bars), week.totalMs);
  const month = build(data, 'month');
  assert.strictEqual(month.bars.length, 31);
  assert.strictEqual(month.bars[6].ms, 30 * MIN);
});

test('all time: one bar per month from the first recorded month, gaps filled', () => {
  const data = [iv(at(20, 10, 0, 7), at(20, 11, 0, 7)), iv(at(8, 10), at(8, 11))]; // 20 Aug and 8 Oct
  const model = build(data, 'all');
  assert.strictEqual(model.barUnit, 'month');
  assert.deepStrictEqual(model.bars.map((b) => [b.label, b.ms]), [['Aug 2026', HOUR], ['Sep 2026', 0], ['Oct 2026', HOUR]]);
});

test('two years of history under "all time" keep one bar per month and the right total', () => {
  const data = Array.from({ length: 24 }, (_, k) => {
    const start = new Date(2024, 10 + k, 15, 10).getTime(); // Nov 2024 .. Oct 2026
    return iv(start, start + HOUR);
  });
  const model = build(data, 'all');
  assert.strictEqual(model.bars.length, 24);
  assert.ok(model.bars.every((b) => b.ms === HOUR));
  assert.strictEqual(model.totalMs, 24 * HOUR);
  assert.strictEqual(sum(model.bars), model.totalMs);
});

test('sessions are newest first and capped', () => {
  const data = Array.from({ length: 60 }, (_, n) => iv(at(1, 0) + n * HOUR, at(1, 0) + n * HOUR + MIN));
  const model = build(data, 'month');
  assert.strictEqual(model.sessions.length, MAX_SESSIONS);
  assert.strictEqual(model.sessions[0].start, at(1, 0) + 59 * HOUR);
  assert.strictEqual(model.sessions[MAX_SESSIONS - 1].start, at(1, 0) + 10 * HOUR);
  assert.ok(model.sessions.every((s, i, all) => i === 0 || s.start < all[i - 1].start));
  assert.deepStrictEqual(model.sessions[0], {
    start: at(1, 0) + 59 * HOUR, end: at(1, 0) + 59 * HOUR + MIN, ms: MIN, projects: ['proj'], languages: ['typescript'], files: ['a.ts'],
  });
});

test('the enabled flag is passed through and existing data is still shown', () => {
  const model = build([iv(at(8, 9), at(8, 9, 30))], 'today', NOW, false);
  assert.strictEqual(model.enabled, false);
  assert.strictEqual(model.totalMs, 30 * MIN);
});

test('isDashboardRange accepts only the five presets', () => {
  for (const r of ['today', 'yesterday', 'week', 'month', 'all']) assert.ok(isDashboardRange(r));
  for (const r of ['custom', '', 'TODAY', null, undefined, 3, {}]) assert.ok(!isDashboardRange(r));
});

test('parseWebviewMessage keeps valid intents, strips extra fields and ignores everything else', () => {
  for (const type of ['ready', 'enableTracking', 'showTrackedData', 'openSettings']) {
    assert.deepStrictEqual(parseWebviewMessage({ type, evil: 1 }), { type });
  }
  assert.deepStrictEqual(parseWebviewMessage({ type: 'setRange', range: 'week' }), { type: 'setRange', range: 'week' });
  for (const bad of [
    { type: 'setRange' }, { type: 'setRange', range: 'custom' }, { type: 'setRange', range: 7 }, { type: 'delete' }, { type: 3 },
    {}, null, undefined, 'ready', 42, [],
  ]) {
    assert.strictEqual(parseWebviewMessage(bad), undefined);
  }
});
```

- [ ] **Step 3: Register the test file**

In `package.json`, change the `test` script to (same command, one extra entry at the end):

```json
"test": "tsc -p tsconfig.json && node --test out/test/tracker.test.js out/test/stats.test.js out/test/intervalStore.test.js out/test/projectIdentity.test.js out/test/activityService.test.js out/test/privacy.test.js out/test/dashboardModel.test.js",
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test`
Expected: FAIL at `tsc` with `error TS2307: Cannot find module '../dashboardModel'`.

- [ ] **Step 5: Implement the view-model**

Create `src/dashboardModel.ts`:

```ts
/// <reference path="./protocol.ts" />
'use strict';

import {
  ALL_TIME, dayKey, dayRange, monthRange, nextPeriodStart, normalizeIntervals, periodStart, periodStats,
} from './stats';
import { DateRange, Interval, NullActivityApi } from './types';

export type DashboardSource = Pick<
  NullActivityApi,
  'getIntervals' | 'getProjectStats' | 'getLanguageStats' | 'getDailyStats' | 'getSessions'
>;

export const MAX_SHARES = 8;
export const MAX_SESSIONS = 50;
export const TERMINAL_LABEL = 'Terminal / other';

const RANGES: readonly DashboardRange[] = ['today', 'yesterday', 'week', 'month', 'all'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];
const pad = (n: number) => String(n).padStart(2, '0');

export function isDashboardRange(v: unknown): v is DashboardRange {
  return RANGES.includes(v as DashboardRange);
}

/** Validates an untrusted webview message; unknown shapes and extra fields are dropped. */
export function parseWebviewMessage(raw: unknown): WebviewToHost | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as { type?: unknown; range?: unknown };
  switch (m.type) {
    case 'ready':
    case 'enableTracking':
    case 'showTrackedData':
    case 'openSettings':
      return { type: m.type } as WebviewToHost;
    case 'setRange':
      return isDashboardRange(m.range) ? { type: 'setRange', range: m.range } : undefined;
    default:
      return undefined;
  }
}

export function rangeFor(range: DashboardRange, now: number): DateRange {
  switch (range) {
    case 'today':
      return dayRange(now);
    case 'yesterday': {
      const to = periodStart(now, 'day');
      const d = new Date(to);
      return { from: new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime(), to };
    }
    case 'week':
      return { from: periodStart(now, 'week'), to: nextPeriodStart(now, 'week') };
    case 'month':
      return monthRange(now);
    case 'all':
      return ALL_TIME;
  }
}

function rangeLabel(range: DashboardRange, r: DateRange): string {
  switch (range) {
    case 'today':
      return 'Today';
    case 'yesterday':
      return 'Yesterday';
    case 'all':
      return 'All time';
    case 'month': {
      const d = new Date(r.from);
      return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    }
    case 'week': {
      const first = new Date(r.from);
      const last = new Date(r.to - 1);
      const startMonth = first.getMonth() === last.getMonth() ? '' : ` ${MONTHS[first.getMonth()]}`;
      return `${DAYS[first.getDay()]} ${first.getDate()}${startMonth} – ${DAYS[last.getDay()]} ${last.getDate()} ${MONTHS[last.getMonth()]}`;
    }
  }
}

/**
 * Time per local clock hour (index 0-23) within a one-day range. Bucketed by wall-clock hour, so a
 * DST day still sums to its real length: the repeated hour lands in one bucket, the skipped hour stays 0.
 */
export function hourlyStats(intervals: readonly Interval[], range: DateRange): number[] {
  const out = new Array<number>(24).fill(0);
  for (const i of normalizeIntervals(intervals, range)) {
    for (let from = i.start; from < i.end; ) {
      const d = new Date(from);
      const intoHour = d.getMinutes() * 60_000 + d.getSeconds() * 1_000 + d.getMilliseconds();
      const to = Math.min(i.end, from - intoHour + 3_600_000);
      out[d.getHours()] += to - from;
      from = to;
    }
  }
  return out;
}

function hourlyBars(intervals: readonly Interval[], r: DateRange): DashboardBar[] {
  const day = new Date(r.from);
  return hourlyStats(intervals, r).map((ms, h) => ({
    label: `${pad(h)}:00`,
    // ponytail: the hour skipped by a spring-forward day resolves to the next hour's start; startMs is only an identity.
    startMs: new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).getTime(),
    ms,
  }));
}

function dailyBars(api: DashboardSource, r: DateRange): DashboardBar[] {
  const byDay = new Map(api.getDailyStats(r).map((d) => [d.day, d.ms]));
  const bars: DashboardBar[] = [];
  for (let t = r.from; t < r.to; t = nextPeriodStart(t, 'day')) {
    const d = new Date(t);
    bars.push({ label: `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`, startMs: t, ms: byDay.get(dayKey(t)) ?? 0 });
  }
  return bars;
}

function monthlyBars(intervals: readonly Interval[], now: number): DashboardBar[] {
  if (intervals.length === 0) return [];
  const byMonth = new Map(periodStats(intervals, ALL_TIME, 'month').map((m) => [m.day, m.ms]));
  const end = nextPeriodStart(now, 'month');
  const bars: DashboardBar[] = [];
  // getIntervals returns time-ordered intervals, so [0] is the earliest.
  for (let t = periodStart(intervals[0].start, 'month'); t < end; t = nextPeriodStart(t, 'month')) {
    const d = new Date(t);
    bars.push({ label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, startMs: t, ms: byMonth.get(dayKey(t)) ?? 0 });
  }
  return bars;
}

/** Ranks by time, keeps at most MAX_SHARES rows (the last one "Other" when folding) and rounds percents. */
export function toShares(items: { name: string; ms: number }[], totalMs: number): Share[] {
  const ranked = items.filter((i) => i.ms > 0).sort((a, b) => b.ms - a.ms);
  const shown = ranked.length > MAX_SHARES ? ranked.slice(0, MAX_SHARES - 1) : ranked;
  const rest = ranked.slice(shown.length).reduce((n, i) => n + i.ms, 0);
  if (rest > 0) shown.push({ name: 'Other', ms: rest });
  return shown.map((i) => ({ name: i.name, ms: i.ms, percent: totalMs > 0 ? Math.round((i.ms / totalMs) * 100) : 0 }));
}

export function buildDashboardModel(api: DashboardSource, range: DashboardRange, now: number, enabled: boolean): DashboardModel {
  const r = rangeFor(range, now);
  const projects = api.getProjectStats(r);
  const totalMs = projects.reduce((n, p) => n + p.ms, 0);

  let bars: DashboardBar[];
  let barUnit: DashboardModel['barUnit'];
  if (range === 'today' || range === 'yesterday') {
    bars = hourlyBars(api.getIntervals(r), r);
    barUnit = 'hour';
  } else if (range === 'all') {
    bars = monthlyBars(api.getIntervals(r), now);
    barUnit = 'month';
  } else {
    bars = dailyBars(api, r);
    barUnit = 'day';
  }

  return {
    range,
    rangeLabel: rangeLabel(range, r),
    enabled,
    totalMs,
    bars,
    barUnit,
    projects: toShares(projects.map((p) => ({ name: p.project.name, ms: p.ms })), totalMs),
    languages: toShares(api.getLanguageStats(r).map((l) => ({ name: l.language || TERMINAL_LABEL, ms: l.ms })), totalMs),
    sessions: api
      .getSessions(r)
      .slice(-MAX_SESSIONS)
      .reverse()
      .map((s) => ({
        start: s.start,
        end: s.end,
        ms: s.durationMs,
        projects: s.projects.map((p) => p.name),
        languages: s.languages,
        files: s.files,
      })),
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all earlier suites plus the new `dashboardModel.test.js` tests (the two DST tests may report `skipped` only if the platform ignores `process.env.TZ`; if so, run them once with `TZ=Europe/Vienna npm test` from Git Bash before committing).

- [ ] **Step 7: Commit**

```bash
git add extensions/null-activity/src/protocol.ts extensions/null-activity/src/dashboardModel.ts extensions/null-activity/src/test/dashboardModel.test.ts extensions/null-activity/package.json
git commit -m "feat(null-activity): dashboard view-model and webview message parsing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Webview shared helpers (`dom.ts`, `model.ts`) and their vm tests

**Files:**
- Create: `src/webview/dashboard/dom.ts`, `src/webview/dashboard/model.ts`, `tsconfig.webview-dashboard-shared.json`, `src/test/dashboardWebviewModel.test.ts`
- Modify: `tsconfig.json`, `package.json` (`compile`, `test`)

**Interfaces:**
- Consumes: global types `DashboardBar`, `Share` from `src/protocol.ts` (Task 1).
- Produces (global functions, used by Task 3):
  - `h(tag: string, attrs?: Attrs, ...children: Child[]): HTMLElement`, `s(tag, attrs?, ...children): SVGElement`
  - `formatDuration(ms: number): string`, `formatPercent(percent: number, ms: number): string`
  - `barScale(values: number[], maxPx: number, stubPx: number): number[]`
  - `axisTicks(count: number, max: number): number[]`
  - `barLabel(bar: DashboardBar): string`
  - `formatDateTime(ts: number): string`
  - `filesTitle(files: string[], max: number): string`
  - `nextIndex(index: number, count: number, key: string): number | undefined`

- [ ] **Step 1: Create the shared tsconfig and keep the webview out of the host program**

Create `tsconfig.webview-dashboard-shared.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "none",
    "lib": ["ES2017", "DOM"],
    "outFile": "./out/webview-dashboard-shared.js",
    "strict": true,
    "sourceMap": false,
    "skipLibCheck": true
  },
  "include": [
    "src/protocol.ts",
    "src/webview/dashboard/dom.ts",
    "src/webview/dashboard/model.ts"
  ]
}
```

In `tsconfig.json`, add `exclude` after `include` (the host program has no DOM lib):

```json
  "include": ["src/**/*.ts"],
  "exclude": ["src/webview"]
```

In `package.json` set:

```json
"compile": "tsc -p tsconfig.json && tsc -p tsconfig.webview-dashboard-shared.json",
"test": "tsc -p tsconfig.json && tsc -p tsconfig.webview-dashboard-shared.json && node --test out/test/tracker.test.js out/test/stats.test.js out/test/intervalStore.test.js out/test/projectIdentity.test.js out/test/activityService.test.js out/test/privacy.test.js out/test/dashboardModel.test.js out/test/dashboardWebviewModel.test.js",
```

- [ ] **Step 2: Write the failing test**

Create `src/test/dashboardWebviewModel.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

// The webview bundle is a plain script, so load the compiled shared file into a sandbox that has a
// tiny fake `document` (no jsdom) and read its top-level functions off it.
class FakeNode {
  children: FakeNode[] = [];
  attrs: Record<string, string> = {};
  constructor(readonly tag: string, readonly text?: string) {}
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  appendChild(c: FakeNode) {
    this.children.push(c);
    return c;
  }
}

const counter = { elements: 0 };
const document = {
  createElement: (tag: string) => {
    counter.elements++;
    return new FakeNode(tag);
  },
  createTextNode: (text: string) => new FakeNode('#text', text),
};
const sandbox = vm.createContext({ document });
vm.runInContext(readFileSync(path.join(__dirname, '..', 'webview-dashboard-shared.js'), 'utf8'), sandbox);
const w = sandbox as unknown as {
  h(tag: string, attrs?: Record<string, unknown> | null, ...children: unknown[]): FakeNode;
  formatDuration(ms: number): string;
  formatPercent(percent: number, ms: number): string;
  barScale(values: number[], maxPx: number, stubPx: number): number[];
  axisTicks(count: number, max: number): number[];
  barLabel(bar: { label: string; startMs: number; ms: number }): string;
  formatDateTime(ts: number): string;
  filesTitle(files: string[], max: number): string;
  nextIndex(index: number, count: number, key: string): number | undefined;
};
/** Arrays made inside the vm have another realm's prototype; round-trip them before deepStrictEqual. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

test('h() keeps markup in names inert: one element, text node child, literal attributes', () => {
  counter.elements = 0;
  const evil = '"><img src=x onerror=alert(1)>';
  const row = w.h('li', { 'data-id': evil, title: evil }, evil);
  assert.strictEqual(counter.elements, 1);
  assert.strictEqual(row.attrs['data-id'], evil);
  assert.strictEqual(row.attrs.title, evil);
  assert.strictEqual(row.children.length, 1);
  assert.strictEqual(row.children[0].tag, '#text');
  assert.strictEqual(row.children[0].text, evil);
});

test('h() skips null/undefined/false, sets boolean attributes and nests elements', () => {
  const inner = w.h('b', null, 'x');
  const el = w.h('div', { hidden: true, disabled: false, title: null, 'aria-pressed': 'false' }, null, undefined, false, inner, 'tail');
  assert.deepStrictEqual(plain(el.attrs), { hidden: '', 'aria-pressed': 'false' });
  assert.deepStrictEqual(el.children.map((c) => c.tag), ['b', '#text']);
});

test('formatDuration', () => {
  assert.strictEqual(w.formatDuration(0), '0m');
  assert.strictEqual(w.formatDuration(59_999), '<1m');
  assert.strictEqual(w.formatDuration(60_000), '1m');
  assert.strictEqual(w.formatDuration(3_599_999), '59m');
  assert.strictEqual(w.formatDuration(3_600_000), '1h 0m');
  assert.strictEqual(w.formatDuration((6 * 60 + 42) * 60_000), '6h 42m');
});

test('formatPercent shows "<1%" instead of a misleading 0%', () => {
  assert.strictEqual(w.formatPercent(42, 1000), '42%');
  assert.strictEqual(w.formatPercent(0, 5000), '<1%');
  assert.strictEqual(w.formatPercent(0, 0), '0%');
});

test('barScale: tallest bar fills maxPx, zero buckets keep a stub, all-zero input is all stubs', () => {
  assert.deepStrictEqual(plain(w.barScale([5, 10], 100, 2)), [50, 100]);
  assert.deepStrictEqual(plain(w.barScale([0, 10], 100, 2)), [2, 100]);
  assert.deepStrictEqual(plain(w.barScale([1, 100], 100, 2)), [2, 100]);
  assert.deepStrictEqual(plain(w.barScale([0, 0, 0], 100, 2)), [2, 2, 2]);
  assert.deepStrictEqual(plain(w.barScale([], 100, 2)), []);
});

test('axisTicks labels at most `max` evenly spaced buckets, starting at the first', () => {
  assert.deepStrictEqual(plain(w.axisTicks(24, 6)), [0, 4, 8, 12, 16, 20]);
  assert.deepStrictEqual(plain(w.axisTicks(31, 6)), [0, 6, 12, 18, 24, 30]);
  assert.deepStrictEqual(plain(w.axisTicks(7, 6)), [0, 2, 4, 6]);
  assert.deepStrictEqual(plain(w.axisTicks(1, 6)), [0]);
  assert.deepStrictEqual(plain(w.axisTicks(0, 6)), []);
});

test('barLabel joins label and duration', () => {
  assert.strictEqual(w.barLabel({ label: '14:00', startMs: 0, ms: 90 * 60_000 }), '14:00 · 1h 30m');
});

test('formatDateTime uses local time', () => {
  assert.strictEqual(w.formatDateTime(new Date(2026, 9, 8, 14, 5).getTime()), 'Thu 8 Oct, 14:05');
  assert.strictEqual(w.formatDateTime(new Date(2026, 0, 2, 0, 0).getTime()), 'Fri 2 Jan, 00:00');
});

test('filesTitle lists the files and truncates long lists', () => {
  assert.strictEqual(w.filesTitle([], 3), 'No files');
  assert.strictEqual(w.filesTitle(['a', 'b'], 3), 'a\nb');
  assert.strictEqual(w.filesTitle(['a', 'b', 'c', 'd', 'e'], 3), 'a\nb\nc\n+2 more');
});

test('nextIndex implements tab-list arrow navigation with wrap-around', () => {
  assert.strictEqual(w.nextIndex(0, 5, 'ArrowRight'), 1);
  assert.strictEqual(w.nextIndex(4, 5, 'ArrowRight'), 0);
  assert.strictEqual(w.nextIndex(0, 5, 'ArrowLeft'), 4);
  assert.strictEqual(w.nextIndex(2, 5, 'Home'), 0);
  assert.strictEqual(w.nextIndex(2, 5, 'End'), 4);
  assert.strictEqual(w.nextIndex(2, 5, 'Enter'), undefined);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — the shared `tsc` run reports `error TS18003: No inputs were found`/missing `dom.ts` & `model.ts`.

- [ ] **Step 4: Implement `dom.ts`**

Create `src/webview/dashboard/dom.ts`:

```ts
'use strict';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined> | null;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Sets attributes and appends children as text nodes or elements, so data (project names, paths)
 * is never parsed as HTML. `true` sets a boolean attribute; null/undefined/false attributes and
 * children are skipped. Never pass `style`: the CSP forbids inline style attributes
 * (use el.style.setProperty).
 */
function fill<T extends Element>(el: T, attrs: Attrs | undefined, children: Child[]): T {
  if (attrs) {
    for (const name of Object.keys(attrs)) {
      const v = attrs[name];
      if (v === null || v === undefined || v === false) continue;
      el.setAttribute(name, v === true ? '' : String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

function h(tag: string, attrs?: Attrs, ...children: Child[]): HTMLElement {
  return fill(document.createElement(tag), attrs, children);
}

function s(tag: string, attrs?: Attrs, ...children: Child[]): SVGElement {
  return fill(document.createElementNS(SVG_NS, tag) as SVGElement, attrs, children);
}
```

- [ ] **Step 5: Implement `model.ts`**

Create `src/webview/dashboard/model.ts`:

```ts
'use strict';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "6h 42m", "35m", "<1m" for under a minute, "0m" for nothing. */
function formatDuration(ms: number): string {
  if (ms <= 0) return '0m';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '<1m';
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/** A row that rounds to 0% but has time reads "<1%", not a misleading "0%". */
function formatPercent(percent: number, ms: number): string {
  return percent === 0 && ms > 0 ? '<1%' : `${percent}%`;
}

/** Size per value with the largest = maxPx; zero (or all-zero) values get stubPx so every bucket stays visible. */
function barScale(values: number[], maxPx: number, stubPx: number): number[] {
  let max = 0;
  for (const v of values) if (v > max) max = v;
  return values.map((v) => (v <= 0 || max <= 0 ? stubPx : Math.max(stubPx, Math.round((v / max) * maxPx))));
}

/** Indexes to label under a graph: at most `max`, evenly spaced, always starting at 0. */
function axisTicks(count: number, max: number): number[] {
  const step = Math.max(1, Math.ceil(count / max));
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  return out;
}

/** Tooltip text and accessible name of a graph bar. */
function barLabel(bar: DashboardBar): string {
  return `${bar.label} · ${formatDuration(bar.ms)}`;
}

/** "Thu 8 Oct, 14:05" in the viewer's local time. */
function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Hover text for a session row: one file per line, the first `max` only. */
function filesTitle(files: string[], max: number): string {
  if (files.length === 0) return 'No files';
  return files.length > max ? [...files.slice(0, max), `+${files.length - max} more`].join('\n') : files.join('\n');
}

/** Arrow-key navigation for a tab list; `undefined` for keys that do not move. */
function nextIndex(index: number, count: number, key: string): number | undefined {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including all `dashboardWebviewModel.test.js` tests.

- [ ] **Step 7: Commit**

```bash
git add extensions/null-activity/src/webview/dashboard/dom.ts extensions/null-activity/src/webview/dashboard/model.ts extensions/null-activity/src/test/dashboardWebviewModel.test.ts extensions/null-activity/tsconfig.webview-dashboard-shared.json extensions/null-activity/tsconfig.json extensions/null-activity/package.json
git commit -m "feat(null-activity): dashboard webview helpers (dom, formatting, bar scaling)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Webview UI (graph, breakdowns, sessions, page) and styles

**Files:**
- Create: `src/webview/dashboard/graph.ts`, `breakdown.ts`, `sessions.ts`, `main.ts`, `tsconfig.webview-dashboard.json`, `lib/dashboard.css`
- Modify: `package.json` (`compile`, `test`)

**Interfaces:**
- Consumes: Task 2's `h`, `s`, `formatDuration`, `formatPercent`, `barScale`, `axisTicks`, `barLabel`, `formatDateTime`, `filesTitle`, `nextIndex`; Task 1's global types.
- Produces: `lib/dashboard.js` (generated) that, on load, sends `{ type: 'ready' }` and renders every `{ type: 'model', model }` it receives; it sends `setRange`, `enableTracking`, `showTrackedData`, `openSettings` intents (Task 4 handles them). Expects markup `<div id="app"></div>` and `lib/dashboard.css`.

There is no unit test for the DOM assembly (the spec covers only the pure helpers); the correctness check for this task is a clean type-check of the whole webview program plus the visual check in Task 6.

- [ ] **Step 1: Create the webview tsconfig**

Create `tsconfig.webview-dashboard.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "none",
    "lib": ["ES2017", "DOM"],
    "outFile": "./lib/dashboard.js",
    "strict": true,
    "sourceMap": false,
    "skipLibCheck": true
  },
  "include": [
    "src/protocol.ts",
    "src/webview/dashboard/dom.ts",
    "src/webview/dashboard/model.ts",
    "src/webview/dashboard/graph.ts",
    "src/webview/dashboard/breakdown.ts",
    "src/webview/dashboard/sessions.ts",
    "src/webview/dashboard/main.ts"
  ]
}
```

In `package.json` set:

```json
"compile": "tsc -p tsconfig.json && tsc -p tsconfig.webview-dashboard-shared.json && tsc -p tsconfig.webview-dashboard.json",
"test": "tsc -p tsconfig.json && tsc -p tsconfig.webview-dashboard-shared.json && tsc -p tsconfig.webview-dashboard.json && node --test out/test/tracker.test.js out/test/stats.test.js out/test/intervalStore.test.js out/test/projectIdentity.test.js out/test/activityService.test.js out/test/privacy.test.js out/test/dashboardModel.test.js out/test/dashboardWebviewModel.test.js",
```

- [ ] **Step 2: Implement the graph**

Create `src/webview/dashboard/graph.ts`:

```ts
'use strict';

const GRAPH_HEIGHT = 120; // viewBox height; the SVG is stretched to the container by CSS
const BAR_SLOT = 10;

/** Inline-SVG bars scaled to the largest bucket; every bar is focusable, with a hover/focus tooltip. */
function renderGraph(model: DashboardModel): HTMLElement {
  const bars = model.bars;
  const heights = barScale(bars.map((b) => b.ms), GRAPH_HEIGHT, 2);
  const tip = h('div', { class: 'tip', role: 'tooltip', hidden: true });
  const centre = (i: number) => `${((i + 0.5) / bars.length) * 100}%`;

  const rects = bars.map((bar, i) => {
    const rect = s('rect', {
      class: 'bar',
      x: i * BAR_SLOT + 1,
      y: GRAPH_HEIGHT - heights[i],
      width: BAR_SLOT - 2,
      height: heights[i],
      tabindex: 0,
      role: 'img',
      'aria-label': barLabel(bar),
    });
    const show = () => {
      tip.textContent = barLabel(bar);
      tip.style.setProperty('left', centre(i));
      tip.hidden = false;
    };
    const hide = () => {
      tip.hidden = true;
    };
    rect.addEventListener('mouseenter', show);
    rect.addEventListener('focus', show);
    rect.addEventListener('mouseleave', hide);
    rect.addEventListener('blur', hide);
    return rect;
  });

  const svg = s(
    'svg',
    {
      class: 'graph-svg',
      viewBox: `0 0 ${bars.length * BAR_SLOT} ${GRAPH_HEIGHT}`,
      preserveAspectRatio: 'none',
      role: 'group',
      'aria-label': 'Activity graph',
    },
    ...rects,
  );

  const ticks = axisTicks(bars.length, 6).map((i) => {
    const tick = h('span', { class: 'tick' }, bars[i].label);
    tick.style.setProperty('left', centre(i));
    return tick;
  });

  return h('section', { class: 'graph' }, h('div', { class: 'plot' }, svg, tip), h('div', { class: 'axis' }, ...ticks));
}
```

- [ ] **Step 3: Implement the breakdown**

Create `src/webview/dashboard/breakdown.ts`:

```ts
'use strict';

/** One card: a ranked list of name, proportional bar (relative to the largest row), duration and percent. */
function renderBreakdown(title: string, shares: Share[]): HTMLElement {
  const widths = barScale(shares.map((share) => share.ms), 100, 0);
  const rows = shares.map((share, i) => {
    const fillBar = h('div', { class: 'fill' });
    fillBar.style.setProperty('width', `${widths[i]}%`);
    return h(
      'li',
      { class: 'row' },
      h('span', { class: 'name', title: share.name }, share.name),
      h('div', { class: 'track' }, fillBar),
      h('span', { class: 'dur' }, formatDuration(share.ms)),
      h('span', { class: 'pct' }, formatPercent(share.percent, share.ms)),
    );
  });
  return h('section', { class: 'card' }, h('h2', null, title), h('ul', { class: 'rows' }, ...rows));
}
```

- [ ] **Step 4: Implement the sessions table**

Create `src/webview/dashboard/sessions.ts`:

```ts
'use strict';

const SESSION_FILES_SHOWN = 20;

/** Table of start, duration, projects, languages and file count; hovering a row lists its files. */
function renderSessions(rows: SessionRow[]): HTMLElement {
  const head = ['Start', 'Duration', 'Projects', 'Languages', 'Files'].map((title) => h('th', { scope: 'col' }, title));
  const body = rows.map((row) =>
    h(
      'tr',
      { title: filesTitle(row.files, SESSION_FILES_SHOWN) },
      h('td', null, formatDateTime(row.start)),
      h('td', null, formatDuration(row.ms)),
      h('td', null, row.projects.join(', ')),
      h('td', null, row.languages.join(', ')),
      h('td', { class: 'num' }, String(row.files.length)),
    ),
  );
  return h(
    'section',
    { class: 'card' },
    h('h2', null, 'Sessions'),
    h('table', { class: 'sessions' }, h('thead', null, h('tr', null, ...head)), h('tbody', null, ...body)),
  );
}
```

- [ ] **Step 5: Implement the page**

Create `src/webview/dashboard/main.ts`:

```ts
'use strict';

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHost): void };

const vscodeApi = acquireVsCodeApi();
const RANGE_TABS: { id: DashboardRange; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];
const appRoot = document.getElementById('app') as HTMLElement;

function send(message: WebviewToHost): void {
  vscodeApi.postMessage(message);
}

function linkButton(text: string, message: WebviewToHost): HTMLElement {
  const button = h('button', { type: 'button', class: 'link' }, text);
  button.addEventListener('click', () => send(message));
  return button;
}

function renderTabs(model: DashboardModel): HTMLElement {
  const current = RANGE_TABS.findIndex((tab) => tab.id === model.range);
  const tabs = RANGE_TABS.map((tab, i) => {
    const selected = i === current;
    const button = h(
      'button',
      { type: 'button', role: 'tab', class: selected ? 'tab active' : 'tab', 'aria-selected': String(selected), tabindex: selected ? 0 : -1 },
      tab.label,
    );
    button.addEventListener('click', () => send({ type: 'setRange', range: tab.id }));
    return button;
  });
  const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Range' }, ...tabs);
  list.addEventListener('keydown', (event) => {
    const next = nextIndex(current, RANGE_TABS.length, (event as KeyboardEvent).key);
    if (next === undefined) return;
    event.preventDefault();
    send({ type: 'setRange', range: RANGE_TABS[next].id });
  });
  return list;
}

function renderBody(model: DashboardModel): Node[] {
  if (model.totalMs === 0) return [h('p', { class: 'empty' }, 'Nothing tracked in this range.')];
  return [
    renderGraph(model),
    h('div', { class: 'columns' }, renderBreakdown('Projects', model.projects), renderBreakdown('Languages', model.languages)),
    renderSessions(model.sessions),
  ];
}

function render(model: DashboardModel): void {
  // The host sends a fresh model after every range change; keep keyboard focus on the tab list across it.
  const tabsHadFocus = !!document.activeElement && !!document.activeElement.closest('.tabs');
  const parts: Node[] = [h('header', { class: 'top' }, h('h1', null, 'Coding Activity'), renderTabs(model))];
  if (!model.enabled) {
    parts.push(
      h(
        'div',
        { class: 'banner', role: 'status' },
        h('span', null, 'Tracking is off. Existing data is still shown.'),
        linkButton('Enable', { type: 'enableTracking' }),
      ),
    );
  }
  parts.push(
    h('section', { class: 'total' }, h('div', { class: 'total-value' }, formatDuration(model.totalMs)), h('div', { class: 'total-label' }, model.rangeLabel)),
    ...renderBody(model),
    h('footer', { class: 'foot' }, linkButton("What's tracked?", { type: 'showTrackedData' }), linkButton('Settings', { type: 'openSettings' })),
  );
  appRoot.replaceChildren(...parts);
  if (tabsHadFocus) appRoot.querySelector<HTMLElement>('.tab.active')?.focus();
}

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  const message = event.data;
  if (message && message.type === 'model') render(message.model);
});

send({ type: 'ready' });
```

- [ ] **Step 6: Write the stylesheet**

Create `lib/dashboard.css` (hand-written; `#0078D4` / `#026EC1` are `signal-blue` / `signal-blue-hover` from `DESIGN.md`):

```css
:root {
  --signal: #0078d4;
  --signal-hover: #026ec1;
  --surface: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.08));
  --border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.35)));
  --muted: var(--vscode-descriptionForeground, rgba(128, 128, 128, 0.9));
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 24px;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

#app {
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

h1 {
  margin: 0;
  font-size: 1.4em;
  font-weight: 600;
}

h2 {
  margin: 0 0 12px;
  font-size: 1em;
  font-weight: 600;
}

button {
  font: inherit;
  color: inherit;
  cursor: pointer;
}

button:focus-visible,
.bar:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 1px;
}

.top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tabs {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.tab {
  padding: 4px 12px;
  background: transparent;
  border: 0;
  border-right: 1px solid var(--border);
}

.tab:last-child {
  border-right: 0;
}

.tab:hover {
  background: var(--surface);
}

.tab.active {
  background: var(--signal);
  color: #fff;
}

.tab.active:hover {
  background: var(--signal-hover);
}

.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--signal);
  border-radius: 4px;
  background: var(--surface);
}

.link {
  background: none;
  border: 0;
  padding: 0;
  color: var(--vscode-textLink-foreground, var(--signal));
}

.link:hover {
  text-decoration: underline;
}

.total-value {
  font-size: 2.6em;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.total-label {
  color: var(--muted);
}

.empty {
  margin: 24px 0;
  color: var(--muted);
}

.plot {
  position: relative;
}

.graph-svg {
  display: block;
  width: 100%;
  height: 140px;
}

.bar {
  fill: var(--signal);
}

.bar:hover,
.bar:focus {
  fill: var(--signal-hover);
  outline: none;
}

.bar:focus-visible {
  stroke: var(--vscode-focusBorder);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.tip {
  position: absolute;
  bottom: 100%;
  transform: translateX(-50%);
  padding: 2px 8px;
  white-space: nowrap;
  pointer-events: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--vscode-editorHoverWidget-background, var(--surface));
  color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
}

.tip[hidden] {
  display: none;
}

.axis {
  position: relative;
  height: 1.5em;
  margin-top: 4px;
}

.tick {
  position: absolute;
  transform: translateX(-50%);
  font-size: 0.85em;
  color: var(--muted);
  white-space: nowrap;
}

.columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

@media (max-width: 700px) {
  .columns {
    grid-template-columns: 1fr;
  }
}

.card {
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  min-width: 0;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 80px 64px 40px;
  align-items: center;
  gap: 8px;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track {
  height: 6px;
  border-radius: 3px;
  background: var(--border);
  overflow: hidden;
}

.fill {
  height: 100%;
  background: var(--signal);
}

.dur,
.pct {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.pct {
  color: var(--muted);
}

.sessions {
  width: 100%;
  border-collapse: collapse;
}

.sessions th {
  text-align: left;
  font-weight: 600;
  color: var(--muted);
}

.sessions th,
.sessions td {
  padding: 6px 8px 6px 0;
  border-bottom: 1px solid var(--border);
}

.sessions tr:last-child td {
  border-bottom: 0;
}

.sessions .num {
  text-align: right;
}

.foot {
  display: flex;
  gap: 16px;
  color: var(--muted);
}
```

- [ ] **Step 7: Compile and run the whole suite**

Run: `npm test`
Expected: PASS. `tsc -p tsconfig.webview-dashboard.json` produces `lib/dashboard.js` with no type errors (a duplicate-identifier error here means two webview files declare the same global name — rename one).

- [ ] **Step 8: Commit**

```bash
git add extensions/null-activity/src/webview/dashboard/graph.ts extensions/null-activity/src/webview/dashboard/breakdown.ts extensions/null-activity/src/webview/dashboard/sessions.ts extensions/null-activity/src/webview/dashboard/main.ts extensions/null-activity/tsconfig.webview-dashboard.json extensions/null-activity/lib/dashboard.css extensions/null-activity/package.json
git commit -m "feat(null-activity): dashboard webview UI (graph, breakdowns, sessions)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: HTML shell with CSP, and the panel

**Files:**
- Create: `src/dashboardHtml.ts`, `src/dashboardPanel.ts`, `src/test/dashboardHtml.test.ts`
- Modify: `package.json` (`test`)

**Interfaces:**
- Consumes: Task 1's `buildDashboardModel`, `parseWebviewMessage`, `isDashboardRange`, `DashboardSource`; global `HostToWebview` / `WebviewToHost` / `DashboardRange`; `ActivityService` (`enabled`, `onDidChange`, and the `DashboardSource` methods); `lib/dashboard.js` + `lib/dashboard.css` from Task 3.
- Produces (used by Task 5): `getDashboardHtml(nonce: string, cspSource: string, scriptUri: string, styleUri: string): string`; `class DashboardPanel implements vscode.Disposable { constructor(context: vscode.ExtensionContext, service: ActivityService, log: (message: string) => void); reveal(): void; dispose(): void }`.

- [ ] **Step 1: Write the failing CSP test**

Create `src/test/dashboardHtml.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { getDashboardHtml } from '../dashboardHtml';

const html = getDashboardHtml('NONCE123', 'vscode-resource:', 'dash.js', 'dash.css');

test('the CSP denies everything by default and allows only the nonce\'d script and the extension stylesheet', () => {
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'nonce-NONCE123'/);
  assert.match(html, /style-src vscode-resource:/);
  assert.ok(!html.includes('unsafe-inline'));
  assert.ok(!html.includes('unsafe-eval'));
  assert.ok(!/https?:\/\//.test(html), 'no remote resources');
});

test('the page loads the nonce\'d script and the stylesheet and nothing inline', () => {
  assert.match(html, /<script nonce="NONCE123" src="dash\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="dash\.css">/);
  assert.match(html, /<div id="app"><\/div>/);
  assert.strictEqual((html.match(/<script/g) ?? []).length, 1);
});
```

In `package.json` append `out/test/dashboardHtml.test.js` to the end of the `node --test` list in the `test` script.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL at `tsc`: `Cannot find module '../dashboardHtml'`.

- [ ] **Step 3: Implement the HTML shell**

Create `src/dashboardHtml.ts`:

```ts
'use strict';

/** The whole UI is built by lib/dashboard.js; this page only sets the CSP and loads it. */
export function getDashboardHtml(nonce: string, cspSource: string, scriptUri: string, styleUri: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Coding Activity</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
```

- [ ] **Step 4: Implement the panel**

Create `src/dashboardPanel.ts`:

```ts
/// <reference path="./protocol.ts" />
'use strict';

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ActivityService } from './activityService';
import { buildDashboardModel, isDashboardRange, parseWebviewMessage } from './dashboardModel';
import { getDashboardHtml } from './dashboardHtml';

const VIEW_TYPE = 'null-activity.dashboard';
const RANGE_KEY = 'null-activity.dashboard.range';
const THROTTLE_MS = 1_000;
const REFRESH_MS = 60_000;

/** Owns the single, reused dashboard tab. All data logic lives in dashboardModel.ts. */
export class DashboardPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private range: DashboardRange;
  private lastPush = 0;
  private pending: NodeJS.Timeout | undefined;
  private openDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly service: ActivityService,
    private readonly log: (message: string) => void,
  ) {
    const saved = context.workspaceState.get<unknown>(RANGE_KEY);
    this.range = isDashboardRange(saved) ? saved : 'today';
  }

  reveal(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const lib = vscode.Uri.joinPath(this.context.extensionUri, 'lib');
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Coding Activity', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [lib],
    });
    this.panel = panel;
    const asset = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, file)).toString();
    panel.webview.html = getDashboardHtml(crypto.randomBytes(16).toString('base64'), panel.webview.cspSource, asset('dashboard.js'), asset('dashboard.css'));

    const refresh = setInterval(() => this.push(), REFRESH_MS);
    this.openDisposables.push(
      { dispose: () => clearInterval(refresh) },
      panel.webview.onDidReceiveMessage((raw) => this.onMessage(raw)),
      this.service.onDidChange(() => this.schedulePush()),
      // Enabling tracking from the banner (or in settings) changes `enabled`, which the service does not announce.
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('null-activity')) this.schedulePush();
      }),
    );
    // With retainContextWhenHidden off the page reloads when the tab is shown again and sends `ready`,
    // so no push on visibility change is needed.
    panel.onDidDispose(() => this.closed(), undefined, this.openDisposables);
  }

  dispose(): void {
    this.panel?.dispose();
    this.closed();
  }

  private closed(): void {
    this.panel = undefined;
    if (this.pending) clearTimeout(this.pending);
    this.pending = undefined;
    for (const d of this.openDisposables.splice(0)) d.dispose();
  }

  private onMessage(raw: unknown): void {
    const message = parseWebviewMessage(raw);
    if (!message) return;
    switch (message.type) {
      case 'ready':
        this.push();
        break;
      case 'setRange':
        this.range = message.range;
        void this.context.workspaceState.update(RANGE_KEY, message.range);
        this.push();
        break;
      case 'enableTracking':
        void vscode.workspace.getConfiguration('null-activity').update('enabled', true, vscode.ConfigurationTarget.Global);
        break;
      case 'showTrackedData':
        void vscode.commands.executeCommand('null-activity.showTrackedData');
        break;
      case 'openSettings':
        void vscode.commands.executeCommand('workbench.action.openSettings', 'null-activity');
        break;
    }
  }

  /** At most one push per THROTTLE_MS; a change inside the window schedules one trailing push. */
  private schedulePush(): void {
    if (this.pending) return;
    const wait = Math.max(0, THROTTLE_MS - (Date.now() - this.lastPush));
    this.pending = setTimeout(() => {
      this.pending = undefined;
      this.push();
    }, wait);
  }

  /** Builds and posts a snapshot; does nothing while the tab is hidden or closed. A failure keeps the previous model on screen. */
  private push(): void {
    const panel = this.panel;
    if (!panel || !panel.visible) return;
    this.lastPush = Date.now();
    try {
      const message: HostToWebview = {
        type: 'model',
        model: buildDashboardModel(this.service, this.range, Date.now(), this.service.enabled),
      };
      void panel.webview.postMessage(message);
    } catch (err) {
      this.log(`dashboard: could not build the model (${err instanceof Error ? err.message : String(err)})`);
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the two `dashboardHtml` tests and every earlier suite; `tsc` accepts `dashboardPanel.ts` (it passes `this.service` as a `DashboardSource` because `ActivityService implements NullActivityApi`).

- [ ] **Step 6: Commit**

```bash
git add extensions/null-activity/src/dashboardHtml.ts extensions/null-activity/src/dashboardPanel.ts extensions/null-activity/src/test/dashboardHtml.test.ts extensions/null-activity/package.json
git commit -m "feat(null-activity): dashboard panel and CSP-locked HTML shell" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire the command, status bar, extension and local sync

**Files:**
- Modify: `package.json` (command contribution), `src/commands.ts`, `src/statusBar.ts`, `src/extension.ts`, `../../scripts/sync-local.ps1`

**Interfaces:**
- Consumes: `DashboardPanel` (Task 4).
- Produces: command `null-activity.openDashboard`; status bar click opens the dashboard.

- [ ] **Step 1: Contribute the command**

In `package.json` `contributes.commands`, add as the first entry:

```json
{ "command": "null-activity.openDashboard", "title": "Null Activity: Open Dashboard" },
```

- [ ] **Step 2: Register the command**

In `src/commands.ts` change the signature and add the registration at the top of the `subscriptions.push(...)` list:

```ts
export function registerCommands(
  context: vscode.ExtensionContext,
  service: ActivityService,
  storageDir: string,
  dashboard: { reveal(): void },
): void {
```

```ts
    vscode.commands.registerCommand('null-activity.openDashboard', () => dashboard.reveal()),

```

- [ ] **Step 3: Rebind the status bar click**

In `src/statusBar.ts`:

```ts
    this.item.command = 'null-activity.openDashboard';
```

and change the enabled tooltip to:

```ts
    this.item.tooltip = 'Null Activity: time tracked today. Click to open the dashboard.';
```

- [ ] **Step 4: Construct the panel**

In `src/extension.ts` add the import `import { DashboardPanel } from './dashboardPanel';`, create the panel after `statusBar`:

```ts
  const dashboard = new DashboardPanel(context, service, (message) => output.appendLine(message));
```

add `dashboard` to `context.subscriptions.push(` right after `statusBar,`, and change the registration to:

```ts
  registerCommands(context, service, storageDir, dashboard);
```

- [ ] **Step 5: Make `sync-local.ps1` copy `lib`**

In `scripts/sync-local.ps1`, in the `"null-activity"` entry change the `Copy` list to:

```powershell
        Copy          = @(
            "package.json",
            "out",
            "lib"
        )
```

- [ ] **Step 6: Compile and run the suite**

Run: `npm test`
Expected: PASS (type-check covers the new `registerCommands` signature at its only call site).

- [ ] **Step 7: Commit**

```bash
git add extensions/null-activity/package.json extensions/null-activity/src/commands.ts extensions/null-activity/src/statusBar.ts extensions/null-activity/src/extension.ts scripts/sync-local.ps1
git commit -m "feat(null-activity): open the dashboard from a command and the status bar" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Integration spec and verification in the real IDE

**Files:**
- Create: `src/test/suite/dashboard.spec.ts`

**Interfaces:**
- Consumes: command `null-activity.openDashboard` (Task 5).

The webview's content is not inspectable from the extension host, so the spec proves the lifecycle (registered, opens, reused, survives data changes, reopens after close); the model contents are covered by Task 1.

- [ ] **Step 1: Write the spec**

Create `src/test/suite/dashboard.spec.ts`:

```ts
'use strict';

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const dashboardTabs = () =>
  vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('null-activity.dashboard'));

suite('null-activity dashboard', () => {
  test('openDashboard opens one reused panel that survives data changes and reopens after close', async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('null.null-activity')!.activate();
    assert.ok((await vscode.commands.getCommands(true)).includes('null-activity.openDashboard'), 'command not registered');

    await vscode.commands.executeCommand('null-activity.openDashboard');
    assert.strictEqual(dashboardTabs().length, 1);
    await vscode.commands.executeCommand('null-activity.openDashboard');
    assert.strictEqual(dashboardTabs().length, 1, 'a second call must reveal the same panel, not open another');

    // Editing a file fires onDidChange -> the throttled push; it must not break or close the panel.
    const file = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'dashboard-spec.txt');
    fs.writeFileSync(file, '');
    const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    await editor.edit((b) => b.insert(new vscode.Position(0, 0), 'hello\n'));
    await sleep(1_500);
    assert.strictEqual(dashboardTabs().length, 1);

    await vscode.window.tabGroups.close(dashboardTabs());
    await sleep(200);
    assert.strictEqual(dashboardTabs().length, 0);

    await vscode.commands.executeCommand('null-activity.openDashboard');
    assert.strictEqual(dashboardTabs().length, 1, 'the panel must open again after being closed');
    await vscode.window.tabGroups.close(dashboardTabs());
  });
});
```

- [ ] **Step 2: Compile the specs**

Run: `npm test`
Expected: PASS (the spec compiles with the rest; it is not part of the `node --test` list because it needs VS Code).

- [ ] **Step 3: Run it against the real build**

Invoke the `verify-local` skill with argument `null-activity` (it runs `scripts/sync-local.ps1`, `scripts/reload-local.ps1`, then `npm run test:integration`).
Expected: both the existing `activation.spec` and `dashboard.spec` pass. If the Null IDE install is missing, stop and report; do not skip.

- [ ] **Step 4: Look at it once in the synced IDE**

In the reloaded Null IDE run `Null Activity: Open Dashboard` and check, using real data (type in a file for a minute first):
1. The status bar clock item opens the dashboard on click (this one cannot be automated).
2. Each of the five range tabs works, with arrow keys moving between them and keeping focus on the tab list; reopening the dashboard restores the last range.
3. Graph: bars scale to the tallest, empty buckets show a thin stub, hovering or tabbing to a bar shows `label · duration`.
4. Switch the theme to a light one and a dark one: text, cards and bars stay readable; only the blue accent is custom.
5. Set `null-activity.enabled` to `false`: banner appears with data still shown; **Enable** flips the setting and removes the banner within about a second.
6. A range with no data shows "Nothing tracked in this range." and the tabs still work.
7. Close the tab and reopen it; keep it open while another tab is active, then return to it (it should refresh on return).

Fix anything that is off in the Task 3 files, re-run `npm test`, and amend nothing — make a new commit for any fix.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src/test/suite/dashboard.spec.ts
git commit -m "test(null-activity): dashboard lifecycle integration spec" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Documentation, compiled output and graph refresh

**Files:**
- Modify: `../../CLAUDE.md`
- Generated: `out/**`, `lib/dashboard.js`

- [ ] **Step 1: Update the null-activity paragraph in `CLAUDE.md`**

In the `### null-activity` section: change `(issue #113; engine only — dashboard, git stats, badge and WakaTime import are later specs)` to `(issue #113; engine and dashboard — git stats, badge and WakaTime import are later specs)`, and replace the final sentences `Design: \`docs/specs/null-activity-engine-design.md\`; plan: \`docs/plans/null-activity-engine.md\`. Integration spec: ...` with:

```
The **Coding Activity dashboard** (`null-activity.openDashboard`; the status bar item opens it) is one reused `WebviewPanel` in `dashboardPanel.ts`, fed by the pure `dashboardModel.ts` (`buildDashboardModel` over `NullActivityApi`, plus `parseWebviewMessage` for untrusted webview messages); the CSP shell is `dashboardHtml.ts`. The vanilla-TS UI in `src/webview/dashboard/` (`module: none`, no imports) compiles via `tsconfig.webview-dashboard.json` into the tracked `lib/dashboard.js`; `tsconfig.webview-dashboard-shared.json` compiles `protocol.ts`/`dom.ts`/`model.ts` for the `vm` tests; `lib/dashboard.css` is hand-written; `tsconfig.json` excludes `src/webview`. `sync-local.ps1` copies `lib`. It is read-only (no delete buttons) and adds no engine API. Designs: `docs/specs/null-activity-engine-design.md`, `docs/specs/null-activity-dashboard-design.md`; plans: `docs/plans/null-activity-engine.md`, `docs/plans/null-activity-dashboard.md`. Integration specs: `npm run test:integration` (via `/verify-local null-activity`).
```

- [ ] **Step 2: Commit the docs**

```bash
git add CLAUDE.md
git commit -m "docs: document the null-activity dashboard" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Refresh the generated output and check it is clean**

Run: `npm run compile`, then `git status --short`
Expected: only `extensions/null-activity/out/**` and `extensions/null-activity/lib/dashboard.js` appear as new/modified, nothing under `src/`. Do not stage unrelated pre-existing changes.

- [ ] **Step 4: Commit the generated output**

```bash
git add extensions/null-activity/out extensions/null-activity/lib/dashboard.js
git commit -m "chore: refresh null-activity compiled output" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Refresh the knowledge graph**

Run: `graphify update .`
Expected: completes without error (AST-only, no API cost). Commit `graphify-out/` only if the repo tracks it (`git status` shows it).

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| One reused `WebviewPanel`, no dependency on other Null extensions | 4 |
| Five preset ranges, default Today, remembered in `workspaceState` | 1 (`rangeFor`), 4 (`RANGE_KEY`) |
| Pure view-model on the host; webview holds no data logic; no chart lib | 1, 2, 3 |
| Engine untouched; hourly bucketing next to the model | 1 (`hourlyStats` in `dashboardModel.ts`) |
| No delete in dashboard; footer links to `showTrackedData` and settings | 3, 4 |
| Data model + bar rules (hour/day/month, DST, `Terminal / other`) | 1 |
| Protocol and push cadence (ready, setRange, throttled `onDidChange`, 60 s, hidden = no recompute) | 4 |
| UI: header + tablist with arrow keys, total, graph (stub, tooltip, focusable `aria-label`), two breakdowns, sessions with file hover, footer | 2 (`nextIndex`, scaling), 3 |
| States: tracking off banner + Enable; empty range | 3 |
| Webview security (CSP, nonce, `localResourceRoots`, `textContent`) | 4 (+ Task 2 `h()` test) |
| Error handling: build throw keeps previous model; unknown messages ignored; no retain; dispose cleans up | 4, 1 (`parseWebviewMessage`) |
| Tests: `dashboardModel.test.ts`, `dashboardWebviewModel.test.ts`, one integration spec | 1, 2, 6 |
| Wiring: `package.json` compile/test/command, `sync-local.ps1` `lib`, CLAUDE.md; `build.yml` unchanged | 1–5, 7 |

**Deliberate deviations from the spec text (worth confirming):**
- *24 bars on DST days.* The spec says both "24 hourly bars" and "DST days have 23 or 25 hourly buckets". The plan always renders 24 bars keyed by wall-clock hour (the skipped hour is an empty bar, the repeated hour is merged into one), which keeps the graph shape stable and still sums to the real total.
- *No HTML-escaping function.* The spec lists "escaping" under `dom.ts`; `h()`/`s()` only create text nodes and attributes, so nothing is ever parsed as HTML and an escape helper would be dead code. The inertness test replaces it.
- *Two small extra pure files/functions:* `dashboardHtml.ts` (so the CSP can be unit-tested; the panel still owns using it) and `parseWebviewMessage` in `dashboardModel.ts` (so the "ignore unknown messages" rule is testable).
- *Status-bar click is checked by hand* (Task 6 Step 4): extensions cannot click a status bar item, so the integration spec asserts the command, not the click.

**Placeholder scan:** none; every code step carries its code.

**Type consistency:** `DashboardModel`/`DashboardBar`/`Share`/`SessionRow`/`HostToWebview`/`WebviewToHost` are defined once in `protocol.ts` and used with the same names in Tasks 1–4; `buildDashboardModel(api, range, now, enabled)`, `parseWebviewMessage`, `isDashboardRange`, `getDashboardHtml(nonce, cspSource, scriptUri, styleUri)` and `DashboardPanel(context, service, log)` are used with identical signatures where consumed; webview helper names (`barScale`, `axisTicks`, `barLabel`, `formatDateTime`, `filesTitle`, `nextIndex`, `formatDuration`, `formatPercent`) match between Task 2 definitions, Task 2 tests and Task 3 callers.

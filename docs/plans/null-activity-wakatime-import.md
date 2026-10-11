# Null Activity WakaTime Import Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** `null-activity.importWakaTime` turns a wakatime.com export (raw heartbeats) into ordinary intervals in the local activity log, so the dashboard, stats and badges include history from before Null IDE tracked anything.

**Architecture:** A pure `convertExport` (heartbeats → intervals, with an injected project resolver) and a pure language-name table feed an internal `ActivityService.replaceImported`, which swaps the `import-wakatime` interval files through a new `IntervalStore.replaceWindow`. `wakatimeProjects.ts` is the only filesystem-touching resolver (matches projects to local git repos through `projectIdentity`); `importCommand.ts` is the only new file importing `vscode`.

**Tech Stack:** TypeScript, `node --test`, `@vscode/test-electron` (one integration spec). No new dependency.

**Spec:** `docs/specs/null-activity-wakatime-import-design.md`

All commands run from `extensions/null-activity/` unless a step says otherwise.

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

- Source is the wakatime.com export file only: `{ user, range, days: [{ date, heartbeats: [...] }] }`. No WakaTime API, no API key, no network code anywhere in this work. `fetch` stays confined to `gistHttp.ts`.
- Read only `days` and `user.timeout` from the export. Nothing else from `user` (it holds email and profile data) is stored. No absolute paths, no machine ids in any interval.
- All categories count as active time (including "AI Coding"). No `category` field on `Interval`.
- Gap rule is the export's own `user.timeout` in minutes (15 when absent, non-numeric or ≤ 0). A heartbeat counts until the next one only if the gap is ≤ the timeout; otherwise it counts nothing, and the last heartbeat of a streak counts nothing.
- Imported intervals live in `intervals-YYYY-MM-import-wakatime.jsonl` (window id `import-wakatime`, exported as `WAKATIME_WINDOW_ID`). Re-importing replaces them. The previous import is replaced only after conversion succeeds.
- `NullActivityApi` and the `Interval` type do not change. `replaceImported` / `hasImport` are internal `ActivityService` methods, not on the object `activate()` returns.
- `linesAdded` and `linesRemoved` are `0` on imported intervals; `branch` is unset.
- `type: "app"` heartbeats import under project `(no folder)` (`NO_FOLDER`), language `''`, no `file`.
- Only `importCommand.ts` (and `extension.ts`) newly import `vscode`.
- Do not change the engine's idle timeout default or heartbeat coverage: that is issue #123.
- Never hand-edit `out/`. `tsc` rewrites the tracked `out/` in every task: leave it unstaged (each task stages only the files it lists) and commit it once in Task 7 (`chore: refresh null-activity compiled output`).
- A new test file does nothing until it is added to the `test` script in `package.json` (each task that adds one does this).
- Commit messages end with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` trailer. Never skip hooks, never push, never amend.

## Review Focus

Inputs and conditions the spec implies that a real export will hit. Each line has a test in the named task.

1. **Windows, POSIX and relative `entity` paths in one export** (the author's has 80k Windows, 5k POSIX, 378 relative). Expect: no crash, basename file names, no path leaks. — Task 2
2. **The same instant from two machines / duplicate timestamps.** Expect: no double-counted or zero-length intervals. — Task 2
3. **Re-running the import, and importing while native tracking overlaps the same hours.** Expect: the second import replaces the first; overlapping time is counted once. — Tasks 3 and 4
4. **An export far bigger than the store's 5,000-interval buffer** (the author's yields tens of thousands). Expect: every interval is kept. — Task 3
5. **A JSON file that is not a WakaTime export, or an export with a missing/zero `user.timeout`.** Expect: a clear error and no data touched; a 15 min fallback. — Tasks 2 and 5

---

### Task 1: Language name table

**Files:**
- Create: `extensions/null-activity/src/languageMap.ts`
- Create: `extensions/null-activity/src/test/languageMap.test.ts`
- Modify: `extensions/null-activity/package.json` (the `test` script)

**Interfaces:**
- Produces: `languageId(wakatimeName: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/test/languageMap.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { languageId } from '../languageMap';

test('maps WakaTime names whose slug would differ from the VS Code language id', () => {
  const want: Record<string, string> = {
    'C++': 'cpp',
    'C#': 'csharp',
    'F#': 'fsharp',
    Batchfile: 'bat',
    Bash: 'shellscript',
    Text: 'plaintext',
    'JSON with Comments': 'jsonc',
    'Vue.js': 'vue',
  };
  for (const [name, id] of Object.entries(want)) assert.strictEqual(languageId(name), id, name);
});

test('other names fall back to a lowercase slug', () => {
  assert.strictEqual(languageId('TypeScript'), 'typescript');
  assert.strictEqual(languageId('Markdown'), 'markdown');
  assert.strictEqual(languageId('C'), 'c');
  assert.strictEqual(languageId('Image (svg)'), 'image-svg');
  assert.strictEqual(languageId('Microsoft Visual Studio Solution'), 'microsoft-visual-studio-solution');
});

test('empty stays empty and object prototype names are not special', () => {
  assert.strictEqual(languageId(''), '');
  assert.strictEqual(languageId('constructor'), 'constructor');
});
```

- [ ] **Step 2: Register the test and run it to verify it fails**

In `package.json`, append ` out/test/languageMap.test.js` to the end of the `node --test …` list in the `test` script (after `out/test/badgePublisher.test.js`).

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module '../languageMap'`.

- [ ] **Step 3: Write the implementation**

Create `src/languageMap.ts`:

```ts
'use strict';

/** WakaTime display name → VS Code languageId, for names whose slug would not match the id. */
const KNOWN: Record<string, string> = {
  'C++': 'cpp',
  'C#': 'csharp',
  'F#': 'fsharp',
  'Objective-C++': 'objective-cpp',
  Batchfile: 'bat',
  Bash: 'shellscript',
  Text: 'plaintext',
  'Git Config': 'properties',
  'JSON with Comments': 'jsonc',
  TSConfig: 'jsonc',
  Docker: 'dockerfile',
  GDScript3: 'gdscript',
  XAML: 'xml',
  'Vue.js': 'vue',
};

export function languageId(wakatimeName: string): string {
  if (Object.prototype.hasOwnProperty.call(KNOWN, wakatimeName)) return KNOWN[wakatimeName];
  return wakatimeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/test/languageMap.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src/languageMap.ts extensions/null-activity/src/test/languageMap.test.ts extensions/null-activity/package.json
git commit -m "feat(null-activity): map WakaTime language names to VS Code ids"
```

---

### Task 2: Convert an export into intervals

**Files:**
- Create: `extensions/null-activity/src/wakatimeImport.ts`
- Create: `extensions/null-activity/src/test/wakatimeImport.test.ts`
- Modify: `extensions/null-activity/package.json` (the `test` script)

**Interfaces:**
- Consumes: `languageId(name: string): string` (Task 1); `NO_FOLDER` from `./projectIdentity`; `Interval` from `./types`.
- Produces:
  - `const WAKATIME_WINDOW_ID = 'import-wakatime'`
  - `interface ResolvedWakaProject { key: string; name: string; root?: string }`
  - `type WakaProjectResolver = (projectName: string, dir: string) => ResolvedWakaProject | undefined` (`dir` uses forward slashes)
  - `interface ImportSummary { days: number; totalMs: number; heartbeats: number; skipped: number; appHeartbeats: number; projectsResolved: number; projectsByName: number; timeoutMs: number }`
  - `convertExport(data: unknown, resolve: WakaProjectResolver): { intervals: Interval[]; summary: ImportSummary }` — throws `Error('Not a WakaTime export: no "days" list found.')`
  - `formatSummary(s: ImportSummary): string`

- [ ] **Step 1: Write the failing tests**

Create `src/test/wakatimeImport.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { NO_FOLDER } from '../projectIdentity';
import { convertExport, formatSummary, WakaProjectResolver } from '../wakatimeImport';

const T0 = Date.UTC(2025, 3, 10, 12, 0, 0) / 1000; // seconds, like the export
const hb = (offsetSec: number, over: Record<string, unknown> = {}) => ({
  time: T0 + offsetSec,
  project: 'proj',
  language: 'TypeScript',
  entity: 'C:\\code\\proj\\src\\a.ts',
  type: 'file',
  ...over,
});
const exportOf = (beats: unknown[], timeout?: number) => ({
  user: timeout === undefined ? {} : { timeout },
  range: {},
  days: [{ date: '2025-04-10', heartbeats: beats }],
});
const noResolve: WakaProjectResolver = () => undefined;
const ms = (offsetSec: number) => (T0 + offsetSec) * 1000;

test('a gap equal to the timeout counts, one second more does not', () => {
  const at = convertExport(exportOf([hb(0), hb(15 * 60)], 15), noResolve).intervals;
  assert.deepStrictEqual(at.map((i) => [i.start, i.end]), [[ms(0), ms(15 * 60)]]);
  assert.deepStrictEqual(convertExport(exportOf([hb(0), hb(15 * 60 + 1)], 15), noResolve).intervals, []);
});

test('consecutive heartbeats with the same project, language and file merge into one interval', () => {
  const { intervals } = convertExport(exportOf([hb(0), hb(60), hb(120)]), noResolve);
  assert.deepStrictEqual(intervals.map((i) => [i.start, i.end]), [[ms(0), ms(120)]]);
  assert.deepStrictEqual(
    { project: intervals[0].project, language: intervals[0].language, file: intervals[0].file, a: intervals[0].linesAdded, r: intervals[0].linesRemoved },
    { project: { key: 'proj', name: 'proj' }, language: 'typescript', file: 'a.ts', a: 0, r: 0 },
  );
});

test('a change of file, project or language starts a new interval', () => {
  for (const over of [{ entity: 'C:\\code\\proj\\src\\b.ts' }, { project: 'other' }, { language: 'Python' }]) {
    const { intervals } = convertExport(exportOf([hb(0), hb(60, over), hb(120, over)]), noResolve);
    assert.deepStrictEqual(intervals.map((i) => [i.start, i.end]), [[ms(0), ms(60)], [ms(60), ms(120)]], JSON.stringify(over));
  }
});

test('the last heartbeat of a streak counts nothing', () => {
  const { intervals } = convertExport(exportOf([hb(0), hb(60), hb(10_000)]), noResolve);
  assert.deepStrictEqual(intervals.map((i) => [i.start, i.end]), [[ms(0), ms(60)]]);
});

test('heartbeats at the same instant (two machines) do not double-count or create empty intervals', () => {
  const b = { entity: 'C:\\code\\proj\\src\\b.ts' };
  const { intervals } = convertExport(exportOf([hb(0), hb(0, b), hb(60, b)]), noResolve);
  assert.deepStrictEqual(intervals.map((i) => [i.start, i.end, i.file]), [[ms(0), ms(60), 'b.ts']]);
});

test('unsorted input is sorted by time', () => {
  const { intervals } = convertExport(exportOf([hb(60), hb(0)]), noResolve);
  assert.deepStrictEqual(intervals.map((i) => [i.start, i.end]), [[ms(0), ms(60)]]);
});

test('malformed heartbeats are skipped and counted', () => {
  const { intervals, summary } = convertExport(exportOf([hb(0), { project: 'x' }, { time: 'abc' }, null, hb(60)]), noResolve);
  assert.strictEqual(intervals.length, 1);
  assert.strictEqual(summary.heartbeats, 5);
  assert.strictEqual(summary.skipped, 3);
});

test('app heartbeats go to (no folder) with no language and no file', () => {
  const app = (s: number) => ({ time: T0 + s, type: 'app', project: 'Figma', language: '', entity: 'Figma' });
  const { intervals, summary } = convertExport(exportOf([app(0), app(60)]), noResolve);
  assert.strictEqual(intervals.length, 1);
  assert.deepStrictEqual(intervals[0].project, { key: NO_FOLDER, name: NO_FOLDER });
  assert.strictEqual(intervals[0].language, '');
  assert.strictEqual('file' in intervals[0], false);
  assert.strictEqual(summary.appHeartbeats, 2);
  assert.strictEqual(summary.projectsByName, 0);
});

test('a heartbeat with no project name is (no folder) but keeps its file name', () => {
  const { intervals } = convertExport(exportOf([hb(0, { project: '' }), hb(60, { project: '' })]), noResolve);
  assert.deepStrictEqual(intervals[0].project, { key: NO_FOLDER, name: NO_FOLDER });
  assert.strictEqual(intervals[0].file, 'a.ts');
});

test('a resolved project supplies the key, and files are relative to its root (case-insensitive) else the basename', () => {
  const seen: Array<[string, string]> = [];
  const resolve: WakaProjectResolver = (name, dir) => {
    seen.push([name, dir]);
    return { key: 'github.com/o/r', name: 'r', root: 'C:\\code\\proj' };
  };
  const { intervals, summary } = convertExport(
    exportOf([hb(0), hb(60, { entity: 'c:\\CODE\\proj\\src\\b.ts' }), hb(120, { entity: 'D:\\elsewhere\\c.ts' }), hb(180)]),
    resolve,
  );
  assert.deepStrictEqual(seen, [['proj', 'C:/code/proj/src']], 'resolver gets the most common directory, once');
  assert.deepStrictEqual(intervals.map((i) => i.file), ['src/a.ts', 'src/b.ts', 'c.ts']);
  assert.ok(intervals.every((i) => i.project.key === 'github.com/o/r' && i.project.name === 'r'));
  assert.strictEqual(summary.projectsResolved, 1);
  assert.strictEqual(summary.projectsByName, 0);
});

test('an unresolved or throwing resolver keeps the WakaTime name and the basename', () => {
  for (const resolve of [noResolve, (() => { throw new Error('boom'); }) as WakaProjectResolver]) {
    const { intervals, summary } = convertExport(exportOf([hb(0), hb(60)]), resolve);
    assert.deepStrictEqual(intervals[0].project, { key: 'proj', name: 'proj' });
    assert.strictEqual(intervals[0].file, 'a.ts');
    assert.strictEqual(summary.projectsByName, 1);
  }
});

test('POSIX and relative entities work and no absolute path or profile data reaches the output', () => {
  const data = exportOf(
    [hb(0, { entity: '/home/me/proj/x.rs' }), hb(60, { entity: 'rel/dir/y.rs' }), hb(120, { entity: 'C:\\Users\\me\\z.rs' }), hb(180)],
    15,
  );
  (data.user as Record<string, unknown>).email = 'me@example.com';
  const json = JSON.stringify(convertExport(data, noResolve).intervals);
  assert.ok(!json.includes('me@example.com'));
  assert.ok(!json.includes('C:'));
  assert.ok(!json.includes('/home'));
  assert.ok(!json.includes('\\'));
  assert.deepStrictEqual(convertExport(data, noResolve).intervals.map((i) => i.file), ['x.rs', 'y.rs', 'z.rs']);
});

test('the timeout comes from user.timeout and falls back to 15 minutes', () => {
  assert.deepStrictEqual(convertExport(exportOf([hb(0), hb(6 * 60)], 5), noResolve).intervals, []);
  assert.strictEqual(convertExport(exportOf([hb(0), hb(6 * 60)], 5), noResolve).summary.timeoutMs, 5 * 60_000);
  for (const t of [undefined, 0, -3, NaN]) {
    const r = convertExport(exportOf([hb(0), hb(14 * 60)], t as number | undefined), noResolve);
    assert.strictEqual(r.summary.timeoutMs, 15 * 60_000, String(t));
    assert.strictEqual(r.intervals.length, 1, String(t));
  }
});

test('the summary counts days and total time', () => {
  const day = 86_400;
  const { summary } = convertExport(exportOf([hb(0), hb(60), hb(2 * day), hb(2 * day + 120)]), noResolve);
  assert.strictEqual(summary.days, 2);
  assert.strictEqual(summary.totalMs, 3 * 60_000);
});

test('not-an-export input throws and a day without heartbeats is ignored', () => {
  for (const bad of [null, 42, {}, { days: 'x' }]) assert.throws(() => convertExport(bad, noResolve), /Not a WakaTime export/);
  assert.deepStrictEqual(convertExport({ days: [{ date: '2025-01-01' }, null] }, noResolve).intervals, []);
});

test('100k heartbeats convert without blowing up', () => {
  const many = Array.from({ length: 100_000 }, (_, i) => hb(i * 30, { entity: `C:\\code\\proj\\src\\f${i % 7}.ts` }));
  const { intervals, summary } = convertExport(exportOf(many), noResolve);
  assert.strictEqual(summary.heartbeats, 100_000);
  assert.strictEqual(intervals.length, 99_999);
  assert.strictEqual(summary.totalMs, 99_999 * 30_000);
});

test('formatSummary reports hours, projects, skips and the gap rule', () => {
  const text = formatSummary({
    days: 288, totalMs: 90 * 3_600_000, heartbeats: 1000, skipped: 2, appHeartbeats: 5,
    projectsResolved: 40, projectsByName: 153, timeoutMs: 15 * 60_000,
  });
  for (const part of ['90.0 h', '288 days', '40 matched to local repos', '153 kept by WakaTime name', '5 app', 'Skipped 2', '15 min']) {
    assert.ok(text.includes(part), `${part} in: ${text}`);
  }
});
```

- [ ] **Step 2: Register the test and run it to verify it fails**

In `package.json`, append ` out/test/wakatimeImport.test.js` to the end of the `node --test …` list.

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module '../wakatimeImport'`.

- [ ] **Step 3: Write the implementation**

Create `src/wakatimeImport.ts`:

```ts
'use strict';

import { languageId } from './languageMap';
import { NO_FOLDER } from './projectIdentity';
import { Interval } from './types';

export const WAKATIME_WINDOW_ID = 'import-wakatime';
const DEFAULT_TIMEOUT_MIN = 15;

export interface ResolvedWakaProject {
  key: string;
  name: string;
  root?: string;
}

/** `dir` is the project's most common heartbeat directory (forward slashes); undefined = not found here. */
export type WakaProjectResolver = (projectName: string, dir: string) => ResolvedWakaProject | undefined;

export interface ImportSummary {
  days: number; // days that produced at least one interval
  totalMs: number; // before overlaps with other data are clipped
  heartbeats: number; // entries read, including skipped ones
  skipped: number; // malformed: no numeric time
  appHeartbeats: number;
  projectsResolved: number; // matched to a local git repo
  projectsByName: number; // kept as the WakaTime name
  timeoutMs: number;
}

interface Beat {
  t: number; // epoch ms
  project: string;
  language: string;
  entity: string;
  app: boolean;
}

interface Context {
  key: string;
  name: string;
  language: string;
  file: string | undefined;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const slash = (p: string): string => p.replace(/\\/g, '/');
const dirOf = (entity: string): string => {
  const e = slash(entity);
  const i = e.lastIndexOf('/');
  return i <= 0 ? '' : e.slice(0, i);
};

function fileOf(entity: string, root: string | undefined): string {
  const e = slash(entity);
  if (root) {
    const prefix = slash(root).replace(/\/+$/, '') + '/';
    if (e.toLowerCase().startsWith(prefix.toLowerCase())) return e.slice(prefix.length);
  }
  return e.slice(e.lastIndexOf('/') + 1);
}

function resolveProjects(beats: Beat[], resolve: WakaProjectResolver) {
  const names = new Set<string>();
  const dirCounts = new Map<string, Map<string, number>>();
  for (const b of beats) {
    if (b.app || !b.project) continue;
    names.add(b.project);
    const dir = dirOf(b.entity);
    if (!dir.includes('/')) continue;
    const counts = dirCounts.get(b.project) ?? new Map<string, number>();
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
    dirCounts.set(b.project, counts);
  }
  const projects = new Map<string, ResolvedWakaProject>();
  let resolved = 0;
  for (const name of names) {
    const counts = dirCounts.get(name);
    const top = counts && [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    let found: ResolvedWakaProject | undefined;
    try {
      found = top ? resolve(name, top) : undefined;
    } catch {
      found = undefined; // an unreadable folder must not fail the import
    }
    if (found) resolved++;
    projects.set(name, found ?? { key: name, name });
  }
  return { projects, resolved, byName: names.size - resolved };
}

function contextOf(b: Beat, projects: Map<string, ResolvedWakaProject>): Context {
  if (b.app) return { key: NO_FOLDER, name: NO_FOLDER, language: '', file: undefined };
  const p: ResolvedWakaProject = (b.project && projects.get(b.project)) || { key: NO_FOLDER, name: NO_FOLDER };
  return { key: p.key, name: p.name, language: languageId(b.language), file: fileOf(b.entity, p.root) || undefined };
}

/**
 * Heartbeats → intervals with WakaTime's own rule: a heartbeat counts until the next one when the gap
 * is within the export's timeout.
 */
export function convertExport(data: unknown, resolve: WakaProjectResolver): { intervals: Interval[]; summary: ImportSummary } {
  if (typeof data !== 'object' || data === null || !Array.isArray((data as { days?: unknown }).days)) {
    throw new Error('Not a WakaTime export: no "days" list found.');
  }
  const root = data as { days: unknown[]; user?: { timeout?: unknown } };
  const userTimeout = Number(root.user?.timeout);
  const timeoutMs = (Number.isFinite(userTimeout) && userTimeout > 0 ? userTimeout : DEFAULT_TIMEOUT_MIN) * 60_000;

  const beats: Beat[] = [];
  let seen = 0;
  let skipped = 0;
  for (const day of root.days) {
    const list = (day as { heartbeats?: unknown } | null)?.heartbeats;
    if (!Array.isArray(list)) continue;
    for (const h of list) {
      seen++;
      const time = (h as { time?: unknown } | null)?.time;
      if (typeof time !== 'number' || !Number.isFinite(time)) {
        skipped++;
        continue;
      }
      const r = h as Record<string, unknown>;
      beats.push({ t: Math.round(time * 1000), project: str(r.project), language: str(r.language), entity: str(r.entity), app: r.type === 'app' });
    }
  }
  beats.sort((a, b) => a.t - b.t);

  const { projects, resolved, byName } = resolveProjects(beats, resolve);
  const contexts = beats.map((b) => contextOf(b, projects));

  const intervals: Interval[] = [];
  let open: Interval | undefined;
  for (let i = 0; i + 1 < beats.length; i++) {
    const start = beats[i].t;
    const end = beats[i + 1].t;
    const gap = end - start;
    if (gap <= 0 || gap > timeoutMs) continue;
    const c = contexts[i];
    if (open && open.end === start && open.project.key === c.key && open.language === c.language && open.file === c.file) {
      open.end = end;
      continue;
    }
    open = {
      start,
      end,
      project: { key: c.key, name: c.name },
      language: c.language,
      ...(c.file !== undefined ? { file: c.file } : {}),
      linesAdded: 0,
      linesRemoved: 0,
    };
    intervals.push(open);
  }

  return {
    intervals,
    summary: {
      days: new Set(intervals.map((i) => new Date(i.start).toDateString())).size,
      totalMs: intervals.reduce((sum, i) => sum + i.end - i.start, 0),
      heartbeats: seen,
      skipped,
      appHeartbeats: beats.filter((b) => b.app).length,
      projectsResolved: resolved,
      projectsByName: byName,
      timeoutMs,
    },
  };
}

export function formatSummary(s: ImportSummary): string {
  const parts = [
    `Imported ${(s.totalMs / 3_600_000).toFixed(1)} h over ${s.days} days.`,
    `Projects: ${s.projectsResolved} matched to local repos, ${s.projectsByName} kept by WakaTime name.`,
  ];
  if (s.appHeartbeats) parts.push(`${s.appHeartbeats} app heartbeats went to "${NO_FOLDER}".`);
  if (s.skipped) parts.push(`Skipped ${s.skipped} malformed heartbeats.`);
  parts.push(`Gaps up to ${s.timeoutMs / 60_000} min count as active, so imported time is measured more generously than live tracking.`);
  return parts.join(' ');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc -p tsconfig.json && node --test out/test/wakatimeImport.test.js`
Expected: PASS (all tests). If the "resolved project" test fails on `seen`, the most-common-directory logic is wrong: the directory with two heartbeats (`C:/code/proj/src`) must win over the two single-heartbeat directories.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src/wakatimeImport.ts extensions/null-activity/src/test/wakatimeImport.test.ts extensions/null-activity/package.json
git commit -m "feat(null-activity): convert WakaTime export heartbeats into intervals"
```

---

### Task 3: Replace one window's interval files

**Files:**
- Modify: `extensions/null-activity/src/intervalStore.ts:46-58` (extract the month split), `:125-127` (`fileFor`), add two methods
- Modify: `extensions/null-activity/src/test/intervalStore.test.ts` (append two tests)

**Interfaces:**
- Consumes: existing `IntervalStore`, `nextPeriodStart`, `monthKey`, private `rewrite`, `listFiles`-style readdir.
- Produces:
  - `IntervalStore.replaceWindow(windowId: string, intervals: Interval[]): void` — swaps all of that window's files for the given intervals (split at month boundaries); throws on write failure; bypasses the buffer cap.
  - `IntervalStore.hasWindow(windowId: string): boolean`

- [ ] **Step 1: Write the failing tests**

Append to `src/test/intervalStore.test.ts`:

```ts
test('replaceWindow swaps one window\'s files, splits months, can be repeated and can empty the window', () => {
  const dir = tmpDir();
  const native = new IntervalStore({ dir, windowId: 'w1' });
  native.append(iv(at(8, 9), at(8, 10)));
  native.flush();
  const store = new IntervalStore({ dir, windowId: 'w2' });
  assert.strictEqual(store.hasWindow('import-wakatime'), false);

  store.replaceWindow('import-wakatime', [iv(at(8, 10), at(8, 11)), iv(at(30, 23, 0, 8), at(1, 1, 0, 9))]);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), [
    'intervals-2026-09-import-wakatime.jsonl',
    'intervals-2026-10-import-wakatime.jsonl',
    'intervals-2026-10-w1.jsonl',
  ]);
  assert.strictEqual(store.hasWindow('import-wakatime'), true);

  store.replaceWindow('import-wakatime', [iv(at(8, 12), at(8, 13))]);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['intervals-2026-10-import-wakatime.jsonl', 'intervals-2026-10-w1.jsonl']);
  const all = { from: -Infinity, to: Infinity };
  assert.deepStrictEqual(store.read(all).sort(byStart).map((i) => i.start), [at(8, 9), at(8, 12)]);

  store.replaceWindow('import-wakatime', []);
  assert.strictEqual(store.hasWindow('import-wakatime'), false);
  assert.deepStrictEqual(fs.readdirSync(dir), ['intervals-2026-10-w1.jsonl']);
});

test('replaceWindow keeps every interval even beyond maxBuffered', () => {
  const store = new IntervalStore({ dir: tmpDir(), windowId: 'w1', maxBuffered: 10 });
  const many = Array.from({ length: 2_000 }, (_, n) => iv(at(8, 0) + n * 120_000, at(8, 0) + n * 120_000 + 60_000));
  store.replaceWindow('import-wakatime', many);
  assert.strictEqual(store.read({ from: -Infinity, to: Infinity }).length, 2_000);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `Property 'replaceWindow' does not exist on type 'IntervalStore'` (and `hasWindow`).

- [ ] **Step 3: Write the implementation**

In `src/intervalStore.ts`, replace the `append` method (lines 46-58) with a shared split plus the new `append`:

```ts
  /** Splits at local month boundaries; lines stay on the first piece. */
  private split(interval: Interval): Interval[] {
    const out: Interval[] = [];
    let piece = interval;
    for (;;) {
      const boundary = nextPeriodStart(piece.start, 'month');
      if (piece.end <= boundary) {
        out.push(piece);
        return out;
      }
      out.push({ ...piece, end: boundary });
      piece = { ...piece, start: boundary, linesAdded: 0, linesRemoved: 0 };
    }
  }

  append(interval: Interval): void {
    for (const piece of this.split(interval)) this.push(piece);
  }
```

Add these two public methods directly after `deleteAll()`:

```ts
  /**
   * Replaces every file of `windowId` with `intervals` (used by imports). Writes straight to disk, so the
   * buffer cap does not apply; throws on write failure, leaving files that were not yet replaced intact.
   */
  replaceWindow(windowId: string, intervals: Interval[]): void {
    const byMonth = new Map<string, Interval[]>();
    for (const i of intervals) {
      for (const piece of this.split(i)) {
        const month = monthKey(piece.start);
        const list = byMonth.get(month);
        if (list) list.push(piece);
        else byMonth.set(month, [piece]);
      }
    }
    fs.mkdirSync(this.opts.dir, { recursive: true });
    const fresh = new Set<string>();
    for (const [month, items] of byMonth) {
      const file = this.fileFor(month, windowId);
      this.rewrite(file, items);
      fresh.add(path.basename(file));
    }
    for (const name of this.windowFiles(windowId)) {
      if (!fresh.has(name)) fs.rmSync(path.join(this.opts.dir, name), { force: true });
    }
  }

  hasWindow(windowId: string): boolean {
    return this.windowFiles(windowId).length > 0;
  }
```

Replace `fileFor` and add `windowFiles` next to it:

```ts
  private fileFor(month: string, windowId = this.opts.windowId): string {
    return path.join(this.opts.dir, `intervals-${month}-${windowId}.jsonl`);
  }

  private windowFiles(windowId: string): string[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.opts.dir);
    } catch {
      return [];
    }
    return names.filter((name) => name.replace(/^intervals-\d{4}-\d{2}-/, '') === `${windowId}.jsonl`);
  }
```

`replaceWindow` pushes into the month's list instead of copying it (the `flush` copy pattern would be quadratic for an import-sized month).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc -p tsconfig.json && node --test out/test/intervalStore.test.js`
Expected: PASS (all existing tests plus the two new ones).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src/intervalStore.ts extensions/null-activity/src/test/intervalStore.test.ts
git commit -m "feat(null-activity): replace one window's interval files"
```

---

### Task 4: Service methods for the import

**Files:**
- Modify: `extensions/null-activity/src/activityService.ts:3-9` (imports), after `deleteAll()` (around line 145)
- Modify: `extensions/null-activity/src/test/activityService.test.ts` (import line 10, append a test)

**Interfaces:**
- Consumes: `IntervalStore.replaceWindow` / `hasWindow` (Task 3); `WAKATIME_WINDOW_ID` (Task 2).
- Produces:
  - `ActivityService.replaceImported(intervals: Interval[]): void` — fires `onDidChange`; not on `NullActivityApi`.
  - `ActivityService.hasImport(): boolean`

- [ ] **Step 1: Write the failing test**

In `src/test/activityService.test.ts` change the types import to `import { Heartbeat, Interval } from '../types';` and append:

```ts
test('replaceImported replaces the previous import, fires onDidChange, counts overlap with native time once, and is cleared by deleteAll', () => {
  const { service } = setup();
  let changes = 0;
  service.onDidChange(() => changes++);
  const imported = (start: number, end: number): Interval => ({
    start, end, project: { key: 'old', name: 'old' }, language: 'cpp', linesAdded: 0, linesRemoved: 0,
  });
  assert.strictEqual(service.hasImport(), false);

  service.replaceImported([imported(at(8, 9), at(8, 10))]);
  service.replaceImported([imported(at(8, 11), at(8, 12))]);
  assert.strictEqual(changes, 2);
  assert.strictEqual(service.hasImport(), true);
  assert.deepStrictEqual(service.getIntervals(day).map((i) => [i.start, i.end]), [[at(8, 11), at(8, 12)]]);

  // Native tracking 11:59–12:01 overlaps the end of the imported hour: 61 minutes in total, not 62.
  service.recordActivity(hb(at(8, 11, 59)));
  service.recordActivity(hb(at(8, 12, 1)));
  const total = service.getIntervals(day).reduce((sum, i) => sum + i.end - i.start, 0);
  assert.strictEqual(total, 61 * MIN);

  service.deleteAll();
  assert.strictEqual(service.hasImport(), false);
  assert.deepStrictEqual(service.getIntervals(day), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `Property 'replaceImported' does not exist on type 'ActivityService'`.

- [ ] **Step 3: Write the implementation**

In `src/activityService.ts` add the import after the `Tracker` import:

```ts
import { WAKATIME_WINDOW_ID } from './wakatimeImport';
```

Add these methods after `deleteAll()`:

```ts
  /** Swaps the previous WakaTime import for `intervals`. Internal: deliberately not on `NullActivityApi`. */
  replaceImported(intervals: Interval[]): void {
    this.opts.store.replaceWindow(WAKATIME_WINDOW_ID, intervals);
    this.dataChanged();
  }

  hasImport(): boolean {
    return this.opts.store.hasWindow(WAKATIME_WINDOW_ID);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc -p tsconfig.json && node --test out/test/activityService.test.js`
Expected: PASS (all existing tests plus the new one).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src/activityService.ts extensions/null-activity/src/test/activityService.test.ts
git commit -m "feat(null-activity): internal service methods for the WakaTime import"
```

---

### Task 5: Match projects to local repos

**Files:**
- Modify: `extensions/null-activity/src/projectIdentity.ts:34-54` (`findGitDirs`) and add `repoRoot`
- Create: `extensions/null-activity/src/wakatimeProjects.ts`
- Create: `extensions/null-activity/src/test/wakatimeProjects.test.ts`
- Modify: `extensions/null-activity/src/test/projectIdentity.test.ts` (append one test)
- Modify: `extensions/null-activity/package.json` (the `test` script)

**Interfaces:**
- Consumes: `WakaProjectResolver` (Task 2), `resolveProject` (existing).
- Produces:
  - `repoRoot(start: string): string | undefined` in `projectIdentity.ts`
  - `diskProjectResolver: WakaProjectResolver` in `wakatimeProjects.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/test/projectIdentity.test.ts` (it already imports `fs`, `path`, `tmpDir`, `repo`; add `repoRoot` to its `../projectIdentity` import):

```ts
test('repoRoot finds the folder containing .git from a nested folder, and undefined without git', () => {
  const root = tmpDir();
  repo(root, { origin: 'git@github.com:o/r.git' });
  const nested = path.join(root, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  assert.strictEqual(repoRoot(nested), root);
  const plain = path.join(tmpDir(), 'plain');
  fs.mkdirSync(plain);
  assert.strictEqual(repoRoot(plain), undefined);
});
```

Create `src/test/wakatimeProjects.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { diskProjectResolver } from '../wakatimeProjects';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-waka-'));
const forward = (p: string) => p.replace(/\\/g, '/');

function repo(root: string, remote: string): void {
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(root, '.git', 'config'), `[remote "origin"]\n\turl = ${remote}\n`);
}

test('a heartbeat directory inside an existing repo resolves to the repo key and root', () => {
  const root = tmpDir();
  repo(root, 'git@github.com:Torres/Null-IDE.git');
  const src = path.join(root, 'src');
  fs.mkdirSync(src);
  assert.deepStrictEqual(diskProjectResolver('whatever', forward(src)), {
    key: 'github.com/torres/null-ide',
    name: path.basename(root),
    root,
  });
});

test('missing, relative and non-git directories do not resolve', () => {
  assert.strictEqual(diskProjectResolver('p', forward(path.join(tmpDir(), 'does-not-exist'))), undefined);
  assert.strictEqual(diskProjectResolver('p', 'relative/dir'), undefined);
  const plain = path.join(tmpDir(), 'plain');
  fs.mkdirSync(plain);
  assert.strictEqual(diskProjectResolver('p', forward(plain)), undefined);
});
```

- [ ] **Step 2: Register the test and run it to verify it fails**

In `package.json`, append ` out/test/wakatimeProjects.test.js` to the end of the `node --test …` list.

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `repoRoot` is not exported from `../projectIdentity`; `Cannot find module '../wakatimeProjects'`.

- [ ] **Step 3: Write the implementation**

In `src/projectIdentity.ts`, change `findGitDirs` to also return the root folder. Replace its signature and the two `return` lines:

```ts
function findGitDirs(start: string): { gitDir: string; commonDir: string; root: string } | undefined {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const dotGit = path.join(dir, '.git');
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(dotGit);
    } catch {
      stat = undefined;
    }
    if (stat?.isDirectory()) return { gitDir: dotGit, commonDir: dotGit, root: dir };
    if (stat?.isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readText(dotGit) ?? '');
      if (m) {
        const gitDir = path.resolve(dir, m[1].trim());
        const common = readText(path.join(gitDir, 'commondir'))?.trim();
        return { gitDir, commonDir: common ? path.resolve(gitDir, common) : gitDir, root: dir };
      }
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** The folder that contains the `.git` found at or above `start`, if any. */
export function repoRoot(start: string): string | undefined {
  return findGitDirs(start)?.root;
}
```

Create `src/wakatimeProjects.ts`:

```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { repoRoot, resolveProject } from './projectIdentity';
import { WakaProjectResolver } from './wakatimeImport';

/**
 * Matches a WakaTime project to a git repo that still exists on this machine, so imported and native time
 * share one project key. Directories from other machines (or deleted ones) simply do not resolve.
 */
export const diskProjectResolver: WakaProjectResolver = (_projectName, dir) => {
  if (!path.isAbsolute(dir) || !fs.existsSync(dir)) return undefined;
  const root = repoRoot(dir);
  if (!root) return undefined;
  const { key, name } = resolveProject(root);
  return { key, name, root };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc -p tsconfig.json && node --test out/test/projectIdentity.test.js out/test/wakatimeProjects.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src/projectIdentity.ts extensions/null-activity/src/wakatimeProjects.ts extensions/null-activity/src/test/wakatimeProjects.test.ts extensions/null-activity/src/test/projectIdentity.test.ts extensions/null-activity/package.json
git commit -m "feat(null-activity): match WakaTime projects to local git repos"
```

---

### Task 6: The import command

**Files:**
- Create: `extensions/null-activity/src/importCommand.ts`
- Modify: `extensions/null-activity/src/extension.ts:5-9` (import), `:48` (registration)
- Modify: `extensions/null-activity/package.json` (`contributes.commands`)
- Create: `extensions/null-activity/src/test/suite/import.spec.ts`

**Interfaces:**
- Consumes: `ActivityService.replaceImported` / `hasImport` (Task 4), `convertExport` / `formatSummary` (Task 2), `diskProjectResolver` (Task 5).
- Produces: command `null-activity.importWakaTime` taking an optional `vscode.Uri` (when given, no dialogs); `registerImport(context, service, log): void`.

- [ ] **Step 1: Write the failing integration spec**

Create `src/test/suite/import.spec.ts`:

```ts
'use strict';

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { NullActivityApi } from '../../types';

suite('null-activity WakaTime import', () => {
  test('importing a small export adds its time through the API, and a non-export is rejected without touching data', async function () {
    this.timeout(30_000);
    const api = await vscode.extensions.getExtension<NullActivityApi>('null.null-activity')!.activate();
    assert.ok((await vscode.commands.getCommands(true)).includes('null-activity.importWakaTime'));

    const base = Date.UTC(2001, 0, 2, 12) / 1000;
    const heartbeats = [0, 60, 120].map((s) => ({
      time: base + s, project: 'fixture-project', language: 'TypeScript', entity: '/nonexistent/fixture-project/src/a.ts', type: 'file',
    }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-waka-spec-'));
    const good = path.join(dir, 'export.json');
    const bad = path.join(dir, 'not-an-export.json');
    fs.writeFileSync(good, JSON.stringify({ user: { timeout: 15 }, range: {}, days: [{ date: '2001-01-02', heartbeats }] }));
    fs.writeFileSync(bad, JSON.stringify({ hello: 'world' }));
    const window = { from: base * 1000 - 3_600_000, to: base * 1000 + 3_600_000 };

    try {
      await vscode.commands.executeCommand('null-activity.importWakaTime', vscode.Uri.file(bad));
      assert.deepStrictEqual(api.getIntervals(window), [], 'a rejected file must not add data');

      await vscode.commands.executeCommand('null-activity.importWakaTime', vscode.Uri.file(good));
      const got = api.getIntervals(window).map((i) => [i.project.name, i.language, i.file, i.end - i.start]);
      assert.deepStrictEqual(got, [['fixture-project', 'typescript', 'a.ts', 120_000]]);

      await vscode.commands.executeCommand('null-activity.importWakaTime', vscode.Uri.file(good));
      assert.strictEqual(api.getIntervals(window).length, 1, 're-importing replaces instead of duplicating');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Verify it cannot pass yet**

Run: `npx tsc -p tsconfig.json`
Expected: PASS (the spec compiles; it only fails at runtime when the command is missing). The behavioral red/green for this task is Step 5.

- [ ] **Step 3: Write the command**

Create `src/importCommand.ts`:

```ts
'use strict';

import * as fs from 'fs';
import * as vscode from 'vscode';
import { ActivityService } from './activityService';
import { convertExport, formatSummary } from './wakatimeImport';
import { diskProjectResolver } from './wakatimeProjects';

async function pickExport(service: ActivityService): Promise<vscode.Uri | undefined> {
  const [uri] =
    (await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'WakaTime export': ['json'] },
      openLabel: 'Import',
      title: 'Choose your WakaTime export (.json)',
    })) ?? [];
  if (!uri) return undefined;
  if (service.hasImport()) {
    const answer = await vscode.window.showWarningMessage(
      'Replace the previous WakaTime import?',
      { modal: true, detail: 'Time tracked natively is not affected.' },
      'Replace',
    );
    if (answer !== 'Replace') return undefined;
  }
  return uri;
}

export function registerImport(context: vscode.ExtensionContext, service: ActivityService, log: (message: string) => void): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('null-activity.importWakaTime', async (file?: vscode.Uri) => {
      // A caller that passes the file (a spec, another command) has already decided: no dialogs.
      const source = file ?? (await pickExport(service));
      if (!source) return;
      try {
        const summary = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Importing WakaTime history…' },
          async () => {
            const text = await fs.promises.readFile(source.fsPath, 'utf8');
            // ponytail: sync parse + convert block the extension host for a few seconds on a ~70 MB export; stream if that hurts.
            const { intervals, summary } = convertExport(JSON.parse(text), diskProjectResolver);
            service.replaceImported(intervals); // only after conversion succeeded
            return summary;
          },
        );
        void vscode.window.showInformationMessage(`Null Activity: ${formatSummary(summary)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`WakaTime import failed: ${message}`);
        void vscode.window.showErrorMessage(`Null Activity: WakaTime import failed. ${message}`);
      }
    }),
  );
}
```

In `src/extension.ts` add `import { registerImport } from './importCommand';` after the `heartbeatSource` import (alphabetical: `heartbeatSource`, `importCommand`, `intervalStore`), and after the `registerBadges(...)` line add:

```ts
  registerImport(context, service, (message) => output.appendLine(message));
```

In `package.json` add to `contributes.commands` (after `saveBadges`, mind the comma on the previous line):

```json
      { "command": "null-activity.importWakaTime", "title": "Null Activity: Import WakaTime History…" }
```

- [ ] **Step 4: Compile and run the unit suite**

Run: `npm test`
Expected: PASS — tsc clean, all `node --test` files green.

- [ ] **Step 5: Run the integration spec against the real build**

Run, from the repo root: `/verify-local null-activity` (it syncs the build into the local Null IDE, then runs `npm --prefix extensions/null-activity run test:integration`).
Expected: PASS for `import.spec.ts` ("importing a small export adds its time…") and the existing `activation.spec.ts` / `dashboard.spec.ts`. If a spec fails, show the Mocha output rather than summarizing it.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-activity/src/importCommand.ts extensions/null-activity/src/extension.ts extensions/null-activity/package.json extensions/null-activity/src/test/suite/import.spec.ts
git commit -m "feat(null-activity): import WakaTime history from a wakatime.com export"
```

---

### Task 7: Docs, compiled output, and a real-export check

**Files:**
- Modify: `CLAUDE.md` (the `### null-activity` section)
- Modify: `extensions/null-activity/out/` (regenerated by `npm run compile`, never hand-edited)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new.

- [ ] **Step 1: Update CLAUDE.md**

In the `### null-activity` section: change `WakaTime import is a later spec` in the opening parenthesis to say the import is built (the parenthesis then reads `issue #113; engine, dashboard, git statistics, badges and WakaTime import`). Before the `Designs:` sentence, add:

```
**WakaTime import** (`wakatimeImport.ts` pure: `convertExport` turns the wakatime.com export's heartbeats into intervals using the export's own `user.timeout`, 15 min when absent; `languageMap.ts` pure name table; `wakatimeProjects.ts` matches each project to a local git repo through `projectIdentity.repoRoot`, else keeps the WakaTime name; `importCommand.ts` is the `vscode` glue): `null-activity.importWakaTime` writes `intervals-YYYY-MM-import-wakatime.jsonl` through `IntervalStore.replaceWindow` via the internal `ActivityService.replaceImported` (not on `NullActivityApi`), so re-importing replaces the previous import and `deleteRange` / `deleteAll` cover it. All categories count; imported lines are 0. Passing a file URI to the command skips its dialogs (used by `import.spec.ts`).
```

Append `docs/specs/null-activity-wakatime-import-design.md` to the designs list and `docs/plans/null-activity-wakatime-import.md` to the plans list in the same sentence.

- [ ] **Step 2: Refresh compiled output and run everything**

Run: `npm run compile && npm test`
Expected: PASS. `git status` shows only `out/` files plus `CLAUDE.md` changed.

- [ ] **Step 3: Check against the real export (manual, nothing committed)**

In a synced Null IDE (`scripts/sync-local.ps1`, then `scripts/reload-local.ps1`): run **Null Activity: Import WakaTime History…** and choose the author's export (`C:\Users\Moritz\Downloads\wakatime-*.json`, ~67 MB, 85,456 heartbeats). Expected: the summary reports about 288 days and every `type: "app"` heartbeat (324) under "(no folder)"; the dashboard shows history from April 2025; running the command again asks "Replace the previous WakaTime import?" and leaves totals unchanged. Report the summary text and the all-time total next to wakatime.com's all-time total; a small difference is expected (the dashboard clips overlaps between your machines) but a large one is a bug to investigate before committing.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the null-activity WakaTime import"
git add extensions/null-activity/out
git commit -m "chore: refresh null-activity compiled output"
```

---

## Self-Review

**Spec coverage:** source file only / no network → Global Constraints + no fetch added (Tasks 2, 6); all categories → Task 2 (no category read); export timeout + 15 fallback → Task 2 timeout test; `import-wakatime` files, replace semantics, delete coverage → Tasks 3, 4; API unchanged → Task 4 + integration check that `activation.spec.ts` still passes; project resolution from disk with name fallback → Tasks 2, 5; files relative/basename, no absolute paths → Task 2; `app` heartbeats → Task 2; language map → Task 1; lines 0 / branch unset → Task 2; overlaps clipped → Task 4 test; command flow (picker, confirmation, progress, summary, errors, replace-after-success) → Task 6; testing list → Tasks 1–6; repo wiring (CLAUDE.md) → Task 7. No gaps found.

**Placeholder scan:** none; every step has runnable code or an exact command.

**Type consistency:** `WakaProjectResolver(projectName, dir)`, `ResolvedWakaProject { key, name, root? }`, `ImportSummary`, `WAKATIME_WINDOW_ID`, `replaceWindow(windowId, intervals)`, `hasWindow(windowId)`, `replaceImported`, `hasImport`, `repoRoot`, `diskProjectResolver`, `registerImport(context, service, log)` are used with the same names and signatures across tasks.

**Review Focus coverage:** (1) path forms and leak check → Task 2 "POSIX and relative entities" test; (2) same-instant heartbeats → Task 2; (3) re-import + native overlap → Tasks 3, 4, 6 spec; (4) beyond the buffer cap → Task 3 `maxBuffered` test; (5) non-export JSON and bad timeouts → Tasks 2, 6 spec.

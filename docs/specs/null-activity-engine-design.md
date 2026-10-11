# Null Activity — Engine Design

Issue: [#113 WakaTime Replacement](https://github.com/TorresVisual/null-ide/issues/113)

## Goal

Track coding activity natively inside Null IDE — active time, projects, languages, files, sessions — and store it locally, privately and modularly. This spec covers only the **engine** (tracking, storage, privacy controls, API, status bar readout). It replaces the part of WakaTime that needs an editor plugin; reporting surfaces build on top of it.

## Decomposition

#113 is several independent pieces. Each gets its own spec → plan → implementation cycle, in this order:

1. **Engine** (this spec) — new built-in extension `null-activity`.
2. **Dashboard** — Today / graphs / project and language breakdowns / Today–All-time ranges.
3. **Git integration** — commits, files changed, lines added/removed, branch.
4. **Badge** — shareable total-time SVG: local renderer first, then opt-in publishing to a GitHub Gist through `null-accounts`. Only the published number leaves the machine.
5. **WakaTime import** (optional) — writes imported history as intervals.

Pieces 2–5 depend only on the `NullActivityApi` and the interval format defined here.

## Decisions

- **Home:** new extension `extensions/null-activity/` (TypeScript, `out/` tracked), following `null-music`'s conventions: pure classes, wiring in `extension.ts`, API returned from `activate`, data under `globalStorageUri`. No dependency on other Null extensions.
- **Active definition (lenient):** any interaction counts while the Null IDE window is focused — edits, cursor moves, scrolling, switching files, saves, terminal input, debug sessions. A gap longer than `null-activity.idleTimeout` (default 900 s, matching WakaTime's 15 min timeout, issue #123) is idle. Closes without a heartbeat (focus loss, pause, shutdown) end at the last heartbeat, never at the closing time, so the long timeout does not credit trailing silence.
- **Storage:** an append-only interval log; every statistic is derived from it. No SQLite, no native module.
- **Project identity:** git remote URL, falling back to the folder path. Display name = folder name, so renaming a folder does not split history.
- **Language:** the document's `languageId`.
- **Not stored:** file contents, diffs, source text. Files are workspace-relative paths only.

## Data model

```ts
interface Interval {
  start: number;          // epoch ms
  end: number;            // epoch ms, > start
  project: { key: string; name: string };
  language: string;       // languageId, '' for terminal/unknown
  file?: string;          // workspace-relative path
  branch?: string;
  linesAdded: number;
  linesRemoved: number;
}
```

Persisted as one JSON object per line in `intervals-YYYY-MM-<windowId>.jsonl` (month of `start`; an interval that crosses midnight at month end is split). One file per window id avoids concurrent-write clobbering between multiple Null IDE windows.

**Sessions** are derived: consecutive intervals with gaps ≤ `null-activity.sessionGap` (default 15 min) form one session. Session = start, end, duration (sum of interval time), projects, languages, files.

## Components

All pure except the wiring layer; none imports `vscode` except `heartbeatSource.ts`, `statusBar.ts`, `commands.ts` and `extension.ts`.

| File | Responsibility |
|---|---|
| `heartbeatSource.ts` | Subscribes to VS Code events (text edits, selection, visible ranges, active editor, saves, terminal data, debug sessions, window focus) and emits `Heartbeat { ts, file, language, workspace, isWrite, linesAdded, linesRemoved }`. Lines come from edit-event change counts. |
| `tracker.ts` | State machine over heartbeats with an injected clock. Maintains one open interval. Closes it at the last heartbeat when the gap exceeds `idleTimeout`, on window focus loss, or when project/language/file changes; then opens a new one. A timer-driven `tick()` closes stale intervals even with no new heartbeat. |
| `intervalStore.ts` | Appends closed intervals (buffered; flushed on a timer and in `dispose`), reads ranges, deletes ranges/all. Skips a torn last line. Memory buffer is capped; write failures log and never throw into the editor. |
| `projectIdentity.ts` | `resolveProject(folderUri) → { key, name, branch? }` — reads `.git/config` remote (falls back to path) and `.git/HEAD` for the branch. Called when the tracker opens an interval, not per heartbeat. |
| `stats.ts` | Pure functions: merge intervals from all windows, clip overlaps (so two open windows do not double-count), derive sessions, aggregate by day/week/month/project/language. Week starts Monday; day boundaries use local time. |
| `activityService.ts` | The public API (below). Owns tracker + store; fires `onDidChange` when an interval closes or data is deleted. |
| `privacy.ts` | Master switch handling and deletion helpers. |
| `statusBar.ts` | Right-aligned item `$(clock) 4h 32m` for today; updates on `onDidChange` and a 60 s timer. Click runs `null-activity.showTrackedData` until the dashboard exists. |
| `commands.ts` | Command registration. |
| `extension.ts` | Wiring; returns `NullActivityApi`. |

## Public API

```ts
interface NullActivityApi {
  startSession(): void;       // resume tracking (no-op if disabled)
  pauseSession(): void;       // close the open interval, stop counting
  endSession(): void;         // close and flush
  recordActivity(h: Heartbeat): void;   // manual heartbeat (used by heartbeatSource)
  getProjectStats(range: DateRange): ProjectStat[];   // { project, ms, files, linesAdded, linesRemoved }
  getLanguageStats(range: DateRange): LanguageStat[]; // { language, ms }
  getDailyStats(range: DateRange): DailyStat[];       // { day: 'YYYY-MM-DD', ms }
  getSessions(range: DateRange): Session[];
  getIntervals(range: DateRange): Interval[];         // for dashboard / import / badge
  readonly onDidChange: Event<void>;
}
```

`DateRange = { from: number; to: number }` (epoch ms, half-open). Stats functions are synchronous over an in-memory index of the requested months, loaded lazily and invalidated on `onDidChange`.

## Privacy

- `null-activity.enabled` (default `true`) is the master switch. Turning it off closes the open interval and stops collection immediately; existing data stays until deleted.
- Commands:
  - `null-activity.showTrackedData` — opens a read-only plain-text document listing what is recorded (field list, storage location, totals by month).
  - `null-activity.deleteRange` — pick a range (Today / Last 7 days / This month / Custom), confirm, delete matching intervals (rewrite affected files).
  - `null-activity.deleteAll` — confirm, remove all interval files.
- The extension contains no network code. (The badge piece later adds the only outbound path, opt-in.)

## Error handling

- Storage errors: log to the output channel, keep tracking in memory up to the cap, retry on next flush. Never show a modal for write failures.
- Clock jumps backwards (negative gap) or forwards beyond the idle timeout: close the interval at the last heartbeat; never produce negative or inflated time.
- Corrupt/torn lines are skipped on read; a corrupt file never blocks the others.
- Workspace-less windows (no folder): project key `"(no folder)"`; still tracked, so scratch work counts.

## Settings

`null-activity.enabled`, `null-activity.idleTimeout` (seconds, 900), `null-activity.sessionGap` (minutes, 15). No other configuration.

## Testing

`node --test` unit tests on `out/**/*.test.js` (register each in the `test` script):

- **tracker:** idle split, focus loss, project/language/file switch, clock jump, `tick()` close, disabled state.
- **intervalStore:** append/read, torn last line, month rollover split, delete range/all.
- **stats:** week (Monday) and month boundaries, local-day boundaries, overlap clipping across windows, session derivation.
- **projectIdentity:** remote URL, no remote, no git, rename stability.

One `verify-local` integration spec for event wiring: open a file, edit, and confirm an interval is recorded and shows in the status bar.

## Repository wiring

- Add `null-activity` to `.github/workflows/build.yml` (compile and copy, like `null-music`), `scripts/sync-local.ps1`, and the CLAUDE.md built-in extensions list (the "nine" becomes ten).
- No patches to VS Code source are needed.

## Out of scope for this spec

Dashboard UI, git statistics, badge and Gist publishing, WakaTime import, cloud sync.

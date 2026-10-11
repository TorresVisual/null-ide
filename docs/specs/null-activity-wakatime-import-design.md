# Null Activity — WakaTime Import Design

Issue: [#113 WakaTime Replacement](https://github.com/TorresVisual/null-ide/issues/113)

## Goal

Bring existing WakaTime history into null-activity as ordinary intervals, so the dashboard, stats and badges cover time from before Null IDE tracked anything. One-off migration from WakaTime's exported JSON file; no network access.

This is piece 5 of the decomposition in `docs/specs/null-activity-engine-design.md`. The engine's own under-reporting versus wakatime.com (default idle timeout, dropped agent edits) is tracked separately in [#123](https://github.com/TorresVisual/null-ide/issues/123).

## Decisions

- **Source:** the file from wakatime.com → Settings → export coding activity. Raw heartbeats grouped by day: `{ user, range, days: [{ date, heartbeats: [...] }] }`. No WakaTime API, no API key, no continuous sync.
- **Categories:** every category counts as active time, including "AI Coding" (about 63% of one real export). No `category` field is added to `Interval`.
- **Project identity:** resolved from disk where possible (see below), falling back to the WakaTime project name.
- **Gap rule:** the export's own timeout (`user.timeout`, minutes; 15 when absent), so imported totals match wakatime.com. Imported days are therefore measured more generously than native days (`null-activity.idleTimeout`); the import summary says so.
- **Storage:** imported intervals live in `intervals-YYYY-MM-import-wakatime.jsonl` files. `IntervalStore`'s file pattern already accepts any window id, so reads, `deleteRange`, `deleteAll` and Show Tracked Data cover imported data unchanged. Re-importing replaces these files, so it is idempotent.
- **API:** unchanged. The write path is an internal `ActivityService` method, not on `NullActivityApi` (deletion and writing stay off the public API).
- **Not stored:** nothing from `user` (it contains email and profile data), no absolute paths, no machine ids.

## Components

All in `extensions/null-activity/src/`. Only `importCommand.ts` imports `vscode`.

| File | Responsibility |
|---|---|
| `wakatimeImport.ts` | Pure. `convertExport(data, resolve, now?) → { intervals: Interval[]; summary: ImportSummary }`. Heartbeats → intervals. |
| `languageMap.ts` | Pure table: WakaTime display name → VS Code `languageId` (`C++` → `cpp`, `Markdown` → `markdown`, …). Unknown names fall back to the lowercased name; empty stays `''`. |
| `importCommand.ts` | `null-activity.importWakaTime`: file picker, replace confirmation, `withProgress`, summary. Builds the project resolver from the local filesystem via the engine's `projectIdentity`. |
| `activityService.ts` | New internal `replaceImported(intervals: Interval[]): void`: rewrites the `import-wakatime` files through a second `IntervalStore` (window id `import-wakatime`), invalidates the stats index, fires `onDidChange`. |
| `package.json`, `extension.ts` | Command contribution and registration. |

```ts
interface ImportSummary {
  days: number;                // days that produced at least one interval
  totalMs: number;
  heartbeats: number;          // read
  skipped: number;             // malformed (no numeric time)
  appHeartbeats: number;       // imported under "(no folder)"
  projectsResolved: number;    // matched to a local git repo
  projectsByName: number;      // kept as the WakaTime name
  timeoutMs: number;           // the gap rule used
}
```

`convertExport` takes `resolve(projectName, entityDirs) → { key, name, root? } | undefined`; the command supplies the real one, tests supply a stub.

## Conversion rules

1. Flatten all heartbeats, drop those without a numeric `time` (counted in `skipped`), sort by `time` (seconds, fractional → ms).
2. **Duration:** each heartbeat counts until the next heartbeat if that gap is ≤ the timeout; otherwise it counts nothing. The last heartbeat of a streak counts nothing. (This is WakaTime's own rule.)
3. **Merging/splitting:** adjacent counted time with the same project key, language and file is one interval; any change starts a new one, like the live tracker. Intervals crossing a month boundary are split by `IntervalStore`.
4. **Projects:** for each WakaTime `project` name, take the most common directory among its `entity` paths and walk up to a directory containing `.git` that exists on this machine. Found → `resolveProject` gives `key` and `name` (so imported and native time merge, and git statistics work). Not found → `key = name = <WakaTime project>`. Heartbeats with no project name use `(no folder)`.
5. **Files:** the path relative to the resolved root; if the entity is not under it or the project was not resolved, the basename. Absolute paths are never stored.
6. **`type: "app"` heartbeats:** project `(no folder)`, no `file`, language `''`.
7. **Language:** through `languageMap.ts`.
8. **Lines:** `linesAdded = linesRemoved = 0` (WakaTime's `lines` is total file length). `branch` is unset.
9. **Overlaps** with native tracking or between the account's machines are not handled here; `stats.ts` already clips overlaps across interval files.

## Command flow

`null-activity.importWakaTime`:
1. Open-file dialog, filter `*.json`.
2. If `import-wakatime` files already exist, modal: "Replace the previous WakaTime import?".
3. `withProgress`: read + parse (the whole file is loaded; fine for a one-off migration — upgrade to streaming if exports grow far beyond the ~70 MB seen), resolve projects, convert.
4. `replaceImported(intervals)`.
5. Information message with the summary: days, hours imported, skipped heartbeats, projects matched to local repos versus by name only, and the gap rule used.

The previous import is replaced only after conversion succeeds.

## Error handling

- Not valid JSON, or no `days` array: error message naming the problem; no data touched.
- Malformed heartbeats are skipped and counted, never fatal.
- Project resolution errors (unreadable folder, bad `.git/config`) fall back to the WakaTime name for that project.
- Storage write failures are reported as an error message and leave the previous import in place where possible (write new files first, then remove stale ones).

## Settings

None. The command is always available; `null-activity.enabled` governs live tracking only, so importing works while tracking is off.

## Testing

`node --test` unit tests on `out/**/*.test.js` (register each in the `test` script):

- **wakatimeImport:** timeout boundary (exactly at, just over), merge on same key, split on project/language/file change, last-heartbeat-of-streak counts nothing, `app` heartbeats, malformed heartbeats counted, unsorted input, month-boundary data, file relativizing and basename fallback, no absolute path in any output interval, `user` fields never appear in output, timeout fallback when `user.timeout` absent.
- **languageMap:** known names, unknown fallback, empty.
- **activityService:** `replaceImported` replaces rather than appends on the second call, fires `onDidChange`, imported plus native overlapping intervals are not double-counted by the stats.

One `verify-local` integration spec: run the command against a small fixture export and confirm the dashboard totals include it.

## Repository wiring

- CLAUDE.md null-activity section: mention the import command and the `import-wakatime` files.
- `scripts/sync-local.ps1` and `build.yml` need no change (same extension).

## Out of scope

The WakaTime API or continuous sync, a `category` field or dashboard split, git line counts for imported time, per-project hand mapping UI, and the engine's own timeout and heartbeat coverage ([#123](https://github.com/TorresVisual/null-ide/issues/123)).

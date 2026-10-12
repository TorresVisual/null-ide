# Null Startup — Startup Profiler Design

Issue: [#19 Add Startup Profiler for Identifying Performance Bottlenecks](https://github.com/TorresVisual/null-ide/issues/19)

## Goal

Make startup time measurable and explainable. Each launch records its phases and per-extension activations, keeps a bounded history, and shows a sortable report with a timeline, launch-to-launch comparison and a sanitized export. Diagnostic only: it is not a monitoring system.

## What upstream already has

VS Code ships **Developer: Startup Performance** (`perfview.show`, `perfviewEditor.ts`): a markdown dump of `ITimerService.startupMetrics`, extension activation stats from `IExtensionService.getExtensionsStatus()`, workbench contribution timings and raw `performance` marks. It has no sorting, timeline, history, comparison or export, and it stays untouched. We reuse its data sources and add no new instrumentation except what is missing:

- `ActivationTimes` holds **durations only** (`codeLoadingTime`, `activateCallTime`, `activateResolvedTime`) and no absolute start. Durations cannot be placed on a timeline or told apart as concurrent versus sequential, and summing them double-counts wall-clock time.
- Extensions cannot read `ITimerService` or `ActivationTimes` through the `vscode` API.

## Decisions

- **Architecture:** a thin core patch plus a new extension. Patch `010-startup-snapshot.patch` stamps extension activations and exposes one internal command; the new built-in extension `null-startup` owns capture, history, report UI and export. Alternatives rejected: a large core rewrite of `perfviewEditor` (breaks on every upstream bump, UI cannot be iterated with `sync-local`) and an extension-only version (cannot see other extensions or core phases).
- **Data handoff: pull.** The extension calls `_null.startup.snapshot`. Core keeps no persistence and no schema. Scraping the perfview markdown was rejected as fragile and lacking absolute times.
- **Headline duration:** launch → `workspaceRestored`, the `code/didRestoreEditors` mark (visible editors resolved). Launch is `code/didStartMain` on the first window, `code/willOpenNewWindow` on later windows, `code/timeOrigin` as a fallback. This is *later* than upstream's `startupMetrics.ellapsed`, which stops at `code/didStartWorkbench` (that is our `uiInteractive`).
- **Milestones** are named, ordered and never interchanged: `windowCreated` (`code/didCreateCodeWindow`, the native window exists; upstream has no first-paint mark), `uiInteractive` (`code/didStartWorkbench`), `workspaceRestored` (`code/didRestoreEditors`, the headline) and `extensionsSettled` (end of the last startup-triggered activation).
- **Startup vs deferred:** an extension whose activation ended before `workspaceRestored` is *startup*; later ones are *deferred*.
- **Capture:** automatic on every launch (cheap, off the critical path), not opt-in.
- **Privacy:** only extension IDs, activation event names, timings and app version are stored. Workspace paths and contents are never captured; `workspace:`-style activation events are reduced to their type.

## Components

### Patch `010-startup-snapshot.patch` (core, ~40 lines)

- In `abstractExtensionService.ts`: record a timestamp in `onWillActivate` and `onDidActivate` per extension, on the same clock as the `performance` marks, kept on the existing extension status object.
- Register the internal command `_null.startup.snapshot` (a workbench contribution that needs `ITimerService`, `IExtensionService` and the contributions registry). It returns plain JSON:
  - `metrics`: the `startupMetrics.timers` values that exist,
  - `marks`: the `performance` marks relevant to startup (name, startTime),
  - `contributions`: workbench contribution timings,
  - `extensions[]`: `{ id, activationEvent, reason, startMs, endMs, loadMs, callMs, resolveMs, eager }`.
- No-op when nothing is registered; adds two timestamp reads per extension to startup.

### Extension `extensions/null-startup/`

Activated on `onStartupFinished`. Only `snapshotSource.ts`, `reportPanel.ts`, `commands.ts` and `extension.ts` import `vscode`; everything else is pure and unit-tested.

| File | Responsibility |
|---|---|
| `src/types.ts` | `Snapshot` (patch output), `Report`, `Milestone`, `PhaseEntry`, `ExtensionEntry`, `schemaVersion`. |
| `src/snapshotSource.ts` | Calls `_null.startup.snapshot`; takes one snapshot as soon as it activates (`onStartupFinished` is after restore) and a second ~30 s later for deferred activations, each with a timeout. The extension status is cumulative, so the second snapshot supersedes the first and rewrites the same report file. |
| `src/buildReport.ts` | Pure. `Snapshot[] → Report`: milestones, phases, startup/deferred split, sanitizing (`sanitize.ts`), `partial` flag. |
| `src/intervals.ts` | Pure. Interval union and per-phase *wall-clock impact*; sum-of-durations is reported alongside, so overlap is visible and never double-counted. |
| `src/compare.ts` | Pure. Per-phase and per-extension deltas against the previous launch or the median of the history; flags regressions above a threshold. |
| `src/reportStore.ts` | Injected fs deps. `globalStorageUri/reports/<startedAt>-<windowId>.json`, one file per launch and window, pruned to `null-startup.retention`; skips unknown `schemaVersion`. |
| `src/exportReport.ts` | Pure. Markdown summary and JSON from the same sanitized `Report`; no second format. |
| `src/reportModel.ts` | Pure. `Report (+ history) → ReportViewModel` (sorting, slowest-3, slow flags, lane assignment for the timeline). |
| `src/reportPanel.ts` | One reused `WebviewPanel`, CSP shell, snapshot pushes, `WebviewToHost` validation (`parseWebviewMessage`). |
| `src/protocol.ts` | Typed `HostToWebview` / `WebviewToHost` unions (triple-slash reference, as in null-music and null-activity). |
| `src/webview/report/` | Vanilla DOM/SVG UI: `dom.ts`, `model.ts` (pure), `summary.ts`, `phases.ts`, `extensions.ts`, `timeline.ts`, `compare.ts`, `main.ts`. `module: none`, no imports. `tsconfig.webview-report.json` compiles to the tracked `lib/report.js`; `tsconfig.webview-report-shared.json` compiles `protocol.ts`/`dom.ts`/`model.ts` for `vm` tests; `lib/report.css` is hand-written. |

## Report UI

- **Summary:** headline `workspaceRestored`, the other milestones, the 3 slowest phases and the 3 slowest extensions.
- **Phases table:** sortable by duration or wall-clock impact; start and impact are columns (raw marks are not stored, which keeps reports small and path-free).
- **Extensions table:** sortable; startup and deferred separated. Columns: load, call, resolve, total, activation event, reason. *Slow* flag when at or above `null-startup.slowExtensionMs` (default 100 ms); labelled "slow", never "problem".
- **Timeline:** Gantt strip with milestone markers and one lane per overlapping activation.
- **Compare:** launch picker against the previous launch or the history median; per-phase and per-extension deltas, regressions flagged.

## Commands and settings

| ID | Purpose |
|---|---|
| `null-startup.openReport` | Open (or reveal) the report panel. |
| `null-startup.copyReport` | Copy the Markdown summary. |
| `null-startup.exportReport` | Save the JSON report. |
| `null-startup.clearHistory` | Delete stored reports (confirm modal). |

Settings: `null-startup.enabled` (master switch), `null-startup.retention` (default 20), `null-startup.slowExtensionMs` (default 100).

## Error handling

- Command missing (patch not applied, stock VS Code): log once, disable quietly.
- Snapshot fails or times out: log it and keep the earlier report, if any. `partial: true` means no launch-start mark was found.
- Missing marks or activation times become `undefined` and render "n/a"; nothing throws.
- Corrupt or unknown-version report files are skipped, never deleted by the reader.

## Testing

- `node --test` units for `buildReport`, `intervals`, `compare`, `sanitize`, `exportReport`, `reportModel`, `reportStore` (injected fs), `parseWebviewMessage`, plus the webview `model.ts`/`dom.ts` via `vm`. Every test file is listed in `package.json`'s `test` script.
- `patches/test`: patch 010 applies cleanly against the pinned `MS_TAG`.
- The snapshot builder is pure and loaded by a `patches/test` unit test. The integration runner uses vanilla VS Code (Null IDE's mutex collides with a running window), which lacks patch 010, so the integration spec asserts the degradation path (activates, commands registered, no report stored, `openReport` opens an empty panel). The real `_null.startup.snapshot` is checked once by hand in the synced Null IDE (plan, final task).

## Out of scope for v1

CPU profiles (`--prof-startup` stays upstream's), main-process phases beyond the existing `startupMetrics` timers, telemetry or remote upload, automatic regression notifications.

## Delivery order

1. Patch 010 and `snapshotSource`.
2. `buildReport`, `intervals`, `sanitize`, `reportStore` (accurate data first).
3. Report panel: summary, tables, timeline.
4. Compare, export and commands.
5. Docs: CLAUDE.md section and patches list.

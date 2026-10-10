# Null Activity — Dashboard Design

Issue: [#113 WakaTime Replacement](https://github.com/TorresVisual/null-ide/issues/113)

## Goal

Show the activity the engine records. A **Coding Activity** dashboard opens as an editor tab inside `null-activity` and presents total time, an activity graph, project and language breakdowns and a sessions list for a chosen range. It is read-only and local: no network code, no engine changes.

This is piece 2 of the decomposition in `docs/specs/null-activity-engine-design.md`. Git statistics, the badge and WakaTime import remain separate later specs.

## Decisions

- **Placement:** one `WebviewPanel` in the main editor area (like the null-actions settings panel), not a sidebar view and not part of the null-tools project dashboard. `null-activity` keeps zero dependencies on other Null extensions.
- **Sections (all four in v1):** range switcher with total, activity graph, project and language breakdowns, sessions list.
- **Ranges (presets only):** Today, Yesterday, This week (Monday start), This month, All time. Default Today; the last choice is remembered in `workspaceState` (`null-activity.dashboard.range`). No custom range picker, no comparison to a previous period.
- **Approach:** a pure view-model built on the extension host plus a vanilla-TS webview (the `null-music` pattern). The webview renders with DOM and inline SVG, sends only intents, and holds no data logic. No chart library, no runtime dependencies.
- **Engine untouched:** the dashboard consumes `NullActivityApi` / `stats.ts` helpers. The only new statistic is hourly bucketing, added next to the model, not in `ActivityService`.
- **Deletion is not in the dashboard.** The engine keeps it off the API on purpose; the footer links to `showTrackedData` and settings only.

## Components

| File | Responsibility |
|---|---|
| `src/dashboardModel.ts` | Pure. `buildDashboardModel(api, range, now, enabled) → DashboardModel` and `hourlyStats`. Imports only `types.ts` and `stats.ts`. |
| `src/dashboardPanel.ts` | Imports `vscode`. Owns the single reused panel, the CSP/HTML shell, snapshot pushes and `WebviewToHost` handling. |
| `src/protocol.ts` | Typed `HostToWebview` / `WebviewToHost` unions and the `DashboardModel` shape. Pulled into the webview with a triple-slash reference, as in null-music. |
| `src/webview/dashboard/` | Vanilla DOM/SVG UI: `dom.ts` (escaping, element helpers), `model.ts` (pure: bar scaling, duration and percent formatting), `graph.ts`, `breakdown.ts`, `sessions.ts`, `main.ts`. `module: none`, no imports. |
| `tsconfig.webview-dashboard.json` | Compiles the webview into the tracked `lib/dashboard.js`. |
| `tsconfig.webview-dashboard-shared.json` | Compiles `protocol.ts`, `dom.ts`, `model.ts` to `out/` so `node --test` can load them through `vm` (top-level `function` declarations only). |
| `lib/dashboard.css` | Hand-written; the only hand-edited file in `lib/`. |
| `commands.ts`, `statusBar.ts`, `extension.ts` | Register `null-activity.openDashboard`; rebind the status bar click to it; construct the panel. |

`package.json` `compile` chains `tsc -p tsconfig.json` with the two webview projects. `null-activity` is already in `build.yml` and `sync-local.ps1`; the latter must also copy `lib`.

## Data model

```ts
type DashboardRange = 'today' | 'yesterday' | 'week' | 'month' | 'all';

interface DashboardModel {
  range: DashboardRange;
  rangeLabel: string;            // "Today", "Mon 6 – Sun 12 Oct", ...
  enabled: boolean;              // null-activity.enabled
  totalMs: number;
  bars: { label: string; startMs: number; ms: number }[];
  barUnit: 'hour' | 'day' | 'month';
  projects: Share[];             // ranked, max 8, remainder folded into "Other"
  languages: Share[];            // same
  sessions: SessionRow[];        // newest first, max 50
}
interface Share { name: string; ms: number; percent: number }   // percent rounded; sums to 100 ± rounding
interface SessionRow { start: number; end: number; ms: number; projects: string[]; languages: string[]; files: string[] }
```

Bars: Today/Yesterday → 24 hourly bars; Week/Month → one bar per local day in the range; All time → one bar per month from the first recorded month to now. Hourly buckets slice the normalized intervals by local hour (DST days have 23 or 25 hourly buckets, bucketed by local clock time so they still sum to the total). The empty language `''` (terminal/unknown) is shown as "Terminal / other".

## Protocol

- Host → webview: `{ type: 'model', model: DashboardModel }`.
- Webview → host: `{ type: 'ready' }`, `{ type: 'setRange', range }`, `{ type: 'enableTracking' }`, `{ type: 'showTrackedData' }`, `{ type: 'openSettings' }`.
- The host sends the first model after `ready`, a new model after `setRange`, on `onDidChange` (throttled to one push per second) and every 60 s while visible. When the panel is hidden nothing is recomputed; one refresh happens when it becomes visible again.

## UI

Single scrolling column, max width about 960 px, `DESIGN.md` tokens (`signal-blue` is the only accent), VS Code theme variables for text and surfaces so it follows the active theme.

1. **Header:** title left; segmented range control right (`role="tablist"`, arrow-key navigation).
2. **Total:** large duration (`6h 42m`) and the range label.
3. **Graph:** inline-SVG bars scaled to the largest bucket; zero buckets render a thin stub; hover/focus tooltip with label and duration; every bar is focusable with an `aria-label`.
4. **Projects / Languages:** two columns; each row is name, proportional bar, duration, percent.
5. **Sessions:** table of start, duration, projects, languages, file count (hover lists the workspace-relative files).
6. **Footer:** "What's tracked?" (`showTrackedData`) and "Settings".

States: tracking disabled → banner "Tracking is off. Existing data is still shown." with an Enable button (sets `null-activity.enabled`); empty range → muted "Nothing tracked in this range." in place of graph and lists, range control stays usable.

Webview security: CSP `default-src 'none'`, nonce'd script, `lib/` via `asWebviewUri` with `localResourceRoots` limited to the extension's `lib/`, no remote resources, all text inserted through `textContent` (project names and paths are user data).

## Error handling

- A throw while building the model is caught, logged to the output channel, and the previous model stays on screen; no modal.
- A message with an unknown `type` or invalid `range` from the webview is ignored.
- `retainContextWhenHidden` is off; the webview sends `ready` on every load and the host re-sends the model.
- Closing the panel disposes its subscriptions and timer.

## Testing

`node --test`, registered in the `test` script in `package.json`:

- **`dashboardModel.test.ts`:** range boundaries (Monday week start, month end, All time start); hourly buckets across midnight and a DST change summing to `totalMs`; overlapping windows not double-counted; "Other" folding and percent sums; empty range; session cap and ordering; disabled flag passthrough; `''` language label.
- **`dashboardWebviewModel.test.ts`:** the pure webview `model.ts`/`dom.ts` helpers (bar scaling incl. all-zero input, duration and percent formatting, HTML escaping) loaded through `vm`.

One `verify-local` integration spec: execute `null-activity.openDashboard`, edit a file, and confirm the panel exists and the status bar click opens it. (Webview content is not inspectable from the extension host; the model contents are covered by the unit tests.)

## Repository wiring

- `package.json`: `compile` script chain, new `openDashboard` command contribution, `test` script entries.
- `sync-local.ps1`: add `lib` to the `null-activity` copy list.
- `build.yml` already compiles null-activity via `npm run compile`; no new step needed.
- CLAUDE.md: update the null-activity paragraph (dashboard exists, webview/`lib` conventions, spec/plan paths).

## Out of scope

Git statistics, badge, WakaTime import, cloud sync, custom date ranges, period-over-period comparison, export, delete buttons in the dashboard, a sidebar or activity-bar entry.

# Desktop Widgets — Design

Status: implemented (see `docs/plans/native-windows-widgets.md` and `docs/specs/native-windows-widgets-gate.md`).

Issue: **#141** ("Native Windows Widgets for NULL IDE"). First release = Projects, Issues and Pull Requests widgets for **GitHub**, drawn as Null's own windows on the desktop wallpaper. GitLab and the Build & Test widget are later issues.

## History: why not the Widgets Board

The first design registered a provider for the Windows 11 Widgets Board (Win+W). A spike (2026-10-21, Windows 11 24H2) showed a sparse-package provider does work there. The Board cannot place a widget on the desktop, though, and desktop placement is what is wanted, so the Board provider, its sparse package `NullIDE.Widgets`, Adaptive Cards and the Board host check are dropped. Nothing else in the data design depended on the Board and it is kept below.

## Decisions

1. **Cache only.** The widget process never fetches. While Null IDE runs it writes a snapshot; the widgets render the last snapshot, with its age shown. Issues and PRs go stale once the IDE is closed, by design. This keeps the "no second credential store" goal: tokens stay in null-accounts' `SecretStorage`, which a separate process cannot read.
2. **The IDE is the only fetcher, filter and writer.** A new `widgetSnapshot` module in `extensions/null-tools/src/` builds one file from three sources:
   - **Issues and PRs:** its own viewer-scoped GraphQL searches (`assignee:@me`, `mentions:@me`, `review-requested:@me`, `author:@me`, plus `mergeable` for `conflict`) over the opted-in repos, through `requestGraphql`. `IssuesStore` is bound to the single workspace repo and `PullSummary` lacks `conflict` and "review requested of me", so neither store can serve this. Only pure mappers (`checkStateOf`, `REVIEWS`) are reused.
   - **Projects:** `recentProjects.ts` (pinned first, then recents: the dashboard order).
   - It is gated by `null.widgets.enabled`, so the IDE behaves identically without the widgets.
3. **GitHub first.** null-tools has no GitLab issue or merge-request code, and null-accounts' `gitlab.ts` has no such API either. The snapshot carries a `provider` field on each item so GitLab slots in later without a schema break.
4. **Host = `null_widgets.exe`**, a plain Win32 exe in the install root next to `null.exe`. No package identity, no signing, no Windows App SDK, no sparse package. It is built by a new CMake target under `shell-ext/widgets/` in the existing MSVC step. One instance only (named mutex).
5. **Rendering = Direct2D / DirectWrite on layered windows.** One layered window per widget (Projects, Issues, Pull Requests): borderless, `WS_EX_LAYERED | WS_EX_TOOLWINDOW` (no taskbar button), per-pixel alpha, rounded corners, a Null Dark palette. Each window is a **child of the desktop icon host (`SHELLDLL_DefView`)**, so it stays on the desktop through Win+D and below every app. A top-level window pinned above `Progman` and `HWND_BOTTOM` both fail (Win+D hides the first, the wallpaper hides the second; measured, see `native-windows-widgets-gate.md`). Explorer destroys those children when it restarts, so the exe recreates them. Per-monitor DPI aware.
6. **Layout is owned by the exe.** Positions, sizes and per-widget visibility live in `%LOCALAPPDATA%\Null\widgets\layout.json`. Dragging moves a widget and snaps to screen edges; a lock toggle disables drags. A saved position outside the current monitors is clamped on screen. The right-click menu has: Refresh, Lock, Hide this widget, Quit widgets. The menu also lists a "Show <widget>" item per hidden widget; a second launch of the exe (what `Null: Set Up Widgets` does) signals the running instance to show all of them, so hiding the last widget is recoverable.
7. **The exe is dumb, and treats the snapshot as untrusted input.** It reads `snapshot.json` (file watch plus a re-read on window show), lays out rows and draws them. No network, no tokens, no settings UI.
   - Links open only for `https://` URLs on host `github.com`, through `ShellExecuteW`; any other row loses its click action.
   - Snapshot text is length-capped and drawn as plain text only.
   - A malformed file keeps the last good render (Decision 12).
8. **Actions.** Issue and PR rows open in the browser. "Open project" and "Open in new window" start `null.exe` with `CreateProcessW`: no shell, `null.exe` resolved from the exe's own directory (never from the snapshot), a project `path` that must be absolute and is passed after a `--` separator. The exe is not packaged, so the AUMID workaround in `shell-ext/CLAUDE.md` does not apply to it.
9. **Configuration lives in IDE settings, and there are two:** `null.widgets.enabled` and `null.widgets.repos` (`[{ repo, account }]`, written by `Null: Set Up Widgets`). Repositories are opt-in; there is no unfiltered stream. Issue and PR sets are fixed (see Snapshot), projects follow the dashboard order, row maxima are constants in `widgetSnapshot` (8 projects, 10 issues, 10 PRs) and the renderer trims per widget size. No filter or row-count settings in v1.
10. **Lifecycle belongs to null-setup.** The wizard gets an opt-in "Desktop widgets" option (default off). Ticking it writes `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\NullWidgets` and starts the exe. Updates stop `null_widgets.exe` (scoped to the install path) before the file swap and restart it afterwards; if it cannot be stopped, the widgets part of that update is skipped and logged. Uninstall removes the Run entry, ends the process and deletes `%LOCALAPPDATA%\Null\widgets\`. Any failure here is logged and ignored; it never fails the IDE install or update. All of it goes through the `FakeSystem` seam.
11. **Nothing runs unless asked.** Without the opt-in there is no Run entry and no process. Turning widgets off in the IDE deletes `snapshot.json` (widgets fall back to the empty state). Signing out of an account does not delete rows; they stay dimmed as `signed_out` so ordinary token expiry never wipes the widgets.
12. **Atomic snapshot writes.** `snapshot.json.tmp`, then rename, so the exe never reads a torn file. A corrupt file anyway keeps the last good render.
13. **No secrets in the snapshot or logs.** Only titles, numbers, URLs, repo names, paths, labels, assignee login and timestamps. The file sits in `%LOCALAPPDATA%\Null\widgets\` (user-only by default). Private-repo issue titles appear on the desktop, visible to anyone who can see the screen; the `null.widgets.*` setting descriptions say so.
14. **One writer window.** Several Null IDE windows may be open, so the `PresenceOwnership` pattern is reused with its own claim file (`widgets-owner.json`): ownership on focus, non-owners poll to take over. Only the owner fetches and writes; it writes once more on dispose.
15. **Accounts.** Each `repos` entry stores the account it was picked under. The fetcher calls `getToken` non-interactively per account and never prompts; no token = that repo is `signed_out`.
16. **Refresh.** The owner refreshes on claiming ownership, every 10 minutes while focused, and on `Null: Refresh Widgets`. Issues and PRs are one GraphQL request per account. Errors back off and a rate limit suspends fetching, as in `src/workflows/`. Removing a repo rewrites the snapshot immediately. The Refresh menu item in a widget opens no network connection; it re-reads the file (the exe cannot ask the IDE for new data).
17. **Nothing is enabled implicitly.** Snapshot writing starts only after `Null: Set Up Widgets` (also reachable from the Features hub) has stored at least one repo or enabled projects; before that the widgets read "Open Null IDE to set up widgets".

## Snapshot (`%LOCALAPPDATA%\Null\widgets\snapshot.json`)

```
{
  "schema": 1,
  "writtenAt": "2026-10-21T14:03:11Z",
  "projects": { "status": "ok", "failed": [], "items": [{ "name", "path", "branch", "dirty", "pinned", "lastOpened" }] },
  "issues":   { "status": "ok", "failed": [], "items": [{ "provider": "github", "repo", "number", "title", "url", "state", "labels": [], "assignee", "attention": "assigned|mentioned", "localPath" }] },
  "prs":      { "status": "ok", "failed": [], "items": [{ "provider": "github", "repo", "number", "title", "url", "author", "review": "requested|approved|changes|none", "checks": "passing|failing|pending|none", "conflict": false, "localPath" }] }
}
```

- **Sets.** Issues: open, in opted-in repos, assigned to or mentioning the viewer. PRs: open, in opted-in repos, authored by or review-requested of the viewer; the viewer's own drafts are included, others' are not. `review` is `requested` when the viewer is a requested reviewer, otherwise the PR's own decision.
- `status` per section is one of `ok | signed_out | offline | error`. It is `ok` when at least one repo succeeded this cycle. `failed` lists `{ repo, reason }` for the repos that did not (`reason` is one of `signed_out | offline | error`); their last good rows are kept and the footer shows "N repos not updated". Only when every repo failed does `status` take the shared reason (`error` if they differ).
- `localPath` is set when a checkout of the repo is known, which enables "Open in Null IDE" on that row.
- The exe treats an unknown `schema` greater than it understands as "Update Null IDE" and renders nothing else.
- PRs are ordered by what needs the user's attention first: review requested of the viewer, then the viewer's PRs with changes requested, failing checks, conflicts, then recency.

## Widgets in v1

| Widget | Default size | Shows | Actions |
|---|---|---|---|
| Projects | 320×240 | Pinned/recent projects, branch, dirty marker, last opened | Open, Open in new window |
| Issues | 360×320 | Number, title, repo, labels, attention signal | Open in browser, Open project (if `localPath`) |
| Pull Requests | 360×320 | Number, title, repo, author, review/check/conflict markers | Open in browser, Open project (if `localPath`) |

Rows per height are decided by the layout code. Build & Test is a later widget; a widget is a data source plus a row layout, so adding one is a new entry, not a new mechanism.

## Errors and staleness

All drawn in the widget, never as a crash:
- no snapshot yet: "Open Null IDE to set up widgets";
- schema newer than the exe: "Update Null IDE";
- section `signed_out | offline | error`: last rows dimmed with the reason; partial failure: footer "N repos not updated";
- footer "updated <age>", muted after 6 hours (a single constant in the layout code).

## Testing

- **null-tools:** node tests for the snapshot projection (sets, ordering, partial failure), the atomic writer, the owner claim and the disable-deletes-file rule, added to the explicit `test` list in `package.json`.
- **Widgets exe:** snapshot parsing, validation and row layout are one translation unit with no window or Direct2D calls, covered by a CTest executable against fixture snapshots (ok, stale, signed-out, partial failure, newer schema, empty, and hostile: a `file:` URL, a `--flag` path, an oversized title, malformed JSON).
- **null-setup:** Run-key add/remove, process stop before swap and restart after, opt-in off, and "process cannot be stopped" covered by the existing `FakeSystem` tests.
- **By hand** (not CI-able), backed by a `scripts/` check script in the style of `check-cold-start-aumid.ps1`: drag, snap, lock, hide, Win+D, sleep/resume, display change, DPI change, IDE closed, update with widgets running, uninstall, on Windows 10 and 11.

## Hard gate at the start of the plan

Before anything else is built, a throwaway probe (not kept) answers: does a layered tool window pinned directly above the desktop window stay visible on Win+D, still receive clicks, and survive sleep/resume, a display change and an Explorer restart, on Windows 11 24H2 and Windows 10? If Win+D hides the widgets, the approach is revisited (the fallback is an owned-by-desktop parent window, accepting its input quirks) before the rest is built.

Measured (2026-10-21, Windows 11 24H2): see `native-windows-widgets-gate.md`. A top-level window above `Progman` is hidden by Win+D; a layered child of `SHELLDLL_DefView` survives it. Still open: Windows 10 and sleep/resume.

## Out of scope

GitLab issues and merge requests; the Build & Test widget; any exe-side fetching or credential; a per-widget settings UI; themes; resizing by drag; Linux.

## Known limits

- Issues and PRs are only as fresh as the last time the IDE ran with focus.
- Private issue titles are visible on the desktop to anyone who can see the screen.
- One more small background process runs at login for users who opt in.

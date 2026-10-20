# Native Windows Widgets — Design

Issue: **#141** ("Native Windows Widgets for NULL IDE"). First release = Projects, Issues and Pull Requests widgets for **GitHub**; GitLab and the Build & Test widget are later issues.

## Feasibility spike (2026-10-21)

Question: does the Windows 11 Widgets Board list, pin and activate a widget provider registered through a *sparse* package with `ExternalLocation`? Microsoft's provider walkthrough says "only packaged apps can be registered as widget providers" and is silent on sparse packages.

Result: **yes.** A throwaway provider (C#, `com:ExeServer` + `com.microsoft.windows.widgets` app extension, sparse manifest modelled on `shell-ext/AppxManifest.xml`) was registered with `Add-AppxPackage -Register <manifest> -ExternalLocation <dir>` on Windows 11 24H2 (build 26100) in developer mode. The OS listed the provider in the `com.microsoft.windows.widgets` app-extension catalog; the Board offered the widget, pinned it, and launched the exe via COM (`-Embedding`) under the sparse package's identity. `CreateWidget`, `Activate`, `OnActionInvoked` (twice) and `Deactivate` all arrived.

Not covered by the spike. These are a **hard gate at the start of the implementation plan**:
- **Provider with `null.exe` closed.** `null.exe` was running during the test. The provider has no dependency on it, but this was not measured. Failure stops the work.
- **A signed package.** The spike was an unsigned loose registration (developer mode). The shipped path is a signed `.appx` with the existing `CN=Null IDE` certificate. Failure stops the work and the design is revisited; everything else rests on it.
- **Runtime dependencies of a C++/WinRT provider.** The C# spike published at 211 MB because the `Microsoft.WindowsAppSDK` metapackage pulls ONNX Runtime, DirectML and XAML. The first task builds the smallest C++/WinRT provider that links only the Widgets component and measures it. Budget: exe plus Widgets runtime bits ≤ 5 MB; missing it is recorded as a finding, not a stop.
- **Minimum Windows build.** The floor for third-party widget providers (believed 22H2, build 22621) is confirmed here and becomes a constant in null-setup.

## Decisions

1. **Cache only.** The provider never fetches. While Null IDE runs it writes a snapshot; the provider renders the last snapshot, with its age shown. Issues and PRs go stale once the IDE is closed, by design. This is what keeps the "no second credential store" goal: tokens stay in null-accounts' `SecretStorage`, which a separate process cannot read.
2. **The IDE is the only fetcher, filter and writer.** A new `widgetSnapshot` module in `extensions/null-tools/src/` builds one file from three sources:
   - **Issues and PRs:** its own viewer-scoped GraphQL searches (`assignee:@me`, `mentions:@me`, `review-requested:@me`, `author:@me`, plus `mergeable` for `conflict`) over the opted-in repos, through `requestGraphql`. `IssuesStore` is bound to the single workspace repo and `PullSummary` lacks `conflict` and "review requested of me", so neither store can serve this. Only pure mappers (`checkStateOf`, `REVIEWS`) are reused.
   - **Projects:** `recentProjects.ts` (pinned first, then recents: the dashboard order).
   - It is gated by `null.widgets.enabled`, so the IDE behaves identically without the widget package.
3. **GitHub first.** null-tools has no GitLab issue or merge-request code, and null-accounts' `gitlab.ts` has no such API either, so GitLab widgets would be new fetching code. The snapshot carries a `provider` field on each item so GitLab slots in later without a schema break.
4. **Provider = separate sparse package `NullIDE.Widgets`**, not an addition to `NullIDE.ExplorerCommand`. A bad widget manifest change must not be able to break the shipped Explorer context menu. Cost: a second registration, version and removal in null-setup.
5. **Provider exe = C++/WinRT** (`null_widgets.exe`), built in the CMake + MSVC step `shell-ext/` already uses, packed as `null-widgets.appx` with `ExternalLocation` at the install root and signed with the same `CN=Null IDE` certificate (no new trust prompt). Card JSON is built with the OS's `Windows.Data.Json`.
6. **The provider is dumb, and treats the snapshot as untrusted input.** It reads `snapshot.json` (file watch plus a re-read on `Activate`), builds Adaptive Card JSON and calls `WidgetManager::UpdateWidget`. No network, no tokens, no settings UI. The file is user-writable, so:
   - `Action.OpenUrl` is emitted only for `https://` URLs on host `github.com`; any other row loses its action.
   - Snapshot text goes only into Adaptive Card text elements (never markup or URLs) and is length-capped.
   - A malformed file keeps the last good render (Decision 11).
7. **Configuration lives in IDE settings, and there are two:** `null.widgets.enabled` and `null.widgets.repos` (`[{ repo, account }]`, written by `Null: Set Up Widgets`). Repositories are opt-in; there is no unfiltered stream. Issue and PR sets are fixed (see Snapshot), projects follow the dashboard order, row maxima are constants in `widgetSnapshot` (8 projects, 10 issues, 10 PRs) and the card builder trims per widget size. No filter or row-count settings in v1.
8. **Actions.** Issue and PR rows use `Action.OpenUrl` (no process needed). "Open project" and "Open in new window" use `Action.Execute`; the provider starts `null.exe` through the explorer-marshalled launch used by `shell-ext` (`LaunchViaExplorer`), because a process started by a packaged provider inherits the package's AUMID (see `shell-ext/CLAUDE.md`). The `null.exe` location comes from the package's install location, never from the snapshot; a project `path` must be absolute and is passed after a `--` separator, never through a shell.
9. **Lifecycle belongs to null-setup.** It checks, adds, updates and removes `NullIDE.Widgets` next to `NullIDE.ExplorerCommand`, with the same trust flow (CurrentUser first, elevated `LocalMachine\TrustedPeople` only on an untrusted-root answer). The uninstaller removes both packages and `%LOCALAPPDATA%\Null\widgets\`.
   - **Opt-in.** Registration happens only if the user ticks a "Windows widgets" setup option (default off). The wizard hides the option when the host check fails.
   - **Host check.** Windows build ≥ the floor confirmed in the spike, and the `MicrosoftWindows.Client.WebExperience` package present, behind the `FakeSystem` seam.
   - **Updates.** The Board keeps the COM server alive while a widget is pinned, so null-setup stops `null_widgets.exe` (scoped to the install path) before the swap and re-registers; the Board relaunches it on the next `Activate`. If it cannot be stopped, the widgets part of that update is skipped and logged.
   - Any failure to register or update widgets, or a machine that fails the host check, is logged and ignored; it never fails the IDE install or update.
10. **The provider process is demand-driven.** The Board starts it and it exits when the last widget is unpinned. Nothing runs when no widget is pinned.
11. **Atomic snapshot writes.** `snapshot.json.tmp`, then rename, so the provider never reads a torn file. A corrupt file anyway keeps the last good render.
12. **No secrets in the snapshot or logs.** Only titles, numbers, URLs, repo names, paths, labels, assignee login and timestamps. The file sits in `%LOCALAPPDATA%\Null\widgets\` (user-only by default). Private-repo issue titles do appear on the Board; the `null.widgets.*` setting descriptions say so.
13. **One writer window.** Several Null IDE windows may be open, so the `PresenceOwnership` pattern is reused with its own claim file (`widgets-owner.json`): ownership on focus, non-owners poll to take over. Only the owner fetches and writes; it writes once more on dispose.
14. **Accounts.** Each `repos` entry stores the account it was picked under. The fetcher calls `getToken` non-interactively per account and never prompts; no token = that repo is `signed_out`.
15. **Refresh.** The owner refreshes on claiming ownership, every 10 minutes while focused, and on `Null: Refresh Widgets`. Issues and PRs are one GraphQL request per account. Errors back off and a rate limit suspends fetching, as in `src/workflows/`. Removing a repo rewrites the snapshot immediately.
16. **Turning widgets off removes the data.** Setting `enabled` to false deletes `snapshot.json` (pinned cards fall back to the empty state). Signing out of an account does not delete rows; they stay dimmed as `signed_out` so ordinary token expiry never wipes the cards.
17. **Nothing is enabled implicitly.** Snapshot writing starts only after `Null: Set Up Widgets` (also reachable from the Features hub) has stored at least one repo or enabled projects; before that the empty card reads "Open Null IDE to set up widgets".

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
- `status` per section is one of `ok | signed_out | offline | error`. It is `ok` when at least one repo succeeded this cycle. `failed` lists `{ repo, reason }` for the repos that did not (`reason` is one of `signed_out | offline | error`); their last good rows are kept and the card footer shows "N repos not updated". Only when every repo failed does `status` take the shared reason (`error` if they differ).
- `localPath` is set when a checkout of the repo is known, which enables "Open in Null IDE" on that row.
- The provider treats an unknown `schema` greater than it understands as "Update Null IDE" and renders nothing else.
- PRs are ordered by what needs the user's attention first: review requested of the viewer, then the viewer's PRs with changes requested, failing checks, conflicts, then recency.

## Widgets in v1

| Widget | Sizes | Shows | Actions |
|---|---|---|---|
| Projects | small, medium, large | Pinned/recent projects, branch, dirty marker, last opened | Open, Open in new window |
| Issues | medium, large | Number, title, repo, labels, attention signal | Open in browser, Open project (if `localPath`) |
| Pull Requests | medium, large | Number, title, repo, author, review/check/conflict markers | Open in browser, Open project (if `localPath`) |

Rows per size are decided by the card builder (e.g. small 3, medium 4, large 8). Build & Test is a later widget; the provider registers widgets by definition id so adding one is a manifest entry plus a card builder.

## Errors and staleness

All shown in the card, never as a crash:
- no snapshot yet: "Open Null IDE to set up widgets";
- schema newer than the provider: "Update Null IDE";
- section `signed_out | offline | error`: last rows dimmed with the reason; partial failure: footer "N repos not updated";
- footer "updated <age>", muted after 6 hours (a single constant in the card builder).

## Testing

- **null-tools:** node tests for the snapshot projection (sets, ordering, partial failure), the atomic writer, the owner claim and the disable-deletes-file rule, added to the explicit `test` list in `package.json`.
- **Provider:** the card builder is one translation unit with no COM activation, covered by a CTest executable against fixture snapshots (ok, stale, signed-out, partial failure, newer schema, empty, and hostile: a `file:` URL, a `--flag` path, an oversized title).
- **null-setup:** register/update/unregister, the host check, opt-in off, and "provider process cannot be stopped" covered by the existing `FakeSystem` tests.
- **Win11 by hand** (not CI-able): pin and unpin, click-through, IDE closed, update with a pinned widget, uninstall. Backed by a `scripts/` check script in the style of `check-cold-start-aumid.ps1`.

## Out of scope

GitLab issues and merge requests; the Build & Test widget; any provider-side fetching or credential; per-widget configuration UI on the Board; filter and row-count settings; Windows 10 (no Widgets Board).

## Known limits

- Issues and PRs are only as fresh as the last time the IDE ran with focus.
- The Widgets Board exists on Windows 11 only; on other systems nothing is registered and nothing changes.

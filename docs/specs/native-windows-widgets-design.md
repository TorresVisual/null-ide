# Native Windows Widgets — Design

Issue: **#141** ("Native Windows Widgets for NULL IDE"). First release = Projects, Issues and Pull Requests widgets for **GitHub**; GitLab and the Build & Test widget are later issues.

## Feasibility spike (2026-10-21)

Question: does the Windows 11 Widgets Board list, pin and activate a widget provider registered through a *sparse* package with `ExternalLocation`? Microsoft's provider walkthrough says "only packaged apps can be registered as widget providers" and is silent on sparse packages.

Result: **yes.** A throwaway provider (C#, `com:ExeServer` + `com.microsoft.windows.widgets` app extension, sparse manifest modelled on `shell-ext/AppxManifest.xml`) was registered with `Add-AppxPackage -Register <manifest> -ExternalLocation <dir>` on Windows 11 24H2 (build 26100) in developer mode. The OS listed the provider in the `com.microsoft.windows.widgets` app-extension catalog; the Board offered the widget, pinned it, and launched the exe via COM (`-Embedding`) under the sparse package's identity. `CreateWidget`, `Activate`, `OnActionInvoked` (twice) and `Deactivate` all arrived.

Not covered by the spike, to be confirmed first in the implementation plan:
- **Provider with `null.exe` closed.** `null.exe` was running during the test. The provider has no dependency on it, but this was not measured.
- **A signed package.** The spike was an unsigned loose registration (developer mode). The shipped path is a signed `.appx` with the existing `CN=Null IDE` certificate.
- **Runtime dependencies of a C++/WinRT provider.** The C# spike published at 211 MB because the `Microsoft.WindowsAppSDK` metapackage pulls ONNX Runtime, DirectML and XAML. The plan's first task is to build the smallest C++/WinRT provider that links only the Widgets component and measure it.

## Decisions

1. **Cache only.** The provider never fetches. While Null IDE runs it writes a snapshot; the provider renders the last snapshot, with its age shown. Issues and PRs go stale once the IDE is closed, by design. This is what keeps the "no second credential store" goal: tokens stay in null-accounts' `SecretStorage`, which a separate process cannot read.
2. **The IDE is the only fetcher, filter and writer.** A new `widgetSnapshot` module in `extensions/null-tools/src/` projects the existing `IssuesStore`, the pull-request model (`pulls/`) and `recentProjects.ts` into one file. It reruns when those change, and is gated by a setting so the IDE behaves identically without the widget package.
3. **GitHub first.** null-tools has no GitLab issue or merge-request code, and null-accounts' `gitlab.ts` has no such API either, so GitLab widgets would be new fetching code. The snapshot carries a `provider` field on each item so GitLab slots in later without a schema break.
4. **Provider = separate sparse package `NullIDE.Widgets`**, not an addition to `NullIDE.ExplorerCommand`. A bad widget manifest change must not be able to break the shipped Explorer context menu. Cost: a second registration, version and removal in null-setup.
5. **Provider exe = C++/WinRT** (`null_widgets.exe`), built in the CMake + MSVC step `shell-ext/` already uses, packed as `null-widgets.appx` with `ExternalLocation` at the install root and signed with the same `CN=Null IDE` certificate (no new trust prompt). Card JSON is built with the OS's `Windows.Data.Json`.
6. **The provider is dumb.** It reads `snapshot.json` (file watch plus a re-read on `Activate`), builds Adaptive Card JSON and calls `WidgetManager::UpdateWidget`. No network, no tokens, no settings UI.
7. **Configuration lives in IDE settings** (`null.widgets.*`): which repos contribute issues and PRs, filters (assigned to me, review requested, needs attention), row counts, pinned projects vs recent. Filtering happens before the snapshot is written. Repositories are opt-in; there is no unfiltered stream.
8. **Actions.** Issue and PR rows use `Action.OpenUrl` (no process needed). "Open project" and "Open in new window" use `Action.Execute`; the provider starts `null.exe` through the explorer-marshalled launch used by `shell-ext` (`LaunchViaExplorer`), because a process started by a packaged provider inherits the package's AUMID (see `shell-ext/CLAUDE.md`).
9. **Lifecycle belongs to null-setup.** It checks, adds, updates and removes `NullIDE.Widgets` next to `NullIDE.ExplorerCommand`, with the same trust flow (CurrentUser first, elevated `LocalMachine\TrustedPeople` only on an untrusted-root answer). The uninstaller removes both. Any failure to register, or a machine without Windows 11 or the Widgets host, is logged and ignored.
10. **The provider process is demand-driven.** The Board starts it and it exits when the last widget is unpinned. Nothing runs when no widget is pinned.
11. **Atomic snapshot writes.** `snapshot.json.tmp`, then rename, so the provider never reads a torn file. A corrupt file anyway keeps the last good render.
12. **No secrets in the snapshot or logs.** Only titles, numbers, URLs, repo names, paths, labels, assignee login and timestamps. The file sits in `%LOCALAPPDATA%\Null\widgets\` (user-only by default). Private-repo issue titles do appear on the Board; the `null.widgets.*` setting descriptions say so.

## Snapshot (`%LOCALAPPDATA%\Null\widgets\snapshot.json`)

```
{
  "schema": 1,
  "writtenAt": "2026-10-21T14:03:11Z",
  "projects": { "status": "ok", "items": [{ "name", "path", "branch", "dirty", "pinned", "lastOpened" }] },
  "issues":   { "status": "ok", "items": [{ "provider": "github", "repo", "number", "title", "url", "state", "labels": [], "assignee", "attention": "assigned|mentioned|none", "localPath" }] },
  "prs":      { "status": "ok", "items": [{ "provider": "github", "repo", "number", "title", "url", "author", "review": "requested|approved|changes|none", "checks": "passing|failing|pending|none", "conflict": false, "localPath" }] }
}
```

- `status` per section is one of `ok | signed_out | offline | error`; non-`ok` keeps the last good `items`.
- `localPath` is set when a checkout of the repo is known, which enables "Open in Null IDE" on that row.
- The provider treats an unknown `schema` greater than it understands as "Update Null IDE" and renders nothing else.
- PRs are ordered by what needs the user's attention first (review requested, changes requested, failing checks, conflicts), then recency.

## Widgets in v1

| Widget | Sizes | Shows | Actions |
|---|---|---|---|
| Projects | small, medium, large | Pinned/recent projects, branch, dirty marker, last opened | Open, Open in new window |
| Issues | medium, large | Number, title, repo, labels, attention signal | Open in browser, Open project (if `localPath`) |
| Pull Requests | medium, large | Number, title, repo, author, review/check/conflict markers | Open in browser, Open project (if `localPath`) |

Build & Test is a later widget; the provider registers widgets by definition id so adding one is a manifest entry plus a card builder.

## Errors and staleness

All shown in the card, never as a crash:
- no snapshot yet: "Open Null IDE to set up widgets";
- schema newer than the provider: "Update Null IDE";
- section `signed_out | offline | error`: last rows dimmed with the reason;
- footer "updated <age>", muted after 6 hours (a single constant in the card builder).

## Testing

- **null-tools:** node tests for the snapshot projection and the atomic writer, added to the explicit `test` list in `package.json`.
- **Provider:** the card builder is one translation unit with no COM activation, covered by a CTest executable against fixture snapshots (ok, stale, signed-out, newer schema, empty).
- **null-setup:** register/update/unregister covered by the existing `FakeSystem` tests.
- **Win11 by hand** (not CI-able): pin and unpin, click-through, IDE closed, update, uninstall. Backed by a `scripts/` check script in the style of `check-cold-start-aumid.ps1`.

## Out of scope

GitLab issues and merge requests; the Build & Test widget; any provider-side fetching or credential; per-widget configuration UI on the Board; Windows 10 (no Widgets Board).

## Known limits

- Issues and PRs are only as fresh as the last time the IDE ran.
- The Widgets Board exists on Windows 11 only; on other systems nothing is registered and nothing changes.

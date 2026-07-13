# Windows Jump List: Recent Projects — Design

## Problem

Right-clicking the Null IDE taskbar icon should show a "Recent" jump list of
recently opened project folders/workspaces, like most Windows desktop apps.
Currently there is no jump list at all.

## Background

VS Code's Electron main process already implements Windows jump lists via
`app.setJumpList()`, fed from its own internal "recently opened workspaces"
history (the same store behind File > Open Recent). This repo's
`product.json` already sets the required `win32AppUserModelId: "NullIDE"`
(product.json:35), so the prerequisite for jump lists to attribute correctly
to this app is already in place.

However, VS Code extensions run in a separate extension-host process and
have no API surface to call `app.setJumpList()` directly — that's
Electron-main-only. So driving the jump list from a `null-tools`-maintained
list (rather than reusing VS Code's own history) requires a small patch to
VS Code's Electron main process, in `patches/` per this repo's existing
(currently unused) patch workflow.

Scope note: this patch touches **only** the jump list's data source. File >
Open Recent, the Welcome page's recent list, and the Ctrl+R quick-open
picker all keep using VS Code's own built-in history, untouched. A full
unification was considered and rejected — `CLAUDE.md` notes upstream core
patches "proved fragile across VS Code version bumps," and unifying would
touch much more of VS Code's core (history service, menu contributions,
Welcome page) for no functional benefit over scoping to just the jump list.

## Architecture & Data Flow

A single shared JSON file, `<userDataRoot>/null-recent-projects.json`, is
the source of truth for the jump list's "Recent" category.
`<userDataRoot>` is resolved relative to `context.globalStorageUri` (walking
up to the userData root) rather than hardcoded to `%APPDATA%\Null`, so it
works identically for the installed and portable ZIP builds.

Flow:

1. User opens a folder or `.code-workspace` file in Null IDE.
2. `null-tools` (extension host) detects the workspace root on activation
   and upserts an entry into `null-recent-projects.json`: move-to-top if
   already present, prune to 10 entries, dedupe by normalized
   (case-insensitive) path.
3. A VS Code core patch changes the Electron main-process call site that
   currently builds the "Recent" category for `app.setJumpList(...)`, so it
   reads from `null-recent-projects.json` instead of VS Code's internal
   recently-opened-workspaces history.
4. The jump list is rebuilt on app startup and on each `browser-window-focus`
   event (cheap file read) rather than via a new file-watcher.
5. User right-clicks the Null IDE taskbar icon → sees "Recent" populated
   from that file, most-recent-first, up to 10 entries.
6. Clicking an entry launches `null.exe "<path>"`, opening that folder in a
   new or existing window (standard Electron jump-list task behavior).

### "More Recent Projects..." entry

The jump list's "Recent" category is capped at 10 (a Windows/Electron
practical display limit), but `null-recent-projects.json` tracks up to 50
entries so more history is available than the jump list itself can show.

A separate, static "Tasks" entry titled "More Recent Projects..." is added
to the jump list (alongside "Recent"). It launches `null.exe` with a
`null://` URI (this repo's registered custom protocol, `product.json:33`),
routed by VS Code core — already supported, no additional patch needed
beyond adding this one static task — to a `vscode.window.registerUriHandler`
registered by `null-tools`. That handler shows a `vscode.window.showQuickPick`
listing all (up to 50) tracked entries; selecting one opens it via
`vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true })`,
always in a new window — consistent with clicking a jump list "Recent" entry
directly.

## Components

### null-tools side (extension host, TypeScript)

New module `extensions/null-tools/src/recentProjects.ts`, invoked from
`activate()` (extension.ts:1298).

- On activation, resolve the current root:
  - `vscode.workspace.workspaceFile` if a `.code-workspace` is open, else
  - `vscode.workspace.workspaceFolders?.[0]`, else
  - do nothing (no entry recorded for an empty window).
- Read `null-recent-projects.json`; treat missing/corrupt file as `[]`.
- Upsert `{ path, label, isWorkspaceFile, timestamp }`:
  - `label` = folder/workspace basename (jump list entry title).
  - `path` = full fs path (used for dedupe key, normalized lowercase on
    Windows, and as the jump list entry's tooltip/description).
- Sort by `timestamp` descending, truncate to **50** (the full tracked
  history; the jump list patch further truncates to 10 for the "Recent"
  category — see "More Recent Projects..." below).
- Write atomically: write to a temp file in the same directory, then
  rename over the target, so a killed process never leaves a partial file.
- Register a `vscode.window.registerUriHandler` for a `/recent-projects`
  path. On invocation, read the full (up to 50) list and show a
  `vscode.window.showQuickPick`; on selection, run
  `vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true })`.

### VS Code core patch (`patches/0001-jumplist-from-null-tools.patch`)

- Locate the existing Electron-main call site that builds the "Recent"
  category array passed to `app.setJumpList()` (upstream, in the
  workspaces-history / windows main service).
- Replace that array's source with a read of
  `null-recent-projects.json` (top 10 of the up-to-50 tracked entries),
  mapping each entry to the same
  `{ type: 'task', program: process.execPath, args: '"<path>"', title,
  description: path, iconPath }` shape VS Code already produces — only the
  source list changes, not the entry-building logic or other categories
  (e.g. a "New Window" task, if present, is left as-is).
- Add one additional static "Tasks" entry, "More Recent Projects...",
  `{ type: 'task', program: process.execPath, args: '--open-url "null://<publisher>.null-tools/recent-projects"', title: 'More Recent Projects...' }`
  (exact CLI flag for opening a URI to be confirmed against the pinned
  VS Code version during implementation).
- Hook the rebuild into existing app lifecycle events already present in
  Electron main (app ready/startup, `browser-window-focus`) instead of
  adding new file-watching machinery.
- No local `vscode-src/` checkout exists in this repo (builds run in CI
  only, per `CLAUDE.md`). Authoring this patch requires temporarily cloning
  VS Code at the pinned `MS_TAG` to find the exact call site, make the
  change, and generate the patch via `git format-patch`, per the existing
  (currently unused) `patches/` workflow documented in `CLAUDE.md`.

## Error Handling

- Missing/corrupt `null-recent-projects.json` → treated as `[]`; never
  crashes jump list update or extension activation.
- A tracked path that no longer exists on disk → still shown (matches VS
  Code's own default recent-list behavior of not validating existence);
  clicking it launches `null.exe` on a missing path, same UX VS Code
  already has for its own stale recent entries.
- Write failures (e.g. read-only volume) → caught and logged, non-fatal;
  the jump list simply doesn't update for that session.

## Testing / Verification

No local VS Code build is possible per `CLAUDE.md` ("do not run CI or build
scripts locally"). Verification path:

1. Trigger a `workflow_dispatch` CI build.
2. Install the resulting ZIP or installer.
3. Open 2-3 different folders across separate launches of Null IDE.
4. Right-click the Null IDE taskbar icon; confirm "Recent" lists them
   most-recent-first.
5. Click an entry; confirm it relaunches Null IDE on that folder.
6. Re-open a folder already in the list; confirm it moves to the top
   rather than duplicating.
7. Click "More Recent Projects..."; confirm the quick-pick lists all
   tracked entries (beyond the 10 shown directly), and selecting one opens
   it in a new window.

The null-tools upsert/prune/dedupe logic (pure JSON manipulation, no VS
Code API dependency) is straightforward to unit test if/when `null-tools`
gains a test setup; otherwise it's verified manually alongside the above.

## Out of Scope

- File > Open Recent, Welcome page recent list, Ctrl+R picker — untouched,
  keep using VS Code's built-in history.
- Custom jump list "Tasks" category (e.g. "New Window") — not part of this
  feature; only the "Recent" category's data source changes.
- Validating that tracked paths still exist before showing them.

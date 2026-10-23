# Project Launcher — Design

## Intent

Opening one of your projects from the taskbar must be fast and must not disturb
the window you are in. It happens many times a day.

Today the jump list shows the pinned and newest ~10 entries (Windows decides the
slot count). "More Recent Projects..." runs a URI handler inside whichever Null
window is already open, which opens the dashboard as a tab there, and a plain
dashboard click opens the project *in that same window*, replacing the project it
holds. So any project beyond the first ten costs a window you did not want to
touch.

Replace "More Recent Projects..." with a standalone launcher: a small separate
program that shows every tracked project, opens the one you pick with
`null.exe`, and exits. It depends on no running Null window.

## Goals

- One keystroke path: open launcher, type a few letters, Enter. Never disturbs an
  existing window.
- Shows all tracked projects (`null.recentProjects.maxItems`, default raised from
  20 to 50, plus all pinned), not just what fits in the jump list.
- Same-named folders are told apart (path, branch).
- Missing folders are visible and marked, never silently dropped.

## Non-goals

- A global hotkey or tray icon. That needs a resident process and is a separate
  subsystem; revisit if the jump list proves too slow to reach.
- Linux or macOS. The jump list is Windows only; the launcher is too.
- Replacing the dashboard. It keeps its cards, search and actions. (Making a
  dashboard click open in a new window when the current one already holds a
  project is a separate, tiny change and is not part of this.)
- A second store. The launcher reads and edits the existing
  `null-recent-projects.json`.

## Anti-goals

- Anything that makes startup visibly slower than the jump list entry it replaces.
- Anything that can lose or corrupt the project list.
- A launcher that holds a lock on the install folder and breaks updates.

## Approaches considered

| Approach | Trade-off |
|---|---|
| Native Win32 palette (like `null_widgets.exe`) | Fastest start (~30 ms), tiny. UI is hand-drawn in C++, hard to grow, a fourth implementation of the store logic. |
| **Standalone Tauri launcher, new `launcher/` crate (chosen)** | ~0.2–0.4 s to open. HTML/CSS UI, pure logic in Rust with `cargo test`, WebView2 already required by the wizard. |
| Launcher window inside Null's Electron process (core patch) | No new binary, but another fragile core patch, and a jump-list click with Null closed boots a full Electron instance just to show a picker. |

Chosen because the UI will keep changing and the logic is testable outside the
window; the start-up cost over native is acceptable for a picker you dismiss in
seconds. Not inside `null-setup.exe`: it relocates itself out of the install
folder when started from there, which a launcher must not do.

## The window (layout B)

Frameless, ~640 px wide, centred, always on top, closes on Esc or on losing focus.

- Search box at the top (focused on open).
- **Pinned** section, then **Recent** section, each in store order.
- Row: name, git-branch chip, project-type chip, path and last-opened time on
  the right. Missing folders are greyed with a "missing" chip and are not
  openable.
- Keys: type to filter, ↑/↓ move, Enter opens, Esc closes, Ctrl+P pins/unpins
  (suppress the webview's print shortcut), Delete removes an **unpinned** entry
  from the list at once; on a pinned entry Delete does nothing (unpin first).
  A missing folder cannot be opened; Delete removes it. Relocating a moved
  project stays in the dashboard.
- Text is at least 11 px. Colours follow the Windows light/dark setting
  (`prefers-color-scheme`); the launcher does not read the Null theme.
- Filter: case-insensitive. Name: subsequence (fuzzy) match, so `nide` finds
  `null-ide`. Path: plain substring. Rank by match quality first (name above
  path-only), then store order (pinned first, then newest).

### Where the chips come from

The store does **not** hold branch or type today (`gitBranch`/`projectType` are
declared but nothing writes them; the dashboard computes type live). So the
launcher computes both itself, after the first paint, so opening never waits:

- Branch: read `<project>/.git/HEAD` (no `git` process). If `.git` is a file
  (worktree or submodule), follow its `gitdir:` line. Detached HEAD shows the
  short hash. No `.git` → no chip.
- Type: one `read_dir` of the project root with the same ordered marker rules as
  `extensions/null-tools/src/projectType.ts` (Rust, CMake, .NET, Node).
  This duplicates a four-line table; a comment names the source.
- A stored `gitBranch`/`projectType`, if present, is used until the live value
  arrives.

## Opening a project

`null.exe` in the same folder as the launcher is started with `--folder-uri
"<file URI>"`, or `--file-uri` for a `.code-workspace` entry (the exact
arguments the jump list entries already use). Null's own launch logic then opens a
new window, focuses the window that already has it, or (only if Null's launch
logic does so by itself) reuses an empty window. The launcher adds no window
tracking and passes no `--reuse-window`. It then exits.
It does not write to the store when opening: the main-process
`addRecentlyOpened` already records the open.

## Data

- Reads `null-recent-projects.json`. Location: `<install>\data\user-data` when
  `<install>\data` exists (portable), else `%APPDATA%\Null`. This is what
  `environmentMainService.userDataPath` resolves to in the patch.
  (`null-tools`' `nullDataDir()` ignores portable mode today; not fixed here, a
  separate issue is filed.)
- Entry format is unchanged. Unknown fields are preserved when the launcher writes.
- Missing, corrupt or empty file → empty list ("No recent projects"), never a crash.
- Pin and remove re-read the file, change the one entry, and write a temp file
  then rename it (the same atomic scheme the patch and null-tools use). Last
  writer wins against a concurrent write from Null; accepted.

## Entry point

The patch (`001-jumplist-recent-projects.patch`) changes the "More Recent
Projects..." task to run `null_launcher.exe` from the folder of `process.execPath`
with no arguments, instead of `--open-url "null://null.null-tools/recent-projects"`.
The `/recent-projects` URI handler in null-tools stays (it is the fallback below).

## Behaviours I decided (change if wrong)

- Only one launcher at a time: a second start (double-click on the jump list)
  brings the existing one forward and exits (named mutex).
- Closes on losing focus, like a palette, and has no taskbar button. Windows can
  refuse a fresh window its first focus, so the close-on-blur handler must ignore
  that case; "launched from the jump list, window stays open" is an explicit
  manual test.
- WebView2 missing or the launcher failing to start its window: fall back to the
  old behaviour (`null.exe --open-url "null://null.null-tools/recent-projects"`)
  silently, so the entry never becomes dead, and append the reason to
  `launcher.log` next to the store. The log is capped (truncate past ~64 KB).
- Appears centred on the monitor under the mouse.

## Build, packaging, lifecycle

- New top-level `launcher/` Cargo workspace: a library for the pure logic (store
  parsing, filter/rank, branch and type detection, URI building, atomic write) and
  a small Tauri binary `null_launcher.exe`. UI in `launcher/ui/` (plain HTML/CSS/JS,
  with its testable rules in a `*-model.js` run by `node --test`, as the wizard does).
- Does not depend on `setup/core` (it would pull the HTTP/updater stack). The
  WebView2 presence check is a small copy of `setup/core/src/webview2.rs`.
- CI (`build.yml`, `build-windows`): `cargo test --locked` and `cargo build
  --release --locked` for `launcher/`, copy `null_launcher.exe` to the install
  root next to `null.exe`, so it ships in the zip. Mirror in
  `scripts/build-local.ps1`.
- Updates and uninstall: the exe sits in the install root, so the swap must end
  any running `null_launcher.exe` under that folder the way it already ends
  `null_widgets.exe` (`procs::stop_named_under`); it lives for seconds, so no
  Run entry or install option.
- Settings: `null.recentProjects.maxItems` default 50 in `null-tools`'
  `package.json` and the patch's fallback constant (was 20); refresh `out/` per the
  extension conventions.
- Docs: a `launcher/CLAUDE.md`, a line in the root `CLAUDE.md` layout, and a
  note in the wiki.

## Testing

- Rust: store parsing (legacy entries, corrupt file, unknown fields kept), filter
  and ranking, branch detection (normal, detached, worktree file, no repo), type
  detection order, file-URI building (spaces, `#`, drive letters, UNC),
  pin/remove round trip and atomic write.
- UI model (`node --test`): key handling, selection after filtering, section
  grouping.
- Manual in a built Null package (like the other native pieces): jump list click
  with Null closed and running, a project that is already open, a missing folder,
  an update while the launcher is open.

## Decisions confirmed with the user

No hotkey or resident process for now; empty-window reuse only if Null does it
natively; pinned entries ignore Delete; relocation stays in the dashboard; default
list size 50; close-on-blur with no taskbar button and the first-focus case
tested; silent fallback to the dashboard plus a log file; fuzzy name matching;
follow Windows light/dark; the portable-mode path mismatch in null-tools is a
separate issue.

## Left to the builder

- Tauri window options for frameless, always-on-top, focus-loss close on Windows.
- Whether the window waits for the first paint before showing (avoid a white flash).
- Single-instance mechanism details and bring-to-front.
- Exact jump-list fallback check (does the exe exist) in the patch.
- Whether CTest-style tests for the fallback belong in `patches/test/`.

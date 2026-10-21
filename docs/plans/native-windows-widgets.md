# Desktop Widgets Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Show Projects, Issues and Pull Requests (GitHub) as borderless Null-styled windows on the Windows desktop, fed by a snapshot file the IDE writes and drawn by a dumb Win32/Direct2D exe that null-setup starts at login as an opt-in.

**Architecture:** Three tracks that meet at one file contract (`%LOCALAPPDATA%\Null\widgets\snapshot.json`, schema 1). (A) `shell-ext/widgets/`: `null_widgets.exe`, a plain Win32 exe (no package, no signing) made of a pure, CTest-covered core (snapshot validation, row layout, placement, safe launching) and a thin window shell. (B) `extensions/null-tools/src/widgets/`: the only fetcher, filter and writer. (C) `setup/core`: an opt-in `Feature::Widgets` (HKCU Run entry, start, stop before a swap, cleanup on uninstall). Task 1 is a hard gate: if it fails, nothing after it is built.

**Tech Stack:** C++20 with C++/WinRT headers from the Windows SDK (`Windows.Data.Json` only), Direct2D/DirectWrite/GDI layered windows, CMake + MSVC, CTest; TypeScript (`node --test`); Rust (`cargo test -p null-setup-core`); PowerShell for the check script.

**Spec:** [docs/specs/native-windows-widgets-design.md](../specs/native-windows-widgets-design.md) (issue #141). Task 1 writes its findings to `docs/specs/native-windows-widgets-gate.md`.

**Verification state of this plan:** the C++ in Tasks 2–6 and the Rust in Tasks 14–15 was compiled and its tests were run in a scratch copy while the plan was written (all CTest and `cargo test -p null-setup-core` suites passed; the host was started and drawn on the desktop of a Windows 11 24H2 machine). The TypeScript in Tasks 8–13 is carried over from the earlier version of this plan and was not compiled; fix compile errors in place, the tests say what the behaviour must be.

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

Copied from the spec; every task includes them.

- First release = Projects, Issues and Pull Requests widgets for **GitHub** only. No GitLab, no Build & Test widget, no Linux. Windows 10 (1703 or later, for per-monitor v2 DPI) and Windows 11.
- **Cache only.** `null_widgets.exe` never fetches, holds no token, has no settings UI. Tokens stay in null-accounts' `SecretStorage`.
- The IDE (`null-tools`) is the only fetcher, filter and writer, gated by `null.widgets.enabled`; with it off the IDE behaves identically to a build without widgets.
- Host = **`null_widgets.exe`**, a plain Win32 exe in the install root next to `null.exe`: no package identity, no signing, no Windows App SDK. One instance (named mutex). Built by the CMake target in `shell-ext/widgets/` in the existing MSVC step.
- Rendering: Direct2D / DirectWrite on layered windows, one top-level window per widget, `WS_EX_LAYERED | WS_EX_TOOLWINDOW` (no taskbar button), per-pixel alpha, rounded corners, Null Dark palette, per-monitor DPI aware. Each window is a layered **child of the desktop's icon host (`SHELLDLL_DefView`)**, so it stays on the desktop through Win+D and below every app (gate result, `docs/specs/native-windows-widgets-gate.md`: a top-level window pinned above `Progman` is hidden by Win+D). The exe embeds a manifest (`supportedOS` + PerMonitorV2) and recreates its windows after an Explorer restart.
- Layout (`%LOCALAPPDATA%\Null\widgets\layout.json`) is owned by the exe: positions, per-widget visibility, lock. Drag moves and snaps to screen edges; a saved position off every monitor is clamped on screen. Right-click menu: Refresh, Lock, Hide this widget, Quit widgets, plus a "Show <widget>" item per hidden widget; a second launch of the exe shows all hidden widgets.
- The exe treats `snapshot.json` as **untrusted input**: links open only for `https://` URLs on host `github.com` via `ShellExecuteW`; snapshot text is length-capped and drawn as plain text only; a malformed file keeps the last good render; `schema` greater than 1 shows "Update Null IDE".
- Actions: issue/PR rows open in the browser. "Open project" / "Open in new window" start `null.exe` with `CreateProcessW`: no shell, `null.exe` resolved from the exe's own folder (never from the snapshot), a project `path` must be absolute and is passed after a `--` separator.
- Settings: exactly two, `null.widgets.enabled` and `null.widgets.repos` (`[{ repo, account }]`). Row maxima are constants: **8 projects, 10 issues, 10 PRs**. No filter or row-count settings.
- null-setup owns the lifecycle: opt-in "Desktop widgets" option (default **off**) writes `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\NullWidgets` and starts the exe; an update stops `null_widgets.exe` (scoped to the install path) before the swap and starts it again afterwards; uninstall removes the Run entry, ends the process and deletes `%LOCALAPPDATA%\Null\widgets\`. Any widgets failure is logged and ignored; it never fails the IDE install or update. All of it goes through the `System` seam (`FakeSystem` in tests).
- Snapshot writes are atomic (`snapshot.json.tmp`, then rename). No secrets in the snapshot or logs. One writer window via the `PresenceOwnership` pattern with claim file `widgets-owner.json`.
- Turning widgets off deletes `snapshot.json`; signing out does **not** delete rows (they stay dimmed as `signed_out`).
- Nothing runs unless asked: without the opt-in there is no Run entry and no process; snapshot writing starts only after `Null: Set Up Widgets`. Before that the widgets read "Open Null IDE to set up widgets".
- The footer is muted after 6 hours (`kStaleAfterSeconds`, one constant in the layout code).
- Repo conventions: `out/` of an extension is tracked — after editing `src/` run `npm run compile` and commit the refreshed `out/` as `chore: refresh null-tools compiled output`; never hand-edit `out/`. New TS test files must be added to **both** the `test` script in `package.json` and `tsconfig.json`'s `include`. Run `graphify update .` after code changes. Commit style: Conventional Commits with `(#141)`.

**Interpretation notes (spec silent or ambiguous; flagged for review):**
1. **Z-order.** The spec said `HWND_BOTTOM`; measured, that hides the windows behind the wallpaper (Task 1 records it, the spec is corrected). The first replacement ("insert after the window directly above `Progman`") was also measured and fails: Win+D hides it. The rule used is now "layered child of `SHELLDLL_DefView`" (Task 1 round 2); Task 6's `app.cc` was adapted accordingly (`FindDesktopHost`, `EnsureWindows`, a 5 s timer and `TaskbarCreated` recreate the windows after an Explorer restart).
2. **Row interaction.** The spec lists actions per widget but not how to reach the second one. Left click = the row's primary action (Open / Open in browser); right click on a row shows that row's actions above the fixed menu items.
3. **"Open" vs "Open in new window".** "Open" runs `null.exe -- <path>` (VS Code's own rule about reusing a window for an already open folder applies); "Open in new window" adds `--new-window`.
4. **Update when the exe cannot be stopped.** The spec says the widgets part of the update is then skipped. An update swaps the whole install folder, so a running exe can only block it, not be skipped. The stop is best effort and logged; the existing locked-files prompt of `procs::close_all` is the backstop (it lists `null_widgets.exe` like any other process).
5. **Wizard option is always offered** (the exe works on Windows 10 and 11, so there is no host check, unlike a Widgets Board design).
6. GitHub search queries are limited to 256 characters, so "one GraphQL request per account" is one request **per chunk of repos** that fits (`chunkRepos`), which is one request per account in the common case.
7. Snapshot rows additionally carry `updatedAt` (the spec example omits it; timestamps are allowed content). Schema stays 1; the exe ignores unknown fields.
8. "Nothing is enabled implicitly … stored at least one repo *or enabled projects*": `Null: Set Up Widgets` sets `null.widgets.enabled = true` and stores the picked repos (possibly none). With zero repos only the Projects widget has data. There is no third setting.
9. Sizes are fixed at the spec's defaults (320×240, 360×320 DIP); `layout.json` may carry `w`/`h` (DIP, 200–800) but there is no resize UI.

## Review Focus

Failure modes the spec implies that no happy-path task exercises. Each has a test in the owning task.

1. **Hostile snapshot** (a `file:`/`javascript:`/look-alike-host URL, a `--flag` or relative project path, a 10 000-character title, markup- or template-looking text): must never produce an action; it renders as inert text. → Tasks 2, 3, 5.
2. **Torn, empty or garbage `snapshot.json`, or a newer schema, while widgets are drawn**: keep the last good render (torn/garbage) or show "Update Null IDE" (newer); never crash or blank the widget. A deleted file falls back to the empty state. → Task 2.
3. **Malformed `null.widgets.repos`** (a repo like `a/b is:private`, `../x`, a non-array, duplicates) must never reach a search string. → Task 8.
4. **Token expiry / offline / rate limit mid-session**: rows stay (dimmed), sections carry the reason, nothing is wiped, fetching suspends instead of hammering. → Tasks 9, 12.
5. **Update or uninstall while the widgets are running** (the exe runs from the install folder and would block the rename), and a **monitor that was unplugged** since the layout was saved (the card must not stay off-screen). → Tasks 4, 14, 15.

## File Structure

| Path | Responsibility |
|---|---|
| `scripts/check-widgets.ps1` | Manual-check driver: `-Status` (process, Run entry, files, z-order next to `Progman`) and `-Checklist` |
| `shell-ext/CMakeLists.txt` | Gains `enable_testing()` and `add_subdirectory(widgets)` |
| `shell-ext/widgets/CMakeLists.txt` | `null_widget_core` static lib, four CTest executables, the `null_widgets` exe |
| `shell-ext/widgets/snapshot.{h,cc}` | Parse, validate and sanitize `snapshot.json`; URL/path allow-lists; last-good rule |
| `shell-ext/widgets/layout.{h,cc}` | Snapshot → rows, footer, messages per widget; metrics (pure) |
| `shell-ext/widgets/placement.{h,cc}` | `layout.json` read/write, default position, clamp to monitors, edge snap (pure) |
| `shell-ext/widgets/actions.{h,cc}` | Command-line quoting, `Run(Action)`, IDE-environment scrub |
| `shell-ext/widgets/app.cc` | `wWinMain`, windows, Direct2D painting, drag, menu, single instance, file watch |
| `shell-ext/widgets/check.h`, `*_test.cc`, `fixtures/*.json` | CTest executables against fixture snapshots |
| `.github/workflows/build.yml`, `scripts/build-local.ps1` | Run the tests, ship `null_widgets.exe` in the install root |
| `extensions/null-tools/src/widgets/widgetTypes.ts` | Snapshot types, constants, `parseRepos` |
| `…/widgetQueries.ts` | GraphQL document, search strings, chunking, mappers, ranking (pure) |
| `…/widgetSections.ts` | Section building (partial failure, last-good, status), projects section (pure) |
| `…/widgetStore.ts` | `widgetsDir()`, atomic writer, delete |
| `…/widgetFetch.ts` | Per-account fetch over `requestGraphql`, error classification (no `vscode` import) |
| `…/widgetRefresher.ts` | Refresh state machine with injected deps (ownership, timers, backoff, disable) |
| `…/widgetSetup.ts` | Pure helpers for `Null: Set Up Widgets` (repo list mapping, settings merge, exe environment) |
| `…/widgetIntegration.ts` | The only `vscode` file: settings, commands, focus, wiring, starting the exe |
| `extensions/null-tools/src/presenceOwnership.ts` | Gains an optional `claimFile` parameter |
| `setup/core/src/install_config.rs` | `Feature::Widgets`, `InstallConfig.widgets` |
| `setup/core/src/shell/widgets.rs` | Run entry, start, stop, data-folder cleanup |
| `setup/core/src/shell/{mod,sys}.rs`, `procs.rs`, `registrations.rs`, `update.rs`, `manage.rs` | `Locations.local_data`, `System::{stop,start}_widgets`, `Registrar::stop_widgets`, wiring |
| `setup/ui/wizard-model.js` | The opt-in option |

---

### Task 1: Hard gate — clean up the abandoned spike, probe the desktop behaviour

The earlier Widgets Board design left uncommitted files in the working tree. This task removes them, then answers the open questions of the spec's "Hard gate" with a throwaway probe. **If a gate item fails, stop and tell the user; do not start Task 2.**

Already measured while this plan was written (Windows 11 24H2, build 26100, with the full host of Tasks 2–6): pinned with `HWND_BOTTOM` the windows end up **below `Progman`** (z-order index greater than Progman's) and are invisible; pinned directly above `Progman` they are visible, draw with per-pixel alpha and stay visible through Win+D. The probe confirms this independently and covers what was not measured.

**Files:**
- Delete (untracked, from the withdrawn design): `scripts/check-widgets.ps1`, `scripts/fetch-widgets-deps.ps1`, `scripts/pack-widgets.ps1`, `shell-ext/widgets/`
- Create (outside the repo, not committed): `%TEMP%\widgets-probe\probe.cc`
- Create: `docs/specs/native-windows-widgets-gate.md`

- [ ] **Step 1: Remove the abandoned spike files**

```powershell
git status --short            # expect exactly: M shell-ext/CMakeLists.txt, ?? the three scripts, ?? shell-ext/widgets/
Remove-Item scripts/check-widgets.ps1, scripts/fetch-widgets-deps.ps1, scripts/pack-widgets.ps1 -Force
Remove-Item shell-ext/widgets -Recurse -Force
```

These files are untracked and belong to the withdrawn design (a Widgets Board provider and its sparse package); they cannot be restored from git. Leave the uncommitted `shell-ext/CMakeLists.txt` change (`enable_testing()` and `add_subdirectory(widgets)`) alone: Task 2 provides the directory it points at and commits it.

- [ ] **Step 2: Write and build the probe**

`%TEMP%\widgets-probe\probe.cc` — a 240×120 layered tool window pinned directly above `Progman`, which flips its colour on every click and logs clicks, display changes and resumes to `%TEMP%\widgets-probe.log`:

```cpp
// Throwaway gate probe (not kept). A layered tool window pinned just above the desktop window, logging what Windows does to it.
// Build (Developer PowerShell for VS 2022):  cl /nologo /EHsc /W4 /DUNICODE /D_UNICODE probe.cc user32.lib gdi32.lib
#include <windows.h>

#include <cstdio>
#include <ctime>

static FILE* g_log;
static int g_clicks = 0;

static void Log(char const* what) {
  std::fprintf(g_log, "%lld %s\n", static_cast<long long>(std::time(nullptr)), what);
  std::fflush(g_log);
}

static HWND AboveDesktop(HWND self) {
  HWND prog = FindWindowW(L"Progman", nullptr);
  HWND above = prog ? GetWindow(prog, GW_HWNDPREV) : nullptr;
  return above == self ? nullptr : above;
}

static void Paint(HWND h) {
  HDC screen = GetDC(nullptr), mem = CreateCompatibleDC(screen);
  BITMAPINFO bi{};
  bi.bmiHeader = {sizeof(BITMAPINFOHEADER), 240, -120, 1, 32, BI_RGB};
  unsigned* px = nullptr;
  HBITMAP bmp = CreateDIBSection(screen, &bi, DIB_RGB_COLORS, reinterpret_cast<void**>(&px), nullptr, 0);
  HGDIOBJ old = SelectObject(mem, bmp);
  unsigned colour = (g_clicks % 2) ? 0xF0204080u : 0xF0802040u;  // premultiplied ARGB: flips on every click
  for (int i = 0; i < 240 * 120; ++i) px[i] = colour;
  RECT wr;
  GetWindowRect(h, &wr);
  POINT pos{wr.left, wr.top}, src{0, 0};
  SIZE size{240, 120};
  BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
  UpdateLayeredWindow(h, screen, &pos, &size, mem, &src, 0, &blend, ULW_ALPHA);
  SelectObject(mem, old);
  DeleteObject(bmp);
  DeleteDC(mem);
  ReleaseDC(nullptr, screen);
}

static LRESULT CALLBACK Proc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_WINDOWPOSCHANGING: {
      auto* p = reinterpret_cast<WINDOWPOS*>(lp);
      if (HWND above = AboveDesktop(h)) {
        p->hwndInsertAfter = above;
        p->flags &= ~SWP_NOZORDER;
      }
      p->flags |= SWP_NOACTIVATE;
      return 0;
    }
    case WM_MOUSEACTIVATE: return MA_NOACTIVATE;
    case WM_LBUTTONDOWN: {
      char buf[64];
      std::snprintf(buf, sizeof buf, "click %d", ++g_clicks);
      Log(buf);
      Paint(h);
      return 0;
    }
    case WM_DISPLAYCHANGE: Log("WM_DISPLAYCHANGE"); SetWindowPos(h, nullptr, 100, 100, 240, 120, SWP_NOACTIVATE | SWP_NOZORDER); Paint(h); return 0;
    case WM_POWERBROADCAST:
      if (wp == PBT_APMRESUMEAUTOMATIC || wp == PBT_APMRESUMESUSPEND) {
        Log("resume");
        SetWindowPos(h, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER);
        Paint(h);
      }
      return TRUE;
    case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(h, msg, wp, lp);
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, PWSTR, int) {
  wchar_t path[MAX_PATH];
  GetTempPathW(MAX_PATH, path);
  wcscat_s(path, L"widgets-probe.log");
  _wfopen_s(&g_log, path, L"a");
  WNDCLASSW wc{};
  wc.lpfnWndProc = Proc;
  wc.hInstance = inst;
  wc.lpszClassName = L"NullWidgetsProbe";
  RegisterClassW(&wc);
  HWND h = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, wc.lpszClassName, L"probe", WS_POPUP, 100, 100, 240, 120, nullptr, nullptr, inst, nullptr);
  ShowWindow(h, SW_SHOWNOACTIVATE);
  Paint(h);
  Log("started");
  MSG m;
  while (GetMessageW(&m, nullptr, 0, 0) > 0) DispatchMessageW(&m);
  return 0;
}
```

Build it in a "Developer PowerShell for VS 2022" (the build must print no warnings):

```powershell
mkdir $env:TEMP\widgets-probe -Force | Out-Null; cd $env:TEMP\widgets-probe
cl /nologo /EHsc /W4 /DUNICODE /D_UNICODE probe.cc user32.lib gdi32.lib
```

- [ ] **Step 3: Run the checks on Windows 11 24H2 and on Windows 10**

Start `probe.exe` from a plain terminal. A dark-red box appears at (100,100) on the primary monitor. For each item write pass/fail and what you saw:

1. Open an app over the box: the app is in front, the box never comes forward.
2. Win+D: the box stays visible.
3. Click the box: its colour flips and the log gains `click N`; the click does not reach any window behind it.
4. Sleep and resume the machine: the log gains `resume`; the box is still visible.
5. Change the display resolution or unplug/plug a monitor: the log gains `WM_DISPLAYCHANGE`; the box is still visible.
6. Restart Explorer (Task Manager → Windows Explorer → Restart): note whether the box is still visible. (Expected: it may vanish behind the new desktop window; the host handles this with `TaskbarCreated`, so this is information, not a gate item.)

Kill the probe afterwards (`Stop-Process -Name probe`).

- [ ] **Step 4: Record the findings**

Create `docs/specs/native-windows-widgets-gate.md` with: the date, the two Windows builds, a table of the six items per OS (pass/fail, notes), the sentence "pinning with `HWND_BOTTOM` hides the windows behind the desktop; pinning directly above `Progman` works", and a verdict line. Items 1–5 must pass on both systems. If Win+D hides the widgets or clicks fail, write the verdict as "stop" and report to the user: the spec's fallback is an owned-by-desktop parent window, which needs a design decision before more is built.

- [ ] **Step 5: Commit**

```bash
git add docs/specs/native-windows-widgets-gate.md
git commit -m "docs(widgets): record the desktop gate findings (#141)"
```

---

### Task 2: Snapshot parser and validator

**Files:**
- Create: `shell-ext/widgets/CMakeLists.txt`, `shell-ext/widgets/check.h`
- Create: `shell-ext/widgets/snapshot.h`, `shell-ext/widgets/snapshot.cc`, `shell-ext/widgets/snapshot_test.cc`
- Create: `shell-ext/widgets/fixtures/ok.json`, `partial.json`, `signed_out.json`, `newer_schema.json`, `corrupt.json`, `hostile.json`
- Modify (already modified in the working tree, commit it here): `shell-ext/CMakeLists.txt`

**Interfaces:**
- Produces (namespace `null_widgets`, `snapshot.h`): `enum class Load { Ok, Missing, Corrupt, NewerSchema }`; structs `Failed`, `Section`, `Project`, `Issue`, `Pr`, `Snapshot`, `Loaded { Load state; Snapshot snapshot; }`; `Loaded ParseSnapshot(std::wstring const&)` (never throws; unsafe URLs and paths come back empty, text is capped); `Loaded LoadSnapshotFile(std::wstring const&)`; `Loaded KeepLastGood(Loaded const& previous, Loaded fresh)`; `bool IsSafeGithubUrl(...)`, `bool IsAbsoluteLocalPath(...)`, `std::wstring CapText(..., size_t)`, `bool ParseIsoUtc(..., long long*)`; `constexpr int kSchema = 1`.

- [ ] **Step 1: Write the fixtures, the check header, the test and the CMake file**

`shell-ext/CMakeLists.txt` already ends with `enable_testing()` and `add_subdirectory(widgets)` (uncommitted); keep it.

`shell-ext/widgets/fixtures/ok.json`:

```json
{"schema":1,"writtenAt":"2026-10-21T14:03:11Z",
 "projects":{"status":"ok","failed":[],"items":[
   {"name":"null-ide","path":"D:\\Coding\\Apps\\null-ide","branch":"main","dirty":true,"pinned":true,"lastOpened":"2026-10-21T13:00:00Z"},
   {"name":"site","path":"D:\\Coding\\site","branch":"dev","dirty":false,"pinned":false,"lastOpened":"2026-10-20T09:00:00Z"}]},
 "issues":{"status":"ok","failed":[],"items":[
   {"provider":"github","repo":"o/r","number":7,"title":"Crash on save","url":"https://github.com/o/r/issues/7","state":"open","labels":["bug"],"assignee":"me","attention":"assigned","localPath":"D:\\Coding\\Apps\\null-ide","updatedAt":"2026-10-21T12:00:00Z"}]},
 "prs":{"status":"ok","failed":[],"items":[
   {"provider":"github","repo":"o/r","number":9,"title":"Add widgets","url":"https://github.com/o/r/pull/9","author":"sam","review":"requested","checks":"failing","conflict":true,"localPath":"","updatedAt":"2026-10-21T12:30:00Z"}]}}
```

`fixtures/partial.json` (two repos failed, one issue kept):

```json
{"schema":1,"writtenAt":"2026-10-21T14:03:11Z",
 "projects":{"status":"ok","failed":[],"items":[]},
 "issues":{"status":"ok","failed":[{"repo":"o/gone","reason":"error"},{"repo":"o/two","reason":"offline"}],"items":[
   {"provider":"github","repo":"o/r","number":7,"title":"Crash on save","url":"https://github.com/o/r/issues/7","state":"open","labels":[],"assignee":"me","attention":"assigned","localPath":"","updatedAt":"2026-10-21T12:00:00Z"}]},
 "prs":{"status":"ok","failed":[],"items":[]}}
```

`fixtures/signed_out.json`:

```json
{"schema":1,"writtenAt":"2026-10-21T14:03:11Z",
 "projects":{"status":"ok","failed":[],"items":[]},
 "issues":{"status":"signed_out","failed":[{"repo":"o/r","reason":"signed_out"}],"items":[
   {"provider":"github","repo":"o/r","number":7,"title":"Crash on save","url":"https://github.com/o/r/issues/7","state":"open","labels":[],"assignee":"me","attention":"assigned","localPath":"","updatedAt":"2026-10-21T12:00:00Z"}]},
 "prs":{"status":"signed_out","failed":[{"repo":"o/r","reason":"signed_out"}],"items":[
   {"provider":"github","repo":"o/r","number":9,"title":"Add widgets","url":"https://github.com/o/r/pull/9","author":"sam","review":"none","checks":"none","conflict":false,"localPath":"","updatedAt":"2026-10-21T12:30:00Z"}]}}
```

`fixtures/newer_schema.json`:

```json
{"schema":2,"writtenAt":"2026-10-21T14:03:11Z"}
```

`fixtures/corrupt.json` — the text below, truncated on purpose, **no trailing newline**:

```json
{"schema":1,"writtenAt":"2026-10-21T14:0
```

`fixtures/hostile.json` — one project, issue and PR set carrying attacks (the oversized title is built in the test by replacing `HUGE` with 10 000 characters):

```json
{"schema":1,"writtenAt":"2026-10-21T14:03:11Z",
 "projects":{"status":"ok","failed":[],"items":[
   {"name":"flag","path":"--remote=evil","branch":"main","dirty":false,"pinned":false,"lastOpened":"2026-10-21T13:00:00Z"},
   {"name":"rel","path":"..\\..\\x","branch":"main","dirty":false,"pinned":false,"lastOpened":"2026-10-21T13:00:00Z"},
   {"name":"good","path":"C:\\work\\good","branch":"main","dirty":false,"pinned":false,"lastOpened":"2026-10-21T13:00:00Z"}]},
 "issues":{"status":"ok","failed":[],"items":[
   {"provider":"github","repo":"o/r","number":1,"title":"${$host.widgetSize} {{x}} <b>hi</b>","url":"file:///C:/Windows/System32/calc.exe","state":"open","labels":[],"assignee":"x","attention":"assigned","localPath":"-n","updatedAt":"2026-10-21T12:00:00Z"},
   {"provider":"github","repo":"o/r","number":2,"title":"look-alike","url":"https://github.com.evil.com/o/r/issues/2","state":"open","labels":[],"assignee":"x","attention":"assigned","localPath":"","updatedAt":"2026-10-21T12:00:00Z"},
   {"provider":"github","repo":"o/r","number":3,"title":"userinfo","url":"https://github.com@evil.com/","state":"open","labels":[],"assignee":"x","attention":"assigned","localPath":"","updatedAt":"2026-10-21T12:00:00Z"},
   {"provider":"github","repo":"o/r","number":4,"title":"javascript","url":"javascript:alert(1)","state":"open","labels":[],"assignee":"x","attention":"assigned","localPath":"","updatedAt":"2026-10-21T12:00:00Z"}]},
 "prs":{"status":"ok","failed":[],"items":[
   {"provider":"github","repo":"o/r","number":5,"title":"HUGE","url":"https://github.com/o/r/pull/5","author":"a","review":"none","checks":"none","conflict":false,"localPath":"","updatedAt":"2026-10-21T12:00:00Z"}]}}
```

`shell-ext/widgets/check.h`:

```cpp
#pragma once
// A framework-free check macro for the widget tests. Each *_test.cc has its own main() and is one CTest test.
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include <winrt/base.h>

inline int g_failures = 0;

#define CHECK(c)                                                        \
  do {                                                                  \
    if (!(c)) {                                                         \
      ++g_failures;                                                     \
      std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " << #c << "\n"; \
    }                                                                   \
  } while (0)

// Fixtures are UTF-8 files next to the sources (FIXTURE_DIR is set by CMake).
inline std::wstring ReadFixture(char const* name) {
  std::ifstream f(std::string(FIXTURE_DIR) + "/" + name, std::ios::binary);
  std::stringstream ss;
  ss << f.rdbuf();
  return std::wstring(winrt::to_hstring(ss.str()).c_str());
}

inline int Finish(char const* what) {
  if (g_failures) {
    std::cerr << g_failures << " check(s) failed in " << what << "\n";
    return 1;
  }
  std::cout << what << ": all checks passed\n";
  return 0;
}
```

`shell-ext/widgets/snapshot_test.cc`:

```cpp
#include "check.h"
#include "snapshot.h"

using namespace null_widgets;

static void TestParse() {
  auto ok = ParseSnapshot(ReadFixture("ok.json"));
  CHECK(ok.state == Load::Ok);
  CHECK(ok.snapshot.projects.size() == 2 && ok.snapshot.projects[0].name == L"null-ide" && ok.snapshot.projects[0].dirty);
  CHECK(ok.snapshot.projects[0].pinned && ok.snapshot.projects[0].path == L"D:\\Coding\\Apps\\null-ide");
  CHECK(ok.snapshot.issues.size() == 1 && ok.snapshot.issues[0].number == 7 && ok.snapshot.issues[0].labels.size() == 1);
  CHECK(ok.snapshot.issues[0].localPath == L"D:\\Coding\\Apps\\null-ide");
  CHECK(ok.snapshot.prs[0].conflict && ok.snapshot.prs[0].review == L"requested" && ok.snapshot.prs[0].checks == L"failing");

  auto partial = ParseSnapshot(ReadFixture("partial.json"));
  CHECK(partial.state == Load::Ok && partial.snapshot.issuesSection.status == L"ok" && partial.snapshot.issuesSection.failed.size() == 2);
  CHECK(partial.snapshot.issuesSection.failed[1].repo == L"o/two" && partial.snapshot.issuesSection.failed[1].reason == L"offline");

  auto out = ParseSnapshot(ReadFixture("signed_out.json"));
  CHECK(out.snapshot.issuesSection.status == L"signed_out" && out.snapshot.issues.size() == 1);
  CHECK(out.snapshot.prsSection.status == L"signed_out" && out.snapshot.projectsSection.status == L"ok");

  CHECK(ParseSnapshot(ReadFixture("newer_schema.json")).state == Load::NewerSchema);
  CHECK(ParseSnapshot(ReadFixture("corrupt.json")).state == Load::Corrupt);
  CHECK(ParseSnapshot(L"").state == Load::Corrupt);
  CHECK(ParseSnapshot(L"[1,2,3]").state == Load::Corrupt);
  CHECK(ParseSnapshot(L"{\"writtenAt\":\"x\"}").state == Load::Corrupt);  // no schema
  CHECK(LoadSnapshotFile(L"C:\\definitely\\not\\here.json").state == Load::Missing);

  // Wrong types degrade; they never throw.
  auto odd = ParseSnapshot(L"{\"schema\":1,\"writtenAt\":5,\"projects\":\"x\",\"issues\":{\"items\":[1,\"a\",{\"number\":\"n\"}]}}");
  CHECK(odd.state == Load::Ok && odd.snapshot.projects.empty() && odd.snapshot.issues.size() == 1 && odd.snapshot.issues[0].number == 0);

  // A section is capped at 200 items however large the file is.
  std::wstring many = L"{\"schema\":1,\"issues\":{\"items\":[";
  for (int i = 0; i < 500; ++i) many += (i ? L",{}" : L"{}");
  many += L"]}}";
  CHECK(ParseSnapshot(many).snapshot.issues.size() == 200);
}

static void TestHostile() {
  auto h = ParseSnapshot(ReadFixture("hostile.json"));
  CHECK(h.state == Load::Ok);
  // A flag-looking path and a relative path are emptied; the absolute one survives.
  CHECK(h.snapshot.projects.size() == 3);
  CHECK(h.snapshot.projects[0].path.empty() && h.snapshot.projects[1].path.empty() && h.snapshot.projects[2].path == L"C:\\work\\good");
  // Only https://github.com/... survives as a URL; localPath "-n" is dropped.
  CHECK(h.snapshot.issues.size() == 4);
  for (auto const& i : h.snapshot.issues) CHECK(i.url.empty());
  CHECK(h.snapshot.issues[0].localPath.empty());
  // Text is kept as it is (it is only ever drawn as plain text), but capped.
  CHECK(h.snapshot.issues[0].title == L"${$host.widgetSize} {{x}} <b>hi</b>");
  std::wstring big = ReadFixture("hostile.json");
  big.replace(big.find(L"HUGE"), 4, std::wstring(10000, L'A'));
  auto capped = ParseSnapshot(big);
  CHECK(capped.snapshot.prs[0].title.size() == 121);  // 120 + the ellipsis
  CHECK(capped.snapshot.prs[0].url == L"https://github.com/o/r/pull/5");

  CHECK(IsSafeGithubUrl(L"https://github.com/o/r/issues/7"));
  CHECK(!IsSafeGithubUrl(L"http://github.com/o/r"));
  CHECK(!IsSafeGithubUrl(L"https://github.com"));
  CHECK(!IsSafeGithubUrl(L"https://github.com/"));
  CHECK(!IsSafeGithubUrl(L"https://GitHub.com.evil.com/x"));
  CHECK(!IsSafeGithubUrl(L"https://github.com@evil.com/x"));
  CHECK(!IsSafeGithubUrl(L"https://github.com/ x"));
  CHECK(!IsSafeGithubUrl(L"https://github.com/\"x"));
  CHECK(!IsSafeGithubUrl(L"https://github.com/o\\r"));
  CHECK(IsAbsoluteLocalPath(L"C:\\a b\\c"));
  CHECK(!IsAbsoluteLocalPath(L"--flag"));
  CHECK(!IsAbsoluteLocalPath(L"-n"));
  CHECK(!IsAbsoluteLocalPath(L"C:rel"));
  CHECK(!IsAbsoluteLocalPath(L"\\\\?\\C:\\x"));
  CHECK(!IsAbsoluteLocalPath(L"\\\\server\\share"));
  CHECK(!IsAbsoluteLocalPath(L"C:\\a|b"));
  CHECK(CapText(L"a\nb", 10) == L"a b");
  CHECK(CapText(L"abcdef", 3) == L"abc\u2026");
  long long t = 0;
  CHECK(ParseIsoUtc(L"2026-10-21T14:03:11Z", &t) && t == 1792591391);
  CHECK(!ParseIsoUtc(L"yesterday", &t));
}

static void TestKeepLastGood() {
  auto good = ParseSnapshot(ReadFixture("ok.json"));
  Loaded corrupt;
  corrupt.state = Load::Corrupt;
  Loaded missing;  // Missing by default
  CHECK(KeepLastGood(good, corrupt).state == Load::Ok);                // torn write: keep what is drawn
  CHECK(KeepLastGood(good, missing).state == Load::Missing);           // file deleted (widgets turned off): fall back
  CHECK(KeepLastGood(missing, corrupt).state == Load::Corrupt);        // nothing to keep
  CHECK(KeepLastGood(good, ParseSnapshot(ReadFixture("newer_schema.json"))).state == Load::NewerSchema);
}

int main() {
  winrt::init_apartment();
  TestParse();
  TestHostile();
  TestKeepLastGood();
  return Finish("snapshot_test");
}
```

`shell-ext/widgets/CMakeLists.txt` (later tasks widen the two `set` lines and append the exe target):

```cmake
# null_widgets.exe: the desktop widgets host (a plain Win32 exe: no package identity, no signing). Design: docs/specs/native-windows-widgets-design.md.
# Parsing, layout, placement and actions live in null_widget_core with no window or Direct2D calls, so CTest covers them.
# JSON comes from Windows.Data.Json (the C++/WinRT headers ship with the Windows SDK; nothing is downloaded).

set(CORE_SOURCES snapshot.cc)
set(TESTS snapshot_test)

add_library(null_widget_core STATIC ${CORE_SOURCES})
target_include_directories(null_widget_core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")
target_compile_definitions(null_widget_core PUBLIC WIN32_LEAN_AND_MEAN UNICODE _UNICODE NOMINMAX)
target_compile_features(null_widget_core PUBLIC cxx_std_20)
if(CMAKE_CXX_COMPILER_FRONTEND_VARIANT STREQUAL "MSVC")
  target_compile_options(null_widget_core PUBLIC /Zc:__cplusplus /EHsc /W4 /permissive- /utf-8 /Qspectre /guard:cf)
endif()
target_link_libraries(null_widget_core PUBLIC windowsapp shell32)

foreach(t ${TESTS})
  add_executable(${t} ${t}.cc)
  target_link_libraries(${t} PRIVATE null_widget_core)
  target_compile_definitions(${t} PRIVATE FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/fixtures")
  add_test(NAME ${t} COMMAND ${t})
endforeach()
```

- [ ] **Step 2: Run to verify failure**

```powershell
cmake -S shell-ext -B shell-ext-build -G "Visual Studio 17 2022" -A x64
```

Expected: FAIL — `Cannot find source file: snapshot.cc`. (`shell-ext/deps/wil` must exist; it is fetched by CI and already present on a developer machine that built the shell extension.)

- [ ] **Step 3: Write the implementation**

`shell-ext/widgets/snapshot.h`:

```cpp
#pragma once
#include <string>
#include <vector>

namespace null_widgets {

constexpr int kSchema = 1;

enum class Load { Ok, Missing, Corrupt, NewerSchema };

struct Failed { std::wstring repo, reason; };
struct Section { std::wstring status = L"ok"; std::vector<Failed> failed; };
struct Project { std::wstring name, path, branch, lastOpened; bool dirty = false, pinned = false; };
struct Issue { std::wstring repo, title, url, attention, localPath, assignee; std::vector<std::wstring> labels; long number = 0; };
struct Pr { std::wstring repo, title, url, author, review, checks, localPath; bool conflict = false; long number = 0; };

struct Snapshot {
  std::wstring writtenAt;  // ISO-8601 UTC as written
  Section projectsSection, issuesSection, prsSection;
  std::vector<Project> projects;
  std::vector<Issue> issues;
  std::vector<Pr> prs;
};

struct Loaded {
  Load state = Load::Missing;
  Snapshot snapshot;
};

// Never throws. Everything in the result is already validated: unsafe URLs and paths are emptied, text is capped.
Loaded ParseSnapshot(std::wstring const& json);
// Missing when the file is absent, Corrupt when it is over 2 MB, else ParseSnapshot.
Loaded LoadSnapshotFile(std::wstring const& path);
// A corrupt file keeps the last good render; every other outcome (including a deleted file) replaces it.
Loaded KeepLastGood(Loaded const& previous, Loaded fresh);

bool IsSafeGithubUrl(std::wstring const& url);
bool IsAbsoluteLocalPath(std::wstring const& path);
// Control characters become spaces; longer text is cut and ends in an ellipsis.
std::wstring CapText(std::wstring const& s, size_t maxLen);
// "2026-10-21T14:03:11Z" -> epoch seconds.
bool ParseIsoUtc(std::wstring const& iso, long long* epochSeconds);

}  // namespace null_widgets
```

`shell-ext/widgets/snapshot.cc`:

```cpp
#include "snapshot.h"

#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <sstream>

#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/base.h>

using namespace winrt::Windows::Data::Json;

namespace null_widgets {

std::wstring CapText(std::wstring const& s, size_t maxLen) {
  std::wstring out = s;
  for (auto& c : out) {
    if (c < 0x20 || c == 0x7f) c = L' ';
  }
  if (out.size() > maxLen) {
    out.resize(maxLen);
    out.push_back(L'\u2026');
  }
  return out;
}

bool IsSafeGithubUrl(std::wstring const& u) {
  static constexpr wchar_t kPrefix[] = L"https://github.com/";
  constexpr size_t kPrefixLen = 19;
  if (u.size() <= kPrefixLen || u.size() > 300 || u.compare(0, kPrefixLen, kPrefix) != 0) return false;
  for (size_t i = kPrefixLen; i < u.size(); ++i) {
    wchar_t c = u[i];
    if (c <= 0x20 || c >= 0x7f || c == L'"' || c == L'\\' || c == L'<' || c == L'>' || c == L'`') return false;
  }
  return true;
}

bool IsAbsoluteLocalPath(std::wstring const& p) {
  if (p.size() < 3 || p.size() > 260) return false;
  bool letter = (p[0] >= L'A' && p[0] <= L'Z') || (p[0] >= L'a' && p[0] <= L'z');
  if (!letter || p[1] != L':' || p[2] != L'\\') return false;
  for (wchar_t c : p) {
    if (c < 0x20 || c == L'<' || c == L'>' || c == L'"' || c == L'|' || c == L'?' || c == L'*') return false;
  }
  return true;
}

bool ParseIsoUtc(std::wstring const& iso, long long* out) {
  int y, mo, d, h, mi, s;
  if (swscanf_s(iso.c_str(), L"%4d-%2d-%2dT%2d:%2d:%2dZ", &y, &mo, &d, &h, &mi, &s) != 6) return false;
  std::tm tm{};
  tm.tm_year = y - 1900;
  tm.tm_mon = mo - 1;
  tm.tm_mday = d;
  tm.tm_hour = h;
  tm.tm_min = mi;
  tm.tm_sec = s;
  auto t = _mkgmtime64(&tm);
  if (t < 0) return false;
  *out = t;
  return true;
}

namespace {

constexpr size_t kMaxItems = 200;

bool Has(JsonObject const& o, wchar_t const* k, JsonValueType t) {
  return o.HasKey(k) && o.GetNamedValue(k).ValueType() == t;
}
std::wstring Str(JsonObject const& o, wchar_t const* k, size_t cap) {
  return Has(o, k, JsonValueType::String) ? CapText(o.GetNamedString(k).c_str(), cap) : L"";
}
bool Bool(JsonObject const& o, wchar_t const* k) { return Has(o, k, JsonValueType::Boolean) && o.GetNamedBoolean(k); }
long Num(JsonObject const& o, wchar_t const* k) {
  return Has(o, k, JsonValueType::Number) ? static_cast<long>(o.GetNamedNumber(k)) : 0;
}
std::wstring Url(JsonObject const& o) {
  auto u = Str(o, L"url", 400);
  return IsSafeGithubUrl(u) ? u : L"";
}
std::wstring Path(JsonObject const& o, wchar_t const* k) {
  auto p = Str(o, k, 300);
  return IsAbsoluteLocalPath(p) ? p : L"";
}

// Reads {status, failed[], items[]} and calls add() for each object item. Anything of the wrong shape is skipped.
template <class F>
Section ReadSection(JsonObject const& root, wchar_t const* key, F add) {
  Section s;
  if (!Has(root, key, JsonValueType::Object)) return s;
  auto sec = root.GetNamedObject(key);
  auto status = Str(sec, L"status", 20);
  if (status == L"signed_out" || status == L"offline" || status == L"error") s.status = status;
  if (Has(sec, L"failed", JsonValueType::Array)) {
    for (auto const& f : sec.GetNamedArray(L"failed")) {
      if (f.ValueType() != JsonValueType::Object) continue;
      auto fo = f.GetObject();
      s.failed.push_back({Str(fo, L"repo", 100), Str(fo, L"reason", 20)});
      if (s.failed.size() >= 50) break;
    }
  }
  if (Has(sec, L"items", JsonValueType::Array)) {
    size_t n = 0;
    for (auto const& it : sec.GetNamedArray(L"items")) {
      if (it.ValueType() != JsonValueType::Object) continue;
      add(it.GetObject());
      if (++n >= kMaxItems) break;
    }
  }
  return s;
}

}  // namespace

Loaded ParseSnapshot(std::wstring const& json) {
  Loaded r;
  try {
    JsonObject root{nullptr};
    if (!JsonObject::TryParse(json, root) || !Has(root, L"schema", JsonValueType::Number)) {
      r.state = Load::Corrupt;
      return r;
    }
    if (static_cast<int>(root.GetNamedNumber(L"schema")) > kSchema) {
      r.state = Load::NewerSchema;
      return r;
    }
    auto& s = r.snapshot;
    s.writtenAt = Str(root, L"writtenAt", 30);
    s.projectsSection = ReadSection(root, L"projects", [&](JsonObject const& o) {
      s.projects.push_back({Str(o, L"name", 60), Path(o, L"path"), Str(o, L"branch", 60), Str(o, L"lastOpened", 30),
                            Bool(o, L"dirty"), Bool(o, L"pinned")});
    });
    s.issuesSection = ReadSection(root, L"issues", [&](JsonObject const& o) {
      Issue i;
      i.repo = Str(o, L"repo", 100);
      i.title = Str(o, L"title", 120);
      i.url = Url(o);
      i.attention = Str(o, L"attention", 20);
      i.localPath = Path(o, L"localPath");
      i.assignee = Str(o, L"assignee", 40);
      i.number = Num(o, L"number");
      if (Has(o, L"labels", JsonValueType::Array)) {
        for (auto const& l : o.GetNamedArray(L"labels")) {
          if (l.ValueType() == JsonValueType::String && i.labels.size() < 5) i.labels.push_back(CapText(l.GetString().c_str(), 30));
        }
      }
      s.issues.push_back(std::move(i));
    });
    s.prsSection = ReadSection(root, L"prs", [&](JsonObject const& o) {
      Pr p;
      p.repo = Str(o, L"repo", 100);
      p.title = Str(o, L"title", 120);
      p.url = Url(o);
      p.author = Str(o, L"author", 40);
      p.review = Str(o, L"review", 20);
      p.checks = Str(o, L"checks", 20);
      p.conflict = Bool(o, L"conflict");
      p.localPath = Path(o, L"localPath");
      p.number = Num(o, L"number");
      s.prs.push_back(std::move(p));
    });
    r.state = Load::Ok;
  } catch (...) {
    r = Loaded{};
    r.state = Load::Corrupt;
  }
  return r;
}

Loaded LoadSnapshotFile(std::wstring const& path) {
  std::ifstream f(std::filesystem::path(path), std::ios::binary);
  Loaded l;
  if (!f) return l;  // Missing
  std::stringstream ss;
  ss << f.rdbuf();
  auto text = ss.str();
  if (text.starts_with("\xEF\xBB\xBF")) text.erase(0, 3);  // a BOM from an editor or PowerShell
  if (text.size() > 2 * 1024 * 1024) {
    l.state = Load::Corrupt;
    return l;
  }
  return ParseSnapshot(std::wstring(winrt::to_hstring(text).c_str()));
}

Loaded KeepLastGood(Loaded const& previous, Loaded fresh) {
  if (fresh.state == Load::Corrupt && previous.state == Load::Ok) return previous;
  return fresh;
}

}  // namespace null_widgets
```

- [ ] **Step 4: Run to verify it passes**

```powershell
cmake -S shell-ext -B shell-ext-build -G "Visual Studio 17 2022" -A x64
cmake --build shell-ext-build --config Release --target snapshot_test
ctest --test-dir shell-ext-build -C Release --output-on-failure -R snapshot_test
```

Expected: no compiler warnings; `snapshot_test: all checks passed`; CTest `100% tests passed`. The `.gitignore` already ignores `shell-ext-build/` and `shell-ext/deps/`.

- [ ] **Step 5: Commit**

```bash
git add shell-ext/CMakeLists.txt shell-ext/widgets
git commit -m "feat(widgets): snapshot parser with untrusted-input validation (#141)"
```

---

### Task 3: Row layout (pure view model)

**Files:**
- Create: `shell-ext/widgets/layout.h`, `shell-ext/widgets/layout.cc`, `shell-ext/widgets/layout_test.cc`
- Modify: `shell-ext/widgets/CMakeLists.txt` (two `set` lines)

**Interfaces:**
- Consumes: `Loaded`, `ParseSnapshot`, `ParseIsoUtc` (Task 2).
- Produces (`layout.h`): `enum class Kind { Projects, Issues, Prs }` (`kKindCount = 3`); `Tone`, `Span`, `ActionKind { None, OpenUrl, OpenProject, OpenProjectNewWindow }`, `Action { kind, target, label }`, `Row { title, detail, click, menu, dimmed }`, `View { title, rows, message, footer, stale }`; `constexpr long long kStaleAfterSeconds = 6*3600`; metrics `kHeaderDip=36, kRowDip=40, kFooterDip=24, kPadDip=8`; `SizeDip DefaultSize(Kind)`, `TitleOf(Kind)`, `KeyOf(Kind)`, `int RowsThatFit(int heightDip)`, `std::wstring FormatAge(long long)`, `View BuildView(Loaded const&, Kind, int maxRows, long long nowEpoch)`.

- [ ] **Step 1: Write the failing test**

`shell-ext/widgets/layout_test.cc`:

```cpp
#include "check.h"
#include "layout.h"

using namespace null_widgets;

constexpr long long kWritten = 1792591391;  // 2026-10-21T14:03:11Z, the writtenAt of the fixtures

static std::wstring Text(std::vector<Span> const& spans) {
  std::wstring s;
  for (auto const& p : spans) s += p.text;
  return s;
}

static void TestRows() {
  auto ok = ParseSnapshot(ReadFixture("ok.json"));
  long long now = kWritten + 300;

  View projects = BuildView(ok, Kind::Projects, 8, now);
  CHECK(projects.title == L"Projects" && projects.rows.size() == 2 && projects.message.empty());
  CHECK(Text(projects.rows[0].title) == L"\u2605 null-ide \u25cf");
  CHECK(Text(projects.rows[0].detail) == L"main \u00b7 1 h ago");
  CHECK(projects.rows[0].click.kind == ActionKind::OpenProject && projects.rows[0].click.target == L"D:\\Coding\\Apps\\null-ide");
  CHECK(projects.rows[0].menu.size() == 2 && projects.rows[0].menu[1].kind == ActionKind::OpenProjectNewWindow);
  CHECK(Text(projects.rows[1].title) == L"site");

  View issues = BuildView(ok, Kind::Issues, 10, now);
  CHECK(Text(issues.rows[0].title) == L"#7 Crash on save");
  CHECK(Text(issues.rows[0].detail) == L"assigned \u00b7 o/r \u00b7 bug");
  CHECK(issues.rows[0].click.kind == ActionKind::OpenUrl && issues.rows[0].click.target == L"https://github.com/o/r/issues/7");
  CHECK(issues.rows[0].menu.size() == 2 && issues.rows[0].menu[1].kind == ActionKind::OpenProject);  // it has a local checkout

  View prs = BuildView(ok, Kind::Prs, 10, now);
  CHECK(Text(prs.rows[0].title) == L"#9 Add widgets");
  CHECK(Text(prs.rows[0].detail) == L"review requested \u00b7 checks failing \u00b7 conflict \u00b7 o/r \u00b7 sam");
  CHECK(prs.rows[0].menu.size() == 1);  // no local checkout: only "Open in browser"

  CHECK(BuildView(ok, Kind::Projects, 1, now).rows.size() == 1);  // the renderer trims to what fits
  CHECK(RowsThatFit(240) == 4 && RowsThatFit(320) == 6 && RowsThatFit(10) == 1);
}

static void TestFooterAndStates() {
  auto ok = ParseSnapshot(ReadFixture("ok.json"));
  View fresh = BuildView(ok, Kind::Issues, 10, kWritten + 300);
  CHECK(fresh.footer == L"updated 5 min ago" && !fresh.stale);
  View old = BuildView(ok, Kind::Issues, 10, kWritten + kStaleAfterSeconds);
  CHECK(old.footer == L"updated 6 h ago" && old.stale);
  CHECK(!BuildView(ok, Kind::Issues, 10, kWritten + kStaleAfterSeconds - 1).stale);

  auto partial = ParseSnapshot(ReadFixture("partial.json"));
  View p = BuildView(partial, Kind::Issues, 10, kWritten + 60);
  CHECK(p.footer == L"2 repos not updated \u00b7 updated 1 min ago" && !p.rows[0].dimmed);
  CHECK(BuildView(partial, Kind::Prs, 10, kWritten).message == L"No pull requests need your attention");

  auto out = ParseSnapshot(ReadFixture("signed_out.json"));
  View s = BuildView(out, Kind::Issues, 10, kWritten + 60);
  CHECK(s.rows.size() == 1 && s.rows[0].dimmed && s.footer == L"Signed out of GitHub \u00b7 updated 1 min ago");
  CHECK(BuildView(out, Kind::Projects, 10, kWritten).message == L"No recent projects");  // projects are independent of GitHub

  Loaded missing;
  CHECK(BuildView(missing, Kind::Prs, 10, kWritten).message == L"Open Null IDE to set up widgets");
  Loaded corrupt;
  corrupt.state = Load::Corrupt;
  CHECK(BuildView(corrupt, Kind::Prs, 10, kWritten).message == L"Open Null IDE to set up widgets");
  CHECK(BuildView(ParseSnapshot(ReadFixture("newer_schema.json")), Kind::Prs, 10, kWritten).message == L"Update Null IDE");

  CHECK(FormatAge(5) == L"just now" && FormatAge(90) == L"1 min ago" && FormatAge(7200) == L"2 h ago" && FormatAge(200000) == L"2 d ago");
}

static void TestHostileRowsHaveNoActions() {
  auto h = ParseSnapshot(ReadFixture("hostile.json"));
  View issues = BuildView(h, Kind::Issues, 10, kWritten);
  CHECK(issues.rows.size() == 4);
  for (auto const& r : issues.rows) CHECK(r.click.kind == ActionKind::None && r.menu.empty());
  View projects = BuildView(h, Kind::Projects, 10, kWritten);
  CHECK(projects.rows[0].click.kind == ActionKind::None && projects.rows[1].click.kind == ActionKind::None);
  CHECK(projects.rows[2].click.kind == ActionKind::OpenProject);
  // Markup-looking text stays text.
  CHECK(Text(issues.rows[0].title) == L"#1 ${$host.widgetSize} {{x}} <b>hi</b>");
}

int main() {
  winrt::init_apartment();
  TestRows();
  TestFooterAndStates();
  TestHostileRowsHaveNoActions();
  return Finish("layout_test");
}
```

In `shell-ext/widgets/CMakeLists.txt` change the two lines to:

```cmake
set(CORE_SOURCES snapshot.cc layout.cc)
set(TESTS snapshot_test layout_test)
```

- [ ] **Step 2: Run to verify failure**

Run: `cmake -S shell-ext -B shell-ext-build -G "Visual Studio 17 2022" -A x64`
Expected: FAIL — `Cannot find source file: layout.cc`.

- [ ] **Step 3: Write the implementation**

`shell-ext/widgets/layout.h`:

```cpp
#pragma once
#include <string>
#include <vector>

#include "snapshot.h"

namespace null_widgets {

enum class Kind { Projects = 0, Issues = 1, Prs = 2 };
constexpr int kKindCount = 3;

enum class Tone { Normal, Muted, Accent, Good, Warn, Bad };
struct Span { std::wstring text; Tone tone = Tone::Normal; };

enum class ActionKind { None, OpenUrl, OpenProject, OpenProjectNewWindow };
struct Action {
  ActionKind kind = ActionKind::None;
  std::wstring target;  // URL or absolute project path, already validated by ParseSnapshot
  std::wstring label;   // menu text
};

struct Row {
  std::vector<Span> title, detail;
  Action click;              // left click; None when the row has nothing to open
  std::vector<Action> menu;  // right-click items for this row
  bool dimmed = false;
};

struct View {
  std::wstring title;
  std::vector<Row> rows;
  std::wstring message;  // drawn instead of the rows when non-empty
  std::wstring footer;
  bool stale = false;    // footer muted
};

// The footer is muted once the snapshot is older than this.
constexpr long long kStaleAfterSeconds = 6 * 3600;

// Metrics in DIPs; the renderer and the hit test share them.
constexpr int kHeaderDip = 36, kRowDip = 40, kFooterDip = 24, kPadDip = 8;

struct SizeDip { int w, h; };
SizeDip DefaultSize(Kind kind);
wchar_t const* TitleOf(Kind kind);
wchar_t const* KeyOf(Kind kind);  // "projects" | "issues" | "prs"
int RowsThatFit(int heightDip);   // at least 1

std::wstring FormatAge(long long seconds);
View BuildView(Loaded const& loaded, Kind kind, int maxRows, long long nowEpoch);

}  // namespace null_widgets
```

`shell-ext/widgets/layout.cc`:

```cpp
#include "layout.h"

#include <algorithm>

namespace null_widgets {

namespace {

constexpr int kMaxRows[kKindCount] = {8, 10, 10};  // the same constants as widgetTypes.ts

Span S(std::wstring text, Tone tone = Tone::Normal) { return Span{std::move(text), tone}; }

// Parts separated by " \u00b7 ".
std::vector<Span> Joined(std::vector<Span> parts) {
  std::vector<Span> out;
  for (auto& p : parts) {
    if (p.text.empty()) continue;
    if (!out.empty()) out.push_back(S(L" \u00b7 ", Tone::Muted));
    out.push_back(std::move(p));
  }
  return out;
}

std::wstring Num(long n) { return L"#" + std::to_wstring(n) + L" "; }

std::wstring ReasonText(std::wstring const& status) {
  if (status == L"signed_out") return L"Signed out of GitHub";
  if (status == L"offline") return L"Offline";
  return L"Could not update";
}

std::wstring Labels(std::vector<std::wstring> const& labels) {
  std::wstring out;
  for (auto const& l : labels) out += (out.empty() ? L"" : L", ") + l;
  return out;
}

Row ProjectRow(Project const& p, long long now) {
  Row r;
  if (p.pinned) r.title.push_back(S(L"\u2605 ", Tone::Accent));
  r.title.push_back(S(p.name));
  if (p.dirty) r.title.push_back(S(L" \u25cf", Tone::Warn));
  long long opened = 0;
  std::wstring when = ParseIsoUtc(p.lastOpened, &opened) ? FormatAge(now - opened) : L"";
  r.detail = Joined({S(p.branch, Tone::Muted), S(when, Tone::Muted)});
  if (!p.path.empty()) {
    r.click = {ActionKind::OpenProject, p.path, L"Open"};
    r.menu = {r.click, {ActionKind::OpenProjectNewWindow, p.path, L"Open in new window"}};
  }
  return r;
}

Row IssueRow(Issue const& i) {
  Row r;
  r.title = {S(Num(i.number), Tone::Muted), S(i.title)};
  r.detail = Joined({S(i.attention == L"assigned" ? L"assigned" : L"mentioned", i.attention == L"assigned" ? Tone::Accent : Tone::Muted),
                     S(i.repo, Tone::Muted), S(Labels(i.labels), Tone::Muted)});
  if (!i.url.empty()) {
    r.click = {ActionKind::OpenUrl, i.url, L"Open in browser"};
    r.menu.push_back(r.click);
  }
  if (!i.localPath.empty()) r.menu.push_back({ActionKind::OpenProject, i.localPath, L"Open project"});
  return r;
}

Row PrRow(Pr const& p) {
  Row r;
  r.title = {S(Num(p.number), Tone::Muted), S(p.title)};
  Span review = p.review == L"requested" ? S(L"review requested", Tone::Accent)
              : p.review == L"approved"  ? S(L"approved", Tone::Good)
              : p.review == L"changes"   ? S(L"changes requested", Tone::Bad)
                                         : S(L"");
  Span checks = p.checks == L"failing" ? S(L"checks failing", Tone::Bad)
              : p.checks == L"pending" ? S(L"checks pending", Tone::Warn)
              : p.checks == L"passing" ? S(L"checks passing", Tone::Good)
                                       : S(L"");
  r.detail = Joined({review, checks, S(p.conflict ? L"conflict" : L"", Tone::Bad), S(p.repo, Tone::Muted), S(p.author, Tone::Muted)});
  if (!p.url.empty()) {
    r.click = {ActionKind::OpenUrl, p.url, L"Open in browser"};
    r.menu.push_back(r.click);
  }
  if (!p.localPath.empty()) r.menu.push_back({ActionKind::OpenProject, p.localPath, L"Open project"});
  return r;
}

template <class T, class F>
void FillRows(View& v, std::vector<T> const& items, int maxRows, bool dimmed, F make) {
  for (size_t i = 0; i < items.size() && static_cast<int>(i) < maxRows; ++i) {
    Row r = make(items[i]);
    r.dimmed = dimmed;
    v.rows.push_back(std::move(r));
  }
}

}  // namespace

SizeDip DefaultSize(Kind kind) {
  return kind == Kind::Projects ? SizeDip{320, 240} : SizeDip{360, 320};
}

wchar_t const* TitleOf(Kind kind) {
  return kind == Kind::Projects ? L"Projects" : kind == Kind::Issues ? L"Issues" : L"Pull Requests";
}

wchar_t const* KeyOf(Kind kind) {
  return kind == Kind::Projects ? L"projects" : kind == Kind::Issues ? L"issues" : L"prs";
}

int RowsThatFit(int heightDip) {
  return std::max(1, (heightDip - kHeaderDip - kFooterDip - kPadDip) / kRowDip);
}

std::wstring FormatAge(long long s) {
  if (s < 60) return L"just now";
  if (s < 3600) return std::to_wstring(s / 60) + L" min ago";
  if (s < 86400) return std::to_wstring(s / 3600) + L" h ago";
  return std::to_wstring(s / 86400) + L" d ago";
}

View BuildView(Loaded const& loaded, Kind kind, int maxRows, long long now) {
  View v;
  v.title = TitleOf(kind);
  if (loaded.state == Load::NewerSchema) {
    v.message = L"Update Null IDE";
    return v;
  }
  if (loaded.state != Load::Ok) {
    v.message = L"Open Null IDE to set up widgets";
    return v;
  }
  Snapshot const& s = loaded.snapshot;
  maxRows = std::min(maxRows, kMaxRows[static_cast<int>(kind)]);
  Section const& sec = kind == Kind::Projects ? s.projectsSection : kind == Kind::Issues ? s.issuesSection : s.prsSection;
  bool dimmed = sec.status != L"ok";
  if (kind == Kind::Projects) FillRows(v, s.projects, maxRows, dimmed, [&](Project const& p) { return ProjectRow(p, now); });
  if (kind == Kind::Issues) FillRows(v, s.issues, maxRows, dimmed, IssueRow);
  if (kind == Kind::Prs) FillRows(v, s.prs, maxRows, dimmed, PrRow);

  if (v.rows.empty()) {
    v.message = dimmed ? ReasonText(sec.status)
              : kind == Kind::Projects ? L"No recent projects"
              : kind == Kind::Issues   ? L"No issues need your attention"
                                       : L"No pull requests need your attention";
  }

  std::vector<Span> footer;
  if (dimmed) {
    footer.push_back(S(ReasonText(sec.status)));
  } else if (!sec.failed.empty()) {
    size_t n = sec.failed.size();
    footer.push_back(S(std::to_wstring(n) + (n == 1 ? L" repo not updated" : L" repos not updated")));
  }
  long long written = 0;
  if (ParseIsoUtc(s.writtenAt, &written)) {
    long long age = std::max(0LL, now - written);
    footer.push_back(S(L"updated " + FormatAge(age)));
    v.stale = age >= kStaleAfterSeconds;
  }
  for (auto const& sp : Joined(std::move(footer))) v.footer += sp.text;
  return v;
}

}  // namespace null_widgets
```

- [ ] **Step 4: Run to verify it passes**

```powershell
cmake -S shell-ext -B shell-ext-build -G "Visual Studio 17 2022" -A x64
cmake --build shell-ext-build --config Release --target snapshot_test layout_test
ctest --test-dir shell-ext-build -C Release --output-on-failure -R "snapshot_test|layout_test"
```

Expected: no warnings; both tests pass.

- [ ] **Step 5: Commit**

```bash
git add shell-ext/widgets
git commit -m "feat(widgets): row layout, footer and empty states (#141)"
```

---

### Task 4: Placement — layout file, clamp to monitors, edge snap

**Files:**
- Create: `shell-ext/widgets/placement.h`, `shell-ext/widgets/placement.cc`, `shell-ext/widgets/placement_test.cc`
- Modify: `shell-ext/widgets/CMakeLists.txt` (two `set` lines)

**Interfaces:**
- Consumes: `Kind`, `kKindCount`, `KeyOf`, `DefaultSize` (Task 3).
- Produces (`placement.h`): `struct Box { int left, top, right, bottom; int w() const; int h() const; }`; `struct Placement { bool visible, placed; int x, y, w, h; }` (x/y virtual-screen pixels, w/h DIP, 0 = default); `struct LayoutFile { bool locked; Placement widget[kKindCount]; }`; `LayoutFile ParseLayout(std::wstring const&)` (never throws); `std::wstring SerializeLayout(LayoutFile const&)`; `Box DefaultBox(Kind, Box primaryWork, double scale)`; `Box ClampToMonitors(Box, std::vector<Box> const& work)`; `Box SnapToEdges(Box, std::vector<Box> const& work, int threshold)`.

- [ ] **Step 1: Write the failing test**

`shell-ext/widgets/placement_test.cc` (covers a monitor that was unplugged, a rect bigger than its monitor, garbage and out-of-range values in the file):

```cpp
#include "check.h"
#include "placement.h"

using namespace null_widgets;

static bool Same(Box a, Box b) { return a.left == b.left && a.top == b.top && a.right == b.right && a.bottom == b.bottom; }

static void TestFile() {
  LayoutFile l;
  l.locked = true;
  l.widget[1] = {false, true, -300, 40, 400, 0};
  l.widget[2].placed = true;
  l.widget[2].x = 10;
  l.widget[2].y = 20;
  LayoutFile back = ParseLayout(SerializeLayout(l));
  CHECK(back.locked);
  CHECK(!back.widget[1].visible && back.widget[1].placed && back.widget[1].x == -300 && back.widget[1].y == 40);
  CHECK(back.widget[1].w == 400 && back.widget[1].h == 0);
  CHECK(back.widget[0].visible && !back.widget[0].placed);  // never saved: defaults
  CHECK(back.widget[2].placed && back.widget[2].x == 10 && back.widget[2].y == 20);

  // Garbage and hostile values never throw and never produce a nonsense size.
  CHECK(!ParseLayout(L"").locked && !ParseLayout(L"{nope").widget[0].placed && !ParseLayout(L"[]").widget[0].placed);
  LayoutFile odd = ParseLayout(L"{\"locked\":\"yes\",\"widgets\":{\"projects\":{\"x\":5,\"y\":\"7\",\"w\":99999,\"h\":-5,\"visible\":3},\"issues\":7}}");
  CHECK(!odd.locked && !odd.widget[0].placed && odd.widget[0].w == 0 && odd.widget[0].h == 0 && odd.widget[0].visible);
  CHECK(odd.widget[1].visible && !odd.widget[1].placed);
}

static void TestBoxes() {
  Box primary{0, 0, 1920, 1040};
  CHECK(Same(DefaultBox(Kind::Projects, primary, 1.0), Box{1576, 24, 1896, 264}));
  CHECK(Same(DefaultBox(Kind::Issues, primary, 1.0), Box{1536, 280, 1896, 600}));
  CHECK(Same(DefaultBox(Kind::Prs, primary, 1.0), Box{1536, 616, 1896, 936}));
  CHECK(DefaultBox(Kind::Projects, primary, 2.0).w() == 640);

  std::vector<Box> two{{0, 0, 1920, 1040}, {1920, 0, 3840, 1040}};
  CHECK(Same(ClampToMonitors(Box{-100, 50, 220, 290}, two), Box{0, 50, 320, 290}));            // off the left edge
  CHECK(Same(ClampToMonitors(Box{1800, 50, 2160, 370}, two), Box{1920, 50, 2280, 370}));       // mostly on monitor 2
  CHECK(Same(ClampToMonitors(Box{100, 900, 420, 1140}, two), Box{100, 800, 420, 1040}));       // below the work area
  CHECK(Same(ClampToMonitors(Box{2000, 100, 2320, 340}, two), Box{2000, 100, 2320, 340}));     // already fine
  std::vector<Box> one{{0, 0, 1920, 1040}};
  CHECK(Same(ClampToMonitors(Box{3000, 100, 3320, 340}, one), Box{1600, 100, 1920, 340}));     // its monitor was unplugged
  CHECK(Same(ClampToMonitors(Box{50, 50, 2150, 1500}, one), Box{0, 0, 2100, 1450}));           // bigger than the monitor: top-left
  CHECK(Same(ClampToMonitors(Box{5, 5, 25, 25}, {}), Box{5, 5, 25, 25}));                      // no monitor list: unchanged

  CHECK(Same(SnapToEdges(Box{10, 12, 330, 252}, one, 16), Box{0, 0, 320, 240}));
  CHECK(Same(SnapToEdges(Box{1590, 400, 1910, 640}, one, 16), Box{1600, 400, 1920, 640}));     // right edge
  CHECK(Same(SnapToEdges(Box{100, 400, 420, 640}, one, 16), Box{100, 400, 420, 640}));         // nothing near
  CHECK(Same(SnapToEdges(Box{100, 810, 420, 1030}, one, 16), Box{100, 820, 420, 1040}));       // bottom edge only
}

int main() {
  winrt::init_apartment();
  TestFile();
  TestBoxes();
  return Finish("placement_test");
}
```

In `CMakeLists.txt` change the two lines to:

```cmake
set(CORE_SOURCES snapshot.cc layout.cc placement.cc)
set(TESTS snapshot_test layout_test placement_test)
```

- [ ] **Step 2: Run to verify failure**

Run: `cmake -S shell-ext -B shell-ext-build -G "Visual Studio 17 2022" -A x64`
Expected: FAIL — `Cannot find source file: placement.cc`.

- [ ] **Step 3: Write the implementation**

`shell-ext/widgets/placement.h`:

```cpp
#pragma once
#include <string>
#include <vector>

#include "layout.h"

namespace null_widgets {

struct Box {
  int left = 0, top = 0, right = 0, bottom = 0;
  int w() const { return right - left; }
  int h() const { return bottom - top; }
};

// One widget's saved state. x/y are virtual-screen pixels; w/h are DIPs (0 = the default size of the widget).
struct Placement {
  bool visible = true;
  bool placed = false;  // false until the widget has a position (first run, or a file without one)
  int x = 0, y = 0;
  int w = 0, h = 0;
};

struct LayoutFile {
  bool locked = false;
  Placement widget[kKindCount];
};

// Never throws; anything unreadable falls back to the defaults (unplaced, visible, unlocked).
LayoutFile ParseLayout(std::wstring const& json);
std::wstring SerializeLayout(LayoutFile const& layout);

// First-run position: a column down the right edge of the primary work area. `scale` is dpi / 96.
Box DefaultBox(Kind kind, Box primaryWork, double scale);

// Moves `r` fully inside the monitor it overlaps most (the nearest one when it overlaps none).
Box ClampToMonitors(Box r, std::vector<Box> const& work);
// Pulls `r` onto a work-area edge that is within `threshold` pixels.
Box SnapToEdges(Box r, std::vector<Box> const& work, int threshold);

}  // namespace null_widgets
```

`shell-ext/widgets/placement.cc`:

```cpp
#include "placement.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>

#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/base.h>

using namespace winrt::Windows::Data::Json;

namespace null_widgets {

namespace {

constexpr int kMinDip = 200, kMaxDip = 800;

long long Overlap(Box const& a, Box const& b) {
  long long w = std::min(a.right, b.right) - std::max(a.left, b.left);
  long long h = std::min(a.bottom, b.bottom) - std::max(a.top, b.top);
  return (w > 0 && h > 0) ? w * h : 0;
}

long long CenterDistance2(Box const& a, Box const& b) {
  long long dx = (a.left + a.right) / 2 - (b.left + b.right) / 2;
  long long dy = (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2;
  return dx * dx + dy * dy;
}

bool Number(JsonObject const& o, wchar_t const* k, int lo, int hi, int* out) {
  if (!o.HasKey(k) || o.GetNamedValue(k).ValueType() != JsonValueType::Number) return false;
  double d = o.GetNamedNumber(k);
  if (!(d >= lo && d <= hi)) return false;
  *out = static_cast<int>(d);
  return true;
}

}  // namespace

LayoutFile ParseLayout(std::wstring const& json) {
  LayoutFile out;
  try {
    JsonObject root{nullptr};
    if (!JsonObject::TryParse(json, root)) return out;
    if (root.HasKey(L"locked") && root.GetNamedValue(L"locked").ValueType() == JsonValueType::Boolean) out.locked = root.GetNamedBoolean(L"locked");
    if (!root.HasKey(L"widgets") || root.GetNamedValue(L"widgets").ValueType() != JsonValueType::Object) return out;
    auto widgets = root.GetNamedObject(L"widgets");
    for (int i = 0; i < kKindCount; ++i) {
      wchar_t const* key = KeyOf(static_cast<Kind>(i));
      if (!widgets.HasKey(key) || widgets.GetNamedValue(key).ValueType() != JsonValueType::Object) continue;
      auto o = widgets.GetNamedObject(key);
      Placement& p = out.widget[i];
      if (o.HasKey(L"visible") && o.GetNamedValue(L"visible").ValueType() == JsonValueType::Boolean) p.visible = o.GetNamedBoolean(L"visible");
      p.placed = Number(o, L"x", -100000, 100000, &p.x) & Number(o, L"y", -100000, 100000, &p.y);
      Number(o, L"w", kMinDip, kMaxDip, &p.w);
      Number(o, L"h", kMinDip, kMaxDip, &p.h);
    }
  } catch (...) {
    return LayoutFile{};
  }
  return out;
}

std::wstring SerializeLayout(LayoutFile const& layout) {
  JsonObject root, widgets;
  root.SetNamedValue(L"schema", JsonValue::CreateNumberValue(1));
  root.SetNamedValue(L"locked", JsonValue::CreateBooleanValue(layout.locked));
  for (int i = 0; i < kKindCount; ++i) {
    Placement const& p = layout.widget[i];
    JsonObject o;
    o.SetNamedValue(L"visible", JsonValue::CreateBooleanValue(p.visible));
    if (p.placed) {
      o.SetNamedValue(L"x", JsonValue::CreateNumberValue(p.x));
      o.SetNamedValue(L"y", JsonValue::CreateNumberValue(p.y));
    }
    if (p.w > 0) o.SetNamedValue(L"w", JsonValue::CreateNumberValue(p.w));
    if (p.h > 0) o.SetNamedValue(L"h", JsonValue::CreateNumberValue(p.h));
    widgets.SetNamedValue(KeyOf(static_cast<Kind>(i)), o);
  }
  root.SetNamedValue(L"widgets", widgets);
  return std::wstring(root.Stringify().c_str());
}

Box DefaultBox(Kind kind, Box work, double scale) {
  int gap = static_cast<int>(std::lround(16 * scale)), margin = static_cast<int>(std::lround(24 * scale));
  int y = work.top + margin;
  for (int i = 0; i < static_cast<int>(kind); ++i) {
    y += static_cast<int>(std::lround(DefaultSize(static_cast<Kind>(i)).h * scale)) + gap;
  }
  SizeDip d = DefaultSize(kind);
  int w = static_cast<int>(std::lround(d.w * scale)), h = static_cast<int>(std::lround(d.h * scale));
  int x = work.right - margin - w;
  return Box{x, y, x + w, y + h};
}

Box ClampToMonitors(Box r, std::vector<Box> const& work) {
  if (work.empty()) return r;
  Box const* best = &work[0];
  long long bestOverlap = -1, bestDist = 0;
  for (auto const& m : work) {
    long long o = Overlap(r, m), d = CenterDistance2(r, m);
    if (o > bestOverlap || (o == bestOverlap && o == 0 && d < bestDist)) {
      best = &m;
      bestOverlap = o;
      bestDist = d;
    }
  }
  int w = r.w(), h = r.h();
  int x = w <= best->w() ? std::clamp(r.left, best->left, best->right - w) : best->left;
  int y = h <= best->h() ? std::clamp(r.top, best->top, best->bottom - h) : best->top;
  return Box{x, y, x + w, y + h};
}

Box SnapToEdges(Box r, std::vector<Box> const& work, int threshold) {
  int w = r.w(), h = r.h();
  int bestDx = threshold + 1, bestDy = threshold + 1, x = r.left, y = r.top;
  for (auto const& m : work) {
    int candX[2] = {m.left, m.right - w}, candY[2] = {m.top, m.bottom - h};
    for (int c : candX) {
      if (std::abs(c - r.left) < bestDx) { bestDx = std::abs(c - r.left); x = c; }
    }
    for (int c : candY) {
      if (std::abs(c - r.top) < bestDy) { bestDy = std::abs(c - r.top); y = c; }
    }
  }
  if (bestDx > threshold) x = r.left;
  if (bestDy > threshold) y = r.top;
  return Box{x, y, x + w, y + h};
}

}  // namespace null_widgets
```

- [ ] **Step 4: Run to verify it passes**

```powershell
cmake -S shell-ext -B shell-ext-build -G "Visual Studio 17 2022" -A x64
cmake --build shell-ext-build --config Release --target placement_test
ctest --test-dir shell-ext-build -C Release --output-on-failure -R placement_test
```

Expected: no warnings; `placement_test: all checks passed`.

- [ ] **Step 5: Commit**

```bash
git add shell-ext/widgets
git commit -m "feat(widgets): saved layout, clamp to monitors and edge snapping (#141)"
```

---

### Task 5: Actions — safe launching

**Files:**
- Create: `shell-ext/widgets/actions.h`, `shell-ext/widgets/actions.cc`, `shell-ext/widgets/actions_test.cc`
- Modify: `shell-ext/widgets/CMakeLists.txt` (two `set` lines)

**Interfaces:**
- Consumes: `Action`, `ActionKind` (Task 3); `IsSafeGithubUrl`, `IsAbsoluteLocalPath` (Task 2).
- Produces (`actions.h`): `std::wstring QuoteArg(std::wstring const&)`; `std::wstring NullCommandLine(nullExe, projectPath, bool newWindow)` → `"<null.exe>" [--new-window] -- "<path>"`; `void ScrubIdeEnvironment()` (drops `ELECTRON_RUN_AS_NODE` and `VSCODE_*`); `bool Run(Action const&, std::wstring const& installDir)` (re-validates; `false` without starting anything on a bad URL/path or a missing `null.exe`).

- [ ] **Step 1: Write the failing test**

`shell-ext/widgets/actions_test.cc`:

```cpp
#include <windows.h>

#include "actions.h"
#include "check.h"

using namespace null_widgets;

static void TestCommandLine() {
  CHECK(QuoteArg(L"abc") == L"abc");
  CHECK(QuoteArg(L"a b") == L"\"a b\"");
  CHECK(QuoteArg(L"") == L"\"\"");
  CHECK(QuoteArg(L"C:\\a b\\") == L"\"C:\\a b\\\\\"");  // trailing backslash is doubled so it cannot escape the closing quote
  CHECK(QuoteArg(L"a\"b") == L"\"a\\\"b\"");
  CHECK(NullCommandLine(L"C:\\Null IDE\\null.exe", L"C:\\work dir\\", true) ==
        L"\"C:\\Null IDE\\null.exe\" --new-window -- \"C:\\work dir\\\\\"");
  CHECK(NullCommandLine(L"C:\\n\\null.exe", L"C:\\work", false) == L"C:\\n\\null.exe -- C:\\work");
}

static void TestRefusals() {
  // Nothing hostile reaches ShellExecute or CreateProcess: these all fail before any process is started.
  CHECK(!Run({ActionKind::OpenUrl, L"file:///C:/Windows/System32/calc.exe", L""}, L"C:\\x"));
  CHECK(!Run({ActionKind::OpenUrl, L"https://github.com.evil.com/x", L""}, L"C:\\x"));
  CHECK(!Run({ActionKind::OpenProject, L"--remote=evil", L""}, L"C:\\x"));
  CHECK(!Run({ActionKind::OpenProjectNewWindow, L"..\\..\\x", L""}, L"C:\\x"));
  CHECK(!Run({ActionKind::OpenProject, L"C:\\work", L""}, L"C:\\no\\such\\install"));  // no null.exe there
  CHECK(!Run({ActionKind::None, L"", L""}, L"C:\\x"));
}

static void TestScrub() {
  SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", L"1");
  SetEnvironmentVariableW(L"VSCODE_PID", L"5");
  SetEnvironmentVariableW(L"vscode_lower", L"1");
  SetEnvironmentVariableW(L"NULL_WIDGETS_TEST_KEEP", L"1");
  ScrubIdeEnvironment();
  wchar_t buf[8];
  CHECK(GetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", buf, 8) == 0);
  CHECK(GetEnvironmentVariableW(L"VSCODE_PID", buf, 8) == 0);
  CHECK(GetEnvironmentVariableW(L"vscode_lower", buf, 8) == 0);
  CHECK(GetEnvironmentVariableW(L"NULL_WIDGETS_TEST_KEEP", buf, 8) == 1);
}

int main() {
  TestCommandLine();
  TestRefusals();
  TestScrub();
  return Finish("actions_test");
}
```

In `CMakeLists.txt` change the two lines to:

```cmake
set(CORE_SOURCES snapshot.cc layout.cc placement.cc actions.cc)
set(TESTS snapshot_test layout_test placement_test actions_test)
```

- [ ] **Step 2: Run to verify failure**

Run: `cmake -S shell-ext -B shell-ext-build -G "Visual Studio 17 2022" -A x64`
Expected: FAIL — `Cannot find source file: actions.cc`.

- [ ] **Step 3: Write the implementation**

`shell-ext/widgets/actions.h`:

```cpp
#pragma once
#include <string>

#include "layout.h"

namespace null_widgets {

// CommandLineToArgvW rules: quotes only when needed, backslashes before a quote doubled.
std::wstring QuoteArg(std::wstring const& arg);
// "<null.exe>" [--new-window] -- "<project>". The `--` keeps a path from ever being read as an option.
std::wstring NullCommandLine(std::wstring const& nullExe, std::wstring const& projectPath, bool newWindow);

// Drops ELECTRON_RUN_AS_NODE and VSCODE_* from this process, so a null.exe started later is the editor and not Node,
// even when the widgets were first started from the extension host.
void ScrubIdeEnvironment();

// Runs one action. URLs and paths are validated again here. `installDir` is the folder of this exe (never from the snapshot).
bool Run(Action const& action, std::wstring const& installDir);

}  // namespace null_widgets
```

`shell-ext/widgets/actions.cc`:

```cpp
#include "actions.h"

#include <windows.h>
#include <shellapi.h>

#include <filesystem>
#include <vector>

#include "snapshot.h"

namespace null_widgets {

std::wstring QuoteArg(std::wstring const& arg) {
  if (!arg.empty() && arg.find_first_of(L" \t\n\v\"") == std::wstring::npos) return arg;
  std::wstring out = L"\"";
  size_t backslashes = 0;
  for (wchar_t c : arg) {
    if (c == L'\\') {
      ++backslashes;
      continue;
    }
    if (c == L'"') out.append(backslashes * 2 + 1, L'\\');
    else out.append(backslashes, L'\\');
    backslashes = 0;
    out.push_back(c);
  }
  out.append(backslashes * 2, L'\\');  // the closing quote must not be escaped by a trailing backslash
  out.push_back(L'"');
  return out;
}

std::wstring NullCommandLine(std::wstring const& nullExe, std::wstring const& projectPath, bool newWindow) {
  std::wstring cmd = QuoteArg(nullExe);
  if (newWindow) cmd += L" --new-window";
  cmd += L" -- " + QuoteArg(projectPath);
  return cmd;
}

void ScrubIdeEnvironment() {
  std::vector<std::wstring> names;
  if (wchar_t* block = GetEnvironmentStringsW()) {
    for (wchar_t* p = block; *p; p += wcslen(p) + 1) {
      std::wstring entry = p;
      size_t eq = entry.find(L'=', 1);  // a leading '=' is a drive-cwd entry such as "=C:"
      if (eq == std::wstring::npos) continue;
      std::wstring name = entry.substr(0, eq);
      if (_wcsicmp(name.c_str(), L"ELECTRON_RUN_AS_NODE") == 0 || _wcsnicmp(name.c_str(), L"VSCODE_", 7) == 0) names.push_back(name);
    }
    FreeEnvironmentStringsW(block);
  }
  for (auto const& n : names) SetEnvironmentVariableW(n.c_str(), nullptr);
}

bool Run(Action const& a, std::wstring const& installDir) {
  switch (a.kind) {
    case ActionKind::OpenUrl: {
      if (!IsSafeGithubUrl(a.target)) return false;
      return reinterpret_cast<INT_PTR>(ShellExecuteW(nullptr, L"open", a.target.c_str(), nullptr, nullptr, SW_SHOWNORMAL)) > 32;
    }
    case ActionKind::OpenProject:
    case ActionKind::OpenProjectNewWindow: {
      if (!IsAbsoluteLocalPath(a.target)) return false;
      std::wstring nullExe = installDir + L"\\null.exe";
      if (!std::filesystem::is_regular_file(nullExe)) return false;
      std::wstring cmd = NullCommandLine(nullExe, a.target, a.kind == ActionKind::OpenProjectNewWindow);
      std::vector<wchar_t> buf(cmd.begin(), cmd.end());
      buf.push_back(L'\0');
      STARTUPINFOW si{sizeof(si)};
      PROCESS_INFORMATION pi{};
      if (!CreateProcessW(nullExe.c_str(), buf.data(), nullptr, nullptr, FALSE, CREATE_UNICODE_ENVIRONMENT, nullptr, nullptr, &si, &pi)) return false;
      CloseHandle(pi.hThread);
      CloseHandle(pi.hProcess);
      return true;
    }
    case ActionKind::None:
      break;
  }
  return false;
}

}  // namespace null_widgets
```

- [ ] **Step 4: Run to verify it passes**

```powershell
cmake -S shell-ext -B shell-ext-build -G "Visual Studio 17 2022" -A x64
cmake --build shell-ext-build --config Release --target actions_test
ctest --test-dir shell-ext-build -C Release --output-on-failure
```

Expected: no warnings; all four widget tests pass.

- [ ] **Step 5: Commit**

```bash
git add shell-ext/widgets
git commit -m "feat(widgets): validated launching of URLs and projects (#141)"
```

---

### Task 6: The host — `null_widgets.exe`

The windows, painting, drag, menu, single instance and file watch. There is nothing here a unit test can reach (it is all window messages); correctness rests on the four tested modules below it and on the manual check at the end.

**Files:**
- Create: `shell-ext/widgets/app.cc`
- Modify: `shell-ext/widgets/CMakeLists.txt` (append the exe target)
- Create: `scripts/check-widgets.ps1`

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces: `null_widgets.exe` (GUI subsystem). Behaviour the other tasks rely on: one instance (named mutex `Local\NullWidgets.Singleton`); a second launch posts `WM_APP_SHOW_ALL` to the first and exits; reads `%LOCALAPPDATA%\Null\widgets\snapshot.json` and `layout.json`; creates the folder if it is missing; sets its working directory there (it never keeps the install folder busy); quits on `WM_CLOSE` of any of its windows (so `taskkill` without `/F` works).

- [ ] **Step 1: Write `app.cc`**

```cpp
// null_widgets.exe: Projects / Issues / Pull Requests as borderless windows pinned just above the wallpaper.
// Reads %LOCALAPPDATA%\Null\widgets\snapshot.json (written by the IDE) and never touches the network.
#include <windows.h>
#include <d2d1.h>
#include <dwrite.h>
#include <shlobj.h>
#include <windowsx.h>

#include <algorithm>
#include <cmath>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include <winrt/Windows.Foundation.h>

#include "actions.h"
#include "layout.h"
#include "placement.h"
#include "snapshot.h"

using namespace null_widgets;

namespace {

constexpr wchar_t kControlClass[] = L"NullWidgetsControl";
constexpr wchar_t kWidgetClass[] = L"NullWidgetsWindow";
constexpr wchar_t kMutexName[] = L"Local\\NullWidgets.Singleton";

constexpr UINT WM_APP_RELOAD = WM_APP + 1;     // the snapshot file changed
constexpr UINT WM_APP_SHOW_ALL = WM_APP + 2;  // a second launch: show every hidden widget
constexpr UINT_PTR kTickTimer = 1;             // repaint once a minute so "updated N min ago" moves on
constexpr int kDragThresholdPx = 4, kSnapDip = 16;

enum MenuId : UINT { kRefresh = 1, kLock, kHide, kQuit, kShowBase = 100, kRowBase = 200 };

// Null Dark (extensions/null-theme/themes/null-dark.json).
struct Palette {
  D2D1_COLOR_F bg{0.094f, 0.094f, 0.094f, 0.94f}, border{1, 1, 1, 0.08f}, hover{1, 1, 1, 0.07f};
  D2D1_COLOR_F text{0.8f, 0.8f, 0.8f, 1}, muted{0.616f, 0.616f, 0.616f, 1}, faint{0.45f, 0.45f, 0.45f, 1};
  D2D1_COLOR_F accent{0.302f, 0.667f, 0.988f, 1}, good{0.18f, 0.627f, 0.263f, 1}, warn{0.8f, 0.655f, 0, 1}, bad{0.973f, 0.318f, 0.286f, 1};
};
const Palette kPal;

struct Widget {
  Kind kind;
  HWND hwnd = nullptr;
  View view;
  int hover = -1;      // row under the cursor
  bool tracking = false;
  bool down = false, dragging = false;
  POINT downScreen{}, downOrigin{};
};

struct App {
  HWND control = nullptr;
  std::wstring installDir, dataDir, snapshotPath, layoutPath;
  LayoutFile layout;
  Loaded loaded;  // what is drawn: the last good snapshot
  Widget widgets[kKindCount] = {{Kind::Projects}, {Kind::Issues}, {Kind::Prs}};
  ID2D1Factory* d2d = nullptr;
  IDWriteFactory* dwrite = nullptr;
} app;

template <class T>
void Release(T*& p) {
  if (p) { p->Release(); p = nullptr; }
}

std::wstring ReadText(std::wstring const& path) {
  std::ifstream f(std::filesystem::path(path), std::ios::binary);
  std::stringstream ss;
  ss << f.rdbuf();
  return std::wstring(winrt::to_hstring(ss.str()).c_str());
}

void WriteTextAtomic(std::wstring const& path, std::wstring const& text) {
  std::wstring tmp = path + L".tmp";
  std::string utf8(winrt::to_string(winrt::hstring(text)));
  {
    std::ofstream f(std::filesystem::path(tmp), std::ios::binary | std::ios::trunc);
    f << utf8;
  }
  MoveFileExW(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING);
}

long long NowEpoch() { return static_cast<long long>(std::time(nullptr)); }

std::vector<Box> WorkAreas() {
  std::vector<Box> out;
  EnumDisplayMonitors(nullptr, nullptr,
      [](HMONITOR m, HDC, LPRECT, LPARAM lp) -> BOOL {
        MONITORINFO mi{sizeof(mi)};
        if (GetMonitorInfoW(m, &mi)) {
          reinterpret_cast<std::vector<Box>*>(lp)->push_back({mi.rcWork.left, mi.rcWork.top, mi.rcWork.right, mi.rcWork.bottom});
        }
        return TRUE;
      },
      reinterpret_cast<LPARAM>(&out));
  return out;
}

Box PrimaryWork() {
  RECT r{};
  SystemParametersInfoW(SPI_GETWORKAREA, 0, &r, 0);
  return {r.left, r.top, r.right, r.bottom};
}

double ScaleOf(HWND h) { return static_cast<double>(GetDpiForWindow(h)) / 96.0; }
int Px(double dip, double scale) { return static_cast<int>(std::lround(dip * scale)); }

SizeDip SizeOfWidget(Kind k) {
  Placement const& p = app.layout.widget[static_cast<int>(k)];
  SizeDip d = DefaultSize(k);
  return {p.w > 0 ? p.w : d.w, p.h > 0 ? p.h : d.h};
}

void SaveLayout() { WriteTextAtomic(app.layoutPath, SerializeLayout(app.layout)); }

// ---- drawing -----------------------------------------------------------------------------------------------

struct Fonts {
  IDWriteTextFormat *title = nullptr, *row = nullptr, *detail = nullptr, *foot = nullptr, *message = nullptr;
};

IDWriteTextFormat* MakeFormat(float size, DWRITE_FONT_WEIGHT weight, DWRITE_TEXT_ALIGNMENT align = DWRITE_TEXT_ALIGNMENT_LEADING) {
  IDWriteTextFormat* f = nullptr;
  if (SUCCEEDED(app.dwrite->CreateTextFormat(L"Segoe UI", nullptr, weight, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, size, L"", &f))) {
    f->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
    f->SetTextAlignment(align);
    f->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
  }
  return f;
}

D2D1_COLOR_F ToneColor(Tone t) {
  switch (t) {
    case Tone::Muted: return kPal.muted;
    case Tone::Accent: return kPal.accent;
    case Tone::Good: return kPal.good;
    case Tone::Warn: return kPal.warn;
    case Tone::Bad: return kPal.bad;
    default: return kPal.text;
  }
}

// Draws spans left to right on one line; the span that runs out of room is cut with an ellipsis.
void DrawSpans(ID2D1RenderTarget* rt, ID2D1SolidColorBrush* brush, IDWriteTextFormat* fmt, std::vector<Span> const& spans, float x, float y,
               float maxX, bool dimmed) {
  IDWriteInlineObject* ellipsis = nullptr;
  DWRITE_TRIMMING trim{DWRITE_TRIMMING_GRANULARITY_CHARACTER, 0, 0};
  for (auto const& s : spans) {
    if (x >= maxX) break;
    IDWriteTextLayout* layout = nullptr;
    if (FAILED(app.dwrite->CreateTextLayout(s.text.c_str(), static_cast<UINT32>(s.text.size()), fmt, maxX - x, 24.f, &layout))) break;
    if (!ellipsis) app.dwrite->CreateEllipsisTrimmingSign(fmt, &ellipsis);
    layout->SetTrimming(&trim, ellipsis);
    DWRITE_TEXT_METRICS m{};
    layout->GetMetrics(&m);
    D2D1_COLOR_F c = ToneColor(s.tone);
    if (dimmed) c.a *= 0.5f;
    brush->SetColor(c);
    rt->DrawTextLayout(D2D1::Point2F(x, y), layout, brush);
    x += m.widthIncludingTrailingWhitespace;
    layout->Release();
  }
  Release(ellipsis);
}

void Render(Widget& w) {
  if (!w.hwnd || !IsWindowVisible(w.hwnd)) return;
  double scale = ScaleOf(w.hwnd);
  SizeDip sd = SizeOfWidget(w.kind);
  int pw = Px(sd.w, scale), ph = Px(sd.h, scale);

  HDC screen = GetDC(nullptr);
  HDC mem = CreateCompatibleDC(screen);
  BITMAPINFO bi{};
  bi.bmiHeader = {sizeof(BITMAPINFOHEADER), pw, -ph, 1, 32, BI_RGB};
  void* bits = nullptr;
  HBITMAP bmp = CreateDIBSection(screen, &bi, DIB_RGB_COLORS, &bits, nullptr, 0);
  HGDIOBJ old = SelectObject(mem, bmp);

  ID2D1DCRenderTarget* rt = nullptr;
  D2D1_RENDER_TARGET_PROPERTIES props = D2D1::RenderTargetProperties(
      D2D1_RENDER_TARGET_TYPE_DEFAULT, D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED), 96.f * static_cast<float>(scale),
      96.f * static_cast<float>(scale), D2D1_RENDER_TARGET_USAGE_GDI_COMPATIBLE);
  if (SUCCEEDED(app.d2d->CreateDCRenderTarget(&props, &rt))) {
    RECT bounds{0, 0, pw, ph};
    rt->BindDC(mem, &bounds);
    ID2D1SolidColorBrush* brush = nullptr;
    rt->CreateSolidColorBrush(kPal.bg, &brush);
    Fonts f{MakeFormat(13.f, DWRITE_FONT_WEIGHT_SEMI_BOLD), MakeFormat(13.f, DWRITE_FONT_WEIGHT_NORMAL), MakeFormat(11.f, DWRITE_FONT_WEIGHT_NORMAL),
            MakeFormat(11.f, DWRITE_FONT_WEIGHT_NORMAL), MakeFormat(13.f, DWRITE_FONT_WEIGHT_NORMAL, DWRITE_TEXT_ALIGNMENT_CENTER)};

    float W = static_cast<float>(sd.w), H = static_cast<float>(sd.h);
    View const& v = w.view;
    rt->BeginDraw();
    rt->Clear(D2D1::ColorF(0, 0, 0, 0));
    D2D1_ROUNDED_RECT card = D2D1::RoundedRect(D2D1::RectF(0.5f, 0.5f, W - 0.5f, H - 0.5f), 10.f, 10.f);
    brush->SetColor(kPal.bg);
    rt->FillRoundedRectangle(card, brush);
    brush->SetColor(kPal.border);
    rt->DrawRoundedRectangle(card, brush, 1.f);

    brush->SetColor(kPal.text);
    rt->DrawText(v.title.c_str(), static_cast<UINT32>(v.title.size()), f.title, D2D1::RectF(14, 9, W - 14, kHeaderDip), brush);

    if (!v.message.empty()) {
      brush->SetColor(kPal.muted);
      rt->DrawText(v.message.c_str(), static_cast<UINT32>(v.message.size()), f.message, D2D1::RectF(14, kHeaderDip + 24, W - 14, H - kFooterDip), brush);
    }
    for (size_t i = 0; i < v.rows.size(); ++i) {
      float top = static_cast<float>(kHeaderDip + i * kRowDip);
      if (static_cast<int>(i) == w.hover && v.rows[i].click.kind != ActionKind::None) {
        brush->SetColor(kPal.hover);
        rt->FillRoundedRectangle(D2D1::RoundedRect(D2D1::RectF(6, top, W - 6, top + kRowDip - 2), 6.f, 6.f), brush);
      }
      DrawSpans(rt, brush, f.row, v.rows[i].title, 14, top + 3, W - 14, v.rows[i].dimmed);
      DrawSpans(rt, brush, f.detail, v.rows[i].detail, 14, top + 22, W - 14, v.rows[i].dimmed);
    }
    if (!v.footer.empty()) {
      brush->SetColor(v.stale ? kPal.faint : kPal.muted);
      rt->DrawText(v.footer.c_str(), static_cast<UINT32>(v.footer.size()), f.foot, D2D1::RectF(14, H - kFooterDip + 2, W - 14, H), brush);
    }
    rt->EndDraw();

    Release(f.title); Release(f.row); Release(f.detail); Release(f.foot); Release(f.message);
    Release(brush);
    Release(rt);
  }

  RECT wr{};
  GetWindowRect(w.hwnd, &wr);
  POINT pos{wr.left, wr.top}, src{0, 0};
  SIZE size{pw, ph};
  BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
  UpdateLayeredWindow(w.hwnd, screen, &pos, &size, mem, &src, 0, &blend, ULW_ALPHA);

  SelectObject(mem, old);
  DeleteObject(bmp);
  DeleteDC(mem);
  ReleaseDC(nullptr, screen);
}

void Rebuild(Widget& w) {
  w.view = BuildView(app.loaded, w.kind, RowsThatFit(SizeOfWidget(w.kind).h), NowEpoch());
  if (w.hover >= static_cast<int>(w.view.rows.size())) w.hover = -1;
  Render(w);
}

void RebuildAll() {
  for (auto& w : app.widgets) Rebuild(w);
}

void Reload() {
  app.loaded = KeepLastGood(app.loaded, LoadSnapshotFile(app.snapshotPath));
  RebuildAll();
}

// ---- placement ---------------------------------------------------------------------------------------------

// The desktop window (Progman) is itself at the very bottom, so HWND_BOTTOM would hide a widget behind the wallpaper. A widget goes
// directly above Progman instead: behind the window that is just above it, so below every app and above the desktop.
// Null when the widget already is that window or there is no desktop window (the z-order is then left alone).
HWND AboveDesktop(HWND self) {
  HWND prog = FindWindowW(L"Progman", nullptr);
  HWND above = prog ? GetWindow(prog, GW_HWNDPREV) : nullptr;
  return above == self ? nullptr : above;
}

void PinToDesktop(HWND h) {
  if (HWND above = AboveDesktop(h)) SetWindowPos(h, above, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

Box WindowBox(HWND h) {
  RECT r{};
  GetWindowRect(h, &r);
  return {r.left, r.top, r.right, r.bottom};
}

void MoveTo(Widget& w, Box b) {
  SetWindowPos(w.hwnd, nullptr, b.left, b.top, b.w(), b.h(), SWP_NOACTIVATE | SWP_NOZORDER);  // WM_WINDOWPOSCHANGING re-pins the z-order
}

// Puts every widget where the layout says, clamped to the monitors that exist now.
void ApplyLayout() {
  auto work = WorkAreas();
  for (int i = 0; i < kKindCount; ++i) {
    Widget& w = app.widgets[i];
    Placement& p = app.layout.widget[i];
    double scale = ScaleOf(w.hwnd);
    SizeDip sd = SizeOfWidget(w.kind);
    int pw = Px(sd.w, scale), ph = Px(sd.h, scale);
    Box b = p.placed ? Box{p.x, p.y, p.x + pw, p.y + ph} : DefaultBox(w.kind, PrimaryWork(), scale);
    b = ClampToMonitors(b, work);
    MoveTo(w, b);
    p.placed = true;
    p.x = b.left;
    p.y = b.top;
    ShowWindow(w.hwnd, p.visible ? SW_SHOWNOACTIVATE : SW_HIDE);
  }
  RebuildAll();
}

// ---- widget window -----------------------------------------------------------------------------------------

int RowAt(Widget const& w, int yPx) {
  double scale = ScaleOf(w.hwnd);
  int top = Px(kHeaderDip, scale), row = Px(kRowDip, scale);
  if (yPx < top) return -1;
  int i = (yPx - top) / row;
  return i < static_cast<int>(w.view.rows.size()) ? i : -1;
}

void ShowMenu(Widget& w, POINT screenPt, int row) {
  HMENU m = CreatePopupMenu();
  if (row >= 0) {
    auto const& items = w.view.rows[row].menu;
    for (size_t i = 0; i < items.size(); ++i) AppendMenuW(m, MF_STRING, kRowBase + i, items[i].label.c_str());
    if (!items.empty()) AppendMenuW(m, MF_SEPARATOR, 0, nullptr);
  }
  AppendMenuW(m, MF_STRING, kRefresh, L"Refresh");
  AppendMenuW(m, MF_STRING | (app.layout.locked ? MF_CHECKED : 0), kLock, L"Lock widgets");
  AppendMenuW(m, MF_STRING, kHide, L"Hide this widget");
  for (int i = 0; i < kKindCount; ++i) {
    if (!app.layout.widget[i].visible) {
      std::wstring label = std::wstring(L"Show ") + TitleOf(static_cast<Kind>(i));
      AppendMenuW(m, MF_STRING, kShowBase + i, label.c_str());
    }
  }
  AppendMenuW(m, MF_SEPARATOR, 0, nullptr);
  AppendMenuW(m, MF_STRING, kQuit, L"Quit widgets");

  SetForegroundWindow(w.hwnd);  // without this the menu does not close when the user clicks elsewhere
  UINT id = TrackPopupMenu(m, TPM_RETURNCMD | TPM_RIGHTBUTTON, screenPt.x, screenPt.y, 0, w.hwnd, nullptr);
  PostMessageW(w.hwnd, WM_NULL, 0, 0);
  DestroyMenu(m);

  int idx = static_cast<int>(w.kind);
  if (id >= kRowBase && id < kRowBase + 8 && row >= 0 && id - kRowBase < w.view.rows[row].menu.size()) {
    Run(w.view.rows[row].menu[id - kRowBase], app.installDir);
  } else if (id == kRefresh) {
    Reload();
  } else if (id == kLock) {
    app.layout.locked = !app.layout.locked;
    SaveLayout();
  } else if (id == kHide) {
    app.layout.widget[idx].visible = false;
    ShowWindow(w.hwnd, SW_HIDE);
    SaveLayout();
  } else if (id >= kShowBase && id < kShowBase + kKindCount) {
    app.layout.widget[id - kShowBase].visible = true;
    ShowWindow(app.widgets[id - kShowBase].hwnd, SW_SHOWNOACTIVATE);
    SaveLayout();
    Reload();
  } else if (id == kQuit) {
    PostMessageW(app.control, WM_CLOSE, 0, 0);
  }
}

LRESULT CALLBACK WidgetProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
  Widget* w = reinterpret_cast<Widget*>(GetWindowLongPtrW(h, GWLP_USERDATA));
  if (!w) return DefWindowProcW(h, msg, wp, lp);
  switch (msg) {
    case WM_WINDOWPOSCHANGING: {
      // Whatever asked for a new z-order (a click, Win+D, another app), the widget stays above the wallpaper and below everything else.
      auto* pos = reinterpret_cast<WINDOWPOS*>(lp);
      if (HWND above = AboveDesktop(h)) {
        pos->hwndInsertAfter = above;
        pos->flags &= ~SWP_NOZORDER;
      } else {
        pos->flags |= SWP_NOZORDER;
      }
      pos->flags |= SWP_NOACTIVATE;
      return 0;
    }
    case WM_MOUSEACTIVATE:
      return MA_NOACTIVATE;
    case WM_MOUSEMOVE: {
      POINT pt{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
      if (!w->tracking) {
        TRACKMOUSEEVENT t{sizeof(t), TME_LEAVE, h, 0};
        TrackMouseEvent(&t);
        w->tracking = true;
      }
      if (w->down && !app.layout.locked) {
        POINT s = pt;
        ClientToScreen(h, &s);
        if (!w->dragging && (std::abs(s.x - w->downScreen.x) > kDragThresholdPx || std::abs(s.y - w->downScreen.y) > kDragThresholdPx)) w->dragging = true;
        if (w->dragging) {
          Box cur = WindowBox(h);
          Box want{w->downOrigin.x + s.x - w->downScreen.x, w->downOrigin.y + s.y - w->downScreen.y, 0, 0};
          want.right = want.left + cur.w();
          want.bottom = want.top + cur.h();
          MoveTo(*w, SnapToEdges(want, WorkAreas(), Px(kSnapDip, ScaleOf(h))));
          return 0;
        }
      }
      int row = RowAt(*w, pt.y);
      if (row != w->hover) {
        w->hover = row;
        Render(*w);
      }
      return 0;
    }
    case WM_MOUSELEAVE:
      w->tracking = false;
      if (w->hover != -1) {
        w->hover = -1;
        Render(*w);
      }
      return 0;
    case WM_LBUTTONDOWN: {
      w->down = true;
      w->dragging = false;
      SetCapture(h);
      w->downScreen = {GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
      ClientToScreen(h, &w->downScreen);
      Box b = WindowBox(h);
      w->downOrigin = {b.left, b.top};
      return 0;
    }
    case WM_LBUTTONUP: {
      bool wasDragging = w->dragging;
      w->down = w->dragging = false;
      ReleaseCapture();
      if (wasDragging) {
        Box b = WindowBox(h);
        Placement& p = app.layout.widget[static_cast<int>(w->kind)];
        p.placed = true;
        p.x = b.left;
        p.y = b.top;
        SaveLayout();
      } else {
        int row = RowAt(*w, GET_Y_LPARAM(lp));
        if (row >= 0) Run(w->view.rows[row].click, app.installDir);
      }
      return 0;
    }
    case WM_RBUTTONUP: {
      POINT pt{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
      int row = RowAt(*w, pt.y);
      ClientToScreen(h, &pt);
      ShowMenu(*w, pt, row);
      return 0;
    }
    case WM_DPICHANGED: {
      Rebuild(*w);
      return 0;
    }
    case WM_CLOSE:  // taskkill without /F, or Alt+F4 on a focused widget: quit everything
      PostMessageW(app.control, WM_CLOSE, 0, 0);
      return 0;
  }
  return DefWindowProcW(h, msg, wp, lp);
}

// ---- control window: second launches, file changes, display and power events --------------------------------

LRESULT CALLBACK ControlProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
  static UINT const taskbarCreated = RegisterWindowMessageW(L"TaskbarCreated");
  if (msg == taskbarCreated) {  // Explorer restarted: there is a new desktop window to sit on
    ApplyLayout();
    return 0;
  }
  switch (msg) {
    case WM_APP_RELOAD:
      Reload();
      return 0;
    case WM_APP_SHOW_ALL:
      for (int i = 0; i < kKindCount; ++i) {
        app.layout.widget[i].visible = true;
        ShowWindow(app.widgets[i].hwnd, SW_SHOWNOACTIVATE);
      }
      SaveLayout();
      Reload();
      return 0;
    case WM_TIMER:
      RebuildAll();
      return 0;
    case WM_DISPLAYCHANGE:
    case WM_SETTINGCHANGE:
      if (msg == WM_DISPLAYCHANGE || wp == SPI_SETWORKAREA) ApplyLayout();
      return 0;
    case WM_POWERBROADCAST:
      if (wp == PBT_APMRESUMEAUTOMATIC || wp == PBT_APMRESUMESUSPEND) {
        for (auto& w : app.widgets) PinToDesktop(w.hwnd);
        ApplyLayout();
        Reload();
      }
      return TRUE;
    case WM_CLOSE:
    case WM_ENDSESSION:
      DestroyWindow(h);
      return 0;
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(h, msg, wp, lp);
}

// Posts WM_APP_RELOAD when anything in the widgets folder changes. Reload() reads the file again, so extra wake-ups are harmless.
DWORD WINAPI WatchThread(LPVOID) {
  HANDLE n = FindFirstChangeNotificationW(app.dataDir.c_str(), FALSE, FILE_NOTIFY_CHANGE_LAST_WRITE | FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_SIZE);
  if (n == INVALID_HANDLE_VALUE) return 1;
  while (WaitForSingleObject(n, INFINITE) == WAIT_OBJECT_0) {
    Sleep(150);  // let the writer finish its rename
    PostMessageW(app.control, WM_APP_RELOAD, 0, 0);
    if (!FindNextChangeNotification(n)) break;
  }
  FindCloseChangeNotification(n);
  return 0;
}

std::wstring KnownFolder(REFKNOWNFOLDERID id) {
  PWSTR p = nullptr;
  std::wstring out;
  if (SUCCEEDED(SHGetKnownFolderPath(id, 0, nullptr, &p))) out = p;
  CoTaskMemFree(p);
  return out;
}

}  // namespace

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, PWSTR, int) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  HANDLE once = CreateMutexW(nullptr, TRUE, kMutexName);
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    // A second launch (null-setup, "Null: Set Up Widgets"): bring every hidden widget back and leave.
    if (HWND other = FindWindowW(kControlClass, nullptr)) PostMessageW(other, WM_APP_SHOW_ALL, 0, 0);
    return 0;
  }
  winrt::init_apartment(winrt::apartment_type::single_threaded);
  ScrubIdeEnvironment();

  wchar_t exe[MAX_PATH];
  GetModuleFileNameW(nullptr, exe, MAX_PATH);
  app.installDir = std::filesystem::path(exe).parent_path().wstring();
  app.dataDir = KnownFolder(FOLDERID_LocalAppData) + L"\\Null\\widgets";
  std::filesystem::create_directories(app.dataDir);
  SetCurrentDirectoryW(app.dataDir.c_str());  // never keep the install folder busy: an update has to rename it
  app.snapshotPath = app.dataDir + L"\\snapshot.json";
  app.layoutPath = app.dataDir + L"\\layout.json";
  app.layout = ParseLayout(ReadText(app.layoutPath));

  D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, &app.d2d);
  DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory), reinterpret_cast<IUnknown**>(&app.dwrite));
  if (!app.d2d || !app.dwrite) return 1;

  WNDCLASSEXW cc{sizeof(cc)};
  cc.lpfnWndProc = ControlProc;
  cc.hInstance = inst;
  cc.lpszClassName = kControlClass;
  RegisterClassExW(&cc);
  WNDCLASSEXW wc{sizeof(wc)};
  wc.lpfnWndProc = WidgetProc;
  wc.hInstance = inst;
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  wc.lpszClassName = kWidgetClass;
  RegisterClassExW(&wc);

  // A hidden top-level window (not message-only): only those receive WM_DISPLAYCHANGE and WM_POWERBROADCAST.
  app.control = CreateWindowExW(WS_EX_TOOLWINDOW, kControlClass, L"Null Widgets", WS_POPUP, 0, 0, 0, 0, nullptr, nullptr, inst, nullptr);
  for (auto& w : app.widgets) {
    w.hwnd = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, kWidgetClass, TitleOf(w.kind), WS_POPUP, 0, 0, 10, 10, nullptr,
                             nullptr, inst, nullptr);
    SetWindowLongPtrW(w.hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(&w));
  }
  app.loaded = LoadSnapshotFile(app.snapshotPath);
  ApplyLayout();
  SaveLayout();
  SetTimer(app.control, kTickTimer, 60 * 1000, nullptr);
  CloseHandle(CreateThread(nullptr, 0, WatchThread, nullptr, 0, nullptr));

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }
  Release(app.d2d);
  Release(app.dwrite);
  CloseHandle(once);
  return 0;
}
```

- [ ] **Step 2: Add the exe target**

Append to `shell-ext/widgets/CMakeLists.txt`:

```cmake
add_executable(null_widgets WIN32 app.cc)
target_link_libraries(null_widgets PRIVATE null_widget_core d2d1 dwrite user32 gdi32 ole32 shlwapi)
if(CMAKE_CXX_COMPILER_FRONTEND_VARIANT STREQUAL "MSVC")
  target_link_options(null_widgets PRIVATE /guard:cf /OPT:REF /OPT:ICF /MACHINE:X64)
endif()
```

- [ ] **Step 3: Build and run the whole suite**

```powershell
cmake -S shell-ext -B shell-ext-build -G "Visual Studio 17 2022" -A x64
cmake --build shell-ext-build --config Release
ctest --test-dir shell-ext-build -C Release --output-on-failure
```

Expected: no warnings; the DLL, `null_identity_stub.exe`, `null_widgets.exe` (about 190 KB) and all four tests build and pass.

- [ ] **Step 4: Write the check script**

`scripts/check-widgets.ps1`:

```powershell
# Manual-check driver for the Null IDE desktop widgets (null_widgets.exe). Cannot run in CI.
#   -Status     what is running, registered and on disk right now, and where the widget windows sit relative to the desktop window
#   -Checklist  prints the manual run (the list at the end of docs/specs/native-windows-widgets-design.md "Testing")
# Run in a PLAIN PowerShell window outside Null IDE (updating and quitting the IDE is part of the checklist).
param(
    [switch]$Status,
    [switch]$Checklist
)
$ErrorActionPreference = 'Stop'
function Section($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }

if (-not ($Status -or $Checklist)) { $Status = $true }

if ($Status) {
    Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class NullWidgetsZ {
  delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EP cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  // Top-to-bottom z-order index of the desktop window and of every widget window. Widgets must sit just above Progman.
  public static string Dump() {
    var sb = new StringBuilder(); int idx = 0;
    EnumWindows((h, l) => { var c = new StringBuilder(64); GetClassName(h, c, 64); var n = c.ToString();
      if (n == "Progman" || n == "NullWidgetsWindow") sb.AppendLine("  z=" + idx + "  " + n + "  visible=" + IsWindowVisible(h));
      idx++; return true; }, IntPtr.Zero);
    return sb.ToString();
  }
}
'@

    Section 'Host'
    $build = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuildNumber
    "Windows build            : $build"
    $proc = Get-Process -Name 'null_widgets' -ErrorAction SilentlyContinue
    "null_widgets.exe running : $(if ($proc) { ($proc.Id -join ', ') } else { 'no' })"
    $ide = Get-Process -Name 'null' -ErrorAction SilentlyContinue
    "null.exe running         : $(if ($ide) { ($ide.Id -join ', ') } else { 'no' })"
    $run = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).NullWidgets
    "Run entry NullWidgets    : $(if ($run) { $run } else { '<none>' })"

    Section 'Files'
    $dir = Join-Path $env:LOCALAPPDATA 'Null\widgets'
    foreach ($f in 'snapshot.json', 'layout.json', 'widgets-owner.json') {
        $p = Join-Path $dir $f
        if (Test-Path $p) { $i = Get-Item $p; "{0,-20}: {1} bytes, written {2}" -f $f, $i.Length, $i.LastWriteTime } else { "{0,-20}: <missing>" -f $f }
    }
    $snap = Join-Path $dir 'snapshot.json'
    if (Test-Path $snap) {
        $s = Get-Content $snap -Raw | ConvertFrom-Json
        "snapshot schema {0}: {1} projects, {2} issues, {3} PRs (issues {4}, PRs {5})" -f $s.schema, $s.projects.items.Count, $s.issues.items.Count, $s.prs.items.Count, $s.issues.status, $s.prs.status
    }

    Section 'Z-order (top = 0; widgets must be directly above Progman, never below it)'
    [NullWidgetsZ]::Dump()
}

if ($Checklist) {
@'

Desktop widgets manual run (cannot run in CI). Use a build from scripts/build-local.ps1, installed with NullIDESetup, on Windows 11 AND Windows 10.
 1. Wizard: "Desktop widgets" is offered and OFF. Install without it: -Status shows no Run entry and no null_widgets.exe.
 2. Null Setup -> Modify -> tick "Desktop widgets" -> Apply: the Run entry exists and three cards appear on the desktop reading "Open Null IDE to set up widgets".
 3. Null: Set Up Widgets in the IDE: pick an account and repos. snapshot.json appears; the cards fill in with correct data and "updated <age>".
 4. Click an issue / PR row: the browser opens that GitHub page. Click a project row: Null IDE opens the folder. Right-click a project row -> "Open in new window" opens a new window.
    Both IDE windows get a normal taskbar slot and icon (the widgets exe is not packaged, so no package identity is involved).
 5. Drag a card: it follows the cursor, snaps to screen edges, and keeps its place after Quit widgets + relaunch. Lock widgets: dragging does nothing. Unlock again.
 6. Win+D: the cards stay visible. Open and focus an app: it covers a card; the card never comes in front of any app. -Status z-order: cards directly above Progman.
 7. Hide this widget on all three, then run `<install>\null_widgets.exe` again (or Null: Set Up Widgets): all three come back.
 8. Sleep and resume; unplug / plug a monitor; change display scaling: cards stay visible and on screen, text stays sharp.
 9. Restart Explorer (Task Manager -> Windows Explorer -> Restart): cards re-appear above the desktop.
10. Quit Null IDE completely: cards keep showing the last data; "updated" ages; after 6 h the footer is muted.
11. Turn null.widgets.enabled off in the IDE: snapshot.json disappears and the cards read "Open Null IDE to set up widgets". Turn it on again: data returns.
12. Sign the account out in null-accounts: rows stay, dimmed, footer "Signed out of GitHub".
13. Update with the widgets running (headless update from a copy outside the install, see setup/CLAUDE.md): no "files are locked" prompt; the cards are back afterwards.
14. Untick "Desktop widgets" in Modify: cards disappear, Run entry and %LOCALAPPDATA%\Null\widgets are gone, IDE untouched. Tick again, then Uninstall: same cleanup.
'@
}
```

- [ ] **Step 5: Look at it on the desktop**

`%LOCALAPPDATA%\Null\widgets` should not exist yet (`Test-Path`); if you already use the widgets, back it up instead.

```powershell
$d = Join-Path $env:LOCALAPPDATA 'Null\widgets'; New-Item -ItemType Directory -Force $d | Out-Null
$now = (Get-Date).ToUniversalTime().AddMinutes(-4).ToString('yyyy-MM-ddTHH:mm:ssZ')
(Get-Content shell-ext/widgets/fixtures/ok.json -Raw) -replace '"writtenAt":"[^"]*"', "`"writtenAt`":`"$now`"" | Set-Content (Join-Path $d 'snapshot.json') -Encoding utf8
Start-Process shell-ext-build/widgets/Release/null_widgets.exe
scripts/check-widgets.ps1 -Status
```

Expected: three cards in a column near the right edge of the primary monitor, with the fixture's rows and "updated 4 min ago"; `-Status` lists three `NullWidgetsWindow` entries with a z-index directly above `Progman` (one less than Progman's, then two less, …). Press Win+D: the cards stay. Then run the items of `scripts/check-widgets.ps1 -Checklist` that need only the exe (4's click-through for issues/PRs, 5, 6, 7, 8, 9). Clean up: `Stop-Process -Name null_widgets; Remove-Item $d -Recurse`.

- [ ] **Step 6: Commit**

```bash
git add shell-ext/widgets scripts/check-widgets.ps1
git commit -m "feat(widgets): the desktop widgets host and its check script (#141)"
```

---

### Task 7: Ship `null_widgets.exe` from CI and `build-local.ps1`

**Files:**
- Modify: `.github/workflows/build.yml` (step "Build Win11 shell extension")
- Modify: `scripts/build-local.ps1` (the shell-ext section)

- [ ] **Step 1: CI — run the tests and put the exe next to `null.exe`**

In `.github/workflows/build.yml`, in the step `Build Win11 shell extension`, directly after the line `Copy-Item "shell-ext-build/Release/null_identity_stub.exe" $pkgDir -Force` add:

```powershell
          # ── 2b. Desktop widgets host: run its tests, ship it next to null.exe ──
          ctest --test-dir shell-ext-build -C Release --output-on-failure
          if ($LASTEXITCODE -ne 0) { Write-Error "widget tests failed with exit code $LASTEXITCODE"; exit $LASTEXITCODE }
          Copy-Item "shell-ext-build/widgets/Release/null_widgets.exe" $outDir -Force
          Write-Host "null_widgets.exe: $((Get-Item "$outDir/null_widgets.exe").Length) bytes"
```

(`$outDir` is `VSCode-win32-x64`, the install root that becomes the release zip; the exe is unsigned like `null.exe`.)

- [ ] **Step 2: `build-local.ps1` — the same two things**

In `scripts/build-local.ps1`, directly after the line `Copy-Item (Join-Path $shellExtBuild "Release/null_identity_stub.exe") $pkgDir -Force` add:

```powershell
    # Desktop widgets host: tests, then next to null.exe.
    Invoke-Native "ctest (widgets)" { ctest --test-dir $shellExtBuild -C Release --output-on-failure }
    Copy-Item (Join-Path $shellExtBuild "widgets/Release/null_widgets.exe") $OutDir -Force
```

- [ ] **Step 3: Verify the YAML and the local script parse**

```powershell
node -e "const y=require('fs').readFileSync('.github/workflows/build.yml','utf8'); if(!y.includes('null_widgets.exe')) process.exit(1)"
$null = [System.Management.Automation.Language.Parser]::ParseFile("$PWD/scripts/build-local.ps1", [ref]$null, [ref]$errs); $errs
```

Expected: no output from the second command (no parse errors). The real proof is the next CI run (or `scripts/build-local.ps1`, only when asked: it takes tens of minutes): `VSCode-win32-x64/null_widgets.exe` exists and the CTest step is green.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/build.yml scripts/build-local.ps1
git commit -m "ci(widgets): test null_widgets.exe and ship it in the install root (#141)"
```

---

### Task 8: GraphQL queries, search strings and row mappers (null-tools)

**Files:**
- Create: `extensions/null-tools/src/widgets/widgetTypes.ts`
- Create: `extensions/null-tools/src/widgets/widgetQueries.ts`
- Create: `extensions/null-tools/src/widgets/widgetQueries.test.ts`
- Modify: `extensions/null-tools/src/pulls/pullModel.ts` (export `REVIEWS`)
- Modify: `extensions/null-tools/package.json` (add `out/widgets/widgetQueries.test.js` to `test`) and `tsconfig.json` (add `"src/widgets/widgetQueries.test.ts"` to `include`)

**Interfaces:**
- Consumes: `checkStateOf`, `REVIEWS`, `CheckState`, `ReviewState` from `../pulls/pullModel`.
- Produces (`widgetTypes.ts`):

```ts
export const SCHEMA = 1;
export const MAX_PROJECTS = 8, MAX_ISSUES = 10, MAX_PRS = 10;
export type Reason = 'signed_out' | 'offline' | 'error';
export type Status = 'ok' | Reason;
export interface Failed { repo: string; reason: Reason }
export interface Section<T> { status: Status; failed: Failed[]; items: T[] }
export interface ProjectRow { name: string; path: string; branch: string | null; dirty: boolean; pinned: boolean; lastOpened: string | null }
export interface IssueRow { provider: 'github'; repo: string; number: number; title: string; url: string; state: 'open'; labels: string[]; assignee: string | null; attention: 'assigned' | 'mentioned'; localPath: string | null; updatedAt: string }
export interface PrRow { provider: 'github'; repo: string; number: number; title: string; url: string; author: string; review: 'requested' | 'approved' | 'changes' | 'none'; checks: 'passing' | 'failing' | 'pending' | 'none'; conflict: boolean; localPath: string | null; updatedAt: string }
export interface Snapshot { schema: 1; writtenAt: string; projects: Section<ProjectRow>; issues: Section<IssueRow>; prs: Section<PrRow> }
export interface WidgetRepo { repo: string; account: string }
export const REPO_RE: RegExp;                    // /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
export function parseRepos(raw: unknown): WidgetRepo[];   // drops malformed, de-duplicates (case-insensitive repo+account)
```

`widgetQueries.ts`:

```ts
export const WIDGET_QUERY: string;
export interface SearchStrings { assigned: string; mentioned: string; authored: string; reviewReq: string }
export function searchStrings(repos: string[]): SearchStrings;
export function chunkRepos(repos: string[], maxScopeChars?: number): string[][];     // default 150
export type LocalPaths = ReadonlyMap<string, string>;                                  // lowercase "owner/repo" -> checkout path
export interface WidgetData { assigned: Nodes; mentioned: Nodes; authored: Nodes; reviewReq: Nodes }
export function mapIssues(data: WidgetData, local: LocalPaths): IssueRow[];
export function mapPrs(data: WidgetData, local: LocalPaths): PrRow[];
export function rankIssues(rows: IssueRow[]): IssueRow[];
export function rankPrs(rows: PrRow[]): PrRow[];
```

- [ ] **Step 1: Write the failing tests**

`extensions/null-tools/src/widgets/widgetQueries.test.ts`:

```ts
import assert from 'node:assert';
import test from 'node:test';
import { parseRepos, REPO_RE } from './widgetTypes';
import { WIDGET_QUERY, WidgetData, chunkRepos, mapIssues, mapPrs, rankIssues, rankPrs, searchStrings } from './widgetQueries';

const pr = (over: Record<string, unknown>) => ({
  number: 1, title: 't', url: 'https://github.com/o/r/pull/1', updatedAt: '2026-10-21T10:00:00Z', isDraft: false,
  mergeable: 'MERGEABLE', reviewDecision: null, repository: { nameWithOwner: 'o/r' }, author: { login: 'me' },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, ...over,
});
const issue = (over: Record<string, unknown>) => ({
  number: 1, title: 'i', url: 'https://github.com/o/r/issues/1', updatedAt: '2026-10-21T10:00:00Z',
  repository: { nameWithOwner: 'o/r' }, labels: { nodes: [{ name: 'bug' }] }, assignees: { nodes: [{ login: 'me' }] }, ...over,
});
const data = (d: Partial<Record<keyof WidgetData, unknown[]>>): WidgetData => ({
  assigned: { nodes: d.assigned ?? [] }, mentioned: { nodes: d.mentioned ?? [] },
  authored: { nodes: d.authored ?? [] }, reviewReq: { nodes: d.reviewReq ?? [] },
}) as unknown as WidgetData;

test('parseRepos keeps only well-formed owner/name entries and de-duplicates', () => {
  const out = parseRepos([
    { repo: 'a/b', account: 'x' }, { repo: 'A/B', account: 'x' },          // duplicate, different case
    { repo: 'a/b is:private', account: 'x' }, { repo: '../x', account: 'x' }, { repo: 'a/b', account: '' },
    { repo: 5, account: 'x' }, null, 'a/b', { repo: 'c/d', account: 'y' },
  ]);
  assert.deepStrictEqual(out, [{ repo: 'a/b', account: 'x' }, { repo: 'c/d', account: 'y' }]);
  assert.deepStrictEqual(parseRepos('nope'), []);
  assert.ok(REPO_RE.test('o/r.js-x_1') && !REPO_RE.test('o/r/x') && !REPO_RE.test('o /r'));
});

test('search strings scope to the repos and use the viewer qualifiers from the spec', () => {
  const s = searchStrings(['a/b', 'c/d']);
  assert.strictEqual(s.assigned, 'repo:a/b repo:c/d is:issue is:open assignee:@me sort:updated-desc');
  assert.ok(s.mentioned.includes('mentions:@me') && s.authored.includes('is:pr is:open author:@me') && s.reviewReq.includes('review-requested:@me'));
  assert.ok(WIDGET_QUERY.includes('mergeable') && WIDGET_QUERY.includes('reviewDecision'));
});

test('chunking keeps every search under GitHub\'s 256 character limit', () => {
  const repos = Array.from({ length: 12 }, (_, i) => `organisation/repository-${i}`);
  const chunks = chunkRepos(repos);
  assert.deepStrictEqual(chunks.flat(), repos);
  for (const c of chunks) for (const q of Object.values(searchStrings(c))) assert.ok(q.length <= 256, `${q.length}`);
  const longest = `${'o'.repeat(100)}/${'r'.repeat(100)}`;
  assert.deepStrictEqual(chunkRepos([longest, 'a/b']), [[longest], ['a/b']]);   // an over-budget repo gets a chunk of its own
});

test('issues: assigned wins over mentioned, duplicates collapse, local checkout is attached', () => {
  const rows = mapIssues(data({ assigned: [issue({ number: 1 })], mentioned: [issue({ number: 1 }), issue({ number: 2, assignees: { nodes: [] } })] }),
    new Map([['o/r', 'D:\\code\\r']]));
  assert.deepStrictEqual(rows.map(r => [r.number, r.attention, r.assignee, r.localPath]), [[1, 'assigned', 'me', 'D:\\code\\r'], [2, 'mentioned', null, 'D:\\code\\r']]);
  assert.deepStrictEqual(rows[0].labels, ['bug']);
  assert.strictEqual(mapIssues(data({ assigned: [{}] }), new Map()).length, 0);              // search noise ({}) is skipped
});

test('PRs: review requested of the viewer, drafts of others dropped, checks and conflicts mapped', () => {
  const rows = mapPrs(data({
    authored: [pr({ number: 1, isDraft: true, mergeable: 'CONFLICTING', reviewDecision: 'CHANGES_REQUESTED',
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } })],
    reviewReq: [pr({ number: 2, author: { login: 'sam' } }), pr({ number: 3, isDraft: true, author: { login: 'sam' } }), pr({ number: 1 })],
  }), new Map());
  assert.deepStrictEqual(rows.map(r => r.number), [1, 2]);                                   // own draft kept, sam's draft dropped, #1 once
  const p1 = rows.find(r => r.number === 1)!, p2 = rows.find(r => r.number === 2)!;
  assert.deepStrictEqual([p1.review, p1.checks, p1.conflict], ['requested', 'failing', true]);   // requested overrides CHANGES_REQUESTED
  assert.deepStrictEqual([p2.review, p2.checks, p2.conflict, p2.author], ['requested', 'passing', false, 'sam']);
  const own = mapPrs(data({ authored: [pr({ reviewDecision: 'APPROVED' })] }), new Map())[0];
  assert.strictEqual(own.review, 'approved');
  assert.strictEqual(mapPrs(data({ authored: [pr({ reviewDecision: 'REVIEW_REQUIRED', commits: { nodes: [] } })] }), new Map())[0].review, 'none');
});

test('PR ranking: review requested, then changes requested, failing checks, conflicts, then recency', () => {
  const mk = (n: number, o: Partial<ReturnType<typeof mapPrs>[number]>) => ({ provider: 'github', repo: 'o/r', number: n, title: '', url: '', author: 'me', review: 'none',
    checks: 'passing', conflict: false, localPath: null, updatedAt: `2026-10-21T0${n}:00:00Z`, ...o }) as ReturnType<typeof mapPrs>[number];
  const ranked = rankPrs([mk(1, {}), mk(2, { conflict: true }), mk(3, { checks: 'failing' }), mk(4, { review: 'changes' }), mk(5, { review: 'requested' }), mk(6, {})]);
  assert.deepStrictEqual(ranked.map(r => r.number), [5, 4, 3, 2, 6, 1]);
});

test('issue ranking: assigned before mentioned, newest first inside each', () => {
  const mk = (n: number, a: 'assigned' | 'mentioned') => ({ provider: 'github', repo: 'o/r', number: n, title: '', url: '', state: 'open', labels: [], assignee: null,
    attention: a, localPath: null, updatedAt: `2026-10-21T0${n}:00:00Z` }) as ReturnType<typeof mapIssues>[number];
  assert.deepStrictEqual(rankIssues([mk(1, 'mentioned'), mk(2, 'assigned'), mk(3, 'mentioned'), mk(4, 'assigned')]).map(r => r.number), [4, 2, 3, 1]);
});
```

Register the test: add `out/widgets/widgetQueries.test.js` to the `test` script's `node --test` list and `"src/widgets/widgetQueries.test.ts"` to `tsconfig.json`'s `include`.

- [ ] **Step 2: Run to verify failure**

Run: `cd extensions/null-tools && npm test`
Expected: FAIL — `Cannot find module './widgetTypes'` (tsc error).

- [ ] **Step 3: Implement**

In `pulls/pullModel.ts` change `const REVIEWS` to `export const REVIEWS`.

`widgetTypes.ts` — the types above plus:

```ts
'use strict';

export const SCHEMA = 1;
export const MAX_PROJECTS = 8;
export const MAX_ISSUES = 10;
export const MAX_PRS = 10;
// … interfaces exactly as listed under Interfaces …

export const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/** The only gate between a settings value and a GitHub search string. */
export function parseRepos(raw: unknown): WidgetRepo[] {
  if (!Array.isArray(raw)) { return []; }
  const seen = new Set<string>();
  const out: WidgetRepo[] = [];
  for (const e of raw) {
    const repo = (e as WidgetRepo | null)?.repo, account = (e as WidgetRepo | null)?.account;
    if (typeof repo !== 'string' || typeof account !== 'string' || !account || !REPO_RE.test(repo)) { continue; }
    const key = `${account}\n${repo.toLowerCase()}`;
    if (seen.has(key)) { continue; }
    seen.add(key);
    out.push({ repo, account });
  }
  return out;
}
```

`widgetQueries.ts`:

```ts
'use strict';

import { CheckState, checkStateOf, REVIEWS } from '../pulls/pullModel';
import { IssueRow, PrRow } from './widgetTypes';

export const WIDGET_QUERY = `
query WidgetItems($assigned: String!, $mentioned: String!, $authored: String!, $reviewReq: String!, $n: Int!) {
  assigned: search(query: $assigned, type: ISSUE, first: $n) { nodes { ...IssueFields } }
  mentioned: search(query: $mentioned, type: ISSUE, first: $n) { nodes { ...IssueFields } }
  authored: search(query: $authored, type: ISSUE, first: $n) { nodes { ...PrFields } }
  reviewReq: search(query: $reviewReq, type: ISSUE, first: $n) { nodes { ...PrFields } }
}
fragment IssueFields on Issue {
  number title url updatedAt repository { nameWithOwner }
  labels(first: 5) { nodes { name } } assignees(first: 1) { nodes { login } }
}
fragment PrFields on PullRequest {
  number title url updatedAt isDraft mergeable reviewDecision repository { nameWithOwner } author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

export interface SearchStrings { assigned: string; mentioned: string; authored: string; reviewReq: string }

export function searchStrings(repos: string[]): SearchStrings {
  const scope = repos.map(r => `repo:${r}`).join(' ');
  const q = (rest: string): string => `${scope} ${rest} sort:updated-desc`;
  return {
    assigned: q('is:issue is:open assignee:@me'),
    mentioned: q('is:issue is:open mentions:@me'),
    authored: q('is:pr is:open author:@me'),
    reviewReq: q('is:pr is:open review-requested:@me'),
  };
}

/** GitHub rejects search queries over 256 characters; the longest suffix above is under 50, so the `repo:` scope gets 150. */
export function chunkRepos(repos: string[], maxScopeChars = 150): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [], len = 0;
  for (const r of repos) {
    const add = r.length + 6;                                   // "repo:" + space
    if (cur.length && len + add > maxScopeChars) { chunks.push(cur); cur = []; len = 0; }
    cur.push(r); len += add;
  }
  if (cur.length) { chunks.push(cur); }
  return chunks;
}

export type LocalPaths = ReadonlyMap<string, string>;
interface Nodes { nodes: Array<Record<string, unknown>> }
export interface WidgetData { assigned: Nodes; mentioned: Nodes; authored: Nodes; reviewReq: Nodes }

interface GqlIssue { number: number; title: string; url: string; updatedAt: string; repository: { nameWithOwner: string };
  labels: { nodes: Array<{ name: string }> }; assignees: { nodes: Array<{ login: string }> } }
interface GqlPr { number: number; title: string; url: string; updatedAt: string; isDraft: boolean; mergeable: string; reviewDecision: string | null;
  repository: { nameWithOwner: string }; author: { login: string } | null;
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> } }

const isNode = (n: Record<string, unknown>): boolean => typeof n.number === 'number';
const CHECKS: Record<CheckState, PrRow['checks']> = { success: 'passing', failure: 'failing', pending: 'pending', none: 'none' };

export function mapIssues(data: WidgetData, local: LocalPaths): IssueRow[] {
  const out = new Map<string, IssueRow>();
  const add = (nodes: Nodes['nodes'], attention: IssueRow['attention']): void => {
    for (const raw of nodes) {
      if (!isNode(raw)) { continue; }
      const n = raw as unknown as GqlIssue;
      const repo = n.repository.nameWithOwner, key = `${repo.toLowerCase()}#${n.number}`;
      if (out.has(key)) { continue; }
      out.set(key, { provider: 'github', repo, number: n.number, title: n.title, url: n.url, state: 'open',
        labels: n.labels.nodes.map(l => l.name), assignee: n.assignees.nodes[0]?.login ?? null, attention,
        localPath: local.get(repo.toLowerCase()) ?? null, updatedAt: n.updatedAt });
    }
  };
  add(data.assigned.nodes, 'assigned');
  add(data.mentioned.nodes, 'mentioned');
  return [...out.values()];
}

export function mapPrs(data: WidgetData, local: LocalPaths): PrRow[] {
  const requested = new Set<string>();
  for (const raw of data.reviewReq.nodes) {
    if (!isNode(raw)) { continue; }
    const n = raw as unknown as GqlPr;
    if (!n.isDraft) { requested.add(`${n.repository.nameWithOwner.toLowerCase()}#${n.number}`); }   // others' drafts are not asked of anyone yet
  }
  const out = new Map<string, PrRow>();
  const add = (nodes: Nodes['nodes'], ownSet: boolean): void => {
    for (const raw of nodes) {
      if (!isNode(raw)) { continue; }
      const n = raw as unknown as GqlPr;
      const repo = n.repository.nameWithOwner, key = `${repo.toLowerCase()}#${n.number}`;
      if (out.has(key) || (!ownSet && n.isDraft)) { continue; }
      const decision = REVIEWS[n.reviewDecision ?? ''] ?? 'none';
      out.set(key, { provider: 'github', repo, number: n.number, title: n.title, url: n.url, author: n.author?.login ?? 'ghost',
        review: requested.has(key) ? 'requested' : decision === 'required' ? 'none' : decision,
        checks: CHECKS[checkStateOf(n.commits.nodes[0]?.commit.statusCheckRollup?.state)], conflict: n.mergeable === 'CONFLICTING',
        localPath: local.get(repo.toLowerCase()) ?? null, updatedAt: n.updatedAt });
    }
  };
  add(data.authored.nodes, true);
  add(data.reviewReq.nodes, false);
  return [...out.values()];
}

const newest = (a: { updatedAt: string }, b: { updatedAt: string }): number => b.updatedAt.localeCompare(a.updatedAt);

export function rankIssues(rows: IssueRow[]): IssueRow[] {
  const w = (r: IssueRow): number => (r.attention === 'assigned' ? 0 : 1);
  return [...rows].sort((a, b) => w(a) - w(b) || newest(a, b));
}

export function rankPrs(rows: PrRow[]): PrRow[] {
  const w = (r: PrRow): number => r.review === 'requested' ? 0 : r.review === 'changes' ? 1 : r.checks === 'failing' ? 2 : r.conflict ? 3 : 4;
  return [...rows].sort((a, b) => w(a) - w(b) || newest(a, b));
}
```

Note the draft rule: the reviewReq pass skips drafts (`!ownSet && n.isDraft`), but a draft the viewer authored arrives through the `authored` pass first and is kept.

- [ ] **Step 4: Run to verify it passes**

Run: `cd extensions/null-tools && npm test`
Expected: PASS, including the existing suites.

- [ ] **Step 5: Verify the query against real GitHub**

```bash
gh api graphql -f query="$(node -e "console.log(require('./extensions/null-tools/out/widgets/widgetQueries').WIDGET_QUERY)")" -f assigned='repo:TorresVisual/null-ide is:issue is:open assignee:@me sort:updated-desc' -f mentioned='repo:TorresVisual/null-ide is:issue is:open mentions:@me sort:updated-desc' -f authored='repo:TorresVisual/null-ide is:pr is:open author:@me sort:updated-desc' -f reviewReq='repo:TorresVisual/null-ide is:pr is:open review-requested:@me sort:updated-desc' -F n=5
```

Expected: a JSON `data` object with the four aliases and no `errors`. If `@me` is rejected in any of the four searches, replace it with the account's login in `searchStrings` (add a `login` parameter) and update the test strings — the spec's qualifiers are the intent, the login is equivalent.

- [ ] **Step 6: Compile output and commit**

```bash
cd extensions/null-tools && npm run compile && cd ../..
git add extensions/null-tools
git commit -m "feat(null-tools): widget queries, search strings and row mappers (#141)"
```

(Commit `out/` in the same commit only if the repo's `out/` is tracked for these files; otherwise follow the `chore: refresh null-tools compiled output` convention in a separate commit.)

---

### Task 9: Sections — partial failure, last-good rows, projects (pure)

**Files:**
- Create: `extensions/null-tools/src/widgets/widgetSections.ts`
- Create: `extensions/null-tools/src/widgets/widgetSections.test.ts`
- Modify: `package.json` test list, `tsconfig.json` include

**Interfaces:**
- Consumes: `Section`, `Reason`, `Failed`, `ProjectRow`, `MAX_PROJECTS` (Task 8); `RecentProjectEntry` from `../recentProjects`; `GitStatus` from `../dashboardGitStatus`.
- Produces:

```ts
export interface RepoOutcome<T> { repo: string; rows: T[] | null; reason?: Reason }   // rows === null: this repo failed this cycle
export function buildSection<T>(
  outcomes: RepoOutcome<T>[],
  previous: ReadonlyMap<string, T[]>,                    // last good rows per lowercase repo
  rank: (rows: T[]) => T[], max: number,
): { section: Section<T>; kept: Map<string, T[]> };      // kept = rows to remember per lowercase repo
export function buildProjects(
  entries: RecentProjectEntry[],
  statuses: ReadonlyMap<string, GitStatus | null>,        // key: entry.path
): Section<ProjectRow>;
```

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert';
import test from 'node:test';
import { buildProjects, buildSection } from './widgetSections';

const rank = (rows: number[]) => [...rows].sort((a, b) => a - b);

test('all repos ok: status ok, rows merged and ranked, capped', () => {
  const { section, kept } = buildSection([{ repo: 'a/b', rows: [5, 1] }, { repo: 'c/d', rows: [3] }], new Map(), rank, 2);
  assert.deepStrictEqual(section, { status: 'ok', failed: [], items: [1, 3] });
  assert.deepStrictEqual([...kept.keys()].sort(), ['a/b', 'c/d']);
});

test('partial failure: status stays ok, the failed repo keeps its last good rows and is listed', () => {
  const previous = new Map([['c/d', [9]]]);
  const { section, kept } = buildSection([{ repo: 'a/b', rows: [1] }, { repo: 'C/D', rows: null, reason: 'offline' }], previous, rank, 10);
  assert.deepStrictEqual(section, { status: 'ok', failed: [{ repo: 'C/D', reason: 'offline' }], items: [1, 9] });
  assert.deepStrictEqual(kept.get('c/d'), [9]);
});

test('every repo failed with the same reason: the section takes that reason and keeps all rows', () => {
  const previous = new Map([['a/b', [2]], ['c/d', [4]]]);
  const { section } = buildSection([{ repo: 'a/b', rows: null, reason: 'signed_out' }, { repo: 'c/d', rows: null, reason: 'signed_out' }], previous, rank, 10);
  assert.strictEqual(section.status, 'signed_out');
  assert.deepStrictEqual(section.items, [2, 4]);
  assert.strictEqual(section.failed.length, 2);
});

test('every repo failed for different reasons: status is error', () => {
  const { section } = buildSection([{ repo: 'a/b', rows: null, reason: 'offline' }, { repo: 'c/d', rows: null, reason: 'signed_out' }], new Map(), rank, 10);
  assert.strictEqual(section.status, 'error');
});

test('a repo that is no longer configured drops its remembered rows', () => {
  const { section, kept } = buildSection([{ repo: 'a/b', rows: [1] }], new Map([['gone/x', [7]]]), rank, 10);
  assert.deepStrictEqual(section.items, [1]);
  assert.ok(!kept.has('gone/x'));
});

test('no repos configured is an empty ok section, not an error', () => {
  assert.deepStrictEqual(buildSection([], new Map(), rank, 10).section, { status: 'ok', failed: [], items: [] });
});

test('projects: pinned first, then newest, capped at 8, git status attached, ISO timestamps', () => {
  const e = (n: number, pinned = false) => ({ path: `D:\\p${n}`, label: `p${n}`, isWorkspaceFile: false, timestamp: Date.UTC(2026, 9, 21, n), pinned });
  const entries = [e(1), e(9), e(2, true), e(3), e(4), e(5), e(6), e(7), e(8)];
  const { items, status } = buildProjects(entries, new Map([['D:\\p2', { branch: 'main', dirty: true }], ['D:\\p9', null]]));
  assert.strictEqual(status, 'ok');
  assert.strictEqual(items.length, 8);
  assert.deepStrictEqual(items.slice(0, 3).map(p => p.name), ['p2', 'p9', 'p8']);
  assert.deepStrictEqual([items[0].branch, items[0].dirty, items[0].pinned, items[0].lastOpened], ['main', true, true, '2026-10-21T02:00:00.000Z']);
  assert.deepStrictEqual([items[1].branch, items[1].dirty], [null, false]);       // git failed: no branch, not dirty
});
```

Register in `package.json`/`tsconfig.json`.

- [ ] **Step 2: Run to verify failure**

Run: `cd extensions/null-tools && npm test`
Expected: FAIL — cannot find `./widgetSections`.

- [ ] **Step 3: Implement**

```ts
'use strict';

import type { GitStatus } from '../dashboardGitStatus';
import type { RecentProjectEntry } from '../recentProjects';
import { Failed, MAX_PROJECTS, ProjectRow, Reason, Section } from './widgetTypes';

export interface RepoOutcome<T> { repo: string; rows: T[] | null; reason?: Reason }

export function buildSection<T>(
  outcomes: RepoOutcome<T>[], previous: ReadonlyMap<string, T[]>, rank: (rows: T[]) => T[], max: number,
): { section: Section<T>; kept: Map<string, T[]> } {
  const kept = new Map<string, T[]>();
  const failed: Failed[] = [];
  for (const o of outcomes) {
    const key = o.repo.toLowerCase();
    if (o.rows) { kept.set(key, o.rows); continue; }
    kept.set(key, previous.get(key) ?? []);                               // keep the last good rows
    failed.push({ repo: o.repo, reason: o.reason ?? 'error' });
  }
  const items = rank([...kept.values()].flat()).slice(0, max);
  let status: Section<T>['status'] = 'ok';
  if (outcomes.length > 0 && failed.length === outcomes.length) {
    const reasons = new Set(failed.map(f => f.reason));
    status = reasons.size === 1 ? failed[0].reason : 'error';
  }
  return { section: { status, failed, items }, kept };
}

export function buildProjects(entries: RecentProjectEntry[], statuses: ReadonlyMap<string, GitStatus | null>): Section<ProjectRow> {
  const ordered = [...entries].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.timestamp - a.timestamp).slice(0, MAX_PROJECTS);
  const items = ordered.map((e): ProjectRow => {
    const git = statuses.get(e.path) ?? null;
    return { name: e.label, path: e.path, branch: git?.branch ?? null, dirty: git?.dirty ?? false, pinned: e.pinned, lastOpened: new Date(e.timestamp).toISOString() };
  });
  return { status: 'ok', failed: [], items };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd extensions/null-tools && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src extensions/null-tools/package.json extensions/null-tools/tsconfig.json
git commit -m "feat(null-tools): widget section building with last-good rows (#141)"
```

---

### Task 10: Atomic snapshot store and per-feature ownership claim

**Files:**
- Create: `extensions/null-tools/src/widgets/widgetStore.ts`, `widgetStore.test.ts`
- Modify: `extensions/null-tools/src/presenceOwnership.ts` (optional `claimFile`)
- Create: `extensions/null-tools/src/presenceOwnership.test.ts`
- Modify: `package.json` test list, `tsconfig.json` include (both new test files)

**Interfaces:**
- Produces:

```ts
// widgetStore.ts
export function widgetsDir(env?: NodeJS.ProcessEnv): string;               // %LOCALAPPDATA%\Null\widgets; throws without LOCALAPPDATA
export class SnapshotStore {
  constructor(dir: string);
  readonly file: string;                                                     // <dir>\snapshot.json
  write(snapshot: Snapshot): void;                                           // snapshot.json.tmp then rename; throws on failure
  remove(): void;                                                            // deletes snapshot.json and a leftover .tmp; ignores missing
}
// presenceOwnership.ts
constructor(storageDir: string | undefined, log?: LogFn, claimFile?: string)   // default 'discord-presence-owner.json'
```

- [ ] **Step 1: Write the failing tests**

`widgetStore.test.ts`:

```ts
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { SnapshotStore, widgetsDir } from './widgetStore';
import { Snapshot } from './widgetTypes';

const snap = (writtenAt: string): Snapshot => ({ schema: 1, writtenAt,
  projects: { status: 'ok', failed: [], items: [] }, issues: { status: 'ok', failed: [], items: [] }, prs: { status: 'ok', failed: [], items: [] } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-widgets-'));

test('write creates the folder, leaves no .tmp behind and round-trips', () => {
  const dir = path.join(tmp(), 'Null', 'widgets');
  const store = new SnapshotStore(dir);
  store.write(snap('2026-10-21T14:00:00Z'));
  assert.deepStrictEqual(fs.readdirSync(dir), ['snapshot.json']);
  assert.strictEqual(JSON.parse(fs.readFileSync(store.file, 'utf8')).writtenAt, '2026-10-21T14:00:00Z');
});

test('a second write replaces the first atomically (same file name, no partial state visible)', () => {
  const store = new SnapshotStore(tmp());
  store.write(snap('a')); store.write(snap('b'));
  assert.strictEqual(JSON.parse(fs.readFileSync(store.file, 'utf8')).writtenAt, 'b');
});

test('remove deletes the snapshot and a stale .tmp, and is fine when nothing exists', () => {
  const dir = tmp();
  const store = new SnapshotStore(dir);
  store.remove();
  fs.writeFileSync(path.join(dir, 'snapshot.json'), '{}');
  fs.writeFileSync(path.join(dir, 'snapshot.json.tmp'), '{');
  store.remove();
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('widgetsDir needs LOCALAPPDATA', () => {
  assert.strictEqual(widgetsDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' } as NodeJS.ProcessEnv), path.win32.join('C:\\Users\\u\\AppData\\Local', 'Null', 'widgets'));
  assert.throws(() => widgetsDir({} as NodeJS.ProcessEnv));
});
```

`presenceOwnership.test.ts` (uses a real child process for a live foreign pid and a finished one for a dead pid):

```ts
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { PresenceOwnership } from './presenceOwnership';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-own-'));
const claim = (dir: string, file: string, pid: number) => fs.writeFileSync(path.join(dir, file), JSON.stringify({ pid, focusedAt: Date.now() }));

test('the default claim file name is unchanged (Discord presence keeps working)', () => {
  const dir = tmp();
  new PresenceOwnership(dir).claim();
  assert.ok(fs.existsSync(path.join(dir, 'discord-presence-owner.json')));
});

test('a custom claim file is used and is independent of the Discord claim', () => {
  const dir = tmp();
  const widgets = new PresenceOwnership(dir, undefined, 'widgets-owner.json');
  widgets.claim();
  assert.ok(fs.existsSync(path.join(dir, 'widgets-owner.json')) && !fs.existsSync(path.join(dir, 'discord-presence-owner.json')));
  widgets.release();
  assert.ok(!fs.existsSync(path.join(dir, 'widgets-owner.json')));
});

test('a live foreign owner keeps ownership; a dead owner is taken over', async () => {
  const dir = tmp();
  const live = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 20000)'], { stdio: 'ignore' });
  try {
    claim(dir, 'widgets-owner.json', live.pid!);
    assert.strictEqual(new PresenceOwnership(dir, undefined, 'widgets-owner.json').isOwner(), false);
  } finally { live.kill(); }
  const dead = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise(r => dead.on('exit', r));
  claim(dir, 'widgets-owner.json', dead.pid!);
  const mine = new PresenceOwnership(dir, undefined, 'widgets-owner.json');
  assert.strictEqual(mine.isOwner(), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'widgets-owner.json'), 'utf8')).pid, process.pid);
});
```

Register both (`out/widgets/widgetStore.test.js`, `out/presenceOwnership.test.js`) in `package.json` and `tsconfig.json`.

- [ ] **Step 2: Run to verify failure**

Run: `cd extensions/null-tools && npm test`
Expected: FAIL — `./widgetStore` missing; and a TS error for the 3-argument `PresenceOwnership` constructor.

- [ ] **Step 3: Implement**

`presenceOwnership.ts`: rename the constant to `DEFAULT_CLAIM_FILE`, change the constructor to
`constructor(storageDir: string | undefined, private readonly log: LogFn = () => undefined, claimFile: string = DEFAULT_CLAIM_FILE)` and use `claimFile` where `CLAIM_FILE` was (`this.file = path.join(storageDir, claimFile)`). Nothing else changes.

`widgetStore.ts`:

```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { Snapshot } from './widgetTypes';

/** %LOCALAPPDATA%\Null\widgets. Local (not roaming): the file is derived data and the widgets host is per machine. */
export function widgetsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.LOCALAPPDATA) { throw new Error('Cannot locate %LOCALAPPDATA%.'); }
  return path.win32.join(env.LOCALAPPDATA, 'Null', 'widgets');
}

export class SnapshotStore {
  readonly file: string;
  private readonly tmp: string;
  constructor(private readonly dir: string) {
    this.file = path.join(dir, 'snapshot.json');
    this.tmp = `${this.file}.tmp`;
  }

  /** Write-then-rename, so null_widgets.exe never reads a torn file. Only the owning window writes, so one fixed .tmp name is enough. */
  write(snapshot: Snapshot): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.tmp, JSON.stringify(snapshot), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }

  remove(): void {
    for (const f of [this.file, this.tmp]) {
      try { fs.unlinkSync(f); } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') { throw err; } }
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd extensions/null-tools && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src extensions/null-tools/package.json extensions/null-tools/tsconfig.json
git commit -m "feat(null-tools): atomic widget snapshot store and ownership claim file (#141)"
```

---

### Task 11: Fetching per account (no `vscode` import)

**Files:**
- Create: `extensions/null-tools/src/widgets/widgetFetch.ts`, `widgetFetch.test.ts`
- Modify: `package.json` test list, `tsconfig.json` include

**Interfaces:**
- Consumes: `WIDGET_QUERY`, `searchStrings`, `chunkRepos`, `mapIssues`, `mapPrs`, `WidgetData`, `LocalPaths` (Task 8); `ApiError` from `../github/githubApi`; `IssueRow`, `PrRow`, `Reason`.
- Produces:

```ts
export type RepoResult =
  | { repo: string; issues: IssueRow[]; prs: PrRow[] }
  | { repo: string; reason: Reason; retryAt?: number | null };
export interface FetchDeps {
  /** Silent token for an account id, undefined when signed out. Never prompts. */
  token(accountId: string): Promise<string | undefined>;
  graphql<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T>;
  localPaths(): LocalPaths;
}
export function classifyError(err: unknown): { reason: Reason; retryAt: number | null };
export async function fetchRepos(deps: FetchDeps, accountId: string, repos: string[]): Promise<RepoResult[]>;
```

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert';
import test from 'node:test';
import { ApiError } from '../github/githubApi';
import { classifyError, fetchRepos, FetchDeps } from './widgetFetch';

const issue = (repo: string, n: number) => ({ number: n, title: 't', url: `https://github.com/${repo}/issues/${n}`, updatedAt: '2026-10-21T10:00:00Z',
  repository: { nameWithOwner: repo }, labels: { nodes: [] }, assignees: { nodes: [] } });
const empty = { nodes: [] };

function deps(over: Partial<FetchDeps> = {}): FetchDeps & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return { calls, token: async () => 'tok', localPaths: () => new Map(),
    graphql: (async (_q: string, vars: Record<string, unknown>) => { calls.push(vars);
      return { assigned: { nodes: [issue('a/b', 1), issue('c/d', 2)] }, mentioned: empty, authored: empty, reviewReq: empty }; }) as FetchDeps['graphql'], ...over };
}

test('no token means every repo is signed_out and nothing is requested', async () => {
  const d = deps({ token: async () => undefined });
  assert.deepStrictEqual(await fetchRepos(d, 'acc', ['a/b', 'c/d']), [{ repo: 'a/b', reason: 'signed_out' }, { repo: 'c/d', reason: 'signed_out' }]);
  assert.strictEqual(d.calls.length, 0);
});

test('one request covers the repos and rows are split back per repo (case-insensitive)', async () => {
  const d = deps();
  const out = await fetchRepos(d, 'acc', ['A/b', 'c/d', 'e/f']);
  assert.strictEqual(d.calls.length, 1);
  assert.strictEqual(d.calls[0].n, 20);
  assert.ok(String(d.calls[0].assigned).startsWith('repo:A/b repo:c/d repo:e/f '));
  assert.deepStrictEqual(out.map(r => [r.repo, 'issues' in r ? r.issues.length : -1]), [['A/b', 1], ['c/d', 1], ['e/f', 0]]);
});

test('a failing chunk marks only its repos; other chunks still succeed', async () => {
  const repos = Array.from({ length: 12 }, (_, i) => `organisation/repository-${i}`);
  let n = 0;
  const d = deps({ graphql: (async () => { if (n++ === 0) throw new ApiError('boom', 500); return { assigned: empty, mentioned: empty, authored: empty, reviewReq: empty }; }) as FetchDeps['graphql'] });
  const out = await fetchRepos(d, 'acc', repos);
  assert.ok(out.some(r => 'reason' in r && r.reason === 'error') && out.some(r => 'issues' in r));
  assert.strictEqual(out.length, 12);
});

test('error classification', () => {
  assert.deepStrictEqual(classifyError(new ApiError('Bad credentials', 401)), { reason: 'signed_out', retryAt: null });
  assert.deepStrictEqual(classifyError(new ApiError('rate', 403, 1234)), { reason: 'error', retryAt: 1234 });
  assert.deepStrictEqual(classifyError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })), { reason: 'offline', retryAt: null });
  assert.deepStrictEqual(classifyError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })), { reason: 'offline', retryAt: null });
  assert.deepStrictEqual(classifyError(new Error('whatever')), { reason: 'error', retryAt: null });
});
```

Register in `package.json`/`tsconfig.json`.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (`./widgetFetch` missing).

- [ ] **Step 3: Implement**

```ts
'use strict';

import { ApiError } from '../github/githubApi';
import { WIDGET_QUERY, WidgetData, LocalPaths, chunkRepos, mapIssues, mapPrs, searchStrings } from './widgetQueries';
import { IssueRow, PrRow, Reason } from './widgetTypes';

export type RepoResult =
  | { repo: string; issues: IssueRow[]; prs: PrRow[] }
  | { repo: string; reason: Reason; retryAt?: number | null };

export interface FetchDeps {
  token(accountId: string): Promise<string | undefined>;
  graphql<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T>;
  localPaths(): LocalPaths;
}

const OFFLINE = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);
const PER_SEARCH = 20;                                    // comfortably above the row maxima after merging and de-duplicating

export function classifyError(err: unknown): { reason: Reason; retryAt: number | null } {
  if (err instanceof ApiError) {
    if (err.retryAt !== null) { return { reason: 'error', retryAt: err.retryAt }; }
    return { reason: err.status === 401 ? 'signed_out' : 'error', retryAt: null };
  }
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return { reason: code && OFFLINE.has(code) ? 'offline' : 'error', retryAt: null };
}

export async function fetchRepos(deps: FetchDeps, accountId: string, repos: string[]): Promise<RepoResult[]> {
  const token = await deps.token(accountId);
  if (!token) { return repos.map(repo => ({ repo, reason: 'signed_out' as const })); }
  const local = deps.localPaths();
  const results: RepoResult[] = [];
  for (const chunk of chunkRepos(repos)) {
    try {
      const data = await deps.graphql<WidgetData>(WIDGET_QUERY, { ...searchStrings(chunk), n: PER_SEARCH }, token);
      const issues = mapIssues(data, local), prs = mapPrs(data, local);
      for (const repo of chunk) {
        const key = repo.toLowerCase();
        results.push({ repo, issues: issues.filter(i => i.repo.toLowerCase() === key), prs: prs.filter(p => p.repo.toLowerCase() === key) });
      }
    } catch (err) {
      const { reason, retryAt } = classifyError(err);
      for (const repo of chunk) { results.push({ repo, reason, retryAt }); }
    }
  }
  return results;
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src extensions/null-tools/package.json extensions/null-tools/tsconfig.json
git commit -m "feat(null-tools): per-account widget fetch with error classification (#141)"
```

---

### Task 12: The refresher — ownership, timers, backoff, disable

**Files:**
- Create: `extensions/null-tools/src/widgets/widgetRefresher.ts`, `widgetRefresher.test.ts`
- Modify: `package.json` test list, `tsconfig.json` include

**Interfaces:**
- Consumes: `RepoResult`, `RepoOutcome`/`buildSection`, `rankIssues`, `rankPrs`, `Snapshot`, `Section`, `ProjectRow`, `IssueRow`, `PrRow`, `WidgetRepo`, `MAX_ISSUES`, `MAX_PRS`.
- Produces:

```ts
export const REFRESH_MS = 10 * 60_000;
export const TICK_MS = 60_000;
export const MAX_BACKOFF_MS = 60 * 60_000;
export const FOCUS_REFRESH_MIN_MS = 60_000;
export interface RefresherDeps {
  now(): number;
  settings(): { enabled: boolean; repos: WidgetRepo[] };
  ownership: { isOwner(): boolean; claim(): void; release(): void };
  fetch(accountId: string, repos: string[]): Promise<RepoResult[]>;
  projects(): Promise<Section<ProjectRow>>;
  store: { write(s: Snapshot): void; remove(): void };
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  log(message: string): void;
}
export class WidgetRefresher {
  constructor(deps: RefresherDeps);
  start(): void;                       // schedules the 60 s tick
  setFocused(focused: boolean): void;  // focus: claim + refresh (throttled by FOCUS_REFRESH_MIN_MS)
  refresh(): Promise<void>;            // manual / due refresh; disabled => removes the file
  onConfigChanged(): void;             // rewrites immediately from remembered rows (no fetch), then refreshes in the background
  dispose(): void;                     // final write if this window owns the snapshot, release ownership
}
```

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert';
import test from 'node:test';
import { ApiError } from '../github/githubApi';
import { WidgetRefresher, RefresherDeps, REFRESH_MS, TICK_MS } from './widgetRefresher';
import { IssueRow, Snapshot, WidgetRepo } from './widgetTypes';
import { RepoResult } from './widgetFetch';

const row = (repo: string, n: number): IssueRow => ({ provider: 'github', repo, number: n, title: 't', url: '', state: 'open', labels: [], assignee: null, attention: 'assigned', localPath: null, updatedAt: '2026-10-21T10:00:00Z' });

function harness(over: { enabled?: boolean; repos?: WidgetRepo[]; owner?: boolean; fetch?: RefresherDeps['fetch'] } = {}) {
  let clock = Date.parse('2026-10-21T10:00:00Z');
  const writes: Snapshot[] = [];
  const state = { enabled: over.enabled ?? true, repos: over.repos ?? [{ repo: 'a/b', account: 'x' }], owner: over.owner ?? true, removed: 0, released: 0, claimed: 0, fetches: 0 };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const deps: RefresherDeps = {
    now: () => clock,
    settings: () => ({ enabled: state.enabled, repos: state.repos }),
    ownership: { isOwner: () => state.owner, claim: () => { state.claimed++; }, release: () => { state.released++; } },
    fetch: over.fetch ?? (async (_a, repos) => { state.fetches++; return repos.map((repo): RepoResult => ({ repo, issues: [row(repo, 1)], prs: [] })); }),
    projects: async () => ({ status: 'ok', failed: [], items: [] }),
    store: { write: s => writes.push(s), remove: () => { state.removed++; } },
    setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimeout: () => undefined, log: () => undefined,
  };
  return { r: new WidgetRefresher(deps), writes, state, timers, advance: (ms: number) => { clock += ms; } };
}

test('disabled: removes the snapshot, never fetches or writes', async () => {
  const h = harness({ enabled: false });
  await h.r.refresh();
  assert.strictEqual(h.state.removed, 1); assert.strictEqual(h.writes.length, 0); assert.strictEqual(h.state.fetches, 0);
});

test('a non-owner window does not fetch or write', async () => {
  const h = harness({ owner: false });
  await h.r.refresh();
  assert.strictEqual(h.state.fetches, 0); assert.strictEqual(h.writes.length, 0);
});

test('an owner cycle writes ok sections with the fetched rows and an ISO timestamp', async () => {
  const h = harness();
  await h.r.refresh();
  assert.strictEqual(h.writes.length, 1);
  const s = h.writes[0];
  assert.deepStrictEqual([s.schema, s.issues.status, s.issues.items.length, s.writtenAt], [1, 'ok', 1, '2026-10-21T10:00:00.000Z']);
});

test('partial failure keeps the failed repo\'s previous rows and lists it', async () => {
  const repos = [{ repo: 'a/b', account: 'x' }, { repo: 'c/d', account: 'x' }];
  let call = 0;
  const h = harness({ repos, fetch: async (_a, rs) => rs.map((repo): RepoResult =>
    (call++ >= 2 && repo === 'c/d') ? { repo, reason: 'error' } : { repo, issues: [row(repo, 1)], prs: [] }) });
  await h.r.refresh(); h.advance(REFRESH_MS); await h.r.refresh();
  const s = h.writes[1];
  assert.strictEqual(s.issues.status, 'ok');
  assert.deepStrictEqual(s.issues.failed, [{ repo: 'c/d', reason: 'error' }]);
  assert.strictEqual(s.issues.items.length, 2);                                   // c/d's old row survived
});

test('signed out: rows stay, status signed_out, nothing deleted', async () => {
  let ok = true;
  const h = harness({ fetch: async (_a, rs) => rs.map((repo): RepoResult => ok ? { repo, issues: [row(repo, 1)], prs: [] } : { repo, reason: 'signed_out' }) });
  await h.r.refresh(); ok = false; h.advance(REFRESH_MS); await h.r.refresh();
  assert.deepStrictEqual([h.writes[1].issues.status, h.writes[1].issues.items.length], ['signed_out', 1]);
  assert.strictEqual(h.state.removed, 0);
});

test('a rate limit suspends fetching until retryAt', async () => {
  let fetches = 0;
  const h = harness({ fetch: async (_a, rs) => { fetches++; return rs.map((repo): RepoResult => ({ repo, reason: 'error', retryAt: Date.parse('2026-10-21T10:30:00Z') })); } });
  await h.r.refresh();
  h.advance(REFRESH_MS); await h.r.refresh();                                      // 10:10, still suspended
  assert.strictEqual(fetches, 1);
  h.advance(25 * 60_000); await h.r.refresh();                                     // 10:35
  assert.strictEqual(fetches, 2);
});

test('removing a repo rewrites at once from remembered rows, without fetching', async () => {
  const h = harness({ repos: [{ repo: 'a/b', account: 'x' }, { repo: 'c/d', account: 'x' }] });
  await h.r.refresh();
  const fetched = h.state.fetches;
  h.state.repos = [{ repo: 'a/b', account: 'x' }];
  h.r.onConfigChanged();
  assert.strictEqual(h.writes.at(-1)!.issues.items.length, 1);
  assert.strictEqual(h.state.fetches, fetched);
});

test('turning widgets off through a settings change deletes the file', async () => {
  const h = harness();
  await h.r.refresh();
  h.state.enabled = false;
  h.r.onConfigChanged();
  assert.strictEqual(h.state.removed, 1);
});

test('focus claims ownership and refreshes, but not more than once a minute', async () => {
  const h = harness();
  h.r.setFocused(true); await Promise.resolve(); await new Promise(r => setImmediate(r));
  assert.strictEqual(h.state.claimed, 1); const first = h.state.fetches;
  h.r.setFocused(false); h.advance(10_000); h.r.setFocused(true); await new Promise(r => setImmediate(r));
  assert.strictEqual(h.state.fetches, first);
});

test('the tick refreshes a focused owner when due and a window that just became owner', async () => {
  const h = harness({ owner: false });
  h.r.start(); h.r.setFocused(true);
  h.state.owner = true;
  h.timers.at(-1)!.fn(); await new Promise(r => setImmediate(r));
  assert.ok(h.state.fetches >= 1);
  assert.strictEqual(h.timers.at(-1)!.ms, TICK_MS);
});

test('dispose writes once more as owner and releases ownership', async () => {
  const h = harness();
  await h.r.refresh();
  h.advance(5 * 60_000);
  h.r.dispose();
  assert.strictEqual(h.writes.length, 2);
  assert.strictEqual(h.writes[1].writtenAt, '2026-10-21T10:05:00.000Z');
  assert.strictEqual(h.state.released, 1);
});

test('a fetch that throws unexpectedly does not wipe rows or crash the cycle', async () => {
  let boom = false;
  const h = harness({ fetch: async (_a, rs) => { if (boom) { throw new ApiError('x', 500); } return rs.map((repo): RepoResult => ({ repo, issues: [row(repo, 1)], prs: [] })); } });
  await h.r.refresh(); boom = true; h.advance(REFRESH_MS);
  await assert.doesNotReject(h.r.refresh());
  assert.strictEqual(h.writes.at(-1)!.issues.items.length, 1);
});
```

Register in `package.json`/`tsconfig.json`.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (`./widgetRefresher` missing).

- [ ] **Step 3: Implement**

```ts
'use strict';

import { classifyError, RepoResult } from './widgetFetch';
import { RepoOutcome, buildSection } from './widgetSections';
import { rankIssues, rankPrs } from './widgetQueries';
import { IssueRow, MAX_ISSUES, MAX_PRS, PrRow, ProjectRow, SCHEMA, Section, Snapshot, WidgetRepo } from './widgetTypes';

export const REFRESH_MS = 10 * 60_000;
export const TICK_MS = 60_000;
export const MAX_BACKOFF_MS = 60 * 60_000;
export const FOCUS_REFRESH_MIN_MS = 60_000;

export interface RefresherDeps { /* exactly as listed under Interfaces */
  now(): number;
  settings(): { enabled: boolean; repos: WidgetRepo[] };
  ownership: { isOwner(): boolean; claim(): void; release(): void };
  fetch(accountId: string, repos: string[]): Promise<RepoResult[]>;
  projects(): Promise<Section<ProjectRow>>;
  store: { write(s: Snapshot): void; remove(): void };
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  log(message: string): void;
}

const empty = <T>(): Section<T> => ({ status: 'ok', failed: [], items: [] });

export class WidgetRefresher {
  private issueRows = new Map<string, IssueRow[]>();
  private prRows = new Map<string, PrRow[]>();
  private sections = { projects: empty<ProjectRow>(), issues: empty<IssueRow>(), prs: empty<PrRow>() };
  private wrote = false;
  private owner = false;
  private focused = false;
  private running = false;
  private failures = 0;
  private lastFetch = 0;
  private suspendedUntil = 0;
  private timer: unknown;

  constructor(private readonly d: RefresherDeps) {}

  start(): void { this.schedule(); }

  setFocused(focused: boolean): void {
    this.focused = focused;
    if (!focused || !this.d.settings().enabled) { return; }
    this.d.ownership.claim();
    this.owner = true;
    if (this.d.now() - this.lastFetch >= FOCUS_REFRESH_MIN_MS) { void this.refresh(); }
  }

  async refresh(): Promise<void> {
    const cfg = this.d.settings();
    if (!cfg.enabled) { this.disable(); return; }
    if (!this.d.ownership.isOwner()) { this.owner = false; return; }
    this.owner = true;
    if (this.running || this.d.now() < this.suspendedUntil) { return; }
    this.running = true;
    try {
      this.lastFetch = this.d.now();
      const byAccount = new Map<string, string[]>();
      for (const { repo, account } of cfg.repos) { byAccount.set(account, [...(byAccount.get(account) ?? []), repo]); }
      const results: RepoResult[] = [];
      for (const [account, repos] of byAccount) {
        try { results.push(...await this.d.fetch(account, repos)); }
        catch (err) { const c = classifyError(err); results.push(...repos.map(repo => ({ repo, reason: c.reason, retryAt: c.retryAt }))); }
      }
      const issues: RepoOutcome<IssueRow>[] = [], prs: RepoOutcome<PrRow>[] = [];
      let retryAt = 0;
      for (const r of results) {
        if ('reason' in r) {
          issues.push({ repo: r.repo, rows: null, reason: r.reason }); prs.push({ repo: r.repo, rows: null, reason: r.reason });
          retryAt = Math.max(retryAt, r.retryAt ?? 0);
        } else {
          issues.push({ repo: r.repo, rows: r.issues }); prs.push({ repo: r.repo, rows: r.prs });
        }
      }
      const i = buildSection(issues, this.issueRows, rankIssues, MAX_ISSUES), p = buildSection(prs, this.prRows, rankPrs, MAX_PRS);
      this.issueRows = i.kept; this.prRows = p.kept;
      this.sections.issues = i.section; this.sections.prs = p.section;
      const allFailed = results.length > 0 && results.every(r => 'reason' in r);
      this.failures = allFailed ? this.failures + 1 : 0;
      if (retryAt > 0) { this.suspendedUntil = retryAt; }
      try { this.sections.projects = await this.d.projects(); } catch (err) { this.d.log(`projects: ${(err as Error).message}`); }
      this.write();
    } finally { this.running = false; }
  }

  onConfigChanged(): void {
    const cfg = this.d.settings();
    if (!cfg.enabled) { this.disable(); return; }
    const keep = new Set(cfg.repos.map(r => r.repo.toLowerCase()));
    for (const k of [...this.issueRows.keys()]) { if (!keep.has(k)) { this.issueRows.delete(k); } }
    for (const k of [...this.prRows.keys()]) { if (!keep.has(k)) { this.prRows.delete(k); } }
    this.sections.issues = { ...this.sections.issues, items: rankIssues([...this.issueRows.values()].flat()).slice(0, MAX_ISSUES), failed: this.sections.issues.failed.filter(f => keep.has(f.repo.toLowerCase())) };
    this.sections.prs = { ...this.sections.prs, items: rankPrs([...this.prRows.values()].flat()).slice(0, MAX_PRS), failed: this.sections.prs.failed.filter(f => keep.has(f.repo.toLowerCase())) };
    if (this.wrote && this.d.ownership.isOwner()) { this.write(); }
    void this.refresh();
  }

  dispose(): void {
    if (this.timer) { this.d.clearTimeout(this.timer); this.timer = undefined; }
    if (this.owner && this.wrote && this.d.settings().enabled) { try { this.write(); } catch (err) { this.d.log(`final write: ${(err as Error).message}`); } }
    this.d.ownership.release();
  }

  private disable(): void {
    this.d.store.remove();
    this.wrote = false;
    this.d.ownership.release();
    this.owner = false;
  }

  private write(): void {
    this.d.store.write({ schema: SCHEMA, writtenAt: new Date(this.d.now()).toISOString(), ...this.sections });
    this.wrote = true;
  }

  private nextDelay(): number {
    const base = this.failures > 0 ? Math.min(REFRESH_MS * 2 ** this.failures, MAX_BACKOFF_MS) : REFRESH_MS;
    return Math.max(base, this.suspendedUntil - this.d.now());
  }

  private schedule(): void {
    this.timer = this.d.setTimeout(() => void this.tick(), TICK_MS);
  }

  private async tick(): Promise<void> {
    try {
      if (this.d.settings().enabled) {
        const was = this.owner;
        this.owner = this.d.ownership.isOwner();
        const due = this.d.now() - this.lastFetch >= this.nextDelay();
        if (this.owner && (!was || (this.focused && due))) { await this.refresh(); }
      }
    } catch (err) { this.d.log(`tick: ${(err as Error).message}`); }
    this.schedule();
  }
}
```

Run the tests; adjust only implementation details that the test names require (e.g. the focus throttle compares against `lastFetch`, which starts at 0, so the first focus always refreshes).

- [ ] **Step 4: Run to verify it passes** — `cd extensions/null-tools && npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src extensions/null-tools/package.json extensions/null-tools/tsconfig.json
git commit -m "feat(null-tools): widget refresher with ownership, backoff and disable (#141)"
```

---

### Task 13: VS Code glue — settings, setup flow, commands, Features entry

**Files:**
- Create: `extensions/null-tools/src/widgets/widgetSetup.ts`, `widgetSetup.test.ts` (pure)
- Create: `extensions/null-tools/src/widgets/widgetIntegration.ts` (the only `vscode` file)
- Modify: `extensions/null-tools/src/extension.ts` (import + `registerWidgetsFeature(context);` next to `registerWorkflowsFeature`)
- Modify: `extensions/null-tools/package.json` (settings, commands, `nullWorkspace.features` entry, test list), `tsconfig.json`
- Modify: `extensions/null-tools/src/featureManifests.test.ts` (expected `setup` list)
- Modify: `extensions/null-tools/CLAUDE.md` (a new table row)

**Interfaces:**
- Consumes: everything from Tasks 8–12; `computeGitStatuses` (`../dashboardGitStatus`), `readRecentProjects`/`getRecentProjectsFilePath` (`../recentProjects`), `parseGithubRemote` (`../github/githubRemote`), `requestGraphql`/`requestJson` (`../github/githubApi`), `PresenceOwnership` (Task 9).
- Produces (`widgetSetup.ts`, pure):

```ts
export function mergeRepos(existing: WidgetRepo[], accountId: string, picked: string[]): WidgetRepo[];  // replaces only that account's entries
export function repoChoices(raw: unknown): string[];                      // GET /user/repos JSON -> valid "owner/name" list (REPO_RE-checked)
export function widgetEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;                                    // without ELECTRON_RUN_AS_NODE and VSCODE_*: the environment for null_widgets.exe
export function localPathsFrom(remotes: ReadonlyMap<string, string | null>): Map<string, string>;       // path -> "owner/repo" remote map => lowercase repo -> path (first wins)
```

- [ ] **Step 1: Write the failing tests for the pure helpers**

```ts
import assert from 'node:assert';
import test from 'node:test';
import { localPathsFrom, mergeRepos, repoChoices, widgetEnv } from './widgetSetup';

test('mergeRepos replaces only the chosen account\'s entries and keeps order stable', () => {
  const existing = [{ repo: 'a/b', account: 'x' }, { repo: 'k/l', account: 'y' }];
  assert.deepStrictEqual(mergeRepos(existing, 'x', ['c/d', 'a/b']), [{ repo: 'k/l', account: 'y' }, { repo: 'c/d', account: 'x' }, { repo: 'a/b', account: 'x' }]);
  assert.deepStrictEqual(mergeRepos(existing, 'x', []), [{ repo: 'k/l', account: 'y' }]);
  assert.deepStrictEqual(mergeRepos(existing, 'x', ['bad repo', '../x', 'ok/ok']), [{ repo: 'k/l', account: 'y' }, { repo: 'ok/ok', account: 'x' }]);
});

test('repoChoices reads full_name and ignores everything unusable', () => {
  assert.deepStrictEqual(repoChoices([{ full_name: 'o/r' }, { full_name: 'x y/z' }, {}, null, 'nope', { full_name: 'o/r2' }]), ['o/r', 'o/r2']);
  assert.deepStrictEqual(repoChoices({}), []);
});

test('localPathsFrom maps a remote repo to the first checkout, case-insensitively', () => {
  const m = localPathsFrom(new Map([['D:\\one', 'Owner/Repo'], ['D:\\two', 'owner/repo'], ['D:\\three', null]]));
  assert.deepStrictEqual([...m], [['owner/repo', 'D:\\one']]);
});

test('widgetEnv drops what would make a later null.exe run as plain Node, and nothing else', () => {
  const env = widgetEnv({ PATH: 'p', ELECTRON_RUN_AS_NODE: '1', VSCODE_PID: '5', vscode_ipc_hook: 'x', Keep: 'k' } as NodeJS.ProcessEnv);
  assert.deepStrictEqual(env, { PATH: 'p', Keep: 'k' });
});
```

Register the test file.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (`./widgetSetup` missing).

- [ ] **Step 3: Implement `widgetSetup.ts`**

```ts
'use strict';

import { REPO_RE, WidgetRepo, parseRepos } from './widgetTypes';

export function mergeRepos(existing: WidgetRepo[], accountId: string, picked: string[]): WidgetRepo[] {
  const others = existing.filter(e => e.account !== accountId);
  return parseRepos([...others, ...picked.map(repo => ({ repo, account: accountId }))]);
}

export function repoChoices(raw: unknown): string[] {
  if (!Array.isArray(raw)) { return []; }
  return raw.map(r => (r as { full_name?: unknown } | null)?.full_name).filter((n): n is string => typeof n === 'string' && REPO_RE.test(n));
}

export function localPathsFrom(remotes: ReadonlyMap<string, string | null>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [dir, repo] of remotes) { if (repo && !out.has(repo.toLowerCase())) { out.set(repo.toLowerCase(), dir); } }
  return out;
}

/** The extension host runs with ELECTRON_RUN_AS_NODE and VSCODE_* set; a null.exe started from the widgets must not inherit them. */
export function widgetEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    const name = k.toUpperCase();
    if (name !== 'ELECTRON_RUN_AS_NODE' && !name.startsWith('VSCODE_')) { out[k] = v; }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test` → PASS.

- [ ] **Step 5: `package.json` contributions**

Add under `contributes.commands`:

```json
{ "command": "null.widgets.setup", "title": "Null: Set Up Widgets", "icon": "$(layout)" },
{ "command": "null.widgets.refresh", "title": "Null: Refresh Widgets", "icon": "$(refresh)" }
```

Under `nullWorkspace.features` (category `setup`, sorts after Formatting Settings):

```json
{ "id": "widgets", "label": "Desktop Widgets", "category": "setup", "icon": "layout",
  "command": "null.widgets.setup", "description": "Show Projects, Issues and PRs on the desktop", "order": 40 }
```

Under `contributes.configuration.properties`:

```json
"null.widgets.enabled": {
  "type": "boolean", "default": false, "scope": "application",
  "description": "Write the data the desktop widgets show (Projects, Issues, Pull Requests) to %LOCALAPPDATA%\\Null\\widgets\\snapshot.json while Null IDE runs. Issue and pull request titles from the repositories you choose, including private ones, appear on the desktop, visible to anyone who can see your screen, and in that file. Turning this off deletes the file. Use \"Null: Set Up Widgets\" to turn it on."
},
"null.widgets.repos": {
  "type": "array", "default": [], "scope": "application",
  "items": { "type": "object", "properties": { "repo": { "type": "string" }, "account": { "type": "string" } }, "required": ["repo", "account"] },
  "description": "Repositories (owner/name, with the Null account id they were picked under) whose issues and pull requests the widgets show. Written by \"Null: Set Up Widgets\". Private issue and pull request titles appear on the desktop."
}
```

Update `featureManifests.test.ts`: the `setup` entry becomes `['Null Setup', 'Environment Check', 'Actions Settings', 'Formatting Settings', 'Desktop Widgets']`.

- [ ] **Step 6: Write `widgetIntegration.ts`**

```ts
'use strict';

import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { nullDataDir } from '../dataDir';
import { computeGitStatuses, GitStatus } from '../dashboardGitStatus';
import { requestGraphql, requestJson } from '../github/githubApi';
import { parseGithubRemote } from '../github/githubRemote';
import { PresenceOwnership } from '../presenceOwnership';
import { getRecentProjectsFilePath, readRecentProjects } from '../recentProjects';
import { findInstall } from '../updater';
import { fetchRepos } from './widgetFetch';
import { WidgetRefresher } from './widgetRefresher';
import { buildProjects } from './widgetSections';
import { localPathsFrom, mergeRepos, repoChoices, widgetEnv } from './widgetSetup';
import { SnapshotStore, widgetsDir } from './widgetStore';
import { WidgetRepo, parseRepos } from './widgetTypes';

/** The slice of null-accounts' API used here (a structural copy, as in githubSession.ts). */
interface AccountsApi {
  getAccounts(): Array<{ id: string; provider: string; username: string; host: string }>;
  getToken(account: { id: string; provider: string; username: string; host: string }, scopes?: string[], options?: { interactive?: boolean }): Promise<string | undefined>;
}
const accountsApi = (): AccountsApi | undefined => vscode.extensions.getExtension<AccountsApi>('null.null-accounts')?.exports;

const gitRemote = (cwd: string): Promise<string | null> => new Promise(resolve =>
  execFile('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 5000 }, (err, out) => {
    const ref = err ? null : parseGithubRemote(out);
    resolve(ref ? `${ref.owner}/${ref.repo}` : null);
  }));

const settings = (): { enabled: boolean; repos: WidgetRepo[] } => {
  const c = vscode.workspace.getConfiguration('null.widgets');
  return { enabled: c.get<boolean>('enabled', false), repos: parseRepos(c.get<unknown>('repos', [])) };
};

export function registerWidgetsFeature(context: vscode.ExtensionContext): void {
  const supported = process.platform === 'win32';
  const notSupported = (): void => void vscode.window.showInformationMessage('Desktop widgets are only available on Windows.');
  const out = vscode.window.createOutputChannel('Null Widgets');
  const log = (m: string): void => out.appendLine(m);

  /** Starts the widgets (a second start of a running exe only un-hides hidden widgets): `<install>\null_widgets.exe`. False when this build has no exe. */
  const startWidgets = (): boolean => {
    const install = findInstall(context);
    const exe = install && path.join(install.installDir, 'null_widgets.exe');
    if (!exe || !fs.existsSync(exe)) { return false; }
    const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.tmpdir(), env: widgetEnv(process.env) });
    child.once('error', err => log(`could not start null_widgets.exe: ${err.message}`));
    child.unref();
    return true;
  };

  const setup = async (): Promise<void> => {
    if (!supported) { notSupported(); return; }
    const api = accountsApi();
    const accounts = api?.getAccounts().filter(a => a.provider === 'github') ?? [];
    if (!api || accounts.length === 0) {
      void vscode.window.showWarningMessage('Add a GitHub account first (Null: Accounts), then run Set Up Widgets again.');
      return;
    }
    const account = accounts.length === 1 ? accounts[0]
      : (await vscode.window.showQuickPick(accounts.map(a => ({ label: a.username, description: a.host, a })), { title: 'Widgets: pick an account' }))?.a;
    if (!account) { return; }
    const token = await api.getToken(account, ['repo'], { interactive: true });
    if (!token) { return; }
    let names: string[];
    try {
      names = repoChoices(await requestJson<unknown>('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member', token));
    } catch (err) { void vscode.window.showErrorMessage(`Could not list repositories: ${(err as Error).message}`); return; }
    const chosen = new Set(settings().repos.filter(r => r.account === account.id).map(r => r.repo.toLowerCase()));
    const picked = await vscode.window.showQuickPick(names.map(label => ({ label, picked: chosen.has(label.toLowerCase()) })), {
      canPickMany: true, title: 'Widgets: repositories for Issues and Pull Requests',
      placeHolder: 'Private issue and pull request titles will appear on your desktop. Pick none for Projects only.',
    });
    if (!picked) { return; }
    const cfg = vscode.workspace.getConfiguration('null.widgets');
    await cfg.update('repos', mergeRepos(settings().repos, account.id, picked.map(p => p.label)), vscode.ConfigurationTarget.Global);
    await cfg.update('enabled', true, vscode.ConfigurationTarget.Global);
    if (startWidgets()) {
      void vscode.window.showInformationMessage('Widgets are set up and shown on your desktop. To start them at every login, tick "Desktop widgets" in Null: Setup.');
    } else {
      void vscode.window.showWarningMessage('Widgets are set up, but this Null IDE has no null_widgets.exe. Install or update Null IDE from a release build.');
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('null.widgets.setup', setup),
    vscode.commands.registerCommand('null.widgets.refresh', async () => {
      if (!supported) { notSupported(); return; }
      if (!settings().enabled) { void vscode.window.showInformationMessage('Run "Null: Set Up Widgets" first.'); return; }
      await refresher?.refresh();
    }),
    out,
  );
  if (!supported) { return; }

  let dir: string;
  try { dir = widgetsDir(); } catch (err) { log(`disabled: ${(err as Error).message}`); return; }
  const store = new SnapshotStore(dir);
  const ownership = new PresenceOwnership(dir, log, 'widgets-owner.json');
  const api = (): AccountsApi | undefined => accountsApi();

  const refresher: WidgetRefresher | undefined = new WidgetRefresher({
    now: Date.now,
    settings,
    ownership,
    store,
    fetch: async (accountId, repos) => {
      const a = api(); const account = a?.getAccounts().find(x => x.id === accountId);
      return fetchRepos({
        token: async () => (a && account ? a.getToken(account, ['repo'], { interactive: false }) : undefined),
        graphql: requestGraphql as never,
        localPaths: () => cachedLocal,
      }, accountId, repos);
    },
    projects: async () => {
      const entries = readRecentProjects(getRecentProjectsFilePath());
      const dirs = entries.filter(e => !e.isWorkspaceFile).map(e => e.path);
      const statuses = new Map<string, GitStatus | null>();
      await computeGitStatuses(dirs.slice(0, 20), (p, s) => statuses.set(p, s));
      const remotes = new Map<string, string | null>();
      await computeGitStatuses<string>(dirs, (p, r) => remotes.set(p, r), 4, gitRemote);
      cachedLocal = localPathsFrom(remotes);
      return buildProjects(entries, statuses);
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: h => clearTimeout(h as NodeJS.Timeout),
    log,
  });
  let cachedLocal: ReadonlyMap<string, string> = new Map();

  refresher.start();
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(s => refresher.setFocused(s.focused)),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('null.widgets')) { refresher.onConfigChanged(); } }),
    { dispose: () => refresher.dispose() },
  );
  if (vscode.window.state.focused) { refresher.setFocused(true); }
  void nullDataDir; // (kept for symmetry with other features; ownership lives next to the snapshot)
}
```

Clean-ups to apply while compiling: `refresher` is used inside the `refresh` command before it is assigned — declare `let refresher: WidgetRefresher | undefined;` above the `context.subscriptions.push(...)` call and assign it later (the optional chaining already handles the unset case); delete the `nullDataDir` import and the `void nullDataDir` line (they were a leftover); `graphql: requestGraphql as never` must be replaced with a correct adapter: `graphql: (q, v, token) => requestGraphql(q, v, token)`.

In `extension.ts`: `import { registerWidgetsFeature } from './widgets/widgetIntegration';` and call `registerWidgetsFeature(context);` after `registerWorkflowsFeature(context);`.

- [ ] **Step 7: Build and run everything**

Run: `cd extensions/null-tools && npm run compile && npm test`
Expected: compiles; all tests pass, including `featureManifests` (new `Windows Widgets` entry, command exists).

- [ ] **Step 8: Verify in a real IDE**

Use the `verify-local` skill (`/verify-local null-tools`) to sync into the installed Null IDE, then on Windows: run **Null: Set Up Widgets** (account → repos), confirm `%LOCALAPPDATA%\Null\widgets\snapshot.json` appears with real issues/PRs and projects, and the three cards fill in on the desktop (an installed release build contains `null_widgets.exe`; after a plain `sync-local.ps1` there is none, so start `shell-ext-build\widgets\Release\null_widgets.exe` by hand); open a second Null IDE window and focus each — only the focused one rewrites the file (`widgets-owner.json` pid changes); set `null.widgets.enabled` to `false` → the file disappears; sign the account out in null-accounts → rows stay with `status: signed_out`.

- [ ] **Step 9: Docs**

Add a row to the table in `extensions/null-tools/CLAUDE.md`: **Desktop widgets** — `src/widgets/` (#141): the only fetcher/writer of `%LOCALAPPDATA%\Null\widgets\snapshot.json`; `null.widgets.enabled` (off by default) and `null.widgets.repos`; `Null: Set Up Widgets` (also starts `<install>\null_widgets.exe`) / `Null: Refresh Widgets`; one writer window through `PresenceOwnership` with `widgets-owner.json`; pure `widgetQueries` / `widgetSections` / `widgetSetup`, `widgetRefresher` has injected deps, only `widgetIntegration` imports `vscode`; design `docs/specs/native-windows-widgets-design.md`, plan `docs/plans/native-windows-widgets.md`.

- [ ] **Step 10: Commit**

```bash
git add extensions/null-tools
git commit -m "feat(null-tools): Null: Set Up Widgets, refresh command and snapshot writer wiring (#141)"
```


---

### Task 14: null-setup — the opt-in `Widgets` feature (Run entry, start, stop, cleanup)

Everything here is verified: the diffs below were applied to a copy of `setup/` and `cargo test -p null-setup-core` passed.

**Files:**
- Modify: `setup/core/src/install_config.rs`, `setup/core/src/shell/mod.rs`, `setup/core/src/shell/sys.rs`, `setup/core/src/procs.rs`, `setup/core/src/registrations.rs`
- Create: `setup/core/src/shell/widgets.rs`
- Modify (tests): `setup/core/tests/install_config.rs`, `setup/core/tests/support/mod.rs`, `setup/core/tests/shell_apply.rs`, `setup/core/tests/procs.rs`
- Create (tests): `setup/core/tests/shell_widgets.rs`

**Interfaces:**
- Produces:
  - `Feature::Widgets` (name `"widgets"`, `follows_install() == true`, `Feature::ALL` has 8 entries, Widgets last); `InstallConfig.widgets: bool` (serde `widgets`, default **false**).
  - `Locations.local_data: PathBuf` (`%LOCALAPPDATA%`; the tests' `Hive` uses a scratch folder), `sys::KnownFolder::LocalAppData`.
  - `System::stop_widgets(&self, install: &Path) -> bool` and `System::start_widgets(&self, exe: &Path)`; `Registrar::stop_widgets(&self, install: &Path, ctx: &Ctx)` (default does nothing; `ShellRegistrar` calls `WinSystem.stop_widgets`).
  - `procs::stop_named_under(dir: &Path, name: &str) -> bool` — force-ends the named processes that run from `dir`; true when none is left.
  - `shell::widgets::{EXE, register, unregister}`: `register` writes `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\NullWidgets` = `"<install>\null_widgets.exe"` and starts the exe (a build without the exe logs and does nothing); `unregister` stops the process, deletes only that Run value and removes `<local_data>\Null\widgets`.

- [ ] **Step 1: Write the failing tests**

`setup/core/tests/install_config.rs` — the opt-in default, the new feature and the update rule:

```diff
--- a/setup/core/tests/install_config.rs
+++ b/setup/core/tests/install_config.rs
@@ -9,10 +9,25 @@ fn defaults_match_the_inno_task_defaults() {
     for f in [Feature::StartMenuShortcut, Feature::SafeModeShortcut, Feature::Path, Feature::ContextMenu, Feature::FileAssociations, Feature::PreviewHandler] {
         assert!(c.has(f), "{f:?}");
     }
+    assert!(!c.widgets, "desktop widgets are opt-in");
     assert!(c.excluded_builtins.is_empty());
     assert_eq!(c.schema, ic::SCHEMA);
 }
 
+#[test]
+fn widgets_round_trip_and_an_older_file_reads_as_off() {
+    assert_eq!(Feature::Widgets.name(), "widgets");
+    assert_eq!(Feature::ALL.len(), 8);
+    assert!(!InstallConfig::default().enabled().contains(&Feature::Widgets));
+    assert!(!ic::from_json(r#"{"schema":1,"path":false}"#).unwrap().widgets);
+    let on = InstallConfig { widgets: true, ..Default::default() };
+    assert_eq!(InstallConfig::default().added_features(&on), vec![Feature::Widgets]);
+    assert_eq!(on.removed_features(&InstallConfig::default()), vec![Feature::Widgets]);
+    let tmp = tempfile::tempdir().unwrap();
+    ic::write(tmp.path(), &on).unwrap();
+    assert!(ic::read(tmp.path()).unwrap().widgets);
+}
+
 #[test]
 fn a_folder_without_a_config_reads_as_the_defaults() {
     let tmp = tempfile::tempdir().unwrap();
@@ -56,7 +71,7 @@ fn enabled_added_and_removed_features_are_listed_in_a_stable_order() {
 #[test]
 fn only_the_install_path_bound_features_follow_an_update() {
     let follow: Vec<_> = Feature::ALL.into_iter().filter(|f| f.follows_install()).collect();
-    assert_eq!(follow, vec![Feature::ContextMenu, Feature::FileAssociations, Feature::PreviewHandler]);
+    assert_eq!(follow, vec![Feature::ContextMenu, Feature::FileAssociations, Feature::PreviewHandler, Feature::Widgets]);
 }
 
 #[test]
```

`setup/core/tests/support/mod.rs` — `Hive` gets `local_data`; `FakeSystem` records `stop_widgets` / `start_widgets:<file>`; `Recorder` counts `stops` (used again by Task 15):

```diff
--- a/setup/core/tests/support/mod.rs
+++ b/setup/core/tests/support/mod.rs
@@ -59,10 +59,12 @@ use null_setup_core::{
 pub struct Call { pub register: Vec<Feature>, pub unregister: Vec<Feature>, pub allow_elevate: bool }
 
 /// Stands in for the real registrar so no test writes the registry, PATH or Start Menu.
-pub struct Recorder { pub calls: Mutex<Vec<Call>>, pub arp: Mutex<Vec<Option<String>>>, pub result: Registration }
+pub struct Recorder { pub calls: Mutex<Vec<Call>>, pub arp: Mutex<Vec<Option<String>>>, pub stops: Mutex<usize>, pub result: Registration }
 
 impl Recorder {
-    pub fn new(result: Registration) -> Arc<Recorder> { Arc::new(Recorder { calls: Mutex::new(vec![]), arp: Mutex::new(vec![]), result }) }
+    pub fn new(result: Registration) -> Arc<Recorder> {
+        Arc::new(Recorder { calls: Mutex::new(vec![]), arp: Mutex::new(vec![]), stops: Mutex::new(0), result })
+    }
 }
 
 impl Registrar for Recorder {
@@ -74,6 +76,10 @@ impl Registrar for Recorder {
     fn arp(&self, _: &std::path::Path, version: Option<&str>, _: &Ctx) {
         self.arp.lock().unwrap().push(version.map(str::to_string));
     }
+
+    fn stop_widgets(&self, _: &std::path::Path, _: &Ctx) {
+        *self.stops.lock().unwrap() += 1;
+    }
 }
 
 use std::sync::atomic::{AtomicU32, Ordering};
@@ -95,10 +101,11 @@ impl Hive {
         let id = format!("{}-{}", std::process::id(), HIVE_ID.fetch_add(1, Ordering::SeqCst));
         let root = format!(r"Software\NullSetupTest\{id}");
         let tmp = tempfile::tempdir().unwrap();
-        let (desktop, programs) = (tmp.path().join("Desktop"), tmp.path().join("Programs"));
+        let (desktop, programs, local_data) = (tmp.path().join("Desktop"), tmp.path().join("Programs"), tmp.path().join("LocalAppData"));
         std::fs::create_dir_all(&desktop).unwrap();
         std::fs::create_dir_all(&programs).unwrap();
-        Hive { loc: Locations { hkcu: format!(r"{root}\"), desktop, programs }, tmp, root }
+        std::fs::create_dir_all(&local_data).unwrap();
+        Hive { loc: Locations { hkcu: format!(r"{root}\"), desktop, programs, local_data }, tmp, root }
     }
     fn open(&self, rel: &str) -> Option<RegKey> {
         RegKey::predef(HKEY_CURRENT_USER).open_subkey(self.loc.key(rel)).ok()
@@ -135,6 +142,7 @@ use null_setup_core::shell::{shortcuts::ShortcutSpec, AppxAdd, System};
 
 #[derive(Default)]
 pub struct FakeSystem {
+    /// What was asked of the system, in order, e.g. "appx_add", "stop_widgets", "start_widgets:null_widgets.exe".
     pub calls: RefCell<Vec<String>>,
     /// PackageFullName of the registered package, if any.
     pub package: RefCell<Option<String>>,
@@ -184,4 +192,11 @@ impl System for FakeSystem {
             Some(Err(m)) => Err(null_setup_core::Error::Other(m)),
         }
     }
+    fn stop_widgets(&self, _: &Path) -> bool {
+        self.calls.borrow_mut().push("stop_widgets".into());
+        true
+    }
+    fn start_widgets(&self, exe: &Path) {
+        self.calls.borrow_mut().push(format!("start_widgets:{}", exe.file_name().unwrap().to_string_lossy()));
+    }
 }
```

`setup/core/tests/shell_widgets.rs` (new):

```rust
mod support;

use std::fs;

use null_setup_core::shell::widgets::*;
use support::{FakeSystem, Hive};

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

fn install(h: &Hive, with_exe: bool) -> std::path::PathBuf {
    let dir = h.tmp.path().join("Null IDE ünï");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("null.exe"), "MZ").unwrap();
    if with_exe {
        fs::write(dir.join(EXE), "MZ").unwrap();
    }
    dir
}

fn quiet() -> impl Fn(&str) {
    |_: &str| {}
}

#[test]
fn registering_writes_the_quoted_run_entry_and_starts_the_exe() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let dir = install(&h, true);
    register(&h.loc, &sys, &dir, &quiet()).unwrap();
    assert_eq!(h.get(RUN, "NullWidgets"), format!("\"{}\"", dir.join(EXE).display()));
    assert_eq!(*sys.calls.borrow(), ["start_widgets:null_widgets.exe"]);
}

#[test]
fn a_build_without_the_exe_registers_nothing_and_says_so() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let logged = std::cell::RefCell::new(String::new());
    register(&h.loc, &sys, &install(&h, false), &|m: &str| logged.borrow_mut().push_str(m)).unwrap();
    assert!(!h.exists(RUN) || h.try_get(RUN, "NullWidgets").is_none());
    assert!(sys.calls.borrow().is_empty());
    assert!(logged.borrow().contains(EXE), "{}", logged.borrow());
}

#[test]
fn registering_again_after_an_update_points_the_entry_at_the_new_folder() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    h.set_text(RUN, "NullWidgets", r#""C:\old\null_widgets.exe""#);
    let dir = install(&h, true);
    register(&h.loc, &sys, &dir, &quiet()).unwrap();
    assert_eq!(h.get(RUN, "NullWidgets"), format!("\"{}\"", dir.join(EXE).display()));
}

#[test]
fn unregistering_stops_the_exe_removes_only_its_run_entry_and_deletes_the_data_folder() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    h.set_text(RUN, "NullWidgets", r#""C:\x\null_widgets.exe""#);
    h.set_text(RUN, "SomethingElse", "keep");
    let data = h.loc.local_data.join("Null").join("widgets");
    fs::create_dir_all(&data).unwrap();
    fs::write(data.join("snapshot.json"), "{}").unwrap();
    unregister(&h.loc, &sys, &install(&h, true)).unwrap();
    assert_eq!(*sys.calls.borrow(), ["stop_widgets"]);
    assert!(h.try_get(RUN, "NullWidgets").is_none());
    assert_eq!(h.get(RUN, "SomethingElse"), "keep");
    assert!(!data.exists());
}

#[test]
fn unregistering_a_machine_that_never_had_widgets_is_fine_even_without_null_exe() {
    let h = Hive::new();
    let sys = FakeSystem::default();
    let dir = install(&h, false);
    fs::remove_file(dir.join("null.exe")).unwrap();
    unregister(&h.loc, &sys, &dir).unwrap();
    unregister(&h.loc, &sys, &dir).unwrap();
}
```

`setup/core/tests/shell_apply.rs`:

```diff
--- a/setup/core/tests/shell_apply.rs
+++ b/setup/core/tests/shell_apply.rs
@@ -20,6 +20,22 @@ fn apply(h: &Hive, sys: &FakeSystem, dir: &std::path::Path, reg: &[Feature], unr
     apply_with(&h.loc, sys, dir, reg, unreg, elevate, &|_| {})
 }
 
+const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
+
+#[test]
+fn the_widgets_feature_registers_and_unregisters_through_apply() {
+    let h = Hive::new();
+    let sys = FakeSystem::default();
+    let dir = install(&h);
+    fs::write(dir.join("null_widgets.exe"), "MZ").unwrap();
+    assert_eq!(apply(&h, &sys, &dir, &[Feature::Widgets], &[], false), Registration::Done);
+    assert!(h.try_get(RUN, "NullWidgets").is_some());
+    assert_eq!(sys.count("start_widgets:null_widgets.exe"), 1);
+    assert_eq!(apply(&h, &sys, &dir, &[], &[Feature::Widgets], false), Registration::Done);
+    assert!(h.try_get(RUN, "NullWidgets").is_none());
+    assert_eq!(sys.count("stop_widgets"), 1);
+}
+
 #[test]
 fn nothing_to_do_is_skipped() {
     let h = Hive::new();
@@ -40,6 +56,8 @@ fn registers_every_feature_into_the_scratch_locations() {
     assert!(h.exists(r"Software\Classes\NullIDE.AssocFile.rust"));
     assert!(h.exists(&format!(r"Software\Classes\CLSID\{}", null_setup_core::shell::classes::PREVIEW_CLSID)));
     assert_eq!(h.get("Environment", "Path"), dir.join("bin").display().to_string());
+    assert!(h.try_get(RUN, "NullWidgets").is_none(), "this fake install has no null_widgets.exe");
+    assert_eq!(sys.count("stop_widgets"), 0);
 }
 
 #[test]
```

`setup/core/tests/procs.rs`:

```diff
--- a/setup/core/tests/procs.rs
+++ b/setup/core/tests/procs.rs
@@ -6,6 +6,25 @@ use null_setup_core::{
     Error,
 };
 
+#[test]
+fn stop_named_under_ends_only_the_named_process_inside_the_folder() {
+    let dir = tempfile::tempdir().unwrap();
+    // PING.EXE is a long-running console program that does not depend on where it lives.
+    let ping = r"C:\Windows\System32\PING.EXE";
+    let (target, other) = (dir.path().join("null_widgets.exe"), dir.path().join("other.exe"));
+    fs::copy(ping, &target).unwrap();
+    fs::copy(ping, &other).unwrap();
+    let start = |exe: &Path| Command::new(exe).args(["-n", "60", "127.0.0.1"]).stdout(std::process::Stdio::null()).spawn().unwrap();
+    let (mut a, mut b) = (start(&target), start(&other));
+    thread::sleep(Duration::from_millis(300));
+
+    assert!(null_setup_core::procs::stop_named_under(dir.path(), "null_widgets.exe"));
+    assert!(a.try_wait().unwrap().is_some(), "the named process is gone");
+    assert!(b.try_wait().unwrap().is_none(), "the other process in the same folder is untouched");
+    let _ = b.kill();
+    assert!(null_setup_core::procs::stop_named_under(dir.path(), "null_widgets.exe"), "nothing to stop is success");
+}
+
 #[test]
 fn is_under_is_case_insensitive_and_respects_directory_boundaries() {
     let dir = Path::new(r"C:\Users\Me\AppData\Local\Programs\Null IDE");
```

- [ ] **Step 2: Run to verify failure**

Run: `cd setup && cargo test -p null-setup-core`
Expected: FAIL — compile errors (`Feature::Widgets`, `local_data`, `stop_widgets`, `shell::widgets`, `stop_named_under`).

- [ ] **Step 3: Implement**

`setup/core/src/install_config.rs`:

```diff
--- a/setup/core/src/install_config.rs
+++ b/setup/core/src/install_config.rs
@@ -8,10 +8,10 @@ pub const FILE: &str = "install-config.json";
 pub const SCHEMA: u32 = 1;
 
 #[derive(Clone, Copy, Debug, PartialEq, Eq)]
-pub enum Feature { DesktopShortcut, StartMenuShortcut, SafeModeShortcut, Path, ContextMenu, FileAssociations, PreviewHandler }
+pub enum Feature { DesktopShortcut, StartMenuShortcut, SafeModeShortcut, Path, ContextMenu, FileAssociations, PreviewHandler, Widgets }
 
 impl Feature {
-    pub const ALL: [Feature; 7] = [
+    pub const ALL: [Feature; 8] = [
         Feature::DesktopShortcut,
         Feature::StartMenuShortcut,
         Feature::SafeModeShortcut,
@@ -19,6 +19,7 @@ impl Feature {
         Feature::ContextMenu,
         Feature::FileAssociations,
         Feature::PreviewHandler,
+        Feature::Widgets,
     ];
 
     /// Stable id used in logs and messages.
@@ -31,13 +32,14 @@ impl Feature {
             Feature::ContextMenu => "contextMenu",
             Feature::FileAssociations => "fileAssociations",
             Feature::PreviewHandler => "previewHandler",
+            Feature::Widgets => "widgets",
         }
     }
 
     /// Registered against the install folder (registry, Explorer), so an update must re-point them.
-    /// Shortcuts and PATH point at paths that survive the swap.
+    /// Shortcuts and PATH point at paths that survive the swap. Widgets: the update stops `null_widgets.exe`, so it is started again.
     pub fn follows_install(self) -> bool {
-        matches!(self, Feature::ContextMenu | Feature::FileAssociations | Feature::PreviewHandler)
+        matches!(self, Feature::ContextMenu | Feature::FileAssociations | Feature::PreviewHandler | Feature::Widgets)
     }
 }
 
@@ -52,6 +54,8 @@ pub struct InstallConfig {
     pub context_menu: bool,
     pub file_associations: bool,
     pub preview_handler: bool,
+    /// Desktop widgets (`null_widgets.exe` at login). The only feature that is off by default.
+    pub widgets: bool,
     /// Built-ins the user left off. Stored as exclusions so a built-in added by a later release is on by default.
     pub excluded_builtins: Vec<String>,
 }
@@ -67,6 +71,7 @@ impl Default for InstallConfig {
             context_menu: true,
             file_associations: true,
             preview_handler: true,
+            widgets: false,
             excluded_builtins: Vec::new(),
         }
     }
@@ -82,6 +87,7 @@ impl InstallConfig {
             Feature::ContextMenu => self.context_menu,
             Feature::FileAssociations => self.file_associations,
             Feature::PreviewHandler => self.preview_handler,
+            Feature::Widgets => self.widgets,
         }
     }
 
```

`setup/core/src/shell/widgets.rs` (new):

```rust
//! Desktop widgets (`null_widgets.exe`, issue #141): an opt-in HKCU Run entry plus start/stop of the process.
//! The exe is a plain Win32 program in the install root: no package, no signing, no elevation.

use std::{fs, io, path::Path};

use super::{create, open_write, set, Locations, System};
use crate::error::{Error, Result};

pub const EXE: &str = "null_widgets.exe";
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "NullWidgets";

/// Writes the Run entry (so the widgets come back at every login) and starts the exe now. A second start of a running exe only
/// asks it to show hidden widgets again.
pub fn register(loc: &Locations, sys: &dyn System, install: &Path, log: &dyn Fn(&str)) -> Result<()> {
    let exe = install.join(EXE);
    if !exe.is_file() {
        log(&format!("widgets not registered: {} not found", exe.display()));
        return Ok(());
    }
    set(&create(loc, RUN_KEY)?, RUN_VALUE, &format!("\"{}\"", exe.display()))?;
    sys.start_widgets(&exe);
    Ok(())
}

/// Ends the process, removes the Run entry and deletes the snapshot/layout folder. Works without `null.exe` and on machines that never
/// had the feature.
pub fn unregister(loc: &Locations, sys: &dyn System, install: &Path) -> Result<()> {
    sys.stop_widgets(install);
    if let Some(k) = open_write(loc, RUN_KEY) {
        match k.delete_value(RUN_VALUE) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(Error::Io { context: "remove the widgets Run entry".into(), source: e }),
        }
    }
    match fs::remove_dir_all(loc.local_data.join("Null").join("widgets")) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(Error::Io { context: "remove the widgets data folder".into(), source: e }),
    }
}
```

`setup/core/src/shell/mod.rs`:

```diff
--- a/setup/core/src/shell/mod.rs
+++ b/setup/core/src/shell/mod.rs
@@ -14,6 +14,7 @@ pub mod classes;
 pub mod path;
 pub mod shortcuts;
 pub mod sys;
+pub mod widgets;
 pub mod win11;
 
 /// Where registrations are written. Production: the real HKCU and shell folders. Tests: a scratch key prefix and temp folders.
@@ -23,6 +24,8 @@ pub struct Locations {
     pub hkcu: String,
     pub desktop: PathBuf,
     pub programs: PathBuf,
+    /// `%LOCALAPPDATA%`; the widgets keep their snapshot and layout in `Null\widgets` below it.
+    pub local_data: PathBuf,
 }
 
 impl Locations {
@@ -73,6 +76,10 @@ pub trait System {
     fn cert_add_current_user(&self, cer: &Path) -> Result<()>;
     /// UAC prompt; Err when declined or failed.
     fn cert_add_machine_elevated(&self, install: &Path) -> Result<()>;
+    /// Force-ends the `null_widgets.exe` processes that run from `install`; true when none is left.
+    fn stop_widgets(&self, install: &Path) -> bool;
+    /// Starts `exe` detached from this process. A failure to start is not an error: the Run entry starts it at the next login.
+    fn start_widgets(&self, exe: &Path);
 }
 
 #[derive(Clone, Debug, PartialEq)]
@@ -84,6 +91,7 @@ impl Locations {
             hkcu: String::new(),
             desktop: sys::known_folder(sys::KnownFolder::Desktop)?,
             programs: sys::known_folder(sys::KnownFolder::Programs)?,
+            local_data: sys::known_folder(sys::KnownFolder::LocalAppData)?,
         })
     }
 }
@@ -128,6 +136,7 @@ fn register_one(
             let (claimed, skipped) = classes::register_preview_handler(loc, sys, install)?;
             log(&format!("preview handler: {claimed} extensions claimed, {skipped} already handled by another app"));
         }
+        Feature::Widgets => widgets::register(loc, sys, install, log)?,
     }
     Ok(false)
 }
@@ -147,6 +156,7 @@ fn unregister_one(f: Feature, loc: &Locations, sys: &dyn System, install: &Path)
         }
         Feature::FileAssociations => classes::unregister_file_associations(loc, sys),
         Feature::PreviewHandler => classes::unregister_preview_handler(loc, sys),
+        Feature::Widgets => widgets::unregister(loc, sys, install),
     }
 }
 
```

`setup/core/src/shell/sys.rs`:

```diff
--- a/setup/core/src/shell/sys.rs
+++ b/setup/core/src/shell/sys.rs
@@ -6,17 +6,21 @@ use windows::{
         Foundation::MAX_PATH,
         Security::Cryptography::{CERT_SYSTEM_STORE_CURRENT_USER, CERT_SYSTEM_STORE_LOCAL_MACHINE},
         System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ},
-        UI::Shell::{FOLDERID_Desktop, FOLDERID_Programs, IShellLinkW, SHGetKnownFolderPath, ShellLink, KF_FLAG_DEFAULT},
+        UI::Shell::{FOLDERID_Desktop, FOLDERID_LocalAppData, FOLDERID_Programs, IShellLinkW, SHGetKnownFolderPath, ShellLink, KF_FLAG_DEFAULT},
     },
 };
 
 use super::{shortcuts::ShortcutSpec, AppxAdd, System};
 use crate::error::{Error, Result};
 
-pub enum KnownFolder { Desktop, Programs }
+pub enum KnownFolder { Desktop, Programs, LocalAppData }
 
 pub fn known_folder(id: KnownFolder) -> Result<PathBuf> {
-    let guid = match id { KnownFolder::Desktop => FOLDERID_Desktop, KnownFolder::Programs => FOLDERID_Programs };
+    let guid = match id {
+        KnownFolder::Desktop => FOLDERID_Desktop,
+        KnownFolder::Programs => FOLDERID_Programs,
+        KnownFolder::LocalAppData => FOLDERID_LocalAppData,
+    };
     unsafe {
         let p = SHGetKnownFolderPath(&guid, KF_FLAG_DEFAULT, None).map_err(|e| Error::Other(format!("known folder: {e}")))?;
         Ok(PathBuf::from(OsString::from_wide(p.as_wide())))
@@ -117,6 +121,17 @@ impl System for WinSystem {
             ))
         })
     }
+
+    fn stop_widgets(&self, install: &Path) -> bool {
+        crate::procs::stop_named_under(install, super::widgets::EXE)
+    }
+
+    fn start_widgets(&self, exe: &Path) {
+        const DETACHED_PROCESS: u32 = 0x0000_0008;
+        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
+        // The temp folder as working directory: the exe must never keep the install folder busy, an update renames it.
+        let _ = Command::new(exe).current_dir(std::env::temp_dir()).creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP).spawn();
+    }
 }
 
 const NO_WINDOW: u32 = 0x0800_0000;
```

`setup/core/src/procs.rs`:

```diff
--- a/setup/core/src/procs.rs
+++ b/setup/core/src/procs.rs
@@ -62,6 +62,20 @@ fn taskkill(pids: &[u32], force: bool) {
 pub fn request_close(pids: &[u32]) { taskkill(pids, false) }
 pub fn force_close(pids: &[u32]) { taskkill(pids, true) }
 
+/// Force-ends the processes called `name` that run from `dir`; true when none is left. Meant for the widgets exe, which keeps no
+/// state in memory (its layout is saved on every drag), and which would otherwise sit in the prompt of `close_all`.
+pub fn stop_named_under(dir: &Path, name: &str) -> bool {
+    let pids = || -> Vec<u32> { running_in(dir).into_iter().filter(|r| r.name.eq_ignore_ascii_case(name)).map(|r| r.pid).collect() };
+    let found = pids();
+    if found.is_empty() { return true; }
+    force_close(&found);
+    for _ in 0..10 {
+        thread::sleep(Duration::from_millis(300));
+        if pids().is_empty() { return true; }
+    }
+    false
+}
+
 pub fn close_all(dir: &Path, ctx: &Ctx, grace: Duration) -> Result<()> {
     loop {
         let mut running = running_in(dir);
```

`setup/core/src/registrations.rs`:

```diff
--- a/setup/core/src/registrations.rs
+++ b/setup/core/src/registrations.rs
@@ -3,7 +3,7 @@ use std::{path::Path, sync::Arc};
 use crate::{
     install_config::Feature,
     progress::Ctx,
-    shell::{self, arp, sys::WinSystem, Locations},
+    shell::{self, arp, sys::WinSystem, Locations, System},
 };
 
 #[derive(Clone, Debug, PartialEq)]
@@ -14,6 +14,10 @@ pub trait Registrar: Send + Sync {
 
     /// Add/Remove Programs entry: `Some(version)` writes or refreshes it, `None` removes it. Never fails the caller.
     fn arp(&self, _install: &Path, _version: Option<&str>, _ctx: &Ctx) {}
+
+    /// Ends `null_widgets.exe` before the install folder is renamed or deleted. Best effort; the locked-files prompt of
+    /// `procs::close_all` is the backstop, so the default does nothing.
+    fn stop_widgets(&self, _install: &Path, _ctx: &Ctx) {}
 }
 
 pub struct ShellRegistrar;
@@ -39,6 +43,12 @@ impl Registrar for ShellRegistrar {
             ctx.log.line(&format!("registrations: Add/Remove Programs entry: {e}"));
         }
     }
+
+    fn stop_widgets(&self, install: &Path, ctx: &Ctx) {
+        if !WinSystem.stop_widgets(install) {
+            ctx.log.line("registrations: null_widgets.exe is still running; it is closed with the other processes");
+        }
+    }
 }
 
 pub fn standard() -> Arc<dyn Registrar> { Arc::new(ShellRegistrar) }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd setup && cargo test -p null-setup-core -p null-setup`
Expected: PASS, including every existing suite (the `Feature::ALL` tests keep working: a fake install without `null_widgets.exe` only logs). The line `ERROR: The process with PID … could not be terminated.` that one existing suite prints is noise, not a failure.

- [ ] **Step 5: Commit**

```bash
git add setup
git commit -m "feat(setup): opt-in desktop widgets feature with Run entry, start, stop and cleanup (#141)"
```

---

### Task 15: null-setup — stop the widgets before an update or uninstall swaps the folder

`null_widgets.exe` runs from the install folder, so a running copy would turn every update into a "files are locked" prompt. The default `Registrar::stop_widgets` and the real implementation exist since Task 14; this task calls them.

**Files:**
- Modify: `setup/core/src/update.rs` (`prepare_swap`), `setup/core/src/manage.rs` (`uninstall_inner`)
- Modify (tests): `setup/core/tests/update.rs`, `setup/core/tests/manage.rs`

- [ ] **Step 1: Write the failing tests**

`setup/core/tests/update.rs`:

```diff
--- a/setup/core/tests/update.rs
+++ b/setup/core/tests/update.rs
@@ -90,6 +90,17 @@ fn update_installs_the_new_version_keeps_data_and_prunes_the_cache() {
     for s in [Progress::Checking, Progress::Preparing, Progress::Installing] { assert!(seen.contains(&s), "{s:?}"); }
 }
 
+#[test]
+fn update_stops_the_widgets_exe_before_it_swaps_the_folder() {
+    let w = world(&[]);
+    let srv = serve_release(w.zip.clone(), sha(&w.zip), Arc::new(AtomicUsize::new(0)));
+    let rec = support::Recorder::new(null_setup_core::registrations::Registration::Done);
+    let mut o = opts(&w, &srv.base);
+    o.registrar = rec.clone();
+    run(|c| update(&o, c)).0.unwrap();
+    assert_eq!(*rec.stops.lock().unwrap(), 1);
+}
+
 #[test]
 fn prefetch_then_update_downloads_the_zip_only_once() {
     let w = world(&[]);
```

`setup/core/tests/manage.rs`:

```diff
--- a/setup/core/tests/manage.rs
+++ b/setup/core/tests/manage.rs
@@ -35,6 +35,17 @@ fn opts(dir: &Path, delete: bool, user_data: &Path) -> UninstallOpts {
     o
 }
 
+#[test]
+fn uninstall_stops_the_widgets_exe_first() {
+    let tmp = tempfile::tempdir().unwrap();
+    let dir = install_in(tmp.path());
+    let rec = support::Recorder::new(Registration::Done);
+    let mut o = opts(&dir, false, &tmp.path().join("Null"));
+    o.registrar = rec.clone();
+    run(|c| uninstall(&o, c)).unwrap();
+    assert_eq!(*rec.stops.lock().unwrap(), 1);
+}
+
 #[test]
 fn modify_in_place_only_rewrites_the_config() {
     let tmp = tempfile::tempdir().unwrap();
```

- [ ] **Step 2: Run to verify failure**

Run: `cd setup && cargo test -p null-setup-core --test update --test manage`
Expected: FAIL — `assertion left == right failed` on `stops` (0 instead of 1).

- [ ] **Step 3: Implement**

`setup/core/src/update.rs`:

```diff
--- a/setup/core/src/update.rs
+++ b/setup/core/src/update.rs
@@ -251,6 +251,7 @@ fn prune_builtins(staged: &Path, cfg: &InstallConfig, strict: bool, ctx: &Ctx) -
 }
 
 fn prepare_swap(o: &Opts, ctx: &Ctx) -> Result<()> {
+    o.registrar.stop_widgets(&o.install_dir, ctx);
     procs::close_all(&o.install_dir, ctx, o.close_grace)?;
     procs::release_inherited_handles(&o.install_dir, ctx);
     if o.release_shell_ext {
```

`setup/core/src/manage.rs`:

```diff
--- a/setup/core/src/manage.rs
+++ b/setup/core/src/manage.rs
@@ -95,6 +95,7 @@ fn uninstall_inner(o: &UninstallOpts, ctx: &Ctx) -> Result<()> {
     if !is_ours(&o.install_dir) {
         return Err(Error::Other(format!("{} is not a Null IDE install; nothing was removed", o.install_dir.display())));
     }
+    o.registrar.stop_widgets(&o.install_dir, ctx);
     procs::close_all(&o.install_dir, ctx, o.close_grace)?;
     procs::release_inherited_handles(&o.install_dir, ctx);
     if o.release_shell_ext {
```

The failure policy is unchanged: `stop_widgets` only logs when the exe will not stop, and `procs::close_all` right after it is the backstop. After the swap, `register` (an update re-applies every feature that `follows_install`, which now includes `Widgets`) starts the new exe.

- [ ] **Step 4: Run to verify it passes**

Run: `cd setup && cargo test -p null-setup-core -p null-setup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add setup
git commit -m "feat(setup): stop the widgets before an update or uninstall swaps the folder (#141)"
```

---

### Task 16: Wizard — the opt-in "Desktop widgets" option

The wizard's options page and summary are driven by `FEATURES` in `setup/ui/wizard-model.js`; the defaults come from the Rust `InstallConfig` (so the option starts unticked), and Modify shows the saved choice. No Rust change is needed.

**Files:**
- Modify: `setup/ui/wizard-model.js`
- Modify (test): `setup/ui-tests/wizard-model.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `setup/ui-tests/wizard-model.test.mjs`, just before the test `a job the backend refuses keeps install and modify on the wizard with the reason`:

```js
test('the desktop widgets option says that it starts a program at login, and the summary names it', () => {
  const row = ctx.FEATURES.find(([key]) => key === 'widgets');
  assert.ok(row, 'the page offers the widgets option');
  assert.ok(/login/i.test(row[2]), 'the explanation says it runs at login');
  const lines = ctx.summaryLines({ dir: 'C:\\x', config: { widgets: true }, excluded: [], settings: {}, view: { manifest: null } });
  assert.ok(lines.includes('Desktop widgets: on'), lines.join('|'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test setup/ui-tests/wizard-model.test.mjs`
Expected: FAIL — `the page offers the widgets option`.

- [ ] **Step 3: Implement**

`setup/ui/wizard-model.js`:

```diff
--- a/setup/ui/wizard-model.js
+++ b/setup/ui/wizard-model.js
@@ -9,6 +9,7 @@ const FEATURES = [
   ['contextMenu', 'Explorer context menu', 'The Windows 11 menu may ask for administrator approval once.'],
   ['fileAssociations', 'File associations', null],
   ['previewHandler', 'Preview pane in Explorer', null],
+  ['widgets', 'Desktop widgets', 'Projects, Issues and Pull Requests on your desktop. Starts a small program at login.'],
 ];
 
 function builtinById(builtins, id) {
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test setup/ui-tests/wizard-model.test.mjs; cd setup && cargo test -p null-setup-core`
Expected: PASS (the existing "every config key the page offers exists on the Rust InstallConfig" test now also checks `widgets`).

- [ ] **Step 5: Look at the window**

Build and run the wizard from a copy outside an install: `cd setup && cargo build -p null-setup`, then `target\debug\null-setup.exe wizard --install-dir "$env:TEMP\widgets-wizard-test"`. Expected: the options page lists "Desktop widgets" with its explanation, unticked; ticking it makes the summary say "Desktop widgets: on".

- [ ] **Step 6: Commit**

```bash
git add setup
git commit -m "feat(setup): Desktop widgets option in the install wizard (#141)"
```

---

### Task 17: End-to-end check, docs and wrap-up

**Files:**
- Modify: `setup/CLAUDE.md`, `shell-ext/CLAUDE.md`, `CLAUDE.md` (root), `extensions/null-tools/CLAUDE.md` (done in Task 13), `README.md` and `docs/wiki/` (run the `wiki-sync` skill)
- Modify: `docs/specs/native-windows-widgets-design.md` (status line), `docs/specs/native-windows-widgets-gate.md` (verification section)

- [ ] **Step 1: Run the manual checklist**

Build a package with `scripts/build-local.ps1` (only when the user agrees: it takes tens of minutes), install it with `NullIDESetup`, and run every item of `scripts/check-widgets.ps1 -Checklist` on Windows 11 and on Windows 10. Write the outcome (pass/fail and notes per item) under `## Verification (YYYY-MM-DD)` at the end of `docs/specs/native-windows-widgets-gate.md`. Fix any failure in the owning task's files (with a test where one is possible) and re-run that item.

- [ ] **Step 2: Documentation**

- `setup/CLAUDE.md`: in the registrations paragraph add that `Feature::Widgets` (opt-in, default off, `widgets` in `install-config.json`) writes the HKCU Run entry `NullWidgets`, starts `<install>\null_widgets.exe` through `System::start_widgets`, that `Registrar::stop_widgets` force-ends it (`procs::stop_named_under`) before an update swap and an uninstall, that uninstall also deletes `%LOCALAPPDATA%\Null\widgets\`, and that the exe is a plain Win32 program: no package, no certificate, no elevation.
- `shell-ext/CLAUDE.md`: add a section "Desktop widgets host (`widgets/`)": `null_widgets.exe`, the `null_widget_core` library and its CTest executables, the rule that widgets sit directly above `Progman` (never `HWND_BOTTOM`), that the exe is unpackaged so the AUMID gotcha above does not apply to it, and `scripts/check-widgets.ps1`.
- Root `CLAUDE.md`: in "Repository Layout" mention `shell-ext/widgets/` and `scripts/check-widgets.ps1`; in "How the Build Works" step 9 add that CTest runs and `null_widgets.exe` is copied to the install root.
- Run the `wiki-sync` skill for the new settings (`null.widgets.enabled`, `null.widgets.repos`), commands (`Null: Set Up Widgets`, `Null: Refresh Widgets`), the wizard option and the privacy note (private titles appear on the desktop).
- Design doc header: add `Status: implemented (see docs/plans/native-windows-widgets.md and docs/specs/native-windows-widgets-gate.md)`.

- [ ] **Step 3: Refresh the knowledge graph and compiled output**

```bash
graphify update .
cd extensions/null-tools && npm run compile && cd ../..
git status --short
```

Expected: only the intended files; refreshed `out/` goes into its own `chore: refresh null-tools compiled output` commit.

- [ ] **Step 4: Final full verification**

```bash
cd extensions/null-tools && npm test
cd ../../setup && cargo test -p null-setup-core -p null-setup && node --test ui-tests/wizard-model.test.mjs
cd .. && ctest --test-dir shell-ext-build -C Release --output-on-failure
node --test scripts/release-notes.test.mjs
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A -- scripts setup/CLAUDE.md shell-ext/CLAUDE.md CLAUDE.md README.md docs
git commit -m "docs(widgets): notes, wiki sync and verification record (#141)"
```

---

## Self-Review

**1. Spec coverage**

| Spec item | Task |
|---|---|
| Hard gate (Win+D, clicks, sleep/resume, display change, Win 10 and 11) | 1 |
| Decision 1 cache only; 7 exe is dumb and treats the snapshot as untrusted | 2, 3, 5 |
| Decision 2 IDE is the only fetcher (issues/PRs GraphQL, projects, gated by `enabled`) | 8, 9, 11, 12, 13 (split into focused files instead of one `widgetSnapshot` module) |
| Decision 3 GitHub first, `provider` field | 8 (`provider: 'github'` on every row) |
| Decision 4 `null_widgets.exe`, plain Win32, CMake step, one instance | 2, 6, 7 |
| Decision 5 Direct2D/DirectWrite layered windows, always above the wallpaper, per-monitor DPI | 6 (z-order rule corrected, see note 1) |
| Decision 6 layout owned by the exe: drag, snap, lock, clamp, menu, show-all on second launch | 4, 6 |
| Decision 7 links only `https://github.com`, plain-text, capped text, malformed keeps last good | 2, 3, 5 |
| Decision 8 actions via `ShellExecuteW` / `CreateProcessW`, `--`, exe folder | 5 |
| Decision 9 two settings, constants 8/10/10 | 8, 13 (and `kMaxRows` in Task 3) |
| Decision 10 lifecycle in null-setup (Run key, stop/restart on update, uninstall cleanup, failures ignored, `FakeSystem`) | 14, 15, 16 |
| Decision 11 nothing runs unless asked; off deletes the snapshot; signed-out keeps rows | 11, 12, 14, 16 |
| Decision 12 atomic writes | 10 |
| Decision 13 no secrets in snapshot or logs | 8, 10 |
| Decision 14 one writer window | 10, 12 |
| Decision 15 accounts non-interactive | 11, 13 |
| Decision 16 refresh cadence, backoff, rate limit, repo removal rewrite; Refresh item re-reads the file | 12; 6 (`Reload`) |
| Decision 17 nothing enabled implicitly | 13 (`enabled` default false, set by the setup command) |
| Snapshot sets, status/failed rules, localPath, newer schema, PR ordering | 8, 9, 2, 3 |
| Widgets table (sizes, rows, actions) | 3 (`DefaultSize`, rows, menus), 6 |
| Errors and staleness incl. the 6 h constant | 3 |
| Testing: node tests / CTest fixtures incl. hostile / `FakeSystem` / manual run + script | 8–12 / 2–5 / 14, 15 / 6, 17 |

**2. Placeholder scan:** no TBD/TODO. Every code step carries the code (the C++ and Rust blocks are the files that were compiled and tested). Two things are deliberately "decide from a measurement", both in Task 1: the verdict of the gate, and what to do if it fails.

**3. Type consistency:** `Loaded/Snapshot/Section` (Task 2) feed `BuildView` (Task 3); `Action/ActionKind` (Task 3) feed `Run` (Task 5) and the menu in `app.cc` (Task 6); `Kind/KeyOf/DefaultSize` (Task 3) feed `placement` (Task 4). TypeScript: `IssueRow/PrRow/Section/Snapshot/WidgetRepo` are defined in Task 8 and used unchanged in Tasks 9–13; `RepoResult` (Task 11) feeds `RefresherDeps.fetch` (Task 12). Rust: `System::{stop,start}_widgets`, `Registrar::stop_widgets` and `Locations.local_data` are introduced in Task 14 and used in Tasks 14–15 with the names the `FakeSystem`/`Recorder` implement.

**4. Review Focus coverage:** 1 → Tasks 2 (hostile fixture, URL/path allow-lists), 3 (hostile rows have no actions, markup stays text), 5 (`Run` refuses before starting anything); 2 → Task 2 (`KeepLastGood`, corrupt/newer/missing, odd types, 200-item cap); 3 → Task 8 (`parseRepos`); 4 → Tasks 9, 12 (signed_out keeps rows, rate-limit suspend, throwing fetch); 5 → Tasks 4 (unplugged monitor clamp), 14 (`stop_named_under`, uninstall cleanup), 15 (stop before swap and uninstall).

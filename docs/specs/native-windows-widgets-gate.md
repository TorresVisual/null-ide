# Desktop widgets — hard gate findings (#141)

Date: 2026-10-21. Machine: Windows 11 Pro 10.0.26100 (24H2), three monitors (virtual screen -2560,-193, 6400×1440). Windows 10: **not tested** (no machine available).

The gate ran in two rounds. Round 1 tested the spec's design (a top-level layered tool window pinned directly above `Progman`) and failed. Round 2 tested the fallback the spec names (a child of the desktop's own windows) and passed.

## Round 1 — top-level window pinned above `Progman`

Pinning with `HWND_BOTTOM` hides the windows behind the desktop; pinning directly above `Progman` works for drawing and z-order, but **Win+D hides the window**. Verdict: fails the gate.

| # | Check | Result |
|---|---|---|
| 1 | Apps open over the box | pass |
| 2 | Win+D keeps the box visible | **fail** |
| 3 | Click flips the colour, does not reach windows behind | pass |
| 4 | Sleep and resume | inconclusive (no `resume` logged) |
| 5 | Display change | pass |
| 6 | Explorer restart | stays visible |

## Round 2 — which desktop window to attach to

Each variant was a 240×120 layered child (`WS_CHILD`, `WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`) of a different desktop window, after sending `0x052C` to `Progman`. The probe read the composed screen pixel back with the desktop revealed (Win+D sent by the probe) and compared it with the colour it painted. Win+D sequencing was uneven between runs, so only the variant that was visible with the desktop shown is a firm result.

| Parent | Visible with the desktop revealed |
|---|---|
| `Progman` (layered child) | no |
| `SHELLDLL_DefView` (layered child) | **yes** |
| `WorkerW` (wallpaper) | no |
| `Progman`, not layered (plain GDI) | no |
| none (top-level above `Progman`, control) | no |

Two things were needed for a layered child to draw at all: an embedded manifest declaring Windows 8–10 support (`supportedOS`), and `UpdateLayeredWindow` with the position in the **parent's client coordinates**. On this 24H2 build `Progman`'s children are `SHELLDLL_DefView` (with `SysListView32`) and `WorkerW`. The probe also needed a separate hidden top-level window to receive `WM_DISPLAYCHANGE` and `WM_POWERBROADCAST`; a child window does not get those broadcasts.

Manual checks of the `SHELLDLL_DefView` variant on Windows 11:

| # | Check | Result |
|---|---|---|
| 1 | Apps open over the box; it never comes forward | pass |
| 2 | Win+D: the box stays visible, and is there after restoring | pass |
| 3 | Click flips the colour (log `click 1`–`click 3`), no desktop icon is selected behind it | pass |
| 4 | Sleep and resume | not verified (no sleep was done; resume handling is repaint-only and is re-checked in Task 17) |
| 5 | Display change | pass (log: two `WM_DISPLAYCHANGE`) |
| 6 | Explorer restart | **the window is destroyed** (`IsWindowVisible` went to 0 in the log). It is a child of a window Explorer destroys, so it must be recreated, not re-pinned |

## Verdict: pass, with a design change

The widgets are layered **child windows of the desktop icon host (`SHELLDLL_DefView`)**, not top-level windows. Consequences recorded for the plan:

- Create the window as `WS_POPUP`, then switch the style to `WS_CHILD | WS_VISIBLE` and `SetParent` to `SHELLDLL_DefView` (found by sending `0x052C` to `Progman`, then searching `Progman`'s children, falling back to the `WorkerW` that holds one). Win+D, apps in front and clicks then work as probed.
- Positions are screen coordinates converted with `ScreenToClient(DefView)`; `UpdateLayeredWindow` takes the client position.
- The exe needs a manifest with `supportedOS` entries and per-monitor v2 DPI awareness.
- A hidden top-level sink window receives `WM_DISPLAYCHANGE`, `WM_POWERBROADCAST` and `TaskbarCreated`.
- After `TaskbarCreated` (Explorer restart) the widget windows are gone: the host destroys what is left and recreates the windows under the new `SHELLDLL_DefView`.
- Windows 10 is untested. Its desktop is arranged differently (`SHELLDLL_DefView` lives under a `WorkerW` that is a top-level window until `0x052C` is sent), so it needs a check before the Windows 10 claim is made.

## Verification (2026-10-21)

Run during implementation on Windows 11 24H2 with a Release build from `shell-ext-build` (not a `build-local.ps1` package, so the installer, Run entry, update and uninstall items were not exercised):

| Checklist item | Result |
|---|---|
| 6. Win+D keeps the cards; apps cover them | pass (screen pixels read back while Win+D was sent twice; the cards kept their colour while the wallpaper was revealed) |
| 5. Drag and persistence | pass (the user dragged the cards; `layout.json` was rewritten with the new positions) |
| Render of the `ok.json` fixture | pass (screenshot: three cards, rows, "updated 4 min ago", muted/accent/bad tones) |
| `check-widgets.ps1 -Status` | pass (three `NullWidgetsWindow` entries, parent `SHELLDLL_DefView`) |
| 4 (click-through), 7, 8 (sleep/resume, scaling), 9 (Explorer restart) | **not run** — the Explorer-restart recreate path (`EnsureWindows`) is untested |
| 1–3, 10–14 (wizard, setup flow, snapshot data, update, uninstall) | **not run** — need a `build-local.ps1` package and a signed-in account |
| Windows 10 | **not tested** |

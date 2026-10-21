# Desktop widgets — hard gate findings (#141)

Date: 2026-10-21. Machine: Windows 11 Pro 10.0.26100 (24H2). Windows 10: **not tested** (no machine available).

Probe: a 240×120 layered tool window (`WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`) pinned directly above `Progman` through `WM_WINDOWPOSCHANGING`, logging clicks, `WM_DISPLAYCHANGE` and resume to `%TEMP%\widgets-probe.log`.

Pinning with `HWND_BOTTOM` hides the windows behind the desktop; pinning directly above `Progman` works.

| # | Check | Windows 11 24H2 | Windows 10 |
|---|---|---|---|
| 1 | Apps open over the box; the box never comes forward | pass | not tested |
| 2 | Win+D: the box stays visible | **fail** — the box is hidden | not tested |
| 3 | Click flips the colour and logs `click N`, click does not reach windows behind | pass (log: `click 1`–`click 6`) | not tested |
| 4 | Sleep and resume: log gains `resume`, box still visible | **inconclusive** — no `resume` line in the log | not tested |
| 5 | Display change: log gains `WM_DISPLAYCHANGE`, box still visible | pass (log: two `WM_DISPLAYCHANGE` lines) | not tested |
| 6 | Explorer restart (information only) | box stays visible | not tested |

## Verdict: stop

Item 2 fails: Win+D hides a window that is pinned just above `Progman`. The plan's premise ("stay visible through Win+D", measured earlier with the full host) did not reproduce with this probe. Item 4 produced no evidence either way (the probe was possibly not put to sleep, or `WM_POWERBROADCAST` did not reach it). Windows 10 was not tested.

The spec's fallback is an owned-by-desktop parent window (for example parenting each widget to the `WorkerW`/`SHELLDLL_DefView` host that holds the wallpaper), which changes the rendering and z-order design and needs a decision before Task 2 onward is built.

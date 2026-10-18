# Null Setup wizard: manual test runbook (2c-2)

Run on Windows 11 and Windows 10 22H2, from a copy of `null-setup.exe` outside any install (e.g. `C:\Temp\stub\null-setup.exe`). Use `scripts/fake-release.mjs --zip <package.zip> --tag v9.9.9 --builtins <builtins.json>` and start the stub from a terminal with `$env:NULL_SETUP_API_BASE='http://127.0.0.1:8787'`. Record results in the PR.

| # | Scenario | Expected |
|---|---|---|
| 1 | No install; start the stub with no arguments | Wizard, Welcome shows the fake tag |
| 2 | "Use recommended defaults" on page 1 | Jumps to Summary; Install installs with all defaults; Finish offers Launch |
| 3 | Options: untick Start Menu shortcut, folder `C:\Temp\Null IDE ünï` | Folder accepted; no Start Menu shortcut after install |
| 4 | Folder `C:\Windows`, a non-empty folder, `C:\`, `C:\a;b` | Each rejected on Next with a sentence; nothing downloaded |
| 5 | Built-ins: tick Format with Env off; untick Env with Format on | Env ticks itself; the untick is refused naming Format |
| 6 | Built-ins left out | Those folders are absent under `resources\app\extensions` |
| 7 | Settings page: change font size to 16, leave the rest | `%APPDATA%\Null\null-setup\first-run.json` holds only `editor.fontSize`; the IDE applies it once |
| 8 | Settings page untouched | No `first-run.json` |
| 9 | Network off at start | Error page with Retry; Retry works after reconnecting |
| 10 | Release served without `builtins.json` (omit `--builtins`) | Built-ins and Settings pages hidden; install works |
| 11 | Start the stub again with an install present | Maintenance page, not a second install |
| 12 | Maintenance → Modify: change a built-in with the IDE running | "Null IDE is still running" panel with Retry / Close Null IDE / Cancel |
| 13 | Maintenance → Repair | Reinstalls; Finish page |
| 14 | Settings → Apps → Null IDE → Modify, and → Uninstall | Window opens on the Modify / Uninstall page of that install |
| 15 | Uninstall, box unticked | App, shortcuts, PATH entry and Apps entry gone; `%APPDATA%\Null` kept |
| 16 | Uninstall, box ticked | `%APPDATA%\Null` gone too |
| 17 | Delete the install folder by hand, then Apps → Uninstall | "no longer installed" page; Remove entry clears the Apps entry |
| 18 | Kill the window during "Installing" (Task Manager) | Next start: `recover` completes or rolls back (see the engine runbook) |
| 19 | Rename `msedgewebview2` runtime away / machine without WebView2 | Native dialog with the download link, no window |
| 20 | Double-click Install quickly | One job only |
| 21 | Installed IDE (stub install): Command Palette → **Null: Setup**; also Features view → Null Setup | Wizard opens on Modify, pre-filled with the install's choices, IDE keeps running |
| 22 | Same, change only the Start Menu shortcut, apply | Shortcut changes; IDE did not close; no "still running" panel |
| 23 | Same, in a folder `C:\Users\<you>\Zoë B\Null IDE` (install there first) | Window opens on that install; Apply works |
| 24 | Extract `null-ide-win32-x64.zip` by hand, run `null.exe`, **Null: Setup** | Opens Modify for that copy, or the wizard's own "not installed" message; no hang, no crash. Record which. |
| 25 | Dev checkout (`sync-local` is not used): Extension Development Host → **Null: Setup** | One information message, no error |
| 26 | Modify with the IDE running: tick/untick a built-in, Apply | "Null IDE is still running" panel (row 12 behavior); **Close Null IDE** applies the change and offers Launch |
| 27 | Machine with an Inno-installed v1.0.17: run the stub, default folder | Install is refused ("not empty"/"already installed") with a sentence; nothing changed |
| 28 | Same machine: Settings → Apps → uninstall old, then run the stub, then check `%APPDATA%\Null` | Old uninstall keeps `%APPDATA%\Null`; the stub installs; settings/extensions are still there |
| 29 | Install with the Win11 context-menu feature on a machine where the sparse package cannot register, with a preset (font size 16) | Finish page shows the registration warning **and** `first-run.json` exists with `editor.fontSize` (Task 1) |

Row 29: make the sparse package fail to register, for example by ticking the Windows 11 context-menu feature on a Windows 10 VM, where it is unsupported. If that is not possible, mark the row "not run" with the reason; the unit test `cli::tests::merge_reports_each_outcome_and_both_when_both_failed` is then the only evidence.

Matrix for sub-project 2c-3: rows 1-29 on Windows 11 with a release build (`cargo build --release` copy of `null-setup.exe`, `scripts/fake-release.mjs`); rows 1-2, 11-17 and 21-22 on Windows 10 22H2. Record date, OS build, build used, and rows skipped with the reason in the header note. Not yet run.

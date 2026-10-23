# launcher (null_launcher.exe)

Standalone project picker started by the jump list's "More Recent Projects..." (patch 001). Lists every project in `null-recent-projects.json`, opens the chosen one with `null.exe --folder-uri` / `--file-uri` (never `--reuse-window`) and exits. It depends on no running Null window. Design: `docs/specs/project-launcher-design.md`.

Own Cargo workspace (empty `[workspace]`, not part of `setup/`): a library `null_launcher` for the pure logic (`store`, `search`, `meta`, `open`, `fallback`) and a thin Tauri binary (`main.rs`) serving the plain HTML/CSS/JS in `ui/`. The page rules live in `ui/launcher-model.js`, tested with `node --test ui-tests/launcher-model.test.mjs` through `node:vm` (as `setup/ui/wizard-model.js`). Tests: `cargo test --locked`.

## Rules to keep
- **Store contract:** `null-recent-projects.json` in the user-data folder (`<install>\data\user-data` when `<install>\data` exists, else `%APPDATA%\Null`). Entry format is Null's; unknown fields survive a write (`Entry.extra`). Missing, corrupt or non-array file gives an empty list; entries failing `readEntry`'s rules (`extensions/null-tools/src/recentProjects.ts`) are skipped.
- **Display order:** pinned first, then unpinned, each by `timestamp` descending. A blank search keeps it; a query ranks name matches (subsequence) above path-only matches (substring) and the page then shows a flat list.
- **Writes:** pin and remove re-read the file, change the one matching entry (path compared with `store::normalize`), write a sibling `.tmp` and rename. It never prunes (Null does on its next open) and never writes on open. A pinned entry ignores remove.
- **The webview sends only a `path`.** The host re-reads the store and acts on the stored entry; a missing folder is never opened.
- **Untrusted input:** a `.git` file's `gitdir:` pointing at a UNC or verbatim path is ignored (reading it would send the user's NTLM credentials).
- **Single instance:** named mutex `Local\NullLauncher`; a second start raises the window titled `Null Launcher` and exits 0.
- **Close on blur** only after the window has had focus once (`shouldCloseOnBlur`); Windows can refuse the first focus.

## Failure fallback
WebView2 missing or the Tauri run returning an error: `fallback::fallback_args()` (`--open-url -- null://null.null-tools/recent-projects`, the old jump list task) is started silently and the reason is appended to `launcher.log` in the user-data folder (restarted past 64 KiB).

## Test seams
`NULL_LAUNCHER_USER_DATA` overrides the user-data folder and `NULL_LAUNCHER_NULL_EXE` the `null.exe` path, so `cargo run` works against fake data with any program that prints its arguments.

## Not part of null-setup.exe
`null-setup.exe` relocates itself out of the install folder when started from there; a launcher must not. It ships next to `null.exe` instead. `procs::close_all` already closes every process under the install folder during an update, and the launcher has a real window, so it needs no `stop_widgets`-style handling.

Windows-only code (`webview2.rs`, the mutex) is behind `cfg(windows)`. `launcher/gen/` and `target/` are git-ignored.

# Null setup first-run check (sub-project 2c-1)

Result record for `docs/plans/null-setup-first-run.md`, Task 8.

- Windows 11 Pro 10.0.26100, Null IDE v1.0.0 (scratch copy `%LOCALAPPDATA%\NullTest\Null IDE.pristine` with the current null-tools synced in).
- Run on 2026-10-18 with `$env:APPDATA` pointed at a throwaway folder. The scratch copy is portable (`data\` inside the install), so the profile's `settings.json` is `data\user-data\User\settings.json`, not `%APPDATA%\Null\User\settings.json`; `first-run.json` was read from the overridden `%APPDATA%`.
- `ELECTRON_RUN_AS_NODE` was set in the driving shell and made `Null.exe` behave as plain Node; it was cleared before launching.

| # | Check | Result |
|---|---|---|
| 1 | `settings.json` has `files.autoSave` `afterDelay`, `editor.fontSize` 17, `editor.formatOnSave` true, `null.updates.check` false, and neither `terminal.integrated.shell.windows` nor `constructor` | PASS |
| 2 | Output "Null Setup" lists `ignored terminal.integrated.shell.windows`, `ignored constructor` and `could not install not-a.real-extension-zzz` | PASS (log read from disk). The warning toast with **Retry** and the Retry click were not observed; the session had no screen access. |
| 3 | `first-run.json` is gone after start (BOM-prefixed file was accepted) | PASS |
| 4 | User `editor.fontSize` 12 stays 12 against a file value of 30; file gone | PASS |
| 5 | User `editor.formatOnSave` `false` stays `false` against a file value of `true`; file gone | PASS (4 and 5 ran in one launch) |
| 6 | With `null.updates.check` false, "Null IDE Updates" has no "Checking for updates" line at startup | PASS for the startup half. Running **Null: Check for Updates** by hand was not done (code path unchanged). |

Observed limitation: on the very first launch the startup update check still runs once (log line "Checking for updates from TorresVisual/null-ide"), because the updater reads `null.updates.check` at activation before first-run has written `false`. From the second launch on it is off.

## Suites (2026-10-18)

- `cargo test --locked -p null-setup-core -p null-setup`: 161 passed, 0 failed
- `node --test scripts/gen-builtins.test.mjs`: 7 passed, 0 failed
- `npm test` in `extensions/null-tools`: 376 passed, 0 failed

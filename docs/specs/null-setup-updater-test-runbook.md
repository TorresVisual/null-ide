# null-setup updater: manual matrix runbook

Companion to `null-setup-updater-test-record.md` (record results there). Everything runs against a **scratch install**, never your daily one.

## Setup (done on this machine, 2026-10-14)

| Thing | Path |
|---|---|
| Scratch install ("old", reports `v1.0.0`) | `%LOCALAPPDATA%\NullTest\Null IDE` |
| Pristine copy of it, to reset between rows | `%LOCALAPPDATA%\NullTest\Null IDE.pristine` |
| "New" zip (same build, no `.null-ide-install.json`) | `%LOCALAPPDATA%\NullTest\null-ide-win32-x64.zip` |
| Updater logs | `%LOCALAPPDATA%\Null\logs` |

**The fake tag must be `v1.0.17`, not the plan's `v9.9.9`.** null-tools discovers updates through the real `api.github.com/.../releases/latest` (`updater.ts` `getLatestRelease`); `NULL_SETUP_API_BASE` only redirects `null-setup.exe`. So the fake server has to serve whatever tag GitHub currently calls latest, or prefetch gets a 404. Re-check with `gh release list --repo TorresVisual/null-ide --limit 1`.

The repo must be public: the updater calls `releases/latest` without credentials, and a private repo answers "Update check failed - GitHub returned 404". (`requestJson` does send `GITHUB_TOKEN` when set, which only helps discovery, not the download.)

Rebuild the scratch install if the updater changes: `cargo build --release --locked -p null-setup` in `setup/`, then `scripts\sync-local.ps1 -InstallDir "$env:LOCALAPPDATA\NullTest\Null IDE"`. Careful: that script also syncs every other known install (including your real one) unless it is skipped.

## Every row: reset, serve, launch

```powershell
# 1. Reset the scratch install to the old build
Get-Process null -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*NullTest*" } | Stop-Process -Force
robocopy "$env:LOCALAPPDATA\NullTest\Null IDE.pristine" "$env:LOCALAPPDATA\NullTest\Null IDE" /MIR /NFL /NDL /NJH /NJS /NP
Remove-Item "$env:LOCALAPPDATA\Null\updates" -Recurse -Force -ErrorAction SilentlyContinue

# 2. Fake release server (terminal A; add --throttle / --cut-after per row)
node D:\Coding\Apps\null-ide\scripts\fake-release.mjs --zip "$env:LOCALAPPDATA\NullTest\null-ide-win32-x64.zip" --tag v1.0.17

# 3. Launch the scratch IDE from a terminal (terminal B) so it inherits the variable
$env:NULL_SETUP_API_BASE = 'http://127.0.0.1:8787'
& "$env:LOCALAPPDATA\NullTest\Null IDE\Null.exe" --user-data-dir "$env:LOCALAPPDATA\NullTest\user-data"
```

`--user-data-dir` keeps the scratch IDE's settings and state apart from your real one. Then run **Null: Check for Updates** and watch the status bar and the fake server's request log.

`bin\null.cmd` and the registry/PATH entries belong to your real install, so the scratch install is not "registered". That is fine for every row except 7 and 8.

## Rows

| # | Do | Pass if |
|---|---|---|
| 1 | Open **two** windows of the scratch IDE. After the status item shows *Restart to update*, click it. | Both windows close, the new IDE starts, the old install folder is gone, no `.null-update-journal.json` remains. Proves the cwd and `ELECTRON_RUN_AS_NODE` fixes. **Run this first.** |
| 2 | Watch the status bar during the check. | `downloading N%` appears, then `Restart to update`. |
| 3 | Open a console whose cwd is inside `Null IDE`, click update. | The window names what is still running; Retry works after you close the console; *Close Null IDE* forces. |
| 4 | Restart the server with `--cut-after 20000000`. | Download resumes from the `.part` and completes; the log shows the interruption. |
| 5 | Server with `--throttle 500`. Close the check window midway and check again. | Speed and percentage update; the download is not deleted; the second `prefetch` reports `busy`. |
| 6 | Click update, kill `null-setup.exe` in Task Manager right after *Installing…*. Then start the IDE, or run `null-setup.exe recover --install-dir "<install>"` (the exe at `%LOCALAPPDATA%\Null\updates\run\`). | Old install restored; or, if the new IDE already wrote `.null-ready`, the update is committed. |
| 7 | Remove the Null cert from `Cert:\LocalMachine\TrustedPeople` (admin PowerShell; **note its thumbprint first** so you can re-import it), then update. | No UAC prompt, update succeeds, the final page says the context menu needs approval, the existing `NullIDE.ExplorerCommand` package is still registered. Only meaningful if the real shell extension is installed. |
| 8 | Right-click a folder in Explorer first, then update. | Update succeeds (Explorer restarts once), the install folder renames without error. |
| 9 | Make a zip whose `Null.exe` exits at once, serve that. | The update reports failure and the old version comes back and is relaunched. |
| 10 | Copy the pristine folder to `%USERPROFILE%\Programs\Null IDE ünï` and run the scratch IDE from there. | Works end to end. |
| 11 | Serve `--tag "a b"` (the real latest must also differ, so this row needs a source edit or a mocked release; skip if not worth it). | null-tools refuses to spawn (`Refusing to prefetch unexpected tag`). Unit-tested already via `isSafeTag`. |
| 12 | While the progress window says *Installing…*, open a new IDE window. | The update is not rolled back. |
| 13 | After a finished prefetch, stop the fake server (or go offline), then click *Restart to update*. | The update still installs from the staged download. |

Row 11 note: because discovery uses the real API, the fake tag can't differ from GitHub's latest without editing code. `isSafeTag` has unit tests; treat this row as covered unless you want to patch the check by hand.

## Windows 10

The plan asks for Windows 11 **and** Windows 10 22H2. Only Windows 11 is available for now, so the Windows 10 pass stays open in the record.

## After

Fill the Result column in `null-setup-updater-test-record.md` (pass/fail + log path), delete `%LOCALAPPDATA%\NullTest` and `%LOCALAPPDATA%\Null\updates`, and commit the record.

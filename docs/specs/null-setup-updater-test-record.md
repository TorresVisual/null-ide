# null-setup updater: test record

Status: **automated checks passed; the manual matrix is partly run** (3 pass, 1 fail, 9 not verified). Row 3 failed
and is fixed in code but not re-run. Finish the matrix before the first release that ships `setup\null-setup.exe`.

## Automated (2026-10-14)

- `cargo test -p null-setup-core -p null-setup`: 65 tests passed (config, http, release, download, procs, extract, swap, registrations, update, args, relocate).
- `extensions/null-tools`: `npm run compile && npm test`: 365 passed, including 8 in `updateStatus.test.ts`.
- `null-setup.exe prefetch --version v0.0.0-nonexistent`: exits 1, prints `checking` then `failed` with `HTTP 404` and the URL.
- `null-setup.exe update` copied alone into an empty folder opens its window (no side DLL needed).
- `install-null-ide.ps1`, `sync-local.ps1`, `build-local.ps1` parse without errors; `build.yml` parses as YAML.

## Reviews

- Security review (`security-reviewer`): no remote exploit and no privilege escalation. Fixed: per-build certificate made the `-NoElevate` path always ask for approval (the existing registration is now kept), a stale "update available" button, unvalidated journal paths, unbounded download stream, download-lock races, unvalidated `--repo`. Not fixed (same-user hardening only): absolute `System32` paths for `powershell`/`taskkill`/`tasklist`; staging beside the install dir when installed under a world-writable parent.
- Whole-branch review: two Critical bugs found and fixed. The updater inherited the extension host's working directory (the install dir) and `ELECTRON_RUN_AS_NODE`, so every real update would have failed at the first rename or started `null.exe` as plain Node. Neither can be seen by the unit tests, which is why the matrix below matters.
- Task 1 verdict: `docs/specs/updater-root-cause.md` ("architecture"; the Task 2 hotfix was skipped).

## Manual matrix

Steps and inputs: [null-setup-updater-test-runbook.md](null-setup-updater-test-runbook.md). Found while running it: on a portable install (`data\` inside the install) every update failed with `rename … Access is denied` because the updater, started by the extension host, inherited the host's open log files (Node opens files inheritable), which sit inside the install in portable mode. Fixed by `procs::release_inherited_handles`, which closes inherited handles that point into the install before the swap (logged as `closed inherited handle on …`). Re-run row 1 on a portable install to confirm. Note: the fake release must use the tag GitHub currently reports as latest (not `v9.9.9` as the plan says), because null-tools discovers updates through the real API.

| # | Scenario | Result |
|---|---|---|
| 1 | Update with two IDE windows open (also proves the cwd and `ELECTRON_RUN_AS_NODE` fixes) | PASS |
| 2 | Status item: `downloading N%` then `Restart to update` | PASS |
| 3 | Locked files: console with cwd inside the install folder; Retry and Close Null IDE | FAIL (see Notes below) |
| 4 | Network cut mid-download (`--cut-after`) | COULDN'T VERIFY (leave open) |
| 5 | Slow link (`--throttle`); second `prefetch` reports busy | PASS |
| 6 | Kill `null-setup.exe` after "Installing…"; `recover` restores or commits | COULDN'T VERIFY (leave open) |
| 7 | Certificate untrusted: no UAC, update succeeds, existing package still registered | COULDN'T VERIFY (leave open) |
| 8 | Explorer holding the shell DLL | COULDN'T VERIFY (leave open) |
| 9 | Broken new build (exits at once): old version comes back and is relaunched | COULDN'T VERIFY (leave open) |
| 10 | Path with spaces and non-ASCII (`Null IDE ünï`) | COULDN'T VERIFY (leave open) |
| 11 | Tag `a b` refused by null-tools | COULDN'T VERIFY (leave open) |
| 12 | Second IDE window during "Installing…": update not rolled back | COULDN'T VERIFY (leave open) |
| 13 | Offline click on "Restart to update" after a finished prefetch | COULDN'T VERIFY (leave open) |

## Notes

Row 3 (console with its cwd inside the install folder):

| Check | Result |
|---|---|
| Identifies the blocker | Fail — no useful warning |
| Retry after releasing the lock | Not tested |
| Close Null IDE option | Not observed |
| Install rename | Failed with OS error 5 |

Cause: `procs::running_in` matched processes by executable path only, so a console running from elsewhere but
sitting in the install folder was never listed and the rename hit it unannounced. Fixed: it now also matches a
working directory inside the install (`finds_a_process_whose_working_directory_is_inside_the_directory`). Re-run
row 3 by hand to confirm the dialog appears; Force close will end that console, as it does any listed process.

## Known gaps carried into the release

- No automatic recovery when the process is killed while the install directory is renamed away (`null-setup recover --install-dir …` restores it).
- Opening the IDE during the registration step can make a successful update report failure.
- A rollback restores the install folder but not the HKCU registrations that `-ReapplyRegistrations` already rewrote. Harmless when the same folder is updated; found when a scratch install updated and its registrations replaced those of the daily install.
- The updater relaunches `Null.exe` with no flags. An IDE started with `--user-data-dir` (or any other instance holding the default profile's lock) makes the relaunched process hand off and exit 0, which the updater reports as "the new Null IDE exited right after the update" and rolls back. Seen while testing; the matrix uses a portable scratch install to avoid it.
- `bin\null.cmd` comes from the zip, not from the installer.
- Installs from before this release have no `setup\null-setup.exe`: the first release containing it must be installed by hand (README says so). Keep the previous release's installer and zip available for rollback.

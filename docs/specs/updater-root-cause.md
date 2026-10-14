# Updater failures: root cause (#12, #120)

## Reported symptoms

- #12 "Fix broken updater": filed from `TODO.md` as an **unreproduced** report. No error text, Windows version or Null IDE version was recorded. A later audit comment says the native-updater fix plan (`docs/plans/native-updater-fix.md`) had already landed and recommends one real update smoke test.
- #120: the update check runs once at activation, and startup-check failures are swallowed silently (`.catch(() => {})`), so a rate-limited or failed check looks like "no update".

No reporter-supplied error text exists in either issue.

## Evidence on this machine (2026-10-14)

- Installed `.null-ide-install.json`: `version v1.0.17`, `installedAt: null`, `installDir: null`. Latest release is `v1.0.17`, so there is no version mismatch here.
- Leftovers: six `%TEMP%\null-ide-updater-*` directories (the latest, `…1783685361752`, is empty); no `null-ide-update*` staging directory and no `*null-ide-*` backup beside the install directory.
- The "Null IDE Updates" output channel is not persisted, so no log of a failed attempt was available.

## Hypotheses

| # | Hypothesis | Result | Evidence |
|---|---|---|---|
| H1 | Staging race: every check deletes the shared staging root | **Confirmed by reading code, not reproduced as a user-visible failure** | `stageUpdateInBackground` (`updater.ts`) calls `fs.rmSync(stagingRoot(), …)` before every download, with no in-process or cross-window guard. A second window or a second check deletes a zip another one is still writing, or one "Update Now" is about to use. |
| H2 | Explorer holds `null_explorer_command.dll`, blocking the directory rename | **Untested** | Needs the manual `tasklist /m` + rename-the-live-install check; not run here because it renames the user's real install. Keep `shellext.rs`. |
| H3 | Version metadata mismatch makes the updater believe it is current | **Refuted on this machine** | Installed and latest are both `v1.0.17`. `installedAt`/`installDir` are `null` (Inno-installed copy) but null-tools only reads `version`/`repo`. |
| H4 | `null-updater.exe` gives up too early | **Confirmed by reading code** | `updater/src/main.cpp` `WaitForIdeExit` waits 15 s, then force-kills the IDE tree (`KillProcessesInDir`); there is no wait with visible blocking-process names, and no journal, so a crash mid-swap leaves a half-swapped install. |

## Verdict

The failure was never reproduced, and the reproducible defects (H1 staging race, H4 forced kill after 15 s, silent check failures) are properties of the whole pipeline, not one contained bug. The spec already replaces the pipeline with `null-setup`; a hotfix to `updater.ts` would be deleted in Task 14.

Verdict: architecture (skip Task 2)

---
name: verify-local
description: Sync current extension/workbench source into the real local Null IDE install, then run the target extension's integration specs against that build. Use when asked to verify a change actually works, not just that it compiles or passes unit tests.
---

# Verify Local

Verifies a source change by syncing it into the real, already-installed local Null IDE (not the CI-only full build) via `scripts/sync-local.ps1`, then running an extension's `@vscode/test-electron`-based integration specs against the synced extension code.

## Steps

1. **Sync.** Run `scripts/sync-local.ps1` from the repo root via the PowerShell tool. If it errors, stop and report the error — do not proceed to testing against a possibly stale or partially-synced install.

2. **Resolve the target extension.** Use the extension folder name passed as this skill's argument (e.g. `/verify-local null-actions`). If no argument was given, default to `null-actions`.

3. **Check for integration specs.** Read `extensions/<name>/package.json`. If it has no `test:integration` script, tell the user this extension has no integration specs yet (only `null-actions` and `null-tools` do today — see `docs/specs/local-verification-tooling-design.md`), offer to run its `npm test` unit tests instead if it has one, and stop.

4. **Run the specs.** Run `npm --prefix extensions/<name> run test:integration`. Note this launches a separately downloaded vanilla VS Code build to host the test run (not the real `Null.exe`) — the real `Null.exe` collides with the Null IDE window this skill is normally invoked from (a fixed `win32MutexName` in `product.json`, the same for every build regardless of install path). The extension code under test is still the exact code `sync-local.ps1` just synced; only the host shell differs. The first run downloads and caches that build (~300MB), so it can take noticeably longer than subsequent runs.

5. **Report results.**
   - On success: name what was verified — which spec file(s) ran and what they asserted (e.g. "activation.spec.ts: null-actions activates and registers null-actions.openSettings / null-actions.runButton").
   - On failure: show the actual Mocha failure output (assertion message, spec name) rather than summarizing it away — the user needs the real error to fix it.

6. **Remind about manual verification.** Note that `Developer: Reload Window` inside Null IDE is still the way to eyeball a change visually.

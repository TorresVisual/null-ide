# Local Verification Tooling — Design

CLAUDE.md forbids running the full VSCodium build locally (it's CI-only), which left no fast way to check that a source change actually works in a real Null IDE window, or that it doesn't just compile but behaves correctly. This adds three pieces that work together: a script that pushes current source into an already-installed local build, an integration-spec harness that exercises that build through the real `vscode` API, and a Claude skill that ties both into one command.

## Goals

- Get a source change from `extensions/*/src` (or `workbench/`) into a real, already-installed Null IDE without running the CI build pipeline.
- Verify a change with more than a compile check: run specs against the real Extension Development Host, using the actual `vscode` API, against the exact files just synced.
- Make "verify this" a single Claude-invocable action.

## Non-goals

- Not a replacement for the CI build — `shell-ext/` (native C++ DLL), `product.json`/icon stamping, and the installer itself are untouched by this tooling and still require a real release build.
- Not a watch-mode / hot-reload system. Sync is a manual, one-shot command; the developer reloads the window themselves.
- Not sandboxed. Specs run against the developer's real `%APPDATA%\Null` profile and real installed extensions, not a disposable user-data-dir. A spec that corrupts settings or crashes hard can affect the daily-driver install — an accepted tradeoff for now.
- Only `null-actions` gets integration specs in this pass. The other six built-in extensions keep only their existing `node --test` unit tests (or none) until the pattern is proven and rolled out separately.
- No CI wiring. This is local-only tooling; whether `npm test` / `npm run test:integration` ever gate the GitHub Actions build is a separate decision.

## Component 1: `scripts/sync-local.ps1`

Follows the conventions already established by `install-null-ide.ps1` / `update-null-ide.ps1`: `[CmdletBinding()]`, `$ErrorActionPreference = "Stop"`, a `Write-Step` helper.

**Param:** `-InstallDir` (default `"$env:LOCALAPPDATA\Programs\Null IDE"`). No scope-filtering flags — every run syncs everything.

**Preflight:**
- Errors out if `<InstallDir>\resources\app\extensions` doesn't exist, pointing at `install-null-ide.ps1`.
- Warns (doesn't block) if a `null`-named process is running under `<InstallDir>`, reusing the same detection approach as `Test-NullIdeRunning` in `install-null-ide.ps1`.

**Per-extension sync**, using a hardcoded map (mirrors the extension list already documented in CLAUDE.md — no generic build-system abstraction):

| Extension | Compile step | Copied into `resources\app\extensions\<name>\` |
|---|---|---|
| `null-theme` | none | `package.json`, `themes/` |
| `null-icons` | none | `package.json`, `src/` |
| `null-markdown` | none | `package.json`, `extension.js`, `preview/` (its `node_modules` is **not** synced — a dependency change still needs a real build) |
| `null-tools` | `npm run compile` | `package.json`, `out/`, `lib/` |
| `null-cpp` | `npm run compile` | `package.json`, `out/` |
| `null-actions` | `npm run compile` | `package.json`, `out/`, `lib/` |
| `wooting-analog` | `npm run compile` (via `tsc`) | `package.json`, `out/`, `native/*.node` |

Rules:
- Before compiling an extension that has a compile step, check `node_modules` exists; if not, `Write-Warning` and skip that extension (never silently runs `npm ci`).
- `wooting-analog` additionally checks `native/*.node` exists (the gitignored, `napi build`-generated addon); if missing, warn and skip the whole extension — without the addon it can't load anyway.
- `out/` and `lib/` are synced with `robocopy /MIR` (mirrors, deleting stale compiled files); single files (`package.json`, `extension.js`) use `Copy-Item -Force`.

**Workbench assets:** copies `workbench/custom.css` → `<InstallDir>\resources\app\out\vs\code\electron-browser\workbench\null-custom.css` and `workbench/splash.js` → `...\null-splash.js` (paths confirmed against a real local install). If that directory doesn't exist (different VSCodium layout), warn and skip rather than fail the run.

**Closing message:** reminds the developer to run `Developer: Reload Window` inside Null IDE — a full renderer reload, so it re-reads both extension code and the linked workbench CSS/JS; no app restart needed. Also notes the tooling doesn't touch `shell-ext/`, `product.json`, or icons.

## Component 2: Integration-spec harness (`extensions/null-actions/`)

New devDependencies: `@vscode/test-electron`, `mocha`, `@types/mocha`.

Confirmed against current `@vscode/test-electron` docs: `runTests({ vscodeExecutablePath, extensionDevelopmentPath, extensionTestsPath, launchArgs })` accepts an existing executable path instead of downloading one, and the Mocha loader pattern uses `ui: 'tdd'` with glob-based test discovery.

**New files:**
- `src/test/runTest.ts` — plain Node entry point (never bundled as part of the extension; nothing references it as `main`). Resolves the install dir from `NULL_IDE_INSTALL_DIR` env var, defaulting to `%LOCALAPPDATA%\Programs\Null IDE`. Calls `runTests()` with:
  - `vscodeExecutablePath` = the install's `*.exe` (found by globbing for an `.exe` that isn't `unins*`, same approach as `Get-NullIdeExecutable` in `install-null-ide.ps1` — avoids hardcoding `Null.exe`'s exact case).
  - `extensionDevelopmentPath` = `<installDir>\resources\app\extensions\null-actions` — the **synced copy**, so specs verify exactly what `sync-local.ps1` just wrote, not the repo source.
  - `extensionTestsPath` = the repo's own compiled `out/test/suite/index.js`. Test code stays in the repo and is never synced into the real install.
  - `launchArgs` = `[tempWorkspaceDir]`, a disposable folder created under `%TEMP%` per run and removed in a `finally` block after `runTests()` settles, so specs have a workspace to operate in without touching a real project or leaking temp dirs. (User-data-dir and installed-extensions are intentionally left as the real profile, per the non-goals above.)
- `src/test/suite/index.ts` — Mocha `tdd`-UI loader; globs `**/*.spec.js` under the compiled `out/test/suite/` directory and runs them.
- `src/test/suite/activation.spec.ts` — first spec: asserts the extension activates and that `null-actions.runButton` and `null-actions.openSettings` are present in `vscode.commands.getCommands(true)`.

**Naming convention:** `.spec.ts` = integration spec, running inside the real Extension Development Host via the harness above. `.test.ts` = the existing pure-logic unit tests, running via plain `node --test`. The two never collide — `package.json`'s `"test"` script explicitly lists `.test.js` files by name, so it's unaffected by new `.spec.ts` files.

**`tsconfig.json`:** its `include` array is an explicit file list (not a glob), matching every existing file in the extension — add the three new files (`src/test/runTest.ts`, `src/test/suite/index.ts`, `src/test/suite/activation.spec.ts`) to it by name.

**`package.json` scripts:**
```json
"pretest:integration": "tsc -p tsconfig.json",
"test:integration": "node ./out/test/runTest.js"
```

## Component 3: `.claude/skills/verify-local/SKILL.md`

A project-scoped skill (matching the existing `.claude/skills/<name>/SKILL.md` convention) that ties the two scripts together as one Claude-invocable action.

Frontmatter: `name: verify-local`, a `description` covering "sync current source into the real local Null IDE install and run its integration specs against that build; use when asked to verify a change actually works, not just that it compiles."

Body instructs Claude to:
1. Run `scripts/sync-local.ps1` from the repo root via the PowerShell tool; stop and report if it errors.
2. Resolve the target extension from the skill's `args` (default `null-actions`).
3. Check `extensions/<name>/package.json` for a `test:integration` script. If absent, tell the user this extension has no integration specs yet (only `null-actions` does today) and offer to run its `npm test` unit tests instead, or stop.
4. Run `npm --prefix extensions/<name> run test:integration`.
5. Report results: on success, name what was verified (which specs, which assertions); on failure, surface the Mocha failure output directly rather than summarizing it away.
6. Remind the user that `Developer: Reload Window` is still the way to eyeball the change manually, and that this tooling runs against their real profile (per the non-goals above).

## Testing

- `sync-local.ps1`: manual verification — make a trivial edit in `null-actions` (e.g. change a status bar label), run the script, reload the window, confirm the change appears; run again with `node_modules` deleted from one extension and confirm it warns and skips rather than failing the whole run.
- `activation.spec.ts`: run `npm run test:integration` in `extensions/null-actions` directly; confirm it fails if a command registration is temporarily commented out, and passes once restored (proves the spec actually exercises real activation, not a stub).
- `verify-local` skill: invoke it once with a deliberately broken `null-actions` change (e.g. a syntax error) and confirm the failure surfaces clearly; invoke it once with a passing change and confirm the success summary is accurate.

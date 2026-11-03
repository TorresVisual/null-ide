# Null Unreal — Engine Tooling Design

First of three specs for Unreal Engine support in Null IDE. This one covers the project tooling: build, test, run, smoke and the clangd database. Follow-ups, each with its own spec:

2. **Asset core** — the engine exports a `.uasset` to cached JSON (and PNG / GLB sidecar files) through a commandlet.
3. **Asset viewers** — one per asset type on top of the core (material node graphs, textures, meshes). The viewers are the reason Null IDE wants Unreal support at all; this spec comes first because the extension it creates is where they will live.

## Milestones

This spec is built in two milestones, so the viewers are reached before the polish. [decided]

- **M1 — foundation:** the `null-unreal` extension, the CLI shell, engine and project resolution, the raw `build` / `test` / `run` / `smoke` commands (result line and log path, no summarizing), logs and rotation, timeouts, exit codes, and the status-bar Run button. The asset core needs exactly this.
- **M2 — polish, after the first viewer exists:** the output summarizers (and their capture phase), `compdb`, and the remaining palette commands.

The implementation plan for M1 is written first. Plans for M2, the asset core and the viewers wait for the asset core's capture spike.

## Goal

Make an Unreal project feel native in Null IDE, for two users of the same commands:

- **The developer** clicks Run from the status bar and finds Build, Test, Smoke and the clangd database in the command palette.
- **The coding agent** (Claude Code, driving a shell) runs the same commands through a small CLI that resolves the engine and project by itself and prints a short summary instead of the engine's full log. The point is to keep thousands of lines of `BuildCookRun` / `-FullStdOutLogOutput` text out of the agent's context.

Both go through one code path, so the buttons and the agent can never disagree about how a build is run.

## Today

The developer runs four hand-written commands against UE 5.8 (`<UE_ROOT>`) and the project `MyGame.uproject`, each prefixed with `$(pwd -W 2>/dev/null || pwd)` to get a Windows path:

| Task | Command |
|---|---|
| build | `AutomationTool.exe BuildCookRun -project=… -platform=Win64 -build -cook` |
| test | `UnrealEditor-Cmd.exe <uproject> -ExecCmds="Automation RunTests MyGame.; Quit" -unattended -nullrhi -stdout -FullStdOutLogOutput` |
| run | `UnrealEditor.exe <uproject> -game -windowed -ResX=1280 -ResY=720` |
| smoke | `UnrealEditor-Cmd.exe <uproject> -game -nullrhi -unattended -stdout -ExecCmds="Quit"` |

Engine path and project name are hard-coded. Output is raw log text. Nothing in the repo knows about Unreal: `null-cpp` would treat a UE project as C++ (clangd, `Alt+O` header/source switching) but has no CMake to drive, and `null-actions` could run these as shell buttons but cannot find the engine or read the output.

## Non-goals and anti-goals

- **No debugging** in this spec. Microsoft's vsdbg is not licensed for VSCodium-based editors; native debugging would go through CodeLLDB on PDBs and is its own investigation.
- **No project-file generation, packaging beyond `-build -cook`, plugin or module scaffolding, editor-in-the-loop features** (live coding, hot reload triggers).
- **Windows only for v1**, labelled experimental in the README. Paths live in one function (`engine.ts`) so Linux can be added without a rewrite.
- **No use of a running editor.** Unreal's Python remote-execution feature (unauthenticated UDP multicast that runs arbitrary Python in the editor, off by default) could answer asset queries instantly and show unsaved state. It is a deliberate non-goal for all three specs: it adds a security-sensitive editor setting for a speed-up the 6 s commandlet route already makes acceptable. [decided]
- **Anti-goal: a summary that hides a failure.** A green summary is only printed on a positive signal (see *Summaries*). When the parser finds nothing it understands, it prints the tail of the log and says so. The full log is always saved and its path is always printed.
- **Anti-goal: a second place that knows how to run Unreal.** The extension never builds a command line itself; it spawns the CLI.

## Decisions

1. **New built-in extension `extensions/null-unreal/`**, workspace-side (no `extensionKind`, like `null-cpp` / `null-env`), activated by `workspaceContains:**/*.uproject`, shipped in every Null IDE install (the activation gate keeps non-Unreal users from paying at runtime). It checks the machine that has the engine, including a remote window. [decided]
2. **The CLI is a plain Node script, `out/cli.js`, with no `vscode` import.** The extension's commands spawn it; the agent calls it. It runs on the editor's own runtime (`null.exe` with `ELECTRON_RUN_AS_NODE=1`), so no system Node is required. [my call — verify early that this works from a shim on Windows]
3. **Engine resolution from the `.uproject`'s `EngineAssociation`, with an override.** Version string (`5.8`) → launcher install (registry `HKLM\SOFTWARE\EpicGames\Unreal Engine\<ver>\InstalledDirectory`, then `LauncherInstalled.dat`); GUID → source build (`HKCU\SOFTWARE\Epic Games\Unreal Engine\Builds`); empty → the project sits inside an engine tree, walk up to `Engine/`. `null-unreal.enginePath` overrides all of it. Failure to resolve is an explicit, actionable error, never a guess.
4. **Project resolution:** the CLI walks up from the working directory to the first `.uproject`; `--project` overrides. Several `.uproject` files in one directory is an error that lists them (setting `null-unreal.project` picks one for the extension).
5. **Logs are always kept.** Every run writes `<project>/Saved/NullUnreal/<command>-<timestamp>.log` (`Saved/` is gitignored in standard UE projects), keeping the latest 10 per command. The summary prints the path.
6. **Pure core, thin shells.** Same convention as `null-env`: engine resolution, command-line building and summarizing are pure modules, tested with `node --test` and fixture logs; only `extension.ts`, `statusBar.ts` and `commands.ts` import `vscode`.

## CLI

`null-unreal <build|test|run|smoke|compdb> [--project <uproject>] [--filter <prefix>] [--timeout <s>] [-- <extra engine args>]`

| Command | Runs | Prints |
|---|---|---|
| `build` | `AutomationTool BuildCookRun -project -platform=Win64 -build -cook` | Result line, then compile / cook / link errors (see below) |
| `test` | `UnrealEditor-Cmd … -ExecCmds="Automation RunTests <filter>; Quit" -unattended -nullrhi -stdout -FullStdOutLogOutput` | Counts, failing tests by name with their messages |
| `run` | `UnrealEditor <uproject> -game -windowed -ResX=1280 -ResY=720` | Exit status only |
| `smoke` | `UnrealEditor-Cmd <uproject> -game -nullrhi -unattended -stdout -ExecCmds="Quit"` | Pass/fail, plus fatal or `appError` lines from the log |
| `compdb` | UnrealBuildTool `-mode=GenerateClangDatabase` for the project's editor target | Path of the resulting `compile_commands.json` |

- Defaults match the commands above. `--filter` defaults to `<ProjectName>.` (the project's own tests, as today). Extra arguments after `--` are appended; settings `null-unreal.<command>.args` give persistent additions. Platform (`Win64`) and resolution are defaults, not hard-coded.
- Foreground by default: the CLI returns when the process exits and its exit code is the process's (or non-zero when the summarizer proves a failure the process did not signal). `smoke` and `test` have a timeout (default 120 s and 600 s) that kills the whole process tree and reports a timeout.
- The CLI is the only place a command line is built.

### Summaries

Caps keep output small: at most 30 error lines and 20 failed tests, then `… N more, see <log>`. Duplicates collapse with a count.

- **build:** UBT/MSVC diagnostics (`file(line): error Cnnnn: …`, `error LNK…`), UAT `ERROR:` lines and cook errors (`LogCook: Error:`), and the final `AutomationTool exiting with ExitCode=N` / `BUILD SUCCESSFUL|FAILED`. Success needs a success signal, not only the absence of errors.
- **test:** the automation controller's per-test completion lines (name, path, result) and any error/warning lines attached to a failed test. Pass requires at least one test reported and none failed. Zero tests found is reported as such (almost always a wrong filter) and is a failure. `UnrealEditor-Cmd` can exit 0 on failing tests, so the parsed result decides the CLI's exit code.
- **smoke:** exit code 0 and no fatal/`appError` marker in the log.
- **Unrecognised output:** print `could not summarize; last 40 lines:` plus the tail, and exit with the process's code (non-zero if it was 0, so an unparsed run is never green).
- The exact log line formats must be captured from real UE 5.8 runs on `MyGame` and stored as fixtures; the patterns above describe intent, not verified regexes. **The first build phase is a capture phase**, before any parser is written: the developer's machine has UE 5.8 and `MyGame`, so record real logs for build, test, smoke and run, plus deliberately broken inputs for the failure fixtures (a compile error, a failing test, a filter that matches nothing, a crash on launch). [my call]

### Exit codes

Part of the CLI contract, because the agent branches on them. [my call]

| Code | Meaning |
|---|---|
| process code | the engine process failed; passed through unchanged |
| 1 | the process exited 0 but the summarizer proved a failure (failed tests, zero tests, unparsed output) |
| 2 | usage or resolution error (no engine, no or several `.uproject`, bad arguments) |
| 124 | timeout; the process tree was killed |

## Extension surface

- **Status bar:** a Run button (the developer's main action) while a `.uproject` workspace is open.
- **Commands:** `Null Unreal: Run | Build | Test | Smoke | Generate clangd Database | Show CLI Path | Open Last Log`. Each spawns the CLI and shows progress; failures offer *Open Log* and list the summary in an Output channel. `run` is spawned without blocking the UI and reports only a non-zero exit.
- **Settings:** `null-unreal.enginePath`, `null-unreal.project`, `null-unreal.<command>.args` (array), nothing else.
- **Terminal PATH:** the extension prepends the folder holding a `null-unreal` shim (`.cmd` plus POSIX `sh`) via `environmentVariableCollection`, so `null-unreal build` works in the integrated terminal. For agents started outside the integrated terminal, `Show CLI Path` prints the absolute path of the shim and a short usage snippet the developer can paste into their own `CLAUDE.md` or a skill. The extension never writes into the project's `CLAUDE.md` or `.claude/` itself. [decided]
- **No Problems-panel integration in v1.** A problem matcher only works on a VS Code Task over raw compiler lines, and the CLI prints a capped, deduplicated summary, so it would break the one-code-path rule. The summary's `file(line)` locations are clickable in the terminal. Revisit with a diagnostics collection fed from the CLI's summary if wanted. [my call]

## Registration (follows `null-devcontainer`)

New extension touches the same places as the last one: `build.yml` (compile step, copy step, both REH lists), `scripts/build-local.ps1`, `scripts/sync-local.ps1`, `product.json` built-in list, `setup/builtins.config.json`, `README.md`, and the root `CLAUDE.md` (extension count, list, build step). Add `extensions/null-unreal/CLAUDE.md`. `out/` is tracked; refresh it with `chore: refresh null-unreal compiled output`. List new test files explicitly in `package.json`'s `test` script.

## Testing

- Unit (`node --test`): engine resolution with injected registry/fs readers (version, GUID, empty association, override, nothing found); command-line building; each summarizer against fixture logs for pass, fail, zero tests, and unrecognised output; log rotation. The repo is public: log fixtures are scrubbed of project names, asset names and local paths before they are committed.
- Integration (`/verify-local null-unreal`): in the real build against `MyGame`, `smoke` and `test --filter <known test>` return the expected summary and the Run button launches the editor.

## Open items for the builder

- Confirm `ELECTRON_RUN_AS_NODE` via `null.exe` works for the shim (Decision 2); fall back to requiring `node` on PATH only if it cannot.
- `GenerateClangDatabase` output location and whether clangd needs `.clangd` / `--compile-commands-dir` wiring; decide how `compdb` hands the file to clangd and whether `null-cpp` needs to change at all.
- How `null-cpp`'s C++ detection should treat a UE project (header/source switching is wanted; it should not offer CMake affordances).
- Whether `null-env` gains a `*.uproject` entry (recommended: clangd) — optional, not needed for v1.

## Follow-ups

- **Asset core spec:** [null-unreal-asset-core-design.md](null-unreal-asset-core-design.md). Decided: the engine reads assets through a commandlet (no byte-level parser), as a new `export` command of this CLI.
- **Viewer specs:** webview custom editors registered by `null-unreal` for `.uasset` / `.umap`.

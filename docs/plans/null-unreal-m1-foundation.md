# Null Unreal M1 (Foundation) Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** A built-in `null-unreal` extension plus a `null-unreal` CLI that runs an Unreal project's `build`, `test`, `run` and `smoke` commands for the developer (status-bar Run button, palette) and a coding agent (shell), resolving engine and project by itself.

**Architecture:** A pure core (`uproject`, `engine`, `commandLine`, `logs`, `runner`, `result`, `cli`, `shim`) with no `vscode` import, tested with `node --test`. `out/cli.js` is the only place a command line is built. The extension (`extension`, `commands`, `statusBar`) only spawns the CLI on the editor's own runtime (`ELECTRON_RUN_AS_NODE=1`) and shows its output.

**Tech Stack:** TypeScript (CommonJS, ES2022), Node `child_process`/`fs`, `node --test`, VS Code extension API. Same layout as `extensions/null-env`.

**Spec:** `docs/specs/null-unreal-tooling-design.md` (issue #149). This plan is **M1 only**: summarizers, the capture phase, `compdb`, Open Last Log and Generate clangd Database are M2.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Extension dir `extensions/null-unreal/`, id `null.null-unreal`, workspace-side (no `extensionKind`), `activationEvents: ["workspaceContains:**/*.uproject"]`.
- The CLI is a plain Node script `out/cli.js` with no `vscode` import; it runs on `null.exe` with `ELECTRON_RUN_AS_NODE=1`, so no system Node is required.
- Only `extension.ts`, `statusBar.ts`, `commands.ts` import `vscode`. Everything else is pure and takes injected readers (fs, registry, spawn, clock).
- Windows only. All engine paths live in `engine.ts`.
- Settings, nothing else: `null-unreal.enginePath`, `null-unreal.project`, `null-unreal.<command>.args` (array, M1: build, test, run, smoke).
- Logs: `<project dir>/Saved/NullUnreal/<command>-<timestamp>.log`, keep the latest 10 per command, path always printed.
- Defaults: `build` = `AutomationTool BuildCookRun -project=<uproject> -platform=Win64 -build -cook`; `test` = `UnrealEditor-Cmd <uproject> -ExecCmds="Automation RunTests <filter>; Quit" -unattended -nullrhi -stdout -FullStdOutLogOutput` with `--filter` defaulting to `<ProjectName>.`; `run` = `UnrealEditor <uproject> -game -windowed -ResX=1280 -ResY=720`; `smoke` = `UnrealEditor-Cmd <uproject> -game -nullrhi -unattended -stdout -ExecCmds="Quit"`.
- Timeouts: `smoke` 120 s, `test` 600 s (`--timeout <s>` overrides); `build` and `run` have none. A timeout kills the whole process tree.
- Exit codes: engine process code passed through; 2 usage or resolution error; 124 timeout. (Code 1, "summarizer proved a failure", arrives in M2.)
- Anti-goal: the extension never builds a command line itself.
- `out/` is tracked: after editing `src/`, `npm run compile` and commit the refreshed `out/` as `chore: refresh null-unreal compiled output`. Never hand-edit `out/`. New test files go in `package.json`'s explicit `test` list.
- The repo is public: no real project names, asset names or local paths in committed fixtures or docs (use `MyGame`, `<UE_ROOT>`).

## Review Focus

- A `.uproject` with a UTF-8 BOM (Unreal's own tools write one): must parse, not throw. Pinned in Task 2.
- A project or engine path containing spaces: arguments are passed as an array, never through a shell. Pinned in Task 4.
- `EngineAssociation` missing, empty, a GUID with or without braces, or a version with no installed engine: explicit actionable error naming what was looked for. Pinned in Task 3.
- A timeout while UAT has spawned child processes (UBT, cook): the whole tree dies and exit is 124. Pinned in Task 6.
- Engine process killed by a signal or crashing (`code === null`): must not exit 0. Pinned in Task 7.
- `Saved/` missing or log dir not writable: create it; if impossible, still run, print a warning and say no log was kept. Pinned in Task 5.

---

### Task 1: Spike the runtime and scaffold the extension

**Files:**
- Create: `extensions/null-unreal/package.json`, `tsconfig.json`, `CLAUDE.md`, `src/extension.ts`
- Modify: `.github/workflows/build.yml` (compile step after null-devcontainer ~L243; copy step ~L266; the two bash loops ~L980 and ~L987), `scripts/build-local.ps1` (~L339, ~L356), `scripts/sync-local.ps1` (entry like `null-devcontainer`, Copy = `package.json`, `out`), `setup/builtins.config.json`, `README.md` (extension table), `docs/wiki/Extensions.md`
- Do **not** add to the REH list (build.yml ~L540): the engine is Windows-only and remote hosts are Linux. Say so in `CLAUDE.md`.

**Interfaces:**
- Produces: a compiling extension `null.null-unreal` whose `activate` does nothing yet; the registration in every list that names the other built-ins; `product.json` is **not** touched (`extensionAllowedProposedApi` is only for proposal users).

- [ ] **Step 1: Verify Decision 2 before building on it.** On an installed Null IDE, run `ELECTRON_RUN_AS_NODE=1 "<install>\null.exe" -e "console.log(process.version)"` from both cmd and Git Bash. Expected: a Node version string, no window. If it fails, stop and tell the user (fallback is requiring `node` on PATH, a spec change).
- [ ] **Step 2: Create `package.json`** modelled on `extensions/null-env/package.json`: name `null-unreal`, displayName `Null Unreal`, `activationEvents` as in Global Constraints, `main ./out/extension.js`, scripts `compile`/`test`/`pretest:integration`/`test:integration` as null-env (test list starts empty and grows per task), same devDependencies. Contribute the settings from Global Constraints (`null-unreal.build.args` etc. as `array` of `string`, default `[]`; `enginePath` and `project` as `string`, default `""`) and commands `null-unreal.run|build|test|smoke|showCliPath` titled `Null Unreal: Run | Build | Test | Smoke | Show CLI Path`. Copy `tsconfig.json` from null-env unchanged.
- [ ] **Step 3: `src/extension.ts`** exports `activate(context: vscode.ExtensionContext): void` and `deactivate(): void`, both empty.
- [ ] **Step 4: Register everywhere** listed under Files, by adding `null-unreal` next to `null-devcontainer` in each list and each per-extension step (copy the null-devcontainer compile step verbatim). Write `CLAUDE.md` in the style of `extensions/null-env/CLAUDE.md` (purpose, pure/vscode split, "not in REH because Windows-only", pointers to the spec and this plan).
- [ ] **Step 5: Verify.** `npm ci && npm run compile` in `extensions/null-unreal` succeeds; `git grep -n null-devcontainer -- .github scripts setup README.md docs/wiki` and `git grep -n null-unreal` list the same files (minus `product.json`).
- [ ] **Step 6: Commit** `feat(null-unreal): scaffold the extension and register it as a built-in (#149)`, then `chore: refresh null-unreal compiled output`.

### Task 2: Project resolution

**Files:**
- Create: `extensions/null-unreal/src/uproject.ts`, `src/uproject.test.ts`
- Modify: `package.json` test list

**Interfaces:**
- Produces:
  ```ts
  export interface Uproject { file: string; dir: string; name: string; engineAssociation: string }
  export interface ProjectFs { readdir(dir: string): string[]; readFile(p: string): string; exists(p: string): boolean }
  export class ResolveError extends Error {}   // exit-code-2 errors, used by tasks 3 and 7
  export function resolveProject(cwd: string, explicit: string | undefined, fs: ProjectFs): Uproject
  ```
  `name` is the file name without extension; `engineAssociation` is `""` when the key is absent.

- [ ] **Step 1: Write failing tests** (`node:test`, an in-memory `ProjectFs`): walks up from `<root>/Source/Game` to `<root>/MyGame.uproject`; `explicit` wins over walking and may be a file or a directory holding one `.uproject`; two `.uproject` in one dir throws `ResolveError` whose message lists both names; none found up to the drive root throws `ResolveError` mentioning `--project`; a file starting with `\uFEFF` parses (Review Focus); malformed JSON throws `ResolveError` naming the file.
- [ ] **Step 2: Run** `npm test` — FAIL (module missing).
- [ ] **Step 3: Implement `resolveProject`**; strip a leading BOM before `JSON.parse`.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(null-unreal): resolve the project from the working directory (#149)`.

### Task 3: Engine resolution

**Files:**
- Create: `extensions/null-unreal/src/engine.ts`, `src/engine.test.ts`
- Modify: `package.json` test list

**Interfaces:**
- Consumes: `Uproject`, `ResolveError` (Task 2).
- Produces:
  ```ts
  export interface EngineReaders {
    registry(key: string, value: string): string | undefined;   // reg query wrapper
    readFile(p: string): string | undefined;
    exists(p: string): boolean;
  }
  export interface Engine { root: string; editor: string; editorCmd: string; automationTool: string }
  export function resolveEngine(project: Uproject, override: string | undefined, r: EngineReaders): Engine
  export const realReaders: EngineReaders   // shells out to `reg query`, reads fs; not unit-tested
  ```
  Binaries: `<root>\Engine\Binaries\Win64\UnrealEditor.exe`, `UnrealEditor-Cmd.exe`, `<root>\Engine\Binaries\DotNET\AutomationTool\AutomationTool.exe`.

- [ ] **Step 1: Write failing tests** with fake readers: override wins over everything; version `5.8` → `HKLM\SOFTWARE\EpicGames\Unreal Engine\5.8` value `InstalledDirectory`; version falling back to `C:\ProgramData\Epic\UnrealEngineLauncher\LauncherInstalled.dat` (`InstallationList[].AppName === "UE_5.8"` → `InstallLocation`); GUID (with and without braces) → `HKCU\SOFTWARE\Epic Games\Unreal Engine\Builds` value named by the braced GUID; empty association → walk up from `project.dir` to a directory containing `Engine\Binaries`; a root that lacks the editor exe is skipped as not found. Every not-found case throws `ResolveError` whose message names the association and every place looked, and mentions `null-unreal.enginePath`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `resolveEngine` and `realReaders` (`reg query "<key>" /v <value>`, parse the `REG_SZ` line; a non-zero exit means `undefined`).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(null-unreal): resolve the engine from EngineAssociation (#149)`.

### Task 4: Command lines

**Files:**
- Create: `extensions/null-unreal/src/commandLine.ts`, `src/commandLine.test.ts`
- Modify: `package.json` test list

**Interfaces:**
- Consumes: `Engine`, `Uproject`.
- Produces:
  ```ts
  export type Command = 'build' | 'test' | 'run' | 'smoke';
  export interface Options { filter?: string; extraArgs: string[]; platform?: string; resX?: number; resY?: number }
  export interface Plan { exe: string; args: string[]; timeoutSec: number | undefined }
  export function buildPlan(cmd: Command, engine: Engine, project: Uproject, o: Options): Plan
  ```

- [ ] **Step 1: Write failing tests**: each command's `exe` and exact `args` array match Global Constraints (for `test` the `-ExecCmds=Automation RunTests MyGame.; Quit` argument is one array element); `--filter Foo.Bar` replaces the default; `extraArgs` are appended last; `platform` and `resX/resY` override defaults; timeouts 120/600/undefined/undefined; a project path with spaces stays one element (Review Focus).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `buildPlan`. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(null-unreal): build the engine command lines (#149)`.

### Task 5: Logs and rotation

**Files:**
- Create: `extensions/null-unreal/src/logs.ts`, `src/logs.test.ts`
- Modify: `package.json` test list

**Interfaces:**
- Produces:
  ```ts
  export function openLog(projectDir: string, cmd: Command, now: Date): { path: string; stream: fs.WriteStream } | { path: undefined; warning: string }
  export function rotate(projectDir: string, cmd: Command, keep?: number): void   // default 10
  ```
  Names: `<cmd>-YYYYMMDD-HHmmss.log` in `<projectDir>\Saved\NullUnreal`, created recursively.

- [ ] **Step 1: Write failing tests** on a temp dir: `openLog` creates the missing `Saved\NullUnreal`; after creating 12 `build-*.log` files `rotate` leaves the newest 10 and does not touch `test-*.log`; when the directory cannot be created (a file named `Saved` in the way) `openLog` returns `{ path: undefined, warning }` instead of throwing.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(null-unreal): keep and rotate command logs (#149)`.

### Task 6: Runner with timeout and tree kill

**Files:**
- Create: `extensions/null-unreal/src/runner.ts`, `src/runner.test.ts`
- Modify: `package.json` test list

**Interfaces:**
- Consumes: `Plan`.
- Produces:
  ```ts
  export interface RunResult { code: number | null; timedOut: boolean; seconds: number }
  export function run(plan: Plan, sink: NodeJS.WritableStream | undefined, echo: boolean): Promise<RunResult>
  ```
  Spawns with `shell: false`, pipes stdout and stderr to `sink` (when given) and to this process's stdout only when `echo` is true (M1 `run` and the CLI print nothing but the result line, so `echo` is false everywhere in M1; the parameter is the seam M2 summarizers replace). On timeout kills the tree with `taskkill /pid <pid> /T /F` and resolves `timedOut: true`.

- [ ] **Step 1: Write failing tests** using `process.execPath` as the "engine": a script that prints and exits 3 → `code 3`, output in the sink; a script that spawns a grandchild which sleeps, with `timeoutSec: 1` → `timedOut true` and the grandchild pid is gone afterwards (Review Focus); a nonexistent exe resolves with `code: null` and does not throw an unhandled error.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(null-unreal): run engine processes with timeout and tree kill (#149)`.

### Task 7: The CLI

**Files:**
- Create: `extensions/null-unreal/src/result.ts`, `src/result.test.ts`, `src/cli.ts`, `src/cli.test.ts`
- Modify: `package.json` test list

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces:
  ```ts
  // result.ts — shared by the CLI and the extension
  export function formatResult(cmd: Command, r: RunResult, logPath: string | undefined): string
  export function parseLogPath(output: string): string | undefined
  // cli.ts
  export interface Deps { cwd: string; project: ProjectFs; engine: EngineReaders; run: typeof run; now(): Date; out(line: string): void }
  export function main(argv: string[], deps: Deps): Promise<number>   // returns the exit code
  ```
  Usage: `null-unreal <build|test|run|smoke> [--project <p>] [--engine <path>] [--filter <prefix>] [--timeout <s>] [-- <extra engine args>]`. `--engine` is the CLI side of `null-unreal.enginePath` (my call, the spec names only the setting). Output is exactly two lines: `null-unreal <cmd>: exit <code> in <n>s` (or `timed out after <n>s`) and `log: <path>` (or `log: not kept (<warning>)`). The file runs `main` when `require.main === module`.

- [ ] **Step 1: Write failing tests.** `result`: `parseLogPath(formatResult(...))` round-trips a path with spaces; returns `undefined` for the not-kept form. `cli` (fake `Deps`, fake `run`): exit code equals the process code; a timeout returns 124; `code: null` returns 255 (my call; never 0, never 1 which M2 reserves); no `.uproject`, two `.uproject`, unknown command and a missing engine each return 2 with the `ResolveError` message on `out`; `--` extra args reach the plan after the defaults; a log is opened and rotated per run.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `result.ts` then `cli.ts` (hand-rolled argv loop; no dependency). **Step 4: Run** — PASS.
- [ ] **Step 5: Smoke the real file.** `node out/cli.js bogus` prints a usage line and exits 2; `node out/cli.js smoke` in an empty temp dir exits 2 naming `--project`.
- [ ] **Step 6: Commit** `feat(null-unreal): the null-unreal CLI with exit codes (#149)`.

### Task 8: Terminal shim

**Files:**
- Create: `extensions/null-unreal/src/shim.ts`, `src/shim.test.ts`
- Modify: `package.json` test list

**Interfaces:**
- Produces:
  ```ts
  export function shimFiles(execPath: string, cliPath: string): { 'null-unreal.cmd': string; 'null-unreal': string }
  export function cliUsageSnippet(shimPath: string): string   // text for Show CLI Path
  ```
  The `.cmd` sets `ELECTRON_RUN_AS_NODE=1` and runs `"<execPath>" "<cliPath>" %*`; the POSIX `sh` does the same with `exec` and `"$@"`. Both quote paths containing spaces.

- [ ] **Step 1: Write failing tests**: both files contain the quoted `execPath` and `cliPath` (paths with spaces); the `.cmd` uses `%*` and CRLF, the sh script starts with `#!/bin/sh` and `"$@"`; the snippet mentions the absolute shim path and all four commands.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(null-unreal): terminal shim for the CLI (#149)`.

### Task 9: Extension shell

**Files:**
- Create: `extensions/null-unreal/src/commands.ts`, `src/statusBar.ts`, `src/test/runTest.ts`, `src/test/suite/index.ts`, `src/test/suite/activation.spec.ts`
- Modify: `src/extension.ts`, `package.json`

**Interfaces:**
- Consumes: `shimFiles`, `cliUsageSnippet` (Task 8), `parseLogPath` (Task 7).
- Produces: commands `null-unreal.run|build|test|smoke|showCliPath`; one status-bar item `$(play) Run` bound to `null-unreal.run`.

- [ ] **Step 1: `extension.ts`** `activate`: write `shimFiles(process.execPath, <ext>/out/cli.js)` into `context.globalStorageUri/bin` (create it), prepend that folder to `PATH` through `context.environmentVariableCollection.prepend('PATH', dir + path.delimiter)` (Windows `;`), register commands and the status bar.
- [ ] **Step 2: `commands.ts`** — one `runCli(cmd)` shared by all four: spawn `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, args `[cli.js, cmd, '--project', setting, '--engine', setting, '--', ...null-unreal.<cmd>.args]` (omit flags whose setting is empty), `cwd` the first workspace folder, `shell: false`. Show it in a `withProgress` notification titled `Null Unreal: <cmd>`, append the CLI output to an Output channel `Null Unreal`. A non-zero exit shows an error message with an `Open Log` button that opens `parseLogPath(output)` when defined. `run` is not awaited by the UI (no progress), reports only a non-zero exit. `showCliPath` shows `cliUsageSnippet(<shim>)` in an information message with a `Copy` button.
- [ ] **Step 3: `statusBar.ts`** — left-aligned item, text `$(play) Run`, tooltip `Run the Unreal project (null-unreal run)`, shown on activation.
- [ ] **Step 4: Integration spec** `activation.spec.ts`: runTest mirrors null-env's but writes `Fixture.uproject` (`{"EngineAssociation":""}`) into the temp workspace before launch and points `extensionDevelopmentPath` at `...\extensions\null-unreal`; the spec asserts the extension activates, the five commands are registered, and `process.env.PATH` seen through `context.environmentVariableCollection` is not asserted (not observable) — instead assert `<globalStorage>/bin/null-unreal.cmd` exists.
- [ ] **Step 5: Verify.** `npm run compile && npm test` in the extension, then `/verify-local null-unreal` (runs `sync-local.ps1`, `reload-local.ps1` and the integration spec).
- [ ] **Step 6: Manual check on the real machine** against `MyGame`: open it in Null IDE; Run button launches the editor; `Null Unreal: Smoke` ends with `exit 0` and a log path; in the integrated terminal `null-unreal test --filter <known test>` prints the two lines; an unresolved engine (`EngineAssociation` edited to `9.9`) shows the actionable error. Report what was and was not run.
- [ ] **Step 7: Commit** `feat(null-unreal): commands, Run button and terminal CLI (#149)`, then `chore: refresh null-unreal compiled output`.

### Task 10: Docs

**Files:**
- Modify: root `CLAUDE.md` (extension count to fifteen, the list and the build-steps sentence, a `### null-unreal` section), `extensions/null-unreal/CLAUDE.md` (flesh out), `README.md` (labelled experimental, Windows only), `docs/wiki/Extensions.md`

- [ ] **Step 1:** Update those files; the wiki gets the settings, the CLI contract (commands, flags, two-line output, exit-code table) and the "no Problems panel" note. Run `/wiki-sync` only if the user asks (it publishes).
- [ ] **Step 2: Commit** `docs(null-unreal): document the extension and the CLI (#149)`.

## Self-review

- **Spec coverage (M1):** extension and activation (T1); engine and project resolution incl. override and errors (T2, T3); raw four commands (T4, T7); logs and rotation (T5); timeouts and exit-code table (T6, T7); Run button and palette (T9); terminal PATH shim and Show CLI Path (T8, T9); registration list and docs (T1, T10); unit and integration testing (every task, T9). Deferred by the spec to M2: summarizers and capture phase, `compdb`, Open Last Log, code 1.
- **Calls made beyond the spec** (mark for the user): `--engine` CLI flag; two-line result format; `code: null` → 255; Build/Test/Smoke palette commands are in M1 (one shared `runCli`), Open Last Log and Generate clangd Database are M2; not added to the REH list; open items "null-cpp UE detection" and "null-env `.uproject` entry" stay out of M1.
- **Open item verified first:** Task 1 Step 1 gates the whole plan on `ELECTRON_RUN_AS_NODE`.

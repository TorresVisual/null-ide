# Null IDE — C++ Development Layer Roadmap

Delivery blueprint for turning `docs/c++-development.md`'s vision into shipped
`null-cpp` features. Read this at the start of any session to know exactly
what to build next.

## Vision

**One sentence**: Orchestrate CMake, MSVC/Clang/GCC toolchains (native and
WSL), clangd, and native debuggers into one coherent C++ workflow inside
Null IDE — without ever building a competing C++ language server.

**Who**: The Null IDE maintainer, building real CMake C++ projects (e.g.
MiniGit-style tools) day to day. Secondary: any future Null IDE user working
in C++.

**Why**: `null-cpp` already solves header/source navigation, paired editors,
and scaffolding (see `docs/specs/null-cpp-extension-design.md` and
`null-cpp-smart-enable-design.md`), but there is currently **no** CMake,
toolchain, build, or debug orchestration at all. Today that means either a
manually maintained `.clangd` file and hand-typed `cmake`/`ninja` commands in
a terminal, or installing a separate, unbundled extension (e.g. CMake
Tools) that wasn't designed around this repo's clangd-first architecture.

**Constraint**: Windows-first. CI builds only run on `windows-2022`
(`CLAUDE.md`: "Do not run CI or build scripts locally") — every phase's
"Definition of Done" is verified by installing a CI-built package, the same
way `null-cpp-extension-design.md`'s testing section already does it. No
database, no web deploy target — this is a VS Code extension shipped via
GitHub Releases. MSVC and Clang (clang-cl) are the priority native
toolchains; GCC/MinGW is explicitly "later" per the source doc. **WSL is a
real v1 toolchain target** (confirmed in brainstorming — the source doc's
"(use Makefile through wsl)" aside next to §3 was intentional, not a stray
note).

**Not building** (see full list at the end): a competing C++ language
server, non-Windows/non-WSL hosts, remote/SSH CMake targets, a bespoke
build-diagnostics UI (VS Code's native Problems panel already does this),
GCC/MinGW toolchain support in v1, profiling, and build-performance
analysis.

---

## 1. Toolchain (of the roadmap's own tools)

| Layer | Choice | Why |
|---|---|---|
| C++ language server | clangd (`llvm-vs-code-extensions.vscode-clangd`) — existing hard dependency | Already wired via `clangdBridge.ts`; never replaced, only fed better input |
| Project/build model | CMake File API (`codemodel-v2` query → reply) | Structured target data without hand-parsing `CMakeLists.txt`; official, versioned JSON |
| Presets | `CMakePresets.json` + `CMakeUserPresets.json`, parsed as plain JSON | Already the de facto standard; avoids inventing a competing config format |
| Windows toolchain discovery | `vswhere.exe` (MSVC), PATH scan + `<compiler> --version` (clang-cl/clang) | `vswhere` ships with every VS/Build Tools install; nothing to vendor |
| WSL toolchain discovery | `wsl.exe --list --quiet` to enumerate distros, then `wsl.exe -d <distro> -- which cmake gcc make` | WSL distros bring their own gcc/make/cmake; null-cpp only shells out |
| Build execution (native) | `child_process.spawn` into a dedicated VS Code `Terminal` | Visible, cancellable — matches how `null-actions` already runs shell commands per button |
| Build execution (WSL) | Same, prefixed through `wsl.exe -d <distro> --` with paths translated via `wslpath` | Keeps one command-execution code path, just with a translation shim |
| Debugger (MSVC, clang-cl) | CodeLLDB (`vadimcn.vscode-lldb`), `type: "lldb"` | `cppvsdbg` (Microsoft's PDB-capable engine) actively refuses to run on non-Microsoft-branded VS Code builds as of cpptools 1.24.5 — confirmed live against Null IDE, no code-side fix. CodeLLDB's bundled LLDB has grown functional Windows PDB support and isn't license-gated. |
| Debugger (plain Clang/GCC, native or WSL) | `cppdbg` (`ms-vscode.cpptools`) with `MIMode: gdb` preferred (plain `lldb.exe` from the LLVM Windows installer doesn't speak the MI protocol at all); WSL via `pipeTransport` (`pipeProgram: wsl.exe`) | Standard, documented cpptools pattern for LLDB/GDB, including through WSL — unaffected by the license check since MIEngine is open source |
| UI | VS Code status bar items + `QuickPick`; `TreeView` (CMake sidebar, phase 3) | Matches `null-actions`' existing status-bar-button conventions |

**Key decision — new dependencies**: Phase 4 (Debugging) uses two companion extensions, no longer declared as
`extensionDependencies` (dropped in 1f7c00b so null-cpp activates standalone; the Null Env check, #89, reports them when missing): `ms-vscode.cpptools` (WSL/native Clang/GCC
debugging via `cppdbg`) and `vadimcn.vscode-lldb` (MSVC/clang-cl debugging
via CodeLLDB, since `cppvsdbg` is license-blocked on this fork — see the
Phase 4 section for the full story). cpptools' IntelliSense engine must be
explicitly disabled (`"C_Cpp.intelliSenseEngine": "disabled"` in
`configurationDefaults`, same mechanism `product.json`'s overlay already
uses) so it never competes with clangd — it contributes debug adapters
only.

---

## 2. State Model

No database — everything is either re-derived from the workspace on demand,
or (for the one thing worth persisting) stored in `context.workspaceState`.

### Toolchain (in-memory, rebuilt by `refreshToolchains`)
```
id            string   e.g. "msvc-2026-x64", "llvm-22-clang-cl", "wsl-ubuntu-gcc15"
kind          enum     msvc | clang | gcc-mingw | wsl-gcc | wsl-clang
displayName   string
compilerPath  string   Windows path, or path inside the WSL distro
arch          string
wslDistro     string?  only set for wsl-* kinds
detectedAt    number   cache-invalidation timestamp
```

### CMakePreset (parsed, not owned — `CMakePresets.json` is the source of truth)
```
name           string
displayName    string
generator      string
binaryDir      string
toolchainId    string   resolved by matching the preset's cacheVariables /
                         toolchainFile / environment against a detected
                         Toolchain — CMakePresets.json has no first-class
                         "toolchain" concept, so this inference is null-cpp's own
isWsl          boolean  inferred (Unix Makefiles/Ninja generator + no cl.exe
                         reachable), or an explicit opt-in `vendor["null-cpp"].wsl`
                         key we document as a convention
```

### CMakeTarget (from the `codemodel-v2` reply, per configured preset)
```
name           string
type           enum     EXECUTABLE | STATIC_LIBRARY | SHARED_LIBRARY | ...
artifactPath   string
sourceFiles    string[]
```

### CppConfigState — the one persisted piece (`context.workspaceState`)
```
activePresetName    string
activeTargetName     string
lastConfiguredAt     number
```

**Relationships**: a `CMakePreset` resolves to one `Toolchain`. A configure
run produces many `CMakeTarget`s. `CppConfigState` points at a preset and a
target **by name**, re-resolved against the live parse every time — if
`CMakeLists.txt` changes and a name disappears, the reference just fails to
resolve (falls back to "no target selected") rather than holding a stale
object.

State model growth by phase:

| Piece | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|---|---|---|---|---|
| Toolchain | ✓ | | | +debugger path field |
| CMakePreset | ✓ | | | |
| CMakeTarget | ✓ | | | |
| CppConfigState | ✓ | | | +last debug config |

---

## 3. Commands & Contribution Points

| Command | Phase | Context gate | Purpose |
|---|---|---|---|
| `null-cpp.cmake.refreshToolchains` | 1 | `isCppProject` | Re-run MSVC/Clang/WSL detection |
| `null-cpp.cmake.selectPreset` | 1 | `isCppProject && cmake.hasPresets` | QuickPick over `CMakePresets.json` presets |
| `null-cpp.cmake.configure` | 1 | `cmake.presetSelected` | Run `cmake --preset <p>` (native or via `wsl.exe`), write/refresh the `.clangd` pointer at the resulting `compile_commands.json` |
| `null-cpp.cmake.selectTarget` | 1 | `cmake.configured` | QuickPick over `codemodel-v2` targets |
| `null-cpp.cmake.build` | 2 | `cmake.targetSelected` | `cmake --build --preset <p> --target <t>` |
| `null-cpp.cmake.rebuild` | 2 | same | adds `--clean-first` |
| `null-cpp.cmake.clean` | 2 | same | `cmake --build --preset <p> --target clean` |
| `null-cpp.cmake.run` | 2 | target is `EXECUTABLE` | Launches `artifactPath` in the integrated terminal (via `wsl.exe` for WSL presets) |
| `null-cpp.cmake.buildAndRun` | 2 | same | build, then run |
| `null-cpp.cmake.showCallHierarchy` | 3 | `isCppProject` | Thin wrapper surfacing clangd's own call-hierarchy provider in a dedicated view — no new LSP work, just UI |
| `null-cpp.debug.start` | 4 | `cmake.targetSelected` | Synthesizes a debug config (`cppvsdbg` or `cppdbg` + `MIMode`/`pipeTransport`) from the active toolchain + target, calls `vscode.debug.startDebugging` |
| `null-cpp.debug.buildAndDebug` | 4 | same | build, then `debug.start` |

---

## 4. UI Surfaces

- **Phase 1**: status bar toolbar — `[Preset ▼] [Target ▼] [⚙ Configure] [↻ Refresh Toolchains]`, visible only when `null-cpp.isCppProject`.
- **Phase 2**: toolbar grows `[▶ Build] [▶ Run]`. Compiler diagnostics feed VS Code's native `DiagnosticCollection` — **not** a bespoke "BUILD FAILED / ❌ 3 errors" tree. This is a deliberate simplification vs. the source doc's §11 mockup: the native Problems panel already gives file grouping, counts, and click-to-source for free.
- **Phase 3** (stretch): CMake sidebar `TreeView` (Targets, Configurations). Optional — the toolbar dropdowns already cover the same job; only build this if the dropdowns prove too cramped in practice.
- **Phase 4**: `[🐞 Debug]` toolbar button. Relies entirely on VS Code's built-in debug UI (Locals/Watch/Call Stack/Threads/Breakpoints) — "Run to Cursor" is already native VS Code debug functionality, nothing to build.
- **Phase 5**: STL visualizers and the memory viewer both turned out to already work — CodeLLDB's bundled LLDB and WSL's stock gdb render STL types correctly out of the box, and VS Code's built-in memory inspector already works against both debug adapters. No custom rendering code, no natvis file, no `.gdbinit`, no custom panel.
- **Phase 6**: sanitizer configs are just more `CMakePresets.json` entries surfaced through the Phase 1 preset picker — near-zero new code. Profiling/build-analysis stay explicitly deferred.

---

## 5. Phases

## Phase 1 — CMake & Toolchain Foundation ✅
*Completed: 2026-09-02, commit 038d373*
*Goal: Open a real CMake project, see detected toolchains (MSVC, Clang, WSL distros), pick a preset, hit Configure — and clangd is correctly pointed at that preset's `compile_commands.json`.*
*Depends on: existing `null-cpp` (`projectDetection.ts`, `cppLanguage.ts`)*
*Estimated effort: 2-3 sessions*

**Scope test**: replaces manually running `cmake --preset X` in a terminal and hand-editing `.clangd` — if it doesn't leave you with working diagnostics in the editor, it's not done.

### New files
- `extensions/null-cpp/src/toolchainRegistry.ts` — `detectMsvc()` via `vswhere.exe -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath` (fallback: scan `VCToolsInstallDir` env / known install roots); `detectClang()` via PATH scan for `clang-cl.exe`/`clang.exe` + `--version`; `detectWsl()` via `wsl.exe --list --quiet` then per-distro `wsl.exe -d <distro> -- which cmake gcc make`. Results cached in-memory; exposes `refresh()` and `list()`.
- `extensions/null-cpp/src/presetsModel.ts` — parses `CMakePresets.json` + `CMakeUserPresets.json` (`configurePresets` array), resolves each preset's `toolchainId` against `toolchainRegistry`, infers `isWsl`.
- `extensions/null-cpp/src/cmakeModel.ts` — runs configure (writes the CMake File API query stub at `<binaryDir>/.cmake/api/v1/query/codemodel-v2` before invoking `cmake --preset`, then reads `<binaryDir>/.cmake/api/v1/reply/index-*.json` → `codemodel-v2-*.json` for the target list).
- `extensions/null-cpp/src/wslPath.ts` — `toWslPath()`/`fromWslPath()` via `wsl.exe wslpath`, used by both `cmakeModel.ts` and (later) build/run/debug.
- `extensions/null-cpp/src/cppConfigState.ts` — reads/writes `CppConfigState` in `context.workspaceState`.
- `extensions/null-cpp/src/cmakeToolbar.ts` — status bar items for preset/target selectors + Configure/Refresh, shown only when `null-cpp.isCppProject`.
- `extensions/null-cpp/src/clangdCompileDb.ts` — after a successful configure, writes/updates a workspace-root `.clangd` (`CompileFlags: { CompilationDatabase: <binaryDir> }`) so clangd picks up the *currently selected* preset's database. Re-run on every preset switch.

### Task Checklist

#### Detection
- [x] `toolchainRegistry.ts`: MSVC detection via `vswhere`
- [x] `toolchainRegistry.ts`: Clang/clang-cl detection via PATH
- [x] `toolchainRegistry.ts`: WSL distro + toolchain detection
- [x] `wslPath.ts`: path translation helpers, unit-testable (pure string logic once the `wslpath` output is captured)
- [x] `null-cpp.cmake.refreshToolchains` command

#### Presets & Configure
- [x] `presetsModel.ts`: parse `CMakePresets.json`/`CMakeUserPresets.json`
- [x] `presetsModel.ts`: resolve each preset's toolchain, infer `isWsl`
- [x] `cmakeModel.ts`: write CMake File API query stub, run configure (native and WSL-wrapped), parse `codemodel-v2` reply into `CMakeTarget[]` (pure JSON parsing lives in the new `cmakeReply.ts` companion so it's unit-testable without the `vscode` module)
- [x] `null-cpp.cmake.selectPreset` command (QuickPick)
- [x] `null-cpp.cmake.configure` command
- [x] `null-cpp.cmake.selectTarget` command (QuickPick, populated post-configure)
- [x] `clangdCompileDb.ts`: write/update `.clangd` on configure and on preset switch (pure text-patching logic lives in the new `clangdConfigText.ts` companion)

#### State & UI
- [x] `cppConfigState.ts`: persist/restore active preset + target across reloads
- [x] `cmakeToolbar.ts`: status bar items, gated on `null-cpp.isCppProject`
- [x] `null-cpp.cmake.hasPresets` / `null-cpp.cmake.configured` context keys for command/menu gating (plus `null-cpp.cmake.presetSelected`, needed by the Configure command's own gate per §3's command table)

#### Packaging
- [x] `package.json`: register the four new commands + `configuration` entries if any new settings are needed (none needed — presets are the config surface, as anticipated)
- [x] No `build.yml` changes needed (no new native binary to vendor — `vswhere.exe` and `wsl.exe` are assumed present on the host, same assumption clangd already makes about its own toolchain)

**Status**: Task checklist complete and unit-tested (68 passing tests across the new pure-logic
modules: `wslPath`, `toolchainRegistry`, `presetsModel`, `cmakeReply`, `clangdConfigText`).
**Definition of Done verified** — manual testing against a real CMake project confirmed MSVC,
Clang, and WSL presets all detect, configure, and wire up clangd correctly. Real-world MSVC
testing surfaced two bugs, fixed in commit 038d373: toolchain detection now falls back through
older MSVC versions when the newest one lacks a working `cl.exe` (partial VS update), and
configure now captures the `VsDevCmd.bat` environment (`INCLUDE`/`LIB`/`LIBPATH`) since the
Ninja generator doesn't inherit those the way the Visual Studio generator does.

### Definition of Done
1. Trigger a `workflow_dispatch` CI build; install the resulting package (per existing `null-cpp-extension-design.md` convention).
2. Open a real CMake project with a `CMakePresets.json` defining at least one MSVC preset, one Clang preset, and one WSL preset.
3. `Refresh Toolchains` shows all three correctly, including the right WSL distro name.
4. Select the Clang preset, hit Configure → `build/clang-debug/compile_commands.json` exists, target list populates.
5. Open a `.cpp` in that project → clangd diagnostics/completion are correct (proves `.clangd` wiring worked), with no manual `.clangd` editing.
6. Switch to the WSL preset, Configure again → `.clangd` now points at the WSL build's compile database; diagnostics update accordingly.
7. Reload the window → last-selected preset/target are restored from `workspaceState`.

---

## Phase 2 — Build & Run ✅
*Completed: 2026-09-02, commit 9d87d9a*
*Goal: Build and run the active target from the toolbar, with real compiler errors landing in the native Problems panel.*
*Depends on: Phase 1*
*Estimated effort: 1-2 sessions*

### Task Checklist

#### Build
- [x] `cmakeModel.ts`: `build(preset, sourceDir, toolchain, target, { clean })` — spawns `cmake --build <binaryDir> --target <t>` (native) or `wsl.exe`-wrapped equivalent, streamed into the shared `Terminal`
- [x] Compiler-output → `vscode.DiagnosticCollection` parser (MSVC `cl.exe` and Clang/GCC diagnostic line formats, shared `BuildDiagnostic[]` shape — pure parsing lives in the new `buildDiagnostics.ts` companion so it's unit-testable without the `vscode` module)
- [x] `null-cpp.cmake.build`, `.rebuild`, `.clean` commands
- [x] Toolbar: `▶ Build` button, busy/cancel state while a build is running (clicking again cancels the active process)

#### Run
- [x] `cmakeModel.ts`: resolve the active target's `artifactPath` (post-build)
- [x] `null-cpp.cmake.run` — launches the artifact in the shared terminal (native) or via `wsl.exe -d <distro> -- <path>` (WSL), gated on target type `EXECUTABLE`
- [x] `null-cpp.cmake.buildAndRun`
- [x] Toolbar: `▶ Run` button, disabled (not hidden) when the active target isn't executable

### Definition of Done
1. ~~CI-built install, real project from Phase 1.~~ Verified via local sync (`scripts/sync-local.ps1`) against a real CMake project instead — sufficient per the roadmap's local-verification-first policy.
2. Introduce a deliberate compile error → `Build` fails, Problems panel shows it grouped by file with correct line/column, clicking jumps to source. **Verified** — surfaced and fixed two real bugs along the way (clang-cl diagnostics with no error code weren't parsed; `--build --preset` needs a `buildPresets` entry most projects don't have, switched to building against the resolved binary dir).
3. Fix it, `Build` succeeds, `Run` launches the executable's output in a terminal. **Verified**, native Clang preset.
4. Repeat both against the WSL preset — errors and run output both work through `wsl.exe`. **Verified** — surfaced a real bug (WSL cwd relied on `wsl.exe` auto-translating the Windows spawn cwd, which proved unreliable and poisoned a CMake cache with a Windows-style path; fixed by pinning the working directory explicitly via `wsl.exe --cd <posix path>`).
5. Cancel a long-running build mid-flight — terminal process is actually killed, toolbar returns to idle state. **Verified.**

---

## Phase 3 — clangd Integration Hardening ✅
*Goal: Configuration switches never leave clangd stale, and call hierarchy/symbol browsing feel native to C++.*
*Depends on: Phase 1 (basic wiring already ships there)*
*Estimated effort: 1 session*
*Completed: 2026-09-02*

### Task Checklist
- [x] Audit the §8 six-step switch sequence end to end: reconfigure → regenerate `compile_commands.json` → update `.clangd` → (nothing needed for build commands/env — already re-derived per-command from `CppConfigState`, not cached)
- [x] ~~`null-cpp.cmake.showCallHierarchy`~~ — **cut, zero code needed.** VS Code's built-in Call Hierarchy view (`Shift+Alt+H` / right-click → *Show Call Hierarchy*) already renders callers/callees for any LSP server advertising `callHierarchyProvider`, which clangd does out of the box. A wrapper command would just be a redundant pass-through to the same feature — same reasoning as the build-diagnostics UI cut in §7.
- [ ] (Stretch) CMake sidebar `TreeView` if the toolbar dropdowns prove cramped in daily use — build only if actually needed

### Definition of Done
1. With a project configured on preset A, switch to preset B via the toolbar. Within one Configure cycle, go-to-definition/diagnostics reflect preset B's compilation database — no window reload required. **Verified by code audit**: `cmdConfigure` (`cmakeToolbar.ts`) calls `writeClangdConfig(root, preset.binaryDir)` on every configure regardless of preset, and `activePreset()`/`activeTarget()` read live from `workspaceState` on every command — nothing about the active preset/toolchain is cached stale. Also exercised live during Phase 2 testing switching between `clang-debug` and `wsl-debug`.
2. Call hierarchy view shows callers/callees for a real symbol, matching clangd's own `Show Call Hierarchy` output. **N/A — no wrapper built**; this is VS Code's own native feature working directly against clangd, not something this extension owns.

---

## Phase 4 — Debugging ✅
*Completed: 2026-09-03*
*Goal: `🐞 Debug` builds (if needed) and launches the correct debugger for the active toolchain — MSVC, Clang, GCC, or WSL — with zero manual `launch.json` authoring.*
*Depends on: Phase 2 (build), Phase 1 (toolchain/target state)*
*Estimated effort: 2 sessions*

**Real-world finding (2026-09-03):** Microsoft's cpptools 1.24.5+ added a binary-level check to `cppvsdbg` (its proprietary `vsdbg.exe` wrapper) that refuses to run on any non-Microsoft-branded VS Code build — confirmed live against Null IDE ("C/C++ Debugging is supported only in Microsoft versions of VS Code"). No code-side fix exists; `cppdbg` (MIEngine, open source) is unaffected. Since MSVC and clang-cl both emit PDB debug info that only `cppvsdbg`-class engines can read, both now route through **CodeLLDB** (`vadimcn.vscode-lldb`, `type: "lldb"`) instead — its bundled LLDB has grown functional (if less polished than vsdbg) Windows PDB support and isn't license-gated.

### Task Checklist
- [x] Add `ms-vscode.cpptools` (WSL/native Clang/GCC via `cppdbg`) and `vadimcn.vscode-lldb` (MSVC/clang-cl via `type: "lldb"`) as companions (originally `extensionDependencies`, dropped in 1f7c00b; the Null Env check, #89, reports them when missing); set `C_Cpp.intelliSenseEngine: "disabled"` in `product.json`'s `configurationDefaults`
- [x] `debugConfigSynth.ts`: build a debug config from the active toolchain + resolved `CMakeTarget`:
  - MSVC or clang-cl (PDB debug info, told apart from plain clang by compiler basename) → `type: "lldb"` (CodeLLDB), `program: artifactPath`
  - Plain native Clang/GCC (DWARF) → `type: "cppdbg"`, `MIMode`/`miDebuggerPath` resolved from PATH — **gdb preferred over lldb**: plain `lldb.exe` from the LLVM Windows installer doesn't implement the MI protocol at all (confirmed live — a real "nothing happens" hang), only the deprecated `lldb-mi.exe` did
  - WSL → `type: "cppdbg"`, `MIMode: "gdb"`, `pipeTransport: { pipeProgram: "wsl.exe", pipeArgs: ["-d", distro], debuggerPath: "/usr/bin/gdb" }`, paths translated via `wslPath.ts`
- [x] `null-cpp.debug.start`, `null-cpp.debug.buildAndDebug` commands
- [x] Toolbar: `🐞 Debug` button

### Definition of Done
1. `Debug` on the MSVC preset stops at a breakpoint, Locals/Call Stack/Watch all populate — via CodeLLDB, no hand-written `launch.json`. **Verified** against the real MSVC preset in `cpp-test`.
2. Same for the Clang preset via CodeLLDB (clang-cl, PDB debug info). **Verified.**
3. Same for the WSL preset via `cppdbg`/GDB through `pipeTransport` — confirms the path-translation plumbing actually works under a real debugger, not just build/run. **Verified** against the `wsl-debug` preset in `cpp-test`. Surfaced a real bug along the way: MIEngine hands `<debuggerPath> <MI args>` to `pipeProgram` as a single quoted argv token rather than separate arguments, so `wsl.exe`'s default shell tried to exec `/usr/bin/gdb --interpreter=mi` as one literal filename ("No such file or directory"). Fixed by routing through `pipeArgs: ['-d', distro, 'bash', '-c']` so `bash -c` re-tokenizes the string itself.
4. `Build and Debug` rebuilds stale binaries before launching. **Verified by code audit**: `cmdBuildAndDebug` (`cmakeToolbar.ts`) always calls `cmdBuild()` first and only proceeds to `cmdDebug()` if it succeeds — same pattern as Phase 3's audit-based verification.

---

## Phase 5 — C++ Native Experience ✅
*Completed: 2026-09-04*
*Goal: Debugging and clangd's code actions feel purpose-built for C++, not generic.*
*Depends on: Phase 4*
*Estimated effort: 2 sessions (came in near-zero — see findings)*

**Real-world finding (2026-09-04):** every task in this phase's original checklist assumed a
gap that turned out not to exist. Verified directly (compiled a real `std::vector`/`std::string`/
`std::map` test program and drove both debuggers from the CLI; sent raw LSP requests to `clangd.exe`
against a real class) rather than trusting the source doc's §11/§12/§17 assumptions, which predate
this fork's CodeLLDB pivot (Phase 4) and were never re-checked against it:

- **STL visualizers ("natvis" task)**: the original task assumed `cppvsdbg`, which Phase 4 already
  killed (license-blocked on this fork). The task never got updated for CodeLLDB. Tested directly:
  CodeLLDB's bundled LLDB (`lldb version 22.1.8-codelldb`) already renders `std::vector<int>`,
  `std::basic_string`, and `std::map<int,int>` correctly out of the box against real clang-cl/PDB
  binaries — no natvis equivalent exists for CodeLLDB anyway (confirmed against its own docs: it
  takes LLDB command-file/Python formatters via `initCommands`, not a `visualizerFile`). **Zero
  code needed.**
- **GDB/LLDB pretty-printer wiring**: tested directly against WSL Ubuntu's stock `gdb`/`g++` —
  libstdc++'s bundled Python pretty-printers auto-load and already render the same three types
  correctly with no `.gdbinit` authored by this extension. **Zero code needed.**
- **Memory viewer**: confirmed both debug adapters advertise `supportsReadMemoryRequest` /
  `supportsWriteMemoryRequest` (grepped the CodeLLDB adapter binary directly; cpptools/MIEngine has
  shipped this since well before the bundled 1.33.8). VS Code's built-in memory inspector ("Open
  Value in Memory Inspector" from a variable's context menu) already works against both. **No
  custom webview needed** — exactly the outcome the original task flagged as the likely one.
- **C++ code actions**: queried `clangd.exe` 22.1.8 directly over LSP against a real class.
  `Generate Constructor` is already a built-in clangd tweak (`MemberwiseConstructor`, surfaced as
  "Define constructor" through the stock lightbulb/quick-fix UI the already-installed clangd
  extension provides) — satisfies the phase's own Definition of Done with no new command. `Sort
  includes` is already covered by `Format Document` (clangd's `documentFormattingProvider`, backed
  by clang-format's `SortIncludes`, on by default) — reordered `<vector>/<algorithm>/<string>`
  correctly in a live test. **Neither needed new code.**
  `Generate Getter/Setter`, `Make const/static`, and `Add [[nodiscard]]` are confirmed **not**
  built into clangd (empty code-action results at the relevant ranges) and are the one real gap
  this phase found. Deliberately **not building them now**: clangd doesn't expose a real AST over
  standard LSP, so a correct implementation would need to parse C++ declarations itself
  (templates, multi-line signatures, operator overloads) well enough to avoid emitting broken
  edits — exactly the kind of "confidently wrong" surface this roadmap's own section 7 already
  avoids elsewhere (the cut build-diagnostics UI, the cut call-hierarchy wrapper). Revisit only if
  real day-to-day friction shows up; `Generate Getter/Setter` would be the first candidate since
  it's the most mechanical of the three.

### Definition of Done
1. Inspecting a `std::vector<int>` while paused shows size/elements, not internal fields — on both
   the CodeLLDB (MSVC/clang-cl) and `cppdbg`/gdb (native Clang/GCC, WSL) paths. **Verified.**
2. At least one shipped code action (`Generate Constructor`) works end to end on a real class.
   **Verified** — ships today via the already-installed clangd extension, no null-cpp code
   required.

---

## Phase 6 — Advanced Tooling (stretch) ✅
*Completed: 2026-09-04*
*Goal: Sanitizer builds are one preset-picker click away; profiling/build-analysis stay explicitly deferred unless a real need shows up.*
*Depends on: Phase 1 (preset picker)*
*Estimated effort: 0.5-1 session*

### Task Checklist
- [x] Document (README/spec, not code) how to add ASan/UBSan/TSan `CMakePresets.json` entries — confirmed **zero new code**: the Phase 1 preset picker (`null-cpp.cmake.selectPreset`) enumerates every `configurePresets` entry with no filtering, so a sanitizer preset just needs to exist in the file. Add a `configurePresets` entry alongside your normal ones, e.g. for Clang/clang-cl:
  ```jsonc
  {
    "name": "clang-asan",
    "inherits": "clang-debug",
    "binaryDir": "${sourceDir}/build/clang-asan",
    "cacheVariables": {
      "CMAKE_CXX_FLAGS": "-fsanitize=address,undefined -fno-omit-frame-pointer",
      "CMAKE_EXE_LINKER_FLAGS": "-fsanitize=address,undefined"
    }
  }
  ```
  Swap `address,undefined` for `thread` (TSan) — ASan/UBSan can combine in one preset, TSan can't combine with ASan. Once it's in `CMakePresets.json`, `Refresh Toolchains` → `Select Preset` surfaces it exactly like any other preset; `Configure`/`Build`/`Run` need nothing sanitizer-specific because the flags live entirely in CMake cache variables, not in anything null-cpp resolves itself.
- [x] Re-evaluate profiling/build-performance analysis only if a concrete need arises — no concrete need has surfaced; **not building**, per this roadmap's section 7.

### Definition of Done
An ASan preset appears in the picker and Configure/Build/Run all work against it, using only Phase 1-2 infrastructure. **Verified by code audit**: `presetsModel.ts` parses every `configurePresets` entry unconditionally (no kind/name filtering), and `cmakeModel.ts`'s configure/build/run all key off the resolved preset's `binaryDir`/toolchain, not preset name — a sanitizer preset is indistinguishable from any other preset to the rest of the pipeline.

---

## 6. Build Order

| Phase | Goal | New state pieces | New commands | Sessions |
|---|---|---|---|---|
| 1 | CMake + toolchain foundation, clangd wired | Toolchain, CMakePreset, CMakeTarget, CppConfigState | 4 | 2-3 |
| 2 | Build + Run from the toolbar | — | +3 | 1-2 |
| 3 | clangd integration hardening | — | +1 | 1 |
| 4 | Debugging | +debugger path on Toolchain | +2 | 2 |
| 5 | STL visualizers + C++ code actions | — | 0 (both already worked — see Phase 5 findings) | 0 |
| 6 | Sanitizer presets (stretch) | — | 0 | 0.5-1 |

---

## 7. Deliberately Not Building (v1)

- **A competing C++ language server** — clangd stays the only source of C++ language intelligence, permanently. Hard architectural constraint, not a v1-only cut.
- **GCC/MinGW native toolchain support** — MSVC + Clang (native) + WSL cover the priority matrix; GCC/MinGW is explicitly "later" in the source doc.
- **Non-Windows, non-WSL hosts** (bare Linux/macOS) — out of scope; this repo targets Windows.
- **Remote/SSH CMake targets** — not mentioned in the source doc; excluded to prevent scope creep beyond the confirmed native+WSL matrix.
- **A bespoke build-diagnostics UI** (the source doc's §11 "BUILD FAILED / ❌ 3 errors" tree) — VS Code's native Problems panel already does file-grouped, click-to-source diagnostics for free.
- **A custom CMake sidebar TreeView** — deferred to a Phase 3 stretch; the toolbar dropdowns are the default UI unless they prove insufficient in real use.
- **A `showCallHierarchy` wrapper command** — VS Code's native Call Hierarchy view already works against clangd's `callHierarchyProvider` for free.
- **A custom Memory Viewer webview** — build only after confirming VS Code's built-in debug-adapter memory view doesn't already cover it (Phase 5 task).
- **Profiling (CPU/memory/allocation) and build-performance/header-dependency analysis** — explicitly "later-stage"/"eventually" in the source doc; re-evaluate only on real need, not speculatively.
- **Full §12 C++ code-action list in one pass** — `Generate Constructor` and `Sort includes` shipped for free (clangd + Format Document already do them); `Generate Getter/Setter`, `Make const/static`, `Add [[nodiscard]]` are deliberately not built (Phase 5 findings) — clangd exposes no real AST over LSP, so a correct implementation is real parsing work, not wiring. Revisit only on actual friction.
- **A custom `.natvis` file, `.gdbinit` pretty-printers, or memory-viewer webview** — CodeLLDB's bundled LLDB and stock gdb already render STL types correctly, and VS Code's built-in memory inspector already works against both debug adapters (Phase 5 findings, verified by direct testing, not assumption).

---

## Execution Notes (how this roadmap gets built)

This project has no deploy target and CI cannot run locally (a full CI build takes roughly 30 minutes), so the
standard roadmap-skill execution loop is adapted to use the existing local synchronization workflow:

* **Verify locally first.** After each phase's task checklist is complete, use `scripts/sync-local.ps1` to synchronize the local files. Most changes do not require a full CI build, so a local sync is the default verification method.

* **Use CI only when necessary.** Trigger a CI build (`workflow_dispatch`) only when the Definition of Done requires validation that cannot reasonably be performed through the local sync workflow, such as CI-specific build behavior, packaging, platform-specific behavior, or other changes where local verification is insufficient. Triggering a CI build/dispatch is a shared-state action — confirm with the user before doing it, same as any other CI/CD-affecting action.

* **Commit at phase boundaries** — `git commit -m "Phase N complete: <goal>"` once the phase's Definition of Done passes. A phase does not require a CI build to be considered complete when local synchronization and verification are sufficient.

* **Progress tracking lives in this file** — check off tasks as they land; the first unchecked task in the first incomplete phase is always the next thing to work on. No separate `SESSION.md`.

* **Stop only when**: a task fails for an unfamiliar reason, a design decision needs human input (e.g. "is the CMake sidebar TreeView actually worth building"), or a credential/tool isn't available (e.g. no WSL distro installed to test against). Otherwise, keep going through the checklist without pausing to ask permission — the checked/unchecked state in this file is the permission.

* **Prefer the cheapest sufficient verification.** Do not run a 30-minute CI build when `scripts/sync-local.ps1` and the established local verification checklist are sufficient to prove the change works. Escalate to CI only when local verification cannot adequately validate the change.


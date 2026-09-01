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
| Debugger (MSVC) | `cppvsdbg` (`ms-vscode.cpptools`) | Only adapter that understands MSVC PDBs and `.natvis` |
| Debugger (Clang/GCC, native or WSL) | `cppdbg` (`ms-vscode.cpptools`) with `MIMode: lldb` or `gdb`; WSL via `pipeTransport` (`pipeProgram: wsl.exe`) | Standard, documented cpptools pattern for LLDB/GDB, including through WSL |
| UI | VS Code status bar items + `QuickPick`; `TreeView` (CMake sidebar, phase 3) | Matches `null-actions`' existing status-bar-button conventions |

**Key decision — new dependency**: Phase 4 (Debugging) requires adding
`ms-vscode.cpptools` as a second `extensionDependencies` entry. Its
IntelliSense engine must be explicitly disabled
(`"C_Cpp.intelliSenseEngine": "disabled"` in `configurationDefaults`, same
mechanism `product.json`'s overlay already uses) so it never competes with
clangd — it contributes debug adapters only. This is a well-established
pattern (clangd for language service, cpptools for `cppvsdbg`/`cppdbg`
only), but it's a real new dependency and worth flagging before Phase 4
starts.

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
- **Phase 5**: STL visualizers via a data-only `.natvis` file (MSVC) + GDB/LLDB pretty-printer wiring in the synthesized debug config (Clang/GCC/WSL) — no custom rendering code. Memory viewer: check whether VS Code's now-built-in debug-adapter memory view already covers this before building a custom panel.
- **Phase 6**: sanitizer configs are just more `CMakePresets.json` entries surfaced through the Phase 1 preset picker — near-zero new code. Profiling/build-analysis stay explicitly deferred.

---

## 5. Phases

## Phase 1 — CMake & Toolchain Foundation
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

**Status**: Task checklist complete and unit-tested (64 passing tests across the new pure-logic
modules: `wslPath`, `toolchainRegistry`, `presetsModel`, `cmakeReply`, `clangdConfigText`).
**Definition of Done is not yet verified** — that requires a CI build (`workflow_dispatch`) and
manual testing against a real CMake project with MSVC, Clang, and WSL presets, which needs
explicit confirmation before triggering (shared CI state) and hardware this agent doesn't have
(a WSL distro, installed MSVC/Clang). Next step before calling Phase 1 done: get that CI build +
manual verification from the maintainer.

### Definition of Done
1. Trigger a `workflow_dispatch` CI build; install the resulting package (per existing `null-cpp-extension-design.md` convention).
2. Open a real CMake project with a `CMakePresets.json` defining at least one MSVC preset, one Clang preset, and one WSL preset.
3. `Refresh Toolchains` shows all three correctly, including the right WSL distro name.
4. Select the Clang preset, hit Configure → `build/clang-debug/compile_commands.json` exists, target list populates.
5. Open a `.cpp` in that project → clangd diagnostics/completion are correct (proves `.clangd` wiring worked), with no manual `.clangd` editing.
6. Switch to the WSL preset, Configure again → `.clangd` now points at the WSL build's compile database; diagnostics update accordingly.
7. Reload the window → last-selected preset/target are restored from `workspaceState`.

---

## Phase 2 — Build & Run
*Goal: Build and run the active target from the toolbar, with real compiler errors landing in the native Problems panel.*
*Depends on: Phase 1*
*Estimated effort: 1-2 sessions*

### Task Checklist

#### Build
- [ ] `cmakeModel.ts`: `build(preset, target, { clean })` — spawns `cmake --build --preset <p> --target <t>` (native) or `wsl.exe`-wrapped equivalent, streamed into a dedicated `Terminal`
- [ ] Compiler-output → `vscode.DiagnosticCollection` parser (MSVC `cl.exe` and Clang/GCC diagnostic line formats — two parsers, shared `Diagnostic[]` shape)
- [ ] `null-cpp.cmake.build`, `.rebuild`, `.clean` commands
- [ ] Toolbar: `▶ Build` button, busy/cancel state while a build is running

#### Run
- [ ] `cmakeModel.ts`: resolve the active target's `artifactPath` (post-build)
- [ ] `null-cpp.cmake.run` — launches the artifact in a terminal (native) or via `wsl.exe -d <distro> -- <path>` (WSL), gated on target type `EXECUTABLE`
- [ ] `null-cpp.cmake.buildAndRun`
- [ ] Toolbar: `▶ Run` button, disabled (not hidden) when the active target isn't executable

### Definition of Done
1. CI-built install, real project from Phase 1.
2. Introduce a deliberate compile error → `Build` fails, Problems panel shows it grouped by file with correct line/column, clicking jumps to source.
3. Fix it, `Build` succeeds, `Run` launches the executable's output in a terminal.
4. Repeat both against the WSL preset — errors and run output both work through `wsl.exe`.
5. Cancel a long-running build mid-flight — terminal process is actually killed, toolbar returns to idle state.

---

## Phase 3 — clangd Integration Hardening
*Goal: Configuration switches never leave clangd stale, and call hierarchy/symbol browsing feel native to C++.*
*Depends on: Phase 1 (basic wiring already ships there)*
*Estimated effort: 1 session*

### Task Checklist
- [ ] Audit the §8 six-step switch sequence end to end: reconfigure → regenerate `compile_commands.json` → update `.clangd` → (nothing needed for build commands/env — already re-derived per-command from `CppConfigState`, not cached)
- [ ] `null-cpp.cmake.showCallHierarchy` — wraps clangd's existing call-hierarchy provider in a view, reusing `symbolTree.ts`'s existing qualified-name logic where useful
- [ ] (Stretch) CMake sidebar `TreeView` if the toolbar dropdowns prove cramped in daily use — build only if actually needed

### Definition of Done
1. With a project configured on preset A, switch to preset B via the toolbar. Within one Configure cycle, go-to-definition/diagnostics reflect preset B's compilation database — no window reload required.
2. Call hierarchy view shows callers/callees for a real symbol, matching clangd's own `Show Call Hierarchy` output.

---

## Phase 4 — Debugging
*Goal: `🐞 Debug` builds (if needed) and launches the correct debugger for the active toolchain — MSVC, Clang, GCC, or WSL — with zero manual `launch.json` authoring.*
*Depends on: Phase 2 (build), Phase 1 (toolchain/target state)*
*Estimated effort: 2 sessions*

### Task Checklist
- [ ] Add `ms-vscode.cpptools` to `extensionDependencies`; set `C_Cpp.intelliSenseEngine: "disabled"` in `product.json`'s `configurationDefaults`
- [ ] `debugConfigSynth.ts`: build a `vscode.DebugConfiguration` from `CppConfigState` + `Toolchain`:
  - MSVC → `type: "cppvsdbg"`, `program: artifactPath`
  - Clang/GCC (native) → `type: "cppdbg"`, `MIMode: "lldb"` or `"gdb"` based on what's on PATH
  - WSL → `type: "cppdbg"`, `MIMode: "gdb"`, `pipeTransport: { pipeProgram: "wsl.exe", pipeArgs: ["-d", distro], debuggerPath: "/usr/bin/gdb" }`, paths translated via `wslPath.ts`
- [ ] `null-cpp.debug.start`, `null-cpp.debug.buildAndDebug` commands
- [ ] Toolbar: `🐞 Debug` button

### Definition of Done
1. CI-built install. `Debug` on the MSVC preset stops at a breakpoint, Locals/Call Stack/Watch all populate — using `cppvsdbg`, no hand-written `launch.json`.
2. Same for the Clang preset via `cppdbg`/LLDB.
3. Same for the WSL preset via `cppdbg`/GDB through `pipeTransport` — confirms the path-translation plumbing actually works under a real debugger, not just build/run.
4. `Build and Debug` rebuilds stale binaries before launching.

---

## Phase 5 — C++ Native Experience
*Goal: Debugging and clangd's code actions feel purpose-built for C++, not generic.*
*Depends on: Phase 4*
*Estimated effort: 2 sessions*

### Task Checklist
- [ ] `.natvis` file covering `std::vector`, `std::string`, `std::optional`, `std::unique_ptr`/`shared_ptr`, `std::map`/`unordered_map`, `std::variant`, `std::span` — data-only, wired into the synthesized `cppvsdbg` config's `visualizerFile`
- [ ] GDB/LLDB pretty-printer wiring (`-gdb-set` / `.lldbinit` equivalent) for the same type set on the Clang/GCC/WSL debug path
- [ ] Investigate whether VS Code's built-in debug-adapter memory view already covers §17's Memory Viewer ask before writing a custom webview
- [ ] C++ code actions layered on clangd (`Generate Constructor/Getter/Setter`, `Make const`/`static`, `Add [[nodiscard]]`, `Sort includes`) — scope down to 3-4 highest-value actions first, not the full §12 list at once

### Definition of Done
1. Inspecting a `std::vector<int>` while paused shows size/capacity/elements, not `_Mypair` internals — on both `cppvsdbg` and `cppdbg` paths.
2. At least one shipped code action (recommend: `Generate Constructor`) works end to end on a real class.

---

## Phase 6 — Advanced Tooling (stretch)
*Goal: Sanitizer builds are one preset-picker click away; profiling/build-analysis stay explicitly deferred unless a real need shows up.*
*Depends on: Phase 1 (preset picker)*
*Estimated effort: 0.5-1 session*

### Task Checklist
- [ ] Document (README/spec, not code) how to add ASan/UBSan/TSan `CMakePresets.json` entries — the Phase 1 picker already surfaces any preset, so this may need **zero new code**
- [ ] Re-evaluate profiling/build-performance analysis only if a concrete need arises — do not build speculatively

### Definition of Done
An ASan preset appears in the picker and Configure/Build/Run all work against it, using only Phase 1-2 infrastructure.

---

## 6. Build Order

| Phase | Goal | New state pieces | New commands | Sessions |
|---|---|---|---|---|
| 1 | CMake + toolchain foundation, clangd wired | Toolchain, CMakePreset, CMakeTarget, CppConfigState | 4 | 2-3 |
| 2 | Build + Run from the toolbar | — | +3 | 1-2 |
| 3 | clangd integration hardening | — | +1 | 1 |
| 4 | Debugging | +debugger path on Toolchain | +2 | 2 |
| 5 | STL visualizers + C++ code actions | — | +0-4 (code actions are clangd code-action ids, not new commands) | 2 |
| 6 | Sanitizer presets (stretch) | — | 0 | 0.5-1 |

---

## 7. Deliberately Not Building (v1)

- **A competing C++ language server** — clangd stays the only source of C++ language intelligence, permanently. Hard architectural constraint, not a v1-only cut.
- **GCC/MinGW native toolchain support** — MSVC + Clang (native) + WSL cover the priority matrix; GCC/MinGW is explicitly "later" in the source doc.
- **Non-Windows, non-WSL hosts** (bare Linux/macOS) — out of scope; this repo targets Windows.
- **Remote/SSH CMake targets** — not mentioned in the source doc; excluded to prevent scope creep beyond the confirmed native+WSL matrix.
- **A bespoke build-diagnostics UI** (the source doc's §11 "BUILD FAILED / ❌ 3 errors" tree) — VS Code's native Problems panel already does file-grouped, click-to-source diagnostics for free.
- **A custom CMake sidebar TreeView** — deferred to a Phase 3 stretch; the toolbar dropdowns are the default UI unless they prove insufficient in real use.
- **A custom Memory Viewer webview** — build only after confirming VS Code's built-in debug-adapter memory view doesn't already cover it (Phase 5 task).
- **Profiling (CPU/memory/allocation) and build-performance/header-dependency analysis** — explicitly "later-stage"/"eventually" in the source doc; re-evaluate only on real need, not speculatively.
- **Full §12 C++ code-action list in one pass** — ship the 3-4 highest-value actions first (Phase 5), grow the set later based on actual use.

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


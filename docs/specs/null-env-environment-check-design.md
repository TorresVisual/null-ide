# Null Env — Environment Check Design

Issue: [#89 Environment check: detect missing companion extensions and toolchains per project](https://github.com/TorresVisual/null-ide/issues/89)

## Goal

Tell the user what a project needs and does not have, before an action fails, and fix it in one click. Covers companion extensions (clangd, cpptools, CodeLLDB, rust-analyzer, Claude Code) and CLI tools (cmake, clangd, gdb/lldb, cargo, rustfmt, clang-format, node, `claude`). Shows nothing when everything is present.

Out of scope: installing CLI toolchains, and re-adding third-party `extensionDependencies` (commit 1f7c00b dropped them on purpose so `null-cpp` activates standalone).

## Today

Detection and tool lookup exist three times and cannot be imported across extension packages:

- `null-cpp`: `projectDetection*.ts` (C++ only, one enabled flag), `toolchainRegistry.ts` (`findOnPath`, MSVC/WSL probes).
- `null-actions`: `projectDetector.ts` (`DETECTORS`: manifest → suggested buttons).
- `null-format`: `toolchainDiscovery.ts` (`findExecutableOnPath`, `findRustfmtPath`, `findClangFormatPath`).

`null-cpp.debug.start` ends in a bare `vscode.debug.startDebugging` (`cmakeToolbar.ts`), so a missing debugger surfaces as VS Code's "unknown debug type". `product.json` `extensionRecommendations` lists no Claude Code or rust-analyzer.

## Decisions

1. **New built-in extension `extensions/null-env/`**, no `extensionKind` (workspace-side, like `null-cpp`/`null-format`/`null-actions`). It then checks the machine that has the tools, including a remote window. CI adds it to the REH repack list (`build.yml`, the `foreach ($e in 'null-cpp', …)` step).
2. **null-env owns the shared logic; the others migrate onto it.** `null-format` and `null-actions` declare `extensionDependencies: ["null.null-env"]` (built-in to built-in, as `null-tools` does for `null-accounts`) and call its exports. No local fallback: a fallback would be the fourth copy. These extensions stop working standalone in stock VS Code, which is not a supported setup.
3. **Cross-host access goes through commands.** `null-tools` is `extensionKind: ["ui"]`; exports do not cross extension hosts, commands do. Workspace-side extensions use exports, `null-tools` uses commands.

## Modules (`extensions/null-env/src/`)

Pure (unit-tested with `node --test`; no `vscode` import):

- `detect.ts` — one manifest → language table: cpp (`CMakeLists.txt`, `compile_commands.json`, `.clangd`), rust (`Cargo.toml`), node (`package.json`), dotnet (`*.csproj`). `detectProjects(folderPath, listDir?)` returns one `{ language, manifest }` per matched manifest (null-actions maps manifests to buttons); `detectLanguages` is its unique-language projection. `listDir` is injectable for tests. Replaces `DETECTORS` manifests in `null-actions`.
- `probe.ts` — `findExecutable(names, extraDirs)`: PATH lookup plus the known locations moved from `null-format` (`~/.cargo/bin`, LLVM install dirs, scoop, bundled `bin/`). `findRustfmtPath` / `findClangFormatPath` move here.
- `rules.ts` — data only. Each requirement: `{ id, label, languages | 'all', kind: 'extension' | 'tool', anyOf: string[], severity: 'required' | 'recommended', fix }`, where `fix` is `{ install: extensionId }` or `{ url }`.
  - cpp (`required`: extensions clangd, cpptools, CodeLLDB; tool cmake. `recommended`: tools clangd, gdb-or-lldb, clang-format — clangd's extension can download clangd itself; MSVC presets debug through CodeLLDB and need no gdb).
  - rust (`required`): extension rust-analyzer; tools cargo, rustfmt.
  - node (`required`): tool node.
  - all: extension `anthropic.claude-code`, tool `claude` (both `recommended`).
- `check.ts` — `check(languages, probes) → Finding[]`. `anyOf` is satisfied by any one entry. No findings means no UI.

`vscode` glue (the only files importing it): `extension.ts` (activate, exports, refresh triggers), `statusBar.ts`, `commands.ts` (QuickPick and fixes), `probes.ts` (binds `vscode.extensions.getExtension` and `fs` into the pure layer).

## Surfaces

- **`Null: Check Environment`** (`null.env.check`): QuickPick of findings. An extension finding runs `workbench.extensions.installExtension`; a tool finding calls `vscode.env.openExternal(url)`; an "Install all missing extensions" row batches the former.
- **Status bar warning**: present only while there are `required` findings; `recommended` ones appear in the QuickPick and dashboard only (so a missing Claude Code never nags as an error). Re-checks on `onDidChangeWorkspaceFolders` and `extensions.onDidChange`. Dismissing snoozes per workspace (`workspaceState`). The QuickPick also offers *Hide this warning for this workspace*, which stores the set of missing required ids; the item reappears when that set changes.
- **Dashboard card** (`null-tools`): reads `null.env.getFindings` (returns plain JSON, no `vscode` types); hidden when empty.
- **Failure paths**:
  - `null-cpp.debug.start` maps the synthesized config's `type` to its extension (`lldb` → `vadimcn.vscode-lldb`, `cppdbg` → `ms-vscode.cpptools`). If missing, show "needs <name>" with *Install* and *Check Environment* buttons instead of calling `startDebugging`. This check lives in `null-cpp`'s `cmakeToolbar.ts`; null-env exports `isExtensionInstalled` / the requirement label.
  - `null-format` rustfmt/clang-format "not found" errors gain a *Check Environment* button.

## Exports and commands

Exports (workspace-side consumers): `getFindings()`, `onDidChange`, `findExecutable()`, `detectLanguages()`, `findRustfmtPath()`, `findClangFormatPath()`.
Commands: `null.env.check`, `null.env.getFindings`.

## Migration

- `null-format`: `toolchainDiscovery.ts` is deleted; the providers call null-env's `findRustfmtPath` / `findClangFormatPath`, which keep the configured-path → bundled-binary → known-locations → PATH precedence. Existing `toolchainDiscovery.test.ts` cases move to null-env.
- `null-actions`: `projectDetector.ts` uses `detectLanguages` for the manifest check and keeps only the language → suggested-button mapping.
- `null-cpp`: `toolchainRegistry.findOnPath` calls an injected finder that `extension.ts` points at null-env's `findExecutable` (keeps `toolchainRegistry.ts` free of `vscode` so its tests run in plain Node); MSVC/WSL probing stays (C++-specific). `projectDetection*.ts` stays; it answers "is this an enabled C++ project" (with the user override), not "what languages exist".

## Shipped alongside

- `product.json` `extensionRecommendations`: add `anthropic.claude-code` and `rust-lang.rust-analyzer`. Lands first, as its own commit.
- `docs/ROADMAP.md` Phase 4 (lines ~60 and ~286) still says `extensionDependencies` are declared; rewrite to point at the environment check.
- Build wiring: `build.yml` (compile + copy lists + REH repack), `build-local.ps1` (both extension lists), `sync-local.ps1`; `CLAUDE.md` gets a null-env section and the "twelve built-in extensions" count updates.
- Future: findings could feed `.null/project.json` (#39); not designed here.

## Testing

- Unit (`node --test`, explicit list in `package.json`'s `test`): `detect`, `rules` sanity (every `anyOf` non-empty, ids unique), `check` with injected probes — including any-of satisfaction, severity filtering, and all-present → empty.
- Integration (`npm run test:integration`, via `/verify-local null-env`): `null.env.check` command registers; `null-cpp.debug.start` with no debugger extension shows the guard instead of invoking `startDebugging`. The runner uses vanilla VS Code, so the install click is verified by hand in a built package.

## Acceptance (from the issue)

- Fresh profile + CMake project with no cpptools/CodeLLDB: warning names them; one click installs.
- `null-cpp.debug.start` with no debugger extension explains the cause and offers the fix.
- Cargo project without rust-analyzer/rustfmt is reported.
- Everything present: nothing shown.
- Claude Code extension and `claude` CLI reported when missing (recommended severity).

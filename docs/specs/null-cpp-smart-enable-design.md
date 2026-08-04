# Null C++ Smart Enable — Design

## Problem

`null-cpp` currently activates unconditionally (`onStartupFinished`) and its
three features are always live: the `Alt+O` keybinding always overrides
clangd's own, the paired-split/scroll-sync listeners always fire for any
opened `.c`/`.cpp` file, and "New C++ Class..." always appears in every
Explorer folder context menu — even in a workspace that has nothing to do
with C++ (e.g. a stray `.c` file dropped in a JS repo, or just a workspace
that happens not to be a C++ project at all). The extension should only make
itself felt when the current workspace actually looks like a C++ project.

## Background

`null-cpp` already has a hard `extensionDependencies` on clangd
(`docs/specs/null-cpp-extension-design.md`), so clangd is present regardless
of project type — clangd's own presence isn't a useful signal for "is this a
C++ project." What's actually diagnostic is the workspace's *content*: a
build-config file clangd itself would want (`CMakeLists.txt`,
`compile_commands.json`, `.clangd`) or the plain presence of C/C++ source
files.

## Design

### Detection

New module `extensions/null-cpp/src/projectDetection.ts` (vscode-touching —
calls `vscode.workspace.findFiles`, so, like `clangdBridge.ts` and
`symbolCache.ts`, it isn't unit-tested; verified via `tsc` and the manual
pass).

`detectCppProject(): Promise<boolean>`:
1. Read `null-cpp.projectDetection.override` (`"auto"` / `"always"` /
   `"never"`, default `"auto"`). `"always"` → `true`, `"never"` → `false`,
   short-circuiting the scan entirely — this is the manual escape hatch for
   whenever the heuristic below gets it wrong.
2. On `"auto"`: no workspace folders open (single-file mode) → `false`.
3. Otherwise run `vscode.workspace.findFiles` with `**/node_modules/**`
   excluded and `maxResults: 1` (each call only needs to know "does at least
   one match exist," not enumerate them) against:
   - Build-config signals: `**/CMakeLists.txt`, `**/compile_commands.json`,
     `**/.clangd`.
   - Source-file signals: `**/*.{c,cpp,cc,cxx,h,hpp,hh,hxx}` — the same
     extension set implied by `cppLanguage.ts`'s `isCppDocument` check
     (`languageId === 'cpp' || 'c'`).
   Any single match, from either group, makes the result `true`.
4. Cache the resolved boolean in the module (set once) and expose it via
   `isEnabled(): boolean` for other modules to check synchronously.

This is a **one-time check at activation**, not a live file watcher. A
project that gains its first `CMakeLists.txt` mid-session picks up smart-enable
after a window reload — consistent with how VS Code's own workspace-type
detection generally works, and avoids an always-on watcher for what's a rare
scenario (bootstrapping a C++ project from zero files inside the editor).

### Wiring

`extension.ts`'s `activate()` becomes `async`:
```ts
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const enabled = await initializeProjectDetection();
  await vscode.commands.executeCommand('setContext', 'null-cpp.isCppProject', enabled);
  registerSwitchSourceHeader(context);
  registerPairedSplit(context);
  registerNewClass(context);
}
```
`initializeProjectDetection()` runs `detectCppProject()` once and stores the
result for `isEnabled()` to read back synchronously afterward.

Commands are **always registered**, detection result or not — VS Code
requires a command referenced by `contributes.commands`/keybindings/menus to
have a registered handler, or invoking it (even by typing its id into the
palette, bypassing a hidden menu entry) throws "command not found." Gating
happens two ways instead:

- **Declaratively**, via the `null-cpp.isCppProject` context key, for
  everything that's a static contribution point: the `Alt+O` keybinding's
  `when`, both `commandPalette` entries' `when`, and the Explorer menu
  entry's `when` (alongside its existing `explorerResourceIsFolder &&
  config.null-cpp.scaffold.showInExplorer` check).
- **Imperatively**, via `isEnabled()`, inside the actual command handlers and
  listeners — `symbolSwitch.ts`'s and `scaffold.ts`'s command bodies, and
  each of `pairedSplit.ts`'s three listeners (open/close/selection-change)
  — as defense-in-depth for the (rare) case a hidden command still gets
  invoked directly. `scaffold.ts`'s guard shows a short informational
  message explaining why nothing happened; the others no-op silently,
  matching the "best-effort convenience feature" error-handling stance
  already established in `docs/specs/null-cpp-extension-design.md`.

### Settings

New: `null-cpp.projectDetection.override` — enum `"auto"` / `"always"` /
`"never"`, default `"auto"`.

## Testing

`projectDetection.ts` is vscode-touching (real `findFiles` calls) and isn't
unit-tested, consistent with `clangdBridge.ts`/`symbolCache.ts`. Manual
verification, added to the existing end-to-end pass:

1. Open a non-C++ workspace (no build-config file, no C/C++ source files).
   Confirm `Alt+O` does nothing, no `null-cpp` commands appear in the
   palette, and no "New C++ Class..." entry appears in the Explorer menu.
2. Open a workspace containing only a `compile_commands.json` (no source
   files yet). Confirm all three features are active.
3. Open a workspace containing only a stray `.cpp` file (no build config).
   Confirm all three features are active.
4. Set `null-cpp.projectDetection.override` to `"always"` in a non-C++
   workspace; confirm features turn on. Set it to `"never"` in a C++
   workspace; confirm features turn off. Reset to `"auto"`.

## Out of Scope

- Live re-detection via file watcher — a reload is the accepted way to pick
  up a workspace's first C++ file/build-config file mid-session.
- Per-workspace-folder detection in a multi-root workspace — a single
  workspace-wide `true`/`false` covers all folders.

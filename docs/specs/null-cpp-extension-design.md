# Null C++ Extension (`null-cpp`) — Design

## Problem

C/C++ editing in Null IDE relies on the (separately installed) clangd
extension for language intelligence, but two everyday workflows are worse
than they should be:

1. **Header/source switching lands at line 0.** clangd's own
   `clangd.switchheadersource` command (`Alt+O`) jumps to the top of the
   counterpart file, not to the declaration/definition you were actually
   looking at. There's no symbol-aware navigation on top of it.
2. **No paired-editor workflow.** Working on a class means manually opening
   both the `.hpp` and `.cpp`, arranging them side by side, and re-scrolling
   each one independently to keep the same method in view in both.

There's also no quick way to scaffold a new `.hpp`/`.cpp` pair with the
boilerplate (`#pragma once`, matching `#include`) filled in.

## Background

clangd's extension (`llvm-vs-code-clangd.vscode-clangd`) contributes
`clangd.switchheadersource`. Its handler (verified against
`clangd/vscode-clangd`'s source) sends the LSP `textDocument/switchSourceHeader`
request itself, then opens the resulting URI directly via
`vscode.window.showTextDocument` — it returns `Promise<void>`, so nothing
usable comes back to a caller that merely runs the command via
`vscode.commands.executeCommand`. Wrapping that command is therefore not an
option; the raw LSP request has to be sent independently.

Since version 0.1.29, vscode-clangd's `activate()` returns a `ClangdExtension`
API object with a versioned `getApi(1)` method exposing `languageClient` (a
`BaseLanguageClient` from `vscode-languageclient`), which supports
`sendRequest(method: string, params)` directly — no need to depend on
clangd's own request-type definitions or npm package; `null-cpp` defines the
`textDocument/switchSourceHeader` request shape (`TextDocumentIdentifier` →
`string | undefined`) itself.

Separately, all document-symbol lookups (finding the enclosing function at a
cursor position, matching a symbol by name in the counterpart file) go
through the builtin, provider-agnostic `vscode.executeDocumentSymbolProvider`
command rather than clangd's client directly — this works regardless of
which extension registers the provider and needs no clangd-specific typing.

Repo precedent: `wooting-analog` is the existing example of a narrowly
scoped built-in extension with its own native/LSP-adjacent dependency,
`package.json`, `src/`, and CI build step, as opposed to bolting unrelated
functionality onto the grab-bag `null-tools` extension. `null-cpp` follows
that same pattern.

## Scope

In scope: symbol-aware header/source switching, auto-paired split editors
with scroll/cursor sync, and `.hpp`/`.cpp` scaffolding.

Out of scope: any C/C++ language feature clangd already provides (hover,
completion, diagnostics, plain go-to-definition/F12) — untouched. This
extension only adds orchestration on top of clangd, never a competing
language server integration.

## Architecture

New built-in extension at `extensions/null-cpp/`, publisher `null`, display
name "Null C++", mirroring `wooting-analog`'s layout:

```
extensions/null-cpp/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts      — activation; wires commands and event listeners
│   ├── clangdBridge.ts   — resolves clangd's exported API; sends the raw
│   │                        textDocument/switchSourceHeader request
│   ├── symbolIndex.ts    — per-document DocumentSymbol tree cache, keyed by
│   │                        doc version; qualified-name tree walk
│   ├── symbolSwitch.ts   — feature #1: null-cpp.switchSourceHeader command
│   ├── pairedSplit.ts    — feature #2: pairing map, auto-open, scroll sync
│   └── scaffold.ts       — feature #3: null-cpp.newClass command
└── out/                  — compiled JS, committed (matches null-tools /
                             wooting-analog convention)
```

`package.json` declares `"extensionDependencies": ["llvm-vs-code-clangd.vscode-clangd"]`.
This has two effects relied on by the design: VS Code auto-installs clangd
alongside `null-cpp` if it's missing, and — the part that matters for
keybindings — **dependencies activate before the dependent extension**. When
two extensions contribute an identical `key` + `when` pair, VS Code resolves
the collision in favor of whichever was contributed most recently in
activation order. Because clangd is guaranteed to activate first, `null-cpp`'s
`Alt+O` binding (same `when` scope clangd uses: C/C++ editor focus)
deterministically wins over clangd's own, without touching the user's
`keybindings.json` or relying on load-order luck.

Activation event: `onStartupFinished`, matching `null-tools` and
`wooting-analog` — simpler than language-gated activation, and cheap since
everything downstream is listener-driven rather than polling.

`build.yml` gains `null-cpp` as the sixth built-in extension: a compile step
(`npm ci && npm run compile` in `extensions/null-cpp/`, same as `null-tools`)
and an entry in the copy-into-`vscode-src/extensions` step.

## Components & Data Flow

### Symbol index (`symbolIndex.ts`)

Shared by all three features.

- `Map<uriString, { version: number; symbols: vscode.DocumentSymbol[] }>`.
- `getSymbols(doc)`: if the cached entry's `version` matches `doc.version`,
  return it; otherwise call `vscode.executeDocumentSymbolProvider` and
  recache. `TextDocument.version` already increments on every edit, so
  comparing versions **is** the invalidation — no separate
  `onDidChangeTextDocument` bookkeeping needed. Entries are deleted on
  `onDidCloseTextDocument`.
- `findEnclosingSymbol(symbols, position)`: recursively walks the tree
  (parent → children), tracking ancestor names to build a qualified name
  (e.g. `"MyClass::method"`), and returns the innermost symbol whose `range`
  contains `position`, or `undefined` if nothing does (e.g. cursor sitting
  in an `#include` block). The containing-range walk already covers "cursor
  is directly on the identifier" as a subset of "cursor is inside the
  symbol's range" — no separate go-to-definition fallback path is needed;
  `undefined` simply means the caller falls back to today's default
  (open-at-line-0) behavior.

### clangd bridge (`clangdBridge.ts`)

- `getLanguageClient()`: resolves
  `vscode.extensions.getExtension('llvm-vs-code-clangd.vscode-clangd')`,
  awaits its activation, and calls `exports.getApi(1).languageClient`.
  Caches the result for the extension host's lifetime.
- `switchSourceHeader(uri)`: sends
  `languageClient.sendRequest<string | undefined>('textDocument/switchSourceHeader', { uri: uri.toString() })`
  and returns the parsed `vscode.Uri` or `undefined`.

### Feature #1 — Symbol-aware switch

Command `null-cpp.switchSourceHeader`, keybinding `Alt+O` (`when`: C/C++
editor focus).

1. No active editor, or not a C/C++ document → no-op.
2. `findEnclosingSymbol` on the current document's cached tree → qualified
   name or `undefined`.
3. `clangdBridge.switchSourceHeader(uri)`. `undefined` → show "Didn't find a
   corresponding file." (matching clangd's own message) and stop.
4. Open the counterpart; get its symbol tree; search for a symbol with the
   same qualified name.
5. Found → `revealRange(range, TextEditorRevealType.InCenterIfOutsideViewport)`
   and move the cursor there. Not found (or step 2 was `undefined`) → leave
   the counterpart at its default open position (today's behavior).

### Feature #2 — Auto-paired split + scroll sync (`pairedSplit.ts`)

- `Map<uriString, uriString>` tracks live pairs, populated via the same
  `clangdBridge.switchSourceHeader` call (one raw LSP request per file,
  cached in the map — not re-sent per keystroke or per sync tick).
- `onDidOpenTextDocument`: if the opened document is C/C++ and
  `null-cpp.autoPairSplit.enabled` is true, resolve its counterpart. If the
  counterpart isn't already visible in another editor column, open it beside
  with `{ viewColumn: ViewColumn.Beside, preserveFocus: true, preview: false }`
  — `preserveFocus` keeps focus on the file the user actually opened;
  `preview: false` stops it from being silently replaced by the next
  single-click-opened file. Recording the pair in the map *before* issuing
  the open call is itself the loop guard: when the counterpart's own
  `onDidOpenTextDocument` fires, it sees a pair already recorded for its URI
  and skips.
- `onDidChangeTextEditorSelection`, debounced ~120ms: if
  `null-cpp.scrollSync.enabled` is true and the editor's document is part of
  a tracked pair whose counterpart is currently visible in some other
  column, run `findEnclosingSymbol` at the new cursor position, look up the
  matching qualified name in the counterpart's cached symbol tree, and
  `revealRange` (not a selection/cursor change) in the counterpart editor.
  Using `revealRange` rather than moving the counterpart's actual selection
  is what prevents feedback loops: it doesn't fire
  `onDidChangeTextEditorSelection` in the target pane, so there is no
  ping-pong and no fighting the user's own scrolling there. No match found →
  no-op (leave the counterpart's current view alone).
- `onDidCloseTextDocument`: remove the pair from the map (both directions).
  If `null-cpp.pairedSplit.autoCloseCounterpart` (default `false`) is set,
  also close the counterpart's tab via the `window.tabGroups` API.

### Feature #3 — Scaffolding (`scaffold.ts`)

Command `null-cpp.newClass`, title "Null C++: New Class...". Contributed to
the Explorer context menu (folders and folder background, alongside "New
File"/"New Folder") gated by `null-cpp.scaffold.showInExplorer` (default
`true`) in the menu's `when` clause, and to the command palette.

1. Determine the target folder (the right-clicked Explorer folder, or — from
   the palette — the workspace root / active file's folder).
2. Prompt for a name via `showInputBox`, validating non-empty and
   filesystem-safe characters.
3. If `<folder>/<Name>.hpp` or `<folder>/<Name>.cpp` already exists, show an
   error and abort — never overwrite.
4. Write `<Name>.hpp`:
   ```cpp
   #pragma once

   ```
   and `<Name>.cpp`:
   ```cpp
   #include "<Name>.hpp"

   ```
5. Open `<Name>.hpp`. Feature #2's auto-pair-split logic (if enabled) puts
   `<Name>.cpp` beside it automatically — no special-casing needed here.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `null-cpp.autoPairSplit.enabled` | `true` | Auto-open the counterpart file beside the one just opened |
| `null-cpp.scrollSync.enabled` | `true` | Sync scroll/reveal position between paired editors |
| `null-cpp.pairedSplit.autoCloseCounterpart` | `false` | Closing one half of a pair also closes the other |
| `null-cpp.scaffold.showInExplorer` | `true` | Show "New C++ Class..." in the Explorer context menu |

## Error Handling

- clangd extension not found via `vscode.extensions.getExtension` at
  activation time: since it's a hard `extensionDependencies` entry, this
  should only be possible transiently during first install (VS Code is
  already handling installing it); `null-cpp` no-ops rather than erroring.
- clangd's exports lack `getApi` (pre-0.1.29 versions predate the exported
  API): show a one-time warning suggesting the user update the clangd
  extension, and forward `Alt+O` to `clangd.switchheadersource` so the key
  isn't left dead.
- `switchSourceHeader` request resolves to `undefined` (no counterpart
  exists, e.g. a `.cpp` with no header): surfaced via the same message text
  clangd itself uses, for consistency; feature quietly no-ops.
- Symbol lookup finds no matching qualified name in the counterpart
  (templates, macros, overloads, or just a differently-named
  declaration/definition pair): silent fallback to line-0 open / no scroll
  sync for that tick. This is a best-effort convenience feature, not a
  correctness-critical one — silent degradation is the right behavior, not
  an error message.

## Testing / Verification

This extension's behavior is driven by real LSP round-trips to clangd, a
real C/C++ workspace, and real editor layout/focus state — not something to
fake convincingly in a unit test. What's practical to unit test, using the
same `node --test` + mocked-`vscode`-module pattern as `null-tools`'s
existing `.test.ts` files:

- `findEnclosingSymbol`'s tree walk and qualified-name construction, against
  hand-built `DocumentSymbol` trees.
- The pairing map's guard logic (recording-before-opening prevents the
  reciprocal-open loop).
- The scaffold command's name validation and existing-file collision
  checks.

Manual verification (per `CLAUDE.md`, no local VS Code build is possible —
CI builds only):

1. Trigger a `workflow_dispatch` CI build; install the resulting build.
2. Open a C++ project with a `compile_commands.json` clangd can use.
3. Place the cursor inside a method body in a `.cpp`, press `Alt+O`; confirm
   it lands on that method's declaration in the `.hpp`, not line 0.
4. Open a `.cpp` with `autoPairSplit.enabled`; confirm the `.hpp` opens
   beside it without stealing focus, and isn't reopened if already visible.
5. Move the cursor between methods in one pane; confirm the other pane
   scrolls to the matching method without moving its cursor or fighting
   manual scrolling.
6. Close one half of a pair with the default setting; confirm the other
   stays open. Toggle `autoCloseCounterpart` and repeat; confirm it now
   closes too.
7. Right-click a folder → "New C++ Class..." → enter a name; confirm both
   files are created with the expected boilerplate and open paired.
8. Toggle `scaffold.showInExplorer` off; confirm the menu entry disappears.

## Out of Scope

- Any clangd-provided language feature (hover, completion, diagnostics,
  plain F12/Ctrl+F12 go-to-definition) — untouched.
- Fuzzy/heuristic symbol matching across decl/def when qualified names
  differ (templates, macros) — falls back silently rather than attempting
  approximate matching.
- Namespace/class skeleton content in scaffolded headers — files are
  intentionally bare (`#pragma once` / matching `#include` only).

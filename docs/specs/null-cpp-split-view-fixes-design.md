# Null C++ Split-View Fixes — Design

## Problem

Two rough edges in how `null-cpp` interacts with split editors:

1. **Alt+O ignores an already-open split.** `symbolSwitch.ts`'s
   `null-cpp.switchSourceHeader` command calls
   `vscode.window.showTextDocument(counterpartDoc)` with no `viewColumn`,
   which always opens in the *currently active* column. If the counterpart
   is already open beside the current file (via auto-pair-split), Alt+O
   opens a second copy in the same column instead of jumping to the pane
   that's already showing it.
2. **Scaffolded pairs land in unpredictable columns.** `scaffold.ts` opens
   the header with no explicit `viewColumn` either, so it lands in whatever
   column was active when "New C++ Class..." was run. The source file then
   opens "Beside" *that*, so the resulting layout depends on whatever else
   was open beforehand rather than a consistent, predictable split.

## Design

### Fix 1: Alt+O targets the existing split

`pairedSplit.ts` already has a `findVisibleEditor(uriString)` helper that
scans `vscode.window.visibleTextEditors` for a document already shown in
some column. Extract it into a new shared module,
`extensions/null-cpp/src/editorLookup.ts` (vscode-touching, not
unit-tested — same convention as `clangdBridge.ts`/`symbolCache.ts`), and
use it from both `pairedSplit.ts` and `symbolSwitch.ts`.

In `symbolSwitch.ts`, after `switchSourceHeader` resolves to `{ kind:
'switched', uri }`:
1. Look up `findVisibleEditor(uri.toString())` **before** opening the
   document.
2. If found, show the counterpart in that editor's `viewColumn` — this
   makes Alt+O reveal the correct symbol in the pane that's already open,
   instead of duplicating it.
3. If not found, show it in `vscode.ViewColumn.Beside` — matching
   auto-pair-split's own default placement, so Alt+O and the auto-split
   feature produce a consistent layout whether the split already existed or
   Alt+O is what creates it.

The qualified-name matching and `revealRange`/selection logic in
`symbolSwitch.ts` is unchanged; only the `viewColumn` passed to
`showTextDocument` changes based on this lookup.

### Fix 2: Deterministic scaffold layout

`scaffold.ts`, after writing both files, changes its final open sequence
based on `null-cpp.autoPairSplit.enabled`:

- **Enabled:** open the source (`.cpp`) first, in `vscode.ViewColumn.One`,
  with `preserveFocus: true, preview: false` (background — it shouldn't
  steal focus while being placed); then open the header (`.hpp`) last, in
  `vscode.ViewColumn.Two`, with default focus behavior (`preserveFocus`
  unset → `false`), so it ends up the active/focused editor. Net result:
  `.cpp` always on the left, `.hpp` always on the right, header focused —
  regardless of whatever columns/tabs were already open before scaffolding.
- **Disabled:** unchanged — open only the header, in the active column, as
  today. Forcing a two-column layout wouldn't make sense when the user has
  opted out of paired splits generally.

No changes to `pairedSplit.ts` itself: opening both documents still fires
`onDidOpenTextDocument` for each, so its existing listener still registers
the pair (for scroll-sync) via its own independent `switchSourceHeader`
call — by the time that (slower, real LSP round-trip) call resolves, both
files are already visible in their fixed columns, so its `alreadyVisible`
check is `true` and it only records the pair without opening anything
itself. This mirrors the reasoning already established for feature
interaction in `docs/specs/null-cpp-extension-design.md`.

## Testing

Both fixes touch vscode-touching command/listener code, not the pure
tested modules (`symbolTree.ts`, `pairRegistry.ts`, `scaffoldNaming.ts` are
unaffected). Verified via `tsc` type-checking plus manual end-to-end
checks:

1. Open a `.cpp` with its `.hpp` already auto-paired beside it (or open one
   manually to trigger the pairing). Move focus back to the `.cpp` and
   press Alt+O. Confirm it reveals the matching symbol in the *existing*
   `.hpp` pane rather than opening a duplicate in the current column.
2. Close the split, then press Alt+O from a lone `.cpp` with no split open.
   Confirm it opens the `.hpp` beside it (`ViewColumn.Beside`), not in the
   same column.
3. With `autoPairSplit.enabled` at its default (`true`) and some unrelated
   file already open and focused, run "New C++ Class...". Confirm the new
   `.cpp` lands in the left column and `.hpp` in the right column, with
   `.hpp` focused, regardless of what was open/active beforehand.
4. Set `autoPairSplit.enabled` to `false` and run "New C++ Class..." again.
   Confirm only the header opens, in the active column, with no forced
   layout.

## Out of Scope

- Any change to `pairedSplit.ts`'s own auto-open-on-file-open logic — it
  already does the right thing; only `symbolSwitch.ts` and `scaffold.ts`
  needed fixing.
- A toolbar ("New File..."-style) icon for scaffolding — considered and
  explicitly declined; a public extension API has no way to know which
  folder is selected in the built-in Explorer tree, so a toolbar button
  could only ever create at the workspace root, unlike the existing
  folder-aware right-click menu entry.

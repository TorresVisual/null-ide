# Null Markdown Editor view — design

Issue: #114. Extension: `extensions/null-markdown/`.

## Goal

A third view for `.md` files, **Markdown Editor**: the document is shown rendered and edited in place, Typora/Obsidian-style. Syntax markers are hidden except around the caret, and edits land in the same file. It sits next to the existing **Source** (plain text) and **Preview** views. All three are views of one `TextDocument`; switching never copies a document.

VS Code's own hybrid Markdown editor is still Agents-window-only and experimental (1.141), so there is nothing to backport (`docs/vscode-tracking.md`, rows 1.131 / 1.132). This is the Null-built equivalent.

## Constraints

- The file is never rewritten or normalised: the editor holds the raw Markdown text and only decorates it. No HTML→Markdown or tree→Markdown serialisation.
- Block widgets (table, Mermaid, math, alert, image, HTML) render through the existing `createMd()` + `processAlerts()`, so they look identical to Preview.
- Preview keeps working independently.
- Plain JS, matching the extension. The webview is bundled by esbuild into a tracked `lib/` (same convention as `null-music` / `null-activity` webviews). This replaces the earlier "no build step" constraint for `null-markdown`.

## Views of one file

```text
example.md
    ├── Markdown Source    (built-in text editor, listed by VS Code as "Text Editor")
    ├── Markdown Editor    (null-markdown.editor — live preview, editable)
    └── Markdown Preview   (null-markdown.previewEditor — rendered, read-only, same tab)
```

All three appear in **Reopen Editor With… / Open With…** (`priority: option`; Source stays the default, "default for .md" is the standard `workbench.editorAssociations`) and switch in place on the same `TextDocument`. The existing side-by-side `null-markdown.openPreview` panel (Ctrl+Shift+V) is unchanged and also works when the active tab is the Editor.

## Architecture

| Piece | Responsibility |
|---|---|
| `editorProvider.js` (host, new) | `CustomTextEditorProvider`, constructed twice with `{ readOnly }` (Editor and in-tab Preview). A thin relay: sends full text + version on open, applies webview edits as one `WorkspaceEdit`, forwards `onDidChangeTextDocument` changes, answers `renderBlock`, handles `wikiLink` / `checkboxToggle` like Preview. |
| `syncState.js` (host, pure) | Version bookkeeping and echo suppression: records the version produced by its own edit, decides forward / drop / reset. Unit-tested. |
| `webview/editor/*.js` (new) | CM6 setup: Markdown language (GFM), live-preview decorations, block widgets, formatting keymaps. Plain ES modules. |
| `webview/editor/reveal.js` (pure) | Reveal rule: (syntax node, selection) → hidden or shown. Unit-tested with no CM6 import. |
| `lib/editor.js` (tracked, generated) | esbuild output. Never hand-edited. |
| `lib/editor.css` (tracked, hand-written) | Theme-variable styling shared with `null-markdown.css` fonts and colours. |
| `extension.js` (modified) | Registers the provider and commands; checkbox toggle edits the document instead of needing a visible text editor; `openPreview` falls back to the Editor's document. |
| `package.json` (modified) | Two `customEditors` entries, commands, `editor/title` items, `build` script (esbuild), `test` script, CodeMirror/lezer deps, `esbuild` devDependency. |
| `scripts/sync-local.ps1`, `build.yml` (modified) | Copy `lib/`; run `npm ci && npm run build` for `null-markdown`. |

Dependencies (dev only; bundled into `lib/editor.js`, about 500 KB minified): `@codemirror/{state,view,commands,language,lang-markdown}`, `@lezer/markdown`, `esbuild`. The decoration plan, sync client and formatting commands are plain `.mjs` modules so `node --test` can import them directly; host files stay CommonJS `.js`.

## Sync protocol

The `TextDocument` is the source of truth; the CM6 doc is a mirror.

- **Line endings:** the webview mirrors the text with LF line endings (CM6 normalises them). Offsets it sends are LF offsets; the host converts them to line/character positions against the LF form of its text and writes inserted text with the document's EOL. This lives in `syncState.js` (pure, unit-tested) together with the version bookkeeping.
- **Webview → host:** `edit { baseVersion, changes: [{from, to, insert}] }` in original-document coordinates. Local changes are debounced (~300 ms) and composed, so a typing burst is one `WorkspaceEdit` and one undo step, and only one edit is in flight at a time. The host applies it, then replies `ack { version }`.
- **Host → webview** (Source edit, git checkout, formatter, undo, rejected edit): `doc { text, version }` with the full LF text. The webview diffs it against its current text and applies the single changed span, so the selection is preserved; it is not echoed back.
- **Version mismatch:** if the host changed since `baseVersion`, or the edit is malformed, it drops the edit and sends `doc`. Anything the webview had pending loses the race (host wins); at most a few keystrokes, and only when two writers race.
- **Save:** Ctrl+S in the webview waits for pending edits to be acked, then asks the host to save; otherwise the workbench would save before the last edit lands and the file would stay dirty.
- **Webview reload / crash:** the webview sends `ready` and the host replies with `doc`. No local persistence.

### Undo/redo (open risk, spike first)

How Ctrl+Z behaves inside a `CustomTextEditor` webview is unverified: it may reach CM6's history, the workbench's document undo, or both (the webview forwards undo/redo keydowns to the workbench even when the editor handled them). The design commits to one stack: the workbench's document undo, with no CM6 history, because the host `TextDocument` is the source of truth and every undo then arrives as a normal `doc` message. Plan task 2 verifies this in the running app before anything else is built on it; if it does not hold, the spec is revisited. Known ceiling: an undo pressed within one debounce window of typing can undo the previous step instead of the one still in flight.

## Live-preview rendering

**Reveal rule:** a syntax marker is hidden unless the selection touches the node that owns it. Inline marks (`**`, `` ` ``, `[](url)`) reveal when the caret is inside their span; block marks (`#`, `>`, list bullets) reveal when the caret is on their line.

**Decorated in place:**
- Headings: `#` hidden, line takes heading size.
- Bold, italic, strikethrough, inline code lose their markers. Links show only their text; Ctrl+click opens. `[[wiki]]` links styled the same way.
- Blockquote left bar; bullets drawn as glyphs, ordered numbers stay text; horizontal rules render as lines.
- Task lists: `[ ]` becomes a checkbox; a click is a one-character change.
- Fenced code: fence lines dimmed, code always editable in monospace, no syntax highlighting in v1.
- Front matter: dimmed raw text.

**Block widgets** (whole ranges: table, Mermaid fence, `$$` math, GitHub alert, image, HTML block): the webview sends `renderBlock { text }`, the host returns HTML from `createMd()` + `processAlerts()`, and the webview runs the same KaTeX / Mermaid scripts Preview loads. Results are cached by source text. When the caret enters the range, or on click, the widget swaps back to raw source; arrow keys enter it naturally.

**Editing helpers:** from `@codemirror/lang-markdown`: Enter continues lists and quotes, Tab indents list items, GFM tables and strikethrough parse. Custom keymaps: Ctrl+B, Ctrl+I, Ctrl+K (bold, italic, link) only.

## Commands and toolbar

- `Markdown: Open Editor` → `vscode.openWith(uri, 'null-markdown.editor')`.
- `Markdown: Open Source` → `vscode.openWith(uri, 'default')`.
- `Markdown: Open Markdown Preview in Tab` (`null-markdown.openPreviewTab`) → `vscode.openWith(uri, 'null-markdown.previewEditor')` (in-tab, read-only). The side-by-side panel stays on `null-markdown.openPreview`.
- `editor/title`: "Open Editor" icon on Source tabs for `.md`; "Open Source" icon when `activeCustomEditorId` is either null-markdown view.

## Errors and edge cases

- Files above ~1 MB (constant in `editorProvider.js`): the Editor shows a notice and offers to reopen as Source; widget round-trips to the host do not scale.
- The webview is local-only with the same CSP as Preview; no untrusted-workspace special handling.

## Behaviour owned by the platform

Dirty state, save, external file changes, Reopen With and tab replacement come from the shared `TextDocument` + `CustomTextEditorProvider`. Source edits reach the Editor via `onDidChangeTextDocument`.

## Testing

- `node --test`: `syncState.js` (echo suppression, mismatch → reset, remote change forwarding) and `reveal.js` (node + selection → hidden / shown). New `test` script in `package.json`, listing the files explicitly.
- Manual checklist (in the plan): Reopen With shows Source / Editor / Preview and each switch keeps one tab and one document; open from Explorer, search and Source Control; untitled `.md`; dirty / save; external file change; Source ↔ Editor edits both ways; undo/redo per the spike; each widget type (table, Mermaid, math, alert, image); checkbox toggle; IME input.
- `null-markdown` has no integration specs, so `/verify-local` does not apply; confirm `sync-local.ps1` copies `lib/`.

## Delivery order

1. Spike: undo/redo ownership; the bundle loads in a CustomTextEditor webview.
2. Sync protocol and a plain CM6 editor (opens, edits, saves).
3. Live-preview decorations.
4. Block widgets.
5. Commands, toolbar and Preview as a custom editor.
6. Build / CI wiring and docs (`CLAUDE.md`, tracking row → Adapt with Null issue #114, comment on the issue).

## Out of scope / known ceilings

- No per-cell table editing (a table is raw while the caret is in it).
- No syntax highlighting inside code fences in the Editor.
- `:emoji:`, footnotes and inline `$math$` stay plain text (`$$` blocks render).
- Relative images resolve against the document's folder; images outside the workspace folders or that folder do not load.
- Export to PDF and Slides still need the Source tab to be active.
- Rendered diffs from Source Control: custom editors cannot be used in the diff editor.
- No Editor↔Source scroll sync (Editor is its own tab).

# Null Markdown Editor view — design

Issue: #114. Extension: `extensions/null-markdown/`.

## Goal

A view for `.md` files, **Markdown Editor**: the document is shown rendered and edited in place, Typora/Obsidian-style. Syntax markers are hidden except around the caret, and edits land in the same file. It is the **default** view of a `.md` file; **Source** (plain text) is one click away through a single toggle button in the tab title. Both are views of one `TextDocument`; switching never copies a document. The side-by-side **Preview** panel (Ctrl+Shift+V) is unchanged.

VS Code's own hybrid Markdown editor is still Agents-window-only and experimental (1.141), so there is nothing to backport (`docs/vscode-tracking.md`, rows 1.131 / 1.132). This is the Null-built equivalent.

## Constraints

- The file is never rewritten or normalised: the editor holds the raw Markdown text and only decorates it. No HTML→Markdown or tree→Markdown serialisation.
- Block widgets (table, Mermaid, math, alert, image, HTML) render through the existing `createMd()` + `processAlerts()`, so they look identical to Preview.
- Preview keeps working independently.
- Plain JS, matching the extension. The webview is bundled by esbuild into a tracked `lib/` (same convention as `null-music` / `null-activity` webviews). This replaces the earlier "no build step" constraint for `null-markdown`.

## Views of one file

```text
example.md
    ├── Markdown Editor    (null-markdown.editor — live preview, editable; default for *.md)
    └── Markdown Source    (built-in text editor, listed by VS Code as "Text Editor")
```

`null-markdown.editor` has `priority: "default"`, so a `.md` opened from the Explorer, search or quick open lands in the Editor. Both views appear in **Reopen Editor With… / Open With…** and switch in place on the same `TextDocument`. Diffs and Source Control keep the text editor (custom editors cannot be used in the diff editor). The side-by-side `null-markdown.openPreview` panel works when the active tab is the Editor, using the Editor's document.

There is no read-only in-tab Preview: the Editor already renders in place, so a second read-only copy adds nothing.

## Architecture

| Piece | Responsibility |
|---|---|
| `editorProvider.js` (host, new) | `CustomTextEditorProvider` for the Editor. A thin relay: sends full text + version on open, applies webview edits as one `WorkspaceEdit`, forwards `onDidChangeTextDocument` changes, answers `renderBlock`, handles `wikiLink` / `checkboxToggle` like Preview. |
| `syncState.js` (host, pure) | Version bookkeeping and echo suppression: records the version produced by its own edit, decides forward / drop / reset. Unit-tested. |
| `webview/editor/*.mjs` (new) | CM6 setup: Markdown language (GFM), live-preview decorations, block widgets, formatting keymaps. Plain ES modules. |
| `webview/editor/reveal.mjs` (pure), `specs.mjs` (pure decoration plan) | Reveal rule: (syntax node, selection) → hidden or shown. Unit-tested with no CM6 import. |
| `lib/editor.js` (tracked, generated) | esbuild output. Never hand-edited. |
| `lib/editor.css` (tracked, hand-written) | Theme-variable styling shared with `null-markdown.css` fonts and colours. |
| `extension.js` (modified) | Registers the provider and commands; checkbox toggle edits the document instead of needing a visible text editor; `openPreview` falls back to the Editor's document. |
| `package.json` (modified) | One `customEditors` entry (`priority: default`), commands, `editor/title` items, `build` script (esbuild), `test` script, CodeMirror/lezer deps, `esbuild` devDependency. |
| `scripts/sync-local.ps1`, `build.yml` (modified) | Copy `lib/`; run `npm ci && npm run build` for `null-markdown`. |

Dependencies (dev only; bundled into `lib/editor.js`, about 500 KB minified): `@codemirror/{state,view,commands,language,lang-markdown}`, `@lezer/markdown`, `esbuild`. The bundle is about 490 KB minified. The decoration plan, sync client and formatting commands are plain `.mjs` modules so `node --test` can import them directly; host files stay CommonJS `.js`.

## Sync protocol

The `TextDocument` is the source of truth; the CM6 doc is a mirror.

- **Line endings:** the webview mirrors the text with LF line endings (CM6 normalises them). Offsets it sends are LF offsets; the host converts them to line/character positions against the LF form of its text and writes inserted text with the document's EOL. This lives in `syncState.js` (pure, unit-tested) together with the version bookkeeping.
- **Webview → host:** `edit { baseVersion, changes: [{from, to, insert}] }` in original-document coordinates. Local changes are debounced (~300 ms) and composed, so a typing burst is one `WorkspaceEdit` and one undo step, and only one edit is in flight at a time. The host applies it, then replies `ack { version }`.
- **Host → webview** (Source edit, git checkout, formatter, undo, rejected edit): `doc { text, version }` with the full LF text. The webview diffs it against its current text and applies the single changed span, so the selection is preserved; it is not echoed back.
- **Version mismatch:** if the host changed since `baseVersion`, or the edit is malformed, it drops the edit and sends `doc`. Anything the webview had pending loses the race (host wins); at most a few keystrokes, and only when two writers race.
- **Save:** Ctrl+S in the webview waits for pending edits to be acked, then asks the host to save; otherwise the workbench would save before the last edit lands and the file would stay dirty.
- **Webview reload / crash:** the webview sends `ready` and the host replies with `doc`. No local persistence.

### Undo/redo (single workbench stack; confirm in the app)

How Ctrl+Z behaves inside a `CustomTextEditor` webview is unverified: it may reach CM6's history, the workbench's document undo, or both (the webview forwards undo/redo keydowns to the workbench even when the editor handled them). The design commits to one stack: the workbench's document undo, with no CM6 history, because the host `TextDocument` is the source of truth and every undo then arrives as a normal `doc` message. Plan task 2's manual undo gate checks this in the running app; if it does not hold, the spec is revisited. (Not yet recorded as passed; run the gate in a synced build.) Known ceiling: an undo pressed within one debounce window of typing can undo the previous step instead of the one still in flight.

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

**Typography:** the Editor looks like the Preview at rest. `lib/editor.css` reuses the Preview's colours and font stacks (as CSS variables shared with `null-markdown.css`) for headings, list indents, the blockquote bar, inline code and fenced code, so switching between Preview and Editor changes nothing but the caret.

**Editing helpers:** from `@codemirror/lang-markdown`: Enter continues lists and quotes, Tab indents list items, GFM tables and strikethrough parse. Custom keymaps: Ctrl+B, Ctrl+I, Ctrl+K (bold, italic, link) only.

## Commands and toolbar

One toggle button in the `editor/title` navigation group, shown by `resourceLangId == markdown`:

- On a Source tab (`!activeCustomEditorId`): **`$(open-preview)`** "Open Markdown Editor" → `vscode.openWith(uri, 'null-markdown.editor')`.
- On an Editor tab (`activeCustomEditorId == null-markdown.editor`): **`$(code)`** "Open Markdown Source" → `vscode.openWith(uri, 'default')`.

The two icons share `group: navigation@1`, and their `when` clauses are mutually exclusive, so the user sees one button that flips the view. `Markdown: Open Editor` / `Markdown: Open Source` are the same two commands in the palette. The side-by-side panel stays on `null-markdown.openPreview`.

## Errors and edge cases

- Files above ~1 MB (constant in `editorProvider.js`): the Editor shows a notice and offers to reopen as Source; widget round-trips to the host do not scale.
- The webview is local-only with the same CSP as Preview; no untrusted-workspace special handling.

## Behaviour owned by the platform

Dirty state, save, external file changes, Reopen With and tab replacement come from the shared `TextDocument` + `CustomTextEditorProvider`. Source edits reach the Editor via `onDidChangeTextDocument`.

## Testing

- `node --test`: `syncState.js` (echo suppression, mismatch → reset, remote change forwarding) and `reveal.js` (node + selection → hidden / shown). New `test` script in `package.json`, listing the files explicitly.
- Manual checklist (in the plan): a `.md` opens in the Editor by default; the title button flips Editor ↔ Source in the same tab; Reopen With shows Editor and Source and each switch keeps one tab and one document; open from Explorer, search and Source Control; untitled `.md`; dirty / save; external file change; Source ↔ Editor edits both ways; undo/redo per the undo gate; each widget type (table, Mermaid, math, alert, image); checkbox toggle; IME input.
- `null-markdown` has no integration specs, so `/verify-local` does not apply; confirm `sync-local.ps1` copies `lib/`.

## Delivery order

1. Done: spike (undo/redo ownership; the bundle loads in a CustomTextEditor webview); sync protocol and a plain CM6 editor (opens, edits, saves).
2. Live-preview decorations and the Preview-matching stylesheet.
3. Default priority, the toggle button, and the size guard (the in-tab Preview from the earlier plan is dropped).
4. Block widgets.
5. Formatting shortcuts and link opening.
6. Build / CI wiring and docs (`CLAUDE.md`, tracking row → Adapt with Null issue #114, comment on the issue).

## Out of scope / known ceilings

- No per-cell table editing (a table is raw while the caret is in it).
- No syntax highlighting inside code fences in the Editor.
- `:emoji:`, footnotes and inline `$math$` stay plain text (`$$` blocks render).
- Relative images resolve against the document's folder; images outside the workspace folders or that folder do not load.
- Export to PDF and Slides still need the Source tab to be active.
- Rendered diffs from Source Control: custom editors cannot be used in the diff editor.
- No Editor↔Source scroll sync (Editor is its own tab).

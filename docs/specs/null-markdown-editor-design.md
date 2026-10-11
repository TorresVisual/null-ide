# Null Markdown Editor view — design

Issue: #114. Extension: `extensions/null-markdown/`.

## Goal

A third view for `.md` files, **Markdown Editor**: the document is shown rendered and edited in place, and edits land in the same file. It sits next to the existing **Source** (plain text) and **Preview** views. All three are views of one `TextDocument`; switching never copies a document.

## Constraints

- Reuse the existing markdown-it pipeline (`createMd()` + `processAlerts()`); no second parser or renderer, no HTML→Markdown converter.
- Preview keeps working independently.
- Not a full WYSIWYG editor.
- `null-markdown` is plain JS with no build step; keep it that way.

## Views of one file

```text
example.md
    ├── Markdown Source    (built-in text editor, listed by VS Code as "Text Editor")
    ├── Markdown Editor    (null-markdown.editor — rendered, editable)
    └── Markdown Preview   (null-markdown.previewEditor — rendered, read-only, same tab)
```

All three appear in **Reopen Editor With… / Open With…** and switch in place on the same `TextDocument`. The existing `null-markdown.openPreview` side-by-side panel is unchanged and remains the quick "preview beside source" path.

## Editing model: block-level source reveal

Granularity is the **top-level block** (paragraph, whole list, table, fence, html block, heading).

1. All blocks render normally. Clicking a block asks the host for its source lines `[start, end)`; the webview swaps that block for a `<textarea>` holding the raw Markdown.
2. Esc or blur commits. The webview posts `replaceBlock { start, end, original, text }`. The host replaces only lines `[start, end)` in one `WorkspaceEdit` (document EOL preserved, blank lines between blocks untouched). One commit = one undo step.
3. Clicking the empty area below the last block appends a new block (textarea at end of file; empty commit adds nothing).
4. The block re-renders through the same pipeline via the normal `onDidChangeTextDocument` → `update` path.

### Concurrent changes

- While a textarea is open, `editor.js` swallows incoming `update` messages (it is loaded before `preview.js` and calls `stopImmediatePropagation`), keeps the latest html, and applies it after the block closes.
- On commit the host checks that lines `[start, end)` still equal `original`. If not (Source edit, external change, formatter), it rejects the edit, tells the webview to keep the textarea, and shows a warning. Nothing is silently overwritten.

## Components

| Piece | Responsibility |
|---|---|
| `extension.js` (modified) | `data-line-end` attribute in the source-map rule; shared `buildPage(webview, ctx, html, extraScripts)` used by Preview, Slides' shell stays as is; `openPreview` falls back to the Editor's document; checkbox toggle edits the document instead of requiring a visible text editor; registers the provider and the new commands. |
| `editor.js` (new, host) | `NullMarkdownEditorProvider` (`CustomTextEditorProvider`), constructed twice with `{ readOnly }`: renders, posts `update`, handles `wikiLink`/`checkboxToggle` (same as Preview), ignores `scroll`. When not read-only it also answers `blockSource` and applies `replaceBlock`, and loads `preview/editor.js`. |
| `blockEdit.js` (new, pure) | `getBlockLines(text, start, end)` and `replaceBlockLines(text, start, end, original, newText)` → new text or `null` on mismatch. Handles `\n`/`\r\n`. Unit-tested. |
| `preview/editor.js` (new, webview) | Click-to-edit layer: finds the top-level `[data-line]` child of `#content`, textarea lifecycle, update queueing, conflict handling. Reuses `preview.js` for KaTeX, Mermaid, wiki links, checkboxes. |
| `preview/null-markdown.css` (modified) | Textarea styling (monospace, matches block width, themed). |
| `package.json` (modified) | two `customEditors` entries (`null-markdown.editor` "Markdown Editor", `null-markdown.previewEditor` "Markdown Preview"; `filenamePattern: *.md`, `priority: option`), commands, `editor/title` menu items, `test` script. |

## Commands and toolbar

- `Markdown: Open Editor` → `vscode.openWith(uri, 'null-markdown.editor')`.
- `Markdown: Open Source` → `vscode.openWith(uri, 'default')`.
- `Markdown: Open Preview` → `vscode.openWith(uri, 'null-markdown.previewEditor')` (in-tab, read-only). The side-by-side panel stays on `null-markdown.openPreview` (Ctrl+Shift+V, `markdown.showPreview*` intercepts), which also works when the active tab is the Editor or in-tab Preview.
- `editor/title`: "Open Editor" icon on Source tabs for `.md`; "Open Source" icon when `activeCustomEditorId` is either null-markdown view.
- Reopen With lists all three views: Source (built-in), Editor and Preview (both `customEditors`, `priority: option`).

## Behaviour owned by the platform

Dirty state, save, external file changes, undo/redo, Reopen With and tab replacement come from the shared `TextDocument` + `CustomTextEditorProvider`. Source edits reach the Editor via `onDidChangeTextDocument`.

## Testing

- `node --test` for `blockEdit.js` (LF/CRLF, first/last block, mismatch → `null`, empty new text, append at EOF). New `test` script in `package.json`.
- Manual checklist (plan): Reopen With shows Source / Editor / Preview and each switch keeps one tab and one document; open from Explorer, search and Source Control; untitled `.md`; undo/redo after block commit, including from the webview (verify that Ctrl+Z in the webview reaches the document); dirty/save; external file change with and without an open textarea; Source ↔ Editor ↔ Preview side by side; checkbox toggle in Preview next to an Editor tab; KaTeX/Mermaid/alerts/wiki links identical to Preview.
- `null-markdown` has no integration specs today, so `/verify-local` does not apply; confirm `sync-local.ps1` copies the new files.

## Out of scope / known ceilings

- No live inline rendering inside the block being edited; no per-cell table editing; nested items edit with their whole top-level block.
- No Editor↔Source scroll sync (Editor is its own tab).
- Front matter is not handled (same as Preview today).
- Mermaid and KaTeX blocks edit as source.

# Null Markdown: Gray Palette & Syntax Highlighting

**Date:** 2026-06-22
**Status:** Approved

## Problem

The null-markdown preview inherits several blue/purple-tinted values from an earlier blue IDE theme:
- Border and separator colors (`#1e1e35`, `#252540`, `#252550`) read as blue-tinged rather than neutral gray.
- The slides view background (`#0d0d1a`) and nav bar (`#111122`) are visibly purple-dark.
- The alert-note background is a blue-tinted rgba, making the alert box feel themed to an old palette.
- Code blocks render as flat `#e6e6f0` text — no syntax highlighting at all.

## Goals

1. Replace blue-tinted **backgrounds and border colors** with neutral grays that sit naturally on `#1f1f1f`.
2. Keep blue for **link text**, **blockquote border**, **inline code color**, and **wiki links** — these are intentional accents, not background stains.
3. Add per-language syntax highlighting to all fenced code blocks, rendered server-side so the webview receives pre-colored HTML.

## Out of Scope

- Changing the Null IDE color theme (`null-theme` extension).
- User-configurable syntax highlight themes.
- Print / PDF export styles (already use a separate light palette, untouched).

---

## Color Palette Changes (`null-markdown.css`)

| Element | Old value | New value |
|---|---|---|
| `h1`, `h2` `border-bottom` | `#1e1e35` | `#2a2a2a` |
| `pre` border, `th`/`td` borders | `#252540` | `#2e2e2e` |
| Slide nav border, misc blue-borders | `#252550` | `#333333` |
| Alert-note **background** | `rgba(60,147,248,.1)` | `rgba(128,128,128,.12)` |
| Slides page background | `#0d0d1a` | `#141414` |
| Slide nav background | `#111122` | `#181818` |

**Unchanged (intentional blue accents):**
- Links: `#3c93f8` / hover `#48cae4`
- Inline `code` text color: `#3c93f8`
- Task-list checkbox `accent-color`: `#3c93f8`
- Wiki links: `#48cae4` / hover `#00b4d8`
- All other alert type borders/backgrounds (tip, important, warning, caution)

**Revision (2026-08-10):** Full neutral-grey pass over remaining off-neutral foreground colors in `null-markdown.css` (functional link/code/wiki-link/alert-note accents kept per user decision):
- Blockquote left border: `#3c93f8` → `#616161` (matches `textBlockQuote.border` in `null-dark.json`)
- Body text, `pre code` text, alert paragraph text: `#e6e6f0` → `#e6e6e6` (dropped the blue-pushed channel)
- Blockquote text, footnotes text: `#9898b8` → `#9a9a9a` (was a distinct blue-gray, now true neutral)

---

## Syntax Highlighting

### Dependency

Add `"highlight.js": "^11.0.0"` to `extensions/null-markdown/package.json` dependencies. CI already runs `npm ci --prefix extensions/null-markdown` so no workflow changes are needed.

### Server-side rendering (extension.js)

In `createMd()`, require the `highlight.js` common bundle (covers ~36 languages) and pass a `highlight` callback to the markdown-it constructor:

```js
const hljs = require('./node_modules/highlight.js/lib/common');
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value;
  }
});
```

markdown-it wraps the returned value in `<pre><code>` automatically. The existing Mermaid fence override runs **after** the highlight callback via `md.renderer.rules.fence`, which already short-circuits on `token.info === 'mermaid'` before calling the default renderer — so Mermaid blocks are unaffected.

### Client-side theme (extension.js `_buildPage`)

Load `highlight.js/styles/github-dark.min.css` from `node_modules` via `wv.asWebviewUri(...)`. Add it as a `<link>` in `_buildPage()` alongside the KaTeX and null-markdown CSS. The CSP already allows `${wv.cspSource}` for stylesheets, so no CSP changes are needed.

The same CSS link must also be added in `NullMarkdownSlides._buildPage()`.

### Content update path

`preview.js` sets `content.innerHTML = msg.html` on each update message. Because the HTML already contains `hljs-*` span markup from the server-side render, no client-side re-highlighting call is needed. `preview.js` is unchanged.

---

## Files Changed

| File | Change |
|---|---|
| `extensions/null-markdown/package.json` | Add `"highlight.js": "^11.0.0"` to `dependencies` |
| `extensions/null-markdown/extension.js` | Require hljs; add `highlight` callback to markdown-it; load hljs CSS in `_buildPage` for both preview and slides |
| `extensions/null-markdown/preview/null-markdown.css` | Replace six blue-tinted color values per table above |

`preview.js` and `package-lock.json` are updated by npm automatically; no manual edits needed.

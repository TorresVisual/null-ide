# Null Markdown: Gray Palette & Syntax Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace blue-tinted background and border colors in the null-markdown preview CSS and add server-side syntax highlighting via highlight.js.

**Architecture:** Two independent changes committed separately. (1) Color fixes: six find-and-replace swaps in `null-markdown.css` and six more in the inline `<style>` block inside `NullMarkdownSlides._buildPage()` in `extension.js`. (2) Syntax highlighting: add `highlight.js` as a Node.js dependency, wire its `highlight` callback into the markdown-it constructor, and load the `vs2015` theme CSS in both `_buildPage` methods. Mermaid fenced blocks are handled by the existing fence override before the highlight callback is ever reached — no change needed there.

**Tech Stack:** highlight.js ^11.0.0, markdown-it ^14 (already installed)

## Global Constraints

- Only modify files inside `extensions/null-markdown/`
- Do not edit `preview/preview.js` — content updates set `innerHTML` directly; pre-highlighted HTML renders without any client-side re-highlighting call
- Do not modify the CI workflow
- The `highlight` callback must return `<pre class="hljs"><code>…</code></pre>` (starting with `<pre`) so markdown-it does not double-wrap the block in its own `<pre><code>` tags
- Keep links blue (`#3c93f8`, `#48cae4`), blockquote border blue, inline `code` color blue, wiki links blue — none of those change

---

### Task 1: Fix blue-tinted colors in null-markdown.css

**Files:**
- Modify: `extensions/null-markdown/preview/null-markdown.css`

**Interfaces:**
- Consumes: nothing
- Produces: CSS with all six blue-tinted values replaced by neutral grays; the file is otherwise unchanged

- [ ] **Step 1: Replace h1/h2 border-bottom color**

Find line 26 in `null-markdown.css`:
```css
h1, h2 {
	border-bottom: 1px solid #1e1e35;
	padding-bottom: 6px;
}
```
Change to:
```css
h1, h2 {
	border-bottom: 1px solid #2a2a2a;
	padding-bottom: 6px;
}
```

- [ ] **Step 2: Replace pre border color**

Find line 47:
```css
	border: 1px solid #252540;
```
Under the `pre {` block. Change to:
```css
	border: 1px solid #2e2e2e;
```

- [ ] **Step 3: Replace th border color**

Find line 84 (inside `th {`):
```css
	border: 1px solid #252540;
```
Change to:
```css
	border: 1px solid #2e2e2e;
```

- [ ] **Step 4: Replace td border color**

Find line 91 (inside `td {`):
```css
	border: 1px solid #252540;
```
Change to:
```css
	border: 1px solid #2e2e2e;
```

- [ ] **Step 5: Replace hr border-top color**

Find line 99 (inside `hr {`):
```css
	border-top: 1px solid #252540;
```
Change to:
```css
	border-top: 1px solid #2e2e2e;
```

- [ ] **Step 6: Replace footnotes border-top color**

Find line 119 (inside `.footnotes {`):
```css
	border-top: 1px solid #252540;
```
Change to:
```css
	border-top: 1px solid #2e2e2e;
```

- [ ] **Step 7: Replace alert-note background**

Find line 140:
```css
.markdown-alert-note      { border-color: #3c93f8; background: rgba(60,147,248,.1); }
```
Change to:
```css
.markdown-alert-note      { border-color: #3c93f8; background: rgba(128,128,128,.12); }
```

- [ ] **Step 8: Commit**

```bash
git add extensions/null-markdown/preview/null-markdown.css
git commit -m "fix(null-markdown): replace blue-tinted border and background colors with neutral grays"
```

---

### Task 2: Fix slides inline CSS and add highlight.js syntax highlighting

**Files:**
- Modify: `extensions/null-markdown/package.json`
- Modify: `extensions/null-markdown/extension.js`

**Interfaces:**
- Consumes: Task 1 (independent, but commits should be ordered)
- Produces:
  - `highlight.js ^11.0.0` installed in `node_modules`
  - `hljs` constant in `createMd()` scope, type: highlight.js common bundle
  - `highlight(code: string, lang: string): string` callback passed to markdown-it constructor — returns `<pre class="hljs"><code>…</code></pre>`
  - `hlCssUri` webview URI pointing to `node_modules/highlight.js/styles/vs2015.min.css`, loaded via `<link>` in both `NullMarkdownPreview._buildPage()` and `NullMarkdownSlides._buildPage()`
  - Slides inline CSS: six color values replaced with neutral grays

- [ ] **Step 1: Add highlight.js to package.json**

Open `extensions/null-markdown/package.json`. In the `"dependencies"` object, add `"highlight.js"` after the last existing entry:

```json
"dependencies": {
    "highlight.js": "^11.0.0",
    "katex": "^0.16.11",
    "markdown-it": "^14.2.0",
    "markdown-it-emoji": "^3.0.0",
    "markdown-it-footnote": "^4.0.0",
    "markdown-it-texmath": "^1.0.0",
    "mermaid": "^10.9.1"
}
```

- [ ] **Step 2: Install the dependency**

```bash
cd extensions/null-markdown && npm install
```

Expected: `node_modules/highlight.js/` appears, `package-lock.json` is updated. The installed version should be 11.x.

- [ ] **Step 3: Require hljs and add highlight callback to markdown-it**

In `extension.js`, find the `createMd()` function. The first two lines currently are:

```js
function createMd() {
	const MarkdownIt = require('./node_modules/markdown-it');
	const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
```

Replace with:

```js
function createMd() {
	const MarkdownIt = require('./node_modules/markdown-it');
	const hljs = require('./node_modules/highlight.js/lib/common');
	const md = new MarkdownIt({
		html: true,
		linkify: true,
		typographer: true,
		highlight(code, lang) {
			const highlighted = lang && hljs.getLanguage(lang)
				? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
				: hljs.highlightAuto(code).value;
			return `<pre class="hljs"><code>${highlighted}</code></pre>`;
		}
	});
```

- [ ] **Step 4: Load hljs CSS in NullMarkdownPreview._buildPage()**

Find the `_buildPage()` method in the `NullMarkdownPreview` class. It currently has:

```js
const autoRenderUri = u('node_modules', 'katex', 'dist', 'contrib', 'auto-render.min.js');
const mermaidUri    = u('node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const previewJsUri  = u('preview', 'preview.js');
```

Add `hlCssUri` after `autoRenderUri`:

```js
const autoRenderUri = u('node_modules', 'katex', 'dist', 'contrib', 'auto-render.min.js');
const hlCssUri      = u('node_modules', 'highlight.js', 'styles', 'vs2015.min.css');
const mermaidUri    = u('node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const previewJsUri  = u('preview', 'preview.js');
```

Then find the `<head>` section of the returned HTML template:

```html
<link rel="stylesheet" href="${katexCssUri}">
<link rel="stylesheet" href="${cssUri}">
```

Add the hljs stylesheet between them:

```html
<link rel="stylesheet" href="${katexCssUri}">
<link rel="stylesheet" href="${hlCssUri}">
<link rel="stylesheet" href="${cssUri}">
```

- [ ] **Step 5: Load hljs CSS in NullMarkdownSlides._buildPage()**

Find the `_buildPage()` method in the `NullMarkdownSlides` class. It currently has:

```js
const autoRenderUri = u('node_modules', 'katex', 'dist', 'contrib', 'auto-render.min.js');
const mermaidUri    = u('node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const nonce         = crypto.randomBytes(16).toString('hex');
```

Add `hlCssUri` after `autoRenderUri`:

```js
const autoRenderUri = u('node_modules', 'katex', 'dist', 'contrib', 'auto-render.min.js');
const hlCssUri      = u('node_modules', 'highlight.js', 'styles', 'vs2015.min.css');
const mermaidUri    = u('node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const nonce         = crypto.randomBytes(16).toString('hex');
```

Then find the `<head>` section of the slides HTML template:

```html
<link rel="stylesheet" href="${katexCssUri}">
<link rel="stylesheet" href="${cssUri}">
```

Add the hljs stylesheet between them:

```html
<link rel="stylesheet" href="${katexCssUri}">
<link rel="stylesheet" href="${hlCssUri}">
<link rel="stylesheet" href="${cssUri}">
```

- [ ] **Step 6: Fix blue-tinted inline CSS in NullMarkdownSlides._buildPage()**

Inside the `<style nonce="${nonce}">` block in `NullMarkdownSlides._buildPage()`, find and replace all six blue-tinted values:

| Find | Replace |
|---|---|
| `background: #0d0d1a` | `background: #141414` |
| `background: #111122` | `background: #181818` |
| `border-top: 1px solid #1e1e35` | `border-top: 1px solid #2a2a2a` |
| `background: #1e1e35` (button bg) | `background: #2a2a2a` |
| `border: 1px solid #252550` | `border: 1px solid #333333` |
| `background: #252550` (button:hover) | `background: #333333` |

The affected CSS lines (shown with their full context so you can locate them):

```css
/* BEFORE */
html, body { height: 100%; margin: 0; padding: 0; background: #0d0d1a; overflow: hidden; }

#slide-nav {
  display: flex; align-items: center; justify-content: center; gap: 20px;
  padding: 12px; background: #111122; border-top: 1px solid #1e1e35;
  flex-shrink: 0;
}
#slide-nav button {
  background: #1e1e35; color: #e6e6f0; border: 1px solid #252550;
  border-radius: 6px; padding: 6px 18px; cursor: pointer; font-size: 14px;
}
#slide-nav button:hover { background: #252550; }
```

```css
/* AFTER */
html, body { height: 100%; margin: 0; padding: 0; background: #141414; overflow: hidden; }

#slide-nav {
  display: flex; align-items: center; justify-content: center; gap: 20px;
  padding: 12px; background: #181818; border-top: 1px solid #2a2a2a;
  flex-shrink: 0;
}
#slide-nav button {
  background: #2a2a2a; color: #e6e6f0; border: 1px solid #333333;
  border-radius: 6px; padding: 6px 18px; cursor: pointer; font-size: 14px;
}
#slide-nav button:hover { background: #333333; }
```

- [ ] **Step 7: Verify manually**

Open any markdown file with a fenced code block (e.g. ` ```js `) in Null IDE and press `Ctrl+Shift+V`. Check:

1. Syntax tokens are colored — keywords (blue), strings (orange-brown), numbers (light green), comments (green) — consistent with the VS Code `vs2015` palette
2. A ` ```mermaid ` block still renders as a Mermaid diagram, not highlighted text
3. The preview background is `#1f1f1f` with no blue-tinted borders visible on `<h1>/<h2>` rules, `<pre>`, or tables
4. `Ctrl+Shift+Alt+S` opens the slides view; background is dark gray (not blue-dark), nav bar is dark gray

- [ ] **Step 8: Commit**

```bash
git add extensions/null-markdown/package.json extensions/null-markdown/package-lock.json extensions/null-markdown/extension.js
git commit -m "feat(null-markdown): add highlight.js syntax highlighting and fix blue-tinted slides colors"
```

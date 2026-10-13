'use strict';

const vscode = require('vscode');
const path   = require('path');
const crypto = require('crypto');
const { buildPreviewPage } = require('./pages');
const { applyCheckboxToggle, openWikiLink } = require('./docActions');
const { NullMarkdownEditorProvider } = require('./editorProvider');

// ── markdown-it setup ─────────────────────────────────────────────────────────

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

	// Inject data-line attributes from source maps for scroll sync
	md.core.ruler.push('null-source-map', state => {
		for (const token of state.tokens) {
			if (token.map && token.map.length) {
				token.attrSet('data-line', String(token.map[0]));
			}
		}
	});

	try { md.use(require('./node_modules/markdown-it-footnote')); }
	catch (e) { console.error('[null-markdown] footnote:', e.message); }

	try { md.use(require('./node_modules/markdown-it-emoji').full); }
	catch (e) { console.error('[null-markdown] emoji:', e.message); }

	try {
		md.use(require('./node_modules/markdown-it-texmath'), {
			engine: require('./node_modules/katex'),
			delimiters: 'dollars',
			katexOptions: { throwOnError: false }
		});
	} catch (e) { console.error('[null-markdown] KaTeX:', e.message); }

	// Interactive task-list checkboxes with source-line tracking
	md.core.ruler.after('inline', 'null-task-list', state => {
		const tokens = state.tokens;
		for (let i = 2; i < tokens.length; i++) {
			const token = tokens[i];
			if (token.type !== 'inline') continue;
			if (tokens[i - 1].type !== 'paragraph_open') continue;
			if (tokens[i - 2].type !== 'list_item_open') continue;
			if (!/^\[[ xX]\][ \t]/.test(token.content)) continue;

			const listItem  = tokens[i - 2];
			const line      = listItem.map ? listItem.map[0] : 0;
			const isChecked = /^\[[xX]\]/.test(token.content);

			token.content = token.content.slice(3);
			if (token.children?.length) token.children[0].content = token.children[0].content.slice(3);

			listItem.attrSet('class', 'task-list-item');

			const cbToken   = new state.Token('html_inline', '', 0);
			cbToken.content = `<input type="checkbox" class="task-list-item-checkbox" data-checkbox-line="${line}"${isChecked ? ' checked' : ''}>`;
			token.children.unshift(cbToken);
		}
	});

	// Wiki links: [[target]] or [[target|label]]
	md.core.ruler.push('null-wiki-links', state => {
		for (const token of state.tokens) {
			if (token.type !== 'inline' || !token.children) continue;
			const out = [];
			for (const child of token.children) {
				if (child.type !== 'text') { out.push(child); continue; }
				const parts = child.content.split(/(\[\[[^\]]+\]\])/g);
				if (parts.length === 1) { out.push(child); continue; }
				for (const part of parts) {
					const m = part.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
					if (!m) {
						const t = new state.Token('text', '', 0);
						t.content = part;
						out.push(t);
					} else {
						const target = m[1].trim();
						const label  = m[2] ? m[2].trim() : target;
						const open   = new state.Token('html_inline', '', 0);
						open.content = `<a class="wiki-link" data-wiki="${target.replace(/"/g, '&quot;')}" href="#">`;
						out.push(open);
						const text   = new state.Token('text', '', 0);
						text.content = label;
						out.push(text);
						const close  = new state.Token('html_inline', '', 0);
						close.content = '</a>';
						out.push(close);
					}
				}
			}
			token.children = out;
		}
	});

	// Mermaid fenced blocks → bare divs (client-side rendering)
	const prevFence = md.renderer.rules.fence;
	md.renderer.rules.fence = (tokens, idx, options, env, self) => {
		const token = tokens[idx];
		if (token.info.trim() === 'mermaid') {
			const esc = token.content
				.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			return `<div class="mermaid">${esc}</div>\n`;
		}
		return prevFence ? prevFence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
	};

	return md;
}

// ── GitHub Alerts post-processing ─────────────────────────────────────────────

const ALERT_LABELS = { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' };

function processAlerts(html) {
	return html.replace(
		/<blockquote[^>]*>\s*<p[^>]*>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:<br\s*\/?>|\n)([\s\S]*?)<\/p>\s*<\/blockquote>/gi,
		(_, type, body) => {
			const key   = type.toUpperCase();
			const label = ALERT_LABELS[key] ?? key;
			return `<div class="markdown-alert markdown-alert-${key.toLowerCase()}"><span class="alert-title">${label}</span><p>${body.trim()}</p></div>`;
		}
	);
}

// ── NullMarkdownPreview ───────────────────────────────────────────────────────

const openPanels = new Map(); // document URI string → NullMarkdownPreview

class NullMarkdownPreview {
	constructor(document, context, md) {
		this._doc   = document;
		this._ctx   = context;
		this._md    = md;
		this._subs  = [];
		this._timer = null;
		this._suppressEditorScroll      = false;
		this._suppressEditorScrollTimer = null;
		this._firstRender  = true;
		this._onDisposeCbs = [];

		this.panel = vscode.window.createWebviewPanel(
			'null-markdown-preview',
			path.basename(document.fileName) + ' — Preview',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.file(context.extensionPath)]
			}
		);

		this.panel.onDidDispose(() => {
			this._subs.forEach(d => d.dispose());
			clearTimeout(this._timer);
			clearTimeout(this._suppressEditorScrollTimer);
			this._onDisposeCbs.forEach(cb => cb());
		}, null, this._subs);

		this.panel.webview.onDidReceiveMessage(msg => this._onMessage(msg), null, this._subs);

		vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() === this._doc.uri.toString()) this._scheduleRender();
		}, null, this._subs);

		vscode.window.onDidChangeTextEditorVisibleRanges(e => {
			if (e.textEditor.document.uri.toString() !== this._doc.uri.toString()) return;
			if (this._suppressEditorScroll) return;
			const line = e.visibleRanges[0]?.start.line ?? 0;
			this.panel.webview.postMessage({ type: 'revealLine', line });
		}, null, this._subs);

		// Follow active markdown editor — switch preview when user changes files
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (!editor || editor.document.languageId !== 'markdown') return;
			const newUri = editor.document.uri.toString();
			if (newUri === this._doc.uri.toString()) return;
			openPanels.delete(this._doc.uri.toString());
			this._doc = editor.document;
			openPanels.set(newUri, this);
			this.panel.title = path.basename(editor.document.fileName) + ' — Preview';
			this._firstRender = true;
			this._render();
		}, null, this._subs);

		this._render();
	}

	reveal() {
		this.panel.reveal(vscode.ViewColumn.Beside, true);
	}

	onDispose(cb) { this._onDisposeCbs.push(cb); }

	_findEditor() {
		return vscode.window.visibleTextEditors.find(e =>
			e.document.uri.toString() === this._doc.uri.toString()
		);
	}

	async _onMessage(msg) {
		if (msg.type === 'checkboxToggle') {
			await applyCheckboxToggle(this._doc, msg.line, msg.checked);
		} else if (msg.type === 'wikiLink') {
			await openWikiLink(msg.target);
		} else if (msg.type === 'scroll') {
			// Webview scrolled → sync editor; suppress the echo it would fire back
			this._suppressEditorScroll = true;
			clearTimeout(this._suppressEditorScrollTimer);
			this._suppressEditorScrollTimer = setTimeout(() => {
				this._suppressEditorScroll = false;
			}, 500);
			const editor = this._findEditor();
			if (editor) {
				editor.revealRange(
					new vscode.Range(msg.line, 0, msg.line, 0),
					vscode.TextEditorRevealType.AtTop
				);
			}
		}
	}

	_scheduleRender() {
		clearTimeout(this._timer);
		this._timer = setTimeout(() => { this._timer = null; this._render(); }, 200);
	}

	_render() {
		let html = this._md.render(this._doc.getText());
		html = processAlerts(html);
		if (this._firstRender) {
			this._firstRender = false;
			this.panel.webview.html = this._buildPage(html);
		} else {
			this.panel.webview.postMessage({ type: 'update', html });
		}
	}

	_buildPage(contentHtml) {
		return buildPreviewPage(this.panel.webview, this._ctx.extensionPath, contentHtml);
	}
}

// ── NullMarkdownSlides ────────────────────────────────────────────────────────

const openSlides = new Map(); // document URI string → NullMarkdownSlides

class NullMarkdownSlides {
	constructor(document, context, md) {
		this._doc  = document;
		this._ctx  = context;
		this._md   = md;
		this._subs = [];

		this.panel = vscode.window.createWebviewPanel(
			'null-markdown-slides',
			path.basename(document.fileName) + ' — Slides',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.file(context.extensionPath)]
			}
		);

		this.panel.onDidDispose(() => {
			this._subs.forEach(d => d.dispose());
			openSlides.delete(document.uri.toString());
		}, null, this._subs);

		vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() === this._doc.uri.toString()) this._render();
		}, null, this._subs);

		this._render();
	}

	reveal() { this.panel.reveal(vscode.ViewColumn.One); }

	_splitSlides(fullHtml) {
		// Split on <hr> tags produced by --- separators
		return fullHtml.split(/<hr\s*\/?>/i).map(s => s.trim()).filter(Boolean);
	}

	_render() {
		let html = this._md.render(this._doc.getText());
		html = processAlerts(html);
		const slides = this._splitSlides(html);
		this.panel.webview.html = this._buildPage(slides);
	}

	_buildPage(slides) {
		const wv  = this.panel.webview;
		const ext = vscode.Uri.file(this._ctx.extensionPath);
		const u   = (...p) => wv.asWebviewUri(vscode.Uri.joinPath(ext, ...p));

		const cssUri        = u('preview', 'null-markdown.css');
		const katexCssUri   = u('node_modules', 'katex', 'dist', 'katex.min.css');
		const katexJsUri    = u('node_modules', 'katex', 'dist', 'katex.min.js');
		const autoRenderUri = u('node_modules', 'katex', 'dist', 'contrib', 'auto-render.min.js');
		const hlCssUri      = u('node_modules', 'highlight.js', 'styles', 'vs2015.min.css');
		const mermaidUri    = u('node_modules', 'mermaid', 'dist', 'mermaid.min.js');
		const nonce         = crypto.randomBytes(16).toString('hex');
		const slidesJson    = JSON.stringify(slides);

		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${wv.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${wv.cspSource}; img-src ${wv.cspSource} https: data:; font-src ${wv.cspSource};">
<link rel="stylesheet" href="${katexCssUri}">
<link rel="stylesheet" href="${hlCssUri}">
<link rel="stylesheet" href="${cssUri}">
<style nonce="${nonce}">
html, body { height: 100%; margin: 0; padding: 0; background: #141414; overflow: hidden; }
body { max-width: none; display: flex; flex-direction: column; align-items: stretch; }
#slide-container {
  flex: 1; display: flex; align-items: center; justify-content: center;
  overflow: hidden; padding: 0 64px; box-sizing: border-box;
}
#slide {
  max-width: 900px; width: 100%; max-height: 100vh;
  overflow-y: auto; padding: 40px 48px; box-sizing: border-box;
}
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
#slide-nav button:disabled { opacity: 0.3; cursor: default; }
#slide-counter { color: #9898b8; font-size: 13px; min-width: 80px; text-align: center; }
/* hide hr separators inside slide content if any leaked through */
#slide hr { display: none; }
</style>
</head>
<body>
<div id="slide-container"><div id="slide"></div></div>
<nav id="slide-nav">
  <button id="btn-prev" disabled>&#8592; Prev</button>
  <span id="slide-counter">1 / 1</span>
  <button id="btn-next">Next &#8594;</button>
</nav>
<script nonce="${nonce}" src="${katexJsUri}"></script>
<script nonce="${nonce}" src="${autoRenderUri}"></script>
<script nonce="${nonce}" src="${mermaidUri}"></script>
<script nonce="${nonce}">
(function() {
  const slides = ${slidesJson};
  let idx = 0;

  const slideEl   = document.getElementById('slide');
  const counter   = document.getElementById('slide-counter');
  const btnPrev   = document.getElementById('btn-prev');
  const btnNext   = document.getElementById('btn-next');

  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose', fontFamily: 'inherit' });
  }

  function show(n) {
    idx = Math.max(0, Math.min(slides.length - 1, n));
    slideEl.innerHTML = slides[idx] || '';
    counter.textContent = (idx + 1) + ' / ' + slides.length;
    btnPrev.disabled = idx === 0;
    btnNext.disabled = idx === slides.length - 1;
    if (typeof renderMathInElement !== 'undefined') {
      renderMathInElement(slideEl, {
        delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
        throwOnError: false, ignoredTags: ['script','noscript','style','textarea','pre','code']
      });
    }
    if (typeof mermaid !== 'undefined') mermaid.run({ querySelector: '#slide .mermaid' });
  }

  btnPrev.addEventListener('click', () => show(idx - 1));
  btnNext.addEventListener('click', () => show(idx + 1));

  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); show(idx + 1); }
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')                    { e.preventDefault(); show(idx - 1); }
    if (e.key === 'Home')                                                  { e.preventDefault(); show(0); }
    if (e.key === 'End')                                                   { e.preventDefault(); show(slides.length - 1); }
  });

  show(0);
})();
</script>
</body>
</html>`;
	}
}

// ── activation ────────────────────────────────────────────────────────────────

function activate(context) {
	const md = createMd();

	// The file a command should act on: an explicit URI (menus), the active Markdown Editor tab, or the active text editor.
	function activeMarkdownUri(arg) {
		if (arg instanceof vscode.Uri) return arg;
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		if (input instanceof vscode.TabInputCustom && input.viewType === 'null-markdown.editor') return input.uri;
		const editor = vscode.window.activeTextEditor;
		return editor?.document.languageId === 'markdown' ? editor.document.uri : undefined;
	}

	async function openPreview(arg) {
		const uri = activeMarkdownUri(arg);
		if (!uri) { vscode.window.showWarningMessage('Open a Markdown file first.'); return; }
		const key = uri.toString();
		if (openPanels.has(key)) { openPanels.get(key).reveal(); return; }
		const doc = await vscode.workspace.openTextDocument(uri);
		if (doc.languageId !== 'markdown') { vscode.window.showWarningMessage('Open a Markdown file first.'); return; }
		const preview = new NullMarkdownPreview(doc, context, md);
		openPanels.set(key, preview);
		preview.onDispose(() => openPanels.delete(key));
	}

	async function exportPdf() {
		const os = require('os');
		const fs = require('fs');

		// Resolve the document — active editor wins, then any open preview panel
		let doc = vscode.window.activeTextEditor?.document;
		if (!doc || doc.languageId !== 'markdown') {
			if (openPanels.size > 0) doc = openPanels.values().next().value._doc;
		}
		if (!doc || doc.languageId !== 'markdown') {
			vscode.window.showWarningMessage('Open a Markdown file first.');
			return;
		}

		let html = md.render(doc.getText());
		html = processAlerts(html);

		// KaTeX CSS with absolute font paths so fonts load from the temp directory
		const extPath  = context.extensionPath;
		const katexRaw = fs.readFileSync(path.join(extPath, 'node_modules', 'katex', 'dist', 'katex.min.css'), 'utf8');
		const fontsAbs = path.join(extPath, 'node_modules', 'katex', 'dist', 'fonts').replace(/\\/g, '/');
		const katexCss = katexRaw.replace(/url\(fonts\//g, `url(file:///${fontsAbs}/`);

		// <base href> resolves relative images/links against the source file's directory
		const srcDir   = path.dirname(doc.fileName).replace(/\\/g, '/');
		const baseHref = `file:///${srcDir}/`;

		const title   = path.basename(doc.fileName, '.md');
		const tmpFile = path.join(os.tmpdir(), `${title}.html`);

		const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<base href="${baseHref}">
<title>${title.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</title>
<style>
${katexCss}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#24292e;background:#fff;max-width:860px;margin:0 auto;padding:32px 48px}
h1,h2,h3,h4,h5,h6{font-weight:600;margin-top:24px;margin-bottom:8px;color:#111}
h1,h2{border-bottom:1px solid #e1e4e8;padding-bottom:6px}
a{color:#0366d6;text-decoration:none}
a:hover{text-decoration:underline}
p{margin:12px 0}
code{font-family:'Geist Mono','JetBrains Mono','Cascadia Code',monospace;background:#f6f8fa;color:#d73a49;padding:2px 5px;border-radius:4px;font-size:0.9em}
pre{background:#f6f8fa;border:1px solid #e1e4e8;border-radius:6px;padding:16px;overflow-x:auto}
pre code{background:transparent;color:#24292e;padding:0;font-size:0.875em}
blockquote{border-left:4px solid #0366d6;margin:16px 0;padding:8px 16px;background:#f1f8ff;color:#555;border-radius:0 4px 4px 0}
blockquote p{margin:0}
table{border-collapse:collapse;width:100%;margin:16px 0}
th{background:#f6f8fa;color:#111;padding:10px 14px;text-align:left;border:1px solid #e1e4e8;font-weight:600}
td{padding:8px 14px;border:1px solid #e1e4e8}
tr:nth-child(even) td{background:#f6f8fa}
hr{border:none;border-top:1px solid #e1e4e8;margin:28px 0}
img{max-width:100%;border-radius:4px}
.task-list-item{list-style:none}
.task-list-item-checkbox{margin-right:6px;margin-left:-20px;vertical-align:middle}
.footnotes{margin-top:32px;padding-top:16px;border-top:1px solid #e1e4e8;font-size:0.875em;color:#666}
.mermaid{text-align:center;margin:20px auto}
.markdown-alert{border-left:4px solid;border-radius:0 4px 4px 0;padding:10px 16px;margin:16px 0}
.markdown-alert .alert-title{display:block;margin-bottom:4px;font-size:0.9em;font-weight:600}
.markdown-alert p{margin:0}
.markdown-alert-note{border-color:#0366d6;background:#f1f8ff}
.markdown-alert-tip{border-color:#22863a;background:#f0fff4}
.markdown-alert-important{border-color:#6f42c1;background:#f5f0ff}
.markdown-alert-warning{border-color:#e36209;background:#fff8f0}
.markdown-alert-caution{border-color:#cb2431;background:#fff5f5}
.katex-display{overflow-x:auto;padding:8px 0}
@media print{
  body{padding:0;max-width:none}
  h1,h2,h3{page-break-after:avoid}
  pre,blockquote,table{page-break-inside:avoid}
}
</style>
</head>
<body>
<div id="content">${html}</div>
</body>
</html>`;

		fs.writeFileSync(tmpFile, page, 'utf8');
		await vscode.env.openExternal(vscode.Uri.file(tmpFile));
	}

	function openSlidesCmd() {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'markdown') {
			vscode.window.showWarningMessage('Open a Markdown file first.');
			return;
		}
		const key = editor.document.uri.toString();
		if (openSlides.has(key)) { openSlides.get(key).reveal(); return; }
		const slides = new NullMarkdownSlides(editor.document, context, md);
		openSlides.set(key, slides);
	}

	const editorProvider = new NullMarkdownEditorProvider(context, { md, processAlerts });
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider('null-markdown.editor', editorProvider, {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: true
		})
	);

	// Menus pass the file URI; from the palette fall back to the active tab (Source or Markdown Editor).
	const openWith = viewType => arg => {
		const uri = activeMarkdownUri(arg) ?? vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri;
		if (!uri) { vscode.window.showWarningMessage('Open a Markdown file first.'); return; }
		return vscode.commands.executeCommand('vscode.openWith', uri, viewType);
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('null-markdown.openPreview', openPreview),
		vscode.commands.registerCommand('null-markdown.openEditor', openWith('null-markdown.editor')),
		vscode.commands.registerCommand('null-markdown.openSource', openWith('default')),
		vscode.commands.registerCommand('null-markdown.exportPdf', exportPdf),
		vscode.commands.registerCommand('null-markdown.openSlides', openSlidesCmd)
	);

	// Intercept the built-in preview commands so the existing editor-title icon
	// opens our preview. Silently ignored on VS Code builds that forbid override.
	for (const id of ['markdown.showPreview', 'markdown.showPreviewToSide']) {
		try {
			context.subscriptions.push(vscode.commands.registerCommand(id, openPreview));
		} catch { /* keybindings provide the fallback path */ }
	}
}

module.exports = { activate };

'use strict';

const vscode = require('vscode');
const path   = require('path');
const crypto = require('crypto');

// ── markdown-it setup ─────────────────────────────────────────────────────────

function createMd() {
	const MarkdownIt = require('./node_modules/markdown-it');
	const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

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
			await this._applyCheckboxToggle(msg.line, msg.checked);
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

	async _applyCheckboxToggle(line, checked) {
		const editor = this._findEditor();
		if (!editor) return;
		const lineObj = editor.document.lineAt(line);
		const updated = checked
			? lineObj.text.replace(/^(\s*(?:[-*+]|\d+[.)]) )\[ \]/, '$1[x]')
			: lineObj.text.replace(/^(\s*(?:[-*+]|\d+[.)]) )\[[xX]\]/, '$1[ ]');
		if (updated === lineObj.text) return;
		const edit = new vscode.WorkspaceEdit();
		edit.replace(editor.document.uri, lineObj.range, updated);
		await vscode.workspace.applyEdit(edit);
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
		const wv  = this.panel.webview;
		const ext = vscode.Uri.file(this._ctx.extensionPath);
		const u   = (...p) => wv.asWebviewUri(vscode.Uri.joinPath(ext, ...p));

		const cssUri        = u('preview', 'null-markdown.css');
		const katexCssUri   = u('node_modules', 'katex', 'dist', 'katex.min.css');
		const katexJsUri    = u('node_modules', 'katex', 'dist', 'katex.min.js');
		const autoRenderUri = u('node_modules', 'katex', 'dist', 'contrib', 'auto-render.min.js');
		const mermaidUri    = u('node_modules', 'mermaid', 'dist', 'mermaid.min.js');
		const previewJsUri  = u('preview', 'preview.js');
		const nonce         = crypto.randomBytes(16).toString('hex');

		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${wv.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${wv.cspSource}; img-src ${wv.cspSource} https: data:; font-src ${wv.cspSource};">
<link rel="stylesheet" href="${katexCssUri}">
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<div id="content">${contentHtml}</div>
<script nonce="${nonce}" src="${katexJsUri}"></script>
<script nonce="${nonce}" src="${autoRenderUri}"></script>
<script nonce="${nonce}" src="${mermaidUri}"></script>
<script nonce="${nonce}" src="${previewJsUri}"></script>
</body>
</html>`;
	}
}

// ── activation ────────────────────────────────────────────────────────────────

function activate(context) {
	const md = createMd();

	function openPreview() {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'markdown') {
			vscode.window.showWarningMessage('Open a Markdown file first.');
			return;
		}
		const key = editor.document.uri.toString();
		if (openPanels.has(key)) {
			openPanels.get(key).reveal();
			return;
		}
		const preview = new NullMarkdownPreview(editor.document, context, md);
		openPanels.set(key, preview);
		preview.onDispose(() => openPanels.delete(key));
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('null-markdown.openPreview', openPreview)
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

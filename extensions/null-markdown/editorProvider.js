'use strict';

const vscode = require('vscode');
const { buildEditorPage } = require('./pages');
const { toLf, isValidChanges, toTextEdits, SyncState } = require('./syncState');
const { rewriteImageSrc } = require('./imageSrc');
const { applyCheckboxToggle, openWikiLink, openLink } = require('./docActions');

// Above this many characters the Editor hands the file back to the plain text editor: widget
// round-trips and whole-document decoration rebuilds do not scale to huge files.
const MAX_EDITOR_CHARS = 1_000_000;

const REF_DEF = /^ {0,3}\[[^\]\n]+\]:[ \t]*\S.*$/gm;

// CustomTextEditorProvider for the live-preview Markdown Editor. A thin relay: the TextDocument
// stays the source of truth.
class NullMarkdownEditorProvider {
	constructor(context, { md, processAlerts }) {
		this._ctx = context;
		this._md = md;
		this._processAlerts = processAlerts;
		// Open-time timings ("Null Markdown" in the Output panel) so a slow file can be diagnosed.
		this._log = vscode.window.createOutputChannel('Null Markdown', { log: true });
		context.subscriptions.push(this._log);
	}

	// Markdown -> HTML through the same pipeline as Preview, with relative images pointed at webview URIs.
	_html(document, webview, text) {
		// A widget holds one block, so `![x][ref]` needs the document's `[ref]: url` lines to resolve.
		const defs = document.getText().match(REF_DEF);
		const html = this._processAlerts(this._md.render(defs ? `${text}\n\n${defs.join('\n')}` : text));
		return rewriteImageSrc(html, src => {
			try { return webview.asWebviewUri(vscode.Uri.joinPath(document.uri, '..', decodeURI(src))).toString(); }
			catch { return null; }
		});
	}

	async resolveCustomTextEditor(document, panel) {
		if (document.getText().length > MAX_EDITOR_CHARS) {
			vscode.window.showInformationMessage('This file is too large for the Markdown Editor; opened as source instead.');
			await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
			panel.dispose();
			return;
		}

		const wv = panel.webview;
		const key = document.uri.toString();
		const opened = Date.now();
		const name = document.uri.path.split('/').pop();
		wv.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.file(this._ctx.extensionPath),
				vscode.Uri.joinPath(document.uri, '..'),
				...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri)
			]
		};

		const post = m => wv.postMessage(m);
		const sync = new SyncState();
		const subs = [];

		const sendDoc = () => post({ type: 'doc', text: toLf(document.getText()), version: document.version });

		wv.html = buildEditorPage(wv, this._ctx.extensionPath);

		subs.push(vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() !== key || !e.contentChanges.length) return;
			if (sync.shouldForward()) sendDoc();
		}));

		subs.push(wv.onDidReceiveMessage(async msg => {
			switch (msg?.type) {
				case 'ready':
					this._log.info(`${name}: webview ready ${Date.now() - opened} ms after open (${document.getText().length} chars)`);
					sendDoc();
					break;
				case 'perf':
					this._log.info(`${name}: first paint ${msg.sinceLoadMs} ms after webview load; initial decorations ${msg.dispatchMs} ms`);
					break;
				case 'edit': await this._applyEdit(document, sync, msg, sendDoc, post); break;
				case 'save': await document.save(); break;
				case 'renderBlock':
					if (typeof msg.text === 'string' && Number.isInteger(msg.id)) {
						const t = Date.now();
						post({ type: 'rendered', id: msg.id, html: this._html(document, wv, msg.text) });
						if (Date.now() - t > 30) this._log.info(`${name}: slow block render ${Date.now() - t} ms (${msg.text.length} chars)`);
					}
					break;
				case 'openLink': if (typeof msg.href === 'string') await openLink(document, msg.href); break;
				case 'wikiLink': if (typeof msg.target === 'string') await openWikiLink(msg.target); break;
				case 'checkboxToggle': await applyCheckboxToggle(document, msg.line, msg.checked); break;
			}
		}));

		panel.onDidDispose(() => subs.forEach(d => d.dispose()));
	}

	// Apply a webview edit as one WorkspaceEdit (one undo step), then ack; on any doubt send the full text.
	async _applyEdit(document, sync, msg, sendDoc, post) {
		const lf = toLf(document.getText());
		if (!sync.canApply(document.version, msg.baseVersion) || !isValidChanges(lf, msg.changes)) { sendDoc(); return; }

		const before = document.version;
		const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
		const edit = new vscode.WorkspaceEdit();
		for (const t of toTextEdits(lf, msg.changes, eol)) {
			edit.replace(document.uri, new vscode.Range(t.start.line, t.start.character, t.end.line, t.end.character), t.newText);
		}
		sync.applying = true;
		let ok = false;
		try { ok = await vscode.workspace.applyEdit(edit); } finally { sync.applying = false; }

		if (ok && sync.isCleanAck(before, document.version)) post({ type: 'ack', version: document.version });
		else sendDoc();
	}
}

module.exports = { NullMarkdownEditorProvider };

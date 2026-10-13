'use strict';

const vscode = require('vscode');
const { buildEditorPage } = require('./pages');
const { toLf, isValidChanges, toTextEdits, SyncState } = require('./syncState');
const { rewriteImageSrc } = require('./imageSrc');
const { applyCheckboxToggle, openWikiLink } = require('./docActions');

// Above this many characters the Editor hands the file back to the plain text editor: widget
// round-trips and whole-document decoration rebuilds do not scale to huge files.
const MAX_EDITOR_CHARS = 1_000_000;

// CustomTextEditorProvider for the live-preview Markdown Editor. A thin relay: the TextDocument
// stays the source of truth.
class NullMarkdownEditorProvider {
	constructor(context, { md, processAlerts }) {
		this._ctx = context;
		this._md = md;
		this._processAlerts = processAlerts;
	}

	// Markdown -> HTML through the same pipeline as Preview, with relative images pointed at webview URIs.
	_html(document, webview, text) {
		const html = this._processAlerts(this._md.render(text));
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
				case 'ready': sendDoc(); break;
				case 'edit': await this._applyEdit(document, sync, msg, sendDoc, post); break;
				case 'save': await document.save(); break;
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

'use strict';

const vscode = require('vscode');

// Flip `- [ ]` / `- [x]` on one line of the document (works with or without a visible text editor).
async function applyCheckboxToggle(document, line, checked) {
	if (!Number.isInteger(line) || line < 0 || line >= document.lineCount) return;
	const lineObj = document.lineAt(line);
	const updated = checked
		? lineObj.text.replace(/^(\s*(?:[-*+]|\d+[.)]) )\[ \]/, '$1[x]')
		: lineObj.text.replace(/^(\s*(?:[-*+]|\d+[.)]) )\[[xX]\]/, '$1[ ]');
	if (updated === lineObj.text) return;
	const edit = new vscode.WorkspaceEdit();
	edit.replace(document.uri, lineObj.range, updated);
	await vscode.workspace.applyEdit(edit);
}

async function openWikiLink(target) {
	const name = target.replace(/\.md$/i, '');
	const files = await vscode.workspace.findFiles(`**/${name}.md`, '**/node_modules/**', 10);
	if (files.length === 0) {
		vscode.window.showWarningMessage(`Wiki page not found: ${target}`);
		return;
	}
	let uri = files[0];
	if (files.length > 1) {
		const picks = files.map(f => ({ label: vscode.workspace.asRelativePath(f), uri: f }));
		const pick  = await vscode.window.showQuickPick(picks, { placeHolder: `Multiple matches for "${target}"` });
		if (!pick) return;
		uri = pick.uri;
	}
	await vscode.window.showTextDocument(uri, { preview: false });
}

// Open a Markdown link: web and other schemes externally, relative/absolute paths in the editor.
async function openLink(document, href) {
	if (/^[a-z][a-z0-9+.-]+:/i.test(href)) {
		await vscode.env.openExternal(vscode.Uri.parse(href));
		return;
	}
	const [rawPath] = href.split('#');
	if (!rawPath) return;
	let clean = rawPath;
	try { clean = decodeURIComponent(rawPath); } catch { /* keep the raw path */ }
	const target = /^(?:[a-z]:)?[\\/]/i.test(clean) ? vscode.Uri.file(clean) : vscode.Uri.joinPath(document.uri, '..', clean);
	await vscode.commands.executeCommand('vscode.open', target);
}

module.exports = { applyCheckboxToggle, openWikiLink, openLink };

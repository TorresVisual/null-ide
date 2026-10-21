'use strict';

const vscode = require('vscode');
const crypto = require('crypto');

// Shared webview shell for the side-by-side Preview and the Editor.
// `lazyLibs`: KaTeX and Mermaid (3+ MB) are not loaded up front; their URIs go in `window.nullLibs` and the
// page loads them the first time a block needs them.
function page(wv, extensionPath, { body, extraCss = [], scripts, lazyLibs = false }) {
	const ext = vscode.Uri.file(extensionPath);
	const u = (...p) => wv.asWebviewUri(vscode.Uri.joinPath(ext, ...p));
	const nonce = crypto.randomBytes(16).toString('hex');
	const libs = {
		katex: u('node_modules', 'katex', 'dist', 'katex.min.js'),
		autoRender: u('node_modules', 'katex', 'dist', 'contrib', 'auto-render.min.js'),
		mermaid: u('node_modules', 'mermaid', 'dist', 'mermaid.min.js')
	};
	const links = [
		u('node_modules', 'katex', 'dist', 'katex.min.css'),
		u('node_modules', 'highlight.js', 'styles', 'vs2015.min.css'),
		u('preview', 'null-markdown.css'),
		...extraCss.map(p => u(...p))
	].map(href => `<link rel="stylesheet" href="${href}">`).join('\n');
	const scriptTags = [
		...(lazyLibs ? [] : [libs.katex, libs.autoRender, libs.mermaid]),
		...scripts.map(p => u(...p))
	].map(src => `<script nonce="${nonce}" src="${src}"></script>`).join('\n');
	const libsTag = lazyLibs ? `<script nonce="${nonce}">window.nullLibs = ${JSON.stringify(libs)};</script>` : '';

	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${wv.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${wv.cspSource}; img-src ${wv.cspSource} https: data:; font-src ${wv.cspSource};">
${links}
</head>
<body>
${body}
${libsTag}
${scriptTags}
</body>
</html>`;
}

function buildPreviewPage(wv, extensionPath, contentHtml) {
	return page(wv, extensionPath, {
		body: `<div id="content">${contentHtml}</div>`,
		scripts: [['preview', 'preview.js']]
	});
}

function buildEditorPage(wv, extensionPath) {
	return page(wv, extensionPath, {
		body: '<div id="editor"></div>',
		extraCss: [['lib', 'editor.css']],
		scripts: [['lib', 'editor.js']],
		lazyLibs: true
	});
}

module.exports = { buildPreviewPage, buildEditorPage };

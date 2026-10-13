'use strict';

const vscode = require('vscode');
const crypto = require('crypto');

// TEMP diagnostic (editor tab blank): forwards webview errors to the host Output channel.
const diag = nonce => `<script nonce="${nonce}">(function(){const v=acquireVsCodeApi();window.__nullVs=v;const l=t=>v.postMessage({type:'log',text:t});l('page script ran');window.addEventListener('error',e=>l('ERROR '+e.message+' @'+(e.filename||'')+':'+e.lineno));window.addEventListener('unhandledrejection',e=>l('REJECTION '+(e.reason&&e.reason.stack||e.reason)));window.addEventListener('securitypolicyviolation',e=>l('CSP '+e.violatedDirective+' '+e.blockedURI));})();</script>`;

// Shared webview shell for the side-by-side Preview, the in-tab Preview and the Editor.
function page(wv, extensionPath, { body, extraCss = [], scripts }) {
	const ext = vscode.Uri.file(extensionPath);
	const u = (...p) => wv.asWebviewUri(vscode.Uri.joinPath(ext, ...p));
	const nonce = crypto.randomBytes(16).toString('hex');
	const links = [
		u('node_modules', 'katex', 'dist', 'katex.min.css'),
		u('node_modules', 'highlight.js', 'styles', 'vs2015.min.css'),
		u('preview', 'null-markdown.css'),
		...extraCss.map(p => u(...p))
	].map(href => `<link rel="stylesheet" href="${href}">`).join('\n');
	const scriptTags = [
		u('node_modules', 'katex', 'dist', 'katex.min.js'),
		u('node_modules', 'katex', 'dist', 'contrib', 'auto-render.min.js'),
		u('node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
		...scripts.map(p => u(...p))
	].map(src => `<script nonce="${nonce}" src="${src}"></script>`).join('\n');

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
${diag(nonce)}
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
		scripts: [['lib', 'editor.js']]
	});
}

module.exports = { buildPreviewPage, buildEditorPage };

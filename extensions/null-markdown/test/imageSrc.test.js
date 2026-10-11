'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rewriteImageSrc } = require('../imageSrc');

const resolve = src => 'vscode-webview://x/' + src;

test('relative sources are rewritten, other attributes survive', () => {
	assert.equal(
		rewriteImageSrc('<p><img src="img/a%20b.png" alt="a" title="t"></p>', resolve),
		'<p><img src="vscode-webview://x/img/a%20b.png" alt="a" title="t"></p>'
	);
	assert.equal(
		rewriteImageSrc('<img alt="a" src="a.png">', resolve),
		'<img alt="a" src="vscode-webview://x/a.png">'
	);
});

test('absolute, protocol-relative, data and drive-letter sources are left alone', () => {
	for (const src of ['https://e.com/a.png', '//e.com/a.png', 'data:image/png;base64,AAAA', 'C:/a.png', '#frag']) {
		const html = `<img src="${src}">`;
		assert.equal(rewriteImageSrc(html, resolve), html);
	}
});

test('a resolver that returns nothing keeps the original', () => {
	assert.equal(rewriteImageSrc('<img src="a.png">', () => null), '<img src="a.png">');
});

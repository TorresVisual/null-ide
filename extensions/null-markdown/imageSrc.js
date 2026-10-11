'use strict';

const IMG_SRC = /(<img\b[^>]*?\bsrc=")([^"]*)(")/gi;
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

// Point relative <img src> values at `resolve(src)` (a webview URI); absolute URLs and data: stay as they are.
function rewriteImageSrc(html, resolve) {
	return html.replace(IMG_SRC, (whole, open, src, close) => {
		if (ABSOLUTE.test(src)) return whole;
		const next = resolve(src);
		return next ? open + next + close : whole;
	});
}

module.exports = { rewriteImageSrc };

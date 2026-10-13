// Asks the host to render Markdown snippets (tables, mermaid, math, alerts, html, images) and paints
// the returned HTML into widget elements. Results are cached by source text.

const CACHE_LIMIT = 200;

function typeset(el) {
	if (typeof renderMathInElement !== 'undefined') {
		renderMathInElement(el, {
			delimiters: [
				{ left: '$$', right: '$$', display: true },
				{ left: '$', right: '$', display: false }
			],
			throwOnError: false,
			ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
		});
	}
	if (typeof mermaid !== 'undefined') {
		const nodes = el.querySelectorAll('.mermaid');
		if (nodes.length) mermaid.run({ nodes });
	}
}

export function createRenderer(post, onPainted) {
	const cache = new Map();   // source -> html
	const waiting = new Map(); // request id -> { src, el }
	let nextId = 1;

	function paint(el, html) {
		el.innerHTML = html;
		typeset(el);
		onPainted();
	}

	return {
		render(src, el) {
			if (cache.has(src)) { paint(el, cache.get(src)); return; }
			el.textContent = '…';
			const id = nextId++;
			waiting.set(id, { src, el });
			post({ type: 'renderBlock', id, text: src });
		},
		onRendered(id, html) {
			const w = waiting.get(id);
			if (!w) return;
			waiting.delete(id);
			if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
			cache.set(w.src, html);
			paint(w.el, html);
		}
	};
}

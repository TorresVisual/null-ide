// Asks the host to render Markdown snippets (tables, mermaid, math, alerts, html, images) and paints
// the returned HTML into widget elements. Results are cached by source text.

const CACHE_LIMIT = 200;

// KaTeX and Mermaid are big; the page only records their URIs (window.nullLibs) and each is loaded the
// first time a rendered block needs it.
const scripts = new Map(); // src -> Promise
function load(src) {
	if (!scripts.has(src)) {
		scripts.set(src, new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = src;
			s.onload = resolve;
			s.onerror = () => { scripts.delete(src); reject(new Error('failed to load ' + src)); };
			document.head.append(s);
		}));
	}
	return scripts.get(src);
}

let mermaidReady = false;
async function typeset(el) {
	const libs = window.nullLibs;
	if (!libs) return;
	if (el.textContent.includes('$')) {
		await load(libs.katex);
		await load(libs.autoRender);
		renderMathInElement(el, {
			delimiters: [
				{ left: '$$', right: '$$', display: true },
				{ left: '$', right: '$', display: false }
			],
			throwOnError: false,
			ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
		});
	}
	const nodes = el.querySelectorAll('.mermaid');
	if (nodes.length) {
		await load(libs.mermaid);
		if (!mermaidReady) {
			mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose', fontFamily: 'inherit' });
			mermaidReady = true;
		}
		await mermaid.run({ nodes });
	}
}

export function createRenderer(post, onPainted) {
	const cache = new Map();   // source -> html
	const waiting = new Map(); // request id -> { src, el }
	let nextId = 1;

	function paint(el, html) {
		el.innerHTML = html;
		onPainted();
		// Math and diagrams change the widget's height once typeset, so measure again.
		typeset(el).then(onPainted, e => console.error('[null-markdown]', e));
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

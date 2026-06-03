(function () {
	'use strict';

	const vscode = acquireVsCodeApi();

	// When the extension tells us to scroll we suppress the scroll event we'd
	// fire back, preventing the echo bounce loop.
	let suppressScrollOut = false;
	let suppressTimer     = null;

	function setSuppressScrollOut(ms) {
		suppressScrollOut = true;
		clearTimeout(suppressTimer);
		suppressTimer = setTimeout(() => { suppressScrollOut = false; }, ms);
	}

	// ── scroll position helpers ───────────────────────────────────────────────

	function getTopLine() {
		const els = document.querySelectorAll('[data-line]');
		for (const el of els) {
			if (el.getBoundingClientRect().top >= -10) {
				return parseInt(el.dataset.line, 10);
			}
		}
		return null;
	}

	function scrollToLine(targetLine) {
		const els = document.querySelectorAll('[data-line]');
		let best  = null;
		for (let i = 0; i < els.length; i++) {
			if (parseInt(els[i].dataset.line, 10) >= targetLine) { best = els[i]; break; }
		}
		if (!best && els.length) best = els[els.length - 1];
		if (best) best.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	// ── preview → editor scroll ───────────────────────────────────────────────

	let scrollDebounce = null;
	window.addEventListener('scroll', () => {
		if (suppressScrollOut) return;
		clearTimeout(scrollDebounce);
		scrollDebounce = setTimeout(() => {
			const line = getTopLine();
			if (line !== null) vscode.postMessage({ type: 'scroll', line });
		}, 80);
	}, { passive: true });

	// ── checkbox sync (preview → editor) ─────────────────────────────────────

	document.addEventListener('change', e => {
		const cb = e.target;
		if (!cb || cb.type !== 'checkbox' || !('checkboxLine' in cb.dataset)) return;
		const line    = parseInt(cb.dataset.checkboxLine, 10);
		const checked = cb.checked;
		// Optimistic revert — the re-render from the resulting document change
		// will restore the correct visual state.
		cb.checked = !checked;
		vscode.postMessage({ type: 'checkboxToggle', line, checked });
	});

	// ── KaTeX & Mermaid ───────────────────────────────────────────────────────

	function runKaTeX(root) {
		if (typeof renderMathInElement === 'undefined') return;
		renderMathInElement(root, {
			delimiters: [
				{ left: '$$', right: '$$', display: true },
				{ left: '$',  right: '$',  display: false }
			],
			throwOnError: false,
			ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
		});
	}

	function runMermaid() {
		if (typeof mermaid === 'undefined') return;
		mermaid.run({ querySelector: '#content .mermaid' });
	}

	// ── messages from extension ───────────────────────────────────────────────

	window.addEventListener('message', e => {
		const msg = e.data;
		if (!msg) return;

		if (msg.type === 'revealLine') {
			setSuppressScrollOut(500);
			scrollToLine(msg.line);

		} else if (msg.type === 'update') {
			const content = document.getElementById('content');
			if (!content) return;
			const savedLine = getTopLine();
			content.innerHTML = msg.html;
			runKaTeX(content);
			runMermaid();
			if (savedLine !== null) {
				// Small delay lets the DOM settle before we restore scroll position
				setTimeout(() => {
					setSuppressScrollOut(400);
					scrollToLine(savedLine);
				}, 40);
			}
		}
	});

	// ── initial render ────────────────────────────────────────────────────────

	if (typeof mermaid !== 'undefined') {
		mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose', fontFamily: 'inherit' });
	}
	runKaTeX(document.getElementById('content') || document.body);
	runMermaid();

})();

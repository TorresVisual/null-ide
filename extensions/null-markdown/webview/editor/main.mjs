import { Annotation, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { createSync, diffChange } from './sync.mjs';
import { livePreview } from './decorations.mjs';
import { createRenderer } from './renderer.mjs';
import { formatKeymap } from './format.mjs';

const vscode = acquireVsCodeApi();
const post = m => vscode.postMessage(m);

const fromHost = Annotation.define(); // marks transactions that apply a host `doc`, so they are not echoed back
const sync = createSync({ post });
const renderer = createRenderer(post, () => view.requestMeasure());

// CodeMirror's base theme sets .cm-scroller to monospace / 1.4, and out-ranks any plain stylesheet rule;
// a theme extension out-ranks the base theme.
const typography = EditorView.theme({
	'.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.65' }
});

const view = new EditorView({
	parent: document.getElementById('editor'),
	state: EditorState.create({
		doc: '',
		extensions: [
			typography,
			EditorView.lineWrapping,
			markdown({ base: markdownLanguage }),
			// No CodeMirror history: undo/redo belongs to the workbench (see the spec's undo section).
			keymap.of([...formatKeymap, ...defaultKeymap, indentWithTab]),
			livePreview(renderer),
			EditorView.updateListener.of(u => {
				if (u.docChanged && !u.transactions.some(t => t.annotation(fromHost))) sync.local(u.changes);
			}),
			EditorView.domEventHandlers({
				click(e) {
					if (!(e.ctrlKey || e.metaKey)) return false;
					const el = e.target.closest?.('[data-wiki], [data-href]');
					if (!el) return false;
					e.preventDefault();
					post(el.dataset.wiki ? { type: 'wikiLink', target: el.dataset.wiki } : { type: 'openLink', href: el.dataset.href });
					return true;
				}
			})
		]
	})
});

// Save goes through the host only after every local edit has landed, or the file would stay dirty.
document.addEventListener('keydown', e => {
	if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
		e.preventDefault();
		e.stopPropagation();
		sync.whenSynced(() => post({ type: 'save' }));
	}
}, true);
window.addEventListener('blur', () => sync.flush());

let perfSent = false;
window.addEventListener('message', e => {
	const msg = e.data;
	if (!msg) return;
	if (msg.type === 'doc') {
		sync.reset(msg.version);
		const change = diffChange(view.state.doc.toString(), msg.text);
		const t0 = performance.now();
		if (change) view.dispatch({ changes: change, annotations: fromHost.of(true) });
		if (!perfSent) {
			perfSent = true;
			// performance.now() counts from webview navigation, so it includes script download + parse.
			requestAnimationFrame(() => post({ type: 'perf', sinceLoadMs: Math.round(performance.now()), dispatchMs: Math.round(performance.now() - t0) }));
		}
	} else if (msg.type === 'ack') {
		sync.ack(msg.version);
	} else if (msg.type === 'rendered') {
		renderer.onRendered(msg.id, msg.html);
	}
});

post({ type: 'ready' });

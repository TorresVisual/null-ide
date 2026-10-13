import { Annotation, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { createSync, diffChange } from './sync.mjs';
import { livePreview } from './decorations.mjs';

const vscode = window.__nullVs ?? acquireVsCodeApi();
const post = m => vscode.postMessage(m);

const fromHost = Annotation.define(); // marks transactions that apply a host `doc`, so they are not echoed back
const sync = createSync({ post });

const view = new EditorView({
	parent: document.getElementById('editor'),
	state: EditorState.create({
		doc: '',
		extensions: [
			EditorView.lineWrapping,
			markdown({ base: markdownLanguage }),
			// No CodeMirror history: undo/redo belongs to the workbench (see the spec's undo section).
			keymap.of([...defaultKeymap, indentWithTab]),
			livePreview(null), // block widgets get their renderer in a later task
			EditorView.updateListener.of(u => {
				if (u.docChanged && !u.transactions.some(t => t.annotation(fromHost))) sync.local(u.changes);
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

window.addEventListener('message', e => {
	const msg = e.data;
	if (!msg) return;
	if (msg.type === 'doc') {
		sync.reset(msg.version);
		const change = diffChange(view.state.doc.toString(), msg.text);
		if (change) view.dispatch({ changes: change, annotations: fromHost.of(true) });
	} else if (msg.type === 'ack') {
		sync.ack(msg.version);
	}
});

post({ type: 'log', text: 'editor.js started' });
post({ type: 'ready' });

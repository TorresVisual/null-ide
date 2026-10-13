import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { toggleWrap, insertLink } from '../webview/editor/format.mjs';

function run(command, doc, from, to = from) {
	let state = EditorState.create({ doc, selection: EditorSelection.single(from, to) });
	command({ state, dispatch: tr => { state = tr.state; } });
	return { text: state.doc.toString(), sel: [state.selection.main.from, state.selection.main.to] };
}

test('bold wraps the selection and keeps it selected', () => {
	assert.deepEqual(run(toggleWrap('**'), 'a hello b', 2, 7), { text: 'a **hello** b', sel: [4, 9] });
});

test('bold unwraps an already wrapped selection', () => {
	assert.deepEqual(run(toggleWrap('**'), 'a **hello** b', 4, 9), { text: 'a hello b', sel: [2, 7] });
});

test('bold with an empty selection inserts a pair and puts the caret between', () => {
	assert.deepEqual(run(toggleWrap('**'), 'ab', 1), { text: 'a****b', sel: [3, 3] });
});

test('italic uses a single marker', () => {
	assert.deepEqual(run(toggleWrap('*'), 'x', 0, 1), { text: '*x*', sel: [1, 2] });
});

test('link wraps the selection and selects the url placeholder', () => {
	const r = run(insertLink, 'see docs now', 4, 8);
	assert.equal(r.text, 'see [docs](url) now');
	assert.equal(r.text.slice(r.sel[0], r.sel[1]), 'url');
});

test('link with an empty selection', () => {
	const r = run(insertLink, '', 0);
	assert.equal(r.text, '[](url)');
	assert.equal(r.text.slice(r.sel[0], r.sel[1]), 'url');
});

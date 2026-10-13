import { Decoration, EditorView } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { computeSpecs } from './specs.mjs';
import { BulletWidget, CheckboxWidget, HrWidget, RenderedWidget } from './widgets.mjs';

function toRange(s, state, renderer) {
	switch (s.type) {
		case 'hide': return Decoration.replace({}).range(s.from, s.to);
		case 'mark': return Decoration.mark({ class: s.cls, attributes: s.attrs }).range(s.from, s.to);
		case 'line': return Decoration.line({ class: s.cls }).range(s.from);
		case 'bullet': return Decoration.replace({ widget: new BulletWidget() }).range(s.from, s.to);
		case 'task': return Decoration.replace({ widget: new CheckboxWidget(s.checked) }).range(s.from, s.to);
		case 'hr': return Decoration.replace({ widget: new HrWidget() }).range(s.from, s.to);
		default: return renderer
			? Decoration.replace({
				widget: new RenderedWidget(state.sliceDoc(s.from, s.to), renderer, s.kind === 'inline'),
				block: s.kind === 'block'
			}).range(s.from, s.to)
			: null;
	}
}

// ponytail: rebuilds the whole document's decorations on every doc or selection change. Fine under
// the editor's size cap; viewport-limited iteration is the upgrade if big files feel slow.
function build(state, renderer) {
	const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
	const specs = computeSpecs(tree, state.doc, state.selection.ranges);
	return Decoration.set(specs.map(s => toRange(s, state, renderer)).filter(Boolean), true);
}

export function livePreview(renderer) {
	return StateField.define({
		create: state => build(state, renderer),
		update: (value, tr) => (tr.docChanged || tr.selection ? build(tr.state, renderer) : value),
		provide: f => EditorView.decorations.from(f)
	});
}

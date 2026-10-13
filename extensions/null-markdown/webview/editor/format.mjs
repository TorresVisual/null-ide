import { EditorSelection } from '@codemirror/state';

// Ctrl+B / Ctrl+I: wrap the selection in `marker`, or unwrap when it is already wrapped.
export function toggleWrap(marker) {
	return ({ state, dispatch }) => {
		const n = marker.length;
		dispatch(state.update(state.changeByRange(range => {
			const { from, to } = range;
			if (state.sliceDoc(Math.max(0, from - n), from) === marker && state.sliceDoc(to, to + n) === marker) {
				return {
					changes: [{ from: from - n, to: from }, { from: to, to: to + n }],
					range: EditorSelection.range(from - n, to - n)
				};
			}
			return {
				changes: [{ from, insert: marker }, { from: to, insert: marker }],
				range: EditorSelection.range(from + n, to + n)
			};
		}), { userEvent: 'input.format' }));
		return true;
	};
}

// Ctrl+K: turn the selection into [text](url) and select the url placeholder.
export function insertLink({ state, dispatch }) {
	dispatch(state.update(state.changeByRange(range => {
		const text = state.sliceDoc(range.from, range.to);
		const urlFrom = range.from + text.length + 3;
		return {
			changes: { from: range.from, to: range.to, insert: `[${text}](url)` },
			range: EditorSelection.range(urlFrom, urlFrom + 3)
		};
	}), { userEvent: 'input.format' }));
	return true;
}

export const formatKeymap = [
	{ key: 'Mod-b', run: toggleWrap('**'), preventDefault: true, stopPropagation: true },
	{ key: 'Mod-i', run: toggleWrap('*'), preventDefault: true, stopPropagation: true },
	{ key: 'Mod-k', run: insertLink, preventDefault: true, stopPropagation: true }
];

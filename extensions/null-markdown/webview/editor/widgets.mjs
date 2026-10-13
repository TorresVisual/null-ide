import { WidgetType } from '@codemirror/view';

export class BulletWidget extends WidgetType {
	eq() { return true; }
	toDOM() {
		const s = document.createElement('span');
		s.className = 'cm-bullet';
		s.textContent = '•';
		return s;
	}
}

export class HrWidget extends WidgetType {
	eq() { return true; }
	toDOM() {
		const s = document.createElement('span');
		s.className = 'cm-hr';
		return s;
	}
}

// Replaces `[ ]` / `[x]`; a click flips the single character between the brackets.
export class CheckboxWidget extends WidgetType {
	constructor(checked) { super(); this.checked = checked; }
	eq(other) { return other.checked === this.checked; }
	toDOM(view) {
		const cb = document.createElement('input');
		cb.type = 'checkbox';
		cb.className = 'cm-task';
		cb.checked = this.checked;
		cb.addEventListener('mousedown', e => {
			e.preventDefault();
			const pos = view.posAtDOM(cb);
			const marker = view.state.sliceDoc(pos, pos + 3);
			view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: /x/i.test(marker) ? ' ' : 'x' } });
		});
		return cb;
	}
	ignoreEvent() { return true; }
}

// A block (table, mermaid, math, alert, html) or inline (image) rendered by the host's markdown-it.
export class RenderedWidget extends WidgetType {
	constructor(src, renderer, inline) { super(); this.src = src; this.renderer = renderer; this.inline = inline; }
	eq(other) { return other.src === this.src && other.inline === this.inline; }
	toDOM() {
		const el = document.createElement(this.inline ? 'span' : 'div');
		el.className = this.inline ? 'cm-rendered cm-rendered-inline' : 'cm-rendered';
		this.renderer.render(this.src, el);
		return el;
	}
	// Let the editor handle clicks: they land the caret at the widget's edge, which reveals the source.
	ignoreEvent() { return false; }
}

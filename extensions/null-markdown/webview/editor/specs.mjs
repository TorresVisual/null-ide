import { touches } from './reveal.mjs';

// Pure decoration plan for the live-preview editor: syntax tree + doc + selection in,
// plain {type, from, to, ...} specs out. decorations.mjs turns them into CM6 decorations.

const INLINE = {
	Emphasis: ['EmphasisMark', 'cm-em'],
	StrongEmphasis: ['EmphasisMark', 'cm-strong'],
	Strikethrough: ['StrikethroughMark', 'cm-strike'],
	InlineCode: ['CodeMark', 'cm-code']
};
const ALERT = /^>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
const FENCE = /^\s*(?:```|~~~)/;

function frontMatterEnd(doc) {
	if (doc.lines < 3 || doc.line(1).text.trimEnd() !== '---') return 0;
	for (let n = 2; n <= doc.lines; n++) if (doc.line(n).text.trimEnd() === '---') return doc.line(n).to;
	return 0;
}

export function computeSpecs(tree, doc, ranges) {
	const specs = [];
	const codeRanges = [];
	const fmTo = frontMatterEnd(doc);

	const onLine = pos => { const l = doc.lineAt(pos); return touches(l.from, l.to, ranges); };
	const hide = (from, to) => { if (from < to) specs.push({ type: 'hide', from, to }); };
	const mark = (from, to, cls, attrs) => { if (from < to) specs.push({ type: 'mark', from, to, cls, attrs }); };
	const afterSpace = pos => (doc.sliceString(pos, pos + 1) === ' ' ? pos + 1 : pos);
	const lines = (from, to, cls, target = specs) => {
		for (let n = doc.lineAt(from).number, end = doc.lineAt(to).number; n <= end; n++) {
			target.push({ type: 'line', from: doc.line(n).from, cls });
		}
	};
	// Replace [from, to] with a rendered widget; show the raw source while the selection is inside.
	const block = (from, to, kind, target = specs) => {
		if (touches(from, to, ranges)) lines(from, to, 'cm-raw-block', target);
		else target.push({ type: 'widget', kind, from, to });
	};

	if (fmTo) lines(0, fmTo, 'cm-frontmatter');

	tree.iterate({
		enter(n) {
			const name = n.name;
			if (name !== 'Document' && n.from < fmTo) return false;

			let m = /^ATXHeading([1-6])$/.exec(name);
			if (m) {
				lines(n.from, n.from, 'cm-h' + m[1]);
				const hm = n.node.getChild('HeaderMark');
				if (hm && !onLine(n.from)) hide(hm.from, afterSpace(hm.to));
				return;
			}
			m = /^SetextHeading([12])$/.exec(name);
			if (m) { lines(n.from, n.from, 'cm-h' + m[1]); return; }

			if (INLINE[name]) {
				const [markName, cls] = INLINE[name];
				if (name === 'InlineCode') codeRanges.push([n.from, n.to]);
				mark(n.from, n.to, cls);
				if (!touches(n.from, n.to, ranges)) for (const c of n.node.getChildren(markName)) hide(c.from, c.to);
				return;
			}

			if (name === 'Link') {
				const marks = n.node.getChildren('LinkMark');
				if (marks.length >= 2) {
					const url = n.node.getChild('URL');
					mark(marks[0].to, marks[1].from, 'cm-link', url ? { 'data-href': doc.sliceString(url.from, url.to) } : undefined);
					if (!touches(n.from, n.to, ranges)) { hide(marks[0].from, marks[0].to); hide(marks[1].from, n.to); }
				}
				return;
			}

			if (name === 'Image') { block(n.from, n.to, 'inline'); return false; }

			if (name === 'Blockquote') {
				if (ALERT.test(doc.lineAt(n.from).text)) { block(n.from, n.to, 'block'); return false; }
				lines(n.from, n.to, 'cm-quote');
				return;
			}
			if (name === 'QuoteMark') { if (!onLine(n.from)) hide(n.from, afterSpace(n.to)); return; }

			if (name === 'ListItem') { lines(n.from, n.from, 'cm-li'); return; }
			if (name === 'ListMark') {
				const item = n.node.parent;
				if (onLine(n.from)) return;
				if (item?.getChild('Task')) hide(n.from, afterSpace(n.to));
				else if (item?.parent?.name === 'BulletList') specs.push({ type: 'bullet', from: n.from, to: n.to });
				return;
			}
			if (name === 'TaskMarker') {
				if (!onLine(n.from)) specs.push({ type: 'task', from: n.from, to: n.to, checked: /\[[xX]\]/.test(doc.sliceString(n.from, n.to)) });
				return;
			}
			if (name === 'HorizontalRule') { if (!onLine(n.from)) specs.push({ type: 'hr', from: n.from, to: n.to }); return; }

			if (name === 'FencedCode') {
				codeRanges.push([n.from, n.to]);
				const info = n.node.getChild('CodeInfo');
				if (info && doc.sliceString(info.from, info.to).trim() === 'mermaid') { block(n.from, n.to, 'block'); return false; }
				lines(n.from, n.to, 'cm-codeblock');
				lines(n.from, n.from, 'cm-fence');
				const last = doc.lineAt(n.to);
				if (last.number > doc.lineAt(n.from).number && FENCE.test(last.text)) lines(n.to, n.to, 'cm-fence');
				return false;
			}
			if (name === 'CodeBlock') { codeRanges.push([n.from, n.to]); lines(n.from, n.to, 'cm-codeblock'); return false; }

			if (name === 'Table' || name === 'HTMLBlock') { block(n.from, n.to, 'block'); return false; }
		}
	});

	// Text-level syntax the Markdown grammar doesn't know: $$ math blocks and [[wiki links]].
	const extra = [];
	const claimed = [];
	const inCode = pos => codeRanges.some(([a, b]) => pos >= a && pos <= b);

	let open = null;
	for (let i = 1; i <= doc.lines; i++) {
		const line = doc.line(i);
		if (line.from < fmTo || inCode(line.from) || line.text.trim() !== '$$') continue;
		if (!open) { open = line; continue; }
		block(open.from, line.to, 'block', extra);
		claimed.push([open.from, line.to]);
		open = null;
	}

	for (let i = 1; i <= doc.lines; i++) {
		const line = doc.line(i);
		if (line.from < fmTo || inCode(line.from)) continue;
		for (const m of line.text.matchAll(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g)) {
			const from = line.from + m.index;
			const to = from + m[0].length;
			if (inCode(from) || claimed.some(([a, b]) => from >= a && to <= b)) continue;
			claimed.push([from, to]);
			extra.push({ type: 'mark', from, to, cls: 'cm-wikilink', attrs: { 'data-wiki': m[1].trim() } });
			if (!touches(from, to, ranges)) {
				extra.push({ type: 'hide', from, to: m[2] ? from + 3 + m[1].length : from + 2 });
				extra.push({ type: 'hide', from: to - 2, to });
			}
		}
	}

	const inside = s => claimed.some(([a, b]) => s.from >= a && s.to <= b);
	return specs.filter(s => s.type === 'line' || !inside(s)).concat(extra);
}

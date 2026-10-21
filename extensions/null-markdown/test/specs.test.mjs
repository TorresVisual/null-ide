import test from 'node:test';
import assert from 'node:assert/strict';
import { parser, GFM } from '@lezer/markdown';
import { Text } from '@codemirror/state';
import { computeSpecs } from '../webview/editor/specs.mjs';

const md = parser.configure(GFM);
function plan(text, caret = -1) {
	const doc = Text.of(text.split('\n'));
	const at = caret < 0 ? text.length + 5 : caret; // default: caret far away
	return computeSpecs(md.parse(text), doc, [{ from: at, to: at }]);
}
const hidden = (specs, text) => specs.filter(s => s.type === 'hide').map(s => text.slice(s.from, s.to));

test('heading marker hides until the caret is on its line', () => {
	const t = '# Title\n\nbody';
	assert.deepEqual(hidden(plan(t, 12), t), ['# ']);
	assert.deepEqual(hidden(plan(t, 3), t), []);
	assert.ok(plan(t, 12).some(s => s.type === 'line' && s.cls === 'cm-h1' && s.from === 0));
});

test('inline marks hide unless the caret is inside or adjacent', () => {
	const t = 'a **b** c';
	assert.deepEqual(hidden(plan(t, 0), t), ['**', '**']);
	assert.deepEqual(hidden(plan(t, 4), t), []);
	assert.deepEqual(hidden(plan(t, 7), t), []); // adjacent counts
	assert.ok(plan(t, 0).some(s => s.type === 'mark' && s.cls === 'cm-strong' && s.from === 2 && s.to === 7));
});

test('link keeps its text and carries the href', () => {
	const t = 'x [a](http://u "t") y';
	const s = plan(t, 0);
	assert.deepEqual(hidden(s, t), ['[', '](http://u "t")']);
	const link = s.find(x => x.cls === 'cm-link');
	assert.equal(t.slice(link.from, link.to), 'a');
	assert.equal(link.attrs['data-href'], 'http://u');
});

test('blockquote marker, bullets, tasks and rules', () => {
	const t = '> q\n\n- a\n\n- [x] t\n\n---';
	const s = plan(t, t.length);
	assert.ok(s.some(x => x.type === 'line' && x.cls === 'cm-quote'));
	assert.deepEqual(hidden(s, t).filter(h => h !== '> '), ['- ']); // task item hides its bullet
	assert.equal(s.filter(x => x.type === 'bullet').length, 1);
	assert.deepEqual(s.filter(x => x.type === 'task').map(x => x.checked), [true]);
	assert.equal(s.filter(x => x.type === 'hr').length, 0); // caret on the rule's line shows it raw
	assert.equal(plan(t, 0).filter(x => x.type === 'hr').length, 1);
});

test('each list item gets a hanging-indent line class on its first line only', () => {
	const t = '- a\n  more\n- b\n  - c\n\n1. d';
	const lis = plan(t, t.length + 1).filter(x => x.cls === 'cm-li').map(x => x.from);
	assert.deepEqual(lis, [0, 11, 15, 22]); // a, b, c, d
});

test('table, html, alert, mermaid and image become widgets; raw while touched', () => {
	const t = '| a | b |\n|---|---|\n| 1 | 2 |\n\n<div>x</div>\n\n> [!NOTE]\n> hi\n\n```mermaid\ngraph TD\n```\n\n![i](u.png)';
	const w = plan(t, t.length + 1).filter(x => x.type === 'widget');
	assert.deepEqual(w.map(x => x.kind), ['block', 'block', 'block', 'block', 'inline']);
	assert.equal(plan(t, 3).filter(x => x.type === 'widget').length, 4);
	assert.ok(plan(t, 3).some(x => x.type === 'line' && x.cls === 'cm-raw-block'));
});

test('fenced code stays editable with dimmed fences', () => {
	const t = '```js\nlet a = 1;\n```';
	const s = plan(t, 8);
	assert.equal(s.filter(x => x.cls === 'cm-codeblock').length, 3);
	assert.equal(s.filter(x => x.cls === 'cm-fence').length, 2);
	assert.equal(s.filter(x => x.type === 'widget').length, 0);
});

test('$$ math block is one widget and swallows inner emphasis', () => {
	const t = 'a\n\n$$\na_b_c\n$$\n\nz';
	const s = plan(t, 0);
	const w = s.filter(x => x.type === 'widget');
	assert.equal(w.length, 1);
	assert.equal(t.slice(w[0].from, w[0].to), '$$\na_b_c\n$$');
	assert.equal(s.filter(x => x.type === 'hide').length, 0);
});

test('$$ inside a code fence is ignored', () => {
	const t = '```\n$$\nx\n$$\n```';
	assert.equal(plan(t, 7).filter(x => x.type === 'widget').length, 0);
});

test('wiki links hide their brackets and target prefix', () => {
	const t = 'see [[Page|label]] and [[Other]] now';
	const s = plan(t, 0);
	assert.deepEqual(hidden(s, t), ['[[Page|', ']]', '[[', ']]']);
	assert.deepEqual(s.filter(x => x.cls === 'cm-wikilink').map(x => x.attrs['data-wiki']), ['Page', 'Other']);
	assert.deepEqual(hidden(plan(t, 8), t), ['[[', ']]']); // caret inside the first one reveals only it
});

test('front matter is dimmed raw and not parsed as markdown', () => {
	const t = '---\ntitle: x\n---\n\n# H';
	const s = plan(t, 19);
	assert.equal(s.filter(x => x.cls === 'cm-frontmatter').length, 3);
	assert.equal(s.filter(x => x.type === 'hr').length, 0);
});

test('empty document and a lone marker produce no decorations or errors', () => {
	assert.deepEqual(plan('', 0), []);
	assert.deepEqual(plan('#', 0).filter(x => x.type === 'hide'), []);
});

test('an unclosed fence only dims its opening line', () => {
	const t = 'intro\n\n```js\nlet a;';
	const s = plan(t, 0);
	assert.equal(s.filter(x => x.cls === 'cm-fence').length, 1);
	assert.equal(s.filter(x => x.cls === 'cm-codeblock').length, 2);
});

test('wiki links inside code are left alone', () => {
	const t = 'use `[[x]]` here\n\n```\n[[y]]\n```';
	assert.equal(plan(t, 0).filter(x => x.cls === 'cm-wikilink').length, 0);
});

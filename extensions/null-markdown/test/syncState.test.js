'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toLf, positionAt, isValidChanges, toTextEdits, SyncState } = require('../syncState');

test('toLf normalises CRLF and lone CR', () => {
	assert.equal(toLf('a\r\nb\rc\nd'), 'a\nb\nc\nd');
});

test('positionAt maps LF offsets to line/character', () => {
	const t = 'ab\ncde\n\nf';
	assert.deepEqual(positionAt(t, 0), { line: 0, character: 0 });
	assert.deepEqual(positionAt(t, 2), { line: 0, character: 2 });
	assert.deepEqual(positionAt(t, 3), { line: 1, character: 0 });
	assert.deepEqual(positionAt(t, 5), { line: 1, character: 2 });
	assert.deepEqual(positionAt(t, 7), { line: 2, character: 0 });
	assert.deepEqual(positionAt(t, 9), { line: 3, character: 1 });
});

test('toTextEdits uses original coordinates and converts inserted EOLs', () => {
	const t = 'ab\ncd';
	const edits = toTextEdits(t, [{ from: 1, to: 4, insert: 'X\nY' }, { from: 5, to: 5, insert: '!' }], '\r\n');
	assert.deepEqual(edits, [
		{ start: { line: 0, character: 1 }, end: { line: 1, character: 1 }, newText: 'X\r\nY' },
		{ start: { line: 1, character: 2 }, end: { line: 1, character: 2 }, newText: '!' }
	]);
});

test('isValidChanges rejects bad shapes and out-of-range offsets', () => {
	const t = 'abc';
	assert.ok(isValidChanges(t, [{ from: 0, to: 3, insert: '' }]));
	assert.ok(!isValidChanges(t, [{ from: 2, to: 1, insert: '' }]));
	assert.ok(!isValidChanges(t, [{ from: 0, to: 4, insert: '' }]));
	assert.ok(!isValidChanges(t, [{ from: 0.5, to: 1, insert: '' }]));
	assert.ok(!isValidChanges(t, [{ from: 0, to: 1, insert: 3 }]));
	assert.ok(!isValidChanges(t, 'x'));
});

test('SyncState decisions', () => {
	const s = new SyncState();
	assert.ok(s.canApply(4, 4));
	assert.ok(!s.canApply(5, 4));
	assert.ok(s.shouldForward());
	s.applying = true;
	assert.ok(!s.shouldForward());
	assert.ok(s.isCleanAck(4, 5));
	assert.ok(!s.isCleanAck(4, 6));
	assert.ok(!s.isCleanAck(4, 4));
});

test('offsets and characters are UTF-16 units, so emoji line up with the document', () => {
	const t = 'a😀b\nc';
	assert.deepEqual(positionAt(t, 3), { line: 0, character: 3 }); // 😀 is two units
	assert.deepEqual(positionAt(t, 5), { line: 1, character: 0 });
	assert.deepEqual(toTextEdits(t, [{ from: 3, to: 4, insert: '' }], '\n')[0].start, { line: 0, character: 3 });
});

test('CRLF documents: LF offsets map to the same line/character', () => {
	const doc = 'ab\r\ncd\r\nef';
	const lf = toLf(doc);
	assert.deepEqual(positionAt(lf, 4), { line: 1, character: 1 });
	assert.equal(doc.split('\r\n')[1][1], 'd');
});

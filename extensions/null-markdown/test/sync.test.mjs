import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeSet } from '@codemirror/state';
import { createSync, diffChange } from '../webview/editor/sync.mjs';

function harness() {
	const sent = [];
	let pending = null;
	const sync = createSync({
		post: m => sent.push(m),
		setTimer: fn => { pending = fn; return 1; },
		clearTimer: () => { pending = null; }
	});
	return { sync, sent, fire: () => { const f = pending; pending = null; f?.(); } };
}
const ins = (len, at, text) => ChangeSet.of({ from: at, insert: text }, len);

test('diffChange finds the minimal single change', () => {
	assert.equal(diffChange('abc', 'abc'), null);
	assert.deepEqual(diffChange('abcd', 'abXcd'), { from: 2, to: 2, insert: 'X' });
	assert.deepEqual(diffChange('abcd', 'ad'), { from: 1, to: 3, insert: '' });
	assert.deepEqual(diffChange('', 'hi'), { from: 0, to: 0, insert: 'hi' });
	assert.deepEqual(diffChange('aaa', 'aa'), { from: 2, to: 3, insert: '' });
});

test('a typing burst becomes one edit with composed changes', () => {
	const { sync, sent, fire } = harness();
	sync.reset(5);
	sync.local(ins(0, 0, 'a'));
	sync.local(ins(1, 1, 'b'));
	assert.equal(sent.length, 0);
	fire();
	assert.deepEqual(sent, [{ type: 'edit', baseVersion: 5, changes: [{ from: 0, to: 0, insert: 'ab' }] }]);
});

test('only one edit is in flight; the next goes out after the ack with the new base', () => {
	const { sync, sent, fire } = harness();
	sync.reset(1);
	sync.local(ins(0, 0, 'a'));
	fire();
	sync.local(ins(1, 1, 'b'));
	fire();
	assert.equal(sent.length, 1);
	sync.ack(2);
	fire();
	assert.equal(sent.length, 2);
	assert.equal(sent[1].baseVersion, 2);
	assert.deepEqual(sent[1].changes, [{ from: 1, to: 1, insert: 'b' }]);
});

test('reset drops pending local edits', () => {
	const { sync, sent, fire } = harness();
	sync.reset(1);
	sync.local(ins(0, 0, 'a'));
	sync.reset(2);
	fire();
	assert.equal(sent.length, 0);
});

test('whenSynced flushes immediately and waits for the ack', () => {
	const { sync, sent } = harness();
	sync.reset(1);
	sync.local(ins(0, 0, 'a'));
	let done = 0;
	sync.whenSynced(() => done++);
	assert.equal(sent.length, 1);
	assert.equal(done, 0);
	sync.ack(2);
	assert.equal(done, 1);
});

test('whenSynced with nothing pending runs at once', () => {
	const { sync } = harness();
	sync.reset(1);
	let done = 0;
	sync.whenSynced(() => done++);
	assert.equal(done, 1);
});

test('diffChange handles emoji and repeated text', () => {
	assert.deepEqual(diffChange('a😀b', 'a😀😀b'), { from: 3, to: 3, insert: '😀' });
	assert.deepEqual(diffChange('x\ny\nz', 'x\nz'), { from: 2, to: 4, insert: '' });
});

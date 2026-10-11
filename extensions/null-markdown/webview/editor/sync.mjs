// Webview side of the document sync. The host TextDocument is the source of truth: local edits are
// batched (one undo step per burst), sent one at a time with the host version they are based on, and
// any `doc` message from the host replaces local state (reset). See docs/specs/null-markdown-editor-design.md.

// Smallest single change turning `a` into `b`, or null when equal.
export function diffChange(a, b) {
	const max = Math.min(a.length, b.length);
	let start = 0;
	while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) { endA--; endB--; }
	return start === endA && start === endB ? null : { from: start, to: endA, insert: b.slice(start, endB) };
}

export function createSync({ post, delay = 300, setTimer = setTimeout, clearTimer = clearTimeout }) {
	let base = null;      // host document version the mirror is based on
	let unsent = null;    // ChangeSet composed since the last send
	let inflight = false;
	let timer = null;
	let waiters = [];

	const idle = () => !inflight && !unsent;
	const settle = () => {
		if (!idle()) return;
		const ready = waiters;
		waiters = [];
		ready.forEach(cb => cb());
	};
	function flush() {
		clearTimer(timer);
		timer = null;
		if (inflight || !unsent || base === null) return;
		const changes = [];
		unsent.iterChanges((fromA, toA, _fromB, _toB, inserted) => changes.push({ from: fromA, to: toA, insert: inserted.toString() }));
		post({ type: 'edit', baseVersion: base, changes });
		unsent = null;
		inflight = true;
	}
	function schedule() {
		if (!timer && !inflight && unsent) timer = setTimer(flush, delay);
	}

	return {
		// A user-originated ChangeSet (not one that applied a host `doc`).
		local(changes) {
			unsent = unsent ? unsent.compose(changes) : changes;
			schedule();
		},
		flush,
		// The host applied our edit and is now at `version`.
		ack(version) {
			base = version;
			inflight = false;
			if (waiters.length) flush(); else schedule();
			settle();
		},
		// The host sent its full text at `version`: whatever we had pending lost the race.
		reset(version) {
			base = version;
			inflight = false;
			unsent = null;
			clearTimer(timer);
			timer = null;
			settle();
		},
		// Run cb once every local edit has reached the host (used before save).
		whenSynced(cb) {
			flush();
			if (idle()) cb(); else waiters.push(cb);
		}
	};
}

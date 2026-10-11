'use strict';

// Host side of the Markdown Editor sync (pure, no vscode import).
// The webview mirrors the document with LF line endings; offsets it sends are in that text.

const toLf = text => text.replace(/\r\n?/g, '\n');

function positionAt(lf, offset) {
	let line = 0;
	let lineStart = 0;
	for (let i = lf.indexOf('\n'); i !== -1 && i < offset; i = lf.indexOf('\n', i + 1)) {
		line++;
		lineStart = i + 1;
	}
	return { line, character: offset - lineStart };
}

function isValidChanges(lf, changes) {
	return Array.isArray(changes) && changes.every(c =>
		c && Number.isInteger(c.from) && Number.isInteger(c.to) && typeof c.insert === 'string'
		&& c.from >= 0 && c.from <= c.to && c.to <= lf.length);
}

// {from, to, insert}[] in LF-text offsets (all against the same pre-edit text) -> position-based edits.
function toTextEdits(lf, changes, eol) {
	return changes.map(c => ({
		start: positionAt(lf, c.from),
		end: positionAt(lf, c.to),
		newText: c.insert.replace(/\n/g, eol)
	}));
}

class SyncState {
	constructor() { this.applying = false; }
	// A webview edit is only valid against the exact version it was made on.
	canApply(docVersion, baseVersion) { return docVersion === baseVersion; }
	// Document changes caused by our own applyEdit are not echoed back.
	shouldForward() { return !this.applying; }
	// One applyEdit bumps the version once; anything else means someone else edited too.
	isCleanAck(before, after) { return after === before + 1; }
}

module.exports = { toLf, positionAt, isValidChanges, toTextEdits, SyncState };

'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Webview bundles are plain scripts (module: none), so load the compiled shared files into a
// sandbox and read their top-level functions off it. Built by `tsc -p tsconfig.webview-shared.json`.
const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);
const shared = sandbox as unknown as {
  relativeTime(iso: string, now?: number): string;
  rgbToHsl(r: number, g: number, b: number): [number, number, number];
  labelStyleVars(hex: string): string;
  issueStateKind(state: string, stateReason?: string | null): string;
  octicon(name: string, className?: string): string;
};

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

test('relativeTime: seconds, minutes, hours', () => {
  assert.strictEqual(shared.relativeTime('2026-09-28T11:59:30Z', NOW), 'just now');
  assert.strictEqual(shared.relativeTime('2026-09-28T11:59:00Z', NOW), '1 minute ago');
  assert.strictEqual(shared.relativeTime('2026-09-28T11:15:00Z', NOW), '45 minutes ago');
  assert.strictEqual(shared.relativeTime('2026-09-28T09:00:00Z', NOW), '3 hours ago');
});

test('relativeTime: a future timestamp (clock skew) reads "just now"', () => {
  assert.strictEqual(shared.relativeTime('2026-09-28T12:05:00Z', NOW), 'just now');
});

test('relativeTime: days, then absolute dates', () => {
  assert.strictEqual(shared.relativeTime('2026-09-27T10:00:00Z', NOW), 'yesterday');
  assert.strictEqual(shared.relativeTime('2026-09-16T12:00:00Z', NOW), '12 days ago');
  assert.strictEqual(shared.relativeTime('2026-08-01T12:00:00Z', NOW), 'on Aug 1');
  assert.strictEqual(shared.relativeTime('2025-03-03T12:00:00Z', NOW), 'on Mar 3, 2025');
});

test('rgbToHsl matches known GitHub label colors', () => {
  // Arrays from the vm realm have a different Array.prototype; copy before deep-comparing.
  assert.deepStrictEqual(Array.from(shared.rgbToHsl(215, 58, 74)), [354, 66, 54]);   // d73a4a "bug"
  assert.deepStrictEqual(Array.from(shared.rgbToHsl(0, 117, 202)), [205, 100, 40]);  // 0075ca "documentation"
  assert.deepStrictEqual(Array.from(shared.rgbToHsl(162, 238, 239)), [181, 71, 79]); // a2eeef "enhancement"
  assert.deepStrictEqual(Array.from(shared.rgbToHsl(255, 255, 255)), [0, 0, 100]);
  assert.deepStrictEqual(Array.from(shared.rgbToHsl(0, 0, 0)), [0, 0, 0]);
});

test('labelStyleVars emits the custom properties the .gh-label CSS computes from', () => {
  const expected = '--label-r:215;--label-g:58;--label-b:74;--label-h:354;--label-s:66;--label-l:54';
  assert.strictEqual(shared.labelStyleVars('d73a4a'), expected);
  assert.strictEqual(shared.labelStyleVars('#d73a4a'), expected);
});

test('issueStateKind maps REST and GraphQL state + reason', () => {
  assert.strictEqual(shared.issueStateKind('open', null), 'open');
  assert.strictEqual(shared.issueStateKind('OPEN', 'REOPENED'), 'open');
  assert.strictEqual(shared.issueStateKind('closed', 'completed'), 'completed');
  assert.strictEqual(shared.issueStateKind('closed', null), 'completed');
  assert.strictEqual(shared.issueStateKind('closed', 'not_planned'), 'not-planned');
  assert.strictEqual(shared.issueStateKind('CLOSED', 'NOT_PLANNED'), 'not-planned');
});

test('octicon renders a generated path and tolerates unknown names', () => {
  assert.match(shared.octicon('issue-opened', 'x'), /^<svg class="octicon x" [^>]*><path d="/);
  assert.match(shared.octicon('no-such-icon'), /<svg[^>]*><\/svg>/);
});

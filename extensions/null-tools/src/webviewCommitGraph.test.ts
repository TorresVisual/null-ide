'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Built by `tsc -p tsconfig.webview-shared.json`; top-level functions of the plain-script webview files land on the sandbox.
const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);
const model = sandbox as unknown as {
  graphRowHeight(): number;
  graphLaneColumn(lane: number): number;
  graphHiddenLanes(laneCount: number): number;
  graphLaneColorVar(color: number): string;
  graphVisibleRange(scrollTop: number, viewportHeight: number, rowCount: number): { start: number; end: number };
  graphMoveSelection(index: number, key: string, pageRows: number, count: number): number;
  graphScrollToReveal(scrollTop: number, viewportHeight: number, index: number): number;
  graphAnchorAfterReset(anchorSha: string | null, offset: number, rows: Array<{ sha: string }>): number | null;
  graphNeedsMore(scrollTop: number, viewportHeight: number, rowCount: number, hasMore: boolean): boolean;
};

test('rows are 24 px tall', () => {
  assert.strictEqual(model.graphRowHeight(), 24);
});

test('graphVisibleRange renders the visible rows plus 20 on each side, clamped to the list', () => {
  assert.deepStrictEqual({ ...model.graphVisibleRange(0, 240, 1000) }, { start: 0, end: 30 });
  assert.deepStrictEqual({ ...model.graphVisibleRange(2400, 240, 1000) }, { start: 80, end: 130 });
  assert.deepStrictEqual({ ...model.graphVisibleRange(0, 240, 5) }, { start: 0, end: 5 });
  assert.deepStrictEqual({ ...model.graphVisibleRange(0, 240, 0) }, { start: 0, end: 0 });
});

test('graphMoveSelection handles every navigation key and clamps at both ends', () => {
  const move = model.graphMoveSelection;
  assert.strictEqual(move(-1, 'ArrowDown', 5, 100), 0);
  assert.strictEqual(move(0, 'ArrowUp', 5, 100), 0);
  assert.strictEqual(move(10, 'ArrowDown', 5, 100), 11);
  assert.strictEqual(move(10, 'ArrowUp', 5, 100), 9);
  assert.strictEqual(move(50, 'PageDown', 9, 100), 59);
  assert.strictEqual(move(50, 'PageUp', 9, 100), 41);
  assert.strictEqual(move(95, 'PageDown', 9, 100), 99);
  assert.strictEqual(move(50, 'Home', 9, 100), 0);
  assert.strictEqual(move(50, 'End', 9, 100), 99);
  assert.strictEqual(move(99, 'ArrowDown', 5, 100), 99);
  assert.strictEqual(move(3, 'x', 5, 100), 3);
  assert.strictEqual(move(3, 'ArrowDown', 5, 0), -1);
});

test('graphScrollToReveal scrolls only as far as needed', () => {
  assert.strictEqual(model.graphScrollToReveal(0, 240, 10), 24);
  assert.strictEqual(model.graphScrollToReveal(100, 240, 0), 0);
  assert.strictEqual(model.graphScrollToReveal(0, 240, 5), 0);
});

test('graphAnchorAfterReset keeps the same commit at the same offset, else gives up', () => {
  const rows = [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }];
  assert.strictEqual(model.graphAnchorAfterReset('c', 5, rows), 53);
  assert.strictEqual(model.graphAnchorAfterReset('gone', 5, rows), null);
  assert.strictEqual(model.graphAnchorAfterReset(null, 0, rows), null);
});

test('graphNeedsMore asks when within ten rows of the end and more exists', () => {
  assert.strictEqual(model.graphNeedsMore(0, 240, 10, true), true);
  assert.strictEqual(model.graphNeedsMore(0, 240, 500, true), false);
  assert.strictEqual(model.graphNeedsMore(11000, 800, 500, true), true);
  assert.strictEqual(model.graphNeedsMore(11000, 800, 500, false), false);
});

test('lane helpers cap the drawn column, count the hidden lanes and wrap colors', () => {
  assert.strictEqual(model.graphLaneColumn(3), 3);
  assert.strictEqual(model.graphLaneColumn(15), 9);
  assert.strictEqual(model.graphHiddenLanes(10), 0);
  assert.strictEqual(model.graphHiddenLanes(12), 2);
  assert.strictEqual(model.graphLaneColorVar(0), 'var(--vscode-charts-red)');
  assert.strictEqual(model.graphLaneColorVar(6), model.graphLaneColorVar(0));
});

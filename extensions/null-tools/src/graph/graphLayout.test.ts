'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { LogCommit } from './gitLog';
import { GraphLayouter } from './graphLayout';

function c(sha: string, parents: string[]): LogCommit {
  return { sha, parents, author: 'a', email: 'e', time: 1, refs: [], subject: sha };
}

test('a linear history stays in lane 0', () => {
  const rows = new GraphLayouter().layoutPage([c('c3', ['c2']), c('c2', ['c1']), c('c1', [])]);
  assert.deepStrictEqual(rows.map((r) => r.lane), [0, 0, 0]);
  assert.deepStrictEqual(rows.map((r) => r.laneCount), [1, 1, 1]);
  assert.deepStrictEqual(rows[0].edges, [{ kind: 'out', from: 0, to: 0, color: 0 }]);
  assert.deepStrictEqual(rows[1].edges, [{ kind: 'in', from: 0, to: 0, color: 0 }, { kind: 'out', from: 0, to: 0, color: 0 }]);
  assert.deepStrictEqual(rows[2].edges, [{ kind: 'in', from: 0, to: 0, color: 0 }]);
});

test('a merge opens a second lane and the fork point joins them again', () => {
  // M merges A and B, both of which sit on R.
  const rows = new GraphLayouter().layoutPage([c('M', ['A', 'B']), c('A', ['R']), c('B', ['R']), c('R', [])]);
  assert.deepStrictEqual(rows.map((r) => r.lane), [0, 0, 1, 0]);
  assert.deepStrictEqual(rows.map((r) => r.laneCount), [2, 2, 2, 2]);
  assert.deepStrictEqual(rows[0].edges, [
    { kind: 'out', from: 0, to: 0, color: 0 },
    { kind: 'out', from: 0, to: 1, color: 1 },
  ]);
  assert.deepStrictEqual(rows[1].edges, [
    { kind: 'pass', from: 1, to: 1, color: 1 },
    { kind: 'in', from: 0, to: 0, color: 0 },
    { kind: 'out', from: 0, to: 0, color: 0 },
  ]);
  assert.deepStrictEqual(rows[3].edges, [
    { kind: 'in', from: 0, to: 0, color: 0 },
    { kind: 'in', from: 1, to: 0, color: 1 },
  ]);
});

test('an octopus merge opens one lane per extra parent', () => {
  const rows = new GraphLayouter().layoutPage([c('M', ['A', 'B', 'C'])]);
  assert.strictEqual(rows[0].laneCount, 3);
  assert.deepStrictEqual(rows[0].edges.map((e) => [e.kind, e.from, e.to]), [['out', 0, 0], ['out', 0, 1], ['out', 0, 2]]);
});

test('a lane freed by a root commit is reused by the next new tip', () => {
  const rows = new GraphLayouter().layoutPage([c('X1', ['P1', 'P2']), c('P2', []), c('Y', []), c('P1', [])]);
  assert.strictEqual(rows[1].lane, 1);
  assert.strictEqual(rows[2].lane, 1, 'Y reuses the lane P2 freed');
});

test('colors repeat after the palette size', () => {
  const parents = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const rows = new GraphLayouter().layoutPage([c('M', parents)]);
  assert.deepStrictEqual(rows[0].edges.map((e) => e.color), [0, 1, 2, 3, 4, 5, 0]);
});

test('two pages lay out exactly like one page, and reset() starts over', () => {
  const history = [
    c('M', ['A', 'B']), c('A', ['R']), c('B', ['R']), c('N', ['Q']), c('R', ['Q']), c('Q', []),
  ];
  const whole = new GraphLayouter().layoutPage(history);
  for (let split = 1; split < history.length; split++) {
    const layouter = new GraphLayouter();
    const rows = [...layouter.layoutPage(history.slice(0, split)), ...layouter.layoutPage(history.slice(split))];
    assert.deepStrictEqual(rows, whole, `split at ${split}`);
  }
  const layouter = new GraphLayouter();
  layouter.layoutPage(history.slice(0, 2));
  layouter.reset();
  assert.deepStrictEqual(layouter.layoutPage(history), whole);
});

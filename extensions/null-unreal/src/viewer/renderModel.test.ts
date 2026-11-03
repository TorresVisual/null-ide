import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildRenderModel, MISSING_NODE, RESULT_ID } from './renderModel';

// The fixture lives beside the package, next to the other hand-written exports.
const fixture = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'material.json'), 'utf8'));
const data = fixture.data as Record<string, unknown>;
const exprs = data.expressions as { inputs?: { link?: unknown }[] }[];
const m = buildRenderModel(data);

test('expressionCount is the export count and nodes add the result node', () => {
  assert.equal(m.expressionCount, exprs.length);
  assert.equal(m.nodes.length, exprs.length + 1);
  assert.equal(m.nodes.at(-1)?.id, RESULT_ID);
});

test('link count is every connected input plus every connected output, missing ones included', () => {
  const inputLinks = exprs.reduce((n, e) => n + (e.inputs ?? []).filter((p) => p.link).length, 0);
  const outputLinks = (data.outputs as { link: unknown }[]).filter((o) => o.link).length;
  assert.equal(m.links.length, inputLinks + outputLinks);
});

test('an unreadable link becomes one missing link and a note, and never drops', () => {
  const missing = m.links.filter((l) => l.missing);
  assert.equal(missing.length, 2);
  assert.ok(missing.every((l) => l.from.node === MISSING_NODE));
  assert.ok(m.notes.includes('2 link(s) to unreadable expressions'));
});

test('a null-linked output creates no link', () => {
  const toResult = m.links.filter((l) => l.to.node === RESULT_ID);
  assert.equal(toResult.length, 2);
});

test('a node with three inputs and one output is 32 + 20 * 3 high', () => {
  const node = m.nodes.find((n) => n.inputs.length === 3);
  assert.ok(node);
  assert.equal(node.h, 32 + 20 * 3);
});

test('a reroute is shaped as a reroute', () => {
  assert.equal(m.nodes.find((n) => n.label === 'Reroute')?.shape, 'reroute');
});

test('bounds contain every node', () => {
  for (const n of m.nodes) {
    assert.ok(n.x >= m.bounds.x && n.x + n.w <= m.bounds.x + m.bounds.w);
    assert.ok(n.y >= m.bounds.y && n.y + n.h <= m.bounds.y + m.bounds.h);
  }
});

test('an out-of-range link index is missing, not a crash', () => {
  const r = buildRenderModel({ expressions: [{ class: 'MaterialExpressionAdd', inputs: [{ name: 'A', link: { from: 9, pin: '' } }], outputs: [] }], outputs: [] });
  assert.equal(r.links.length, 1);
  assert.equal(r.links[0].missing, true);
});

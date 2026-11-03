import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveParams, ParamSource } from './instance';

const material: ParamSource = {
  kind: 'material',
  data: {
    parameters: [
      { name: 'Roughness', type: 'scalar', default: 0.5 },
      { name: 'Tint', type: 'vector', default: { r: 0, g: 0, b: 1 } },
    ],
  },
};
const instance = (overrides: Record<string, Record<string, unknown>>): ParamSource => ({
  kind: 'material-instance',
  data: { overrides: { scalar: {}, vector: {}, texture: {}, ...overrides } },
});

test('resolveParams marks own overrides and inherits the rest from the root material', () => {
  const own = instance({ scalar: { Roughness: 0.8 } });
  const r = resolveParams(own, [material]);
  assert.equal(r.complete, true);
  assert.deepEqual(r.rows, [
    { name: 'Roughness', type: 'scalar', value: 0.8, source: 'override' },
    { name: 'Tint', type: 'vector', value: { r: 0, g: 0, b: 1 }, source: 'inherited' },
  ]);
});

test('resolveParams takes an inherited value from the nearest ancestor that overrides it', () => {
  const own = instance({});
  const parent = instance({ vector: { Tint: { r: 1, g: 0, b: 0 } } });
  const r = resolveParams(own, [parent, material]);
  assert.equal(r.complete, true);
  assert.deepEqual(r.rows, [
    { name: 'Tint', type: 'vector', value: { r: 1, g: 0, b: 0 }, source: 'inherited' },
    { name: 'Roughness', type: 'scalar', value: 0.5, source: 'inherited' },
  ]);
});

test('resolveParams with a chain that ends at an uncached parent returns only the overrides', () => {
  const own = instance({ scalar: { Roughness: 0.8 } });
  const parent = instance({ vector: { Tint: { r: 1, g: 0, b: 0 } } });
  const r = resolveParams(own, [parent]);
  assert.equal(r.complete, false);
  assert.deepEqual(r.rows, [{ name: 'Roughness', type: 'scalar', value: 0.8, source: 'override' }]);
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { familyColor, Family, nodeFamily, pinColor, UNKNOWN_PIN } from './colors';

const FAMILIES: Family[] = ['parameter', 'texture', 'math', 'constant', 'utility', 'function', 'other'];

test('every node family has a colour', () => {
  for (const f of FAMILIES) assert.ok(familyColor(f).length > 0, f);
});

test('a float pin and a texture pin have different colours', () => {
  assert.notEqual(pinColor(1), pinColor(16));
});

test('an unknown pin type is the neutral grey', () => {
  assert.equal(pinColor(null), UNKNOWN_PIN);
  assert.equal(UNKNOWN_PIN, '#8a8a8a');
});

test('nodeFamily maps class names by pattern, texture before parameter', () => {
  assert.equal(nodeFamily('MaterialExpressionTextureSampleParameter2D'), 'texture');
  assert.equal(nodeFamily('MaterialExpressionScalarParameter'), 'parameter');
  assert.equal(nodeFamily('MaterialExpressionMultiply'), 'math');
  assert.equal(nodeFamily('MaterialExpressionConstant'), 'constant');
  assert.equal(nodeFamily('MaterialExpressionSomethingNew'), 'other');
});

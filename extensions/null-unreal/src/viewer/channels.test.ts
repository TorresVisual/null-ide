import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyMask, isToneMapped } from './channels';

test('applyMask zeroes the off colour channels and keeps alpha', () => {
  const out = applyMask(new Uint8ClampedArray([10, 20, 30, 40]), { r: true, g: false, b: true, a: true });
  assert.deepEqual([...out], [10, 0, 30, 40]);
});

test('applyMask with alpha off forces full opacity', () => {
  const out = applyMask(new Uint8ClampedArray([10, 20, 30, 40]), { r: true, g: true, b: true, a: false });
  assert.deepEqual([...out], [10, 20, 30, 255]);
});

test('applyMask with only alpha on shows alpha as grey', () => {
  const out = applyMask(new Uint8ClampedArray([10, 20, 30, 40]), { r: false, g: false, b: false, a: true });
  assert.deepEqual([...out], [40, 40, 40, 255]);
});

test('isToneMapped is true for HDR or float compression only', () => {
  assert.equal(isToneMapped({ compression: 'HDR' }), true);
  assert.equal(isToneMapped({ compression: 'TC_HDR_Compressed' }), true);
  assert.equal(isToneMapped({ compression: 'DEFAULT' }), false);
  assert.equal(isToneMapped({ compression: { unreadable: 'x' } }), false);
});

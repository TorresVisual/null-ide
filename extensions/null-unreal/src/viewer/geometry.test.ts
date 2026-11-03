import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fitView, zoomAbout } from './geometry';

test('fitView scales content to the viewport and centres it', () => {
  assert.deepEqual(fitView({ w: 100, h: 50 }, { w: 200, h: 200 }, 0), { scale: 2, x: 0, y: 50 });
});

test('zoomAbout keeps the point under the cursor fixed', () => {
  const v = { scale: 1, x: 5, y: 7 };
  const p = { x: 10, y: 10 };
  const before = { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
  const z = zoomAbout(v, p, 2);
  assert.equal(z.scale, 2);
  assert.equal((p.x - z.x) / z.scale, before.x);
  assert.equal((p.y - z.y) / z.scale, before.y);
});

test('zoomAbout clamps at the limits', () => {
  assert.equal(zoomAbout({ scale: 30, x: 0, y: 0 }, { x: 0, y: 0 }, 4, { min: 0.05, max: 32 }).scale, 32);
  assert.equal(zoomAbout({ scale: 0.06, x: 0, y: 0 }, { x: 0, y: 0 }, 0.1, { min: 0.05, max: 32 }).scale, 0.05);
});

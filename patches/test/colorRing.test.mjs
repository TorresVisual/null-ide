import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const src = new URL('../../vscode-src/src/vs/', import.meta.url);
const dir = 'editor/contrib/colorPicker/browser/colorPickerParts/';
const skip = !existsSync(new URL(dir, src)) && 'vscode-src not present';

// Plain TypeScript with no VS Code imports, so Node's type stripping loads it directly.
const load = () => import(new URL(dir + 'colorPickerRingMath.ts', src).href);

const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} !~ ${b}`);

test('hslToRgb', { skip }, async () => {
	const { hslToRgb } = await load();
	assert.deepEqual(hslToRgb(0, 1, 0.5), { r: 255, g: 0, b: 0 });
	assert.deepEqual(hslToRgb(60, 1, 0.5), { r: 255, g: 255, b: 0 });
	assert.deepEqual(hslToRgb(120, 1, 0.5), { r: 0, g: 255, b: 0 });
	assert.deepEqual(hslToRgb(240, 1, 0.5), { r: 0, g: 0, b: 255 });
	assert.deepEqual(hslToRgb(-120, 1, 0.5), { r: 0, g: 0, b: 255 }, 'negative hue wraps');
	assert.deepEqual(hslToRgb(180, 0.5, 0.5), { r: 64, g: 191, b: 191 });
	assert.deepEqual(hslToRgb(123, 0, 1), { r: 255, g: 255, b: 255 }, 'white ignores hue');
	assert.deepEqual(hslToRgb(123, 0, 0), { r: 0, g: 0, b: 0 }, 'black ignores hue');
});

test('ringGeometry scales the 200px design', { skip }, async () => {
	const { ringGeometry } = await load();
	const a = ringGeometry(200);
	assert.deepEqual([a.outer, a.inner, a.radius, a.cx, a.cy], [92, 78, 66, 100, 100]);
	const b = ringGeometry(150);
	assert.deepEqual([b.outer, b.inner, b.radius, b.cx, b.cy], [69, 58.5, 49.5, 75, 75]);
});

test('hue 0 points straight up; hueAtPoint inverts it', { skip }, async () => {
	const { ringGeometry, triangleVertices, hueAngle, hueAtPoint } = await load();
	const g = ringGeometry(150);
	near(hueAngle(0), -Math.PI / 2);
	const t = triangleVertices(g, 0);
	near(t.hue.x, g.cx, 1e-9, 'hue vertex x');
	near(t.hue.y, g.cy - g.radius, 1e-9, 'hue vertex y');
	// Circular distance: float error can land 0 as 359.99999999999994.
	const hueNear = (a, b) => near(Math.min(Math.abs(a - b), 360 - Math.abs(a - b)), 0, 1e-9, `hue ${a} !~ ${b}`);
	hueNear(hueAtPoint(g, { x: g.cx, y: g.cy - 50 }), 0);
	hueNear(hueAtPoint(g, { x: g.cx + 50, y: g.cy }), 90);
	hueNear(hueAtPoint(g, { x: g.cx, y: g.cy + 50 }), 180);
	hueNear(hueAtPoint(g, { x: g.cx - 50, y: g.cy }), 270);
});

test('triangle corners map to the pure hue, white and black', { skip }, async () => {
	const { slToBary, baryToSl } = await load();
	assert.deepEqual(slToBary(1, 0.5), { u: 1, v: 0, w: 0 });
	assert.deepEqual(slToBary(0, 1), { u: 0, v: 1, w: 0 });
	assert.deepEqual(slToBary(0, 0), { u: 0, v: 0, w: 1 });
	assert.deepEqual(baryToSl(1, 0), { s: 1, l: 0.5 });
	assert.deepEqual(baryToSl(0, 1), { s: 0, l: 1 });
});

test('(s, l) -> point -> (s, l) round-trips, including greys and extremes', { skip }, async () => {
	const { ringGeometry, pointForSl, slAtPoint } = await load();
	const g = ringGeometry(150);
	for (const h of [0, 45, 200, 359]) {
		for (const s of [0, 0.25, 0.5, 0.75, 1]) {
			for (const l of [0, 0.1, 0.5, 0.9, 1]) {
				if (l < s / 2 - 1e-12 || l > 1 - s / 2 + 1e-12) { continue; } // outside the triangle
				const p = pointForSl(g, h, s, l);
				assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `finite point h=${h} s=${s} l=${l}`);
				const back = slAtPoint(g, h, p);
				near(back.s, s, 1e-9, `s h=${h} s=${s} l=${l}`);
				near(back.l, l, 1e-9, `l h=${h} s=${s} l=${l}`);
			}
		}
	}
});

test('slAtPoint clamps far-outside points into the triangle', { skip }, async () => {
	const { ringGeometry, slAtPoint } = await load();
	const g = ringGeometry(150);
	for (const p of [{ x: -500, y: -500 }, { x: 900, y: 10 }, { x: 75, y: 900 }, { x: 75, y: -900 }, { x: 0, y: 0 }]) {
		const { s, l } = slAtPoint(g, 123, p);
		assert.ok(Number.isFinite(s) && Number.isFinite(l), 'finite');
		assert.ok(s >= 0 && s <= 1 && l >= 0 && l <= 1, `in range s=${s} l=${l}`);
		assert.ok(l >= s / 2 - 1e-9 && l <= 1 - s / 2 + 1e-9, `inside the triangle s=${s} l=${l}`);
	}
});

test('hitTest classifies ring, triangle and outside', { skip }, async () => {
	const { ringGeometry, pointForSl, hitTest } = await load();
	const g = ringGeometry(150);
	const mid = (g.outer + g.inner) / 2;
	assert.equal(hitTest(g, 0, { x: g.cx + mid, y: g.cy }), 'ring');
	assert.equal(hitTest(g, 0, { x: g.cx, y: g.cy - g.outer - 1 }), 'ring', 'tolerance outside the outer edge');
	assert.equal(hitTest(g, 0, { x: g.cx, y: g.cy }), 'triangle');
	assert.equal(hitTest(g, 200, pointForSl(g, 200, 1, 0.5)), 'triangle', 'on the hue vertex');
	assert.equal(hitTest(g, 0, { x: 0, y: 0 }), undefined, 'canvas corner');
	assert.equal(hitTest(g, 0, { x: g.cx, y: g.cy - g.outer - 10 }), undefined, 'beyond the ring tolerance');
});

test('triangleColorAt: inside, feathered edge, outside', { skip }, async () => {
	const { ringGeometry, triangleVertices, triangleColorAt } = await load();
	const g = ringGeometry(150);
	const vertex = triangleVertices(g, 120).hue;
	assert.deepEqual(triangleColorAt(g, 120, vertex.x, vertex.y), { r: 0, g: 255, b: 0, a: 255 }, 'hue vertex of hue 120 is pure green');
	// A hue-0 triangle: its centroid is inside and fully opaque.
	const inside = triangleColorAt(g, 0, g.cx, g.cy);
	assert.ok(inside && inside.a === 255, 'centroid opaque');
	// Just outside the hue/white edge by half the feather width: partly transparent.
	const t = triangleVertices(g, 0);
	const u = 0.5, w = -0.01, v = 1 - u - w;
	const edge = { x: u * t.hue.x + v * t.white.x + w * t.black.x, y: u * t.hue.y + v * t.white.y + w * t.black.y };
	const feathered = triangleColorAt(g, 0, edge.x, edge.y);
	assert.ok(feathered && feathered.a > 100 && feathered.a < 160, `feathered alpha ${feathered && feathered.a}`);
	assert.equal(triangleColorAt(g, 0, 1, 1), undefined, 'far outside');
});

test('adoptHue keeps the hue for greys and adopts it for colors', { skip }, async () => {
	const { adoptHue, HUE_EPSILON } = await load();
	assert.equal(adoptHue(200, { h: 0, s: 0, l: 0 }), 200, 'black');
	assert.equal(adoptHue(200, { h: 0, s: 0, l: 1 }), 200, 'white');
	assert.equal(adoptHue(200, { h: 0, s: HUE_EPSILON / 2, l: 0.5 }), 200, 'nearly grey');
	assert.equal(adoptHue(200, { h: 30, s: 0.5, l: 0.5 }), 30, 'a real color');
});

test('keyStep', { skip }, async () => {
	const { keyStep } = await load();
	const c = { h: 0, s: 0.5, l: 0.5 };
	assert.equal(keyStep(c, 'ArrowLeft', false).h, 359, 'hue wraps below 0');
	assert.equal(keyStep(c, 'ArrowLeft', true).h, 350, 'shift = 10');
	assert.equal(keyStep({ ...c, h: 359 }, 'ArrowRight', false).h, 0, 'hue wraps above 359');
	near(keyStep(c, 'ArrowUp', false).l, 0.51);
	assert.equal(keyStep({ ...c, l: 0.995 }, 'ArrowUp', false).l, 1, 'lightness clamps at 1');
	assert.equal(keyStep({ ...c, l: 0.005 }, 'ArrowDown', false).l, 0, 'lightness clamps at 0');
	near(keyStep(c, 'PageUp', false).s, 0.51);
	near(keyStep(c, 'PageDown', true).s, 0.4);
	assert.equal(keyStep(c, 'a', false), undefined, 'other keys are ignored');
});

# Core Color Picker (Hue Ring + Triangle) Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Replace the saturation square and hue strip in VS Code's built-in color picker (editor hover and standalone picker) with the Affinity-style hue ring + saturation/lightness triangle, shipped as `patches/012-color-ring-picker.patch`.

**Architecture:** One new pure math module (unit-tested with `node --test`) and one new `Disposable` DOM part (`ColorRing`) replace `SaturationBox` + `HueStrip` inside `ColorPickerBody`. The opacity strip, header, Insert/Close buttons and the edit path are untouched. The change is written in the (already patched, uncommitted) `vscode-src` tree and exported with `git diff --cached`, like patch 011.

**Tech Stack:** TypeScript (VS Code source conventions: tabs, `Disposable`, `Emitter`), canvas 2D, `node:test` with Node type stripping, git.

**Spec:** `docs/specs/core-color-picker-design.md`

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- `vscode-src/` is gitignored in the outer repo and is the **patched** tree (patches 001–011 applied, ~1100 uncommitted entries). Never commit there, never `git add -A` / `git add .` there, never `git stash`/`checkout`/`clean` there. Stage only the five files named in Task 4.
- New files under `vscode-src` use VS Code's tab indentation and the Microsoft MIT header, plus a `// Null IDE:` comment, like `nullStartupSnapshot.ts`.
- `.colorpicker-widget` stays 190 px tall; the ring is about 150 px, centered in the existing `min-width: 220px` area; no hover relayout.
- Opacity strip stays and alpha is preserved on every ring edit.
- Handle and outline colors are fixed (white stroke, dark halo, dark outline): no theme tokens, no new color registrations, no new setting, no switch back to the stock picker.
- The ring canvas is keyboard accessible: `tabindex=0`, `role="application"`, `aria-label`.
- The patch must apply with `git apply --ignore-whitespace` after VSCodium's patches and patches 001–011.
- Do not touch `extensions/null-actions/src/webview/colorPicker.ts` or its `out/`.
- Stop at the static checks (math tests, `git apply --check`, scoped `tsc`). Do not run `scripts/build-local.ps1`. Report the patch as **not visually verified**.
- Commit in the outer repo only the patch, the test file and the `CLAUDE.md` line. Do not commit the unrelated pending changes (`.vscode/settings.json`, `extensions/null-actions/src/...`). Do not push.

## Review Focus

Failure modes the spec implies that most likely bite a person using the picker. Math-level ones are pinned by a test in Task 1; DOM-level ones cannot run under `node:test` (same as the rest of the repo's webview code) and are pinned by the manual checklist in Task 4.

1. Dragging the triangle to black or white (or nudging opacity there) must not snap the hue handle to red. Pinned: `adoptHue` test (Task 1); manual item 4.
2. Pure-grey and extreme colors (`#000`, `#fff`, `#808080`, `s = 0`) must give finite handle positions and round-trip through the triangle mapping. Pinned: round-trip grid including `s = 0`, `l = 0`, `l = 1` (Task 1).
3. A pointer released or dragged outside the triangle/ring must clamp to a valid `(s, l)` inside the triangle, never produce `NaN` or `s`/`l` outside `[0, 1]`. Pinned: `slAtPoint` far-outside test (Task 1).
4. High-DPI (`pixelRatio` 2): the triangle must be painted in device pixels. (The `null-actions` original uses `putImageData` with CSS-pixel coordinates, which is wrong at `devicePixelRatio` 2.) Pinned: `triangleColorAt` takes CSS coordinates and the part samples at `(device + 0.5) / pixelRatio` (Task 2); manual item 7.
5. `layout()` called before the node is attached (`offsetWidth` 0) must not throw or size the canvas to 0/NaN. Pinned by the `size <= 0` guard (Task 2); manual item 1.
6. Alpha must survive ring edits on `rgba()` / `#rrggbbaa` colors. Pinned by `emit` reading the model's alpha (Task 2); manual item 3.

---

### Task 1: Pure ring math, test-first

**Files:**
- Create: `vscode-src/src/vs/editor/contrib/colorPicker/browser/colorPickerParts/colorPickerRingMath.ts`
- Create: `patches/test/colorRing.test.mjs`

**Interfaces:**
- Produces (all exported from `colorPickerRingMath.ts`, used by Task 2):
  - types `Rgb {r,g,b}`, `Rgba extends Rgb {a}`, `Hsl {h,s,l}`, `Point {x,y}`, `Bary {u,v,w}`, `Triangle {hue,white,black: Point}`, `RingGeometry {size,cx,cy,outer,inner,radius,scale}`, `RingHit = 'ring' | 'triangle'`
  - `HUE_EPSILON: number` (0.02)
  - `ringGeometry(size: number): RingGeometry`
  - `hslToRgb(h: number, s: number, l: number): Rgb`
  - `hueAngle(h: number): number` (radians; hue 0 points straight up)
  - `triangleVertices(g: RingGeometry, h: number): Triangle`
  - `barycentric(p: Point, t: Triangle): Bary`
  - `slToBary(s: number, l: number): Bary`, `baryToSl(u: number, v: number): { s: number; l: number }`
  - `pointForSl(g: RingGeometry, h: number, s: number, l: number): Point`
  - `slAtPoint(g: RingGeometry, h: number, p: Point): { s: number; l: number }` (clamps into the triangle)
  - `hitTest(g: RingGeometry, h: number, p: Point): RingHit | undefined`
  - `hueAtPoint(g: RingGeometry, p: Point): number` (0–360)
  - `triangleColorAt(g: RingGeometry, h: number, x: number, y: number): Rgba | undefined`
  - `adoptHue(current: number, incoming: Hsl): number`
  - `keyStep(c: Hsl, key: string, shift: boolean): Hsl | undefined`

- [ ] **Step 1: Confirm the touched upstream files are unmodified in the patched tree**

Patch 012 is exported as a diff of the working tree. For `git apply --check` against a clean `HEAD` checkout to be a valid proof (Task 4), the files it modifies must currently equal `HEAD`.

Run: `git -C vscode-src status --short -- src/vs/editor/contrib/colorPicker`
Expected: no output. If anything is listed, stop and tell the user: another patch touches the picker and the check strategy in Task 4 must change.

- [ ] **Step 2: Write the failing test**

Create `patches/test/colorRing.test.mjs`:

```js
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test patches/test/colorRing.test.mjs`
Expected: every test FAILS with a module-not-found error for `colorPickerRingMath.ts` (not "skipped"; if skipped, `vscode-src` is missing and the plan cannot proceed).

- [ ] **Step 4: Write the implementation**

Create `vscode-src/src/vs/editor/contrib/colorPicker/browser/colorPickerParts/colorPickerRingMath.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Null IDE: geometry and color math for the hue ring + triangle picker. No VS Code imports, so patches/test can load it directly.
//
// The triangle's three corners are exactly HSL's (s=1, l=0.5) "pure hue", (s=0, l=1) "white" and (s=0, l=0) "black".
// Because (s, l) is already a linear blend of those three points, barycentric weights map to (s, l) and back with
// plain linear algebra, so drawing (position -> color) and hit-testing (color -> position) stay consistent:
//   s = u            (u = weight of the hue corner)
//   l = u / 2 + v    (v = weight of the white corner)

export interface Rgb { readonly r: number; readonly g: number; readonly b: number }
export interface Rgba extends Rgb { readonly a: number }
export interface Hsl { readonly h: number; readonly s: number; readonly l: number }
export interface Point { readonly x: number; readonly y: number }
export interface Bary { readonly u: number; readonly v: number; readonly w: number }
export interface Triangle { readonly hue: Point; readonly white: Point; readonly black: Point }

export interface RingGeometry {
	readonly size: number;
	readonly cx: number;
	readonly cy: number;
	readonly outer: number;
	readonly inner: number;
	/** Center to each triangle vertex. */
	readonly radius: number;
	/** `size / 200`: the design was drawn at 200 px. */
	readonly scale: number;
}

export type RingHit = 'ring' | 'triangle';

/** Below this HSL saturation the hue of a color is noise (8-bit rounding), so the ring keeps its own hue. */
export const HUE_EPSILON = 0.02;

/** Soft-edge anti-aliasing margin of the triangle, in barycentric units. */
const FEATHER = 0.02;
/** Hit-test slack just outside the triangle edges, in barycentric units. */
const TRIANGLE_SLACK = 0.05;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const wrapHue = (h: number): number => ((h % 360) + 360) % 360;

export function ringGeometry(size: number): RingGeometry {
	const scale = size / 200;
	return { size, cx: size / 2, cy: size / 2, outer: 92 * scale, inner: 78 * scale, radius: 66 * scale, scale };
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
	h = wrapHue(h);
	s = clamp01(s);
	l = clamp01(l);
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hp = h / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	let r1 = 0, g1 = 0, b1 = 0;
	if (hp < 1) { r1 = c; g1 = x; }
	else if (hp < 2) { r1 = x; g1 = c; }
	else if (hp < 3) { g1 = c; b1 = x; }
	else if (hp < 4) { g1 = x; b1 = c; }
	else if (hp < 5) { r1 = x; b1 = c; }
	else { r1 = c; b1 = x; }
	const m = l - c / 2;
	return {
		r: Math.round((r1 + m) * 255),
		g: Math.round((g1 + m) * 255),
		b: Math.round((b1 + m) * 255),
	};
}

/** Hue 0 (red) points straight up. */
export function hueAngle(h: number): number {
	return (-90 + h) * Math.PI / 180;
}

export function triangleVertices(g: RingGeometry, h: number): Triangle {
	const a0 = hueAngle(h);
	const at = (a: number): Point => ({ x: g.cx + g.radius * Math.cos(a), y: g.cy + g.radius * Math.sin(a) });
	return {
		hue: at(a0),
		white: at(a0 + 2 * Math.PI / 3),
		black: at(a0 - 2 * Math.PI / 3),
	};
}

export function barycentric(p: Point, t: Triangle): Bary {
	const a = t.hue, b = t.white, c = t.black;
	const v0x = b.x - a.x, v0y = b.y - a.y;
	const v1x = c.x - a.x, v1y = c.y - a.y;
	const v2x = p.x - a.x, v2y = p.y - a.y;
	const d00 = v0x * v0x + v0y * v0y;
	const d01 = v0x * v1x + v0y * v1y;
	const d11 = v1x * v1x + v1y * v1y;
	const d20 = v2x * v0x + v2y * v0y;
	const d21 = v2x * v1x + v2y * v1y;
	const denom = d00 * d11 - d01 * d01;
	const v = (d11 * d20 - d01 * d21) / denom;
	const w = (d00 * d21 - d01 * d20) / denom;
	return { u: 1 - v - w, v, w };
}

export function slToBary(s: number, l: number): Bary {
	const u = s;
	const v = l - s / 2;
	return { u, v, w: 1 - u - v };
}

export function baryToSl(u: number, v: number): { s: number; l: number } {
	return { s: u, l: u / 2 + v };
}

export function pointForSl(g: RingGeometry, h: number, s: number, l: number): Point {
	const t = triangleVertices(g, h);
	const { u, v, w } = slToBary(s, l);
	return {
		x: u * t.hue.x + v * t.white.x + w * t.black.x,
		y: u * t.hue.y + v * t.white.y + w * t.black.y,
	};
}

/** The (s, l) under `p`; points outside the triangle are pulled to its boundary. */
export function slAtPoint(g: RingGeometry, h: number, p: Point): { s: number; l: number } {
	const b = barycentric(p, triangleVertices(g, h));
	const u = Math.max(0, b.u), v = Math.max(0, b.v), w = Math.max(0, b.w);
	const sum = u + v + w || 1;
	const sl = baryToSl(u / sum, v / sum);
	return { s: clamp01(sl.s), l: clamp01(sl.l) };
}

export function hitTest(g: RingGeometry, h: number, p: Point): RingHit | undefined {
	const dist = Math.hypot(p.x - g.cx, p.y - g.cy);
	const tolerance = 4 * g.scale;
	if (dist >= g.inner - tolerance && dist <= g.outer + tolerance) {
		return 'ring';
	}
	const b = barycentric(p, triangleVertices(g, h));
	return Math.min(b.u, b.v, b.w) >= -TRIANGLE_SLACK ? 'triangle' : undefined;
}

/** Hue in degrees (0-360) of the direction from the center to `p`. */
export function hueAtPoint(g: RingGeometry, p: Point): number {
	return wrapHue(Math.atan2(p.y - g.cy, p.x - g.cx) * 180 / Math.PI + 90);
}

/** The triangle's pixel at CSS coordinates (x, y), or undefined when fully outside. Edge pixels get a partial alpha. */
export function triangleColorAt(g: RingGeometry, h: number, x: number, y: number): Rgba | undefined {
	const b = barycentric({ x, y }, triangleVertices(g, h));
	const minWeight = Math.min(b.u, b.v, b.w);
	if (minWeight < -FEATHER) {
		return undefined;
	}
	const { r, g: green, b: blue } = hslToRgb(h, clamp01(b.u), clamp01(b.u / 2 + b.v));
	return { r, g: green, b: blue, a: minWeight >= 0 ? 255 : Math.round(255 * (1 + minWeight / FEATHER)) };
}

/**
 * The ring's hue after the model's color changed from outside the ring.
 * HSL has no hue at saturation 0 and the opacity strip rebuilds colors through HSV (RGB-derived), so greys carry a
 * meaningless hue: keep the current one instead of snapping to red.
 */
export function adoptHue(current: number, incoming: Hsl): number {
	return incoming.s > HUE_EPSILON ? incoming.h : current;
}

/** The keyboard step for a key, or undefined if the key is not a picker key. */
export function keyStep(c: Hsl, key: string, shift: boolean): Hsl | undefined {
	const step = shift ? 10 : 1;
	switch (key) {
		case 'ArrowLeft': return { ...c, h: wrapHue(c.h - step) };
		case 'ArrowRight': return { ...c, h: wrapHue(c.h + step) };
		case 'ArrowUp': return { ...c, l: clamp01(c.l + step / 100) };
		case 'ArrowDown': return { ...c, l: clamp01(c.l - step / 100) };
		case 'PageUp': return { ...c, s: clamp01(c.s + step / 100) };
		case 'PageDown': return { ...c, s: clamp01(c.s - step / 100) };
		default: return undefined;
	}
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test patches/test/colorRing.test.mjs`
Expected: all 10 tests PASS. If the hue-vertex assertion in `triangleColorAt` is off by one unit (e.g. `g: 254`), it is float error at the vertex; clamp is already applied to `s`/`l`, so look at the rounding in `hslToRgb` before touching the expectation. Do not loosen the other tests.

- [ ] **Step 6: Run the other patch tests to confirm nothing else broke**

Run: `node --test patches/test/*.test.mjs`
Expected: all PASS (the existing `safeMode` and `startupSnapshot` suites plus the new one).

(No commit: the math file lives in the gitignored `vscode-src`; everything is committed together in Task 4.)

---

### Task 2: The ring part and its styles

**Files:**
- Create: `vscode-src/src/vs/editor/contrib/colorPicker/browser/colorPickerParts/colorPickerRing.ts`
- Modify: `vscode-src/src/vs/editor/contrib/colorPicker/browser/colorPicker.css` (insert a block before `.colorpicker-body .hue-strip {`)

**Interfaces:**
- Consumes (Task 1): `ringGeometry`, `RingGeometry`, `hslToRgb`, `hueAngle`, `triangleVertices`, `pointForSl`, `slAtPoint`, `hitTest`, `hueAtPoint`, `triangleColorAt`, `adoptHue`, `keyStep` from `./colorPickerRingMath.js`.
- Consumes (core): `ColorPickerModel` (`.color: Color`, settable, `.onDidChangeColor`); `GlobalPointerMoveMonitor`; `Color`, `HSLA`.
- Produces (used by Task 3): `class ColorRing extends Disposable` with
  - `constructor(container: HTMLElement, model: ColorPickerModel, pixelRatio: number)` — appends `.ring-wrap` to `container`
  - `get domNode(): HTMLElement` (the `.ring-wrap`)
  - `readonly onColorFlushed: Event<void>` (pointer released / keys released / canvas blurred after a change)
  - `layout(): void`
  - The ring writes `model.color` itself (HSLA, alpha copied from the current color).

- [ ] **Step 1: Create the part**

Create `vscode-src/src/vs/editor/contrib/colorPicker/browser/colorPickerParts/colorPickerRing.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Null IDE: hue ring + inscribed saturation/lightness triangle, replacing the saturation box and hue strip.
// Drawing and hit-testing math lives in colorPickerRingMath.ts (unit-tested by patches/test/colorRing.test.mjs).

import '../colorPicker.css';
import * as dom from '../../../../../base/browser/dom.js';
import { GlobalPointerMoveMonitor } from '../../../../../base/browser/globalPointerMoveMonitor.js';
import { Color, HSLA } from '../../../../../base/common/color.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { ColorPickerModel } from '../colorPickerModel.js';
import { RingGeometry, RingHit, adoptHue, hitTest, hslToRgb, hueAngle, hueAtPoint, keyStep, pointForSl, ringGeometry, slAtPoint, triangleColorAt, triangleVertices } from './colorPickerRingMath.js';

const $ = dom.$;

export class ColorRing extends Disposable {

	private readonly _domNode: HTMLElement;
	private readonly _canvas: HTMLCanvasElement;
	/** Ring + triangle for `baseHue`, in device pixels; repainted only when the hue changes. */
	private readonly _base: HTMLCanvasElement;
	private readonly monitor = this._register(new GlobalPointerMoveMonitor());

	private geometry: RingGeometry | undefined;
	/** The ring's own hue: HSL has none at greys, and the model's hue is unreliable there. */
	private hue: number;
	private baseHue = NaN;
	private lastEmitted: Color | undefined;
	private flushPending = false;

	private readonly _onColorFlushed = this._register(new Emitter<void>());
	readonly onColorFlushed: Event<void> = this._onColorFlushed.event;

	constructor(container: HTMLElement, private readonly model: ColorPickerModel, private readonly pixelRatio: number) {
		super();

		this.hue = model.color.hsla.h;

		this._domNode = $('.ring-wrap');
		dom.append(container, this._domNode);

		this._canvas = document.createElement('canvas');
		this._canvas.className = 'ring-canvas';
		this._canvas.tabIndex = 0;
		this._canvas.setAttribute('role', 'application');
		this._canvas.setAttribute('aria-label', localize('colorPickerRing', "Color picker. Left and right arrows change the hue, up and down change the lightness, Page Up and Page Down change the saturation. Hold Shift for larger steps."));
		dom.append(this._domNode, this._canvas);

		this._base = document.createElement('canvas');

		this._register(dom.addDisposableListener(this._canvas, dom.EventType.POINTER_DOWN, e => this.onPointerDown(e)));
		this._register(dom.addDisposableListener(this._canvas, dom.EventType.KEY_DOWN, e => this.onKeyDown(e)));
		this._register(dom.addDisposableListener(this._canvas, dom.EventType.KEY_UP, () => this.flushIfPending()));
		this._register(dom.addDisposableListener(this._canvas, dom.EventType.BLUR, () => this.flushIfPending()));
		this._register(this.model.onDidChangeColor(this.onDidChangeColor, this));

		this.layout();
	}

	get domNode(): HTMLElement {
		return this._domNode;
	}

	layout(): void {
		const size = Math.floor(Math.min(this._domNode.offsetWidth, this._domNode.offsetHeight));
		if (size <= 0) {
			return; // not laid out yet
		}
		this.geometry = ringGeometry(size);
		for (const canvas of [this._canvas, this._base]) {
			canvas.width = size * this.pixelRatio;
			canvas.height = size * this.pixelRatio;
		}
		this._canvas.style.width = `${size}px`;
		this._canvas.style.height = `${size}px`;
		this.baseHue = NaN;
		this.paint();
	}

	// -- input -------------------------------------------------------------

	private onPointerDown(e: PointerEvent): void {
		const g = this.geometry;
		if (!g || e.button !== 0) {
			return;
		}
		const hit = hitTest(g, this.hue, this.localPoint(e));
		if (!hit) {
			return;
		}
		this.drag(hit, e);
		this.monitor.startMonitoring(this._canvas, e.pointerId, e.buttons, event => this.drag(hit, event), () => this._onColorFlushed.fire());
	}

	private drag(hit: RingHit, e: { clientX: number; clientY: number }): void {
		const g = this.geometry;
		if (!g) {
			return;
		}
		const p = this.localPoint(e);
		if (hit === 'ring') {
			this.hue = hueAtPoint(g, p);
			const { s, l } = this.model.color.hsla;
			this.emit(s, l);
		} else {
			const { s, l } = slAtPoint(g, this.hue, p);
			this.emit(s, l);
		}
	}

	private onKeyDown(e: KeyboardEvent): void {
		const { s, l } = this.model.color.hsla;
		const next = keyStep({ h: this.hue, s, l }, e.key, e.shiftKey);
		if (!next) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		this.hue = next.h;
		this.flushPending = true;
		this.emit(next.s, next.l);
	}

	private flushIfPending(): void {
		if (this.flushPending) {
			this.flushPending = false;
			this._onColorFlushed.fire();
		}
	}

	private localPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
		const rect = this._canvas.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	// -- model -------------------------------------------------------------

	private emit(s: number, l: number): void {
		const color = new Color(new HSLA(this.hue, s, l, this.model.color.rgba.a));
		this.lastEmitted = color;
		this.model.color = color;
		this.paint();
	}

	private onDidChangeColor(color: Color): void {
		if (this.monitor.isMonitoring()) {
			return;
		}
		const last = this.lastEmitted;
		if (last && last.rgba.r === color.rgba.r && last.rgba.g === color.rgba.g && last.rgba.b === color.rgba.b) {
			return; // our own change, or an alpha-only change: the ring looks the same
		}
		this.hue = adoptHue(this.hue, color.hsla);
		this.paint();
	}

	// -- drawing -----------------------------------------------------------

	private paint(): void {
		const g = this.geometry;
		if (!g) {
			return;
		}
		if (this.baseHue !== this.hue) {
			this.paintBase(g);
			this.baseHue = this.hue;
		}

		const ctx = this._canvas.getContext('2d')!;
		ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
		ctx.clearRect(0, 0, g.size, g.size);
		ctx.drawImage(this._base, 0, 0, g.size, g.size);

		const { s, l } = this.model.color.hsla;
		const ringRadius = (g.outer + g.inner) / 2;
		const angle = hueAngle(this.hue);
		const pure = hslToRgb(this.hue, 1, 0.5);
		this.drawHandle(ctx, g.cx + ringRadius * Math.cos(angle), g.cy + ringRadius * Math.sin(angle), 7 * g.scale, `rgb(${pure.r},${pure.g},${pure.b})`);

		const p = pointForSl(g, this.hue, s, l);
		const picked = hslToRgb(this.hue, s, l);
		this.drawHandle(ctx, p.x, p.y, 6 * g.scale, `rgb(${picked.r},${picked.g},${picked.b})`);
	}

	private paintBase(g: RingGeometry): void {
		const ctx = this._base.getContext('2d')!;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this._base.width, this._base.height);

		// Triangle first: putImageData overwrites its whole bounding box, transparent pixels included,
		// while the ring below is a normal path fill and only touches its own annulus.
		this.paintTriangle(ctx, g);

		ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
		const gradient = ctx.createConicGradient(-Math.PI / 2, g.cx, g.cy);
		for (let i = 0; i <= 6; i++) {
			const c = hslToRgb(i * 60, 1, 0.5);
			gradient.addColorStop(i / 6, `rgb(${c.r},${c.g},${c.b})`);
		}
		ctx.beginPath();
		ctx.arc(g.cx, g.cy, g.outer, 0, Math.PI * 2);
		ctx.arc(g.cx, g.cy, g.inner, 0, Math.PI * 2, true);
		ctx.closePath();
		ctx.fillStyle = gradient;
		ctx.fill('evenodd');

		ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(g.cx, g.cy, g.outer, 0, Math.PI * 2);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(g.cx, g.cy, g.inner, 0, Math.PI * 2);
		ctx.stroke();
	}

	/** Paints in device pixels (putImageData ignores the canvas transform) and samples each at its CSS-pixel center. */
	private paintTriangle(ctx: CanvasRenderingContext2D, g: RingGeometry): void {
		const pr = this.pixelRatio;
		const t = triangleVertices(g, this.hue);
		const xs = [t.hue.x, t.white.x, t.black.x];
		const ys = [t.hue.y, t.white.y, t.black.y];
		const x0 = Math.max(0, Math.floor(Math.min(...xs) * pr) - 1);
		const x1 = Math.min(this._base.width, Math.ceil(Math.max(...xs) * pr) + 1);
		const y0 = Math.max(0, Math.floor(Math.min(...ys) * pr) - 1);
		const y1 = Math.min(this._base.height, Math.ceil(Math.max(...ys) * pr) + 1);
		const w = x1 - x0;
		const h = y1 - y0;
		if (w <= 0 || h <= 0) {
			return;
		}
		const image = ctx.createImageData(w, h);
		for (let py = 0; py < h; py++) {
			for (let px = 0; px < w; px++) {
				const c = triangleColorAt(g, this.hue, (x0 + px + 0.5) / pr, (y0 + py + 0.5) / pr);
				if (!c) {
					continue;
				}
				const i = (py * w + px) * 4;
				image.data[i] = c.r;
				image.data[i + 1] = c.g;
				image.data[i + 2] = c.b;
				image.data[i + 3] = c.a;
			}
		}
		ctx.putImageData(image, x0, y0);
	}

	private drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string): void {
		ctx.save();
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, Math.PI * 2);
		ctx.fillStyle = fill;
		ctx.fill();
		ctx.lineWidth = 2;
		ctx.strokeStyle = '#ffffff';
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(x, y, radius + 1.5, 0, Math.PI * 2);
		ctx.lineWidth = 1;
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
		ctx.stroke();
		ctx.restore();
	}
}
```

- [ ] **Step 2: Add the styles**

In `vscode-src/src/vs/editor/contrib/colorPicker/browser/colorPicker.css`, insert this block immediately before the line `.colorpicker-body .hue-strip {`:

```css
.colorpicker-body .ring-wrap {
	display: flex;
	justify-content: center;
	height: 150px;
	position: relative;
	min-width: 220px;
	flex: 1;
}

.colorpicker-body .ring-canvas {
	flex: none;
	cursor: crosshair;
	touch-action: none;
}

.colorpicker-body .ring-canvas:focus-visible {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: -1px;
}

```

(The old `.saturation-*` and `.hue-strip` rules stay; they are simply unused.)

- [ ] **Step 3: Confirm the math tests still pass**

Run: `node --test patches/test/colorRing.test.mjs`
Expected: PASS (this task adds no testable logic; the DOM part is checked by `tsc` in Task 3 and by the manual checklist).

(No commit; see Task 4.)

---

### Task 3: Wire the ring into the body and the standalone widget

**Files:**
- Modify: `vscode-src/src/vs/editor/contrib/colorPicker/browser/colorPickerParts/colorPickerBody.ts` (replace the whole file)
- Modify: `vscode-src/src/vs/editor/contrib/colorPicker/browser/standaloneColorPicker/standaloneColorPickerWidget.ts:204`

**Interfaces:**
- Consumes (Task 2): `ColorRing` (`domNode`, `onColorFlushed`, `layout()`).
- Produces: `ColorPickerBody.ring: ColorRing` getter, replacing `saturationBox` and `hueStrip`. `opacityStrip`, `enterButton`, `domNode` and `layout()` are unchanged. Nothing outside `standaloneColorPickerWidget.ts` read `saturationBox`/`hueStrip` (verified by grep when this plan was written).

- [ ] **Step 1: Replace `colorPickerBody.ts`**

Replace the full contents of `colorPickerParts/colorPickerBody.ts` with:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import '../colorPicker.css';
import * as dom from '../../../../../base/browser/dom.js';
import { Color, HSVA } from '../../../../../base/common/color.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ColorPickerModel } from '../colorPickerModel.js';
import { ColorRing } from './colorPickerRing.js';
import { InsertButton } from './colorPickerInsertButton.js';
import { OpacityStrip, Strip } from './colorPickerStrip.js';
import { ColorPickerWidgetType } from '../colorPickerParticipantUtils.js';

const $ = dom.$;

export class ColorPickerBody extends Disposable {

	private readonly _domNode: HTMLElement;
	// Null IDE: the hue ring + triangle replaces the saturation box and the hue strip.
	private readonly _ring: ColorRing;
	private readonly _opacityStrip: Strip;
	private readonly _insertButton: InsertButton | null = null;

	constructor(container: HTMLElement, private readonly model: ColorPickerModel, private pixelRatio: number, type: ColorPickerWidgetType) {
		super();

		this._domNode = $('.colorpicker-body');
		dom.append(container, this._domNode);

		this._ring = new ColorRing(this._domNode, this.model, this.pixelRatio);
		this._register(this._ring);
		this._register(this._ring.onColorFlushed(this.flushColor, this));

		this._opacityStrip = new OpacityStrip(this._domNode, this.model, type);
		this._register(this._opacityStrip);
		this._register(this._opacityStrip.onDidChange(this.onDidOpacityChange, this));
		this._register(this._opacityStrip.onColorFlushed(this.flushColor, this));

		if (type === ColorPickerWidgetType.Standalone) {
			this._insertButton = this._register(new InsertButton(this._domNode));
			this._domNode.classList.add('standalone-colorpicker');
		}
	}

	private flushColor(): void {
		this.model.flushColor();
	}

	private onDidOpacityChange(a: number): void {
		const hsva = this.model.color.hsva;
		this.model.color = new Color(new HSVA(hsva.h, hsva.s, hsva.v, a));
	}

	get domNode() {
		return this._domNode;
	}

	get ring() {
		return this._ring;
	}

	get opacityStrip() {
		return this._opacityStrip;
	}

	get enterButton() {
		return this._insertButton;
	}

	layout(): void {
		this._ring.layout();
		this._opacityStrip.layout();
	}
}
```

- [ ] **Step 2: Point the standalone widget at the ring**

In `standaloneColorPicker/standaloneColorPickerWidget.ts` line 204, change:

```ts
		const saturationBoxWidth = colorPickerBody.saturationBox.domNode.clientWidth;
```
to:
```ts
		const saturationBoxWidth = colorPickerBody.ring.domNode.clientWidth;
```
(The variable keeps its name to keep the diff to one line; the value is the same `min-width: 220px` area as before.)

- [ ] **Step 3: Type-check the touched files**

Create the scoped config `vscode-src/src/tsconfig.ring-check.json`:

```json
{
	"extends": "./tsconfig.json",
	"compilerOptions": { "noEmit": true, "incremental": false },
	"include": ["./typings", "./vscode-dts/vscode.d.ts"],
	"files": [
		"./vs/editor/contrib/colorPicker/browser/colorPickerWidget.ts",
		"./vs/editor/contrib/colorPicker/browser/standaloneColorPicker/standaloneColorPickerWidget.ts",
		"./vs/editor/contrib/colorPicker/browser/hoverColorPicker/hoverColorPickerParticipant.ts"
	]
}
```

Run: `vscode-src/node_modules/.bin/tsc -p vscode-src/src/tsconfig.ring-check.json | grep colorPicker`
Expected: **no output**. (The untouched tree already prints 4 unrelated `monaco` / `editorWebWorker` errors from files outside the picker; ignore those. They are the baseline, not a regression. The check takes about 2 seconds.)

If a `colorPicker` line appears, fix it. Likely causes: an unused import (`noUnusedLocals`), or `dom.EventType.KEY_DOWN` handler typing; fix at the source, don't add `any`.

- [ ] **Step 4: Remove the scratch config**

Run: `rm vscode-src/src/tsconfig.ring-check.json`
Expected: file gone (`git -C vscode-src status --short -- src/tsconfig.ring-check.json` prints nothing).

- [ ] **Step 5: Re-run all patch tests**

Run: `node --test patches/test/*.test.mjs`
Expected: all PASS.

(No commit; see Task 4.)

---

### Task 4: Export the patch, prove it applies, document, commit

**Files:**
- Create: `patches/012-color-ring-picker.patch`
- Modify: `CLAUDE.md` (the patch list under "## Patches", after the `011-…` line)
- Test: `patches/test/colorRing.test.mjs` (created in Task 1; committed here)

**Interfaces:**
- Consumes: the five working-tree changes from Tasks 1–3 in `vscode-src`.
- Produces: `patches/012-color-ring-picker.patch`, picked up by the existing `patches/*.patch` loop in `build.yml` and `upstream-check.yml` (no workflow change).

- [ ] **Step 1: Stage exactly the five patch files in `vscode-src`**

Run (from the repo root):
```bash
git -C vscode-src diff --cached --name-only
```
Expected: no output (nothing pre-staged; if anything is listed, stop and tell the user).

Then:
```bash
git -C vscode-src add \
  src/vs/editor/contrib/colorPicker/browser/colorPickerParts/colorPickerRingMath.ts \
  src/vs/editor/contrib/colorPicker/browser/colorPickerParts/colorPickerRing.ts \
  src/vs/editor/contrib/colorPicker/browser/colorPickerParts/colorPickerBody.ts \
  src/vs/editor/contrib/colorPicker/browser/colorPicker.css \
  src/vs/editor/contrib/colorPicker/browser/standaloneColorPicker/standaloneColorPickerWidget.ts
git -C vscode-src diff --cached --name-only
```
Expected: exactly those five paths.

- [ ] **Step 2: Export the patch (plain `git diff`, like patch 011) and unstage**

```bash
git -C vscode-src diff --cached > patches/012-color-ring-picker.patch
git -C vscode-src reset -q
```
Expected: the patch file is non-empty and starts with `diff --git a/src/vs/editor/contrib/colorPicker/browser/colorPicker.css`. `reset -q` unstages only; the working-tree edits stay, matching how patches 001–011 sit in `vscode-src`. Do not commit in `vscode-src`.

- [ ] **Step 3: Prove the patch applies to a clean checkout**

```bash
W="$(mktemp -d)/w"
git -C vscode-src worktree add --detach "$W" HEAD
git -C "$W" apply --check --ignore-whitespace "$PWD/patches/012-color-ring-picker.patch" && echo APPLIES
git -C vscode-src worktree remove --force "$W"
```
Expected: `APPLIES`. (Valid because Task 1 Step 1 confirmed the four modified upstream files equal `HEAD` in the patched tree, so no earlier patch touches them.)

- [ ] **Step 4: Prove the patch matches the working tree**

Run: `git -C vscode-src apply --check -R --ignore-whitespace "$PWD/patches/012-color-ring-picker.patch" && echo MATCHES`
Expected: `MATCHES`.

- [ ] **Step 5: Add the patch to `CLAUDE.md`**

After the `011-compile-cache-rm-retries.patch` line in the patch list, add:

```markdown
- `012-color-ring-picker.patch` — core's color picker (editor hover and the standalone picker, the only two users of `ColorPickerWidget`) shows a hue ring + inscribed saturation/lightness triangle (`colorPickerRing.ts`) instead of the saturation box and hue strip; the opacity strip stays. The ring owns its hue because HSL has none at greys. Pure math has `node --test patches/test/*.test.mjs`. Design `docs/specs/core-color-picker-design.md`; not yet visually verified in a CI build
```

- [ ] **Step 6: Update the knowledge graph**

Run: `graphify update .`
Then `git status --short`. If `graphify-out/` shows as modified and is tracked, leave it out of this commit and mention it in the report; if it is ignored, nothing to do.

- [ ] **Step 7: Run the full test pass once more**

Run: `node --test patches/test/*.test.mjs`
Expected: all PASS.

- [ ] **Step 8: Commit (outer repo, only this work)**

```bash
git status --short
git add patches/012-color-ring-picker.patch patches/test/colorRing.test.mjs CLAUDE.md
git status --short
git commit -m "feat(patches): hue ring + triangle picker for core color pickers (012)

Replaces the saturation box and hue strip in the editor hover and
standalone color pickers; the opacity strip stays. Math is covered by
patches/test/colorRing.test.mjs. Not yet visually verified in a build.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git log --oneline -1
```
Expected: the second `git status` shows only unrelated pre-existing changes (`.vscode/settings.json`, `extensions/null-actions/...`) as unstaged; the commit contains exactly the three files. Do not push.

- [ ] **Step 9: Report, including the manual checklist**

Tell the user, plainly: the patch passes the math tests, applies to a clean `HEAD`, matches the working tree, and type-checks; it is **not visually verified**. Ask them to run a `workflow_dispatch` build, install it, and check:

1. Hover `#1e90ff`, `rgb(30,144,255)`, `hsl(210 100% 56%)` and `rgba(30,144,255,0.5)` in a CSS file: picker opens, ring is centered and not clipped, no scrollbar in the hover.
2. Drag the ring handle and the triangle handle: the color text in the editor updates and one undo reverts the whole drag.
3. On the `rgba()` color, drag the ring and triangle: alpha stays 0.5. Drag the opacity strip: ring does not change.
4. Drag the triangle to the black corner, then the white corner, then up to the hue corner: the ring handle never jumps to red. Same after nudging the opacity strip while at black/white.
5. Click the format label: it cycles rgb/hsl/hex; click the original swatch: color resets and the ring follows (including to a grey original).
6. Keyboard: Tab into the ring, arrows / PageUp / PageDown / Shift step the color; Escape still closes the hover.
7. Standalone picker (`Show or Focus Standalone Color Picker`): header widths line up, Insert/Replace and Close work. Repeat on a 200% display scaling: the triangle is sharp and aligned with its handle.
8. Light and high-contrast themes: handles and ring outline are visible.
9. Press a pointer on the ring, drag outside the hover and release: the color follows, nothing sticks.

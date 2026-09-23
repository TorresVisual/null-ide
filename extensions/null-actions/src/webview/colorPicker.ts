'use strict';

// Affinity-style HSL color picker: a hue ring + inscribed saturation/lightness
// triangle, rendered on <canvas>. Runs standalone in the settings webview
// (no module system -- compiled via tsconfig.webview.json into a single
// global-scope bundle, same pattern as null-tools/src/webview/agents.ts).
// Exposes one global, window.NullColorPicker, with a toggle(anchor, hex,
// onChange) method that the inline settings-panel script calls.
//
// Not covered by node:test (DOM/canvas-dependent, like the rest of the
// settings webview) -- verified manually in a running Extension Host.

interface PickerState {
  h: number; // 0-360
  s: number; // 0-1
  l: number; // 0-1
  a: number; // 0-1 (kept for API completeness; no alpha UI -- not needed by
             // the button-color field this feeds, and StatusBarItem.color
             // has no alpha channel to apply it to)
}

(function () {
  // ── Color conversion ──────────────────────────────────────────────────

  function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r1 = 0, g1 = 0, b1 = 0;
    if (hp < 1) { r1 = c; g1 = x; b1 = 0; }
    else if (hp < 2) { r1 = x; g1 = c; b1 = 0; }
    else if (hp < 3) { r1 = 0; g1 = c; b1 = x; }
    else if (hp < 4) { r1 = 0; g1 = x; b1 = c; }
    else if (hp < 5) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    const m = l - c / 2;
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255),
    };
  }

  function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) { return { h: 0, s: 0, l }; }
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h: number;
    if (max === r) { h = ((g - b) / d) % 6; }
    else if (max === g) { h = (b - r) / d + 2; }
    else { h = (r - g) / d + 4; }
    h *= 60;
    if (h < 0) { h += 360; }
    return { h, s, l };
  }

  function rgbToHex(r: number, g: number, b: number): string {
    const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }

  function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!m) { return null; }
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
    const rgb = hexToRgb(hex);
    return rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : null;
  }

  // ── Geometry ─────────────────────────────────────────────────────────
  // The triangle's three corners are exactly HSL's (s=1,l=0.5) "pure hue",
  // (s=0,l=1) "white", and (s=0,l=0) "black". Because s and l are already a
  // linear blend of those three points, barycentric weights map to (s, l)
  // -- and back -- with plain linear algebra, no RGB round-trip needed:
  //   s = u            (u = weight of the hue corner)
  //   l = u/2 + v       (v = weight of the white corner)
  // This keeps rendering (position -> color) and hit-testing
  // (color -> position) exactly consistent with each other.

  const SIZE = 200;         // CSS px, square canvas
  const RING_OUTER = 92;
  const RING_INNER = 78;
  const TRI_RADIUS = 66;    // center to each triangle vertex

  function angleForHue(hue: number): number {
    return (-90 + hue) * Math.PI / 180; // hue 0 (red) points straight up
  }

  function triangleVertices(hue: number, cx: number, cy: number) {
    const a0 = angleForHue(hue);
    const a1 = a0 + (2 * Math.PI / 3);
    const a2 = a0 - (2 * Math.PI / 3);
    return {
      hueX: cx + TRI_RADIUS * Math.cos(a0), hueY: cy + TRI_RADIUS * Math.sin(a0),
      whiteX: cx + TRI_RADIUS * Math.cos(a1), whiteY: cy + TRI_RADIUS * Math.sin(a1),
      blackX: cx + TRI_RADIUS * Math.cos(a2), blackY: cy + TRI_RADIUS * Math.sin(a2),
    };
  }

  function barycentric(
    px: number, py: number,
    ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
  ): { u: number; v: number; w: number } {
    const v0x = bx - ax, v0y = by - ay;
    const v1x = cx - ax, v1y = cy - ay;
    const v2x = px - ax, v2y = py - ay;
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

  function slToBary(s: number, l: number): { u: number; v: number; w: number } {
    const u = s;
    const v = l - s / 2;
    return { u, v, w: 1 - u - v };
  }

  function baryToSl(u: number, v: number): { s: number; l: number } {
    return { s: u, l: u / 2 + v };
  }

  // ── Canvas rendering + pointer interaction + component ──────────────

  type DragMode = 'ring' | 'triangle' | null;

  class Picker {
    private readonly root: HTMLDivElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly triBase: HTMLCanvasElement; // offscreen cache: ring + triangle for current hue
    private readonly triCtx: CanvasRenderingContext2D;
    private readonly dpr: number;
    private readonly center = { x: SIZE / 2, y: SIZE / 2 };

    private state: PickerState = { h: 0, s: 1, l: 0.5, a: 1 };
    private onChange: ((hex: string) => void) | null = null;
    private dragMode: DragMode = null;
    private currentAnchor: HTMLElement | null = null;

    constructor() {
      this.dpr = window.devicePixelRatio || 1;

      this.root = document.createElement('div');
      this.root.className = 'null-color-popover';
      this.root.style.display = 'none';

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'null-color-canvas';
      this.canvas.tabIndex = 0;
      this.canvas.setAttribute('role', 'application');
      this.canvas.setAttribute('aria-label', 'Color picker: left/right arrows adjust hue, up/down adjust lightness, page up/down adjust saturation, hold shift for larger steps');
      this.root.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;

      this.triBase = document.createElement('canvas');
      this.triCtx = this.triBase.getContext('2d') as CanvasRenderingContext2D;

      this.setupCanvasSize();
      this.bindPointerEvents();

      document.addEventListener('pointerdown', (e) => this.handleOutsidePointerDown(e), true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.close(); } });
    }

    toggle(anchor: HTMLElement, initialHex: string, onChange: (hex: string) => void): void {
      if (this.root.style.display === 'block' && this.currentAnchor === anchor) {
        this.close();
        return;
      }
      this.currentAnchor = anchor;
      this.open(anchor, initialHex, onChange);
    }

    private open(anchor: HTMLElement, initialHex: string, onChange: (hex: string) => void): void {
      const hsl = hexToHsl(initialHex) || { h: 0, s: 1, l: 0.5 };
      this.state = { h: hsl.h, s: hsl.s, l: hsl.l, a: 1 };
      this.onChange = onChange;

      if (!this.root.parentElement) { document.body.appendChild(this.root); }

      const rect = anchor.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - SIZE - 24));
      const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - SIZE - 24));
      this.root.style.left = left + 'px';
      this.root.style.top = top + 'px';
      this.root.style.display = 'block';

      this.redraw(true);
    }

    private close(): void {
      this.root.style.display = 'none';
      this.onChange = null;
      this.currentAnchor = null;
    }

    private handleOutsidePointerDown(e: Event): void {
      if (this.root.style.display !== 'block') { return; }
      const target = e.target as Node;
      if (this.root.contains(target)) { return; }
      if (this.currentAnchor && this.currentAnchor.contains(target)) { return; } // toggle() decides
      this.close();
    }

    private setupCanvasSize(): void {
      for (const c of [this.canvas, this.triBase]) {
        c.width = SIZE * this.dpr;
        c.height = SIZE * this.dpr;
        c.style.width = SIZE + 'px';
        c.style.height = SIZE + 'px';
      }
      this.ctx.scale(this.dpr, this.dpr);
      this.triCtx.scale(this.dpr, this.dpr);
    }

    private redraw(hueChanged: boolean): void {
      if (hueChanged) { this.renderBase(); }
      this.renderHandles();
    }

    private renderBase(): void {
      const { x: cx, y: cy } = this.center;
      const ctx = this.triCtx;
      ctx.clearRect(0, 0, SIZE, SIZE);

      // Triangle first: it's painted via putImageData, which writes raw
      // pixels (including fully-transparent ones outside the triangle)
      // directly into its bounding box, clobbering anything drawn there
      // beforehand instead of compositing over it. Drawing the ring
      // afterward is safe the other way around -- a normal path fill only
      // touches pixels inside the ring's own annulus shape, so it correctly
      // repaints over whatever the triangle's bounding-box corners erased,
      // without affecting the triangle's interior at all.
      this.renderTriangle();

      // Hue ring: a true conic gradient (not a CSS approximation), smooth
      // across the full 360-degree spectrum with no banding.
      const grad = ctx.createConicGradient(-Math.PI / 2, cx, cy);
      for (let i = 0; i <= 6; i++) {
        const { r, g, b } = hslToRgb(i * 60, 1, 0.5);
        grad.addColorStop(i / 6, 'rgb(' + r + ',' + g + ',' + b + ')');
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, RING_OUTER, 0, Math.PI * 2);
      ctx.arc(cx, cy, RING_INNER, 0, Math.PI * 2, true);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill('evenodd');
      ctx.restore();

      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, RING_OUTER, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, RING_INNER, 0, Math.PI * 2); ctx.stroke();
    }

    private renderTriangle(): void {
      const { x: cx, y: cy } = this.center;
      const { hueX, hueY, whiteX, whiteY, blackX, blackY } = triangleVertices(this.state.h, cx, cy);

      const minX = Math.max(0, Math.floor(Math.min(hueX, whiteX, blackX)) - 1);
      const maxX = Math.min(SIZE, Math.ceil(Math.max(hueX, whiteX, blackX)) + 1);
      const minY = Math.max(0, Math.floor(Math.min(hueY, whiteY, blackY)) - 1);
      const maxY = Math.min(SIZE, Math.ceil(Math.max(hueY, whiteY, blackY)) + 1);
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const img = this.triCtx.createImageData(w, h);

      const FEATHER = 0.02; // soft-edge anti-aliasing margin, in barycentric units

      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const bary = barycentric(minX + px, minY + py, hueX, hueY, whiteX, whiteY, blackX, blackY);
          const minWeight = Math.min(bary.u, bary.v, bary.w);
          if (minWeight < -FEATHER) { continue; } // fully outside -> stays transparent
          const s = Math.max(0, Math.min(1, bary.u));
          const l = Math.max(0, Math.min(1, bary.u / 2 + bary.v));
          const { r, g, b } = hslToRgb(this.state.h, s, l);
          const alpha = minWeight >= 0 ? 255 : Math.round(255 * (1 + minWeight / FEATHER));
          const idx = (py * w + px) * 4;
          img.data[idx] = r; img.data[idx + 1] = g; img.data[idx + 2] = b; img.data[idx + 3] = alpha;
        }
      }
      this.triCtx.putImageData(img, minX, minY);
    }

    private renderHandles(): void {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(this.triBase, 0, 0, this.triBase.width, this.triBase.height, 0, 0, SIZE, SIZE);

      const { x: cx, y: cy } = this.center;

      const hueAngle = angleForHue(this.state.h);
      const hueHandleR = (RING_OUTER + RING_INNER) / 2;
      this.drawHandle(cx + hueHandleR * Math.cos(hueAngle), cy + hueHandleR * Math.sin(hueAngle), 8);

      const { hueX, hueY, whiteX, whiteY, blackX, blackY } = triangleVertices(this.state.h, cx, cy);
      const bary = slToBary(this.state.s, this.state.l);
      const sx = bary.u * hueX + bary.v * whiteX + bary.w * blackX;
      const sy = bary.u * hueY + bary.v * whiteY + bary.w * blackY;
      const { r, g, b } = hslToRgb(this.state.h, this.state.s, this.state.l);
      this.drawHandle(sx, sy, 7, 'rgb(' + r + ',' + g + ',' + b + ')');
    }

    private drawHandle(x: number, y: number, radius: number, fill?: string): void {
      const ctx = this.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fill || '#1e1e1e';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, radius + 1.5, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.stroke();
      ctx.restore();
    }

    private bindPointerEvents(): void {
      this.canvas.addEventListener('pointerdown', (e) => {
        const { px, py } = this.pointerPos(e);
        const { x: cx, y: cy } = this.center;
        const dist = Math.hypot(px - cx, py - cy);

        if (dist >= RING_INNER - 4 && dist <= RING_OUTER + 4) {
          this.dragMode = 'ring';
          this.canvas.setPointerCapture(e.pointerId);
          this.updateFromRing(px, py);
          return;
        }

        const { hueX, hueY, whiteX, whiteY, blackX, blackY } = triangleVertices(this.state.h, cx, cy);
        const bary = barycentric(px, py, hueX, hueY, whiteX, whiteY, blackX, blackY);
        if (Math.min(bary.u, bary.v, bary.w) >= -0.05) {
          this.dragMode = 'triangle';
          this.canvas.setPointerCapture(e.pointerId);
          this.updateFromTriangle(px, py);
        }
      });

      this.canvas.addEventListener('pointermove', (e) => {
        if (!this.dragMode) { return; }
        const { px, py } = this.pointerPos(e);
        if (this.dragMode === 'ring') { this.updateFromRing(px, py); }
        else { this.updateFromTriangle(px, py); }
      });

      const endDrag = (e: PointerEvent) => {
        if (this.dragMode) {
          try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        }
        this.dragMode = null;
      };
      this.canvas.addEventListener('pointerup', endDrag);
      this.canvas.addEventListener('pointercancel', endDrag);

      this.canvas.addEventListener('keydown', (e) => this.handleKeyDown(e));
    }

    private handleKeyDown(e: KeyboardEvent): void {
      const step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case 'ArrowLeft': this.state.h = ((this.state.h - step) % 360 + 360) % 360; this.redraw(true); break;
        case 'ArrowRight': this.state.h = (this.state.h + step) % 360; this.redraw(true); break;
        case 'ArrowUp': this.state.l = Math.max(0, Math.min(1, this.state.l + step / 100)); this.redraw(false); break;
        case 'ArrowDown': this.state.l = Math.max(0, Math.min(1, this.state.l - step / 100)); this.redraw(false); break;
        case 'PageUp': this.state.s = Math.max(0, Math.min(1, this.state.s + step / 100)); this.redraw(false); break;
        case 'PageDown': this.state.s = Math.max(0, Math.min(1, this.state.s - step / 100)); this.redraw(false); break;
        default: return;
      }
      e.preventDefault();
      this.emitChange();
    }

    private pointerPos(e: PointerEvent): { px: number; py: number } {
      const rect = this.canvas.getBoundingClientRect();
      return { px: e.clientX - rect.left, py: e.clientY - rect.top };
    }

    private updateFromRing(px: number, py: number): void {
      const { x: cx, y: cy } = this.center;
      const angleDeg = Math.atan2(py - cy, px - cx) * 180 / Math.PI;
      this.state.h = ((angleDeg + 90) % 360 + 360) % 360;
      this.redraw(true);
      this.emitChange();
    }

    private updateFromTriangle(px: number, py: number): void {
      const { x: cx, y: cy } = this.center;
      const { hueX, hueY, whiteX, whiteY, blackX, blackY } = triangleVertices(this.state.h, cx, cy);
      let { u, v, w } = barycentric(px, py, hueX, hueY, whiteX, whiteY, blackX, blackY);
      if (u < 0 || v < 0 || w < 0) {
        u = Math.max(0, u); v = Math.max(0, v); w = Math.max(0, w);
        const sum = u + v + w || 1;
        u /= sum; v /= sum; w /= sum;
      }
      const sl = baryToSl(u, v);
      this.state.s = Math.max(0, Math.min(1, sl.s));
      this.state.l = Math.max(0, Math.min(1, sl.l));
      this.redraw(false);
      this.emitChange();
    }

    private emitChange(): void {
      const { r, g, b } = hslToRgb(this.state.h, this.state.s, this.state.l);
      if (this.onChange) { this.onChange(rgbToHex(r, g, b)); }
    }
  }

  const picker = new Picker();
  (window as unknown as { NullColorPicker: unknown }).NullColorPicker = {
    toggle: (anchor: HTMLElement, initialHex: string, onChange: (hex: string) => void) => {
      picker.toggle(anchor, initialHex, onChange);
    },
  };
})();

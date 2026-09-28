'use strict';

/** RGB 0–255 → HSL rounded to integers: [hue 0–360, saturation 0–100, lightness 0–100]. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

/**
 * CSS custom properties for a GitHub label hex color ("d73a4a"). The .gh-label rules in lib/issues.css
 * compute background/text/border from these exactly like github.com's own label CSS, per theme.
 */
function labelStyleVars(hex: string): string {
  const clean = hex.replace(/^#/, '');
  const r = parseInt(clean.slice(0, 2), 16), g = parseInt(clean.slice(2, 4), 16), b = parseInt(clean.slice(4, 6), 16);
  const [h, s, l] = rgbToHsl(r, g, b);
  return `--label-r:${r};--label-g:${g};--label-b:${b};--label-h:${h};--label-s:${s};--label-l:${l}`;
}

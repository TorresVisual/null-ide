'use strict';

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Picks whichever of black/white text has the higher WCAG contrast ratio against a GitHub label hex color. */
function labelChipStyle(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const bgLuminance = relativeLuminance(r, g, b);
  const color = contrastRatio(bgLuminance, 1) > contrastRatio(bgLuminance, 0) ? '#fff' : '#111';
  return `background:#${hex};color:${color}`;
}

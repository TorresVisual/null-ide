// Pan and zoom for the viewers. Pure: no DOM, no vscode.

export interface View { scale: number; x: number; y: number }
export interface Point { x: number; y: number }

// Scales content to fit the viewport (minus `pad` on each side) and centres it.
export function fitView(content: { w: number; h: number }, viewport: { w: number; h: number }, pad: number): View {
  const scale = Math.min((viewport.w - 2 * pad) / content.w, (viewport.h - 2 * pad) / content.h);
  return { scale, x: (viewport.w - content.w * scale) / 2, y: (viewport.h - content.h * scale) / 2 };
}

// The content point under `p` stays under `p` after the zoom. The scale is clamped, so the ratio applied is the real one.
export function zoomAbout(
  v: View,
  p: Point,
  factor: number,
  limits: { min: number; max: number } = { min: 0.05, max: 32 },
): View {
  const scale = Math.min(limits.max, Math.max(limits.min, v.scale * factor));
  const wx = (p.x - v.x) / v.scale;
  const wy = (p.y - v.y) / v.scale;
  return { scale, x: p.x - wx * scale, y: p.y - wy * scale };
}

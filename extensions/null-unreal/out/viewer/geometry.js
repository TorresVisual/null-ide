"use strict";
// Pan and zoom for the viewers. Pure: no DOM, no vscode.
Object.defineProperty(exports, "__esModule", { value: true });
exports.fitView = fitView;
exports.zoomAbout = zoomAbout;
// Scales content to fit the viewport (minus `pad` on each side) and centres it.
function fitView(content, viewport, pad) {
    const scale = Math.min((viewport.w - 2 * pad) / content.w, (viewport.h - 2 * pad) / content.h);
    return { scale, x: (viewport.w - content.w * scale) / 2, y: (viewport.h - content.h * scale) / 2 };
}
// The content point under `p` stays under `p` after the zoom. The scale is clamped, so the ratio applied is the real one.
function zoomAbout(v, p, factor, limits = { min: 0.05, max: 32 }) {
    const scale = Math.min(limits.max, Math.max(limits.min, v.scale * factor));
    const wx = (p.x - v.x) / v.scale;
    const wy = (p.y - v.y) / v.scale;
    return { scale, x: p.x - wx * scale, y: p.y - wy * scale };
}
//# sourceMappingURL=geometry.js.map
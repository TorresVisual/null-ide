"use strict";
// Pan and zoom for the viewers. Pure: no DOM, no vscode.
Object.defineProperty(exports, "__esModule", { value: true });
exports.fitView = fitView;
exports.zoomAbout = zoomAbout;
exports.linkPath = linkPath;
exports.hitNode = hitNode;
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
// Cubic Bézier from a to b with horizontal handles, so links leave and enter pins sideways.
function linkPath(a, b) {
    const c = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + c} ${a.y} ${b.x - c} ${b.y} ${b.x} ${b.y}`;
}
// Topmost node under the point: the last drawn wins, so the search runs from the end.
function hitNode(nodes, p) {
    for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h)
            return n.id;
    }
    return undefined;
}
//# sourceMappingURL=geometry.js.map
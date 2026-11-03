"use strict";
// Channel toggles for the texture viewer. Pure over RGBA bytes.
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMask = applyMask;
exports.isToneMapped = isToneMapped;
// Off colour channels go to 0. Alpha off shows the texture opaque. Alpha alone shows the alpha as grey.
function applyMask(rgba, m) {
    const out = new Uint8ClampedArray(rgba.length);
    const alphaOnly = m.a && !m.r && !m.g && !m.b;
    for (let i = 0; i < rgba.length; i += 4) {
        const a = rgba[i + 3];
        if (alphaOnly) {
            out[i] = out[i + 1] = out[i + 2] = a;
        }
        else {
            out[i] = m.r ? rgba[i] : 0;
            out[i + 1] = m.g ? rgba[i + 1] : 0;
            out[i + 2] = m.b ? rgba[i + 2] : 0;
        }
        out[i + 3] = m.a && !alphaOnly ? a : 255;
    }
    return out;
}
// HDR and float formats come out of the PNG export tone-mapped, so the viewer must say so.
function isToneMapped(data) {
    return typeof data.compression === 'string' && /HDR|FLOAT/i.test(data.compression);
}
//# sourceMappingURL=channels.js.map
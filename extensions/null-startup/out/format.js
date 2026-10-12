'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.fmtMs = fmtMs;
exports.stamp = stamp;
function fmtMs(ms) {
    if (ms === undefined)
        return 'n/a';
    return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}
const two = (n) => String(n).padStart(2, '0');
/** Local `YYYY-MM-DD HH:mm`. */
function stamp(epochMs) {
    const d = new Date(epochMs);
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
//# sourceMappingURL=format.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.describe = describe;
// Text for one export value. An unreadable value says so with its reason; it is never shown as 0, "" or NaN.
function describe(v) {
    if (v === undefined || v === null)
        return '—';
    if (Array.isArray(v))
        return `${v.length} items`;
    if (typeof v === 'object') {
        const u = v.unreadable;
        if (typeof u === 'string')
            return `not available: ${u}`;
        return 'object';
    }
    return String(v);
}
//# sourceMappingURL=value.js.map
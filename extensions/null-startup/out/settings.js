'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRetention = normalizeRetention;
exports.normalizeSlowMs = normalizeSlowMs;
function normalizeRetention(v) {
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(200, Math.max(1, Math.round(v))) : 20;
}
function normalizeSlowMs(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 100;
}
//# sourceMappingURL=settings.js.map
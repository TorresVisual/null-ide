/// <reference path="./protocol.ts" />
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_REGRESSION_RATIO = exports.MIN_REGRESSION_MS = void 0;
exports.baselineOf = baselineOf;
exports.medianBaseline = medianBaseline;
exports.compare = compare;
/** A slowdown is a regression only if it is both noticeable in absolute terms and relative to the baseline. */
exports.MIN_REGRESSION_MS = 50;
exports.MIN_REGRESSION_RATIO = 0.1;
const defined = (e) => e[1] !== undefined;
function baselineOf(r) {
    return {
        headlineMs: r.headlineMs,
        phases: Object.fromEntries(r.phases.map((p) => [p.id, p.durationMs]).filter(defined)),
        extensions: Object.fromEntries(r.extensions.map((e) => [e.id, e.totalMs]).filter(defined)),
    };
}
function median(values) {
    if (!values.length)
        return undefined;
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function medians(maps) {
    const keys = new Set(maps.flatMap((m) => Object.keys(m)));
    const out = {};
    for (const k of keys) {
        const m = median(maps.map((x) => x[k]).filter((v) => v !== undefined));
        if (m !== undefined)
            out[k] = m;
    }
    return out;
}
function medianBaseline(rs) {
    const bs = rs.map(baselineOf);
    return {
        headlineMs: median(bs.map((b) => b.headlineMs).filter((v) => v !== undefined)),
        phases: medians(bs.map((b) => b.phases)),
        extensions: medians(bs.map((b) => b.extensions)),
    };
}
function row(id, label, baseMs, currentMs) {
    const deltaMs = baseMs !== undefined && currentMs !== undefined ? currentMs - baseMs : undefined;
    const regression = deltaMs !== undefined && deltaMs >= exports.MIN_REGRESSION_MS && (baseMs === 0 || deltaMs / baseMs >= exports.MIN_REGRESSION_RATIO);
    return { id, label, baseMs, currentMs, deltaMs, regression };
}
const bySlowdown = (a, b) => (b.deltaMs ?? -Infinity) - (a.deltaMs ?? -Infinity);
function compare(current, base, baseLabel) {
    const phaseNow = new Map(current.phases.map((p) => [p.id, p]));
    const extNow = new Map(current.extensions.map((e) => [e.id, e]));
    const phaseIds = [...new Set([...phaseNow.keys(), ...Object.keys(base.phases)])];
    const extIds = [...new Set([...extNow.keys(), ...Object.keys(base.extensions)])];
    return {
        baseLabel,
        headline: row('headline', 'Startup (workspace restored)', base.headlineMs, current.headlineMs),
        phases: phaseIds.map((id) => row(id, phaseNow.get(id)?.label ?? id, base.phases[id], phaseNow.get(id)?.durationMs)).sort(bySlowdown),
        extensions: extIds.map((id) => row(id, id, base.extensions[id], extNow.get(id)?.totalMs)).sort(bySlowdown),
    };
}
//# sourceMappingURL=compare.js.map
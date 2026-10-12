'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSnapshot = parseSnapshot;
const types_1 = require("./types");
const isObject = (v) => typeof v === 'object' && v !== null;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const list = (v) => (Array.isArray(v) ? v.filter(isObject) : []);
/** Validates the untrusted command result; anything that is not a version-1 snapshot is dropped. */
function parseSnapshot(raw) {
    if (!isObject(raw) || raw.schemaVersion !== types_1.SCHEMA_VERSION)
        return undefined;
    const metrics = {};
    if (isObject(raw.metrics)) {
        for (const [key, value] of Object.entries(raw.metrics)) {
            const n = num(value);
            if (n !== undefined)
                metrics[key] = n;
        }
    }
    const marks = [];
    for (const m of list(raw.marks)) {
        const startTime = num(m.startTime);
        if (typeof m.name === 'string' && startTime !== undefined)
            marks.push({ source: String(m.source ?? ''), name: m.name, startTime });
    }
    const contributions = [];
    for (const c of list(raw.contributions)) {
        const phase = num(c.phase);
        const ms = num(c.ms);
        if (phase !== undefined && ms !== undefined && typeof c.id === 'string')
            contributions.push({ phase, id: c.id, ms });
    }
    const extensions = [];
    for (const e of list(raw.extensions)) {
        if (typeof e.id !== 'string')
            continue;
        extensions.push({
            id: e.id,
            activationEvent: typeof e.activationEvent === 'string' ? e.activationEvent : '',
            reason: typeof e.reason === 'string' ? e.reason : '',
            eager: e.eager === true,
            startMs: num(e.startMs),
            endMs: num(e.endMs),
            loadMs: num(e.loadMs),
            callMs: num(e.callMs),
            resolveMs: num(e.resolveMs),
        });
    }
    return {
        schemaVersion: types_1.SCHEMA_VERSION,
        takenAt: num(raw.takenAt) ?? 0,
        appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : '',
        initialStartup: raw.initialStartup === true,
        metrics,
        marks,
        contributions,
        extensions,
    };
}
//# sourceMappingURL=snapshot.js.map
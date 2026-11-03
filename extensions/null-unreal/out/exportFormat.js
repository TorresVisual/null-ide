"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEMA = void 0;
exports.parseExport = parseExport;
exports.parseManifest = parseManifest;
exports.summarize = summarize;
// The contract between the CLI and engine/export_asset.py: the request, the manifest and one export file.
exports.SCHEMA = 1;
const KINDS = ['material', 'material-instance', 'texture', 'skeletal-mesh', 'skeleton', 'generic'];
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
// Anything that does not look like a current export is a cache miss, never an error.
function parseExport(text) {
    let j;
    try {
        j = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    if (!isObject(j) || !isObject(j.references) || !isObject(j.data) || !isObject(j.sidecars))
        return undefined;
    if (typeof j.schema !== 'number' || typeof j.engineVersion !== 'string')
        return undefined;
    if (typeof j.sourceMtime !== 'number' || typeof j.sourceSize !== 'number')
        return undefined;
    if (typeof j.package !== 'string' || typeof j.class !== 'string')
        return undefined;
    if (!KINDS.includes(j.kind) || !Array.isArray(j.references.dependencies))
        return undefined;
    return j;
}
function parseManifest(text) {
    let j;
    try {
        j = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    if (!isObject(j) || !isObject(j.assets))
        return undefined;
    const out = {};
    for (const [pkg, s] of Object.entries(j.assets)) {
        if (!isObject(s))
            return undefined;
        if (s.status === 'exported')
            out[pkg] = { status: 'exported' };
        else if (s.status === 'failed')
            out[pkg] = { status: 'failed', error: String(s.error ?? 'unknown error') };
        else
            return undefined;
    }
    return out;
}
// One line for the CLI: what the asset is, in a few words.
function summarize(doc) {
    const d = doc.data;
    const n = (v) => (Array.isArray(v) ? v.length : 0);
    switch (doc.kind) {
        case 'material':
            return `Material, ${n(d.expressions)} expressions, ${n(d.parameters)} parameters`;
        case 'material-instance':
            return `Material instance of ${d.parent ?? '?'}`;
        case 'texture':
            return `Texture ${d.width}x${d.height}, ${d.compression ?? '?'}`;
        case 'skeletal-mesh':
            return `Skeletal mesh, ${n(d.bones)} bones, ${n(d.lods)} LODs`;
        case 'skeleton':
            return `Skeleton, ${n(d.bones)} bones`;
        case 'generic':
            return `${doc.class} (generic export)`;
    }
}
//# sourceMappingURL=exportFormat.js.map
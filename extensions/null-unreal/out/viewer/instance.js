"use strict";
// Material instance parameter resolution. Pure: the chain comes from the host, which only uses cached exports.
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveParams = resolveParams;
const TYPES = ['scalar', 'vector', 'texture', 'switch'];
const overridesOf = (s) => {
    const o = s.data.overrides;
    if (!o)
        return [];
    return TYPES.flatMap((t) => Object.entries(o[t] ?? {}).map(([name, v]) => [t, name, v]));
};
// `chain` is the parents, nearest first, as far as they are cached. Rows are the instance's own overrides, then every
// parameter of the root material not overridden by a closer instance. Without a material at the end of the chain the
// result is only the overrides, with complete:false.
function resolveParams(own, chain) {
    const rows = overridesOf(own).map(([type, name, value]) => ({ type, name, value, source: 'override' }));
    const seen = new Set(rows.map((r) => r.name));
    const root = chain[chain.length - 1];
    const complete = root?.kind === 'material';
    if (!complete)
        return { rows, complete: false };
    for (const ancestor of chain) {
        if (ancestor.kind !== 'material-instance')
            continue;
        for (const [type, name, value] of overridesOf(ancestor)) {
            if (seen.has(name))
                continue;
            seen.add(name);
            rows.push({ type, name, value, source: 'inherited' });
        }
    }
    const params = root.data.parameters ?? [];
    for (const p of params) {
        if (seen.has(p.name))
            continue;
        seen.add(p.name);
        rows.push({ type: p.type, name: p.name, value: p.default, source: 'inherited' });
    }
    return { rows, complete: true };
}
//# sourceMappingURL=instance.js.map
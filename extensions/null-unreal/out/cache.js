"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assetsDir = void 0;
exports.entryPath = entryPath;
exports.lookup = lookup;
const node_path_1 = require("node:path");
const exportFormat_1 = require("./exportFormat");
const assetsDir = (projectDir) => node_path_1.win32.join(projectDir, 'Saved', 'NullUnreal', 'assets');
exports.assetsDir = assetsDir;
// /Game/A/B -> <assets>/Game/A/B.json
function entryPath(assets, pkg) {
    return node_path_1.win32.join(assets, ...pkg.split('/').filter(Boolean)) + '.json';
}
// A hit needs the same schema, engine version, source mtime and size, and every sidecar file still present.
function lookup(assets, pkg, current, io) {
    const file = entryPath(assets, pkg);
    const text = io.readFile(file);
    if (text === undefined)
        return { state: 'miss', reason: 'absent' };
    const doc = (0, exportFormat_1.parseExport)(text);
    if (!doc || doc.package !== pkg)
        return { state: 'miss', reason: 'corrupt' };
    if (doc.schema !== exportFormat_1.SCHEMA ||
        doc.engineVersion !== current.engineVersion ||
        doc.sourceMtime !== current.sourceMtime ||
        doc.sourceSize !== current.sourceSize) {
        return { state: 'miss', reason: 'stale' };
    }
    const dir = node_path_1.win32.dirname(file);
    for (const v of Object.values(doc.sidecars)) {
        if (typeof v === 'string' && !io.exists(node_path_1.win32.join(dir, v)))
            return { state: 'miss', reason: 'stale' };
    }
    return { state: 'hit', doc };
}
//# sourceMappingURL=cache.js.map
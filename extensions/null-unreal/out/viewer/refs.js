"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.packageToFile = packageToFile;
exports.sidecarFile = sidecarFile;
exports.thumbnailMap = thumbnailMap;
const node_path_1 = require("node:path");
const cache_1 = require("../cache");
// /Game/A/B -> <content root>\A\B.uasset, the inverse of toPackagePath. Undefined when no mount serves the package.
function packageToFile(pkg, mounts) {
    const mount = mounts.find((m) => pkg.startsWith(m.name + '/'));
    if (!mount)
        return undefined;
    const rel = pkg.slice(mount.name.length + 1).split('/');
    return node_path_1.win32.join(mount.root, ...rel) + '.uasset';
}
// Absolute path of a sidecar file beside the entry JSON; undefined when the export does not name a readable one.
function sidecarFile(assets, doc, key) {
    const v = doc.sidecars[key];
    if (typeof v !== 'string')
        return undefined;
    return node_path_1.win32.join(node_path_1.win32.dirname((0, cache_1.entryPath)(assets, doc.package)), v);
}
// Every package gets an entry: the PNG path when it is cached, null when it is not (a placeholder, never a guess).
function thumbnailMap(packages, pngFor) {
    const out = {};
    for (const p of packages)
        out[p] = pngFor(p) ?? null;
    return out;
}
//# sourceMappingURL=refs.js.map
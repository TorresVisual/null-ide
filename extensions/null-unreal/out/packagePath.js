"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findMounts = findMounts;
exports.toPackagePath = toPackagePath;
exports.uassetsIn = uassetsIn;
const node_path_1 = require("node:path");
const uproject_1 = require("./uproject");
const SKIP = new Set(['Binaries', 'Intermediate', 'Saved', 'Content', 'Source', 'DerivedDataCache', '.git']);
// Project content plus every plugin under <project>/Plugins that has a Content folder.
function findMounts(projectDir, fs) {
    const mounts = [{ name: '/Game', root: node_path_1.win32.join(projectDir, 'Content') }];
    const walk = (dir, depth) => {
        const entries = fs.list(dir);
        const uplugin = entries.find((e) => !e.isDirectory && e.name.toLowerCase().endsWith('.uplugin'));
        if (uplugin) {
            const content = node_path_1.win32.join(dir, 'Content');
            if (fs.exists(content))
                mounts.push({ name: `/${node_path_1.win32.basename(uplugin.name, node_path_1.win32.extname(uplugin.name))}`, root: content });
        }
        if (depth >= 4)
            return;
        for (const e of entries)
            if (e.isDirectory && !SKIP.has(e.name))
                walk(node_path_1.win32.join(dir, e.name), depth + 1);
    };
    walk(node_path_1.win32.join(projectDir, 'Plugins'), 0);
    return mounts;
}
const under = (root, file) => file.toLowerCase().startsWith(root.toLowerCase() + node_path_1.win32.sep);
// Throws when the file is not under any mounted content root (an engine or unrelated .uasset).
function toPackagePath(file, mounts) {
    const f = node_path_1.win32.normalize(file);
    const mount = mounts.find((m) => under(m.root, f));
    if (!mount || !f.toLowerCase().endsWith('.uasset')) {
        throw new uproject_1.ResolveError(`${file} is not a .uasset under the project's Content folder or a plugin's Content folder`);
    }
    const rel = f.slice(mount.root.length + 1, -'.uasset'.length);
    return `${mount.name}/${rel.split(node_path_1.win32.sep).join('/')}`;
}
// Every .uasset below `dir`, sorted (maps and other files are not exported).
function uassetsIn(dir, fs) {
    const out = [];
    const walk = (d) => {
        for (const e of fs.list(d)) {
            const p = node_path_1.win32.join(d, e.name);
            if (e.isDirectory)
                walk(p);
            else if (e.name.toLowerCase().endsWith('.uasset'))
                out.push(p);
        }
    };
    walk(dir);
    return out.sort();
}
//# sourceMappingURL=packagePath.js.map
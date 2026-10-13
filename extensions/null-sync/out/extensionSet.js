'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeExtensions = mergeExtensions;
exports.parseIds = parseIds;
exports.installedIds = installedIds;
const sorted = (ids) => [...new Set(ids)].sort();
const sameSet = (a, b) => a.size === b.size && [...a].every((id) => b.has(id));
/**
 * Three-way set merge. `base` is what both sides agreed on at the last sync (`undefined` = never synced, so nothing
 * has been removed by either side). IDs pending install are deliberately left out of `nextBase`: remembering them
 * would make the next run read them as "uninstalled here" and push their removal. Removals still being reported are kept
 * in it for the opposite reason: dropping them would make the next run read them as new local additions and re-upload them.
 */
function mergeExtensions(local, remote, base) {
    const mine = new Set(local);
    const theirs = new Set(remote ?? []);
    const agreed = new Set(base ?? []);
    const install = [...theirs].filter((id) => !agreed.has(id) && !mine.has(id));
    const notifyRemoved = [...agreed].filter((id) => !theirs.has(id) && mine.has(id));
    const next = new Set([...theirs, ...[...mine].filter((id) => !agreed.has(id))]);
    for (const id of agreed) {
        if (!mine.has(id))
            next.delete(id);
    }
    return {
        install: sorted(install),
        notifyRemoved: sorted(notifyRemoved),
        push: remote !== null && sameSet(next, theirs) ? undefined : sorted(next),
        nextBase: sorted([...[...mine].filter((id) => next.has(id)), ...notifyRemoved]),
    };
}
/** The decrypted remote list: a JSON array of extension IDs; `undefined` if it is anything else. */
function parseIds(text) {
    try {
        const list = JSON.parse(text);
        return Array.isArray(list) && list.every((id) => typeof id === 'string')
            ? sorted(list.map((id) => id.toLowerCase()))
            : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * User-installed extension IDs from `extensions.json`. That file lists disabled extensions too (`vscode.extensions.all`
 * does not). `undefined` when the text is not a list, so an unreadable file is never mistaken for "everything was uninstalled".
 */
function installedIds(manifestText) {
    try {
        const list = JSON.parse(manifestText);
        if (!Array.isArray(list))
            return undefined;
        return sorted(list.flatMap((entry) => typeof entry?.identifier?.id === 'string' && entry.metadata?.isBuiltin !== true && entry.metadata?.isMachineScoped !== true
            ? [entry.identifier.id.toLowerCase()]
            : []));
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=extensionSet.js.map
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.planFile = planFile;
exports.planAll = planAll;
/**
 * Decides what to do with one file. `local` and `remote` are hashes of what each side holds now (`null` = absent);
 * `base` is each side's hash at the last successful sync (`undefined` = never synced on this device).
 * Each side is compared with its own half of `base`, so a pull that rewrote the text slightly does not look like a change.
 * For files that are not `deletable`, `null` is never a change: a missing file is "no local data" and is restored, not propagated.
 */
function planFile(local, remote, base, deletable) {
    if (local === remote)
        return 'none';
    if (local === null && (!deletable || base === undefined))
        return 'pull';
    if (remote === null && (!deletable || base === undefined))
        return 'push';
    if (base === undefined)
        return 'conflict';
    const localChanged = local !== base.local;
    const remoteChanged = remote !== base.remote;
    if (!localChanged && !remoteChanged)
        return 'none';
    if (!remoteChanged)
        return 'push';
    if (!localChanged)
        return 'pull';
    return 'conflict';
}
function planAll(files) {
    return Object.fromEntries(Object.entries(files).map(([file, s]) => [file, planFile(s.local, s.remote, s.base, s.deletable)]));
}
//# sourceMappingURL=syncPlan.js.map
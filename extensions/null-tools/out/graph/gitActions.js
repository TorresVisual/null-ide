/// <reference path="./protocol.ts" />
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkout = checkout;
exports.createBranch = createBranch;
exports.cherryPick = cherryPick;
exports.revert = revert;
exports.resumeOperation = resumeOperation;
exports.reset = reset;
exports.resetImpact = resetImpact;
const ok = (value) => ({ ok: true, value });
const fail = (message) => ({ ok: false, message });
const messageOf = (err) => (err instanceof Error ? err.message : String(err));
async function run(git, args) {
    try {
        await git(args);
        return ok(undefined);
    }
    catch (err) {
        return fail(messageOf(err));
    }
}
function checkout(git, target) {
    switch (target.kind) {
        case 'branch': return run(git, ['checkout', target.name, '--']);
        case 'remote': return run(git, ['switch', '--track', target.name]);
        case 'detach': return run(git, ['checkout', '--detach', target.sha]);
    }
}
async function createBranch(git, name, sha) {
    if (!name || name.startsWith('-'))
        return fail(`"${name}" is not a valid branch name.`);
    try {
        await git(['check-ref-format', '--branch', name]);
    }
    catch {
        return fail(`"${name}" is not a valid branch name.`);
    }
    return run(git, ['switch', '-c', name, sha]);
}
/** Runs a cherry-pick/revert/continue/skip/abort. A non-zero exit with the operation still in progress is a stop, not a failure. */
async function sequencer(git, inProgress, args) {
    try {
        const out = await git(args);
        return ok({ stopped: false, message: out.trim() });
    }
    catch (err) {
        if (await inProgress())
            return ok({ stopped: true, message: messageOf(err) });
        return fail(messageOf(err));
    }
}
const parentArgs = (parent) => (parent ? ['-m', String(parent)] : []);
function cherryPick(git, inProgress, sha, parent) {
    return sequencer(git, inProgress, ['cherry-pick', ...parentArgs(parent), sha]);
}
function revert(git, inProgress, sha, parent) {
    return sequencer(git, inProgress, ['revert', '--no-edit', ...parentArgs(parent), sha]);
}
async function resumeOperation(git, inProgress, action) {
    const operation = await inProgress();
    if (!operation)
        return fail('No operation is in progress.');
    if (operation.kind === 'merge' && action === 'skip')
        return fail('A merge cannot be skipped; continue or abort it.');
    return sequencer(git, inProgress, [operation.kind, `--${action}`]);
}
function reset(git, mode, sha) {
    return run(git, ['reset', `--${mode}`, sha, '--']);
}
async function count(git, args) {
    return Number((await git(args)).trim()) || 0;
}
async function resetImpact(git, sha) {
    try {
        let branch = null;
        try {
            branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() || null;
        }
        catch { /* detached */ }
        const leaving = await count(git, ['rev-list', '--count', 'HEAD', '--not', sha]);
        // After --not every later ref is negated; --exclude (before the glob) keeps the current branch from hiding its own commits.
        const orphaned = await count(git, [
            'rev-list', '--count', 'HEAD', '--not', sha, ...(branch ? [`--exclude=${branch}`] : []), '--branches', '--tags', '--remotes',
        ]);
        let trackedChanges = 0;
        try {
            trackedChanges = (await git(['diff', '--name-only', '-z', 'HEAD'])).split('\0').filter(Boolean).length;
        }
        catch { /* no commits */ }
        return ok({ branch, leaving, orphaned, trackedChanges });
    }
    catch (err) {
        return fail(messageOf(err));
    }
}
//# sourceMappingURL=gitActions.js.map
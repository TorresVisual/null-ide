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
exports.pull = pull;
exports.integrateUpstream = integrateUpstream;
exports.pullPreference = pullPreference;
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
/** Fast-forward only: a diverged branch is reported and left alone, so no merge commit and no conflict can appear. */
async function pull(git) {
    try {
        let upstream;
        try {
            upstream = (await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim();
        }
        catch {
            return ok({ kind: 'noUpstream' });
        }
        if (!upstream)
            return ok({ kind: 'noUpstream' });
        // The counts read the remote-tracking ref, which only a fetch moves; without this a pull never sees new commits.
        await git(['fetch']);
        const behind = await count(git, ['rev-list', '--count', 'HEAD..@{u}']);
        if (behind === 0)
            return ok({ kind: 'upToDate' });
        const ahead = await count(git, ['rev-list', '--count', '@{u}..HEAD']);
        if (ahead > 0)
            return ok({ kind: 'diverged', ahead, behind });
        await git(['pull', '--ff-only']);
        return ok({ kind: 'fastForwarded', commits: behind });
    }
    catch (err) {
        return fail(messageOf(err));
    }
}
/**
 * Brings a diverged branch level with its upstream. The caller has fetched already, so this never touches the network.
 * No --autostash: a dirty tree is refused by git and its message comes back as a failure.
 */
function integrateUpstream(git, inProgress, strategy) {
    return sequencer(git, inProgress, strategy === 'rebase' ? ['rebase', '@{u}'] : ['merge', '--no-edit', '@{u}']);
}
/** One `git config --get` value, lower-cased. '' when unset (git exits 1); null when the read failed for any other reason. */
async function configValue(git, key) {
    try {
        return (await git(['config', '--get', key])).trim().toLowerCase();
    }
    catch (err) {
        return err.code === 1 ? '' : null;
    }
}
/**
 * What the user's git config says a pull should do once the branch has diverged.
 * Same precedence as git: branch.<name>.rebase over pull.rebase; a rebase setting over pull.ff.
 * `merges` and `interactive` are not offered by Null, so they ask rather than silently rebase plainly.
 * Anything unset asks: that is what git itself does (it refuses and tells the user to choose).
 * A read that fails for any other reason also asks, and never falls through to a lower-precedence key.
 */
async function pullPreference(git) {
    let branch = '';
    try {
        branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
    }
    catch { /* detached */ }
    const scoped = branch ? await configValue(git, `branch.${branch}.rebase`) : '';
    if (scoped === null)
        return 'ask';
    const rebase = scoped || await configValue(git, 'pull.rebase');
    if (rebase === null)
        return 'ask';
    if (['true', 'yes', 'on', '1'].includes(rebase))
        return 'rebase';
    const ff = await configValue(git, 'pull.ff');
    if (ff === null)
        return 'ask';
    if (['false', 'no', 'off', '0'].includes(rebase))
        return ff === 'only' ? 'ff-only' : 'merge';
    if (rebase)
        return 'ask';
    if (ff === 'only')
        return 'ff-only';
    return ['false', 'no', 'off', '0'].includes(ff) ? 'merge' : 'ask';
}
//# sourceMappingURL=gitActions.js.map
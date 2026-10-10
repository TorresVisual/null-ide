'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitWiring = exports.WIRING_KEY = void 0;
exports.describeSkip = describeSkip;
const git_1 = require("./git");
const gitPlan_1 = require("./gitPlan");
const serial_1 = require("./serial");
exports.WIRING_KEY = 'null-accounts.gitWiring';
const stripNewline = (s) => s.replace(/\r?\n$/, '');
const INSIDE_REPO = ['rev-parse', '--is-inside-work-tree'];
const sameConfig = (entries, plan) => entries.length === plan.config.length && plan.config.every((c, i) => entries[i].key === c.key && entries[i].value === c.value);
const isRecord = (v) => typeof v === 'object' && v !== null && typeof v.accountId === 'string' && Array.isArray(v.entries);
/**
 * Applies each bound folder's account to its repo-local git config (`git config --local` only; global and
 * system config are never touched) and takes it back out when the folder is unbound.
 */
class GitWiring {
    deps;
    queue = (0, serial_1.serial)();
    constructor(deps) {
        this.deps = deps;
    }
    /** Brings every bound folder, and every folder we wired earlier, in line with the current bindings. Safe to call often. */
    reconcile() {
        return this.queue(async () => {
            const bound = new Map(this.deps.bindings.entries());
            const folders = new Set([...bound.keys(), ...Object.keys(this.records())]);
            const outcomes = [];
            for (const folder of folders) {
                outcomes.push(await this.syncFolder(folder, bound.get(folder)));
            }
            return outcomes;
        });
    }
    async syncFolder(folder, accountId) {
        const old = this.records()[folder];
        const account = accountId === undefined ? undefined : this.deps.accounts.get(accountId);
        if (!account) {
            if (!old) {
                return { folder, status: 'unchanged' };
            }
            return (await this.release(folder, old))
                ? { folder, status: 'cleared' }
                : { folder, status: 'skipped', reason: 'git-missing' };
        }
        const keyFile = (0, gitPlan_1.sshKeyFile)(account, this.deps.home);
        const keyMissing = keyFile !== '' && !this.deps.exists(keyFile);
        // A token account's key is optional: without the file it keeps its identity and credential, minus the SSH settings.
        const plan = (0, gitPlan_1.planFor)(keyMissing && account.authMethod !== 'ssh' ? { ...account, sshKeyPath: undefined, signCommits: undefined } : account, this.deps.home);
        if (old && old.accountId === account.id && sameConfig(old.entries, plan)) {
            return { folder, status: 'unchanged' };
        }
        // A skipped folder must not keep the previous account's identity.
        const skip = async (reason, detail) => {
            if (old && old.accountId !== account.id) {
                await this.release(folder, old);
            }
            return { folder, status: 'skipped', reason, detail };
        };
        // Checked first: git reports a folder that doesn't exist exactly like git not being installed.
        if (!this.deps.exists(folder)) {
            return skip('folder-missing');
        }
        if (keyMissing && account.authMethod === 'ssh') {
            return skip('ssh-key-missing', keyFile);
        }
        const probe = await this.deps.git(folder, INSIDE_REPO);
        if (probe.code === git_1.GIT_UNAVAILABLE) {
            return skip('git-missing');
        }
        if (probe.code !== 0) {
            return skip('not-a-repo', probe.stderr.trim().split(/\r?\n/)[0]);
        }
        if (old) {
            await this.restore(folder, old);
        }
        const entries = [];
        for (const { key, value } of plan.config) {
            const current = await this.deps.git(folder, ['config', '--local', '--get', key]);
            // ponytail: a key set several times collapses to one value here; `previous` keeps only the last.
            const previous = current.code === 0 ? stripNewline(current.stdout) : null;
            const set = await this.deps.git(folder, ['config', '--local', '--replace-all', key, value]);
            if (set.code !== 0) {
                await this.save(folder, { accountId: account.id, entries }); // keep what did land, so it can still be undone
                return { folder, status: 'skipped', reason: 'config-failed', detail: set.stderr.trim() };
            }
            entries.push({ key, value, previous });
        }
        // ponytail: a crash between the writes above and this save leaves keys with no record; they just stay until the next bind overwrites them.
        await this.save(folder, { accountId: account.id, entries });
        return { folder, status: 'wired' };
    }
    /** Puts back what each entry replaced, but only where the value is still the one we wrote: a hand edit since then is the user's. */
    async restore(folder, record) {
        for (const entry of [...record.entries].reverse()) {
            const current = await this.deps.git(folder, ['config', '--local', '--get', entry.key]);
            if (current.code === git_1.GIT_UNAVAILABLE) {
                return false;
            }
            if (current.code !== 0 || stripNewline(current.stdout) !== entry.value) {
                continue;
            }
            await this.deps.git(folder, entry.previous === null
                ? ['config', '--local', '--unset-all', entry.key]
                : ['config', '--local', '--replace-all', entry.key, entry.previous]);
        }
        return true;
    }
    /** Undoes a folder's wiring and forgets it. `false` (record kept) only when git can't run, so it is retried. */
    async release(folder, record) {
        if (this.deps.exists(folder)) {
            const probe = await this.deps.git(folder, INSIDE_REPO);
            if (probe.code === git_1.GIT_UNAVAILABLE) {
                return false;
            }
            if (probe.code === 0 && !(await this.restore(folder, record))) {
                return false;
            }
            // Not a repo any more (or the folder is gone): there is no config left to clean.
        }
        await this.save(folder, undefined);
        return true;
    }
    records() {
        const raw = this.deps.meta.get(exports.WIRING_KEY);
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            return {};
        }
        return Object.fromEntries(Object.entries(raw).filter((e) => isRecord(e[1])));
    }
    async save(folder, record) {
        const { [folder]: _old, ...rest } = this.records();
        await this.deps.meta.update(exports.WIRING_KEY, record ? { ...rest, [folder]: record } : rest);
    }
}
exports.GitWiring = GitWiring;
/** The warning worth showing for a skipped folder; `undefined` for the quiet reasons (a plain folder isn't an error). */
function describeSkip(outcome, folderName) {
    switch (outcome.reason) {
        case 'git-missing': return `git was not found on your PATH, so the git identity for "${folderName}" was not set.`;
        case 'ssh-key-missing': return `The SSH key ${outcome.detail} was not found; the git settings for "${folderName}" were not changed.`;
        case 'config-failed': return `git refused a setting for "${folderName}": ${outcome.detail}`;
        case 'not-a-repo':
        case 'folder-missing': return undefined;
    }
}
//# sourceMappingURL=gitWiring.js.map
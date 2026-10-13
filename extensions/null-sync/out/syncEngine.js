'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncEngine = void 0;
const crypto = __importStar(require("crypto"));
const cryptoBox_1 = require("./cryptoBox");
const extensionSet_1 = require("./extensionSet");
const gistStore_1 = require("./gistStore");
const layout_1 = require("./layout");
const settingsFilter_1 = require("./settingsFilter");
const syncPlan_1 = require("./syncPlan");
const types_1 = require("./types");
/** Gist files over 1 MB are truncated by the API; stay well below. */
const MAX_FILE_BYTES = 900_000;
const hash = (text) => (text === null ? null : crypto.createHash('sha256').update(text).digest('hex'));
const enabledCategories = (c) => types_1.CATEGORIES.filter((category) => c[category]);
const tooLarge = (content) => content !== null && Buffer.byteLength(content) > MAX_FILE_BYTES;
const CLEARED = {
    conflicts: [],
    pending: [],
    pendingInstalls: [],
    pendingRemovals: [],
    lastSyncedAt: undefined,
    message: undefined,
};
class SyncEngine {
    d;
    status;
    listeners = new Set();
    tail = Promise.resolve();
    constructor(d) {
        this.d = d;
        this.status = { conflicts: [], pending: [], pendingInstalls: [], pendingRemovals: [], state: d.enabled() ? 'idle' : 'disabled' };
    }
    getStatus() {
        return this.status;
    }
    onDidChange(listener) {
        this.listeners.add(listener);
        return { dispose: () => void this.listeners.delete(listener) };
    }
    set(patch) {
        this.status = { ...this.status, ...patch };
        for (const listener of this.listeners)
            listener();
    }
    /** Runs one sync. Never rejects. A background run (`interactive: false`) never prompts and skips quietly when another window is syncing. */
    run(options) {
        if (!this.d.enabled()) {
            this.set({ ...CLEARED, state: 'disabled' });
            return Promise.resolve();
        }
        return this.serialized(async () => {
            this.set({ state: 'syncing' });
            const conn = await this.connect(options.interactive);
            if (conn)
                await this.sync(conn, options);
        }, !options.interactive);
    }
    /** `idle` or `needsAttention`, from what is still outstanding. */
    settle() {
        const s = this.status;
        const outstanding = s.conflicts.length + s.pending.length + s.pendingInstalls.length + s.pendingRemovals.length;
        this.set({ state: outstanding > 0 ? 'needsAttention' : 'idle', message: undefined });
    }
    /** `mine` uploads this device's file; `theirs` backs it up and applies the remote one. */
    resolve(file, side) {
        return this.serialized(async () => {
            const c = await this.connect(true);
            if (!c)
                return;
            const i = this.inspect(c, file, await this.d.files.read(file));
            if (typeof i === 'string') {
                this.set({ state: 'error', message: i });
                return;
            }
            const base = { ...c.st.base };
            if (side === 'mine') {
                if (tooLarge(i.content)) {
                    this.set({ state: 'error', message: `${file} is too large to sync.` });
                    return;
                }
                const updated = await c.store.update(c.st.gistId, { [i.name]: i.content === null ? null : (0, cryptoBox_1.seal)(c.key, i.name, i.content) });
                if (!updated.ok) {
                    this.failed(updated);
                    return;
                }
                base[file] = { local: i.lv, remote: i.lv };
            }
            else {
                const applied = await this.applyPull(i);
                if (typeof applied === 'string') {
                    this.set({ state: 'error', message: applied });
                    return;
                }
                base[file] = applied.base;
            }
            await this.d.setState({ ...c.st, base });
            this.set({ conflicts: this.status.conflicts.filter((x) => x.file !== file) });
            this.settle();
        }, false);
    }
    /** The decrypted remote text of a file, for a diff; `undefined` if there is none. */
    async previewRemote(file) {
        await this.tail;
        const c = await this.connect(true);
        const i = c && this.inspect(c, file, null);
        return typeof i === 'object' ? (i.plain ?? undefined) : undefined;
    }
    /** The Gist's revisions, newest first; `undefined` (with the status set) if they cannot be read. */
    async revisions() {
        await this.tail;
        const c = await this.connect(true);
        if (!c)
            return undefined;
        const revisions = await c.store.revisions(c.st.gistId);
        return revisions.ok ? revisions.value : this.failed(revisions);
    }
    /** Applies an earlier revision locally and uploads it as a new revision, so every other device rolls back too. */
    restore(revision) {
        return this.serialized(async () => {
            const c = await this.connect(true);
            if (!c)
                return;
            const snapshot = await c.store.readRevision(c.st.gistId, revision);
            if (!snapshot.ok) {
                if (snapshot.kind === 'notFound')
                    this.set({ state: 'error', message: 'That revision no longer exists.' });
                else
                    this.failed(snapshot);
                return;
            }
            const categories = enabledCategories(this.d.categories());
            const problems = [];
            const base = { ...c.st.base };
            const changes = {};
            const pushed = {};
            for (const [name, encrypted] of Object.entries(snapshot.value.files)) {
                const file = (0, layout_1.fileOfRemoteName)(name);
                if (file === undefined || !categories.includes((0, layout_1.categoryOf)(file)))
                    continue;
                const plain = (0, cryptoBox_1.open)(c.key, name, encrypted);
                if (plain === undefined) {
                    problems.push(`Could not decrypt ${name} in that revision.`);
                    continue;
                }
                const raw = await this.d.files.read(file);
                const applied = await this.applyPull({ file, name, raw, content: plain, plain, lv: hash(plain), rv: hash(plain) });
                if (typeof applied === 'string') {
                    problems.push(applied);
                    continue;
                }
                const uploaded = applied.uploaded ?? plain;
                changes[name] = (0, cryptoBox_1.seal)(c.key, name, uploaded);
                pushed[file] = { local: hash(uploaded), remote: hash(uploaded) };
            }
            if (Object.keys(changes).length > 0) {
                const updated = await c.store.update(c.st.gistId, changes);
                if (!updated.ok) {
                    this.failed(updated);
                    return;
                }
                Object.assign(base, pushed);
            }
            await this.d.setState({ ...c.st, base });
            this.set({ conflicts: this.status.conflicts.filter((x) => !(x.file in pushed)) });
            if (problems.length > 0)
                this.set({ state: 'error', message: problems.join(' ') });
            else
                this.settle();
        }, false);
    }
    /** Forgets this device (state and passphrase); optionally deletes the cloud copy first. Local files are never touched. */
    async stop(deleteGist) {
        await this.tail;
        const st = this.d.state.get();
        if (deleteGist && st) {
            const account = (await this.d.accounts()).find((a) => a.id === st.accountId);
            const token = account && (await this.d.token(account.id, true));
            if (!token)
                return { ok: false, message: 'Could not get a GitHub token to delete the Gist.' };
            const removed = await (0, gistStore_1.createGistStore)(this.d.io, token).remove(st.gistId);
            if (!removed.ok && removed.kind !== 'notFound')
                return { ok: false, message: removed.message };
        }
        await this.d.setState(undefined);
        await this.d.clearPassphrase();
        this.set({ ...CLEARED, state: 'disabled' });
        return { ok: true };
    }
    /** One task at a time, under the cross-window lock. Never rejects. */
    serialized(task, quiet) {
        const next = this.tail.then(async () => {
            try {
                const release = await this.d.lock();
                if (!release) {
                    if (!quiet)
                        this.set({ message: 'Another window is syncing. Try again in a moment.' });
                    return;
                }
                try {
                    await task();
                }
                finally {
                    await release();
                }
            }
            catch (err) {
                this.set({ state: 'error', message: `Sync failed (${err instanceof Error ? err.message : String(err)}).` });
            }
        });
        this.tail = next;
        return next;
    }
    /** Sets the status for a failed Gist call and returns `undefined` so callers can `return this.failed(...)`. */
    failed(failure) {
        this.set({
            state: failure.kind === 'offline' ? 'offline' : failure.kind === 'error' ? 'error' : 'signedOut',
            message: failure.kind === 'notFound'
                ? 'The sync Gist no longer exists. Run "Null: Enable Settings Sync" to create a new one.'
                : failure.message,
        });
        return undefined;
    }
    /** Account, token, passphrase and the current remote files; sets the status and returns `undefined` if any is missing. */
    async connect(interactive) {
        const { d } = this;
        const st = d.state.get();
        const passphrase = await d.passphrase();
        const account = st && (await d.accounts()).find((a) => a.id === st.accountId);
        if (!st || !account || !passphrase) {
            this.set({ state: 'signedOut', message: 'Run "Null: Enable Settings Sync" to set up sync on this device.' });
            return undefined;
        }
        const token = await d.token(account.id, interactive);
        if (!token) {
            this.set({ state: 'signedOut', message: `Sign in to @${account.username} in Null Accounts (with the gist scope) to sync.` });
            return undefined;
        }
        const store = (0, gistStore_1.createGistStore)(d.io, token);
        const read = await store.read(st.gistId);
        if (!read.ok)
            return this.failed(read);
        const key = await (0, cryptoBox_1.unlock)(passphrase, read.value.files[layout_1.MANIFEST]);
        if (!key) {
            this.set({ state: 'error', message: 'The saved passphrase does not match this sync store. Run "Null: Enable Settings Sync" again.' });
            return undefined;
        }
        return { st, store, key, files: read.value.files };
    }
    /** Both sides of one file, or a message if either cannot be used. */
    inspect(c, file, raw) {
        const name = (0, layout_1.remoteNameOf)(file);
        let content = raw;
        if (file === layout_1.SETTINGS && raw !== null) {
            const stripped = (0, settingsFilter_1.stripExcluded)(raw, this.d.excluded());
            if (stripped === undefined)
                return 'settings.json is not valid JSON, so it was not synced.';
            content = stripped;
        }
        let plain = null;
        const encrypted = c.files[name];
        if (encrypted !== undefined) {
            const opened = (0, cryptoBox_1.open)(c.key, name, encrypted);
            if (opened === undefined)
                return `Could not decrypt ${name}; it was left alone.`;
            plain = opened;
        }
        return { file, name, raw, content, plain, lv: hash(content), rv: hash(plain) };
    }
    /** Writes the remote version locally (back-up first). `uploaded` is what this device would now upload for the file. */
    async applyPull(i) {
        let text = i.plain;
        if (i.file === layout_1.SETTINGS && i.plain !== null) {
            const merged = (0, settingsFilter_1.reapplyExcluded)(i.plain, i.raw, this.d.excluded());
            if (merged === undefined)
                return 'The synced settings.json is not valid JSON and was not applied.';
            text = merged;
        }
        await this.d.files.write(i.file, text);
        const uploaded = i.file === layout_1.SETTINGS && text !== null ? ((0, settingsFilter_1.stripExcluded)(text, this.d.excluded()) ?? text) : text;
        return { base: { local: hash(uploaded), remote: i.rv }, uploaded };
    }
    async sync(c, { interactive, firstSync }) {
        const { d } = this;
        const categories = enabledCategories(d.categories());
        const raws = await d.files.list(categories);
        const names = new Set(Object.keys(raws));
        for (const file of layout_1.CORE_FILES) {
            if (categories.includes((0, layout_1.categoryOf)(file)))
                names.add(file);
        }
        for (const name of Object.keys(c.files)) {
            const file = (0, layout_1.fileOfRemoteName)(name);
            if (file !== undefined && categories.includes((0, layout_1.categoryOf)(file)))
                names.add(file);
        }
        const problems = [];
        const conflicts = [];
        const pending = [];
        const base = { ...c.st.base };
        const changes = {};
        const pushed = {};
        for (const file of [...names].sort()) {
            const i = this.inspect(c, file, raws[file] ?? null);
            if (typeof i === 'string') {
                problems.push(i);
                continue;
            }
            const prior = c.st.base[file];
            let action = (0, syncPlan_1.planFile)(i.lv, i.rv, prior, (0, layout_1.isDeletable)(file));
            if (action === 'conflict' && prior === undefined && firstSync)
                action = firstSync === 'cloud' ? 'pull' : 'push';
            switch (action) {
                case 'none':
                    base[file] = { local: i.lv, remote: i.rv };
                    break;
                case 'conflict':
                    conflicts.push({ file, category: (0, layout_1.categoryOf)(file) });
                    break;
                case 'push':
                    if (tooLarge(i.content)) {
                        problems.push(`${file} is too large to sync.`);
                        break;
                    }
                    changes[i.name] = i.content === null ? null : (0, cryptoBox_1.seal)(c.key, i.name, i.content);
                    pushed[file] = { local: i.lv, remote: i.lv };
                    break;
                case 'pull': {
                    if (d.files.isDirty(file) && !(interactive && d.confirmOverwrite && (await d.confirmOverwrite(file)))) {
                        pending.push(file);
                        break;
                    }
                    const applied = await this.applyPull(i);
                    if (typeof applied === 'string')
                        problems.push(applied);
                    else
                        base[file] = applied.base;
                    break;
                }
            }
        }
        let extensionsBase = c.st.extensionsBase;
        let pendingInstalls = [];
        let pendingRemovals = [];
        if (categories.includes('extensions') && d.extensions) {
            const merged = await this.syncExtensions(c, d.extensions, interactive, problems);
            if (merged) {
                pendingInstalls = merged.pendingInstalls;
                pendingRemovals = merged.pendingRemovals;
                extensionsBase = merged.nextBase;
                if (merged.push)
                    changes[layout_1.EXTENSIONS_REMOTE] = (0, cryptoBox_1.seal)(c.key, layout_1.EXTENSIONS_REMOTE, JSON.stringify(merged.push));
            }
        }
        if (Object.keys(changes).length > 0) {
            const updated = await c.store.update(c.st.gistId, changes);
            if (!updated.ok) {
                // Pulls already happened, so remember them; the extension base stays put until the upload works.
                await d.setState({ ...c.st, base });
                this.failed(updated);
                this.set({ conflicts, pending, pendingInstalls, pendingRemovals });
                return;
            }
            Object.assign(base, pushed);
        }
        const lastSyncedAt = d.now();
        await d.setState({ ...c.st, base, extensionsBase, lastSyncedAt });
        const outstanding = conflicts.length + pending.length + pendingInstalls.length + pendingRemovals.length;
        this.set({
            state: problems.length > 0 ? 'error' : outstanding > 0 ? 'needsAttention' : 'idle',
            message: problems.length > 0 ? problems.join(' ') : undefined,
            lastSyncedAt,
            conflicts,
            pending,
            pendingInstalls,
            pendingRemovals,
        });
    }
    /**
     * Merges the installed-extension list with the remote one. Only an interactive run installs; removals are only ever
     * reported. `undefined` (with a message in `problems`) when either list cannot be read, so nothing is changed.
     */
    async syncExtensions(c, host, interactive, problems) {
        let remote = null;
        const encrypted = c.files[layout_1.EXTENSIONS_REMOTE];
        if (encrypted !== undefined) {
            const plain = (0, cryptoBox_1.open)(c.key, layout_1.EXTENSIONS_REMOTE, encrypted);
            const ids = plain === undefined ? undefined : (0, extensionSet_1.parseIds)(plain);
            if (ids === undefined) {
                problems.push(`Could not read ${layout_1.EXTENSIONS_REMOTE}; the extension list was left alone.`);
                return undefined;
            }
            remote = ids;
        }
        const installed = await host.installed();
        if (installed === undefined) {
            problems.push('Could not read the installed extensions; the extension list was not synced.');
            return undefined;
        }
        let local = installed;
        let merge = (0, extensionSet_1.mergeExtensions)(local, remote, c.st.extensionsBase);
        if (interactive && merge.install.length > 0) {
            for (const id of merge.install) {
                if (await host.install(id))
                    local = [...local, id];
                else
                    problems.push(`Could not install ${id}.`);
            }
            merge = (0, extensionSet_1.mergeExtensions)(local, remote, c.st.extensionsBase);
        }
        return { pendingInstalls: merge.install, pendingRemovals: merge.notifyRemoved, push: merge.push, nextBase: merge.nextBase };
    }
    /** Uninstalls an extension that was removed on another device, and stops reporting it. */
    async uninstallRemoved(id) {
        await this.tail;
        const host = this.d.extensions;
        const st = this.d.state.get();
        if (!host || !st || !this.status.pendingRemovals.includes(id))
            return;
        if (!(await host.uninstall(id))) {
            this.set({ state: 'error', message: `Could not uninstall ${id}.` });
            return;
        }
        await this.d.setState({ ...st, extensionsBase: (st.extensionsBase ?? []).filter((x) => x !== id) });
        this.set({ pendingRemovals: this.status.pendingRemovals.filter((x) => x !== id) });
        this.settle();
    }
}
exports.SyncEngine = SyncEngine;
//# sourceMappingURL=syncEngine.js.map
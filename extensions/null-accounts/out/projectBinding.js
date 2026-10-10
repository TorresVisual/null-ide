'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectBinding = exports.ADOPTED_KEY = exports.DEFAULT_KEY = exports.BINDINGS_KEY = void 0;
exports.folderKey = folderKey;
const node_path_1 = __importDefault(require("node:path"));
const changeEmitter_1 = require("./changeEmitter");
exports.BINDINGS_KEY = 'null-accounts.bindings';
exports.DEFAULT_KEY = 'null-accounts.defaultAccount';
exports.ADOPTED_KEY = 'null-accounts.defaultAdopted';
/** Stable key for a folder: absolute, forward slashes, no trailing separator; case-folded on Windows (case-insensitive filesystem). */
function folderKey(fsPath, platform = process.platform) {
    const win = platform === 'win32';
    const resolved = (win ? node_path_1.default.win32 : node_path_1.default.posix).resolve(fsPath).replace(/\\/g, '/');
    return win ? resolved.toLowerCase() : resolved;
}
/**
 * folder key -> account id, in `globalState` so the dashboard can read bindings for projects that
 * aren't open. Every write reads and updates with no `await` in between, so overlapping calls
 * can't lose each other's changes.
 */
class ProjectBinding {
    meta;
    platform;
    emitter = new changeEmitter_1.ChangeEmitter();
    onDidChange = this.emitter.event;
    constructor(meta, platform = process.platform) {
        this.meta = meta;
        this.platform = platform;
    }
    accountIdFor(folderPath) {
        return this.read()[folderKey(folderPath, this.platform)];
    }
    /** Every binding as [folder key, account id]. Keys are in `folderKey` form (lower-cased on Windows). */
    entries() {
        return Object.entries(this.read());
    }
    async bind(folderPath, accountId) {
        const key = folderKey(folderPath, this.platform);
        const bindings = this.read();
        if (bindings[key] === accountId) {
            return;
        }
        await this.write({ ...bindings, [key]: accountId });
    }
    async unbind(folderPath) {
        const key = folderKey(folderPath, this.platform);
        const { [key]: removed, ...rest } = this.read();
        if (removed === undefined) {
            return;
        }
        await this.write(rest);
    }
    /** The account new projects start with, if one is set. */
    defaultId() {
        const raw = this.meta.get(exports.DEFAULT_KEY);
        return typeof raw === 'string' && raw !== '' ? raw : undefined;
    }
    async setDefault(accountId) {
        if (this.defaultId() === accountId) {
            return;
        }
        await this.meta.update(exports.DEFAULT_KEY, accountId);
        this.emitter.fire();
    }
    /** Whether the default account has already been offered to this folder (see `adoptFolder`). */
    wasAdopted(folderPath) {
        return this.adopted().includes(folderKey(folderPath, this.platform));
    }
    /**
     * Gives a folder its first account: binds it to `accountId` unless it already has a binding. Happens once
     * per folder, so choosing "no account" for it later sticks instead of being undone on the next open.
     */
    async adoptFolder(folderPath, accountId) {
        if (this.wasAdopted(folderPath)) {
            return;
        }
        await this.meta.update(exports.ADOPTED_KEY, [...this.adopted(), folderKey(folderPath, this.platform)]);
        if (this.accountIdFor(folderPath) === undefined) {
            await this.bind(folderPath, accountId);
        }
    }
    /** Drops bindings (and the default) whose account no longer exists. */
    async prune(validIds) {
        const defaultId = this.defaultId();
        if (defaultId !== undefined && !validIds.has(defaultId)) {
            await this.setDefault(undefined);
        }
        const entries = Object.entries(this.read());
        const kept = entries.filter(([, id]) => validIds.has(id));
        if (kept.length === entries.length) {
            return;
        }
        await this.write(Object.fromEntries(kept));
    }
    adopted() {
        const raw = this.meta.get(exports.ADOPTED_KEY);
        return Array.isArray(raw) ? raw.filter((k) => typeof k === 'string') : [];
    }
    read() {
        const raw = this.meta.get(exports.BINDINGS_KEY);
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            return {};
        }
        return Object.fromEntries(Object.entries(raw).filter((e) => typeof e[1] === 'string'));
    }
    async write(bindings) {
        await this.meta.update(exports.BINDINGS_KEY, bindings);
        this.emitter.fire();
    }
}
exports.ProjectBinding = ProjectBinding;
//# sourceMappingURL=projectBinding.js.map
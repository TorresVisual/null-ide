'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectBinding = exports.BINDINGS_KEY = void 0;
exports.folderKey = folderKey;
const node_path_1 = __importDefault(require("node:path"));
const changeEmitter_1 = require("./changeEmitter");
exports.BINDINGS_KEY = 'null-accounts.bindings';
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
    /** Drops bindings whose account no longer exists. */
    async prune(validIds) {
        const entries = Object.entries(this.read());
        const kept = entries.filter(([, id]) => validIds.has(id));
        if (kept.length === entries.length) {
            return;
        }
        await this.write(Object.fromEntries(kept));
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
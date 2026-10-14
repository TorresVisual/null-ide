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
exports.Device = void 0;
exports.cleanup = cleanup;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const enable_1 = require("./enable");
const localFiles_1 = require("./localFiles");
const syncEngine_1 = require("./syncEngine");
const types_1 = require("./types");
const roots = [];
/** Deletes every temp folder the devices created; call from `after()`. */
function cleanup() {
    for (const dir of roots.splice(0))
        fs.rmSync(dir, { recursive: true, force: true });
}
/** One machine: its own user-data folder, remembered state, passphrase and settings, talking to a shared fake Gist. */
class Device {
    gist;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-device-'));
    userDir = path.join(this.root, 'User');
    backupsDir = path.join(this.root, 'backups');
    /** Files (e.g. `keybindings.json`) that count as open with unsaved edits. */
    dirty = new Set();
    engine;
    enabled = true;
    /** Another window holds the cross-window lock. */
    locked = false;
    /** What an interactive run answers when asked to overwrite a file with unsaved edits. */
    overwrite = false;
    state;
    passphrase;
    categories = { settings: true, keybindings: true, snippets: true, extensions: true, activity: false };
    excluded = ['*.path', '*token*'];
    /** The extensions installed on this machine (enabled or not). */
    installed = new Set();
    /** Extension IDs whose install fails, like one that is not in the gallery. */
    failing = new Set();
    /** The on-disk extension list cannot be read. */
    manifestBroken = false;
    /** While set, an uninstall waits for it (a slow `workbench.extensions.uninstallExtension`). */
    uninstallGate;
    account = { id: 'acc', username: 'me' };
    clock = 1;
    constructor(gist) {
        this.gist = gist;
        roots.push(this.root);
        fs.mkdirSync(path.join(this.userDir, 'snippets'), { recursive: true });
        const files = new localFiles_1.LocalFiles({
            userDir: this.userDir,
            backupsDir: this.backupsDir,
            now: () => this.clock++,
            isDirty: (p) => this.dirty.has(path.relative(this.userDir, p).split(path.sep).join('/')),
        });
        this.engine = new syncEngine_1.SyncEngine({
            enabled: () => this.enabled,
            categories: () => this.categories,
            excluded: () => this.excluded,
            accounts: async () => [this.account],
            token: async () => 'token',
            io: gist.io,
            files,
            passphrase: async () => this.passphrase,
            clearPassphrase: async () => { this.passphrase = undefined; },
            state: { get: () => this.state },
            setState: async (s) => { this.state = s; },
            lock: async () => (this.locked ? undefined : async () => undefined),
            now: () => this.clock++,
            confirmOverwrite: async () => this.overwrite,
            extensions: {
                installed: async () => (this.manifestBroken ? undefined : [...this.installed].sort()),
                install: async (id) => {
                    if (this.failing.has(id))
                        return false;
                    this.installed.add(id);
                    return true;
                },
                uninstall: async (id) => {
                    await this.uninstallGate;
                    return this.installed.delete(id);
                },
            },
        });
    }
    get status() {
        return this.engine.getStatus();
    }
    abs(file) {
        return path.join(this.userDir, ...file.split('/'));
    }
    write(file, text) {
        fs.mkdirSync(path.dirname(this.abs(file)), { recursive: true });
        fs.writeFileSync(this.abs(file), text);
    }
    read(file) {
        try {
            return fs.readFileSync(this.abs(file), 'utf8');
        }
        catch {
            return null;
        }
    }
    remove(file) {
        fs.rmSync(this.abs(file), { force: true });
    }
    /** Backup files whose name starts with `prefix`, e.g. `keybindings.json.`. */
    backups(prefix) {
        return fs.existsSync(this.backupsDir) ? fs.readdirSync(this.backupsDir).filter((n) => n.startsWith(prefix)) : [];
    }
    /** A background run (the timer / file watcher). */
    run() {
        return this.engine.run({ interactive: false });
    }
    /** `Null: Sync Settings Now`. */
    syncNow() {
        return this.engine.run({ interactive: true });
    }
    /** The Enable command: set this device up, then run once like the command does. */
    async enable(passphrase, firstSync = 'each') {
        const result = await (0, enable_1.enable)({
            accounts: async () => [this.account],
            token: async () => 'token',
            io: this.gist.io,
            categories: () => types_1.CATEGORIES.filter((c) => this.categories[c]),
            savePassphrase: async (p) => { this.passphrase = p; },
            setState: async (s) => { this.state = s; },
        }, {
            chooseAccount: async (accounts) => accounts[0],
            consent: async () => true,
            newPassphrase: async () => passphrase,
            existingPassphrase: async () => passphrase,
            firstSync: async () => firstSync,
        });
        if (result.ok)
            await this.engine.run({ interactive: true, firstSync: result.firstSync });
        return result;
    }
}
exports.Device = Device;
//# sourceMappingURL=testDevice.js.map
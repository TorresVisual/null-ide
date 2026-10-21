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
exports.PresenceOwnership = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Decides which Null IDE window owns the Discord presence.
 *
 * Every window runs its own extension host, so without coordination they all
 * publish and Discord flaps between projects. Ownership is claimed on focus and
 * recorded in a small file in globalStorage, which every window of the same
 * installation can see. Non-owners disconnect entirely and poll to take over if
 * the owner disappears.
 */
const DEFAULT_CLAIM_FILE = 'discord-presence-owner.json';
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        // Signal 0 performs the permission/existence check without sending anything.
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        // EPERM means the process exists but belongs to someone else.
        return err.code === 'EPERM';
    }
}
class PresenceOwnership {
    log;
    file;
    lastLoggedOwner = -1;
    /** Without a storage directory (tests, older hosts) ownership is always granted. */
    constructor(storageDir, log = () => undefined, claimFile = DEFAULT_CLAIM_FILE) {
        this.log = log;
        if (!storageDir) {
            this.file = undefined;
            return;
        }
        this.file = path.join(storageDir, claimFile);
        try {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        catch {
            // A unusable storage dir degrades to single-window behaviour.
        }
    }
    /** Marks this window as the presence owner. Called when the window takes focus. */
    claim(workspace) {
        if (!this.file) {
            return;
        }
        const claim = { pid: process.pid, focusedAt: Date.now(), workspace };
        const temp = `${this.file}.${process.pid}.tmp`;
        try {
            // Write-then-rename so another window never observes a half-written claim.
            fs.writeFileSync(temp, JSON.stringify(claim), 'utf8');
            fs.renameSync(temp, this.file);
        }
        catch (err) {
            this.log(`Could not claim presence ownership: ${err.message}`);
            try {
                fs.unlinkSync(temp);
            }
            catch { /* nothing to clean up */ }
        }
    }
    /**
     * True when this window should publish. Takes over automatically if the
     * recorded owner is gone or the claim is unreadable.
     */
    isOwner(workspace) {
        if (!this.file) {
            return true;
        }
        const claim = this.read();
        if (!claim) {
            this.claim(workspace);
            return true;
        }
        if (claim.pid === process.pid) {
            return true;
        }
        if (!isProcessAlive(claim.pid)) {
            this.log(`Presence owner (pid ${claim.pid}) is gone — taking over.`);
            this.claim(workspace);
            return true;
        }
        if (this.lastLoggedOwner !== claim.pid) {
            this.lastLoggedOwner = claim.pid;
            const where = claim.workspace ? ` (${claim.workspace})` : '';
            this.log(`Another Null IDE window${where} owns the presence — staying quiet.`);
        }
        return false;
    }
    /** Gives up ownership so a sibling window can take over immediately. */
    release() {
        if (!this.file) {
            return;
        }
        const claim = this.read();
        if (!claim || claim.pid !== process.pid) {
            return;
        }
        try {
            fs.unlinkSync(this.file);
        }
        catch {
            // Already gone, or another window replaced it.
        }
    }
    read() {
        if (!this.file) {
            return undefined;
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            return typeof parsed?.pid === 'number' ? parsed : undefined;
        }
        catch {
            // Missing or corrupt — treated as "no owner" by the caller.
            return undefined;
        }
    }
}
exports.PresenceOwnership = PresenceOwnership;
//# sourceMappingURL=presenceOwnership.js.map
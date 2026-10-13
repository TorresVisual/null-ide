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
exports.acquire = acquire;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const STALE_MS = 120_000;
/**
 * Several windows share one user-data folder and each runs the sync timers. A run takes this lock first and
 * skips when another window holds it. A lock older than `staleMs` belongs to a crashed window and is taken over.
 * Never throws. ponytail: a lock file with a stale timeout, not leader election; two windows taking over the same
 * stale lock in the same instant can both proceed, which the three-way plan tolerates (the second push is a no-op).
 */
async function acquire(lockPath, now = Date.now, staleMs = STALE_MS) {
    try {
        await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const handle = await fs.promises.open(lockPath, 'wx');
                await handle.writeFile(`${process.pid} ${now()}`);
                await handle.close();
                return () => fs.promises.rm(lockPath, { force: true });
            }
            catch (err) {
                if (err.code !== 'EEXIST')
                    return undefined;
                const stat = await fs.promises.stat(lockPath).catch(() => undefined);
                if (stat && now() - stat.mtimeMs < staleMs)
                    return undefined;
                await fs.promises.rm(lockPath, { force: true });
            }
        }
    }
    catch {
        /* an unusable path means no sync this time */
    }
    return undefined;
}
//# sourceMappingURL=lock.js.map
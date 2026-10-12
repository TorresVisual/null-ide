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
exports.SNAPSHOT_COMMAND = void 0;
exports.takeSnapshot = takeSnapshot;
const vscode = __importStar(require("vscode"));
const snapshot_1 = require("./snapshot");
exports.SNAPSHOT_COMMAND = '_null.startup.snapshot';
const TIMEOUT_MS = 10_000;
/** Calls the internal command added by patch 010; on a build without it, logs and returns undefined. */
async function takeSnapshot(log) {
    let timer;
    try {
        const raw = await Promise.race([
            Promise.resolve(vscode.commands.executeCommand(exports.SNAPSHOT_COMMAND)),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS);
            }),
        ]);
        const snapshot = (0, snapshot_1.parseSnapshot)(raw);
        if (!snapshot)
            log('startup snapshot had an unexpected shape; ignored');
        return snapshot;
    }
    catch (err) {
        log(`startup snapshot unavailable (needs a Null IDE build with patch 010): ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
//# sourceMappingURL=snapshotSource.js.map
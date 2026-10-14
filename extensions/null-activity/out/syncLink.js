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
exports.startActivitySync = startActivitySync;
const vscode = __importStar(require("vscode"));
const activitySync_1 = require("./activitySync");
const STARTUP_MS = 10_000;
const INTERVAL_MS = 10 * 60_000;
/** null-sync is optional: without it (or with the activity category off) the port is missing or refuses and nothing leaves the device. */
async function syncPort() {
    const ext = vscode.extensions.getExtension('null.null-sync');
    if (!ext)
        return undefined;
    const api = ext.isActive ? ext.exports : await ext.activate();
    return typeof api?.syncActivity === 'function' ? api : undefined;
}
/** Runs the activity sync shortly after startup and every 10 minutes, silently. */
function startActivitySync(deps) {
    const sync = new activitySync_1.ActivitySync({ ...deps, port: syncPort });
    const run = () => void sync.run();
    const startup = setTimeout(run, STARTUP_MS);
    const timer = setInterval(run, INTERVAL_MS);
    return { dispose: () => { clearTimeout(startup); clearInterval(timer); } };
}
//# sourceMappingURL=syncLink.js.map
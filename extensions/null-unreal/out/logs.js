"use strict";
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
exports.openLog = openLog;
exports.rotate = rotate;
exports.latestLog = latestLog;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const pad = (n) => String(n).padStart(2, '0');
function stamp(d) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function logDir(projectDir) {
    return path.join(projectDir, 'Saved', 'NullUnreal');
}
// A run always keeps its log. When the folder cannot be made, the run still goes ahead without one.
function openLog(projectDir, cmd, now) {
    const dir = logDir(projectDir);
    try {
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${cmd}-${stamp(now)}.log`);
        const fd = fs.openSync(file, 'w');
        return { path: file, stream: fs.createWriteStream(file, { fd }) };
    }
    catch (e) {
        return { path: undefined, warning: `could not create ${dir}: ${e.message}` };
    }
}
// Stamps sort chronologically by name, so the oldest are the first in sorted order.
function rotate(projectDir, cmd, keep = 10) {
    const dir = logDir(projectDir);
    let names;
    try {
        names = fs.readdirSync(dir);
    }
    catch {
        return;
    }
    const re = new RegExp(`^${cmd}-\\d{8}-\\d{6}\\.log$`);
    const old = names.filter((n) => re.test(n)).sort();
    for (const n of old.slice(0, Math.max(0, old.length - keep))) {
        try {
            fs.rmSync(path.join(dir, n), { force: true });
        }
        catch {
            // A locked log (Windows keeps files open) is not worth failing a run for.
        }
    }
}
// The newest log of one command, or undefined when none exists yet.
function latestLog(projectDir, cmd) {
    const dir = logDir(projectDir);
    let names;
    try {
        names = fs.readdirSync(dir);
    }
    catch {
        return undefined;
    }
    const re = new RegExp(`^${cmd}-\\d{8}-\\d{6}\\.log$`);
    const newest = names.filter((n) => re.test(n)).sort().pop();
    return newest ? path.join(dir, newest) : undefined;
}
//# sourceMappingURL=logs.js.map
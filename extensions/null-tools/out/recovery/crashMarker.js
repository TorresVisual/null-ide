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
exports.isPidAlive = isPidAlive;
exports.writeMarker = writeMarker;
exports.removeMarker = removeMarker;
exports.findCrashed = findCrashed;
exports.sharesFolder = sharesFolder;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// EPERM means the process exists but belongs to someone else — still alive.
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        return err.code === 'EPERM';
    }
}
// Written to a temp name and renamed so a window scanning at the same moment
// never reads a half-written marker (and deletes it as "corrupt").
function writeMarker(dir, marker) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${marker.pid}-${marker.startedAt}.json`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(marker));
    fs.renameSync(tmp, file);
    return file;
}
function removeMarker(file) {
    try {
        fs.unlinkSync(file);
    }
    catch {
        // already gone
    }
}
function parseMarker(text) {
    try {
        const m = JSON.parse(text);
        if (m &&
            Number.isInteger(m.pid) &&
            Number.isFinite(m.startedAt) &&
            Array.isArray(m.folders) &&
            m.folders.every((f) => typeof f === 'string')) {
            return m;
        }
    }
    catch {
        // corrupt
    }
    return null;
}
// Markers of dead processes = crashed runs. They stay on disk until the user
// reviews or discards them, so they are the pending record too.
// ponytail: a dead pid reused by another live process hides that crash; the age rule cleans it up.
function findCrashed(dir, isAlive, now, maxAgeMs) {
    let entries;
    try {
        entries = fs.readdirSync(dir);
    }
    catch {
        return [];
    }
    const crashed = [];
    for (const entry of entries) {
        if (!entry.endsWith('.json'))
            continue;
        const file = path.join(dir, entry);
        let marker = null;
        try {
            marker = parseMarker(fs.readFileSync(file, 'utf8'));
        }
        catch {
            // unreadable
        }
        if (!marker || now - marker.startedAt > maxAgeMs) {
            removeMarker(file);
            continue;
        }
        if (!isAlive(marker.pid))
            crashed.push({ file, marker });
    }
    return crashed;
}
// Windows paths are case-insensitive; `D:\Repo` and `d:\repo` are one folder.
const norm = (p) => path.resolve(p).toLowerCase();
function sharesFolder(markerFolders, windowFolders) {
    const mine = new Set(windowFolders.map(norm));
    return markerFolders.some(f => mine.has(norm(f)));
}
//# sourceMappingURL=crashMarker.js.map
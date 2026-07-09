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
exports.MAX_TRACKED_ENTRIES = void 0;
exports.getRecentProjectsFilePath = getRecentProjectsFilePath;
exports.readRecentProjects = readRecentProjects;
exports.writeRecentProjectsAtomic = writeRecentProjectsAtomic;
exports.upsertEntry = upsertEntry;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.MAX_TRACKED_ENTRIES = 50;
function getRecentProjectsFilePath() {
    const appData = process.env.APPDATA;
    if (!appData) {
        throw new Error('Cannot locate %APPDATA%.');
    }
    return path.join(appData, 'Null', 'null-recent-projects.json');
}
function readRecentProjects(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function writeRecentProjectsAtomic(filePath, entries) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(entries, null, '\t'));
    fs.renameSync(tmpPath, filePath);
}
function upsertEntry(entries, entry, maxEntries = exports.MAX_TRACKED_ENTRIES) {
    const normalizedTarget = entry.path.toLowerCase();
    const withoutExisting = entries.filter(e => e.path.toLowerCase() !== normalizedTarget);
    const updated = [
        { path: entry.path, label: entry.label, isWorkspaceFile: entry.isWorkspaceFile, timestamp: Date.now() },
        ...withoutExisting,
    ];
    return updated.slice(0, maxEntries);
}
//# sourceMappingURL=recentProjects.js.map
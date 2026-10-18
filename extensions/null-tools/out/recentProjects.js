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
exports.getRecentProjectsFilePath = getRecentProjectsFilePath;
exports.normalizeRecentProjectPath = normalizeRecentProjectPath;
exports.readRecentProjects = readRecentProjects;
exports.writeRecentProjects = writeRecentProjects;
exports.updateRecentProjects = updateRecentProjects;
exports.touchRecentProject = touchRecentProject;
exports.setRecentProjectPinned = setRecentProjectPinned;
exports.removeRecentProject = removeRecentProject;
exports.replaceRecentProjectPath = replaceRecentProjectPath;
exports.findCurrentRecentProject = findCurrentRecentProject;
exports.relocateRecentProject = relocateRecentProject;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const dataDir_1 = require("./dataDir");
function getRecentProjectsFilePath() {
    return path.join((0, dataDir_1.nullDataDir)(), 'null-recent-projects.json');
}
// Windows paths are case-insensitive, so 'Work' and 'work' name one project there; Linux paths are not.
function normalizeRecentProjectPath(value, platform = process.platform) {
    const resolved = path.resolve(value);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function readEntry(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const entry = value;
    if (typeof entry.path !== 'string' || typeof entry.label !== 'string'
        || typeof entry.isWorkspaceFile !== 'boolean' || typeof entry.timestamp !== 'number'
        || !Number.isFinite(entry.timestamp) || (entry.pinned !== undefined && typeof entry.pinned !== 'boolean'))
        return undefined;
    return {
        path: entry.path, label: entry.label, isWorkspaceFile: entry.isWorkspaceFile,
        timestamp: entry.timestamp, pinned: entry.pinned ?? false,
        ...(typeof entry.gitBranch === 'string' ? { gitBranch: entry.gitBranch } : {}),
        ...(typeof entry.projectType === 'string' ? { projectType: entry.projectType } : {}),
        ...(typeof entry.icon === 'string' ? { icon: entry.icon } : {}),
    };
}
function readRecentProjects(filePath) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed) ? parsed.map(readEntry).filter((entry) => !!entry) : [];
    }
    catch {
        return [];
    }
}
function writeRecentProjects(filePath, entries) {
    const temporaryFile = `${filePath}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporaryFile, JSON.stringify(entries));
        fs.renameSync(temporaryFile, filePath);
        return true;
    }
    catch {
        try {
            fs.unlinkSync(temporaryFile);
        }
        catch { /* best effort cleanup */ }
        return false;
    }
}
function retain(entries, maxItems) {
    const unique = new Map();
    for (const entry of [...entries].sort((a, b) => b.timestamp - a.timestamp)) {
        const key = normalizeRecentProjectPath(entry.path);
        if (!unique.has(key))
            unique.set(key, entry);
    }
    const sorted = [...unique.values()].sort((a, b) => b.timestamp - a.timestamp);
    const maxUnpinned = Number.isFinite(maxItems) ? Math.max(1, Math.floor(maxItems)) : 1;
    let unpinned = 0;
    return sorted.filter(entry => entry.pinned || ++unpinned <= maxUnpinned);
}
function updateRecentProjects(filePath, mutate, maxItems) {
    try {
        const updated = mutate(readRecentProjects(filePath).map(entry => ({ ...entry })));
        return Array.isArray(updated) && writeRecentProjects(filePath, retain(updated, maxItems));
    }
    catch {
        return false;
    }
}
function touchRecentProject(filePath, entry, maxItems) {
    return updateRecentProjects(filePath, entries => {
        const key = normalizeRecentProjectPath(entry.path);
        const previous = entries.find(candidate => normalizeRecentProjectPath(candidate.path) === key);
        return [{ ...previous, ...entry, timestamp: Date.now(), pinned: previous?.pinned ?? entry.pinned }, ...entries.filter(candidate => normalizeRecentProjectPath(candidate.path) !== key)];
    }, maxItems);
}
function setRecentProjectPinned(filePath, requestedPath, pinned, maxItems) {
    const key = normalizeRecentProjectPath(requestedPath);
    return updateRecentProjects(filePath, entries => entries.map(entry => normalizeRecentProjectPath(entry.path) === key ? { ...entry, pinned } : entry), maxItems);
}
function removeRecentProject(filePath, requestedPath, maxItems) {
    const key = normalizeRecentProjectPath(requestedPath);
    return updateRecentProjects(filePath, entries => entries.filter(entry => normalizeRecentProjectPath(entry.path) !== key), maxItems);
}
function replaceRecentProjectPath(filePath, requestedPath, replacementPath, replacementLabel, maxItems) {
    const key = normalizeRecentProjectPath(requestedPath);
    return updateRecentProjects(filePath, entries => entries.map(entry => normalizeRecentProjectPath(entry.path) === key
        ? { ...entry, path: replacementPath, label: replacementLabel } : entry), maxItems);
}
/** The stored entry for `requestedPath`, read fresh from disk. Undefined if it was removed or replaced. */
function findCurrentRecentProject(filePath, requestedPath) {
    const key = normalizeRecentProjectPath(requestedPath);
    return readRecentProjects(filePath).find(entry => normalizeRecentProjectPath(entry.path) === key);
}
/** Points an existing entry at a directory the user chose. Refuses anything that is not a directory. */
function relocateRecentProject(filePath, requestedPath, replacementPath, maxItems) {
    try {
        if (!fs.statSync(replacementPath).isDirectory()) {
            return false;
        }
    }
    catch {
        return false;
    }
    const label = path.basename(replacementPath) || replacementPath;
    return replaceRecentProjectPath(filePath, requestedPath, replacementPath, label, maxItems);
}
//# sourceMappingURL=recentProjects.js.map
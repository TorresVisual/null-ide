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
exports.NO_FOLDER = void 0;
exports.normalizeRemote = normalizeRemote;
exports.repoRoot = repoRoot;
exports.resolveProject = resolveProject;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.NO_FOLDER = '(no folder)';
/** `git@host:Owner/Repo.git`, `https://user:tok@host/owner/repo` and friends all map to `host/owner/repo`. */
function normalizeRemote(url) {
    let u = url.trim();
    const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/\/)(.+)$/.exec(u);
    if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
        u = `${scp[1]}/${scp[2]}`;
    }
    else {
        u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]+@/, '');
    }
    return u.replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}
function normalizePath(folder) {
    const p = path.resolve(folder).replace(/\\/g, '/');
    return process.platform === 'win32' ? p.toLowerCase() : p;
}
function readText(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    }
    catch {
        return undefined;
    }
}
function findGitDirs(start) {
    for (let dir = path.resolve(start);; dir = path.dirname(dir)) {
        const dotGit = path.join(dir, '.git');
        let stat;
        try {
            stat = fs.statSync(dotGit);
        }
        catch {
            stat = undefined;
        }
        if (stat?.isDirectory())
            return { gitDir: dotGit, commonDir: dotGit, root: dir };
        if (stat?.isFile()) {
            const m = /^gitdir:\s*(.+)$/m.exec(readText(dotGit) ?? '');
            if (m) {
                const gitDir = path.resolve(dir, m[1].trim());
                const common = readText(path.join(gitDir, 'commondir'))?.trim();
                return { gitDir, commonDir: common ? path.resolve(gitDir, common) : gitDir, root: dir };
            }
        }
        if (path.dirname(dir) === dir)
            return undefined;
    }
}
/** The folder that contains the `.git` found at or above `start`, if any. */
function repoRoot(start) {
    return findGitDirs(start)?.root;
}
function remoteUrl(config) {
    const urls = new Map();
    let section;
    for (const line of config.split(/\r?\n/)) {
        const header = /^\s*\[remote "([^"]+)"\]/.exec(line);
        if (header) {
            section = header[1];
            continue;
        }
        if (/^\s*\[/.test(line)) {
            section = undefined;
            continue;
        }
        const url = section && !urls.has(section) ? /^\s*url\s*=\s*(.+?)\s*$/.exec(line) : null;
        if (section && url)
            urls.set(section, url[1]);
    }
    return urls.get('origin') ?? urls.values().next().value;
}
/** Called when the tracker opens an interval, never per heartbeat. */
function resolveProject(folder) {
    if (!folder)
        return { key: exports.NO_FOLDER, name: exports.NO_FOLDER };
    const name = path.basename(folder) || folder;
    const git = findGitDirs(folder);
    const remote = git ? remoteUrl(readText(path.join(git.commonDir, 'config')) ?? '') : undefined;
    const branch = git ? /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(readText(path.join(git.gitDir, 'HEAD')) ?? '')?.[1] : undefined;
    return {
        key: remote ? normalizeRemote(remote) : normalizePath(folder),
        name,
        ...(branch ? { branch } : {}),
    };
}
//# sourceMappingURL=projectIdentity.js.map
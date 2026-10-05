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
exports.issueImagesDir = exports.EXCLUDE_LINE = void 0;
exports.withExcludeLine = withExcludeLine;
exports.ensureExcluded = ensureExcluded;
exports.resolveImage = resolveImage;
exports.mapLimit = mapLimit;
// The local copy of every issue image the panel shows. The webview can't fetch GitHub's images itself (they need the
// token, and its CSP only allows avatars), so the host downloads each one once into <workspace>/.null/issue-images/
// and the webview loads the file through asWebviewUri. No `vscode` import: node:test runs this with a stub network.
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const scratchNotesStorage_1 = require("../scratchNotesStorage");
const githubApi_1 = require("./githubApi");
const imageUrls_1 = require("./imageUrls");
/** `**\/` so it also matches when the workspace folder is a subfolder of the repository. */
exports.EXCLUDE_LINE = '**/.null/issue-images/';
const issueImagesDir = (workspaceRoot) => path.join((0, scratchNotesStorage_1.getNullDir)(workspaceRoot), 'issue-images');
exports.issueImagesDir = issueImagesDir;
/** `existing` exclude-file text with `line` added; unchanged when the line is already there. */
function withExcludeLine(existing, line) {
    if (existing.split(/\r?\n/).some(l => l.trim() === line))
        return existing;
    return `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${line}\n`;
}
/**
 * Adds the cache folder to the repository's `info/exclude` (local to this clone, so no tracked file changes and nothing to
 * commit). `--git-path` finds the file in a linked worktree too, where `.git` is a file, not a folder. Silent outside a repo.
 */
function ensureExcluded(workspaceRoot, line = exports.EXCLUDE_LINE) {
    try {
        const rel = (0, child_process_1.execFileSync)('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: workspaceRoot, encoding: 'utf8', timeout: 5000 }).trim();
        const file = path.resolve(workspaceRoot, rel);
        let existing = '';
        try {
            existing = fs.readFileSync(file, 'utf8');
        }
        catch {
            // no exclude file yet
        }
        const next = withExcludeLine(existing, line);
        if (next !== existing) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, next);
        }
    }
    catch {
        // not a repository, or git isn't installed: the cache folder just isn't excluded
    }
}
const fetchFromGithub = (plan, token) => plan.kind === 'contents'
    ? (0, githubApi_1.fetchRepoFile)(plan.owner, plan.repo, plan.ref, plan.path, token, imageUrls_1.MAX_IMAGE_BYTES)
    : (0, githubApi_1.fetchBytes)(plan.url, token, 'image/*,*/*;q=0.8', imageUrls_1.MAX_IMAGE_BYTES);
const excludedRoots = new Set();
/** Downloads in progress, so two requests for one image (a re-render, two posts quoting it) share a download. */
const inFlight = new Map();
async function download(url, source) {
    const dir = (0, exports.issueImagesDir)(source.root);
    for (const name of (0, imageUrls_1.cacheFileNames)(url)) {
        const cached = path.join(dir, name);
        if (fs.existsSync(cached))
            return cached;
    }
    const plan = (0, imageUrls_1.imageFetchPlan)(url);
    if (!plan)
        throw new Error('Not a fetchable image URL');
    const { bytes, contentType } = await (source.fetch ?? fetchFromGithub)(plan, source.token);
    const ext = (0, imageUrls_1.imageExtension)(contentType, url);
    if (!ext)
        throw new Error(`Not an image (${contentType ?? 'unknown type'})`);
    if (bytes.length > imageUrls_1.MAX_IMAGE_BYTES)
        throw new Error(`Image is larger than ${imageUrls_1.MAX_IMAGE_BYTES / (1024 * 1024)} MB`);
    if (!excludedRoots.has(source.root)) {
        ensureExcluded(source.root);
        excludedRoots.add(source.root);
    }
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, (0, imageUrls_1.cacheFileName)(url, ext));
    // Written aside and renamed, so a crash mid-write never leaves a truncated file that a later lookup would trust.
    const partial = `${file}.part`;
    fs.writeFileSync(partial, bytes);
    fs.renameSync(partial, file);
    return file;
}
/**
 * Absolute path of the local copy of the image at `url`, downloading it first if needed. Rejects, with a reason, for a URL
 * that isn't plain https, a response that isn't an allowed image type, or one over the size cap.
 * ponytail: the cache is never cleaned up; add an age-based sweep if .null/issue-images grows noticeably.
 */
function resolveImage(url, source) {
    const key = `${source.root}\n${(0, imageUrls_1.cacheKeyUrl)(url)}`;
    let pending = inFlight.get(key);
    if (!pending) {
        pending = download(url, source).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
    }
    return pending;
}
/** `fn` over `items`, at most `limit` at a time, results in the order of `items`. `fn` must not reject. */
async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            out[index] = await fn(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}
//# sourceMappingURL=imageCache.js.map
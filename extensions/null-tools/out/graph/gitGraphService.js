/// <reference path="./protocol.ts" />
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
exports.GitGraphService = exports.PAGE_SIZE = void 0;
exports.resolveRepoRoot = resolveRepoRoot;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const gitLog_1 = require("./gitLog");
const gitRun_1 = require("./gitRun");
exports.PAGE_SIZE = 500;
const OPERATION_MARKERS = [
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
    ['MERGE_HEAD', 'merge'],
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
];
async function resolveRepoRoot(folder) {
    try {
        const out = await (0, gitRun_1.makeRunGit)(folder)(['rev-parse', '--show-toplevel']);
        return { ok: true, root: path.normalize(out.trim()) };
    }
    catch (err) {
        return { ok: false, reason: err instanceof gitRun_1.GitError && err.code === 'ENOENT' ? 'no-git' : 'not-a-repo' };
    }
}
class GitGraphService {
    git;
    root;
    constructor(git, root) {
        this.git = git;
        this.root = root;
    }
    async stashes() {
        const out = await this.git(['stash', 'list', '--format=%H%x1f%P']);
        return out.split('\n').filter(Boolean).map((line) => {
            const [sha, parents] = line.split('\x1f');
            return { sha, parents: parents ? parents.split(' ') : [] };
        });
    }
    /** `--date-order` is parent-safe and roughly newest-first (`--topo-order` lets one old branch fill page 1). */
    async loadPage(skip, count = exports.PAGE_SIZE) {
        const stashes = await this.stashes();
        const run = (withHead) => this.git([
            'log', '--date-order', '--decorate=full', '-z', `--format=${gitLog_1.LOG_FORMAT}`, `--skip=${skip}`, '-n', String(count),
            '--branches', '--tags', '--remotes', ...(withHead ? ['HEAD'] : []), ...stashes.map((s) => s.sha), '--',
        ]);
        let out;
        try {
            out = await run(true);
        }
        catch (err) {
            // git words the unborn-HEAD error differently across versions, so ask whether HEAD resolves instead of matching text.
            if (await this.attempt(['rev-parse', '--verify', '--quiet', 'HEAD']))
                throw err;
            try {
                out = await run(false);
            }
            catch {
                out = '';
            } // unborn HEAD: nothing (or only other refs) to show
        }
        const raw = (0, gitLog_1.parseLog)(out);
        return { commits: (0, gitLog_1.applyStashes)(raw, stashes), rawCount: raw.length, hasMore: raw.length === count };
    }
    async refs() {
        const out = await this.git([
            'for-each-ref', '--format=%(refname)%1f%(objectname)%1f%(*objectname)', 'refs/heads', 'refs/remotes', 'refs/tags',
        ]);
        const refs = [];
        for (const line of out.split('\n')) {
            if (!line)
                continue;
            const [full, object, peeled] = line.split('\x1f');
            const sha = peeled || object;
            if (full.startsWith('refs/heads/'))
                refs.push({ name: full.slice('refs/heads/'.length), kind: 'branch', sha });
            else if (full.startsWith('refs/remotes/') && !full.endsWith('/HEAD'))
                refs.push({ name: full.slice('refs/remotes/'.length), kind: 'remote', sha });
            else if (full.startsWith('refs/tags/'))
                refs.push({ name: full.slice('refs/tags/'.length), kind: 'tag', sha });
        }
        return refs;
    }
    async attempt(args) {
        try {
            return (await this.git(args)).trim();
        }
        catch {
            return '';
        }
    }
    /** A hash of everything the graph shows plus the in-progress state; a working-tree edit does not change it. */
    async fingerprint() {
        const [refs, head, branch, stash, inProgress] = await Promise.all([
            this.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags']),
            this.attempt(['rev-parse', '--verify', '--quiet', 'HEAD']),
            this.attempt(['symbolic-ref', '--quiet', 'HEAD']),
            this.git(['stash', 'list', '--format=%H']),
            this.inProgress(),
        ]);
        const hash = crypto.createHash('sha1').update([refs, head, branch, stash, inProgress?.kind ?? ''].join('\n--\n')).digest('hex');
        return { hash, inProgress };
    }
    /** Markers are resolved through --git-path so a linked worktree (where .git is a file) reads its own state. */
    async inProgress() {
        const out = await this.git(['rev-parse', ...OPERATION_MARKERS.flatMap(([name]) => ['--git-path', name])]);
        const paths = out.split('\n').filter(Boolean);
        for (let i = 0; i < OPERATION_MARKERS.length; i++) {
            if (paths[i] && fs.existsSync(path.resolve(this.root, paths[i])))
                return { kind: OPERATION_MARKERS[i][1] };
        }
        return null;
    }
    async commitDetail(sha) {
        const out = await this.git(['show', '-s', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B', sha, '--']);
        const f = out.split('\x1f');
        return {
            sha: f[0].trim(),
            parents: f[1] ? f[1].split(' ') : [],
            author: f[2],
            authorEmail: f[3],
            authorTime: Number(f[4]) || 0,
            committer: f[5],
            committerEmail: f[6],
            committerTime: Number(f[7]) || 0,
            message: f.slice(8).join('\x1f').trim(),
        };
    }
    /** Files changed against `parent` (the first parent for a merge); a root commit passes no parent and diffs against nothing. */
    async commitFiles(sha, parent) {
        const base = ['diff-tree', '-z', '--no-commit-id', '--name-status', '-r', '-M'];
        const out = await this.git(parent ? [...base, parent, sha, '--'] : [...base, '--root', sha, '--']);
        return (0, gitLog_1.parseNameStatus)(out);
    }
}
exports.GitGraphService = GitGraphService;
//# sourceMappingURL=gitGraphService.js.map
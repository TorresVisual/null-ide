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
exports.parseWorktreeListPorcelain = parseWorktreeListPorcelain;
exports.getBaseBranch = getBaseBranch;
exports.resolveMainWorktreeRoot = resolveMainWorktreeRoot;
exports.listWorktrees = listWorktrees;
exports.createWorktree = createWorktree;
exports.listLocalBranches = listLocalBranches;
exports.removeWorktree = removeWorktree;
exports.mergeWorktreeBack = mergeWorktreeBack;
exports.pruneCandidates = pruneCandidates;
exports.pruneWorktrees = pruneWorktrees;
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dashboardGitStatus_1 = require("./dashboardGitStatus");
const gitBranch_1 = require("./github/gitBranch");
const scratchNotesStorage_1 = require("./scratchNotesStorage");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
function normalizePath(p) {
    return p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}
function parseWorktreeListPorcelain(output, currentPath) {
    const current = normalizePath(currentPath);
    return output
        .split(/\r?\n\r?\n/)
        .map(block => block.trim())
        .filter(Boolean)
        .map(block => {
        let wtPath = '', head = '', branch = null, prunable = false;
        for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('worktree '))
                wtPath = line.slice('worktree '.length).trim();
            else if (line.startsWith('HEAD '))
                head = line.slice('HEAD '.length).trim();
            else if (line.startsWith('branch '))
                branch = line.slice('branch '.length).replace('refs/heads/', '').trim();
            else if (line === 'detached')
                branch = null;
            else if (line.startsWith('prunable'))
                prunable = true;
        }
        return { path: wtPath, branch, head, prunable, isCurrent: normalizePath(wtPath) === current };
    });
}
function getBaseBranch(repoCwd) {
    try {
        const ref = (0, child_process_1.execFileSync)('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 }).trim();
        return ref.replace(/^refs\/remotes\/origin\//, '');
    }
    catch {
        // no remote, or origin/HEAD not set
    }
    for (const candidate of ['main', 'master']) {
        try {
            (0, child_process_1.execFileSync)('git', ['rev-parse', '--verify', `refs/heads/${candidate}`], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 });
            return candidate;
        }
        catch {
            // candidate branch doesn't exist
        }
    }
    return (0, child_process_1.execFileSync)('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 }).trim();
}
async function fetchWorktreeStatus(worktreePath, branch, head, baseBranch) {
    try {
        const { stdout: porcelain } = await execFileAsync('git', ['status', '--porcelain'], { cwd: worktreePath, timeout: 5000 });
        const dirty = porcelain.trim().length > 0;
        let ahead = 0, behind = 0;
        if (branch) {
            try {
                const { stdout } = await execFileAsync('git', ['rev-list', '--left-right', '--count', `${branch}...${branch}@{u}`], { cwd: worktreePath, timeout: 5000 });
                [ahead, behind] = stdout.trim().split(/\s+/).map(Number);
            }
            catch {
                // no upstream configured
            }
        }
        let aheadBase = 0, behindBase = 0;
        try {
            const ref = branch ?? head;
            const { stdout } = await execFileAsync('git', ['rev-list', '--left-right', '--count', `${ref}...${baseBranch}`], { cwd: worktreePath, timeout: 5000 });
            [aheadBase, behindBase] = stdout.trim().split(/\s+/).map(Number);
        }
        catch {
            // base branch unresolvable from this worktree
        }
        const { stdout: log } = await execFileAsync('git', ['log', '-1', '--format=%s%x1f%cI', 'HEAD'], { cwd: worktreePath, timeout: 5000 });
        const [lastCommitSubject, lastCommitDate] = log.trim().split('\x1f');
        return { dirty, ahead, behind, aheadBase, behindBase, lastCommitSubject: lastCommitSubject ?? '', lastCommitDate: lastCommitDate ?? '' };
    }
    catch {
        return null;
    }
}
function resolveMainWorktreeRoot(repoCwd) {
    try {
        const stdout = (0, child_process_1.execFileSync)('git', ['worktree', 'list', '--porcelain'], { cwd: repoCwd, encoding: 'utf8', timeout: 10000 });
        return parseWorktreeListPorcelain(stdout, repoCwd)[0]?.path ?? repoCwd;
    }
    catch {
        return repoCwd;
    }
}
async function listWorktrees(repoCwd) {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoCwd, timeout: 10000 });
    const base = parseWorktreeListPorcelain(stdout, repoCwd);
    if (base.length === 0)
        return [];
    const baseBranch = getBaseBranch(repoCwd);
    const byPath = new Map(base.map(e => [e.path, e]));
    const statuses = new Map();
    await (0, dashboardGitStatus_1.computeGitStatuses)(base.map(e => e.path), (p, status) => statuses.set(p, status), 4, (p) => {
        const entry = byPath.get(p);
        return fetchWorktreeStatus(p, entry.branch, entry.head, baseBranch);
    });
    return base.map(entry => {
        const status = statuses.get(entry.path);
        return {
            ...entry,
            dirty: status?.dirty ?? false,
            ahead: status?.ahead ?? 0,
            behind: status?.behind ?? 0,
            aheadBase: status?.aheadBase ?? 0,
            behindBase: status?.behindBase ?? 0,
            lastCommitSubject: status?.lastCommitSubject ?? '',
            lastCommitDate: status?.lastCommitDate ?? '',
        };
    });
}
function ensureWorktreesIgnored(repoCwd) {
    try {
        (0, child_process_1.execFileSync)('git', ['check-ignore', '-q', '.claude/worktrees'], { cwd: repoCwd, stdio: 'ignore' });
        return; // already ignored
    }
    catch (err) {
        if (err.status !== 1)
            return; // not a "no match" result — leave .gitignore alone
    }
    const gitignorePath = path.join(repoCwd, '.gitignore');
    const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
    if (existing.includes('.claude/worktrees'))
        return;
    const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(gitignorePath, `${existing}${sep}.claude/worktrees/\n`);
    try {
        (0, child_process_1.execFileSync)('git', ['add', '--', '.gitignore'], { cwd: repoCwd, timeout: 5000 });
        (0, child_process_1.execFileSync)('git', ['commit', '-q', '-m', 'chore: ignore .claude/worktrees/', '--', '.gitignore'], { cwd: repoCwd, timeout: 5000 });
    }
    catch {
        // leave the .gitignore edit uncommitted — the caller's own dirty checks (e.g. mergeWorktreeBack) still see it
    }
}
function branchExists(repoCwd, branch) {
    try {
        (0, child_process_1.execFileSync)('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoCwd, stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
function createWorktree(repoCwd, opts) {
    let branch;
    let isNewBranch;
    switch (opts.kind) {
        case 'issue':
            branch = (0, gitBranch_1.branchNameForIssue)(opts.issueNumber, opts.title);
            isNewBranch = true;
            break;
        case 'branch':
            branch = opts.branch;
            isNewBranch = false;
            break;
        case 'scratch':
            branch = (0, scratchNotesStorage_1.slugify)(opts.description);
            isNewBranch = true;
            break;
    }
    if (isNewBranch && branchExists(repoCwd, branch))
        isNewBranch = false;
    const worktreePath = path.join(repoCwd, '.claude', 'worktrees', branch);
    if (fs.existsSync(worktreePath)) {
        return { ok: false, message: `A worktree already exists at ${worktreePath}.` };
    }
    ensureWorktreesIgnored(repoCwd);
    try {
        const args = isNewBranch
            ? ['worktree', 'add', '-b', branch, worktreePath]
            : ['worktree', 'add', worktreePath, branch];
        (0, child_process_1.execFileSync)('git', args, { cwd: repoCwd, encoding: 'utf8', timeout: 15000 });
        return { ok: true, value: { path: worktreePath, branch } };
    }
    catch (err) {
        return { ok: false, message: err.message };
    }
}
function listLocalBranches(repoCwd) {
    try {
        const stdout = (0, child_process_1.execFileSync)('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 });
        return stdout.split('\n').map(l => l.trim()).filter(Boolean);
    }
    catch {
        return [];
    }
}
function removeWorktree(repoCwd, worktreePath, force) {
    try {
        const args = force ? ['worktree', 'remove', '--force', worktreePath] : ['worktree', 'remove', worktreePath];
        (0, child_process_1.execFileSync)('git', args, { cwd: repoCwd, encoding: 'utf8', timeout: 15000 });
        return { ok: true, value: undefined };
    }
    catch (err) {
        return { ok: false, message: err.message };
    }
}
function mergeWorktreeBack(repoCwd, branch, baseBranch, mode) {
    const status = (0, child_process_1.execFileSync)('git', ['status', '--porcelain'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 });
    if (status.trim().length > 0) {
        return { ok: false, reason: 'dirty', message: `${repoCwd} has uncommitted changes — commit or stash before merging back.` };
    }
    try {
        (0, child_process_1.execFileSync)('git', ['checkout', baseBranch], { cwd: repoCwd, encoding: 'utf8', timeout: 10000 });
    }
    catch (err) {
        return { ok: false, reason: 'checkout', message: `Failed to check out ${baseBranch}: ${err.message}` };
    }
    try {
        (0, child_process_1.execFileSync)('git', ['merge', mode === 'ff-only' ? '--ff-only' : '--no-edit', branch], { cwd: repoCwd, encoding: 'utf8', timeout: 10000 });
        return { ok: true, value: { mode: mode === 'ff-only' ? 'ff' : 'merge' } };
    }
    catch (err) {
        return { ok: false, reason: 'merge', message: err.message };
    }
}
async function pruneCandidates(repoCwd, baseBranch) {
    const entries = await listWorktrees(repoCwd);
    const merged = [];
    const missing = [];
    let mergedBranches = [];
    try {
        const stdout = (0, child_process_1.execFileSync)('git', ['branch', '--merged', baseBranch, '--format=%(refname:short)'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 });
        mergedBranches = stdout.split('\n').map(l => l.trim()).filter(Boolean);
    }
    catch {
        // leave mergedBranches empty — nothing will be classified as merged
    }
    for (const entry of entries) {
        if (entry.isCurrent)
            continue;
        if (entry.prunable) {
            missing.push(entry);
            continue;
        }
        if (entry.branch && mergedBranches.includes(entry.branch))
            merged.push(entry);
    }
    return { merged, missing };
}
function pruneWorktrees(repoCwd) {
    try {
        (0, child_process_1.execFileSync)('git', ['worktree', 'prune'], { cwd: repoCwd, encoding: 'utf8', timeout: 10000 });
        return { ok: true, value: undefined };
    }
    catch (err) {
        return { ok: false, message: err.message };
    }
}
//# sourceMappingURL=worktrees.js.map
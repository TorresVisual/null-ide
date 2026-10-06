'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.branchIssueTracker = exports.BranchIssueTracker = void 0;
exports.branchNameForIssue = branchNameForIssue;
exports.issueNumberFromBranch = issueNumberFromBranch;
exports.createIssueBranch = createIssueBranch;
exports.getLocallyClosedIssueNumbers = getLocallyClosedIssueNumbers;
const child_process_1 = require("child_process");
function slugify(title) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
function branchNameForIssue(issueNumber, title) {
    const slug = slugify(title);
    return slug ? `issue-${issueNumber}-${slug}` : `issue-${issueNumber}`;
}
/** The number in `issue-<n>` or `issue-<n>-<slug>`, the names `branchNameForIssue` makes. */
function issueNumberFromBranch(name) {
    const match = /^issue-(\d{1,9})(?:-|$)/.exec(name ?? '');
    const n = match ? Number(match[1]) : 0;
    return n > 0 ? n : null;
}
/**
 * Decides which HEAD changes deserve an "open this issue?" prompt. The git extension reports every
 * status change, not just branch switches, so this keeps a prompt to a real switch onto a branch we
 * haven't offered yet.
 */
class BranchIssueTracker {
    last = new Map();
    offered = new Set();
    created = new Set();
    /** The issue number to offer, or null. Call on every HEAD change; the first call per repo only records it. */
    onHead(repoKey, branch) {
        const previous = this.last.get(repoKey);
        this.last.set(repoKey, branch);
        // ponytail: an unknown previous HEAD (startup, still loading, detached) never prompts, so leaving a
        // detached HEAD onto an issue branch is missed. Track "seen a real branch" separately if that matters.
        if (!previous || !branch || previous === branch)
            return null;
        const n = issueNumberFromBranch(branch);
        if (n === null)
            return null;
        const key = `${repoKey}\0${branch}`;
        if (this.offered.has(key))
            return null;
        this.offered.add(key);
        if (this.created.delete(branch))
            return null;
        return n;
    }
    /** The panel just created `branch`: its first checkout is the user's own doing, not news. */
    skip(branch) {
        this.created.add(branch);
    }
}
exports.BranchIssueTracker = BranchIssueTracker;
exports.branchIssueTracker = new BranchIssueTracker();
function createIssueBranch(cwd, issueNumber, title) {
    const branch = branchNameForIssue(issueNumber, title);
    try {
        (0, child_process_1.execFileSync)('git', ['checkout', '-b', branch], { cwd, encoding: 'utf8', timeout: 5000 });
        exports.branchIssueTracker.skip(branch);
        return { ok: true, branch };
    }
    catch (err) {
        return { ok: false, message: err.message };
    }
}
const CLOSING_KEYWORD_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
/** Issue numbers that unpushed local commits will close, via GitHub's closing-keyword syntax. */
function getLocallyClosedIssueNumbers(cwd) {
    const numbers = new Set();
    let log;
    try {
        // @{u}..HEAD throws when there's no upstream (fresh branch, detached HEAD) — treat as "nothing unpushed".
        log = (0, child_process_1.execFileSync)('git', ['log', '--format=%B', '@{u}..HEAD'], { cwd, encoding: 'utf8', timeout: 5000 });
    }
    catch {
        return numbers;
    }
    for (const match of log.matchAll(CLOSING_KEYWORD_RE)) {
        numbers.add(Number(match[1]));
    }
    return numbers;
}
//# sourceMappingURL=gitBranch.js.map
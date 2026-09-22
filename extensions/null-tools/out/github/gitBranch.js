'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.branchNameForIssue = branchNameForIssue;
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
function createIssueBranch(cwd, issueNumber, title) {
    const branch = branchNameForIssue(issueNumber, title);
    try {
        (0, child_process_1.execFileSync)('git', ['checkout', '-b', branch], { cwd, encoding: 'utf8', timeout: 5000 });
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
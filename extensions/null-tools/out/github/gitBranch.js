'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.branchNameForIssue = branchNameForIssue;
exports.createIssueBranch = createIssueBranch;
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
//# sourceMappingURL=gitBranch.js.map
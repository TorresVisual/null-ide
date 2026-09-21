'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripPullRequests = stripPullRequests;
exports.filterIssues = filterIssues;
function stripPullRequests(issues) {
    return issues.filter(issue => !issue.pull_request);
}
function filterIssues(issues, opts) {
    const query = opts.query.trim().toLowerCase();
    return issues.filter(issue => {
        if (opts.labels.length > 0) {
            const issueLabels = new Set(issue.labels.map(l => l.name));
            if (!opts.labels.every(label => issueLabels.has(label)))
                return false;
        }
        if (opts.assignee === 'me') {
            if (!opts.viewerLogin)
                return false;
            if (!issue.assignees.some(a => a.login === opts.viewerLogin))
                return false;
        }
        if (query) {
            const haystack = `${issue.title}\n${issue.body || ''}`.toLowerCase();
            if (!haystack.includes(query))
                return false;
        }
        return true;
    });
}
//# sourceMappingURL=issueFilter.js.map
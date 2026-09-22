'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripPullRequests = stripPullRequests;
exports.relevantToViewer = relevantToViewer;
exports.newestUpdateTime = newestUpdateTime;
exports.filterIssues = filterIssues;
function stripPullRequests(issues) {
    return issues.filter(issue => !issue.pull_request);
}
function relevantToViewer(issues, viewerLogin) {
    if (!viewerLogin)
        return [];
    return issues.filter(issue => issue.user.login === viewerLogin || issue.assignees.some(a => a.login === viewerLogin));
}
function newestUpdateTime(issues) {
    return issues.reduce((max, issue) => Math.max(max, new Date(issue.updated_at).getTime()), 0);
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
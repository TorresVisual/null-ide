'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripPullRequests = stripPullRequests;
exports.relevantToViewer = relevantToViewer;
exports.newestUpdateTime = newestUpdateTime;
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
//# sourceMappingURL=issueFilter.js.map
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssuesStore = void 0;
const githubRemote_1 = require("./githubRemote");
const githubAuth_1 = require("./githubAuth");
const githubApi_1 = require("./githubApi");
const issueFilter_1 = require("./issueFilter");
class IssuesStore {
    issues = [];
    repo = null;
    token = null;
    async refresh(cwd, state) {
        if (!cwd)
            return { status: 'no-workspace' };
        const repo = (0, githubRemote_1.getWorkspaceGithubRepo)(cwd);
        if (!repo)
            return { status: 'no-remote' };
        const session = await (0, githubAuth_1.getGithubSession)(false);
        if (!session)
            return { status: 'signed-out' };
        try {
            const issues = await (0, githubApi_1.fetchIssues)(repo.owner, repo.repo, state, session.accessToken);
            this.issues = issues;
            this.repo = repo;
            this.token = session.accessToken;
            return { status: 'ok', repo, issues, viewerLogin: session.account.label };
        }
        catch (err) {
            return { status: 'error', message: err.message };
        }
    }
    getFiltered(opts) {
        return (0, issueFilter_1.filterIssues)(this.issues, opts);
    }
    getByNumber(number) {
        return this.issues.find(issue => issue.number === number);
    }
    getComments(issueNumber) {
        if (!this.repo)
            return Promise.resolve([]);
        return (0, githubApi_1.fetchComments)(this.repo.owner, this.repo.repo, issueNumber, this.token);
    }
}
exports.IssuesStore = IssuesStore;
//# sourceMappingURL=issuesStore.js.map
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssuesStore = exports.SessionError = void 0;
const githubRemote_1 = require("./githubRemote");
const githubAuth_1 = require("./githubAuth");
const githubApi_1 = require("./githubApi");
const issueFilter_1 = require("./issueFilter");
const SESSION_MESSAGES = {
    'no-workspace': 'Open a folder to use GitHub issues.',
    'no-remote': 'This folder has no GitHub remote.',
    'signed-out': 'Sign in to GitHub to continue.',
};
/** Why no GitHub session could be established; `refresh()` maps it to the panel's status screens. */
class SessionError extends Error {
    status;
    constructor(status) {
        super(SESSION_MESSAGES[status]);
        this.status = status;
    }
}
exports.SessionError = SessionError;
class IssuesStore {
    getCwd;
    issues = [];
    repo = null;
    repoLabels = null;
    assignableUsers = null;
    viewerLogin = null;
    constructor(getCwd) {
        this.getCwd = getCwd;
    }
    /** Seeds in-memory state from a persisted cache, without a network call. */
    hydrateFromCache(repo, issues, viewerLogin) {
        this.setRepo(repo);
        this.issues = issues;
        this.viewerLogin = viewerLogin;
    }
    /**
     * Resolves the workspace's GitHub repo and a live session token. Every read and write goes through
     * here, so no call can go out with a missing or stale repo/token (#106). `interactive` shows the
     * sign-in prompt, and is used for user-initiated writes; background reads stay silent.
     */
    async ensureSession(interactive) {
        const cwd = this.getCwd();
        if (!cwd)
            throw new SessionError('no-workspace');
        const repo = (0, githubRemote_1.getWorkspaceGithubRepo)(cwd);
        if (!repo)
            throw new SessionError('no-remote');
        const session = await (0, githubAuth_1.getGithubSession)(interactive);
        if (!session)
            throw new SessionError('signed-out');
        this.setRepo(repo);
        this.viewerLogin = session.account.label;
        return { repo, token: session.accessToken };
    }
    /** Switches the active repo, dropping every per-repo cache when it actually changes. */
    setRepo(repo) {
        if (this.repo && (this.repo.owner !== repo.owner || this.repo.repo !== repo.repo)) {
            this.issues = [];
            this.repoLabels = null;
            this.assignableUsers = null;
        }
        this.repo = repo;
    }
    async refresh(state) {
        try {
            const { repo, token } = await this.ensureSession(false);
            this.issues = await (0, githubApi_1.fetchIssues)(repo.owner, repo.repo, state, token);
            return { status: 'ok', repo, issues: this.issues, viewerLogin: this.viewerLogin };
        }
        catch (err) {
            if (err instanceof SessionError)
                return { status: err.status };
            return { status: 'error', message: err.message };
        }
    }
    async getRepoLabels() {
        const { repo, token } = await this.ensureSession(false);
        if (!this.repoLabels)
            this.repoLabels = await (0, githubApi_1.fetchRepoLabels)(repo.owner, repo.repo, token);
        return this.repoLabels;
    }
    async getAssignableUsers() {
        const { repo, token } = await this.ensureSession(false);
        if (!this.assignableUsers)
            this.assignableUsers = await (0, githubApi_1.fetchAssignableUsers)(repo.owner, repo.repo, token);
        return this.assignableUsers;
    }
    getFiltered(opts) {
        return (0, issueFilter_1.filterIssues)(this.issues, opts);
    }
    getByNumber(number) {
        return this.issues.find(issue => issue.number === number);
    }
    getAllIssues() {
        return this.issues;
    }
    getRepo() {
        return this.repo;
    }
    getViewerLogin() {
        return this.viewerLogin;
    }
    async getComments(issueNumber) {
        const { repo, token } = await this.ensureSession(false);
        return (0, githubApi_1.fetchComments)(repo.owner, repo.repo, issueNumber, token);
    }
    async getTimeline(issueNumber) {
        const { repo, token } = await this.ensureSession(false);
        return (0, githubApi_1.fetchTimeline)(repo.owner, repo.repo, issueNumber, token);
    }
    /** Re-fetches one issue from GitHub and replaces it in the cache, without refetching the whole list. */
    async reloadIssue(issueNumber) {
        const { repo, token } = await this.ensureSession(false);
        const fresh = await (0, githubApi_1.fetchIssue)(repo.owner, repo.repo, issueNumber, token);
        this.issues = this.issues.map(issue => (issue.number === issueNumber ? fresh : issue));
    }
    async updateIssue(issueNumber, patch) {
        const { repo, token } = await this.ensureSession(true);
        const updated = await (0, githubApi_1.updateIssue)(repo.owner, repo.repo, issueNumber, patch, token);
        this.issues = this.issues.map(issue => (issue.number === issueNumber ? updated : issue));
        return updated;
    }
    async createIssue(data) {
        const { repo, token } = await this.ensureSession(true);
        const created = await (0, githubApi_1.createIssue)(repo.owner, repo.repo, data, token);
        this.issues = [created, ...this.issues];
        return created;
    }
    async addComment(issueNumber, body) {
        const { repo, token } = await this.ensureSession(true);
        const comment = await (0, githubApi_1.createComment)(repo.owner, repo.repo, issueNumber, body, token);
        this.issues = this.issues.map(issue => issue.number === issueNumber ? { ...issue, comments: issue.comments + 1 } : issue);
        return comment;
    }
    async updateComment(commentId, body) {
        const { repo, token } = await this.ensureSession(true);
        return (0, githubApi_1.updateComment)(repo.owner, repo.repo, commentId, body, token);
    }
    async deleteComment(issueNumber, commentId) {
        const { repo, token } = await this.ensureSession(true);
        await (0, githubApi_1.deleteComment)(repo.owner, repo.repo, commentId, token);
        this.issues = this.issues.map(issue => issue.number === issueNumber ? { ...issue, comments: Math.max(0, issue.comments - 1) } : issue);
    }
}
exports.IssuesStore = IssuesStore;
//# sourceMappingURL=issuesStore.js.map
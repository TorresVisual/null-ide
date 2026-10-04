'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssuesStore = exports.SessionError = exports.PAGE_SIZE = void 0;
const githubRemote_1 = require("./githubRemote");
const githubAuth_1 = require("./githubAuth");
const githubApi_1 = require("./githubApi");
const githubQueries_1 = require("./githubQueries");
const searchQuery_1 = require("./searchQuery");
exports.PAGE_SIZE = 50;
const SESSION_MESSAGES = {
    'no-workspace': 'Open a folder to use GitHub issues.',
    'no-remote': 'This folder has no GitHub remote.',
    'signed-out': 'Sign in to GitHub to continue.',
};
/** Why no GitHub session could be established; the list controller maps it to the panel's status screens. */
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
    /** Every issue any list has loaded, by number, so row actions and the detail tab can find one by number. */
    known = new Map();
    repo = null;
    repoLabels = null;
    assignableUsers = null;
    metadata = null;
    viewerLogin = null;
    constructor(getCwd) {
        this.getCwd = getCwd;
    }
    /** Seeds in-memory state from a persisted cache, without a network call. */
    hydrateFromCache(repo, issues) {
        this.setRepo(repo);
        this.remember(issues);
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
        // VS Code rejects (rather than resolving undefined) when the sign-in prompt is dismissed.
        const session = await (0, githubAuth_1.getGithubSession)(interactive).then(s => s, () => undefined);
        if (!session)
            throw new SessionError('signed-out');
        this.setRepo(repo);
        this.viewerLogin = session.account.label;
        return { repo, token: session.accessToken };
    }
    /** Switches the active repo, dropping every per-repo cache when it actually changes. */
    setRepo(repo) {
        if (this.repo && (this.repo.owner !== repo.owner || this.repo.repo !== repo.repo)) {
            this.known.clear();
            this.repoLabels = null;
            this.assignableUsers = null;
            this.metadata = null;
        }
        this.repo = repo;
    }
    remember(issues) {
        for (const issue of issues)
            this.known.set(issue.number, issue);
    }
    /** One page of a search. `withCounts` also fetches the Open/Closed tab counts (first page only). */
    async search(query, cursor, withCounts) {
        const { repo, token } = await this.ensureSession(false);
        const name = `${repo.owner}/${repo.repo}`;
        const data = await (0, githubApi_1.requestGraphql)(githubQueries_1.SEARCH_ISSUES, {
            q: (0, searchQuery_1.toApiQuery)(name, query),
            qOpen: (0, searchQuery_1.toApiQuery)(name, (0, searchQuery_1.withState)(query, 'open')),
            qClosed: (0, searchQuery_1.toApiQuery)(name, (0, searchQuery_1.withState)(query, 'closed')),
            first: exports.PAGE_SIZE,
            after: cursor,
            withCounts,
        }, token);
        const page = (0, githubQueries_1.mapSearchPage)(data);
        this.remember(page.items);
        return page;
    }
    /** Labels, assignable users, milestones and issue types for the filter dropdowns. Cached until `force`. */
    async getMetadata(force = false) {
        const { repo, token } = await this.ensureSession(false);
        if (force || !this.metadata) {
            this.metadata = (0, githubQueries_1.mapMetadata)(await (0, githubApi_1.requestGraphql)(githubQueries_1.REPO_METADATA, { owner: repo.owner, name: repo.repo }, token));
        }
        return this.metadata;
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
    getByNumber(number) {
        return this.known.get(number);
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
    /** Re-fetches one issue from GitHub and replaces it in the cache, without refetching any list. */
    async reloadIssue(issueNumber) {
        const { repo, token } = await this.ensureSession(false);
        this.remember([await (0, githubApi_1.fetchIssue)(repo.owner, repo.repo, issueNumber, token)]);
    }
    async updateIssue(issueNumber, patch) {
        const { repo, token } = await this.ensureSession(true);
        const updated = await (0, githubApi_1.updateIssue)(repo.owner, repo.repo, issueNumber, patch, token);
        this.remember([updated]);
        return updated;
    }
    async createIssue(data) {
        const { repo, token } = await this.ensureSession(true);
        const created = await (0, githubApi_1.createIssue)(repo.owner, repo.repo, data, token);
        this.remember([created]);
        return created;
    }
    async addComment(issueNumber, body) {
        const { repo, token } = await this.ensureSession(true);
        const comment = await (0, githubApi_1.createComment)(repo.owner, repo.repo, issueNumber, body, token);
        const issue = this.known.get(issueNumber);
        if (issue)
            this.known.set(issueNumber, { ...issue, comments: issue.comments + 1 });
        return comment;
    }
    async updateComment(commentId, body) {
        const { repo, token } = await this.ensureSession(true);
        return (0, githubApi_1.updateComment)(repo.owner, repo.repo, commentId, body, token);
    }
    async deleteComment(issueNumber, commentId) {
        const { repo, token } = await this.ensureSession(true);
        await (0, githubApi_1.deleteComment)(repo.owner, repo.repo, commentId, token);
        const issue = this.known.get(issueNumber);
        if (issue)
            this.known.set(issueNumber, { ...issue, comments: Math.max(0, issue.comments - 1) });
    }
}
exports.IssuesStore = IssuesStore;
//# sourceMappingURL=issuesStore.js.map
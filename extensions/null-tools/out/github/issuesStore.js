'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssuesStore = exports.SessionError = exports.PAGE_SIZE = void 0;
const githubRemote_1 = require("./githubRemote");
const githubAuth_1 = require("./githubAuth");
const githubApi_1 = require("./githubApi");
const detailQueries_1 = require("./detailQueries");
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
    /** One issue with its first timeline page. Also refreshes the by-number cache the row actions read. */
    async getDetail(issueNumber) {
        const { repo, token } = await this.ensureSession(false);
        const data = await (0, githubApi_1.requestGraphql)(detailQueries_1.ISSUE_DETAIL, { owner: repo.owner, name: repo.repo, number: issueNumber }, token);
        const detail = (0, detailQueries_1.mapIssueDetail)(data, `${repo.owner}/${repo.repo}`);
        this.remember([detail.issue]);
        return detail;
    }
    async getTimelinePage(issueNumber, after) {
        const { repo, token } = await this.ensureSession(false);
        const data = await (0, githubApi_1.requestGraphql)(detailQueries_1.ISSUE_TIMELINE, { owner: repo.owner, name: repo.repo, number: issueNumber, after }, token);
        if (!data.repository.issue)
            throw new Error('Issue not found.');
        return (0, detailQueries_1.mapTimelinePage)(data.repository.issue.timelineItems, `${repo.owner}/${repo.repo}`);
    }
    /** A GraphQL write. Prompts for sign-in like every user-initiated write. */
    async mutate(query, variables) {
        const { token } = await this.ensureSession(true);
        return (0, githubApi_1.requestGraphql)(query, variables, token);
    }
    async toggleReaction(subjectId, content, add) {
        const data = await this.mutate(add ? detailQueries_1.ADD_REACTION : detailQueries_1.REMOVE_REACTION, { id: subjectId, content });
        return (0, detailQueries_1.mapReactions)((data.addReaction ?? data.removeReaction).subject.reactionGroups);
    }
    async setIssueType(issueId, typeId) {
        await this.mutate(detailQueries_1.SET_ISSUE_TYPE, { id: issueId, typeId });
    }
    async addSubIssue(parentId, subIssueNumber) {
        const { repo, token } = await this.ensureSession(true);
        const url = `https://github.com/${repo.owner}/${repo.repo}/issues/${subIssueNumber}`;
        await (0, githubApi_1.requestGraphql)(detailQueries_1.ADD_SUB_ISSUE, { id: parentId, url }, token);
    }
    async removeSubIssue(parentId, subIssueId) {
        await this.mutate(detailQueries_1.REMOVE_SUB_ISSUE, { id: parentId, subId: subIssueId });
    }
    /** Posts a comment and returns it already rendered, so the tab can append it without refetching. */
    async postComment(issueNumber, issueId, body) {
        const data = await this.mutate(detailQueries_1.ADD_COMMENT, { id: issueId, body });
        const issue = this.known.get(issueNumber);
        if (issue)
            this.known.set(issueNumber, { ...issue, comments: issue.comments + 1 });
        return (0, detailQueries_1.mapComment)(data.addComment.commentEdge.node);
    }
    async editComment(commentId, body) {
        const data = await this.mutate(detailQueries_1.UPDATE_COMMENT, { id: commentId, body });
        return (0, detailQueries_1.mapComment)(data.updateIssueComment.issueComment);
    }
    async removeComment(issueNumber, commentId) {
        await this.mutate(detailQueries_1.DELETE_COMMENT, { id: commentId });
        const issue = this.known.get(issueNumber);
        if (issue)
            this.known.set(issueNumber, { ...issue, comments: Math.max(0, issue.comments - 1) });
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
}
exports.IssuesStore = IssuesStore;
//# sourceMappingURL=issuesStore.js.map
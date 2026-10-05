'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssuesStore = exports.SessionError = exports.PAGE_SIZE = void 0;
const githubRemote_1 = require("./githubRemote");
const githubAuth_1 = require("./githubAuth");
const createExtras_1 = require("./createExtras");
const githubApi_1 = require("./githubApi");
const imageCache_1 = require("./imageCache");
const imageUpload_1 = require("./imageUpload");
const detailQueries_1 = require("./detailQueries");
const githubQueries_1 = require("./githubQueries");
const issueSuggest_1 = require("./issueSuggest");
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
    /**
     * The issue body and every visible comment, paging past the first 100 timeline items, for Copy as prompt.
     * Collapsed (minimized) comments are spam or off-topic, so they stay out.
     * ponytail: 1000 timeline items at most; a longer thread is cut off there.
     */
    async getConversation(issueNumber) {
        const detail = await this.getDetail(issueNumber);
        const items = [...detail.timeline];
        let cursor = detail.hasMoreTimeline ? detail.timelineCursor : null;
        for (let pages = 0; cursor && pages < 9; pages++) {
            const page = await this.getTimelinePage(issueNumber, cursor);
            items.push(...page.items);
            cursor = page.hasMore ? page.cursor : null;
        }
        const comments = items.filter((i) => i.kind === 'comment' && !i.minimizedReason);
        return { post: detail.post, comments };
    }
    /** GitHub's own rendering of `text` in this repo's context (so `#12` and `@user` become links), for the composer's Preview tab. */
    async renderPreview(text) {
        const { repo, token } = await this.ensureSession(false);
        return (0, githubApi_1.renderMarkdown)(text, `${repo.owner}/${repo.repo}`, token);
    }
    /** Local file for an image shown in a post or the preview; downloads it once into `.null/issue-images`. */
    async resolveImage(url) {
        const { token } = await this.ensureSession(false);
        return (0, imageCache_1.resolveImage)(url, { root: this.getCwd(), token }); // ensureSession succeeded, so there is a workspace folder
    }
    /** Commits an image to the repo's `null-issue-assets` branch and returns the markdown that links it. Prompts for sign-in like every write. */
    async uploadImage(name, mime, bytes) {
        const { repo, token } = await this.ensureSession(true);
        return (0, imageUpload_1.uploadImage)(repo, token, { name, mime, bytes });
    }
    /** Issues for the composer's `#` popup: what is already loaded first, then (from 2 characters) a server search. */
    async suggestIssues(prefix) {
        const local = (0, issueSuggest_1.matchIssues)([...this.known.values()], prefix);
        if (prefix.length < 2 || local.length >= 5)
            return local;
        try {
            const page = await this.search(prefix, null, false);
            const have = new Set(local.map(i => i.number));
            return local.concat(page.items.filter(i => !have.has(i.number)).map(issueSuggest_1.toSuggestion)).slice(0, 8);
        }
        catch {
            return local; // offline or rate limited: the loaded issues are still a useful answer
        }
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
    /**
     * REST create can't set an issue type or a parent, so they follow it. Returns what failed and never throws.
     * ponytail: the parent's node id comes from a full getDetail (100 timeline items); add a light id query if that is ever slow.
     */
    applyCreateExtras(created, extras) {
        const steps = [];
        const { typeId, parent } = extras;
        if (typeId) {
            steps.push({
                what: 'set the type',
                run: async () => {
                    if (!created.node_id)
                        throw new Error('GitHub did not return the issue id');
                    await this.setIssueType(created.node_id, typeId);
                },
            });
        }
        if (parent) {
            steps.push({
                what: `link it to #${parent}`,
                run: async () => this.addSubIssue((await this.getDetail(parent)).id, created.number),
            });
        }
        return (0, createExtras_1.runCreateExtras)(steps);
    }
}
exports.IssuesStore = IssuesStore;
//# sourceMappingURL=issuesStore.js.map
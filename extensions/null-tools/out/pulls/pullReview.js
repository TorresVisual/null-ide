'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PullReview = void 0;
const vscode = __importStar(require("vscode"));
const githubApi_1 = require("../github/githubApi");
const pullApi_1 = require("./pullApi");
const githubAuth_1 = require("../github/githubAuth");
const pullDocs_1 = require("./pullDocs");
const pullModel_1 = require("./pullModel");
const pullReviewApi_1 = require("./pullReviewApi");
const pullDiff_1 = require("./pullDiff");
const NOTICE_KEY = 'null.pulls.commentNoticeShown';
function toComment(c) {
    return {
        body: new vscode.MarkdownString(c.body),
        mode: vscode.CommentMode.Preview,
        author: { name: c.author, iconPath: c.avatar ? vscode.Uri.parse(c.avatar) : undefined },
        label: c.pending ? 'Pending' : undefined,
    };
}
/** Review threads of the PRs the tree has opened, shown in the diff editors, plus posting new comments and replies. */
class PullReview {
    globalState;
    controller = vscode.comments.createCommentController('null.pulls', 'Pull Request Review');
    byPull = new Map();
    /** First comment of each existing thread: GitHub replies hang off it. */
    roots = new WeakMap();
    /** GraphQL node id of each existing thread: resolving, and replies inside a pending review, need it. */
    ids = new WeakMap();
    constructor(globalState) {
        this.globalState = globalState;
        this.controller.commentingRangeProvider = {
            provideCommentingRanges: doc => doc.uri.scheme === pullDocs_1.PULL_SCHEME && (0, pullDocs_1.parseDocQuery)(doc.uri.path, doc.uri.query)
                ? [new vscode.Range(0, 0, Math.max(doc.lineCount - 1, 0), 0)]
                : undefined,
        };
    }
    /** (Re)shows `threads` for one PR. GitHub rejects a comment on a line outside the diff; the error is shown as is. */
    show(detail, threads) {
        this.drop(detail.pull.number);
        const shown = threads.map(t => {
            const first = (t.startLine ?? t.line) - 1;
            const thread = this.controller.createCommentThread((0, pullDiff_1.sideUri)(detail, t.path, t.side), new vscode.Range(first, 0, t.line - 1, 0), t.comments.map(toComment));
            thread.canReply = true;
            thread.state = t.resolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
            thread.collapsibleState = t.resolved ? vscode.CommentThreadCollapsibleState.Collapsed : vscode.CommentThreadCollapsibleState.Expanded;
            this.roots.set(thread, t.comments[0].id);
            this.ids.set(thread, t.id);
            thread.contextValue = (0, pullModel_1.threadAction)(t);
            return thread;
        });
        this.byPull.set(detail.pull.number, shown);
    }
    clear() {
        for (const n of [...this.byPull.keys()])
            this.drop(n);
    }
    drop(pull) {
        for (const thread of this.byPull.get(pull) ?? [])
            thread.dispose();
        this.byPull.delete(pull);
    }
    /** Command handler for the thread's submit button: a reply on an existing thread, otherwise a new line comment. */
    async submit(reply) {
        const { thread, text } = reply;
        const ref = (0, pullDocs_1.parseDocQuery)(thread.uri.path, thread.uri.query);
        if (!ref || !text.trim())
            return;
        const session = await (0, githubAuth_1.getGithubSession)(true);
        if (!session)
            return;
        try {
            const root = this.roots.get(thread);
            const posted = root === undefined
                ? await this.postNew(ref, thread, text, session.accessToken)
                : await (0, pullApi_1.replyToComment)(ref.owner, ref.repo, ref.pull, root, text, session.accessToken);
            if (root === undefined) {
                this.roots.set(thread, posted.id);
                thread.canReply = true;
            }
            thread.comments = [...thread.comments, toComment(posted)];
            this.noticeOnce(ref);
        }
        catch (err) {
            void vscode.window.showErrorMessage(`Could not post the comment: ${(0, pullModel_1.describeFailure)(err)}`);
        }
    }
    /** Command handler for *Add Review Comment*: into the viewer's pending review (started if needed), as a reply or a new thread. */
    async addToReview(reply) {
        const { thread, text } = reply;
        const ref = (0, pullDocs_1.parseDocQuery)(thread.uri.path, thread.uri.query);
        if (!ref || !text.trim())
            return;
        const session = await (0, githubAuth_1.getGithubSession)(true);
        if (!session)
            return;
        try {
            const token = session.accessToken;
            const reviewId = await (0, pullReviewApi_1.ensureReview)(ref.owner, ref.repo, ref.pull, token);
            const threadId = this.ids.get(thread);
            let posted;
            if (threadId !== undefined) {
                posted = await (0, pullReviewApi_1.replyInReview)(reviewId, threadId, text, token);
            }
            else {
                const created = await this.addThread(reviewId, ref, thread, text, token);
                this.ids.set(thread, created.threadId);
                this.roots.set(thread, created.comment.id);
                thread.canReply = true;
                posted = created.comment;
            }
            thread.comments = [...thread.comments, toComment(posted)];
        }
        catch (err) {
            void vscode.window.showErrorMessage(`Could not add the review comment: ${(0, pullModel_1.describeFailure)(err)}`);
        }
    }
    /** The selected range; when GitHub rejects it (it crosses hunks) the first line alone, like an immediate comment. */
    async addThread(reviewId, ref, thread, body, token) {
        const first = (thread.range?.start.line ?? 0) + 1;
        const last = (thread.range?.end.line ?? 0) + 1;
        const input = { reviewId, body, path: ref.path, side: ref.side };
        try {
            return await (0, pullReviewApi_1.addReviewThread)({ ...input, startLine: first, line: last }, token);
        }
        catch (err) {
            if (first === last)
                throw err;
            return (0, pullReviewApi_1.addReviewThread)({ ...input, line: first }, token); // a GraphQL error carries no 422: any failure of a range retries once
        }
    }
    /** Command handler for the thread-title buttons. GitHub decides whether the viewer may; its refusal is shown as is. */
    async setResolved(thread, resolved) {
        const id = this.ids.get(thread);
        if (id === undefined)
            return;
        const session = await (0, githubAuth_1.getGithubSession)(true);
        if (!session)
            return;
        try {
            await (0, pullReviewApi_1.setThreadResolved)(id, resolved, session.accessToken);
            thread.state = resolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
            thread.collapsibleState = resolved ? vscode.CommentThreadCollapsibleState.Collapsed : vscode.CommentThreadCollapsibleState.Expanded;
            thread.contextValue = resolved ? 'unresolvable' : 'resolvable'; // the viewer just did one, so may undo it
        }
        catch (err) {
            void vscode.window.showErrorMessage(`Could not ${resolved ? 'resolve' : 'reopen'} the thread: ${(0, pullModel_1.describeFailure)(err)}`);
        }
    }
    /** The selected range as one comment; when GitHub rejects the range (422: it crosses hunks) the first line alone. */
    async postNew(ref, thread, body, token) {
        const input = { body, commitId: ref.head, path: ref.path, side: ref.side };
        const first = (thread.range?.start.line ?? 0) + 1;
        const last = (thread.range?.end.line ?? 0) + 1;
        // ponytail: a new comment on the left side of a renamed file posts the old name as `path`, which GitHub rejects (422, shown as the toast). Carry the current path in DocRef to fix.
        try {
            return await (0, pullApi_1.createLineComment)(ref.owner, ref.repo, ref.pull, { ...input, startLine: first, line: last }, token);
        }
        catch (err) {
            if (first === last || !(err instanceof githubApi_1.ApiError) || err.status !== 422)
                throw err;
            return (0, pullApi_1.createLineComment)(ref.owner, ref.repo, ref.pull, { ...input, line: first }, token);
        }
    }
    /** Comments go out at once and notify the author; say so after the first one, with the way to delete a mistake. */
    noticeOnce(ref) {
        if (this.globalState.get(NOTICE_KEY))
            return;
        void this.globalState.update(NOTICE_KEY, true);
        void vscode.window.showInformationMessage('Comment Now posts at once and notifies the author. To send several comments together, use Add Review Comment and finish the review from the pull request. Editing or deleting a comment is done on GitHub.', 'Open on GitHub').then(choice => {
            if (choice)
                void vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${ref.owner}/${ref.repo}/pull/${ref.pull}`));
        });
    }
    dispose() {
        this.clear();
        this.controller.dispose();
    }
}
exports.PullReview = PullReview;
//# sourceMappingURL=pullReview.js.map
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.threadCount = exports.checkStateOf = exports.pullStateOf = exports.REVIEW_THREADS = exports.LIST_PULLS = void 0;
exports.mapPulls = mapPulls;
exports.mapFiles = mapFiles;
exports.leftPath = leftPath;
exports.commentFromGql = commentFromGql;
exports.mapThreads = mapThreads;
exports.threadAction = threadAction;
exports.pullBranch = pullBranch;
exports.pinCurrent = pinCurrent;
exports.commentFromRest = commentFromRest;
exports.describeFailure = describeFailure;
const githubApi_1 = require("../github/githubApi");
exports.LIST_PULLS = `
query ListPulls($q: String!, $first: Int!) {
  search(query: $q, type: ISSUE, first: $first) {
    nodes { ... on PullRequest {
      number title url state isDraft updatedAt isCrossRepository headRefName baseRefName headRefOid baseRefOid reviewDecision
      author { login }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    } }
  }
}`;
exports.REVIEW_THREADS = `
query ReviewThreads($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) { nodes {
        id isResolved isOutdated viewerCanResolve viewerCanUnresolve path line startLine diffSide
        comments(first: 50) { nodes { databaseId state body createdAt author { login avatarUrl } } }
      } }
    }
  }
}`;
const CHECKS = {
    SUCCESS: 'success', FAILURE: 'failure', ERROR: 'failure', PENDING: 'pending', EXPECTED: 'pending',
};
const REVIEWS = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'required' };
const pullStateOf = (s) => (s === 'MERGED' ? 'merged' : s === 'CLOSED' ? 'closed' : 'open');
exports.pullStateOf = pullStateOf;
const checkStateOf = (s) => CHECKS[s ?? ''] ?? 'none';
exports.checkStateOf = checkStateOf;
function mapPulls(data) {
    return data.search.nodes
        .filter((n) => typeof n.number === 'number')
        .map(n => ({
        number: n.number,
        title: n.title,
        url: n.url,
        state: (0, exports.pullStateOf)(n.state),
        draft: n.isDraft,
        author: n.author?.login ?? 'ghost',
        fork: n.isCrossRepository,
        headRef: n.headRefName,
        baseRef: n.baseRefName,
        headSha: n.headRefOid,
        baseSha: n.baseRefOid,
        updatedAt: n.updatedAt,
        checks: (0, exports.checkStateOf)(n.commits.nodes[0]?.commit.statusCheckRollup?.state),
        review: REVIEWS[n.reviewDecision ?? ''] ?? 'none',
    }));
}
function mapFiles(raw) {
    return raw.map(f => ({
        path: f.filename,
        ...(f.previous_filename ? { oldPath: f.previous_filename } : {}),
        status: f.status === 'added' || f.status === 'removed' || f.status === 'renamed' ? f.status : 'modified',
        additions: f.additions,
        deletions: f.deletions,
    }));
}
/** The path a file had on the left (merge-base) side; GitHub reports a renamed file's comments under its new name. */
function leftPath(files, path) {
    return files.find(f => f.path === path)?.oldPath ?? path;
}
function commentFromGql(c) {
    return {
        id: c.databaseId, body: c.body, author: c.author?.login ?? 'ghost', avatar: c.author?.avatarUrl ?? '',
        createdAt: c.createdAt, pending: c.state === 'PENDING',
    };
}
function mapThreads(data) {
    const nodes = data.repository.pullRequest?.reviewThreads.nodes ?? [];
    // ponytail: outdated threads (their line no longer exists in the head) are not shown, only counted for the
    // PR's tooltip; show them on the file's first line, or in the Phase 2 detail page, if that turns out to be missed.
    const threads = nodes
        .filter(t => !t.isOutdated && t.line !== null && t.comments.nodes.length > 0)
        .map(t => ({
        id: t.id,
        path: t.path,
        line: t.line,
        startLine: t.startLine,
        side: t.diffSide,
        resolved: t.isResolved,
        canResolve: t.viewerCanResolve,
        canUnresolve: t.viewerCanUnresolve,
        comments: t.comments.nodes.map(commentFromGql),
    }));
    return { threads, outdated: nodes.filter(t => t.isOutdated).length };
}
const threadCount = (threads, path) => threads.filter(t => t.path === path).length;
exports.threadCount = threadCount;
/** The comment thread's `contextValue`: what the thread-title button (Resolve / Unresolve) may offer, if anything. */
function threadAction(t) {
    if (t.resolved)
        return t.canUnresolve ? 'unresolvable' : undefined;
    return t.canResolve ? 'resolvable' : undefined;
}
/**
 * The local branch a PR is checked out as: its own head branch name for a same-repo PR, `pr/<n>` for a fork PR.
 * A head name that git could read as an option or that has odd characters also falls back to `pr/<n>`.
 */
function pullBranch(pull) {
    const safe = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(pull.headRef);
    return !pull.fork && safe ? pull.headRef : `pr/${pull.number}`;
}
/** The PR of the checked-out branch first (the one you most likely want next), the rest in their given order. */
function pinCurrent(pulls, branch) {
    const current = branch === null ? undefined : pulls.find(p => pullBranch(p) === branch);
    return current ? [current, ...pulls.filter(p => p !== current)] : pulls;
}
function commentFromRest(c) {
    return { id: c.id, body: c.body, author: c.user.login, avatar: c.user.avatar_url, createdAt: c.created_at, pending: false };
}
/** One line for the tree's status message: GitHub's own explanation, plus when a rate limit lifts. */
function describeFailure(err, now = Date.now()) {
    if (err instanceof githubApi_1.ApiError && err.retryAt !== null) {
        const minutes = Math.max(1, Math.ceil((err.retryAt - now) / 60_000));
        return `${err.message}. Try again in ${minutes} min.`;
    }
    return err instanceof Error ? err.message : String(err);
}
//# sourceMappingURL=pullModel.js.map
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.listOpenPulls = listOpenPulls;
exports.fetchPullFiles = fetchPullFiles;
exports.fetchMergeBase = fetchMergeBase;
exports.fetchReviewThreads = fetchReviewThreads;
exports.createLineComment = createLineComment;
exports.replyToComment = replyToComment;
const githubApi_1 = require("../github/githubApi");
const pullModel_1 = require("./pullModel");
// ponytail: the 50 most recently updated open PRs; add cursor paging (like the issues list) if a repo has more.
async function listOpenPulls(owner, repo, token) {
    return (0, pullModel_1.mapPulls)(await (0, githubApi_1.requestGraphql)(pullModel_1.LIST_PULLS, { q: (0, pullModel_1.openPullsQuery)(owner, repo), first: 50 }, token));
}
/** All changed files. GitHub caps a PR at 3000 files, i.e. 30 pages of 100. */
async function fetchPullFiles(owner, repo, pull, token) {
    const all = [];
    for (let page = 1; page <= 30; page++) {
        const batch = await (0, githubApi_1.requestJson)(`/repos/${owner}/${repo}/pulls/${pull}/files?per_page=100&page=${page}`, token);
        all.push(...batch);
        if (batch.length < 100)
            break;
    }
    return (0, pullModel_1.mapFiles)(all);
}
async function fetchMergeBase(owner, repo, baseSha, headSha, token) {
    const cmp = await (0, githubApi_1.requestJson)(`/repos/${owner}/${repo}/compare/${baseSha}...${headSha}?per_page=1`, token);
    return cmp.merge_base_commit.sha;
}
async function fetchReviewThreads(owner, repo, pull, token) {
    return (0, pullModel_1.mapThreads)(await (0, githubApi_1.requestGraphql)(pullModel_1.REVIEW_THREADS, { owner, name: repo, number: pull }, token));
}
// ponytail: posts at once. Phase 3 adds pending reviews.
async function createLineComment(owner, repo, pull, input, token) {
    const range = input.startLine !== undefined && input.startLine < input.line
        ? { start_line: input.startLine, start_side: input.side } : {};
    const created = await (0, githubApi_1.requestJson)(`/repos/${owner}/${repo}/pulls/${pull}/comments`, token, 'POST', {
        body: input.body, commit_id: input.commitId, path: input.path, ...range, line: input.line, side: input.side,
    });
    return (0, pullModel_1.commentFromRest)(created);
}
async function replyToComment(owner, repo, pull, commentId, body, token) {
    const created = await (0, githubApi_1.requestJson)(`/repos/${owner}/${repo}/pulls/${pull}/comments/${commentId}/replies`, token, 'POST', { body });
    return (0, pullModel_1.commentFromRest)(created);
}
//# sourceMappingURL=pullApi.js.map
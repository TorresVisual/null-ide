'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchReviewState = fetchReviewState;
exports.ensureReview = ensureReview;
exports.addReviewThread = addReviewThread;
exports.replyInReview = replyInReview;
exports.submitReview = submitReview;
exports.submitNewReview = submitNewReview;
exports.discardReview = discardReview;
exports.setThreadResolved = setThreadResolved;
const githubApi_1 = require("../github/githubApi");
const pullModel_1 = require("./pullModel");
// GitHub shows an unsent (PENDING) review to its author only, so this is always the viewer's own, at most one.
const REVIEW_STATE = `
query ReviewState($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id headRefOid viewerDidAuthor
      reviews(first: 1, states: [PENDING]) { nodes { id comments { totalCount } } }
    }
  }
}`;
async function fetchReviewState(owner, repo, number, token) {
    const p = (await (0, githubApi_1.requestGraphql)(REVIEW_STATE, { owner, name: repo, number }, token)).repository?.pullRequest;
    if (!p)
        throw new Error('Pull request not found.');
    const unsent = p.reviews.nodes[0];
    return { pullId: p.id, headSha: p.headRefOid, viewerIsAuthor: p.viewerDidAuthor, reviewId: unsent?.id ?? null, comments: unsent?.comments.totalCount ?? 0 };
}
// No `event`: the review stays PENDING. With an `event` the same mutation creates and submits in one go.
const ADD_REVIEW = `
mutation AddReview($input: AddPullRequestReviewInput!) { addPullRequestReview(input: $input) { pullRequestReview { id } } }`;
/** The unsent review's id; one is started (anchored on the current head) when there is none. */
async function ensureReview(owner, repo, number, token) {
    const state = await fetchReviewState(owner, repo, number, token);
    if (state.reviewId)
        return state.reviewId;
    const created = await (0, githubApi_1.requestGraphql)(ADD_REVIEW, { input: { pullRequestId: state.pullId, commitOID: state.headSha } }, token);
    return created.addPullRequestReview.pullRequestReview.id;
}
const ADD_THREAD = `
mutation AddThread($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) {
    thread { id comments(first: 1) { nodes { databaseId state body createdAt author { login avatarUrl } } } }
  }
}`;
/** `startLine` below `line` makes it a range on `side`; GitHub refuses a range that crosses hunks. */
async function addReviewThread(input, token) {
    const range = input.startLine !== undefined && input.startLine < input.line ? { startLine: input.startLine, startSide: input.side } : {};
    const data = await (0, githubApi_1.requestGraphql)(ADD_THREAD, { input: { pullRequestReviewId: input.reviewId, body: input.body, path: input.path, line: input.line, side: input.side, ...range } }, token);
    const thread = data.addPullRequestReviewThread.thread;
    if (!thread || thread.comments.nodes.length === 0)
        throw new Error('GitHub did not create the comment.');
    return { threadId: thread.id, comment: (0, pullModel_1.commentFromGql)(thread.comments.nodes[0]) };
}
const REPLY = `
mutation Reply($input: AddPullRequestReviewThreadReplyInput!) {
  addPullRequestReviewThreadReply(input: $input) { comment { databaseId state body createdAt author { login avatarUrl } } }
}`;
async function replyInReview(reviewId, threadId, body, token) {
    const data = await (0, githubApi_1.requestGraphql)(REPLY, { input: { pullRequestReviewId: reviewId, pullRequestReviewThreadId: threadId, body } }, token);
    return (0, pullModel_1.commentFromGql)(data.addPullRequestReviewThreadReply.comment);
}
const SUBMIT = `
mutation Submit($input: SubmitPullRequestReviewInput!) { submitPullRequestReview(input: $input) { pullRequestReview { id } } }`;
async function submitReview(reviewId, event, body, token) {
    await (0, githubApi_1.requestGraphql)(SUBMIT, { input: { pullRequestReviewId: reviewId, event, body } }, token);
}
/** Nothing was pending: create the review and submit it in one call. */
async function submitNewReview(state, event, body, token) {
    await (0, githubApi_1.requestGraphql)(ADD_REVIEW, { input: { pullRequestId: state.pullId, commitOID: state.headSha, event, body } }, token);
}
const DISCARD = `
mutation Discard($input: DeletePullRequestReviewInput!) { deletePullRequestReview(input: $input) { pullRequestReview { id } } }`;
async function discardReview(reviewId, token) {
    await (0, githubApi_1.requestGraphql)(DISCARD, { input: { pullRequestReviewId: reviewId } }, token);
}
const RESOLVE = `
mutation Resolve($input: ResolveReviewThreadInput!) { resolveReviewThread(input: $input) { thread { id } } }`;
const UNRESOLVE = `
mutation Unresolve($input: UnresolveReviewThreadInput!) { unresolveReviewThread(input: $input) { thread { id } } }`;
async function setThreadResolved(threadId, resolved, token) {
    await (0, githubApi_1.requestGraphql)(resolved ? RESOLVE : UNRESOLVE, { input: { threadId } }, token);
}
//# sourceMappingURL=pullReviewApi.js.map
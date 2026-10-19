'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergePull = mergePull;
exports.setPullOpen = setPullOpen;
exports.setPullDraft = setPullDraft;
const githubApi_1 = require("../github/githubApi");
const MERGE = `
mutation Merge($input: MergePullRequestInput!) { mergePullRequest(input: $input) { pullRequest { merged } } }`;
/** `expectedHeadSha` makes GitHub refuse when the branch moved since the page was loaded. Default commit message; the branch is kept. */
async function mergePull(pullId, method, expectedHeadSha, token) {
    await (0, githubApi_1.requestGraphql)(MERGE, { input: { pullRequestId: pullId, mergeMethod: method, expectedHeadOid: expectedHeadSha } }, token);
}
const CLOSE = `
mutation Close($input: ClosePullRequestInput!) { closePullRequest(input: $input) { pullRequest { state } } }`;
const REOPEN = `
mutation Reopen($input: ReopenPullRequestInput!) { reopenPullRequest(input: $input) { pullRequest { state } } }`;
async function setPullOpen(pullId, open, token) {
    await (0, githubApi_1.requestGraphql)(open ? REOPEN : CLOSE, { input: { pullRequestId: pullId } }, token);
}
const TO_DRAFT = `
mutation ToDraft($input: ConvertPullRequestToDraftInput!) { convertPullRequestToDraft(input: $input) { pullRequest { isDraft } } }`;
const TO_READY = `
mutation ToReady($input: MarkPullRequestReadyForReviewInput!) { markPullRequestReadyForReview(input: $input) { pullRequest { isDraft } } }`;
async function setPullDraft(pullId, draft, token) {
    await (0, githubApi_1.requestGraphql)(draft ? TO_DRAFT : TO_READY, { input: { pullRequestId: pullId } }, token);
}
//# sourceMappingURL=pullLifecycleApi.js.map
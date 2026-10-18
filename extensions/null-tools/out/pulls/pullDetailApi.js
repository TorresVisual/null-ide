'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPullPage = fetchPullPage;
exports.rerunFailedRuns = rerunFailedRuns;
const githubApi_1 = require("../github/githubApi");
const pullDetailModel_1 = require("./pullDetailModel");
async function fetchPullPage(owner, repo, number, token) {
    return (0, pullDetailModel_1.mapPullPage)(await (0, githubApi_1.requestGraphql)(pullDetailModel_1.PULL_PAGE, { owner, name: repo, number }, token));
}
/** One POST per workflow run, in order; a run GitHub refuses (still running, no Actions permission) is reported and the rest still go. */
async function rerunFailedRuns(owner, repo, runIds, token) {
    const result = { started: 0, errors: [] };
    for (const id of runIds) {
        try {
            await (0, githubApi_1.requestJson)(`/repos/${owner}/${repo}/actions/runs/${id}/rerun-failed-jobs`, token, 'POST', {});
            result.started++;
        }
        catch (err) {
            result.errors.push(err instanceof Error ? err.message : String(err));
        }
    }
    return result;
}
//# sourceMappingURL=pullDetailApi.js.map
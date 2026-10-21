'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyError = classifyError;
exports.fetchRepos = fetchRepos;
const githubApi_1 = require("../github/githubApi");
const widgetQueries_1 = require("./widgetQueries");
const OFFLINE = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);
const PER_SEARCH = 20; // comfortably above the row maxima after merging and de-duplicating
function classifyError(err) {
    if (err instanceof githubApi_1.ApiError) {
        if (err.retryAt !== null) {
            return { reason: 'error', retryAt: err.retryAt };
        }
        return { reason: err.status === 401 ? 'signed_out' : 'error', retryAt: null };
    }
    const code = err?.code;
    return { reason: code && OFFLINE.has(code) ? 'offline' : 'error', retryAt: null };
}
async function fetchRepos(deps, accountId, repos) {
    const token = await deps.token(accountId);
    if (!token) {
        return repos.map(repo => ({ repo, reason: 'signed_out' }));
    }
    const local = deps.localPaths();
    const results = [];
    for (const chunk of (0, widgetQueries_1.chunkRepos)(repos)) {
        try {
            const data = await deps.graphql(widgetQueries_1.WIDGET_QUERY, { ...(0, widgetQueries_1.searchStrings)(chunk), n: PER_SEARCH }, token);
            const issues = (0, widgetQueries_1.mapIssues)(data, local), prs = (0, widgetQueries_1.mapPrs)(data, local);
            for (const repo of chunk) {
                const key = repo.toLowerCase();
                results.push({ repo, issues: issues.filter(i => i.repo.toLowerCase() === key), prs: prs.filter(p => p.repo.toLowerCase() === key) });
            }
        }
        catch (err) {
            const { reason, retryAt } = classifyError(err);
            for (const repo of chunk) {
                results.push({ repo, reason, retryAt });
            }
        }
    }
    return results;
}
//# sourceMappingURL=widgetFetch.js.map
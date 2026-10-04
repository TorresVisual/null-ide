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
exports.ApiError = void 0;
exports.formatApiError = formatApiError;
exports.rateLimitRetryAt = rateLimitRetryAt;
exports.requestGraphql = requestGraphql;
exports.fetchIssues = fetchIssues;
exports.updateIssue = updateIssue;
exports.createIssue = createIssue;
exports.fetchRepoLabels = fetchRepoLabels;
exports.fetchAssignableUsers = fetchAssignableUsers;
const https = __importStar(require("https"));
const issueFilter_1 = require("./issueFilter");
/** User-facing message for a failed GitHub REST or GraphQL call, keeping GitHub's own explanation. */
function formatApiError(status, body) {
    const prefix = status >= 200 && status < 300 ? 'GitHub API error' : `GitHub API ${status}`;
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        return prefix;
    }
    if (!parsed || typeof parsed !== 'object')
        return prefix;
    const details = (parsed.errors ?? []).map(e => typeof e === 'string' ? e : e.message ?? [e.field, e.code].filter(Boolean).join(' '));
    const parts = [parsed.message, ...details].filter(Boolean);
    return parts.length > 0 ? `${prefix}: ${parts.join(' · ')}` : prefix;
}
/** A failed GitHub call. `retryAt` (epoch ms) is set when GitHub says to wait before retrying. */
class ApiError extends Error {
    status;
    retryAt;
    constructor(message, status, retryAt = null) {
        super(message);
        this.status = status;
        this.retryAt = retryAt;
    }
}
exports.ApiError = ApiError;
/** When a rate-limited request may be retried: `Retry-After` wins, else the primary limit's reset time. */
function rateLimitRetryAt(headers, now = Date.now()) {
    const retryAfter = Number(headers['retry-after']);
    if (retryAfter > 0)
        return now + retryAfter * 1000;
    const reset = Number(headers['x-ratelimit-reset']);
    return headers['x-ratelimit-remaining'] === '0' && reset > 0 ? reset * 1000 : null;
}
function request(path, token, method, body) {
    return new Promise((resolve, reject) => {
        const headers = {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'Null-IDE',
        };
        if (token)
            headers.Authorization = `Bearer ${token}`;
        const payload = body !== undefined ? JSON.stringify(body) : undefined;
        if (payload)
            headers['Content-Type'] = 'application/json';
        const req = https.request(`https://api.github.com${path}`, { method, headers }, res => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => (data += chunk));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        req.setTimeout(10000, () => req.destroy(new Error('GitHub API request timed out')));
        if (payload)
            req.write(payload);
        req.end();
    });
}
function failure(res) {
    const limited = res.status === 403 || res.status === 429;
    return new ApiError(formatApiError(res.status, res.body), res.status, limited ? rateLimitRetryAt(res.headers) : null);
}
async function requestJson(path, token, method = 'GET', body) {
    const res = await request(path, token, method, body);
    if (res.status < 200 || res.status >= 300)
        throw failure(res);
    return (res.body ? JSON.parse(res.body) : undefined);
}
/** POST /graphql. Resolves to `data`; rejects on HTTP errors and on any GraphQL `errors[]`, even with partial data. */
async function requestGraphql(query, variables, token) {
    const res = await request('/graphql', token, 'POST', { query, variables });
    if (res.status < 200 || res.status >= 300)
        throw failure(res);
    const parsed = JSON.parse(res.body);
    // A half-filled list is worse than an error, so partial data next to errors[] is dropped.
    if (parsed.errors?.length || !parsed.data) {
        throw new ApiError(formatApiError(res.status, res.body), res.status, rateLimitRetryAt(res.headers));
    }
    return parsed.data;
}
// ponytail: single page, 100 issues max — add Link-header pagination if a
// tracked repo ever exceeds that many open issues.
async function fetchIssues(owner, repo, state, token) {
    const raw = await requestJson(`/repos/${owner}/${repo}/issues?state=${state}&per_page=100`, token);
    return (0, issueFilter_1.stripPullRequests)(raw);
}
function updateIssue(owner, repo, issueNumber, patch, token) {
    return requestJson(`/repos/${owner}/${repo}/issues/${issueNumber}`, token, 'PATCH', patch);
}
function createIssue(owner, repo, data, token) {
    return requestJson(`/repos/${owner}/${repo}/issues`, token, 'POST', data);
}
function fetchRepoLabels(owner, repo, token) {
    return requestJson(`/repos/${owner}/${repo}/labels?per_page=100`, token);
}
function fetchAssignableUsers(owner, repo, token) {
    return requestJson(`/repos/${owner}/${repo}/assignees?per_page=100`, token);
}
//# sourceMappingURL=githubApi.js.map
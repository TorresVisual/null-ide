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
exports.TooLargeError = exports.ApiError = void 0;
exports.formatApiError = formatApiError;
exports.rateLimitRetryAt = rateLimitRetryAt;
exports.requestRaw = request;
exports.apiFailure = failure;
exports.requestJson = requestJson;
exports.requestGraphql = requestGraphql;
exports.renderMarkdown = renderMarkdown;
exports.fetchIssues = fetchIssues;
exports.updateIssue = updateIssue;
exports.createIssue = createIssue;
exports.fetchBytes = fetchBytes;
exports.fetchRepoFile = fetchRepoFile;
exports.getRefSha = getRefSha;
exports.createOrphanBranch = createOrphanBranch;
exports.putFile = putFile;
const https = __importStar(require("https"));
const issueFilter_1 = require("./issueFilter");
const imageUrls_1 = require("./imageUrls");
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
/** A download past its size cap (`fetchBytes`). Callers that can show a placeholder match this type, not the message. */
class TooLargeError extends Error {
}
exports.TooLargeError = TooLargeError;
/** When a rate-limited request may be retried: `Retry-After` wins, else the primary limit's reset time. */
function rateLimitRetryAt(headers, now = Date.now()) {
    const retryAfter = Number(headers['retry-after']);
    if (retryAfter > 0)
        return now + retryAfter * 1000;
    const reset = Number(headers['x-ratelimit-reset']);
    return headers['x-ratelimit-remaining'] === '0' && reset > 0 ? reset * 1000 : null;
}
/** `maxBytes` (optional) stops reading at twice that size and keeps the tail; `truncated` says so. */
function request(path, token, method, body, maxBytes) {
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
            res.on('data', chunk => {
                data += chunk;
                if (maxBytes !== undefined && data.length > maxBytes * 2) { // stop reading a huge body; the tail is what callers keep
                    res.destroy();
                    resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data.slice(-maxBytes), truncated: true });
                }
            });
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
/** POST /markdown (GFM, in this repo's context): GitHub's own HTML for `text`, as a posted comment would show it. Answers text/html, not JSON. */
async function renderMarkdown(text, repoFullName, token) {
    const res = await request('/markdown', token, 'POST', { text, mode: 'gfm', context: repoFullName });
    if (res.status < 200 || res.status >= 300)
        throw failure(res);
    return res.body;
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
/**
 * GET a file as bytes (an image). `request()` above decodes the body as UTF-8, which would corrupt binary, so this is its
 * own transport. Redirects are followed by hand, up to 5, so the token (see `tokenForUrl`) is only ever sent on the first
 * request. A body past `maxBytes` aborts the download. Not unit-tested: it needs HTTPS (Task 7, scenario 1).
 */
function fetchBytes(url, token, accept, maxBytes, hop = 0) {
    return new Promise((resolve, reject) => {
        if (hop > 5) {
            reject(new Error('Too many redirects'));
            return;
        }
        let target;
        try {
            target = new URL(url);
        }
        catch {
            reject(new Error('Invalid image URL'));
            return;
        }
        if (target.protocol !== 'https:') {
            reject(new Error('Only https images can be fetched'));
            return;
        }
        const headers = { Accept: accept, 'User-Agent': 'Null-IDE' };
        const auth = (0, imageUrls_1.tokenForUrl)(url, token, hop);
        if (auth)
            headers.Authorization = `Bearer ${auth}`;
        const req = https.get(target, { headers }, res => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400 && res.headers.location) {
                res.resume();
                fetchBytes(new URL(res.headers.location, target).href, token, accept, maxBytes, hop + 1).then(resolve, reject);
                return;
            }
            if (status < 200 || status >= 300) {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { if (data.length < 2000)
                    data += chunk; });
                res.on('end', () => reject(new ApiError(formatApiError(status, data), status)));
                return;
            }
            const tooBig = () => {
                res.destroy();
                reject(new TooLargeError(`Image is larger than ${Math.round(maxBytes / (1024 * 1024))} MB`));
            };
            if (Number(res.headers['content-length']) > maxBytes) {
                tooBig();
                return;
            }
            const chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
                size += chunk.length;
                if (size > maxBytes)
                    tooBig();
                else
                    chunks.push(chunk);
            });
            res.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType: res.headers['content-type'] ?? null }));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(15000, () => req.destroy(new Error('Image request timed out')));
    });
}
/** A file of a repo at `ref`, as bytes, through the Contents API's raw media type (works for private repos, unlike a github.com page URL). */
function fetchRepoFile(owner, repo, ref, filePath, token, maxBytes) {
    const apiPath = filePath.split('/').map(encodeURIComponent).join('/');
    return fetchBytes(`https://api.github.com/repos/${owner}/${repo}/contents/${apiPath}?ref=${encodeURIComponent(ref)}`, token, 'application/vnd.github.raw+json', maxBytes);
}
/** The commit a branch points at, or null when the branch doesn't exist. */
async function getRefSha(owner, repo, branch, token) {
    try {
        const ref = await requestJson(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
        return ref.object.sha;
    }
    catch (err) {
        if (err instanceof ApiError && err.status === 404)
            return null;
        throw err;
    }
}
/** Creates `branch` with a single commit that has no parent (so it carries none of the repo's history): blob → tree → commit → ref. */
async function createOrphanBranch(owner, repo, branch, readme, token) {
    const git = `/repos/${owner}/${repo}/git`;
    const blob = await requestJson(`${git}/blobs`, token, 'POST', { content: readme, encoding: 'utf-8' });
    const tree = await requestJson(`${git}/trees`, token, 'POST', {
        tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }],
    });
    const commit = await requestJson(`${git}/commits`, token, 'POST', {
        message: 'Create the issue assets branch', tree: tree.sha, parents: [],
    });
    try {
        await requestJson(`${git}/refs`, token, 'POST', { ref: `refs/heads/${branch}`, sha: commit.sha });
    }
    catch (err) {
        // Another window created it a moment ago: that is the outcome we wanted.
        if (!(err instanceof ApiError && err.status === 422 && /already exists/i.test(err.message)))
            throw err;
    }
}
/** Creates a file on `branch` (Contents API). `base64` is the file's bytes. */
async function putFile(owner, repo, branch, filePath, base64, message, token) {
    const apiPath = filePath.split('/').map(encodeURIComponent).join('/');
    await requestJson(`/repos/${owner}/${repo}/contents/${apiPath}`, token, 'PUT', { message, content: base64, branch });
}
//# sourceMappingURL=githubApi.js.map
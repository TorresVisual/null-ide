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
exports.fetchIssues = fetchIssues;
exports.fetchComments = fetchComments;
exports.updateIssue = updateIssue;
exports.createComment = createComment;
exports.fetchRepoLabels = fetchRepoLabels;
exports.fetchAssignableUsers = fetchAssignableUsers;
const https = __importStar(require("https"));
const issueFilter_1 = require("./issueFilter");
function requestJson(path, token, method = 'GET', body) {
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
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                reject(new Error(`GitHub API ${res.statusCode ?? 'error'}: ${path}`));
                return;
            }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => (data += chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch (err) {
                    reject(err);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => req.destroy(new Error('GitHub API request timed out')));
        if (payload)
            req.write(payload);
        req.end();
    });
}
// ponytail: single page, 100 issues max — add Link-header pagination if a
// tracked repo ever exceeds that many open issues.
async function fetchIssues(owner, repo, state, token) {
    const raw = await requestJson(`/repos/${owner}/${repo}/issues?state=${state}&per_page=100`, token);
    return (0, issueFilter_1.stripPullRequests)(raw);
}
function fetchComments(owner, repo, issueNumber, token) {
    return requestJson(`/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`, token);
}
function updateIssue(owner, repo, issueNumber, patch, token) {
    return requestJson(`/repos/${owner}/${repo}/issues/${issueNumber}`, token, 'PATCH', patch);
}
function createComment(owner, repo, issueNumber, body, token) {
    return requestJson(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, token, 'POST', { body });
}
function fetchRepoLabels(owner, repo, token) {
    return requestJson(`/repos/${owner}/${repo}/labels?per_page=100`, token);
}
function fetchAssignableUsers(owner, repo, token) {
    return requestJson(`/repos/${owner}/${repo}/assignees?per_page=100`, token);
}
//# sourceMappingURL=githubApi.js.map
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
exports.LOG_CAP = exports.enableWorkflow = exports.cancelRun = exports.rerunJob = exports.rerunFailedJobs = exports.rerunRun = void 0;
exports.listRuns = listRuns;
exports.getRun = getRun;
exports.listJobs = listJobs;
exports.getJob = getJob;
exports.listWorkflows = listWorkflows;
exports.listBranches = listBranches;
exports.getDefaultBranch = getDefaultBranch;
exports.dispatchWorkflow = dispatchWorkflow;
exports.fetchJobLog = fetchJobLog;
const https = __importStar(require("https"));
const githubApi_1 = require("../github/githubApi");
const workflowsModel_1 = require("./workflowsModel");
const repoPath = (owner, repo) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
async function listRuns(owner, repo, filter, ctx, page, token) {
    const res = await (0, githubApi_1.requestJson)((0, workflowsModel_1.runsPath)(owner, repo, filter, ctx, page), token);
    return { runs: res.workflow_runs.map(workflowsModel_1.mapRun), total: res.total_count };
}
async function getRun(owner, repo, runId, token) {
    return (0, workflowsModel_1.mapRun)(await (0, githubApi_1.requestJson)(`${repoPath(owner, repo)}/actions/runs/${runId}`, token));
}
async function listJobs(owner, repo, runId, token) {
    const res = await (0, githubApi_1.requestJson)(`${repoPath(owner, repo)}/actions/runs/${runId}/jobs?filter=latest&per_page=100`, token);
    return res.jobs.map(workflowsModel_1.mapJob);
}
async function getJob(owner, repo, jobId, token) {
    return (0, workflowsModel_1.mapJob)(await (0, githubApi_1.requestJson)(`${repoPath(owner, repo)}/actions/jobs/${jobId}`, token));
}
// ponytail: first 100 only (the group says so); add Link-header paging if a repo ever has more workflows than that.
async function listWorkflows(owner, repo, token) {
    const res = await (0, githubApi_1.requestJson)(`${repoPath(owner, repo)}/actions/workflows?per_page=100`, token);
    return { workflows: res.workflows.map(workflowsModel_1.mapWorkflow), total: res.total_count };
}
async function listBranches(owner, repo, token) {
    const res = await (0, githubApi_1.requestJson)(`${repoPath(owner, repo)}/branches?per_page=100`, token);
    return res.map(b => b.name);
}
async function getDefaultBranch(owner, repo, token) {
    return (await (0, githubApi_1.requestJson)(repoPath(owner, repo), token)).default_branch;
}
const post = (owner, repo, tail, token, method = 'POST', body = {}) => (0, githubApi_1.requestJson)(`${repoPath(owner, repo)}/actions/${tail}`, token, method, body);
const rerunRun = (o, r, runId, t) => post(o, r, `runs/${runId}/rerun`, t);
exports.rerunRun = rerunRun;
const rerunFailedJobs = (o, r, runId, t) => post(o, r, `runs/${runId}/rerun-failed-jobs`, t);
exports.rerunFailedJobs = rerunFailedJobs;
const rerunJob = (o, r, jobId, t) => post(o, r, `jobs/${jobId}/rerun`, t);
exports.rerunJob = rerunJob;
const cancelRun = (o, r, runId, t) => post(o, r, `runs/${runId}/cancel`, t);
exports.cancelRun = cancelRun;
const enableWorkflow = (o, r, id, t) => post(o, r, `workflows/${id}/enable`, t, 'PUT');
exports.enableWorkflow = enableWorkflow;
function dispatchWorkflow(owner, repo, workflowId, ref, inputs, token) {
    const body = Object.keys(inputs).length > 0 ? { ref, inputs } : { ref };
    return post(owner, repo, `workflows/${workflowId}/dispatches`, token, 'POST', body);
}
/** Cap in characters (close enough to bytes for a text log). */
exports.LOG_CAP = 5 * 1024 * 1024;
/** Keeps the last `cap` characters, starting at a line boundary. */
function clip(text, cap, alreadyCut = false) {
    if (text.length <= cap && !alreadyCut)
        return { text, truncated: false };
    const tail = text.length > cap ? text.slice(-cap) : text;
    const nl = tail.indexOf('\n');
    return { text: nl >= 0 ? tail.slice(nl + 1) : tail, truncated: true }; // the first line is cut mid-way: drop it
}
/**
 * `GET …/jobs/{id}/logs` answers 302 with a signed URL on another host that expires within about a minute. The first call
 * carries the token; the second is made at once and carries **no** Authorization header (the URL is its own credential, and
 * the token must never leave api.github.com).
 */
async function fetchJobLog(owner, repo, jobId, token, cap = exports.LOG_CAP) {
    const first = await (0, githubApi_1.requestRaw)(`${repoPath(owner, repo)}/actions/jobs/${jobId}/logs`, token, 'GET', undefined, cap);
    if (first.status >= 300 && first.status < 400) {
        const location = first.headers.location;
        if (!location)
            throw new githubApi_1.ApiError('GitHub did not say where the log is.', first.status);
        return fetchLogText(location, cap);
    }
    if (first.status < 200 || first.status >= 300)
        throw (0, githubApi_1.apiFailure)(first);
    return clip(first.body, cap, first.truncated === true);
}
function fetchLogText(url, cap) {
    return new Promise((resolve, reject) => {
        let target;
        try {
            target = new URL(url);
        }
        catch {
            reject(new githubApi_1.ApiError('GitHub sent an invalid log address.', 0));
            return;
        }
        if (target.protocol !== 'https:') {
            reject(new githubApi_1.ApiError('Logs are only fetched over https.', 0));
            return;
        }
        const req = https.request(target.href, { method: 'GET', headers: { 'User-Agent': 'Null-IDE', Accept: '*/*' } }, res => {
            const status = res.statusCode ?? 0;
            let data = '';
            let dropped = false;
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                data += chunk;
                if (data.length > cap * 2) { // never hold more than twice the cap while a huge log streams in
                    data = data.slice(-cap);
                    dropped = true;
                }
            });
            res.on('end', () => {
                if (status < 200 || status >= 300)
                    reject(new githubApi_1.ApiError((0, githubApi_1.formatApiError)(status, data.slice(0, 2000)), status));
                else
                    resolve(clip(data, cap, dropped));
            });
            res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(30_000, () => req.destroy(new Error('Log request timed out')));
        req.end();
    });
}
//# sourceMappingURL=workflowsApi.js.map
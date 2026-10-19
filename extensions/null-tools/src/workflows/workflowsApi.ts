'use strict';

import * as https from 'https';
import { ApiError, apiFailure, formatApiError, requestJson, requestRaw } from '../github/githubApi';
import {
  RunFilter, Workflow, WorkflowJob, WorkflowRun, mapJob, mapRun, mapWorkflow, runsPath,
} from './workflowsModel';

type Raw = Record<string, any>;

const repoPath = (owner: string, repo: string): string => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

export async function listRuns(
  owner: string, repo: string, filter: RunFilter, ctx: { branch: string | null; login: string | null }, page: number, token: string | null,
): Promise<{ runs: WorkflowRun[]; total: number }> {
  const res = await requestJson<{ total_count: number; workflow_runs: Raw[] }>(runsPath(owner, repo, filter, ctx, page), token);
  return { runs: res.workflow_runs.map(mapRun), total: res.total_count };
}

export async function getRun(owner: string, repo: string, runId: number, token: string | null): Promise<WorkflowRun> {
  return mapRun(await requestJson<Raw>(`${repoPath(owner, repo)}/actions/runs/${runId}`, token));
}

export async function listJobs(owner: string, repo: string, runId: number, token: string | null): Promise<WorkflowJob[]> {
  const res = await requestJson<{ jobs: Raw[] }>(`${repoPath(owner, repo)}/actions/runs/${runId}/jobs?filter=latest&per_page=100`, token);
  return res.jobs.map(mapJob);
}

export async function getJob(owner: string, repo: string, jobId: number, token: string | null): Promise<WorkflowJob> {
  return mapJob(await requestJson<Raw>(`${repoPath(owner, repo)}/actions/jobs/${jobId}`, token));
}

// ponytail: first 100 only (the group says so); add Link-header paging if a repo ever has more workflows than that.
export async function listWorkflows(owner: string, repo: string, token: string | null): Promise<{ workflows: Workflow[]; total: number }> {
  const res = await requestJson<{ total_count: number; workflows: Raw[] }>(`${repoPath(owner, repo)}/actions/workflows?per_page=100`, token);
  return { workflows: res.workflows.map(mapWorkflow), total: res.total_count };
}

export async function listBranches(owner: string, repo: string, token: string | null): Promise<string[]> {
  const res = await requestJson<Array<{ name: string }>>(`${repoPath(owner, repo)}/branches?per_page=100`, token);
  return res.map(b => b.name);
}

export async function getDefaultBranch(owner: string, repo: string, token: string | null): Promise<string> {
  return (await requestJson<{ default_branch: string }>(repoPath(owner, repo), token)).default_branch;
}

const post = (owner: string, repo: string, tail: string, token: string | null, method: 'POST' | 'PUT' = 'POST', body: unknown = {}): Promise<void> =>
  requestJson<void>(`${repoPath(owner, repo)}/actions/${tail}`, token, method, body);

export const rerunRun = (o: string, r: string, runId: number, t: string | null): Promise<void> => post(o, r, `runs/${runId}/rerun`, t);
export const rerunFailedJobs = (o: string, r: string, runId: number, t: string | null): Promise<void> => post(o, r, `runs/${runId}/rerun-failed-jobs`, t);
export const rerunJob = (o: string, r: string, jobId: number, t: string | null): Promise<void> => post(o, r, `jobs/${jobId}/rerun`, t);
export const cancelRun = (o: string, r: string, runId: number, t: string | null): Promise<void> => post(o, r, `runs/${runId}/cancel`, t);
export const enableWorkflow = (o: string, r: string, id: number, t: string | null): Promise<void> => post(o, r, `workflows/${id}/enable`, t, 'PUT');

export function dispatchWorkflow(
  owner: string, repo: string, workflowId: number, ref: string, inputs: Record<string, string>, token: string | null,
): Promise<void> {
  const body = Object.keys(inputs).length > 0 ? { ref, inputs } : { ref };
  return post(owner, repo, `workflows/${workflowId}/dispatches`, token, 'POST', body);
}

// ── job logs ────────────────────────────────────────────────────────────────

export interface JobLog { text: string; truncated: boolean }
/** Cap in characters (close enough to bytes for a text log). */
export const LOG_CAP = 5 * 1024 * 1024;

/** Keeps the last `cap` characters, starting at a line boundary. */
function clip(text: string, cap: number, alreadyCut = false): JobLog {
  if (text.length <= cap && !alreadyCut) return { text, truncated: false };
  const tail = text.length > cap ? text.slice(-cap) : text;
  const nl = tail.indexOf('\n');
  return { text: nl >= 0 ? tail.slice(nl + 1) : tail, truncated: true }; // the first line is cut mid-way: drop it
}

/**
 * `GET …/jobs/{id}/logs` answers 302 with a signed URL on another host that expires within about a minute. The first call
 * carries the token; the second is made at once and carries **no** Authorization header (the URL is its own credential, and
 * the token must never leave api.github.com).
 */
export async function fetchJobLog(owner: string, repo: string, jobId: number, token: string | null, cap: number = LOG_CAP): Promise<JobLog> {
  const first = await requestRaw(`${repoPath(owner, repo)}/actions/jobs/${jobId}/logs`, token, 'GET');
  if (first.status >= 300 && first.status < 400) {
    const location = first.headers.location;
    if (!location) throw new ApiError('GitHub did not say where the log is.', first.status);
    return fetchLogText(location, cap);
  }
  if (first.status < 200 || first.status >= 300) throw apiFailure(first);
  return clip(first.body, cap);
}

function fetchLogText(url: string, cap: number): Promise<JobLog> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new ApiError('GitHub sent an invalid log address.', 0));
      return;
    }
    if (target.protocol !== 'https:') {
      reject(new ApiError('Logs are only fetched over https.', 0));
      return;
    }
    const req = https.request(target.href, { method: 'GET', headers: { 'User-Agent': 'Null-IDE', Accept: '*/*' } }, res => {
      const status = res.statusCode ?? 0;
      let data = '';
      let dropped = false;
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        data += chunk;
        if (data.length > cap * 2) { // never hold more than twice the cap while a huge log streams in
          data = data.slice(-cap);
          dropped = true;
        }
      });
      res.on('end', () => {
        if (status < 200 || status >= 300) reject(new ApiError(formatApiError(status, data.slice(0, 2000)), status));
        else resolve(clip(data, cap, dropped));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('Log request timed out')));
    req.end();
  });
}

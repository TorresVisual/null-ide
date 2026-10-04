'use strict';

import * as https from 'https';
import type { IncomingHttpHeaders } from 'http';
import { GithubComment, GithubIssue, GithubLabel, GithubTimelineEvent, GithubUser, IssueState } from './types';
import { stripPullRequests } from './issueFilter';

interface ApiErrorBody {
  message?: string;
  errors?: Array<string | { message?: string; field?: string; code?: string }>;
}

/** User-facing message for a failed GitHub REST or GraphQL call, keeping GitHub's own explanation. */
export function formatApiError(status: number, body: string): string {
  const prefix = status >= 200 && status < 300 ? 'GitHub API error' : `GitHub API ${status}`;
  let parsed: ApiErrorBody | null;
  try {
    parsed = JSON.parse(body) as ApiErrorBody | null;
  } catch {
    return prefix;
  }
  if (!parsed || typeof parsed !== 'object') return prefix;
  const details = (parsed.errors ?? []).map(e =>
    typeof e === 'string' ? e : e.message ?? [e.field, e.code].filter(Boolean).join(' '));
  const parts = [parsed.message, ...details].filter(Boolean);
  return parts.length > 0 ? `${prefix}: ${parts.join(' · ')}` : prefix;
}

/** A failed GitHub call. `retryAt` (epoch ms) is set when GitHub says to wait before retrying. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryAt: number | null = null) {
    super(message);
  }
}

/** When a rate-limited request may be retried: `Retry-After` wins, else the primary limit's reset time. */
export function rateLimitRetryAt(headers: IncomingHttpHeaders, now: number = Date.now()): number | null {
  const retryAfter = Number(headers['retry-after']);
  if (retryAfter > 0) return now + retryAfter * 1000;
  const reset = Number(headers['x-ratelimit-reset']);
  return headers['x-ratelimit-remaining'] === '0' && reset > 0 ? reset * 1000 : null;
}

interface RawResponse { status: number; headers: IncomingHttpHeaders; body: string }

function request(
  path: string, token: string | null, method: 'GET' | 'PATCH' | 'POST' | 'DELETE', body?: unknown,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Null-IDE',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    if (payload) headers['Content-Type'] = 'application/json';

    const req = https.request(`https://api.github.com${path}`, { method, headers }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('GitHub API request timed out')));
    if (payload) req.write(payload);
    req.end();
  });
}

function failure(res: RawResponse): ApiError {
  const limited = res.status === 403 || res.status === 429;
  return new ApiError(formatApiError(res.status, res.body), res.status, limited ? rateLimitRetryAt(res.headers) : null);
}

async function requestJson<T>(
  path: string, token: string | null, method: 'GET' | 'PATCH' | 'POST' | 'DELETE' = 'GET', body?: unknown,
): Promise<T> {
  const res = await request(path, token, method, body);
  if (res.status < 200 || res.status >= 300) throw failure(res);
  return (res.body ? JSON.parse(res.body) : undefined) as T;
}

/** POST /graphql. Resolves to `data`; rejects on HTTP errors and on any GraphQL `errors[]`, even with partial data. */
export async function requestGraphql<T>(
  query: string, variables: Record<string, unknown>, token: string | null,
): Promise<T> {
  const res = await request('/graphql', token, 'POST', { query, variables });
  if (res.status < 200 || res.status >= 300) throw failure(res);
  const parsed = JSON.parse(res.body) as { data?: T; errors?: unknown[] };
  // A half-filled list is worse than an error, so partial data next to errors[] is dropped.
  if (parsed.errors?.length || !parsed.data) {
    throw new ApiError(formatApiError(res.status, res.body), res.status, rateLimitRetryAt(res.headers));
  }
  return parsed.data;
}

// ponytail: single page, 100 issues max — add Link-header pagination if a
// tracked repo ever exceeds that many open issues.
export async function fetchIssues(
  owner: string, repo: string, state: IssueState, token: string | null,
): Promise<GithubIssue[]> {
  const raw = await requestJson<GithubIssue[]>(
    `/repos/${owner}/${repo}/issues?state=${state}&per_page=100`, token,
  );
  return stripPullRequests(raw);
}

export function fetchIssue(
  owner: string, repo: string, issueNumber: number, token: string | null,
): Promise<GithubIssue> {
  return requestJson<GithubIssue>(`/repos/${owner}/${repo}/issues/${issueNumber}`, token);
}

export function fetchComments(
  owner: string, repo: string, issueNumber: number, token: string | null,
): Promise<GithubComment[]> {
  return requestJson<GithubComment[]>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`, token,
  );
}

export function fetchTimeline(
  owner: string, repo: string, issueNumber: number, token: string | null,
): Promise<GithubTimelineEvent[]> {
  return requestJson<GithubTimelineEvent[]>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/timeline?per_page=100`, token,
  );
}

export function updateIssue(
  owner: string, repo: string, issueNumber: number,
  patch: { title?: string; body?: string; state?: 'open' | 'closed'; labels?: string[]; assignees?: string[] },
  token: string | null,
): Promise<GithubIssue> {
  return requestJson<GithubIssue>(`/repos/${owner}/${repo}/issues/${issueNumber}`, token, 'PATCH', patch);
}

export function createIssue(
  owner: string, repo: string,
  data: { title: string; body?: string; labels?: string[]; assignees?: string[] },
  token: string | null,
): Promise<GithubIssue> {
  return requestJson<GithubIssue>(`/repos/${owner}/${repo}/issues`, token, 'POST', data);
}

export function createComment(
  owner: string, repo: string, issueNumber: number, body: string, token: string | null,
): Promise<GithubComment> {
  return requestJson<GithubComment>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, token, 'POST', { body },
  );
}

export function updateComment(
  owner: string, repo: string, commentId: number, body: string, token: string | null,
): Promise<GithubComment> {
  return requestJson<GithubComment>(
    `/repos/${owner}/${repo}/issues/comments/${commentId}`, token, 'PATCH', { body },
  );
}

export function deleteComment(
  owner: string, repo: string, commentId: number, token: string | null,
): Promise<void> {
  return requestJson<void>(`/repos/${owner}/${repo}/issues/comments/${commentId}`, token, 'DELETE');
}

export function fetchRepoLabels(owner: string, repo: string, token: string | null): Promise<GithubLabel[]> {
  return requestJson<GithubLabel[]>(`/repos/${owner}/${repo}/labels?per_page=100`, token);
}

export function fetchAssignableUsers(owner: string, repo: string, token: string | null): Promise<GithubUser[]> {
  return requestJson<GithubUser[]>(`/repos/${owner}/${repo}/assignees?per_page=100`, token);
}

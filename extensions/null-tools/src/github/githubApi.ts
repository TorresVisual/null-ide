'use strict';

import * as https from 'https';
import type { IncomingHttpHeaders } from 'http';
import { GithubIssue, IssueState } from './types';
import { stripPullRequests } from './issueFilter';
import { tokenForUrl } from './imageUrls';

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

/** A download past its size cap (`fetchBytes`). Callers that can show a placeholder match this type, not the message. */
export class TooLargeError extends Error {}

/** When a rate-limited request may be retried: `Retry-After` wins, else the primary limit's reset time. */
export function rateLimitRetryAt(headers: IncomingHttpHeaders, now: number = Date.now()): number | null {
  const retryAfter = Number(headers['retry-after']);
  if (retryAfter > 0) return now + retryAfter * 1000;
  const reset = Number(headers['x-ratelimit-reset']);
  return headers['x-ratelimit-remaining'] === '0' && reset > 0 ? reset * 1000 : null;
}

export interface RawResponse { status: number; headers: IncomingHttpHeaders; body: string; truncated?: boolean }

/** `maxBytes` (optional) stops reading at twice that size and keeps the tail; `truncated` says so. */
function request(
  path: string, token: string | null, method: 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE', body?: unknown, maxBytes?: number,
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
    if (payload) req.write(payload);
    req.end();
  });
}

function failure(res: RawResponse): ApiError {
  const limited = res.status === 403 || res.status === 429;
  return new ApiError(formatApiError(res.status, res.body), res.status, limited ? rateLimitRetryAt(res.headers) : null);
}

/** For callers that must see the status and headers themselves (a redirect they follow by hand). */
export { request as requestRaw, failure as apiFailure };

export async function requestJson<T>(
  path: string, token: string | null, method: 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown,
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

/** POST /markdown (GFM, in this repo's context): GitHub's own HTML for `text`, as a posted comment would show it. Answers text/html, not JSON. */
export async function renderMarkdown(text: string, repoFullName: string, token: string | null): Promise<string> {
  const res = await request('/markdown', token, 'POST', { text, mode: 'gfm', context: repoFullName });
  if (res.status < 200 || res.status >= 300) throw failure(res);
  return res.body;
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

/** Fields of REST `PATCH /issues/:n` the extension sets. `milestone: null` clears it; `labels`/`assignees` replace the set. */
export interface IssuePatch {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  state_reason?: 'completed' | 'not_planned' | 'reopened';
  labels?: string[];
  assignees?: string[];
  milestone?: number | null;
}

export function updateIssue(
  owner: string, repo: string, issueNumber: number, patch: IssuePatch,
  token: string | null,
): Promise<GithubIssue> {
  return requestJson<GithubIssue>(`/repos/${owner}/${repo}/issues/${issueNumber}`, token, 'PATCH', patch);
}

export function createIssue(
  owner: string, repo: string,
  data: { title: string; body?: string; labels?: string[]; assignees?: string[]; milestone?: number },
  token: string | null,
): Promise<GithubIssue> {
  return requestJson<GithubIssue>(`/repos/${owner}/${repo}/issues`, token, 'POST', data);
}

export interface FetchedBytes { bytes: Buffer; contentType: string | null }

/**
 * GET a file as bytes (an image). `request()` above decodes the body as UTF-8, which would corrupt binary, so this is its
 * own transport. Redirects are followed by hand, up to 5, so the token (see `tokenForUrl`) is only ever sent on the first
 * request. A body past `maxBytes` aborts the download. Not unit-tested: it needs HTTPS (Task 7, scenario 1).
 */
export function fetchBytes(url: string, token: string | null, accept: string, maxBytes: number, hop = 0): Promise<FetchedBytes> {
  return new Promise((resolve, reject) => {
    if (hop > 5) {
      reject(new Error('Too many redirects'));
      return;
    }
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new Error('Invalid image URL'));
      return;
    }
    if (target.protocol !== 'https:') {
      reject(new Error('Only https images can be fetched'));
      return;
    }
    const headers: Record<string, string> = { Accept: accept, 'User-Agent': 'Null-IDE' };
    const auth = tokenForUrl(url, token, hop);
    if (auth) headers.Authorization = `Bearer ${auth}`;
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
        res.on('data', chunk => { if (data.length < 2000) data += chunk; });
        res.on('end', () => reject(new ApiError(formatApiError(status, data), status)));
        return;
      }
      const tooBig = (): void => {
        res.destroy();
        reject(new TooLargeError(`Image is larger than ${Math.round(maxBytes / (1024 * 1024))} MB`));
      };
      if (Number(res.headers['content-length']) > maxBytes) {
        tooBig();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) tooBig();
        else chunks.push(chunk);
      });
      res.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType: res.headers['content-type'] ?? null }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Image request timed out')));
  });
}

/** A file of a repo at `ref`, as bytes, through the Contents API's raw media type (works for private repos, unlike a github.com page URL). */
export function fetchRepoFile(
  owner: string, repo: string, ref: string, filePath: string, token: string | null, maxBytes: number,
): Promise<FetchedBytes> {
  const apiPath = filePath.split('/').map(encodeURIComponent).join('/');
  return fetchBytes(
    `https://api.github.com/repos/${owner}/${repo}/contents/${apiPath}?ref=${encodeURIComponent(ref)}`,
    token, 'application/vnd.github.raw+json', maxBytes);
}

/** The commit a branch points at, or null when the branch doesn't exist. */
export async function getRefSha(owner: string, repo: string, branch: string, token: string | null): Promise<string | null> {
  try {
    const ref = await requestJson<{ object: { sha: string } }>(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
    return ref.object.sha;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Creates `branch` with a single commit that has no parent (so it carries none of the repo's history): blob → tree → commit → ref. */
export async function createOrphanBranch(owner: string, repo: string, branch: string, readme: string, token: string | null): Promise<void> {
  const git = `/repos/${owner}/${repo}/git`;
  const blob = await requestJson<{ sha: string }>(`${git}/blobs`, token, 'POST', { content: readme, encoding: 'utf-8' });
  const tree = await requestJson<{ sha: string }>(`${git}/trees`, token, 'POST', {
    tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }],
  });
  const commit = await requestJson<{ sha: string }>(`${git}/commits`, token, 'POST', {
    message: 'Create the issue assets branch', tree: tree.sha, parents: [],
  });
  try {
    await requestJson(`${git}/refs`, token, 'POST', { ref: `refs/heads/${branch}`, sha: commit.sha });
  } catch (err) {
    // Another window created it a moment ago: that is the outcome we wanted.
    if (!(err instanceof ApiError && err.status === 422 && /already exists/i.test(err.message))) throw err;
  }
}

/** Creates a file on `branch` (Contents API). `base64` is the file's bytes. */
export async function putFile(
  owner: string, repo: string, branch: string, filePath: string, base64: string, message: string, token: string | null,
): Promise<void> {
  const apiPath = filePath.split('/').map(encodeURIComponent).join('/');
  await requestJson(`/repos/${owner}/${repo}/contents/${apiPath}`, token, 'PUT', { message, content: base64, branch });
}

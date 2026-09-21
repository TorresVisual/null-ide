'use strict';

import * as https from 'https';
import { GithubComment, GithubIssue, IssueState } from './types';
import { stripPullRequests } from './issueFilter';

function requestJson<T>(
  path: string, token: string | null, method: 'GET' | 'PATCH' | 'POST' = 'GET', body?: unknown,
): Promise<T> {
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
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`GitHub API ${res.statusCode ?? 'error'}: ${path}`));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data) as T); }
        catch (err) { reject(err as Error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('GitHub API request timed out')));
    if (payload) req.write(payload);
    req.end();
  });
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

export function fetchComments(
  owner: string, repo: string, issueNumber: number, token: string | null,
): Promise<GithubComment[]> {
  return requestJson<GithubComment[]>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`, token,
  );
}

export function updateIssue(
  owner: string, repo: string, issueNumber: number,
  patch: { title?: string; body?: string; state?: 'open' | 'closed' }, token: string | null,
): Promise<GithubIssue> {
  return requestJson<GithubIssue>(`/repos/${owner}/${repo}/issues/${issueNumber}`, token, 'PATCH', patch);
}

export function createComment(
  owner: string, repo: string, issueNumber: number, body: string, token: string | null,
): Promise<GithubComment> {
  return requestJson<GithubComment>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, token, 'POST', { body },
  );
}

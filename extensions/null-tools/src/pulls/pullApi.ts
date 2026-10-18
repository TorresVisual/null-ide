'use strict';

import { requestGraphql, requestJson } from '../github/githubApi';
import { PullFilter, pullsQuery } from './pullFilter';
import {
  LIST_PULLS, ListPullsData, PullFile, PullSummary, REVIEW_THREADS, RestComment, RestFile, ReviewComment, ReviewThread,
  ThreadsData, commentFromRest, mapFiles, mapPulls, mapThreads,
} from './pullModel';

// ponytail: the first 50 matches; add cursor paging (like the issues list) if a repo has more.
export async function listPulls(owner: string, repo: string, filter: PullFilter, token: string | null): Promise<PullSummary[]> {
  return mapPulls(await requestGraphql<ListPullsData>(LIST_PULLS, { q: pullsQuery(owner, repo, filter), first: 50 }, token));
}

/** All changed files. GitHub caps a PR at 3000 files, i.e. 30 pages of 100. */
export async function fetchPullFiles(owner: string, repo: string, pull: number, token: string | null): Promise<PullFile[]> {
  const all: RestFile[] = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await requestJson<RestFile[]>(`/repos/${owner}/${repo}/pulls/${pull}/files?per_page=100&page=${page}`, token);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return mapFiles(all);
}

export async function fetchMergeBase(owner: string, repo: string, baseSha: string, headSha: string, token: string | null): Promise<string> {
  const cmp = await requestJson<{ merge_base_commit: { sha: string } }>(
    `/repos/${owner}/${repo}/compare/${baseSha}...${headSha}?per_page=1`, token);
  return cmp.merge_base_commit.sha;
}

export async function fetchReviewThreads(
  owner: string, repo: string, pull: number, token: string | null,
): Promise<{ threads: ReviewThread[]; outdated: number }> {
  return mapThreads(await requestGraphql<ThreadsData>(REVIEW_THREADS, { owner, name: repo, number: pull }, token));
}

/** `startLine` set (and below `line`) makes it a range on `side`; GitHub answers 422 when the range crosses hunks. */
export interface LineCommentInput { body: string; commitId: string; path: string; line: number; startLine?: number; side: 'LEFT' | 'RIGHT' }

// ponytail: posts at once. Phase 3 adds pending reviews.
export async function createLineComment(
  owner: string, repo: string, pull: number, input: LineCommentInput, token: string | null,
): Promise<ReviewComment> {
  const range = input.startLine !== undefined && input.startLine < input.line
    ? { start_line: input.startLine, start_side: input.side } : {};
  const created = await requestJson<RestComment>(`/repos/${owner}/${repo}/pulls/${pull}/comments`, token, 'POST', {
    body: input.body, commit_id: input.commitId, path: input.path, ...range, line: input.line, side: input.side,
  });
  return commentFromRest(created);
}

export async function replyToComment(
  owner: string, repo: string, pull: number, commentId: number, body: string, token: string | null,
): Promise<ReviewComment> {
  const created = await requestJson<RestComment>(
    `/repos/${owner}/${repo}/pulls/${pull}/comments/${commentId}/replies`, token, 'POST', { body });
  return commentFromRest(created);
}

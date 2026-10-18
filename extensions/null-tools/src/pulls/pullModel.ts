'use strict';

import { ApiError } from '../github/githubApi';

export type CheckState = 'success' | 'failure' | 'pending' | 'none';
export type ReviewState = 'approved' | 'changes' | 'required' | 'none';

export interface PullSummary {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  author: string;
  /** The head branch lives in another repository. */
  fork: boolean;
  headRef: string;
  baseRef: string;
  headSha: string;
  baseSha: string;
  updatedAt: string;
  checks: CheckState;
  review: ReviewState;
}

export interface PullFile {
  path: string;
  /** Set for renames only: the name on the base side. */
  oldPath?: string;
  status: 'added' | 'removed' | 'renamed' | 'modified';
  additions: number;
  deletions: number;
}

export interface ReviewComment { id: number; body: string; author: string; avatar: string; createdAt: string }
export interface ReviewThread {
  path: string;
  line: number;
  /** First line of a multi-line thread; null for a single line. */
  startLine: number | null;
  side: 'LEFT' | 'RIGHT';
  resolved: boolean;
  comments: ReviewComment[];
}

/** Everything the tree needs to show one PR's files and to anchor its comment threads. */
export interface PullDetail {
  repo: { owner: string; repo: string };
  pull: PullSummary;
  /** Left side of every diff: GitHub compares a PR from the merge base, not from the base branch tip. */
  mergeBase: string;
  files: PullFile[];
  threads: ReviewThread[];
  /** Threads on code that no longer exists in the head; not shown, only counted. */
  outdated: number;
}

export const LIST_PULLS = `
query ListPulls($q: String!, $first: Int!) {
  search(query: $q, type: ISSUE, first: $first) {
    nodes { ... on PullRequest {
      number title url isDraft updatedAt isCrossRepository headRefName baseRefName headRefOid baseRefOid reviewDecision
      author { login }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    } }
  }
}`;

export const REVIEW_THREADS = `
query ReviewThreads($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) { nodes {
        isResolved isOutdated path line startLine diffSide
        comments(first: 50) { nodes { databaseId body createdAt author { login avatarUrl } } }
      } }
    }
  }
}`;

export const openPullsQuery = (owner: string, repo: string): string => `repo:${owner}/${repo} is:pr is:open sort:updated-desc`;

interface GqlUser { login: string; avatarUrl: string }
interface GqlPull {
  number: number; title: string; url: string; isDraft: boolean; updatedAt: string; isCrossRepository: boolean;
  headRefName: string; baseRefName: string; headRefOid: string; baseRefOid: string;
  reviewDecision: string | null;
  author: { login: string } | null;
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> };
}
export interface ListPullsData { search: { nodes: Array<GqlPull | Record<string, never>> } }

const CHECKS: Record<string, CheckState> = {
  SUCCESS: 'success', FAILURE: 'failure', ERROR: 'failure', PENDING: 'pending', EXPECTED: 'pending',
};
const REVIEWS: Record<string, ReviewState> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'required' };

export function mapPulls(data: ListPullsData): PullSummary[] {
  return data.search.nodes
    .filter((n): n is GqlPull => typeof (n as GqlPull).number === 'number')
    .map(n => ({
      number: n.number,
      title: n.title,
      url: n.url,
      draft: n.isDraft,
      author: n.author?.login ?? 'ghost',
      fork: n.isCrossRepository,
      headRef: n.headRefName,
      baseRef: n.baseRefName,
      headSha: n.headRefOid,
      baseSha: n.baseRefOid,
      updatedAt: n.updatedAt,
      checks: CHECKS[n.commits.nodes[0]?.commit.statusCheckRollup?.state ?? ''] ?? 'none',
      review: REVIEWS[n.reviewDecision ?? ''] ?? 'none',
    }));
}

export interface RestFile { filename: string; previous_filename?: string; status: string; additions: number; deletions: number }

export function mapFiles(raw: RestFile[]): PullFile[] {
  return raw.map(f => ({
    path: f.filename,
    ...(f.previous_filename ? { oldPath: f.previous_filename } : {}),
    status: f.status === 'added' || f.status === 'removed' || f.status === 'renamed' ? f.status : 'modified',
    additions: f.additions,
    deletions: f.deletions,
  }));
}

/** The path a file had on the left (merge-base) side; GitHub reports a renamed file's comments under its new name. */
export function leftPath(files: PullFile[], path: string): string {
  return files.find(f => f.path === path)?.oldPath ?? path;
}

interface GqlComment { databaseId: number; body: string; createdAt: string; author: GqlUser | null }
interface GqlThread {
  isResolved: boolean; isOutdated: boolean; path: string; line: number | null; startLine: number | null; diffSide: 'LEFT' | 'RIGHT';
  comments: { nodes: GqlComment[] };
}
export interface ThreadsData { repository: { pullRequest: { reviewThreads: { nodes: GqlThread[] } } | null } }

export function mapThreads(data: ThreadsData): { threads: ReviewThread[]; outdated: number } {
  const nodes = data.repository.pullRequest?.reviewThreads.nodes ?? [];
  // ponytail: outdated threads (their line no longer exists in the head) are not shown, only counted for the
  // PR's tooltip; show them on the file's first line, or in the Phase 2 detail page, if that turns out to be missed.
  const threads = nodes
    .filter(t => !t.isOutdated && t.line !== null && t.comments.nodes.length > 0)
    .map(t => ({
      path: t.path,
      line: t.line as number,
      startLine: t.startLine,
      side: t.diffSide,
      resolved: t.isResolved,
      comments: t.comments.nodes.map(c => ({
        id: c.databaseId, body: c.body, author: c.author?.login ?? 'ghost', avatar: c.author?.avatarUrl ?? '', createdAt: c.createdAt,
      })),
    }));
  return { threads, outdated: nodes.filter(t => t.isOutdated).length };
}

export const threadCount = (threads: ReviewThread[], path: string): number => threads.filter(t => t.path === path).length;

/**
 * The local branch a PR is checked out as: its own head branch name for a same-repo PR, `pr/<n>` for a fork PR.
 * A head name that git could read as an option or that has odd characters also falls back to `pr/<n>`.
 */
export function pullBranch(pull: Pick<PullSummary, 'number' | 'headRef' | 'fork'>): string {
  const safe = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(pull.headRef);
  return !pull.fork && safe ? pull.headRef : `pr/${pull.number}`;
}

/** The PR of the checked-out branch first (the one you most likely want next), the rest in their given order. */
export function pinCurrent(pulls: PullSummary[], branch: string | null): PullSummary[] {
  const current = branch === null ? undefined : pulls.find(p => pullBranch(p) === branch);
  return current ? [current, ...pulls.filter(p => p !== current)] : pulls;
}

export interface RestComment { id: number; body: string; created_at: string; user: { login: string; avatar_url: string } }

export function commentFromRest(c: RestComment): ReviewComment {
  return { id: c.id, body: c.body, author: c.user.login, avatar: c.user.avatar_url, createdAt: c.created_at };
}

/** One line for the tree's status message: GitHub's own explanation, plus when a rate limit lifts. */
export function describeFailure(err: unknown, now: number = Date.now()): string {
  if (err instanceof ApiError && err.retryAt !== null) {
    const minutes = Math.max(1, Math.ceil((err.retryAt - now) / 60_000));
    return `${err.message}. Try again in ${minutes} min.`;
  }
  return err instanceof Error ? err.message : String(err);
}

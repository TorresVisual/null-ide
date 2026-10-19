'use strict';

import { requestGraphql } from '../github/githubApi';
import { GqlComment, ReviewComment, commentFromGql } from './pullModel';

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

/** The viewer's own picture of a PR for reviewing: ids to write against, and the unsent review if there is one. */
export interface ReviewState { pullId: string; headSha: string; viewerIsAuthor: boolean; reviewId: string | null; comments: number }

// GitHub shows an unsent (PENDING) review to its author only, so this is always the viewer's own, at most one.
const REVIEW_STATE = `
query ReviewState($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id headRefOid viewerDidAuthor
      reviews(first: 1, states: [PENDING]) { nodes { id comments { totalCount } } }
    }
  }
}`;

interface ReviewStateData {
  repository: { pullRequest: {
    id: string; headRefOid: string; viewerDidAuthor: boolean;
    reviews: { nodes: Array<{ id: string; comments: { totalCount: number } }> };
  } | null } | null;
}

export async function fetchReviewState(owner: string, repo: string, number: number, token: string | null): Promise<ReviewState> {
  const p = (await requestGraphql<ReviewStateData>(REVIEW_STATE, { owner, name: repo, number }, token)).repository?.pullRequest;
  if (!p) throw new Error('Pull request not found.');
  const unsent = p.reviews.nodes[0];
  return { pullId: p.id, headSha: p.headRefOid, viewerIsAuthor: p.viewerDidAuthor, reviewId: unsent?.id ?? null, comments: unsent?.comments.totalCount ?? 0 };
}

// No `event`: the review stays PENDING. With an `event` the same mutation creates and submits in one go.
const ADD_REVIEW = `
mutation AddReview($input: AddPullRequestReviewInput!) { addPullRequestReview(input: $input) { pullRequestReview { id } } }`;

/** The unsent review's id; one is started (anchored on the current head) when there is none. */
export async function ensureReview(owner: string, repo: string, number: number, token: string | null): Promise<string> {
  const state = await fetchReviewState(owner, repo, number, token);
  if (state.reviewId) return state.reviewId;
  const created = await requestGraphql<{ addPullRequestReview: { pullRequestReview: { id: string } } }>(
    ADD_REVIEW, { input: { pullRequestId: state.pullId, commitOID: state.headSha } }, token);
  return created.addPullRequestReview.pullRequestReview.id;
}

export interface ThreadInput { reviewId: string; body: string; path: string; line: number; startLine?: number; side: 'LEFT' | 'RIGHT' }

const ADD_THREAD = `
mutation AddThread($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) {
    thread { id comments(first: 1) { nodes { databaseId state body createdAt author { login avatarUrl } } } }
  }
}`;

/** `startLine` below `line` makes it a range on `side`; GitHub refuses a range that crosses hunks. */
export async function addReviewThread(input: ThreadInput, token: string | null): Promise<{ threadId: string; comment: ReviewComment }> {
  const range = input.startLine !== undefined && input.startLine < input.line ? { startLine: input.startLine, startSide: input.side } : {};
  const data = await requestGraphql<{ addPullRequestReviewThread: { thread: { id: string; comments: { nodes: GqlComment[] } } | null } }>(
    ADD_THREAD, { input: { pullRequestReviewId: input.reviewId, body: input.body, path: input.path, line: input.line, side: input.side, ...range } }, token);
  const thread = data.addPullRequestReviewThread.thread;
  if (!thread || thread.comments.nodes.length === 0) throw new Error('GitHub did not create the comment.');
  return { threadId: thread.id, comment: commentFromGql(thread.comments.nodes[0]) };
}

const REPLY = `
mutation Reply($input: AddPullRequestReviewThreadReplyInput!) {
  addPullRequestReviewThreadReply(input: $input) { comment { databaseId state body createdAt author { login avatarUrl } } }
}`;

export async function replyInReview(reviewId: string, threadId: string, body: string, token: string | null): Promise<ReviewComment> {
  const data = await requestGraphql<{ addPullRequestReviewThreadReply: { comment: GqlComment } }>(
    REPLY, { input: { pullRequestReviewId: reviewId, pullRequestReviewThreadId: threadId, body } }, token);
  return commentFromGql(data.addPullRequestReviewThreadReply.comment);
}

const SUBMIT = `
mutation Submit($input: SubmitPullRequestReviewInput!) { submitPullRequestReview(input: $input) { pullRequestReview { id } } }`;

export async function submitReview(reviewId: string, event: ReviewEvent, body: string, token: string | null): Promise<void> {
  await requestGraphql(SUBMIT, { input: { pullRequestReviewId: reviewId, event, body } }, token);
}

/** Nothing was pending: create the review and submit it in one call. */
export async function submitNewReview(state: ReviewState, event: ReviewEvent, body: string, token: string | null): Promise<void> {
  await requestGraphql(ADD_REVIEW, { input: { pullRequestId: state.pullId, commitOID: state.headSha, event, body } }, token);
}

const DISCARD = `
mutation Discard($input: DeletePullRequestReviewInput!) { deletePullRequestReview(input: $input) { pullRequestReview { id } } }`;

export async function discardReview(reviewId: string, token: string | null): Promise<void> {
  await requestGraphql(DISCARD, { input: { pullRequestReviewId: reviewId } }, token);
}

const RESOLVE = `
mutation Resolve($input: ResolveReviewThreadInput!) { resolveReviewThread(input: $input) { thread { id } } }`;
const UNRESOLVE = `
mutation Unresolve($input: UnresolveReviewThreadInput!) { unresolveReviewThread(input: $input) { thread { id } } }`;

export async function setThreadResolved(threadId: string, resolved: boolean, token: string | null): Promise<void> {
  await requestGraphql(resolved ? RESOLVE : UNRESOLVE, { input: { threadId } }, token);
}

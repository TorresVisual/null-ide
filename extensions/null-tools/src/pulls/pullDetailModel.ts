'use strict';

import { PageActions, pageActions } from './pullActionsModel';
import { CheckState, PullState, checkStateOf, pullStateOf } from './pullModel';

export interface PullUser { login: string; avatar: string }
export type ReviewVerdict = 'approved' | 'changes' | 'commented' | 'dismissed';
export interface ReviewerRow { login: string; avatar: string; state: ReviewVerdict | 'pending' }
export type CheckRowState = 'success' | 'failure' | 'pending' | 'neutral';
export interface CheckRow {
  name: string;
  state: CheckRowState;
  /** GitHub's own page for the check (logs live there); not validated here, see `safeExternalUrl`. */
  url: string | null;
  /** The Actions workflow run of this check, for "Re-run failed jobs"; null for other checks and legacy statuses. */
  runId: number | null;
  description: string;
}
export interface CommitRow { sha: string; short: string; headline: string; author: string; at: string; url: string }
export type PullTimelineItem =
  | { kind: 'comment'; author: PullUser; at: string; bodyHTML: string; url: string }
  | { kind: 'review'; author: PullUser; at: string; verdict: ReviewVerdict; bodyHTML: string; url: string; comments: number }
  | { kind: 'event'; at: string; actor: string; event: 'closed' | 'merged' | 'reopened' | 'ready' | 'draft' };

/**
 * Everything the detail tab shows. Mirrored by hand in src/webview/pullDetailTypes.ts; `bodyHTML` is GitHub's
 * rendering and is sanitized in the webview before it is shown.
 */
export interface PullPage {
  number: number;
  /** GraphQL node id and head commit: for the host's writes only, never rendered. */
  id: string;
  headSha: string;
  title: string;
  url: string;
  state: PullState;
  draft: boolean;
  author: PullUser;
  createdAt: string;
  bodyHTML: string;
  headRef: string;
  baseRef: string;
  fork: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: Array<{ name: string; color: string }>;
  milestone: string | null;
  assignees: PullUser[];
  reviewers: ReviewerRow[];
  commits: CommitRow[];
  commitTotal: number;
  timeline: PullTimelineItem[];
  timelineTotal: number;
  checkState: CheckState;
  checks: CheckRow[];
  checksTotal: number;
  actions: PageActions;
}

// ponytail: first 100 commits, 100 conversation items, 100 checks (the page says when it is cut off); add paging
// ("load more") if that turns out to be missed.
export const PULL_PAGE = `
query PullPage($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    viewerPermission mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
    pullRequest(number: $number) {
      id headRefOid mergeable mergeStateStatus viewerCanUpdate viewerDidAuthor
      pendingReview: reviews(first: 1, states: [PENDING]) { nodes { id comments { totalCount } } }
      number title url state isDraft createdAt bodyHTML headRefName baseRefName isCrossRepository additions deletions changedFiles
      author { login avatarUrl }
      labels(first: 50) { nodes { name color } }
      milestone { title }
      assignees(first: 20) { nodes { login avatarUrl } }
      reviewRequests(first: 20) { nodes { requestedReviewer {
        __typename
        ... on User { login avatarUrl }
        ... on Mannequin { login avatarUrl }
        ... on Team { name }
      } } }
      latestOpinionatedReviews(first: 30) { nodes { state author { login avatarUrl } } }
      commits(first: 100) { totalCount nodes { commit {
        oid abbreviatedOid messageHeadline committedDate url author { name user { login } }
      } } }
      timelineItems(first: 100, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW, CLOSED_EVENT, MERGED_EVENT, REOPENED_EVENT, READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT]) {
        totalCount
        nodes {
          __typename
          ... on IssueComment { url createdAt bodyHTML author { login avatarUrl } }
          ... on PullRequestReview { url state createdAt bodyHTML author { login avatarUrl } comments { totalCount } }
          ... on ClosedEvent { createdAt actor { login } }
          ... on MergedEvent { createdAt actor { login } }
          ... on ReopenedEvent { createdAt actor { login } }
          ... on ReadyForReviewEvent { createdAt actor { login } }
          ... on ConvertToDraftEvent { createdAt actor { login } }
        }
      }
      lastCommit: commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) {
        totalCount
        nodes {
          __typename
          ... on CheckRun { name status conclusion detailsUrl checkSuite { workflowRun { databaseId } } }
          ... on StatusContext { context state targetUrl description }
        }
      } } } } }
    }
  }
}`;

interface GqlUser { login: string; avatarUrl: string }
interface GqlTimelineNode {
  __typename: string; url?: string; createdAt?: string; bodyHTML?: string; state?: string;
  author?: GqlUser | null; actor?: { login: string } | null; comments?: { totalCount: number };
}
interface GqlCheckNode {
  __typename: string;
  name?: string; status?: string; conclusion?: string | null; detailsUrl?: string | null;
  checkSuite?: { workflowRun: { databaseId: number } | null } | null;
  context?: string; state?: string; targetUrl?: string | null; description?: string | null;
}
interface GqlPullPage {
  id: string; headRefOid: string; mergeable: string; mergeStateStatus: string; viewerCanUpdate: boolean; viewerDidAuthor: boolean;
  pendingReview: { nodes: Array<{ id: string; comments: { totalCount: number } }> };
  number: number; title: string; url: string; state: string; isDraft: boolean; createdAt: string; bodyHTML: string;
  headRefName: string; baseRefName: string; isCrossRepository: boolean; additions: number; deletions: number; changedFiles: number;
  author: GqlUser | null;
  labels: { nodes: Array<{ name: string; color: string }> };
  milestone: { title: string } | null;
  assignees: { nodes: GqlUser[] };
  reviewRequests: { nodes: Array<{ requestedReviewer: { __typename: string; login?: string; avatarUrl?: string; name?: string } | null } | null> };
  latestOpinionatedReviews: { nodes: Array<{ state: string; author: GqlUser | null } | null> };
  commits: { totalCount: number; nodes: Array<{ commit: {
    oid: string; abbreviatedOid: string; messageHeadline: string; committedDate: string; url: string;
    author: { name: string | null; user: { login: string } | null } | null;
  } }> };
  timelineItems: { totalCount: number; nodes: Array<GqlTimelineNode | null> };
  lastCommit: { nodes: Array<{ commit: { statusCheckRollup: { state: string; contexts: { totalCount: number; nodes: Array<GqlCheckNode | null> } } | null } }> };
}
export interface PullPageData {
  repository: {
    viewerPermission: string | null;
    mergeCommitAllowed: boolean; squashMergeAllowed: boolean; rebaseMergeAllowed: boolean;
    pullRequest: GqlPullPage | null;
  } | null;
}

const ghost = (u: GqlUser | null | undefined): PullUser => ({ login: u?.login ?? 'ghost', avatar: u?.avatarUrl ?? '' });
const user = (u: GqlUser): PullUser => ({ login: u.login, avatar: u.avatarUrl });

// Maps, not records: a type name from the wire must never hit an Object.prototype key.
const VERDICTS = new Map<string, ReviewVerdict>([
  ['APPROVED', 'approved'], ['CHANGES_REQUESTED', 'changes'], ['COMMENTED', 'commented'], ['DISMISSED', 'dismissed'],
]);
const EVENTS = new Map<string, 'closed' | 'merged' | 'reopened' | 'ready' | 'draft'>([
  ['ClosedEvent', 'closed'], ['MergedEvent', 'merged'], ['ReopenedEvent', 'reopened'],
  ['ReadyForReviewEvent', 'ready'], ['ConvertToDraftEvent', 'draft'],
]);

/** Comments, submitted reviews and state events, oldest first. An unsent (PENDING) review and unknown types are skipped. */
export function mapTimeline(nodes: Array<GqlTimelineNode | null>): PullTimelineItem[] {
  const items: PullTimelineItem[] = [];
  for (const n of nodes) {
    if (!n) continue;
    const at = n.createdAt ?? '';
    const event = EVENTS.get(n.__typename);
    if (n.__typename === 'IssueComment') {
      items.push({ kind: 'comment', author: ghost(n.author), at, bodyHTML: n.bodyHTML ?? '', url: n.url ?? '' });
    } else if (n.__typename === 'PullRequestReview') {
      const verdict = VERDICTS.get(n.state ?? '');
      if (verdict) {
        items.push({ kind: 'review', author: ghost(n.author), at, verdict, bodyHTML: n.bodyHTML ?? '', url: n.url ?? '', comments: n.comments?.totalCount ?? 0 });
      }
    } else if (event) {
      items.push({ kind: 'event', at, actor: n.actor?.login ?? 'ghost', event });
    }
  }
  return items;
}

/** Latest verdict per reviewer; someone asked (again) to review shows as pending, which wins over an older verdict. */
export function mapReviewers(p: Pick<GqlPullPage, 'latestOpinionatedReviews' | 'reviewRequests'>): ReviewerRow[] {
  const rows = new Map<string, ReviewerRow>();
  for (const r of p.latestOpinionatedReviews.nodes) {
    const verdict = r ? VERDICTS.get(r.state) : undefined;
    if (r?.author && verdict) rows.set(r.author.login, { login: r.author.login, avatar: r.author.avatarUrl, state: verdict });
  }
  for (const req of p.reviewRequests.nodes) {
    const who = req?.requestedReviewer;
    const login = who?.login ?? who?.name; // a team has a name, not a login
    if (login) rows.set(login, { login, avatar: who?.avatarUrl ?? '', state: 'pending' });
  }
  return [...rows.values()];
}

export function checkRowState(status: string, conclusion: string | null): CheckRowState {
  if (status !== 'COMPLETED') return 'pending';
  switch (conclusion) {
    case 'SUCCESS': return 'success';
    case 'FAILURE': case 'TIMED_OUT': case 'STARTUP_FAILURE': return 'failure';
    case 'ACTION_REQUIRED': return 'pending'; // needs someone, and a re-run would not help
    default: return 'neutral'; // NEUTRAL, SKIPPED, CANCELLED, STALE
  }
}

export function statusContextState(state: string): CheckRowState {
  if (state === 'SUCCESS') return 'success';
  if (state === 'FAILURE' || state === 'ERROR') return 'failure';
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending';
  return 'neutral';
}

const RANK: Record<CheckRowState, number> = { failure: 0, pending: 1, success: 2, neutral: 3 };

/** Check runs and legacy commit statuses as one list: what needs attention first, then by name. */
export function mapChecks(nodes: Array<GqlCheckNode | null>): CheckRow[] {
  const rows: CheckRow[] = [];
  for (const n of nodes) {
    if (!n) continue;
    if (n.__typename === 'CheckRun') {
      rows.push({
        name: n.name ?? 'check', state: checkRowState(n.status ?? '', n.conclusion ?? null), url: n.detailsUrl ?? null,
        runId: n.checkSuite?.workflowRun?.databaseId ?? null, description: '',
      });
    } else if (n.__typename === 'StatusContext') {
      rows.push({ name: n.context ?? 'status', state: statusContextState(n.state ?? ''), url: n.targetUrl ?? null, runId: null, description: n.description ?? '' });
    }
  }
  return rows.sort((a, b) => RANK[a.state] - RANK[b.state] || a.name.localeCompare(b.name));
}

/** The workflow runs worth re-running: the distinct runs of failed checks. */
export function failedRunIds(checks: CheckRow[]): number[] {
  const ids = new Set<number>();
  for (const c of checks) {
    if (c.state === 'failure' && c.runId !== null && Number.isSafeInteger(c.runId) && c.runId > 0) ids.add(c.runId);
  }
  return [...ids];
}

export function mapPullPage(data: PullPageData): PullPage {
  const repo = data.repository;
  const p = repo?.pullRequest;
  if (!repo || !p) throw new Error('Pull request not found.');
  const rollup = p.lastCommit.nodes[0]?.commit.statusCheckRollup ?? null;
  const unsent = p.pendingReview.nodes[0];
  return {
    number: p.number, id: p.id, headSha: p.headRefOid,
    title: p.title, url: p.url, state: pullStateOf(p.state), draft: p.isDraft,
    author: ghost(p.author), createdAt: p.createdAt, bodyHTML: p.bodyHTML,
    headRef: p.headRefName, baseRef: p.baseRefName, fork: p.isCrossRepository,
    additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles,
    labels: p.labels.nodes.map(l => ({ name: l.name, color: l.color })),
    milestone: p.milestone?.title ?? null,
    assignees: p.assignees.nodes.map(user),
    reviewers: mapReviewers(p),
    commits: p.commits.nodes.map(({ commit: c }) => ({
      sha: c.oid, short: c.abbreviatedOid, headline: c.messageHeadline,
      author: c.author?.user?.login ?? c.author?.name ?? 'unknown', at: c.committedDate, url: c.url,
    })),
    commitTotal: p.commits.totalCount,
    timeline: mapTimeline(p.timelineItems.nodes),
    timelineTotal: p.timelineItems.totalCount,
    checkState: checkStateOf(rollup?.state),
    checks: mapChecks(rollup?.contexts.nodes ?? []),
    checksTotal: rollup?.contexts.totalCount ?? 0,
    actions: pageActions({
      state: pullStateOf(p.state), draft: p.isDraft, mergeable: p.mergeable, mergeStateStatus: p.mergeStateStatus,
      viewerCanUpdate: p.viewerCanUpdate, viewerDidAuthor: p.viewerDidAuthor, viewerPermission: repo.viewerPermission ?? '',
      mergeCommitAllowed: repo.mergeCommitAllowed, squashMergeAllowed: repo.squashMergeAllowed, rebaseMergeAllowed: repo.rebaseMergeAllowed,
      pendingComments: unsent ? unsent.comments.totalCount : null,
    }),
  };
}

/** The only links the host opens for the webview: absolute https. Everything else (javascript:, relative, http:) is dropped. */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

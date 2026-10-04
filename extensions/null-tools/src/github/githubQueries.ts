'use strict';

import { GithubIssue, RepoMetadata, SearchPage } from './types';

const LIST_ISSUE_FIELDS = `
  number title body state stateReason url createdAt updatedAt closedAt
  author { login avatarUrl }
  labels(first: 20) { nodes { name color } }
  assignees(first: 5) { nodes { login avatarUrl } }
  comments { totalCount }
  milestone { number title }
  issueType { name }
  subIssuesSummary { total completed }
  closedByPullRequestsReferences(first: 1) { totalCount }
`;

/** One page of the issue list plus (on the first page only) the Open/Closed tab counts. */
export const SEARCH_ISSUES = `
query SearchIssues($q: String!, $qOpen: String!, $qClosed: String!, $first: Int!, $after: String, $withCounts: Boolean!) {
  search(query: $q, type: ISSUE, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on Issue { ${LIST_ISSUE_FIELDS} } }
  }
  open: search(query: $qOpen, type: ISSUE, first: 0) @include(if: $withCounts) { issueCount }
  closed: search(query: $qClosed, type: ISSUE, first: 0) @include(if: $withCounts) { issueCount }
}`;

/** Everything the filter dropdowns offer. `issueTypes` is null on repos (e.g. user-owned) without issue types. */
export const REPO_METADATA = `
query RepoMetadata($owner: String!, $name: String!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    labels(first: 100, orderBy: { field: NAME, direction: ASC }) { nodes { name color description } }
    assignableUsers(first: 100) { nodes { login avatarUrl } }
    milestones(first: 50, states: OPEN, orderBy: { field: DUE_DATE, direction: ASC }) { nodes { number title } }
    issueTypes(first: 25) { nodes { id name } }
  }
}`;

export interface GqlUser { login: string; avatarUrl: string }
export interface GqlIssue {
  number: number; title: string; body: string | null; state: 'OPEN' | 'CLOSED'; stateReason: string | null; url: string;
  createdAt: string; updatedAt: string; closedAt: string | null; author: GqlUser | null;
  labels: { nodes: Array<{ name: string; color: string }> };
  assignees: { nodes: GqlUser[] };
  comments: { totalCount: number };
  milestone: { number: number; title: string } | null;
  issueType: { name: string } | null;
  subIssuesSummary: { total: number; completed: number } | null;
  closedByPullRequestsReferences: { totalCount: number } | null;
}
export interface SearchData {
  search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<GqlIssue | Record<string, never>> };
  open?: { issueCount: number };
  closed?: { issueCount: number };
}
export interface MetadataData {
  viewer: { login: string };
  repository: {
    labels: { nodes: Array<{ name: string; color: string; description: string | null }> };
    assignableUsers: { nodes: GqlUser[] };
    milestones: { nodes: Array<{ number: number; title: string }> };
    issueTypes: { nodes: Array<{ id: string; name: string }> } | null;
  };
}

export const toUser = (u: GqlUser): { login: string; avatar_url: string } => ({ login: u.login, avatar_url: u.avatarUrl });

/** A deleted account has no author; GitHub shows "ghost", so do we. */
export const GHOST = { login: 'ghost', avatar_url: '' };

export function mapIssue(n: GqlIssue): GithubIssue {
  const sub = n.subIssuesSummary;
  return {
    number: n.number,
    title: n.title,
    body: n.body ?? '',
    state: n.state === 'OPEN' ? 'open' : 'closed',
    state_reason: n.stateReason ? (n.stateReason.toLowerCase() as GithubIssue['state_reason']) : null,
    html_url: n.url,
    labels: n.labels.nodes.map(l => ({ name: l.name, color: l.color })),
    assignees: n.assignees.nodes.map(toUser),
    user: n.author ? toUser(n.author) : GHOST,
    comments: n.comments.totalCount,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
    closed_at: n.closedAt,
    milestone: n.milestone,
    issue_type: n.issueType?.name ?? null,
    sub_issues: sub && sub.total > 0 ? { total: sub.total, completed: sub.completed } : null,
    linked_prs: n.closedByPullRequestsReferences?.totalCount ?? 0,
  };
}

export function mapSearchPage(data: SearchData): SearchPage {
  return {
    items: data.search.nodes.filter((n): n is GqlIssue => typeof (n as GqlIssue).number === 'number').map(mapIssue),
    hasMore: data.search.pageInfo.hasNextPage,
    cursor: data.search.pageInfo.endCursor,
    openCount: data.open?.issueCount ?? null,
    closedCount: data.closed?.issueCount ?? null,
  };
}

export function mapMetadata(data: MetadataData): RepoMetadata {
  const repo = data.repository;
  return {
    labels: repo.labels.nodes,
    assignees: repo.assignableUsers.nodes.map(toUser),
    milestones: repo.milestones.nodes,
    issueTypes: repo.issueTypes?.nodes ?? [],
    viewerLogin: data.viewer.login,
  };
}

'use strict';

export type IssueState = 'open' | 'closed' | 'all';

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export interface GithubLabel {
  name: string;
  color: string;
  /** Only present on labels from the repo metadata query. */
  description?: string | null;
}

export interface GithubUser {
  login: string;
  avatar_url: string;
}

export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  /** Why a closed issue was closed; null while open or for issues closed before GitHub tracked reasons. */
  state_reason?: 'completed' | 'not_planned' | 'reopened' | 'duplicate' | null;
  html_url: string;
  labels: GithubLabel[];
  assignees: GithubUser[];
  user: GithubUser;
  comments: number;
  /** The fields below come from the GraphQL list query; REST-fetched issues lack them. */
  created_at?: string;
  updated_at: string;
  closed_at?: string | null;
  milestone?: { number: number; title: string } | null;
  issue_type?: string | null;
  sub_issues?: { total: number; completed: number } | null;
  linked_prs?: number;
  pull_request?: unknown;
  /** True when an unpushed local commit will close this issue on push. Computed client-side, never sent to GitHub. */
  closedLocally?: boolean;
}

export interface GithubComment {
  id: number;
  user: GithubUser;
  body: string;
  created_at: string;
}

/** A GitHub issue timeline event (labeled, closed-via-commit, cross-referenced, etc). Fields vary by `event`. */
export interface GithubTimelineEvent {
  event: string;
  actor: GithubUser | null;
  created_at: string;
  commit_id?: string | null;
  label?: { name: string; color: string };
  assignee?: GithubUser;
  rename?: { from: string; to: string };
  source?: { issue?: { number: number; title: string; html_url: string; repository?: { full_name: string } } };
}

export interface IssueFilterOptions {
  labels: string[];
  assignee: 'me' | 'everyone';
  query: string;
  viewerLogin: string | null;
}

export interface IssueTemplate {
  name: string;
  title: string;
  body: string;
  labels: string[];
}

export interface RepoMetadata {
  labels: GithubLabel[];
  assignees: GithubUser[];
  milestones: Array<{ number: number; title: string }>;
  issueTypes: Array<{ id: string; name: string }>;
  viewerLogin: string;
}

export interface SearchPage {
  items: GithubIssue[];
  hasMore: boolean;
  cursor: string | null;
  /** Null when the request skipped the count aliases (every page after the first). */
  openCount: number | null;
  closedCount: number | null;
}

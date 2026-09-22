'use strict';

export type IssueState = 'open' | 'closed' | 'all';

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export interface GithubLabel {
  name: string;
  color: string;
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
  html_url: string;
  labels: GithubLabel[];
  assignees: GithubUser[];
  user: GithubUser;
  comments: number;
  updated_at: string;
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

export interface IssueFilterOptions {
  labels: string[];
  assignee: 'me' | 'everyone';
  query: string;
  viewerLogin: string | null;
}

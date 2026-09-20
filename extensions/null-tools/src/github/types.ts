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

'use strict';

import { GithubIssue } from './types';

export function stripPullRequests(issues: GithubIssue[]): GithubIssue[] {
  return issues.filter(issue => !issue.pull_request);
}

export function relevantToViewer(issues: GithubIssue[], viewerLogin: string | null): GithubIssue[] {
  if (!viewerLogin) return [];
  return issues.filter(issue =>
    issue.user.login === viewerLogin || issue.assignees.some(a => a.login === viewerLogin));
}

export function newestUpdateTime(issues: GithubIssue[]): number {
  return issues.reduce((max, issue) => Math.max(max, new Date(issue.updated_at).getTime()), 0);
}

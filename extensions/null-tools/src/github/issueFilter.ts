'use strict';

import { GithubIssue, IssueFilterOptions } from './types';

export function stripPullRequests(issues: GithubIssue[]): GithubIssue[] {
  return issues.filter(issue => !issue.pull_request);
}

export function filterIssues(issues: GithubIssue[], opts: IssueFilterOptions): GithubIssue[] {
  const query = opts.query.trim().toLowerCase();
  return issues.filter(issue => {
    if (opts.labels.length > 0) {
      const issueLabels = new Set(issue.labels.map(l => l.name));
      if (!opts.labels.every(label => issueLabels.has(label))) return false;
    }
    if (opts.assignee === 'me') {
      if (!opts.viewerLogin) return false;
      if (!issue.assignees.some(a => a.login === opts.viewerLogin)) return false;
    }
    if (query) {
      const haystack = `${issue.title}\n${issue.body || ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

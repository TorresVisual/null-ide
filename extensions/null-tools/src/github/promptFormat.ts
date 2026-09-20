'use strict';

import { GithubIssue } from './types';

export function formatIssueAsPrompt(issue: GithubIssue): string {
  const header = `#${issue.number} ${issue.title}`;
  const body = issue.body?.trim();
  const parts = body ? [header, body, issue.html_url] : [header, issue.html_url];
  return parts.join('\n\n');
}

'use strict';

import { GithubIssue } from './types';

export interface PromptComment { author: string; createdAt: string; body: string }

/**
 * The issue as plain text for pasting into an AI chat: title, body, comments, then the local files of its images
 * (so the assistant can open them), then the link. Empty sections are left out.
 */
export function formatIssueAsPrompt(issue: GithubIssue, comments: PromptComment[] = [], imagePaths: string[] = []): string {
  const parts = [`#${issue.number} ${issue.title}`];
  const body = issue.body?.trim();
  if (body) parts.push(body);
  const spoken = comments.filter(c => c.body.trim());
  if (spoken.length > 0) {
    parts.push(`--- Comments ---\n${spoken.map(c => `@${c.author} (${c.createdAt.slice(0, 10)}): ${c.body.trim()}`).join('\n\n')}`);
  }
  if (imagePaths.length > 0) {
    parts.push(`Images (local files; open with the Read tool):\n${imagePaths.map(p => `- ${p}`).join('\n')}`);
  }
  parts.push(issue.html_url);
  return parts.join('\n\n');
}

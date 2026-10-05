'use strict';

import { GithubRepoRef } from './types';

/** `workspaceState` key for the unsent text of one issue's comment box (`target` = the issue number) or of the New issue form (`'new'`). */
export function draftKey(repo: GithubRepoRef, target: number | 'new'): string {
  return `null.issues.draft:${repo.owner}/${repo.repo}#${target}`;
}

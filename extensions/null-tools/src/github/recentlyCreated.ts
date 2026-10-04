'use strict';

import { describeQuery, hasFreeText } from './searchQuery';
import { GithubIssue } from './types';

/** How long after creation GitHub's search index may still lack an issue. */
const INDEX_LAG_MS = 60_000;

export interface RecentIssue { issue: GithubIssue; at: number }

/**
 * Search results for a plain list (a state tab and sort, no filters or text) plus issues created in the last
 * minute that the search hasn't indexed yet, newest first. `added` is what was merged in.
 */
export function mergeRecentlyCreated(
  items: GithubIssue[], recent: RecentIssue[], query: string, now: number,
): { items: GithubIssue[]; added: GithubIssue[] } {
  const view = describeQuery(query, null);
  const filtered = Object.values(view.selected).some(values => values.length > 0) || hasFreeText(query);
  if (filtered) return { items, added: [] };
  const listed = new Set(items.map(i => i.number));
  const added = recent
    .filter(r => now - r.at <= INDEX_LAG_MS && !listed.has(r.issue.number))
    .filter(r => view.state === 'all' || view.state === r.issue.state)
    .map(r => r.issue);
  return { items: [...added, ...items], added };
}

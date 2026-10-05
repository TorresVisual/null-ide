'use strict';

import { GithubIssue } from './types';

export interface IssueSuggestion { number: number; title: string; state: 'open' | 'closed'; }
type Suggestible = Pick<GithubIssue, 'number' | 'title' | 'state'>;

export const toSuggestion = (i: Suggestible): IssueSuggestion => ({ number: i.number, title: i.title, state: i.state });

/**
 * Issues for the composer's `#` popup. A typed number matches issue numbers by prefix (`#12` finds 12, 120, 123) and
 * titles containing it; other text matches titles; nothing typed lists the newest. Each number once, newest first.
 */
export function matchIssues(issues: Suggestible[], prefix: string, limit = 8): IssueSuggestion[] {
  const byNumber = new Map<number, Suggestible>();
  for (const i of issues) byNumber.set(i.number, i);
  const p = prefix.toLowerCase();
  const numeric = /^\d+$/.test(p);
  return [...byNumber.values()]
    .filter(i => !p || (numeric && String(i.number).startsWith(p)) || i.title.toLowerCase().includes(p))
    .sort((a, b) => b.number - a.number)
    .slice(0, limit)
    .map(toSuggestion);
}

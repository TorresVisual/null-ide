'use strict';

const QUALIFIER_TOKEN = /(?:^|\s)-?[A-Za-z]+:(?:"[^"]*"?|\S*)/g;

/** The free-text part of a search string: qualifiers (`is:open`, `label:"x y"`, `-author:bob`) removed, lowercased. */
function freeTextOf(query: string): string {
  return query.replace(QUALIFIER_TOKEN, ' ').replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Instant, host-free filter over the rows already on screen: every free-text word must appear in "#number title". */
function matchesLocalFilter(issue: { number: number; title: string }, query: string): boolean {
  const words = freeTextOf(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `#${issue.number} ${issue.title}`.toLowerCase();
  return words.every(word => haystack.includes(word));
}

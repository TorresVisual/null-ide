'use strict';

/** Qualifier-aware editing of the user-visible issue search string (the single source of truth for the list). */

interface Token { raw: string; key: string | null; value: string; negated: boolean; }

const QUALIFIER = /^(-?)([A-Za-z]+):(.*)$/;

/** Splits on whitespace, keeping "quoted phrases" and key:"quoted value" in one piece. */
function tokenize(q: string): Token[] {
  return (q.match(/(?:[^\s"]|"[^"]*"?)+/g) ?? []).map(raw => {
    const m = QUALIFIER.exec(raw);
    if (!m) return { raw, key: null, value: '', negated: false };
    const value = m[3].length >= 2 && m[3].startsWith('"') && m[3].endsWith('"') ? m[3].slice(1, -1) : m[3];
    return { raw, key: m[2].toLowerCase(), value, negated: m[1] === '-' };
  });
}

const join = (tokens: Token[]): string => tokens.map(t => t.raw).join(' ');
const isKey = (t: Token, key: string): boolean => t.key === key.toLowerCase() && !t.negated;
const quoteIfNeeded = (v: string): string => (/\s/.test(v) ? `"${v}"` : v);

/** Values of every non-negated `key:` token, unquoted. `label:"good first issue" label:bug` → both. */
export function getQualifierValues(q: string, key: string): string[] {
  return tokenize(q).filter(t => isKey(t, key)).map(t => t.value);
}

/** Adds `key:value`, or removes it if already present (case-insensitive). */
export function toggleQualifier(q: string, key: string, value: string): string {
  const tokens = tokenize(q);
  const same = (t: Token): boolean => isKey(t, key) && t.value.toLowerCase() === value.toLowerCase();
  if (tokens.some(same)) return join(tokens.filter(t => !same(t)));
  return join([...tokens, ...tokenize(`${key}:${quoteIfNeeded(value)}`)]);
}

/** Replaces every non-negated `key:` token with a single `key:value`. */
export function setQualifier(q: string, key: string, value: string): string {
  return join([...tokenize(q).filter(t => !isKey(t, key)), ...tokenize(`${key}:${quoteIfNeeded(value)}`)]);
}

export function removeQualifier(q: string, key: string): string {
  return join(tokenize(q).filter(t => !isKey(t, key)));
}

/** Open/Closed tab: swaps `is:open` / `is:closed`, putting the new one first. Other `is:` tokens are kept. */
export function withState(q: string, state: 'open' | 'closed'): string {
  const rest = tokenize(q).filter(t => !(isKey(t, 'is') && (t.value === 'open' || t.value === 'closed')));
  return join([...tokenize(`is:${state}`), ...rest]);
}

export interface QueryView {
  state: 'open' | 'closed' | 'all';
  selected: { label: string[]; author: string[]; assignee: string[]; milestone: string[]; type: string[] };
  sort: string | null;
}

/** What the filter bar should highlight for a query. `@me` is shown as the viewer's login. */
export function describeQuery(q: string, viewerLogin: string | null): QueryView {
  const is = getQualifierValues(q, 'is');
  const open = is.includes('open'), closed = is.includes('closed');
  const me = (v: string): string => (v === '@me' && viewerLogin ? viewerLogin : v);
  const values = (key: string): string[] => getQualifierValues(q, key).map(me);
  return {
    state: open && !closed ? 'open' : closed && !open ? 'closed' : 'all',
    selected: {
      label: values('label'), author: values('author'), assignee: values('assignee'),
      milestone: values('milestone'), type: values('type'),
    },
    sort: getQualifierValues(q, 'sort')[0] ?? null,
  };
}

/**
 * The string sent to GitHub search: the user's query scoped to this repo's issues. `repo:`/`org:`/`user:`/`owner:`
 * typed by the user are dropped (GitHub ORs repeated `repo:`, which would leak other repos into the list),
 * and with no free text and no `sort:` we sort newest-first like github.com instead of "best match".
 */
export function toApiQuery(repo: string, q: string): string {
  const tokens = tokenize(q).filter(t => !(t.key && ['repo', 'org', 'user', 'owner'].includes(t.key)));
  const parts = [`repo:${repo}`, 'is:issue', join(tokens)];
  if (!tokens.some(t => t.key === 'sort') && !tokens.some(t => t.key === null)) parts.push('sort:created-desc');
  return parts.filter(Boolean).join(' ');
}

/** True when the query has free text besides qualifiers (`is:open crash`), which a just-created issue may not match. */
export function hasFreeText(q: string): boolean {
  return tokenize(q).some(t => t.key === null);
}

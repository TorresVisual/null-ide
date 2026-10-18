'use strict';

export type PullStateFilter = 'open' | 'merged' | 'closed' | 'all';
export type DraftFilter = 'any' | 'only' | 'hide';
export type PullSort = 'updated' | 'created' | 'comments';

export interface PullFilter {
  state: PullStateFilter;
  /** Authored by the signed-in user (`author:@me`). */
  mine: boolean;
  /** The signed-in user is asked to review (`review-requested:@me`). */
  reviewRequested: boolean;
  draft: DraftFilter;
  label: string | null;
  milestone: string | null;
  sort: PullSort;
}

export const DEFAULT_FILTER: PullFilter = {
  state: 'open', mine: false, reviewRequested: false, draft: 'any', label: null, milestone: null, sort: 'updated',
};

export const STATE_OPTIONS: Array<{ value: PullStateFilter; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'merged', label: 'Merged' },
  { value: 'closed', label: 'Closed (not merged)' },
  { value: 'all', label: 'All' },
];
export const DRAFT_OPTIONS: Array<{ value: DraftFilter; label: string }> = [
  { value: 'any', label: 'Any' },
  { value: 'only', label: 'Drafts only' },
  { value: 'hide', label: 'No drafts' },
];
export const SORT_OPTIONS: Array<{ value: PullSort; label: string }> = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Newest' },
  { value: 'comments', label: 'Most commented' },
];

const STATE_QUALIFIER: Record<PullStateFilter, string> = {
  open: 'is:open', merged: 'is:merged', closed: 'is:closed is:unmerged', all: '',
};
const DRAFT_QUALIFIER: Record<DraftFilter, string> = { any: '', only: 'draft:true', hide: 'draft:false' };
const SORT_QUALIFIER: Record<PullSort, string> = {
  updated: 'sort:updated-desc', created: 'sort:created-desc', comments: 'sort:comments-desc',
};

/** A label or milestone name that can sit inside `key:"…"` without ending the quotes or starting another qualifier. */
export const isSafeSearchValue = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 100 && !/["\\\u0000-\u001f]/.test(v);

/** The GitHub search string for one repo's PRs. Unsafe label/milestone names are dropped rather than escaped. */
export function pullsQuery(owner: string, repo: string, f: PullFilter): string {
  return [
    `repo:${owner}/${repo}`,
    'is:pr',
    STATE_QUALIFIER[f.state],
    f.mine ? 'author:@me' : '',
    f.reviewRequested ? 'review-requested:@me' : '',
    DRAFT_QUALIFIER[f.draft],
    isSafeSearchValue(f.label) ? `label:"${f.label}"` : '',
    isSafeSearchValue(f.milestone) ? `milestone:"${f.milestone}"` : '',
    SORT_QUALIFIER[f.sort],
  ].filter(Boolean).join(' ');
}

const pick = <T extends string>(allowed: ReadonlyArray<{ value: T }>, v: unknown, fallback: T): T =>
  allowed.some(o => o.value === v) ? (v as T) : fallback;

/** Reads whatever `workspaceState` returned; never throws, keeps every field that is still valid. */
export function parseFilter(raw: unknown): PullFilter {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    state: pick<PullStateFilter>(STATE_OPTIONS, o.state, DEFAULT_FILTER.state),
    mine: o.mine === true,
    reviewRequested: o.reviewRequested === true,
    draft: pick<DraftFilter>(DRAFT_OPTIONS, o.draft, DEFAULT_FILTER.draft),
    label: isSafeSearchValue(o.label) ? o.label : null,
    milestone: isSafeSearchValue(o.milestone) ? o.milestone : null,
    sort: pick<PullSort>(SORT_OPTIONS, o.sort, DEFAULT_FILTER.sort),
  };
}

export const isDefaultFilter = (f: PullFilter): boolean =>
  (Object.keys(DEFAULT_FILTER) as Array<keyof PullFilter>).every(k => f[k] === DEFAULT_FILTER[k]);

const labelOf = <T extends string>(options: Array<{ value: T; label: string }>, v: T): string =>
  options.find(o => o.value === v)?.label ?? v;

/** One line for the view's message: what differs from the default; `''` when nothing does. */
export function describeFilter(f: PullFilter): string {
  return [
    f.state !== 'open' ? labelOf(STATE_OPTIONS, f.state) : '',
    f.mine ? 'Created by me' : '',
    f.reviewRequested ? 'Review requested' : '',
    f.draft !== 'any' ? labelOf(DRAFT_OPTIONS, f.draft) : '',
    f.label ? `Label: ${f.label}` : '',
    f.milestone ? `Milestone: ${f.milestone}` : '',
    f.sort !== 'updated' ? labelOf(SORT_OPTIONS, f.sort) : '',
  ].filter(Boolean).join(' · ');
}

export type FacetId = 'state' | 'mine' | 'reviewRequested' | 'draft' | 'label' | 'milestone' | 'sort';

/** The rows of the filter menu with each facet's current value. */
export function facetRows(f: PullFilter): Array<{ id: FacetId; label: string; description: string }> {
  return [
    { id: 'state', label: 'State', description: labelOf(STATE_OPTIONS, f.state) },
    { id: 'mine', label: 'Created by me', description: f.mine ? 'On' : 'Off' },
    { id: 'reviewRequested', label: 'Review requested from me', description: f.reviewRequested ? 'On' : 'Off' },
    { id: 'draft', label: 'Drafts', description: labelOf(DRAFT_OPTIONS, f.draft) },
    { id: 'label', label: 'Label', description: f.label ?? 'Any' },
    { id: 'milestone', label: 'Milestone', description: f.milestone ?? 'Any' },
    { id: 'sort', label: 'Sort by', description: labelOf(SORT_OPTIONS, f.sort) },
  ];
}

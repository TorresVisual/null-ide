'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDefaultFilter = exports.isSafeSearchValue = exports.SORT_OPTIONS = exports.DRAFT_OPTIONS = exports.STATE_OPTIONS = exports.DEFAULT_FILTER = void 0;
exports.pullsQuery = pullsQuery;
exports.parseFilter = parseFilter;
exports.describeFilter = describeFilter;
exports.facetRows = facetRows;
exports.DEFAULT_FILTER = {
    state: 'open', mine: false, reviewRequested: false, draft: 'any', label: null, milestone: null, sort: 'updated',
};
exports.STATE_OPTIONS = [
    { value: 'open', label: 'Open' },
    { value: 'merged', label: 'Merged' },
    { value: 'closed', label: 'Closed (not merged)' },
    { value: 'all', label: 'All' },
];
exports.DRAFT_OPTIONS = [
    { value: 'any', label: 'Any' },
    { value: 'only', label: 'Drafts only' },
    { value: 'hide', label: 'No drafts' },
];
exports.SORT_OPTIONS = [
    { value: 'updated', label: 'Recently updated' },
    { value: 'created', label: 'Newest' },
    { value: 'comments', label: 'Most commented' },
];
const STATE_QUALIFIER = {
    open: 'is:open', merged: 'is:merged', closed: 'is:closed is:unmerged', all: '',
};
const DRAFT_QUALIFIER = { any: '', only: 'draft:true', hide: 'draft:false' };
const SORT_QUALIFIER = {
    updated: 'sort:updated-desc', created: 'sort:created-desc', comments: 'sort:comments-desc',
};
/** A label or milestone name that can sit inside `key:"…"` without ending the quotes or starting another qualifier. */
const isSafeSearchValue = (v) => typeof v === 'string' && v.length > 0 && v.length <= 100 && !/["\\\u0000-\u001f]/.test(v);
exports.isSafeSearchValue = isSafeSearchValue;
/** The GitHub search string for one repo's PRs. Unsafe label/milestone names are dropped rather than escaped. */
function pullsQuery(owner, repo, f) {
    return [
        `repo:${owner}/${repo}`,
        'is:pr',
        STATE_QUALIFIER[f.state],
        f.mine ? 'author:@me' : '',
        f.reviewRequested ? 'review-requested:@me' : '',
        DRAFT_QUALIFIER[f.draft],
        (0, exports.isSafeSearchValue)(f.label) ? `label:"${f.label}"` : '',
        (0, exports.isSafeSearchValue)(f.milestone) ? `milestone:"${f.milestone}"` : '',
        SORT_QUALIFIER[f.sort],
    ].filter(Boolean).join(' ');
}
const pick = (allowed, v, fallback) => allowed.some(o => o.value === v) ? v : fallback;
/** Reads whatever `workspaceState` returned; never throws, keeps every field that is still valid. */
function parseFilter(raw) {
    const o = (typeof raw === 'object' && raw !== null ? raw : {});
    return {
        state: pick(exports.STATE_OPTIONS, o.state, exports.DEFAULT_FILTER.state),
        mine: o.mine === true,
        reviewRequested: o.reviewRequested === true,
        draft: pick(exports.DRAFT_OPTIONS, o.draft, exports.DEFAULT_FILTER.draft),
        label: (0, exports.isSafeSearchValue)(o.label) ? o.label : null,
        milestone: (0, exports.isSafeSearchValue)(o.milestone) ? o.milestone : null,
        sort: pick(exports.SORT_OPTIONS, o.sort, exports.DEFAULT_FILTER.sort),
    };
}
const isDefaultFilter = (f) => Object.keys(exports.DEFAULT_FILTER).every(k => f[k] === exports.DEFAULT_FILTER[k]);
exports.isDefaultFilter = isDefaultFilter;
const labelOf = (options, v) => options.find(o => o.value === v)?.label ?? v;
/** One line for the view's message: what differs from the default; `''` when nothing does. */
function describeFilter(f) {
    return [
        f.state !== 'open' ? labelOf(exports.STATE_OPTIONS, f.state) : '',
        f.mine ? 'Created by me' : '',
        f.reviewRequested ? 'Review requested' : '',
        f.draft !== 'any' ? labelOf(exports.DRAFT_OPTIONS, f.draft) : '',
        f.label ? `Label: ${f.label}` : '',
        f.milestone ? `Milestone: ${f.milestone}` : '',
        f.sort !== 'updated' ? labelOf(exports.SORT_OPTIONS, f.sort) : '',
    ].filter(Boolean).join(' · ');
}
/** The rows of the filter menu with each facet's current value. */
function facetRows(f) {
    return [
        { id: 'state', label: 'State', description: labelOf(exports.STATE_OPTIONS, f.state) },
        { id: 'mine', label: 'Created by me', description: f.mine ? 'On' : 'Off' },
        { id: 'reviewRequested', label: 'Review requested from me', description: f.reviewRequested ? 'On' : 'Off' },
        { id: 'draft', label: 'Drafts', description: labelOf(exports.DRAFT_OPTIONS, f.draft) },
        { id: 'label', label: 'Label', description: f.label ?? 'Any' },
        { id: 'milestone', label: 'Milestone', description: f.milestone ?? 'Any' },
        { id: 'sort', label: 'Sort by', description: labelOf(exports.SORT_OPTIONS, f.sort) },
    ];
}
//# sourceMappingURL=pullFilter.js.map
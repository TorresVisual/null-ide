# Pull Requests Phase 2 — Detail & Checks Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** In `null-tools`, give the Pull Requests tree a filter (state, mine, review requested, draft, label, milestone, sort) and a PR detail tab showing the description, PR-level conversation, commits, reviewers, labels, milestone and the list of checks with links and a "Re-run failed jobs" button (phase 2 of umbrella #117).

**Architecture:** Two independent halves in `src/pulls/`. *Filters*: a pure `pullFilter.ts` turns a filter object into the GitHub search `q` (the tree already sends `q`), a thin QuickPick (`pullFilterMenu.ts`) edits it, and the tree persists it in `workspaceState`. *Detail*: `pullDetailModel.ts` (one GraphQL query + pure mappers) and `pullDetailApi.ts` feed `PullDetailPanel` (`vscode` glue), whose webview is a new `lib/pullDetail.js` bundle built from `src/webview/pullDetail*.ts`; its HTML builders are pure and tested through the existing `webview-shared` sandbox. The tab is read-only except one write: re-running failed workflow runs.

**Tech Stack:** TypeScript (commonjs host, `module: none` webview bundles), `node:test` with a mocked `https.request`, VS Code TreeView / QuickPick / WebviewPanel, GitHub GraphQL + REST, DOMPurify (already shipped as `lib/purify.min.js`).

**Spec:** `docs/specs/pull-requests-design.md` (Phase 2 row, decisions 1–16). Decisions 17–23 below were made while writing this plan and are appended to the spec in Task 8; **confirm them before executing**.

## Decisions made for this plan (not yet in the spec)

17. **The detail tab is read-only, with one write.** No PR-level comment composer, no labels/reviewer editing (Phase 4 per the #117 mapping), no review submit/merge (Phase 3). The only write is *Re-run failed jobs*. The page says so and offers *Open on GitHub*.
18. **No inline review threads on the detail page.** They stay in the diff editor (Phase 1). A review in the conversation shows its verdict, body and "n inline comments" with a link to GitHub. Outdated threads stay uncounted-in-page (still in the tree tooltip).
19. **One tab per PR**, opened from the tree row (inline icon + context menu). It reloads on focus after 60 s and has a refresh button. Check-out from the tab runs the tree's own `null.pulls.checkout`.
20. **Checks come from `statusCheckRollup.contexts`** (first 100): `CheckRun`s and legacy `StatusContext`s, failures first, each with a link to GitHub's own log page (`detailsUrl` / `targetUrl`). No log fetching.
21. **Re-run failed jobs** posts `actions/runs/{id}/rerun-failed-jobs` once per distinct workflow run among failed rows. The host recomputes the run ids from the page it loaded; the webview sends no ids. GitHub refusals (run still running, token without Actions write) are shown verbatim in a toast.
22. **Filter = search qualifiers, kept per workspace.** States: Open (`is:open`), Merged (`is:merged`), Closed (`is:closed is:unmerged`), All. Persisted in `workspaceState` as `null.pulls.filter`; a stored value that does not parse falls back field by field. Label/milestone names containing `"`, `\` or a control character are never put in a query (and not offered).
23. **Merged/closed rows** get a merge / closed icon (purple / red) instead of the CI colour, and a filter that matches nothing shows its own welcome text with *Change Filters* / *Reset Filters*.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Everything lives in `extensions/null-tools`; run all commands from that directory (`cd extensions/null-tools`).
- `out/` and `lib/*.js` are tracked build output; never hand-edit them. `lib/*.css` are hand-written sources. This phase adds a new compiled bundle `lib/pullDetail.js` (Task 6). After the work, `npm run compile` and commit the refreshed output as `chore: refresh null-tools compiled output`.
- Every new `*.test.ts` must be added to **both** `tsconfig.json`'s `include` and the explicit `node --test` list in `package.json`'s `test` script, or it is silently skipped.
- GitHub only. Signed-out use stays silent (`getGithubSession(false)`); only *Re-run failed jobs* may prompt (`getGithubSession(true)`).
- Webview bundles are `module: none`: every top-level name in `src/webview/pullDetail*.ts` is global in the shared bundle, so they all start with `pull`/`Pull`. The webview CSP is unchanged (scripts from `lib/`, avatars only); no network from the webview.
- The webview is untrusted input: every URL it sends back is validated by `safeExternalUrl` (https only) and it never supplies ids, shas or run numbers.
- Nothing is fetched or polled until the PR view is first shown; the filter commands do nothing before that.
- Commit style: `feat(null-tools): …` / `test(null-tools): …` / `docs: …`. Do not push.

## Review Focus

Failure modes the spec implies but a happy-path test would miss, most likely first. Each has a pinned test in the task named in brackets:

1. **A label or milestone name that breaks out of its search qualifier** (`x" is:closed`, backslash, newline, empty) — must never reach the query, from the picker or from a stored filter. [Task 1 `a label that would end the quotes…`, `parseFilter`; Task 2 `fetchLabelNames`, `fetchMilestoneTitles`]
2. **A stored filter in an old or hand-edited shape** (`workspaceState` returns anything) — falls back field by field, never throws. [Task 1 `parseFilter`]
3. **PRs with no checks, only neutral checks, only legacy statuses, more than 100 checks** — no empty box, no re-run button unless a *failed* row belongs to a workflow run, a "showing n of N" note. And the webview cannot choose which runs are re-run. [Task 3 `mapChecks`, `failedRunIds`; Task 4 `rerunFailedRuns`; Task 5 `checks section`; the host-side run ids and the button itself are checked by hand in Task 8 step 1, item 7]
4. **Hostile text and links** — HTML in a PR title, branch, check name or author; `javascript:`/`http:`/relative links from bodies or `detailsUrl`. [Task 5 `escapes…`, `href…`; Task 3 `safeExternalUrl`]
5. **Awkward timelines** — unsent (PENDING) reviews, deleted authors (`ghost`), team reviewers, a review with no body, an unknown timeline type, more than 100 events or commits. [Task 3 `mapTimeline`, `mapReviewers`; Task 5 `timeline…`, `truncation`]

---

### Task 1: Filter model, PR state, and the list query

**Files:**
- Create: `extensions/null-tools/src/pulls/pullFilter.ts`
- Create: `extensions/null-tools/src/pulls/pullFilter.test.ts`
- Modify: `extensions/null-tools/src/pulls/pullModel.ts` (add `PullState`, `PullSummary.state`, `pullStateOf`, `checkStateOf`; drop `openPullsQuery`)
- Modify: `extensions/null-tools/src/pulls/pullModel.test.ts`
- Modify: `extensions/null-tools/src/pulls/pullApi.ts` (`listOpenPulls` → `listPulls`)
- Modify: `extensions/null-tools/src/pulls/pullApi.test.ts`
- Modify: `extensions/null-tools/src/pulls/pullsTreeView.ts` (one call site, keeps the build green)
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Produces (`pullFilter.ts`):
  - `type PullStateFilter = 'open' | 'merged' | 'closed' | 'all'`, `type DraftFilter = 'any' | 'only' | 'hide'`, `type PullSort = 'updated' | 'created' | 'comments'`
  - `interface PullFilter { state; mine: boolean; reviewRequested: boolean; draft; label: string | null; milestone: string | null; sort }`
  - `const DEFAULT_FILTER: PullFilter`
  - `isSafeSearchValue(v: unknown): v is string`
  - `pullsQuery(owner: string, repo: string, f: PullFilter): string`
  - `parseFilter(raw: unknown): PullFilter`, `isDefaultFilter(f): boolean`, `describeFilter(f): string` (`''` for the default)
  - `type FacetId`, `facetRows(f): Array<{ id: FacetId; label: string; description: string }>`
  - `STATE_OPTIONS`, `DRAFT_OPTIONS`, `SORT_OPTIONS`: `Array<{ value; label }>`
- Produces (`pullModel.ts`): `type PullState = 'open' | 'closed' | 'merged'`; `PullSummary.state: PullState`; `pullStateOf(s: string): PullState`; `checkStateOf(s: string | undefined): CheckState`.
- Produces (`pullApi.ts`): `listPulls(owner, repo, filter: PullFilter, token: string | null): Promise<PullSummary[]>`.

- [ ] **Step 1: Write the failing filter test** — create `src/pulls/pullFilter.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import {
  DEFAULT_FILTER, PullFilter, describeFilter, facetRows, isDefaultFilter, isSafeSearchValue, parseFilter, pullsQuery,
} from './pullFilter';

const q = (over: Partial<PullFilter> = {}): string => pullsQuery('o', 'r', { ...DEFAULT_FILTER, ...over });

test('the default filter is exactly the Phase 1 query', () => {
  assert.strictEqual(q(), 'repo:o/r is:pr is:open sort:updated-desc');
  assert.ok(isDefaultFilter(DEFAULT_FILTER));
});

test('each state maps to its qualifiers: closed excludes merged, all adds none', () => {
  assert.strictEqual(q({ state: 'merged' }), 'repo:o/r is:pr is:merged sort:updated-desc');
  assert.strictEqual(q({ state: 'closed' }), 'repo:o/r is:pr is:closed is:unmerged sort:updated-desc');
  assert.strictEqual(q({ state: 'all' }), 'repo:o/r is:pr sort:updated-desc');
});

test('mine, review requested, draft and sort', () => {
  assert.strictEqual(
    q({ mine: true, reviewRequested: true, draft: 'hide', sort: 'created' }),
    'repo:o/r is:pr is:open author:@me review-requested:@me draft:false sort:created-desc',
  );
  assert.strictEqual(q({ draft: 'only', sort: 'comments' }), 'repo:o/r is:pr is:open draft:true sort:comments-desc');
});

test('label and milestone are quoted so names with spaces stay one qualifier', () => {
  assert.strictEqual(
    q({ label: 'good first issue', milestone: 'v 1.0' }),
    'repo:o/r is:pr is:open label:"good first issue" milestone:"v 1.0" sort:updated-desc',
  );
});

test('a label that would end the quotes or start another qualifier never reaches the query', () => {
  for (const bad of ['x" is:closed', 'a\\', 'line\nbreak', 'tab\there', '', 'x'.repeat(101)]) {
    assert.strictEqual(isSafeSearchValue(bad), false, JSON.stringify(bad));
    assert.strictEqual(q({ label: bad, milestone: bad }), q(), JSON.stringify(bad));
  }
});

test('parseFilter: anything unusable falls back field by field and never throws', () => {
  for (const junk of [undefined, null, 'x', 7, [], {}]) assert.deepStrictEqual(parseFilter(junk), DEFAULT_FILTER);
  assert.deepStrictEqual(
    parseFilter({ state: 'bogus', mine: 'yes', draft: 'only', label: 'bug" x', milestone: 'v1', sort: 7 }),
    { ...DEFAULT_FILTER, draft: 'only', milestone: 'v1' },
  );
  const kept: PullFilter = { ...DEFAULT_FILTER, state: 'merged', mine: true, label: 'bug', sort: 'comments' };
  assert.deepStrictEqual(parseFilter(JSON.parse(JSON.stringify(kept))), kept);
});

test('describeFilter names only what differs from the default, and isDefaultFilter agrees', () => {
  assert.strictEqual(describeFilter(DEFAULT_FILTER), '');
  const f: PullFilter = { ...DEFAULT_FILTER, state: 'merged', mine: true, draft: 'hide', label: 'bug', sort: 'created' };
  assert.strictEqual(describeFilter(f), 'Merged · Created by me · No drafts · Label: bug · Newest');
  assert.ok(!isDefaultFilter(f));
  assert.ok(!isDefaultFilter({ ...DEFAULT_FILTER, milestone: 'v1' }));
});

test('facetRows shows the current value of every facet', () => {
  const rows = facetRows({ ...DEFAULT_FILTER, state: 'closed', reviewRequested: true, label: 'bug' });
  const by = Object.fromEntries(rows.map(r => [r.id, r.description]));
  assert.deepStrictEqual(by, {
    state: 'Closed (not merged)', mine: 'Off', reviewRequested: 'On', draft: 'Any', label: 'bug', milestone: 'Any', sort: 'Recently updated',
  });
});
```

- [ ] **Step 2: Register the test** — in `tsconfig.json`, change `"src/pulls/pullCheckout.test.ts"]` to `"src/pulls/pullCheckout.test.ts", "src/pulls/pullFilter.test.ts"]`; in `package.json`'s `test` script change `out/pulls/pullCheckout.test.js"` to `out/pulls/pullCheckout.test.js out/pulls/pullFilter.test.js"`.

- [ ] **Step 3: Run it to verify it fails**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './pullFilter'`.

- [ ] **Step 4: Write `src/pulls/pullFilter.ts`**

```ts
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
```

- [ ] **Step 5: Update `pullModel.ts`** — (a) add after `ReviewState`: `export type PullState = 'open' | 'closed' | 'merged';`; (b) add `state: PullState;` to `PullSummary` after `url`; (c) in `LIST_PULLS` change the field line to `number title url state isDraft updatedAt isCrossRepository headRefName baseRefName headRefOid baseRefOid reviewDecision`; (d) add `state: string;` to `GqlPull` after `url: string;`; (e) add the two helpers right after the existing `REVIEWS` constant (they use `CHECKS`, which is declared above it); (f) delete `openPullsQuery`:

```ts
export const pullStateOf = (s: string): PullState => (s === 'MERGED' ? 'merged' : s === 'CLOSED' ? 'closed' : 'open');
export const checkStateOf = (s: string | undefined): CheckState => CHECKS[s ?? ''] ?? 'none';
```

and in `mapPulls` use them:

```ts
      url: n.url,
      state: pullStateOf(n.state),
      ...
      checks: checkStateOf(n.commits.nodes[0]?.commit.statusCheckRollup?.state),
```

- [ ] **Step 6: Update `pullModel.test.ts`** — remove `openPullsQuery` from the import and delete its test; add `state: 'OPEN',` to the `pullNode` fixture and `state: 'open',` to the expected object in `mapPulls maps a PR…`; then add:

```ts
test('mapPulls: merged and closed PRs keep their state, anything unknown counts as open', () => {
  const state = (s: string) => mapPulls(list([pullNode({ state: s })]))[0].state;
  assert.strictEqual(state('MERGED'), 'merged');
  assert.strictEqual(state('CLOSED'), 'closed');
  assert.strictEqual(state('OPEN'), 'open');
  assert.strictEqual(state('SOMETHING_NEW'), 'open');
});
```

If `tsc` complains about other `PullSummary` literals in the tests (e.g. `pinCurrent`), add `state: 'open'` to them.

- [ ] **Step 7: Update `pullApi.ts`** — replace `listOpenPulls` and its imports:

```ts
import { PullFilter, pullsQuery } from './pullFilter';
// (and drop `openPullsQuery` from the './pullModel' import list)

// ponytail: the first 50 matches; add cursor paging (like the issues list) if a repo has more.
export async function listPulls(owner: string, repo: string, filter: PullFilter, token: string | null): Promise<PullSummary[]> {
  return mapPulls(await requestGraphql<ListPullsData>(LIST_PULLS, { q: pullsQuery(owner, repo, filter), first: 50 }, token));
}
```

and in `pullApi.test.ts` replace the import of `listOpenPulls` with `listPulls`, import `DEFAULT_FILTER` from `./pullFilter`, and replace the `listOpenPulls…` test with:

```ts
test('listPulls sends the filter as the search query', async () => {
  const empty = { data: { search: { nodes: [] } } };
  const calls = stub([empty, empty]);
  assert.deepStrictEqual(await listPulls('o', 'r', DEFAULT_FILTER, 't'), []);
  assert.strictEqual(calls[0].url, 'https://api.github.com/graphql');
  assert.strictEqual(calls[0].body.variables.q, 'repo:o/r is:pr is:open sort:updated-desc');
  await listPulls('o', 'r', { ...DEFAULT_FILTER, state: 'merged', mine: true }, 't');
  assert.strictEqual(calls[1].body.variables.q, 'repo:o/r is:pr is:merged author:@me sort:updated-desc');
});
```

- [ ] **Step 8: Keep the tree compiling** — in `pullsTreeView.ts` change the import to `listPulls` and add `import { DEFAULT_FILTER } from './pullFilter';`, and the call to `listPulls(this.repo!.owner, this.repo!.repo, DEFAULT_FILTER, this.token)`. (Task 2 replaces `DEFAULT_FILTER` with real state.)

- [ ] **Step 9: Run the tests**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/pulls/pullFilter.test.js out/pulls/pullModel.test.js out/pulls/pullApi.test.js`
Expected: PASS (all tests in the three files).

- [ ] **Step 10: Commit**

```bash
git add extensions/null-tools/src/pulls extensions/null-tools/tsconfig.json extensions/null-tools/package.json
git commit -m "feat(null-tools): pull request filter model and PR state"
```

---

### Task 2: Filter menu, persistence and tree wiring

**Files:**
- Create: `extensions/null-tools/src/pulls/pullFilterMenu.ts`
- Modify: `extensions/null-tools/src/pulls/pullApi.ts` (`fetchLabelNames`, `fetchMilestoneTitles`)
- Modify: `extensions/null-tools/src/pulls/pullApi.test.ts`
- Modify: `extensions/null-tools/src/pulls/pullsTreeView.ts` (filter state, `empty-filtered`, merged/closed icons, `context()`)
- Modify: `extensions/null-tools/src/pulls/pullsIntegration.ts` (commands)
- Modify: `extensions/null-tools/package.json` (commands, title buttons, welcome text)
- Modify: `extensions/null-tools/src/test/suite/pulls.spec.ts`

**Interfaces:**
- Consumes (Task 1): `PullFilter`, `DEFAULT_FILTER`, `parseFilter`, `isDefaultFilter`, `describeFilter`, `facetRows`, `FacetId`, `STATE_OPTIONS`, `DRAFT_OPTIONS`, `SORT_OPTIONS`, `isSafeSearchValue`, `listPulls`, `PullSummary.state`.
- Produces: `fetchLabelNames(owner, repo, token): Promise<string[]>`, `fetchMilestoneTitles(owner, repo, token): Promise<string[]>`; `editFilter(start: PullFilter, choices: { labels(): Promise<string[]>; milestones(): Promise<string[]> }): Promise<PullFilter | undefined>`; on `PullsTreeProvider`: `filter: PullFilter`, `setFilter(next): Promise<void>`, `context(): { repo: { owner: string; repo: string }; token: string | null } | null`; `PullsState` gains `'empty-filtered'`; commands `null.pulls.filter`, `null.pulls.resetFilter`.

- [ ] **Step 1: Write the failing API tests** — in `pullApi.test.ts` add `fetchLabelNames, fetchMilestoneTitles` to the import and append:

```ts
test('fetchLabelNames returns the names and drops any that could break out of a search qualifier', async () => {
  const calls = stub([[{ name: 'bug' }, { name: 'good first issue' }, { name: 'x" is:closed' }]]);
  assert.deepStrictEqual(await fetchLabelNames('o', 'r', 't'), ['bug', 'good first issue']);
  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/labels?per_page=100');
});

test('fetchMilestoneTitles lists open and closed milestones, minus unsafe titles', async () => {
  const calls = stub([[{ title: 'v1' }, { title: 'v2\nis:open' }]]);
  assert.deepStrictEqual(await fetchMilestoneTitles('o', 'r', 't'), ['v1']);
  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/milestones?state=all&per_page=100');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: FAIL — `fetchLabelNames` is not exported.

- [ ] **Step 3: Implement the two calls** — in `pullApi.ts` (import `isSafeSearchValue` from `./pullFilter` next to the existing filter import):

```ts
// ponytail: the first 100 labels / milestones; add paging if a repo has more to pick from.
export async function fetchLabelNames(owner: string, repo: string, token: string | null): Promise<string[]> {
  const raw = await requestJson<Array<{ name: string }>>(`/repos/${owner}/${repo}/labels?per_page=100`, token);
  return raw.map(l => l.name).filter(isSafeSearchValue);
}

export async function fetchMilestoneTitles(owner: string, repo: string, token: string | null): Promise<string[]> {
  const raw = await requestJson<Array<{ title: string }>>(`/repos/${owner}/${repo}/milestones?state=all&per_page=100`, token);
  return raw.map(m => m.title).filter(isSafeSearchValue);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/pulls/pullApi.test.js`
Expected: PASS.

- [ ] **Step 5: Write `src/pulls/pullFilterMenu.ts`** (thin `vscode` glue; its logic is `facetRows` and the option lists from Task 1)

```ts
'use strict';

import * as vscode from 'vscode';
import {
  DEFAULT_FILTER, DRAFT_OPTIONS, FacetId, PullFilter, SORT_OPTIONS, STATE_OPTIONS, facetRows,
} from './pullFilter';
import { describeFailure } from './pullModel';

export interface FilterChoices {
  labels(): Promise<string[]>;
  milestones(): Promise<string[]>;
}

type MenuItem = vscode.QuickPickItem & { id?: FacetId; action?: 'apply' | 'reset' };

async function pickOne<T extends string>(title: string, options: Array<{ value: T; label: string }>, current: T): Promise<T> {
  const picked = await vscode.window.showQuickPick(
    options.map(o => ({ label: o.label, description: o.value === current ? 'current' : '', value: o.value })), { title });
  return picked ? picked.value : current;
}

/** `null` clears the facet; the current value is kept when the list cannot be loaded or the pick is cancelled. */
async function pickName(title: string, load: () => Promise<string[]>, current: string | null): Promise<string | null> {
  let names: string[];
  try {
    names = await load();
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not load the ${title.toLowerCase()} list: ${describeFailure(err)}`);
    return current;
  }
  const items = [{ label: 'Any', value: null as string | null }, ...names.map(n => ({ label: n, value: n as string | null }))];
  const picked = await vscode.window.showQuickPick(items, { title });
  return picked ? picked.value : current;
}

/** Walks the facets until Apply (resolves to the new filter) or Escape (resolves to undefined: nothing changes). */
export async function editFilter(start: PullFilter, choices: FilterChoices): Promise<PullFilter | undefined> {
  let f = start;
  for (;;) {
    const items: MenuItem[] = [
      { label: '$(check) Apply', action: 'apply' },
      ...facetRows(f).map(r => ({ label: r.label, description: r.description, id: r.id })),
      { label: '$(discard) Reset filters', action: 'reset' },
    ];
    const picked = await vscode.window.showQuickPick(items, { title: 'Filter pull requests' });
    if (!picked) return undefined;
    if (picked.action === 'apply') return f;
    if (picked.action === 'reset') { f = DEFAULT_FILTER; continue; }
    switch (picked.id) {
      case 'mine': f = { ...f, mine: !f.mine }; break;
      case 'reviewRequested': f = { ...f, reviewRequested: !f.reviewRequested }; break;
      case 'state': f = { ...f, state: await pickOne('State', STATE_OPTIONS, f.state) }; break;
      case 'draft': f = { ...f, draft: await pickOne('Drafts', DRAFT_OPTIONS, f.draft) }; break;
      case 'sort': f = { ...f, sort: await pickOne('Sort by', SORT_OPTIONS, f.sort) }; break;
      case 'label': f = { ...f, label: await pickName('Label', choices.labels, f.label) }; break;
      case 'milestone': f = { ...f, milestone: await pickName('Milestone', choices.milestones, f.milestone) }; break;
    }
  }
}
```

- [ ] **Step 6: Wire the tree** — in `pullsTreeView.ts`:

(a) imports: replace the Task 1 `DEFAULT_FILTER` import with `import { PullFilter, describeFilter, isDefaultFilter, parseFilter } from './pullFilter';`.

(b) extend the state union: `… | 'signed-out' | 'error' | 'empty' | 'empty-filtered' | 'ready';`

(c) add `const FILTER_KEY = 'null.pulls.filter';` below `STATUS_LETTER`.

(d) in the class: add the field and change the constructor:

```ts
  filter: PullFilter;
  ...
  /** The tree's one-line detail: the failure for `error`, the active filters otherwise. */
  onMessage: (message: string | undefined) => void = () => undefined;

  constructor(private readonly review: PullReview, private readonly store: vscode.Memento) {
    this.filter = parseFilter(store.get(FILTER_KEY));
  }

  /** The repo and token the last refresh resolved; null before the view first loads or without a GitHub remote. */
  context(): { repo: { owner: string; repo: string }; token: string | null } | null {
    return this.repo ? { repo: this.repo, token: this.token } : null;
  }

  async setFilter(next: PullFilter): Promise<void> {
    this.filter = next;
    await this.store.update(FILTER_KEY, isDefaultFilter(next) ? undefined : next);
    await this.refresh();
  }
```

(e) in `refresh()` replace the `try` body:

```ts
      try {
        this.pulls = pinCurrent(await listPulls(this.repo!.owner, this.repo!.repo, this.filter, this.token), this.current);
        const plain = isDefaultFilter(this.filter);
        this.state = this.pulls.length > 0 ? 'ready' : plain ? 'empty' : 'empty-filtered';
        if (!plain) message = describeFilter(this.filter);
      } catch (err) {
```

(f) in `getTreeItem` replace the icon lines and the `checks` text:

```ts
    const color = pull.state === 'merged' ? 'charts.purple' : pull.state === 'closed' ? 'charts.red' : CHECK_COLORS[pull.checks];
    const icon = pull.state === 'merged' ? 'git-merge' : pull.state === 'closed' ? 'git-pull-request-closed'
      : pull.draft ? 'git-pull-request-draft' : 'git-pull-request';
    item.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
    ...
    const checks = pull.state !== 'open' ? pull.state : pull.checks === 'none' ? 'no checks' : `checks ${pull.checks}`;
```

- [ ] **Step 7: Register the commands** — in `pullsIntegration.ts`: import `{ DEFAULT_FILTER }` from `./pullFilter`, `{ editFilter }` from `./pullFilterMenu`, `{ fetchLabelNames, fetchMilestoneTitles }` from `./pullApi`; construct the tree with `new PullsTreeProvider(review, context.workspaceState)`; add to the `context.subscriptions.push(` list:

```ts
    vscode.commands.registerCommand('null.pulls.filter', async () => {
      const ctx = tree.context();
      if (!ctx) {
        void vscode.window.showInformationMessage('Open the Pull Requests view of a folder with a GitHub remote first.');
        return;
      }
      const { owner, repo } = ctx.repo;
      const next = await editFilter(tree.filter, {
        labels: () => fetchLabelNames(owner, repo, ctx.token),
        milestones: () => fetchMilestoneTitles(owner, repo, ctx.token),
      });
      if (next) {
        lastRefresh = Date.now();
        await tree.setFilter(next);
      }
    }),
    vscode.commands.registerCommand('null.pulls.resetFilter', async () => {
      lastRefresh = Date.now();
      await tree.setFilter(DEFAULT_FILTER);
    }),
```

- [ ] **Step 8: Contribute them** — in `package.json`:

commands (after `null.pulls.comment`, adding a comma): 
```json
      { "command": "null.pulls.filter", "title": "Null: Filter Pull Requests", "icon": "$(filter)" },
      { "command": "null.pulls.resetFilter", "title": "Null: Reset Pull Request Filters" }
```
`viewsWelcome` (after the `empty` entry, adding a comma):
```json
      { "view": "null.pullsView", "contents": "No pull requests match the filters.\n[Change Filters](command:null.pulls.filter)\n[Reset Filters](command:null.pulls.resetFilter)", "when": "null.pulls.state == empty-filtered" }
```
`view/title`: replace the single refresh entry with
```json
        { "command": "null.pulls.filter", "when": "view == null.pullsView && null.pulls.state =~ /^(ready|empty|empty-filtered)$/", "group": "navigation@1" },
        { "command": "null.pulls.refresh", "when": "view == null.pullsView", "group": "navigation@2" }
```

- [ ] **Step 9: Update the integration spec** — in `src/test/suite/pulls.spec.ts` extend the command list to `['null.pulls.refresh', 'null.pulls.open', 'null.pulls.checkout', 'null.pulls.openOnGitHub', 'null.pulls.filter', 'null.pulls.resetFilter']`.

- [ ] **Step 10: Build and run the unit tests**

Run: `cd extensions/null-tools && npm test`
Expected: PASS (tsc clean; every test file green).

- [ ] **Step 11: Commit**

```bash
git add extensions/null-tools/src extensions/null-tools/package.json
git commit -m "feat(null-tools): filter and sort the pull request list"
```

---

### Task 3: Detail model — query, mappers, checks, safe links

**Files:**
- Create: `extensions/null-tools/src/pulls/pullDetailModel.ts`
- Create: `extensions/null-tools/src/pulls/pullDetailModel.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Consumes (Task 1): `PullState`, `CheckState`, `pullStateOf`, `checkStateOf` from `./pullModel`.
- Produces: types `PullUser`, `ReviewVerdict`, `ReviewerRow`, `CheckRowState`, `CheckRow`, `CommitRow`, `PullTimelineItem`, `PullPage`, `PullPageData`; `PULL_PAGE` (GraphQL string); `mapPullPage(data: PullPageData): PullPage` (throws `Error('Pull request not found.')`); `mapTimeline`, `mapReviewers`, `mapChecks`, `checkRowState(status, conclusion)`, `statusContextState(state)`; `failedRunIds(checks: CheckRow[]): number[]`; `safeExternalUrl(raw: unknown): string | null`.

- [ ] **Step 1: Write the failing test** — create `src/pulls/pullDetailModel.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import {
  CheckRow, PullPageData, checkRowState, failedRunIds, mapChecks, mapPullPage, safeExternalUrl, statusContextState,
} from './pullDetailModel';

const user = (login: string) => ({ login, avatarUrl: `https://avatars.githubusercontent.com/${login}` });

const gqlPage = (over: Record<string, unknown> = {}): PullPageData => ({
  repository: {
    pullRequest: {
      number: 12, title: 'Add x', url: 'https://github.com/o/r/pull/12', state: 'OPEN', isDraft: false,
      createdAt: '2026-10-01T10:00:00Z', bodyHTML: '<p>Hi</p>', headRefName: 'feat/x', baseRefName: 'main',
      isCrossRepository: false, additions: 10, deletions: 2, changedFiles: 3,
      author: user('octocat'),
      labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
      milestone: { title: 'v1' },
      assignees: { nodes: [user('hubot')] },
      reviewRequests: { nodes: [] },
      latestOpinionatedReviews: { nodes: [] },
      commits: {
        totalCount: 1,
        nodes: [{ commit: { oid: 'a'.repeat(40), abbreviatedOid: 'aaaaaaa', messageHeadline: 'wip', committedDate: '2026-10-01T09:00:00Z',
          url: 'https://github.com/o/r/commit/a', author: { name: 'Octo Cat', user: { login: 'octocat' } } } }],
      },
      timelineItems: { totalCount: 0, nodes: [] },
      lastCommit: { nodes: [{ commit: { statusCheckRollup: null } }] },
      ...over,
    },
  },
} as unknown as PullPageData);

test('mapPullPage maps the header, sidebar and commits', () => {
  const p = mapPullPage(gqlPage());
  assert.strictEqual(p.number, 12);
  assert.strictEqual(p.state, 'open');
  assert.deepStrictEqual(p.author, { login: 'octocat', avatar: 'https://avatars.githubusercontent.com/octocat' });
  assert.deepStrictEqual(p.labels, [{ name: 'bug', color: 'd73a4a' }]);
  assert.strictEqual(p.milestone, 'v1');
  assert.deepStrictEqual(p.assignees.map(a => a.login), ['hubot']);
  assert.deepStrictEqual(p.commits, [{
    sha: 'a'.repeat(40), short: 'aaaaaaa', headline: 'wip', author: 'octocat', at: '2026-10-01T09:00:00Z', url: 'https://github.com/o/r/commit/a',
  }]);
  assert.strictEqual(p.commitTotal, 1);
  assert.strictEqual(p.checkState, 'none');
  assert.deepStrictEqual(p.checks, []);
});

test('mapPullPage: merged, closed, a deleted author, a commit by a non-GitHub user', () => {
  assert.strictEqual(mapPullPage(gqlPage({ state: 'MERGED' })).state, 'merged');
  assert.strictEqual(mapPullPage(gqlPage({ state: 'CLOSED' })).state, 'closed');
  assert.strictEqual(mapPullPage(gqlPage({ author: null })).author.login, 'ghost');
  const commits = { totalCount: 1, nodes: [{ commit: { oid: 'b'.repeat(40), abbreviatedOid: 'bbbbbbb', messageHeadline: 'x',
    committedDate: '2026-10-01T09:00:00Z', url: 'u', author: { name: 'Octo Cat', user: null } } }] };
  assert.strictEqual(mapPullPage(gqlPage({ commits })).commits[0].author, 'Octo Cat');
});

test('mapPullPage throws a readable error when the PR does not exist', () => {
  assert.throws(() => mapPullPage({ repository: { pullRequest: null } } as PullPageData), /Pull request not found/);
  assert.throws(() => mapPullPage({ repository: null } as unknown as PullPageData), /Pull request not found/);
});

test('mapTimeline: comments, reviews, events; PENDING reviews, unknown types and null nodes are skipped; deleted authors are ghost', () => {
  const nodes = [
    { __typename: 'IssueComment', url: 'u1', createdAt: '2026-10-01T11:00:00Z', bodyHTML: '<p>c</p>', author: user('a') },
    { __typename: 'PullRequestReview', url: 'u2', state: 'APPROVED', createdAt: '2026-10-01T12:00:00Z', bodyHTML: '', author: user('b'), comments: { totalCount: 2 } },
    { __typename: 'PullRequestReview', url: 'u3', state: 'PENDING', createdAt: '2026-10-01T12:30:00Z', bodyHTML: '', author: user('me'), comments: { totalCount: 1 } },
    { __typename: 'PullRequestReview', url: 'u4', state: 'CHANGES_REQUESTED', createdAt: '2026-10-01T13:00:00Z', bodyHTML: '<p>no</p>', author: null, comments: { totalCount: 0 } },
    { __typename: 'MergedEvent', createdAt: '2026-10-02T10:00:00Z', actor: { login: 'maint' } },
    { __typename: 'ClosedEvent', createdAt: '2026-10-02T11:00:00Z', actor: null },
    { __typename: 'ConvertToDraftEvent', createdAt: '2026-10-02T12:00:00Z', actor: { login: 'a' } },
    { __typename: 'SomethingNew', createdAt: '2026-10-02T13:00:00Z' },
    { __typename: 'constructor' },
    null,
  ];
  const timeline = mapPullPage(gqlPage({ timelineItems: { totalCount: 12, nodes } })).timeline;
  assert.deepStrictEqual(timeline.map(i => (i.kind === 'event' ? `event:${i.event}:${i.actor}` : i.kind === 'review' ? `review:${i.verdict}:${i.author.login}` : `comment:${i.author.login}`)), [
    'comment:a', 'review:approved:b', 'review:changes:ghost', 'event:merged:maint', 'event:closed:ghost', 'event:draft:a',
  ]);
  const approved = timeline[1];
  assert.ok(approved.kind === 'review' && approved.comments === 2 && approved.url === 'u2');
});

test('mapPullPage keeps the timeline total so the page can say it is cut off', () => {
  const p = mapPullPage(gqlPage({ timelineItems: { totalCount: 230, nodes: [] }, commits: { totalCount: 130, nodes: [] } }));
  assert.strictEqual(p.timelineTotal, 230);
  assert.strictEqual(p.commitTotal, 130);
});

test('mapReviewers: latest verdicts, a re-request wins over an old verdict, a team has a name instead of a login', () => {
  const p = mapPullPage(gqlPage({
    latestOpinionatedReviews: { nodes: [
      { state: 'APPROVED', author: user('ann') }, { state: 'CHANGES_REQUESTED', author: user('bob') },
      { state: 'DISMISSED', author: user('dee') }, { state: 'COMMENTED', author: null },
    ] },
    reviewRequests: { nodes: [
      { requestedReviewer: { __typename: 'User', login: 'bob', avatarUrl: 'https://a/bob' } },
      { requestedReviewer: { __typename: 'Team', name: 'core' } },
      { requestedReviewer: null },
    ] },
  }));
  assert.deepStrictEqual(p.reviewers.map(r => `${r.login}:${r.state}`), ['ann:approved', 'bob:pending', 'dee:dismissed', 'core:pending']);
});

test('checkRowState / statusContextState', () => {
  assert.strictEqual(checkRowState('COMPLETED', 'SUCCESS'), 'success');
  for (const c of ['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE']) assert.strictEqual(checkRowState('COMPLETED', c), 'failure', c);
  for (const c of ['NEUTRAL', 'SKIPPED', 'CANCELLED', 'STALE', null]) assert.strictEqual(checkRowState('COMPLETED', c), 'neutral', String(c));
  assert.strictEqual(checkRowState('COMPLETED', 'ACTION_REQUIRED'), 'pending');
  for (const s of ['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING', 'REQUESTED']) assert.strictEqual(checkRowState(s, null), 'pending', s);
  assert.deepStrictEqual(['SUCCESS', 'FAILURE', 'ERROR', 'PENDING', 'EXPECTED', 'WHAT'].map(statusContextState),
    ['success', 'failure', 'failure', 'pending', 'pending', 'neutral']);
});

test('mapChecks: check runs and legacy statuses, failures first, then by name; run id only from Actions checks', () => {
  const rows = mapChecks([
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/o/r/actions/runs/1/job/1', checkSuite: { workflowRun: { databaseId: 1 } } },
    { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/2/job/9', checkSuite: { workflowRun: { databaseId: 2 } } },
    { __typename: 'CheckRun', name: 'app', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: null, checkSuite: { workflowRun: null } },
    { __typename: 'StatusContext', context: 'ci/legacy', state: 'FAILURE', targetUrl: 'https://ci.example/1', description: 'broke' },
    { __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: null, detailsUrl: 'https://x', checkSuite: null },
    { __typename: 'Unknown' },
    null,
  ]);
  assert.deepStrictEqual(rows.map(r => `${r.state}:${r.name}`), ['failure:app', 'failure:ci/legacy', 'failure:test', 'pending:build', 'success:lint']);
  assert.strictEqual(rows.find(r => r.name === 'test')!.runId, 2);
  assert.strictEqual(rows.find(r => r.name === 'app')!.runId, null);
  assert.strictEqual(rows.find(r => r.name === 'ci/legacy')!.description, 'broke');
});

test('mapPullPage reads the rollup: overall state, rows and the total (which may exceed the rows)', () => {
  const rollup = { state: 'FAILURE', contexts: { totalCount: 150, nodes: [
    { __typename: 'CheckRun', name: 't', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://x', checkSuite: { workflowRun: { databaseId: 5 } } },
  ] } };
  const p = mapPullPage(gqlPage({ lastCommit: { nodes: [{ commit: { statusCheckRollup: rollup } }] } }));
  assert.strictEqual(p.checkState, 'failure');
  assert.strictEqual(p.checks.length, 1);
  assert.strictEqual(p.checksTotal, 150);
});

test('failedRunIds: distinct runs of failed rows only; no failures or no run ids means nothing to re-run', () => {
  const row = (state: CheckRow['state'], runId: number | null): CheckRow => ({ name: 'n', state, url: null, runId, description: '' });
  assert.deepStrictEqual(failedRunIds([row('failure', 2), row('failure', 2), row('failure', 3), row('success', 4), row('pending', 5), row('failure', null)]), [2, 3]);
  assert.deepStrictEqual(failedRunIds([row('success', 1), row('neutral', 2)]), []);
  assert.deepStrictEqual(failedRunIds([row('failure', null), row('failure', -1), row('failure', 1.5)]), []);
  assert.deepStrictEqual(failedRunIds([]), []);
});

test('safeExternalUrl allows https only', () => {
  assert.strictEqual(safeExternalUrl('https://github.com/o/r/pull/1'), 'https://github.com/o/r/pull/1');
  for (const bad of ['javascript:alert(1)', 'http://github.com', 'file:///etc/passwd', 'vscode://x', '/relative', '#frag', '', 'not a url', null, undefined, 7]) {
    assert.strictEqual(safeExternalUrl(bad), null, String(bad));
  }
});
```

- [ ] **Step 2: Register the test** — add `"src/pulls/pullDetailModel.test.ts"` after the last `src/pulls/` entry of `tsconfig.json`'s `include`, and `out/pulls/pullDetailModel.test.js` after the last `out/pulls/` entry of `package.json`'s `test` script.

- [ ] **Step 3: Run it to verify it fails**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './pullDetailModel'`.

- [ ] **Step 4: Write `src/pulls/pullDetailModel.ts`**

```ts
'use strict';

import { CheckState, PullState, checkStateOf, pullStateOf } from './pullModel';

export interface PullUser { login: string; avatar: string }
export type ReviewVerdict = 'approved' | 'changes' | 'commented' | 'dismissed';
export interface ReviewerRow { login: string; avatar: string; state: ReviewVerdict | 'pending' }
export type CheckRowState = 'success' | 'failure' | 'pending' | 'neutral';
export interface CheckRow {
  name: string;
  state: CheckRowState;
  /** GitHub's own page for the check (logs live there); not validated here, see `safeExternalUrl`. */
  url: string | null;
  /** The Actions workflow run of this check, for "Re-run failed jobs"; null for other checks and legacy statuses. */
  runId: number | null;
  description: string;
}
export interface CommitRow { sha: string; short: string; headline: string; author: string; at: string; url: string }
export type PullTimelineItem =
  | { kind: 'comment'; author: PullUser; at: string; bodyHTML: string; url: string }
  | { kind: 'review'; author: PullUser; at: string; verdict: ReviewVerdict; bodyHTML: string; url: string; comments: number }
  | { kind: 'event'; at: string; actor: string; event: 'closed' | 'merged' | 'reopened' | 'ready' | 'draft' };

/**
 * Everything the detail tab shows. Mirrored by hand in src/webview/pullDetailTypes.ts; `bodyHTML` is GitHub's
 * rendering and is sanitized in the webview before it is shown.
 */
export interface PullPage {
  number: number;
  title: string;
  url: string;
  state: PullState;
  draft: boolean;
  author: PullUser;
  createdAt: string;
  bodyHTML: string;
  headRef: string;
  baseRef: string;
  fork: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: Array<{ name: string; color: string }>;
  milestone: string | null;
  assignees: PullUser[];
  reviewers: ReviewerRow[];
  commits: CommitRow[];
  commitTotal: number;
  timeline: PullTimelineItem[];
  timelineTotal: number;
  checkState: CheckState;
  checks: CheckRow[];
  checksTotal: number;
}

// ponytail: first 100 commits, 100 conversation items, 100 checks (the page says when it is cut off); add paging
// ("load more") if that turns out to be missed.
export const PULL_PAGE = `
query PullPage($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number title url state isDraft createdAt bodyHTML headRefName baseRefName isCrossRepository additions deletions changedFiles
      author { login avatarUrl }
      labels(first: 50) { nodes { name color } }
      milestone { title }
      assignees(first: 20) { nodes { login avatarUrl } }
      reviewRequests(first: 20) { nodes { requestedReviewer {
        __typename
        ... on User { login avatarUrl }
        ... on Mannequin { login avatarUrl }
        ... on Team { name }
      } } }
      latestOpinionatedReviews(first: 30) { nodes { state author { login avatarUrl } } }
      commits(first: 100) { totalCount nodes { commit {
        oid abbreviatedOid messageHeadline committedDate url author { name user { login } }
      } } }
      timelineItems(first: 100, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW, CLOSED_EVENT, MERGED_EVENT, REOPENED_EVENT, READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT]) {
        totalCount
        nodes {
          __typename
          ... on IssueComment { url createdAt bodyHTML author { login avatarUrl } }
          ... on PullRequestReview { url state createdAt bodyHTML author { login avatarUrl } comments { totalCount } }
          ... on ClosedEvent { createdAt actor { login } }
          ... on MergedEvent { createdAt actor { login } }
          ... on ReopenedEvent { createdAt actor { login } }
          ... on ReadyForReviewEvent { createdAt actor { login } }
          ... on ConvertToDraftEvent { createdAt actor { login } }
        }
      }
      lastCommit: commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) {
        totalCount
        nodes {
          __typename
          ... on CheckRun { name status conclusion detailsUrl checkSuite { workflowRun { databaseId } } }
          ... on StatusContext { context state targetUrl description }
        }
      } } } } }
    }
  }
}`;

interface GqlUser { login: string; avatarUrl: string }
interface GqlTimelineNode {
  __typename: string; url?: string; createdAt?: string; bodyHTML?: string; state?: string;
  author?: GqlUser | null; actor?: { login: string } | null; comments?: { totalCount: number };
}
interface GqlCheckNode {
  __typename: string;
  name?: string; status?: string; conclusion?: string | null; detailsUrl?: string | null;
  checkSuite?: { workflowRun: { databaseId: number } | null } | null;
  context?: string; state?: string; targetUrl?: string | null; description?: string | null;
}
interface GqlPullPage {
  number: number; title: string; url: string; state: string; isDraft: boolean; createdAt: string; bodyHTML: string;
  headRefName: string; baseRefName: string; isCrossRepository: boolean; additions: number; deletions: number; changedFiles: number;
  author: GqlUser | null;
  labels: { nodes: Array<{ name: string; color: string }> };
  milestone: { title: string } | null;
  assignees: { nodes: GqlUser[] };
  reviewRequests: { nodes: Array<{ requestedReviewer: { __typename: string; login?: string; avatarUrl?: string; name?: string } | null } | null> };
  latestOpinionatedReviews: { nodes: Array<{ state: string; author: GqlUser | null } | null> };
  commits: { totalCount: number; nodes: Array<{ commit: {
    oid: string; abbreviatedOid: string; messageHeadline: string; committedDate: string; url: string;
    author: { name: string | null; user: { login: string } | null } | null;
  } }> };
  timelineItems: { totalCount: number; nodes: Array<GqlTimelineNode | null> };
  lastCommit: { nodes: Array<{ commit: { statusCheckRollup: { state: string; contexts: { totalCount: number; nodes: Array<GqlCheckNode | null> } } | null } }> };
}
export interface PullPageData { repository: { pullRequest: GqlPullPage | null } | null }

const ghost = (u: GqlUser | null | undefined): PullUser => ({ login: u?.login ?? 'ghost', avatar: u?.avatarUrl ?? '' });
const user = (u: GqlUser): PullUser => ({ login: u.login, avatar: u.avatarUrl });

// Maps, not records: a type name from the wire must never hit an Object.prototype key.
const VERDICTS = new Map<string, ReviewVerdict>([
  ['APPROVED', 'approved'], ['CHANGES_REQUESTED', 'changes'], ['COMMENTED', 'commented'], ['DISMISSED', 'dismissed'],
]);
const EVENTS = new Map<string, 'closed' | 'merged' | 'reopened' | 'ready' | 'draft'>([
  ['ClosedEvent', 'closed'], ['MergedEvent', 'merged'], ['ReopenedEvent', 'reopened'],
  ['ReadyForReviewEvent', 'ready'], ['ConvertToDraftEvent', 'draft'],
]);

/** Comments, submitted reviews and state events, oldest first. An unsent (PENDING) review and unknown types are skipped. */
export function mapTimeline(nodes: Array<GqlTimelineNode | null>): PullTimelineItem[] {
  const items: PullTimelineItem[] = [];
  for (const n of nodes) {
    if (!n) continue;
    const at = n.createdAt ?? '';
    const event = EVENTS.get(n.__typename);
    if (n.__typename === 'IssueComment') {
      items.push({ kind: 'comment', author: ghost(n.author), at, bodyHTML: n.bodyHTML ?? '', url: n.url ?? '' });
    } else if (n.__typename === 'PullRequestReview') {
      const verdict = VERDICTS.get(n.state ?? '');
      if (verdict) {
        items.push({ kind: 'review', author: ghost(n.author), at, verdict, bodyHTML: n.bodyHTML ?? '', url: n.url ?? '', comments: n.comments?.totalCount ?? 0 });
      }
    } else if (event) {
      items.push({ kind: 'event', at, actor: n.actor?.login ?? 'ghost', event });
    }
  }
  return items;
}

/** Latest verdict per reviewer; someone asked (again) to review shows as pending, which wins over an older verdict. */
export function mapReviewers(p: Pick<GqlPullPage, 'latestOpinionatedReviews' | 'reviewRequests'>): ReviewerRow[] {
  const rows = new Map<string, ReviewerRow>();
  for (const r of p.latestOpinionatedReviews.nodes) {
    const verdict = r ? VERDICTS.get(r.state) : undefined;
    if (r?.author && verdict) rows.set(r.author.login, { login: r.author.login, avatar: r.author.avatarUrl, state: verdict });
  }
  for (const req of p.reviewRequests.nodes) {
    const who = req?.requestedReviewer;
    const login = who?.login ?? who?.name; // a team has a name, not a login
    if (login) rows.set(login, { login, avatar: who?.avatarUrl ?? '', state: 'pending' });
  }
  return [...rows.values()];
}

export function checkRowState(status: string, conclusion: string | null): CheckRowState {
  if (status !== 'COMPLETED') return 'pending';
  switch (conclusion) {
    case 'SUCCESS': return 'success';
    case 'FAILURE': case 'TIMED_OUT': case 'STARTUP_FAILURE': return 'failure';
    case 'ACTION_REQUIRED': return 'pending'; // needs someone, and a re-run would not help
    default: return 'neutral'; // NEUTRAL, SKIPPED, CANCELLED, STALE
  }
}

export function statusContextState(state: string): CheckRowState {
  if (state === 'SUCCESS') return 'success';
  if (state === 'FAILURE' || state === 'ERROR') return 'failure';
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending';
  return 'neutral';
}

const RANK: Record<CheckRowState, number> = { failure: 0, pending: 1, success: 2, neutral: 3 };

/** Check runs and legacy commit statuses as one list: what needs attention first, then by name. */
export function mapChecks(nodes: Array<GqlCheckNode | null>): CheckRow[] {
  const rows: CheckRow[] = [];
  for (const n of nodes) {
    if (!n) continue;
    if (n.__typename === 'CheckRun') {
      rows.push({
        name: n.name ?? 'check', state: checkRowState(n.status ?? '', n.conclusion ?? null), url: n.detailsUrl ?? null,
        runId: n.checkSuite?.workflowRun?.databaseId ?? null, description: '',
      });
    } else if (n.__typename === 'StatusContext') {
      rows.push({ name: n.context ?? 'status', state: statusContextState(n.state ?? ''), url: n.targetUrl ?? null, runId: null, description: n.description ?? '' });
    }
  }
  return rows.sort((a, b) => RANK[a.state] - RANK[b.state] || a.name.localeCompare(b.name));
}

/** The workflow runs worth re-running: the distinct runs of failed checks. */
export function failedRunIds(checks: CheckRow[]): number[] {
  const ids = new Set<number>();
  for (const c of checks) {
    if (c.state === 'failure' && c.runId !== null && Number.isSafeInteger(c.runId) && c.runId > 0) ids.add(c.runId);
  }
  return [...ids];
}

export function mapPullPage(data: PullPageData): PullPage {
  const p = data.repository?.pullRequest;
  if (!p) throw new Error('Pull request not found.');
  const rollup = p.lastCommit.nodes[0]?.commit.statusCheckRollup ?? null;
  return {
    number: p.number, title: p.title, url: p.url, state: pullStateOf(p.state), draft: p.isDraft,
    author: ghost(p.author), createdAt: p.createdAt, bodyHTML: p.bodyHTML,
    headRef: p.headRefName, baseRef: p.baseRefName, fork: p.isCrossRepository,
    additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles,
    labels: p.labels.nodes.map(l => ({ name: l.name, color: l.color })),
    milestone: p.milestone?.title ?? null,
    assignees: p.assignees.nodes.map(user),
    reviewers: mapReviewers(p),
    commits: p.commits.nodes.map(({ commit: c }) => ({
      sha: c.oid, short: c.abbreviatedOid, headline: c.messageHeadline,
      author: c.author?.user?.login ?? c.author?.name ?? 'unknown', at: c.committedDate, url: c.url,
    })),
    commitTotal: p.commits.totalCount,
    timeline: mapTimeline(p.timelineItems.nodes),
    timelineTotal: p.timelineItems.totalCount,
    checkState: checkStateOf(rollup?.state),
    checks: mapChecks(rollup?.contexts.nodes ?? []),
    checksTotal: rollup?.contexts.totalCount ?? 0,
  };
}

/** The only links the host opens for the webview: absolute https. Everything else (javascript:, relative, http:) is dropped. */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/pulls/pullDetailModel.test.js`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add extensions/null-tools/src/pulls extensions/null-tools/tsconfig.json extensions/null-tools/package.json
git commit -m "feat(null-tools): pull request detail model and check mapping"
```

---

### Task 4: Detail API — fetch the page, re-run failed runs

**Files:**
- Create: `extensions/null-tools/src/pulls/pullDetailApi.ts`
- Create: `extensions/null-tools/src/pulls/pullDetailApi.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Consumes (Task 3): `PULL_PAGE`, `PullPageData`, `PullPage`, `mapPullPage`.
- Produces: `fetchPullPage(owner, repo, number, token): Promise<PullPage>`; `rerunFailedRuns(owner, repo, runIds: number[], token): Promise<{ started: number; errors: string[] }>`.

- [ ] **Step 1: Write the failing test** — create `src/pulls/pullDetailApi.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import test, { afterEach, mock } from 'node:test';
import { fetchPullPage, rerunFailedRuns } from './pullDetailApi';

afterEach(() => mock.restoreAll());

interface Call { url: string; method: string; body?: any }
interface Canned { status?: number; body: unknown }

/** Answers each https.request with the next canned response (the last one repeats) and records what was asked. */
function stub(responses: Canned[]): Call[] {
  const calls: Call[] = [];
  mock.method(https, 'request', (url: string, opts: { method: string }, onResponse: (res: unknown) => void) => {
    const call: Call = { url, method: opts.method };
    calls.push(call);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return Object.assign(new EventEmitter(), {
      setTimeout() {}, destroy() {},
      write(payload: string) { call.body = JSON.parse(payload); },
      end() {
        const res = Object.assign(new EventEmitter(), { statusCode: next.status ?? 200, headers: {}, setEncoding() {} });
        onResponse(res);
        res.emit('data', JSON.stringify(next.body));
        res.emit('end');
      },
    });
  });
  return calls;
}

const minimalPage = {
  number: 5, title: 'T', url: 'https://github.com/o/r/pull/5', state: 'MERGED', isDraft: false, createdAt: '2026-10-01T10:00:00Z',
  bodyHTML: '', headRefName: 'h', baseRefName: 'main', isCrossRepository: false, additions: 1, deletions: 0, changedFiles: 1,
  author: null, labels: { nodes: [] }, milestone: null, assignees: { nodes: [] }, reviewRequests: { nodes: [] },
  latestOpinionatedReviews: { nodes: [] }, commits: { totalCount: 0, nodes: [] }, timelineItems: { totalCount: 0, nodes: [] },
  lastCommit: { nodes: [] },
};

test('fetchPullPage asks GraphQL for one PR and maps it', async () => {
  const calls = stub([{ body: { data: { repository: { pullRequest: minimalPage } } } }]);
  const page = await fetchPullPage('o', 'r', 5, 't');
  assert.strictEqual(calls[0].url, 'https://api.github.com/graphql');
  assert.deepStrictEqual(calls[0].body.variables, { owner: 'o', name: 'r', number: 5 });
  assert.strictEqual(page.state, 'merged');
  assert.strictEqual(page.author.login, 'ghost');
});

test('fetchPullPage: a PR that does not exist is a readable error', async () => {
  stub([{ body: { data: { repository: { pullRequest: null } } } }]);
  await assert.rejects(fetchPullPage('o', 'r', 404, 't'), /Pull request not found/);
});

test('rerunFailedRuns posts once per run, in order', async () => {
  const calls = stub([{ status: 201, body: {} }]);
  assert.deepStrictEqual(await rerunFailedRuns('o', 'r', [11, 12], 't'), { started: 2, errors: [] });
  assert.deepStrictEqual(calls.map(c => `${c.method} ${c.url}`), [
    'POST https://api.github.com/repos/o/r/actions/runs/11/rerun-failed-jobs',
    'POST https://api.github.com/repos/o/r/actions/runs/12/rerun-failed-jobs',
  ]);
});

test('rerunFailedRuns: a run GitHub refuses is reported with GitHub\'s words, the rest still go', async () => {
  const calls = stub([{ status: 403, body: { message: 'Workflow is still running' } }, { status: 201, body: {} }]);
  const result = await rerunFailedRuns('o', 'r', [11, 12], 't');
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(result.started, 1);
  assert.strictEqual(result.errors.length, 1);
  assert.match(result.errors[0], /Workflow is still running/);
});

test('rerunFailedRuns with no runs makes no request', async () => {
  const calls = stub([{ body: {} }]);
  assert.deepStrictEqual(await rerunFailedRuns('o', 'r', [], 't'), { started: 0, errors: [] });
  assert.strictEqual(calls.length, 0);
});
```

- [ ] **Step 2: Register the test** — `src/pulls/pullDetailApi.test.ts` / `out/pulls/pullDetailApi.test.js` after the last `pulls/` entries in `tsconfig.json` and `package.json`.

- [ ] **Step 3: Run it to verify it fails**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './pullDetailApi'`.

- [ ] **Step 4: Write `src/pulls/pullDetailApi.ts`**

```ts
'use strict';

import { requestGraphql, requestJson } from '../github/githubApi';
import { PULL_PAGE, PullPage, PullPageData, mapPullPage } from './pullDetailModel';

export async function fetchPullPage(owner: string, repo: string, number: number, token: string | null): Promise<PullPage> {
  return mapPullPage(await requestGraphql<PullPageData>(PULL_PAGE, { owner, name: repo, number }, token));
}

export interface RerunResult { started: number; errors: string[] }

/** One POST per workflow run, in order; a run GitHub refuses (still running, no Actions permission) is reported and the rest still go. */
export async function rerunFailedRuns(owner: string, repo: string, runIds: number[], token: string | null): Promise<RerunResult> {
  const result: RerunResult = { started: 0, errors: [] };
  for (const id of runIds) {
    try {
      await requestJson(`/repos/${owner}/${repo}/actions/runs/${id}/rerun-failed-jobs`, token, 'POST', {});
      result.started++;
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return result;
}
```

- [ ] **Step 5: Run the tests**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/pulls/pullDetailApi.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add extensions/null-tools/src/pulls extensions/null-tools/tsconfig.json extensions/null-tools/package.json
git commit -m "feat(null-tools): fetch a pull request page and re-run failed workflow runs"
```

---

### Task 5: Webview HTML builders (pure) and their tests

**Files:**
- Create: `extensions/null-tools/src/webview/pullDetailTypes.ts`
- Create: `extensions/null-tools/src/webview/pullDetailHtml.ts`
- Create: `extensions/null-tools/src/webviewPullDetail.test.ts`
- Modify: `extensions/null-tools/tsconfig.webview-shared.json` (add the two webview files after `detailHtml.ts`)
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Consumes (existing, global in the bundle): `escapeHtml`, `octicon`, `timeHtml`, `avatarHtml(user: GithubUser, large?)`, `eventLabelChips(labels: GithubLabel[])`, `neutralizeImagesHtml`.
- Produces (globals): `pullPageHtml(p: PullPage): string`, `withBodies(p: PullPage, fn: (html: string) => string): PullPage`, `checkSummary(checks: PullCheck[]): string`; webview-side types `PullPage`, `PullUser`, `PullCheck`, … mirroring the host's `PullPage`. `data-act` values it emits: `checkout`, `open-github`, `refresh`, `rerun`.

- [ ] **Step 1: Write the failing test** — create `src/webviewPullDetail.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// The pull request tab's HTML builders are plain top-level functions in a `module: none` bundle: load the compiled
// shared bundle (built by `tsc -p tsconfig.webview-shared.json`) into a sandbox, like webviewDetail.test.ts does.
const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);

type Obj = Record<string, any>;
const html = sandbox as unknown as {
  pullPageHtml(p: Obj): string;
  withBodies(p: Obj, fn: (h: string) => string): Obj;
  checkSummary(checks: Obj[]): string;
};

const user = { login: 'octocat', avatar: 'https://avatars.githubusercontent.com/u/1?v=4' };
const page = (over: Obj = {}): Obj => ({
  number: 12, title: 'Add x', url: 'https://github.com/o/r/pull/12', state: 'open', draft: false, author: user,
  createdAt: '2026-10-01T10:00:00Z', bodyHTML: '<p>Hello</p>', headRef: 'feat/x', baseRef: 'main', fork: false,
  additions: 10, deletions: 2, changedFiles: 3, labels: [{ name: 'bug', color: 'd73a4a' }], milestone: 'v1',
  assignees: [user], reviewers: [], commits: [], commitTotal: 0, timeline: [], timelineTotal: 0,
  checkState: 'none', checks: [], checksTotal: 0, ...over,
});
const check = (over: Obj = {}): Obj => ({ name: 'test', state: 'success', url: 'https://github.com/o/r/actions/runs/1', runId: 1, description: '', ...over });

test('title, branches and author are escaped', () => {
  const out = html.pullPageHtml(page({
    title: '<img src=x onerror=alert(1)>', headRef: '<b>h</b>', baseRef: 'a"b', author: { login: '<i>me</i>', avatar: '' },
  }));
  assert.ok(!out.includes('<img src=x'), 'title');
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!out.includes('<b>h</b>') && out.includes('&lt;b&gt;h&lt;/b&gt;'), 'branch');
  assert.ok(!out.includes('<i>me</i>'), 'author');
});

test('state badge: open, draft, merged, closed', () => {
  const badge = (tone: string, text: string): RegExp => new RegExp(`class="state-badge ${tone}">.*?</svg> ${text}</span>`, 's');
  assert.match(html.pullPageHtml(page()), badge('state-open', 'Open'));
  assert.match(html.pullPageHtml(page({ draft: true })), badge('state-not-planned', 'Draft'));
  const merged = html.pullPageHtml(page({ state: 'merged' }));
  assert.match(merged, badge('state-completed', 'Merged'));
  assert.ok(merged.includes(' merged <code>'));
  assert.match(html.pullPageHtml(page({ state: 'closed' })), badge('state-closed', 'Closed'));
});

test('a draft that is already merged shows its real state', () => {
  assert.match(html.pullPageHtml(page({ state: 'merged', draft: true })), /class="state-badge state-completed">/);
});

test('the description is shown, or a hint when empty', () => {
  assert.ok(html.pullPageHtml(page()).includes('<p>Hello</p>'));
  assert.ok(html.pullPageHtml(page({ bodyHTML: '' })).includes('No description provided.'));
});

test('checks section: absent without checks; failing first; summary; re-run only for a failed row that has a run', () => {
  assert.ok(!html.pullPageHtml(page()).includes('class="checks"'));

  // The host model sorts failures first; the page renders the rows in the order it is given.
  const rows = [check({ name: 'unit', state: 'failure', runId: 7 }), check({ name: 'build', state: 'pending', runId: null }), check({ name: 'lint', state: 'success' })];
  const out = html.pullPageHtml(page({ checks: rows, checksTotal: 3 }));
  assert.ok(out.includes('class="checks"'));
  assert.ok(out.indexOf('unit') < out.indexOf('build') && out.indexOf('build') < out.indexOf('lint'));
  assert.ok(out.includes('1 failing, 1 in progress, 1 successful'));
  assert.ok(out.includes('data-act="rerun"'));

  const noRun = html.pullPageHtml(page({ checks: [check({ state: 'failure', runId: null })], checksTotal: 1 }));
  assert.ok(!noRun.includes('data-act="rerun"'), 'a failed legacy status has no run to re-run');
  const allGood = html.pullPageHtml(page({ checks: [check()], checksTotal: 1 }));
  assert.ok(!allGood.includes('data-act="rerun"'), 'nothing failed');
});

test('checks: names and links are escaped, and more checks than shown are admitted', () => {
  const out = html.pullPageHtml(page({
    checks: [check({ name: '<script>x</script>', url: 'https://x/?a="b"', description: '<i>d</i>' })], checksTotal: 150,
  }));
  assert.ok(!out.includes('<script>x') && !out.includes('<i>d</i>'));
  assert.ok(out.includes('href="https://x/?a=&quot;b&quot;"'));
  assert.ok(out.includes('Showing 1 of 150 checks.'));
});

test('checkSummary names only non-empty groups', () => {
  assert.strictEqual(html.checkSummary([check(), check({ state: 'neutral' }), check({ state: 'neutral' })]), '1 successful, 2 skipped');
  assert.strictEqual(html.checkSummary([]), '');
});

test('timeline: a bodiless review is one compact row; a review with a body is a card; comments and events', () => {
  const out = html.pullPageHtml(page({ timelineTotal: 4, timeline: [
    { kind: 'review', author: { login: 'rev', avatar: '' }, at: '2026-10-02T10:00:00Z', verdict: 'approved', bodyHTML: '', url: 'https://github.com/o/r/pull/12#r1', comments: 2 },
    { kind: 'review', author: { login: 'pick', avatar: '' }, at: '2026-10-02T11:00:00Z', verdict: 'changes', bodyHTML: '<p>please fix</p>', url: 'https://github.com/o/r/pull/12#r2', comments: 0 },
    { kind: 'comment', author: { login: 'talker', avatar: '' }, at: '2026-10-02T12:00:00Z', bodyHTML: '<p>nice</p>', url: 'u' },
    { kind: 'event', at: '2026-10-03T10:00:00Z', actor: 'maint', event: 'merged' },
  ] }));
  assert.match(out, /tl-event[^]*rev<\/b> approved these changes with 2 inline comments/);
  assert.ok(out.includes('<p>please fix</p>'), 'review body shown');
  assert.match(out, /pick<\/b><span class="post-when">requested changes/);
  assert.ok(out.includes('<p>nice</p>'));
  assert.match(out, /maint<\/b> merged this/);
  assert.ok(!out.includes('Showing the first'), 'nothing is cut off');
});

test('truncation: more events than shown, and more commits than shown, are admitted', () => {
  const out = html.pullPageHtml(page({
    timelineTotal: 230,
    commitTotal: 130,
    commits: [{ sha: 'a'.repeat(40), short: 'aaaaaaa', headline: 'fix <b>', author: 'octocat', at: '2026-10-01T09:00:00Z', url: 'https://github.com/o/r/commit/a' }],
  }));
  assert.ok(out.includes('Showing the first 0 of 230 events.'));
  assert.ok(out.includes('Showing the first 1 of 130 commits.'));
  assert.ok(out.includes('130 commits'));
  assert.ok(out.includes('fix &lt;b&gt;'));
});

test('sidebar: reviewers with verdicts, a pending request, labels, milestone, assignees; empty states', () => {
  const out = html.pullPageHtml(page({ reviewers: [
    { login: 'ann', avatar: '', state: 'approved' }, { login: 'core', avatar: '', state: 'pending' },
  ] }));
  assert.match(out, /ann[^]*rv-approved/);
  assert.match(out, /core[^]*requested/);
  assert.ok(out.includes('gh-label') && out.includes('bug'));
  assert.ok(out.includes('v1'));
  const bare = html.pullPageHtml(page({ reviewers: [], labels: [], milestone: null, assignees: [] }));
  assert.ok(bare.includes('No reviewers') && bare.includes('No milestone') && bare.includes('No one') && bare.includes('None yet'));
});

test('the header offers check out, open on GitHub and refresh', () => {
  const out = html.pullPageHtml(page());
  for (const act of ['checkout', 'open-github', 'refresh']) assert.ok(out.includes(`data-act="${act}"`), act);
});

test('withBodies applies the sanitizer to the description, comments and reviews, and leaves the input alone', () => {
  const input = page({ bodyHTML: 'D', timeline: [
    { kind: 'comment', author: user, at: 'x', bodyHTML: 'C', url: 'u' },
    { kind: 'review', author: user, at: 'x', verdict: 'approved', bodyHTML: 'R', url: 'u', comments: 0 },
    { kind: 'event', at: 'x', actor: 'a', event: 'closed' },
  ] });
  const out = html.withBodies(input, h => `[${h}]`);
  assert.strictEqual(out.bodyHTML, '[D]');
  assert.deepStrictEqual(out.timeline.map((t: Obj) => t.bodyHTML), ['[C]', '[R]', undefined]);
  assert.strictEqual(input.bodyHTML, 'D');
  assert.strictEqual(input.timeline[0].bodyHTML, 'C');
});
```

- [ ] **Step 2: Register the test** — add `"src/webviewPullDetail.test.ts"` after `"src/webviewCreate.test.ts"` in `tsconfig.json`'s `include`, and `out/webviewPullDetail.test.js` after `out/webviewCreate.test.js` in `package.json`'s `test` script.

- [ ] **Step 3: Run it to verify it fails**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.webview-shared.json && npx tsc -p tsconfig.json && node --test out/webviewPullDetail.test.js`
Expected: FAIL — `html.pullPageHtml is not a function` (the files don't exist yet).

- [ ] **Step 4: Write the webview files**

`src/webview/pullDetailTypes.ts`:

```ts
'use strict';

// Webview-side mirror of PullPage in src/pulls/pullDetailModel.ts (this bundle is `module: none`, so it cannot
// import it). The host sends exactly these shapes; keep the two files in sync by hand.

interface PullUser { login: string; avatar: string; }
type PullVerdict = 'approved' | 'changes' | 'commented' | 'dismissed';
interface PullReviewer { login: string; avatar: string; state: PullVerdict | 'pending'; }
type PullCheckState = 'success' | 'failure' | 'pending' | 'neutral';
interface PullCheck { name: string; state: PullCheckState; url: string | null; runId: number | null; description: string; }
interface PullCommit { sha: string; short: string; headline: string; author: string; at: string; url: string; }
type PullTimelineEntry =
  | { kind: 'comment'; author: PullUser; at: string; bodyHTML: string; url: string }
  | { kind: 'review'; author: PullUser; at: string; verdict: PullVerdict; bodyHTML: string; url: string; comments: number }
  | { kind: 'event'; at: string; actor: string; event: 'closed' | 'merged' | 'reopened' | 'ready' | 'draft' };

interface PullPage {
  number: number; title: string; url: string; state: 'open' | 'closed' | 'merged'; draft: boolean;
  author: PullUser; createdAt: string; bodyHTML: string;
  headRef: string; baseRef: string; fork: boolean;
  additions: number; deletions: number; changedFiles: number;
  labels: Array<{ name: string; color: string }>;
  milestone: string | null;
  assignees: PullUser[];
  reviewers: PullReviewer[];
  commits: PullCommit[]; commitTotal: number;
  timeline: PullTimelineEntry[]; timelineTotal: number;
  checkState: 'success' | 'failure' | 'pending' | 'none'; checks: PullCheck[]; checksTotal: number;
}
```

`src/webview/pullDetailHtml.ts`:

```ts
'use strict';

// Pure HTML for the pull request tab (conventions in detailHtml.ts): data in, string out, no DOM. Every
// host-supplied string goes through escapeHtml except `bodyHTML`, which GitHub renders and the caller sanitizes
// first (withBodies). Reuses avatarHtml / eventLabelChips from detailHtml.ts; every name here starts with `pull`
// because all webview files share one global scope.

type PullStateKey = 'open' | 'draft' | 'merged' | 'closed';

const PULL_STATE_TEXT: Record<PullStateKey, string> = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' };
const PULL_STATE_ICON: Record<PullStateKey, string> = {
  open: 'git-pull-request', draft: 'git-pull-request-draft', merged: 'git-merge', closed: 'git-pull-request-closed',
};
const PULL_STATE_TONE: Record<PullStateKey, string> = {
  open: 'state-open', draft: 'state-not-planned', merged: 'state-completed', closed: 'state-closed',
};
const PULL_REVIEW_TEXT: Record<PullVerdict, string> = {
  approved: 'approved these changes', changes: 'requested changes', commented: 'reviewed', dismissed: 'had their review dismissed',
};
const PULL_REVIEW_ICON: Record<PullVerdict, string> = { approved: 'check', changes: 'x', commented: 'comment', dismissed: 'skip' };
const PULL_VERDICT_TITLE: Record<PullVerdict | 'pending', string> = {
  approved: 'Approved', changes: 'Changes requested', commented: 'Commented', dismissed: 'Review dismissed', pending: 'Review requested',
};
const PULL_EVENT_PARTS: Record<'closed' | 'merged' | 'reopened' | 'ready' | 'draft', { icon: string; tone: string; text: string }> = {
  closed: { icon: 'git-pull-request-closed', tone: 'state-closed', text: 'closed this' },
  merged: { icon: 'git-merge', tone: 'state-completed', text: 'merged this' },
  reopened: { icon: 'issue-reopened', tone: 'state-open', text: 'reopened this' },
  ready: { icon: 'git-pull-request', tone: 'state-open', text: 'marked this as ready for review' },
  draft: { icon: 'git-pull-request-draft', tone: '', text: 'converted this to a draft' },
};
const PULL_CHECK_TEXT: Record<PullCheckState, string> = {
  failure: 'failing', pending: 'in progress', success: 'successful', neutral: 'skipped',
};

const pullAsUser = (u: PullUser): GithubUser => ({ login: u.login, avatar_url: u.avatar });
const pullPlural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function pullStateKey(p: PullPage): PullStateKey {
  return p.state === 'open' && p.draft ? 'draft' : p.state;
}

function pullHeaderHtml(p: PullPage): string {
  const key = pullStateKey(p);
  const verb = p.state === 'merged' ? 'merged' : p.state === 'closed' ? 'wanted to merge' : 'wants to merge';
  return `<div class="title-row">
      <h1 class="title">${escapeHtml(p.title)} <span class="number">#${p.number}</span></h1>
      <div class="title-actions">
        <button type="button" class="btn btn-secondary" data-act="checkout">${octicon('git-branch')} Check out</button>
        <button type="button" class="btn btn-secondary" data-act="open-github">${octicon('link-external')} GitHub</button>
        <button type="button" class="icon-btn" data-act="refresh" title="Refresh" aria-label="Refresh">${octicon('sync')}</button>
      </div>
    </div>
    <div class="meta-row">
      <span class="state-badge ${PULL_STATE_TONE[key]}">${octicon(PULL_STATE_ICON[key], 'state-icon')} ${PULL_STATE_TEXT[key]}</span>
      <span><b>${escapeHtml(p.author.login)}</b> ${verb} <code>${escapeHtml(p.headRef)}</code>${p.fork ? ' (from a fork)' : ''} into <code>${escapeHtml(p.baseRef)}</code></span>
      <span>· ${pullPlural(p.changedFiles, 'file')} <span class="pr-add">+${p.additions}</span> <span class="pr-del">−${p.deletions}</span></span>
    </div>`;
}

/** A card with the author's avatar. `what` is fixed text from this file, never host data. */
function pullPostHtml(author: PullUser, what: string, at: string, bodyHTML: string, emptyHint: string): string {
  return `<div class="post"><div class="post-avatar">${avatarHtml(pullAsUser(author), true)}</div><div class="post-card">
      <div class="post-header"><b class="post-author">${escapeHtml(author.login)}</b><span class="post-when">${what} ${timeHtml(at)}</span></div>
      <div class="post-body">${bodyHTML || `<span class="muted">${emptyHint}</span>`}</div>
    </div></div>`;
}

function pullRailHtml(icon: string, tone: string, actor: string, text: string, at: string, link = ''): string {
  return `<div class="tl-event"><span class="tl-badge ${tone}">${octicon(icon)}</span>`
    + `<div class="tl-text"><b class="tl-actor">${escapeHtml(actor)}</b> ${text} ${timeHtml(at)}${link}</div></div>`;
}

function pullEntryHtml(e: PullTimelineEntry): string {
  if (e.kind === 'comment') return pullPostHtml(e.author, 'commented', e.at, e.bodyHTML, '');
  if (e.kind === 'event') {
    const parts = PULL_EVENT_PARTS[e.event];
    return pullRailHtml(parts.icon, parts.tone, e.actor, parts.text, e.at);
  }
  const inline = e.comments > 0 ? ` with ${pullPlural(e.comments, 'inline comment')}` : '';
  if (e.bodyHTML) return pullPostHtml(e.author, PULL_REVIEW_TEXT[e.verdict] + inline, e.at, e.bodyHTML, '');
  const link = e.url ? ` <a href="${escapeHtml(e.url)}">View</a>` : '';
  return pullRailHtml(PULL_REVIEW_ICON[e.verdict], `pr-${e.verdict}`, e.author.login, PULL_REVIEW_TEXT[e.verdict] + inline, e.at, link);
}

/** "2 failing, 1 in progress, 14 successful": only the groups that exist. */
function checkSummary(checks: PullCheck[]): string {
  return (['failure', 'pending', 'success', 'neutral'] as PullCheckState[])
    .map(s => ({ n: checks.filter(c => c.state === s).length, text: PULL_CHECK_TEXT[s] }))
    .filter(g => g.n > 0)
    .map(g => `${g.n} ${g.text}`)
    .join(', ');
}

function pullChecksHtml(p: PullPage): string {
  if (p.checks.length === 0) return '';
  const canRerun = p.checks.some(c => c.state === 'failure' && c.runId !== null);
  const rows = p.checks.map(c => `<div class="check-row">
      <span class="check-dot check-${c.state}" title="${PULL_CHECK_TEXT[c.state]}"></span>
      <span class="check-name">${escapeHtml(c.name)}</span>
      <span class="muted">${escapeHtml(c.description)}</span>
      ${c.url ? `<a class="check-link" href="${escapeHtml(c.url)}">Details</a>` : ''}
    </div>`).join('');
  const more = p.checksTotal > p.checks.length
    ? `<div class="muted check-more">Showing ${p.checks.length} of ${p.checksTotal} checks.</div>` : '';
  return `<section class="checks"><div class="checks-head"><b>Checks</b> <span class="muted">${checkSummary(p.checks)}</span>`
    + `${canRerun ? '<button type="button" class="btn btn-secondary" data-act="rerun">Re-run failed jobs</button>' : ''}</div>${rows}${more}</section>`;
}

function pullCommitsHtml(p: PullPage): string {
  if (p.commits.length === 0) return '';
  const rows = p.commits.map(c => `<div class="commit-row"><a href="${escapeHtml(c.url)}">${escapeHtml(c.headline)}</a>`
    + `<span class="muted">${escapeHtml(c.author)} · <code>${escapeHtml(c.short)}</code> · ${timeHtml(c.at)}</span></div>`).join('');
  const more = p.commitTotal > p.commits.length
    ? `<div class="muted check-more">Showing the first ${p.commits.length} of ${p.commitTotal} commits.</div>` : '';
  return `<details class="commits"><summary>${pullPlural(p.commitTotal, 'commit')}</summary>${rows}${more}</details>`;
}

function pullSideSection(title: string, body: string): string {
  return `<section class="sb-section"><div class="sb-head"><span>${title}</span></div><div class="sb-body">${body}</div></section>`;
}

function pullSidebarHtml(p: PullPage): string {
  const none = (text: string): string => `<span class="muted">${text}</span>`;
  const person = (u: PullUser): string => `<div class="sb-person">${avatarHtml(pullAsUser(u))} ${escapeHtml(u.login)}</div>`;
  const reviewers = p.reviewers.length > 0
    ? p.reviewers.map(r => `<div class="sb-person">${avatarHtml(pullAsUser(r))} ${escapeHtml(r.login)}`
      + `<span class="rv rv-${r.state}" title="${PULL_VERDICT_TITLE[r.state]}">`
      + `${r.state === 'pending' ? '<span class="muted">requested</span>' : octicon(PULL_REVIEW_ICON[r.state])}</span></div>`).join('')
    : none('No reviewers');
  return pullSideSection('Reviewers', reviewers)
    + pullSideSection('Assignees', p.assignees.length > 0 ? p.assignees.map(person).join('') : none('No one'))
    + pullSideSection('Labels', p.labels.length > 0 ? eventLabelChips(p.labels) : none('None yet'))
    + pullSideSection('Milestone', p.milestone ? `<div>${octicon('milestone')} ${escapeHtml(p.milestone)}</div>` : none('No milestone'));
}

/** The whole tab body. `p` must already have its bodies sanitized (see withBodies). */
function pullPageHtml(p: PullPage): string {
  const cut = p.timelineTotal > p.timeline.length
    ? `<div class="muted pr-foot">Showing the first ${p.timeline.length} of ${p.timelineTotal} events. `
      + `<button type="button" class="link-btn" data-act="open-github">See the rest on GitHub</button></div>` : '';
  return `<div id="page">${pullHeaderHtml(p)}<div id="layout"><div id="main">
      ${pullPostHtml(p.author, 'opened this', p.createdAt, p.bodyHTML, 'No description provided.')}
      ${pullChecksHtml(p)}${pullCommitsHtml(p)}${p.timeline.map(pullEntryHtml).join('')}${cut}
      <div class="muted pr-foot">Commenting, reviewing and merging happen on GitHub for now.
        <button type="button" class="link-btn" data-act="open-github">Open on GitHub</button></div>
    </div><aside id="sidebar">${pullSidebarHtml(p)}</aside></div></div>`;
}

/** `p` with `fn` applied to every GitHub-rendered body: the glue passes the DOMPurify + image-placeholder step. Does not mutate `p`. */
function withBodies(p: PullPage, fn: (html: string) => string): PullPage {
  return {
    ...p,
    bodyHTML: fn(p.bodyHTML),
    timeline: p.timeline.map(e => (e.kind === 'event' ? e : { ...e, bodyHTML: fn(e.bodyHTML) })),
  };
}
```

- [ ] **Step 5: Add both files to the shared test bundle** — in `tsconfig.webview-shared.json` insert `"src/webview/pullDetailTypes.ts", "src/webview/pullDetailHtml.ts",` right after `"src/webview/detailHtml.ts",`.

- [ ] **Step 6: Tighten the two loose assertions** (see the note under Step 1), then run the tests

Run: `cd extensions/null-tools && npx tsc -p tsconfig.webview-shared.json && npx tsc -p tsconfig.json && node --test out/webviewPullDetail.test.js out/webviewDetail.test.js out/webviewShared.test.js`
Expected: PASS. If `tsc` reports a duplicate or missing global, rename the clashing name in the new files (the `pull` prefix should prevent clashes) rather than editing `detailHtml.ts`.

- [ ] **Step 7: Commit**

```bash
git add extensions/null-tools/src extensions/null-tools/tsconfig.json extensions/null-tools/tsconfig.webview-shared.json extensions/null-tools/package.json
git commit -m "feat(null-tools): pull request detail HTML builders"
```

---

### Task 6: Webview glue, bundle and styles

**Files:**
- Create: `extensions/null-tools/src/webview/pullDetail.ts`
- Create: `extensions/null-tools/tsconfig.webview-pull-detail.json`
- Create: `extensions/null-tools/lib/pullDetail.css`
- Modify: `extensions/null-tools/package.json` (`compile` script)
- Create (generated): `extensions/null-tools/lib/pullDetail.js`

**Interfaces:**
- Consumes (Task 5): `pullPageHtml`, `withBodies`, `PullPage`; existing `neutralizeImagesHtml`, `escapeHtml`, global `DOMPurify`.
- Produces: the page protocol. Host → webview: `{ type: 'page'; page: PullPage }`, `{ type: 'toast'; message: string }`, `{ type: 'error'; message: string }`. Webview → host: `{ type: 'ready' | 'refresh' | 'checkout' | 'rerun' }`, `{ type: 'openExternal'; url: string }`.

- [ ] **Step 1: Write `src/webview/pullDetail.ts`**

```ts
'use strict';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
declare const DOMPurify: { sanitize(html: string): string };

(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('detail') as HTMLDivElement;
  const toastEl = document.createElement('div');
  toastEl.id = 'toast';
  toastEl.className = 'hidden';
  toastEl.setAttribute('role', 'status');
  document.body.appendChild(toastEl);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let pageUrl = '';

  const post = (message: unknown): void => vscode.postMessage(message);

  function toast(message: string): void {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 6000);
  }

  /** Replaces the whole page (a refresh is rare and small) and keeps the scroll position. */
  function render(page: PullPage): void {
    pageUrl = page.url;
    const scroll = window.scrollY;
    root.innerHTML = pullPageHtml(withBodies(page, html => DOMPurify.sanitize(neutralizeImagesHtml(html))));
    window.scrollTo(0, scroll);
  }

  root.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const placeholder = target.closest<HTMLElement>('.img-placeholder');
    if (placeholder && !placeholder.closest('a')) {
      post({ type: 'openExternal', url: placeholder.dataset.src ?? '' });
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (anchor) {
      event.preventDefault();
      post({ type: 'openExternal', url: anchor.getAttribute('href') ?? '' }); // the host opens absolute https links only
      return;
    }
    const button = target.closest<HTMLElement>('[data-act]');
    switch (button?.dataset.act) {
      case 'checkout': post({ type: 'checkout' }); break;
      case 'refresh': post({ type: 'refresh' }); break;
      case 'open-github': post({ type: 'openExternal', url: pageUrl }); break;
      case 'rerun':
        (button as HTMLButtonElement).disabled = true; // the host answers with a toast and a fresh page
        post({ type: 'rerun' });
        break;
    }
  });

  window.addEventListener('message', event => {
    const msg = event.data as { type: string; page?: PullPage; message?: string };
    if (msg.type === 'page' && msg.page) render(msg.page);
    else if (msg.type === 'toast' && msg.message) toast(msg.message);
    else if (msg.type === 'error') root.innerHTML = `<div id="empty">${escapeHtml(msg.message ?? 'Could not load this pull request.')}</div>`;
  });

  post({ type: 'ready' });
})();
```

- [ ] **Step 2: Write `tsconfig.webview-pull-detail.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "none",
    "lib": ["ES2017", "DOM"],
    "outFile": "./lib/pullDetail.js",
    "strict": true,
    "sourceMap": false,
    "skipLibCheck": true
  },
  "include": [
    "src/webview/shared/octicons.ts", "src/webview/shared/time.ts", "src/webview/shared/labels.ts", "src/webview/shared/issueState.ts",
    "src/webview/shared/dom.ts", "src/webview/shared/picker.ts",
    "src/webview/detailTypes.ts", "src/webview/detailHtml.ts",
    "src/webview/pullDetailTypes.ts", "src/webview/pullDetailHtml.ts", "src/webview/pullDetail.ts"
  ]
}
```

- [ ] **Step 3: Add it to `compile`** — in `package.json`'s `compile` script append ` && tsc -p tsconfig.webview-pull-detail.json` after `tsc -p tsconfig.webview-commit-graph.json`.

- [ ] **Step 4: Build the bundle**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.webview-pull-detail.json`
Expected: PASS and `lib/pullDetail.js` exists. If `tsc` says a function from another webview file is missing (for example from `detailSidebarHtml.ts` or `issueState.ts`), add that file to this `include` in the same order the issue-detail config uses; do not copy code.

- [ ] **Step 5: Write `lib/pullDetail.css`**

```css
/* Pull request tab. Layout, posts, the timeline rail, the sidebar, buttons and the toast come from issueDetail.css;
   tokens, the state badge and labels from issues.css. Only what a pull request adds is here. */

.state-badge.state-closed { background:var(--vscode-charts-red); }
.tl-badge.state-closed, .tl-badge.pr-changes { color:var(--vscode-charts-red); }
.tl-badge.pr-approved { color:var(--gh-open); }
.pr-add { color:var(--vscode-charts-green); }
.pr-del { color:var(--vscode-charts-red); }
.pr-foot { margin:16px 0 0 52px; }

.checks, .commits { margin:0 0 16px 52px; border:1px solid var(--vscode-widget-border,rgba(128,128,128,.3)); border-radius:6px; }
.checks-head {
  display:flex; align-items:center; gap:8px; padding:6px 8px 6px 12px;
  background:color-mix(in srgb, var(--vscode-foreground) 6%, transparent); border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.3));
}
.checks-head .btn { margin-left:auto; }
.check-row { display:flex; align-items:center; gap:8px; padding:6px 12px; }
.check-row + .check-row, .commit-row { border-top:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); }
.check-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
.check-success { background:var(--vscode-charts-green); }
.check-failure { background:var(--vscode-charts-red); }
.check-pending { background:var(--vscode-charts-yellow); }
.check-neutral { background:var(--gh-neutral); }
.check-name { font-weight:600; }
.check-link, .commit-row a { color:var(--vscode-textLink-foreground); text-decoration:none; }
.check-link { margin-left:auto; }
.check-link:hover, .commit-row a:hover { text-decoration:underline; }
.check-more { padding:6px 12px; }
.commits > summary { cursor:pointer; padding:6px 12px; font-weight:600; }
.commit-row { display:flex; flex-direction:column; padding:6px 12px; }

#sidebar .sb-person { width:100%; }
.rv { margin-left:auto; display:inline-flex; }
.rv-approved { color:var(--gh-open); }
.rv-changes { color:var(--vscode-charts-red); }
```

- [ ] **Step 6: Run the unit tests**

Run: `cd extensions/null-tools && npm test`
Expected: PASS.

- [ ] **Step 7: Commit** (the generated `lib/pullDetail.js` is tracked, like the other bundles)

```bash
git add extensions/null-tools/src/webview extensions/null-tools/tsconfig.webview-pull-detail.json extensions/null-tools/lib/pullDetail.css extensions/null-tools/lib/pullDetail.js extensions/null-tools/package.json
git commit -m "feat(null-tools): pull request detail webview bundle"
```

---

### Task 7: The detail panel and its entry points

**Files:**
- Create: `extensions/null-tools/src/pulls/pullDetailPanel.ts`
- Modify: `extensions/null-tools/src/pulls/pullsIntegration.ts` (command)
- Modify: `extensions/null-tools/package.json` (command, inline action, context menu, palette)
- Modify: `extensions/null-tools/src/test/suite/pulls.spec.ts`

**Interfaces:**
- Consumes: `fetchPullPage`, `rerunFailedRuns` (Task 4); `failedRunIds`, `safeExternalUrl`, `PullPage` (Task 3); `PullSummary`, `describeFailure`; `tree.context()` (Task 2); the command `null.pulls.checkout` taking a `PullNode`.
- Produces: `PullDetailPanel.show(extensionUri: vscode.Uri, repo: { owner: string; repo: string }, pull: PullSummary): void`; command `null.pulls.openDetail` (argument: a `pull` `PullNode`).

- [ ] **Step 1: Write `src/pulls/pullDetailPanel.ts`**

```ts
'use strict';

import * as vscode from 'vscode';
import { getGithubSession } from '../github/githubAuth';
import { getNonce } from '../webviewUtils';
import { fetchPullPage, rerunFailedRuns } from './pullDetailApi';
import { PullPage, failedRunIds, safeExternalUrl } from './pullDetailModel';
import { PullSummary, describeFailure } from './pullModel';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'checkout' }
  | { type: 'rerun' }
  | { type: 'openExternal'; url: string };

/** A tab that regains focus after this long reloads its pull request. */
const STALE_MS = 60_000;

const shortTitle = (title: string): string => (title.length > 32 ? `${title.slice(0, 31)}…` : title);

export class PullDetailPanel {
  /** One tab per pull request, so opening one that already has a tab just focuses it. */
  private static readonly byNumber = new Map<number, PullDetailPanel>();

  static show(extensionUri: vscode.Uri, repo: { owner: string; repo: string }, pull: PullSummary): void {
    const existing = PullDetailPanel.byNumber.get(pull.number);
    if (existing) existing.panel.reveal();
    else new PullDetailPanel(extensionUri, repo, pull);
  }

  private readonly panel: vscode.WebviewPanel;
  private page: PullPage | null = null;
  private loadedAt = 0;
  private disposed = false;

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly repo: { owner: string; repo: string },
    private readonly pull: PullSummary,
  ) {
    this.panel = vscode.window.createWebviewPanel('null-tools.pullDetail', `#${pull.number}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'lib')],
    });
    this.panel.iconPath = {
      light: vscode.Uri.joinPath(extensionUri, 'media', 'github-issues.svg'),
      dark: vscode.Uri.joinPath(extensionUri, 'media', 'github-issues-dark.svg'),
    };
    this.panel.webview.html = this.buildHtml();
    this.panel.webview.onDidReceiveMessage((msg: InboundMessage) => void this.handle(msg));
    this.panel.onDidChangeViewState(e => {
      if (e.webviewPanel.active && this.page && Date.now() - this.loadedAt > STALE_MS) void this.load();
    });
    this.panel.onDidDispose(() => {
      this.disposed = true;
      PullDetailPanel.byNumber.delete(pull.number);
    });
    PullDetailPanel.byNumber.set(pull.number, this);
  }

  private post(message: unknown): void {
    if (!this.disposed) void this.panel.webview.postMessage(message); // a reply can outlive its tab
  }

  /** Fetches the page and sends it. A failed refresh of a page already on screen is a toast, not a blank tab. */
  private async load(): Promise<void> {
    try {
      const session = await getGithubSession(false);
      const page = await fetchPullPage(this.repo.owner, this.repo.repo, this.pull.number, session?.accessToken ?? null);
      this.page = page;
      this.loadedAt = Date.now();
      this.panel.title = `#${page.number} ${shortTitle(page.title)}`;
      this.post({ type: 'page', page });
    } catch (err) {
      this.post({ type: this.page ? 'toast' : 'error', message: describeFailure(err) });
    }
  }

  private async rerun(): Promise<void> {
    // The run ids come from the page this host loaded; the webview sends none.
    const ids = this.page ? failedRunIds(this.page.checks) : [];
    if (ids.length === 0) return;
    const session = await getGithubSession(true);
    if (!session) {
      this.post({ type: 'toast', message: 'Sign in to GitHub to re-run jobs.' });
    } else {
      const { started, errors } = await rerunFailedRuns(this.repo.owner, this.repo.repo, ids, session.accessToken);
      const startedText = started > 0 ? `Re-running the failed jobs of ${started} workflow run${started === 1 ? '' : 's'}.` : '';
      this.post({ type: 'toast', message: [startedText, ...errors].filter(Boolean).join(' ') });
    }
    await this.load(); // also re-enables the button
  }

  private async handle(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        await this.load();
        break;
      case 'checkout':
        // The tree owns checkout (progress, branch naming, moving the ● marker).
        void vscode.commands.executeCommand('null.pulls.checkout', { kind: 'pull', pull: this.pull });
        break;
      case 'rerun':
        await this.rerun();
        break;
      case 'openExternal': {
        const url = safeExternalUrl(msg.url);
        if (url) void vscode.env.openExternal(vscode.Uri.parse(url));
        break;
      }
    }
  }

  private buildHtml(): string {
    const nonce = getNonce();
    const asUri = (file: string): vscode.Uri => this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', file));
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; img-src ${this.panel.webview.cspSource} https://avatars.githubusercontent.com;">
<link rel="stylesheet" href="${asUri('issues.css')}">
<link rel="stylesheet" href="${asUri('issueDetail.css')}">
<link rel="stylesheet" href="${asUri('pullDetail.css')}">
</head><body>
<div id="detail"><div id="empty">Loading…</div></div>
<script nonce="${nonce}" src="${asUri('purify.min.js')}"></script>
<script nonce="${nonce}" src="${asUri('pullDetail.js')}"></script>
</body></html>`;
  }
}
```
- [ ] **Step 2: Register the command** — in `pullsIntegration.ts` import `{ PullDetailPanel } from './pullDetailPanel'` and add to the subscriptions:

```ts
    vscode.commands.registerCommand('null.pulls.openDetail', (node: PullNode) => {
      const ctx = tree.context();
      if (node.kind === 'pull' && ctx) PullDetailPanel.show(context.extensionUri, ctx.repo, node.pull);
    }),
```

- [ ] **Step 3: Contribute it** — in `package.json`:

commands: `{ "command": "null.pulls.openDetail", "title": "Null: Open Pull Request Details", "icon": "$(open-preview)" },`

`view/item/context` (before the existing `null.pulls.checkout` inline entry, so it is the first icon):
```json
        { "command": "null.pulls.openDetail", "when": "view == null.pullsView && viewItem == pull", "group": "inline@0" },
        { "command": "null.pulls.openDetail", "when": "view == null.pullsView && viewItem == pull", "group": "1_pull@0" },
```
`commandPalette` (next to the other `"when": "false"` entries): `{ "command": "null.pulls.openDetail", "when": "false" },`

- [ ] **Step 4: Update the integration spec** — add `'null.pulls.openDetail'` to the command list in `pulls.spec.ts`.

- [ ] **Step 5: Build**

Run: `cd extensions/null-tools && npm run compile && npm test`
Expected: PASS (clean compile, including the pull-detail bundle; all tests green).

- [ ] **Step 6: Commit**

```bash
git add extensions/null-tools/src extensions/null-tools/package.json extensions/null-tools/lib/pullDetail.js
git commit -m "feat(null-tools): pull request detail tab with checks and re-run"
```

---

### Task 8: Verify in the real app, document, refresh output

**Files:**
- Modify: `extensions/null-tools/CLAUDE.md` (extend the Pull Requests row)
- Modify: `docs/specs/pull-requests-design.md` (Phase 2 plan link, decisions 17–23, Phase 2 limits)
- Modify: `extensions/null-tools/out/**` (compiled, via `npm run compile`)

- [ ] **Step 1: Verify in the real app** — run the `/verify-local` skill for `null-tools` (it syncs into the installed Null IDE and reloads; `sync-local.ps1` copies `lib/`, so `pullDetail.js` and `pullDetail.css` arrive with it), open a folder whose `origin` is a GitHub repo with open, merged and closed PRs, ideally one with failing Actions checks you may re-run, then check each:

1. **Filter button** in the Pull Requests title bar (next to refresh). *Apply* with no change keeps the list. State → Merged: only merged PRs, purple merge icon; Closed: red closed icon, no merged ones; All: everything. The view message reads e.g. `Merged · Created by me`.
2. **Mine / Review requested / Drafts** each change the list as on github.com; Label and Milestone offer GitHub's names (and *Any*); Sort → Newest / Most commented reorders.
3. **Persistence:** set a filter, reload the window, expand the view: the filter is still active. **Reset filters** (menu row, and the welcome link) returns to open PRs.
4. **Empty result:** pick a label no PR has: the *No pull requests match the filters* text appears with *Change Filters* and *Reset Filters*; the title-bar filter button is still there.
5. **Detail tab:** the `$(open-preview)` icon (and the context-menu entry) on a PR row opens a tab titled `#n title`; opening it twice focuses the same tab. It shows state badge, branches, `n files +a −d`, the description, checks (failures first, with *Details* links opening GitHub in the browser), a collapsed commit list, the conversation (comments, a review with a body as a card, a bodiless review as one row with *View*, merge/close events) and the sidebar (reviewers with verdicts, labels, milestone, assignees).
6. **Links:** a link in a description opens in the browser; a relative or `javascript:` link (edit a test PR body to include `[x](javascript:alert(1))`) does nothing.
7. **Re-run failed jobs:** on a PR whose workflow failed and has finished, the button re-runs it (toast, then the check turns pending after the reload). On a PR whose only failure is a legacy commit status, the button is absent. Pressing it while the run is still running shows GitHub's refusal text in the toast.
8. **Check out** from the tab lands on the PR branch (same toast and ● marker as from the tree). **Refresh** works; switching away and back after a minute reloads; going offline then pressing Refresh shows a toast and keeps the page.
9. **Signed out:** the tab for a PR opened before signing out shows the error text instead of a stack trace.

- [ ] **Step 2: Document the feature** — in `extensions/null-tools/CLAUDE.md`, append to the end of the **Pull Requests** table row (before the closing `|`): ` Phase 2 (`docs/plans/pull-requests-phase2-detail-checks.md`): `pullFilter.ts` (pure: filter → GitHub search `q`, kept in `workspaceState` as `null.pulls.filter`, edited by `pullFilterMenu.ts`) and a detail tab (`pullDetailPanel.ts` + `pullDetailModel.ts`/`pullDetailApi.ts`; webview bundle `lib/pullDetail.js` from `src/webview/pullDetail*.ts`, HTML builders tested through `webview-shared`). Read-only except *Re-run failed jobs*, whose run ids the host recomputes from its own page; links from the webview open only as absolute https.`

- [ ] **Step 3: Update the spec** — in `docs/specs/pull-requests-design.md`: set the Phase 2 row's Plan cell to `docs/plans/pull-requests-phase2-detail-checks.md`; append decisions 17–23 from the top of this plan to the *Decisions* list; and add a *Known limits of Phase 2* list: first 100 commits / conversation items / checks (page says so); first 100 labels and milestones in the filter pickers; filter facets are AND-only (no free-text search, one label, one milestone); no inline review threads on the detail page; no PR-level comment composer (not in any phase — add one to Phase 3 if wanted).

- [ ] **Step 4: Refresh compiled output, update the graph, commit**

```bash
cd extensions/null-tools && npm run compile && cd ../..
graphify update .
git add extensions/null-tools/CLAUDE.md docs/specs/pull-requests-design.md
git commit -m "docs(null-tools): document pull request detail and filters"
git add extensions/null-tools/out extensions/null-tools/lib
git commit -m "chore: refresh null-tools compiled output"
```

(If `git status` shows nothing to commit for the second command, `out/` and `lib/` were already committed by the earlier tasks; skip it.) After this task run `/wiki-sync` as a separate step (a new command, two settings-less views and a new tab are user-facing).

- [ ] **Step 5: Close the loop on GitHub** — comment on #117 "Phase 2 shipped (detail tab, checks, filters): `docs/plans/pull-requests-phase2-detail-checks.md`; phases 3–6 remain" and keep it open. (Ask first: this is outward-facing.)

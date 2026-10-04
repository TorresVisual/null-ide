# GitHub Issues Panel v2, Phase 2 (List): Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Replace the v1 issue list (100-issue REST fetch, client-side filtering, full `innerHTML` rebuild on every keystroke) with a github.com-style list: search syntax, Open/Closed counts, filter dropdowns, sort, presets, paging, instant local filtering, a full-width tab next to the compact sidebar, and keyboard navigation.

**Architecture:** The search string is the single source of truth. Pure `searchQuery.ts` edits it; `IssuesStore.search()` sends it to GitHub's GraphQL `search` and maps the page into the existing REST-shaped `GithubIssue`, so the detail tab, prompt copy and branch actions keep working untouched. A new `IssuesListController` binds one query, its loaded pages and a paging cursor to any `vscode.Webview`; the sidebar view and the new full tab each get one. The webview keeps rows alive across refreshes with a keyed `reconcile()`, filters the rendered rows instantly while typing, and sends a debounced search only on Enter or a 400ms pause.

**Tech Stack:** TypeScript 5.8, VS Code extension API (`^1.85.0`), vanilla DOM webviews, GitHub GraphQL API, `node:test`, CSS container queries.

**Spec:** [docs/specs/github-issues-panel-v2-design.md](../specs/github-issues-panel-v2-design.md) (this plan covers "Delivery phases → 2. List"). Phase 1 shipped in commits `2081d16`…`e587ea8`.

**Deviations from the spec's Phase 2 list** (each one is deliberate):
- `requestGraphql` lands here (Phase 1 deferred it to its first caller). `formatApiError` already handles GraphQL `errors[]`.
- `shared/picker.ts` is pulled forward from Phase 3: the filter dropdowns, the presets menu and the row `⋯` menu are its first users.
- `searchQuery.ts` stays host-only. The host sends the values to highlight (`describeQuery`) with every `results` message instead of the webview parsing the query. The webview only needs `freeTextOf` (a regex) for the instant filter.
- Paging triggers on scroll position, not an `IntersectionObserver`: the observer doesn't fire again when the sentinel is still visible after a short page.
- Ctrl+Enter / middle-click "open in a new tab" moves to Phase 3 (it needs per-issue tab tracking in `issueDetailPanel.ts`). `open{number}` has no `newTab` yet.
- The blue "updated since last seen" dot is deferred: the sidebar marks everything read whenever it is visible, so the dot would vanish immediately. Decide the watermark rule first.
- Protocol tweaks: `results` drops `totalCount` (nothing shows it); the Open/Closed tabs send `editQuery{op:'set', key:'state'}`; `status{kind:'rate-limited'}` carries `willRetry`; `init` carries `defaultQuery`.
- Newly created issues are inserted into the lists here (spec: Phase 4) because GitHub's search index lags a few seconds behind, so a refresh right after creating would not list the new issue.
- Only the default query (`is:open`) is cached for cache-first paint. The REST `fetchIssues` stays: the status-bar count and the commit-message picker still use it.
- Verified against live GitHub on 2026-10-04: every field in the Phase 2 queries exists (`issueType`, `subIssuesSummary { total completed }`, `closedByPullRequestsReferences`), `search(first: 0) { issueCount }` works for the tab counts, and `Repository.issueTypes` is **null** on repos without issue types (this one).

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Work only inside `D:\Coding\Apps\null-ide\` (CLAUDE.md scope rule). All paths below are relative to `extensions/null-tools/` unless they start with `docs/` or `CLAUDE.md`.
- Edit TypeScript sources only; never hand-edit compiled output (`out/*.js`, `lib/issues.js`, `lib/issueDetail.js`). `out/` and `lib/*.js` **are tracked in git**: after `npm run compile`, stage the compiled files that belong to the task in the same commit as their source. `git status` already shows unrelated modified `out/autoGitignore*` files: never stage those.
- Unit tests only cover files that don't `import 'vscode'` (repo convention). The main `tsconfig.json` has an explicit `include` list: every new `*.test.ts` must be added there *and* to the `test` script in `package.json`.
- Webview files are `module: none` scripts: no `import`/`export`. Top-level names share one global scope per bundle, so every top-level identifier in `src/webview/shared/` must be unique across all files in that bundle.
- No new runtime or dev dependencies. `@primer/octicons` is only downloaded into a temp dir to run the generator.
- Colors: theme variables only (`var(--vscode-*)`), no hex fallbacks in new CSS, except label colors (repo data).
- Interpolate only escaped text into webview `innerHTML`: user-controlled strings go through `escapeHtml`. `PickerItem.html` is trusted markup the caller has already escaped.
- Commit messages: conventional style (`feat(null-tools): …`), ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Don't push.
- Run all `npm`/`npx` commands from `extensions/null-tools/`.

## Review Focus

1. **Rapid query changes.** Clicking Open/Closed or typing quickly fires several searches; a slow older response must never overwrite a newer query's rows. The `seq` guard in `IssuesListController._run` is the only protection and the controller imports `vscode`, so it is checked manually in Task 7 Step 3 (toggle the tabs ten times fast; the rows must match the highlighted tab).
2. **A repo without issue types or milestones.** `Repository.issueTypes` is `null` on this very repo. Metadata must map to empty lists, and the Types/Milestones dropdowns must not render. Pinned in Task 3 Step 1 (`mapMetadata`) and checked in Task 7 Step 3.
3. **A deleted author.** GraphQL returns `author: null` for deleted accounts: the row must show "ghost", not crash the mapper. Pinned in Task 3 Step 1.
4. **Searching outside the repo.** Typing `repo:someone/private` (or `org:`/`user:`) into the box must not pull other repos' issues into a list whose actions target this repo. Pinned in Task 1 Step 1 (`toApiQuery`).
5. **Create, then refresh.** GitHub's search index lags, so an issue created a moment ago may be missing from search results. The list inserts it itself; verified in Task 7 Step 3.

---

### Task 1: Search query editing (`searchQuery.ts`)

**Files:**
- Create: `src/github/searchQuery.ts`
- Create: `src/github/searchQuery.test.ts`
- Modify: `tsconfig.json` (`include`), `package.json` (`test` script)

**Interfaces:**
- Consumes: nothing.
- Produces (all pure, string in → string out):
  - `getQualifierValues(q: string, key: string): string[]`
  - `toggleQualifier(q: string, key: string, value: string): string`
  - `setQualifier(q: string, key: string, value: string): string`
  - `removeQualifier(q: string, key: string): string`
  - `withState(q: string, state: 'open' | 'closed'): string`
  - `describeQuery(q: string, viewerLogin: string | null): QueryView` where `QueryView = { state: 'open' | 'closed' | 'all'; selected: { label: string[]; author: string[]; assignee: string[]; milestone: string[]; type: string[] }; sort: string | null }`
  - `toApiQuery(repo: string, q: string): string` (`repo` is `owner/name`)

- [ ] **Step 1: Write the failing test**

Create `src/github/searchQuery.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import {
  describeQuery, getQualifierValues, removeQualifier, setQualifier, toApiQuery, toggleQualifier, withState,
} from './searchQuery';

test('getQualifierValues unquotes values and ignores negated and other keys', () => {
  const q = 'is:open label:"good first issue" label:bug -label:wontfix assignee:octocat fix crash';
  assert.deepStrictEqual(getQualifierValues(q, 'label'), ['good first issue', 'bug']);
  assert.deepStrictEqual(getQualifierValues(q, 'LABEL'), ['good first issue', 'bug']);
  assert.deepStrictEqual(getQualifierValues(q, 'milestone'), []);
});

test('toggleQualifier adds, quotes values with spaces, and removes case-insensitively', () => {
  assert.strictEqual(toggleQualifier('is:open', 'label', 'bug'), 'is:open label:bug');
  assert.strictEqual(toggleQualifier('is:open', 'label', 'good first issue'), 'is:open label:"good first issue"');
  assert.strictEqual(toggleQualifier('is:open label:Bug', 'label', 'bug'), 'is:open');
  assert.strictEqual(toggleQualifier('label:"good first issue" x', 'label', 'good first issue'), 'x');
});

test('toggleQualifier twice is the identity', () => {
  const q = 'is:open label:ui fix';
  assert.strictEqual(toggleQualifier(toggleQualifier(q, 'label', 'bug'), 'label', 'bug'), q);
});

test('toggleQualifier leaves a negated token of the same key alone', () => {
  assert.strictEqual(toggleQualifier('-label:bug', 'label', 'bug'), '-label:bug label:bug');
});

test('setQualifier replaces every value of the key and keeps free text', () => {
  assert.strictEqual(setQualifier('is:open assignee:a assignee:b crash', 'assignee', 'c'), 'is:open crash assignee:c');
  assert.strictEqual(setQualifier('is:open', 'sort', 'updated-desc'), 'is:open sort:updated-desc');
});

test('removeQualifier drops the key but keeps negations and free text', () => {
  assert.strictEqual(
    removeQualifier('is:open label:a -label:b "exact phrase" x', 'label'),
    'is:open -label:b "exact phrase" x',
  );
});

test('withState swaps is:open / is:closed and keeps other is: filters', () => {
  assert.strictEqual(withState('is:open label:bug', 'closed'), 'is:closed label:bug');
  assert.strictEqual(withState('label:bug', 'open'), 'is:open label:bug');
  assert.strictEqual(withState('is:open is:locked', 'closed'), 'is:closed is:locked');
});

test('describeQuery reports tab, selected values (@me resolved) and sort', () => {
  const view = describeQuery('is:closed assignee:@me label:bug sort:updated-desc', 'octocat');
  assert.strictEqual(view.state, 'closed');
  assert.deepStrictEqual(view.selected.assignee, ['octocat']);
  assert.deepStrictEqual(view.selected.label, ['bug']);
  assert.strictEqual(view.sort, 'updated-desc');
  assert.strictEqual(describeQuery('', null).state, 'all');
  assert.strictEqual(describeQuery('is:open is:closed', null).state, 'all');
  assert.deepStrictEqual(describeQuery('assignee:@me', null).selected.assignee, ['@me']);
});

test('toApiQuery scopes to the repo and sorts newest-first when there is no text or sort', () => {
  assert.strictEqual(toApiQuery('o/r', 'is:open'), 'repo:o/r is:issue is:open sort:created-desc');
  assert.strictEqual(toApiQuery('o/r', 'is:open crash'), 'repo:o/r is:issue is:open crash');
  assert.strictEqual(toApiQuery('o/r', 'is:open sort:comments-desc'), 'repo:o/r is:issue is:open sort:comments-desc');
  assert.strictEqual(toApiQuery('o/r', ''), 'repo:o/r is:issue sort:created-desc');
});

test('toApiQuery drops repo:/org:/user: so the list cannot leave this repo', () => {
  assert.strictEqual(
    toApiQuery('o/r', 'repo:evil/private org:x -user:y is:open'),
    'repo:o/r is:issue is:open sort:created-desc',
  );
});
```

In `tsconfig.json`, add `"src/github/searchQuery.test.ts"` to the `include` array (after `"src/github/githubApi.test.ts"`).

In `package.json`, append ` out/github/searchQuery.test.js` to the end of the `test` script's `node --test …` file list.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsc -p tsconfig.json`
Expected: FAIL with `error TS2307: Cannot find module './searchQuery'`.

- [ ] **Step 3: Implement `searchQuery.ts`**

Create `src/github/searchQuery.ts`:

```ts
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
 * The string sent to GitHub search: the user's query scoped to this repo's issues. `repo:`/`org:`/`user:`
 * typed by the user are dropped (GitHub ORs repeated `repo:`, which would leak other repos into the list),
 * and with no free text and no `sort:` we sort newest-first like github.com instead of "best match".
 */
export function toApiQuery(repo: string, q: string): string {
  const tokens = tokenize(q).filter(t => !(t.key && ['repo', 'org', 'user'].includes(t.key)));
  const parts = [`repo:${repo}`, 'is:issue', join(tokens)];
  if (!tokens.some(t => t.key === 'sort') && !tokens.some(t => t.key === null)) parts.push('sort:created-desc');
  return parts.filter(Boolean).join(' ');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc -p tsconfig.json && node --test out/github/searchQuery.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Compile and commit**

```bash
npm run compile
git add src/github/searchQuery.ts src/github/searchQuery.test.ts tsconfig.json package.json out/github/searchQuery*
git commit -m "feat(null-tools): add search-query editing for the Issues list

Pure helpers to toggle/set/remove qualifiers in the user-visible query
string, describe it for the filter bar, and scope it to the repo for the
API (dropping any repo:/org:/user: the user typed).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: GraphQL transport (`requestGraphql`, `ApiError`, rate-limit retry time)

**Files:**
- Modify: `src/github/githubApi.ts` (imports, and `requestJson` at lines 28-61)
- Modify: `src/github/githubApi.test.ts`

**Interfaces:**
- Consumes: `formatApiError` (Phase 1).
- Produces:
  - `export class ApiError extends Error { constructor(message: string, readonly status: number, readonly retryAt: number | null = null) }`. `retryAt` is an epoch-ms time. Every non-2xx response from `requestJson` now rejects with an `ApiError` (still an `Error`, same message as before).
  - `export function rateLimitRetryAt(headers: IncomingHttpHeaders, now?: number): number | null`
  - `export async function requestGraphql<T>(query: string, variables: Record<string, unknown>, token: string | null): Promise<T>`. Resolves to `data`; rejects (`ApiError`) on HTTP errors and on any `errors[]`, even when partial `data` came back.

- [ ] **Step 1: Write the failing tests**

In `src/github/githubApi.test.ts`, replace the three import lines at the top:

```ts
import assert from 'node:assert';
import test from 'node:test';
import { formatApiError } from './githubApi';
```

with:

```ts
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import test, { afterEach, mock } from 'node:test';
import { ApiError, formatApiError, rateLimitRetryAt, requestGraphql } from './githubApi';

afterEach(() => mock.restoreAll());
```

and append to the end of the file:

```ts
/** Makes https.request answer with a canned response, so requestGraphql can be tested without the network. */
function stubGitHub(status: number, body: string, headers: Record<string, string> = {}): void {
  mock.method(https, 'request', (_url: unknown, _opts: unknown, onResponse: (res: unknown) => void) => {
    const req = Object.assign(new EventEmitter(), {
      setTimeout() {}, write() {}, destroy() {},
      end() {
        const res = Object.assign(new EventEmitter(), { statusCode: status, headers, setEncoding() {} });
        onResponse(res);
        res.emit('data', body);
        res.emit('end');
      },
    });
    return req;
  });
}

test('requestGraphql resolves to data', async () => {
  stubGitHub(200, JSON.stringify({ data: { viewer: { login: 'octocat' } } }));
  assert.deepStrictEqual(await requestGraphql('query{viewer{login}}', {}, 't'), { viewer: { login: 'octocat' } });
});

test('requestGraphql rejects on errors[] even when partial data came back', async () => {
  stubGitHub(200, JSON.stringify({ data: { viewer: null }, errors: [{ message: "Field 'foo' doesn't exist" }] }));
  await assert.rejects(requestGraphql('q', {}, 't'), (err: Error) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.message, "GitHub API error: Field 'foo' doesn't exist");
    return true;
  });
});

test('requestGraphql: a rate-limit error carries when to retry', async () => {
  stubGitHub(200, JSON.stringify({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }), {
    'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000',
  });
  await assert.rejects(requestGraphql('q', {}, 't'), (err: ApiError) => err.retryAt === 1800000000 * 1000);
});

test('requestGraphql: a 401 is an ApiError with its status and no retry time', async () => {
  stubGitHub(401, JSON.stringify({ message: 'Bad credentials' }));
  await assert.rejects(requestGraphql('q', {}, 't'), (err: ApiError) =>
    err.status === 401 && err.retryAt === null && err.message === 'GitHub API 401: Bad credentials');
});

test('requestGraphql: a secondary rate limit (403 + retry-after) carries a retry time', async () => {
  stubGitHub(403, JSON.stringify({ message: 'You have exceeded a secondary rate limit' }), { 'retry-after': '30' });
  const before = Date.now();
  await assert.rejects(requestGraphql('q', {}, 't'), (err: ApiError) =>
    err.retryAt !== null && err.retryAt >= before + 30000 && err.retryAt < before + 31000);
});

test('rateLimitRetryAt: Retry-After wins, then the reset time, else null', () => {
  assert.strictEqual(rateLimitRetryAt({ 'retry-after': '60' }, 1000), 61000);
  assert.strictEqual(rateLimitRetryAt({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000' }), 2000000);
  assert.strictEqual(rateLimitRetryAt({ 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': '2000' }), null);
  assert.strictEqual(rateLimitRetryAt({}), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc -p tsconfig.json`
Expected: FAIL with `error TS2305: Module '"./githubApi"' has no exported member 'ApiError'` (and the same for `rateLimitRetryAt`, `requestGraphql`).

- [ ] **Step 3: Implement the transport**

In `src/github/githubApi.ts`, add below the `import * as https from 'https';` line:

```ts
import type { IncomingHttpHeaders } from 'http';
```

Then replace the whole `requestJson` function (from `function requestJson<T>(` through its closing `}`, right before the `// ponytail: single page, 100 issues max` comment) with:

```ts
/** A failed GitHub call. `retryAt` (epoch ms) is set when GitHub says to wait before retrying. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryAt: number | null = null) {
    super(message);
  }
}

/** When a rate-limited request may be retried: `Retry-After` wins, else the primary limit's reset time. */
export function rateLimitRetryAt(headers: IncomingHttpHeaders, now: number = Date.now()): number | null {
  const retryAfter = Number(headers['retry-after']);
  if (retryAfter > 0) return now + retryAfter * 1000;
  const reset = Number(headers['x-ratelimit-reset']);
  return headers['x-ratelimit-remaining'] === '0' && reset > 0 ? reset * 1000 : null;
}

interface RawResponse { status: number; headers: IncomingHttpHeaders; body: string }

function request(
  path: string, token: string | null, method: 'GET' | 'PATCH' | 'POST' | 'DELETE', body?: unknown,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Null-IDE',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    if (payload) headers['Content-Type'] = 'application/json';

    const req = https.request(`https://api.github.com${path}`, { method, headers }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('GitHub API request timed out')));
    if (payload) req.write(payload);
    req.end();
  });
}

function failure(res: RawResponse): ApiError {
  const limited = res.status === 403 || res.status === 429;
  return new ApiError(formatApiError(res.status, res.body), res.status, limited ? rateLimitRetryAt(res.headers) : null);
}

async function requestJson<T>(
  path: string, token: string | null, method: 'GET' | 'PATCH' | 'POST' | 'DELETE' = 'GET', body?: unknown,
): Promise<T> {
  const res = await request(path, token, method, body);
  if (res.status < 200 || res.status >= 300) throw failure(res);
  return (res.body ? JSON.parse(res.body) : undefined) as T;
}

/** POST /graphql. Resolves to `data`; rejects on HTTP errors and on any GraphQL `errors[]`, even with partial data. */
export async function requestGraphql<T>(
  query: string, variables: Record<string, unknown>, token: string | null,
): Promise<T> {
  const res = await request('/graphql', token, 'POST', { query, variables });
  if (res.status < 200 || res.status >= 300) throw failure(res);
  const parsed = JSON.parse(res.body) as { data?: T; errors?: unknown[] };
  // A half-filled list is worse than an error, so partial data next to errors[] is dropped.
  if (parsed.errors?.length || !parsed.data) {
    throw new ApiError(formatApiError(res.status, res.body), res.status, rateLimitRetryAt(res.headers));
  }
  return parsed.data;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc -p tsconfig.json && node --test out/github/githubApi.test.js`
Expected: PASS, 13 tests (7 existing + 6 new). Then `npm test`: all pass.

- [ ] **Step 5: Compile and commit**

```bash
npm run compile
git add src/github/githubApi.ts src/github/githubApi.test.ts out/github/githubApi*
git commit -m "feat(null-tools): add GraphQL transport and rate-limit retry time

requestGraphql rejects on any errors[] (partial data is never shown).
Failures are ApiError with the HTTP status and, for 403/429 or a GraphQL
rate-limit error, the time GitHub says to retry at.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: List queries and mappers (`githubQueries.ts`)

**Files:**
- Create: `src/github/githubQueries.ts`
- Create: `src/github/githubQueries.test.ts`
- Modify: `src/github/types.ts`
- Modify: `tsconfig.json` (`include`), `package.json` (`test` script)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `SEARCH_ISSUES`, `REPO_METADATA`: GraphQL query strings. `SEARCH_ISSUES` variables: `{ q, qOpen, qClosed: string; first: number; after: string | null; withCounts: boolean }`. `REPO_METADATA` variables: `{ owner, name: string }`.
  - `SearchData`, `MetadataData`: response shapes (exported for `requestGraphql<…>`).
  - `mapSearchPage(data: SearchData): SearchPage`, `mapMetadata(data: MetadataData): RepoMetadata`.
  - In `types.ts`: `GithubLabel.description?`, `GithubIssue` gains optional `created_at`, `closed_at`, `milestone`, `issue_type`, `sub_issues`, `linked_prs`; `state_reason` gains `'duplicate'`; new `RepoMetadata` and `SearchPage`.

- [ ] **Step 1: Write the failing test**

Create `src/github/githubQueries.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { MetadataData, SearchData, mapMetadata, mapSearchPage } from './githubQueries';

const issueNode = (over: Record<string, unknown> = {}) => ({
  number: 7, title: 'Crash on start', body: 'It crashes', state: 'OPEN', stateReason: null,
  url: 'https://github.com/o/r/issues/7', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z',
  closedAt: null, author: { login: 'octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' },
  labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
  assignees: { nodes: [{ login: 'hubot', avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4' }] },
  comments: { totalCount: 3 }, milestone: { number: 2, title: 'v1.0' }, issueType: { name: 'Bug' },
  subIssuesSummary: { total: 3, completed: 1 }, closedByPullRequestsReferences: { totalCount: 1 },
  ...over,
});

const page = (nodes: unknown[], extra: Record<string, unknown> = {}): SearchData => ({
  search: { pageInfo: { hasNextPage: true, endCursor: 'abc' }, nodes },
  ...extra,
} as SearchData);

test('mapSearchPage maps an open issue to the REST-shaped GithubIssue the rest of the extension uses', () => {
  const result = mapSearchPage(page([issueNode()], { open: { issueCount: 52 }, closed: { issueCount: 58 } }));
  assert.deepStrictEqual(result.items[0], {
    number: 7, title: 'Crash on start', body: 'It crashes', state: 'open', state_reason: null,
    html_url: 'https://github.com/o/r/issues/7',
    labels: [{ name: 'bug', color: 'd73a4a' }],
    assignees: [{ login: 'hubot', avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4' }],
    user: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
    comments: 3, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-02T10:00:00Z', closed_at: null,
    milestone: { number: 2, title: 'v1.0' }, issue_type: 'Bug', sub_issues: { total: 3, completed: 1 }, linked_prs: 1,
  });
  assert.strictEqual(result.hasMore, true);
  assert.strictEqual(result.cursor, 'abc');
  assert.strictEqual(result.openCount, 52);
  assert.strictEqual(result.closedCount, 58);
});

test('mapSearchPage lowercases state and stateReason', () => {
  const closed = mapSearchPage(page([issueNode({ state: 'CLOSED', stateReason: 'NOT_PLANNED', closedAt: '2026-10-03T00:00:00Z' })]));
  assert.strictEqual(closed.items[0].state, 'closed');
  assert.strictEqual(closed.items[0].state_reason, 'not_planned');
  assert.strictEqual(closed.items[0].closed_at, '2026-10-03T00:00:00Z');
});

test('mapSearchPage tolerates a deleted author, null body, missing optional blocks, and zero sub-issues', () => {
  const [issue] = mapSearchPage(page([issueNode({
    author: null, body: null, milestone: null, issueType: null,
    subIssuesSummary: { total: 0, completed: 0 }, closedByPullRequestsReferences: null,
  })])).items;
  assert.deepStrictEqual(issue.user, { login: 'ghost', avatar_url: '' });
  assert.strictEqual(issue.body, '');
  assert.strictEqual(issue.milestone, null);
  assert.strictEqual(issue.issue_type, null);
  assert.strictEqual(issue.sub_issues, null);
  assert.strictEqual(issue.linked_prs, 0);
});

test('mapSearchPage skips non-issue search nodes and reports null counts when none were requested', () => {
  const result = mapSearchPage(page([{}, issueNode()]));
  assert.deepStrictEqual(result.items.map(i => i.number), [7]);
  assert.strictEqual(result.openCount, null);
  assert.strictEqual(result.closedCount, null);
});

test('mapMetadata handles a repo without issue types (issueTypes: null)', () => {
  const data: MetadataData = {
    viewer: { login: 'octocat' },
    repository: {
      labels: { nodes: [{ name: 'bug', color: 'd73a4a', description: 'Something isn\'t working' }] },
      assignableUsers: { nodes: [{ login: 'octocat', avatarUrl: 'https://a/u/1' }] },
      milestones: { nodes: [{ number: 2, title: 'v1.0' }] },
      issueTypes: null,
    },
  };
  assert.deepStrictEqual(mapMetadata(data), {
    labels: [{ name: 'bug', color: 'd73a4a', description: 'Something isn\'t working' }],
    assignees: [{ login: 'octocat', avatar_url: 'https://a/u/1' }],
    milestones: [{ number: 2, title: 'v1.0' }],
    issueTypes: [],
    viewerLogin: 'octocat',
  });
});
```

In `tsconfig.json`, add `"src/github/githubQueries.test.ts"` to `include`. In `package.json`, append ` out/github/githubQueries.test.js` to the `test` script's file list.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsc -p tsconfig.json`
Expected: FAIL with `error TS2307: Cannot find module './githubQueries'`.

- [ ] **Step 3: Extend `types.ts`**

In `src/github/types.ts`:

Replace

```ts
export interface GithubLabel {
  name: string;
  color: string;
}
```

with

```ts
export interface GithubLabel {
  name: string;
  color: string;
  /** Only present on labels from the repo metadata query. */
  description?: string | null;
}
```

In `GithubIssue`, change `state_reason?: 'completed' | 'not_planned' | 'reopened' | null;` to `state_reason?: 'completed' | 'not_planned' | 'reopened' | 'duplicate' | null;`, and replace

```ts
  comments: number;
  updated_at: string;
  pull_request?: unknown;
```

with

```ts
  comments: number;
  /** The fields below come from the GraphQL list query; REST-fetched issues lack them. */
  created_at?: string;
  updated_at: string;
  closed_at?: string | null;
  milestone?: { number: number; title: string } | null;
  issue_type?: string | null;
  sub_issues?: { total: number; completed: number } | null;
  linked_prs?: number;
  pull_request?: unknown;
```

Append to the end of the file:

```ts

export interface RepoMetadata {
  labels: GithubLabel[];
  assignees: GithubUser[];
  milestones: Array<{ number: number; title: string }>;
  issueTypes: Array<{ id: string; name: string }>;
  viewerLogin: string;
}

export interface SearchPage {
  items: GithubIssue[];
  hasMore: boolean;
  cursor: string | null;
  /** Null when the request skipped the count aliases (every page after the first). */
  openCount: number | null;
  closedCount: number | null;
}
```

- [ ] **Step 4: Implement `githubQueries.ts`**

Create `src/github/githubQueries.ts`:

```ts
'use strict';

import { GithubIssue, RepoMetadata, SearchPage } from './types';

const LIST_ISSUE_FIELDS = `
  number title body state stateReason url createdAt updatedAt closedAt
  author { login avatarUrl }
  labels(first: 20) { nodes { name color } }
  assignees(first: 5) { nodes { login avatarUrl } }
  comments { totalCount }
  milestone { number title }
  issueType { name }
  subIssuesSummary { total completed }
  closedByPullRequestsReferences(first: 1) { totalCount }
`;

/** One page of the issue list plus (on the first page only) the Open/Closed tab counts. */
export const SEARCH_ISSUES = `
query SearchIssues($q: String!, $qOpen: String!, $qClosed: String!, $first: Int!, $after: String, $withCounts: Boolean!) {
  search(query: $q, type: ISSUE, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on Issue { ${LIST_ISSUE_FIELDS} } }
  }
  open: search(query: $qOpen, type: ISSUE, first: 0) @include(if: $withCounts) { issueCount }
  closed: search(query: $qClosed, type: ISSUE, first: 0) @include(if: $withCounts) { issueCount }
}`;

/** Everything the filter dropdowns offer. `issueTypes` is null on repos (e.g. user-owned) without issue types. */
export const REPO_METADATA = `
query RepoMetadata($owner: String!, $name: String!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    labels(first: 100, orderBy: { field: NAME, direction: ASC }) { nodes { name color description } }
    assignableUsers(first: 100) { nodes { login avatarUrl } }
    milestones(first: 50, states: OPEN, orderBy: { field: DUE_DATE, direction: ASC }) { nodes { number title } }
    issueTypes(first: 25) { nodes { id name } }
  }
}`;

interface GqlUser { login: string; avatarUrl: string }
interface GqlIssue {
  number: number; title: string; body: string | null; state: 'OPEN' | 'CLOSED'; stateReason: string | null; url: string;
  createdAt: string; updatedAt: string; closedAt: string | null; author: GqlUser | null;
  labels: { nodes: Array<{ name: string; color: string }> };
  assignees: { nodes: GqlUser[] };
  comments: { totalCount: number };
  milestone: { number: number; title: string } | null;
  issueType: { name: string } | null;
  subIssuesSummary: { total: number; completed: number } | null;
  closedByPullRequestsReferences: { totalCount: number } | null;
}
export interface SearchData {
  search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<GqlIssue | Record<string, never>> };
  open?: { issueCount: number };
  closed?: { issueCount: number };
}
export interface MetadataData {
  viewer: { login: string };
  repository: {
    labels: { nodes: Array<{ name: string; color: string; description: string | null }> };
    assignableUsers: { nodes: GqlUser[] };
    milestones: { nodes: Array<{ number: number; title: string }> };
    issueTypes: { nodes: Array<{ id: string; name: string }> } | null;
  };
}

const toUser = (u: GqlUser): { login: string; avatar_url: string } => ({ login: u.login, avatar_url: u.avatarUrl });

/** A deleted account has no author; GitHub shows "ghost", so do we. */
const GHOST = { login: 'ghost', avatar_url: '' };

function mapIssue(n: GqlIssue): GithubIssue {
  const sub = n.subIssuesSummary;
  return {
    number: n.number,
    title: n.title,
    body: n.body ?? '',
    state: n.state === 'OPEN' ? 'open' : 'closed',
    state_reason: n.stateReason ? (n.stateReason.toLowerCase() as GithubIssue['state_reason']) : null,
    html_url: n.url,
    labels: n.labels.nodes.map(l => ({ name: l.name, color: l.color })),
    assignees: n.assignees.nodes.map(toUser),
    user: n.author ? toUser(n.author) : GHOST,
    comments: n.comments.totalCount,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
    closed_at: n.closedAt,
    milestone: n.milestone,
    issue_type: n.issueType?.name ?? null,
    sub_issues: sub && sub.total > 0 ? { total: sub.total, completed: sub.completed } : null,
    linked_prs: n.closedByPullRequestsReferences?.totalCount ?? 0,
  };
}

export function mapSearchPage(data: SearchData): SearchPage {
  return {
    items: data.search.nodes.filter((n): n is GqlIssue => typeof (n as GqlIssue).number === 'number').map(mapIssue),
    hasMore: data.search.pageInfo.hasNextPage,
    cursor: data.search.pageInfo.endCursor,
    openCount: data.open?.issueCount ?? null,
    closedCount: data.closed?.issueCount ?? null,
  };
}

export function mapMetadata(data: MetadataData): RepoMetadata {
  const repo = data.repository;
  return {
    labels: repo.labels.nodes,
    assignees: repo.assignableUsers.nodes.map(toUser),
    milestones: repo.milestones.nodes,
    issueTypes: repo.issueTypes?.nodes ?? [],
    viewerLogin: data.viewer.login,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsc -p tsconfig.json && node --test out/github/githubQueries.test.js`
Expected: PASS, 5 tests. Then `npm test`: all pass.

- [ ] **Step 6: Verify the queries against live GitHub**

The mappers are tested against hand-made fixtures, so confirm the real schema still accepts the query text. Run (Git Bash, from `extensions/null-tools/`; needs `gh auth status` to be logged in):

```bash
node -e "const q=require('./out/github/githubQueries'); require('fs').writeFileSync(process.env.TMP+'/search.graphql', q.SEARCH_ISSUES); require('fs').writeFileSync(process.env.TMP+'/meta.graphql', q.REPO_METADATA)"
R='repo:TorresVisual/null-ide is:issue'
gh api graphql -f query="$(cat $TMP/search.graphql)" -f q="$R is:open sort:created-desc" -f qOpen="$R is:open" -f qClosed="$R is:closed" -F first=2 -F withCounts=true | head -c 400
gh api graphql -f query="$(cat $TMP/meta.graphql)" -f owner=TorresVisual -f name=null-ide | head -c 300
```
Expected: both print JSON starting with `{"data":{…` and no `"errors"` key. (If GitHub renames a field, the error names it: fix the query string and the mapper, then re-run this step.)

- [ ] **Step 7: Compile and commit**

```bash
npm run compile
git add src/github/githubQueries.ts src/github/githubQueries.test.ts src/github/types.ts tsconfig.json package.json out/github/githubQueries* out/github/types.js*
git commit -m "feat(null-tools): add GraphQL list queries and mappers

SEARCH_ISSUES (page + Open/Closed counts in one request) and REPO_METADATA
for the filter dropdowns, mapped into the REST-shaped GithubIssue the
detail tab already uses. Tolerates deleted authors and repos without
issue types (issueTypes is null on user-owned repos).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shared webview modules (`reconcile`, instant filter, picker) and icons

**Files:**
- Create: `src/webview/shared/dom.ts`
- Create: `src/webview/shared/listFilter.ts`
- Create: `src/webview/shared/picker.ts`
- Create: `src/webviewList.test.ts`
- Modify: `scripts/gen-octicons.js` (`NAMES`), regenerate `src/webview/shared/octicons.ts`
- Modify: `src/webview/shared/issueState.ts` (`duplicate` reads as not planned), `src/webviewShared.test.ts`
- Modify: `lib/issues.css` (picker styles)
- Modify: `tsconfig.webview-shared.json` (`include`), `tsconfig.json` (`include`), `package.json` (`test` script)

**Interfaces:**
- Consumes: `octicon` and `issueStateKind` (Phase 1). `escapeHtml` is defined in this task's `dom.ts` and used by `picker.ts`.
- Produces (global script functions for the webview bundles that `include` these files):
  - `escapeHtml(s: string): string`
  - `reconcile<T>(container: Element, items: T[], key: (item: T) => string, render: (item: T) => Element): void`
  - `freeTextOf(query: string): string`, `matchesLocalFilter(issue: { number: number; title: string }, query: string): boolean`
  - `interface PickerItem { value: string; label: string; html?: string; description?: string; selected?: boolean }`
  - `openPicker(opts: { anchor: HTMLElement; title: string; items: PickerItem[]; multi?: boolean; filterable?: boolean; emptyText?: string; onSelect(value: string): void }): void`
  - `filterPickerItems(items: PickerItem[], text: string): PickerItem[]`
  - New octicons: `git-pull-request`, `milestone`, `issue-tracks`, `kebab-horizontal`, `triangle-down`, `screen-full`, `search`, `x`, `plus`, `sync`.

- [ ] **Step 1: Write the failing test**

Create `src/webviewList.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Webview bundles are plain scripts (module: none), so load the compiled shared files into a sandbox and read
// their top-level functions off it. Built by `tsc -p tsconfig.webview-shared.json`.
const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);
const shared = sandbox as unknown as {
  escapeHtml(s: string): string;
  reconcile<T>(container: FakeElement, items: T[], key: (item: T) => string, render: (item: T) => FakeElement): void;
  freeTextOf(query: string): string;
  matchesLocalFilter(issue: { number: number; title: string }, query: string): boolean;
  filterPickerItems(items: Array<{ value: string; label: string; description?: string }>, text: string): Array<{ value: string }>;
};

/** Just enough of the DOM tree API for reconcile(): ordered children, insert/move, replace, remove. */
class FakeElement {
  kids: FakeElement[] = [];
  parent: FakeElement | null = null;
  constructor(readonly name: string) {}
  get children(): FakeElement[] { return this.kids; }
  get firstElementChild(): FakeElement | null { return this.kids[0] ?? null; }
  get nextElementSibling(): FakeElement | null {
    return this.parent ? this.parent.kids[this.parent.kids.indexOf(this) + 1] ?? null : null;
  }
  insertBefore(node: FakeElement, ref: FakeElement | null): FakeElement {
    if (node.parent) node.parent.kids.splice(node.parent.kids.indexOf(node), 1);
    node.parent = this;
    this.kids.splice(ref ? this.kids.indexOf(ref) : this.kids.length, 0, node);
    return node;
  }
  removeChild(node: FakeElement): FakeElement {
    this.kids.splice(this.kids.indexOf(node), 1);
    node.parent = null;
    return node;
  }
  replaceChild(node: FakeElement, old: FakeElement): FakeElement {
    this.kids.splice(this.kids.indexOf(old), 1, node);
    node.parent = this;
    old.parent = null;
    return old;
  }
}

interface Row { id: string; title: string }
const render = (r: Row): FakeElement => new FakeElement(`${r.id}:${r.title}`);
const key = (r: Row): string => r.id;
const names = (c: FakeElement): string[] => c.kids.map(k => k.name);

test('reconcile: unchanged rows keep their element across a refresh', () => {
  const c = new FakeElement('c');
  const rows = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  shared.reconcile(c, rows, key, render);
  const [a, b] = c.kids;
  shared.reconcile(c, rows.map(r => ({ ...r })), key, render);
  assert.strictEqual(c.kids[0], a);
  assert.strictEqual(c.kids[1], b);
});

test('reconcile: a changed row is re-rendered in place, its neighbours are untouched', () => {
  const c = new FakeElement('c');
  shared.reconcile(c, [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], key, render);
  const [a, b] = c.kids;
  shared.reconcile(c, [{ id: 'a', title: 'A2' }, { id: 'b', title: 'B' }], key, render);
  assert.deepStrictEqual(names(c), ['a:A2', 'b:B']);
  assert.notStrictEqual(c.kids[0], a);
  assert.strictEqual(c.kids[1], b);
});

test('reconcile: reorders by moving existing elements, inserts new ones, removes missing ones', () => {
  const c = new FakeElement('c');
  shared.reconcile(c, [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }], key, render);
  const [a, , cc] = c.kids;
  shared.reconcile(c, [{ id: 'c', title: 'C' }, { id: 'd', title: 'D' }, { id: 'a', title: 'A' }], key, render);
  assert.deepStrictEqual(names(c), ['c:C', 'd:D', 'a:A']);
  assert.strictEqual(c.kids[0], cc);
  assert.strictEqual(c.kids[2], a);
  assert.strictEqual(c.kids.length, 3);
});

test('reconcile: removes children it did not create and skips repeated keys', () => {
  const c = new FakeElement('c');
  c.insertBefore(new FakeElement('skeleton'), null);
  shared.reconcile(c, [{ id: 'a', title: 'A' }, { id: 'a', title: 'A again' }, { id: 'b', title: 'B' }], key, render);
  assert.deepStrictEqual(names(c), ['a:A', 'b:B']);
});

test('reconcile: an empty list clears the container', () => {
  const c = new FakeElement('c');
  shared.reconcile(c, [{ id: 'a', title: 'A' }], key, render);
  shared.reconcile(c, [], key, render);
  assert.deepStrictEqual(names(c), []);
});

test('freeTextOf strips qualifiers (quoted, negated) and lowercases the rest', () => {
  assert.strictEqual(shared.freeTextOf('is:open fix Crash'), 'fix crash');
  assert.strictEqual(shared.freeTextOf('label:"good first issue" -author:bob  startup'), 'startup');
  assert.strictEqual(shared.freeTextOf('is:open'), '');
  assert.strictEqual(shared.freeTextOf('#12 "exact phrase"'), '#12 exact phrase');
});

test('matchesLocalFilter matches title and #number, ignoring qualifiers', () => {
  const issue = { number: 106, title: 'Creating issues is bugged' };
  assert.strictEqual(shared.matchesLocalFilter(issue, 'is:open label:bug'), true);
  assert.strictEqual(shared.matchesLocalFilter(issue, 'is:open BUGGED'), true);
  assert.strictEqual(shared.matchesLocalFilter(issue, '#106'), true);
  assert.strictEqual(shared.matchesLocalFilter(issue, '106'), true);
  assert.strictEqual(shared.matchesLocalFilter(issue, 'creating nothing'), false);
});

test('filterPickerItems matches label or description, case-insensitively', () => {
  const items = [
    { value: 'bug', label: 'bug', description: "Something isn't working" },
    { value: 'docs', label: 'documentation' },
  ];
  assert.deepStrictEqual(shared.filterPickerItems(items, '').map(i => i.value), ['bug', 'docs']);
  assert.deepStrictEqual(shared.filterPickerItems(items, 'WORKING').map(i => i.value), ['bug']);
  assert.deepStrictEqual(shared.filterPickerItems(items, 'doc').map(i => i.value), ['docs']);
  assert.deepStrictEqual(shared.filterPickerItems(items, 'zzz'), []);
});

test('escapeHtml escapes the five HTML-significant characters', () => {
  assert.strictEqual(shared.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});
```

In `src/webviewShared.test.ts`, add this line after the `issueStateKind('closed', 'not_planned')` assertion:

```ts
  assert.strictEqual(shared.issueStateKind('closed', 'duplicate'), 'not-planned');
```

In `tsconfig.json` add `"src/webviewList.test.ts"` to `include`; in `package.json` append ` out/webviewList.test.js` to the `test` script's file list.

In `tsconfig.webview-shared.json`, add these three entries to `include` (after `"src/webview/shared/issueState.ts"`):

```json
    "src/webview/shared/dom.ts",
    "src/webview/shared/listFilter.ts",
    "src/webview/shared/picker.ts"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL. `tsc -p tsconfig.webview-shared.json` reports `error TS6053: File '…/src/webview/shared/dom.ts' not found.` (and the same for the other two).

- [ ] **Step 3: Write `dom.ts` and `listFilter.ts`**

Create `src/webview/shared/dom.ts`:

```ts
'use strict';

function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return s.replace(/[&<>"']/g, c => map[c]);
}

const reconcileKeys = new WeakMap<Element, string>();
const reconcileSignatures = new WeakMap<Element, string>();

/**
 * Makes `container`'s children match `items`, matched by `key`. A row whose item is unchanged (compared as JSON)
 * keeps its DOM node, so hover, focus and scroll survive a refresh; changed rows are re-rendered in place, new
 * ones inserted, missing ones removed, and rows are only moved when out of order. Children it didn't create
 * (a skeleton, an old message) are removed. A repeated key is skipped.
 */
function reconcile<T>(container: Element, items: T[], key: (item: T) => string, render: (item: T) => Element): void {
  const wanted = new Set(items.map(key));
  const existing = new Map<string, Element>();
  for (const child of Array.from(container.children)) {
    const k = reconcileKeys.get(child);
    if (k !== undefined && wanted.has(k) && !existing.has(k)) existing.set(k, child);
    else container.removeChild(child);
  }
  const placed = new Set<string>();
  let previous: Element | null = null;
  for (const item of items) {
    const k = key(item);
    if (placed.has(k)) continue;
    placed.add(k);
    const signature = JSON.stringify(item);
    let el = existing.get(k);
    if (el && reconcileSignatures.get(el) !== signature) {
      const fresh = render(item);
      container.replaceChild(fresh, el);
      el = fresh;
    } else if (!el) {
      el = render(item);
    }
    reconcileKeys.set(el, k);
    reconcileSignatures.set(el, signature);
    const expected: Element | null = previous ? previous.nextElementSibling : container.firstElementChild;
    if (el !== expected) container.insertBefore(el, expected);
    previous = el;
  }
}
```

Create `src/webview/shared/listFilter.ts`:

```ts
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
```

- [ ] **Step 4: Write `picker.ts`**

Create `src/webview/shared/picker.ts`:

```ts
'use strict';

interface PickerItem {
  value: string;
  /** Plain name: matched by the filter box and, unless `html` is set, shown (escaped). */
  label: string;
  /** Trusted markup shown instead of `label`: a label chip, an avatar + login. The caller must have escaped it. */
  html?: string;
  description?: string;
  selected?: boolean;
}

interface PickerOptions {
  anchor: HTMLElement;
  title: string;
  items: PickerItem[];
  /** Multi-select pickers stay open and toggle the check; single-select ones close on pick. */
  multi?: boolean;
  /** Show the filter box. Default true. */
  filterable?: boolean;
  emptyText?: string;
  onSelect(value: string): void;
}

function filterPickerItems(items: PickerItem[], text: string): PickerItem[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return items;
  return items.filter(i => i.label.toLowerCase().includes(needle) || (i.description ?? '').toLowerCase().includes(needle));
}

let closeActivePicker: (() => void) | null = null;
let activePickerAnchor: HTMLElement | null = null;

/**
 * Popover list under `anchor`: optional filter box, checkmarks, ↑/↓/Enter/Esc. One picker is open at a time,
 * and activating the anchor of the open picker closes it. Styled by `.picker*` in lib/issues.css.
 */
function openPicker(opts: PickerOptions): void {
  const wasOpenOnSameAnchor = activePickerAnchor === opts.anchor;
  closeActivePicker?.();
  if (wasOpenOnSameAnchor) return;

  const items = opts.items.map(i => ({ ...i })); // multi pickers toggle `selected` on their own copy
  const filterable = opts.filterable !== false;
  const pop = document.createElement('div');
  pop.className = 'picker';
  pop.tabIndex = -1;
  pop.innerHTML = `<div class="picker-title">${escapeHtml(opts.title)}</div>`
    + (filterable ? '<input class="picker-filter" placeholder="Filter" spellcheck="false">' : '')
    + '<div class="picker-list"></div>';
  document.body.appendChild(pop);
  const listEl = pop.querySelector('.picker-list') as HTMLElement;
  const input = pop.querySelector('.picker-filter') as HTMLInputElement | null;
  let shown: PickerItem[] = [];
  let active = 0;

  function render(): void {
    shown = filterPickerItems(items, input ? input.value : '');
    if (active >= shown.length) active = Math.max(0, shown.length - 1);
    listEl.innerHTML = shown.length === 0
      ? `<div class="picker-empty">${escapeHtml(opts.emptyText ?? 'Nothing to show')}</div>`
      : shown.map((item, i) => `
        <button type="button" class="picker-item${i === active ? ' active' : ''}" data-index="${i}">
          <span class="picker-check">${item.selected ? octicon('check') : ''}</span>
          <span class="picker-text">${item.html ?? escapeHtml(item.label)}${item.description ? `<span class="picker-desc">${escapeHtml(item.description)}</span>` : ''}</span>
        </button>`).join('');
    const activeEl = listEl.querySelector('.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function choose(index: number): void {
    const item = shown[index];
    if (!item) return;
    if (opts.multi) { item.selected = !item.selected; render(); } else close();
    opts.onSelect(item.value);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); opts.anchor.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      if (shown.length > 0) active = (active + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      choose(active);
    }
  }

  function onOutsideMouseDown(e: MouseEvent): void {
    const target = e.target as Node;
    if (!pop.contains(target) && !opts.anchor.contains(target)) close();
  }

  function close(): void {
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('mousedown', onOutsideMouseDown, true);
    pop.remove();
    closeActivePicker = null;
    activePickerAnchor = null;
  }

  listEl.addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('.picker-item');
    if (button) choose(Number(button.dataset.index));
  });
  if (input) input.addEventListener('input', () => { active = 0; render(); });
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mousedown', onOutsideMouseDown, true);
  closeActivePicker = close;
  activePickerAnchor = opts.anchor;

  render();
  const rect = opts.anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 4))}px`;
  pop.style.top = `${Math.max(4, Math.min(rect.bottom + 2, window.innerHeight - pop.offsetHeight - 4))}px`;
  (input ?? pop).focus();
}
```

- [ ] **Step 5: Duplicate reads as not planned**

In `src/webview/shared/issueState.ts`, replace

```ts
  return stateReason?.toLowerCase() === 'not_planned' ? 'not-planned' : 'completed';
```

with

```ts
  const reason = stateReason?.toLowerCase();
  return reason === 'not_planned' || reason === 'duplicate' ? 'not-planned' : 'completed';
```

- [ ] **Step 6: Add the new octicons**

In `scripts/gen-octicons.js`, replace the `NAMES` array with:

```js
const NAMES = [
  'issue-opened', 'issue-closed', 'skip', 'comment', 'copy', 'check', 'link-external', 'git-branch',
  'git-pull-request', 'milestone', 'issue-tracks', 'kebab-horizontal', 'triangle-down', 'screen-full',
  'search', 'x', 'plus', 'sync',
];
```

Run (Git Bash):

```bash
( cd "$TMP" && rm -rf package primer-octicons-*.tgz && npm pack @primer/octicons --silent && tar xzf primer-octicons-*.tgz )
node scripts/gen-octicons.js "$TMP/package"
```
Expected: `wrote 18 octicons from @primer/octicons 19.38.0 to …\src\webview\shared\octicons.ts`. `git diff --stat src/webview/shared/octicons.ts` shows only added lines (the first 8 entries are byte-identical).

- [ ] **Step 7: Picker styles**

Append to `lib/issues.css`:

```css

/* Popover picker (shared/picker.ts): filter menus, row action menus, and later the detail sidebar pickers. */
.picker {
  position:fixed; z-index:50; width:260px; max-width:calc(100vw - 8px); display:flex; flex-direction:column; outline:none;
  background:var(--vscode-quickInput-background, var(--vscode-editorWidget-background));
  color:var(--vscode-quickInput-foreground, var(--vscode-foreground));
  border:1px solid var(--vscode-widget-border, rgba(128,128,128,.35)); border-radius:6px; box-shadow:0 6px 18px rgba(0,0,0,.35);
}
.picker-title { padding:8px 10px 4px; font-size:11px; font-weight:600; color:var(--vscode-descriptionForeground); }
.picker-filter {
  margin:4px 8px 6px; padding:4px 8px; font:inherit; border-radius:4px;
  background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border, transparent);
}
.picker-filter:focus { outline:none; border-color:var(--vscode-focusBorder); }
.picker-list { max-height:300px; overflow-y:auto; padding:0 4px 4px; }
.picker-empty { padding:10px; text-align:center; color:var(--vscode-descriptionForeground); }
.picker-item {
  display:flex; align-items:flex-start; gap:6px; width:100%; padding:5px 6px; border:none; border-radius:4px; text-align:left;
  background:transparent; color:inherit; font:inherit; cursor:pointer;
}
.picker-item.active, .picker-item:hover { background:var(--vscode-list-hoverBackground); }
.picker-check { width:16px; flex-shrink:0; line-height:0; padding-top:3px; }
.picker-text { min-width:0; display:flex; flex-direction:column; gap:1px; }
.picker-desc { color:var(--vscode-descriptionForeground); font-size:.9em; }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including the 9 new `webviewList` tests and the extended `issueStateKind` test. (`escapeHtml`, `reconcile`, `freeTextOf`, … are not referenced by `issues.js`/`issueDetail.js` yet; unused top-level functions are fine.)

- [ ] **Step 9: Compile and commit**

```bash
npm run compile
git add src/webview/shared/ src/webviewList.test.ts src/webviewShared.test.ts scripts/gen-octicons.js lib/issues.css \
  tsconfig.webview-shared.json tsconfig.json package.json lib/issues.js lib/issueDetail.js out/webviewList.test.js* out/webviewShared.test.js* out/webview-shared.js
git commit -m "feat(null-tools): add keyed reconcile, instant filter and picker for the Issues list

reconcile() keeps unchanged rows' DOM nodes across refreshes; matchesLocalFilter
hides rendered rows while typing without a host round-trip; openPicker is the
popover used by the filter dropdowns and row menu. Adds the octicons they need
and treats a duplicate close like not-planned.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Host side: store search, list controller, provider, full tab

**Files:**
- Modify: `src/github/issuesStore.ts` (replace whole file)
- Create: `src/issuesListController.ts`
- Modify: `src/issuesPanel.ts` (replace whole file)
- Modify: `src/issueDetailPanel.ts` (`onCreated` signature)
- Modify: `src/issuesPanelIntegration.ts` (new command)
- Modify: `package.json` (command contribution)
- Modify: `src/github/issueFilter.ts`, `src/github/issueFilter.test.ts` (remove `filterIssues`)
- Modify: `src/github/types.ts` (remove `IssueFilterOptions`)

**Interfaces:**
- Consumes: `requestGraphql`, `ApiError` (Task 2); `SEARCH_ISSUES`, `REPO_METADATA`, `mapSearchPage`, `mapMetadata`, `RepoMetadata`, `SearchPage` (Task 3); `toApiQuery`, `withState`, `describeQuery`, `setQualifier`, `toggleQualifier`, `removeQualifier` (Task 1).
- Produces:
  - `IssuesStore.search(query: string, cursor: string | null, withCounts: boolean): Promise<SearchPage>` and `IssuesStore.getMetadata(force?: boolean): Promise<RepoMetadata>`. `IssuesStore.getByNumber` now reads a by-number map filled by every search/read/write. `hydrateFromCache(repo, issues)` lost its `viewerLogin` parameter. Removed: `refresh`, `getFiltered`, `getAllIssues`, `IssuesResult`.
  - `IssuesListController` and `IssuesListHost` (see the file below); `DEFAULT_QUERY = 'is:open'`.
  - Webview ⇄ host protocol exactly as in the controller's `InboundMessage` and its `_post` calls (Task 6's webview implements the other side): host→webview `init{query, compact, defaultQuery}`, `results{query, state, selected, sort, viewerLogin, items, openCount, closedCount, hasMore, append, fromCache}`, `metadata{labels, assignees, milestones, types, viewerLogin}`, `loading{on}`, `status{kind, message?, retryAt?, willRetry?}`, `rowActionDone{action, number}`.
  - Command `null.issues.openFullView`.

**This task and Task 6 land as one commit.** The webview still speaks the old protocol until Task 6, so the panel is mid-switch in between. Do not commit at the end of this task.

- [ ] **Step 1: Remove `filterIssues`**

In `src/github/issueFilter.ts`: change the import line to `import { GithubIssue } from './types';` and delete the whole `export function filterIssues(…) { … }` function at the end of the file.

In `src/github/issueFilter.test.ts`: change the import to `import { newestUpdateTime, relevantToViewer, stripPullRequests } from './issueFilter';` and delete the six `test('filterIssues …', …)` cases (everything from `test('filterIssues requires ALL selected labels…` through the end of `test('filterIssues with no filters returns everything unchanged'…)`). Keep `makeIssue`, `stripPullRequests`, `relevantToViewer` and `newestUpdateTime` tests.

In `src/github/types.ts`: delete the `export interface IssueFilterOptions { … }` block.

- [ ] **Step 2: Replace `src/github/issuesStore.ts`**

Replace the whole file with:

```ts
'use strict';

import { getWorkspaceGithubRepo } from './githubRemote';
import { getGithubSession } from './githubAuth';
import {
  createComment, createIssue, deleteComment, fetchAssignableUsers, fetchComments, fetchIssue, fetchRepoLabels,
  fetchTimeline, requestGraphql, updateComment, updateIssue,
} from './githubApi';
import { MetadataData, REPO_METADATA, SEARCH_ISSUES, SearchData, mapMetadata, mapSearchPage } from './githubQueries';
import { toApiQuery, withState } from './searchQuery';
import {
  GithubComment, GithubIssue, GithubLabel, GithubRepoRef, GithubTimelineEvent, GithubUser, RepoMetadata, SearchPage,
} from './types';

export const PAGE_SIZE = 50;

type SessionStatus = 'no-workspace' | 'no-remote' | 'signed-out';

const SESSION_MESSAGES: Record<SessionStatus, string> = {
  'no-workspace': 'Open a folder to use GitHub issues.',
  'no-remote': 'This folder has no GitHub remote.',
  'signed-out': 'Sign in to GitHub to continue.',
};

/** Why no GitHub session could be established; the list controller maps it to the panel's status screens. */
export class SessionError extends Error {
  constructor(readonly status: SessionStatus) {
    super(SESSION_MESSAGES[status]);
  }
}

type IssuePatch = { title?: string; body?: string; state?: 'open' | 'closed'; labels?: string[]; assignees?: string[] };

export class IssuesStore {
  /** Every issue any list has loaded, by number, so row actions and the detail tab can find one by number. */
  private known = new Map<number, GithubIssue>();
  private repo: GithubRepoRef | null = null;
  private repoLabels: GithubLabel[] | null = null;
  private assignableUsers: GithubUser[] | null = null;
  private metadata: RepoMetadata | null = null;
  private viewerLogin: string | null = null;

  constructor(private readonly getCwd: () => string | null) {}

  /** Seeds in-memory state from a persisted cache, without a network call. */
  hydrateFromCache(repo: GithubRepoRef, issues: GithubIssue[]): void {
    this.setRepo(repo);
    this.remember(issues);
  }

  /**
   * Resolves the workspace's GitHub repo and a live session token. Every read and write goes through
   * here, so no call can go out with a missing or stale repo/token (#106). `interactive` shows the
   * sign-in prompt, and is used for user-initiated writes; background reads stay silent.
   */
  async ensureSession(interactive: boolean): Promise<{ repo: GithubRepoRef; token: string }> {
    const cwd = this.getCwd();
    if (!cwd) throw new SessionError('no-workspace');
    const repo = getWorkspaceGithubRepo(cwd);
    if (!repo) throw new SessionError('no-remote');
    // VS Code rejects (rather than resolving undefined) when the sign-in prompt is dismissed.
    const session = await getGithubSession(interactive).then(s => s, () => undefined);
    if (!session) throw new SessionError('signed-out');
    this.setRepo(repo);
    this.viewerLogin = session.account.label;
    return { repo, token: session.accessToken };
  }

  /** Switches the active repo, dropping every per-repo cache when it actually changes. */
  private setRepo(repo: GithubRepoRef): void {
    if (this.repo && (this.repo.owner !== repo.owner || this.repo.repo !== repo.repo)) {
      this.known.clear();
      this.repoLabels = null;
      this.assignableUsers = null;
      this.metadata = null;
    }
    this.repo = repo;
  }

  private remember(issues: GithubIssue[]): void {
    for (const issue of issues) this.known.set(issue.number, issue);
  }

  /** One page of a search. `withCounts` also fetches the Open/Closed tab counts (first page only). */
  async search(query: string, cursor: string | null, withCounts: boolean): Promise<SearchPage> {
    const { repo, token } = await this.ensureSession(false);
    const name = `${repo.owner}/${repo.repo}`;
    const data = await requestGraphql<SearchData>(SEARCH_ISSUES, {
      q: toApiQuery(name, query),
      qOpen: toApiQuery(name, withState(query, 'open')),
      qClosed: toApiQuery(name, withState(query, 'closed')),
      first: PAGE_SIZE,
      after: cursor,
      withCounts,
    }, token);
    const page = mapSearchPage(data);
    this.remember(page.items);
    return page;
  }

  /** Labels, assignable users, milestones and issue types for the filter dropdowns. Cached until `force`. */
  async getMetadata(force = false): Promise<RepoMetadata> {
    const { repo, token } = await this.ensureSession(false);
    if (force || !this.metadata) {
      this.metadata = mapMetadata(await requestGraphql<MetadataData>(
        REPO_METADATA, { owner: repo.owner, name: repo.repo }, token));
    }
    return this.metadata;
  }

  async getRepoLabels(): Promise<GithubLabel[]> {
    const { repo, token } = await this.ensureSession(false);
    if (!this.repoLabels) this.repoLabels = await fetchRepoLabels(repo.owner, repo.repo, token);
    return this.repoLabels;
  }

  async getAssignableUsers(): Promise<GithubUser[]> {
    const { repo, token } = await this.ensureSession(false);
    if (!this.assignableUsers) this.assignableUsers = await fetchAssignableUsers(repo.owner, repo.repo, token);
    return this.assignableUsers;
  }

  getByNumber(number: number): GithubIssue | undefined {
    return this.known.get(number);
  }

  getRepo(): GithubRepoRef | null {
    return this.repo;
  }

  getViewerLogin(): string | null {
    return this.viewerLogin;
  }

  async getComments(issueNumber: number): Promise<GithubComment[]> {
    const { repo, token } = await this.ensureSession(false);
    return fetchComments(repo.owner, repo.repo, issueNumber, token);
  }

  async getTimeline(issueNumber: number): Promise<GithubTimelineEvent[]> {
    const { repo, token } = await this.ensureSession(false);
    return fetchTimeline(repo.owner, repo.repo, issueNumber, token);
  }

  /** Re-fetches one issue from GitHub and replaces it in the cache, without refetching any list. */
  async reloadIssue(issueNumber: number): Promise<void> {
    const { repo, token } = await this.ensureSession(false);
    this.remember([await fetchIssue(repo.owner, repo.repo, issueNumber, token)]);
  }

  async updateIssue(issueNumber: number, patch: IssuePatch): Promise<GithubIssue> {
    const { repo, token } = await this.ensureSession(true);
    const updated = await updateIssue(repo.owner, repo.repo, issueNumber, patch, token);
    this.remember([updated]);
    return updated;
  }

  async createIssue(
    data: { title: string; body?: string; labels?: string[]; assignees?: string[] },
  ): Promise<GithubIssue> {
    const { repo, token } = await this.ensureSession(true);
    const created = await createIssue(repo.owner, repo.repo, data, token);
    this.remember([created]);
    return created;
  }

  async addComment(issueNumber: number, body: string): Promise<GithubComment> {
    const { repo, token } = await this.ensureSession(true);
    const comment = await createComment(repo.owner, repo.repo, issueNumber, body, token);
    const issue = this.known.get(issueNumber);
    if (issue) this.known.set(issueNumber, { ...issue, comments: issue.comments + 1 });
    return comment;
  }

  async updateComment(commentId: number, body: string): Promise<GithubComment> {
    const { repo, token } = await this.ensureSession(true);
    return updateComment(repo.owner, repo.repo, commentId, body, token);
  }

  async deleteComment(issueNumber: number, commentId: number): Promise<void> {
    const { repo, token } = await this.ensureSession(true);
    await deleteComment(repo.owner, repo.repo, commentId, token);
    const issue = this.known.get(issueNumber);
    if (issue) this.known.set(issueNumber, { ...issue, comments: Math.max(0, issue.comments - 1) });
  }
}
```

- [ ] **Step 3: Create `src/issuesListController.ts`**

```ts
'use strict';

import * as vscode from 'vscode';
import { ApiError } from './github/githubApi';
import { getGithubSession } from './github/githubAuth';
import { createIssueBranch, getLocallyClosedIssueNumbers } from './github/gitBranch';
import { getWorkspaceGithubRepo } from './github/githubRemote';
import { IssuesStore, SessionError } from './github/issuesStore';
import { formatIssueAsPrompt } from './github/promptFormat';
import { describeQuery, removeQualifier, setQualifier, toggleQualifier, withState } from './github/searchQuery';
import { GithubIssue, GithubRepoRef, RepoMetadata } from './github/types';
import { IssueDetailPanel } from './issueDetailPanel';

export const DEFAULT_QUERY = 'is:open';

/** Query keys the filter bar may edit; anything else from the webview is ignored. */
const EDITABLE_KEYS = new Set(['state', 'label', 'author', 'assignee', 'milestone', 'type', 'sort']);

/** The default query's first page, painted before the network answers. */
interface ListCache { items: GithubIssue[]; openCount: number | null; closedCount: number | null }

/** What a list needs from whoever owns it (the sidebar provider): badge, mark-read, create, full view. */
export interface IssuesListHost {
  /** Called with the first page each time the default query finishes loading, for the unread badge. */
  onDefaultResults(items: GithubIssue[]): void;
  markRead(): void;
  createIssue(): Promise<void>;
  /** Offered by the sidebar only. */
  openFullView?(): void;
}

type InboundMessage =
  | { type: 'ready' }
  | { type: 'query'; text: string }
  | { type: 'editQuery'; op: 'toggle' | 'set' | 'remove'; key: string; value?: string }
  | { type: 'loadMore' }
  | { type: 'open'; number: number }
  | { type: 'rowAction'; action: 'branch' | 'worktree' | 'copyPrompt' | 'browser'; number: number }
  | { type: 'create' }
  | { type: 'signIn' }
  | { type: 'refresh' }
  | { type: 'markRead' }
  | { type: 'openFullView' };

/**
 * One issue list bound to one webview (the sidebar view or the full tab). It owns the query string, the loaded
 * pages and the paging cursor; the store owns GitHub access and the by-number lookup shared with the detail tab.
 */
export class IssuesListController {
  private _query = DEFAULT_QUERY;
  private _items: GithubIssue[] = [];
  private _cursor: string | null = null;
  private _hasMore = false;
  private _openCount: number | null = null;
  private _closedCount: number | null = null;
  private _cachedViewer: string | null = null;
  /** Bumped by every request; a response whose number is no longer current belongs to a superseded query. */
  private _seq = 0;
  private _loading = false;
  private _showingRows = false;
  private _rateRetried = false;
  private _retryTimer: ReturnType<typeof setTimeout> | undefined;
  private _disposed = false;
  private readonly _subscription: vscode.Disposable;

  constructor(
    private readonly _webview: vscode.Webview,
    private readonly _extensionUri: vscode.Uri,
    private readonly _store: IssuesStore,
    private readonly _globalState: vscode.Memento,
    private readonly _host: IssuesListHost,
    private readonly _compact: boolean,
  ) {
    this._subscription = _webview.onDidReceiveMessage((msg: InboundMessage) => void this._handleMessage(msg));
  }

  dispose(): void {
    this._disposed = true;
    this._seq++;
    clearTimeout(this._retryTimer);
    this._subscription.dispose();
  }

  /** Re-runs the current query from the first page and refreshes the dropdown metadata. */
  async refresh(): Promise<void> {
    void this._loadMetadata(true);
    await this._run(false);
  }

  /**
   * Puts a just-created issue at the top without a search: GitHub's search index lags a few seconds behind, so a
   * refresh straight after creating would not list it. It may not match the active filters; the next real
   * search corrects that.
   */
  insertCreated(issue: GithubIssue): void {
    this._items = [issue, ...this._items.filter(i => i.number !== issue.number)];
    if (issue.state === 'open' && this._openCount !== null) this._openCount++;
    this._showingRows = true;
    this._post(this._resultsMessage(this._items, false));
  }

  private _post(message: unknown): void {
    if (!this._disposed) void this._webview.postMessage(message);
  }

  private _cwd(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  private _repo(): GithubRepoRef | null {
    const cwd = this._cwd();
    return cwd ? getWorkspaceGithubRepo(cwd) : null;
  }

  private _listCacheKey(repo: GithubRepoRef): string {
    return `null.issues.listCache:${repo.owner}/${repo.repo}`;
  }

  private _metaCacheKey(repo: GithubRepoRef): string {
    return `null.issues.metaCache:${repo.owner}/${repo.repo}`;
  }

  /** Rows for the webview: no bodies (they can be long and the list never shows them), plus the local-close flag. */
  private _rows(issues: GithubIssue[]): unknown[] {
    const cwd = this._cwd();
    const closedLocally = cwd ? getLocallyClosedIssueNumbers(cwd) : new Set<number>();
    return issues.map(({ body: _body, ...row }) =>
      (row.state === 'open' && closedLocally.has(row.number) ? { ...row, closedLocally: true } : row));
  }

  private _resultsMessage(items: GithubIssue[], append: boolean, fromCache = false): unknown {
    const viewer = this._store.getViewerLogin() ?? this._cachedViewer;
    return {
      type: 'results',
      query: this._query,
      ...describeQuery(this._query, viewer),
      viewerLogin: viewer,
      items: this._rows(items),
      openCount: this._openCount,
      closedCount: this._closedCount,
      hasMore: this._hasMore,
      append,
      fromCache,
    };
  }

  private _metadataMessage(m: RepoMetadata): unknown {
    return {
      type: 'metadata', labels: m.labels, assignees: m.assignees, milestones: m.milestones,
      types: m.issueTypes, viewerLogin: m.viewerLogin,
    };
  }

  private _paintFromCache(): void {
    if (this._query !== DEFAULT_QUERY) return;
    const repo = this._repo();
    if (!repo) return;
    const meta = this._globalState.get<RepoMetadata>(this._metaCacheKey(repo));
    if (meta) {
      this._cachedViewer = meta.viewerLogin;
      this._post(this._metadataMessage(meta));
    }
    const cached = this._globalState.get<ListCache>(this._listCacheKey(repo));
    if (!cached) return;
    this._store.hydrateFromCache(repo, cached.items);
    this._openCount = cached.openCount;
    this._closedCount = cached.closedCount;
    this._hasMore = false;
    this._showingRows = true;
    this._post(this._resultsMessage(cached.items, false, true));
  }

  private async _loadMetadata(force: boolean): Promise<void> {
    try {
      const metadata = await this._store.getMetadata(force);
      this._post(this._metadataMessage(metadata));
      const repo = this._store.getRepo();
      if (repo) void this._globalState.update(this._metaCacheKey(repo), metadata);
    } catch {
      // The dropdowns just stay empty; the list's own request reports whatever is wrong.
    }
  }

  private async _run(append: boolean): Promise<void> {
    const seq = ++this._seq;
    const query = this._query;
    this._loading = true;
    this._post({ type: 'loading', on: true });
    try {
      const page = await this._store.search(query, append ? this._cursor : null, !append);
      if (seq !== this._seq) return;
      const loaded = new Set(this._items.map(i => i.number));
      const fresh = append ? page.items.filter(i => !loaded.has(i.number)) : page.items;
      this._items = append ? [...this._items, ...fresh] : page.items;
      this._cursor = page.cursor;
      this._hasMore = page.hasMore;
      if (page.openCount !== null) {
        this._openCount = page.openCount;
        this._closedCount = page.closedCount;
      }
      this._rateRetried = false;
      this._showingRows = true;
      this._post(this._resultsMessage(fresh, append));
      if (!append && query === DEFAULT_QUERY) {
        const repo = this._store.getRepo();
        if (repo) {
          void this._globalState.update(this._listCacheKey(repo), {
            items: this._items, openCount: this._openCount, closedCount: this._closedCount,
          } satisfies ListCache);
        }
        this._host.onDefaultResults(this._items);
      }
    } catch (err) {
      if (seq !== this._seq) return;
      this._reportFailure(err);
    } finally {
      if (seq === this._seq) {
        this._loading = false;
        this._post({ type: 'loading', on: false });
      }
    }
  }

  private _reportFailure(err: unknown): void {
    if (err instanceof SessionError) {
      this._showingRows = false;
      this._post({ type: 'status', kind: err.status });
    } else if (err instanceof ApiError && err.status === 401) {
      this._showingRows = false;
      this._post({ type: 'status', kind: 'signed-out' });
    } else if (err instanceof ApiError && err.retryAt !== null) {
      const willRetry = !this._rateRetried;
      this._post({ type: 'status', kind: 'rate-limited', retryAt: err.retryAt, willRetry });
      if (willRetry) {
        this._rateRetried = true;
        clearTimeout(this._retryTimer);
        const delay = Math.min(Math.max(err.retryAt - Date.now(), 1000), 10 * 60 * 1000);
        this._retryTimer = setTimeout(() => void this.refresh(), delay);
      }
    } else {
      const kind = this._showingRows ? 'offline' : 'error';
      this._post({ type: 'status', kind, message: (err as Error).message });
    }
  }

  private async _handleMessage(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this._post({ type: 'init', query: this._query, compact: this._compact, defaultQuery: DEFAULT_QUERY });
        this._paintFromCache();
        await this.refresh();
        break;
      case 'query':
        this._query = msg.text.trim();
        await this._run(false);
        break;
      case 'editQuery': {
        if (!EDITABLE_KEYS.has(msg.key)) break;
        if (msg.key === 'state') this._query = withState(this._query, msg.value === 'closed' ? 'closed' : 'open');
        else if (msg.op === 'toggle' && msg.value) this._query = toggleQualifier(this._query, msg.key, msg.value);
        else if (msg.op === 'set' && msg.value) this._query = setQualifier(this._query, msg.key, msg.value);
        else if (msg.op === 'remove') this._query = removeQualifier(this._query, msg.key);
        await this._run(false);
        break;
      }
      case 'loadMore':
        if (this._hasMore && !this._loading) await this._run(true);
        break;
      case 'open':
        if (this._store.getByNumber(msg.number)) {
          await IssueDetailPanel.show(this._extensionUri, this._store, msg.number);
        }
        break;
      case 'rowAction':
        await this._rowAction(msg.action, msg.number);
        break;
      case 'create':
        await this._host.createIssue();
        break;
      case 'signIn':
        await getGithubSession(true).then(() => undefined, () => undefined);
        await this.refresh();
        break;
      case 'refresh':
        await this.refresh();
        break;
      case 'markRead':
        this._host.markRead();
        break;
      case 'openFullView':
        this._host.openFullView?.();
        break;
    }
  }

  private async _rowAction(action: 'branch' | 'worktree' | 'copyPrompt' | 'browser', number: number): Promise<void> {
    const issue = this._store.getByNumber(number);
    if (!issue) return;
    switch (action) {
      case 'browser':
        await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
        break;
      case 'branch': {
        const cwd = this._cwd();
        if (!cwd) break;
        const result = createIssueBranch(cwd, issue.number, issue.title);
        if (result.ok) void vscode.window.showInformationMessage(`Switched to branch ${result.branch}`);
        else void vscode.window.showErrorMessage(`Failed to create branch: ${result.message}`);
        break;
      }
      case 'worktree':
        await vscode.commands.executeCommand('null.worktrees.createForIssue', issue.number, issue.title);
        break;
      case 'copyPrompt':
        await vscode.env.clipboard.writeText(formatIssueAsPrompt(issue));
        this._post({ type: 'rowActionDone', action, number });
        break;
    }
  }
}
```

- [ ] **Step 4: Replace `src/issuesPanel.ts`**

Replace the whole file with:

```ts
'use strict';

import * as vscode from 'vscode';
import { getNonce } from './webviewUtils';
import { IssuesStore } from './github/issuesStore';
import { getGithubSession } from './github/githubAuth';
import { getWorkspaceGithubRepo } from './github/githubRemote';
import { IssueDetailPanel } from './issueDetailPanel';
import { GithubIssue, GithubRepoRef } from './github/types';
import { newestUpdateTime, relevantToViewer } from './github/issueFilter';
import { IssuesListController, IssuesListHost } from './issuesListController';

/** Owns the sidebar list and, on request, one full-width tab; both are `IssuesListController`s over the same store. */
export class IssuesViewProvider implements vscode.WebviewViewProvider, IssuesListHost {
  private _webviewView?: vscode.WebviewView;
  private _fullView?: vscode.WebviewPanel;
  private readonly _controllers = new Set<IssuesListController>();
  private _badgeItems: GithubIssue[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _store: IssuesStore,
    private readonly _globalState: vscode.Memento,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._webviewView = webviewView;
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'lib')],
    };
    webview.html = buildListHtml(webview, this._extensionUri);
    this._attach(webview, true, () => { if (this._webviewView === webviewView) this._webviewView = undefined; }, webviewView);
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.markRead();
    });
    if (webviewView.visible) this.markRead();
  }

  openFullView(): void {
    if (this._fullView) {
      this._fullView.reveal();
      return;
    }
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const repo = cwd ? getWorkspaceGithubRepo(cwd) : null;
    const panel = vscode.window.createWebviewPanel(
      'null-tools.issuesFull',
      repo ? `Issues · ${repo.owner}/${repo.repo}` : 'Issues',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'lib')],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'github-issues.svg');
    panel.webview.html = buildListHtml(panel.webview, this._extensionUri);
    this._fullView = panel;
    this._attach(panel.webview, false, () => { this._fullView = undefined; }, panel);
  }

  private _attach(
    webview: vscode.Webview, compact: boolean, onGone: () => void, owner: { onDidDispose: vscode.Event<void> },
  ): void {
    const controller = new IssuesListController(webview, this._extensionUri, this._store, this._globalState, this, compact);
    this._controllers.add(controller);
    owner.onDidDispose(() => {
      controller.dispose();
      this._controllers.delete(controller);
      onGone();
    });
  }

  async refresh(): Promise<void> {
    await Promise.all([...this._controllers].map(c => c.refresh()));
  }

  async signIn(): Promise<void> {
    await getGithubSession(true).then(() => undefined, () => undefined);
    await this.refresh();
  }

  async createIssue(): Promise<void> {
    await IssueDetailPanel.showCreate(this._extensionUri, this._store, issue => {
      for (const controller of this._controllers) controller.insertCreated(issue);
    });
  }

  onDefaultResults(items: GithubIssue[]): void {
    this._badgeItems = items;
    this._updateUnreadBadge();
  }

  /** Advances the per-repo "last seen" watermark to now (or the newest known issue) and clears the badge. */
  markRead(): void {
    const repo = this._store.getRepo();
    if (!repo) return;
    const lastSeen = newestUpdateTime(this._badgeItems) || Date.now();
    void this._globalState.update(this._lastSeenKey(repo), lastSeen);
    if (this._webviewView) this._webviewView.badge = undefined;
  }

  private _lastSeenKey(repo: GithubRepoRef): string {
    return `null.issues.lastSeen:${repo.owner}/${repo.repo}`;
  }

  // ponytail: resolveWebviewView only fires once the panel has actually been
  // opened (or was left open last session), so the badge can't appear before
  // that first open in a cold session — VS Code gives webview views no way to
  // badge an unresolved container. No workaround worth the UX cost of forcing
  // the panel open.
  private _updateUnreadBadge(): void {
    if (!this._webviewView) return;
    const repo = this._store.getRepo();
    if (!repo) { this._webviewView.badge = undefined; return; }
    if (this._webviewView.visible) { this.markRead(); return; }

    const key = this._lastSeenKey(repo);
    const lastSeen = this._globalState.get<number>(key, 0);
    if (lastSeen === 0) {
      void this._globalState.update(key, newestUpdateTime(this._badgeItems) || Date.now());
      this._webviewView.badge = undefined;
      return;
    }

    const unread = relevantToViewer(this._badgeItems, this._store.getViewerLogin())
      .filter(issue => new Date(issue.updated_at).getTime() > lastSeen);
    this._webviewView.badge = unread.length > 0
      ? { value: unread.length, tooltip: `${unread.length} unread issue${unread.length === 1 ? '' : 's'}` }
      : undefined;
  }
}

function buildListHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const lib = (file: string): vscode.Uri => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'lib', file));
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https://avatars.githubusercontent.com;">
<link rel="stylesheet" href="${lib('issues.css')}">
<link rel="stylesheet" href="${lib('issueList.css')}">
</head><body>
<div id="app">
  <div id="progress" class="hidden"></div>
  <div id="toolbar">
    <span id="toolbar-title">Issues</span>
    <button type="button" class="icon-btn" id="new-issue-btn" title="New issue (c)"></button>
    <button type="button" class="icon-btn" id="refresh-btn" title="Refresh"></button>
    <button type="button" class="icon-btn" id="mark-read-btn" title="Mark Issues as Read"></button>
    <button type="button" class="icon-btn hidden" id="full-view-btn" title="Open in full view"></button>
  </div>
  <div id="searchrow">
    <button type="button" class="gh-btn" id="presets-btn">Filters</button>
    <input id="search-input" placeholder="Search issues (/)" spellcheck="false" autocomplete="off">
  </div>
  <div id="filters">
    <div id="tabs">
      <button type="button" class="tab" id="tab-open"></button>
      <button type="button" class="tab" id="tab-closed"></button>
    </div>
    <div id="dropdowns"></div>
  </div>
  <div id="banner" class="hidden"></div>
  <div id="list">
    <div id="message" class="hidden"></div>
    <div id="rows">${'<div class="skeleton-row"><span></span><span></span></div>'.repeat(6)}</div>
  </div>
  <div id="toast" class="hidden"></div>
</div>
<script nonce="${nonce}" src="${lib('issues.js')}"></script>
</body></html>`;
}
```

- [ ] **Step 5: Detail panel: pass the created issue to the list**

In `src/issueDetailPanel.ts`:

1. Change `import { GithubLabel, GithubUser } from './github/types';` to `import { GithubIssue, GithubLabel, GithubUser } from './github/types';`.
2. Replace all three occurrences of `onCreated?: () => void` (the private field, the `static async showCreate(…)` parameter, and the `private async openCreate(…)` parameter) with `onCreated?: (issue: GithubIssue) => void`. Use a find-and-replace on the exact text.
3. In the `case 'submitCreate':` branch, replace the comment and the two lines after the `createIssue` call:

```ts
          // Open the new issue before refreshing the list: onCreated() repaints from a
          // cache snapshot that doesn't include `created` yet, and would otherwise
          // overwrite the store's in-memory issues before openIssue's getByNumber runs.
          await this.openIssue(created.number);
          this.onCreated?.();
```

with:

```ts
          // Open the new issue first so the detail tab finds it in the store, then let the lists
          // insert it. They don't search for it: GitHub's search index lags a few seconds behind.
          await this.openIssue(created.number);
          this.onCreated?.(created);
```

- [ ] **Step 6: Register the full-view command**

In `src/issuesPanelIntegration.ts`, add above the `null.issues.refresh` registration:

```ts
  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.openFullView', () => provider.openFullView()),
  );
```

In `package.json`, add to `contributes.commands`, right after the `null.issues.refresh` entry:

```json
      {
        "command": "null.issues.openFullView",
        "title": "Null: Open GitHub Issues in Full View",
        "icon": "$(screen-full)"
      },
```

and add `{ "command": "null.issues.openFullView" },` to the `commandPalette` list, after the `null.issues.refresh` line.

- [ ] **Step 7: Type-check the host side**

Run: `npx tsc -p tsconfig.json`
Expected: no errors. (Do **not** run `npm run compile` yet: the webview bundle still targets the old protocol.)

Run: `grep -rn "getAllIssues\|getFiltered\|IssueFilterOptions\|IssuesResult\|filterIssues" src`
Expected: no output.

Run: `npm test`
Expected: all pass (the `issueFilter` suite now has 3 tests).

---

### Task 6: List webview and styles, then commit the switch

**Files:**
- Modify: `src/webview/issues.ts` (replace whole file)
- Modify: `lib/issueList.css` (replace whole file)
- Modify: `tsconfig.webview-issues.json` (`include`)

**Interfaces:**
- Consumes: the host protocol from Task 5; `reconcile`, `escapeHtml`, `matchesLocalFilter`, `openPicker`, `PickerItem` (Task 4); `octicon`, `timeHtml`, `labelStyleVars`, `issueStateIcon` (Phase 1); the element ids in `buildListHtml` (Task 5 Step 4).
- Produces: the working list.

- [ ] **Step 1: Bundle the new shared files into the list webview**

In `tsconfig.webview-issues.json`, add these three entries to `include`, after `"src/webview/shared/issueState.ts"` and before `"src/webview/issues.ts"`:

```json
    "src/webview/shared/dom.ts", "src/webview/shared/listFilter.ts", "src/webview/shared/picker.ts",
```

- [ ] **Step 2: Replace `src/webview/issues.ts`**

Replace the whole file with:

```ts
'use strict';

interface GithubLabel { name: string; color: string; description?: string | null; }
interface GithubUser { login: string; avatar_url: string; }
interface ListIssue {
  number: number; title: string; state: string; state_reason?: string | null; html_url: string;
  labels: GithubLabel[]; assignees: GithubUser[]; user: GithubUser; comments: number;
  created_at?: string; updated_at: string; closed_at?: string | null;
  milestone?: { number: number; title: string } | null; issue_type?: string | null;
  sub_issues?: { total: number; completed: number } | null; linked_prs?: number; closedLocally?: boolean;
}
/** What the row markup depends on beyond the issue itself, so `reconcile` re-renders a row when any of it changes. */
type RowView = ListIssue & { you: boolean; clock: number };
interface QueryView { state: 'open' | 'closed' | 'all'; selected: Record<string, string[]>; sort: string | null; }
interface Metadata {
  labels: GithubLabel[]; assignees: GithubUser[]; milestones: Array<{ number: number; title: string }>;
  types: Array<{ id: string; name: string }>;
}

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

(function () {
  const vscode = acquireVsCodeApi();
  const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

  const progressEl = el('progress');
  const newIssueBtn = el('new-issue-btn');
  const refreshBtn = el('refresh-btn');
  const markReadBtn = el('mark-read-btn');
  const fullViewBtn = el('full-view-btn');
  const presetsBtn = el('presets-btn');
  const searchInput = el<HTMLInputElement>('search-input');
  const tabOpen = el('tab-open');
  const tabClosed = el('tab-closed');
  const dropdownsEl = el('dropdowns');
  const bannerEl = el('banner');
  const listEl = el('list');
  const messageEl = el('message');
  const rowsEl = el('rows');
  const toastEl = el('toast');

  const DROPDOWNS = [
    { key: 'author', title: 'Author' }, { key: 'label', title: 'Labels' }, { key: 'assignee', title: 'Assignees' },
    { key: 'milestone', title: 'Milestones' }, { key: 'type', title: 'Types' }, { key: 'sort', title: 'Sort' },
  ];
  const SORTS: Array<[string, string]> = [
    ['created-desc', 'Newest'], ['created-asc', 'Oldest'],
    ['updated-desc', 'Recently updated'], ['comments-desc', 'Most commented'],
  ];
  const PRESETS: Array<[string, string]> = [
    ['is:open', 'Open issues'], ['is:open assignee:@me', 'Assigned to me'], ['is:open author:@me', 'Created by me'],
    ['is:open mentions:@me', 'Mentioning me'], ['is:open sort:updated-desc', 'Recently updated'],
  ];

  let query = '';
  let defaultQuery = 'is:open';
  let view: QueryView = { state: 'open', selected: {}, sort: null };
  let items: ListIssue[] = [];
  let byNumber = new Map<number, ListIssue>();
  let openCount: number | null = null;
  let closedCount: number | null = null;
  let hasMore = false;
  let loading = false;
  let metadata: Metadata | null = null;
  let viewerLogin: string | null = null;
  let selectedNumber: number | null = null;
  let searchTimer: number | undefined;
  let countdownTimer: number | undefined;
  let toastTimer: number | undefined;

  newIssueBtn.innerHTML = octicon('plus');
  refreshBtn.innerHTML = octicon('sync');
  markReadBtn.innerHTML = octicon('check');
  fullViewBtn.innerHTML = octicon('screen-full');
  presetsBtn.innerHTML = `Filters ${octicon('triangle-down')}`;

  function avatarHtml(user: GithubUser): string {
    if (!user.avatar_url) return '';
    const src = `${user.avatar_url}${user.avatar_url.includes('?') ? '&' : '?'}s=40`;
    return `<img class="avatar" src="${escapeHtml(src)}" alt="" title="${escapeHtml(user.login)}" width="20" height="20">`;
  }

  function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  function rowHtml(r: RowView): string {
    const closed = r.state === 'closed';
    const when = closed && r.closed_at ? `closed ${timeHtml(r.closed_at)}` : `opened ${timeHtml(r.created_at || r.updated_at)}`;
    const prs = r.linked_prs
      ? `<span class="count" title="${plural(r.linked_prs, 'linked pull request')}">${octicon('git-pull-request')} ${r.linked_prs}</span>` : '';
    const avatars = r.assignees.length ? `<span class="avatars">${r.assignees.map(avatarHtml).join('')}</span>` : '';
    const comments = r.comments
      ? `<span class="count" title="${plural(r.comments, 'comment')}">${octicon('comment')} ${r.comments}</span>` : '';
    const counts = prs + avatars + comments;
    const milestone = r.milestone ? ` · ${octicon('milestone')} ${escapeHtml(r.milestone.title)}` : '';
    const sub = r.sub_issues
      ? ` · <span class="sub-progress" title="${r.sub_issues.completed} of ${plural(r.sub_issues.total, 'sub-issue')} done"><span style="width:${Math.round(100 * r.sub_issues.completed / r.sub_issues.total)}%"></span></span> ${r.sub_issues.completed} of ${r.sub_issues.total}`
      : '';
    const type = r.issue_type ? ` · ${escapeHtml(r.issue_type)}` : '';
    return `
      <div class="issue-row${closed ? ' closed' : ''}${r.number === selectedNumber ? ' selected' : ''}" data-number="${r.number}">
        <span class="row-state">${issueStateIcon(r.state, r.state_reason)}</span>
        <div class="issue-main">
          <div class="row-top">
            <span class="issue-title">${escapeHtml(r.title)}</span>
            ${r.labels.map(l => `<span class="gh-label" style="${labelStyleVars(l.color)}">${escapeHtml(l.name)}</span>`).join('')}
            ${r.you ? '<span class="you-badge">@you</span>' : ''}
            ${r.closedLocally ? '<span class="closes-badge" title="An unpushed local commit will close this issue">closes on push</span>' : ''}
          </div>
          <div class="row-sub"><span class="issue-num">#${r.number}</span> · ${escapeHtml(r.user.login)} ${when}${milestone}${sub}${type}<span class="row-inline">${counts}</span></div>
        </div>
        <div class="row-right">${counts}</div>
        <button type="button" class="row-menu-btn icon-btn" title="More actions" aria-label="More actions">${octicon('kebab-horizontal')}</button>
      </div>`;
  }

  function showMessage(html: string): void {
    messageEl.innerHTML = html;
    messageEl.classList.remove('hidden');
  }

  function clearStatus(): void {
    clearInterval(countdownTimer);
    bannerEl.classList.add('hidden');
    messageEl.classList.add('hidden');
  }

  function applyLocalFilter(): void {
    rowsEl.querySelectorAll<HTMLElement>('.issue-row').forEach(row => {
      const issue = byNumber.get(Number(row.dataset.number));
      row.classList.toggle('filtered', !!issue && !matchesLocalFilter(issue, searchInput.value));
    });
  }

  function renderRows(): void {
    byNumber = new Map(items.map(i => [i.number, i]));
    // Rows re-render when this 5-minute bucket changes, which keeps "3 minutes ago" honest without a timer.
    const clock = Math.floor(Date.now() / 300000);
    const rows: RowView[] = items.map(i => ({
      ...i, you: !!viewerLogin && i.assignees.some(a => a.login === viewerLogin), clock,
    }));
    reconcile(rowsEl, rows, r => String(r.number), r => {
      const holder = document.createElement('div');
      holder.innerHTML = rowHtml(r);
      return holder.firstElementChild as HTMLElement;
    });
    applyLocalFilter();
    if (items.length === 0) {
      showMessage('No results matched your search.<br><button type="button" class="action" id="clear-filters">Clear filters</button>');
    }
  }

  function renderTabs(): void {
    const count = (n: number | null): string => (n === null ? '' : ` <span class="tab-count">${n}</span>`);
    tabOpen.innerHTML = `${octicon('issue-opened')} Open${count(openCount)}`;
    tabClosed.innerHTML = `${octicon('issue-closed')} Closed${count(closedCount)}`;
    tabOpen.classList.toggle('active', view.state === 'open');
    tabClosed.classList.toggle('active', view.state === 'closed');
  }

  function renderDropdowns(): void {
    const shown = DROPDOWNS.filter(d => {
      if (d.key === 'milestone') return !!metadata && metadata.milestones.length > 0;
      if (d.key === 'type') return !!metadata && metadata.types.length > 0;
      return true;
    });
    dropdownsEl.innerHTML = shown.map(d => {
      const active = d.key === 'sort' ? view.sort !== null : (view.selected[d.key] || []).length > 0;
      return `<button type="button" class="gh-btn filter-btn${active ? ' active' : ''}" data-key="${d.key}">${d.title} ${octicon('triangle-down')}</button>`;
    }).join('');
  }

  function isSelected(key: string, value: string): boolean {
    if (key === 'sort') return view.sort === value;
    return (view.selected[key] || []).some(s => s.toLowerCase() === value.toLowerCase());
  }

  function dropdownItems(key: string): PickerItem[] {
    if (key === 'sort') return SORTS.map(([value, label]) => ({ value, label, selected: isSelected(key, value) }));
    if (!metadata) return [];
    switch (key) {
      case 'label':
        return metadata.labels.map(l => ({
          value: l.name, label: l.name, description: l.description || undefined, selected: isSelected(key, l.name),
          html: `<span class="gh-label" style="${labelStyleVars(l.color)}">${escapeHtml(l.name)}</span>`,
        }));
      case 'author':
      case 'assignee':
        return metadata.assignees.map(u => ({
          value: u.login, label: u.login, selected: isSelected(key, u.login), html: `${avatarHtml(u)} ${escapeHtml(u.login)}`,
        }));
      case 'milestone':
        return metadata.milestones.map(m => ({ value: m.title, label: m.title, selected: isSelected(key, m.title) }));
      case 'type':
        return metadata.types.map(t => ({ value: t.name, label: t.name, selected: isSelected(key, t.name) }));
    }
    return [];
  }

  function openDropdown(key: string, anchor: HTMLElement): void {
    openPicker({
      anchor,
      title: DROPDOWNS.find(d => d.key === key)!.title,
      items: dropdownItems(key),
      multi: key === 'label',
      filterable: key !== 'sort',
      emptyText: metadata || key === 'sort' ? 'Nothing to show' : 'Loading…',
      onSelect: value => {
        if (key === 'label') vscode.postMessage({ type: 'editQuery', op: 'toggle', key, value });
        else vscode.postMessage({ type: 'editQuery', op: isSelected(key, value) ? 'remove' : 'set', key, value });
      },
    });
  }

  function select(number: number | null): void {
    selectedNumber = number;
    rowsEl.querySelectorAll<HTMLElement>('.issue-row').forEach(row => {
      const on = Number(row.dataset.number) === number;
      row.classList.toggle('selected', on);
      if (on) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function moveSelection(delta: number): void {
    const rows = Array.from(rowsEl.querySelectorAll<HTMLElement>('.issue-row:not(.filtered)'));
    if (rows.length === 0) return;
    const current = rows.findIndex(r => Number(r.dataset.number) === selectedNumber);
    const next = Math.max(0, Math.min(rows.length - 1, current + delta));
    select(Number(rows[next].dataset.number));
  }

  function sendQuery(): void {
    clearTimeout(searchTimer);
    if (searchInput.value.trim() !== query) vscode.postMessage({ type: 'query', text: searchInput.value });
  }

  function maybeLoadMore(): void {
    if (!hasMore || loading) return;
    if (listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight > 300) return;
    loading = true;
    vscode.postMessage({ type: 'loadMore' });
  }

  function toast(text: string): void {
    clearTimeout(toastTimer);
    toastEl.textContent = text;
    toastEl.classList.remove('hidden');
    toastTimer = window.setTimeout(() => toastEl.classList.add('hidden'), 1500);
  }

  function showRateLimit(retryAt: number, willRetry: boolean): void {
    clearInterval(countdownTimer);
    const retryButton = '<button type="button" class="link" data-act="retry">Retry now</button>';
    const tick = (): void => {
      const seconds = Math.ceil((retryAt - Date.now()) / 1000);
      const wait = seconds > 0 ? (willRetry ? `retrying in ${seconds}s` : `resets in ${seconds}s`) : 'ready to retry';
      bannerEl.innerHTML = `Rate limited · ${wait} · ${retryButton}`;
      if (seconds <= 0) clearInterval(countdownTimer);
    };
    tick();
    bannerEl.classList.remove('hidden');
    countdownTimer = window.setInterval(tick, 1000);
  }

  function onResults(msg: {
    query: string; state: QueryView['state']; selected: QueryView['selected']; sort: string | null;
    viewerLogin: string | null; items: ListIssue[]; openCount: number | null; closedCount: number | null;
    hasMore: boolean; append: boolean;
  }): void {
    clearStatus();
    query = msg.query;
    view = { state: msg.state, selected: msg.selected, sort: msg.sort };
    if (msg.viewerLogin) viewerLogin = msg.viewerLogin;
    openCount = msg.openCount;
    closedCount = msg.closedCount;
    hasMore = msg.hasMore;
    // Don't overwrite what the user is typing; the echo of their own Enter/pause carries the same text anyway.
    if (document.activeElement !== searchInput) searchInput.value = msg.query;
    items = msg.append ? items.concat(msg.items) : msg.items;
    renderTabs();
    renderDropdowns();
    renderRows();
    requestAnimationFrame(maybeLoadMore);
  }

  function onStatus(msg: { kind: string; message?: string; retryAt?: number; willRetry?: boolean }): void {
    if (msg.kind === 'offline') {
      bannerEl.innerHTML = `<span title="${escapeHtml(msg.message || '')}">Offline · showing cached results</span> · <button type="button" class="link" data-act="retry">Retry</button>`;
      bannerEl.classList.remove('hidden');
      return;
    }
    if (items.length === 0) rowsEl.replaceChildren(); // drops the loading skeleton
    if (msg.kind === 'rate-limited') {
      showRateLimit(msg.retryAt || Date.now(), !!msg.willRetry);
      return;
    }
    items = [];
    byNumber = new Map();
    rowsEl.replaceChildren();
    const texts: Record<string, string> = {
      'no-workspace': 'Open a folder to browse its GitHub issues.',
      'no-remote': 'This folder has no GitHub remote.',
      'signed-out': 'Sign in to GitHub to view issues.',
      error: msg.message || 'Failed to load issues.',
    };
    showMessage(`${escapeHtml(texts[msg.kind] || 'Failed to load issues.')}${
      msg.kind === 'signed-out' ? '<br><button type="button" class="action" id="signin-btn">Sign in</button>'
        : msg.kind === 'error' ? '<br><button type="button" class="action" id="retry-btn">Retry</button>' : ''}`);
  }

  newIssueBtn.addEventListener('click', () => vscode.postMessage({ type: 'create' }));
  refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  markReadBtn.addEventListener('click', () => vscode.postMessage({ type: 'markRead' }));
  fullViewBtn.addEventListener('click', () => vscode.postMessage({ type: 'openFullView' }));

  presetsBtn.addEventListener('click', () => openPicker({
    anchor: presetsBtn, title: 'Filters', filterable: false,
    items: PRESETS.map(([value, label]) => ({ value, label, selected: value === query })),
    onSelect: value => vscode.postMessage({ type: 'query', text: value }),
  }));

  tabOpen.addEventListener('click', () => vscode.postMessage({ type: 'editQuery', op: 'set', key: 'state', value: 'open' }));
  tabClosed.addEventListener('click', () => vscode.postMessage({ type: 'editQuery', op: 'set', key: 'state', value: 'closed' }));
  dropdownsEl.addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('.filter-btn');
    if (button) openDropdown(button.dataset.key!, button);
  });

  searchInput.addEventListener('input', () => {
    applyLocalFilter();
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(sendQuery, 400);
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendQuery();
    else if (e.key === 'Escape') searchInput.blur();
  });

  rowsEl.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('.issue-row');
    if (!row) return;
    const number = Number(row.dataset.number);
    const menuButton = target.closest<HTMLElement>('.row-menu-btn');
    if (menuButton) {
      openPicker({
        anchor: menuButton, title: `#${number}`, filterable: false,
        items: [
          { value: 'branch', label: 'Create branch' }, { value: 'worktree', label: 'Create worktree' },
          { value: 'copyPrompt', label: 'Copy as prompt' }, { value: 'browser', label: 'Open on github.com' },
        ],
        onSelect: action => vscode.postMessage({ type: 'rowAction', action, number }),
      });
      return;
    }
    select(number);
    vscode.postMessage({ type: 'open', number });
  });

  messageEl.addEventListener('click', e => {
    const id = (e.target as HTMLElement).id;
    if (id === 'signin-btn') vscode.postMessage({ type: 'signIn' });
    else if (id === 'retry-btn') vscode.postMessage({ type: 'refresh' });
    else if (id === 'clear-filters') vscode.postMessage({ type: 'query', text: defaultQuery });
  });
  bannerEl.addEventListener('click', e => {
    if ((e.target as HTMLElement).dataset.act === 'retry') vscode.postMessage({ type: 'refresh' });
  });
  listEl.addEventListener('scroll', maybeLoadMore, { passive: true });

  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.picker')) return;
    if ((e.target as HTMLElement).closest('input, textarea, select, button')) return;
    switch (e.key) {
      case '/': e.preventDefault(); searchInput.focus(); searchInput.select(); break;
      case 'j': case 'ArrowDown': e.preventDefault(); moveSelection(1); break;
      case 'k': case 'ArrowUp': e.preventDefault(); moveSelection(-1); break;
      case 'Enter': if (selectedNumber !== null) vscode.postMessage({ type: 'open', number: selectedNumber }); break;
      case 'c': e.preventDefault(); vscode.postMessage({ type: 'create' }); break;
    }
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        query = msg.query;
        defaultQuery = msg.defaultQuery;
        searchInput.value = msg.query;
        fullViewBtn.classList.toggle('hidden', !msg.compact);
        break;
      case 'results':
        onResults(msg);
        break;
      case 'metadata':
        metadata = { labels: msg.labels, assignees: msg.assignees, milestones: msg.milestones, types: msg.types };
        if (msg.viewerLogin) viewerLogin = msg.viewerLogin;
        renderDropdowns();
        break;
      case 'loading':
        loading = msg.on;
        progressEl.classList.toggle('hidden', !msg.on);
        if (!msg.on) maybeLoadMore();
        break;
      case 'status':
        onStatus(msg);
        break;
      case 'rowActionDone':
        if (msg.action === 'copyPrompt') toast('Copied as prompt');
        break;
    }
  });

  renderTabs();
  vscode.postMessage({ type: 'ready' });
})();
```

- [ ] **Step 3: Replace `lib/issueList.css`**

Replace the whole file with:

```css
/* Issue list (sidebar view and full tab). Shared look lives in issues.css. */

html, body { margin:0; padding:0; height:100%; background:var(--vscode-editor-background); color:var(--vscode-foreground);
             font:13px/1.5 var(--vscode-font-family); }
#app { display:flex; flex-direction:column; height:100%; position:relative; }

/* Request in flight: a 2px bar sweeping across the top, like github.com's turbo progress. */
#progress { position:absolute; top:0; left:0; right:0; height:2px; overflow:hidden; z-index:5; }
#progress::after {
  content:''; position:absolute; top:0; bottom:0; width:40%; background:var(--vscode-progressBar-background, var(--vscode-focusBorder));
  animation:progress-sweep 1s ease-in-out infinite;
}
@keyframes progress-sweep { from { left:-40%; } to { left:100%; } }
@media (prefers-reduced-motion: reduce) { #progress::after { animation:none; left:0; width:100%; opacity:.5; } }

#toolbar { display:flex; align-items:center; gap:2px; padding:6px 8px 2px; flex-shrink:0; }
#toolbar-title { flex:1; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--vscode-descriptionForeground); }
.icon-btn {
  background:transparent; border:none; color:var(--vscode-foreground); cursor:pointer;
  padding:4px 6px; border-radius:4px; line-height:0;
}
.icon-btn:hover { background:var(--vscode-toolbar-hoverBackground, color-mix(in srgb, var(--vscode-foreground) 8%, transparent)); }
.icon-btn:focus-visible, .gh-btn:focus-visible, .tab:focus-visible, button.link:focus-visible { outline:1px solid var(--vscode-focusBorder); outline-offset:1px; }

#searchrow { display:flex; gap:6px; padding:4px 8px; flex-shrink:0; }
#search-input {
  flex:1; min-width:0; background:var(--vscode-input-background); border:1px solid var(--vscode-input-border, transparent);
  color:var(--vscode-input-foreground); padding:4px 8px; font:inherit; border-radius:4px;
}
#search-input::placeholder { color:var(--vscode-input-placeholderForeground); }
#search-input:focus { outline:none; border-color:var(--vscode-focusBorder); }

.gh-btn {
  display:inline-flex; align-items:center; gap:4px; white-space:nowrap; cursor:pointer; font:inherit;
  background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground);
  border:1px solid transparent; border-radius:4px; padding:3px 8px;
}
.gh-btn:hover { background:var(--vscode-button-secondaryHoverBackground); }
.gh-btn.active { border-color:var(--vscode-focusBorder); }

#filters {
  display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:4px 8px; padding:4px 8px 6px;
  border-bottom:1px solid var(--vscode-widget-border, rgba(128,128,128,.2)); flex-shrink:0;
}
#tabs { display:flex; gap:2px; }
.tab {
  display:inline-flex; align-items:center; gap:4px; background:transparent; border:none; border-radius:4px; cursor:pointer;
  color:var(--vscode-descriptionForeground); font:inherit; padding:3px 8px;
}
.tab:hover { color:var(--vscode-foreground); background:var(--vscode-toolbar-hoverBackground, color-mix(in srgb, var(--vscode-foreground) 8%, transparent)); }
.tab.active { color:var(--vscode-foreground); font-weight:600; }
.tab-count { background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); border-radius:999px; padding:0 6px; font-size:.85em; font-weight:400; }
#dropdowns { display:flex; flex-wrap:wrap; gap:4px; }

#banner {
  padding:6px 10px; font-size:.95em; flex-shrink:0;
  background:color-mix(in srgb, var(--vscode-editorWarning-foreground) 14%, transparent);
  border-bottom:1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground) 40%, transparent);
}
button.link { background:none; border:none; padding:0; color:var(--vscode-textLink-foreground); cursor:pointer; font:inherit; }
button.link:hover { text-decoration:underline; }

#list { flex:1; overflow-y:auto; container-type:inline-size; }
#message { padding:24px 16px; text-align:center; color:var(--vscode-descriptionForeground); }
button.action { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; padding:5px 12px; border-radius:4px; cursor:pointer; margin-top:8px; font:inherit; }
button.action:hover { background:var(--vscode-button-hoverBackground); }

.issue-row {
  display:flex; align-items:flex-start; gap:8px; padding:8px 10px; cursor:pointer;
  border-bottom:1px solid var(--vscode-widget-border, rgba(128,128,128,.12));
}
.issue-row:hover { background:var(--vscode-list-hoverBackground); }
.issue-row.selected { background:var(--vscode-list-activeSelectionBackground); color:var(--vscode-list-activeSelectionForeground); }
.issue-row.filtered { display:none; }
.row-state { flex-shrink:0; line-height:0; margin-top:3px; }
.issue-main { min-width:0; flex:1; }
.row-top { display:flex; flex-wrap:wrap; align-items:center; gap:2px 4px; }
.issue-title { font-weight:600; margin-right:4px; overflow-wrap:anywhere; }
.row-sub { color:var(--vscode-descriptionForeground); font-size:.9em; margin-top:1px; }
.issue-row.selected .row-sub { color:inherit; opacity:.85; }
.row-sub .octicon, .count .octicon { width:12px; height:12px; vertical-align:-1px; }
.row-right, .row-inline { display:inline-flex; align-items:center; gap:10px; }
.row-right { display:none; flex-shrink:0; color:var(--vscode-descriptionForeground); margin-top:1px; }
.row-inline { margin-left:8px; gap:8px; }
.count { display:inline-flex; align-items:center; gap:3px; }
.avatars { display:inline-flex; }
.avatar { border-radius:50%; margin-left:-6px; border:1px solid var(--vscode-editor-background); background:var(--vscode-editor-background); }
.avatars .avatar:first-child { margin-left:0; }
.row-inline .avatar { width:14px; height:14px; }
.row-menu-btn { opacity:0; flex-shrink:0; color:var(--vscode-descriptionForeground); }
.issue-row:hover .row-menu-btn, .row-menu-btn:focus-visible { opacity:1; }

.you-badge, .closes-badge { display:inline-block; padding:0 6px; border-radius:999px; font-size:.85em; }
.you-badge { background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); }
.closes-badge { background:var(--vscode-editorWarning-foreground); color:var(--vscode-editor-background); }

.sub-progress { display:inline-block; width:36px; height:6px; border-radius:3px; vertical-align:1px; overflow:hidden;
                background:color-mix(in srgb, var(--vscode-foreground) 18%, transparent); }
.sub-progress > span { display:block; height:100%; background:var(--gh-open); }

/* Wide: counts and assignees get their own right-hand column. Narrow (sidebar): they move into the second line. */
@container (min-width: 480px) {
  .row-right { display:inline-flex; }
  .row-inline { display:none; }
}

/* Cold start with no cache: grey placeholder rows. */
.skeleton-row { display:flex; flex-direction:column; gap:6px; padding:12px 10px; border-bottom:1px solid var(--vscode-widget-border, rgba(128,128,128,.12)); }
.skeleton-row span { height:10px; border-radius:3px; background:color-mix(in srgb, var(--vscode-foreground) 10%, transparent); }
.skeleton-row span:first-child { width:60%; }
.skeleton-row span:last-child { width:35%; height:8px; }

#toast {
  position:absolute; left:50%; bottom:16px; transform:translateX(-50%); padding:6px 12px; border-radius:4px; z-index:20;
  background:var(--vscode-notifications-background, var(--vscode-editorWidget-background)); color:var(--vscode-notifications-foreground, var(--vscode-foreground));
  border:1px solid var(--vscode-widget-border, rgba(128,128,128,.3)); box-shadow:0 2px 8px rgba(0,0,0,.3);
}
```

- [ ] **Step 4: Compile everything and run the suite**

Run: `npm run compile && npm test`
Expected: no TypeScript errors (all four webview bundles and the extension compile); all tests pass.

Run: `grep -n "dropdown-container\|dropdown-trigger\|filter-popover\|setFilters\|selectIssue" src/webview/issues.ts src/issuesPanel.ts src/issuesListController.ts lib/issueList.css`
Expected: no output (the old v1 list wiring is gone).

- [ ] **Step 5: Commit the switch (Tasks 5 and 6 together)**

```bash
git status --short   # expect only the files below plus the unrelated out/autoGitignore* ones
git add src/github/types.ts src/github/issueFilter.ts src/github/issueFilter.test.ts src/github/issuesStore.ts \
  src/issuesListController.ts src/issuesPanel.ts src/issueDetailPanel.ts src/issuesPanelIntegration.ts package.json \
  src/webview/issues.ts tsconfig.webview-issues.json lib/issueList.css lib/issues.js \
  out/github/types.js* out/github/issueFilter* out/github/issuesStore.js* out/issuesListController.js* \
  out/issuesPanel.js* out/issueDetailPanel.js* out/issuesPanelIntegration.js*
git commit -m "feat(null-tools): github.com-style Issues list with search, counts, paging and a full tab

The list now searches through GitHub's GraphQL API from one query string:
Open/Closed counts, label/author/assignee/milestone/type filters, sort,
presets, 50-per-page paging, instant local filtering while typing, keyed
row reconciliation (no flicker), skeleton and offline/rate-limit states,
and j/k/Enter, /, c keys. IssuesListController binds a list to any webview,
so the sidebar and the new full-width tab (null.issues.openFullView) share
one implementation. Newly created issues are inserted into the lists
directly because GitHub's search index lags.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verify against a real install

**Files:** none (verification only; fix-up commits if something fails), plus one docs line.

**Interfaces:**
- Consumes: everything above.
- Produces: a verified Phase 2.

- [ ] **Step 1: Sync to the local install**

Invoke the `verify-local` skill for `null-tools`. It syncs source into the local Null IDE install and runs the extension's integration specs. Reload the Null IDE window afterwards.
Expected: sync succeeds; specs (if any exist for null-tools) pass.

- [ ] **Step 2: Unit tests one more time**

Run: `npm test`
Expected: all pass.

- [ ] **Step 3: Scenarios** (in the `TorresVisual/null-ide` workspace; open the *GitHub Issues* activity-bar view)

1. **Cold paint.** Reload the window. Expected: grey skeleton rows (or last session's cached rows) appear immediately, then the real list replaces them without the rows jumping. The tabs read `Open 5x` / `Closed 5x` with counts.
2. **Instant filter.** Type `spotify` slowly. Expected: rows hide on each keystroke with no flicker or progress bar; after ~400ms the progress bar sweeps once and the list settles on the server's results. Clear the box and press Enter: the full open list returns.
3. **Query is the source of truth.** Pick a label in *Labels* (picker stays open, check toggles), close it. Expected: the box now reads `is:open label:bug` (or similar), the button is highlighted, and the list is filtered. Click *Closed*: the box reads `is:closed label:bug`. Click the same label again in the picker: it disappears from the box.
4. **Rapid tab changes (Review Focus 1).** Click *Open* / *Closed* ten times as fast as you can, ending on *Closed*. Expected: after the progress bar stops, the highlighted tab and the rows both match *Closed*; never a mixed list.
5. **Dropdowns on a repo without issue types (Review Focus 2).** Expected: no *Types* button (this repo has no issue types) and no *Milestones* button unless a milestone exists; no console errors (Developer: Open Webview Developer Tools).
6. **Searching outside the repo (Review Focus 4).** Type `repo:microsoft/vscode` and press Enter. Expected: zero rows or only this repo's issues, never vscode's issues.
7. **Presets.** *Filters ▾* → *Assigned to me*, then *Recently updated*. Expected: the box shows `is:open assignee:@me` / `is:open sort:updated-desc`, rows follow, the menu closes after picking.
8. **Paging.** Search with an empty box (all issues, 100+ across open/closed). Scroll to the bottom. Expected: more rows load without a jump; scrolling continues until `hasMore` is false.
9. **Full tab.** Click the full-view button (top right of the sidebar list), or run *Null: Open GitHub Issues in Full View*. Expected: a tab `Issues · TorresVisual/null-ide` opens; it has no full-view button; each row shows a right-hand column (linked-PR count, assignee avatars, comments); resizing the tab below ~480px moves those into the second line. Typing in the sidebar box doesn't change the tab's query and vice versa.
10. **Keyboard.** In the full tab: press `/` (search focuses), Esc, `j`/`k` (selection moves, scrolls into view), `Enter` (detail tab opens), `c` (new issue form opens). With a picker open, `j` does nothing; ↑/↓/Enter/Esc work inside it.
11. **Row menu.** Hover a row, click `⋯` → *Copy as prompt*. Expected: a "Copied as prompt" toast, and the clipboard holds `#N title …`. *Create branch* switches branch (undo it with `git checkout -`), *Open on github.com* opens the browser.
12. **Create, then list (Review Focus 5).** Click New issue, create `Phase 2 verification`. Expected: the detail tab opens and, back in the list, the new issue is already the top row with the Open count increased by one. Close that issue as *not planned* on github.com afterwards.
13. **Offline.** Disable the network, then click Refresh. Expected: the cached rows stay and an "Offline · showing cached results · Retry" banner appears; re-enable the network and click Retry: the banner disappears.
14. **Unread badge still works.** With the sidebar hidden (switch to Explorer), refresh from the command palette (*Null: Refresh GitHub Issues*) after commenting on an issue assigned to you from github.com. Expected: the badge appears on the activity-bar icon; opening the view clears it.
15. **Themes.** Repeat a glance at the list in Null Dark and one light theme: filter buttons, tabs, picker popover, label chips, banner and toast are all legible.

Clean up: close `Phase 2 verification` (and any other test issues) on github.com.

- [ ] **Step 4: Update the project docs**

In `CLAUDE.md`, in the `null-tools` table, replace the **GitHub Issues panel** row's details with:

```
| **GitHub Issues panel** | Own activity-bar view (`null-issues`) plus a full-width tab (`null.issues.openFullView`); GraphQL search with a github.com-style query box, Open/Closed counts, filter dropdowns, sort, presets, paging and keyboard navigation; create/comment on issues, sign-in, mark-as-read, issue templates, link/insert issue references in commit messages |
```

Commit:

```bash
git add CLAUDE.md
git commit -m "docs: describe the GitHub Issues list and full tab

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Record and report**

If any scenario fails, fix it in the owning task's files, re-run that task's tests, and commit as `fix(null-tools): …`. Then report the verification results (what passed, anything deferred, and the deviations listed at the top) to the user.

# Pull Requests Phase 1 — Review Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** In `null-tools`, list a repo's open pull requests in a native tree, open any changed file in the stock diff editor, read and post inline review comments, check a PR out locally, and open it on GitHub (issue #92; first slice of umbrella #117).

**Architecture:** New `src/pulls/` directory. Pure files (`pullModel.ts` queries/mappers/types, `pullDocs.ts` virtual-document URIs) and thin API/git wrappers (`pullApi.ts` over the existing `requestGraphql`/`requestJson`, `pullCheckout.ts` over `graph/gitRun.ts`) carry all logic and are unit-tested. `vscode` glue is four small files: a content provider serving file text from the Contents API, a diff opener, a `CommentController` wrapper, and the tree provider plus registration.

**Tech Stack:** TypeScript (commonjs), `node:test` with a mocked `https.request` and real `git` in temp repos, VS Code TreeView / Comments API / `vscode.diff`, GitHub GraphQL + REST.

**Spec:** `docs/specs/pull-requests-design.md` (read it first: it fixes GitHub-only scope, native-UI choice and the merge-base rule).

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

- Everything lives in `extensions/null-tools`; run all commands from that directory (`cd extensions/null-tools`).
- `out/` and `lib/` are tracked; never hand-edit them. After the work, `npm run compile` and commit the refreshed `out/` as `chore: refresh null-tools compiled output`. No webview code is added in this phase, so `lib/` does not change.
- Every new `*.test.ts` must be added to **both** `tsconfig.json`'s `include` and the explicit `node --test` list in `package.json`'s `test` script, or it is silently skipped.
- GitHub only. Signed-out use is silent (`getGithubSession(false)`); only posting a comment may prompt (`getGithubSession(true)`).
- Git: only through `makeRunGit` from `src/graph/gitRun.ts`; no force flags, no `reset`, no `push`. Never overwrite a local `pr-<n>` branch.
- Anything fetched from GitHub or from a document URI is untrusted: owner/repo names, shas and paths are validated before use (Task 2).
- Commit style: `feat(null-tools): …` / `test(null-tools): …` / `docs: …`. Do not push.

## Review Focus

Failure modes the spec implies but a happy-path test would miss, most likely first. Each has a pinned test in the task named in brackets:

1. **Local `pr-<n>` branch has commits the PR does not** — checkout must refuse to move it and keep the user's commits. [Task 4 `diverged local branch is left alone`]
2. **Renamed, added, removed and binary files, and PRs with more than 100 files** — left side must read the old path, added/removed sides must be empty, binary content must not be dumped as text, file paging must not stop at page 1. [Task 1 `mapFiles`, `leftPath`; Task 2 `decodeBlob`; Task 3 `fetchPullFiles pages`]
3. **Threads on outdated code (no current line) and deleted authors** — skipped / shown as `ghost`, never a crash. [Task 1 `mapThreads`]
4. **Rate limit or 401/403 while listing** — the tree shows one line with when to retry, not an error toast per refresh. [Task 1 `describeFailure`]
5. **Hostile document URI** (`..` in the path, owner `..`, short sha, bad side) must never reach the network. [Task 2 `parseDocQuery rejects …`]

---

### Task 1: PR model — queries, mappers, types

**Files:**
- Create: `extensions/null-tools/src/pulls/pullModel.ts`
- Create: `extensions/null-tools/src/pulls/pullModel.test.ts`
- Modify: `extensions/null-tools/src/github/githubApi.ts` (export `requestJson`)
- Modify: `extensions/null-tools/tsconfig.json` (include), `extensions/null-tools/package.json` (`test` script)

**Interfaces:**
- Consumes: `ApiError` from `../github/githubApi`.
- Produces (used by Tasks 2–5): `CheckState`, `ReviewState`, `PullSummary`, `PullFile`, `PullDetail`, `ReviewComment`, `ReviewThread`, `LIST_PULLS`, `REVIEW_THREADS`, `openPullsQuery(owner, repo): string`, `mapPulls(data: ListPullsData): PullSummary[]`, `mapFiles(raw: RestFile[]): PullFile[]`, `mapThreads(data: ThreadsData): ReviewThread[]`, `commentFromRest(c: RestComment): ReviewComment`, `leftPath(files: PullFile[], path: string): string`, `describeFailure(err: unknown, now?: number): string`; `requestJson<T>(path, token, method?, body?)` exported from `githubApi.ts`.

- [ ] **Step 1: Export `requestJson`**

In `src/github/githubApi.ts` change `async function requestJson<T>(` to `export async function requestJson<T>(`. Nothing else changes.

- [ ] **Step 2: Write the failing test** — `src/pulls/pullModel.test.ts`

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { ApiError } from '../github/githubApi';
import {
  ListPullsData, ThreadsData, commentFromRest, describeFailure, leftPath, mapFiles, mapPulls, mapThreads, openPullsQuery,
} from './pullModel';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const pullNode = (over: Record<string, unknown> = {}) => ({
  number: 12, title: 'Add x', url: 'https://github.com/o/r/pull/12', isDraft: false, updatedAt: '2026-10-02T10:00:00Z',
  headRefName: 'feat/x', baseRefName: 'main', headRefOid: A, baseRefOid: B, reviewDecision: 'APPROVED',
  author: { login: 'octocat' }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  ...over,
});
const list = (nodes: unknown[]): ListPullsData => ({ search: { nodes } } as ListPullsData);

test('openPullsQuery searches open PRs of one repo, newest update first', () => {
  assert.strictEqual(openPullsQuery('o', 'r'), 'repo:o/r is:pr is:open sort:updated-desc');
});

test('mapPulls maps a PR and skips non-PR search nodes', () => {
  const [pull, ...rest] = mapPulls(list([pullNode(), {}]));
  assert.strictEqual(rest.length, 0);
  assert.deepStrictEqual(pull, {
    number: 12, title: 'Add x', url: 'https://github.com/o/r/pull/12', draft: false, author: 'octocat',
    headRef: 'feat/x', baseRef: 'main', headSha: A, baseSha: B, updatedAt: '2026-10-02T10:00:00Z',
    checks: 'success', review: 'approved',
  });
});

test('mapPulls: check rollup and review decision variants, missing rollup, deleted author', () => {
  const states = (s: string | null, review: string | null) => mapPulls(list([pullNode({
    reviewDecision: review,
    commits: { nodes: s ? [{ commit: { statusCheckRollup: { state: s } } }] : [{ commit: { statusCheckRollup: null } }] },
  })]))[0];
  assert.strictEqual(states('FAILURE', 'CHANGES_REQUESTED').checks, 'failure');
  assert.strictEqual(states('ERROR', null).checks, 'failure');
  assert.strictEqual(states('PENDING', 'REVIEW_REQUIRED').checks, 'pending');
  assert.strictEqual(states('EXPECTED', null).checks, 'pending');
  assert.strictEqual(states(null, null).checks, 'none');
  assert.strictEqual(states('SUCCESS', 'CHANGES_REQUESTED').review, 'changes');
  assert.strictEqual(states('SUCCESS', 'REVIEW_REQUIRED').review, 'required');
  assert.strictEqual(states('SUCCESS', null).review, 'none');
  assert.strictEqual(mapPulls(list([pullNode({ author: null, commits: { nodes: [] } })]))[0].author, 'ghost');
});

test('mapFiles: statuses collapse to added/removed/renamed/modified and renames keep the old path', () => {
  const files = mapFiles([
    { filename: 'a.ts', status: 'added', additions: 3, deletions: 0 },
    { filename: 'b.ts', status: 'removed', additions: 0, deletions: 4 },
    { filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed', additions: 1, deletions: 1 },
    { filename: 'c.ts', status: 'changed', additions: 2, deletions: 2 },
    { filename: 'd.ts', status: 'copied', additions: 0, deletions: 0 },
  ]);
  assert.deepStrictEqual(files.map(f => f.status), ['added', 'removed', 'renamed', 'modified', 'modified']);
  assert.strictEqual(files[2].oldPath, 'old.ts');
  assert.strictEqual(files[0].oldPath, undefined);
});

test('leftPath reads the old name of a renamed file and is the identity otherwise', () => {
  const files = mapFiles([
    { filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed', additions: 0, deletions: 0 },
    { filename: 'same.ts', status: 'modified', additions: 1, deletions: 0 },
  ]);
  assert.strictEqual(leftPath(files, 'new.ts'), 'old.ts');
  assert.strictEqual(leftPath(files, 'same.ts'), 'same.ts');
  assert.strictEqual(leftPath(files, 'unknown.ts'), 'unknown.ts');
});

const thread = (over: Record<string, unknown> = {}) => ({
  isResolved: false, isOutdated: false, path: 'src/a.ts', line: 10, diffSide: 'RIGHT',
  comments: { nodes: [
    { databaseId: 101, body: 'Why?', createdAt: '2026-10-01T10:00:00Z', author: { login: 'rev', avatarUrl: 'https://x/a.png' } },
    { databaseId: 102, body: 'Because.', createdAt: '2026-10-01T11:00:00Z', author: null },
  ] },
  ...over,
});
const threads = (nodes: unknown[]): ThreadsData => ({ repository: { pullRequest: { reviewThreads: { nodes } } } } as ThreadsData);

test('mapThreads maps comments, side and resolved flag; a deleted author is ghost', () => {
  const [t] = mapThreads(threads([thread({ isResolved: true, diffSide: 'LEFT' })]));
  assert.strictEqual(t.path, 'src/a.ts');
  assert.strictEqual(t.line, 10);
  assert.strictEqual(t.side, 'LEFT');
  assert.strictEqual(t.resolved, true);
  assert.deepStrictEqual(t.comments.map(c => [c.id, c.author]), [[101, 'rev'], [102, 'ghost']]);
});

test('mapThreads skips outdated threads, threads without a current line and threads without comments', () => {
  const result = mapThreads(threads([
    thread({ isOutdated: true }), thread({ line: null }), thread({ comments: { nodes: [] } }), thread(),
  ]));
  assert.strictEqual(result.length, 1);
});

test('mapThreads tolerates a PR that no longer exists', () => {
  assert.deepStrictEqual(mapThreads({ repository: { pullRequest: null } } as ThreadsData), []);
});

test('commentFromRest maps a REST review comment', () => {
  assert.deepStrictEqual(
    commentFromRest({ id: 7, body: 'hi', created_at: '2026-10-01T10:00:00Z', user: { login: 'me', avatar_url: 'https://x/m.png' } }),
    { id: 7, body: 'hi', author: 'me', avatar: 'https://x/m.png', createdAt: '2026-10-01T10:00:00Z' },
  );
});

test('describeFailure: a rate limit says when to retry, anything else keeps its own message', () => {
  const limited = new ApiError('GitHub API 403: rate limit', 403, 1_000_000 + 5 * 60_000);
  assert.strictEqual(describeFailure(limited, 1_000_000), 'GitHub API 403: rate limit. Try again in 5 min.');
  assert.strictEqual(describeFailure(new ApiError('GitHub API 401: Bad credentials', 401), 0), 'GitHub API 401: Bad credentials');
  assert.strictEqual(describeFailure(new Error('boom')), 'boom');
  assert.strictEqual(describeFailure('odd'), 'odd');
});
```

- [ ] **Step 3: Register the test and run it to see it fail**

Add `"src/pulls/pullModel.test.ts"` to `tsconfig.json` `include` and ` out/pulls/pullModel.test.js` to the end of the `node --test` list in `package.json`'s `test` script.

Run: `npm test`
Expected: FAIL — `tsc` reports `Cannot find module './pullModel'`.

- [ ] **Step 4: Write the implementation** — `src/pulls/pullModel.ts`

```ts
'use strict';

import { ApiError } from '../github/githubApi';

export type CheckState = 'success' | 'failure' | 'pending' | 'none';
export type ReviewState = 'approved' | 'changes' | 'required' | 'none';

export interface PullSummary {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  author: string;
  headRef: string;
  baseRef: string;
  headSha: string;
  baseSha: string;
  updatedAt: string;
  checks: CheckState;
  review: ReviewState;
}

export interface PullFile {
  path: string;
  /** Set for renames only: the name on the base side. */
  oldPath?: string;
  status: 'added' | 'removed' | 'renamed' | 'modified';
  additions: number;
  deletions: number;
}

export interface ReviewComment { id: number; body: string; author: string; avatar: string; createdAt: string }
export interface ReviewThread {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  resolved: boolean;
  comments: ReviewComment[];
}

/** Everything the tree needs to show one PR's files and to anchor its comment threads. */
export interface PullDetail {
  repo: { owner: string; repo: string };
  pull: PullSummary;
  /** Left side of every diff: GitHub compares a PR from the merge base, not from the base branch tip. */
  mergeBase: string;
  files: PullFile[];
}

export const LIST_PULLS = `
query ListPulls($q: String!, $first: Int!) {
  search(query: $q, type: ISSUE, first: $first) {
    nodes { ... on PullRequest {
      number title url isDraft updatedAt headRefName baseRefName headRefOid baseRefOid reviewDecision
      author { login }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    } }
  }
}`;

export const REVIEW_THREADS = `
query ReviewThreads($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) { nodes {
        isResolved isOutdated path line diffSide
        comments(first: 50) { nodes { databaseId body createdAt author { login avatarUrl } } }
      } }
    }
  }
}`;

export const openPullsQuery = (owner: string, repo: string): string => `repo:${owner}/${repo} is:pr is:open sort:updated-desc`;

interface GqlUser { login: string; avatarUrl: string }
interface GqlPull {
  number: number; title: string; url: string; isDraft: boolean; updatedAt: string;
  headRefName: string; baseRefName: string; headRefOid: string; baseRefOid: string;
  reviewDecision: string | null;
  author: { login: string } | null;
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> };
}
export interface ListPullsData { search: { nodes: Array<GqlPull | Record<string, never>> } }

const CHECKS: Record<string, CheckState> = {
  SUCCESS: 'success', FAILURE: 'failure', ERROR: 'failure', PENDING: 'pending', EXPECTED: 'pending',
};
const REVIEWS: Record<string, ReviewState> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'required' };

export function mapPulls(data: ListPullsData): PullSummary[] {
  return data.search.nodes
    .filter((n): n is GqlPull => typeof (n as GqlPull).number === 'number')
    .map(n => ({
      number: n.number,
      title: n.title,
      url: n.url,
      draft: n.isDraft,
      author: n.author?.login ?? 'ghost',
      headRef: n.headRefName,
      baseRef: n.baseRefName,
      headSha: n.headRefOid,
      baseSha: n.baseRefOid,
      updatedAt: n.updatedAt,
      checks: CHECKS[n.commits.nodes[0]?.commit.statusCheckRollup?.state ?? ''] ?? 'none',
      review: REVIEWS[n.reviewDecision ?? ''] ?? 'none',
    }));
}

export interface RestFile { filename: string; previous_filename?: string; status: string; additions: number; deletions: number }

export function mapFiles(raw: RestFile[]): PullFile[] {
  return raw.map(f => ({
    path: f.filename,
    ...(f.previous_filename ? { oldPath: f.previous_filename } : {}),
    status: f.status === 'added' || f.status === 'removed' || f.status === 'renamed' ? f.status : 'modified',
    additions: f.additions,
    deletions: f.deletions,
  }));
}

/** The path a file had on the left (merge-base) side; GitHub reports a renamed file's comments under its new name. */
export function leftPath(files: PullFile[], path: string): string {
  return files.find(f => f.path === path)?.oldPath ?? path;
}

interface GqlComment { databaseId: number; body: string; createdAt: string; author: GqlUser | null }
interface GqlThread {
  isResolved: boolean; isOutdated: boolean; path: string; line: number | null; diffSide: 'LEFT' | 'RIGHT';
  comments: { nodes: GqlComment[] };
}
export interface ThreadsData { repository: { pullRequest: { reviewThreads: { nodes: GqlThread[] } } | null } }

export function mapThreads(data: ThreadsData): ReviewThread[] {
  const nodes = data.repository.pullRequest?.reviewThreads.nodes ?? [];
  // ponytail: outdated threads (their line no longer exists in the head) are not shown; surface them
  // on the file's first line, or in the Phase 2 detail page, if that turns out to be missed.
  return nodes
    .filter(t => !t.isOutdated && t.line !== null && t.comments.nodes.length > 0)
    .map(t => ({
      path: t.path,
      line: t.line as number,
      side: t.diffSide,
      resolved: t.isResolved,
      comments: t.comments.nodes.map(c => ({
        id: c.databaseId, body: c.body, author: c.author?.login ?? 'ghost', avatar: c.author?.avatarUrl ?? '', createdAt: c.createdAt,
      })),
    }));
}

export interface RestComment { id: number; body: string; created_at: string; user: { login: string; avatar_url: string } }

export function commentFromRest(c: RestComment): ReviewComment {
  return { id: c.id, body: c.body, author: c.user.login, avatar: c.user.avatar_url, createdAt: c.created_at };
}

/** One line for the tree's status message: GitHub's own explanation, plus when a rate limit lifts. */
export function describeFailure(err: unknown, now: number = Date.now()): string {
  if (err instanceof ApiError && err.retryAt !== null) {
    const minutes = Math.max(1, Math.ceil((err.retryAt - now) / 60_000));
    return `${err.message}. Try again in ${minutes} min.`;
  }
  return err instanceof Error ? err.message : String(err);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test`
Expected: PASS, including the new `pullModel` tests.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-tools/src/pulls extensions/null-tools/src/github/githubApi.ts extensions/null-tools/tsconfig.json extensions/null-tools/package.json
git commit -m "feat(null-tools): pull request model, queries and mappers"
```

---

### Task 2: Virtual-document URIs and blob decoding

**Files:**
- Create: `extensions/null-tools/src/pulls/pullDocs.ts`
- Create: `extensions/null-tools/src/pulls/pullDocs.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Consumes: nothing.
- Produces: `PULL_SCHEME = 'null-pr'`, `DocRef { owner; repo; pull; path; sha; head; side }`, `docQuery(ref: DocRef): string` (query only — the path travels as the URI path), `parseDocQuery(path: string, query: string): DocRef | null`, `decodeBlob(bytes: Buffer): string`.

- [ ] **Step 1: Write the failing test** — `src/pulls/pullDocs.test.ts`

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { DocRef, decodeBlob, docQuery, parseDocQuery } from './pullDocs';

const ref: DocRef = {
  owner: 'TorresVisual', repo: 'null-ide', pull: 12, path: 'src/a b/é.ts',
  sha: 'a'.repeat(40), head: 'b'.repeat(40), side: 'LEFT',
};

test('docQuery / parseDocQuery round-trip, including spaces and unicode in the path', () => {
  assert.deepStrictEqual(parseDocQuery(`/${ref.path}`, docQuery(ref)), ref);
});

test('parseDocQuery rejects a traversal path, dot-only owner/repo, short shas, a bad side and a bad pull number', () => {
  const q = (over: Partial<DocRef>) => docQuery({ ...ref, ...over });
  assert.strictEqual(parseDocQuery('/src/../../etc/passwd', q({})), null);
  assert.strictEqual(parseDocQuery('/', q({})), null);
  assert.strictEqual(parseDocQuery('/a.ts', q({ owner: '..' })), null);
  assert.strictEqual(parseDocQuery('/a.ts', q({ repo: 'a/b' })), null);
  assert.strictEqual(parseDocQuery('/a.ts', q({ sha: 'abc123' })), null);
  assert.strictEqual(parseDocQuery('/a.ts', q({ head: 'z'.repeat(40) })), null);
  assert.strictEqual(parseDocQuery('/a.ts', q({ side: 'MIDDLE' as DocRef['side'] })), null);
  assert.strictEqual(parseDocQuery('/a.ts', q({ pull: 0 })), null);
  assert.strictEqual(parseDocQuery('/a.ts', ''), null);
});

test('decodeBlob returns text as UTF-8 and replaces a binary file with a one-line note', () => {
  assert.strictEqual(decodeBlob(Buffer.from('héllo\n', 'utf8')), 'héllo\n');
  assert.strictEqual(decodeBlob(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])), '(binary file not shown)');
  assert.strictEqual(decodeBlob(Buffer.alloc(0)), '');
});
```

- [ ] **Step 2: Register the test and run it to see it fail**

Add `"src/pulls/pullDocs.test.ts"` to `tsconfig.json` `include` and ` out/pulls/pullDocs.test.js` to the `test` script.

Run: `npm test`
Expected: FAIL — `Cannot find module './pullDocs'`.

- [ ] **Step 3: Write the implementation** — `src/pulls/pullDocs.ts`

```ts
'use strict';

/** URI scheme of one side of a pull-request file; served by `PullContentProvider` from the Contents API. */
export const PULL_SCHEME = 'null-pr';

export interface DocRef {
  owner: string;
  repo: string;
  pull: number;
  /** Repo path of the file on this side (the old name for the left side of a rename). */
  path: string;
  /** The commit whose content this document shows: the merge base (LEFT) or the PR head (RIGHT). */
  sha: string;
  /** The PR head commit; GitHub wants it as `commit_id` when a comment is posted, whichever side it is on. */
  head: string;
  side: 'LEFT' | 'RIGHT';
}

const SHA = /^[0-9a-f]{40}$/;
const NAME = /^[A-Za-z0-9._-]+$/;
const dotsOnly = (s: string): boolean => /^\.+$/.test(s);

/** The query half of the document URI. The path is the URI's own path, so the tab title and language mode come out right. */
export function docQuery(ref: DocRef): string {
  return new URLSearchParams({
    o: ref.owner, r: ref.repo, n: String(ref.pull), s: ref.sha, h: ref.head, d: ref.side,
  }).toString();
}

/** The reference a document URI encodes, or null when anything about it is off (it then never reaches the network). */
export function parseDocQuery(uriPath: string, query: string): DocRef | null {
  const params = new URLSearchParams(query);
  const owner = params.get('o') ?? '';
  const repo = params.get('r') ?? '';
  const pull = Number(params.get('n'));
  const sha = params.get('s') ?? '';
  const head = params.get('h') ?? '';
  const side = params.get('d');
  const path = uriPath.replace(/^\//, '');
  if (!NAME.test(owner) || dotsOnly(owner) || !NAME.test(repo) || dotsOnly(repo)) return null;
  if (!Number.isInteger(pull) || pull <= 0) return null;
  if (!SHA.test(sha) || !SHA.test(head)) return null;
  if (side !== 'LEFT' && side !== 'RIGHT') return null;
  if (!path || path.split('/').some(part => part === '..' || part === '')) return null;
  return { owner, repo, pull, path, sha, head, side };
}

/** File text for the editor. A NUL byte marks a binary file, which would only show as garbage. */
export function decodeBlob(bytes: Buffer): string {
  return bytes.includes(0) ? '(binary file not shown)' : bytes.toString('utf8');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/pulls extensions/null-tools/tsconfig.json extensions/null-tools/package.json
git commit -m "feat(null-tools): pull request document URIs and blob decoding"
```

---

### Task 3: GitHub calls for pull requests

**Files:**
- Create: `extensions/null-tools/src/pulls/pullApi.ts`
- Create: `extensions/null-tools/src/pulls/pullApi.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Consumes: `requestGraphql`, `requestJson` (`../github/githubApi`); everything from Task 1.
- Produces: `listOpenPulls(owner, repo, token): Promise<PullSummary[]>`, `fetchPullFiles(owner, repo, pull, token): Promise<PullFile[]>`, `fetchMergeBase(owner, repo, baseSha, headSha, token): Promise<string>`, `fetchReviewThreads(owner, repo, pull, token): Promise<ReviewThread[]>`, `createLineComment(owner, repo, pull, input: { body; commitId; path; line; side }, token): Promise<ReviewComment>`, `replyToComment(owner, repo, pull, commentId, body, token): Promise<ReviewComment>`.

- [ ] **Step 1: Write the failing test** — `src/pulls/pullApi.test.ts`

```ts
'use strict';

import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import test, { afterEach, mock } from 'node:test';
import { createLineComment, fetchMergeBase, fetchPullFiles, fetchReviewThreads, listOpenPulls, replyToComment } from './pullApi';

afterEach(() => mock.restoreAll());

interface Call { url: string; method: string; body?: any }

/** Answers each https.request with the next canned response (the last one repeats) and records what was asked. */
function stub(responses: unknown[]): Call[] {
  const calls: Call[] = [];
  mock.method(https, 'request', (url: string, opts: { method: string }, onResponse: (res: unknown) => void) => {
    const call: Call = { url, method: opts.method };
    calls.push(call);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return Object.assign(new EventEmitter(), {
      setTimeout() {}, destroy() {},
      write(payload: string) { call.body = JSON.parse(payload); },
      end() {
        const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, setEncoding() {} });
        onResponse(res);
        res.emit('data', JSON.stringify(next));
        res.emit('end');
      },
    });
  });
  return calls;
}

const restFile = (i: number) => ({ filename: `f${i}.ts`, status: 'modified', additions: 1, deletions: 0 });

test('listOpenPulls asks for this repo\'s open PRs', async () => {
  const calls = stub([{ data: { search: { nodes: [] } } }]);
  assert.deepStrictEqual(await listOpenPulls('o', 'r', 't'), []);
  assert.strictEqual(calls[0].url, 'https://api.github.com/graphql');
  assert.strictEqual(calls[0].body.variables.q, 'repo:o/r is:pr is:open sort:updated-desc');
});

test('fetchPullFiles pages until a short page, so a PR with more than 100 files is not cut off', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => restFile(i));
  const calls = stub([page1, [restFile(100)]]);
  const files = await fetchPullFiles('o', 'r', 5, 't');
  assert.strictEqual(files.length, 101);
  assert.deepStrictEqual(calls.map(c => c.url), [
    'https://api.github.com/repos/o/r/pulls/5/files?per_page=100&page=1',
    'https://api.github.com/repos/o/r/pulls/5/files?per_page=100&page=2',
  ]);
});

test('fetchMergeBase returns the merge-base commit of base...head', async () => {
  const calls = stub([{ merge_base_commit: { sha: 'c'.repeat(40) } }]);
  assert.strictEqual(await fetchMergeBase('o', 'r', 'a'.repeat(40), 'b'.repeat(40), 't'), 'c'.repeat(40));
  assert.strictEqual(calls[0].url, `https://api.github.com/repos/o/r/compare/${'a'.repeat(40)}...${'b'.repeat(40)}?per_page=1`);
});

test('fetchReviewThreads sends owner, name and number', async () => {
  const calls = stub([{ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } }]);
  assert.deepStrictEqual(await fetchReviewThreads('o', 'r', 5, 't'), []);
  assert.deepStrictEqual(calls[0].body.variables, { owner: 'o', name: 'r', number: 5 });
});

const posted = { id: 9, body: 'ok', created_at: '2026-10-01T10:00:00Z', user: { login: 'me', avatar_url: 'u' } };

test('createLineComment posts a single-line review comment on the head commit', async () => {
  const calls = stub([posted]);
  const c = await createLineComment('o', 'r', 5, { body: 'ok', commitId: 'b'.repeat(40), path: 'a.ts', line: 3, side: 'RIGHT' }, 't');
  assert.strictEqual(c.id, 9);
  assert.strictEqual(calls[0].method, 'POST');
  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/pulls/5/comments');
  assert.deepStrictEqual(calls[0].body, { body: 'ok', commit_id: 'b'.repeat(40), path: 'a.ts', line: 3, side: 'RIGHT' });
});

test('replyToComment posts to the thread\'s first comment', async () => {
  const calls = stub([posted]);
  await replyToComment('o', 'r', 5, 101, 'thanks', 't');
  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/o/r/pulls/5/comments/101/replies');
  assert.deepStrictEqual(calls[0].body, { body: 'thanks' });
});
```

- [ ] **Step 2: Register the test and run it to see it fail**

Add `"src/pulls/pullApi.test.ts"` to `tsconfig.json` `include` and ` out/pulls/pullApi.test.js` to the `test` script.

Run: `npm test`
Expected: FAIL — `Cannot find module './pullApi'`.

- [ ] **Step 3: Write the implementation** — `src/pulls/pullApi.ts`

```ts
'use strict';

import { requestGraphql, requestJson } from '../github/githubApi';
import {
  LIST_PULLS, ListPullsData, PullFile, PullSummary, REVIEW_THREADS, RestComment, RestFile, ReviewComment, ReviewThread,
  ThreadsData, commentFromRest, mapFiles, mapPulls, mapThreads, openPullsQuery,
} from './pullModel';

// ponytail: the 50 most recently updated open PRs; add cursor paging (like the issues list) if a repo has more.
export async function listOpenPulls(owner: string, repo: string, token: string | null): Promise<PullSummary[]> {
  return mapPulls(await requestGraphql<ListPullsData>(LIST_PULLS, { q: openPullsQuery(owner, repo), first: 50 }, token));
}

/** All changed files. GitHub caps a PR at 3000 files, i.e. 30 pages of 100. */
export async function fetchPullFiles(owner: string, repo: string, pull: number, token: string | null): Promise<PullFile[]> {
  const all: RestFile[] = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await requestJson<RestFile[]>(`/repos/${owner}/${repo}/pulls/${pull}/files?per_page=100&page=${page}`, token);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return mapFiles(all);
}

export async function fetchMergeBase(owner: string, repo: string, baseSha: string, headSha: string, token: string | null): Promise<string> {
  const cmp = await requestJson<{ merge_base_commit: { sha: string } }>(
    `/repos/${owner}/${repo}/compare/${baseSha}...${headSha}?per_page=1`, token);
  return cmp.merge_base_commit.sha;
}

export async function fetchReviewThreads(owner: string, repo: string, pull: number, token: string | null): Promise<ReviewThread[]> {
  return mapThreads(await requestGraphql<ThreadsData>(REVIEW_THREADS, { owner, name: repo, number: pull }, token));
}

export interface LineCommentInput { body: string; commitId: string; path: string; line: number; side: 'LEFT' | 'RIGHT' }

// ponytail: posts at once and on one line. Phase 3 adds pending reviews and multi-line ranges (start_line/start_side).
export async function createLineComment(
  owner: string, repo: string, pull: number, input: LineCommentInput, token: string | null,
): Promise<ReviewComment> {
  const created = await requestJson<RestComment>(`/repos/${owner}/${repo}/pulls/${pull}/comments`, token, 'POST', {
    body: input.body, commit_id: input.commitId, path: input.path, line: input.line, side: input.side,
  });
  return commentFromRest(created);
}

export async function replyToComment(
  owner: string, repo: string, pull: number, commentId: number, body: string, token: string | null,
): Promise<ReviewComment> {
  const created = await requestJson<RestComment>(
    `/repos/${owner}/${repo}/pulls/${pull}/comments/${commentId}/replies`, token, 'POST', { body });
  return commentFromRest(created);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/pulls extensions/null-tools/tsconfig.json extensions/null-tools/package.json
git commit -m "feat(null-tools): GitHub pull request API calls"
```

---

### Task 4: Checkout a PR branch

**Files:**
- Create: `extensions/null-tools/src/pulls/pullCheckout.ts`
- Create: `extensions/null-tools/src/pulls/pullCheckout.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Consumes: `RunGit` from `../graph/gitRun`.
- Produces: `pullBranch(n: number): string` (`pr-<n>`), `checkoutPull(run: RunGit, n: number): Promise<{ ok: true; branch: string } | { ok: false; message: string }>`.

- [ ] **Step 1: Write the failing test** — `src/pulls/pullCheckout.test.ts`

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeRunGit } from '../graph/gitRun';
import { checkoutPull, pullBranch } from './pullCheckout';

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function identity(dir: string): void {
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
}

function commit(dir: string, file: string, content: string): string {
  writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '--', file);
  git(dir, 'commit', '-q', '-m', `edit ${file}`);
  return git(dir, 'rev-parse', 'HEAD');
}

/** A bare `origin`, an `author` clone that publishes `refs/pull/<n>/head` the way GitHub does, and the `reader` that checks out. */
function setup(): { author: string; reader: string; publish: (n: number) => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'pull-checkout-'));
  const origin = path.join(root, 'origin.git');
  const author = path.join(root, 'author');
  const reader = path.join(root, 'reader');
  git(root, 'init', '-q', '--bare', '--initial-branch=main', origin);
  git(root, 'init', '-q', '--initial-branch=main', author);
  identity(author);
  git(author, 'remote', 'add', 'origin', origin);
  commit(author, 'a.txt', '1');
  git(author, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(root, 'clone', '-q', origin, reader);
  identity(reader);
  return { author, reader, publish: (n) => git(author, 'push', '-q', '--force', 'origin', `HEAD:refs/pull/${n}/head`) };
}

test('pullBranch names the local branch pr-<n>', () => {
  assert.strictEqual(pullBranch(42), 'pr-42');
});

test('checkoutPull creates pr-<n> at the PR head, then fast-forwards it when the PR gains commits', async () => {
  const { author, reader, publish } = setup();
  const first = commit(author, 'b.txt', 'b');
  publish(7);
  const run = makeRunGit(reader);

  assert.deepStrictEqual(await checkoutPull(run, 7), { ok: true, branch: 'pr-7' });
  assert.strictEqual(git(reader, 'rev-parse', '--abbrev-ref', 'HEAD'), 'pr-7');
  assert.strictEqual(git(reader, 'rev-parse', 'HEAD'), first);

  const second = commit(author, 'b.txt', 'bb');
  publish(7);
  assert.strictEqual((await checkoutPull(run, 7)).ok, true);
  assert.strictEqual(git(reader, 'rev-parse', 'HEAD'), second);
});

test('checkoutPull: a diverged local branch is left alone', async () => {
  const { author, reader, publish } = setup();
  commit(author, 'b.txt', 'b');
  publish(7);
  const run = makeRunGit(reader);
  await checkoutPull(run, 7);
  const mine = commit(reader, 'mine.txt', 'local work');
  commit(author, 'b.txt', 'bb');
  publish(7);

  const result = await checkoutPull(run, 7);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(git(reader, 'rev-parse', 'HEAD'), mine);
});

test('checkoutPull: a PR that does not exist is a failure with git\'s message', async () => {
  const { reader } = setup();
  const result = await checkoutPull(makeRunGit(reader), 99);
  assert.strictEqual(result.ok, false);
  assert.ok(!result.ok && result.message.length > 0);
});
```

- [ ] **Step 2: Register the test and run it to see it fail**

Add `"src/pulls/pullCheckout.test.ts"` to `tsconfig.json` `include` and ` out/pulls/pullCheckout.test.js` to the `test` script.

Run: `npm test`
Expected: FAIL — `Cannot find module './pullCheckout'`.

- [ ] **Step 3: Write the implementation** — `src/pulls/pullCheckout.ts`

```ts
'use strict';

import type { RunGit } from '../graph/gitRun';

export type CheckoutResult = { ok: true; branch: string } | { ok: false; message: string };

export const pullBranch = (n: number): string => `pr-${n}`;

/**
 * Checks PR `n` out as the local branch `pr-<n>`. `pull/<n>/head` is served by GitHub for fork PRs too.
 * An existing `pr-<n>` is only ever fast-forwarded, so the user's own commits on it are never lost;
 * a dirty tree makes `git checkout` refuse by itself.
 */
export async function checkoutPull(run: RunGit, n: number): Promise<CheckoutResult> {
  const branch = pullBranch(n);
  try {
    await run(['fetch', 'origin', `pull/${n}/head`]);
    const exists = await run(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(() => true, () => false);
    if (!exists) {
      await run(['checkout', '-b', branch, 'FETCH_HEAD']);
    } else {
      await run(['checkout', branch]);
      await run(['merge', '--ff-only', 'FETCH_HEAD']);
    }
    return { ok: true, branch };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS (the checkout tests spawn real `git`).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/pulls extensions/null-tools/tsconfig.json extensions/null-tools/package.json
git commit -m "feat(null-tools): check out a pull request branch"
```

---

### Task 5: Tree, diff, comments and registration

No new unit tests: everything with logic is already covered above, and these files only wire `vscode` APIs (verified end to end in Task 6).

**Files:**
- Modify: `extensions/null-tools/src/graph/graphDiff.ts` (export `emptyDocUri`)
- Create: `extensions/null-tools/src/pulls/pullContentProvider.ts`
- Create: `extensions/null-tools/src/pulls/pullDiff.ts`
- Create: `extensions/null-tools/src/pulls/pullReview.ts`
- Create: `extensions/null-tools/src/pulls/pullsTreeView.ts`
- Create: `extensions/null-tools/src/pulls/pullsIntegration.ts`
- Modify: `extensions/null-tools/src/extension.ts` (register the feature)
- Modify: `extensions/null-tools/package.json` (`contributes`)

**Interfaces:**
- Consumes: everything from Tasks 1–4; `getGithubSession` (`../github/githubAuth`), `getWorkspaceGithubRepo` (`../github/githubRemote`), `fetchRepoFile` (`../github/githubApi`), `makeRunGit` (`../graph/gitRun`).
- Produces: `registerPullsFeature(context)`; view `null.pullsView`; commands `null.pulls.refresh`, `null.pulls.checkout`, `null.pulls.openOnGitHub`, `null.pulls.openFileDiff`, `null.pulls.comment`.

- [ ] **Step 1: Share the empty-document URI** — in `src/graph/graphDiff.ts`, add below `registerEmptyDocument` and use it in `openFileDiff`

```ts
/** URI of the empty document standing in for the missing side of an added or deleted file. */
export function emptyDocUri(filePath: string): vscode.Uri {
  return vscode.Uri.from({ scheme: EMPTY_SCHEME, path: `/${filePath}` });
}
```

and replace the line `const empty = vscode.Uri.from({ scheme: EMPTY_SCHEME, path: \`/${file.path}\` });` in `openFileDiff` with `const empty = emptyDocUri(file.path);`.

- [ ] **Step 2: Content provider** — `src/pulls/pullContentProvider.ts`

```ts
'use strict';

import * as vscode from 'vscode';
import { fetchRepoFile } from '../github/githubApi';
import { getGithubSession } from '../github/githubAuth';
import { decodeBlob, parseDocQuery } from './pullDocs';

const MAX_BYTES = 5 * 1024 * 1024;

/** Serves `null-pr:` documents: a file as it was at the merge base or at the PR head, straight from GitHub. */
export class PullContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const ref = parseDocQuery(uri.path, uri.query);
    if (!ref) return '';
    const session = await getGithubSession(false);
    const { bytes } = await fetchRepoFile(ref.owner, ref.repo, ref.sha, ref.path, session?.accessToken ?? null, MAX_BYTES);
    return decodeBlob(bytes);
  }
}
```

- [ ] **Step 3: Diff opener and URI builder** — `src/pulls/pullDiff.ts`

```ts
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { emptyDocUri } from '../graph/graphDiff';
import { DocRef, PULL_SCHEME, docQuery } from './pullDocs';
import { PullDetail, PullFile, leftPath } from './pullModel';

export function pullDocUri(ref: DocRef): vscode.Uri {
  return vscode.Uri.from({ scheme: PULL_SCHEME, path: `/${ref.path}`, query: docQuery(ref) });
}

/** The document for one side of `filePath`. Diffs and comment threads both build their URIs here, so they always match. */
export function sideUri(detail: PullDetail, filePath: string, side: 'LEFT' | 'RIGHT'): vscode.Uri {
  return pullDocUri({
    ...detail.repo,
    pull: detail.pull.number,
    path: side === 'LEFT' ? leftPath(detail.files, filePath) : filePath,
    sha: side === 'LEFT' ? detail.mergeBase : detail.pull.headSha,
    head: detail.pull.headSha,
    side,
  });
}

export async function openPullFileDiff(detail: PullDetail, file: PullFile): Promise<void> {
  const left = file.status === 'added' ? emptyDocUri(file.path) : sideUri(detail, file.path, 'LEFT');
  const right = file.status === 'removed' ? emptyDocUri(file.path) : sideUri(detail, file.path, 'RIGHT');
  await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(file.path)} (#${detail.pull.number})`);
}
```

- [ ] **Step 4: Comment controller** — `src/pulls/pullReview.ts`

```ts
'use strict';

import * as vscode from 'vscode';
import { createLineComment, replyToComment } from './pullApi';
import { getGithubSession } from '../github/githubAuth';
import { PULL_SCHEME, parseDocQuery } from './pullDocs';
import { PullDetail, ReviewComment, ReviewThread, describeFailure } from './pullModel';
import { sideUri } from './pullDiff';

function toComment(c: ReviewComment): vscode.Comment {
  return {
    body: new vscode.MarkdownString(c.body),
    mode: vscode.CommentMode.Preview,
    author: { name: c.author, iconPath: c.avatar ? vscode.Uri.parse(c.avatar) : undefined },
  };
}

/** Review threads of the PRs the tree has opened, shown in the diff editors, plus posting new comments and replies. */
export class PullReview implements vscode.Disposable {
  private readonly controller = vscode.comments.createCommentController('null.pulls', 'Pull Request Review');
  private readonly byPull = new Map<number, vscode.CommentThread[]>();
  /** First comment of each existing thread: GitHub replies hang off it. */
  private readonly roots = new WeakMap<vscode.CommentThread, number>();

  constructor() {
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: doc =>
        doc.uri.scheme === PULL_SCHEME && parseDocQuery(doc.uri.path, doc.uri.query)
          ? [new vscode.Range(0, 0, Math.max(doc.lineCount - 1, 0), 0)]
          : undefined,
    };
  }

  /** (Re)shows `threads` for one PR. GitHub rejects a comment on a line outside the diff; the error is shown as is. */
  show(detail: PullDetail, threads: ReviewThread[]): void {
    this.drop(detail.pull.number);
    const shown = threads.map(t => {
      const line = t.line - 1;
      const thread = this.controller.createCommentThread(sideUri(detail, t.path, t.side), new vscode.Range(line, 0, line, 0), t.comments.map(toComment));
      thread.canReply = true;
      thread.state = t.resolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
      thread.collapsibleState = t.resolved ? vscode.CommentThreadCollapsibleState.Collapsed : vscode.CommentThreadCollapsibleState.Expanded;
      this.roots.set(thread, t.comments[0].id);
      return thread;
    });
    this.byPull.set(detail.pull.number, shown);
  }

  clear(): void {
    for (const n of [...this.byPull.keys()]) this.drop(n);
  }

  private drop(pull: number): void {
    for (const thread of this.byPull.get(pull) ?? []) thread.dispose();
    this.byPull.delete(pull);
  }

  /** Command handler for the thread's submit button: a reply on an existing thread, otherwise a new line comment. */
  async submit(reply: vscode.CommentReply): Promise<void> {
    const { thread, text } = reply;
    const ref = parseDocQuery(thread.uri.path, thread.uri.query);
    if (!ref || !text.trim()) return;
    const session = await getGithubSession(true);
    if (!session) return;
    try {
      const root = this.roots.get(thread);
      const posted = root === undefined
        ? await createLineComment(ref.owner, ref.repo, ref.pull, {
          body: text, commitId: ref.head, path: ref.path, line: (thread.range?.start.line ?? 0) + 1, side: ref.side,
        }, session.accessToken)
        : await replyToComment(ref.owner, ref.repo, ref.pull, root, text, session.accessToken);
      if (root === undefined) {
        this.roots.set(thread, posted.id);
        thread.canReply = true;
      }
      thread.comments = [...thread.comments, toComment(posted)];
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not post the comment: ${describeFailure(err)}`);
    }
  }

  dispose(): void {
    this.clear();
    this.controller.dispose();
  }
}
```

Known limit, deliberately left: a *new* comment on the left side of a renamed file posts the old name as `path`, which GitHub rejects with a 422 that the error toast shows. Existing threads on renamed files display correctly (Task 1 `leftPath`). Add a `ponytail:` comment above the `createLineComment` call in `submit` saying so; fix it by carrying the current path in `DocRef` if it is ever hit.

- [ ] **Step 5: Tree provider** — `src/pulls/pullsTreeView.ts`

```ts
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { getGithubSession } from '../github/githubAuth';
import { getWorkspaceGithubRepo } from '../github/githubRemote';
import { fetchMergeBase, fetchPullFiles, fetchReviewThreads, listOpenPulls } from './pullApi';
import { PullDetail, PullFile, PullSummary, describeFailure } from './pullModel';
import { PullReview } from './pullReview';

export type PullNode = { kind: 'pull'; pull: PullSummary } | { kind: 'file'; detail: PullDetail; file: PullFile };

const CHECK_COLORS = { success: 'charts.green', failure: 'charts.red', pending: 'charts.yellow', none: undefined } as const;

export class PullsTreeProvider implements vscode.TreeDataProvider<PullNode> {
  private readonly emitter = new vscode.EventEmitter<PullNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private pulls: PullSummary[] = [];
  private readonly details = new Map<number, Promise<PullDetail>>();
  private repo: { owner: string; repo: string } | null = null;
  private token: string | null = null;

  loaded = false;
  /** The tree's one-line status (empty list, rate limit, …); undefined while the list is showing. */
  onMessage: (message: string | undefined) => void = () => undefined;

  constructor(private readonly review: PullReview) {}

  async refresh(): Promise<void> {
    this.loaded = true;
    this.details.clear();
    this.review.clear();
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.repo = folder ? getWorkspaceGithubRepo(folder) : null;
    const session = this.repo ? await getGithubSession(false) : undefined;
    this.token = session?.accessToken ?? null;
    this.pulls = [];
    let message: string | undefined;
    const state = !this.repo ? 'no-repo' : !session ? 'signed-out' : 'ready';
    void vscode.commands.executeCommand('setContext', 'null.pulls.state', state);
    if (this.repo && session) {
      try {
        this.pulls = await listOpenPulls(this.repo.owner, this.repo.repo, session.accessToken);
        if (this.pulls.length === 0) message = 'No open pull requests.';
      } catch (err) {
        message = describeFailure(err);
      }
    }
    this.onMessage(message);
    this.emitter.fire(undefined);
  }

  getTreeItem(node: PullNode): vscode.TreeItem {
    if (node.kind === 'file') {
      const { file } = node;
      const item = new vscode.TreeItem(vscode.Uri.file(file.path), vscode.TreeItemCollapsibleState.None);
      const dir = path.posix.dirname(file.path);
      item.description = `${dir === '.' ? '' : `${dir}  `}+${file.additions} −${file.deletions}`;
      item.tooltip = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
      item.contextValue = 'pullFile';
      item.id = `pull-${node.detail.pull.number}-${file.path}`;
      item.command = { command: 'null.pulls.openFileDiff', title: 'Open Diff', arguments: [node] };
      return item;
    }
    const { pull } = node;
    const item = new vscode.TreeItem(`#${pull.number} ${pull.title}`, vscode.TreeItemCollapsibleState.Collapsed);
    const color = CHECK_COLORS[pull.checks];
    item.iconPath = new vscode.ThemeIcon(pull.draft ? 'git-pull-request-draft' : 'git-pull-request', color ? new vscode.ThemeColor(color) : undefined);
    item.description = `${pull.author} · ${pull.headRef} → ${pull.baseRef}`;
    const checks = pull.checks === 'none' ? 'no checks' : `checks ${pull.checks}`;
    const review = pull.review === 'none' ? '' : ` · ${pull.review === 'changes' ? 'changes requested' : pull.review}`;
    item.tooltip = `${pull.title}\n#${pull.number} by ${pull.author}${pull.draft ? ' (draft)' : ''}\n${checks}${review}`;
    item.contextValue = 'pull';
    item.id = `pull-${pull.number}`;
    return item;
  }

  async getChildren(node?: PullNode): Promise<PullNode[]> {
    if (!node) return this.pulls.map(pull => ({ kind: 'pull', pull }));
    if (node.kind === 'file') return [];
    try {
      const detail = await this.detail(node.pull);
      return detail.files.map(file => ({ kind: 'file', detail, file }));
    } catch (err) {
      this.details.delete(node.pull.number);
      void vscode.window.showErrorMessage(`Could not load #${node.pull.number}: ${describeFailure(err)}`);
      return [];
    }
  }

  private detail(pull: PullSummary): Promise<PullDetail> {
    let cached = this.details.get(pull.number);
    if (!cached) {
      cached = this.load(pull);
      this.details.set(pull.number, cached);
    }
    return cached;
  }

  private async load(pull: PullSummary): Promise<PullDetail> {
    const repo = this.repo;
    if (!repo) throw new Error('This folder has no GitHub remote.');
    const [files, mergeBase, threads] = await Promise.all([
      fetchPullFiles(repo.owner, repo.repo, pull.number, this.token),
      fetchMergeBase(repo.owner, repo.repo, pull.baseSha, pull.headSha, this.token),
      fetchReviewThreads(repo.owner, repo.repo, pull.number, this.token),
    ]);
    const detail: PullDetail = { repo, pull, mergeBase, files };
    this.review.show(detail, threads);
    return detail;
  }
}
```

- [ ] **Step 6: Registration** — `src/pulls/pullsIntegration.ts`

```ts
'use strict';

import * as vscode from 'vscode';
import { getAccountsApi } from '../github/githubAuth';
import { makeRunGit } from '../graph/gitRun';
import { checkoutPull } from './pullCheckout';
import { PullContentProvider } from './pullContentProvider';
import { PULL_SCHEME } from './pullDocs';
import { openPullFileDiff } from './pullDiff';
import { PullReview } from './pullReview';
import { PullNode, PullsTreeProvider } from './pullsTreeView';

export function registerPullsFeature(context: vscode.ExtensionContext): void {
  const review = new PullReview();
  const tree = new PullsTreeProvider(review);
  const view = vscode.window.createTreeView<PullNode>('null.pullsView', { treeDataProvider: tree });
  tree.onMessage = message => { view.message = message; };

  async function checkout(node: PullNode): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (node.kind !== 'pull' || !cwd) return;
    const { number } = node.pull;
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Checking out pull request #${number}…` },
      () => checkoutPull(makeRunGit(cwd, 60_000), number),
    );
    if (result.ok) void vscode.window.showInformationMessage(`On branch ${result.branch}.`);
    else void vscode.window.showErrorMessage(`Could not check out #${number}: ${result.message}`);
  }

  context.subscriptions.push(
    review,
    view,
    vscode.workspace.registerTextDocumentContentProvider(PULL_SCHEME, new PullContentProvider()),
    vscode.commands.registerCommand('null.pulls.refresh', () => tree.refresh()),
    vscode.commands.registerCommand('null.pulls.checkout', checkout),
    vscode.commands.registerCommand('null.pulls.openOnGitHub', (node: PullNode) => {
      if (node.kind === 'pull') void vscode.env.openExternal(vscode.Uri.parse(node.pull.url));
    }),
    vscode.commands.registerCommand('null.pulls.openFileDiff', (node: PullNode) => {
      if (node.kind === 'file') return openPullFileDiff(node.detail, node.file);
    }),
    vscode.commands.registerCommand('null.pulls.comment', (reply: vscode.CommentReply) => review.submit(reply)),
    view.onDidChangeVisibility(e => { if (e.visible && !tree.loaded) void tree.refresh(); }),
  );
  if (view.visible) void tree.refresh();

  // Binding or importing an account must show up without a manual refresh.
  const accountsChanged = getAccountsApi()?.onDidChange(() => void tree.refresh());
  if (accountsChanged) context.subscriptions.push(accountsChanged);
}
```

In `src/extension.ts` add `import { registerPullsFeature } from './pulls/pullsIntegration';` next to the other feature imports and call `registerPullsFeature(context);` right after `registerIssuesPanelFeature(context);`.

- [ ] **Step 7: Contributions** — in `package.json` `contributes`:

`views."null-issues"` — append after the `null.issuesView` entry:

```json
{ "id": "null.pullsView", "name": "Pull Requests", "visibility": "visible" }
```

`commands` — append:

```json
{ "command": "null.pulls.refresh", "title": "Null: Refresh Pull Requests", "icon": "$(refresh)" },
{ "command": "null.pulls.checkout", "title": "Null: Check Out Pull Request", "icon": "$(git-branch)" },
{ "command": "null.pulls.openOnGitHub", "title": "Null: Open Pull Request on GitHub", "icon": "$(link-external)" },
{ "command": "null.pulls.openFileDiff", "title": "Null: Open Pull Request File Diff" },
{ "command": "null.pulls.comment", "title": "Comment" }
```

`menus."view/title"` — append `{ "command": "null.pulls.refresh", "when": "view == null.pullsView", "group": "navigation" }`.

`menus."view/item/context"` — append:

```json
{ "command": "null.pulls.checkout", "when": "view == null.pullsView && viewItem == pull", "group": "inline@1" },
{ "command": "null.pulls.openOnGitHub", "when": "view == null.pullsView && viewItem == pull", "group": "inline@2" },
{ "command": "null.pulls.checkout", "when": "view == null.pullsView && viewItem == pull", "group": "1_pull@1" },
{ "command": "null.pulls.openOnGitHub", "when": "view == null.pullsView && viewItem == pull", "group": "1_pull@2" }
```

`menus` — add a new key (the Comments API submit button):

```json
"comments/commentThread/context": [
  { "command": "null.pulls.comment", "when": "commentController == null.pulls", "group": "inline" }
]
```

`menus.commandPalette` — hide the two commands that need an argument:

```json
{ "command": "null.pulls.openFileDiff", "when": "false" },
{ "command": "null.pulls.comment", "when": "false" }
```

`viewsWelcome` — append:

```json
{ "view": "null.pullsView", "contents": "The open folder has no GitHub remote.", "when": "null.pulls.state == no-repo" },
{ "view": "null.pullsView", "contents": "Sign in to GitHub to see this repository's pull requests.\n[Sign In](command:null.issues.signIn)", "when": "null.pulls.state == signed-out" }
```

- [ ] **Step 8: Compile and run the unit tests**

Run: `npm run compile && npm test`
Expected: both succeed with no TypeScript errors. If `thread.range` is typed `Range | undefined` in the installed `@types/vscode`, the `?.` in `pullReview.ts` already handles it; if it is non-optional, drop the `?.`/`?? 0`.

- [ ] **Step 9: Commit**

```bash
git add extensions/null-tools/src extensions/null-tools/package.json
git commit -m "feat(null-tools): pull requests tree, diffs and inline review comments"
```

---

### Task 6: Verify in the real app, document, refresh output

**Files:**
- Modify: `extensions/null-tools/CLAUDE.md` (add a feature row)
- Modify: `extensions/null-tools/out/**` (compiled, via `npm run compile`)

- [ ] **Step 1: Verify in the real app** — run the `/verify-local` skill for `null-tools` (it syncs into the installed Null IDE and reloads), open a folder whose `origin` is a GitHub repo you can comment on, then check each:

1. Open the **GitHub Issues** activity-bar container: a **Pull Requests** view lists open PRs with a green/red/yellow icon for checks and a draft icon for drafts.
2. Expand a PR: changed files appear with `+n −m`. Click one: a diff opens, left = merge base, right = head. An **added** file shows an empty left, a **removed** file an empty right, a **renamed** file's left side is the old name's content.
3. A PR that already has review comments shows them as threads in the right place; resolved ones are collapsed. Reply to one: the reply appears in the thread and on github.com.
4. Click the `+` gutter icon on a changed line, type a comment, submit: it appears on github.com. Try a line outside the diff: the 422 text from GitHub appears in an error toast, nothing is added.
5. **Fork PR** (from someone else's fork, or your own fork): expand it and open a file. If the right side fails to load (404), the head commit is not reachable through the base repo's Contents API: replace `fetchRepoFile` in `PullContentProvider` with `git fetch origin pull/<n>/head` once per PR plus `git show <sha>:<path>`, and record that in the spec's limits section. If it loads, delete that bullet from the spec.
6. Inline **checkout** button on a PR: you land on `pr-<n>`. Check out a PR with a dirty working tree: git's refusal is shown. Run it again after the PR gains a commit: the branch fast-forwards.
7. Signed out (`null-accounts` has no GitHub account for the folder): the view shows the sign-in welcome text and no toasts. A folder without a GitHub remote shows the no-remote text.

- [ ] **Step 2: Document the feature** — in `extensions/null-tools/CLAUDE.md` add a table row after "GitHub Issues panel":

```
| **Pull Requests** | `src/pulls/` (#92, phase 1 of #117): the `null.pullsView` tree in the `null-issues` container lists the 50 most recently updated open PRs (CI/draft icon from one GraphQL search); a PR expands to its changed files, which open in `vscode.diff` between the merge base and the head. File text comes from the Contents API through the `null-pr:` content provider (`pullContentProvider.ts`, URIs built and validated by `pullDocs.ts`), not from git. Review threads and new line comments use the Comments API (`pullReview.ts`; comments post at once, one line, until pending reviews land in phase 3). Checkout (`pullCheckout.ts`) fetches `pull/<n>/head` into `pr-<n>` and only ever fast-forwards it. Pure: `pullModel.ts`, `pullDocs.ts`; `pullApi.ts` wraps `requestGraphql`/`requestJson`. GitHub only. Design `docs/specs/pull-requests-design.md`; plan `docs/plans/pull-requests-phase1-review.md` |
```

- [ ] **Step 3: Refresh compiled output, update the graph, commit**

```bash
cd extensions/null-tools && npm run compile && cd ../..
graphify update .
git add extensions/null-tools/CLAUDE.md docs/specs/pull-requests-design.md
git commit -m "docs(null-tools): document the pull requests view"
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output"
```

(If step 1.5 changed the fork-PR approach, include that code change in its own `fix(null-tools): …` commit before these.)

- [ ] **Step 4: Close the loop on GitHub** — comment on #92 with the commit range and the manual-verification result, and close it; comment on #117 "Phase 1 shipped via #92; phases 2–6 tracked in `docs/specs/pull-requests-design.md`" and keep it open. (Ask first: these are outward-facing.)

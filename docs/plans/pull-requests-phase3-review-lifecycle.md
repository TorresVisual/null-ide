# Pull Requests Phase 3 — Review Lifecycle & Actions Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** In `null-tools`, let a user review a pull request without leaving the editor: collect line comments into a pending review and submit it (comment / approve / request changes), resolve and reopen threads, and merge, close/reopen or flip draft ↔ ready from the PR detail tab (phase 3 of umbrella #117).

**Architecture:** Three independent layers in `src/pulls/`. *Pure rules* (`pullActionsModel.ts`): what the viewer may do with a page, the review choices and when a review body is required. *GraphQL mutations* (`pullReviewApi.ts`, `pullLifecycleApi.ts`), tested against a mocked `https.request`. *`vscode` glue*: `pullReview.ts` gains an **Add Review Comment** button and resolve/unresolve thread buttons; `pullActions.ts` holds the native flows (QuickPick / InputBox / modal confirm) that the detail tab and the tree both call. The detail tab gets an action row; it stays a thin renderer because the host computes `PullPage.actions` and re-checks it before every write. A pending review is never cached locally: every action asks GitHub for it first.

**Tech Stack:** TypeScript (commonjs host, `module: none` webview bundle), `node:test` with a mocked `https.request`, VS Code Comments API / QuickPick / InputBox / WebviewPanel, GitHub GraphQL.

**Spec:** `docs/specs/pull-requests-design.md` (Phase 3 row, decisions 1–23). Decisions 24–32 below were made while writing this plan and are appended to the spec in Task 8; **confirm them before executing**.

## Decisions made for this plan (not yet in the spec)

24. **Two buttons in the diff comment widget.** **Add Review Comment** (primary) puts the comment in the viewer's pending review, starting one on first use; **Comment Now** is the existing immediate post (renamed from *Comment*, behaviour unchanged). Pending comments carry the label `Pending` and are visible only to their author, as on github.com.
25. **The pending review is read from GitHub every time** (`ReviewState`), never kept in memory: a review submitted or deleted on github.com in the meantime cannot go stale. A viewer has at most one pending review per PR.
26. **Finish review = one QuickPick + one InputBox.** Choices: *Comment*, *Approve*, *Request changes* (the last two hidden on your own PR) and *Discard pending review* (only when one exists). The body is single-line (the InputBox's limit); it is required for *Request changes*, and for *Comment* when no comments are pending. With no pending review the chosen event submits a body-only review in one call.
27. **Resolve / Unresolve** is a button in the thread's title bar, offered only when GitHub's `viewerCanResolve` / `viewerCanUnresolve` says so. It takes effect at once and is not part of the review.
28. **Lifecycle actions live in the detail tab only**: *Review* / *Finish review (n)*, *Merge*, *Convert to draft* / *Ready for review*, *Close* / *Reopen*. *Finish review* and *Discard* are also on the tree row's context menu (`null.pulls.finishReview`), because that is where a review in the diff editors naturally ends. The webview sends only an action name; the host re-checks it against its own loaded `PullPage.actions` and supplies every id and sha.
29. **Merge** asks for a method only when the repository allows more than one, then shows a modal confirmation naming the PR, base and method. It sends `expectedHeadOid` = the head the page showed, so a push in between makes GitHub refuse. Default commit message (no editing), the head branch is not deleted by Null (the repository's own setting applies). Merge queues and auto-merge are not driven: GitHub's refusal is shown.
30. **Eligibility is advisory.** The page disables only what is certain: not open, draft (merge), merge conflicts, no write access, no merge method allowed, approving your own PR. Everything else GitHub refuses (required checks, branch protection, stale head) is shown verbatim in a toast, as in decision 9.
31. **Still no PR-level comment composer** and no edit/delete of comments (decision 17's list shrinks to those two). The tab's footer says conversation comments are written on GitHub.
32. **After every write** the tab reloads and the tree refreshes (`null.pulls.refresh`), so a merged or closed PR leaves the Open list and the state icon changes. A cancelled dialog changes nothing and only re-enables the buttons.

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
- `out/` and `lib/*.js` are tracked build output; never hand-edit them. `lib/*.css` are hand-written sources. After the work, `npm run compile` and commit the refreshed output as `chore: refresh null-tools compiled output`. **`git status` already shows uncommitted changes to `lib/issueDetail.js`, `lib/pullDetail.js` and `out/pulls/*.js` that are not part of this plan: stage only the files each task names, and let Task 8's compile commit regenerate the compiled output.**
- Every new `*.test.ts` must be added to **both** `tsconfig.json`'s `include` and the explicit `node --test` list in `package.json`'s `test` script, or it is silently skipped. `httpStub.ts` (Task 2) is imported by tests, so it only needs the `tsconfig.json` `include`.
- GitHub only. Signed-out use stays silent (`getGithubSession(false)`); only an explicit write (review, resolve, merge, close, draft) may prompt (`getGithubSession(true)`).
- Webview bundles are `module: none`: every top-level name in `src/webview/pullDetail*.ts` is global in the shared bundle, so they all start with `pull`/`Pull`. The CSP is unchanged; no network from the webview.
- The webview is untrusted input: it sends an action name only, never an id, sha, method or event. The host validates the name against `PullPage.actions` before doing anything.
- Mutation field and input names below were checked against GitHub's GraphQL reference (`addPullRequestReview`, `addPullRequestReviewThread`, `addPullRequestReviewThreadReply`, `submitPullRequestReview`, `deletePullRequestReview`, `resolveReviewThread`, `unresolveReviewThread`, `mergePullRequest`, `closePullRequest`, `reopenPullRequest`, `markPullRequestReadyForReview`, `convertPullRequestToDraft`). Task 8 step 1 exercises each against the real API.
- Commit style: `feat(null-tools): …` / `test(null-tools): …` / `docs: …`. Do not push.

## Review Focus

Failure modes the spec implies but a happy-path test would miss, most likely first. Each has a pinned test in the task named in brackets:

1. **A review body that GitHub would reject, or a no-op submit** — *Request changes* with an empty or whitespace body, *Comment* with nothing pending and no body. Must be caught in the InputBox, before any request. [Task 4 `reviewBodyError`]
2. **Approving or requesting changes on your own PR** — GitHub refuses; the choices must not be offered, and the host must not trust a stale webview. [Task 4 `reviewChoices`, `pageActions`; Task 7 `runAction` re-check, by hand in Task 8 step 1 item 9]
3. **A double click, or a second action while one dialog is open** — one merge, not two. [Task 7 `busy` guard; Task 6 buttons disabled on click; by hand in Task 8 step 1 item 8]
4. **The branch moved between loading the tab and merging** — `expectedHeadOid` makes GitHub refuse and the toast says why, the tab reloads. [Task 5 `mergePull` sends `expectedHeadOid`; by hand in item 7]
5. **The pending review changed elsewhere** — submitted or deleted on github.com while a thread still says *Pending*, or a multi-line comment that crosses hunks. Submit/discard/add must use fresh state, and a rejected range retries on its first line. [Task 2 `ensureReview`; Task 3 `addThread` retry; by hand in item 10]

---

### Task 1: Thread ids, resolve rights and pending comments in the model

**Files:**
- Modify: `extensions/null-tools/src/pulls/pullModel.ts`
- Modify: `extensions/null-tools/src/pulls/pullModel.test.ts`

**Interfaces:**
- Produces (`pullModel.ts`):
  - `ReviewComment` gains `pending: boolean`.
  - `ReviewThread` gains `id: string` (GraphQL node id), `canResolve: boolean`, `canUnresolve: boolean`.
  - `interface GqlComment { databaseId: number; state: string; body: string; createdAt: string; author: { login: string; avatarUrl: string } | null }` (exported)
  - `commentFromGql(c: GqlComment): ReviewComment`
  - `threadAction(t: Pick<ReviewThread, 'resolved' | 'canResolve' | 'canUnresolve'>): 'resolvable' | 'unresolvable' | undefined` — the `contextValue` of a comment thread, which the thread-title menu reads.
- `commentFromRest` now returns `pending: false`.

- [ ] **Step 1: Update the fixtures and write the failing tests** — in `src/pulls/pullModel.test.ts`:

(a) Add `commentFromGql` and `threadAction` to the import list from `./pullModel`.

(b) In the `thread()` fixture, add the three new thread fields and a `state` on each comment:

```ts
const thread = (over: Record<string, unknown> = {}) => ({
  id: 'T1', isResolved: false, isOutdated: false, viewerCanResolve: true, viewerCanUnresolve: false,
  path: 'src/a.ts', line: 10, startLine: null, diffSide: 'RIGHT',
  comments: { nodes: [
    { databaseId: 101, state: 'SUBMITTED', body: 'Why?', createdAt: '2026-10-01T10:00:00Z', author: { login: 'rev', avatarUrl: 'https://x/a.png' } },
    { databaseId: 102, state: 'SUBMITTED', body: 'Because.', createdAt: '2026-10-01T11:00:00Z', author: null },
  ] },
  ...over,
});
```

(c) Change the `commentFromRest` expectation to include `pending: false`:

```ts
    { id: 7, body: 'hi', author: 'me', avatar: 'https://x/m.png', createdAt: '2026-10-01T10:00:00Z', pending: false },
```

(d) Append:

```ts
test('mapThreads carries the thread id, the resolve rights and which comments are pending', () => {
  const [t] = mapThreads(threads([thread({ comments: { nodes: [
    { databaseId: 1, state: 'SUBMITTED', body: 'a', createdAt: '2026-10-01T10:00:00Z', author: null },
    { databaseId: 2, state: 'PENDING', body: 'b', createdAt: '2026-10-01T10:01:00Z', author: null },
  ] } })])).threads;
  assert.strictEqual(t.id, 'T1');
  assert.strictEqual(t.canResolve, true);
  assert.strictEqual(t.canUnresolve, false);
  assert.deepStrictEqual(t.comments.map(c => c.pending), [false, true]);
});

test('commentFromGql maps one comment; an unknown state is not pending', () => {
  const c = commentFromGql({ databaseId: 5, state: 'SOMETHING_NEW', body: 'x', createdAt: '2026-10-01T10:00:00Z', author: { login: 'me', avatarUrl: 'https://x/m.png' } });
  assert.deepStrictEqual(c, { id: 5, body: 'x', author: 'me', avatar: 'https://x/m.png', createdAt: '2026-10-01T10:00:00Z', pending: false });
});

test('threadAction: what the thread-title button offers', () => {
  const t = (resolved: boolean, canResolve: boolean, canUnresolve: boolean) => ({ resolved, canResolve, canUnresolve });
  assert.strictEqual(threadAction(t(false, true, false)), 'resolvable');
  assert.strictEqual(threadAction(t(true, false, true)), 'unresolvable');
  assert.strictEqual(threadAction(t(false, false, false)), undefined);
  assert.strictEqual(threadAction(t(true, true, false)), undefined, 'resolved and you cannot reopen it');
  assert.strictEqual(threadAction(t(false, false, true)), undefined, 'open: unresolve makes no sense');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `commentFromGql` / `threadAction` not exported from `./pullModel`.

- [ ] **Step 3: Implement** — in `src/pulls/pullModel.ts`:

(a) `ReviewComment` and `ReviewThread`:

```ts
export interface ReviewComment {
  id: number; body: string; author: string; avatar: string; createdAt: string;
  /** In the viewer's unsent review: only they can see it. */
  pending: boolean;
}
export interface ReviewThread {
  /** GraphQL node id, for resolve/unresolve and for replies inside a pending review. */
  id: string;
  path: string;
  line: number;
  /** First line of a multi-line thread; null for a single line. */
  startLine: number | null;
  side: 'LEFT' | 'RIGHT';
  resolved: boolean;
  canResolve: boolean;
  canUnresolve: boolean;
  comments: ReviewComment[];
}
```

(b) The `REVIEW_THREADS` query's thread selection becomes:

```
      reviewThreads(first: 100) { nodes {
        id isResolved isOutdated viewerCanResolve viewerCanUnresolve path line startLine diffSide
        comments(first: 50) { nodes { databaseId state body createdAt author { login avatarUrl } } }
      } }
```

(c) Replace the `GqlComment` / `GqlThread` interfaces and the `mapThreads` thread mapping:

```ts
export interface GqlComment { databaseId: number; state: string; body: string; createdAt: string; author: GqlUser | null }
interface GqlThread {
  id: string; isResolved: boolean; isOutdated: boolean; viewerCanResolve: boolean; viewerCanUnresolve: boolean;
  path: string; line: number | null; startLine: number | null; diffSide: 'LEFT' | 'RIGHT';
  comments: { nodes: GqlComment[] };
}

export function commentFromGql(c: GqlComment): ReviewComment {
  return {
    id: c.databaseId, body: c.body, author: c.author?.login ?? 'ghost', avatar: c.author?.avatarUrl ?? '',
    createdAt: c.createdAt, pending: c.state === 'PENDING',
  };
}
```

and inside `mapThreads`, the `.map(t => ({ … }))` becomes:

```ts
    .map(t => ({
      id: t.id,
      path: t.path,
      line: t.line as number,
      startLine: t.startLine,
      side: t.diffSide,
      resolved: t.isResolved,
      canResolve: t.viewerCanResolve,
      canUnresolve: t.viewerCanUnresolve,
      comments: t.comments.nodes.map(commentFromGql),
    }));
```

(d) After `threadCount` add:

```ts
/** The comment thread's `contextValue`: what the thread-title button (Resolve / Unresolve) may offer, if anything. */
export function threadAction(t: Pick<ReviewThread, 'resolved' | 'canResolve' | 'canUnresolve'>): 'resolvable' | 'unresolvable' | undefined {
  if (t.resolved) return t.canUnresolve ? 'unresolvable' : undefined;
  return t.canResolve ? 'resolvable' : undefined;
}
```

(e) `commentFromRest` returns `{ id: c.id, body: c.body, author: c.user.login, avatar: c.user.avatar_url, createdAt: c.created_at, pending: false }`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/pulls/pullModel.test.js`
Expected: PASS. (`tsc` also type-checks `pullReview.ts` and `pullsTreeView.ts`, which only read these types; they must still compile.)

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/pulls/pullModel.ts extensions/null-tools/src/pulls/pullModel.test.ts
git commit -m "feat(null-tools): review thread ids, resolve rights and pending comments"
```

---

### Task 2: Review mutations (pending review, thread, reply, submit, discard, resolve)

**Files:**
- Create: `extensions/null-tools/src/pulls/httpStub.ts`
- Create: `extensions/null-tools/src/pulls/pullReviewApi.ts`
- Create: `extensions/null-tools/src/pulls/pullReviewApi.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test; add `httpStub.ts` to `include`)

**Interfaces:**
- Consumes (Task 1): `GqlComment`, `ReviewComment`, `commentFromGql`.
- Produces (`httpStub.ts`): `interface Call { url: string; method: string; body?: any }`, `stub(responses: Array<{ status?: number; body: unknown }>): Call[]` — answers each `https.request` with the next canned response (the last repeats) and records the calls. Call `mock.restoreAll()` in the test's `afterEach`.
- Produces (`pullReviewApi.ts`):
  - `type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'`
  - `interface ReviewState { pullId: string; headSha: string; viewerIsAuthor: boolean; reviewId: string | null; comments: number }`
  - `fetchReviewState(owner, repo, number, token): Promise<ReviewState>`
  - `ensureReview(owner, repo, number, token): Promise<string>` — the pending review's id, starting one if there is none
  - `interface ThreadInput { reviewId: string; body: string; path: string; line: number; startLine?: number; side: 'LEFT' | 'RIGHT' }`
  - `addReviewThread(input: ThreadInput, token): Promise<{ threadId: string; comment: ReviewComment }>`
  - `replyInReview(reviewId: string, threadId: string, body: string, token): Promise<ReviewComment>`
  - `submitReview(reviewId: string, event: ReviewEvent, body: string, token): Promise<void>`
  - `submitNewReview(state: ReviewState, event: ReviewEvent, body: string, token): Promise<void>` — creates and submits in one call (nothing was pending)
  - `discardReview(reviewId: string, token): Promise<void>`
  - `setThreadResolved(threadId: string, resolved: boolean, token): Promise<void>`

- [ ] **Step 1: Create the shared HTTP stub** — `src/pulls/httpStub.ts` (the same stub `pullDetailApi.test.ts` carries inline; new tests share this one, the old tests are left alone):

```ts
'use strict';

import { EventEmitter } from 'node:events';
import https from 'node:https';
import { mock } from 'node:test';

export interface Call { url: string; method: string; body?: any }
export interface Canned { status?: number; body: unknown }

/** Answers each https.request with the next canned response (the last one repeats) and records what was asked. */
export function stub(responses: Canned[]): Call[] {
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
```

- [ ] **Step 2: Write the failing test** — `src/pulls/pullReviewApi.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test, { afterEach, mock } from 'node:test';
import { stub } from './httpStub';
import {
  addReviewThread, discardReview, ensureReview, fetchReviewState, replyInReview, setThreadResolved, submitNewReview, submitReview,
} from './pullReviewApi';

afterEach(() => mock.restoreAll());

const stateData = (reviews: unknown[], over: Record<string, unknown> = {}) => ({
  data: { repository: { pullRequest: { id: 'PR_1', headRefOid: 'a'.repeat(40), viewerDidAuthor: false, reviews: { nodes: reviews }, ...over } } },
});
const pending = { id: 'REV_1', comments: { totalCount: 3 } };
const gqlComment = { databaseId: 9, state: 'PENDING', body: 'hm', createdAt: '2026-10-01T10:00:00Z', author: { login: 'me', avatarUrl: 'https://x/m.png' } };

test('fetchReviewState reads the PR id, head, authorship and the unsent review', async () => {
  const calls = stub([{ body: stateData([pending]) }]);
  assert.deepStrictEqual(await fetchReviewState('o', 'r', 5, 't'), {
    pullId: 'PR_1', headSha: 'a'.repeat(40), viewerIsAuthor: false, reviewId: 'REV_1', comments: 3,
  });
  assert.deepStrictEqual(calls[0].body.variables, { owner: 'o', name: 'r', number: 5 });
  assert.match(calls[0].body.query, /states: \[PENDING\]/);
});

test('fetchReviewState: no unsent review, and a PR that does not exist', async () => {
  stub([{ body: stateData([]) }]);
  assert.deepStrictEqual(
    { ...await fetchReviewState('o', 'r', 5, 't') }, { pullId: 'PR_1', headSha: 'a'.repeat(40), viewerIsAuthor: false, reviewId: null, comments: 0 });
  mock.restoreAll();
  stub([{ body: { data: { repository: { pullRequest: null } } } }]);
  await assert.rejects(fetchReviewState('o', 'r', 404, 't'), /Pull request not found/);
});

test('ensureReview reuses the unsent review and starts one only when there is none', async () => {
  const reuse = stub([{ body: stateData([pending]) }]);
  assert.strictEqual(await ensureReview('o', 'r', 5, 't'), 'REV_1');
  assert.strictEqual(reuse.length, 1, 'no mutation');
  mock.restoreAll();

  const start = stub([{ body: stateData([]) }, { body: { data: { addPullRequestReview: { pullRequestReview: { id: 'REV_2' } } } } }]);
  assert.strictEqual(await ensureReview('o', 'r', 5, 't'), 'REV_2');
  assert.deepStrictEqual(start[1].body.variables, { input: { pullRequestId: 'PR_1', commitOID: 'a'.repeat(40) } });
  assert.ok(!('event' in start[1].body.variables.input), 'no event: the review stays pending');
});

test('addReviewThread: one line, or a range with its start side', async () => {
  const reply = { data: { addPullRequestReviewThread: { thread: { id: 'T9', comments: { nodes: [gqlComment] } } } } };
  const calls = stub([{ body: reply }]);
  const one = await addReviewThread({ reviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 4, side: 'RIGHT' }, 't');
  assert.deepStrictEqual(calls[0].body.variables.input, { pullRequestReviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 4, side: 'RIGHT' });
  assert.strictEqual(one.threadId, 'T9');
  assert.deepStrictEqual(one.comment, { id: 9, body: 'hm', author: 'me', avatar: 'https://x/m.png', createdAt: '2026-10-01T10:00:00Z', pending: true });

  await addReviewThread({ reviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 6, startLine: 4, side: 'LEFT' }, 't');
  assert.deepStrictEqual(calls[1].body.variables.input, {
    pullRequestReviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 6, side: 'LEFT', startLine: 4, startSide: 'LEFT',
  });

  await addReviewThread({ reviewId: 'REV_1', body: 'hm', path: 'a.ts', line: 4, startLine: 4, side: 'RIGHT' }, 't');
  assert.ok(!('startLine' in calls[2].body.variables.input), 'a start line equal to the line is a single line');
});

test('addReviewThread: GitHub returning no thread is an error, not a silent success', async () => {
  stub([{ body: { data: { addPullRequestReviewThread: { thread: null } } } }]);
  await assert.rejects(addReviewThread({ reviewId: 'R', body: 'x', path: 'a', line: 1, side: 'RIGHT' }, 't'), /did not create/);
});

test('replyInReview posts into the pending review', async () => {
  const calls = stub([{ body: { data: { addPullRequestReviewThreadReply: { comment: gqlComment } } } }]);
  const c = await replyInReview('REV_1', 'T9', 'ok', 't');
  assert.deepStrictEqual(calls[0].body.variables.input, { pullRequestReviewId: 'REV_1', pullRequestReviewThreadId: 'T9', body: 'ok' });
  assert.strictEqual(c.pending, true);
});

test('submitReview, submitNewReview, discardReview and setThreadResolved send exactly what they are given', async () => {
  const calls = stub([{ body: { data: {} } }]);
  await submitReview('REV_1', 'REQUEST_CHANGES', 'fix it', 't');
  assert.match(calls[0].body.query, /submitPullRequestReview/);
  assert.deepStrictEqual(calls[0].body.variables.input, { pullRequestReviewId: 'REV_1', event: 'REQUEST_CHANGES', body: 'fix it' });

  await submitNewReview({ pullId: 'PR_1', headSha: 'b'.repeat(40), viewerIsAuthor: false, reviewId: null, comments: 0 }, 'APPROVE', '', 't');
  assert.match(calls[1].body.query, /addPullRequestReview\(/);
  assert.deepStrictEqual(calls[1].body.variables.input, { pullRequestId: 'PR_1', commitOID: 'b'.repeat(40), event: 'APPROVE', body: '' });

  await discardReview('REV_1', 't');
  assert.match(calls[2].body.query, /deletePullRequestReview/);
  assert.deepStrictEqual(calls[2].body.variables.input, { pullRequestReviewId: 'REV_1' });

  await setThreadResolved('T9', true, 't');
  assert.match(calls[3].body.query, /resolveReviewThread/);
  assert.doesNotMatch(calls[3].body.query, /unresolveReviewThread/);
  await setThreadResolved('T9', false, 't');
  assert.match(calls[4].body.query, /unresolveReviewThread/);
  assert.deepStrictEqual(calls[4].body.variables.input, { threadId: 'T9' });
});

test('a GraphQL error from a mutation surfaces GitHub\'s message', async () => {
  stub([{ body: { errors: [{ message: 'Can not approve your own pull request' }] } }]);
  await assert.rejects(submitReview('REV_1', 'APPROVE', '', 't'), /Can not approve your own pull request/);
});
```

Register `src/pulls/pullReviewApi.test.ts` and `src/pulls/httpStub.ts` in `tsconfig.json`'s `include` (append after `"src/pulls/pullDetailApi.test.ts"`), and `out/pulls/pullReviewApi.test.js` at the end of the `node --test` list in `package.json`'s `test` script.

- [ ] **Step 3: Run to verify it fails**

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `./pullReviewApi` does not exist.

- [ ] **Step 4: Write `src/pulls/pullReviewApi.ts`**

```ts
'use strict';

import { requestGraphql } from '../github/githubApi';
import { GqlComment, ReviewComment, commentFromGql } from './pullModel';

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

/** The viewer's own picture of a PR for reviewing: ids to write against, and the unsent review if there is one. */
export interface ReviewState { pullId: string; headSha: string; viewerIsAuthor: boolean; reviewId: string | null; comments: number }

// GitHub shows an unsent (PENDING) review to its author only, so this is always the viewer's own, at most one.
const REVIEW_STATE = `
query ReviewState($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id headRefOid viewerDidAuthor
      reviews(first: 1, states: [PENDING]) { nodes { id comments { totalCount } } }
    }
  }
}`;

interface ReviewStateData {
  repository: { pullRequest: {
    id: string; headRefOid: string; viewerDidAuthor: boolean;
    reviews: { nodes: Array<{ id: string; comments: { totalCount: number } }> };
  } | null } | null;
}

export async function fetchReviewState(owner: string, repo: string, number: number, token: string | null): Promise<ReviewState> {
  const p = (await requestGraphql<ReviewStateData>(REVIEW_STATE, { owner, name: repo, number }, token)).repository?.pullRequest;
  if (!p) throw new Error('Pull request not found.');
  const unsent = p.reviews.nodes[0];
  return { pullId: p.id, headSha: p.headRefOid, viewerIsAuthor: p.viewerDidAuthor, reviewId: unsent?.id ?? null, comments: unsent?.comments.totalCount ?? 0 };
}

// No `event`: the review stays PENDING. With an `event` the same mutation creates and submits in one go.
const ADD_REVIEW = `
mutation AddReview($input: AddPullRequestReviewInput!) { addPullRequestReview(input: $input) { pullRequestReview { id } } }`;

/** The unsent review's id; one is started (anchored on the current head) when there is none. */
export async function ensureReview(owner: string, repo: string, number: number, token: string | null): Promise<string> {
  const state = await fetchReviewState(owner, repo, number, token);
  if (state.reviewId) return state.reviewId;
  const created = await requestGraphql<{ addPullRequestReview: { pullRequestReview: { id: string } } }>(
    ADD_REVIEW, { input: { pullRequestId: state.pullId, commitOID: state.headSha } }, token);
  return created.addPullRequestReview.pullRequestReview.id;
}

export interface ThreadInput { reviewId: string; body: string; path: string; line: number; startLine?: number; side: 'LEFT' | 'RIGHT' }

const ADD_THREAD = `
mutation AddThread($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) {
    thread { id comments(first: 1) { nodes { databaseId state body createdAt author { login avatarUrl } } } }
  }
}`;

/** `startLine` below `line` makes it a range on `side`; GitHub refuses a range that crosses hunks. */
export async function addReviewThread(input: ThreadInput, token: string | null): Promise<{ threadId: string; comment: ReviewComment }> {
  const range = input.startLine !== undefined && input.startLine < input.line ? { startLine: input.startLine, startSide: input.side } : {};
  const data = await requestGraphql<{ addPullRequestReviewThread: { thread: { id: string; comments: { nodes: GqlComment[] } } | null } }>(
    ADD_THREAD, { input: { pullRequestReviewId: input.reviewId, body: input.body, path: input.path, line: input.line, side: input.side, ...range } }, token);
  const thread = data.addPullRequestReviewThread.thread;
  if (!thread || thread.comments.nodes.length === 0) throw new Error('GitHub did not create the comment.');
  return { threadId: thread.id, comment: commentFromGql(thread.comments.nodes[0]) };
}

const REPLY = `
mutation Reply($input: AddPullRequestReviewThreadReplyInput!) {
  addPullRequestReviewThreadReply(input: $input) { comment { databaseId state body createdAt author { login avatarUrl } } }
}`;

export async function replyInReview(reviewId: string, threadId: string, body: string, token: string | null): Promise<ReviewComment> {
  const data = await requestGraphql<{ addPullRequestReviewThreadReply: { comment: GqlComment } }>(
    REPLY, { input: { pullRequestReviewId: reviewId, pullRequestReviewThreadId: threadId, body } }, token);
  return commentFromGql(data.addPullRequestReviewThreadReply.comment);
}

const SUBMIT = `
mutation Submit($input: SubmitPullRequestReviewInput!) { submitPullRequestReview(input: $input) { pullRequestReview { id } } }`;

export async function submitReview(reviewId: string, event: ReviewEvent, body: string, token: string | null): Promise<void> {
  await requestGraphql(SUBMIT, { input: { pullRequestReviewId: reviewId, event, body } }, token);
}

/** Nothing was pending: create the review and submit it in one call. */
export async function submitNewReview(state: ReviewState, event: ReviewEvent, body: string, token: string | null): Promise<void> {
  await requestGraphql(ADD_REVIEW, { input: { pullRequestId: state.pullId, commitOID: state.headSha, event, body } }, token);
}

const DISCARD = `
mutation Discard($input: DeletePullRequestReviewInput!) { deletePullRequestReview(input: $input) { pullRequestReview { id } } }`;

export async function discardReview(reviewId: string, token: string | null): Promise<void> {
  await requestGraphql(DISCARD, { input: { pullRequestReviewId: reviewId } }, token);
}

const RESOLVE = `
mutation Resolve($input: ResolveReviewThreadInput!) { resolveReviewThread(input: $input) { thread { id } } }`;
const UNRESOLVE = `
mutation Unresolve($input: UnresolveReviewThreadInput!) { unresolveReviewThread(input: $input) { thread { id } } }`;

export async function setThreadResolved(threadId: string, resolved: boolean, token: string | null): Promise<void> {
  await requestGraphql(resolved ? RESOLVE : UNRESOLVE, { input: { threadId } }, token);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/pulls/pullReviewApi.test.js`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add extensions/null-tools/src/pulls/httpStub.ts extensions/null-tools/src/pulls/pullReviewApi.ts extensions/null-tools/src/pulls/pullReviewApi.test.ts extensions/null-tools/tsconfig.json extensions/null-tools/package.json
git commit -m "feat(null-tools): review mutations for pending reviews, threads and submit"
```

---

### Task 3: Pending comments and thread resolving in the diff editor

**Files:**
- Modify: `extensions/null-tools/src/pulls/pullReview.ts`
- Modify: `extensions/null-tools/src/pulls/pullsIntegration.ts` (three commands)
- Modify: `extensions/null-tools/package.json` (commands, menus, palette hiding)

**Interfaces:**
- Consumes (Task 1): `ReviewThread.id/canResolve/canUnresolve/resolved`, `ReviewComment.pending`, `threadAction`. (Task 2): `ensureReview`, `addReviewThread`, `replyInReview`, `setThreadResolved`.
- Produces: `PullReview.addToReview(reply: vscode.CommentReply): Promise<void>` and `PullReview.setResolved(thread: vscode.CommentThread, resolved: boolean): Promise<void>`; commands `null.pulls.addToReview` (arg `CommentReply`), `null.pulls.resolveThread`, `null.pulls.unresolveThread` (arg `CommentThread`).

This is `vscode` glue, which the repo covers by the integration spec and the manual pass (Task 8), not by unit tests; the pure parts it uses were tested in Tasks 1–2.

- [ ] **Step 1: Edit `src/pulls/pullReview.ts`**

(a) Imports: replace the `./pullApi` and `./pullModel` lines and add the new ones:

```ts
import { createLineComment, replyToComment } from './pullApi';
import { PullDetail, ReviewComment, ReviewThread, describeFailure, threadAction } from './pullModel';
import { addReviewThread, ensureReview, replyInReview, setThreadResolved } from './pullReviewApi';
```

(b) `toComment` shows pending comments with a label:

```ts
function toComment(c: ReviewComment): vscode.Comment {
  return {
    body: new vscode.MarkdownString(c.body),
    mode: vscode.CommentMode.Preview,
    author: { name: c.author, iconPath: c.avatar ? vscode.Uri.parse(c.avatar) : undefined },
    label: c.pending ? 'Pending' : undefined,
  };
}
```

(c) Next to `roots`, remember each thread's GraphQL id:

```ts
  /** GraphQL node id of each existing thread: resolving, and replies inside a pending review, need it. */
  private readonly ids = new WeakMap<vscode.CommentThread, string>();
```

(d) In `show()`, after `this.roots.set(thread, t.comments[0].id);` add:

```ts
      this.ids.set(thread, t.id);
      thread.contextValue = threadAction(t);
```

(e) Add the two methods after `submit()`:

```ts
  /** Command handler for *Add Review Comment*: into the viewer's pending review (started if needed), as a reply or a new thread. */
  async addToReview(reply: vscode.CommentReply): Promise<void> {
    const { thread, text } = reply;
    const ref = parseDocQuery(thread.uri.path, thread.uri.query);
    if (!ref || !text.trim()) return;
    const session = await getGithubSession(true);
    if (!session) return;
    try {
      const token = session.accessToken;
      const reviewId = await ensureReview(ref.owner, ref.repo, ref.pull, token);
      const threadId = this.ids.get(thread);
      let posted: ReviewComment;
      if (threadId !== undefined) {
        posted = await replyInReview(reviewId, threadId, text, token);
      } else {
        const created = await this.addThread(reviewId, ref, thread, text, token);
        this.ids.set(thread, created.threadId);
        this.roots.set(thread, created.comment.id);
        thread.canReply = true;
        posted = created.comment;
      }
      thread.comments = [...thread.comments, toComment(posted)];
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not add the review comment: ${describeFailure(err)}`);
    }
  }

  /** The selected range; when GitHub rejects it (it crosses hunks) the first line alone, like an immediate comment. */
  private async addThread(
    reviewId: string, ref: NonNullable<ReturnType<typeof parseDocQuery>>, thread: vscode.CommentThread, body: string, token: string,
  ): ReturnType<typeof addReviewThread> {
    const first = (thread.range?.start.line ?? 0) + 1;
    const last = (thread.range?.end.line ?? 0) + 1;
    const input = { reviewId, body, path: ref.path, side: ref.side };
    try {
      return await addReviewThread({ ...input, startLine: first, line: last }, token);
    } catch (err) {
      if (first === last) throw err;
      return addReviewThread({ ...input, line: first }, token); // a GraphQL error carries no 422: any failure of a range retries once
    }
  }

  /** Command handler for the thread-title buttons. GitHub decides whether the viewer may; its refusal is shown as is. */
  async setResolved(thread: vscode.CommentThread, resolved: boolean): Promise<void> {
    const id = this.ids.get(thread);
    if (id === undefined) return;
    const session = await getGithubSession(true);
    if (!session) return;
    try {
      await setThreadResolved(id, resolved, session.accessToken);
      thread.state = resolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
      thread.collapsibleState = resolved ? vscode.CommentThreadCollapsibleState.Collapsed : vscode.CommentThreadCollapsibleState.Expanded;
      thread.contextValue = resolved ? 'unresolvable' : 'resolvable'; // the viewer just did one, so may undo it
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not ${resolved ? 'resolve' : 'reopen'} the thread: ${describeFailure(err)}`);
    }
  }
```

(f) The one-time notice now points at the other button — replace the message text in `noticeOnce`:

```ts
      'Comment Now posts at once and notifies the author. To send several comments together, use Add Review Comment and finish the review from the pull request. Editing or deleting a comment is done on GitHub.',
```

- [ ] **Step 2: Register the commands** — in `src/pulls/pullsIntegration.ts`, after the `null.pulls.comment` line:

```ts
    vscode.commands.registerCommand('null.pulls.addToReview', (reply: vscode.CommentReply) => review.addToReview(reply)),
    vscode.commands.registerCommand('null.pulls.resolveThread', (thread: vscode.CommentThread) => review.setResolved(thread, true)),
    vscode.commands.registerCommand('null.pulls.unresolveThread', (thread: vscode.CommentThread) => review.setResolved(thread, false)),
```

- [ ] **Step 3: Contribute the commands and menus** — in `package.json`:

(a) In `contributes.commands`, change the `null.pulls.comment` entry's title and add three entries after it:

```json
      { "command": "null.pulls.comment", "title": "Comment Now" },
      { "command": "null.pulls.addToReview", "title": "Add Review Comment" },
      { "command": "null.pulls.resolveThread", "title": "Resolve Thread", "icon": "$(check)" },
      { "command": "null.pulls.unresolveThread", "title": "Unresolve Thread", "icon": "$(discard)" },
```

(b) Replace the `comments/commentThread/context` block and add the title block after it:

```json
      "comments/commentThread/context": [
        { "command": "null.pulls.addToReview", "when": "commentController == null.pulls", "group": "inline@0" },
        { "command": "null.pulls.comment", "when": "commentController == null.pulls", "group": "inline@1" }
      ],
      "comments/commentThread/title": [
        { "command": "null.pulls.resolveThread", "when": "commentController == null.pulls && commentThread == resolvable", "group": "inline@0" },
        { "command": "null.pulls.unresolveThread", "when": "commentController == null.pulls && commentThread == unresolvable", "group": "inline@0" }
      ],
```

(c) In `commandPalette`, after the `null.pulls.comment` line, hide the three:

```json
        { "command": "null.pulls.addToReview", "when": "false" },
        { "command": "null.pulls.resolveThread", "when": "false" },
        { "command": "null.pulls.unresolveThread", "when": "false" },
```

- [ ] **Step 4: Compile**

Run: `npx tsc -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/pulls/pullReview.ts extensions/null-tools/src/pulls/pullsIntegration.ts extensions/null-tools/package.json
git commit -m "feat(null-tools): add review comments to a pending review and resolve threads"
```

---

### Task 4: What the viewer may do — page model and pure rules

**Files:**
- Create: `extensions/null-tools/src/pulls/pullActionsModel.ts`
- Create: `extensions/null-tools/src/pulls/pullActionsModel.test.ts`
- Modify: `extensions/null-tools/src/pulls/pullDetailModel.ts` (query, types, `mapPullPage`)
- Modify: `extensions/null-tools/src/pulls/pullDetailModel.test.ts`, `extensions/null-tools/src/pulls/pullDetailApi.test.ts` (fixtures)
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the new test)

**Interfaces:**
- Consumes (Task 2): `ReviewEvent` (type only).
- Produces (`pullActionsModel.ts`):
  - `type MergeMethod = 'MERGE' | 'SQUASH' | 'REBASE'`
  - `interface PageActions { review: { available: boolean; canApprove: boolean; pending: number | null }; merge: { enabled: boolean; hint: string; methods: MergeMethod[] }; state: 'close' | 'reopen' | null; draft: 'ready' | 'draft' | null }`
  - `interface ActionFacts { state: PullState; draft: boolean; mergeable: string; mergeStateStatus: string; viewerCanUpdate: boolean; viewerDidAuthor: boolean; viewerPermission: string; mergeCommitAllowed: boolean; squashMergeAllowed: boolean; rebaseMergeAllowed: boolean; pendingComments: number | null }`
  - `pageActions(f: ActionFacts): PageActions`
  - `type ReviewChoice = ReviewEvent | 'DISCARD'`, `interface ReviewOption { choice: ReviewChoice; label: string; description: string }`
  - `reviewChoices(s: { viewerIsAuthor: boolean; reviewId: string | null; comments: number }): ReviewOption[]`
  - `reviewBodyError(event: ReviewEvent, pendingComments: number, body: string): string | undefined`
- Produces (`pullDetailModel.ts`): `PullPage` gains `id: string` (GraphQL node id, host-only), `headSha: string` (host-only) and `actions: PageActions`.

- [ ] **Step 1: Write the failing test** — `src/pulls/pullActionsModel.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { ActionFacts, pageActions, reviewBodyError, reviewChoices } from './pullActionsModel';

const facts = (over: Partial<ActionFacts> = {}): ActionFacts => ({
  state: 'open', draft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  viewerCanUpdate: true, viewerDidAuthor: false, viewerPermission: 'WRITE',
  mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false, pendingComments: null, ...over,
});

test('an open, clean PR you can write to: everything is on offer', () => {
  assert.deepStrictEqual(pageActions(facts()), {
    review: { available: true, canApprove: true, pending: null },
    merge: { enabled: true, hint: 'Ready to merge.', methods: ['MERGE', 'SQUASH'] },
    state: 'close', draft: 'draft',
  });
});

test('merge is disabled, with the reason, for a draft, conflicts, read access, or no allowed method', () => {
  const merge = (over: Partial<ActionFacts>) => pageActions(facts(over)).merge;
  assert.deepStrictEqual([merge({ draft: true }).enabled, merge({ draft: true }).hint], [false, 'Mark this as ready for review to merge it.']);
  assert.deepStrictEqual([merge({ mergeable: 'CONFLICTING' }).enabled, merge({ mergeable: 'CONFLICTING' }).hint], [false, 'This branch has conflicts that must be resolved first.']);
  assert.deepStrictEqual([merge({ viewerPermission: 'READ' }).enabled, merge({ viewerPermission: 'TRIAGE' }).enabled], [false, false]);
  assert.match(merge({ viewerPermission: 'READ' }).hint, /write access/);
  const none = merge({ mergeCommitAllowed: false, squashMergeAllowed: false, rebaseMergeAllowed: false });
  assert.deepStrictEqual([none.enabled, none.methods, none.hint], [false, [], 'This repository allows no merge method.']);
});

test('merge stays enabled when GitHub only says blocked, behind or unstable: the repository may let you through, GitHub decides', () => {
  for (const status of ['BLOCKED', 'BEHIND', 'UNSTABLE']) {
    const m = pageActions(facts({ mergeStateStatus: status })).merge;
    assert.strictEqual(m.enabled, true, status);
    assert.notStrictEqual(m.hint, '', status);
  }
  assert.strictEqual(pageActions(facts({ mergeStateStatus: 'SOMETHING_NEW' })).merge.hint, '', 'an unknown status says nothing');
  assert.strictEqual(pageActions(facts({ mergeStateStatus: 'SOMETHING_NEW' })).merge.enabled, true);
});

test('merge method order is merge, squash, rebase and only the allowed ones', () => {
  assert.deepStrictEqual(pageActions(facts({ mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: true })).merge.methods, ['SQUASH', 'REBASE']);
});

test('closed and merged PRs: nothing to merge; closed can be reopened, merged is final', () => {
  const closed = pageActions(facts({ state: 'closed' }));
  assert.deepStrictEqual([closed.merge.enabled, closed.merge.hint, closed.state, closed.draft, closed.review.available], [false, '', 'reopen', null, false]);
  const merged = pageActions(facts({ state: 'merged' }));
  assert.deepStrictEqual([merged.merge.enabled, merged.state, merged.draft, merged.review.available], [false, null, null, false]);
});

test('close and draft follow viewerCanUpdate and the current draft state', () => {
  assert.deepStrictEqual([pageActions(facts({ draft: true })).draft, pageActions(facts({ draft: false })).draft], ['ready', 'draft']);
  const readOnly = pageActions(facts({ viewerCanUpdate: false }));
  assert.deepStrictEqual([readOnly.state, readOnly.draft], [null, null]);
});

test('your own PR cannot be approved; a pending review is reported with its comment count', () => {
  assert.strictEqual(pageActions(facts({ viewerDidAuthor: true })).review.canApprove, false);
  assert.strictEqual(pageActions(facts({ pendingComments: 3 })).review.pending, 3);
});

test('reviewChoices: approve and request changes are hidden on your own PR; discard only when something is pending', () => {
  const labels = (s: Parameters<typeof reviewChoices>[0]) => reviewChoices(s).map(o => o.choice);
  assert.deepStrictEqual(labels({ viewerIsAuthor: false, reviewId: null, comments: 0 }), ['COMMENT', 'APPROVE', 'REQUEST_CHANGES']);
  assert.deepStrictEqual(labels({ viewerIsAuthor: true, reviewId: null, comments: 0 }), ['COMMENT']);
  assert.deepStrictEqual(labels({ viewerIsAuthor: false, reviewId: 'R', comments: 2 }), ['COMMENT', 'APPROVE', 'REQUEST_CHANGES', 'DISCARD']);
  assert.match(reviewChoices({ viewerIsAuthor: false, reviewId: 'R', comments: 1 })[0].description, /1 pending comment\b/);
  assert.match(reviewChoices({ viewerIsAuthor: false, reviewId: 'R', comments: 2 })[0].description, /2 pending comments/);
  assert.doesNotMatch(reviewChoices({ viewerIsAuthor: false, reviewId: 'R', comments: 0 })[0].description, /pending/);
});

test('reviewBodyError: requesting changes needs a body; a bare comment needs a body unless comments are pending; approving never does', () => {
  assert.match(reviewBodyError('REQUEST_CHANGES', 5, '')!, /what needs to change/);
  assert.match(reviewBodyError('REQUEST_CHANGES', 0, '   \n')!, /what needs to change/, 'whitespace is empty');
  assert.match(reviewBodyError('COMMENT', 0, '')!, /Write a comment/);
  assert.strictEqual(reviewBodyError('COMMENT', 2, ''), undefined);
  assert.strictEqual(reviewBodyError('APPROVE', 0, ''), undefined);
  assert.strictEqual(reviewBodyError('REQUEST_CHANGES', 0, 'fix x'), undefined);
});
```

Register `src/pulls/pullActionsModel.test.ts` in `tsconfig.json`'s `include` and `out/pulls/pullActionsModel.test.js` in the `node --test` list.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `./pullActionsModel` does not exist.

- [ ] **Step 3: Write `src/pulls/pullActionsModel.ts`**

```ts
'use strict';

import { PullState } from './pullModel';
import { ReviewEvent } from './pullReviewApi';

export type MergeMethod = 'MERGE' | 'SQUASH' | 'REBASE';

/**
 * What the detail tab offers. Computed by the host from GitHub's own flags and mirrored by hand in
 * src/webview/pullDetailTypes.ts; the host re-reads it from its loaded page before any write, so the webview can only ask.
 */
export interface PageActions {
  /** `pending`: comments in the viewer's unsent review, null when there is none. */
  review: { available: boolean; canApprove: boolean; pending: number | null };
  merge: { enabled: boolean; hint: string; methods: MergeMethod[] };
  state: 'close' | 'reopen' | null;
  draft: 'ready' | 'draft' | null;
}

export interface ActionFacts {
  state: PullState;
  draft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  viewerCanUpdate: boolean;
  viewerDidAuthor: boolean;
  viewerPermission: string;
  mergeCommitAllowed: boolean;
  squashMergeAllowed: boolean;
  rebaseMergeAllowed: boolean;
  pendingComments: number | null;
}

const WRITERS = new Set(['ADMIN', 'MAINTAIN', 'WRITE']);
// A Map, not a record: a status from the wire must never hit an Object.prototype key.
const MERGE_HINTS = new Map<string, string>([
  ['CLEAN', 'Ready to merge.'],
  ['HAS_HOOKS', 'Ready to merge.'],
  ['BEHIND', 'This branch is out of date with the base branch.'],
  ['BLOCKED', 'Merging is blocked: required reviews or checks are missing.'],
  ['UNSTABLE', 'Some checks have not passed.'],
  ['UNKNOWN', 'GitHub is still checking whether this can be merged.'],
]);

/** Only what is certain disables a button (see decision 30); BLOCKED / BEHIND / UNSTABLE are hints because admins and rulesets can bypass them. */
export function pageActions(f: ActionFacts): PageActions {
  const open = f.state === 'open';
  const methods = (['MERGE', 'SQUASH', 'REBASE'] as const).filter(m =>
    m === 'MERGE' ? f.mergeCommitAllowed : m === 'SQUASH' ? f.squashMergeAllowed : f.rebaseMergeAllowed);
  const canWrite = WRITERS.has(f.viewerPermission);
  let hint = '';
  if (open) {
    if (f.draft) hint = 'Mark this as ready for review to merge it.';
    else if (!canWrite) hint = 'Merging needs write access to this repository.';
    else if (methods.length === 0) hint = 'This repository allows no merge method.';
    else if (f.mergeable === 'CONFLICTING') hint = 'This branch has conflicts that must be resolved first.';
    else hint = MERGE_HINTS.get(f.mergeStateStatus) ?? '';
  }
  return {
    review: { available: open, canApprove: open && !f.viewerDidAuthor, pending: f.pendingComments },
    merge: { enabled: open && !f.draft && canWrite && methods.length > 0 && f.mergeable !== 'CONFLICTING', hint, methods },
    state: !f.viewerCanUpdate ? null : open ? 'close' : f.state === 'closed' ? 'reopen' : null,
    draft: !f.viewerCanUpdate || !open ? null : f.draft ? 'ready' : 'draft',
  };
}

export type ReviewChoice = ReviewEvent | 'DISCARD';
export interface ReviewOption { choice: ReviewChoice; label: string; description: string }

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function reviewChoices(s: { viewerIsAuthor: boolean; reviewId: string | null; comments: number }): ReviewOption[] {
  const withPending = s.reviewId !== null && s.comments > 0 ? ` with your ${plural(s.comments, 'pending comment')}` : '';
  const options: ReviewOption[] = [{ choice: 'COMMENT', label: 'Comment', description: `Send feedback without approving or blocking${withPending}` }];
  if (!s.viewerIsAuthor) {
    options.push(
      { choice: 'APPROVE', label: 'Approve', description: `Approve these changes${withPending}` },
      { choice: 'REQUEST_CHANGES', label: 'Request changes', description: `Block merging until this is addressed${withPending}` },
    );
  }
  if (s.reviewId !== null) {
    options.push({ choice: 'DISCARD', label: 'Discard pending review', description: `Delete your ${plural(s.comments, 'unsent comment')}` });
  }
  return options;
}

/** The InputBox's validation message, or undefined when `body` is acceptable for `event`. Catches what GitHub would only reject afterwards. */
export function reviewBodyError(event: ReviewEvent, pendingComments: number, body: string): string | undefined {
  if (body.trim()) return undefined;
  if (event === 'REQUEST_CHANGES') return 'Say what needs to change.';
  if (event === 'COMMENT' && pendingComments === 0) return 'Write a comment, or add review comments in the diff first.';
  return undefined;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/pulls/pullActionsModel.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Extend the page query and mapper** — in `src/pulls/pullDetailModel.ts`:

(a) Imports: add `import { PageActions, pageActions } from './pullActionsModel';`.

(b) `PullPage` gains, right after `number: number;`:

```ts
  /** GraphQL node id and head commit: for the host's writes only, never rendered. */
  id: string;
  headSha: string;
```

and, at the end of the interface (after `checksTotal`):

```ts
  actions: PageActions;
```

(c) In `PULL_PAGE`, the repository selection and the pull selection start as:

```
  repository(owner: $owner, name: $name) {
    viewerPermission mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
    pullRequest(number: $number) {
      id headRefOid mergeable mergeStateStatus viewerCanUpdate viewerDidAuthor
      pendingReview: reviews(first: 1, states: [PENDING]) { nodes { id comments { totalCount } } }
      number title url state isDraft createdAt bodyHTML headRefName baseRefName isCrossRepository additions deletions changedFiles
```

(the rest of the query is unchanged).

(d) `GqlPullPage` gains `id: string; headRefOid: string; mergeable: string; mergeStateStatus: string; viewerCanUpdate: boolean; viewerDidAuthor: boolean; pendingReview: { nodes: Array<{ id: string; comments: { totalCount: number } }> };`, and `PullPageData` becomes:

```ts
export interface PullPageData {
  repository: {
    viewerPermission: string | null;
    mergeCommitAllowed: boolean; squashMergeAllowed: boolean; rebaseMergeAllowed: boolean;
    pullRequest: GqlPullPage | null;
  } | null;
}
```

(e) `mapPullPage` — replace its first lines and add the three result fields:

```ts
export function mapPullPage(data: PullPageData): PullPage {
  const repo = data.repository;
  const p = repo?.pullRequest;
  if (!repo || !p) throw new Error('Pull request not found.');
  const rollup = p.lastCommit.nodes[0]?.commit.statusCheckRollup ?? null;
  const unsent = p.pendingReview.nodes[0];
  return {
    number: p.number, id: p.id, headSha: p.headRefOid,
    title: p.title, url: p.url, state: pullStateOf(p.state), draft: p.isDraft,
    // …all the existing fields stay as they are, then at the end:
    checksTotal: rollup?.contexts.totalCount ?? 0,
    actions: pageActions({
      state: pullStateOf(p.state), draft: p.isDraft, mergeable: p.mergeable, mergeStateStatus: p.mergeStateStatus,
      viewerCanUpdate: p.viewerCanUpdate, viewerDidAuthor: p.viewerDidAuthor, viewerPermission: repo.viewerPermission ?? '',
      mergeCommitAllowed: repo.mergeCommitAllowed, squashMergeAllowed: repo.squashMergeAllowed, rebaseMergeAllowed: repo.rebaseMergeAllowed,
      pendingComments: unsent ? unsent.comments.totalCount : null,
    }),
  };
}
```

- [ ] **Step 6: Update the fixtures and add the mapper test**

In `src/pulls/pullDetailModel.test.ts`, the `gqlPage` fixture: put the repository-level fields next to `pullRequest` and the pull-level fields at the top of the pull:

```ts
const gqlPage = (over: Record<string, unknown> = {}): PullPageData => ({
  repository: {
    viewerPermission: 'WRITE', mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false,
    pullRequest: {
      id: 'PR_1', headRefOid: 'c'.repeat(40), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
      viewerCanUpdate: true, viewerDidAuthor: false, pendingReview: { nodes: [] },
      number: 12, title: 'Add x', …  // unchanged from here
```

Append the test:

```ts
test('mapPullPage keeps the ids for writes and derives the actions from the page', () => {
  const p = mapPullPage(gqlPage());
  assert.strictEqual(p.id, 'PR_1');
  assert.strictEqual(p.headSha, 'c'.repeat(40));
  assert.deepStrictEqual(p.actions, {
    review: { available: true, canApprove: true, pending: null },
    merge: { enabled: true, hint: 'Ready to merge.', methods: ['MERGE', 'SQUASH'] },
    state: 'close', draft: 'draft',
  });
  const unsent = mapPullPage(gqlPage({ pendingReview: { nodes: [{ id: 'REV_1', comments: { totalCount: 3 } }] } }));
  assert.strictEqual(unsent.actions.review.pending, 3);
  assert.strictEqual(mapPullPage(gqlPage({ viewerDidAuthor: true })).actions.review.canApprove, false);
});
```

In `src/pulls/pullDetailApi.test.ts`, add the same pull fields to `minimalPage` (`id: 'PR_1', headRefOid: 'c'.repeat(40), mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN', viewerCanUpdate: false, viewerDidAuthor: false, pendingReview: { nodes: [] },`) and wrap it as `{ repository: { viewerPermission: null, mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true, pullRequest: minimalPage } }` in `fetchPullPage asks GraphQL for one PR and maps it`.

- [ ] **Step 7: Run everything**

Run: `npm test`
Expected: PASS. (This compiles the webview-shared bundle too; `webviewPullDetail.test.ts` still passes because the webview types are untouched until Task 6.)

- [ ] **Step 8: Commit**

```bash
git add extensions/null-tools/src/pulls/pullActionsModel.ts extensions/null-tools/src/pulls/pullActionsModel.test.ts extensions/null-tools/src/pulls/pullDetailModel.ts extensions/null-tools/src/pulls/pullDetailModel.test.ts extensions/null-tools/src/pulls/pullDetailApi.test.ts extensions/null-tools/tsconfig.json extensions/null-tools/package.json
git commit -m "feat(null-tools): pull request page actions and review rules"
```

---

### Task 5: Lifecycle mutations (merge, close, reopen, draft)

**Files:**
- Create: `extensions/null-tools/src/pulls/pullLifecycleApi.ts`
- Create: `extensions/null-tools/src/pulls/pullLifecycleApi.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the test)

**Interfaces:**
- Consumes (Task 2): `stub` from `httpStub.ts`. (Task 4): `MergeMethod`.
- Produces (`pullLifecycleApi.ts`):
  - `mergePull(pullId: string, method: MergeMethod, expectedHeadSha: string, token: string | null): Promise<void>`
  - `setPullOpen(pullId: string, open: boolean, token: string | null): Promise<void>`
  - `setPullDraft(pullId: string, draft: boolean, token: string | null): Promise<void>`

- [ ] **Step 1: Write the failing test** — `src/pulls/pullLifecycleApi.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test, { afterEach, mock } from 'node:test';
import { stub } from './httpStub';
import { mergePull, setPullDraft, setPullOpen } from './pullLifecycleApi';

afterEach(() => mock.restoreAll());

test('mergePull sends the method and pins the head the page showed', async () => {
  const calls = stub([{ body: { data: { mergePullRequest: { pullRequest: { merged: true } } } } }]);
  await mergePull('PR_1', 'SQUASH', 'a'.repeat(40), 't');
  assert.match(calls[0].body.query, /mergePullRequest/);
  assert.deepStrictEqual(calls[0].body.variables.input, { pullRequestId: 'PR_1', mergeMethod: 'SQUASH', expectedHeadOid: 'a'.repeat(40) });
});

test('mergePull: a head that moved, or any refusal, rejects with GitHub\'s own words', async () => {
  stub([{ body: { errors: [{ message: 'Head branch was modified. Review and try the merge again.' }] } }]);
  await assert.rejects(mergePull('PR_1', 'MERGE', 'a'.repeat(40), 't'), /Head branch was modified/);
});

test('setPullOpen closes or reopens', async () => {
  const calls = stub([{ body: { data: {} } }]);
  await setPullOpen('PR_1', false, 't');
  await setPullOpen('PR_1', true, 't');
  assert.match(calls[0].body.query, /closePullRequest/);
  assert.match(calls[1].body.query, /reopenPullRequest/);
  assert.deepStrictEqual(calls[1].body.variables.input, { pullRequestId: 'PR_1' });
});

test('setPullDraft converts to a draft or marks ready', async () => {
  const calls = stub([{ body: { data: {} } }]);
  await setPullDraft('PR_1', true, 't');
  await setPullDraft('PR_1', false, 't');
  assert.match(calls[0].body.query, /convertPullRequestToDraft/);
  assert.match(calls[1].body.query, /markPullRequestReadyForReview/);
  assert.deepStrictEqual(calls[0].body.variables.input, { pullRequestId: 'PR_1' });
});
```

Register `src/pulls/pullLifecycleApi.test.ts` in `tsconfig.json`'s `include` and `out/pulls/pullLifecycleApi.test.js` in the `node --test` list.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `./pullLifecycleApi` does not exist.

- [ ] **Step 3: Write `src/pulls/pullLifecycleApi.ts`**

```ts
'use strict';

import { requestGraphql } from '../github/githubApi';
import { MergeMethod } from './pullActionsModel';

const MERGE = `
mutation Merge($input: MergePullRequestInput!) { mergePullRequest(input: $input) { pullRequest { merged } } }`;

/** `expectedHeadSha` makes GitHub refuse when the branch moved since the page was loaded. Default commit message; the branch is kept. */
export async function mergePull(pullId: string, method: MergeMethod, expectedHeadSha: string, token: string | null): Promise<void> {
  await requestGraphql(MERGE, { input: { pullRequestId: pullId, mergeMethod: method, expectedHeadOid: expectedHeadSha } }, token);
}

const CLOSE = `
mutation Close($input: ClosePullRequestInput!) { closePullRequest(input: $input) { pullRequest { state } } }`;
const REOPEN = `
mutation Reopen($input: ReopenPullRequestInput!) { reopenPullRequest(input: $input) { pullRequest { state } } }`;

export async function setPullOpen(pullId: string, open: boolean, token: string | null): Promise<void> {
  await requestGraphql(open ? REOPEN : CLOSE, { input: { pullRequestId: pullId } }, token);
}

const TO_DRAFT = `
mutation ToDraft($input: ConvertPullRequestToDraftInput!) { convertPullRequestToDraft(input: $input) { pullRequest { isDraft } } }`;
const TO_READY = `
mutation ToReady($input: MarkPullRequestReadyForReviewInput!) { markPullRequestReadyForReview(input: $input) { pullRequest { isDraft } } }`;

export async function setPullDraft(pullId: string, draft: boolean, token: string | null): Promise<void> {
  await requestGraphql(draft ? TO_DRAFT : TO_READY, { input: { pullRequestId: pullId } }, token);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/pulls/pullLifecycleApi.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/pulls/pullLifecycleApi.ts extensions/null-tools/src/pulls/pullLifecycleApi.test.ts extensions/null-tools/tsconfig.json extensions/null-tools/package.json
git commit -m "feat(null-tools): merge, close, reopen and draft mutations"
```

---

### Task 6: The action row in the detail tab (webview)

**Files:**
- Modify: `extensions/null-tools/src/webview/pullDetailTypes.ts`
- Modify: `extensions/null-tools/src/webview/pullDetailHtml.ts`
- Modify: `extensions/null-tools/src/webview/pullDetail.ts`
- Modify: `extensions/null-tools/lib/pullDetail.css`
- Modify: `extensions/null-tools/src/webviewPullDetail.test.ts`
- Generated: `extensions/null-tools/lib/pullDetail.js` (by `npm run compile`, committed in Task 8)

**Interfaces:**
- Consumes (Task 4): the `PageActions` shape, mirrored by hand below.
- Produces: `pullActionsHtml(p: PullPage): string` (global in the shared bundle). Webview → host messages `{ type: 'review' | 'merge' | 'close' | 'reopen' | 'ready' | 'draft' }` (name only).

- [ ] **Step 1: Write the failing tests** — in `src/webviewPullDetail.test.ts`:

(a) Extend the `html` cast with `pullActionsHtml(p: Obj): string;`.

(b) Give the `page()` fixture default actions (add before `...over`):

```ts
  id: 'PR_1', headSha: 'c'.repeat(40),
  actions: {
    review: { available: true, canApprove: true, pending: null },
    merge: { enabled: true, hint: 'Ready to merge.', methods: ['MERGE', 'SQUASH'] },
    state: 'close', draft: 'draft',
  },
```

(c) Append:

```ts
const actions = (over: Obj = {}): Obj => ({ ...page().actions, ...over });

test('actions row: an open PR offers review, merge, convert to draft and close', () => {
  const out = html.pullActionsHtml(page());
  for (const act of ['review', 'merge', 'draft', 'close']) assert.ok(out.includes(`data-act="${act}"`), act);
  assert.ok(out.includes('class="btn btn-primary" data-act="merge">'), 'merge is the primary button and enabled');
  assert.ok(out.includes('Ready to merge.'));
});

test('actions row: a disabled merge says why; the hint is escaped', () => {
  const out = html.pullActionsHtml(page({ actions: actions({ merge: { enabled: false, hint: '<b>conflicts</b>', methods: ['MERGE'] } }) }));
  assert.match(out, /data-act="merge" disabled>/);
  assert.ok(!out.includes('<b>conflicts</b>') && out.includes('&lt;b&gt;conflicts&lt;/b&gt;'));
});

test('actions row: a pending review shows its comment count; a draft offers ready for review', () => {
  assert.ok(html.pullActionsHtml(page({ actions: actions({ review: { available: true, canApprove: true, pending: 3 } }) })).includes('Finish review (3)'));
  const draft = html.pullActionsHtml(page({ draft: true, actions: actions({ draft: 'ready', merge: { enabled: false, hint: 'Mark this as ready for review to merge it.', methods: ['MERGE'] } }) }));
  assert.ok(draft.includes('data-act="ready"') && draft.includes('Ready for review'));
  assert.ok(!draft.includes('data-act="draft"'));
});

test('actions row: closed offers reopen only; merged and read-only viewers get no row', () => {
  const closed = html.pullActionsHtml(page({ state: 'closed', actions: actions({
    review: { available: false, canApprove: false, pending: null }, merge: { enabled: false, hint: '', methods: ['MERGE'] }, state: 'reopen', draft: null }) }));
  assert.ok(closed.includes('data-act="reopen"'));
  for (const act of ['merge', 'review', 'close', 'draft']) assert.ok(!closed.includes(`data-act="${act}"`), act);
  const nothing = html.pullActionsHtml(page({ state: 'merged', actions: actions({
    review: { available: false, canApprove: false, pending: null }, merge: { enabled: false, hint: '', methods: [] }, state: null, draft: null }) }));
  assert.strictEqual(nothing, '');
});

test('the page carries the actions row, and no longer claims reviewing and merging happen on GitHub', () => {
  const out = html.pullPageHtml(page());
  assert.ok(out.includes('class="pr-actions"'));
  assert.ok(!out.includes('reviewing and merging happen on GitHub'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `html.pullActionsHtml is not a function` (and `pullActionsHtml` unknown to the typed cast is fine at runtime).

- [ ] **Step 3: Implement**

(a) `src/webview/pullDetailTypes.ts` — add to the mirror, before `interface PullPage`:

```ts
type PullMergeMethod = 'MERGE' | 'SQUASH' | 'REBASE';
interface PullActions {
  review: { available: boolean; canApprove: boolean; pending: number | null; };
  merge: { enabled: boolean; hint: string; methods: PullMergeMethod[]; };
  state: 'close' | 'reopen' | null;
  draft: 'ready' | 'draft' | null;
}
```

and in `interface PullPage`: add `id: string; headSha: string;` after `number: number;` (host-only, never rendered) and `actions: PullActions;` as the last field.

(b) `src/webview/pullDetailHtml.ts` — add above `pullHeaderHtml`:

```ts
/** Review, merge, draft and close/reopen. The page only asks; the host re-checks `actions` before it writes anything. */
function pullActionsHtml(p: PullPage): string {
  const a = p.actions;
  const button = (act: string, label: string, kind = 'secondary', disabled = false): string =>
    `<button type="button" class="btn btn-${kind}" data-act="${act}"${disabled ? ' disabled' : ''}>${label}</button>`;
  const buttons: string[] = [];
  if (a.review.available) buttons.push(button('review', a.review.pending === null ? 'Review' : `Finish review (${a.review.pending})`));
  if (p.state === 'open') buttons.push(button('merge', 'Merge', 'primary', !a.merge.enabled));
  if (a.draft) buttons.push(button(a.draft, a.draft === 'ready' ? 'Ready for review' : 'Convert to draft'));
  if (a.state) buttons.push(button(a.state, a.state === 'close' ? 'Close' : 'Reopen'));
  if (buttons.length === 0) return '';
  const hint = p.state === 'open' && a.merge.hint ? `<span class="muted">${escapeHtml(a.merge.hint)}</span>` : '';
  return `<div class="pr-actions">${buttons.join('')}${hint}</div>`;
}
```

In `pullHeaderHtml`, append the row after the `meta-row` div: change the end of the template from `</div>\`;` (closing `meta-row`) to `</div>\n    ${pullActionsHtml(p)}\`;`.

In `pullPageHtml`, replace the footer text `Commenting, reviewing and merging happen on GitHub for now.` with `Conversation comments are written on GitHub for now.`

(c) `src/webview/pullDetail.ts` — in the click `switch`, after the `rerun` case:

```ts
      case 'review': case 'merge': case 'close': case 'reopen': case 'ready': case 'draft':
        // The host answers with a fresh page (a change or a failure) or with the same page again (a cancelled dialog).
        root.querySelectorAll<HTMLButtonElement>('.pr-actions button').forEach(b => { b.disabled = true; });
        post({ type: button?.dataset.act });
        break;
```

(d) `lib/pullDetail.css` — append:

```css
.pr-actions { display:flex; align-items:center; gap:8px; margin:12px 0; flex-wrap:wrap; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS. If an older assertion in `webviewPullDetail.test.ts` now fails because the header contains more `data-act` buttons (for example line 132 checks `checkout`, `open-github`, `refresh` are present, which still holds), fix the assertion, not the markup.

- [ ] **Step 5: Build the bundle**

Run: `npx tsc -p tsconfig.webview-pull-detail.json`
Expected: no errors; `lib/pullDetail.js` changes (it also carries the uncommitted pre-existing diff mentioned in Global Constraints; Task 8 commits it with the refresh).

- [ ] **Step 6: Commit**

```bash
git add extensions/null-tools/src/webview/pullDetailTypes.ts extensions/null-tools/src/webview/pullDetailHtml.ts extensions/null-tools/src/webview/pullDetail.ts extensions/null-tools/lib/pullDetail.css extensions/null-tools/src/webviewPullDetail.test.ts
git commit -m "feat(null-tools): review, merge and state actions in the pull request tab"
```

---

### Task 7: The native flows, the panel and the tree entry points

**Files:**
- Create: `extensions/null-tools/src/pulls/pullActions.ts`
- Modify: `extensions/null-tools/src/pulls/pullDetailPanel.ts`
- Modify: `extensions/null-tools/src/pulls/pullsIntegration.ts` (`null.pulls.finishReview`)
- Modify: `extensions/null-tools/package.json` (command, tree menu, palette hiding)

**Interfaces:**
- Consumes: `PageActions`, `reviewChoices`, `reviewBodyError` (Task 4); `fetchReviewState`, `submitReview`, `submitNewReview`, `discardReview` (Task 2); `mergePull`, `setPullOpen`, `setPullDraft` (Task 5); `PullPage` incl. `id`, `headSha`, `actions`.
- Produces (`pullActions.ts`):
  - `type Outcome = 'changed' | 'failed' | 'cancelled'`
  - `type PageAction = 'review' | 'merge' | 'close' | 'reopen' | 'ready' | 'draft'`
  - `const PAGE_ACTIONS: ReadonlySet<string>` — the names the panel accepts from the webview
  - `interface PullTarget { owner: string; repo: string; number: number }`
  - `finishReview(target: PullTarget): Promise<Outcome>` — QuickPick → InputBox → submit or discard
  - `runAction(action: PageAction, target: PullTarget, page: PullPage): Promise<Outcome>` — re-checks `page.actions`, then runs the flow

As glue, this task is covered by compile + the manual pass; its decisions are already tested as pure functions (Tasks 4–5).

- [ ] **Step 1: Write `src/pulls/pullActions.ts`**

```ts
'use strict';

import * as vscode from 'vscode';
import { getGithubSession } from '../github/githubAuth';
import { MergeMethod, ReviewChoice, reviewBodyError, reviewChoices } from './pullActionsModel';
import { PullPage } from './pullDetailModel';
import { mergePull, setPullDraft, setPullOpen } from './pullLifecycleApi';
import { describeFailure } from './pullModel';
import { ReviewEvent, ReviewState, discardReview, fetchReviewState, submitNewReview, submitReview } from './pullReviewApi';

/** `changed`: GitHub accepted a write. `failed`: it refused (already shown). `cancelled`: the user backed out, nothing happened. */
export type Outcome = 'changed' | 'failed' | 'cancelled';
export type PageAction = 'review' | 'merge' | 'close' | 'reopen' | 'ready' | 'draft';
/** What the panel accepts from the webview; anything else is ignored. */
export const PAGE_ACTIONS: ReadonlySet<string> = new Set<PageAction>(['review', 'merge', 'close', 'reopen', 'ready', 'draft']);

export interface PullTarget { owner: string; repo: string; number: number }

const METHOD_LABELS: Record<MergeMethod, string> = {
  MERGE: 'Create a merge commit', SQUASH: 'Squash and merge', REBASE: 'Rebase and merge',
};

async function token(): Promise<string | null> {
  return (await getGithubSession(true))?.accessToken ?? null;
}

function fail(what: string, err: unknown): Outcome {
  void vscode.window.showErrorMessage(`Could not ${what}: ${describeFailure(err)}`);
  return 'failed';
}

/** Ends the viewer's review: comment / approve / request changes (submitting any pending comments with it), or discard it. */
export async function finishReview(target: PullTarget): Promise<Outcome> {
  const t = await token();
  if (!t) return 'cancelled';
  let state: ReviewState;
  try {
    state = await fetchReviewState(target.owner, target.repo, target.number, t);
  } catch (err) {
    return fail(`load the review of #${target.number}`, err);
  }
  const picked = await vscode.window.showQuickPick(
    reviewChoices(state).map(o => ({ label: o.label, description: o.description, choice: o.choice })),
    { title: `Review #${target.number}`, placeHolder: 'How do you want to finish your review?' },
  );
  if (!picked) return 'cancelled';
  const choice: ReviewChoice = picked.choice;
  try {
    if (choice === 'DISCARD') {
      const sure = await vscode.window.showWarningMessage(
        `Discard your ${state.comments} unsent comment${state.comments === 1 ? '' : 's'} on #${target.number}?`, { modal: true }, 'Discard');
      if (!sure || state.reviewId === null) return 'cancelled';
      await discardReview(state.reviewId, t);
      void vscode.window.showInformationMessage('Pending review discarded.');
      return 'changed';
    }
    const event: ReviewEvent = choice;
    const body = await vscode.window.showInputBox({
      title: `${picked.label} · #${target.number}`,
      prompt: event === 'APPROVE' ? 'Optional summary' : 'Summary',
      validateInput: v => reviewBodyError(event, state.comments, v),
    });
    if (body === undefined) return 'cancelled';
    if (state.reviewId === null) await submitNewReview(state, event, body.trim(), t);
    else await submitReview(state.reviewId, event, body.trim(), t);
    void vscode.window.showInformationMessage(`Review submitted on #${target.number}.`);
    return 'changed';
  } catch (err) {
    return fail(`submit the review of #${target.number}`, err);
  }
}

async function merge(page: PullPage): Promise<Outcome> {
  const methods = page.actions.merge.methods;
  const method: MergeMethod | undefined = methods.length === 1 ? methods[0]
    : (await vscode.window.showQuickPick(
      methods.map(m => ({ label: METHOD_LABELS[m], method: m })), { title: `Merge #${page.number}`, placeHolder: 'How should it be merged?' }))?.method;
  if (!method) return 'cancelled';
  const sure = await vscode.window.showWarningMessage(
    `${METHOD_LABELS[method]}: #${page.number} into ${page.baseRef}?`, { modal: true, detail: page.title }, 'Merge');
  if (!sure) return 'cancelled';
  const t = await token();
  if (!t) return 'cancelled';
  try {
    await mergePull(page.id, method, page.headSha, t); // pinned to the head this page showed
    void vscode.window.showInformationMessage(`Merged #${page.number} into ${page.baseRef}.`);
    return 'changed';
  } catch (err) {
    return fail(`merge #${page.number}`, err);
  }
}

/** Close / reopen / draft: reversible, so no confirmation. */
async function changeState(action: 'close' | 'reopen' | 'ready' | 'draft', page: PullPage): Promise<Outcome> {
  const t = await token();
  if (!t) return 'cancelled';
  try {
    if (action === 'close' || action === 'reopen') await setPullOpen(page.id, action === 'reopen', t);
    else await setPullDraft(page.id, action === 'draft', t);
    return 'changed';
  } catch (err) {
    const what = { close: 'close', reopen: 'reopen', ready: 'mark as ready', draft: 'convert to a draft' }[action];
    return fail(`${what} #${page.number}`, err);
  }
}

/** Runs one tab action. The host trusts its own loaded `page.actions`, never the webview: an action the page did not offer does nothing. */
export async function runAction(action: PageAction, target: PullTarget, page: PullPage): Promise<Outcome> {
  const a = page.actions;
  switch (action) {
    case 'review': return a.review.available ? finishReview(target) : 'cancelled';
    case 'merge': return a.merge.enabled ? merge(page) : 'cancelled';
    case 'close': case 'reopen': return a.state === action ? changeState(action, page) : 'cancelled';
    case 'ready': case 'draft': return a.draft === action ? changeState(action, page) : 'cancelled';
  }
}
```

- [ ] **Step 2: Wire the panel** — in `src/pulls/pullDetailPanel.ts`:

(a) Imports: add `import { PAGE_ACTIONS, PageAction, runAction } from './pullActions';`.

(b) Extend `InboundMessage` with `| { type: PageAction }` (keep the existing members).

(c) Add a field `private busy = false;` next to `disposed`, and this method after `rerun()`:

```ts
  /** One write at a time: a second click (or a second button) while a dialog or request is open is dropped. */
  private async act(action: PageAction): Promise<void> {
    if (this.busy || !this.page) return;
    this.busy = true;
    try {
      const outcome = await runAction(action, { ...this.repo, number: this.pull.number }, this.page);
      if (outcome === 'cancelled') {
        this.post({ type: 'page', page: this.page }); // same page again: re-enables the buttons
      } else {
        await this.load(); // a refusal can mean the PR changed (moved head, closed elsewhere): show it as it is now
        void vscode.commands.executeCommand('null.pulls.refresh'); // state icon, merged PRs leave the Open list
      }
    } finally {
      this.busy = false;
    }
  }
```

(d) In `handle()`, add before `case 'openExternal'`:

```ts
      case 'review': case 'merge': case 'close': case 'reopen': case 'ready': case 'draft':
        if (PAGE_ACTIONS.has(msg.type)) await this.act(msg.type);
        break;
```

- [ ] **Step 3: Tree entry point** — in `src/pulls/pullsIntegration.ts`: add `import { finishReview } from './pullActions';` and, after the `null.pulls.openDetail` registration:

```ts
    vscode.commands.registerCommand('null.pulls.finishReview', async (node: PullNode) => {
      const ctx = tree.context();
      if (node.kind !== 'pull' || !ctx) return;
      if (await finishReview({ ...ctx.repo, number: node.pull.number }) !== 'cancelled') await refresh();
    }),
```

In `package.json`: add the command `{ "command": "null.pulls.finishReview", "title": "Null: Finish Pull Request Review…" }` after `null.pulls.openDetail`; the tree menu entry after the last `1_pull` line (add a comma to that line):

```json
        { "command": "null.pulls.finishReview", "when": "view == null.pullsView && viewItem == pull", "group": "1_pull@3" }
```

and in `commandPalette`: `{ "command": "null.pulls.finishReview", "when": "false" },`.

- [ ] **Step 4: Compile and run the unit suite**

Run: `npm test`
Expected: PASS and no type errors (the `runAction` switch is exhaustive over `PageAction`).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/pulls/pullActions.ts extensions/null-tools/src/pulls/pullDetailPanel.ts extensions/null-tools/src/pulls/pullsIntegration.ts extensions/null-tools/package.json
git commit -m "feat(null-tools): finish reviews and merge, close or draft from the pull request tab"
```

---

### Task 8: Verify in the real app, document, refresh output

**Files:**
- Modify: `extensions/null-tools/src/test/suite/pulls.spec.ts` (new command ids)
- Modify: `extensions/null-tools/CLAUDE.md` (extend the Pull Requests row)
- Modify: `docs/specs/pull-requests-design.md` (Phase 3 plan link, decisions 24–32, Phase 3 limits)
- Modify: `extensions/null-tools/out/**`, `extensions/null-tools/lib/pullDetail.js` (compiled, via `npm run compile`)

- [ ] **Step 1: Register the new commands in the integration spec** — in `src/test/suite/pulls.spec.ts`, extend the id list with `'null.pulls.addToReview', 'null.pulls.resolveThread', 'null.pulls.unresolveThread', 'null.pulls.finishReview'`.

- [ ] **Step 2: Verify in the real app** — run the `/verify-local` skill for `null-tools` (it syncs `lib/` and `out/` into the installed Null IDE and reloads). There is no fake GitHub (`api.github.com` is hardcoded), so use a **throwaway repository you own on github.com** with a second branch and several small PRs, ideally with one required check and a second account (or a collaborator) to approve with. Check each:

1. **Add Review Comment:** in a PR's file diff, comment on a line: the widget shows **Add Review Comment** (primary) and **Comment Now**. Add one: the comment shows the `Pending` label; github.com shows a pending review with it, visible only to you. Add a second on another file and a reply inside the first thread: both join the same review (the tab's button reads *Finish review (3)*).
2. **Multi-line range** that crosses two hunks: the comment lands on its first line, no error.
3. **Comment Now** still posts at once (no `Pending` label), and its one-time notice now mentions Add Review Comment.
4. **Finish review → Comment** with the three pending comments and an empty body: accepted (comments are pending). With nothing pending and an empty body: the InputBox shows *Write a comment…* and Enter does nothing. **Request changes** with an empty body: *Say what needs to change.* Submit one with a body: the tab shows the review card and the PR row's review state updates after the refresh.
5. **Approve** from a second account: tree row and tab show *approved*. On **your own** PR the QuickPick offers only *Comment*.
6. **Discard pending review:** add a pending comment, finish → *Discard pending review* → confirm: the `Pending` thread disappears after the refresh and github.com shows no pending review.
7. **Resolve / Unresolve:** the thread-title check button resolves (thread collapses, state Resolved) and the discard-arrow button reopens it; a viewer without rights sees neither. **Stale head:** open the tab, push a new commit to the PR branch from a terminal, press *Merge* in the (not yet reloaded) tab and confirm: GitHub refuses ("Head branch was modified…"), the toast shows it, and the tab reloads to the new head.
8. **Merge:** with a repo that allows several methods the picker appears, with one it does not; the modal names the PR and base. After confirming: toast, the tab shows *Merged*, the PR leaves the Open list, the branch still exists. Press *Merge* twice quickly / click another button while the dialog is open: only one dialog and one merge. With a failing required check: the button is enabled with the *blocked* hint and GitHub's refusal appears verbatim (an admin may get through; that is GitHub's decision).
9. **Draft ↔ ready, close ↔ reopen:** each flips the badge, the row icon and the buttons. A merged PR shows no action row. **Read-only viewer:** in a repository where you only have *Triage* or *Read* access, *Merge* is disabled with *Merging needs write access…* and there is no *Close* / *Convert to draft*. (The host-side re-check in `runAction` has no UI path to exercise; it is covered by reading the code.)
10. **Pending review changed elsewhere:** add a pending comment, delete the pending review on github.com, then **Finish review** in the editor: the QuickPick no longer offers *Discard* and Approve/Comment submit a body-only review; the old `Pending` thread disappears on the next refresh. Add another review comment: a fresh pending review is started.
11. **Tree entry:** right-click a PR row → *Null: Finish Pull Request Review…* behaves like the tab's *Review* button. Cancelling any dialog changes nothing and leaves the tab's buttons enabled again.
12. **Signed out:** with no GitHub session, Add Review Comment / Merge prompt to sign in; declining changes nothing.

Fix anything found before continuing; if a mutation shape differs from what `pullReviewApi.ts` sends, correct it and its test together.

- [ ] **Step 3: Document the feature** — in `extensions/null-tools/CLAUDE.md`, append to the end of the **Pull Requests** table row (before the closing `|`): ` Phase 3 (`docs/plans/pull-requests-phase3-review-lifecycle.md`): pending reviews and thread resolving in the diff editor (`pullReview.ts`: **Add Review Comment** vs **Comment Now**; mutations in `pullReviewApi.ts`), and merge / close / reopen / draft in the detail tab (`pullLifecycleApi.ts`). `pullActionsModel.ts` is pure: `PullPage.actions` (what the viewer may do, computed by the host from GitHub's flags), the review choices and the body rules. `pullActions.ts` holds the native QuickPick / InputBox / modal flows; the webview sends an action name only and the host re-checks it against its own page (`runAction`), writes with `expectedHeadOid`, and never caches the pending review (always `fetchReviewState`).`

- [ ] **Step 4: Update the spec** — in `docs/specs/pull-requests-design.md`: set the Phase 3 row's Plan cell to `docs/plans/pull-requests-phase3-review-lifecycle.md`; append decisions 24–32 from the top of this plan to the *Decisions* list; change decision 17's tail so it reads that the only PR-level writes are the Phase 3 lifecycle actions; and add a *Known limits of Phase 3* list: the review body is a single-line InputBox; no PR-level comment composer and no edit/delete of comments; merge uses GitHub's default commit message and does not delete the head branch or drive merge queues / auto-merge; resolving a thread is immediate and not part of the review; outdated threads still cannot be replied to or resolved from the editor; pending review is per viewer and per PR, found by asking GitHub each time (one extra request per action).

- [ ] **Step 5: Refresh compiled output, update the graph, commit**

```bash
cd extensions/null-tools && npm run compile && cd ../..
graphify update .
git add extensions/null-tools/src/test/suite/pulls.spec.ts extensions/null-tools/CLAUDE.md docs/specs/pull-requests-design.md
git commit -m "docs(null-tools): document pull request reviews and lifecycle actions"
git add extensions/null-tools/out extensions/null-tools/lib
git commit -m "chore: refresh null-tools compiled output"
```

(Compiled `out/` and `lib/*.js` from earlier tasks are intentionally not committed per task; this last commit also picks up the pre-existing uncommitted compiled diffs noted in Global Constraints, which is correct because `npm run compile` regenerates all of them from the committed sources.) After this task run `/wiki-sync` as a separate step (new buttons, a new command and a new review workflow are user-facing).

- [ ] **Step 6: Close the loop on GitHub** — comment on #117 "Phase 3 shipped (pending reviews, resolve threads, merge, close/reopen, draft): `docs/plans/pull-requests-phase3-review-lifecycle.md`; phases 4–6 remain" and keep it open. (Ask first: this is outward-facing.)

---

## Self-Review

**Spec coverage** (Phase 3 row: *pending review (start → submit), approve / request changes, resolve threads, merge (method choice), close/reopen, draft ↔ ready*): pending review → Tasks 2, 3; submit / approve / request changes / discard → Tasks 2, 4, 7; resolve threads → Tasks 1, 2, 3; merge with method choice → Tasks 4, 5, 7; close/reopen and draft ↔ ready → Tasks 4, 5, 7; surfaces → Task 6 (tab), Task 7 (tree). Mapping rows in the spec's #117 table for "Approve, request changes, resolve conversations" and "Close/reopen, merge" are all covered. The Phase 2 note "add a PR-level comment composer to Phase 3 if wanted" is answered by decision 31 (not included).

**Placeholder scan:** no TBD/TODO; every code step shows its code. Task 4 step 5(e) elides "the existing fields" with a comment on purpose: they are unchanged lines of `mapPullPage` that the engineer keeps; only the additions are new.

**Type consistency:** `ReviewState` (Task 2) is consumed by `reviewChoices`' structural parameter (Task 4) and `finishReview` (Task 7); `ReviewEvent` is defined in `pullReviewApi.ts` and imported by `pullActionsModel.ts` (type only, no cycle: `pullReviewApi` imports `pullModel`, not `pullActionsModel`). `PageActions` (Task 4) is mirrored as `PullActions` in the webview (Task 6) with the same field names. `PullPage.id` / `headSha` (Task 4) are what `mergePull` / `changeState` read (Task 7). Action names `review|merge|close|reopen|ready|draft` are the same in `PageActions.state`/`draft` values, the HTML `data-act`s, the webview message types and `PageAction`.

**Review Focus:** all five items have a test or a numbered manual check above.

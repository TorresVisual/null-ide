# GitHub Issues Panel v2, Phase 3 (Detail): Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Replace the v1 issue detail tab (REST fetch, one global Edit mode, `marked` rendering, flat comment list, one shared tab) with a github.com-style tab: server-rendered markdown, a timeline with events, per-post edit/delete, reactions, sub-issues, linked PRs, a metadata sidebar with optimistic pickers, close reasons, a sticky header, and one tab per issue.

**Architecture:** One GraphQL query (`ISSUE_DETAIL`) is mapped into an `IssueDetail` (the REST-shaped `GithubIssue` the rest of the extension uses, plus the body as a post, a typed timeline, sub-issues and linked PRs). `IssueDetailPanel` tracks tabs by issue number (a plain click reuses the shared tab, Ctrl/middle-click opens another) and answers every webview write by performing it and re-fetching: the webview applies the change optimistically, then either receives a fresh `detail{afterWrite}` or a `failed{what:'write'}` and rolls back. The webview's HTML is built by pure functions (`detailHtml.ts`, `detailSidebarHtml.ts`) that the existing `vm` sandbox tests exercise.

**Tech Stack:** TypeScript 5.8, VS Code extension API (`^1.85.0`), vanilla DOM webviews, GitHub GraphQL + REST, `node:test`.

**Spec:** [docs/specs/github-issues-panel-v2-design.md](../specs/github-issues-panel-v2-design.md) (this plan covers "Delivery phases → 3. Detail"). Phases 1 and 2 are on `main`.

**Deviations from the spec's Phase 3 list** (each one is deliberate):
- **No composer yet.** New comments and edits use a plain textarea; Phase 4 swaps in Write/Preview, toolbar, autocomplete and drafts. Quote reply, Ctrl+Enter and Close-with-comment are in.
- **Post writes use GraphQL** (`addComment`, `updateIssueComment`, `deleteIssueComment`), not the spec's REST `updateComment`/`deleteComment`: the mutations return `bodyHTML`, so a posted or edited comment renders without a refetch and no `databaseId` is needed. The REST comment functions are deleted. Title, body, state, labels, assignees and milestone stay REST `PATCH`.
- **Every successful state/sidebar/body write re-fetches the issue** instead of patching locally. The spec's `patched`/`reverted` pair becomes `detail{afterWrite}` + `failed{what:'write'}`: one code path, and the new timeline event ("closed this") appears by itself.
- **Multi-select pickers (assignees, labels) apply when the popover closes**, like github.com, instead of one request per tick (a race of `PATCH`es that replace the whole set). `openPicker` gains `onClose`.
- **Reactions are not optimistic**: the host answers with the post's fresh reaction groups.
- **"Create sub-issue" waits for Phase 4** (it needs the create form's Parent field). *Add sub-issue* picks from the 50 newest open issues.
- **Development lists closing-PR references only.** Cross-referenced PRs stay on the timeline. Participants show at most 10.
- **"Load more" has no count** ("N hidden items" would include event types the tab skips).
- **Images in posts become labelled placeholders** (`neutralizeImagesHtml`): the CSP only allows avatars, so v1 showed broken icons. Phase 5 replaces them with thumbnails. The lightbox goes with them.
- **The New issue form moves, behavior unchanged, to its own singleton tab** and to `issueCreate.ts` (the spec has this in Phase 4; it falls out of the per-issue tab tracking).
- **`lib/marked.js` is deleted** (nothing else loads it). DOMPurify stays.
- Verified against live GitHub on 2026-10-04: `ISSUE_DETAIL` and `ISSUE_TIMELINE` run clean and map without error for 12 issues of `TorresVisual/null-ide`; a pull request number returns `Could not resolve to an Issue`; every mutation document passes validation (dummy ids answer `NOT_FOUND`, not a schema error); `closedByPullRequestsReferences(includeClosedPrs: true)`, `issueType { id name }`, `subIssues`, `parent`, `ReferencedEvent`, `SubIssueAddedEvent` and `ClosedEvent.closer` all exist.

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
- Edit TypeScript sources only; never hand-edit compiled output (`out/*.js`, `lib/issues.js`, `lib/issueDetail.js`, `out/webview-shared.js`). `out/` and `lib/*.js` **are tracked in git**: after `npm run compile`, stage the compiled files that belong to the task in the same commit as their source. Never stage unrelated modified files (`git status` before every commit).
- Unit tests only cover files that don't `import 'vscode'` (repo convention). The main `tsconfig.json` has an explicit `include` list: every new `*.test.ts` must be added there *and* to the `test` script in `package.json`. Webview helpers are tested through `tsconfig.webview-shared.json` → `out/webview-shared.js` (see `src/webviewShared.test.ts`).
- Webview files are `module: none` scripts: no `import`/`export`. Top-level names share one global scope per bundle, so every top-level identifier must be unique across all files of a bundle (`issueDetail.js` and `webview-shared.js` now share `detailHtml.ts` and friends).
- No new runtime or dev dependencies (no `jsdom`, no markdown library). `@primer/octicons` is only downloaded into a temp dir to run the generator.
- Colors: theme variables only (`var(--vscode-*)`), no hex fallbacks in new CSS, except label colors (repo data).
- Interpolate only escaped text into webview `innerHTML`: user-controlled strings go through `escapeHtml`. The only trusted markup is `post.bodyHTML` (GitHub-rendered), and it reaches the DOM only through `neutralizeImagesHtml` + `DOMPurify.sanitize`. `PickerItem.html` is markup the caller has already escaped.
- Commit messages: conventional style (`feat(null-tools): …`), ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Don't push.
- Run all `npm`/`npx` commands from `extensions/null-tools/`.
- The `impeccable` edit hook may report `broken-image` on the `<img\b…` regular expression in `detailHtml.ts`. It matches regex source text, not markup: a false positive. Persist the narrowest ignore with the command the hook prints (`impeccable hooks ignore-value broken-image "<value>" --reason "regex that strips <img>, not markup"`) and say so in the commit report.

## Review Focus

1. **A write racing a refresh.** A tab-focus refresh, a second edit, or a failed request can arrive while an optimistic change is still unconfirmed; the user's pending edit must not flicker back, and a failure must restore what GitHub still has. The `pending`/`rollback` logic lives in the webview entry script (not unit-testable without a DOM), so it is checked manually in Task 7 (scenarios 6 and 7).
2. **A deleted author.** GraphQL returns `author: null` for deleted accounts and `actor: null` on events: show "ghost", never crash. Pinned in Task 1 (`a deleted author is shown as ghost…`, `cross references show … a deleted actor is ghost`).
3. **A repo without issue types, milestones, parent, sub-issues or linked PRs** (this repo has none of them). Pinned in Task 1 (`mapIssueDetail copes with a repo without…`) and Task 3 (`sidebarHtml leaves out Type…`, `…the empty states`).
4. **Hostile text.** Titles, logins, labels, link URLs and image `alt` text come from other people. Pinned in Task 3 (`eventHtml escapes titles and logins…`, `neutralizeImagesHtml does not let a raw < in alt text become markup`, `postHtml in edit mode shows the escaped markdown source…`, `issueNumberFromLink` look-alike hosts).
5. **Someone who can't edit.** A viewer without write access must not see edit gears, Edit/Delete, "assign yourself" or sub-issue controls. Pinned in Task 3 (`sidebarHtml shows edit gears… only to someone who can edit`, `subIssuesHtml … only when editable`); checked on a repo you don't own in Task 7 (scenario 18).
6. **A very long thread, and a number that isn't an issue.** More than 100 timeline items page in with "Load more", and posting a comment while pages remain must not duplicate it; a `/issues/<n>` link whose number is a pull request must show a retryable error, not a blank tab. Both need a live thread; Task 7 (scenarios 16 and 17).

---

### Task 1: Detail data layer (`detailQueries.ts`)

**Files:**
- Create: `src/github/detailQueries.ts`
- Create: `src/github/detailQueries.test.ts`
- Modify: `src/github/githubQueries.ts` (export five declarations), `src/github/types.ts` (append types), `tsconfig.json` (`include`), `package.json` (`test` script)

**Interfaces:**
- Consumes (from `githubQueries.ts`, exported here): `mapIssue(n: GqlIssue): GithubIssue`, `toUser(u: GqlUser)`, `GHOST`, `GqlUser`, `GqlIssue`.
- Produces:
  - Documents: `ISSUE_DETAIL`, `ISSUE_TIMELINE`, `ADD_COMMENT`, `UPDATE_COMMENT`, `DELETE_COMMENT`, `ADD_REACTION`, `REMOVE_REACTION`, `SET_ISSUE_TYPE`, `ADD_SUB_ISSUE`, `REMOVE_SUB_ISSUE`, `COMMENT_FIELDS`.
  - `mapIssueDetail(data: IssueDetailData, repo: string): IssueDetail` (`repo` is `owner/name`; throws `Error('Issue not found.')` when the issue is null)
  - `mapTimelinePage(timeline: GqlTimeline, repo: string): TimelinePage`
  - `mapComment(n: GqlComment): IssuePost`, `mapReactions(groups: GqlReactionGroup[]): ReactionGroup[]`, `collapseTimeline(items: TimelineItem[]): TimelineItem[]`
  - Types in `types.ts`: `ReactionContent`, `ReactionGroup`, `IssuePost`, `TimelineEventBody`, `TimelineEvent`, `TimelineItem`, `SubIssue`, `LinkedPr`, `IssueDetail`, `TimelinePage`.
  - Exported GraphQL shapes: `GqlComment`, `GqlReactionGroup`, `IssueDetailData`, `IssueTimelineData`.

- [ ] **Step 1: Write the failing test**

Create `src/github/detailQueries.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { IssueDetailData, collapseTimeline, mapComment, mapIssueDetail, mapReactions, mapTimelinePage } from './detailQueries';
import { TimelineItem } from './types';

const user = { login: 'octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' };
const groups = [
  { content: 'THUMBS_UP', viewerHasReacted: true, reactors: { totalCount: 2 } },
  { content: 'EYES', viewerHasReacted: false, reactors: { totalCount: 0 } },
];

const commentNode = (over: Record<string, unknown> = {}) => ({
  __typename: 'IssueComment', id: 'IC_1', url: 'https://github.com/o/r/issues/7#issuecomment-1', body: 'Looks **good**',
  bodyHTML: '<p>Looks <strong>good</strong></p>', createdAt: '2026-10-01T11:00:00Z', lastEditedAt: null,
  authorAssociation: 'MEMBER', isMinimized: false, minimizedReason: null, viewerCanUpdate: true, viewerCanDelete: false,
  author: user, reactionGroups: groups, ...over,
});

const issueNode = (over: Record<string, unknown> = {}) => ({
  id: 'I_7', number: 7, title: 'Crash on start', body: 'It crashes', bodyHTML: '<p>It crashes</p>', state: 'OPEN',
  stateReason: null, url: 'https://github.com/o/r/issues/7', createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-02T10:00:00Z', closedAt: null, lastEditedAt: '2026-10-01T10:05:00Z', authorAssociation: 'OWNER',
  viewerCanUpdate: true, author: user, labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
  assignees: { nodes: [user] }, comments: { totalCount: 1 },
  milestone: { number: 2, title: 'v1.0', progressPercentage: 33.3333 }, issueType: { id: 'IT_1', name: 'Bug' },
  subIssuesSummary: { total: 1, completed: 0 },
  subIssues: { nodes: [{ id: 'I_8', number: 8, title: 'Child', state: 'OPEN', stateReason: null, url: 'https://github.com/o/r/issues/8', assignees: { nodes: [user] } }] },
  parent: { number: 3, title: 'Epic', url: 'https://github.com/o/r/issues/3' },
  closedByPullRequestsReferences: { totalCount: 1, nodes: [{ number: 9, title: 'Fix', state: 'MERGED', url: 'https://github.com/o/r/pull/9', isDraft: false }] },
  participants: { nodes: [user] }, reactionGroups: groups,
  timelineItems: { pageInfo: { hasNextPage: true, endCursor: 'cur' }, nodes: [commentNode()] },
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({ repository: { issue: issueNode(over) } }) as unknown as IssueDetailData;

test('mapIssueDetail maps the header, sidebar data and the body as the first post', () => {
  const d = mapIssueDetail(detail(), 'o/r');
  assert.strictEqual(d.id, 'I_7');
  assert.strictEqual(d.issue.number, 7);
  assert.strictEqual(d.issue.state, 'open');
  assert.deepStrictEqual(d.issueType, { id: 'IT_1', name: 'Bug' });
  assert.deepStrictEqual(d.milestone, { number: 2, title: 'v1.0', percent: 33 });
  assert.deepStrictEqual(d.parent, { number: 3, title: 'Epic', url: 'https://github.com/o/r/issues/3' });
  assert.deepStrictEqual(d.subIssues.map(s => [s.id, s.number, s.state]), [['I_8', 8, 'open']]);
  assert.deepStrictEqual(d.linkedPrs, [{ number: 9, title: 'Fix', state: 'merged', isDraft: false, url: 'https://github.com/o/r/pull/9' }]);
  assert.strictEqual(d.participants.length, 1);
  assert.strictEqual(d.post.id, 'I_7');
  assert.strictEqual(d.post.bodyHTML, '<p>It crashes</p>');
  assert.strictEqual(d.post.viewerCanUpdate, true);
  assert.strictEqual(d.post.viewerCanDelete, false);
  assert.strictEqual(d.post.authorAssociation, 'OWNER');
  assert.strictEqual(d.hasMoreTimeline, true);
  assert.strictEqual(d.timelineCursor, 'cur');
});

test('mapIssueDetail copes with a repo without issue types, milestones, parent or linked PRs', () => {
  const d = mapIssueDetail(detail({
    milestone: null, issueType: null, parent: null, subIssuesSummary: null, closedByPullRequestsReferences: null,
    subIssues: { nodes: [] },
  }), 'o/r');
  assert.strictEqual(d.milestone, null);
  assert.strictEqual(d.issueType, null);
  assert.strictEqual(d.parent, null);
  assert.deepStrictEqual(d.linkedPrs, []);
  assert.deepStrictEqual(d.subIssues, []);
});

test('mapIssueDetail throws when the issue does not exist (e.g. the number belongs to a pull request)', () => {
  assert.throws(() => mapIssueDetail({ repository: { issue: null } }, 'o/r'), /not found/);
});

test('a deleted author is shown as ghost on the issue and on comments', () => {
  const d = mapIssueDetail(detail({
    author: null,
    timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [commentNode({ author: null })] },
  }), 'o/r');
  assert.strictEqual(d.post.author.login, 'ghost');
  const c = d.timeline[0];
  assert.strictEqual(c.kind === 'comment' && c.author.login, 'ghost');
});

test('mapComment maps reactions, minimized state and edit rights', () => {
  const post = mapComment(commentNode({ isMinimized: true, minimizedReason: 'OFF_TOPIC' }) as never);
  assert.deepStrictEqual(post.reactions, [
    { content: 'THUMBS_UP', count: 2, viewerHasReacted: true },
    { content: 'EYES', count: 0, viewerHasReacted: false },
  ]);
  assert.strictEqual(post.minimizedReason, 'off_topic');
  assert.strictEqual(mapComment(commentNode() as never).minimizedReason, null);
  assert.deepStrictEqual(mapReactions([]), []);
});

const page = (nodes: unknown[]) => mapTimelinePage({ pageInfo: { hasNextPage: false, endCursor: null }, nodes } as never, 'o/r');
const ev = (typename: string, over: Record<string, unknown> = {}) => ({
  __typename: typename, createdAt: '2026-10-01T12:00:00Z', actor: { login: 'octocat' }, ...over,
});

test('timeline events map to plain data and unknown event types are skipped', () => {
  const { items } = page([
    ev('ClosedEvent', { stateReason: 'NOT_PLANNED', closer: { abbreviatedOid: 'abc1234', url: 'https://github.com/o/r/commit/abc1234' } }),
    ev('ReopenedEvent'),
    ev('RenamedTitleEvent', { previousTitle: 'old', currentTitle: 'new' }),
    ev('AssignedEvent', { assignee: { login: 'hubot' } }),
    ev('MilestonedEvent', { milestoneTitle: 'v1.0' }),
    ev('MentionedEvent'),
    ev('SubscribedEvent'),
  ]);
  assert.deepStrictEqual(items.map(i => i.kind === 'event' ? i.type : 'comment'),
    ['closed', 'reopened', 'renamed', 'assigned', 'milestoned']);
  const closed = items[0];
  assert.ok(closed.kind === 'event' && closed.type === 'closed');
  assert.strictEqual(closed.reason, 'not_planned');
  assert.deepStrictEqual(closed.closer, { text: 'abc1234', url: 'https://github.com/o/r/commit/abc1234' });
});

test('a pull request closer is shown as #n, and a missing closer stays null', () => {
  const { items } = page([
    ev('ClosedEvent', { stateReason: 'COMPLETED', closer: { number: 12, url: 'https://github.com/o/r/pull/12' } }),
    ev('ClosedEvent', { stateReason: null, closer: null }),
  ]);
  const [a, b] = items;
  assert.ok(a.kind === 'event' && a.type === 'closed' && b.kind === 'event' && b.type === 'closed');
  assert.strictEqual(a.closer?.text, '#12');
  assert.strictEqual(b.closer, null);
  assert.strictEqual(b.reason, null);
});

test('cross references show #n in this repo and owner/repo#n elsewhere; a deleted actor is ghost', () => {
  const src = (nameWithOwner: string) => ({
    source: { number: 5, title: 'Related', url: 'https://github.com/x/y/issues/5', repository: { nameWithOwner } },
  });
  const { items } = page([ev('CrossReferencedEvent', src('O/R')), ev('CrossReferencedEvent', { ...src('x/y'), actor: null })]);
  const [a, b] = items;
  assert.ok(a.kind === 'event' && b.kind === 'event' && 'text' in a && 'text' in b);
  assert.strictEqual(a.text, 'Related #5');
  assert.strictEqual(b.text, 'Related x/y#5');
  assert.strictEqual(b.actor, 'ghost');
});

test('a cross reference without a source, or a commit reference without a commit, is dropped', () => {
  assert.deepStrictEqual(page([ev('CrossReferencedEvent', { source: null }), ev('ReferencedEvent', { commit: null })]).items, []);
});

const label = (name: string) => ({ name, color: 'ffffff' });
const labelEvent = (type: 'added' | 'removed', name: string, at: string, actor = 'octocat'): TimelineItem => ({
  kind: 'event', type: 'labels', at, actor, added: type === 'added' ? [label(name)] : [], removed: type === 'removed' ? [label(name)] : [],
});

test('collapseTimeline merges label events by the same actor within 60 seconds', () => {
  const out = collapseTimeline([
    labelEvent('added', 'bug', '2026-10-01T12:00:00Z'),
    labelEvent('added', 'ui', '2026-10-01T12:00:30Z'),
    labelEvent('removed', 'wip', '2026-10-01T12:01:10Z'),
  ]);
  assert.strictEqual(out.length, 1);
  const only = out[0];
  assert.ok(only.kind === 'event' && only.type === 'labels');
  assert.deepStrictEqual(only.added.map(l => l.name), ['bug', 'ui']);
  assert.deepStrictEqual(only.removed.map(l => l.name), ['wip']);
});

test('collapseTimeline keeps label events apart across actors, gaps over a minute, and other events', () => {
  assert.strictEqual(collapseTimeline([
    labelEvent('added', 'a', '2026-10-01T12:00:00Z'), labelEvent('added', 'b', '2026-10-01T12:00:10Z', 'hubot'),
  ]).length, 2);
  assert.strictEqual(collapseTimeline([
    labelEvent('added', 'a', '2026-10-01T12:00:00Z'), labelEvent('added', 'b', '2026-10-01T12:02:00Z'),
  ]).length, 2);
  const reopened: TimelineItem = { kind: 'event', type: 'reopened', at: '2026-10-01T12:00:05Z', actor: 'octocat' };
  assert.strictEqual(collapseTimeline([
    labelEvent('added', 'a', '2026-10-01T12:00:00Z'), reopened, labelEvent('added', 'b', '2026-10-01T12:00:10Z'),
  ]).length, 3);
});
```

In `tsconfig.json`, add `"src/github/detailQueries.test.ts"` to the `include` array right after `"src/github/githubQueries.test.ts"`.

In `package.json`, add ` out/github/detailQueries.test.js` right after `out/github/githubQueries.test.js` in the `test` script's `node --test …` file list.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsc -p tsconfig.json`
Expected: FAIL with `error TS2307: Cannot find module './detailQueries'`.

- [ ] **Step 3: Export the list mappers and add the types**

In `src/github/githubQueries.ts`, add `export` to these five existing declarations (nothing else changes): `interface GqlUser`, `interface GqlIssue`, `const toUser`, `const GHOST`, `function mapIssue`.

Append to the end of `src/github/types.ts`:

```ts
export type ReactionContent = 'THUMBS_UP' | 'THUMBS_DOWN' | 'LAUGH' | 'HOORAY' | 'CONFUSED' | 'HEART' | 'ROCKET' | 'EYES';

export interface ReactionGroup {
  content: ReactionContent;
  count: number;
  viewerHasReacted: boolean;
}

/** The issue body or one comment, as the detail tab shows it. `id` is the GraphQL node ID: reaction subject and edit/delete target. */
export interface IssuePost {
  id: string;
  url: string;
  author: GithubUser;
  /** GitHub's `authorAssociation` ("OWNER", "MEMBER", "NONE", ...); null on mutation payloads that omit it. */
  authorAssociation: string | null;
  createdAt: string;
  lastEditedAt: string | null;
  /** Server-rendered HTML; the webview sanitizes it again before inserting. */
  bodyHTML: string;
  /** Markdown source, for editing and quote reply. */
  body: string;
  reactions: ReactionGroup[];
  viewerCanUpdate: boolean;
  viewerCanDelete: boolean;
  /** Why a moderator collapsed this comment ("off-topic", "outdated", ...); null when it is shown normally. */
  minimizedReason: string | null;
}

/** What happened, without who/when. Split from `TimelineEvent` so mappers can build the body on its own. */
export type TimelineEventBody =
  | { type: 'labels'; added: GithubLabel[]; removed: GithubLabel[] }
  | { type: 'closed'; reason: 'completed' | 'not_planned' | 'duplicate' | null; closer: { text: string; url: string } | null }
  | { type: 'reopened' }
  | { type: 'renamed'; from: string; to: string }
  | { type: 'assigned' | 'unassigned'; login: string }
  | { type: 'milestoned' | 'demilestoned'; title: string }
  | { type: 'cross-referenced' | 'connected' | 'referenced' | 'sub-issue-added' | 'sub-issue-removed'; text: string; url: string };

/** One line on the timeline rail. `actor` is a login ("ghost" for deleted accounts). */
export type TimelineEvent = { kind: 'event'; at: string; actor: string } & TimelineEventBody;

export type TimelineItem = ({ kind: 'comment' } & IssuePost) | TimelineEvent;

export interface SubIssue {
  id: string;
  number: number;
  title: string;
  state: 'open' | 'closed';
  stateReason: string | null;
  url: string;
  assignees: GithubUser[];
}

export interface LinkedPr {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  url: string;
}

/** Everything the detail tab shows for one issue. `issue` is the same REST-shaped record the lists use. */
export interface IssueDetail {
  id: string;
  issue: GithubIssue;
  post: IssuePost;
  issueType: { id: string; name: string } | null;
  milestone: { number: number; title: string; percent: number } | null;
  parent: { number: number; title: string; url: string } | null;
  subIssues: SubIssue[];
  linkedPrs: LinkedPr[];
  participants: GithubUser[];
  timeline: TimelineItem[];
  hasMoreTimeline: boolean;
  timelineCursor: string | null;
}

export interface TimelinePage {
  items: TimelineItem[];
  hasMore: boolean;
  cursor: string | null;
}
```

- [ ] **Step 4: Implement `detailQueries.ts`**

Create `src/github/detailQueries.ts`:

```ts
'use strict';

import { GqlIssue, GqlUser, GHOST, mapIssue, toUser } from './githubQueries';
import {
  IssueDetail, IssuePost, LinkedPr, ReactionGroup, SubIssue, TimelineEventBody, TimelineItem, TimelinePage,
} from './types';

const REACTIONS = 'reactionGroups { content viewerHasReacted reactors { totalCount } }';

/** Fields of one comment; shared by the timeline and the add/edit comment mutations so one mapper covers all three. */
export const COMMENT_FIELDS = `
  id url body bodyHTML createdAt lastEditedAt authorAssociation isMinimized minimizedReason
  viewerCanUpdate viewerCanDelete
  author { login avatarUrl }
  ${REACTIONS}`;

const ISSUE_OR_PR = '__typename ... on Issue { number title url repository { nameWithOwner } } ... on PullRequest { number title url repository { nameWithOwner } }';

const TIMELINE_FIELDS = `
  pageInfo { hasNextPage endCursor }
  nodes {
    __typename
    ... on IssueComment { ${COMMENT_FIELDS} }
    ... on LabeledEvent { createdAt actor { login } label { name color } }
    ... on UnlabeledEvent { createdAt actor { login } label { name color } }
    ... on ClosedEvent {
      createdAt actor { login } stateReason
      closer { __typename ... on Commit { abbreviatedOid url } ... on PullRequest { number url } }
    }
    ... on ReopenedEvent { createdAt actor { login } }
    ... on RenamedTitleEvent { createdAt actor { login } previousTitle currentTitle }
    ... on AssignedEvent { createdAt actor { login } assignee { ... on User { login } ... on Bot { login } } }
    ... on UnassignedEvent { createdAt actor { login } assignee { ... on User { login } ... on Bot { login } } }
    ... on MilestonedEvent { createdAt actor { login } milestoneTitle }
    ... on DemilestonedEvent { createdAt actor { login } milestoneTitle }
    ... on CrossReferencedEvent { createdAt actor { login } source { ${ISSUE_OR_PR} } }
    ... on ConnectedEvent { createdAt actor { login } subject { ${ISSUE_OR_PR} } }
    ... on ReferencedEvent { createdAt actor { login } commit { abbreviatedOid url } }
    ... on SubIssueAddedEvent { createdAt actor { login } subIssue { number title url repository { nameWithOwner } } }
    ... on SubIssueRemovedEvent { createdAt actor { login } subIssue { number title url repository { nameWithOwner } } }
  }`;

/** One issue with everything the detail tab shows, plus the first 100 timeline items. */
export const ISSUE_DETAIL = `
query IssueDetail($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      id number title body bodyHTML state stateReason url createdAt updatedAt closedAt lastEditedAt authorAssociation
      viewerCanUpdate
      author { login avatarUrl }
      labels(first: 100) { nodes { name color } }
      assignees(first: 20) { nodes { login avatarUrl } }
      comments { totalCount }
      milestone { number title progressPercentage }
      issueType { id name }
      subIssuesSummary { total completed }
      subIssues(first: 50) {
        nodes { id number title state stateReason url assignees(first: 3) { nodes { login avatarUrl } } }
      }
      parent { number title url }
      closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
        totalCount
        nodes { number title state url isDraft }
      }
      participants(first: 10) { nodes { login avatarUrl } }
      ${REACTIONS}
      timelineItems(first: 100) { ${TIMELINE_FIELDS} }
    }
  }
}`;

/** The next page of one issue's timeline. */
export const ISSUE_TIMELINE = `
query IssueTimeline($owner: String!, $name: String!, $number: Int!, $after: String!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) { timelineItems(first: 100, after: $after) { ${TIMELINE_FIELDS} } }
  }
}`;

export const ADD_COMMENT = `
mutation AddComment($id: ID!, $body: String!) {
  addComment(input: { subjectId: $id, body: $body }) { commentEdge { node { ${COMMENT_FIELDS} } } }
}`;

export const UPDATE_COMMENT = `
mutation UpdateComment($id: ID!, $body: String!) {
  updateIssueComment(input: { id: $id, body: $body }) { issueComment { ${COMMENT_FIELDS} } }
}`;

export const DELETE_COMMENT = `
mutation DeleteComment($id: ID!) { deleteIssueComment(input: { id: $id }) { clientMutationId } }`;

export const ADD_REACTION = `
mutation AddReaction($id: ID!, $content: ReactionContent!) {
  addReaction(input: { subjectId: $id, content: $content }) { subject { ${REACTIONS} } }
}`;

export const REMOVE_REACTION = `
mutation RemoveReaction($id: ID!, $content: ReactionContent!) {
  removeReaction(input: { subjectId: $id, content: $content }) { subject { ${REACTIONS} } }
}`;

/** `typeId: null` clears the issue's type. */
export const SET_ISSUE_TYPE = `
mutation SetIssueType($id: ID!, $typeId: ID) {
  updateIssueIssueType(input: { issueId: $id, issueTypeId: $typeId }) { clientMutationId }
}`;

export const ADD_SUB_ISSUE = `
mutation AddSubIssue($id: ID!, $url: String!) {
  addSubIssue(input: { issueId: $id, subIssueUrl: $url }) { clientMutationId }
}`;

export const REMOVE_SUB_ISSUE = `
mutation RemoveSubIssue($id: ID!, $subId: ID!) {
  removeSubIssue(input: { issueId: $id, subIssueId: $subId }) { clientMutationId }
}`;

export interface GqlReactionGroup { content: ReactionGroup['content']; viewerHasReacted: boolean; reactors: { totalCount: number } }
export interface GqlComment {
  id: string; url: string; body: string; bodyHTML: string; createdAt: string; lastEditedAt: string | null;
  authorAssociation: string | null; isMinimized: boolean; minimizedReason: string | null;
  viewerCanUpdate: boolean; viewerCanDelete: boolean; author: GqlUser | null; reactionGroups: GqlReactionGroup[];
}
interface GqlRef { number?: number; title?: string; url: string; repository?: { nameWithOwner: string } }
interface GqlTimelineNode extends Partial<GqlComment> {
  __typename: string;
  actor?: { login: string } | null;
  label?: { name: string; color: string };
  stateReason?: string | null;
  closer?: { abbreviatedOid?: string; number?: number; url: string } | null;
  previousTitle?: string;
  currentTitle?: string;
  assignee?: { login?: string } | null;
  milestoneTitle?: string;
  source?: GqlRef | null;
  subject?: GqlRef | null;
  commit?: { abbreviatedOid: string; url: string } | null;
  subIssue?: GqlRef | null;
}
interface GqlTimeline { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlTimelineNode[] }
interface GqlSubIssue {
  id: string; number: number; title: string; state: 'OPEN' | 'CLOSED'; stateReason: string | null; url: string;
  assignees: { nodes: GqlUser[] };
}
interface GqlDetailIssue extends GqlIssue {
  id: string; bodyHTML: string; lastEditedAt: string | null; authorAssociation: string | null; viewerCanUpdate: boolean;
  milestone: { number: number; title: string; progressPercentage: number } | null;
  issueType: { id: string; name: string } | null;
  subIssues: { nodes: GqlSubIssue[] };
  parent: { number: number; title: string; url: string } | null;
  closedByPullRequestsReferences: {
    totalCount: number;
    nodes: Array<{ number: number; title: string; state: 'OPEN' | 'CLOSED' | 'MERGED'; url: string; isDraft: boolean }>;
  } | null;
  participants: { nodes: GqlUser[] };
  reactionGroups: GqlReactionGroup[];
  timelineItems: GqlTimeline;
}
export interface IssueDetailData { repository: { issue: GqlDetailIssue | null } }
export interface IssueTimelineData { repository: { issue: { timelineItems: GqlTimeline } | null } }

export function mapReactions(groups: GqlReactionGroup[]): ReactionGroup[] {
  return groups.map(g => ({ content: g.content, count: g.reactors.totalCount, viewerHasReacted: g.viewerHasReacted }));
}

/** A comment from the timeline or from the add/edit comment mutations. */
export function mapComment(n: GqlComment): IssuePost {
  return {
    id: n.id, url: n.url, author: n.author ? toUser(n.author) : GHOST, authorAssociation: n.authorAssociation,
    createdAt: n.createdAt, lastEditedAt: n.lastEditedAt, bodyHTML: n.bodyHTML, body: n.body,
    reactions: mapReactions(n.reactionGroups), viewerCanUpdate: n.viewerCanUpdate, viewerCanDelete: n.viewerCanDelete,
    minimizedReason: n.isMinimized ? (n.minimizedReason ?? 'hidden').toLowerCase() : null,
  };
}

/** `#12` inside this repo, `owner/other#12` elsewhere. */
function refText(ref: GqlRef, repo: string): string {
  const name = ref.repository?.nameWithOwner;
  return `${name && name.toLowerCase() !== repo.toLowerCase() ? name : ''}#${ref.number}`;
}

function mapNode(n: GqlTimelineNode, repo: string): TimelineItem | null {
  const at = n.createdAt ?? '';
  const actor = n.actor?.login ?? 'ghost';
  const event = (body: TimelineEventBody): TimelineItem => ({ kind: 'event', at, actor, ...body });
  const ref = (r: GqlRef | null | undefined, type: 'cross-referenced' | 'connected' | 'sub-issue-added' | 'sub-issue-removed') =>
    r && typeof r.number === 'number' ? event({ type, text: `${r.title ?? ''} ${refText(r, repo)}`.trim(), url: r.url }) : null;
  switch (n.__typename) {
    case 'IssueComment': return { kind: 'comment', ...mapComment(n as GqlComment) };
    case 'LabeledEvent': return n.label ? event({ type: 'labels', added: [n.label], removed: [] }) : null;
    case 'UnlabeledEvent': return n.label ? event({ type: 'labels', added: [], removed: [n.label] }) : null;
    case 'ClosedEvent': {
      const reason = n.stateReason ? n.stateReason.toLowerCase() as 'completed' | 'not_planned' | 'duplicate' : null;
      const closer = n.closer ? { text: n.closer.abbreviatedOid ?? `#${n.closer.number}`, url: n.closer.url } : null;
      return event({ type: 'closed', reason, closer });
    }
    case 'ReopenedEvent': return event({ type: 'reopened' });
    case 'RenamedTitleEvent': return event({ type: 'renamed', from: n.previousTitle ?? '', to: n.currentTitle ?? '' });
    case 'AssignedEvent':
    case 'UnassignedEvent':
      return n.assignee?.login
        ? event({ type: n.__typename === 'AssignedEvent' ? 'assigned' : 'unassigned', login: n.assignee.login }) : null;
    case 'MilestonedEvent': return event({ type: 'milestoned', title: n.milestoneTitle ?? '' });
    case 'DemilestonedEvent': return event({ type: 'demilestoned', title: n.milestoneTitle ?? '' });
    case 'CrossReferencedEvent': return ref(n.source, 'cross-referenced');
    case 'ConnectedEvent': return ref(n.subject, 'connected');
    case 'ReferencedEvent':
      return n.commit ? event({ type: 'referenced', text: n.commit.abbreviatedOid, url: n.commit.url }) : null;
    case 'SubIssueAddedEvent': return ref(n.subIssue, 'sub-issue-added');
    case 'SubIssueRemovedEvent': return ref(n.subIssue, 'sub-issue-removed');
    default: return null; // an event type the tab doesn't show
  }
}

/** Merges consecutive label events by the same person within a minute into one "added a and b" line. */
export function collapseTimeline(items: TimelineItem[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    if (item.kind === 'event' && item.type === 'labels' && prev?.kind === 'event' && prev.type === 'labels'
        && prev.actor === item.actor && Date.parse(item.at) - Date.parse(prev.at) <= 60_000) {
      out[out.length - 1] = { ...prev, at: item.at, added: [...prev.added, ...item.added], removed: [...prev.removed, ...item.removed] };
    } else {
      out.push(item);
    }
  }
  return out;
}

export function mapTimelinePage(timeline: GqlTimeline, repo: string): TimelinePage {
  const items = timeline.nodes.map(n => mapNode(n, repo)).filter((i): i is TimelineItem => i !== null);
  return { items: collapseTimeline(items), hasMore: timeline.pageInfo.hasNextPage, cursor: timeline.pageInfo.endCursor };
}

const mapSubIssue = (s: GqlSubIssue): SubIssue => ({
  id: s.id, number: s.number, title: s.title, state: s.state === 'OPEN' ? 'open' : 'closed',
  stateReason: s.stateReason ? s.stateReason.toLowerCase() : null, url: s.url, assignees: s.assignees.nodes.map(toUser),
});

const mapLinkedPr = (p: { number: number; title: string; state: string; url: string; isDraft: boolean }): LinkedPr => ({
  number: p.number, title: p.title, state: p.state.toLowerCase() as LinkedPr['state'], isDraft: p.isDraft, url: p.url,
});

/** `repo` is `owner/name`; it decides whether a referenced issue is shown as `#12` or `owner/other#12`. */
export function mapIssueDetail(data: IssueDetailData, repo: string): IssueDetail {
  const n = data.repository.issue;
  if (!n) throw new Error('Issue not found.');
  const timeline = mapTimelinePage(n.timelineItems, repo);
  return {
    id: n.id,
    issue: mapIssue(n),
    post: {
      id: n.id, url: n.url, author: n.author ? toUser(n.author) : GHOST, authorAssociation: n.authorAssociation,
      createdAt: n.createdAt, lastEditedAt: n.lastEditedAt, bodyHTML: n.bodyHTML, body: n.body ?? '',
      reactions: mapReactions(n.reactionGroups), viewerCanUpdate: n.viewerCanUpdate, viewerCanDelete: false,
      minimizedReason: null,
    },
    issueType: n.issueType,
    milestone: n.milestone
      ? { number: n.milestone.number, title: n.milestone.title, percent: Math.round(n.milestone.progressPercentage) } : null,
    parent: n.parent,
    subIssues: n.subIssues.nodes.map(mapSubIssue),
    linkedPrs: (n.closedByPullRequestsReferences?.nodes ?? []).map(mapLinkedPr),
    participants: n.participants.nodes.map(toUser),
    timeline: timeline.items,
    hasMoreTimeline: timeline.hasMore,
    timelineCursor: timeline.cursor,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsc -p tsconfig.json && node --test out/github/detailQueries.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 6: Validate the documents against GitHub**

The mappers are only as good as the queries. With `gh` signed in:

```bash
CURSOR=$(gh api graphql -F owner=TorresVisual -F name=null-ide -F number=106 -f query="$(node -p "require('./out/github/detailQueries.js').ISSUE_DETAIL")" --jq '.data.repository.issue.timelineItems.pageInfo.endCursor')
gh api graphql -F owner=TorresVisual -F name=null-ide -F number=106 -f after="$CURSOR" -f query="$(node -p "require('./out/github/detailQueries.js').ISSUE_TIMELINE")" --jq '.data.repository.issue.timelineItems.nodes | length'
```

Expected: the first command prints nothing but the cursor is captured (no `errors`); the second prints `0`.

Then confirm every mutation document is valid (dummy ids must fail at *resolving the node*, not at schema validation):

```bash
v() { gh api graphql -f query="$(node -p "require('./out/github/detailQueries.js').$1")" "${@:2}" 2>&1 | grep -o "Could not resolve to a node[^\"]*\|doesn.t exist[^\"]*\|Variable[^\"]*\|not defined[^\"]*" | head -1; }
for spec in "ADD_COMMENT -f id=I_x -f body=b" "UPDATE_COMMENT -f id=IC_x -f body=b" "DELETE_COMMENT -f id=IC_x" "ADD_REACTION -f id=I_x -f content=EYES" "REMOVE_REACTION -f id=I_x -f content=EYES" "SET_ISSUE_TYPE -f id=I_x" "ADD_SUB_ISSUE -f id=I_x -f url=https://github.com/o/r/issues/1" "REMOVE_SUB_ISSUE -f id=I_x -f subId=I_y"; do printf "%s -> " "${spec%% *}"; v $spec; done
```

Expected: all eight lines end with `Could not resolve to a node with the global id of 'I_x'` (or `'IC_x'`). Any `doesn't exist` / `Variable` line means that document has a schema error: fix it before continuing.

- [ ] **Step 7: Compile and commit**

```bash
npm run compile
git add src/github/detailQueries.ts src/github/detailQueries.test.ts src/github/githubQueries.ts src/github/types.ts tsconfig.json package.json out/github
git status --short
git commit -m "feat(null-tools): add GraphQL issue-detail queries and mappers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

`git status --short` must list only this task's files before you commit (leave any unrelated modified `out/` file unstaged).

---

### Task 2: Store methods and the REST patch type

**Files:**
- Modify: `src/github/githubApi.ts` (`updateIssue` patch type), `src/github/issuesStore.ts`

**Interfaces:**
- Consumes: Task 1's documents and mappers; `requestGraphql`.
- Produces (on `IssuesStore`):
  - `getDetail(issueNumber: number): Promise<IssueDetail>` (also refreshes the by-number cache)
  - `getTimelinePage(issueNumber: number, after: string): Promise<TimelinePage>`
  - `toggleReaction(subjectId: string, content: ReactionContent, add: boolean): Promise<ReactionGroup[]>`
  - `setIssueType(issueId: string, typeId: string | null): Promise<void>`
  - `addSubIssue(parentId: string, subIssueNumber: number): Promise<void>`, `removeSubIssue(parentId: string, subIssueId: string): Promise<void>`
  - `postComment(issueNumber: number, issueId: string, body: string): Promise<IssuePost>`, `editComment(commentId: string, body: string): Promise<IssuePost>`, `removeComment(issueNumber: number, commentId: string): Promise<void>`
  - `updateIssue(number, patch: IssuePatch)` now accepts `state_reason` and `milestone`.
  - `githubApi.ts` exports `interface IssuePatch`.

The store imports `vscode` (through `githubAuth`), so it has no unit test; the compiler and Task 7 are its checks. Every method goes through `ensureSession` (the #106 rule).

- [ ] **Step 1: Widen the REST patch type**

In `src/github/githubApi.ts`, replace

```ts
export function updateIssue(
  owner: string, repo: string, issueNumber: number,
  patch: { title?: string; body?: string; state?: 'open' | 'closed'; labels?: string[]; assignees?: string[] },
  token: string | null,
): Promise<GithubIssue> {
```

with

```ts
/** Fields of REST `PATCH /issues/:n` the extension sets. `milestone: null` clears it; `labels`/`assignees` replace the set. */
export interface IssuePatch {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  state_reason?: 'completed' | 'not_planned' | 'reopened';
  labels?: string[];
  assignees?: string[];
  milestone?: number | null;
}

export function updateIssue(
  owner: string, repo: string, issueNumber: number, patch: IssuePatch,
  token: string | null,
): Promise<GithubIssue> {
```

- [ ] **Step 2: Extend the store**

In `src/github/issuesStore.ts`:

1. Replace the `./githubApi` import block with:

```ts
import {
  IssuePatch, createComment, createIssue, deleteComment, fetchAssignableUsers, fetchComments, fetchIssue, fetchRepoLabels,
  fetchTimeline, requestGraphql, updateComment, updateIssue,
} from './githubApi';
import {
  ADD_COMMENT, ADD_REACTION, ADD_SUB_ISSUE, DELETE_COMMENT, GqlComment, GqlReactionGroup, ISSUE_DETAIL, ISSUE_TIMELINE,
  IssueDetailData, IssueTimelineData, REMOVE_REACTION, REMOVE_SUB_ISSUE, SET_ISSUE_TYPE, UPDATE_COMMENT, mapComment,
  mapIssueDetail, mapReactions, mapTimelinePage,
} from './detailQueries';
```

2. In the `./types` import add `IssueDetail, IssuePost, ReactionContent, ReactionGroup, TimelinePage` (keep the existing names; `GithubComment` and `GithubTimelineEvent` go away in Task 4).
3. Delete the line `type IssuePatch = { title?: string; body?: string; state?: 'open' | 'closed'; labels?: string[]; assignees?: string[] };` (it now comes from `githubApi`).
4. Insert this block directly above `getByNumber(number: number)`:

```ts
  /** One issue with its first timeline page. Also refreshes the by-number cache the row actions read. */
  async getDetail(issueNumber: number): Promise<IssueDetail> {
    const { repo, token } = await this.ensureSession(false);
    const data = await requestGraphql<IssueDetailData>(
      ISSUE_DETAIL, { owner: repo.owner, name: repo.repo, number: issueNumber }, token);
    const detail = mapIssueDetail(data, `${repo.owner}/${repo.repo}`);
    this.remember([detail.issue]);
    return detail;
  }

  async getTimelinePage(issueNumber: number, after: string): Promise<TimelinePage> {
    const { repo, token } = await this.ensureSession(false);
    const data = await requestGraphql<IssueTimelineData>(
      ISSUE_TIMELINE, { owner: repo.owner, name: repo.repo, number: issueNumber, after }, token);
    if (!data.repository.issue) throw new Error('Issue not found.');
    return mapTimelinePage(data.repository.issue.timelineItems, `${repo.owner}/${repo.repo}`);
  }

  /** A GraphQL write. Prompts for sign-in like every user-initiated write. */
  private async mutate<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const { token } = await this.ensureSession(true);
    return requestGraphql<T>(query, variables, token);
  }

  async toggleReaction(subjectId: string, content: ReactionContent, add: boolean): Promise<ReactionGroup[]> {
    type Payload = { subject: { reactionGroups: GqlReactionGroup[] } };
    const data = await this.mutate<{ addReaction?: Payload; removeReaction?: Payload }>(
      add ? ADD_REACTION : REMOVE_REACTION, { id: subjectId, content });
    return mapReactions((data.addReaction ?? data.removeReaction)!.subject.reactionGroups);
  }

  async setIssueType(issueId: string, typeId: string | null): Promise<void> {
    await this.mutate(SET_ISSUE_TYPE, { id: issueId, typeId });
  }

  async addSubIssue(parentId: string, subIssueNumber: number): Promise<void> {
    const { repo, token } = await this.ensureSession(true);
    const url = `https://github.com/${repo.owner}/${repo.repo}/issues/${subIssueNumber}`;
    await requestGraphql(ADD_SUB_ISSUE, { id: parentId, url }, token);
  }

  async removeSubIssue(parentId: string, subIssueId: string): Promise<void> {
    await this.mutate(REMOVE_SUB_ISSUE, { id: parentId, subId: subIssueId });
  }

  /** Posts a comment and returns it already rendered, so the tab can append it without refetching. */
  async postComment(issueNumber: number, issueId: string, body: string): Promise<IssuePost> {
    const data = await this.mutate<{ addComment: { commentEdge: { node: GqlComment } } }>(
      ADD_COMMENT, { id: issueId, body });
    const issue = this.known.get(issueNumber);
    if (issue) this.known.set(issueNumber, { ...issue, comments: issue.comments + 1 });
    return mapComment(data.addComment.commentEdge.node);
  }

  async editComment(commentId: string, body: string): Promise<IssuePost> {
    const data = await this.mutate<{ updateIssueComment: { issueComment: GqlComment } }>(
      UPDATE_COMMENT, { id: commentId, body });
    return mapComment(data.updateIssueComment.issueComment);
  }

  async removeComment(issueNumber: number, commentId: string): Promise<void> {
    await this.mutate(DELETE_COMMENT, { id: commentId });
    const issue = this.known.get(issueNumber);
    if (issue) this.known.set(issueNumber, { ...issue, comments: Math.max(0, issue.comments - 1) });
  }
```

- [ ] **Step 3: Compile and test**

Run: `npx tsc -p tsconfig.json && npm test`
Expected: no TypeScript errors; all tests pass (163: the 152 existing plus Task 1's 11).

- [ ] **Step 4: Commit**

```bash
npm run compile
git add src/github/githubApi.ts src/github/issuesStore.ts out/github
git status --short
git commit -m "feat(null-tools): add issue-detail reads and GraphQL writes to the store

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared webview pieces (octicons, picker `onClose`, HTML builders)

**Files:**
- Modify: `scripts/gen-octicons.js`, `src/webview/shared/octicons.ts` (regenerated), `src/webview/shared/picker.ts`, `tsconfig.webview-shared.json`, `tsconfig.json`, `package.json`
- Create: `src/webview/detailTypes.ts`, `src/webview/detailHtml.ts`, `src/webview/detailSidebarHtml.ts`, `src/webviewDetail.test.ts`

**Interfaces:**
- Consumes: `escapeHtml`, `octicon`, `labelStyleVars`, `timeHtml`, `issueStateIcon`, `PickerItem` (all existing shared webview globals).
- Produces (webview globals): `avatarHtml(user, large?)`, `roleBadgeHtml(association)`, `neutralizeImagesHtml(html)`, `issueNumberFromLink(href, repo)`, `reactionsHtml(post)`, `reactionPickerItems(post): PickerItem[]`, `postHtml(post, kind: 'body' | 'comment', editing)`, `eventLabelChips(labels)`, `eventHtml(ev)`, `sidebarHtml(d, meta, viewer)`, `subIssuesHtml(d)`; webview-side mirrors of the host records (`IssuePost`, `TimelineItem`, `IssueDetail`, `DetailMetadata`, …); `PickerOptions.onClose?(): void`; 15 more octicons (`git-merge`, `git-pull-request-closed`, `git-pull-request-draft`, `gear`, `smiley`, `pencil`, `trash`, `quote`, `link`, `tag`, `person`, `git-commit`, `issue-reopened`, `cross-reference`, `image`).

- [ ] **Step 1: Write the failing test**

Create `src/webviewDetail.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// The detail tab's HTML builders are plain top-level functions in a `module: none` bundle, so load the compiled
// bundle into a sandbox (built by `tsc -p tsconfig.webview-shared.json`) and call them like webviewShared.test.ts does.
const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);

type Post = Record<string, unknown>;
const html = sandbox as unknown as {
  neutralizeImagesHtml(h: string): string;
  issueNumberFromLink(href: string, repo: string): number | null;
  eventHtml(ev: Record<string, unknown>): string;
  postHtml(post: Post, kind: 'body' | 'comment', editing: boolean): string;
  reactionPickerItems(post: Post): Array<{ value: string; selected?: boolean }>;
  sidebarHtml(d: Record<string, unknown>, meta: Record<string, unknown> | null, viewer: string | null): string;
  subIssuesHtml(d: Record<string, unknown>): string;
};

const user = { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' };
const post = (over: Post = {}): Post => ({
  id: 'IC_1', url: 'https://github.com/o/r/issues/7#issuecomment-1', author: user, authorAssociation: 'OWNER',
  createdAt: '2026-10-01T10:00:00Z', lastEditedAt: null, bodyHTML: '<p>Hello</p>', body: 'Hello', reactions: [],
  viewerCanUpdate: true, viewerCanDelete: true, minimizedReason: null, ...over,
});

test('neutralizeImagesHtml turns images into placeholders and emoji into their text', () => {
  const out = html.neutralizeImagesHtml(
    '<p><img src="https://github.com/user-attachments/assets/1" alt="shot" width="10"> '
    + '<img class="emoji" title=":+1:" alt="👍" src="https://github.githubassets.com/e.png" height="20"></p>');
  assert.ok(!/<img/i.test(out));
  assert.match(out, /<span class="img-placeholder" data-src="https:\/\/github.com\/user-attachments\/assets\/1"[^>]*>.*shot<\/span>/);
  assert.ok(out.includes('👍'));
});

test('neutralizeImagesHtml reads src, not data-canonical-src, and labels an image without alt text', () => {
  const out = html.neutralizeImagesHtml('<img data-canonical-src="https://x/orig.png" src="https://camo.githubusercontent.com/abc">');
  assert.ok(out.includes('data-src="https://camo.githubusercontent.com/abc"'));
  assert.match(out, /> image<\/span>$/);
});

test('neutralizeImagesHtml does not let a raw < in alt text become markup', () => {
  const out = html.neutralizeImagesHtml('<img src="https://x/y.png" alt="<script>alert(1)</script>">');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('issueNumberFromLink recognises only issue links of this repo', () => {
  assert.strictEqual(html.issueNumberFromLink('https://github.com/O/R/issues/12', 'o/r'), 12);
  assert.strictEqual(html.issueNumberFromLink('https://github.com/o/r/issues/12#issuecomment-5', 'o/r'), 12);
  assert.strictEqual(html.issueNumberFromLink('https://github.com/o/other/issues/12', 'o/r'), null);
  assert.strictEqual(html.issueNumberFromLink('https://github.com/o/r/pull/12', 'o/r'), null);
  assert.strictEqual(html.issueNumberFromLink('http://github.com/o/r/issues/12', 'o/r'), null);
  assert.strictEqual(html.issueNumberFromLink('https://github.com.evil.example/o/r/issues/12', 'o/r'), null);
  assert.strictEqual(html.issueNumberFromLink('https://github.com/o/r/issues/12evil', 'o/r'), null);
});

test('eventHtml escapes titles and logins instead of trusting them', () => {
  const out = html.eventHtml({
    kind: 'event', at: '2026-10-01T10:00:00Z', actor: '<b>x</b>', type: 'renamed', from: '<img src=x onerror=alert(1)>', to: 'ok',
  });
  assert.ok(!out.includes('<img src=x'));
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(out.includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('eventHtml words closing, labels and self-assignment like github.com', () => {
  const closed = html.eventHtml({
    kind: 'event', at: '2026-10-01T10:00:00Z', actor: 'octocat', type: 'closed', reason: 'not_planned',
    closer: { text: '#12', url: 'https://github.com/o/r/pull/12' },
  });
  assert.match(closed, /closed this as not planned in <a href="https:\/\/github.com\/o\/r\/pull\/12">#12<\/a>/);
  assert.ok(closed.includes('state-not-planned'));
  const labels = html.eventHtml({
    kind: 'event', at: '2026-10-01T10:00:00Z', actor: 'octocat', type: 'labels',
    added: [{ name: 'bug', color: 'd73a4a' }, { name: 'ui', color: '0075ca' }], removed: [{ name: 'wip', color: 'ffffff' }],
  });
  assert.match(labels, /added .*bug.*ui.* labels and removed .*wip.* label /);
  const self = html.eventHtml({ kind: 'event', at: '2026-10-01T10:00:00Z', actor: 'octocat', type: 'assigned', login: 'octocat' });
  assert.ok(self.includes('self-assigned this'));
  const plain = html.eventHtml({ kind: 'event', at: '2026-10-01T10:00:00Z', actor: 'octocat', type: 'closed', reason: null, closer: null });
  assert.ok(plain.includes('closed this <'));
});

test('postHtml shows role badge, edited marker and escapes the author', () => {
  const out = html.postHtml(post({ author: { login: '<i>', avatar_url: '' }, lastEditedAt: '2026-10-01T11:00:00Z' }), 'comment', false);
  assert.ok(out.includes('role-badge">Owner<'));
  assert.ok(out.includes('· edited'));
  assert.ok(out.includes('&lt;i&gt;'));
  assert.ok(out.includes('commented'));
  assert.ok(html.postHtml(post({ authorAssociation: 'NONE' }), 'comment', false).indexOf('role-badge') === -1);
  assert.ok(html.postHtml(post(), 'body', false).includes('opened this'));
});

test('postHtml folds minimized comments and shows only reactions someone used', () => {
  const folded = html.postHtml(post({ minimizedReason: 'off_topic' }), 'comment', false);
  assert.match(folded, /^\s*<details class="post-minimized"><summary>This comment was marked as off topic\. Show<\/summary>/);
  const reacted = html.postHtml(post({
    reactions: [
      { content: 'THUMBS_UP', count: 2, viewerHasReacted: true },
      { content: 'EYES', count: 0, viewerHasReacted: false },
    ],
  }), 'comment', false);
  assert.ok(reacted.includes('reaction-chip active'));
  assert.ok(reacted.includes('👍 2'));
  assert.ok(!reacted.includes('👀'));
});

test('postHtml in edit mode shows the escaped markdown source instead of the rendered body', () => {
  const out = html.postHtml(post({ body: 'a </textarea><script>x</script>' }), 'comment', true);
  assert.ok(out.includes('a &lt;/textarea&gt;&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(!out.includes('post-body'));
  assert.ok(out.includes('data-act="save-edit"'));
});

test('reactionPickerItems offers GitHub\'s eight and checks the viewer\'s own', () => {
  const items = html.reactionPickerItems(post({ reactions: [{ content: 'HEART', count: 1, viewerHasReacted: true }] }));
  assert.strictEqual(items.length, 8);
  // Arrays from the vm realm have a different Array.prototype; copy before deep-comparing.
  assert.deepStrictEqual(Array.from(items.filter(i => i.selected).map(i => i.value)), ['HEART']);
});

const detail = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'I_7',
  issue: { number: 7, title: 'T', body: '', state: 'open', html_url: 'u', labels: [], assignees: [], user, comments: 0, updated_at: '' },
  post: post(), issueType: null, milestone: null, parent: null, subIssues: [], linkedPrs: [], participants: [user],
  timeline: [], hasMoreTimeline: false, timelineCursor: null, ...over,
});

test('sidebarHtml leaves out Type on repos without issue types, and shows it once the issue has one', () => {
  assert.ok(!html.sidebarHtml(detail(), { types: [] }, 'octocat').includes('data-sec="type"'));
  assert.ok(!html.sidebarHtml(detail(), null, 'octocat').includes('data-sec="type"'));
  assert.ok(html.sidebarHtml(detail(), { types: [{ id: 'T', name: 'Bug' }] }, 'octocat').includes('data-sec="type"'));
  assert.ok(html.sidebarHtml(detail({ issueType: { id: 'T', name: 'Bug' } }), null, 'octocat').includes('data-sec="type"'));
});

test('sidebarHtml shows edit gears and "assign yourself" only to someone who can edit', () => {
  const editable = html.sidebarHtml(detail(), null, 'octocat');
  assert.ok(editable.includes('data-act="pick-assignees"'));
  assert.ok(editable.includes('data-act="assign-me"'));
  const readOnly = html.sidebarHtml(detail({ post: post({ viewerCanUpdate: false }) }), null, 'octocat');
  assert.ok(!readOnly.includes('data-act="pick-'));
  assert.ok(!readOnly.includes('data-act="assign-me"'));
  assert.ok(!html.sidebarHtml(detail(), null, null).includes('data-act="assign-me"'));
});

test('sidebarHtml lists linked pull requests with their state and the empty states otherwise', () => {
  const out = html.sidebarHtml(detail({
    linkedPrs: [{ number: 9, title: 'Fix <it>', state: 'merged', isDraft: false, url: 'https://github.com/o/r/pull/9' }],
  }), null, 'octocat');
  assert.ok(out.includes('pr-merged'));
  assert.ok(out.includes('Fix &lt;it&gt;'));
  assert.ok(out.includes('No one'));
  assert.ok(out.includes('No milestone'));
  assert.ok(out.includes('None yet'));
});

test('subIssuesHtml is empty without children; otherwise counts closed ones and offers remove only when editable', () => {
  assert.strictEqual(html.subIssuesHtml(detail()), '');
  const subs = [
    { id: 'I_8', number: 8, title: 'Done', state: 'closed', stateReason: 'completed', url: 'u', assignees: [] },
    { id: 'I_9', number: 9, title: 'Todo', state: 'open', stateReason: null, url: 'u', assignees: [user] },
  ];
  const out = html.subIssuesHtml(detail({ subIssues: subs }));
  assert.ok(out.includes('1 of 2'));
  assert.ok(out.includes('width:50%'));
  assert.ok(out.includes('data-act="sub-menu"'));
  const readOnly = html.subIssuesHtml(detail({ subIssues: subs, post: post({ viewerCanUpdate: false }) }));
  assert.ok(!readOnly.includes('data-act="sub-menu"'));
  assert.ok(!readOnly.includes('data-act="add-sub"'));
});
```

In `tsconfig.json`, add `"src/webviewDetail.test.ts"` to `include` right after `"src/webviewShared.test.ts"`. In `package.json`, add ` out/webviewDetail.test.js` right after `out/webviewShared.test.js` in the `test` script.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsc -p tsconfig.json && npx tsc -p tsconfig.webview-shared.json && node --test out/webviewDetail.test.js`
Expected: FAIL, every test with `TypeError: html.neutralizeImagesHtml is not a function` (or the sibling builder names).

- [ ] **Step 3: Add the octicons**

In `scripts/gen-octicons.js`, extend `NAMES` (add one line before the closing `];`):

```js
  'git-merge', 'git-pull-request-closed', 'git-pull-request-draft', 'gear', 'smiley', 'pencil', 'trash', 'quote',
  'link', 'tag', 'person', 'git-commit', 'issue-reopened', 'cross-reference', 'image',
```

Regenerate (the package is only downloaded to a temp dir):

```bash
mkdir -p "$TMP/octicons" && (cd "$TMP/octicons" && npm pack @primer/octicons@19.38.0 --silent && tar xzf primer-octicons-19.38.0.tgz)
node scripts/gen-octicons.js "$TMP/octicons/package"
```

Expected: `wrote 33 octicons from @primer/octicons 19.38.0 …`, and `git diff --stat src/webview/shared/octicons.ts` shows only added lines.

- [ ] **Step 4: Give the picker an `onClose`**

In `src/webview/shared/picker.ts`:

1. In `interface PickerOptions`, after `onSelect(value: string): void;` add:

```ts
  /** Called once when the popover closes for any reason (pick in a single-select picker, Esc, click outside). */
  onClose?(): void;
```

2. At the end of `function close()`, after `activePickerAnchor = null;`, add `opts.onClose?.();`:

```ts
    pop.remove();
    closeActivePicker = null;
    activePickerAnchor = null;
    opts.onClose?.();
  }
```

- [ ] **Step 5: Create the three webview modules**

Create `src/webview/detailTypes.ts`:

```ts
'use strict';

// Webview-side mirrors of the records in src/github/types.ts (this bundle is `module: none`, so it cannot import
// them). The host sends exactly these shapes; keep the two files in sync by hand.

interface GithubLabel { name: string; color: string; description?: string | null; }
interface GithubUser { login: string; avatar_url: string; }
interface IssueTemplate { name: string; title: string; body: string; labels: string[]; }

interface ReactionGroup { content: string; count: number; viewerHasReacted: boolean; }

interface IssuePost {
  id: string; url: string; author: GithubUser; authorAssociation: string | null; createdAt: string;
  lastEditedAt: string | null; bodyHTML: string; body: string; reactions: ReactionGroup[];
  viewerCanUpdate: boolean; viewerCanDelete: boolean; minimizedReason: string | null;
}

type TimelineEventBody =
  | { type: 'labels'; added: GithubLabel[]; removed: GithubLabel[] }
  | { type: 'closed'; reason: 'completed' | 'not_planned' | 'duplicate' | null; closer: { text: string; url: string } | null }
  | { type: 'reopened' }
  | { type: 'renamed'; from: string; to: string }
  | { type: 'assigned' | 'unassigned'; login: string }
  | { type: 'milestoned' | 'demilestoned'; title: string }
  | { type: 'cross-referenced' | 'connected' | 'referenced' | 'sub-issue-added' | 'sub-issue-removed'; text: string; url: string };
type TimelineEvent = { kind: 'event'; at: string; actor: string } & TimelineEventBody;
type TimelineItem = ({ kind: 'comment' } & IssuePost) | TimelineEvent;

interface SubIssue {
  id: string; number: number; title: string; state: 'open' | 'closed'; stateReason: string | null; url: string;
  assignees: GithubUser[];
}
interface LinkedPr { number: number; title: string; state: 'open' | 'closed' | 'merged'; isDraft: boolean; url: string; }

interface DetailIssue {
  number: number; title: string; body: string; state: 'open' | 'closed'; state_reason?: string | null; html_url: string;
  labels: GithubLabel[]; assignees: GithubUser[]; user: GithubUser; comments: number; updated_at: string;
  created_at?: string;
}

interface IssueDetail {
  id: string;
  issue: DetailIssue;
  post: IssuePost;
  issueType: { id: string; name: string } | null;
  milestone: { number: number; title: string; percent: number } | null;
  parent: { number: number; title: string; url: string } | null;
  subIssues: SubIssue[];
  linkedPrs: LinkedPr[];
  participants: GithubUser[];
  timeline: TimelineItem[];
  hasMoreTimeline: boolean;
  timelineCursor: string | null;
}

/** What the sidebar pickers choose from; arrives separately from `detail` because it is cached per repo. */
interface DetailMetadata {
  labels: GithubLabel[];
  assignees: GithubUser[];
  milestones: Array<{ number: number; title: string }>;
  types: Array<{ id: string; name: string }>;
}
```

Create `src/webview/detailHtml.ts`:

```ts
'use strict';

// Pure HTML builders for the issue detail tab. They take data and return strings (no DOM, no state), so
// webviewShared tests can run them in a sandbox. Every user-controlled string goes through escapeHtml;
// `post.bodyHTML` is the exception: GitHub renders it, and the caller sanitizes it before calling postHtml.

const REACTION_EMOJI: Record<string, string> = {
  THUMBS_UP: '👍', THUMBS_DOWN: '👎', LAUGH: '😄', HOORAY: '🎉', CONFUSED: '😕', HEART: '❤️', ROCKET: '🚀', EYES: '👀',
};
const REACTION_NAMES: Record<string, string> = {
  THUMBS_UP: 'Thumbs up', THUMBS_DOWN: 'Thumbs down', LAUGH: 'Laugh', HOORAY: 'Hooray', CONFUSED: 'Confused',
  HEART: 'Heart', ROCKET: 'Rocket', EYES: 'Eyes',
};
const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner', MEMBER: 'Member', COLLABORATOR: 'Collaborator', CONTRIBUTOR: 'Contributor',
};

function avatarHtml(user: GithubUser, large = false): string {
  const initials = escapeHtml(user.login.slice(0, 2).toUpperCase());
  return `<span class="avatar${large ? ' avatar-lg' : ''}" data-initials="${initials}">`
    + `${user.avatar_url ? `<img src="${escapeHtml(user.avatar_url)}" alt="">` : ''}</span>`;
}

/** GitHub's author-association badge. Only the four roles github.com shows; everyone else gets none. */
function roleBadgeHtml(association: string | null): string {
  const label = association ? ROLE_LABELS[association] : undefined;
  return label ? `<span class="role-badge">${label}</span>` : '';
}

/**
 * GitHub's image URLs need a token the webview doesn't have, and its CSP only allows avatars, so an <img> in
 * rendered markdown would be a broken icon. Emoji become their text; any other image becomes a labelled
 * placeholder that opens the image externally. (Phase 5 swaps this for real thumbnails.)
 */
function neutralizeImagesHtml(html: string): string {
  return html.replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, tag => {
    const attr = (name: string): string => new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag)?.[1] ?? '';
    // Attribute values may hold a raw < or > (only quotes are escaped inside them); this text lands in markup.
    const alt = attr('alt').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (/\bclass="[^"]*\bemoji\b/i.test(tag)) return alt;
    return `<span class="img-placeholder" data-src="${attr('src')}" title="Open image on github.com">${octicon('image')} ${alt || 'image'}</span>`;
  });
}

/** The issue number if `href` is an issue of `repo` (`owner/name`); null for anything else, including other repos. */
function issueNumberFromLink(href: string, repo: string): number | null {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[/?#].*)?$/i.exec(href);
  return m && `${m[1]}/${m[2]}`.toLowerCase() === repo.toLowerCase() ? Number(m[3]) : null;
}

/** Reaction chips under a post; nothing when no one has reacted. */
function reactionsHtml(post: IssuePost): string {
  const chips = post.reactions.filter(r => r.count > 0).map(r => `
    <button type="button" class="reaction-chip${r.viewerHasReacted ? ' active' : ''}" data-act="react" data-id="${escapeHtml(post.id)}"
      data-content="${escapeHtml(r.content)}" title="${REACTION_NAMES[r.content] ?? ''}">${REACTION_EMOJI[r.content] ?? ''} ${r.count}</button>`);
  return chips.length > 0 ? `<div class="reactions">${chips.join('')}</div>` : '';
}

/** The eight reactions GitHub offers, as picker items (the viewer's own are checked). */
function reactionPickerItems(post: IssuePost): PickerItem[] {
  return Object.keys(REACTION_EMOJI).map(content => ({
    value: content,
    label: `${REACTION_EMOJI[content]} ${REACTION_NAMES[content]}`,
    selected: post.reactions.some(r => r.content === content && r.viewerHasReacted),
  }));
}

/**
 * One post: the issue body (`kind: 'body'`) or a comment. A moderator-collapsed comment is folded in a
 * <details>. `editing` swaps the rendered body for a plain textarea (the Phase 4 composer replaces it).
 */
function postHtml(post: IssuePost, kind: 'body' | 'comment', editing: boolean): string {
  const id = escapeHtml(post.id);
  const edited = post.lastEditedAt
    ? ` <span class="post-edited" title="${escapeHtml(new Date(post.lastEditedAt).toLocaleString())}">· edited</span>` : '';
  const content = editing
    ? `<div class="edit-form post-edit">
         <textarea class="post-edit-input" data-id="${id}" aria-label="Edit ${kind === 'body' ? 'description' : 'comment'}">${escapeHtml(post.body)}</textarea>
         <div class="btn-row">
           <button type="button" class="btn btn-primary" data-act="save-edit" data-id="${id}">Update ${kind === 'body' ? 'description' : 'comment'}</button>
           <button type="button" class="btn btn-secondary" data-act="cancel-edit">Cancel</button>
         </div>
       </div>`
    : `<div class="post-body">${post.bodyHTML || '<span class="muted">No description provided.</span>'}</div>${reactionsHtml(post)}`;
  const html = `
    <div class="post" data-id="${id}" data-kind="${kind}">
      <div class="post-avatar">${avatarHtml(post.author, true)}</div>
      <div class="post-card">
        <div class="post-header">
          <b class="post-author">${escapeHtml(post.author.login)}</b>${roleBadgeHtml(post.authorAssociation)}
          <span class="post-when">${kind === 'body' ? 'opened this' : 'commented'} ${timeHtml(post.createdAt)}</span>${edited}
          <span class="post-actions">
            <button type="button" class="icon-btn" data-act="react-picker" data-id="${id}" title="Add reaction" aria-label="Add reaction">${octicon('smiley')}</button>
            <button type="button" class="icon-btn" data-act="post-menu" data-id="${id}" title="More actions" aria-label="More actions">${octicon('kebab-horizontal')}</button>
          </span>
        </div>
        ${content}
      </div>
    </div>`;
  return kind === 'comment' && post.minimizedReason
    ? `<details class="post-minimized"><summary>This comment was marked as ${escapeHtml(post.minimizedReason.replace(/_/g, ' '))}. Show</summary>${html}</details>`
    : html;
}

function eventLabelChips(labels: GithubLabel[]): string {
  return labels.map(l => `<span class="gh-label" style="${labelStyleVars(l.color)}">${escapeHtml(l.name)}</span>`).join('');
}

function eventLink(text: string, url: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
}

const CLOSED_REASON_TEXT: Record<string, string> = { completed: ' as completed', not_planned: ' as not planned', duplicate: ' as a duplicate' };

/** The rail icon, its color class and the sentence for one event (without the leading actor and trailing time). */
function eventParts(ev: TimelineEvent): { icon: string; tone: string; text: string } {
  switch (ev.type) {
    case 'labels': {
      const noun = (n: number): string => (n === 1 ? 'label' : 'labels');
      const parts = [];
      if (ev.added.length > 0) parts.push(`added ${eventLabelChips(ev.added)} ${noun(ev.added.length)}`);
      if (ev.removed.length > 0) parts.push(`removed ${eventLabelChips(ev.removed)} ${noun(ev.removed.length)}`);
      return { icon: 'tag', tone: '', text: parts.join(' and ') };
    }
    case 'closed': {
      const unplanned = ev.reason === 'not_planned' || ev.reason === 'duplicate';
      const closer = ev.closer ? ` in ${eventLink(ev.closer.text, ev.closer.url)}` : '';
      return {
        icon: unplanned ? 'skip' : 'issue-closed', tone: unplanned ? 'state-not-planned' : 'state-completed',
        text: `closed this${CLOSED_REASON_TEXT[ev.reason ?? ''] ?? ''}${closer}`,
      };
    }
    case 'reopened': return { icon: 'issue-reopened', tone: 'state-open', text: 'reopened this' };
    case 'renamed':
      return { icon: 'pencil', tone: '', text: `changed the title <s>${escapeHtml(ev.from)}</s> ${escapeHtml(ev.to)}` };
    case 'assigned':
      return { icon: 'person', tone: '', text: ev.login === ev.actor ? 'self-assigned this' : `assigned <b>${escapeHtml(ev.login)}</b>` };
    case 'unassigned':
      return { icon: 'person', tone: '', text: ev.login === ev.actor ? 'removed their assignment' : `unassigned <b>${escapeHtml(ev.login)}</b>` };
    case 'milestoned': return { icon: 'milestone', tone: '', text: `added this to the <b>${escapeHtml(ev.title)}</b> milestone` };
    case 'demilestoned': return { icon: 'milestone', tone: '', text: `removed this from the <b>${escapeHtml(ev.title)}</b> milestone` };
    case 'cross-referenced': return { icon: 'cross-reference', tone: '', text: `mentioned this in ${eventLink(ev.text, ev.url)}` };
    case 'connected': return { icon: 'link', tone: '', text: `linked ${eventLink(ev.text, ev.url)}` };
    case 'referenced': return { icon: 'git-commit', tone: '', text: `referenced this in commit ${eventLink(ev.text, ev.url)}` };
    case 'sub-issue-added': return { icon: 'issue-tracks', tone: '', text: `added sub-issue ${eventLink(ev.text, ev.url)}` };
    case 'sub-issue-removed': return { icon: 'issue-tracks', tone: '', text: `removed sub-issue ${eventLink(ev.text, ev.url)}` };
  }
}

/** One event on the timeline rail: icon badge, "actor did something", relative time. */
function eventHtml(ev: TimelineEvent): string {
  const { icon, tone, text } = eventParts(ev);
  return `<div class="tl-event"><span class="tl-badge ${tone}">${octicon(icon)}</span>`
    + `<div class="tl-text"><b class="tl-actor">${escapeHtml(ev.actor)}</b> ${text} ${timeHtml(ev.at)}</div></div>`;
}
```

Create `src/webview/detailSidebarHtml.ts`:

```ts
'use strict';

// Pure HTML for the detail tab's right sidebar and the sub-issue block (see detailHtml.ts for the conventions).

function sidebarSection(key: string, title: string, canEdit: boolean, body: string): string {
  const edit = canEdit
    ? `<button type="button" class="icon-btn" data-act="pick-${key}" title="Edit ${title.toLowerCase()}" aria-label="Edit ${title.toLowerCase()}">${octicon('gear')}</button>`
    : '';
  return `<section class="sb-section" data-sec="${key}"><div class="sb-head"><span>${title}</span>${edit}</div><div class="sb-body">${body}</div></section>`;
}

function pullRequestIcon(pr: LinkedPr): string {
  if (pr.state === 'merged') return octicon('git-merge', 'pr-icon pr-merged');
  if (pr.state === 'closed') return octicon('git-pull-request-closed', 'pr-icon pr-closed');
  return pr.isDraft ? octicon('git-pull-request-draft', 'pr-icon pr-draft') : octicon('git-pull-request', 'pr-icon pr-open');
}

/** Assignees, Labels, Type (only for repos that have issue types), Milestone, Development, Participants. */
function sidebarHtml(d: IssueDetail, meta: DetailMetadata | null, viewer: string | null): string {
  const canEdit = d.post.viewerCanUpdate;
  const none = (text: string): string => `<span class="muted">${text}</span>`;

  const assignees = d.issue.assignees.length > 0
    ? d.issue.assignees.map(a => `<div class="sb-person">${avatarHtml(a)} ${escapeHtml(a.login)}</div>`).join('')
    : none('No one')
      + (canEdit && viewer ? ` <button type="button" class="link-btn" data-act="assign-me">assign yourself</button>` : '');
  const labels = d.issue.labels.length > 0 ? eventLabelChips(d.issue.labels) : none('None yet');
  const type = d.issueType ? escapeHtml(d.issueType.name) : none('No type');
  const milestone = d.milestone
    ? `<div>${octicon('milestone')} ${escapeHtml(d.milestone.title)}</div>`
      + `<div class="progress" title="${d.milestone.percent}% complete"><span style="width:${d.milestone.percent}%"></span></div>`
    : none('No milestone');
  const prs = d.linkedPrs.map(pr =>
    `<div class="sb-pr"><a href="${escapeHtml(pr.url)}">${pullRequestIcon(pr)} ${escapeHtml(pr.title)} <span class="muted">#${pr.number}</span></a></div>`).join('');
  const development = prs
    + `<div class="sb-dev-actions"><button type="button" class="link-btn" data-act="branch">${octicon('git-branch')} Create a branch</button>`
    + `<button type="button" class="link-btn" data-act="worktree">${octicon('git-branch')} Create a worktree</button></div>`;
  const participants = d.participants.map(p => `<span title="${escapeHtml(p.login)}">${avatarHtml(p)}</span>`).join('');

  return sidebarSection('assignees', 'Assignees', canEdit, assignees)
    + sidebarSection('labels', 'Labels', canEdit, labels)
    + (d.issueType || (meta && meta.types.length > 0) ? sidebarSection('type', 'Type', canEdit, type) : '')
    + sidebarSection('milestone', 'Milestone', canEdit, milestone)
    + sidebarSection('development', 'Development', false, development)
    + (participants ? sidebarSection('participants', 'Participants', false, `<div class="sb-avatars">${participants}</div>`) : '');
}

/** The sub-issue list under the issue body: progress, one row per child, and (when editable) add / remove. */
function subIssuesHtml(d: IssueDetail): string {
  if (d.subIssues.length === 0) return '';
  const canEdit = d.post.viewerCanUpdate;
  const done = d.subIssues.filter(s => s.state === 'closed').length;
  const percent = Math.round((done / d.subIssues.length) * 100);
  const rows = d.subIssues.map(s => `
    <div class="sub-row">
      ${issueStateIcon(s.state, s.stateReason)}
      <button type="button" class="sub-title" data-act="open-issue" data-number="${s.number}">${escapeHtml(s.title)}</button>
      <span class="muted">#${s.number}</span>
      <span class="sub-people">${s.assignees.map(a => avatarHtml(a)).join('')}</span>
      ${canEdit ? `<button type="button" class="icon-btn" data-act="sub-menu" data-id="${escapeHtml(s.id)}" data-number="${s.number}" title="More actions" aria-label="More actions">${octicon('kebab-horizontal')}</button>` : ''}
    </div>`).join('');
  return `<section class="subissues">
    <div class="sub-head"><b>Sub-issues</b> <span class="muted">${done} of ${d.subIssues.length}</span>
      <div class="progress"><span style="width:${percent}%"></span></div>
      ${canEdit ? `<button type="button" class="btn btn-ghost btn-small" data-act="add-sub">Add sub-issue</button>` : ''}
    </div>${rows}
  </section>`;
}
```

In `tsconfig.webview-shared.json`, append three entries to `include` (after `"src/webview/shared/picker.ts"`): `"src/webview/detailTypes.ts"`, `"src/webview/detailHtml.ts"`, `"src/webview/detailSidebarHtml.ts"`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsc -p tsconfig.json && npx tsc -p tsconfig.webview-shared.json && node --test out/webviewDetail.test.js`
Expected: PASS, 14 tests.

Then: `npm test`
Expected: all pass (177).

- [ ] **Step 7: Commit**

```bash
npm run compile
git add scripts/gen-octicons.js src/webview/shared/octicons.ts src/webview/shared/picker.ts src/webview/detailTypes.ts src/webview/detailHtml.ts src/webview/detailSidebarHtml.ts src/webviewDetail.test.ts tsconfig.webview-shared.json tsconfig.json package.json out/webview-shared.js out/webviewDetail.test.js out/webviewDetail.test.js.map lib/issues.js lib/issueDetail.js
git status --short
git commit -m "feat(null-tools): add the Issues detail tab's HTML builders and icons

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(`lib/issues.js` and `lib/issueDetail.js` change because both bundles include `octicons.ts`.)

---

### Task 4: Host panel: one tab per issue and the new protocol

**Do not commit this task on its own.** The webview still speaks the old protocol until Task 5, so the commit that makes the tab work again is Task 6's.

**Files:**
- Replace: `src/issueDetailPanel.ts`
- Modify: `src/issuesListController.ts`, `src/github/githubApi.ts`, `src/github/issuesStore.ts`, `src/github/types.ts` (delete dead code)

**Interfaces:**
- Consumes: Task 2's store methods; `formatIssueAsPrompt`, `createIssueBranch`, `toggleTaskCheckbox`, `loadIssueTemplates` (unchanged).
- Produces: `IssueDetailPanel.show(extensionUri, store, issueNumber, newTab = false)`, `IssueDetailPanel.showCreate(extensionUri, store, onCreated?)` (same shape as before). **Host → webview:** `detail{detail, afterWrite, viewer, repo, closedLocally}`, `metadata{labels, assignees, milestones, types}`, `timelinePage{items, hasMore}`, `commentAdded{item}`, `postUpdated{item}`, `postDeleted{id}`, `reactions{id, groups}`, `candidates{items}`, `failed{what: 'write' | 'refresh' | 'comment' | 'edit' | 'delete' | 'reaction' | 'candidates' | 'timeline', message}`, `error{message}`, `copied`, `createInit{repoLabels, assignableUsers, templates}`, `createFailed`. **Webview → host:** the `InboundMessage` union at the top of the file.

- [ ] **Step 1: Replace `src/issueDetailPanel.ts`**

Replace the whole file with:

```ts
'use strict';

import * as vscode from 'vscode';
import { getNonce } from './webviewUtils';
import { IssuePatch } from './github/githubApi';
import { IssuesStore } from './github/issuesStore';
import { formatIssueAsPrompt } from './github/promptFormat';
import { createIssueBranch, getLocallyClosedIssueNumbers } from './github/gitBranch';
import { toggleTaskCheckbox } from './github/taskList';
import { loadIssueTemplates } from './github/issueTemplates';
import { GithubIssue, GithubLabel, GithubUser, ReactionContent } from './github/types';

/** What a close/reopen button asks for. */
type StateTarget = 'completed' | 'not_planned' | 'reopen';

const STATE_PATCHES: Record<StateTarget, IssuePatch> = {
  completed: { state: 'closed', state_reason: 'completed' },
  not_planned: { state: 'closed', state_reason: 'not_planned' },
  reopen: { state: 'open', state_reason: 'reopened' },
};

type InboundMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'loadMoreTimeline' }
  | { type: 'setTitle'; title: string }
  | { type: 'setState'; to: StateTarget }
  | { type: 'setAssignees'; logins: string[] }
  | { type: 'setLabels'; names: string[] }
  | { type: 'setMilestone'; number: number | null }
  | { type: 'setType'; id: string | null }
  | { type: 'toggleReaction'; subjectId: string; content: ReactionContent; add: boolean }
  | { type: 'requestCandidates' }
  | { type: 'addSubIssue'; number: number }
  | { type: 'removeSubIssue'; id: string }
  | { type: 'postComment'; body: string; then?: StateTarget }
  | { type: 'editPost'; kind: 'body' | 'comment'; id: string; body: string }
  | { type: 'deletePost'; id: string }
  | { type: 'toggleTask'; index: number; checked: boolean }
  | { type: 'openIssue'; number: number; newTab: boolean }
  | { type: 'openExternal'; url: string }
  | { type: 'copyText'; text: string }
  | { type: 'copyAsPrompt' }
  | { type: 'openInBrowser' }
  | { type: 'createBranch' }
  | { type: 'createWorktree' }
  | { type: 'submitCreate'; title: string; body: string; labels: string[]; assignees: string[] }
  | { type: 'cancelCreate' };

/** A tab that regains focus after this long reloads its issue. */
const STALE_MS = 60_000;

const shortTitle = (title: string): string => (title.length > 32 ? `${title.slice(0, 31)}…` : title);

export class IssueDetailPanel {
  /** Every open issue tab, by issue number, so opening an issue that already has a tab just focuses it. */
  private static readonly byNumber = new Map<number, IssueDetailPanel>();
  /** The tab a plain click reuses. Ctrl/middle-click opens a tab of its own that is never reused. */
  private static shared: IssueDetailPanel | undefined;
  /** The one New issue tab. */
  private static creatingTab: IssueDetailPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private issueNumber = 0;
  private creating = false;
  private onCreated?: (issue: GithubIssue) => void;
  private detail: { id: string; timelineCursor: string | null } | null = null;
  private loadedAt = 0;

  static async show(extensionUri: vscode.Uri, store: IssuesStore, issueNumber: number, newTab = false): Promise<void> {
    const existing = IssueDetailPanel.byNumber.get(issueNumber);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    let target = newTab ? undefined : IssueDetailPanel.shared;
    if (target) {
      target.panel.reveal();
    } else {
      target = new IssueDetailPanel(extensionUri, store);
      if (!newTab) IssueDetailPanel.shared = target;
    }
    await target.openIssue(issueNumber);
  }

  static async showCreate(extensionUri: vscode.Uri, store: IssuesStore, onCreated?: (issue: GithubIssue) => void): Promise<void> {
    const existing = IssueDetailPanel.creatingTab;
    if (existing) {
      existing.onCreated = onCreated;
      existing.panel.reveal();
      return;
    }
    const tab = new IssueDetailPanel(extensionUri, store);
    IssueDetailPanel.creatingTab = tab;
    await tab.openCreate(onCreated);
  }

  private constructor(private readonly extensionUri: vscode.Uri, private readonly store: IssuesStore) {
    this.panel = vscode.window.createWebviewPanel('null-tools.issueDetail', 'Issue', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'lib')],
    });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'github-issues.svg');
    this.panel.webview.html = this._buildHtml();
    this.panel.webview.onDidReceiveMessage((msg: InboundMessage) => void this._handleMessage(msg));
    this.panel.onDidChangeViewState(e => {
      if (e.webviewPanel.active && this.issueNumber && Date.now() - this.loadedAt > STALE_MS) void this._load(false);
    });
    this.panel.onDidDispose(() => {
      if (IssueDetailPanel.byNumber.get(this.issueNumber) === this) IssueDetailPanel.byNumber.delete(this.issueNumber);
      if (IssueDetailPanel.shared === this) IssueDetailPanel.shared = undefined;
      if (IssueDetailPanel.creatingTab === this) IssueDetailPanel.creatingTab = undefined;
    });
  }

  private _post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private async openIssue(issueNumber: number): Promise<void> {
    if (IssueDetailPanel.byNumber.get(this.issueNumber) === this) IssueDetailPanel.byNumber.delete(this.issueNumber);
    this.creating = false;
    this.issueNumber = issueNumber;
    this.detail = null;
    IssueDetailPanel.byNumber.set(issueNumber, this);
    this.panel.title = `Issue #${issueNumber}`;
    await this._load(false);
  }

  private async openCreate(onCreated?: (issue: GithubIssue) => void): Promise<void> {
    this.creating = true;
    this.onCreated = onCreated;
    this.panel.title = 'New Issue';
    await this._sendCreateForm();
  }

  private _cwd(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /** Fetches the issue and sends it. `afterWrite` tells the webview this answers one of its own writes. */
  private async _load(afterWrite: boolean): Promise<void> {
    const number = this.issueNumber;
    try {
      const detail = await this.store.getDetail(number);
      if (number !== this.issueNumber) return; // this tab moved on to another issue meanwhile
      this.detail = { id: detail.id, timelineCursor: detail.timelineCursor };
      this.loadedAt = Date.now();
      this.panel.title = `#${number} ${shortTitle(detail.issue.title)}`;
      const cwd = this._cwd();
      const repo = this.store.getRepo();
      this._post({
        type: 'detail', detail, afterWrite,
        viewer: this.store.getViewerLogin(),
        repo: repo ? `${repo.owner}/${repo.repo}` : '',
        closedLocally: detail.issue.state === 'open' && !!cwd && getLocallyClosedIssueNumbers(cwd).has(number),
      });
      void this._sendMetadata();
    } catch (err) {
      this._post(afterWrite
        ? { type: 'failed', what: 'refresh', message: (err as Error).message }
        : { type: 'error', message: (err as Error).message });
    }
  }

  private async _sendMetadata(): Promise<void> {
    try {
      const m = await this.store.getMetadata();
      this._post({ type: 'metadata', labels: m.labels, assignees: m.assignees, milestones: m.milestones, types: m.issueTypes });
    } catch {
      // The pickers just stay empty; the issue itself already loaded.
    }
  }

  private async _sendCreateForm(): Promise<void> {
    // Signed-out/offline must still show the form: Create itself prompts for sign-in
    // (ensureSession(true)), so an empty-picker form beats no form at all.
    const [repoLabels, assignableUsers] = await Promise.all([
      this.store.getRepoLabels().catch((): GithubLabel[] => []),
      this.store.getAssignableUsers().catch((): GithubUser[] => []),
    ]);
    const cwd = this._cwd();
    this._post({ type: 'createInit', repoLabels, assignableUsers, templates: cwd ? loadIssueTemplates(cwd) : [] });
  }

  /** Runs one GitHub write, then reloads the issue so the tab shows GitHub's version (and any new timeline events). */
  private async _write(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action();
    } catch (err) {
      this._post({ type: 'failed', what: 'write', message: (err as Error).message });
      return false;
    }
    await this._load(true);
    return true;
  }

  private async _handleMessage(msg: InboundMessage): Promise<void> {
    const number = this.issueNumber;
    switch (msg.type) {
      case 'ready':
        if (this.creating) await this._sendCreateForm();
        else if (number) await this._load(false);
        break;
      case 'refresh':
        await this._load(false);
        break;
      case 'loadMoreTimeline': {
        const cursor = this.detail?.timelineCursor;
        if (!cursor) break;
        try {
          const page = await this.store.getTimelinePage(number, cursor);
          if (this.detail) this.detail.timelineCursor = page.cursor;
          this._post({ type: 'timelinePage', items: page.items, hasMore: page.hasMore });
        } catch (err) {
          this._post({ type: 'failed', what: 'timeline', message: (err as Error).message });
        }
        break;
      }
      case 'setTitle':
        await this._write(() => this.store.updateIssue(number, { title: msg.title }));
        break;
      case 'setState':
        await this._write(() => this.store.updateIssue(number, STATE_PATCHES[msg.to]));
        break;
      case 'setAssignees':
        await this._write(() => this.store.updateIssue(number, { assignees: msg.logins }));
        break;
      case 'setLabels':
        await this._write(() => this.store.updateIssue(number, { labels: msg.names }));
        break;
      case 'setMilestone':
        await this._write(() => this.store.updateIssue(number, { milestone: msg.number }));
        break;
      case 'setType':
        if (this.detail) await this._write(() => this.store.setIssueType(this.detail!.id, msg.id));
        break;
      case 'addSubIssue':
        if (this.detail) await this._write(() => this.store.addSubIssue(this.detail!.id, msg.number));
        break;
      case 'removeSubIssue':
        if (this.detail) await this._write(() => this.store.removeSubIssue(this.detail!.id, msg.id));
        break;
      case 'toggleReaction':
        try {
          const groups = await this.store.toggleReaction(msg.subjectId, msg.content, msg.add);
          this._post({ type: 'reactions', id: msg.subjectId, groups });
        } catch (err) {
          this._post({ type: 'failed', what: 'reaction', message: (err as Error).message });
        }
        break;
      case 'requestCandidates':
        try {
          // ponytail: the 50 newest open issues; add a debounced server search if that proves too few to pick from.
          const page = await this.store.search('is:open', null, false);
          this._post({
            type: 'candidates',
            items: page.items.filter(i => i.number !== number).map(i => ({ number: i.number, title: i.title })),
          });
        } catch (err) {
          this._post({ type: 'failed', what: 'candidates', message: (err as Error).message });
        }
        break;
      case 'postComment': {
        if (!this.detail) break;
        try {
          const item = await this.store.postComment(number, this.detail.id, msg.body);
          this._post({ type: 'commentAdded', item });
        } catch (err) {
          // With a close/reopen attached, the webview already applied it optimistically and has to undo it.
          this._post({ type: 'failed', what: msg.then ? 'write' : 'comment', message: (err as Error).message });
          break;
        }
        if (msg.then) {
          const to = msg.then;
          await this._write(() => this.store.updateIssue(number, STATE_PATCHES[to]));
        }
        break;
      }
      case 'editPost':
        if (msg.kind === 'body') {
          await this._write(() => this.store.updateIssue(number, { body: msg.body }));
        } else {
          try {
            this._post({ type: 'postUpdated', item: await this.store.editComment(msg.id, msg.body) });
          } catch (err) {
            this._post({ type: 'failed', what: 'edit', message: (err as Error).message });
          }
        }
        break;
      case 'deletePost': {
        const confirmed = await vscode.window.showWarningMessage('Delete this comment?', { modal: true }, 'Delete');
        if (confirmed !== 'Delete') break;
        try {
          await this.store.removeComment(number, msg.id);
          this._post({ type: 'postDeleted', id: msg.id });
        } catch (err) {
          this._post({ type: 'failed', what: 'delete', message: (err as Error).message });
        }
        break;
      }
      case 'toggleTask': {
        const body = this.store.getByNumber(number)?.body;
        const newBody = body ? toggleTaskCheckbox(body, msg.index, msg.checked) : null;
        if (newBody === null) {
          this._post({ type: 'failed', what: 'write', message: 'Could not find that checkbox in the issue text.' });
          break;
        }
        await this._write(() => this.store.updateIssue(number, { body: newBody }));
        break;
      }
      case 'openIssue':
        await IssueDetailPanel.show(this.extensionUri, this.store, msg.number, msg.newTab);
        break;
      case 'openExternal':
        // The webview only sends links it found in GitHub-rendered HTML, but never hand an arbitrary scheme to the OS.
        if (/^https:\/\//i.test(msg.url)) await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
      case 'copyText':
        await vscode.env.clipboard.writeText(msg.text);
        break;
      case 'copyAsPrompt': {
        const issue = this.store.getByNumber(number);
        if (!issue) break;
        await vscode.env.clipboard.writeText(formatIssueAsPrompt(issue));
        this._post({ type: 'copied' });
        break;
      }
      case 'openInBrowser': {
        const issue = this.store.getByNumber(number);
        if (issue) await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
        break;
      }
      case 'createBranch': {
        const issue = this.store.getByNumber(number);
        const cwd = this._cwd();
        if (!issue || !cwd) break;
        const result = createIssueBranch(cwd, issue.number, issue.title);
        if (result.ok) void vscode.window.showInformationMessage(`Switched to branch ${result.branch}`);
        else void vscode.window.showErrorMessage(`Failed to create branch: ${result.message}`);
        break;
      }
      case 'createWorktree': {
        const issue = this.store.getByNumber(number);
        if (issue) await vscode.commands.executeCommand('null.worktrees.createForIssue', issue.number, issue.title);
        break;
      }
      case 'submitCreate': {
        try {
          const created = await this.store.createIssue({
            title: msg.title, body: msg.body, labels: msg.labels, assignees: msg.assignees,
          });
          // This tab becomes the new issue's tab. Open it first so the store knows the issue, then let the
          // lists insert it: they don't search for it, because GitHub's search index lags a few seconds.
          if (IssueDetailPanel.creatingTab === this) IssueDetailPanel.creatingTab = undefined;
          IssueDetailPanel.shared ??= this;
          await this.openIssue(created.number);
          this.onCreated?.(created);
        } catch (err) {
          void vscode.window.showErrorMessage(`Failed to create issue: ${(err as Error).message}`);
          this._post({ type: 'createFailed' });
        }
        break;
      }
      case 'cancelCreate':
        this.panel.dispose();
        break;
    }
  }

  private _buildHtml(): string {
    const nonce = getNonce();
    const asUri = (file: string): vscode.Uri => this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', file));
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; img-src ${this.panel.webview.cspSource} https://avatars.githubusercontent.com;">
<link rel="stylesheet" href="${asUri('issues.css')}">
<link rel="stylesheet" href="${asUri('issueDetail.css')}">
</head><body>
<div id="detail"><div id="empty">Loading…</div></div>
<script nonce="${nonce}" src="${asUri('purify.min.js')}"></script>
<script nonce="${nonce}" src="${asUri('issueDetail.js')}"></script>
</body></html>`;
  }
}
```

- [ ] **Step 2: Let the list open a new tab**

In `src/issuesListController.ts`:

1. In `type InboundMessage`, change `| { type: 'open'; number: number }` to `| { type: 'open'; number: number; newTab?: boolean }`.
2. In `_handleMessage`, `case 'open':`, change
   `await IssueDetailPanel.show(this._extensionUri, this._store, msg.number);`
   to
   `await IssueDetailPanel.show(this._extensionUri, this._store, msg.number, msg.newTab === true);`.

- [ ] **Step 3: Delete the REST code nothing calls any more**

- `src/github/githubApi.ts`: delete the functions `fetchIssue`, `fetchComments`, `fetchTimeline`, `createComment`, `updateComment`, `deleteComment`, and change the first import to `import { GithubIssue, GithubLabel, GithubUser, IssueState } from './types';`.
- `src/github/issuesStore.ts`: delete the methods `getComments`, `getTimeline`, `reloadIssue`, `addComment`, `updateComment`, `deleteComment`; replace the `./githubApi` import with `import { IssuePatch, createIssue, fetchAssignableUsers, fetchRepoLabels, requestGraphql, updateIssue } from './githubApi';` and remove `GithubComment` and `GithubTimelineEvent` from the `./types` import.
- `src/github/types.ts`: delete the interfaces `GithubComment` and `GithubTimelineEvent` (with their doc comments).

- [ ] **Step 4: Compile**

Run: `npx tsc -p tsconfig.json`
Expected: no errors. If `grep -rn "getComments\|getTimeline\b\|reloadIssue\|GithubComment\|GithubTimelineEvent" src --include=*.ts` still lists anything outside `src/webview/` (the old webview file, replaced in Task 5), remove that leftover.

---

### Task 5: Webview: detail script, create form, list gestures

**Do not commit this task on its own** (see Task 4).

**Files:**
- Replace: `tsconfig.webview-issue-detail.json`, `src/webview/issueDetail.ts`
- Create: `src/webview/issueCreate.ts`
- Modify: `src/webview/issues.ts`

**Interfaces:**
- Consumes: Task 3's builders and picker; Task 4's protocol.
- Produces: `lib/issueDetail.js` (the detail and create views) and a list that sends `open{number, newTab}`.

- [ ] **Step 1: Point the bundle at the new files**

Replace `tsconfig.webview-issue-detail.json` with:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "none",
    "lib": ["ES2017", "DOM"],
    "outFile": "./lib/issueDetail.js",
    "strict": true,
    "sourceMap": false,
    "skipLibCheck": true
  },
  "include": [
    "src/webview/shared/octicons.ts", "src/webview/shared/time.ts", "src/webview/shared/labels.ts", "src/webview/shared/issueState.ts",
    "src/webview/shared/dom.ts", "src/webview/shared/picker.ts",
    "src/webview/detailTypes.ts", "src/webview/detailHtml.ts", "src/webview/detailSidebarHtml.ts",
    "src/webview/issueCreate.ts", "src/webview/issueDetail.ts"
  ]
}
```

- [ ] **Step 2: Move the create form**

Create `src/webview/issueCreate.ts` (the old form and its dropdown, behavior unchanged, now fed by `createInit`):

```ts
'use strict';

// The New issue form. Moved out of issueDetail.ts unchanged in behavior; the Phase 4 composer rewrites it.

interface CreateFormData { repoLabels: GithubLabel[]; assignableUsers: GithubUser[]; templates: IssueTemplate[]; }
interface DropdownItem { value: string; label: string; color?: string; }

/** Closes the form's open dropdowns. Set while the form is on screen. */
let closeCreateDropdowns: (() => void) | null = null;

document.addEventListener('click', e => {
  if (e.composedPath().some(n => n instanceof Element && n.classList.contains('dropdown-container'))) return;
  closeCreateDropdowns?.();
});

function renderDropdown(
  containerId: string, items: DropdownItem[], selected: Set<string>,
  isOpen: () => boolean, toggleOpen: () => void, placeholder: string,
): () => void {
  const refresh = () => {
    const container = document.getElementById(containerId) as HTMLDivElement | null;
    if (!container) return;
    const open = isOpen();
    const selectedItems = items.filter(i => selected.has(i.value));
    container.innerHTML = `
      <button type="button" class="dropdown-trigger">
        ${selectedItems.length > 0 ? `<span class="selected-tags">${selectedItems.map(i => `
          <span class="tag${i.color ? ' gh-label' : ''}"${i.color ? ` style="${labelStyleVars(i.color)}"` : ''}>${escapeHtml(i.label)}<span class="tag-remove" data-value="${escapeHtml(i.value)}">&times;</span></span>`).join('')}</span>`
          : `<span class="dropdown-placeholder">${escapeHtml(placeholder)}</span>`}
        <span class="dropdown-arrow">${open ? '▲' : '▼'}</span>
      </button>
      <div class="dropdown-list${open ? '' : ' hidden'}">
        ${items.length === 0 ? '<span class="muted">None available.</span>' : items.map(i => `
          <button type="button" class="dropdown-item${selected.has(i.value) ? ' selected' : ''}" data-value="${escapeHtml(i.value)}">
            <span class="checkbox">${selected.has(i.value) ? '☑' : '☐'}</span>
            ${i.color ? `<span class="color-dot" style="background:#${i.color}"></span>` : ''}
            ${escapeHtml(i.label)}
          </button>`).join('')}
      </div>`;
    container.querySelector('.dropdown-trigger')?.addEventListener('click', () => {
      toggleOpen();
      refresh();
    });
    container.querySelectorAll<HTMLElement>('.tag-remove').forEach(el => el.addEventListener('mousedown', e => {
      e.preventDefault();
      selected.delete(el.dataset.value!);
      refresh();
    }));
    container.querySelectorAll<HTMLElement>('.dropdown-item').forEach(el => el.addEventListener('click', () => {
      const v = el.dataset.value!;
      if (selected.has(v)) selected.delete(v); else selected.add(v);
      refresh();
    }));
  };
  refresh();
  return refresh;
}

function renderCreateForm(root: HTMLElement, data: CreateFormData, post: (message: unknown) => void): void {
  let labelOpen = false;
  let assigneeOpen = false;
  const selectedLabels = new Set<string>();
  const selectedAssignees = new Set<string>();
  root.innerHTML = `
    <div id="create-form">
      <h1 class="title">New issue</h1>
      <div class="edit-form">
        ${data.templates.length > 0 ? `
        <select id="template-picker">
          <option value="">Blank issue</option>
          ${data.templates.map((t, i) => `<option value="${i}">${escapeHtml(t.name)}</option>`).join('')}
        </select>` : ''}
        <input id="edit-title" placeholder="Title">
        <div id="title-error" class="field-error hidden">Title is required.</div>
        <textarea id="edit-body" placeholder="Description"></textarea>
        <div class="picker-group">
          <span class="assignees-label">Labels:</span>
          <div class="dropdown-container" id="label-picker"></div>
        </div>
        <div class="picker-group">
          <span class="assignees-label">Assignees:</span>
          <div class="dropdown-container" id="assignee-picker"></div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="save-btn">Create</button>
          <button class="btn btn-secondary" id="cancel-btn">Cancel</button>
        </div>
      </div>
    </div>`;
  const refreshLabels = renderDropdown(
    'label-picker', data.repoLabels.map(l => ({ value: l.name, label: l.name, color: l.color })), selectedLabels,
    () => labelOpen, () => { labelOpen = !labelOpen; }, 'Select labels…',
  );
  const refreshAssignees = renderDropdown(
    'assignee-picker', data.assignableUsers.map(u => ({ value: u.login, label: u.login })), selectedAssignees,
    () => assigneeOpen, () => { assigneeOpen = !assigneeOpen; }, 'Select assignees…',
  );
  closeCreateDropdowns = () => {
    if (!labelOpen && !assigneeOpen) return;
    labelOpen = false;
    assigneeOpen = false;
    refreshLabels();
    refreshAssignees();
  };
  document.getElementById('template-picker')?.addEventListener('change', e => {
    const index = (e.target as HTMLSelectElement).value;
    const template = index ? data.templates[Number(index)] : null;
    (document.getElementById('edit-title') as HTMLInputElement).value = template?.title ?? '';
    (document.getElementById('edit-body') as HTMLTextAreaElement).value = template?.body ?? '';
    selectedLabels.clear();
    template?.labels.forEach(l => {
      const match = data.repoLabels.find(rl => rl.name.toLowerCase() === l.toLowerCase());
      if (match) selectedLabels.add(match.name);
    });
    refreshLabels();
  });
  const titleInput = document.getElementById('edit-title') as HTMLInputElement;
  const titleError = document.getElementById('title-error') as HTMLDivElement;
  titleInput.addEventListener('input', () => titleError.classList.add('hidden'));
  document.getElementById('save-btn')?.addEventListener('click', () => {
    const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
    if (saveBtn.disabled) return;
    const title = titleInput.value.trim();
    if (!title) {
      titleError.classList.remove('hidden');
      titleInput.focus();
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Creating…';
    post({
      type: 'submitCreate', title,
      body: (document.getElementById('edit-body') as HTMLTextAreaElement).value,
      labels: Array.from(selectedLabels), assignees: Array.from(selectedAssignees),
    });
  });
  document.getElementById('cancel-btn')?.addEventListener('click', () => post({ type: 'cancelCreate' }));
}
```

- [ ] **Step 3: Replace the detail script**

Replace the whole of `src/webview/issueDetail.ts` with:

```ts
'use strict';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
declare const DOMPurify: { sanitize(html: string): string };

/** What a close / reopen button asks for; the host maps it to REST `state` + `state_reason`. */
type StateTarget = 'completed' | 'not_planned' | 'reopen';

(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('detail') as HTMLDivElement;
  const toastEl = document.createElement('div');
  toastEl.id = 'toast';
  toastEl.className = 'hidden';
  toastEl.setAttribute('role', 'status');
  document.body.appendChild(toastEl);

  let detail: IssueDetail | null = null;
  let metadata: DetailMetadata | null = null;
  let viewer: string | null = null;
  let repoName = '';
  let closedLocally = false;
  let hasMoreTimeline = false;
  /** Id of the post whose edit form is open (the issue's own id for the body). */
  let editingId: string | null = null;
  let editingTitle = false;
  let commentBusy = false;
  /** Writes the host hasn't answered yet. While any are in flight, a refresh must not overwrite the optimistic state. */
  let pending = 0;
  /** `detail` as it was before the oldest unanswered write, to restore if that write fails. */
  let rollback: IssueDetail | null = null;
  let pageMounted = false;
  let composerFor = 0;
  let candidateAnchor: HTMLElement | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const post = (message: unknown): void => vscode.postMessage(message);
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

  function toast(message: string): void {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 5000);
  }

  // ---- rendering ----------------------------------------------------------------------------------------------

  /** Server-rendered markdown, minus images the webview can't load, sanitized once more before it touches the DOM. */
  const prepared = (p: IssuePost): IssuePost => ({ ...p, bodyHTML: DOMPurify.sanitize(neutralizeImagesHtml(p.bodyHTML)) });

  function bindAvatarFallbacks(): void {
    root.querySelectorAll<HTMLImageElement>('.avatar img').forEach(img =>
      img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true }));
  }

  function mountPage(): void {
    root.innerHTML = `
      <div id="sticky" class="hidden"></div>
      <div id="page">
        <header id="header"></header>
        <div id="layout">
          <main id="main"><div id="timeline"></div><div id="composer"></div></main>
          <aside id="sidebar"></aside>
        </div>
      </div>`;
    new IntersectionObserver(([entry]) => $('sticky').classList.toggle('hidden', entry.isIntersecting))
      .observe($('header'));
    pageMounted = true;
    composerFor = 0;
  }

  function renderHeader(): void {
    if (!detail) return;
    const { issue } = detail;
    const title = editingTitle
      ? `<div class="title-edit"><input id="title-input" value="${escapeHtml(issue.title)}" aria-label="Title">
           <button type="button" class="btn btn-primary" data-act="save-title">Save</button>
           <button type="button" class="btn btn-secondary" data-act="cancel-title">Cancel</button></div>`
      : `<h1 class="title">${escapeHtml(issue.title)} <span class="number">#${issue.number}</span></h1>
         <div class="title-actions">
           ${detail.post.viewerCanUpdate ? '<button type="button" class="btn btn-ghost" data-act="edit-title">Edit</button>' : ''}
           <button type="button" class="icon-btn" data-act="header-menu" title="More actions" aria-label="More actions">${octicon('kebab-horizontal')}</button>
         </div>`;
    const parent = detail.parent
      ? ` · sub-issue of <button type="button" class="link-btn" data-act="open-issue" data-number="${detail.parent.number}">#${detail.parent.number} ${escapeHtml(detail.parent.title)}</button>` : '';
    $('header').innerHTML = `
      <div class="title-row">${title}</div>
      <div class="meta-row">
        ${issueStateBadge(issue.state, issue.state_reason)}
        ${closedLocally && issue.state === 'open' ? '<span class="closes-badge" title="An unpushed local commit will close this issue">closes on push</span>' : ''}
        <span><b>${escapeHtml(issue.user.login)}</b> opened this ${timeHtml(issue.created_at ?? detail.post.createdAt)} · ${plural(issue.comments, 'comment')}${parent}</span>
      </div>`;
    $('sticky').innerHTML = `${issueStateIcon(issue.state, issue.state_reason)} <b>${escapeHtml(issue.title)}</b> <span class="muted">#${issue.number}</span>`;
    bindAvatarFallbacks();
  }

  function renderSidebar(): void {
    if (!detail) return;
    $('sidebar').innerHTML = sidebarHtml(detail, metadata, viewer);
    bindAvatarFallbacks();
  }

  function renderTimeline(): void {
    if (!detail) return;
    const d = detail;
    // An open edit form is rebuilt with the rest, so carry what was typed across.
    const typing = root.querySelector<HTMLTextAreaElement>('.post-edit-input');
    const draft = typing ? typing.value : null;
    const parts = [postHtml(prepared(d.post), 'body', editingId === d.post.id), subIssuesHtml(d)];
    for (const item of d.timeline) {
      parts.push(item.kind === 'comment' ? postHtml(prepared(item), 'comment', editingId === item.id) : eventHtml(item));
    }
    if (hasMoreTimeline) parts.push('<button type="button" class="btn btn-ghost load-more" data-act="load-more">Load more</button>');
    $('timeline').innerHTML = parts.join('');
    const again = root.querySelector<HTMLTextAreaElement>('.post-edit-input');
    if (again && draft !== null) again.value = draft;
    // GitHub's rendered task items are disabled checkboxes; make them live for people who can edit the body.
    $('timeline').querySelectorAll<HTMLInputElement>('.post[data-kind="body"] .post-body input[type=checkbox]')
      .forEach((box, index) => {
        box.disabled = !d.post.viewerCanUpdate;
        box.addEventListener('change', () => {
          beginWrite(() => undefined);
          post({ type: 'toggleTask', index, checked: box.checked });
        });
      });
    bindAvatarFallbacks();
  }

  function renderAll(): void {
    renderHeader();
    renderSidebar();
    renderTimeline();
    updateComposer();
  }

  function mountComposer(): void {
    $('composer').innerHTML = `
      <div class="composer-card">
        <textarea id="comment-input" placeholder="Leave a comment" aria-label="Comment"></textarea>
        <div class="composer-actions">
          <span class="split">
            <button type="button" class="btn btn-ghost" id="close-main" data-act="close-main"></button>
            <button type="button" class="btn btn-ghost split-caret" id="close-caret" data-act="close-menu" aria-label="Close options">${octicon('triangle-down')}</button>
          </span>
          <button type="button" class="btn btn-primary" id="comment-btn" data-act="comment">Comment</button>
        </div>
      </div>`;
    const input = $<HTMLTextAreaElement>('comment-input');
    input.addEventListener('input', updateComposer);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitComment(); }
    });
    commentBusy = false;
  }

  /** Close/Reopen wording follows the issue's state and whether a comment is typed, like github.com. */
  function updateComposer(): void {
    const input = document.getElementById('comment-input') as HTMLTextAreaElement | null;
    if (!input || !detail) return;
    const hasText = input.value.trim().length > 0;
    const closed = detail.issue.state === 'closed';
    $('close-main').textContent = closed ? (hasText ? 'Reopen with comment' : 'Reopen issue') : (hasText ? 'Close with comment' : 'Close issue');
    $('close-caret').classList.toggle('hidden', closed);
    $<HTMLButtonElement>('close-main').disabled = commentBusy;
    $<HTMLButtonElement>('close-caret').disabled = commentBusy;
    $<HTMLButtonElement>('comment-btn').disabled = commentBusy || !hasText;
  }

  // ---- writes -------------------------------------------------------------------------------------------------

  /** Applies a change locally right away and counts it as unanswered until the host's `detail` or `failed` arrives. */
  function beginWrite(change: (d: IssueDetail) => void): void {
    if (!detail) return;
    if (pending === 0) rollback = clone(detail);
    pending++;
    change(detail);
    renderAll();
  }

  function applyState(to: StateTarget): void {
    beginWrite(d => {
      d.issue.state = to === 'reopen' ? 'open' : 'closed';
      d.issue.state_reason = to === 'reopen' ? 'reopened' : to;
    });
  }

  function submitComment(then?: StateTarget): void {
    const input = $<HTMLTextAreaElement>('comment-input');
    const body = input.value.trim();
    if (commentBusy || (!body && !then)) return;
    if (then) applyState(then);
    if (!body) {
      post({ type: 'setState', to: then });
      return;
    }
    commentBusy = true;
    updateComposer();
    post({ type: 'postComment', body, then });
  }

  /** The target a Close / Reopen click means for the issue's current state. */
  const closeTarget = (): StateTarget => (detail?.issue.state === 'closed' ? 'reopen' : 'completed');

  // ---- pickers ------------------------------------------------------------------------------------------------

  const sameSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every(v => b.has(v));

  /** A multi-select picker that applies once it closes, like github.com, instead of one request per tick. */
  function pickMany(anchor: HTMLElement, title: string, items: PickerItem[], apply: (chosen: Set<string>) => void): void {
    const initial = new Set(items.filter(i => i.selected).map(i => i.value));
    const chosen = new Set(initial);
    openPicker({
      anchor, title, items, multi: true,
      onSelect: v => { if (chosen.has(v)) chosen.delete(v); else chosen.add(v); },
      onClose: () => { if (!sameSet(chosen, initial)) apply(chosen); },
    });
  }

  function pickAssignees(anchor: HTMLElement): void {
    if (!detail) return;
    const current = detail.issue.assignees;
    const known = [...(metadata?.assignees ?? [])];
    for (const a of current) if (!known.some(k => k.login === a.login)) known.push(a);
    const items = known.map(u => ({
      value: u.login, label: u.login, html: `${avatarHtml(u)} ${escapeHtml(u.login)}`,
      selected: current.some(a => a.login === u.login),
    }));
    pickMany(anchor, 'Assign up to 10 people', items, chosen => {
      const logins = [...chosen];
      beginWrite(d => { d.issue.assignees = logins.map(l => known.find(k => k.login === l)!); });
      post({ type: 'setAssignees', logins });
    });
  }

  function pickLabels(anchor: HTMLElement): void {
    if (!detail) return;
    const current = detail.issue.labels;
    const known = [...(metadata?.labels ?? [])];
    for (const l of current) if (!known.some(k => k.name === l.name)) known.push(l);
    const items = known.map(l => ({
      value: l.name, label: l.name, html: `<span class="gh-label" style="${labelStyleVars(l.color)}">${escapeHtml(l.name)}</span>`,
      description: l.description ?? undefined, selected: current.some(c => c.name === l.name),
    }));
    pickMany(anchor, 'Apply labels', items, chosen => {
      const names = [...chosen];
      beginWrite(d => { d.issue.labels = names.map(n => known.find(k => k.name === n)!); });
      post({ type: 'setLabels', names });
    });
  }

  function pickMilestone(anchor: HTMLElement): void {
    if (!detail) return;
    const current = detail.milestone?.number ?? null;
    const items: PickerItem[] = [{ value: '', label: 'No milestone', selected: current === null }]
      .concat((metadata?.milestones ?? []).map(m => ({ value: String(m.number), label: m.title, selected: m.number === current })));
    openPicker({
      anchor, title: 'Set milestone', items, filterable: items.length > 8,
      onSelect: v => {
        const number = v === '' ? null : Number(v);
        if (number === current) return;
        const found = (metadata?.milestones ?? []).find(m => m.number === number);
        beginWrite(d => { d.milestone = found ? { number: found.number, title: found.title, percent: 0 } : null; });
        post({ type: 'setMilestone', number });
      },
    });
  }

  function pickType(anchor: HTMLElement): void {
    if (!detail) return;
    const current = detail.issueType?.id ?? null;
    const items: PickerItem[] = [{ value: '', label: 'No type', selected: current === null }]
      .concat((metadata?.types ?? []).map(t => ({ value: t.id, label: t.name, selected: t.id === current })));
    openPicker({
      anchor, title: 'Set issue type', items, filterable: false,
      onSelect: v => {
        const id = v === '' ? null : v;
        if (id === current) return;
        const found = (metadata?.types ?? []).find(t => t.id === id);
        beginWrite(d => { d.issueType = found ? { id: found.id, name: found.name } : null; });
        post({ type: 'setType', id });
      },
    });
  }

  function findPost(id: string): IssuePost | undefined {
    if (!detail) return undefined;
    if (detail.post.id === id) return detail.post;
    return detail.timeline.find((i): i is { kind: 'comment' } & IssuePost => i.kind === 'comment' && i.id === id);
  }

  function reactionPicker(anchor: HTMLElement, id: string): void {
    const target = findPost(id);
    if (!target) return;
    openPicker({
      anchor, title: 'Pick your reaction', items: reactionPickerItems(target), multi: true, filterable: false,
      onSelect: content => {
        const has = target.reactions.some(r => r.content === content && r.viewerHasReacted);
        post({ type: 'toggleReaction', subjectId: id, content, add: !has });
      },
    });
  }

  function quoteReply(target: IssuePost): void {
    const input = $<HTMLTextAreaElement>('comment-input');
    const postEl = root.querySelector(`.post[data-id="${CSS.escape(target.id)}"]`);
    const selection = window.getSelection();
    const selected = selection && postEl && postEl.contains(selection.anchorNode) ? selection.toString().trim() : '';
    const quote = (selected || target.body.trim()).split('\n').map(line => `> ${line}`).join('\n');
    input.value = `${input.value ? `${input.value.replace(/\s+$/, '')}\n\n` : ''}${quote}\n\n`;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    updateComposer();
  }

  function postMenu(anchor: HTMLElement, id: string): void {
    const target = findPost(id);
    if (!target || !detail) return;
    const isBody = target.id === detail.post.id;
    const items: PickerItem[] = [{ value: 'link', label: 'Copy link' }, { value: 'quote', label: 'Quote reply' }];
    if (target.viewerCanUpdate) items.push({ value: 'edit', label: 'Edit' });
    if (!isBody && target.viewerCanDelete) items.push({ value: 'delete', label: 'Delete' });
    openPicker({
      anchor, title: 'Actions', items, filterable: false,
      onSelect: action => {
        if (action === 'link') post({ type: 'copyText', text: target.url });
        else if (action === 'quote') quoteReply(target);
        else if (action === 'edit') { editingId = target.id; renderTimeline(); root.querySelector<HTMLTextAreaElement>('.post-edit-input')?.focus(); }
        else if (action === 'delete') post({ type: 'deletePost', id: target.id });
      },
    });
  }

  function headerMenu(anchor: HTMLElement): void {
    const items: PickerItem[] = [
      { value: 'prompt', label: 'Copy as prompt' }, { value: 'browser', label: 'Open on github.com' },
      { value: 'refresh', label: 'Refresh' },
    ];
    if (detail?.post.viewerCanUpdate) items.push({ value: 'sub', label: 'Add sub-issue…' });
    openPicker({
      anchor, title: 'Actions', items, filterable: false,
      onSelect: action => {
        if (action === 'prompt') post({ type: 'copyAsPrompt' });
        else if (action === 'browser') post({ type: 'openInBrowser' });
        else if (action === 'refresh') post({ type: 'refresh' });
        else if (action === 'sub') requestCandidates(anchor);
      },
    });
  }

  function requestCandidates(anchor: HTMLElement): void {
    candidateAnchor = anchor;
    post({ type: 'requestCandidates' });
  }

  function candidatePicker(candidates: Array<{ number: number; title: string }>): void {
    if (!detail) return;
    const taken = new Set<number>([detail.issue.number, ...detail.subIssues.map(s => s.number)]);
    if (detail.parent) taken.add(detail.parent.number);
    const items = candidates.filter(c => !taken.has(c.number)).map(c => ({ value: String(c.number), label: `#${c.number} ${c.title}` }));
    const anchor = candidateAnchor && candidateAnchor.isConnected ? candidateAnchor : root;
    openPicker({
      anchor, title: 'Add sub-issue', items, emptyText: 'No other open issues',
      onSelect: v => {
        const number = Number(v);
        const picked = candidates.find(c => c.number === number);
        beginWrite(d => d.subIssues.push({
          id: '', number, title: picked?.title ?? `#${number}`, state: 'open', stateReason: null, url: '', assignees: [],
        }));
        post({ type: 'addSubIssue', number });
      },
    });
  }

  function subMenu(anchor: HTMLElement, id: string, number: number): void {
    openPicker({
      anchor, title: 'Sub-issue', filterable: false,
      items: [{ value: 'open', label: 'Open' }, { value: 'remove', label: 'Remove sub-issue' }],
      onSelect: action => {
        if (action === 'open') post({ type: 'openIssue', number, newTab: false });
        else {
          beginWrite(d => { d.subIssues = d.subIssues.filter(s => s.id !== id); });
          post({ type: 'removeSubIssue', id });
        }
      },
    });
  }

  // ---- events -------------------------------------------------------------------------------------------------

  function handleAction(act: string, el: HTMLElement, e: MouseEvent): void {
    const id = el.dataset.id ?? '';
    const newTab = e.ctrlKey || e.metaKey || e.button === 1;
    switch (act) {
      case 'edit-title':
        editingTitle = true;
        renderHeader();
        $<HTMLInputElement>('title-input').focus();
        break;
      case 'save-title': {
        const title = $<HTMLInputElement>('title-input').value.trim();
        editingTitle = false;
        if (title && detail && title !== detail.issue.title) {
          beginWrite(d => { d.issue.title = title; });
          post({ type: 'setTitle', title });
        } else renderHeader();
        break;
      }
      case 'cancel-title': editingTitle = false; renderHeader(); break;
      case 'header-menu': headerMenu(el); break;
      case 'react': {
        const content = el.dataset.content!;
        const has = findPost(id)?.reactions.some(r => r.content === content && r.viewerHasReacted) ?? false;
        post({ type: 'toggleReaction', subjectId: id, content, add: !has });
        break;
      }
      case 'react-picker': reactionPicker(el, id); break;
      case 'post-menu': postMenu(el, id); break;
      case 'save-edit': {
        const body = (el.closest('.post')?.querySelector('.post-edit-input') as HTMLTextAreaElement).value;
        const isBody = detail?.post.id === id;
        if (isBody) beginWrite(() => undefined);
        (el as HTMLButtonElement).disabled = true;
        el.textContent = 'Saving…';
        post({ type: 'editPost', kind: isBody ? 'body' : 'comment', id, body });
        break;
      }
      case 'cancel-edit': editingId = null; renderTimeline(); break;
      case 'open-issue': post({ type: 'openIssue', number: Number(el.dataset.number), newTab }); break;
      case 'add-sub': requestCandidates(el); break;
      case 'sub-menu': subMenu(el, id, Number(el.dataset.number)); break;
      case 'load-more':
        (el as HTMLButtonElement).disabled = true;
        post({ type: 'loadMoreTimeline' });
        break;
      case 'pick-assignees': pickAssignees(el); break;
      case 'pick-labels': pickLabels(el); break;
      case 'pick-type': pickType(el); break;
      case 'pick-milestone': pickMilestone(el); break;
      case 'assign-me':
        if (viewer) {
          const me = (metadata?.assignees ?? []).find(a => a.login === viewer) ?? { login: viewer, avatar_url: '' };
          beginWrite(d => { d.issue.assignees = [me]; });
          post({ type: 'setAssignees', logins: [viewer] });
        }
        break;
      case 'branch': post({ type: 'createBranch' }); break;
      case 'worktree': post({ type: 'createWorktree' }); break;
      case 'comment': submitComment(); break;
      case 'close-main': submitComment(closeTarget()); break;
      case 'close-menu':
        openPicker({
          anchor: el, title: 'Close issue', filterable: false,
          items: [{ value: 'completed', label: 'Close as completed' }, { value: 'not_planned', label: 'Close as not planned' }],
          onSelect: v => submitComment(v as StateTarget),
        });
        break;
      case 'retry': post({ type: 'refresh' }); break;
    }
  }

  /** Links inside GitHub-rendered markdown: this repo's issues open in a tab, anything else leaves for the browser. */
  function handleLink(a: HTMLAnchorElement, e: MouseEvent): void {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) return; // footnote jumps stay in the page
    e.preventDefault();
    const number = issueNumberFromLink(href, repoName);
    if (number !== null) post({ type: 'openIssue', number, newTab: e.ctrlKey || e.metaKey || e.button === 1 });
    else post({ type: 'openExternal', url: href });
  }

  function onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const actEl = target.closest<HTMLElement>('[data-act]');
    if (actEl) {
      handleAction(actEl.dataset.act!, actEl, e);
      return;
    }
    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (link && link.closest('.post-body, .tl-text, .sb-pr')) {
      handleLink(link, e);
      return;
    }
    const placeholder = target.closest<HTMLElement>('.img-placeholder');
    if (placeholder && !placeholder.closest('a')) post({ type: 'openExternal', url: placeholder.dataset.src ?? '' });
  }

  root.addEventListener('click', onClick);
  root.addEventListener('auxclick', e => {
    const target = e.target as HTMLElement;
    if (e.button === 1 && (target.closest('a[href]') || target.closest('[data-act="open-issue"]'))) onClick(e);
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'detail': {
        if (!detail || detail.issue.number !== msg.detail.issue.number) {
          // A different issue (this tab was reused, or the create form just became an issue): nothing in flight applies.
          pending = 0;
          rollback = null;
        } else if (msg.afterWrite) {
          pending = Math.max(0, pending - 1);
        }
        if (pending > 0) break; // newer local edits are still in flight; the last answer is the one to show
        rollback = null;
        detail = msg.detail;
        viewer = msg.viewer;
        repoName = msg.repo;
        closedLocally = msg.closedLocally;
        hasMoreTimeline = msg.detail.hasMoreTimeline;
        if (!pageMounted) mountPage();
        if (composerFor !== msg.detail.issue.number) {
          composerFor = msg.detail.issue.number;
          editingId = null;
          editingTitle = false;
          mountComposer();
        }
        if (msg.afterWrite) { editingId = null; editingTitle = false; }
        renderAll();
        break;
      }
      case 'metadata':
        metadata = { labels: msg.labels, assignees: msg.assignees, milestones: msg.milestones, types: msg.types };
        renderSidebar();
        break;
      case 'timelinePage': {
        if (!detail) break;
        const have = new Set(detail.timeline.filter((i): i is { kind: 'comment' } & IssuePost => i.kind === 'comment').map(c => c.id));
        detail.timeline.push(...(msg.items as TimelineItem[]).filter(i => i.kind !== 'comment' || !have.has(i.id)));
        hasMoreTimeline = msg.hasMore;
        renderTimeline();
        break;
      }
      case 'commentAdded': {
        if (!detail) break;
        const item = msg.item as IssuePost;
        if (!findPost(item.id)) detail.timeline.push({ kind: 'comment', ...item });
        detail.issue.comments++;
        $<HTMLTextAreaElement>('comment-input').value = '';
        commentBusy = false;
        renderHeader();
        renderTimeline();
        updateComposer();
        $('timeline').lastElementChild?.scrollIntoView({ block: 'nearest' });
        break;
      }
      case 'postUpdated': {
        const item = msg.item as IssuePost;
        const at = detail ? detail.timeline.findIndex(i => i.kind === 'comment' && i.id === item.id) : -1;
        if (detail && at >= 0) detail.timeline[at] = { kind: 'comment', ...item };
        editingId = null;
        renderTimeline();
        break;
      }
      case 'postDeleted':
        if (detail) {
          detail.timeline = detail.timeline.filter(i => i.kind !== 'comment' || i.id !== msg.id);
          detail.issue.comments = Math.max(0, detail.issue.comments - 1);
          renderHeader();
          renderTimeline();
        }
        break;
      case 'reactions': {
        const target = findPost(msg.id);
        if (target) {
          target.reactions = msg.groups;
          renderTimeline();
        }
        break;
      }
      case 'candidates': candidatePicker(msg.items); break;
      case 'failed':
        toast(msg.message);
        if (msg.what === 'write' || msg.what === 'refresh') pending = Math.max(0, pending - 1);
        if (msg.what === 'write' && pending === 0 && rollback) {
          detail = rollback;
          rollback = null;
          editingId = null;
          renderAll();
        }
        if (msg.what === 'write' || msg.what === 'comment') { commentBusy = false; updateComposer(); }
        if (msg.what === 'edit' || msg.what === 'timeline') renderTimeline();
        break;
      case 'error':
        pageMounted = false;
        root.innerHTML = `<div id="empty">Failed to load issue: ${escapeHtml(msg.message)}
          <div><button type="button" class="btn btn-secondary" data-act="retry">Retry</button></div></div>`;
        break;
      case 'copied': toast('Copied'); break;
      case 'createInit':
        pageMounted = false;
        detail = null;
        pending = 0;
        rollback = null;
        renderCreateForm(root, msg, post);
        break;
      case 'createFailed': {
        const btn = document.getElementById('save-btn') as HTMLButtonElement | null;
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Create';
        }
        break;
      }
    }
  });

  post({ type: 'ready' });
})();
```

- [ ] **Step 4: Open in a new tab from the list**

In `src/webview/issues.ts`:

1. Replace the end of the row `click` handler

```ts
    select(number);
    vscode.postMessage({ type: 'open', number });
  });
```

with

```ts
    select(number);
    vscode.postMessage({ type: 'open', number, newTab: e.ctrlKey || e.metaKey });
  });
  // Middle-click opens a tab of its own. Without the mousedown guard Chromium starts autoscroll instead.
  rowsEl.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
  rowsEl.addEventListener('auxclick', e => {
    if (e.button !== 1) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('.issue-row');
    if (!row || (e.target as HTMLElement).closest('.row-menu-btn')) return;
    const number = Number(row.dataset.number);
    select(number);
    vscode.postMessage({ type: 'open', number, newTab: true });
  });
```

2. In the document `keydown` handler, replace

```ts
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.picker')) return;
    if ((e.target as HTMLElement).closest('input, textarea, select, button')) return;
    switch (e.key) {
```

with

```ts
    if (e.defaultPrevented || e.altKey) return;
    if (document.querySelector('.picker')) return;
    if ((e.target as HTMLElement).closest('input, textarea, select, button')) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'Enter' && selectedNumber !== null) vscode.postMessage({ type: 'open', number: selectedNumber, newTab: true });
      return;
    }
    switch (e.key) {
```

- [ ] **Step 5: Compile the webviews**

Run: `npx tsc -p tsconfig.webview-issue-detail.json && npx tsc -p tsconfig.webview-issues.json`
Expected: no errors.

---

### Task 6: Styles, remove `marked`, and commit the switch

**Files:**
- Replace: `lib/issueDetail.css`
- Delete: `lib/marked.js`
- Modify: `src/github/taskList.ts` (comment)

**Interfaces:**
- Consumes: Tasks 4 and 5.
- Produces: a working detail tab, committed together with the host and webview halves.

- [ ] **Step 1: Replace the stylesheet**

Replace the whole of `lib/issueDetail.css` with:

```css
/* Issue detail tab and New issue form. Shared tokens, state badge, labels and the picker popover live in issues.css. */

html,body { margin:0; padding:0; height:100%; background:var(--vscode-editor-background); color:var(--vscode-foreground);
            font:var(--vscode-font-size,13px)/1.5 var(--vscode-font-family); }
.muted { color:var(--vscode-descriptionForeground); }
#empty { padding:20px; color:var(--vscode-descriptionForeground); }

/* ---- page layout ---- */
#page, #create-form { max-width:1200px; margin:0 auto; padding:24px; }
#create-form { max-width:900px; }
#layout { display:grid; grid-template-columns:minmax(0,1fr) 260px; gap:24px; align-items:start; }
#main { min-width:0; }
@media (max-width:768px) {
  #layout { grid-template-columns:minmax(0,1fr); }
  #sidebar { order:-1; }
}

/* ---- header ---- */
.title-row { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.title { margin:0; font-size:1.7em; font-weight:400; line-height:1.25; word-break:break-word; }
.title .number { color:var(--vscode-descriptionForeground); }
.title-actions { display:flex; align-items:center; gap:6px; flex-shrink:0; }
.title-edit { display:flex; gap:8px; flex:1; }
.title-edit input {
  flex:1; min-width:0; padding:6px 8px; font:inherit; border-radius:4px;
  background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border,transparent);
}
.title-edit input:focus { outline:none; border-color:var(--vscode-focusBorder); }
.meta-row {
  display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:10px 0 16px; padding-bottom:16px;
  color:var(--vscode-descriptionForeground);
  border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.25));
}
.meta-row b { color:var(--vscode-foreground); font-weight:600; }
.closes-badge {
  font-size:.85em; font-weight:600; padding:2px 8px; border-radius:2em;
  background:var(--vscode-charts-yellow); color:var(--vscode-editor-background);
}
#sticky {
  position:sticky; top:0; z-index:5; display:flex; align-items:center; gap:8px; padding:8px 24px;
  background:var(--vscode-editor-background); border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.25));
}

/* ---- buttons ---- */
button { font:inherit; }
.btn-row { display:flex; align-items:center; gap:8px; margin:12px 0; flex-wrap:wrap; }
button.btn { border:none; padding:5px 14px; border-radius:4px; cursor:pointer; font-weight:500; transition:filter .15s,background .15s; }
button.btn-small { padding:2px 10px; font-size:.9em; }
button.btn-primary { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
button.btn-primary:hover { background:var(--vscode-button-hoverBackground); }
button.btn-secondary { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }
button.btn-secondary:hover { background:var(--vscode-button-secondaryHoverBackground); }
button.btn-ghost {
  background:transparent; color:var(--vscode-foreground);
  border:1px solid var(--vscode-input-border,var(--vscode-widget-border,rgba(128,128,128,.3)));
}
button.btn-ghost:hover { background:color-mix(in srgb, var(--vscode-foreground) 8%, transparent); }
button.btn:disabled { opacity:.5; cursor:default; }
.icon-btn {
  display:inline-flex; align-items:center; justify-content:center; padding:4px; border:none; border-radius:4px;
  background:transparent; color:var(--vscode-descriptionForeground); cursor:pointer;
}
.icon-btn:hover { background:color-mix(in srgb, var(--vscode-foreground) 10%, transparent); color:var(--vscode-foreground); }
.link-btn { padding:0; border:none; background:transparent; color:var(--vscode-textLink-foreground); cursor:pointer; text-align:left; }
.link-btn:hover { text-decoration:underline; }
.split { display:inline-flex; }
.split .btn:first-child { border-radius:4px 0 0 4px; }
.split-caret { border-radius:0 4px 4px 0 !important; border-left:0 !important; padding:5px 6px !important; }
button:focus-visible, .icon-btn:focus-visible { outline:1px solid var(--vscode-focusBorder); outline-offset:1px; }

/* ---- avatars ---- */
.avatar {
  position:relative; overflow:hidden; width:20px; height:20px; border-radius:50%; display:inline-flex;
  align-items:center; justify-content:center; font-size:.7em; font-weight:700; flex-shrink:0; vertical-align:middle;
  background:var(--vscode-badge-background); color:var(--vscode-badge-foreground);
}
.avatar::before { content:attr(data-initials); }
.avatar img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
.avatar-lg { width:40px; height:40px; font-size:.95em; }

/* ---- posts (issue body and comments) ---- */
.post { display:flex; gap:12px; margin:0 0 16px; }
.post-avatar { flex-shrink:0; }
.post-card { flex:1; min-width:0; border:1px solid var(--vscode-widget-border,rgba(128,128,128,.3)); border-radius:6px; overflow:hidden; }
.post-header {
  display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:6px 8px 6px 12px;
  background:color-mix(in srgb, var(--vscode-foreground) 6%, transparent); color:var(--vscode-descriptionForeground);
  border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.3));
}
.post-author { color:var(--vscode-foreground); }
.post-actions { margin-left:auto; display:flex; gap:2px; }
.role-badge {
  padding:0 7px; font-size:12px; line-height:18px; border:1px solid var(--vscode-widget-border,rgba(128,128,128,.4));
  border-radius:2em; color:var(--vscode-descriptionForeground);
}
.post-minimized { margin:0 0 16px; }
.post-minimized > summary { cursor:pointer; padding:6px 12px; color:var(--vscode-descriptionForeground); }
.post-minimized > .post { margin-top:8px; }
.post-body { padding:12px; line-height:1.5; word-wrap:break-word; overflow-x:auto; }
.post-body > *:first-child { margin-top:0; }
.post-body > *:last-child { margin-bottom:0; }
.post-body h1, .post-body h2 { border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.25)); padding-bottom:.3em; }
.post-body h1 { font-size:1.6em; } .post-body h2 { font-size:1.35em; } .post-body h3 { font-size:1.15em; } .post-body h4 { font-size:1em; }
.post-body pre {
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.08)); padding:10px; border-radius:4px; overflow-x:auto;
}
.post-body code {
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.08)); padding:1px 4px; border-radius:3px;
  font-family:var(--vscode-editor-font-family,monospace);
}
.post-body pre code { background:none; padding:0; }
.post-body blockquote {
  border-left:3px solid var(--vscode-widget-border,rgba(128,128,128,.4)); margin:0; padding:2px 12px; color:var(--vscode-descriptionForeground);
}
.post-body a, .tl-text a, .sb-pr a { color:var(--vscode-textLink-foreground); text-decoration:none; }
.post-body a:hover, .tl-text a:hover, .sb-pr a:hover { text-decoration:underline; }
.post-body table { border-collapse:collapse; display:block; overflow-x:auto; }
.post-body th, .post-body td { border:1px solid var(--vscode-widget-border,rgba(128,128,128,.3)); padding:4px 8px; }
.post-body .task-list-item { list-style:none; }
.post-body .task-list-item input[type=checkbox] { margin:0 .4em 0 -1.4em; vertical-align:middle; cursor:pointer; }
.post-body .task-list-item input[type=checkbox]:disabled { cursor:default; }
.post-body .markdown-alert { border-left:4px solid var(--vscode-textLink-foreground); padding:2px 12px; margin:8px 0; }
.post-body .markdown-alert-title { font-weight:600; margin:0; }
.img-placeholder {
  display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:4px; cursor:pointer;
  background:color-mix(in srgb, var(--vscode-foreground) 8%, transparent); color:var(--vscode-textLink-foreground);
}
.post-edit { padding:12px; }
.post-edit-input, #comment-input {
  width:100%; box-sizing:border-box; min-height:110px; resize:vertical; padding:8px; font:inherit; border-radius:4px;
  background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border,transparent);
}
.post-edit-input:focus, #comment-input:focus { outline:none; border-color:var(--vscode-focusBorder); }

/* ---- reactions ---- */
.reactions { display:flex; gap:6px; flex-wrap:wrap; padding:0 12px 12px; }
.reaction-chip {
  display:inline-flex; align-items:center; gap:4px; padding:1px 10px; border-radius:2em; cursor:pointer; color:var(--vscode-foreground);
  background:transparent; border:1px solid var(--vscode-widget-border,rgba(128,128,128,.4));
}
.reaction-chip:hover { background:color-mix(in srgb, var(--vscode-foreground) 8%, transparent); }
.reaction-chip.active {
  border-color:var(--vscode-textLink-foreground);
  background:color-mix(in srgb, var(--vscode-textLink-foreground) 15%, transparent);
}

/* ---- timeline events on the rail ---- */
.tl-event { position:relative; padding:8px 0 8px 52px; color:var(--vscode-descriptionForeground); }
.tl-event::before {
  content:''; position:absolute; left:19px; top:0; bottom:0; width:2px; background:var(--vscode-widget-border,rgba(128,128,128,.3));
}
.tl-badge {
  position:absolute; left:6px; top:50%; transform:translateY(-50%); z-index:1; box-sizing:border-box; width:28px; height:28px;
  display:flex; align-items:center; justify-content:center; border-radius:50%;
  background:var(--vscode-editor-background); border:2px solid var(--vscode-widget-border,rgba(128,128,128,.3));
}
.tl-badge.state-open { color:var(--gh-open); }
.tl-badge.state-completed { color:var(--gh-done); }
.tl-badge.state-not-planned { color:var(--gh-neutral); }
.tl-actor { color:var(--vscode-foreground); font-weight:600; }
.tl-text s { opacity:.7; }
.load-more { margin:8px 0 16px 52px; }

/* ---- sub-issues ---- */
.subissues { margin:0 0 16px 52px; border:1px solid var(--vscode-widget-border,rgba(128,128,128,.3)); border-radius:6px; }
.sub-head {
  display:flex; align-items:center; gap:8px; padding:6px 8px 6px 12px;
  background:color-mix(in srgb, var(--vscode-foreground) 6%, transparent); border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.3));
}
.sub-head .progress { width:80px; }
.sub-head .btn { margin-left:auto; }
.sub-row { display:flex; align-items:center; gap:8px; padding:6px 8px 6px 12px; }
.sub-row + .sub-row { border-top:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); }
.sub-title { padding:0; border:none; background:transparent; color:var(--vscode-foreground); font-weight:600; cursor:pointer; text-align:left; }
.sub-title:hover { color:var(--vscode-textLink-foreground); }
.sub-people { margin-left:auto; display:flex; gap:2px; }
.progress { height:6px; border-radius:3px; background:color-mix(in srgb, var(--vscode-foreground) 15%, transparent); overflow:hidden; }
.progress > span { display:block; height:100%; background:var(--gh-open); }

/* ---- sidebar ---- */
.sb-section { padding:12px 0; border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.25)); }
.sb-head { display:flex; align-items:center; justify-content:space-between; font-weight:600; color:var(--vscode-descriptionForeground); font-size:12px; min-height:24px; }
.sb-body { margin-top:4px; display:flex; flex-direction:column; gap:4px; align-items:flex-start; }
.sb-person { display:flex; align-items:center; gap:6px; }
.sb-avatars { display:flex; flex-wrap:wrap; gap:4px; }
.sb-pr a { display:flex; gap:6px; align-items:flex-start; }
.sb-dev-actions { display:flex; flex-direction:column; align-items:flex-start; gap:2px; }
.pr-open { color:var(--gh-open); } .pr-merged { color:var(--gh-done); }
.pr-closed { color:var(--vscode-charts-red); } .pr-draft { color:var(--gh-neutral); }
#sidebar .progress { width:100%; }
#sidebar .gh-label { margin-bottom:2px; }

/* ---- comment composer ---- */
#composer { margin:16px 0 0 52px; }
.composer-card { border:1px solid var(--vscode-widget-border,rgba(128,128,128,.3)); border-radius:6px; padding:12px; }
.composer-actions { display:flex; justify-content:flex-end; align-items:center; gap:8px; margin-top:8px; }
@media (max-width:768px) { #composer, .subissues, .load-more { margin-left:0; } }

/* ---- toast ---- */
#toast {
  position:fixed; bottom:16px; left:50%; transform:translateX(-50%); z-index:60; max-width:min(560px,90vw); padding:8px 14px;
  border-radius:6px; background:var(--vscode-notifications-background); color:var(--vscode-notifications-foreground);
  border:1px solid var(--vscode-widget-border,rgba(128,128,128,.4)); box-shadow:0 6px 18px rgba(0,0,0,.35);
}

/* ---- New issue form ---- */
.edit-form input, .edit-form textarea, .edit-form select {
  width:100%; box-sizing:border-box; background:var(--vscode-input-background); color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,transparent); border-radius:4px; padding:8px; font:inherit; margin-bottom:8px;
}
.edit-form input:focus, .edit-form textarea:focus { outline:none; border-color:var(--vscode-focusBorder); }
.edit-form textarea { min-height:160px; resize:vertical; }
.field-error { color:var(--vscode-errorForeground); font-size:.9em; margin:-4px 0 8px; }
.picker-group { margin-bottom:10px; }
.assignees-label { text-transform:uppercase; letter-spacing:.06em; color:var(--vscode-descriptionForeground); font-size:.8em; }
.dropdown-container { position:relative; }
.dropdown-trigger {
  width:100%; min-height:30px; padding:4px 28px 4px 8px; border:1px solid var(--vscode-input-border,transparent);
  background:var(--vscode-input-background); color:var(--vscode-input-foreground); border-radius:4px; cursor:pointer;
  display:flex; align-items:center; text-align:left; position:relative; box-sizing:border-box; transition:border-color .15s;
}
.dropdown-trigger:hover { border-color:var(--vscode-focusBorder); }
.dropdown-arrow { position:absolute; right:8px; top:50%; transform:translateY(-50%); font-size:.7em; color:var(--vscode-descriptionForeground); pointer-events:none; }
.dropdown-placeholder { color:var(--vscode-input-placeholderForeground); font-size:.9em; }
.selected-tags { display:flex; flex-wrap:wrap; gap:4px; }
.tag { display:inline-flex; align-items:center; gap:4px; padding:2px 6px; border-radius:999px; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); font-size:.82em; }
.tag-remove { cursor:pointer; font-size:1.1em; line-height:1; opacity:.7; }
.tag-remove:hover { opacity:1; }
.dropdown-list {
  position:absolute; top:100%; left:0; right:0; margin-top:2px; border:1px solid var(--vscode-input-border,transparent);
  background:var(--vscode-dropdown-background,var(--vscode-input-background)); border-radius:4px; max-height:180px;
  overflow-y:auto; z-index:10; box-shadow:0 4px 12px rgba(0,0,0,.3);
}
.dropdown-item {
  width:100%; padding:6px 10px; border:none; background:transparent; color:var(--vscode-foreground); cursor:pointer;
  display:flex; align-items:center; gap:6px; font-size:.9em; text-align:left;
}
.dropdown-item:hover { background:color-mix(in srgb, var(--vscode-foreground) 8%, transparent); }
.dropdown-item.selected { background:var(--vscode-list-activeSelectionBackground); color:var(--vscode-list-activeSelectionForeground); }
.dropdown-item .checkbox { flex-shrink:0; }
.dropdown-item .color-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
```

- [ ] **Step 2: Remove `marked`**

```bash
git rm lib/marked.js
grep -rn "marked" src lib/*.css
```

Expected: the only hits are the comment in `src/github/taskList.ts`, the words "marked as" in `detailHtml.ts` and `webviewDetail.test.ts`, and `marked` in `worktrees.test.ts`'s test title. Change the `taskList.ts` doc comment to say what is now true:

```ts
/**
 * Flips the nth GFM task-list checkbox (`- [ ]` / `- [x]`) in `body`, skipping
 * any inside fenced code blocks — mirrors the order GitHub renders task items
 * in `bodyHTML`, so `index` lines up with the webview's DOM order.
 */
```

- [ ] **Step 3: Compile and test everything**

Run: `npm run compile && npm test`
Expected: no errors; all tests pass (177).

- [ ] **Step 4: Commit the switch**

```bash
git add src tsconfig.json tsconfig.webview-issue-detail.json package.json lib/issueDetail.css lib/issueDetail.js lib/issues.js out
git status --short
```

`git status --short` must show only the Task 4–6 files (the staged `lib/marked.js` deletion included). Leave any unrelated modified `out/` file unstaged, then:

```bash
git commit -m "feat(null-tools): github.com-style Issues detail tab

Server-rendered markdown timeline with events, per-post edit and delete,
reactions, sub-issues, linked PRs, a metadata sidebar with optimistic
pickers, close reasons, a sticky header and one tab per issue (Ctrl or
middle-click opens another). The New issue form moves to its own tab.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verify against a real install

**Files:** none (verification only; fix-up commits if something fails), plus one docs line.

**Interfaces:**
- Consumes: everything above.
- Produces: a verified Phase 3.

- [ ] **Step 1: Sync to the local install**

Invoke the `verify-local` skill for `null-tools`. It syncs source into the local Null IDE install and runs the extension's integration specs. Reload the Null IDE window afterwards.
Expected: sync succeeds; specs (if any exist for null-tools) pass.

- [ ] **Step 2: Unit tests one more time**

Run: `npm test`
Expected: all pass (177).

- [ ] **Step 3: Scenarios** (in the `TorresVisual/null-ide` workspace; create throwaway issues on github.com as needed and close them afterwards)

1. **Read.** Click issue #106 in the list. Expected: a tab `#106 Bug: Creating Issues in the…` with the state badge, rendered body, a `bug` label event and four "referenced this in commit" events on the rail, and a sidebar with Assignees, Labels, Milestone, Development (Create a branch / worktree) and Participants. No *Type* section (this repo has no issue types) (Review Focus 3).
2. **Tabs.** Click another issue: the same tab changes. Ctrl+click a third: a new tab opens. Middle-click a fourth: another new tab. Click an issue that already has a tab: that tab is focused, no duplicate. `Ctrl+Enter` on the selected list row (full tab) opens a new tab.
3. **Sticky header.** Scroll an issue with a long body until the title leaves the screen: a slim bar with the state icon, title and `#n` pins to the top, and goes away when you scroll back.
4. **Links.** In a body, comment or `mentioned this in` event: a link to another issue of this repo opens in a tab (Ctrl+click: a new one); an external link and a pull-request link open the browser; a footnote `#` link scrolls in place.
5. **Title.** Edit → change → Save. The title changes at once; after a moment a `changed the title` event appears; github.com agrees. Empty title and unchanged title do nothing.
6. **Failure rolls back (Review Focus 1).** Turn the network off, open the Labels gear, tick a label, press Esc. Expected: the chip appears immediately, then a toast with the error and the chip disappears again. Same for a title change and for Close issue (badge flips to Closed, then back to Open). Turn the network back on.
7. **Rapid edits (Review Focus 1).** With the network on, change a label, then immediately open Assignees and change one, then close the issue as not planned, all within a few seconds. Expected: no flicker back to old values; the final state matches github.com.
8. **Pickers.** Assignees and Labels: filter box works, checks toggle, nothing is sent until the popover closes (one request); Milestone (create one on github.com first): pick, progress bar shows, pick *No milestone* to clear.
9. **Close reasons.** *Close issue* → purple badge + `closed this as completed`. Reopen it. Caret → *Close as not planned* → gray badge + `closed this as not planned`. With text typed, the button reads *Close with comment* (comment appears, then the state changes); on a closed issue it reads *Reopen issue* / *Reopen with comment*.
10. **Comments.** Type, press Comment (or Ctrl+Enter): the comment appears at the end without a reload, the header count goes up, the box clears. Double-click Comment: posted once.
11. **Edit and delete (Review Focus 5).** On your own comment: ⋯ → Edit shows the markdown source; type, then trigger a tab refresh (switch away 60+ seconds and back): your text is still there; Update comment re-renders. ⋯ → Delete asks first, then removes it. Another person's comment (or any comment on an issue you can't edit) has neither Edit nor Delete.
12. **Quote reply.** Select a sentence in a comment, ⋯ → Quote reply: the composer gets `> sentence`. With nothing selected it quotes the whole post.
13. **Reactions.** ☺ on a post → pick 👍: a highlighted `👍 1` chip appears (after a beat). Click the chip: it goes away. github.com agrees.
14. **Sub-issues.** On a throwaway parent: header ⋯ → *Add sub-issue…* → pick an issue: a *Sub-issues* block with `0 of 1` and a progress bar appears. Row ⋯ → *Remove sub-issue* removes it. Open the child: its header says `sub-issue of #parent`, and clicking that opens the parent. Close the child on github.com, refresh the parent: `1 of 1`.
15. **Development.** Open an issue that a merged pull request closed (or link one with `Fixes #n` in a throwaway PR): the PR is listed with the purple merged icon, and clicking it opens the browser.
16. **Long thread (Review Focus 6).** On a throwaway issue, post 105 comments (`for i in $(seq 105); do gh issue comment <n> -b "c$i"; done`). Open it: a *Load more* button follows the first page; click it: the rest appear in order. Post a new comment while a *Load more* is still showing: it appears once, and loading the remaining pages doesn't duplicate it.
17. **Not an issue (Review Focus 6).** In a throwaway issue comment, paste `https://github.com/TorresVisual/null-ide/issues/109` (a pull request) and click it. Expected: a tab with `Failed to load issue: …` and a *Retry* button, not a blank page.
18. **No write access (Review Focus 5).** Open a clone of a public repo you don't own (e.g. `octocat/Hello-World`) and open an issue. Expected: no gear icons, no title *Edit*, no Edit/Delete on others' comments, no *assign yourself*; commenting and reactions still work.
19. **New issue.** Command Palette → *Null: New GitHub Issue*: a `New Issue` tab (not the issue tab you had). Run the command again: the same tab is focused. Create with an empty title: inline error. Create `Phase 3 verification` (double-click Create: one issue). The tab becomes the new issue's detail tab and the list shows it on top.
20. **Refresh on focus.** Edit an issue's body on github.com, switch to another editor tab for 60+ seconds, come back: the tab shows the new text. Header ⋯ → *Refresh* does the same on demand.
21. **Images.** Open an issue whose body contains an image: a small `image` chip shows instead of a broken icon; clicking it opens the browser. Emoji (`:tada:`) render as characters.
22. **Narrow and themes.** Drag the tab narrower than ~768px: the sidebar moves above the timeline. Glance at Null Dark and one light theme: badges, label chips, rail icons, reactions, the picker popover and the toast are legible.
23. **Copy as prompt.** Header ⋯ → *Copy as prompt*: a *Copied* toast, and the clipboard holds `#n title …`.

Clean up: close `Phase 3 verification` and the other throwaway issues on github.com.

- [ ] **Step 4: Update the project docs**

In `CLAUDE.md`, in the `null-tools` table, replace the **GitHub Issues panel** row with:

```
| **GitHub Issues panel** | Own activity-bar view (`null-issues`) plus a full-width tab (`null.issues.openFullView`); GraphQL search with a github.com-style query box, Open/Closed counts, filter dropdowns, sort, presets, paging and keyboard navigation; github.com-style issue tab (server-rendered markdown timeline with events, reactions, sub-issues, linked PRs, a metadata sidebar with optimistic pickers, close reasons, one tab per issue); create/comment on issues, sign-in, mark-as-read, issue templates, link/insert issue references in commit messages |
```

Commit:

```bash
git add CLAUDE.md
git commit -m "docs: describe the GitHub Issues detail tab

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Record and report**

If any scenario fails, fix it in the owning task's files, re-run that task's tests, and commit as `fix(null-tools): …`. Then report the verification results (what passed, anything deferred, and the deviations listed at the top) to the user.

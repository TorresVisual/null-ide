# GitHub Issues Panel v2 (`null-tools`): Design

## Problem

The v1 panel ([github-issues-panel-design.md](github-issues-panel-design.md))
covers the basics: list, detail, comments, editing, and branch/worktree from an
issue. It still doesn't feel like github.com, so issue work keeps ending up in
the browser:

- **Looks:** red/green dots instead of GitHub's state icons, ISO dates, solid
  label chips, a single-column detail page with one global "Edit" mode.
- **Smoothness:** every filter keystroke round-trips to the extension host and
  rebuilds the whole list with `innerHTML`. Loading shows a bare "Loading…".
- **Capability gaps:** no search syntax, sort, counts, or paging (100-issue cap);
  no close reasons, reactions (#59), sub-issues, milestone (#56), linked PRs
  (#57), composer preview/toolbar/autocomplete, or image upload (#107).
- **Broken create flow (#106):** root causes are listed in [Create flow](#create-flow-106).

Goal: the user stops opening the browser for issue work. The list reacts
instantly to typing, and the detail tab reads like github.com in Null's theme
colors.

## Decisions

Made during brainstorming (2026-09-28):

| Question | Decision |
|---|---|
| Where browsing happens | **Sidebar + full tab.** The compact sidebar list stays; a new full-width editor tab shows the github.com-style list. Both use one renderer. |
| Scope | All four groups: rich composer, metadata sidebar, reactions + sub-issues, search syntax + paging. |
| Image upload | **Commit to the repo** (orphan branch), with images cached locally so Claude Code can Read them. |
| Data layer | **GraphQL for reads, existing REST writes kept**; new writes use whichever API is simpler for each. |

**Out of scope:** pull requests (#92, own spec), account manager (#102),
GitLab/GHES, YAML issue forms (`.yml` templates), `:emoji:` autocomplete, saved
replies, and lock/pin/transfer/delete/subscribe/"close as duplicate". Any of the
last group is a small addition later.

## Architecture

All code stays in `extensions/null-tools/`. No new dependencies.

### Extension host: `src/github/`

| File | Responsibility |
|---|---|
| `githubApi.ts` | Existing REST client plus `requestGraphql(query, variables, token)` (POST `/graphql`, errors if the response has an `errors[]` array). `requestJson` keeps the error body and throws `formatApiError(status, body)`, which includes GitHub's `message` and each `errors[].message`. New REST calls: `renderMarkdown(text, repo)` (`POST /markdown`, `mode: gfm`, `context: owner/repo`), `putContent` (Contents API), and `createOrphanBranch` (git data: blob → tree → commit without parents → ref). New GraphQL mutations: `addReaction`/`removeReaction`, `addSubIssue`/`removeSubIssue`, `updateIssueIssueType`. |
| `githubQueries.ts` *(new)* | GraphQL query strings (`SEARCH_ISSUES`, `ISSUE_DETAIL`, `REPO_METADATA`) and pure mappers from response to view model: `mapSearchPage`, `mapIssueDetail`, `collapseTimeline`. |
| `searchQuery.ts` *(new, pure)* | Qualifier editing on the user-visible query string: `toggleQualifier(q, key, value)`, `setQualifier(q, key, value)`, `removeQualifier(q, key)`, `getQualifierValues(q, key)`. Handles quoted values (`label:"good first issue"`) and negation (`-label:bug`). `toApiQuery(repo, q)` prepends `repo:owner/name is:issue`. |
| `issuesStore.ts` | Per-repo data owner. **`ensureSession()`** resolves repo + token when needed and is awaited by every read and write (the #106 root fix). `search(query, cursor)`, `getDetail(number, timelineCursor?)`, cached `getMetadata()` (labels, assignable users, milestones, issue types, viewer login), and all mutations. |
| `imageCache.ts` *(new)* | `resolveImage(url, { root, token })` downloads an image (the token goes only to github.com / api.github.com), writes it to `.null/issue-images/<sha1(url)>.<ext>` (via the existing `getNullDir()`), and returns the file path. On first write it calls `ensureExcluded(repoRoot)`. Pure helpers: `cacheFileName(url, ext)`, `withExcludeLine(existing, line)`. |
| `imageUpload.ts` *(new)* | `uploadImage(repo, token, { name, mime, bytes })` creates `null-issue-assets` as an orphan branch on first use, then PUTs `yyyy/mm/<uuid>.<ext>` via the Contents API and returns the markdown link. |
| `promptFormat.ts` | `formatIssueAsPrompt(issue, comments, imagePaths)` returns title, body, comments as plain text, the URL, and an `Images:` list of absolute local paths. |
| `gitBranch.ts` | Adds pure `issueNumberFromBranch(name)` for the existing `issue-<n>-<slug>` scheme (#54). |
| `issueFilter.ts` | Delete `filterIssues` and its tests (replaced by server search). Keep `relevantToViewer` and `newestUpdateTime` for the unread badge. |

### Extension host: panels

- **`issuesPanel.ts` → `IssuesListController`**: owns one query string, the
  loaded pages, and a paging cursor, and attaches to any `vscode.Webview`. The
  sidebar `WebviewView` (`null.issuesView`) and the new full tab
  (`null.issues.openFullView`, a singleton `WebviewPanel` titled
  `Issues · owner/repo`) each get their own instance. The unread badge,
  cache-first paint, and row actions (branch, worktree, copy as prompt, browser)
  carry over.
- **`issueDetailPanel.ts`**: panels are tracked by issue number. A plain click
  reuses the shared "current" tab; Ctrl/middle-click opens a new tab. The create
  form is always its own tab (`New issue`), never the shared one.
- **`issuesPanelIntegration.ts`**: registers the new command, and the #54
  listener: the built-in git extension's `repository.state.onDidChange`. When
  HEAD moves to a branch where `issueNumberFromBranch` returns `n`, it shows
  *"Branch refers to #n: <title>" [Open] [Not now]*, at most once per branch per
  session.

### Webview: `src/webview/`

The bundling model is unchanged: `module: none` + `outFile`, with shared files
concatenated via each tsconfig's `include`, the same way `colorUtils.ts` is today.

- `shared/dom.ts`: `escapeHtml`, `h()` element helper, keyed-list reconcile
  (`reconcile(container, items, key, render)`: updates or moves or inserts rows
  by key instead of rebuilding).
- `shared/octicons.ts`: inline SVG for the ~25 Primer octicons used (MIT):
  issue-opened, issue-closed, skip, git-pull-request, comment, smiley, kebab,
  gear, check, x, milestone, tag, person, link, quote, pencil, trash, copy,
  image, bold, italic, code, list-unordered, list-ordered, tasklist,
  link-external, sync.
- `shared/time.ts`: `relativeTime(iso)`, with the exact timestamp in a `title`.
- `shared/labels.ts`: GitHub's label formulas. In dark mode: tinted background
  `rgba(r,g,b,.18)`, text lightened in HSL, `rgba` border. In light mode: solid
  background, black/white text by perceived lightness. The mode comes from
  `body.vscode-dark` / `vscode-light`. Replaces `colorUtils.ts`.
- `shared/picker.ts`: popover picker with filter box, checkmarks, color
  dots/avatars/descriptions, single- or multi-select, keyboard navigable.
- `shared/composer.ts`: composer component (see [Composer](#composer)).
- `issues.ts`: list view (sidebar and full tab).
- `issueDetail.ts` + `issueCreate.ts`: one bundle (`lib/issueDetail.js`).
- **`lib/issues.css`**: one stylesheet for all three views. It replaces the
  inline `<style>` blocks, is loaded through `<link>` (the existing `style-src
  ${cspSource}` allows it), and maps Primer-like tokens onto `--vscode-*`
  colors.
- `marked.js` is removed if nothing else loads it. DOMPurify stays as defense in
  depth over `bodyHTML`.

## Issue list

**The query string is the single source of truth.** The search box shows it
(default `is:open`; the `repo:`/`is:issue` prefix is implicit and hidden). Every
control edits it:

- **Open N / Closed N** tabs → `setQualifier(q, 'state', …)`. Both counts come
  from one GraphQL request (two aliased `search` fields with `issueCount`).
- **Author / Labels / Assignee / Milestone / Type** dropdowns → `toggleQualifier`.
  Values come from cached repo metadata.
- **Sort** dropdown → `sort:created-desc`, `sort:created-asc`,
  `sort:updated-desc`, `sort:comments-desc`.
- **Presets** (a menu on the search box): *Open issues* (`is:open`),
  *Assigned to me* (`is:open assignee:@me`), *Created by me* (`is:open author:@me`),
  *Mentioning me* (`is:open mentions:@me`), *Recently updated*
  (`is:open sort:updated-desc`).

Dropdown clicks send `editQuery` to the host, which applies the pure
`searchQuery.ts` edit and runs the search. That's one round-trip, on clicks only.

**Rows.** Wide layout (container ≥ 480px, via CSS container query):
state octicon · **title** · labels · right column (linked-PR icon + count,
assignee avatar stack, comment icon + count). Second line:
`#106 · author opened 3 days ago` (closed: `· closed 2 days ago`) · milestone ·
sub-issue progress `▰▰▱ 2 of 3` · issue type.
Compact layout (sidebar): the right-column items move into the second line as
small icons. Row actions collapse into a `⋯` menu, shown on hover in the wide
layout.

- State icons: open (green), closed/completed (purple), closed/not planned (gray),
  from `stateReason`.
- A blue dot marks rows updated since the per-repo `lastSeen` watermark.
- The "closes on push" badge stays (`getLocallyClosedIssueNumbers`).

**Smoothness rules:**

1. **Cache-first paint.** The first page of each default query is stored in
   `globalState` (as today) and painted before the network call resolves.
2. **Instant local filter.** On each keystroke the webview hides/shows the
   *already rendered* rows by case-insensitive substring match on title and
   `#number`, ignoring qualifier tokens. There's no host round-trip and no
   re-render.
3. **Debounced server search.** Enter or a 400ms pause sends `query`. Results
   are applied with `reconcile()` keyed by issue number, so unchanged rows keep
   their DOM nodes (no flicker, no lost hover or focus).
4. **Paging.** An `IntersectionObserver` on the last row sends `loadMore` (50 per
   page, cursor-based, up to GitHub's 1000-result search cap).
5. **Loading.** A 2px indeterminate progress bar at the top while a request is
   in flight. Skeleton rows only on a cold start with no cache.
6. **Empty state.** "No results matched your search." plus a *Clear filters*
   link (resets to `is:open`).

**Keyboard** (github.com's shortcuts): `/` focuses search, `j`/`k` and ↑/↓ move
the selection, `Enter` opens, `Ctrl+Enter` opens in a new tab, `c` creates an
issue.

**Toolbar:** New issue, Refresh, Mark as read, and in the sidebar only, *Open
full view* (`⤢`).

## Issue detail

**Layout.** A main column plus a ~260px right sidebar. Below 768px the sidebar
moves under the header. A sticky header (state badge, title, `#n`) appears once
the title scrolls out of view.

**Header.** Title + `#n`, an inline *Edit* for the title only (input +
Save/Cancel), the state badge (Open / Closed with the matching octicon and
color), `author opened this <time> · N comments`, and a `⋯` menu (Copy as
prompt, Open on github.com, Refresh). If the tab's data is more than 60s old,
it refreshes when the tab regains focus.

**Timeline** (from one `ISSUE_DETAIL` GraphQL request):

- **Body as the first post.** Every post (body or comment) has a 40px avatar,
  an author-role badge (`authorAssociation`: Owner/Member/Collaborator/
  Contributor), relative time, "edited" marker if `lastEditedAt`, a `⋯` menu
  (Copy link, Quote reply, Edit, Delete), rendered `bodyHTML`, and a reactions
  row. Edit/Delete only appear when `viewerCanUpdate`/`viewerCanDelete` are
  true. Edit swaps the post body for an inline composer. **The v1 global edit
  mode is removed.**
- **Events** on a vertical rail with octicons. Handled `timelineItems` types:
  `LabeledEvent`/`UnlabeledEvent` (consecutive ones by the same actor within 60s
  collapse into "added bug and ui"), `ClosedEvent` (with `stateReason` and the
  closing commit or PR), `ReopenedEvent`, `RenamedTitleEvent` (old title struck
  through), `AssignedEvent`/`UnassignedEvent`, `MilestonedEvent`/
  `DemilestonedEvent`, `CrossReferencedEvent`, `ConnectedEvent`,
  `SubIssueAddedEvent`/`SubIssueRemovedEvent`. Unknown types are skipped.
- **Minimized comments** (`isMinimized`) render collapsed: "This comment was
  marked as <reason>. Show".
- **Long threads.** The first 100 timeline items load. If more exist, a "N hidden
  items · Load more" gap pages by cursor.
- **Links in `bodyHTML`** are intercepted: `github.com/<this repo>/issues/<n>`
  opens in the detail tab, everything else goes to `openExternal`.
- **Task checkboxes** stay toggleable via the existing `toggleTaskCheckbox`
  (index-based; GitHub renders task items in source order).
- **Reactions.** Chips (`👍 2`) from `reactionGroups`. The chip is highlighted
  when `viewerHasReacted`, and clicking it toggles via `addReaction`/
  `removeReaction`. `☺+` opens GitHub's eight: 👍 👎 😄 🎉 😕 ❤️ 🚀 👀.
- **Sub-issues.** A block under the body: progress bar from `subIssuesSummary`,
  rows (state icon, title, assignee avatars) that open the sub-issue. *Add ▾*
  offers *Add existing issue* (picker over search results) or *Create
  sub-issue* (opens the create form with Parent preset). Row `⋯` → *Remove*.

**Sidebar.** Each section header has a ⚙ that opens a `picker.ts` popover.
Changes apply **immediately and optimistically**. On failure the section reverts
and a toast shows GitHub's error message (never a silent revert).

| Section | Content | Write |
|---|---|---|
| Assignees | avatars + logins; "No one · assign yourself" when empty | REST `PATCH issue {assignees}` |
| Labels | labels in GitHub style | REST `PATCH issue {labels}` |
| Type | shown only if the repo has issue types | GraphQL `updateIssueIssueType` |
| Milestone | title + progress bar | REST `PATCH issue {milestone}` |
| Development | linked PRs (`closedByPullRequestsReferences` + cross-referenced PRs) with state icons; **Create branch** / **Create worktree** (existing `createIssueBranch` / `null.worktrees.createForIssue`) | none |
| Participants | avatar list | none |

## Composer

One component (`shared/composer.ts`) is used for new comments, editing a comment
or the body, and the create form.

- **Write / Preview** tabs. Preview calls `renderMarkdown` (GitHub's
  `POST /markdown` with repo context) so it matches the final rendering. The
  result is cached until the text changes.
- **Toolbar:** heading, bold, italic, quote, code, link, bulleted list, numbered
  list, task list, attach image. Shortcuts: Ctrl+B, Ctrl+I, Ctrl+K (link),
  Ctrl+E (code). Each wraps the selection or inserts at the cursor.
- **Autocomplete** in a caret-anchored popover: `@` → assignable users ∪
  participants; `#` → loaded issues matching the typed prefix/number, then a
  debounced `search` fallback. Tab/Enter accepts, Esc dismisses.
- **Keys:** Ctrl+Enter submits; Esc cancels an edit (asks first if the text
  changed).
- **Drafts** are stored on the extension side in `workspaceState` under
  `null.issues.draft:<owner>/<repo>#<n|new>`, saved on a 500ms debounce and
  cleared on submit. They survive switching issues and closing the tab.
- **Buttons** (new-comment composer only): `[Close issue ▾]` (split: *Close as
  completed* / *Close as not planned*, REST `PATCH {state, state_reason}`) and
  `[Comment]`. When the text is non-empty the split button reads *Close with
  comment* (comment first, then close). When the issue is closed it reads
  *Reopen issue* / *Reopen with comment*.
- **Posting.** The submit button is disabled while the request is in flight.
  On success the returned comment is appended to the timeline, with no full
  reload. On failure the text stays and a toast appears.
- **Quote reply** inserts `> ` + the selected text (or the whole post's
  markdown) into the new-comment composer and focuses it.

## Create flow (#106)

**Root causes in v1:**

1. `IssuesStore.hydrateFromCache()` sets `repo` but not `token`. Creating while
   the list shows cached data, or after a failed refresh, POSTs without auth.
2. `null.issues.create` from the Command Palette before the sidebar has loaded:
   `store.repo === null`, so `createIssue()` returns `null` and `submitCreate`
   `break`s silently. The label/assignee pickers are empty too.
3. There's no in-flight guard on Create, so a double-click creates duplicates.
4. An empty title is ignored silently, and `requestJson` discards GitHub's error
   body, so a 422 reads as `GitHub API 422: /repos/…`.
5. Create reuses the shared detail tab, replacing the issue the user had open.

**Fixes:** `ensureSession()` in the store (1, 2, and every other write path),
`formatApiError` (4), a disabled submit while in flight (3), an inline "Title is
required" (4), and a dedicated create tab (5).

**Form** (github.com's new-issue page):

1. If `.github/ISSUE_TEMPLATE/*.md` exist, a template chooser first: cards with
   each template's `name` + `about`, plus *Blank issue*. `parseIssueTemplate`
   gains `about`.
2. Title input, then the composer (Write/Preview, toolbar, autocomplete, image
   paste), and a right sidebar with Assignees, Labels, Type, Milestone, Parent
   (same pickers, in pre-submit mode).
3. `[Create]` plus a **Create more** checkbox. When checked, the form resets
   (keeping the template, labels, and milestone) instead of opening the new
   issue. Ctrl+Enter submits.
4. On success: the list controllers insert the new issue (`reconcile`), and the
   Parent (if set) is linked via `addSubIssue`.

## Images (#107)

**Upload.**
1. Paste, drop, or the toolbar's 📎 inserts `![Uploading <name>…]()` at the
   cursor and sends the bytes (base64) to the host.
2. The host rejects files over 10 MB or types other than
   png/jpg/gif/webp/svg with a toast. Otherwise it calls `uploadImage`.
3. On first use, `null-issue-assets` is created as an **orphan branch** (no
   parent commit, so it carries no copy of the repo): blob → tree → commit →
   `refs/heads/null-issue-assets`. The initial commit contains a `README.md`
   explaining the branch.
4. The file goes to `yyyy/mm/<uuid>.<ext>` via Contents PUT on that branch. The
   placeholder is replaced with
   `![<name>](https://github.com/<owner>/<repo>/blob/null-issue-assets/<path>?raw=true)`.
5. On failure (e.g. no push access, 403/404) the placeholder is removed and the
   toast offers *Attach on github.com* (opens the issue in the browser).

**Display: one path for every image.**
1. Posts render immediately. Each `<img>` in `bodyHTML` gets a sized
   placeholder and its original URL in `data-src`, and the webview sends
   `resolveImages{urls}`.
2. The host calls `imageCache.resolveImage(url)` for each one. Only `github.com` and `api.github.com` get the token, and only on the first request (a redirect never carries it);
   repo `blob/…?raw=true` links go through the Contents API (`raw` media type).
   Private-user-image signed URLs are fetched as-is (they are valid for a few
   minutes after the detail request).
3. The host replies `imageResolved{url, src}` with `asWebviewUri(localPath)`.
   The webview CSP stays `img-src ${cspSource} https://avatars.githubusercontent.com`, and the detail webview's `localResourceRoots` gains `.null/issue-images/` (files outside `lib/` are not served otherwise).
4. On first write, `**/.null/issue-images/` is appended to the repository's `info/exclude` (found with `git rev-parse --git-path`, so linked worktrees work; idempotent; no `.gitignore` edit).

**Known limit:** the image cache is never cleaned up (mark it with a `ponytail:`
comment in `imageCache.ts`). Add an age-based sweep if `.null/issue-images`
grows noticeably.

**Claude can see them.** *Copy as prompt* (row action, detail `⋯`) resolves
every image in the body and comments first, then copies:

```
#106 Bug: Creating issues is bugged

<body as plain text>

--- Comments ---
@user (2026-09-25): <comment text>

Images (local files; open with the Read tool):
- D:\Coding\Apps\null-ide\.null\issue-images\3f9a….png

https://github.com/TorresVisual/null-ide/issues/106
```

## Message protocol

IDs: `subjectId` is a GraphQL node ID (used only for reactions and
sub-issues). Comment `id`/`commentId` is the REST `databaseId` (fetched alongside
it), so post edits and deletes keep using the existing REST `updateComment` /
`deleteComment` / `updateIssue` calls.

**List (`issues.ts` ⇄ `IssuesListController`)**

| Direction | Message |
|---|---|
| → host | `ready`, `query{text}`, `editQuery{op:'toggle'\|'set'\|'remove', key, value?}`, `loadMore`, `open{number, newTab}`, `rowAction{action:'branch'\|'worktree'\|'copyPrompt'\|'browser', number}`, `create`, `signIn`, `refresh`, `markRead`, `openFullView` |
| → webview | `init{query, compact}`, `results{query, items, totalCount, openCount, closedCount, hasMore, append}`, `metadata{labels, assignees, milestones, types, viewerLogin}`, `loading{on}`, `status{kind:'no-workspace'\|'no-remote'\|'signed-out'\|'offline'\|'rate-limited'\|'error', message?, retryAt?}`, `rowActionDone{action, number}` |

**Detail/create (`issueDetail.ts`/`issueCreate.ts` ⇄ `IssueDetailPanel`)**

| Direction | Message |
|---|---|
| → host | `ready`, `refresh`, `loadMoreTimeline`, `setTitle{title}`, `setState{state, reason?, comment?}`, `setAssignees{logins}`, `setLabels{names}`, `setMilestone{number\|null}`, `setType{id\|null}`, `toggleReaction{subjectId, content}`, `addSubIssue{number}`, `removeSubIssue{number}`, `postComment{body}`, `editPost{kind:'body'\|'comment', id, body}`, `deletePost{commentId}`, `toggleTask{index, checked}`, `preview{requestId, text}`, `suggest{requestId, trigger:'@'\|'#', prefix}`, `uploadImage{requestId, name, dataBase64}`, `resolveImages{urls}`, `saveDraft{body}`, `openIssue{number, newTab}`, `openExternal{url}`, `copyAsPrompt`, `createBranch`, `createWorktree`, `submitCreate{title, body, labels, assignees, milestone, typeId, parent, createMore}` |
| → webview | `detail{issue, timeline, hasMoreTimeline, metadata, viewer, draft}`, `createInit{templates, metadata, parent?, draft}`, `timelinePage{items, hasMore}`, `patched{issue}`, `reverted{field, message}`, `commentAdded{item}`, `previewResult{requestId, html}`, `suggestions{requestId, items}`, `uploadResult{requestId, markdown?, error?}`, `imageResolved{url, src}`, `copied`, `created{number}`, `error{message}` |

## Error handling

- **Read failures with a cache:** keep the cached results and show an inline
  banner "Offline · showing cached results · Retry". Without a cache: the full
  status message.
- **Rate limits:** on 403/429 with `x-ratelimit-remaining: 0` or `retry-after`,
  show `status{kind:'rate-limited', retryAt}` ("Rate limited · retrying in 42s")
  and retry once at `retryAt`.
- **401:** show the Sign-in state (session expired or revoked).
- **GraphQL `errors[]`:** treated as a failure with the first message shown. A
  response with partial `data` is not rendered.
- **Mutations:** optimistic update, then `reverted{field, message}` + toast
  with the `formatApiError` text.
- **Uploads:** placeholder removed + toast with an *Attach on github.com*
  action.

## Testing

`node --test` (the existing convention: only files that don't import `vscode`):

- `searchQuery.test.ts`: toggling/setting/removing qualifiers, quoted values,
  negation, idempotence, `toApiQuery` prefixing.
- `githubQueries.test.ts`: `mapSearchPage`, `mapIssueDetail`,
  `collapseTimeline` against captured JSON fixtures in `src/github/fixtures/`.
- `githubApi.test.ts`: `formatApiError` (REST `message` + `errors[]`, GraphQL
  `errors[]`, empty body).
- `promptFormat.test.ts`: comments + image paths.
- `imageCache.test.ts`: `cacheFileName`, `withExcludeLine` (append, no
  duplicate, trailing newline).
- `gitBranch.test.ts`: `issueNumberFromBranch`.
- `issueTemplates.test.ts`: `about` field.
- Remove the `filterIssues` cases from `issueFilter.test.ts`.

Manual, against a real install via the `verify-local` skill, per phase:

- create from the Command Palette on a cold start;
- double-click Create;
- create while offline with a cached list (shows an error, never silent);
- sidebar ↔ full tab, compact ↔ wide at the breakpoint;
- typing in search doesn't flicker; paging past 50;
- the j/k/Enter/`/`/`c` keys;
- sidebar pickers apply and revert on a forced failure;
- reactions toggle;
- sub-issue add/remove;
- paste an image into a comment on a private repo → shows in the panel → shows
  on github.com → *Copy as prompt* → Claude Code reads the image path;
- checking out `issue-106-…` offers to open #106.

## Delivery phases

Each phase ships on its own and gets its own plan in `docs/plans/`.

1. **Foundation:** `requestGraphql`, `formatApiError`, `ensureSession` (fixes
   #106 causes 1, 2, 4 on their own), the `shared/` webview modules, `lib/issues.css`,
   GitHub label styles.
2. **List:** `searchQuery.ts`, `SEARCH_ISSUES` + mapper, counts, paging, instant
   filter + `reconcile`, compact/wide layouts, full tab, keyboard, presets,
   removal of `filterIssues`.
3. **Detail:** `ISSUE_DETAIL` + mappers, layout + sticky header, `bodyHTML`
   timeline + events, link interception, sidebar pickers, close reasons,
   reactions (#59), sub-issues, linked PRs (#57), milestone (#56). First step:
   confirm the `subIssuesSummary`, `closedByPullRequestsReferences` and
   `issueType` field names against the live schema (introspection) before
   writing the query.
4. **Composer + create flow:** `composer.ts`, preview, toolbar, autocomplete,
   drafts, dedicated create tab, templates chooser, Create more (finishes #106).
5. **Images (#107):** `imageUpload.ts`, `imageCache.ts`, exclude entry, prompt
   paths.
6. **Branch → issue (#54):** `issueNumberFromBranch` + the HEAD listener.

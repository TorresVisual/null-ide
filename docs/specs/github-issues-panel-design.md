# GitHub Issues Panel (`null-tools`) — Design

## Problem

Working on this repo (or filing/triaging issues against it) currently means
tabbing out to github.com for anything issue-related: browsing the backlog,
reading a report, leaving a comment, or re-labeling something. `null-tools`
already owns the editor's git/GitHub-adjacent tooling —
`null.generateCommitMessage` (`extensions/null-tools/src/commitMessage.ts`)
shells out to `gh`-aware git diffs, and `updater.ts` already talks to the
GitHub REST API for release checks. Issue browsing is the next "stay in the
editor" surface this extension builds toward, similar in spirit to
[VS-Code-Git-Issues](https://github.com/tabsl/VS-Code-Git-Issues).

Source: GitHub issue
[TorresVisual/null-ide#43](https://github.com/TorresVisual/null-ide/issues/43).

## Background

Repo precedent this design reuses rather than reinvents:

- **Webview-view pattern**: `agentsPanel.ts` / `agentsPanelIntegration.ts`
  already implement a secondary-sidebar `WebviewViewProvider` with an
  extension-host state owner and a thin vanilla-TS renderer compiled
  separately (`webview/agents.ts` → `lib/agents.js` via `tsconfig.webview.json`,
  `module: "none"` + `outFile`). The issues panel is a second view in the
  same pattern, added to the same `null-agents` secondary-sidebar container.
- **GitHub REST API access**: `updater.ts` already fetches
  `https://api.github.com/repos/{repo}/releases/latest` using the built-in
  `https` module with `Accept: application/vnd.github+json` /
  `X-GitHub-Api-Version` headers and an optional bearer token — no Octokit
  dependency. The issues panel's API client follows the same shape, just
  with more endpoints and a real user token (see Auth below) instead of an
  optional `GITHUB_TOKEN` env var.
- **Test convention**: this codebase only unit-tests files that don't
  `import 'vscode'` (e.g. `autoGitignoreStorage.ts` is tested,
  `autoGitignore.ts` which wires it into VS Code is not — same split as
  `versionComparison.ts`/`.test.ts` vs. `updater.ts`). Anything that touches
  `vscode.authentication`, network I/O, or webview DOM is verified by hand
  against a real local install (`scripts/sync-local.ps1` / the
  `verify-local` skill), not by `node --test`.

## Scope

**In scope (full v1, per the source issue):**

- A secondary-sidebar webview view listing issues for the current repo,
  resolved via `git remote` — same lookup style `null.generateCommitMessage`
  already uses for git.
- Filters: state (open/closed/all), labels, assignee (me/everyone).
- Full-text search across loaded issues.
- Viewing an issue's body + comments; adding a new comment without leaving
  the editor.
- Editing title, labels, and assignees via the GitHub REST API.
- Auth via VS Code's built-in `github` authentication provider
  (`vscode.authentication.getSession('github', ...)`) — no separate PAT flow.
- Branch/commit integration: creating/checking out a branch named after an
  issue; `#123` references in the SCM commit-message input link back to the
  issue.
- A "copy as prompt" action — copies title/body/link to the clipboard for
  pasting into whatever AI surface is open (the official Claude Code
  extension's sidebar/tab, not necessarily `null-tools`' own AI Agents
  panel). Deliberately a generic clipboard action, not a hardcoded
  "paste into the Agents panel" integration.

**Out of scope (for any plan under this spec):**

- GitLab / self-hosted Git hosting — GitHub.com only, no current use case in
  this repo.
- Milestones, emoji reactions, markdown-preview toggling in the comment view.
- Rendering issue/comment bodies as rendered Markdown — plain pre-wrapped
  text only. (`null-markdown`'s preview machinery is a separate webview
  context; wiring it into this panel is a possible future enhancement, not
  part of this design.)
- Pagination beyond the first 100 issues per state — flagged as a known
  ceiling below, not designed away.

## Deviations from source issue

One point where this design doesn't literally match
[#43](https://github.com/TorresVisual/null-ide/issues/43)'s wording:

- **`#123` SCM-input linking ships as the lighter fallback, not literal
  in-document linking.** #43 asks for `#123` references to link back to the
  issue directly inside the SCM commit-message box. Checked: VS Code's
  `SourceControlInputBox` exposes only a plain `.value` string to third-party
  extensions — there is no public document/URI to register a
  `DocumentLinkProvider` against (the built-in "GitHub Pull Requests and
  Issues" extension does this via a proposed API this extension doesn't have
  access to). Shipped instead: `null.issues.linkFromCommitMessage`, a
  scm/title button that reads the current commit message, regex-matches
  `#(\d+)`, and opens the referenced issue (prompting with a quick-pick if
  there's more than one) — see `issuesPanelIntegration.ts`.

## Architecture

All new code lives inside the existing `extensions/null-tools/` extension
(no new built-in extension — this is a feature of the grab-bag tools
extension, not big/isolated enough on its own to warrant the `null-actions`/
`null-cpp` treatment of a separate `package.json` + CI build step).

```
extensions/null-tools/src/
├── github/
│   ├── types.ts          — shared types: GithubRepoRef, GithubIssue,
│   │                        GithubComment, GithubLabel, GithubUser,
│   │                        IssueState, IssueFilterOptions
│   ├── githubRemote.ts   — parseGithubRemote(), getWorkspaceGithubRepo()
│   ├── githubAuth.ts     — getGithubSession() wrapping vscode.authentication
│   ├── githubApi.ts      — fetchIssues(), fetchComments(), and (write path)
│   │                        createComment(), updateIssue()
│   ├── issueFilter.ts    — stripPullRequests(), filterIssues()
│   ├── promptFormat.ts   — formatIssueAsPrompt()
│   └── issuesStore.ts    — IssuesStore: cache + orchestration over the
│                            above; owns the one GitHub session/token/repo
│                            in memory for the panel's lifetime
├── issuesPanel.ts        — IssuesViewProvider (WebviewViewProvider):
│                            extension-host state owner + HTML shell +
│                            message protocol
├── issuesPanelIntegration.ts — registerIssuesPanelFeature(): view + command
│                            registration, called from extension.ts
└── webview/
    └── issues.ts          — thin renderer: list/filter/search UI, detail +
                             comments pane; compiled via a new
                             tsconfig.webview-issues.json (mirrors
                             tsconfig.webview.json's outFile/module:"none"
                             setup) to lib/issues.js
```

Registered as a second view (`null.issuesView`, "GitHub Issues") inside the
existing `null-agents` secondary-sidebar container, alongside
`null.agentsView` ("Claude Code") — per the source issue's explicit "same
pattern as the Agents panel" framing.

## Data Model

```typescript
type IssueState = 'open' | 'closed' | 'all';

interface GithubRepoRef { owner: string; repo: string; }
interface GithubLabel { name: string; color: string; }
interface GithubUser { login: string; }

interface GithubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  html_url: string;
  labels: GithubLabel[];
  assignees: GithubUser[];
  user: GithubUser;
  comments: number;
  updated_at: string;
  pull_request?: unknown;   // present only on PRs returned by /issues — stripped before use
}

interface GithubComment {
  id: number;
  user: GithubUser;
  body: string;
  created_at: string;
  html_url: string;
}

interface IssueFilterOptions {
  labels: string[];
  assignee: 'me' | 'everyone';
  query: string;
  viewerLogin: string | null;
}
```

`IssuesStore` is the single owner of live state (current issue list, repo,
token) for the panel's lifetime; `issuesPanel.ts` never talks to
`githubApi.ts`/`githubAuth.ts` directly, only through the store. This keeps
every future write-path addition (comment, edit) a store method plus a
message-protocol case, not a parallel access path.

### Host ↔ webview message protocol

Webview → host: `{type:'ready'}`, `{type:'setState', state}`,
`{type:'setFilters', labels, assignee, query}`, `{type:'selectIssue', number}`,
`{type:'copyAsPrompt', number}`, `{type:'openInBrowser', number}`,
`{type:'signIn'}` — and, once the write path lands:
`{type:'addComment', number, body}`, `{type:'updateIssue', number, patch}`.

Host → webview: `{type:'init', state}`, `{type:'issues', status, issues?,
message?}` (`status` ∈ `'ok'|'no-workspace'|'no-remote'|'signed-out'|'error'`),
`{type:'issueDetail', issue, comments}`, `{type:'copied'}` — and, once the
write path lands: `{type:'commentAdded', comment}`,
`{type:'issueUpdated', issue}`.

## Auth

`vscode.authentication.getSession('github', ['repo'], { createIfNone, silent:
!createIfNone })`. Silent lookup on panel load (no prompt if not signed in —
shows a "Sign in" button instead); `createIfNone: true` only when the user
explicitly clicks that button. The `repo` scope is required up front (not
requested lazily at write-time) because VS Code's GitHub auth provider
dedupes sessions by scope set — asking for a broader scope later would
force a second consent prompt instead of reusing the read-time session.

## Read Path — issue list, filters, search, detail + comments

Covered in full by
[docs/plans/github-issues-panel-mvp.md](../plans/github-issues-panel-mvp.md):
`IssuesStore.refresh()` re-fetches from `GET /repos/{owner}/{repo}/issues`
(state passed server-side as a query param; PRs stripped client-side since
that endpoint returns both), `filterIssues()` narrows the cached list
client-side by labels (AND) / assignee / free-text search, and
`selectIssue` lazily fetches `GET .../issues/{n}/comments`. "Copy as prompt"
formats `#N Title\n\nBody\n\nURL` to the clipboard via
`vscode.env.clipboard.writeText`.

Known ceiling: a single page (`per_page=100`) per state, no
pagination — fine for this repo's current issue volume; add
`Link`-header-based paging if a tracked repo ever exceeds 100 open issues in
one state.

## Write Path — comments and editing (implemented)

- **Add comment**: `POST /repos/{owner}/{repo}/issues/{number}/comments`
  with `{body}` (`githubApi.createComment`, `IssuesStore.addComment`),
  reusing the `repo`-scope session from the read path. The detail webview's
  composer posts a comment and the panel re-fetches the detail view on
  success.
- **Edit title/body/state/labels/assignees**:
  `PATCH /repos/{owner}/{repo}/issues/{number}` (`githubApi.updateIssue`,
  `IssuesStore.updateIssue`) with a partial body. Labels and assignees are
  backed by real pickers in the edit form, fed by the repo's assignable-users
  list (`GET .../assignees` — `githubApi.fetchAssignableUsers`) and label set
  (`GET .../labels` — `githubApi.fetchRepoLabels`), both cached per-repo on
  `IssuesStore`. The main list's labels filter was upgraded alongside this
  from free-text to a checkbox multi-select using the same fetched label set
  (`issuesPanel.ts` / `webview/issues.ts`).
- Errors from `updateIssue`/`addComment` (including 409/422 on conflicting
  states) surface via `vscode.window.showErrorMessage` in
  `issueDetailPanel.ts` — no optimistic-then-silently-revert UX.

## Git Integration — branch-from-issue, `#123` linking (implemented)

- **Branch from issue**: a "Branch" action in the detail panel and a
  per-row action in the list, both calling `createIssueBranch`
  (`github/gitBranch.ts`), which shells out via `git checkout -b` to create
  and check out a branch named from the issue (e.g.
  `issue-43-add-github-issues-panel`).
- **`#123` linking in the SCM input box**: confirmed not reachable from a
  third-party extension on the public API (see the Deviations section above)
  — shipped as the documented fallback instead: `null.issues.linkFromCommitMessage`
  (`issuesPanelIntegration.ts`), a button on the SCM title bar next to
  "Generate Commit Message" that reads the commit message box, finds `#N`
  references, and opens the issue (via quick-pick if there's more than one).

## Testing

Pure logic gets `node --test` coverage (matches this codebase's existing
split): `githubRemote.ts`, `issueFilter.ts`, `promptFormat.ts`, and any pure
helpers the write/git-integration plans add (e.g. a branch-name-from-title
slugifier). Anything importing `vscode` or doing network I/O
(`githubAuth.ts`, `githubApi.ts`, `issuesStore.ts`, `issuesPanel.ts`,
`webview/issues.ts`) is verified by hand against a real local install per
plan, since this repo has no HTTP-mocking or webview-DOM test harness.

## Plans under this spec

1. **[github-issues-panel-mvp.md](../plans/github-issues-panel-mvp.md)** —
   read-only MVP: repo/auth resolution, list/filter/search, detail +
   comments view, copy as prompt. *(done)*
2. **Write path** *(done, no separate plan doc)* — add comment, edit
   title/body/state/labels/assignees, per the Write Path section above.
3. **Git integration** *(done, no separate plan doc)* — branch-from-issue
   and the `#123` commit-message quick-pick fallback, per the Git
   Integration section above.

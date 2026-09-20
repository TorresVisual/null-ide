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
- Fetching the repo's full label set for a proper multi-select label picker
  — the label filter matches against labels already present on loaded
  issues (typed, comma-separated).
- Rendering issue/comment bodies as rendered Markdown — plain pre-wrapped
  text only. (`null-markdown`'s preview machinery is a separate webview
  context; wiring it into this panel is a possible future enhancement, not
  part of this design.)
- Pagination beyond the first 100 issues per state — flagged as a known
  ceiling below, not designed away.

## Deviations from source issue

Two points where this design doesn't literally match
[#43](https://github.com/TorresVisual/null-ide/issues/43)'s wording:

- **Labels filter isn't multi-select.** #43 asks for "labels (multi-select)";
  MVP ships a comma-separated free-text filter matched against labels already
  present on loaded issues instead, because a real picker needs the repo's
  full label set (a separate fetch) — see the Write Path section's label
  picker, which is where this should get upgraded.
- **`#123` SCM-input linking isn't guaranteed as specified.** #43 lists it as
  in-scope; the Git Integration section flags it as needing a feasibility
  check (whether a third-party extension can register against VS Code's SCM
  input document the way the built-in GitHub PR/Issues extension does) before
  a follow-up plan can commit to it as described, with a lighter fallback
  noted if it isn't reachable.

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

## Write Path — comments and editing (not yet planned)

Deferred out of the MVP plan; a follow-up plan under this spec should cover:

- **Add comment**: `POST /repos/{owner}/{repo}/issues/{number}/comments`
  with `{body}`, requires the `repo` scope session already held from the
  read path (no new auth prompt). Webview adds a textarea + submit button
  under the comments list in the detail pane; on success, append the
  returned comment optimistically rather than re-fetching the whole list.
- **Edit title/labels/assignees**: `PATCH /repos/{owner}/{repo}/issues/{number}`
  with a partial body (`{title}`, `{labels}`, `{assignees}`). Needs the
  repo's assignable-users list (`GET .../assignees`) and its label set
  (`GET .../labels`) to back proper pickers — this is also where the MVP's
  "type labels as free text" filter should probably get upgraded to a real
  multi-select using the same fetched label set, since both need it.
- Error handling for concurrent edits (GitHub returns 409/422 on some
  conflicting states) should surface as an inline webview error, not a
  silent failure — no optimistic-then-silently-revert UX.

## Git Integration — branch-from-issue, `#123` linking (not yet planned)

Deferred out of the MVP plan; a follow-up plan under this spec should cover:

- **Branch from issue**: a "Create branch" action on an issue that shells
  out via the built-in `vscode.git` extension API (same
  `vscode.extensions.getExtension('vscode.git')` access pattern
  `null.generateCommitMessage` already uses in `extension.ts`) to create and
  check out a branch named from the issue (e.g. `43-add-github-issues-panel`).
- **`#123` linking in the SCM input box**: needs investigation before
  planning — VS Code's SCM input box is backed by a text document VS Code's
  own "GitHub Pull Requests and Issues" extension decorates via a
  `DocumentLinkProvider`/`CompletionItemProvider` registered against that
  document's URI scheme. Confirm this is reachable from a third-party
  extension (not a private API) before committing to it in a plan; if not
  feasible, a lighter fallback (a status-bar hint or a quick-pick triggered
  from the commit message) should be considered instead.

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
   comments view, copy as prompt. *(in progress)*
2. **Write path** (not yet planned) — add comment, edit title/labels/
   assignees, per the Write Path section above.
3. **Git integration** (not yet planned) — branch-from-issue and `#123`
   SCM-input linking, per the Git Integration section above, pending the
   linking-API feasibility check called out there.

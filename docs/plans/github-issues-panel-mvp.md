# GitHub Issues Panel (MVP) Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Add a read-only "GitHub Issues" webview view to `null-tools`, in the same secondary-sidebar container as the AI Agents panel, that lists/filters/searches issues for the current repo, shows an issue's body + comments, and offers a "copy as prompt" clipboard action.

**Architecture:** A `github/` module resolves the repo from `git remote`, authenticates via VS Code's built-in `github` auth provider, and fetches issues/comments over HTTPS from the GitHub REST API (no new npm dependency — same `https`-module pattern `updater.ts` already uses for GitHub Releases). A `WebviewViewProvider` (`issuesPanel.ts`) owns all state and filtering on the extension-host side and pushes plain data to a thin vanilla-TS renderer (`webview/issues.ts`), mirroring the existing `agentsPanel.ts` / `webview/agents.ts` split.

**Tech Stack:** TypeScript, VS Code Extension API (`vscode.authentication`, `vscode.window.registerWebviewViewProvider`), Node `https` module, `node:test` for unit tests.

**Spec:** [docs/specs/github-issues-panel-design.md](../specs/github-issues-panel-design.md) (implements the full source issue, [TorresVisual/null-ide#43](https://github.com/TorresVisual/null-ide/issues/43)). This plan implements only the spec's **Read Path** section — list/filter/search, issue detail + comments (view only), and "copy as prompt". The spec's Write Path (comments, editing) and Git Integration (branch-from-issue, `#123` linking) sections are deferred to follow-up plans under the same spec — see "Out of Scope" below.

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

- GitHub.com only — no GitLab, no GitHub Enterprise (per issue: "this repo has no GitLab usage").
- Auth reuses VS Code's built-in `github` authentication provider (`vscode.authentication.getSession('github', ...)`) — no separate PAT flow.
- No new npm dependencies (no Octokit) — use the `https` module, matching `updater.ts`'s existing GitHub API pattern.
- Reuse the existing webview-view pattern from `agentsPanel.ts` / `agentsPanelIntegration.ts` (secondary-sidebar `null-agents` container, `retainContextWhenHidden: true`).
- Work only inside `D:\Coding\Apps\null-ide\` — do not touch system PATH, registry, or any install outside this repo's own scripts.
- `tsconfig.json`'s `include` array is a whitelist of *root* files, but any file reachable via `import` from a root file (like `extension.ts`) compiles automatically — only new **test** files (not imported by production code) need to be added explicitly, plus their entry in `package.json`'s `test` script.

## Out of Scope (this plan)

Everything below is covered by the spec's own sections, deferred to a
follow-up plan under [docs/specs/github-issues-panel-design.md](../specs/github-issues-panel-design.md)
rather than this one:

- Adding comments, editing title/labels/assignees — see the spec's **Write Path** section.
- Branch-from-issue and `#123` SCM-input-box linking — see the spec's **Git Integration** section.
- Fetching the repo's full label set for a proper multi-select — MVP's label filter is a comma-separated text input matched against labels already present on loaded issues (the spec notes this should be upgraded alongside the Write Path's label picker).
- Markdown rendering of issue/comment bodies — MVP renders body text as plain pre-wrapped text.

## Review Focus

- A workspace remote that isn't `github.com` (GitLab, Bitbucket, malformed) must not be mistaken for a GitHub repo — `parseGithubRemote` returns `null` and the panel shows a "no remote" state, never garbage owner/repo. (Task 1)
- GitHub's `GET /issues` endpoint also returns pull requests — those must never appear in the issue list. (Task 2)
- The labels filter must require **all** typed labels to be present (AND), not just any one of them, or users filtering by two labels get a flooded, wrong list. (Task 2)
- The "assigned to me" filter must never silently fall back to showing everyone's issues when the viewer isn't signed in — it must show zero results, not a false "no filter applied" state. (Task 2)
- "Copy as prompt" must still produce a sane, non-broken block of text for the common case of an issue with an empty body (many issues have none). (Task 3)

---

### Task 1: Resolve the current repo's GitHub owner/repo from `git remote`

**Files:**
- Create: `extensions/null-tools/src/github/types.ts`
- Create: `extensions/null-tools/src/github/githubRemote.ts`
- Test: `extensions/null-tools/src/github/githubRemote.test.ts`
- Modify: `extensions/null-tools/package.json:12` (test script)

**Interfaces:**
- Produces: `parseGithubRemote(remoteUrl: string): GithubRepoRef | null`, `getWorkspaceGithubRepo(cwd: string): GithubRepoRef | null`, and the shared types `GithubRepoRef`, `IssueState`, `GithubLabel`, `GithubUser`, `GithubIssue`, `GithubComment`, `IssueFilterOptions` (all later tasks import these from `./types`).

- [ ] **Step 1: Write the failing test**

```typescript
// extensions/null-tools/src/github/githubRemote.test.ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { parseGithubRemote } from './githubRemote';

test('parseGithubRemote handles https remotes', () => {
  assert.deepStrictEqual(
    parseGithubRemote('https://github.com/TorresVisual/null-ide.git\n'),
    { owner: 'TorresVisual', repo: 'null-ide' },
  );
  assert.deepStrictEqual(
    parseGithubRemote('https://github.com/TorresVisual/null-ide'),
    { owner: 'TorresVisual', repo: 'null-ide' },
  );
});

test('parseGithubRemote handles ssh remotes', () => {
  assert.deepStrictEqual(
    parseGithubRemote('git@github.com:TorresVisual/null-ide.git\n'),
    { owner: 'TorresVisual', repo: 'null-ide' },
  );
});

test('parseGithubRemote returns null for non-GitHub or malformed remotes', () => {
  assert.strictEqual(parseGithubRemote('https://gitlab.com/foo/bar.git'), null);
  assert.strictEqual(parseGithubRemote('git@bitbucket.org:foo/bar.git'), null);
  assert.strictEqual(parseGithubRemote('not a url'), null);
  assert.strictEqual(parseGithubRemote(''), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/github/githubRemote.test.js`
Expected: FAIL — `githubRemote.ts` / `parseGithubRemote` does not exist yet (tsc error).

- [ ] **Step 3: Write minimal implementation**

```typescript
// extensions/null-tools/src/github/types.ts
'use strict';

export type IssueState = 'open' | 'closed' | 'all';

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export interface GithubLabel {
  name: string;
  color: string;
}

export interface GithubUser {
  login: string;
}

export interface GithubIssue {
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
  pull_request?: unknown;
}

export interface GithubComment {
  id: number;
  user: GithubUser;
  body: string;
  created_at: string;
}

export interface IssueFilterOptions {
  labels: string[];
  assignee: 'me' | 'everyone';
  query: string;
  viewerLogin: string | null;
}
```

```typescript
// extensions/null-tools/src/github/githubRemote.ts
'use strict';

import { execSync } from 'child_process';
import { GithubRepoRef } from './types';

export function parseGithubRemote(remoteUrl: string): GithubRepoRef | null {
  const trimmed = remoteUrl.trim();
  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  return null;
}

export function getWorkspaceGithubRepo(cwd: string): GithubRepoRef | null {
  try {
    const url = execSync('git remote get-url origin', { cwd, encoding: 'utf8', timeout: 5000 });
    return parseGithubRemote(url);
  } catch {
    return null;
  }
}
```

Update `extensions/null-tools/package.json`'s `test` script to include the new test file:

```json
"test": "tsc -p tsconfig.json && node --test out/recentProjects.test.js out/scratchNotesStorage.test.js out/autoGitignore.test.js out/versionComparison.test.js out/nullNotes.test.js out/github/githubRemote.test.js"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/null-tools && npm test`
Expected: All tests PASS, including the three new `parseGithubRemote` cases.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/github/types.ts extensions/null-tools/src/github/githubRemote.ts extensions/null-tools/src/github/githubRemote.test.ts extensions/null-tools/package.json
git commit -m "feat(null-tools): resolve GitHub owner/repo from git remote"
```

---

### Task 2: Issue filtering + pull-request stripping

**Files:**
- Create: `extensions/null-tools/src/github/issueFilter.ts`
- Test: `extensions/null-tools/src/github/issueFilter.test.ts`
- Modify: `extensions/null-tools/package.json` (test script)

**Interfaces:**
- Consumes: `GithubIssue`, `IssueFilterOptions` from `./types` (Task 1).
- Produces: `stripPullRequests(issues: GithubIssue[]): GithubIssue[]`, `filterIssues(issues: GithubIssue[], opts: IssueFilterOptions): GithubIssue[]` — both used by `issuesStore.ts` (Task 4) and `githubApi.ts` (Task 6, for `stripPullRequests`).

- [ ] **Step 1: Write the failing test**

```typescript
// extensions/null-tools/src/github/issueFilter.test.ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { filterIssues, stripPullRequests } from './issueFilter';
import { GithubIssue } from './types';

function makeIssue(overrides: Partial<GithubIssue>): GithubIssue {
  return {
    number: 1,
    title: 'Untitled',
    body: '',
    state: 'open',
    html_url: 'https://github.com/o/r/issues/1',
    labels: [],
    assignees: [],
    user: { login: 'author' },
    comments: 0,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('stripPullRequests removes entries with a pull_request field', () => {
  const issue = makeIssue({ number: 1 });
  const pr = makeIssue({ number: 2, pull_request: { url: 'x' } });
  assert.deepStrictEqual(stripPullRequests([issue, pr]), [issue]);
});

test('filterIssues requires ALL selected labels to be present (AND)', () => {
  const a = makeIssue({ number: 1, labels: [{ name: 'bug', color: 'f00' }] });
  const b = makeIssue({ number: 2, labels: [{ name: 'bug', color: 'f00' }, { name: 'ui', color: '0f0' }] });
  const opts = { labels: ['bug', 'ui'], assignee: 'everyone' as const, query: '', viewerLogin: null };
  assert.deepStrictEqual(filterIssues([a, b], opts), [b]);
});

test('filterIssues "me" never falls back to showing everyone when signed out', () => {
  const a = makeIssue({ number: 1, assignees: [{ login: 'octocat' }] });
  const opts = { labels: [], assignee: 'me' as const, query: '', viewerLogin: null };
  assert.deepStrictEqual(filterIssues([a], opts), []);
});

test('filterIssues "me" matches the viewer\'s own assigned issues', () => {
  const mine = makeIssue({ number: 1, assignees: [{ login: 'octocat' }] });
  const other = makeIssue({ number: 2, assignees: [{ login: 'someoneelse' }] });
  const opts = { labels: [], assignee: 'me' as const, query: '', viewerLogin: 'octocat' };
  assert.deepStrictEqual(filterIssues([mine, other], opts), [mine]);
});

test('filterIssues searches title and body case-insensitively', () => {
  const a = makeIssue({ number: 1, title: 'Crash on startup', body: '' });
  const b = makeIssue({ number: 2, title: 'Unrelated', body: 'reproduces on STARTUP too' });
  const c = makeIssue({ number: 3, title: 'Also unrelated', body: '' });
  const opts = { labels: [], assignee: 'everyone' as const, query: 'startup', viewerLogin: null };
  assert.deepStrictEqual(filterIssues([a, b, c], opts).map(i => i.number), [1, 2]);
});

test('filterIssues with no filters returns everything unchanged', () => {
  const issues = [makeIssue({ number: 1 }), makeIssue({ number: 2 })];
  const opts = { labels: [], assignee: 'everyone' as const, query: '', viewerLogin: null };
  assert.deepStrictEqual(filterIssues(issues, opts), issues);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/github/issueFilter.test.js`
Expected: FAIL — `issueFilter.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
// extensions/null-tools/src/github/issueFilter.ts
'use strict';

import { GithubIssue, IssueFilterOptions } from './types';

export function stripPullRequests(issues: GithubIssue[]): GithubIssue[] {
  return issues.filter(issue => !issue.pull_request);
}

export function filterIssues(issues: GithubIssue[], opts: IssueFilterOptions): GithubIssue[] {
  const query = opts.query.trim().toLowerCase();
  return issues.filter(issue => {
    if (opts.labels.length > 0) {
      const issueLabels = new Set(issue.labels.map(l => l.name));
      if (!opts.labels.every(label => issueLabels.has(label))) return false;
    }
    if (opts.assignee === 'me') {
      if (!opts.viewerLogin) return false;
      if (!issue.assignees.some(a => a.login === opts.viewerLogin)) return false;
    }
    if (query) {
      const haystack = `${issue.title}\n${issue.body || ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}
```

Update `extensions/null-tools/package.json`'s `test` script:

```json
"test": "tsc -p tsconfig.json && node --test out/recentProjects.test.js out/scratchNotesStorage.test.js out/autoGitignore.test.js out/versionComparison.test.js out/nullNotes.test.js out/github/githubRemote.test.js out/github/issueFilter.test.js"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/null-tools && npm test`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/github/issueFilter.ts extensions/null-tools/src/github/issueFilter.test.ts extensions/null-tools/package.json
git commit -m "feat(null-tools): add issue filtering and PR-stripping logic"
```

---

### Task 3: "Copy as prompt" formatting

**Files:**
- Create: `extensions/null-tools/src/github/promptFormat.ts`
- Test: `extensions/null-tools/src/github/promptFormat.test.ts`
- Modify: `extensions/null-tools/package.json` (test script)

**Interfaces:**
- Consumes: `GithubIssue` from `./types` (Task 1).
- Produces: `formatIssueAsPrompt(issue: GithubIssue): string` — used by `issuesPanel.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

```typescript
// extensions/null-tools/src/github/promptFormat.test.ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { formatIssueAsPrompt } from './promptFormat';
import { GithubIssue } from './types';

function makeIssue(overrides: Partial<GithubIssue>): GithubIssue {
  return {
    number: 1,
    title: 'Untitled',
    body: '',
    state: 'open',
    html_url: 'https://github.com/o/r/issues/1',
    labels: [],
    assignees: [],
    user: { login: 'author' },
    comments: 0,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('formatIssueAsPrompt includes number, title, body, and link', () => {
  const text = formatIssueAsPrompt(makeIssue({
    number: 43, title: 'Add issues panel', body: 'Some body text',
    html_url: 'https://github.com/x/y/issues/43',
  }));
  assert.strictEqual(
    text,
    '#43 Add issues panel\n\nSome body text\n\nhttps://github.com/x/y/issues/43',
  );
});

test('formatIssueAsPrompt handles an empty body without a dangling blank section', () => {
  const text = formatIssueAsPrompt(makeIssue({
    number: 5, title: 'No description', body: '',
    html_url: 'https://github.com/x/y/issues/5',
  }));
  assert.strictEqual(text, '#5 No description\n\nhttps://github.com/x/y/issues/5');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/github/promptFormat.test.js`
Expected: FAIL — `promptFormat.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
// extensions/null-tools/src/github/promptFormat.ts
'use strict';

import { GithubIssue } from './types';

export function formatIssueAsPrompt(issue: GithubIssue): string {
  const header = `#${issue.number} ${issue.title}`;
  const body = issue.body?.trim();
  const parts = body ? [header, body, issue.html_url] : [header, issue.html_url];
  return parts.join('\n\n');
}
```

Update `extensions/null-tools/package.json`'s `test` script:

```json
"test": "tsc -p tsconfig.json && node --test out/recentProjects.test.js out/scratchNotesStorage.test.js out/autoGitignore.test.js out/versionComparison.test.js out/nullNotes.test.js out/github/githubRemote.test.js out/github/issueFilter.test.js out/github/promptFormat.test.js"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/null-tools && npm test`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/github/promptFormat.ts extensions/null-tools/src/github/promptFormat.test.ts extensions/null-tools/package.json
git commit -m "feat(null-tools): add copy-as-prompt formatting for GitHub issues"
```

---

### Task 4: GitHub auth session wrapper

**Files:**
- Create: `extensions/null-tools/src/github/githubAuth.ts`

**Interfaces:**
- Produces: `getGithubSession(createIfNone: boolean): Promise<vscode.AuthenticationSession | undefined>` — used by `issuesStore.ts` (Task 6).

This is a five-line wrapper around a single `vscode` API call with no branch or loop of its own — no test file, matching this codebase's existing convention (compare `autoGitignore.ts`, `commitMessage.ts`'s `runClaude`: files that only call into `vscode`/external processes aren't unit-tested here; only their pure logic siblings are, e.g. `autoGitignoreStorage.ts`). Verified end-to-end by Task 9's manual smoke test.

- [ ] **Step 1: Write the implementation**

```typescript
// extensions/null-tools/src/github/githubAuth.ts
'use strict';

import * as vscode from 'vscode';

const SCOPES = ['repo'];

export function getGithubSession(createIfNone: boolean): Thenable<vscode.AuthenticationSession | undefined> {
  return vscode.authentication.getSession('github', SCOPES, { createIfNone, silent: !createIfNone });
}
```

- [ ] **Step 2: Compile to verify it type-checks**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: No errors. (`githubAuth.ts` isn't imported by anything yet, so this only confirms the file itself is valid TypeScript in isolation — full wiring lands in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add extensions/null-tools/src/github/githubAuth.ts
git commit -m "feat(null-tools): wrap VS Code's built-in GitHub auth session"
```

---

### Task 5: GitHub REST API client

**Files:**
- Create: `extensions/null-tools/src/github/githubApi.ts`

**Interfaces:**
- Consumes: `stripPullRequests` from `./issueFilter` (Task 2); `GithubIssue`, `GithubComment`, `IssueState` from `./types` (Task 1).
- Produces: `fetchIssues(owner: string, repo: string, state: IssueState, token: string | null): Promise<GithubIssue[]>`, `fetchComments(owner: string, repo: string, issueNumber: number, token: string | null): Promise<GithubComment[]>` — used by `issuesStore.ts` (Task 6).

Network I/O over `https` — no unit test, matching `updater.ts`'s existing `requestJson` (also untested; this codebase has no HTTP-mocking infrastructure). Verified end-to-end by Task 9's manual smoke test. MVP fetches a single page (`per_page=100`); repos with more than 100 open issues will only show the first 100 — acceptable for this repo today, flagged here as the known ceiling.

- [ ] **Step 1: Write the implementation**

```typescript
// extensions/null-tools/src/github/githubApi.ts
'use strict';

import * as https from 'https';
import { GithubComment, GithubIssue, IssueState } from './types';
import { stripPullRequests } from './issueFilter';

function requestJson<T>(path: string, token: string | null): Promise<T> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Null-IDE',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const req = https.get(`https://api.github.com${path}`, { headers }, res => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`GitHub API ${res.statusCode ?? 'error'}: ${path}`));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data) as T); }
        catch (err) { reject(err as Error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('GitHub API request timed out')));
  });
}

// ponytail: single page, 100 issues max — add Link-header pagination if a
// tracked repo ever exceeds that many open issues.
export async function fetchIssues(
  owner: string, repo: string, state: IssueState, token: string | null,
): Promise<GithubIssue[]> {
  const raw = await requestJson<GithubIssue[]>(
    `/repos/${owner}/${repo}/issues?state=${state}&per_page=100`, token,
  );
  return stripPullRequests(raw);
}

export function fetchComments(
  owner: string, repo: string, issueNumber: number, token: string | null,
): Promise<GithubComment[]> {
  return requestJson<GithubComment[]>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`, token,
  );
}
```

- [ ] **Step 2: Compile to verify it type-checks**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/null-tools/src/github/githubApi.ts
git commit -m "feat(null-tools): fetch GitHub issues and comments over HTTPS"
```

---

### Task 6: Issues store (cache + orchestration)

**Files:**
- Create: `extensions/null-tools/src/github/issuesStore.ts`

**Interfaces:**
- Consumes: `getWorkspaceGithubRepo` from `./githubRemote` (Task 1); `getGithubSession` from `./githubAuth` (Task 4); `fetchIssues`, `fetchComments` from `./githubApi` (Task 5); `filterIssues` from `./issueFilter` (Task 2); `GithubRepoRef`, `GithubIssue`, `GithubComment`, `IssueState`, `IssueFilterOptions` from `./types` (Task 1).
- Produces: `class IssuesStore` with `refresh(cwd: string | null, state: IssueState): Promise<IssuesResult>`, `getFiltered(opts: IssueFilterOptions): GithubIssue[]`, `getByNumber(number: number): GithubIssue | undefined`, `getComments(issueNumber: number): Promise<GithubComment[]>` — and the exported `IssuesResult` union type. Used by `issuesPanel.ts` (Task 7).

Orchestration over already-tested pure pieces (`issueFilter.ts`) plus `vscode`/network calls transitively imported via `githubAuth.ts` — this file can't run under plain `node --test` (importing `vscode` outside the extension host throws at module-load time, same reason `autoGitignore.ts` has no test file while `autoGitignoreStorage.ts` does). No test file; the branch logic it adds on top of `issueFilter.ts` (workspace/remote/auth status dispatch) is exercised by Task 9's manual smoke test across each of the five states.

- [ ] **Step 1: Write the implementation**

```typescript
// extensions/null-tools/src/github/issuesStore.ts
'use strict';

import { getWorkspaceGithubRepo } from './githubRemote';
import { getGithubSession } from './githubAuth';
import { fetchComments, fetchIssues } from './githubApi';
import { filterIssues } from './issueFilter';
import { GithubComment, GithubIssue, GithubRepoRef, IssueFilterOptions, IssueState } from './types';

export type IssuesResult =
  | { status: 'no-workspace' }
  | { status: 'no-remote' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | { status: 'ok'; repo: GithubRepoRef; issues: GithubIssue[]; viewerLogin: string | null };

export class IssuesStore {
  private issues: GithubIssue[] = [];
  private repo: GithubRepoRef | null = null;
  private token: string | null = null;

  async refresh(cwd: string | null, state: IssueState): Promise<IssuesResult> {
    if (!cwd) return { status: 'no-workspace' };

    const repo = getWorkspaceGithubRepo(cwd);
    if (!repo) return { status: 'no-remote' };

    const session = await getGithubSession(false);
    if (!session) return { status: 'signed-out' };

    try {
      const issues = await fetchIssues(repo.owner, repo.repo, state, session.accessToken);
      this.issues = issues;
      this.repo = repo;
      this.token = session.accessToken;
      return { status: 'ok', repo, issues, viewerLogin: session.account.label };
    } catch (err) {
      return { status: 'error', message: (err as Error).message };
    }
  }

  getFiltered(opts: IssueFilterOptions): GithubIssue[] {
    return filterIssues(this.issues, opts);
  }

  getByNumber(number: number): GithubIssue | undefined {
    return this.issues.find(issue => issue.number === number);
  }

  getComments(issueNumber: number): Promise<GithubComment[]> {
    if (!this.repo) return Promise.resolve([]);
    return fetchComments(this.repo.owner, this.repo.repo, issueNumber, this.token);
  }
}
```

- [ ] **Step 2: Compile to verify it type-checks**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/null-tools/src/github/issuesStore.ts
git commit -m "feat(null-tools): add IssuesStore to orchestrate repo/auth/fetch/filter"
```

---

### Task 7: Issues webview view provider (extension-host side)

**Files:**
- Create: `extensions/null-tools/src/issuesPanel.ts`

**Interfaces:**
- Consumes: `getNonce` from `./webviewUtils` (existing); `IssuesStore` from `./github/issuesStore` (Task 6); `getGithubSession` from `./github/githubAuth` (Task 4); `formatIssueAsPrompt` from `./github/promptFormat` (Task 3); `IssueFilterOptions`, `IssueState` from `./github/types` (Task 1).
- Produces: `class IssuesViewProvider implements vscode.WebviewViewProvider` with public `refresh(): Promise<void>` and `signIn(): Promise<void>` — used by `issuesPanelIntegration.ts` (Task 9). Also defines the **host↔webview message protocol** that `webview/issues.ts` (Task 8) must match exactly:
  - Webview → host: `{type:'ready'}`, `{type:'setState', state}`, `{type:'setFilters', labels, assignee, query}`, `{type:'selectIssue', number}`, `{type:'copyAsPrompt', number}`, `{type:'openInBrowser', number}`, `{type:'signIn'}`.
  - Host → webview: `{type:'init', state}`, `{type:'issues', status, issues?, message?}` (status is one of `'ok'|'no-workspace'|'no-remote'|'signed-out'|'error'`), `{type:'issueDetail', issue, comments}`, `{type:'copied'}`.

Not unit-testable for the same `vscode`-import reason as Task 6; verified in Task 9's manual smoke test.

- [ ] **Step 1: Write the implementation**

```typescript
// extensions/null-tools/src/issuesPanel.ts
'use strict';

import * as vscode from 'vscode';
import { getNonce } from './webviewUtils';
import { IssuesStore } from './github/issuesStore';
import { getGithubSession } from './github/githubAuth';
import { formatIssueAsPrompt } from './github/promptFormat';
import { IssueFilterOptions, IssueState } from './github/types';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'setState'; state: IssueState }
  | { type: 'setFilters'; labels: string[]; assignee: 'me' | 'everyone'; query: string }
  | { type: 'selectIssue'; number: number }
  | { type: 'copyAsPrompt'; number: number }
  | { type: 'openInBrowser'; number: number }
  | { type: 'signIn' };

export class IssuesViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.Webview;
  private _state: IssueState = 'open';
  private _filters: IssueFilterOptions = { labels: [], assignee: 'everyone', query: '', viewerLogin: null };

  constructor(private readonly _extensionUri: vscode.Uri, private readonly _store: IssuesStore) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const webview = webviewView.webview;
    this._view = webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'lib')],
    };
    webview.html = this._buildHtml(webview);
    webview.onDidReceiveMessage((msg: InboundMessage) => this._handleMessage(msg));
  }

  async refresh(): Promise<void> {
    await this._sendIssues();
  }

  async signIn(): Promise<void> {
    await getGithubSession(true);
    await this._sendIssues();
  }

  private _cwd(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  private async _sendIssues(): Promise<void> {
    if (!this._view) return;
    const result = await this._store.refresh(this._cwd(), this._state);
    if (result.status !== 'ok') {
      this._view.postMessage({
        type: 'issues',
        status: result.status,
        message: 'message' in result ? result.message : undefined,
      });
      return;
    }
    this._filters = { ...this._filters, viewerLogin: result.viewerLogin };
    this._view.postMessage({ type: 'issues', status: 'ok', issues: this._store.getFiltered(this._filters) });
  }

  private async _handleMessage(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this._view?.postMessage({ type: 'init', state: this._state });
        await this._sendIssues();
        break;
      case 'setState':
        this._state = msg.state;
        await this._sendIssues();
        break;
      case 'setFilters':
        this._filters = { ...this._filters, labels: msg.labels, assignee: msg.assignee, query: msg.query };
        this._view?.postMessage({ type: 'issues', status: 'ok', issues: this._store.getFiltered(this._filters) });
        break;
      case 'selectIssue': {
        const issue = this._store.getByNumber(msg.number);
        if (!issue) break;
        const comments = await this._store.getComments(msg.number);
        this._view?.postMessage({ type: 'issueDetail', issue, comments });
        break;
      }
      case 'copyAsPrompt': {
        const issue = this._store.getByNumber(msg.number);
        if (!issue) break;
        await vscode.env.clipboard.writeText(formatIssueAsPrompt(issue));
        this._view?.postMessage({ type: 'copied' });
        break;
      }
      case 'openInBrowser': {
        const issue = this._store.getByNumber(msg.number);
        if (issue) await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
        break;
      }
      case 'signIn':
        await this.signIn();
        break;
    }
  }

  private _buildHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'issues.js'));
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
<style>
  html,body { margin:0; padding:0; height:100%; background:#181818; color:#ccc;
              font:12px/1.5 'Cascadia Code',Consolas,monospace; }
  #app { display:flex; flex-direction:column; height:100%; }
  #toolbar { display:flex; flex-wrap:wrap; gap:6px; padding:8px; border-bottom:1px solid #2b2b2b; flex-shrink:0; }
  #toolbar input, #toolbar select { background:#1e1e1e; border:1px solid #333; color:#ccc; padding:4px 6px; font:inherit; border-radius:2px; }
  #toolbar input { flex:1; min-width:80px; }
  .assignee-btn { background:#1e1e1e; border:1px solid #333; color:#888; padding:4px 8px; cursor:pointer; border-radius:2px; }
  .assignee-btn.active { color:#e0e0e0; border-color:#0078D4; }
  #body { flex:1; display:flex; min-height:0; }
  #list { width:45%; overflow-y:auto; border-right:1px solid #2b2b2b; }
  .issue-row { padding:8px 10px; border-bottom:1px solid #222; cursor:pointer; }
  .issue-row:hover { background:#1e1e1e; }
  .issue-row.selected { background:#242424; border-left:2px solid #4EC9B0; }
  .issue-num { color:#666; }
  .issue-title { color:#e0e0e0; }
  .issue-meta { color:#666; font-size:11px; margin-top:2px; }
  .label-chip { display:inline-block; padding:0 5px; border-radius:8px; font-size:10px; margin-right:4px; color:#111; }
  #detail { flex:1; overflow-y:auto; padding:12px; }
  #detail-body { white-space:pre-wrap; margin:10px 0; color:#ccc; }
  .comment { border-top:1px solid #2b2b2b; padding:8px 0; }
  .comment-author { color:#4EC9B0; }
  button.action { background:#0078D4; color:#fff; border:none; padding:5px 10px; border-radius:2px; cursor:pointer; margin-right:6px; }
  button.action:hover { background:#106EBE; }
  #empty { padding:20px; color:#666; text-align:center; }
</style></head><body>
<div id="app">
  <div id="toolbar">
    <select id="state-select">
      <option value="open">Open</option>
      <option value="closed">Closed</option>
      <option value="all">All</option>
    </select>
    <button class="assignee-btn active" id="assignee-everyone">Everyone</button>
    <button class="assignee-btn" id="assignee-me">Assigned to me</button>
    <input id="label-input" placeholder="labels, comma-separated">
    <input id="search-input" placeholder="Search title &amp; body">
  </div>
  <div id="body">
    <div id="list"><div id="empty">Loading…</div></div>
    <div id="detail"><div id="empty">Select an issue.</div></div>
  </div>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
  }
}
```

- [ ] **Step 2: Compile to verify it type-checks**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/null-tools/src/issuesPanel.ts
git commit -m "feat(null-tools): add Issues webview view provider"
```

---

### Task 8: Issues webview client script (renderer)

**Files:**
- Create: `extensions/null-tools/src/webview/issues.ts`
- Create: `extensions/null-tools/tsconfig.webview-issues.json`
- Modify: `extensions/null-tools/package.json:11` (`compile` script)

**Interfaces:**
- Consumes: the message protocol defined in Task 7's `issuesPanel.ts` (duplicated locally as plain interfaces, same pattern as `webview/agents.ts` duplicating extension-host types — the two are separate compilation units with no shared module system, per the existing `tsconfig.webview.json` `module: "none"` / `outFile` setup).
- Produces: compiled `lib/issues.js`, loaded by `issuesPanel.ts`'s `_buildHtml` (Task 7) via `<script src="${scriptUri}">`.

- [ ] **Step 1: Write the implementation**

```typescript
// extensions/null-tools/src/webview/issues.ts
'use strict';

interface GithubLabel { name: string; color: string; }
interface GithubUser { login: string; }
interface GithubIssue {
  number: number; title: string; body: string; state: string; html_url: string;
  labels: GithubLabel[]; assignees: GithubUser[]; user: GithubUser; comments: number; updated_at: string;
}
interface GithubComment { id: number; user: GithubUser; body: string; created_at: string; }

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

(function () {
  const vscode = acquireVsCodeApi();

  const stateSelect      = document.getElementById('state-select') as HTMLSelectElement;
  const assigneeMe       = document.getElementById('assignee-me') as HTMLButtonElement;
  const assigneeEveryone = document.getElementById('assignee-everyone') as HTMLButtonElement;
  const labelInput       = document.getElementById('label-input') as HTMLInputElement;
  const searchInput      = document.getElementById('search-input') as HTMLInputElement;
  const listEl           = document.getElementById('list') as HTMLDivElement;
  const detailEl         = document.getElementById('detail') as HTMLDivElement;

  let assignee: 'me' | 'everyone' = 'everyone';
  let selectedNumber: number | null = null;

  function escapeHtml(s: string): string {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return s.replace(/[&<>"']/g, c => map[c]);
  }

  function sendFilters(): void {
    vscode.postMessage({
      type: 'setFilters',
      labels: labelInput.value.split(',').map(s => s.trim()).filter(Boolean),
      assignee,
      query: searchInput.value,
    });
  }

  stateSelect.addEventListener('change', () => {
    vscode.postMessage({ type: 'setState', state: stateSelect.value });
  });
  labelInput.addEventListener('input', sendFilters);
  searchInput.addEventListener('input', sendFilters);
  assigneeMe.addEventListener('click', () => {
    assignee = 'me';
    assigneeMe.classList.add('active');
    assigneeEveryone.classList.remove('active');
    sendFilters();
  });
  assigneeEveryone.addEventListener('click', () => {
    assignee = 'everyone';
    assigneeEveryone.classList.add('active');
    assigneeMe.classList.remove('active');
    sendFilters();
  });

  function renderList(issues: GithubIssue[]): void {
    if (issues.length === 0) {
      listEl.innerHTML = '<div id="empty">No issues match.</div>';
      return;
    }
    listEl.innerHTML = issues.map(issue => `
      <div class="issue-row${issue.number === selectedNumber ? ' selected' : ''}" data-number="${issue.number}">
        <div><span class="issue-num">#${issue.number}</span> <span class="issue-title">${escapeHtml(issue.title)}</span></div>
        <div class="issue-meta">
          ${issue.labels.map(l => `<span class="label-chip" style="background:#${l.color}">${escapeHtml(l.name)}</span>`).join('')}
          ${issue.comments} comments · updated ${issue.updated_at.slice(0, 10)}
        </div>
      </div>`).join('');
    listEl.querySelectorAll<HTMLDivElement>('.issue-row').forEach(row => {
      row.addEventListener('click', () => {
        selectedNumber = Number(row.dataset.number);
        vscode.postMessage({ type: 'selectIssue', number: selectedNumber });
        listEl.querySelectorAll('.issue-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
      });
    });
  }

  function renderDetail(issue: GithubIssue, comments: GithubComment[]): void {
    detailEl.innerHTML = `
      <h2>#${issue.number} ${escapeHtml(issue.title)}</h2>
      <div>
        <button class="action" id="copy-btn">Copy as prompt</button>
        <button class="action" id="browser-btn">Open in Browser</button>
      </div>
      <div id="detail-body">${escapeHtml(issue.body || '(no description)')}</div>
      <div id="comments">
        ${comments.map(c => `
          <div class="comment">
            <span class="comment-author">${escapeHtml(c.user.login)}</span>
            <span class="issue-meta">${c.created_at.slice(0, 10)}</span>
            <div>${escapeHtml(c.body)}</div>
          </div>`).join('') || '<div class="issue-meta">No comments.</div>'}
      </div>`;
    document.getElementById('copy-btn')?.addEventListener('click', () =>
      vscode.postMessage({ type: 'copyAsPrompt', number: issue.number }));
    document.getElementById('browser-btn')?.addEventListener('click', () =>
      vscode.postMessage({ type: 'openInBrowser', number: issue.number }));
  }

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        stateSelect.value = msg.state;
        break;
      case 'issues':
        if (msg.status === 'ok') {
          renderList(msg.issues);
        } else {
          const messages: Record<string, string> = {
            'no-workspace': 'Open a folder to browse its GitHub issues.',
            'no-remote': 'This folder has no GitHub remote.',
            'signed-out': 'Sign in to GitHub to view issues.',
            'error': msg.message || 'Failed to load issues.',
          };
          const text = messages[msg.status] || 'Failed to load issues.';
          listEl.innerHTML = `<div id="empty">${escapeHtml(text)}${
            msg.status === 'signed-out' ? '<br><button class="action" id="signin-btn">Sign in</button>' : ''
          }</div>`;
          document.getElementById('signin-btn')?.addEventListener('click', () =>
            vscode.postMessage({ type: 'signIn' }));
        }
        break;
      case 'issueDetail':
        renderDetail(msg.issue, msg.comments);
        break;
      case 'copied': {
        const btn = detailEl.querySelector('#copy-btn');
        if (btn) {
          btn.textContent = 'Copied!';
          setTimeout(() => { if (btn) btn.textContent = 'Copy as prompt'; }, 1500);
        }
        break;
      }
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
```

```json
// extensions/null-tools/tsconfig.webview-issues.json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "none",
    "lib": ["ES2017", "DOM"],
    "outFile": "./lib/issues.js",
    "strict": true,
    "sourceMap": false,
    "skipLibCheck": true
  },
  "include": ["src/webview/issues.ts"]
}
```

Update `extensions/null-tools/package.json`'s `compile` script:

```json
"compile": "tsc -p tsconfig.json && tsc -p tsconfig.webview.json && tsc -p tsconfig.webview-issues.json"
```

- [ ] **Step 2: Compile to verify it type-checks and produces the bundle**

Run: `cd extensions/null-tools && npm run compile`
Expected: No errors; `extensions/null-tools/lib/issues.js` is created.

- [ ] **Step 3: Commit**

```bash
git add extensions/null-tools/src/webview/issues.ts extensions/null-tools/tsconfig.webview-issues.json extensions/null-tools/package.json
git commit -m "feat(null-tools): add Issues panel webview renderer"
```

---

### Task 9: Wire up commands, view registration, and package.json contributes

**Files:**
- Create: `extensions/null-tools/src/issuesPanelIntegration.ts`
- Modify: `extensions/null-tools/src/extension.ts:14` (import), `extensions/null-tools/src/extension.ts:283` (call registration alongside `registerPortsFeature`)
- Modify: `extensions/null-tools/package.json` (`commands`, `views.null-agents`, `menus.view/title`, `menus.commandPalette`)

**Interfaces:**
- Consumes: `IssuesStore` from `./github/issuesStore` (Task 6); `IssuesViewProvider` from `./issuesPanel` (Task 7).
- Produces: `registerIssuesPanelFeature(context: vscode.ExtensionContext): void`, commands `null.issues.refresh` and `null.issues.signIn`, view id `null.issuesView`.

- [ ] **Step 1: Write the implementation**

```typescript
// extensions/null-tools/src/issuesPanelIntegration.ts
'use strict';

import * as vscode from 'vscode';
import { IssuesStore } from './github/issuesStore';
import { IssuesViewProvider } from './issuesPanel';

export function registerIssuesPanelFeature(context: vscode.ExtensionContext): void {
  const store = new IssuesStore();
  const provider = new IssuesViewProvider(context.extensionUri, store);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('null.issuesView', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.refresh', () => provider.refresh()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('null.issues.signIn', () => provider.signIn()),
  );
}
```

In `extensions/null-tools/src/extension.ts`, add the import next to the other integration imports (near line 14):

```typescript
import { registerAgentsPanelFeature } from './agentsPanelIntegration';
import { registerIssuesPanelFeature } from './issuesPanelIntegration';
```

And register it next to the other feature registrations near the bottom of `activate()` (near line 283, alongside `registerPortsFeature(context);`):

```typescript
  registerPortsFeature(context);
  registerIssuesPanelFeature(context);
  registerDiscordPresenceFeature(context);
  registerOpenInNullNotesFeature(context);
```

In `extensions/null-tools/package.json`, add to `contributes.commands` (near the other `null.agentsPaste`-style entries):

```json
{
  "command": "null.issues.refresh",
  "title": "Null: Refresh GitHub Issues",
  "icon": "$(refresh)"
},
{
  "command": "null.issues.signIn",
  "title": "Null: Sign in to GitHub"
}
```

Add a second view to `contributes.views["null-agents"]` (currently only `null.agentsView`):

```json
"null-agents": [
  {
    "type": "webview",
    "id": "null.agentsView",
    "name": "Claude Code",
    "visibility": "visible"
  },
  {
    "type": "webview",
    "id": "null.issuesView",
    "name": "GitHub Issues",
    "visibility": "visible"
  }
],
```

Add to `contributes.menus["view/title"]`:

```json
{
  "command": "null.issues.refresh",
  "when": "view == null.issuesView",
  "group": "navigation"
}
```

Add to `contributes.menus.commandPalette`:

```json
{ "command": "null.issues.refresh" },
{ "command": "null.issues.signIn" }
```

- [ ] **Step 2: Compile to verify it type-checks**

Run: `cd extensions/null-tools && npm run compile`
Expected: No errors.

- [ ] **Step 3: Manual smoke test in the real local install**

This feature touches `vscode.authentication` and live network calls, which have no automated coverage in this codebase (see Tasks 4–7) — verify it by hand using the project's existing local-install sync workflow (the `verify-local` skill, or directly: `pwsh -File scripts/sync-local.ps1`) against a real Null IDE install, then in that running instance:

1. Open this repo (`D:\Coding\Apps\null-ide`) as a folder.
2. Open the secondary sidebar's "AI Agents" activity bar icon; confirm a new "GitHub Issues" view appears below "Claude Code".
3. If prompted (or via the panel's "Sign in" button), authenticate with GitHub. Confirm the issue list populates for `TorresVisual/null-ide`.
4. Switch the state dropdown between Open / Closed / All; confirm the list changes accordingly and no pull requests appear in it.
5. Type a label name (e.g. `enhancement`) into the labels filter; confirm the list narrows to issues carrying that label. Type two comma-separated labels that don't share an issue; confirm the list goes empty (AND semantics).
6. Type into the search box; confirm the list narrows by title/body match.
7. Click "Assigned to me" with no matching issues; confirm the list goes empty rather than showing everyone's issues.
8. Click issue #43 in the list; confirm the detail pane shows its title, body, and comments.
9. Click "Copy as prompt"; confirm the button briefly shows "Copied!" and pasting elsewhere yields `#43 <title>\n\n<body>\n\n<url>`.
10. Click "Open in Browser"; confirm it opens the issue on github.com.
11. Close a workspace folder (or open a non-git folder) and confirm the panel shows the "Open a folder…" / "This folder has no GitHub remote." empty states instead of erroring.

Expected: All eleven checks pass.

- [ ] **Step 4: Commit**

```bash
git add extensions/null-tools/src/issuesPanelIntegration.ts extensions/null-tools/src/extension.ts extensions/null-tools/package.json
git commit -m "feat(null-tools): register GitHub Issues panel view and commands"
```

---

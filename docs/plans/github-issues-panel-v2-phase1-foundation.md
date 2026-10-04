# GitHub Issues Panel v2, Phase 1 (Foundation): Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Fix the root causes of #106 (unauthenticated or silently dropped writes, unreadable API errors, double-submit), and lay down the shared webview foundation (octicons, relative time, GitHub label styles, state icons, external CSS) that Phases 2–6 build on. The panel should visibly start looking like github.com.

**Architecture:** `IssuesStore.ensureSession()` becomes the single guard every GitHub call goes through, instead of cached `repo`/`token` fields that can be stale or null. `requestJson` keeps GitHub's error body and turns it into a readable message via a pure `formatApiError`. On the webview side, new `src/webview/shared/*.ts` script files are concatenated into both bundles through their tsconfig `include` (the existing `module: none` + `outFile` model). They are unit-tested by loading a compiled bundle into a `node:vm` sandbox. Inline `<style>` blocks move to `lib/*.css`.

**Tech Stack:** TypeScript 5.8, VS Code extension API (`^1.85.0`), vanilla DOM webviews, `node:test`, `@primer/octicons` 19.38.0 (data copied into source by a script; not a dependency).

**Spec:** [docs/specs/github-issues-panel-v2-design.md](../specs/github-issues-panel-v2-design.md) (this plan covers "Delivery phases → 1. Foundation")

**Deviations from the spec's Phase 1 list** (each moves code to the phase that first uses it, so nothing ships unused):
- `requestGraphql` → Phase 2, next to `SEARCH_ISSUES`, its first caller. `formatApiError` already handles GraphQL `errors[]` so Phase 2 can reuse it.
- `shared/dom.ts` (`reconcile`) → Phase 2. `shared/picker.ts` → Phase 3. `shared/composer.ts` → Phase 4.
- The spec's single `lib/issues.css` becomes `lib/issues.css` (shared GitHub look) plus `lib/issueList.css` and `lib/issueDetail.css` (the moved per-view styles). The two view styles clash on shared class names (`.dropdown-trigger`, `.tag`, `#empty`), and Phases 2–4 rewrite them anyway.
- #106 cause 3 (double-submit) and the empty-title half of cause 4 are fixed here on the existing create form, rather than waiting for Phase 4's new form, because the bug is live now.

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

- Work only inside `D:\Coding\Apps\null-ide\` (CLAUDE.md scope rule). All paths below are relative to `extensions/null-tools/` unless they start with `docs/` or `DESIGN.md`.
- Edit TypeScript sources only; never hand-edit compiled output (`out/*.js`, `lib/issues.js`, `lib/issueDetail.js`). `out/` and `lib/*.js` **are tracked in git**: after `npm run compile`, stage them in the same commit as their source.
- Unit tests only cover files that don't `import 'vscode'` (repo convention). The main `tsconfig.json` has an explicit `include` list: every new `*.test.ts` must be added there *and* to the `test` script in `package.json`.
- Webview files are `module: none` scripts: no `import`/`export`. Top-level names share one global scope per bundle, so every top-level identifier in `src/webview/shared/` must be unique across all files in that bundle.
- No new runtime or dev dependencies. `@primer/octicons` is only downloaded into a temp dir to run the generator.
- Colors: theme variables only (`var(--vscode-*)`), with no hex fallbacks in new CSS. The one exception is label colors, which are repo data. Issue state colors (decided 2026-09-28): open = `--vscode-charts-green`, completed = `--vscode-charts-purple`, not planned = `--vscode-descriptionForeground`.
- Commit messages: conventional style (`fix(null-tools): …`, `feat(null-tools): …`), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.
- Run all `npm` commands from `extensions/null-tools/`.

## Review Focus

1. **Write while signed out.** Clicking Create / Comment / Close with no GitHub session must show VS Code's sign-in prompt. If that's dismissed, an error toast "Sign in to GitHub to continue." appears, never a silent no-op. Checked in Task 7 Step 3.
2. **Switching to a folder with a different GitHub repo.** Label and assignee pickers must show the *new* repo's labels, not the previous repo's cached ones (the cache paint path must reset them too). Checked in Task 2 Step 1 (`setRepo` shared by both paths) and Task 7 Step 3.
3. **Label colors at the extremes.** A white `ffffff` label in a light theme needs a visible border. A near-black label in a dark theme needs lightened, readable text. The HSL conversion is pinned in Task 4 Step 1. Rendering is checked in Task 7 Step 4.
4. **Clock skew.** A timestamp slightly in the future (local clock behind GitHub's) must render "just now", not "-3 minutes ago". Pinned in Task 4 Step 1.
5. **Non-JSON error bodies** (a proxy's HTML 502 page). The toast must read "GitHub API 502" with no HTML dumped into it. Pinned in Task 1 Step 1.

---

### Task 1: Readable GitHub API errors (`formatApiError`)

**Files:**
- Modify: `src/github/githubApi.ts:8-41` (`requestJson`), plus a new exported function
- Create: `src/github/githubApi.test.ts`
- Modify: `tsconfig.json` (`include`), `package.json` (`test` script)

**Interfaces:**
- Consumes: nothing.
- Produces: `export function formatApiError(status: number, body: string): string`. `requestJson` now rejects with `new Error(formatApiError(status, body))` for every non-2xx response. Phase 2's `requestGraphql` will call `formatApiError(200, body)` for GraphQL `errors[]`.

- [ ] **Step 1: Write the failing test**

Create `src/github/githubApi.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { formatApiError } from './githubApi';

test('formatApiError: REST validation error lists each field error', () => {
  const body = JSON.stringify({
    message: 'Validation Failed',
    errors: [{ resource: 'Issue', code: 'invalid', field: 'assignees' }],
  });
  assert.strictEqual(formatApiError(422, body), 'GitHub API 422: Validation Failed · assignees invalid');
});

test("formatApiError: prefers an error entry's own message", () => {
  const body = JSON.stringify({
    message: 'Validation Failed',
    errors: [{ message: "Could not resolve to a User with the login of 'ghost'." }],
  });
  assert.strictEqual(
    formatApiError(422, body),
    "GitHub API 422: Validation Failed · Could not resolve to a User with the login of 'ghost'.",
  );
});

test('formatApiError: plain message, documentation_url ignored', () => {
  const body = JSON.stringify({ message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' });
  assert.strictEqual(formatApiError(401, body), 'GitHub API 401: Bad credentials');
});

test('formatApiError: string entries in errors[]', () => {
  const body = JSON.stringify({ message: 'Validation Failed', errors: ['title is too long'] });
  assert.strictEqual(formatApiError(422, body), 'GitHub API 422: Validation Failed · title is too long');
});

test('formatApiError: GraphQL errors on a 200 response', () => {
  const body = JSON.stringify({ errors: [{ message: "Field 'foo' doesn't exist on type 'Issue'" }] });
  assert.strictEqual(formatApiError(200, body), "GitHub API error: Field 'foo' doesn't exist on type 'Issue'");
});

test('formatApiError: non-JSON body (proxy HTML) shows only the status', () => {
  assert.strictEqual(formatApiError(502, '<html><body>Bad gateway</body></html>'), 'GitHub API 502');
});

test('formatApiError: empty or null body', () => {
  assert.strictEqual(formatApiError(404, ''), 'GitHub API 404');
  assert.strictEqual(formatApiError(500, 'null'), 'GitHub API 500');
});
```

In `tsconfig.json`, add `"src/github/githubApi.test.ts"` to the `include` array (after `"src/github/issueTemplates.test.ts"`).

In `package.json`, append ` out/github/githubApi.test.js` to the end of the `test` script's `node --test …` file list.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsc -p tsconfig.json`
Expected: FAIL with `error TS2305: Module '"./githubApi"' has no exported member 'formatApiError'.`

- [ ] **Step 3: Implement `formatApiError` and use it in `requestJson`**

In `src/github/githubApi.ts`, add above `requestJson`:

```ts
interface ApiErrorBody {
  message?: string;
  errors?: Array<string | { message?: string; field?: string; code?: string }>;
}

/** User-facing message for a failed GitHub REST or GraphQL call, keeping GitHub's own explanation. */
export function formatApiError(status: number, body: string): string {
  const prefix = status >= 200 && status < 300 ? 'GitHub API error' : `GitHub API ${status}`;
  let parsed: ApiErrorBody | null;
  try {
    parsed = JSON.parse(body) as ApiErrorBody | null;
  } catch {
    return prefix;
  }
  if (!parsed || typeof parsed !== 'object') return prefix;
  const details = (parsed.errors ?? []).map(e =>
    typeof e === 'string' ? e : e.message ?? [e.field, e.code].filter(Boolean).join(' '));
  const parts = [parsed.message, ...details].filter(Boolean);
  return parts.length > 0 ? `${prefix}: ${parts.join(' · ')}` : prefix;
}
```

Replace the response callback inside `requestJson` (currently the `res => { if (!res.statusCode || … ) { res.resume(); reject(…); return; } let data = ''; … }` block) with:

```ts
    const req = https.request(`https://api.github.com${path}`, { method, headers }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          reject(new Error(formatApiError(status, data)));
          return;
        }
        if (!data) { resolve(undefined as T); return; }
        try { resolve(JSON.parse(data) as T); }
        catch (err) { reject(err as Error); }
      });
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc -p tsconfig.json && node --test out/github/githubApi.test.js`
Expected: PASS, 7 tests.

Then run the full suite: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Compile and commit**

```bash
npm run compile
git add src/github/githubApi.ts src/github/githubApi.test.ts tsconfig.json package.json out/
git commit -m "fix(null-tools): surface GitHub's error message in Issues panel failures

Part of #106: requestJson discarded the response body, so a 422 read as
'GitHub API 422: /repos/...'. formatApiError keeps GitHub's message and
field errors, and also handles GraphQL errors[] for Phase 2.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `ensureSession()`: one guard for every GitHub call

**Files:**
- Modify: `src/github/issuesStore.ts` (whole file, shown below)
- Modify: `src/issuesPanel.ts:151-203` (`_sendIssues`, `setFilters` case)
- Modify: `src/issueDetailPanel.ts:91-105` (`_sendDetail` create branch), `:234-246` (`submitCreate`)
- Modify: `src/issuesPanelIntegration.ts:12` (store construction)

**Interfaces:**
- Consumes: `formatApiError` messages (Task 1) arrive as `Error.message` from every store call.
- Produces:
  - `new IssuesStore(getCwd: () => string | null)`
  - `IssuesStore.ensureSession(interactive: boolean): Promise<{ repo: GithubRepoRef; token: string }>`. Throws `SessionError`.
  - `export class SessionError extends Error { readonly status: 'no-workspace' | 'no-remote' | 'signed-out' }`
  - `IssuesStore.refresh(state: IssueState): Promise<IssuesResult>` (the `cwd` parameter is removed).
  - Writes now resolve to non-null values: `updateIssue → Promise<GithubIssue>`, `createIssue → Promise<GithubIssue>`, `addComment → Promise<GithubComment>`, `updateComment → Promise<GithubComment>`. `getRepoLabels`/`getAssignableUsers`/`getComments`/`getTimeline`/`reloadIssue` reject instead of returning empty values when there is no session.

`issuesStore.ts` imports `vscode` (through `githubAuth.ts`), so it is verified manually, not by `node --test` (repo convention; see the spec's Testing section).

- [ ] **Step 1: Rewrite `src/github/issuesStore.ts`**

Replace the whole file with:

```ts
'use strict';

import { getWorkspaceGithubRepo } from './githubRemote';
import { getGithubSession } from './githubAuth';
import {
  createComment, createIssue, deleteComment, fetchAssignableUsers, fetchComments, fetchIssue, fetchIssues, fetchRepoLabels,
  fetchTimeline, updateComment, updateIssue,
} from './githubApi';
import { filterIssues } from './issueFilter';
import {
  GithubComment, GithubIssue, GithubLabel, GithubRepoRef, GithubTimelineEvent, GithubUser, IssueFilterOptions,
  IssueState,
} from './types';

export type IssuesResult =
  | { status: 'no-workspace' }
  | { status: 'no-remote' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | { status: 'ok'; repo: GithubRepoRef; issues: GithubIssue[]; viewerLogin: string | null };

type SessionStatus = 'no-workspace' | 'no-remote' | 'signed-out';

const SESSION_MESSAGES: Record<SessionStatus, string> = {
  'no-workspace': 'Open a folder to use GitHub issues.',
  'no-remote': 'This folder has no GitHub remote.',
  'signed-out': 'Sign in to GitHub to continue.',
};

/** Why no GitHub session could be established; `refresh()` maps it to the panel's status screens. */
export class SessionError extends Error {
  constructor(readonly status: SessionStatus) {
    super(SESSION_MESSAGES[status]);
  }
}

type IssuePatch = { title?: string; body?: string; state?: 'open' | 'closed'; labels?: string[]; assignees?: string[] };

export class IssuesStore {
  private issues: GithubIssue[] = [];
  private repo: GithubRepoRef | null = null;
  private repoLabels: GithubLabel[] | null = null;
  private assignableUsers: GithubUser[] | null = null;
  private viewerLogin: string | null = null;

  constructor(private readonly getCwd: () => string | null) {}

  /** Seeds in-memory state from a persisted cache, without a network call. */
  hydrateFromCache(repo: GithubRepoRef, issues: GithubIssue[], viewerLogin: string | null): void {
    this.setRepo(repo);
    this.issues = issues;
    this.viewerLogin = viewerLogin;
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
    const session = await getGithubSession(interactive);
    if (!session) throw new SessionError('signed-out');
    this.setRepo(repo);
    this.viewerLogin = session.account.label;
    return { repo, token: session.accessToken };
  }

  /** Switches the active repo, dropping every per-repo cache when it actually changes. */
  private setRepo(repo: GithubRepoRef): void {
    if (this.repo && (this.repo.owner !== repo.owner || this.repo.repo !== repo.repo)) {
      this.issues = [];
      this.repoLabels = null;
      this.assignableUsers = null;
    }
    this.repo = repo;
  }

  async refresh(state: IssueState): Promise<IssuesResult> {
    try {
      const { repo, token } = await this.ensureSession(false);
      this.issues = await fetchIssues(repo.owner, repo.repo, state, token);
      return { status: 'ok', repo, issues: this.issues, viewerLogin: this.viewerLogin };
    } catch (err) {
      if (err instanceof SessionError) return { status: err.status };
      return { status: 'error', message: (err as Error).message };
    }
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

  getFiltered(opts: IssueFilterOptions): GithubIssue[] {
    return filterIssues(this.issues, opts);
  }

  getByNumber(number: number): GithubIssue | undefined {
    return this.issues.find(issue => issue.number === number);
  }

  getAllIssues(): GithubIssue[] {
    return this.issues;
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

  /** Re-fetches one issue from GitHub and replaces it in the cache, without refetching the whole list. */
  async reloadIssue(issueNumber: number): Promise<void> {
    const { repo, token } = await this.ensureSession(false);
    const fresh = await fetchIssue(repo.owner, repo.repo, issueNumber, token);
    this.issues = this.issues.map(issue => (issue.number === issueNumber ? fresh : issue));
  }

  async updateIssue(issueNumber: number, patch: IssuePatch): Promise<GithubIssue> {
    const { repo, token } = await this.ensureSession(true);
    const updated = await updateIssue(repo.owner, repo.repo, issueNumber, patch, token);
    this.issues = this.issues.map(issue => (issue.number === issueNumber ? updated : issue));
    return updated;
  }

  async createIssue(
    data: { title: string; body?: string; labels?: string[]; assignees?: string[] },
  ): Promise<GithubIssue> {
    const { repo, token } = await this.ensureSession(true);
    const created = await createIssue(repo.owner, repo.repo, data, token);
    this.issues = [created, ...this.issues];
    return created;
  }

  async addComment(issueNumber: number, body: string): Promise<GithubComment> {
    const { repo, token } = await this.ensureSession(true);
    const comment = await createComment(repo.owner, repo.repo, issueNumber, body, token);
    this.issues = this.issues.map(issue =>
      issue.number === issueNumber ? { ...issue, comments: issue.comments + 1 } : issue,
    );
    return comment;
  }

  async updateComment(commentId: number, body: string): Promise<GithubComment> {
    const { repo, token } = await this.ensureSession(true);
    return updateComment(repo.owner, repo.repo, commentId, body, token);
  }

  async deleteComment(issueNumber: number, commentId: number): Promise<void> {
    const { repo, token } = await this.ensureSession(true);
    await deleteComment(repo.owner, repo.repo, commentId, token);
    this.issues = this.issues.map(issue =>
      issue.number === issueNumber ? { ...issue, comments: Math.max(0, issue.comments - 1) } : issue,
    );
  }
}
```

- [ ] **Step 2: Construct the store with a cwd getter**

In `src/issuesPanelIntegration.ts`, replace `const store = new IssuesStore();` with:

```ts
  const store = new IssuesStore(() => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null);
```

- [ ] **Step 3: Update the list panel's callers**

In `src/issuesPanel.ts` `_sendIssues()`, replace:

```ts
    const result = await this._store.refresh(cwd, this._state);
```
with:
```ts
    const result = await this._store.refresh(this._state);
```

and replace:

```ts
    const repoLabels = await this._store.getRepoLabels();
```
with:
```ts
    // A failed label fetch must not blank a list that just loaded fine.
    const repoLabels = await this._store.getRepoLabels().catch((): GithubLabel[] => []);
```

In the `case 'setFilters':` branch of `_handleMessage`, replace `repoLabels: await this._store.getRepoLabels(),` with:

```ts
          repoLabels: await this._store.getRepoLabels().catch((): GithubLabel[] => []),
```

(`GithubLabel` is already imported at the top of `issuesPanel.ts`.)

- [ ] **Step 4: Update the detail panel's callers**

In `src/issueDetailPanel.ts` `_sendDetail()`, replace the create branch's fetch:

```ts
      const [repoLabels, assignableUsers] = await Promise.all([
        this.store.getRepoLabels(),
        this.store.getAssignableUsers(),
      ]);
```
with:
```ts
      let repoLabels, assignableUsers;
      try {
        [repoLabels, assignableUsers] = await Promise.all([
          this.store.getRepoLabels(),
          this.store.getAssignableUsers(),
        ]);
      } catch (err) {
        this.panel.webview.postMessage({ type: 'issueDetailError', message: (err as Error).message });
        return;
      }
```

In the `case 'submitCreate':` branch, replace the whole `try { … } catch { … }` with:

```ts
        try {
          const created = await this.store.createIssue({
            title: msg.title, body: msg.body, labels: msg.labels, assignees: msg.assignees,
          });
          this.onCreated?.();
          await this.openIssue(created.number);
        } catch (err) {
          void vscode.window.showErrorMessage(`Failed to create issue: ${(err as Error).message}`);
          this.panel.webview.postMessage({ type: 'createFailed' });
        }
```

(The webview handles `createFailed` in Task 3. Until then the message is simply ignored.)

- [ ] **Step 5: Type-check and run the suite**

Run: `npm test`
Expected: compiles with no errors; all tests pass.

- [ ] **Step 6: Compile and commit**

```bash
npm run compile
git add src/github/issuesStore.ts src/issuesPanel.ts src/issueDetailPanel.ts src/issuesPanelIntegration.ts out/
git commit -m "fix(null-tools): route every GitHub call through ensureSession (#106)

hydrateFromCache set repo but not token, so creating from a cached list
POSTed unauthenticated; and New Issue from the Command Palette before the
sidebar loaded found repo === null and silently did nothing. Every store
call now resolves repo + token itself, prompting for sign-in on writes.
Per-repo caches also reset on the cache-paint path, not just on refresh.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Create form, no double-submit and a visible title error

**Files:**
- Modify: `src/webview/issueDetail.ts`: `renderCreateForm()` markup (the `<input id="edit-title" placeholder="Title">` line) and its `save-btn` handler; the `window.addEventListener('message', …)` switch
- Modify: `src/issueDetailPanel.ts`: inline `<style>` block (two rules added)

**Interfaces:**
- Consumes: host posts `{ type: 'createFailed' }` on failure (Task 2 Step 4).
- Produces: nothing new for later tasks.

Webview behavior has no automated harness in this repo; it is verified manually in Task 7.

- [ ] **Step 1: Add the title error element**

In `renderCreateForm()`, replace:

```ts
        <input id="edit-title" placeholder="Title">
```
with:
```ts
        <input id="edit-title" placeholder="Title">
        <div id="title-error" class="field-error hidden">Title is required.</div>
```

- [ ] **Step 2: Guard the Create button**

In `renderCreateForm()`, replace the whole `document.getElementById('save-btn')?.addEventListener('click', () => { … });` handler with:

```ts
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
      vscode.postMessage({
        type: 'submitCreate', title,
        body: (document.getElementById('edit-body') as HTMLTextAreaElement).value,
        labels: Array.from(selectedLabels), assignees: Array.from(selectedAssignees),
      });
    });
```

- [ ] **Step 3: Re-enable on failure**

In the webview's `window.addEventListener('message', …)` switch, add after the `case 'commentPostFailed': { … }` block:

```ts
      case 'createFailed': {
        const btn = detailEl.querySelector<HTMLButtonElement>('#save-btn');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Create';
        }
        break;
      }
```

- [ ] **Step 4: Style the error**

In `src/issueDetailPanel.ts`'s inline `<style>` block, add directly before the closing `</style>` line (after the `#empty { … }` rule):

```css
  .field-error { color:var(--vscode-errorForeground); font-size:.9em; margin:-4px 0 8px; }
  .field-error.hidden { display:none; }
```

- [ ] **Step 5: Compile**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/webview/issueDetail.ts src/issueDetailPanel.ts lib/issueDetail.js out/
git commit -m "fix(null-tools): prevent duplicate issues and silent empty-title create (#106)

Create is disabled while the request is in flight (a double-click made two
issues) and re-enabled on failure; an empty title now shows an inline error
instead of doing nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shared webview modules (octicons, relative time, label colors, issue state)

**Files:**
- Create: `scripts/gen-octicons.js`
- Create (generated): `src/webview/shared/octicons.ts`
- Create: `src/webview/shared/time.ts`
- Create: `src/webview/shared/labels.ts`
- Create: `src/webview/shared/issueState.ts`
- Create: `tsconfig.webview-shared.json`
- Create: `src/webviewShared.test.ts`
- Modify: `tsconfig.json` (`include`), `package.json` (`test` script)

**Interfaces:**
- Consumes: nothing.
- Produces (global script functions, available in any bundle that `include`s the files):
  - `octicon(name: string, className?: string): string`: 16px inline SVG, `fill="currentColor"`, class `octicon <className>`.
  - `relativeTime(iso: string, now?: number): string` and `timeHtml(iso: string): string` (a `<time>` element with the exact local time in `title`).
  - `rgbToHsl(r: number, g: number, b: number): [number, number, number]` and `labelStyleVars(hex: string): string`. The latter returns `--label-r:…;--label-g:…;--label-b:…;--label-h:…;--label-s:…;--label-l:…` for a `style` attribute on a `.gh-label` element.
  - `issueStateKind(state: string, stateReason?: string | null): 'open' | 'completed' | 'not-planned'` (case-insensitive, so it also accepts GraphQL's `OPEN`/`NOT_PLANNED` in Phase 2), `issueStateIcon(state, stateReason?)`, `issueStateBadge(state, stateReason?)`.

- [ ] **Step 1: Write the failing test and its build config**

Create `tsconfig.webview-shared.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "none",
    "lib": ["ES2017", "DOM"],
    "outFile": "./out/webview-shared.js",
    "strict": true,
    "sourceMap": false,
    "skipLibCheck": true
  },
  "include": [
    "src/webview/shared/octicons.ts",
    "src/webview/shared/time.ts",
    "src/webview/shared/labels.ts",
    "src/webview/shared/issueState.ts"
  ]
}
```

Create `src/webviewShared.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Webview bundles are plain scripts (module: none), so load the compiled shared files into a
// sandbox and read their top-level functions off it. Built by `tsc -p tsconfig.webview-shared.json`.
const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);
const shared = sandbox as unknown as {
  relativeTime(iso: string, now?: number): string;
  rgbToHsl(r: number, g: number, b: number): [number, number, number];
  labelStyleVars(hex: string): string;
  issueStateKind(state: string, stateReason?: string | null): string;
  octicon(name: string, className?: string): string;
};

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

test('relativeTime: seconds, minutes, hours', () => {
  assert.strictEqual(shared.relativeTime('2026-09-28T11:59:30Z', NOW), 'just now');
  assert.strictEqual(shared.relativeTime('2026-09-28T11:59:00Z', NOW), '1 minute ago');
  assert.strictEqual(shared.relativeTime('2026-09-28T11:15:00Z', NOW), '45 minutes ago');
  assert.strictEqual(shared.relativeTime('2026-09-28T09:00:00Z', NOW), '3 hours ago');
});

test('relativeTime: a future timestamp (clock skew) reads "just now"', () => {
  assert.strictEqual(shared.relativeTime('2026-09-28T12:05:00Z', NOW), 'just now');
});

test('relativeTime: days, then absolute dates', () => {
  assert.strictEqual(shared.relativeTime('2026-09-27T10:00:00Z', NOW), 'yesterday');
  assert.strictEqual(shared.relativeTime('2026-09-16T12:00:00Z', NOW), '12 days ago');
  assert.strictEqual(shared.relativeTime('2026-08-01T12:00:00Z', NOW), 'on Aug 1');
  assert.strictEqual(shared.relativeTime('2025-03-03T12:00:00Z', NOW), 'on Mar 3, 2025');
});

test('rgbToHsl matches known GitHub label colors', () => {
  // Arrays from the vm realm have a different Array.prototype; copy before deep-comparing.
  assert.deepStrictEqual(Array.from(shared.rgbToHsl(215, 58, 74)), [354, 66, 54]);   // d73a4a "bug"
  assert.deepStrictEqual(Array.from(shared.rgbToHsl(0, 117, 202)), [205, 100, 40]);  // 0075ca "documentation"
  assert.deepStrictEqual(Array.from(shared.rgbToHsl(162, 238, 239)), [181, 71, 79]); // a2eeef "enhancement"
  assert.deepStrictEqual(Array.from(shared.rgbToHsl(255, 255, 255)), [0, 0, 100]);
  assert.deepStrictEqual(Array.from(shared.rgbToHsl(0, 0, 0)), [0, 0, 0]);
});

test('labelStyleVars emits the custom properties the .gh-label CSS computes from', () => {
  const expected = '--label-r:215;--label-g:58;--label-b:74;--label-h:354;--label-s:66;--label-l:54';
  assert.strictEqual(shared.labelStyleVars('d73a4a'), expected);
  assert.strictEqual(shared.labelStyleVars('#d73a4a'), expected);
});

test('issueStateKind maps REST and GraphQL state + reason', () => {
  assert.strictEqual(shared.issueStateKind('open', null), 'open');
  assert.strictEqual(shared.issueStateKind('OPEN', 'REOPENED'), 'open');
  assert.strictEqual(shared.issueStateKind('closed', 'completed'), 'completed');
  assert.strictEqual(shared.issueStateKind('closed', null), 'completed');
  assert.strictEqual(shared.issueStateKind('closed', 'not_planned'), 'not-planned');
  assert.strictEqual(shared.issueStateKind('CLOSED', 'NOT_PLANNED'), 'not-planned');
});

test('octicon renders a generated path and tolerates unknown names', () => {
  assert.match(shared.octicon('issue-opened', 'x'), /^<svg class="octicon x" [^>]*><path d="/);
  assert.match(shared.octicon('no-such-icon'), /<svg[^>]*><\/svg>/);
});
```

In `tsconfig.json`, add `"src/webviewShared.test.ts"` to `include`.

In `package.json`, change the start of the `test` script from `tsc -p tsconfig.json && node --test` to `tsc -p tsconfig.json && tsc -p tsconfig.webview-shared.json && node --test`, and append ` out/webviewShared.test.js` to the end of the file list.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL. `tsc -p tsconfig.webview-shared.json` reports `error TS18003: No inputs were found in config file` (the shared files don't exist yet).

- [ ] **Step 3: Write and run the octicon generator**

Create `scripts/gen-octicons.js`:

```js
// Regenerates src/webview/shared/octicons.ts from @primer/octicons (MIT) build data.
// Usage (from extensions/null-tools/):
//   cd "$TMP" && npm pack @primer/octicons && tar xzf primer-octicons-*.tgz   # → $TMP/package
//   node scripts/gen-octicons.js "$TMP/package"
// To add an icon: add its name to NAMES and re-run.
'use strict';

const fs = require('fs');
const path = require('path');

const NAMES = [
  'issue-opened', 'issue-closed', 'skip', 'comment', 'copy', 'check', 'link-external', 'git-branch',
];

const pkgDir = process.argv[2];
if (!pkgDir) {
  console.error('usage: node scripts/gen-octicons.js <path to extracted @primer/octicons package>');
  process.exit(1);
}
const data = require(path.resolve(pkgDir, 'build', 'data.json'));
const version = require(path.resolve(pkgDir, 'package.json')).version;

const entries = NAMES.map(name => {
  const icon = data[name] && data[name].heights['16'];
  if (!icon) throw new Error(`octicon not found at 16px: ${name}`);
  return `  '${name}': ${JSON.stringify(icon.path)},`;
});

const out = `'use strict';

// Generated by scripts/gen-octicons.js from @primer/octicons ${version} (MIT). Do not edit by hand:
// add names to NAMES in the script and re-run it.
const OCTICON_PATHS: Record<string, string> = {
${entries.join('\n')}
};

/** Inline 16px Primer octicon; takes its color from CSS via fill="currentColor". */
function octicon(name: string, className = ''): string {
  return \`<svg class="octicon \${className}" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">\${OCTICON_PATHS[name] ?? ''}</svg>\`;
}
`;

const target = path.join(__dirname, '..', 'src', 'webview', 'shared', 'octicons.ts');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, out);
console.log(`wrote ${NAMES.length} octicons from @primer/octicons ${version} to ${target}`);
```

Run (Git Bash):

```bash
( cd "$TMP" && rm -rf package primer-octicons-*.tgz && npm pack @primer/octicons --silent && tar xzf primer-octicons-*.tgz )
node scripts/gen-octicons.js "$TMP/package"
```
Expected: `wrote 8 octicons from @primer/octicons 19.38.0 to …\src\webview\shared\octicons.ts` (a newer version number is fine).

- [ ] **Step 4: Write `time.ts`, `labels.ts`, `issueState.ts`**

Create `src/webview/shared/time.ts`:

```ts
'use strict';

const TIME_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** github.com-style relative time: "just now", "5 minutes ago", "yesterday", "12 days ago", "on Sep 3[, 2024]". */
function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso);
  const seconds = Math.floor((now - then.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const date = `${TIME_MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === new Date(now).getFullYear() ? `on ${date}` : `on ${date}, ${then.getFullYear()}`;
}

/** Relative time with the exact local timestamp on hover, like github.com's <relative-time>. */
function timeHtml(iso: string): string {
  return `<time datetime="${iso}" title="${new Date(iso).toLocaleString()}">${relativeTime(iso)}</time>`;
}
```

Create `src/webview/shared/labels.ts`:

```ts
'use strict';

/** RGB 0–255 → HSL rounded to integers: [hue 0–360, saturation 0–100, lightness 0–100]. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

/**
 * CSS custom properties for a GitHub label hex color ("d73a4a"). The .gh-label rules in lib/issues.css
 * compute background/text/border from these exactly like github.com's own label CSS, per theme.
 */
function labelStyleVars(hex: string): string {
  const clean = hex.replace(/^#/, '');
  const r = parseInt(clean.slice(0, 2), 16), g = parseInt(clean.slice(2, 4), 16), b = parseInt(clean.slice(4, 6), 16);
  const [h, s, l] = rgbToHsl(r, g, b);
  return `--label-r:${r};--label-g:${g};--label-b:${b};--label-h:${h};--label-s:${s};--label-l:${l}`;
}
```

Create `src/webview/shared/issueState.ts`:

```ts
'use strict';

/** github.com's three issue states. Accepts REST (`closed`/`not_planned`) and GraphQL (`CLOSED`/`NOT_PLANNED`) casing. */
function issueStateKind(state: string, stateReason?: string | null): 'open' | 'completed' | 'not-planned' {
  if (state.toLowerCase() === 'open') return 'open';
  return stateReason?.toLowerCase() === 'not_planned' ? 'not-planned' : 'completed';
}

/** Colored state octicon (open / closed-completed / closed-not-planned), as in github.com's issue lists. */
function issueStateIcon(state: string, stateReason?: string | null): string {
  const kind = issueStateKind(state, stateReason);
  const icon = kind === 'open' ? 'issue-opened' : kind === 'completed' ? 'issue-closed' : 'skip';
  return octicon(icon, `state-icon state-${kind}`);
}

/** The "◉ Open" / "✓ Closed" pill from github.com's issue header. */
function issueStateBadge(state: string, stateReason?: string | null): string {
  const kind = issueStateKind(state, stateReason);
  return `<span class="state-badge state-${kind}">${issueStateIcon(state, stateReason)}${kind === 'open' ? 'Open' : 'Closed'}</span>`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including the 7 new `webviewShared` tests and all existing ones.

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-octicons.js src/webview/shared/ tsconfig.webview-shared.json src/webviewShared.test.ts tsconfig.json package.json out/
git commit -m "feat(null-tools): add shared webview modules for the Issues panel v2

Primer octicons (generated from @primer/octicons), github.com-style
relative time, GitHub's label-color inputs, and the open/completed/
not-planned issue state; unit-tested through a vm-loaded bundle since
webview files are module-less scripts.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Move inline webview CSS into `lib/*.css` (no visual change)

**Files:**
- Create: `lib/issueList.css` (moved from `src/issuesPanel.ts` `_buildHtml` `<style>` block)
- Create: `lib/issueDetail.css` (moved from `src/issueDetailPanel.ts` `_buildHtml` `<style>` block, including Task 3's two rules)
- Modify: `src/issuesPanel.ts` (`_buildHtml`), `src/issueDetailPanel.ts` (`_buildHtml`)

**Interfaces:**
- Consumes: nothing.
- Produces: both views load their styles from `lib/`, so Task 6 can add `lib/issues.css` next to them with one more `<link>`. The existing CSP `style-src ${webview.cspSource} 'unsafe-inline'` already allows `lib/` stylesheets, and `localResourceRoots` already includes `lib/`.

- [ ] **Step 1: Extract both style blocks verbatim**

Run (from `extensions/null-tools/`):

```bash
node -e "
const fs = require('fs');
for (const [ts, css] of [['src/issuesPanel.ts', 'lib/issueList.css'], ['src/issueDetailPanel.ts', 'lib/issueDetail.css']]) {
  const m = fs.readFileSync(ts, 'utf8').match(/<style>\r?\n([\s\S]*?)<\/style>/);
  if (!m) throw new Error('no <style> block in ' + ts);
  if (m[1].includes('\${')) throw new Error('template expression inside <style> in ' + ts);
  fs.writeFileSync(css, m[1].replace(/^  /gm, ''));
  console.log(css, m[1].split('\n').length, 'lines');
}"
```
Expected: two lines printed, `lib/issueList.css ~90 lines` and `lib/issueDetail.css ~153 lines`, and no error.

- [ ] **Step 2: Replace the list view's `<style>` block with a `<link>`**

In `src/issuesPanel.ts` `_buildHtml`, add after the `const scriptUri = …` line:

```ts
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'issueList.css'));
```

and replace everything from the line `<style>` through the line `</style></head><body>` (inclusive) with:

```ts
<link rel="stylesheet" href="${cssUri}">
</head><body>
```

- [ ] **Step 3: Same for the detail view**

In `src/issueDetailPanel.ts` `_buildHtml`, add after the `const purifyUri = …;` statement:

```ts
    const cssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'lib', 'issueDetail.css'),
    );
```

and replace everything from `<style>` through `</style></head><body>` (inclusive) with:

```ts
<link rel="stylesheet" href="${cssUri}">
</head><body>
```

- [ ] **Step 4: Compile and check nothing else changed**

Run: `npm run compile && git diff --stat`
Expected: compiles with no errors. The diff touches only `src/issuesPanel.ts`, `src/issueDetailPanel.ts`, `out/issuesPanel.js(.map)`, `out/issueDetailPanel.js(.map)`, and the two new CSS files are untracked. Styling is checked visually in Task 7.

- [ ] **Step 5: Commit**

```bash
git add lib/issueList.css lib/issueDetail.css src/issuesPanel.ts src/issueDetailPanel.ts out/
git commit -m "refactor(null-tools): move Issues panel styles out of TS template strings

Verbatim move of both inline <style> blocks to lib/issueList.css and
lib/issueDetail.css; no visual change.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: GitHub look: state icons, label styles, relative times

**Files:**
- Create: `lib/issues.css`
- Modify: `tsconfig.webview-issues.json`, `tsconfig.webview-issue-detail.json` (`include`)
- Delete: `src/webview/colorUtils.ts`
- Modify: `src/webview/issues.ts` (icon constants, `renderLabelPicker`, `renderList`)
- Modify: `src/webview/issueDetail.ts` (`renderPicker` tag, `timelineEventText`, `render`)
- Modify: `lib/issueList.css`, `lib/issueDetail.css` (remove superseded rules)
- Modify: `src/issuesPanel.ts`, `src/issueDetailPanel.ts` (`_buildHtml`: link `issues.css`)
- Modify: `src/github/types.ts` (`GithubIssue.state_reason`)
- Modify: `DESIGN.md:112` (state-color rule)

**Interfaces:**
- Consumes: `octicon`, `timeHtml`, `labelStyleVars`, `issueStateIcon`, `issueStateBadge` (Task 4); per-view CSS files (Task 5).
- Produces: `.gh-label`, `.state-icon.state-{open|completed|not-planned}`, `.state-badge.state-*`, `.octicon` classes in `lib/issues.css` for Phases 2–4.

- [ ] **Step 1: Point both bundles at the shared files**

In both `tsconfig.webview-issues.json` and `tsconfig.webview-issue-detail.json`, replace `"src/webview/colorUtils.ts"` in `include` with:

```json
"src/webview/shared/octicons.ts", "src/webview/shared/time.ts", "src/webview/shared/labels.ts", "src/webview/shared/issueState.ts"
```

Delete `src/webview/colorUtils.ts`.

- [ ] **Step 2: Add `state_reason` to the issue types**

In `src/github/types.ts`, add to `interface GithubIssue` after `state: 'open' | 'closed';`:

```ts
  /** Why a closed issue was closed; null while open or for issues closed before GitHub tracked reasons. */
  state_reason?: 'completed' | 'not_planned' | 'reopened' | null;
```

In both `src/webview/issues.ts` and `src/webview/issueDetail.ts`, change the local `interface GithubIssue` line `number: number; title: string; body: string; state: string; html_url: string;` to:

```ts
  number: number; title: string; body: string; state: string; state_reason?: string | null; html_url: string;
```

- [ ] **Step 3: Create `lib/issues.css`**

```css
/* Shared github.com look for the Issues panel views (list, detail). Loaded before the per-view CSS. */

:root {
  --gh-open: var(--vscode-charts-green);
  --gh-done: var(--vscode-charts-purple);
  --gh-neutral: var(--vscode-descriptionForeground);
}

.hidden { display:none !important; }

.octicon { display:inline-block; flex-shrink:0; vertical-align:text-bottom; overflow:visible; }

/* Issue state: open / closed as completed / closed as not planned. */
.state-icon.state-open { color:var(--gh-open); }
.state-icon.state-completed { color:var(--gh-done); }
.state-icon.state-not-planned { color:var(--gh-neutral); }

.state-badge {
  display:inline-flex; align-items:center; gap:4px; padding:4px 12px; border-radius:2em;
  font-size:13px; font-weight:500; line-height:20px; white-space:nowrap;
  /* The editor background is dark in dark themes and light in light ones, so it contrasts with the chart color. */
  color:var(--vscode-editor-background);
}
.state-badge .state-icon { color:inherit; }
.state-badge.state-open { background:var(--gh-open); }
.state-badge.state-completed { background:var(--gh-done); }
.state-badge.state-not-planned { background:var(--gh-neutral); }

/* GitHub labels: same formulas as github.com, fed by --label-r/g/b/h/s/l from labelStyleVars(). */
.gh-label {
  display:inline-block; padding:0 7px; margin-right:4px; font-size:12px; font-weight:500; line-height:18px;
  border:1px solid transparent; border-radius:2em; white-space:nowrap;
  --perceived-lightness: calc(((var(--label-r) * 0.2126) + (var(--label-g) * 0.7152) + (var(--label-b) * 0.0722)) / 255);
  --lightness-switch: max(0, min(calc(1 / (var(--lightness-threshold) - var(--perceived-lightness))), 1));
}
body.vscode-light .gh-label,
body.vscode-high-contrast-light .gh-label {
  --lightness-threshold: 0.453;
  --border-threshold: 0.96;
  --border-alpha: max(0, min(calc((var(--perceived-lightness) - var(--border-threshold)) * 100), 1));
  background:rgb(var(--label-r), var(--label-g), var(--label-b));
  color:hsl(0deg, 0%, calc(var(--lightness-switch) * 100%));
  border-color:hsla(var(--label-h), calc(var(--label-s) * 1%), calc((var(--label-l) - 25) * 1%), var(--border-alpha));
}
body.vscode-dark .gh-label,
body.vscode-high-contrast:not(.vscode-high-contrast-light) .gh-label {
  --lightness-threshold: 0.6;
  --background-alpha: 0.18;
  --border-alpha: 0.3;
  --lighten-by: calc(((var(--lightness-threshold) - var(--perceived-lightness)) * 100) * var(--lightness-switch));
  background:rgba(var(--label-r), var(--label-g), var(--label-b), var(--background-alpha));
  color:hsl(var(--label-h), calc(var(--label-s) * 1%), calc((var(--label-l) + var(--lighten-by)) * 1%));
  border-color:hsla(var(--label-h), calc(var(--label-s) * 1%), calc((var(--label-l) + var(--lighten-by)) * 1%), var(--border-alpha));
}

time { white-space:nowrap; }
```

- [ ] **Step 4: Load `issues.css` in both views**

In `src/issuesPanel.ts` `_buildHtml`, add after the `const cssUri = …` line from Task 5:

```ts
    const sharedCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'lib', 'issues.css'));
```
and change `<link rel="stylesheet" href="${cssUri}">` to:
```ts
<link rel="stylesheet" href="${sharedCssUri}">
<link rel="stylesheet" href="${cssUri}">
```

In `src/issueDetailPanel.ts` `_buildHtml`, add after its `const cssUri = …;` statement:

```ts
    const sharedCssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'lib', 'issues.css'),
    );
```
and make the same `<link>` change.

- [ ] **Step 5: List view: octicons, state icons, labels, relative time**

In `src/webview/issues.ts`:

Replace the four constants `COPY_ICON`, `OPEN_ICON`, `CHECK_ICON`, `BRANCH_ICON` (keep `WORKTREE_ICON`, which has no octicon) with:

```ts
const COPY_ICON = octicon('copy');
const OPEN_ICON = octicon('link-external');
const CHECK_ICON = octicon('check');
const BRANCH_ICON = octicon('git-branch');
```

In `renderLabelPicker`, replace:
```ts
          <span class="tag" style="${labelChipStyle(l.color)}">
```
with:
```ts
          <span class="tag gh-label" style="${labelStyleVars(l.color)}">
```

Everywhere in the file, replace `class="label-chip" style="${labelChipStyle(` with `class="gh-label" style="${labelStyleVars(` (two occurrences: the dropdown item and the row).

In `renderList`, replace:
```ts
        <span class="state-dot" title="${issue.state}"></span>
```
with:
```ts
        <span class="row-state">${issueStateIcon(issue.state, issue.state_reason)}</span>
```
and replace:
```ts
            ${issue.comments} comments · updated ${issue.updated_at.slice(0, 10)}
```
with:
```ts
            ${octicon('comment')} ${issue.comments} · updated ${timeHtml(issue.updated_at)}
```

In `lib/issueList.css`, delete these rules (superseded by `lib/issues.css`):
- `.state-dot { … }` (the rule spanning 3 lines)
- `.issue-row.closed .state-dot { … }`
- `.label-chip { … }`
- `.hidden { display:none !important; }`

and add:
```css
.row-state { flex-shrink:0; line-height:0; margin-top:2px; }
.issue-meta .octicon { width:12px; height:12px; vertical-align:-1px; }
```

- [ ] **Step 6: Detail view: state badge, labels, relative time**

In `src/webview/issueDetail.ts`:

In `renderPicker`, replace:
```ts
            <span class="tag"${i.color ? ` style="${labelChipStyle(i.color)}"` : ''}>
```
with:
```ts
            <span class="tag${i.color ? ' gh-label' : ''}"${i.color ? ` style="${labelStyleVars(i.color)}"` : ''}>
```

Everywhere in the file, replace `class="label-chip" style="${labelChipStyle(` with `class="gh-label" style="${labelStyleVars(` (three occurrences: `labeled`, `unlabeled` timeline text, and the header meta row).

In `render()`, replace the start of the `<h2>`:
```ts
      <h2><span class="state-badge${closed ? ' closed' : ''}">${issue.state}</span>
```
with:
```ts
      <h2>${issueStateBadge(issue.state, issue.state_reason)}
```

Replace `updated ${issue.updated_at.slice(0, 10)}` with `updated ${timeHtml(issue.updated_at)}`.

Replace `<span class="issue-meta">${item.created_at.slice(0, 10)}</span>` with `<span class="issue-meta">${timeHtml(item.created_at)}</span>`.

Replace `<span class="issue-meta">${item.comment.created_at.slice(0, 10)}</span>` with `<span class="issue-meta">${timeHtml(item.comment.created_at)}</span>`.

In `lib/issueDetail.css`, delete these rules (superseded by `lib/issues.css`):
- `.state-badge { … }` (the 4-line rule)
- `.state-badge.closed { … }`
- `.label-chip { … }`
- `.field-error.hidden { display:none; }` (`.hidden` is global now)

- [ ] **Step 7: Record the state-color decision in DESIGN.md**

In `DESIGN.md`, add after line 112 (`- **Success** (#2EA043) / …`):

```markdown
- **GitHub issue state** (open `charts-green` / completed `charts-purple` / not planned `descriptionForeground`): issue state in the GitHub Issues panel only, mirroring github.com. Git-host state, same category as diff colors, and never used as UI accent.
```

- [ ] **Step 8: Compile and run the suite**

Run: `npm run compile && npm test`
Expected: no errors (in particular no `Cannot find name 'labelChipStyle'`). All tests pass.

Run: `grep -rn "labelChipStyle\|label-chip\|state-dot\|slice(0, 10)" src/webview lib/*.css`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add lib/issues.css lib/issueList.css lib/issueDetail.css lib/issues.js lib/issueDetail.js \
  tsconfig.webview-issues.json tsconfig.webview-issue-detail.json src/webview/ src/github/types.ts \
  src/issuesPanel.ts src/issueDetailPanel.ts out/ ../../DESIGN.md
# `git add src/webview/` also stages the deletion of colorUtils.ts.
git commit -m "feat(null-tools): github.com look for Issues panel states, labels, and times

Octicon state icons (open green / completed purple / not planned gray)
from state_reason, GitHub's own per-theme label color formulas, and
relative times with exact timestamps on hover. DESIGN.md records GitHub
issue state as git-host state.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verify against a real install

**Files:** none (verification only; fix-up commits if something fails).

**Interfaces:**
- Consumes: everything above.
- Produces: a verified Phase 1.

- [ ] **Step 1: Sync to the local install**

Invoke the `verify-local` skill for `null-tools`. It syncs source into the local Null IDE install and runs the extension's integration specs.
Expected: sync succeeds; specs (if any exist for null-tools) pass. Reload the Null IDE window.

- [ ] **Step 2: Unit tests one more time**

Run: `npm test`
Expected: all pass.

- [ ] **Step 3: #106 scenarios** (in the `TorresVisual/null-ide` workspace)

1. Fresh window, **without opening the Issues sidebar**, Command Palette → *Null: New GitHub Issue*. Expected: the form's label and assignee pickers are filled in. Title `Phase 1 verification A`, *Create*. Expected: the issue opens in the detail tab.
2. New issue form, title `Phase 1 verification B`, **double-click** *Create*. Expected: the button shows "Creating…" and exactly one issue is created (check with `gh issue list --search "Phase 1 verification B"`).
3. New issue form, empty title, *Create*. Expected: red "Title is required." under the input, which disappears on typing.
4. Accounts menu → sign out of GitHub. In an open issue, post a comment. Expected: VS Code's GitHub sign-in prompt. Cancel it. Expected: toast `Failed to post comment: Sign in to GitHub to continue.` Sign back in.
5. Disconnect the network with the list showing, then open *New issue* and create. Expected: a toast containing the actual network error (e.g. `getaddrinfo ENOTFOUND api.github.com`), with the Create button enabled again. Reconnect.
6. Open a second folder with a different GitHub remote (any other repo) in the same window, and open the Issues sidebar. Expected: the label filter lists *that* repo's labels. Switch back.

Clean up: close verification issues A and B **as not planned** on github.com (they're used in Step 4).

- [ ] **Step 4: Visual checks** (Null Dark, then a light theme via *Preferences: Color Theme*)

- List rows: green open-issue icon; the closed-as-not-planned verification issues (state filter *Closed*) show a gray slash icon; other closed issues show a purple check.
- Labels: dark theme shows tinted chips with colored text and a thin border. Light theme shows solid chips with black/white text. A white or very light label has a visible border in the light theme.
- Times read "3 days ago" etc.; hovering shows the exact local date/time.
- Detail header: pill `◉ Open` (green) / `✓ Closed` (purple or gray), readable in both themes.
- Row hover actions show the octicon copy/branch/external icons; *Copy as prompt* briefly shows the check icon.
- Nothing else changed position or style compared with before Task 5 (the dropdowns, comment cards, composer).

- [ ] **Step 5: Record and report**

If any check fails, fix it in the owning task's files, re-run that task's tests, and commit as `fix(null-tools): …`. Then report the verification results (what passed, anything deferred) to the user.

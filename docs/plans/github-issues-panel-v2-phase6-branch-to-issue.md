# GitHub Issues Panel v2, Phase 6 (Branch → issue): Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** When the user switches to a branch named `issue-<n>-<slug>` (the scheme *Create branch* already produces), Null IDE offers to open that issue: *"Branch refers to #n: <title>" [Open] [Not now]*. This finishes #54 and closes out Issues panel v2.

**Architecture:** Pure logic goes in the existing vscode-free `src/github/gitBranch.ts`: `issueNumberFromBranch(name)` parses the branch name, and a small `BranchIssueTracker` decides *whether* a HEAD change deserves a prompt (it has to ignore startup, repeat events, branches it already offered, and branches the panel itself just created). `issuesPanelIntegration.ts` wires the built-in git extension's `repository.state.onDidChange` to the tracker and, on a hit, fetches the title with `store.getDetail` and shows the toast. No new files, no new settings.

**Tech Stack:** TypeScript 5.8, VS Code extension API (`^1.85.0`), built-in `vscode.git` extension API v1, `node:test`.

**Spec:** [docs/specs/github-issues-panel-v2-design.md](../specs/github-issues-panel-v2-design.md) (this plan covers "Delivery phases → 6. Branch → issue (#54)" and the `issuesPanelIntegration.ts` bullet under "Extension host: panels"). Phases 1–5 are on `main`.

**Deviations from the spec** (each one is deliberate):
- **Startup never prompts.** The spec says "when HEAD moves to a branch…". A window opened *on* an issue branch is not a move, and a prompt on every launch of a long-running branch would be nagging. The tracker only reacts when the previous HEAD was a known branch name. Consequence: leaving a detached HEAD onto an issue branch doesn't prompt either (`ponytail:` comment in the tracker).
- **A branch the panel just created doesn't prompt.** *Create branch* (`createIssueBranch`) calls `branchIssueTracker.skip(branch)`, otherwise the user gets "Branch refers to #n" right after clicking the button on #n.
- **Only the workspace's own repo prompts.** The git extension reports every repository (multi-root, nested). `IssuesStore` only knows the first workspace folder's GitHub repo, so a branch in another repo would look up the wrong issue. The listener compares `owner/repo` of the changed repository with the first folder's, and ignores the rest.
- **Failures are silent.** Signed out, offline, a number that is a pull request or doesn't exist: no toast, no error. This is a courtesy prompt, never an interruption.

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

- Work only inside `D:\Coding\Apps\null-ide\` (CLAUDE.md scope rule). All paths below are relative to `extensions/null-tools/` unless they start with `docs/` or `CLAUDE.md`. Run all `npm`/`npx` commands from `extensions/null-tools/`.
- Edit TypeScript sources only; never hand-edit compiled output. `out/` and `lib/*.js` **are tracked in git**: after `npm test` / `npm run compile`, stage the compiled files that belong to the task in the same commit as their source. The tree is clean before each task (the untracked `graphify-out/` at the repo root is not part of any task), so `git status --short` then `git add -A .` from `extensions/null-tools/` stages exactly the task's source plus its compiled output.
- Unit tests only cover files that don't `import 'vscode'`: `gitBranch.ts` must stay vscode-free. `gitBranch.test.ts` is already in `tsconfig.json`'s `include` and in the `test` script, so neither needs editing.
- No new dependencies.
- Branch scheme is `issue-<n>` or `issue-<n>-<slug>` only (what `branchNameForIssue` produces). Prefixed names like `feature/issue-12` are intentionally not matched.
- Commit messages: conventional style (`feat(null-tools): …`), ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Don't push.

## Review Focus

1. **A prompt on every window launch.** Opening the IDE on `issue-12-foo` must not toast; neither must HEAD being `undefined` while the git extension is still loading and then turning into the branch name. Pinned in Task 1 (`tracker ignores the first HEAD it sees …`, `… an unknown previous HEAD`).
2. **A prompt on every git status refresh.** `repository.state.onDidChange` fires for every staged file and every fetch, not just branch switches. Same branch twice in a row, or leaving and coming back in one session, prompts at most once. Pinned in Task 1 (`tracker ignores repeat events …`, `tracker offers each branch once per session …`).
3. **A redundant prompt after *Create branch*.** The user just clicked the button on that very issue. Pinned in Task 1 (`tracker skips a branch the panel just created`); the real `createIssueBranch` call is manual, Task 2 scenario 3.
4. **Names that look like the scheme but aren't.** `issue-12abc`, `issue-0`, `issue-`, `my-issue-12`, `issue-99999999999999999999` (past `Number.MAX_SAFE_INTEGER`). Pinned in Task 1 (`issueNumberFromBranch rejects …`).
5. **The number points nowhere useful.** A PR number, a deleted issue, signed out, offline, or a branch in a different repo of a multi-root workspace: nothing happens, no error toast, no wrong-repo lookup. Manual, Task 2 scenarios 5 and 6 (needs a live GitHub session and a second repo).

---

### Task 1: Branch-name parsing and the prompt tracker (`gitBranch.ts`)

**Files:**
- Modify: `src/github/gitBranch.ts`
- Modify: `src/github/gitBranch.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (all pure, vscode-free):
  - `issueNumberFromBranch(name: string | undefined): number | null`
  - `class BranchIssueTracker { onHead(repoKey: string, branch: string | undefined): number | null; skip(branch: string): void }`
  - `export const branchIssueTracker: BranchIssueTracker` (module singleton; `createIssueBranch` and Task 2's listener share it)
  - `createIssueBranch(...)` keeps its signature but now calls `branchIssueTracker.skip(branch)` on success.

- [ ] **Step 1: Write the failing tests**

In `src/github/gitBranch.test.ts`, change the import line to:

```ts
import { BranchIssueTracker, branchNameForIssue, getLocallyClosedIssueNumbers, issueNumberFromBranch } from './gitBranch';
```

Append at the end of the file:

```ts
test('issueNumberFromBranch reads the number from the scheme branchNameForIssue produces', () => {
  assert.strictEqual(issueNumberFromBranch('issue-106-fix-create'), 106);
  assert.strictEqual(issueNumberFromBranch('issue-7'), 7);
  assert.strictEqual(issueNumberFromBranch(branchNameForIssue(43, 'Add Issues Panel')), 43);
});

test('issueNumberFromBranch rejects names that only look like the scheme', () => {
  for (const name of ['issue-12abc', 'issue-0', 'issue-', 'issue', 'my-issue-12', 'feature/issue-12', 'Issue-12', 'main', '']) {
    assert.strictEqual(issueNumberFromBranch(name), null, name);
  }
  assert.strictEqual(issueNumberFromBranch(undefined), null);
  assert.strictEqual(issueNumberFromBranch('issue-99999999999999999999-x'), null);
});

test('tracker ignores the first HEAD it sees and an unknown previous HEAD', () => {
  const t = new BranchIssueTracker();
  assert.strictEqual(t.onHead('r', 'issue-12-foo'), null, 'window opened on an issue branch');
  const u = new BranchIssueTracker();
  assert.strictEqual(u.onHead('r', undefined), null);
  assert.strictEqual(u.onHead('r', 'issue-12-foo'), null, 'HEAD was still loading');
});

test('tracker offers the issue when HEAD moves onto an issue branch', () => {
  const t = new BranchIssueTracker();
  t.onHead('r', 'main');
  assert.strictEqual(t.onHead('r', 'issue-12-foo'), 12);
});

test('tracker ignores repeat events and non-issue branches', () => {
  const t = new BranchIssueTracker();
  t.onHead('r', 'main');
  assert.strictEqual(t.onHead('r', 'main'), null);
  assert.strictEqual(t.onHead('r', 'feature/x'), null);
  assert.strictEqual(t.onHead('r', 'issue-12-foo'), 12);
  assert.strictEqual(t.onHead('r', 'issue-12-foo'), null, 'status refresh on the same branch');
  assert.strictEqual(t.onHead('r', undefined), null, 'detached HEAD');
});

test('tracker offers each branch once per session, per repo', () => {
  const t = new BranchIssueTracker();
  t.onHead('a', 'main');
  t.onHead('b', 'main');
  assert.strictEqual(t.onHead('a', 'issue-12-foo'), 12);
  t.onHead('a', 'main');
  assert.strictEqual(t.onHead('a', 'issue-12-foo'), null, 'back again');
  assert.strictEqual(t.onHead('b', 'issue-12-foo'), 12, 'same name in another repo');
});

test('tracker skips a branch the panel just created, once', () => {
  const t = new BranchIssueTracker();
  t.onHead('r', 'main');
  t.skip('issue-12-foo');
  assert.strictEqual(t.onHead('r', 'issue-12-foo'), null);
  t.onHead('r', 'main');
  assert.strictEqual(t.onHead('r', 'issue-12-foo'), null, 'still counted as offered');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL to compile (`BranchIssueTracker` / `issueNumberFromBranch` are not exported from `./gitBranch`).

- [ ] **Step 3: Write the implementation**

In `src/github/gitBranch.ts`, insert after `branchNameForIssue` (before `createIssueBranch`):

```ts
/** The number in `issue-<n>` or `issue-<n>-<slug>`, the names `branchNameForIssue` makes. */
export function issueNumberFromBranch(name: string | undefined): number | null {
  const match = /^issue-(\d{1,9})(?:-|$)/.exec(name ?? '');
  const n = match ? Number(match[1]) : 0;
  return n > 0 ? n : null;
}

/**
 * Decides which HEAD changes deserve an "open this issue?" prompt. The git extension reports every
 * status change, not just branch switches, so this keeps a prompt to a real switch onto a branch we
 * haven't offered yet.
 */
export class BranchIssueTracker {
  private readonly last = new Map<string, string | undefined>();
  private readonly offered = new Set<string>();
  private readonly created = new Set<string>();

  /** The issue number to offer, or null. Call on every HEAD change; the first call per repo only records it. */
  onHead(repoKey: string, branch: string | undefined): number | null {
    const previous = this.last.get(repoKey);
    this.last.set(repoKey, branch);
    // ponytail: an unknown previous HEAD (startup, still loading, detached) never prompts, so leaving a
    // detached HEAD onto an issue branch is missed. Track "seen a real branch" separately if that matters.
    if (!previous || !branch || previous === branch) return null;
    const n = issueNumberFromBranch(branch);
    if (n === null) return null;
    const key = `${repoKey}\0${branch}`;
    if (this.offered.has(key)) return null;
    this.offered.add(key);
    if (this.created.delete(branch)) return null;
    return n;
  }

  /** The panel just created `branch`: its first checkout is the user's own doing, not news. */
  skip(branch: string): void {
    this.created.add(branch);
  }
}

export const branchIssueTracker = new BranchIssueTracker();
```

In `createIssueBranch`, after the `execFileSync('git', ['checkout', '-b', branch], …)` line, add:

```ts
    branchIssueTracker.skip(branch);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including the 7 new tests in `gitBranch.test.js`.

- [ ] **Step 5: Commit**

```bash
git status --short
git add -A .
git commit -m "feat(null-tools): parse issue numbers from branch names and decide when to offer them

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Offer the issue when HEAD moves (`issuesPanelIntegration.ts`)

**Files:**
- Modify: `src/issuesPanelIntegration.ts`
- Modify: `CLAUDE.md` (the `null-tools` table, **GitHub Issues panel** row)

**Interfaces:**
- Consumes: `branchIssueTracker.onHead(repoKey, branch): number | null` from Task 1; `IssuesStore.getDetail(n): Promise<IssueDetail>` (`.issue.title`); `IssueDetailPanel.show(extensionUri, store, n)`; `getWorkspaceGithubRepo(cwd): GithubRepoRef | null`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Add the listener**

In `src/issuesPanelIntegration.ts`, extend the imports:

```ts
import { branchIssueTracker } from './github/gitBranch';
```

In `registerIssuesPanelFeature`, directly before the `const countBar = …` line, add:

```ts
  watchIssueBranches(context, store);
```

Append to the end of the file:

```ts
interface GitRepo {
  rootUri: vscode.Uri;
  state: { HEAD?: { name?: string }; onDidChange: vscode.Event<void> };
}

/** #54: offer to open the issue when the user switches to an `issue-<n>-…` branch. */
function watchIssueBranches(context: vscode.ExtensionContext, store: IssuesStore): void {
  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (!gitExt) return;

  const sameRepoAsWorkspace = (root: string): boolean => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const mine = cwd ? getWorkspaceGithubRepo(cwd) : null;
    const theirs = getWorkspaceGithubRepo(root);
    return !!mine && !!theirs && mine.owner === theirs.owner && mine.repo === theirs.repo;
  };

  const offer = async (n: number): Promise<void> => {
    let title: string;
    try {
      title = (await store.getDetail(n)).issue.title;
    } catch {
      return; // signed out, offline, a PR number, a deleted issue: a courtesy prompt stays quiet
    }
    const pick = await vscode.window.showInformationMessage(`Branch refers to #${n}: ${title}`, 'Open', 'Not now');
    if (pick === 'Open') await IssueDetailPanel.show(context.extensionUri, store, n);
  };

  const watch = (repo: GitRepo): void => {
    const root = repo.rootUri.fsPath;
    branchIssueTracker.onHead(root, repo.state.HEAD?.name); // records the starting branch
    context.subscriptions.push(repo.state.onDidChange(() => {
      const n = branchIssueTracker.onHead(root, repo.state.HEAD?.name);
      if (n !== null && sameRepoAsWorkspace(root)) void offer(n);
    }));
  };

  void (async () => {
    try {
      const git = (gitExt.isActive ? gitExt.exports : await gitExt.activate()).getAPI(1);
      (git.repositories as GitRepo[]).forEach(watch);
      context.subscriptions.push(git.onDidOpenRepository(watch));
    } catch {
      // git extension disabled: no branch prompts
    }
  })();
}
```

- [ ] **Step 2: Compile**

Run: `npm run compile`
Expected: no TypeScript errors. Then `npm test`; expected PASS (nothing here is unit-tested, this only proves nothing regressed).

- [ ] **Step 3: Update `CLAUDE.md`**

In the `null-tools` table row **GitHub Issues panel**, replace the phrase `sign-in, mark-as-read, issue templates, link/insert issue references in commit messages` with `sign-in, mark-as-read, issue templates, link/insert issue references in commit messages, an "open this issue?" prompt when you switch to an \`issue-<n>-…\` branch`.

- [ ] **Step 4: Verify in a real install**

Invoke the `verify-local` skill (syncs source into the local Null IDE install). In a workspace whose GitHub remote has an open issue `N`, signed in:

1. In the terminal run `git switch -c issue-N-try` from `main` → toast *"Branch refers to #N: <title>"*; **Open** opens the issue tab, **Not now** dismisses it.
2. `git switch main`, then `git switch issue-N-try` again → no second toast. Stage a file on the branch → no toast.
3. Hover issue row M, click *Create branch* → branch created, **no** toast.
4. Reload the window while on `issue-N-try` → no toast.
5. `git switch -c issue-999999-x` (no such issue) and `git switch -c issue-<a PR number>-x` → no toast, no error. Sign out of GitHub, `git switch -c issue-N-other` → no toast.
6. If you have a multi-root workspace with a second GitHub repo: `git switch -c issue-N-y` in the *second* repo → no toast.

Expected: all six as written. Report any that differ before committing.

- [ ] **Step 5: Commit**

```bash
git status --short
git add -A . ../../CLAUDE.md
git commit -m "feat(null-tools): offer to open the issue when switching to an issue branch (#54)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage:** `issueNumberFromBranch` → Task 1; HEAD listener via `repository.state.onDidChange`, toast with title and [Open]/[Not now], once per branch per session → Tasks 1–2; `gitBranch.test.ts` entry in the spec's Testing list → Task 1. The spec's manual list item "checking out `issue-106-…` offers to open #106" → Task 2 scenario 1.
- **Placeholders:** none.
- **Types:** `onHead(repoKey, branch)`, `skip(branch)`, `branchIssueTracker` and `issueNumberFromBranch` have the same names and signatures in both tasks.

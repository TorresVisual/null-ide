# Git Worktree Manager Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Add a worktree tree view to `null-tools` (issue #88): list worktrees with git status, create one from a GitHub issue/branch/scratch, open/reveal/terminal a worktree, merge a worktree's branch back, and prune stale ones.

**Architecture:** A new `vscode`-free data module (`worktrees.ts`) does all git shelling and returns `Result<T>`; a `TreeDataProvider` (`worktreesTreeView.ts`) renders it; an integration module (`worktreesIntegration.ts`) wires commands/settings, mirroring the existing Ports feature's three-file shape. New worktrees are created under `.claude/worktrees/<branch>` — the same directory Claude Code's own `EnterWorktree` tool already uses — so both mechanisms list, merge, and clean up the same worktrees without special-casing either one.

**Tech Stack:** TypeScript, VS Code Extension API, Node `child_process`/`fs`, `node:test` for unit tests (existing repo conventions — no new dependencies).

**Spec:** [docs/specs/worktree-manager-design.md](../specs/worktree-manager-design.md)

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

- Operates on `workspaceFolders[0]` only — no multi-root fan-out (matches `issuesPanel.ts`/`issueDetailPanel.ts`).
- No new npm dependencies — `child_process`, `fs`, `path`, and `vscode.workspace.findFiles` cover everything.
- Every git-shelling mutating function returns `Result<T> = { ok: true; value: T } | { ok: false; message: string }` — never throws to its caller.
- All worktrees are created at `<repoCwd>/.claude/worktrees/<branch>` — never a sibling directory — matching `EnterWorktree`'s own convention.
- No auto-polling refresh timer (unlike Ports) — refresh on activation, manual refresh, and after every mutating command.
- Destructive confirmations use `showWarningMessage(..., { modal: true }, '<Verb>')`, matching `portsIntegration.ts`'s `killProcess`.
- `mergeWorktreeBack` never auto-falls-back from a fast-forward to a real merge — the caller (integration layer) confirms with the user first.

## Review Focus

- Detached-HEAD worktree (`branch: null`) — must list and render without crashing, and must be rejected with a clear message (not a crash) if merge-back is attempted on it. → Task 4 (`listWorktrees`), Task 9 (`mergeBack` command guard).
- A worktree whose directory was deleted outside git (`rm -rf`) — must still appear (`prunable: true`, blank status) rather than being silently dropped or throwing. → Task 4.
- Creating a worktree whose target directory already exists (same issue re-picked, or two "scratch" worktrees with the same description) — must fail cleanly (`ok: false`), never throw or corrupt state. → Task 5.
- A repo with no `origin` remote — ahead/behind-vs-upstream must read `0`/`0` instead of throwing, and `getBaseBranch` must still resolve to a real local branch. → Task 3, Task 4.
- `mergeWorktreeBack` invoked while the *main* repo's own working tree has uncommitted changes — must refuse before touching anything, never auto-stash/discard. → Task 6.

---

## Task 1: Genericize `computeGitStatuses`

**Files:**
- Modify: `extensions/null-tools/src/dashboardGitStatus.ts`
- Test: `extensions/null-tools/src/dashboardGitStatus.test.ts`

**Interfaces:**
- Produces: `computeGitStatuses<T = GitStatus>(paths: string[], onResult: (path: string, status: T | null) => void, concurrency?: number, fetchStatus?: (cwd: string) => Promise<T | null>): Promise<void>` — Task 4 calls this with `T = WorktreeStatusFields`.

- [ ] **Step 1: Write the failing test**

Add to `dashboardGitStatus.test.ts`:

```ts
test('computeGitStatuses supports a custom status type via generics', async () => {
  interface CustomStatus { note: string }
  const fakeFetch = async (): Promise<CustomStatus | null> => ({ note: 'ok' });
  const results = new Map<string, CustomStatus | null>();
  await computeGitStatuses<CustomStatus>(['a'], (p, s) => results.set(p, s), 1, fakeFetch);
  assert.deepStrictEqual(results.get('a'), { note: 'ok' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: FAIL — `error TS2558: Expected 0 type arguments, but got 1.` (`computeGitStatuses` isn't generic yet).

- [ ] **Step 3: Genericize the function**

In `dashboardGitStatus.ts`, replace the `computeGitStatuses` signature and body:

```ts
export async function computeGitStatuses<T = GitStatus>(
  paths: string[],
  onResult: (path: string, status: T | null) => void,
  concurrency = 4,
  fetchStatus: (cwd: string) => Promise<T | null> = getGitStatus as unknown as (cwd: string) => Promise<T | null>,
): Promise<void> {
  let next = 0;

  async function worker(): Promise<void> {
    while (next < paths.length) {
      const index = next++;
      const p = paths[index];
      let status: T | null;
      try {
        status = await fetchStatus(p);
      } catch {
        status = null;
      }
      onResult(p, status);
    }
  }

  const workerCount = Math.min(concurrency, paths.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
}
```

(Only the signature's type parameters and the two `status` local-variable annotations change — the worker loop body is unchanged.)

- [ ] **Step 4: Run tests to verify everything passes**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/dashboardGitStatus.test.js`
Expected: PASS — all 5 existing tests plus the new generic test.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/dashboardGitStatus.ts extensions/null-tools/src/dashboardGitStatus.test.ts
git commit -m "refactor(null-tools): genericize computeGitStatuses for reuse by the worktree manager"
```

---

## Task 2: Worktree data model + porcelain parsing

**Files:**
- Create: `extensions/null-tools/src/worktrees.ts`
- Test: `extensions/null-tools/src/worktrees.test.ts`
- Modify: `extensions/null-tools/package.json` (`scripts.test`)

**Interfaces:**
- Produces: `WorktreeBase` (`{ path, branch, head, isCurrent, prunable }`), `WorktreeEntry extends WorktreeBase` (adds `dirty, ahead, behind, aheadBase, behindBase, lastCommitSubject, lastCommitDate`), `Result<T>`, `parseWorktreeListPorcelain(output: string, currentPath: string): WorktreeBase[]`.

- [ ] **Step 1: Write the failing test**

Create `worktrees.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { parseWorktreeListPorcelain } from './worktrees';

test('parseWorktreeListPorcelain parses primary, linked, detached, and prunable worktrees', () => {
  const output = [
    'worktree /repo',
    'HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'branch refs/heads/main',
    '',
    'worktree /repo/.claude/worktrees/feature-x',
    'HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'branch refs/heads/feature-x',
    '',
    'worktree /repo/.claude/worktrees/detached-one',
    'HEAD cccccccccccccccccccccccccccccccccccccccc',
    'detached',
    '',
    'worktree /repo/.claude/worktrees/gone',
    'HEAD dddddddddddddddddddddddddddddddddddddddd',
    'branch refs/heads/gone',
    'prunable gitdir file points to non-existent location',
  ].join('\n');

  const entries = parseWorktreeListPorcelain(output, '/repo');
  assert.strictEqual(entries.length, 4);
  assert.deepStrictEqual(entries[0], {
    path: '/repo', branch: 'main',
    head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    isCurrent: true, prunable: false,
  });
  assert.strictEqual(entries[1].branch, 'feature-x');
  assert.strictEqual(entries[1].isCurrent, false);
  assert.strictEqual(entries[2].branch, null);
  assert.strictEqual(entries[3].prunable, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: FAIL — `error TS2307: Cannot find module './worktrees'` (file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `worktrees.ts`:

```ts
'use strict';

export interface WorktreeBase {
  path: string;
  branch: string | null;
  head: string;
  isCurrent: boolean;
  prunable: boolean;
}

export interface WorktreeEntry extends WorktreeBase {
  dirty: boolean;
  ahead: number;
  behind: number;
  aheadBase: number;
  behindBase: number;
  lastCommitSubject: string;
  lastCommitDate: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}

export function parseWorktreeListPorcelain(output: string, currentPath: string): WorktreeBase[] {
  const current = normalizePath(currentPath);
  return output
    .split(/\r?\n\r?\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      let wtPath = '', head = '', branch: string | null = null, prunable = false;
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) wtPath = line.slice('worktree '.length).trim();
        else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim();
        else if (line.startsWith('branch ')) branch = line.slice('branch '.length).replace('refs/heads/', '').trim();
        else if (line === 'detached') branch = null;
        else if (line.startsWith('prunable')) prunable = true;
      }
      return { path: wtPath, branch, head, prunable, isCurrent: normalizePath(wtPath) === current };
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/worktrees.test.js`
Expected: PASS

- [ ] **Step 5: Add the new test file to the test script**

In `package.json`, append `out/worktrees.test.js` to the end of the `scripts.test` command (after `out/claudeTabIntegration.test.js`):

```json
"test": "tsc -p tsconfig.json && node --test out/recentProjects.test.js out/scratchNotesStorage.test.js out/autoGitignore.test.js out/versionComparison.test.js out/nullNotes.test.js out/github/githubRemote.test.js out/github/issueFilter.test.js out/github/promptFormat.test.js out/github/gitBranch.test.js out/github/taskList.test.js out/github/issueTemplates.test.js out/dashboardGitStatus.test.js out/dashboardActions.test.js out/claudeTabIntegration.test.js out/worktrees.test.js"
```

- [ ] **Step 6: Commit**

```bash
git add extensions/null-tools/src/worktrees.ts extensions/null-tools/src/worktrees.test.ts extensions/null-tools/package.json
git commit -m "feat(null-tools): parse git worktree list --porcelain output"
```

---

## Task 3: Base branch detection

**Files:**
- Modify: `extensions/null-tools/src/worktrees.ts`
- Test: `extensions/null-tools/src/worktrees.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getBaseBranch(repoCwd: string): string`.

- [ ] **Step 1: Write the failing test**

Add to `worktrees.test.ts` (add these imports at the top: `import { execFileSync } from 'node:child_process'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import path from 'node:path';` and a shared helper):

```ts
function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'worktrees-test-'));
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

function commit(dir: string, file: string, message: string): void {
  writeFileSync(path.join(dir, file), file);
  execFileSync('git', ['add', file], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

test('getBaseBranch falls back to main when there is no remote', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  assert.strictEqual(getBaseBranch(dir), 'main');
});

test('getBaseBranch resolves origin/HEAD when a remote is configured', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const bare = mkdtempSync(path.join(tmpdir(), 'worktrees-bare-'));
  execFileSync('git', ['init', '-q', '--bare'], { cwd: bare });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir });
  execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: dir });
  execFileSync('git', ['remote', 'set-head', 'origin', 'main'], { cwd: dir });
  assert.strictEqual(getBaseBranch(dir), 'main');
});
```

(Also add `writeFileSync` to the `node:fs` import and `getBaseBranch` to the `./worktrees` import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: FAIL — `error TS2305: Module './worktrees' has no exported member 'getBaseBranch'.`

- [ ] **Step 3: Write the minimal implementation**

Add to `worktrees.ts` (new import line at top: `import { execFileSync } from 'child_process';`):

```ts
export function getBaseBranch(repoCwd: string): string {
  try {
    const ref = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 }).trim();
    return ref.replace(/^refs\/remotes\/origin\//, '');
  } catch {
    // no remote, or origin/HEAD not set
  }
  for (const candidate of ['main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', `refs/heads/${candidate}`], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 });
      return candidate;
    } catch {
      // candidate branch doesn't exist
    }
  }
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 }).trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/worktrees.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/worktrees.ts extensions/null-tools/src/worktrees.test.ts
git commit -m "feat(null-tools): detect the base branch for worktree ahead/behind and merges"
```

---

## Task 4: `listWorktrees` — enrich with status via `computeGitStatuses`

**Files:**
- Modify: `extensions/null-tools/src/worktrees.ts`
- Test: `extensions/null-tools/src/worktrees.test.ts`

**Interfaces:**
- Consumes: `computeGitStatuses<T>` (Task 1), `parseWorktreeListPorcelain`/`getBaseBranch` (Tasks 2-3).
- Produces: `listWorktrees(repoCwd: string): Promise<WorktreeEntry[]>`.

- [ ] **Step 1: Write the failing tests**

Add to `worktrees.test.ts` (add `fs` to imports: `import * as fs from 'node:fs';`, and `listWorktrees`, `createWorktree` — used ahead of its own Task 5 definition, so this step's tests will only fully compile once Task 5 lands; run this task's own listing-only test first with a worktree created via raw `execFileSync`, not `createWorktree`, to keep task order clean):

```ts
test('listWorktrees reports the primary and a linked worktree with correct branch/status', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const wtPath = path.join(dir, '.claude', 'worktrees', 'feature-x');
  execFileSync('git', ['worktree', 'add', '-b', 'feature-x', wtPath], { cwd: dir });
  commit(wtPath, 'b.txt', 'feature work');

  const entries = await listWorktrees(dir);
  assert.strictEqual(entries.length, 2);

  const main = entries.find(e => e.isCurrent)!;
  assert.strictEqual(main.dirty, false);

  const feature = entries.find(e => !e.isCurrent)!;
  assert.strictEqual(feature.branch, 'feature-x');
  assert.strictEqual(feature.dirty, false);
  assert.strictEqual(feature.aheadBase, 1);
  assert.strictEqual(feature.behindBase, 0);
  assert.strictEqual(feature.ahead, 0);
  assert.strictEqual(feature.behind, 0);
});

test('listWorktrees keeps a worktree whose directory was deleted, marked prunable', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const wtPath = path.join(dir, '.claude', 'worktrees', 'to-delete');
  execFileSync('git', ['worktree', 'add', '-b', 'to-delete', wtPath], { cwd: dir });
  fs.rmSync(wtPath, { recursive: true, force: true });

  const entries = await listWorktrees(dir);
  const gone = entries.find(e => !e.isCurrent)!;
  assert.strictEqual(gone.prunable, true);
  assert.strictEqual(gone.dirty, false);
});

test('listWorktrees represents a detached-HEAD worktree with a null branch', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const wtPath = path.join(dir, '.claude', 'worktrees', 'detached-one');
  execFileSync('git', ['worktree', 'add', '--detach', wtPath, head], { cwd: dir });

  const entries = await listWorktrees(dir);
  const detached = entries.find(e => !e.isCurrent)!;
  assert.strictEqual(detached.branch, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: FAIL — `error TS2305: Module './worktrees' has no exported member 'listWorktrees'.`

- [ ] **Step 3: Write the minimal implementation**

Add to `worktrees.ts` (new imports: `import { execFile } from 'child_process'; import { promisify } from 'util'; import { computeGitStatuses } from './dashboardGitStatus';` — note `execFileSync` from Task 3 stays; add `const execFileAsync = promisify(execFile);` near the top):

```ts
interface WorktreeStatusFields {
  dirty: boolean;
  ahead: number;
  behind: number;
  aheadBase: number;
  behindBase: number;
  lastCommitSubject: string;
  lastCommitDate: string;
}

async function fetchWorktreeStatus(
  worktreePath: string,
  branch: string | null,
  head: string,
  baseBranch: string,
): Promise<WorktreeStatusFields | null> {
  try {
    const { stdout: porcelain } = await execFileAsync('git', ['status', '--porcelain'], { cwd: worktreePath, timeout: 5000 });
    const dirty = porcelain.trim().length > 0;

    let ahead = 0, behind = 0;
    if (branch) {
      try {
        const { stdout } = await execFileAsync('git', ['rev-list', '--left-right', '--count', `${branch}...${branch}@{u}`], { cwd: worktreePath, timeout: 5000 });
        [ahead, behind] = stdout.trim().split(/\s+/).map(Number);
      } catch {
        // no upstream configured
      }
    }

    let aheadBase = 0, behindBase = 0;
    try {
      const ref = branch ?? head;
      const { stdout } = await execFileAsync('git', ['rev-list', '--left-right', '--count', `${ref}...${baseBranch}`], { cwd: worktreePath, timeout: 5000 });
      [aheadBase, behindBase] = stdout.trim().split(/\s+/).map(Number);
    } catch {
      // base branch unresolvable from this worktree
    }

    const { stdout: log } = await execFileAsync('git', ['log', '-1', '--format=%s%x1f%cI', 'HEAD'], { cwd: worktreePath, timeout: 5000 });
    const [lastCommitSubject, lastCommitDate] = log.trim().split('\x1f');

    return { dirty, ahead, behind, aheadBase, behindBase, lastCommitSubject: lastCommitSubject ?? '', lastCommitDate: lastCommitDate ?? '' };
  } catch {
    return null;
  }
}

export async function listWorktrees(repoCwd: string): Promise<WorktreeEntry[]> {
  const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoCwd, timeout: 10000 });
  const base = parseWorktreeListPorcelain(stdout, repoCwd);
  if (base.length === 0) return [];

  const baseBranch = getBaseBranch(repoCwd);
  const byPath = new Map(base.map(e => [e.path, e]));
  const statuses = new Map<string, WorktreeStatusFields | null>();

  await computeGitStatuses<WorktreeStatusFields>(
    base.map(e => e.path),
    (p, status) => statuses.set(p, status),
    4,
    (p) => {
      const entry = byPath.get(p)!;
      return fetchWorktreeStatus(p, entry.branch, entry.head, baseBranch);
    },
  );

  return base.map(entry => {
    const status = statuses.get(entry.path);
    return {
      ...entry,
      dirty: status?.dirty ?? false,
      ahead: status?.ahead ?? 0,
      behind: status?.behind ?? 0,
      aheadBase: status?.aheadBase ?? 0,
      behindBase: status?.behindBase ?? 0,
      lastCommitSubject: status?.lastCommitSubject ?? '',
      lastCommitDate: status?.lastCommitDate ?? '',
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/worktrees.test.js`
Expected: PASS — all listWorktrees tests green (fetch for the deleted directory fails internally and returns `null`, so defaults apply — nothing throws).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/worktrees.ts extensions/null-tools/src/worktrees.test.ts
git commit -m "feat(null-tools): enrich worktree list with dirty/ahead-behind/last-commit status"
```

---

## Task 5: `createWorktree` (issue / branch / scratch) + gitignore safety check

**Files:**
- Modify: `extensions/null-tools/src/worktrees.ts`
- Test: `extensions/null-tools/src/worktrees.test.ts`

**Interfaces:**
- Consumes: `branchNameForIssue` (`./github/gitBranch`), `slugify` (`./scratchNotesStorage`).
- Produces: `CreateWorktreeOptions` (union), `createWorktree(repoCwd, opts): Result<{ path: string; branch: string }>`, `listLocalBranches(repoCwd: string): string[]` (used by Task 9's "From Branch" QuickPick).

- [ ] **Step 1: Write the failing tests**

Add to `worktrees.test.ts`:

```ts
test('createWorktree from scratch creates a branch and worktree under .claude/worktrees', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');

  const result = createWorktree(dir, { kind: 'scratch', description: 'Try a fix' });
  assert.ok(result.ok);
  assert.strictEqual(result.value.branch, 'try-a-fix');
  assert.ok(fs.existsSync(result.value.path));
  assert.match(result.value.path.replace(/\\/g, '/'), /\.claude\/worktrees\/try-a-fix$/);

  const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gitignore, /\.claude\/worktrees/);
});

test('createWorktree fails cleanly when the target directory already exists', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  createWorktree(dir, { kind: 'scratch', description: 'dup' });

  const second = createWorktree(dir, { kind: 'scratch', description: 'dup' });
  assert.strictEqual(second.ok, false);
});

test('createWorktree from an issue uses branchNameForIssue for the branch name', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const result = createWorktree(dir, { kind: 'issue', issueNumber: 88, title: 'Git worktree manager' });
  assert.ok(result.ok);
  assert.strictEqual(result.value.branch, 'issue-88-git-worktree-manager');
});

test('createWorktree from an existing branch reuses it rather than creating a new one', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  execFileSync('git', ['branch', 'existing-feature'], { cwd: dir });

  const result = createWorktree(dir, { kind: 'branch', branch: 'existing-feature' });
  assert.ok(result.ok);
  assert.strictEqual(result.value.branch, 'existing-feature');
});

test('listLocalBranches returns local branch names', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  execFileSync('git', ['branch', 'a-branch'], { cwd: dir });
  execFileSync('git', ['branch', 'b-branch'], { cwd: dir });

  const branches = listLocalBranches(dir);
  assert.ok(branches.includes('main'));
  assert.ok(branches.includes('a-branch'));
  assert.ok(branches.includes('b-branch'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: FAIL — `error TS2305: Module './worktrees' has no exported member 'createWorktree'.`

- [ ] **Step 3: Write the minimal implementation**

Add to `worktrees.ts` (new imports: `import * as fs from 'fs'; import * as path from 'path'; import { branchNameForIssue } from './github/gitBranch'; import { slugify } from './scratchNotesStorage';`):

```ts
export type CreateWorktreeOptions =
  | { kind: 'issue'; issueNumber: number; title: string }
  | { kind: 'branch'; branch: string }
  | { kind: 'scratch'; description: string };

function ensureWorktreesIgnored(repoCwd: string): void {
  try {
    execFileSync('git', ['check-ignore', '-q', '.claude/worktrees'], { cwd: repoCwd, stdio: 'ignore' });
    return; // already ignored
  } catch (err) {
    if ((err as { status?: number }).status !== 1) return; // not a "no match" result — leave .gitignore alone
  }
  const gitignorePath = path.join(repoCwd, '.gitignore');
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  if (existing.includes('.claude/worktrees')) return;
  const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(gitignorePath, `${existing}${sep}.claude/worktrees/\n`);
}

export function createWorktree(repoCwd: string, opts: CreateWorktreeOptions): Result<{ path: string; branch: string }> {
  let branch: string;
  let isNewBranch: boolean;
  switch (opts.kind) {
    case 'issue':
      branch = branchNameForIssue(opts.issueNumber, opts.title);
      isNewBranch = true;
      break;
    case 'branch':
      branch = opts.branch;
      isNewBranch = false;
      break;
    case 'scratch':
      branch = slugify(opts.description);
      isNewBranch = true;
      break;
  }

  const worktreePath = path.join(repoCwd, '.claude', 'worktrees', branch);
  if (fs.existsSync(worktreePath)) {
    return { ok: false, message: `A worktree already exists at ${worktreePath}.` };
  }

  ensureWorktreesIgnored(repoCwd);

  try {
    const args = isNewBranch
      ? ['worktree', 'add', '-b', branch, worktreePath]
      : ['worktree', 'add', worktreePath, branch];
    execFileSync('git', args, { cwd: repoCwd, encoding: 'utf8', timeout: 15000 });
    return { ok: true, value: { path: worktreePath, branch } };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export function listLocalBranches(repoCwd: string): string[] {
  try {
    const stdout = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 });
    return stdout.split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/worktrees.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/worktrees.ts extensions/null-tools/src/worktrees.test.ts
git commit -m "feat(null-tools): create worktrees from an issue, branch, or scratch description"
```

---

## Task 6: `removeWorktree` + `mergeWorktreeBack`

**Files:**
- Modify: `extensions/null-tools/src/worktrees.ts`
- Test: `extensions/null-tools/src/worktrees.test.ts`

**Interfaces:**
- Produces: `removeWorktree(repoCwd, worktreePath, force): Result<void>`, `mergeWorktreeBack(repoCwd, branch, baseBranch, mode: 'ff-only' | 'merge'): Result<{ mode: 'ff' | 'merge' }>`.

- [ ] **Step 1: Write the failing tests**

Add to `worktrees.test.ts`:

```ts
test('removeWorktree deletes the worktree directory and registration', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const created = createWorktree(dir, { kind: 'scratch', description: 'temp' });
  assert.ok(created.ok);

  const result = removeWorktree(dir, created.value.path, false);
  assert.ok(result.ok);
  assert.strictEqual(fs.existsSync(created.value.path), false);
});

test('mergeWorktreeBack refuses when the main repo has uncommitted changes', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const created = createWorktree(dir, { kind: 'scratch', description: 'feature' });
  assert.ok(created.ok);
  writeFileSync(path.join(dir, 'a.txt'), 'dirty change');

  const result = mergeWorktreeBack(dir, created.value.branch, 'main', 'ff-only');
  assert.strictEqual(result.ok, false);
});

test('mergeWorktreeBack fast-forwards when the worktree branch is ahead', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const created = createWorktree(dir, { kind: 'scratch', description: 'feature' });
  assert.ok(created.ok);
  commit(created.value.path, 'b.txt', 'feature work');

  const result = mergeWorktreeBack(dir, created.value.branch, 'main', 'ff-only');
  assert.ok(result.ok);
  assert.strictEqual(result.value.mode, 'ff');
  assert.ok(fs.existsSync(path.join(dir, 'b.txt')));
});

test('mergeWorktreeBack ff-only fails when base has diverged, and mode "merge" succeeds', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const created = createWorktree(dir, { kind: 'scratch', description: 'feature' });
  assert.ok(created.ok);
  commit(created.value.path, 'b.txt', 'feature work');
  commit(dir, 'c.txt', 'main moved on');

  const ffResult = mergeWorktreeBack(dir, created.value.branch, 'main', 'ff-only');
  assert.strictEqual(ffResult.ok, false);

  const mergeResult = mergeWorktreeBack(dir, created.value.branch, 'main', 'merge');
  assert.ok(mergeResult.ok);
  assert.strictEqual(mergeResult.value.mode, 'merge');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: FAIL — `error TS2305: Module './worktrees' has no exported member 'removeWorktree'.`

- [ ] **Step 3: Write the minimal implementation**

Add to `worktrees.ts`:

```ts
export function removeWorktree(repoCwd: string, worktreePath: string, force: boolean): Result<void> {
  try {
    const args = force ? ['worktree', 'remove', '--force', worktreePath] : ['worktree', 'remove', worktreePath];
    execFileSync('git', args, { cwd: repoCwd, encoding: 'utf8', timeout: 15000 });
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export function mergeWorktreeBack(
  repoCwd: string, branch: string, baseBranch: string, mode: 'ff-only' | 'merge',
): Result<{ mode: 'ff' | 'merge' }> {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 });
  if (status.trim().length > 0) {
    return { ok: false, message: `${repoCwd} has uncommitted changes — commit or stash before merging back.` };
  }

  try {
    execFileSync('git', ['checkout', baseBranch], { cwd: repoCwd, encoding: 'utf8', timeout: 10000 });
  } catch (err) {
    return { ok: false, message: `Failed to check out ${baseBranch}: ${(err as Error).message}` };
  }

  try {
    execFileSync('git', ['merge', mode === 'ff-only' ? '--ff-only' : '--no-edit', branch], { cwd: repoCwd, encoding: 'utf8', timeout: 10000 });
    return { ok: true, value: { mode: mode === 'ff-only' ? 'ff' : 'merge' } };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/worktrees.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/worktrees.ts extensions/null-tools/src/worktrees.test.ts
git commit -m "feat(null-tools): remove worktrees and merge a worktree's branch back"
```

---

## Task 7: `pruneCandidates` + `pruneWorktrees`

**Files:**
- Modify: `extensions/null-tools/src/worktrees.ts`
- Test: `extensions/null-tools/src/worktrees.test.ts`

**Interfaces:**
- Consumes: `listWorktrees` (Task 4).
- Produces: `pruneCandidates(repoCwd, baseBranch): Promise<{ merged: WorktreeEntry[]; missing: WorktreeEntry[] }>`, `pruneWorktrees(repoCwd): Result<void>`.

- [ ] **Step 1: Write the failing test**

Add to `worktrees.test.ts`:

```ts
test('pruneCandidates separates a merged worktree from one with a missing directory', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');

  const merged = createWorktree(dir, { kind: 'scratch', description: 'merged one' });
  assert.ok(merged.ok);
  const missing = createWorktree(dir, { kind: 'scratch', description: 'missing one' });
  assert.ok(missing.ok);

  const mergeResult = mergeWorktreeBack(dir, merged.value.branch, 'main', 'ff-only');
  assert.ok(mergeResult.ok);
  fs.rmSync(missing.value.path, { recursive: true, force: true });

  const { merged: mergedList, missing: missingList } = await pruneCandidates(dir, 'main');
  assert.ok(mergedList.some(e => e.branch === merged.value.branch));
  assert.ok(missingList.some(e => e.prunable));
});

test('pruneWorktrees removes registration for a worktree with a missing directory', () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const created = createWorktree(dir, { kind: 'scratch', description: 'to prune' });
  assert.ok(created.ok);
  fs.rmSync(created.value.path, { recursive: true, force: true });

  const result = pruneWorktrees(dir);
  assert.ok(result.ok);
  const stdout = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: dir, encoding: 'utf8' });
  assert.ok(!stdout.includes(created.value.branch));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: FAIL — `error TS2305: Module './worktrees' has no exported member 'pruneCandidates'.`

- [ ] **Step 3: Write the minimal implementation**

Add to `worktrees.ts`:

```ts
export async function pruneCandidates(
  repoCwd: string, baseBranch: string,
): Promise<{ merged: WorktreeEntry[]; missing: WorktreeEntry[] }> {
  const entries = await listWorktrees(repoCwd);
  const merged: WorktreeEntry[] = [];
  const missing: WorktreeEntry[] = [];

  let mergedBranches: string[] = [];
  try {
    const stdout = execFileSync('git', ['branch', '--merged', baseBranch, '--format=%(refname:short)'], { cwd: repoCwd, encoding: 'utf8', timeout: 5000 });
    mergedBranches = stdout.split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    // leave mergedBranches empty — nothing will be classified as merged
  }

  for (const entry of entries) {
    if (entry.isCurrent) continue;
    if (entry.prunable) { missing.push(entry); continue; }
    if (entry.branch && mergedBranches.includes(entry.branch)) merged.push(entry);
  }
  return { merged, missing };
}

export function pruneWorktrees(repoCwd: string): Result<void> {
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: repoCwd, encoding: 'utf8', timeout: 10000 });
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/worktrees.test.js`
Expected: PASS — this is the last task for `worktrees.ts`; run the full suite once more: `node --test out/worktrees.test.js` should show all tests from Tasks 2-7 passing.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/worktrees.ts extensions/null-tools/src/worktrees.test.ts
git commit -m "feat(null-tools): identify merged and missing worktrees for pruning"
```

---

## Task 8: `WorktreeTreeProvider`

**Files:**
- Create: `extensions/null-tools/src/worktreesTreeView.ts`

**Interfaces:**
- Consumes: `WorktreeEntry`, `listWorktrees` (Task 4).
- Produces: `WorktreeTreeProvider` class with `entries`, `refresh(): Promise<void>`, and the `vscode.TreeDataProvider<WorktreeEntry>` methods — Task 9 constructs it and registers it as `null.worktreesView`.

This is a `vscode`-dependent UI file with no existing test convention in this codebase (`portsTreeView.ts`, `scratchNotesTreeView.ts` have none either) — verify with a compile check and the manual smoke test in Task 10.

- [ ] **Step 1: Write the provider**

Create `worktreesTreeView.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import { WorktreeEntry, listWorktrees } from './worktrees';

export class WorktreeTreeProvider implements vscode.TreeDataProvider<WorktreeEntry> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _entries: WorktreeEntry[] = [];
  private _refreshing = false;

  constructor(private readonly _repoCwd: () => string | null) {
    void this.refresh();
  }

  get entries(): readonly WorktreeEntry[] {
    return this._entries;
  }

  async refresh(): Promise<void> {
    if (this._refreshing) return;
    this._refreshing = true;
    try {
      const cwd = this._repoCwd();
      this._entries = cwd ? await listWorktrees(cwd) : [];
    } catch {
      this._entries = [];
    } finally {
      this._refreshing = false;
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(entry: WorktreeEntry): vscode.TreeItem {
    const isClaudeSession = /[\\/]\.claude[\\/]worktrees[\\/]/.test(entry.path);
    const label = entry.branch ?? `(detached ${entry.head.slice(0, 7)})`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

    const aheadBehind = entry.ahead || entry.behind ? ` ↑${entry.ahead} ↓${entry.behind}` : '';
    item.description = `${entry.dirty ? '●' : ''}${aheadBehind}`.trim() || undefined;

    item.tooltip = new vscode.MarkdownString(
      `**${label}**\n\n${entry.path}\n\n` +
      `Head: \`${entry.head.slice(0, 7)}\`\n\n` +
      (entry.lastCommitSubject ? `Last commit: ${entry.lastCommitSubject} (${entry.lastCommitDate.slice(0, 10)})\n\n` : '') +
      `Ahead/behind base: ↑${entry.aheadBase} ↓${entry.behindBase}` +
      (entry.prunable ? '\n\n_Directory is missing — needs pruning._' : ''),
    );

    item.iconPath = new vscode.ThemeIcon(
      entry.prunable ? 'warning' : isClaudeSession ? 'hubot' : 'source-control',
      entry.isCurrent ? new vscode.ThemeColor('charts.blue') : undefined,
    );
    item.contextValue = 'worktreeEntry';
    item.id = `worktree-${entry.path}`;
    return item;
  }

  getChildren(): WorktreeEntry[] {
    return this._entries;
  }
}
```

- [ ] **Step 2: Compile check**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: PASS with no errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/null-tools/src/worktreesTreeView.ts
git commit -m "feat(null-tools): add the worktree tree data provider"
```

---

## Task 9: `worktreesIntegration.ts` — commands, settings, `copySetupFiles`

**Files:**
- Create: `extensions/null-tools/src/worktreesIntegration.ts`

**Interfaces:**
- Consumes: everything from `worktrees.ts` (Tasks 2-7), `WorktreeTreeProvider` (Task 8).
- Produces: `registerWorktreesFeature(context: vscode.ExtensionContext): void` — Task 10 calls this from `extension.ts`.

No automated test (matches `portsIntegration.ts`'s own convention) — verify with a compile check now and the manual smoke test in Task 10 once the view is registered.

- [ ] **Step 1: Write the integration module**

Create `worktreesIntegration.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  CreateWorktreeOptions, WorktreeEntry,
  createWorktree, getBaseBranch, listLocalBranches, mergeWorktreeBack,
  pruneCandidates, pruneWorktrees, removeWorktree,
} from './worktrees';
import { WorktreeTreeProvider } from './worktreesTreeView';

function repoCwd(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

function getCopyFilesGlob(): string[] {
  return vscode.workspace.getConfiguration('null.worktrees').get<string[]>('copyFilesGlob', []);
}

export async function copySetupFiles(sourceCwd: string, destCwd: string, globs: string[]): Promise<void> {
  for (const glob of globs) {
    const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(sourceCwd), glob));
    for (const match of matches) {
      const rel = path.relative(sourceCwd, match.fsPath);
      const dest = path.join(destCwd, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(match.fsPath, dest);
    }
  }
}

async function createAndOffer(cwd: string, opts: CreateWorktreeOptions, provider: WorktreeTreeProvider): Promise<void> {
  const result = createWorktree(cwd, opts);
  if (!result.ok) {
    vscode.window.showErrorMessage(`Failed to create worktree: ${result.message}`);
    return;
  }
  const globs = getCopyFilesGlob();
  if (globs.length > 0) await copySetupFiles(cwd, result.value.path, globs);
  await provider.refresh();

  const choice = await vscode.window.showInformationMessage(
    `Worktree created on branch ${result.value.branch}.`, 'Open in New Window', 'Stay Here',
  );
  if (choice === 'Open in New Window') {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(result.value.path), { forceNewWindow: true });
  }
}

export function registerWorktreesFeature(context: vscode.ExtensionContext): void {
  const provider = new WorktreeTreeProvider(repoCwd);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('null.worktreesView', provider));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void provider.refresh()));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.refresh', () => provider.refresh()));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.new', async () => {
    const cwd = repoCwd();
    if (!cwd) { vscode.window.showErrorMessage('Open a folder first.'); return; }

    const picked = await vscode.window.showQuickPick(
      [
        { label: '$(issues) From Issue…', kind: 'issue' as const },
        { label: '$(git-branch) From Existing Branch…', kind: 'branch' as const },
        { label: '$(edit) From Scratch…', kind: 'scratch' as const },
      ],
      { placeHolder: 'New worktree…' },
    );
    if (!picked) return;

    if (picked.kind === 'issue') {
      await vscode.commands.executeCommand('workbench.view.extension.null-issues');
      vscode.window.showInformationMessage('Pick an issue in the GitHub Issues panel, then use its "Create Worktree for Issue" button.');
      return;
    }

    let opts: CreateWorktreeOptions;
    if (picked.kind === 'branch') {
      const branches = listLocalBranches(cwd);
      const branchPick = await vscode.window.showQuickPick(branches, { placeHolder: 'Pick a branch…' });
      if (!branchPick) return;
      opts = { kind: 'branch', branch: branchPick };
    } else {
      const description = await vscode.window.showInputBox({ prompt: 'Describe the work (used to name the branch)' });
      if (!description) return;
      opts = { kind: 'scratch', description };
    }

    await createAndOffer(cwd, opts, provider);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.openInNewWindow', async (entry?: WorktreeEntry) => {
    if (!entry) return;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(entry.path), { forceNewWindow: true });
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.revealInExplorer', async (entry?: WorktreeEntry) => {
    if (!entry) return;
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(entry.path));
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.openTerminal', (entry?: WorktreeEntry) => {
    if (!entry) return;
    const terminal = vscode.window.createTerminal({ name: entry.branch ?? entry.path, cwd: entry.path });
    terminal.show();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.remove', async (entry?: WorktreeEntry) => {
    if (!entry) return;
    const cwd = repoCwd();
    if (!cwd) return;
    if (entry.isCurrent) { vscode.window.showErrorMessage('Cannot remove the worktree currently open in this window.'); return; }

    const confirm = await vscode.window.showWarningMessage(
      `Remove worktree at ${entry.path}${entry.dirty ? ' (has uncommitted changes)' : ''}?`,
      { modal: true }, 'Remove',
    );
    if (confirm !== 'Remove') return;

    const result = removeWorktree(cwd, entry.path, entry.dirty);
    if (!result.ok) vscode.window.showErrorMessage(`Failed to remove worktree: ${result.message}`);
    await provider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.mergeBack', async (entry?: WorktreeEntry) => {
    if (!entry) return;
    if (!entry.branch) { vscode.window.showErrorMessage('Cannot merge a detached-HEAD worktree — it has no branch.'); return; }
    const cwd = repoCwd();
    if (!cwd) return;
    const baseBranch = getBaseBranch(cwd);
    if (entry.branch === baseBranch) { vscode.window.showInformationMessage(`${entry.branch} is already the base branch.`); return; }

    let result = mergeWorktreeBack(cwd, entry.branch, baseBranch, 'ff-only');
    if (!result.ok) {
      const retry = await vscode.window.showWarningMessage(
        `Fast-forward merge failed (${result.message}). Try a regular merge instead?`, 'Merge', 'Cancel',
      );
      if (retry !== 'Merge') return;
      result = mergeWorktreeBack(cwd, entry.branch, baseBranch, 'merge');
    }
    if (!result.ok) { vscode.window.showErrorMessage(`Merge failed: ${result.message}`); return; }

    await provider.refresh();
    const cleanup = await vscode.window.showInformationMessage(
      `Merged ${entry.branch} into ${baseBranch}.`, 'Remove Worktree and Branch', 'Keep',
    );
    if (cleanup === 'Remove Worktree and Branch') {
      removeWorktree(cwd, entry.path, false);
      try { execFileSync('git', ['branch', '-d', entry.branch], { cwd, encoding: 'utf8' }); } catch { /* leave the branch if delete fails */ }
      await provider.refresh();
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.prune', async () => {
    const cwd = repoCwd();
    if (!cwd) return;
    const baseBranch = getBaseBranch(cwd);
    const { merged, missing } = await pruneCandidates(cwd, baseBranch);
    if (merged.length === 0 && missing.length === 0) {
      vscode.window.showInformationMessage('Nothing to prune.');
      return;
    }

    const items = [
      ...missing.map(e => ({ label: `$(warning) ${e.path}`, description: 'directory missing', entry: e, kind: 'missing' as const })),
      ...merged.map(e => ({ label: `$(git-merge) ${e.branch}`, description: `merged into ${baseBranch}`, entry: e, kind: 'merged' as const })),
    ];
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select worktrees to clean up…', canPickMany: true });
    if (!picked || picked.length === 0) return;

    const confirm = await vscode.window.showWarningMessage(`Clean up ${picked.length} worktree(s)?`, { modal: true }, 'Clean Up');
    if (confirm !== 'Clean Up') return;

    pruneWorktrees(cwd);
    for (const item of picked) {
      if (item.kind === 'merged') {
        removeWorktree(cwd, item.entry.path, false);
        if (item.entry.branch) {
          try { execFileSync('git', ['branch', '-d', item.entry.branch], { cwd, encoding: 'utf8' }); } catch { /* ignore */ }
        }
      }
    }
    await provider.refresh();
  }));
}
```

- [ ] **Step 2: Compile check**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: PASS with no errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/null-tools/src/worktreesIntegration.ts
git commit -m "feat(null-tools): register worktree commands, settings, and setup-file copying"
```

---

## Task 10: Wire up `package.json` contributions and `extension.ts`

**Files:**
- Modify: `extensions/null-tools/package.json`
- Modify: `extensions/null-tools/src/extension.ts`

**Interfaces:**
- Consumes: `registerWorktreesFeature` (Task 9).

- [ ] **Step 1: Add commands**

In `package.json`, inside `contributes.commands`, add after the `null.ports.copyUrl` entry (around line 108):

```json
      {
        "command": "null.worktrees.new",
        "title": "Null: New Worktree",
        "icon": "$(add)"
      },
      {
        "command": "null.worktrees.refresh",
        "title": "Null: Refresh Worktrees",
        "icon": "$(refresh)"
      },
      {
        "command": "null.worktrees.prune",
        "title": "Null: Prune Worktrees",
        "icon": "$(clear-all)"
      },
      {
        "command": "null.worktrees.openInNewWindow",
        "title": "Open Worktree in New Window",
        "icon": "$(empty-window)"
      },
      {
        "command": "null.worktrees.revealInExplorer",
        "title": "Reveal in File Explorer",
        "icon": "$(folder-opened)"
      },
      {
        "command": "null.worktrees.openTerminal",
        "title": "Open Terminal Here",
        "icon": "$(terminal)"
      },
      {
        "command": "null.worktrees.mergeBack",
        "title": "Merge Back into Base Branch",
        "icon": "$(git-merge)"
      },
      {
        "command": "null.worktrees.remove",
        "title": "Remove Worktree",
        "icon": "$(trash)"
      },
```

- [ ] **Step 2: Add the view**

In `contributes.views.null-workspace`, add after `null.portsView`:

```json
        {
          "id": "null.worktreesView",
          "name": "Worktrees"
        }
```

- [ ] **Step 3: Add menus**

In `contributes.menus."view/title"`, add after the `null.ports.refresh` entry:

```json
        {
          "command": "null.worktrees.new",
          "when": "view == null.worktreesView",
          "group": "navigation"
        },
        {
          "command": "null.worktrees.refresh",
          "when": "view == null.worktreesView",
          "group": "navigation"
        },
        {
          "command": "null.worktrees.prune",
          "when": "view == null.worktreesView",
          "group": "navigation"
        }
```

In `contributes.menus."view/item/context"`, add after the `null.ports.killProcess` entry:

```json
        {
          "command": "null.worktrees.openInNewWindow",
          "when": "view == null.worktreesView && viewItem == worktreeEntry",
          "group": "inline@1"
        },
        {
          "command": "null.worktrees.revealInExplorer",
          "when": "view == null.worktreesView && viewItem == worktreeEntry",
          "group": "inline@2"
        },
        {
          "command": "null.worktrees.openTerminal",
          "when": "view == null.worktreesView && viewItem == worktreeEntry",
          "group": "inline@3"
        },
        {
          "command": "null.worktrees.mergeBack",
          "when": "view == null.worktreesView && viewItem == worktreeEntry"
        },
        {
          "command": "null.worktrees.remove",
          "when": "view == null.worktreesView && viewItem == worktreeEntry"
        }
```

In `contributes.menus.commandPalette`, add after `null.ports.copyUrl`:

```json
        { "command": "null.worktrees.new" },
        { "command": "null.worktrees.refresh" },
        { "command": "null.worktrees.prune" },
        { "command": "null.worktrees.openInNewWindow", "when": "false" },
        { "command": "null.worktrees.revealInExplorer", "when": "false" },
        { "command": "null.worktrees.openTerminal", "when": "false" },
        { "command": "null.worktrees.mergeBack", "when": "false" },
        { "command": "null.worktrees.remove", "when": "false" }
```

(`"when": "false"` for the entry-scoped commands matches the existing `null.renameScratchOrNoteItem`/`null.deleteScratchOrNoteItem` precedent — they only make sense with a tree item argument, so they're hidden from the palette.)

- [ ] **Step 4: Add the setting**

In `contributes.configuration.properties`, add after `null.ports.filterDevOnly`:

```json
        "null.worktrees.copyFilesGlob": {
          "type": "array",
          "default": [],
          "items": { "type": "string" },
          "description": "Glob patterns for untracked setup files (e.g. .env, .claude/settings.local.json) to copy into every newly created worktree."
        },
```

- [ ] **Step 5: Register the feature in `extension.ts`**

Add the import near the other feature registrations (after `import { registerPortsFeature } from './portsIntegration';`):

```ts
import { registerWorktreesFeature } from './worktreesIntegration';
```

Add the call in `activate()`, next to `registerPortsFeature(context);`:

```ts
  registerPortsFeature(context);
  registerWorktreesFeature(context);
```

- [ ] **Step 6: Validate and compile**

Run: `cd extensions/null-tools && node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))"` (confirms the JSON is well-formed)
Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: both PASS with no errors.

- [ ] **Step 7: Manual smoke test**

This step needs the real Null IDE build, not just `tsc` — per this repo's `CLAUDE.md`, full builds run in CI, but `extensions/null-tools` can be synced into a local Null IDE install for manual verification (see the `verify-local` skill if available). At minimum, confirm:
- The "Worktrees" view appears in the Null Workspace activity-bar container.
- "Null: New Worktree" → From Scratch creates a worktree under `.claude/worktrees/` and offers to open it in a new window.
- The tree shows dirty/ahead-behind and refreshes after create/remove/merge/prune.

- [ ] **Step 8: Commit**

```bash
git add extensions/null-tools/package.json extensions/null-tools/src/extension.ts
git commit -m "feat(null-tools): contribute the Worktrees view, commands, menus, and setting"
```

---

## Task 11: Issues panel integration — "Create Worktree for Issue"

**Files:**
- Modify: `extensions/null-tools/src/issuesPanel.ts`
- Modify: `extensions/null-tools/src/webview/issues.ts`

**Interfaces:**
- Consumes: `createWorktree` (Task 5).

- [ ] **Step 1: Add the message type and handler in `issuesPanel.ts`**

Add the import: `import { createWorktree } from './worktrees';`

Add to the `InboundMessage` union (after `| { type: 'createBranchForIssue'; number: number }`):

```ts
  | { type: 'createWorktreeForIssue'; number: number }
```

Add the case (after the existing `case 'createBranchForIssue':` block, in the same `switch`):

```ts
      case 'createWorktreeForIssue': {
        const issue = this._store.getByNumber(msg.number);
        const cwd = this._cwd();
        if (!issue || !cwd) break;
        const result = createWorktree(cwd, { kind: 'issue', issueNumber: issue.number, title: issue.title });
        if (!result.ok) { void vscode.window.showErrorMessage(`Failed to create worktree: ${result.message}`); break; }
        const choice = await vscode.window.showInformationMessage(
          `Worktree created on branch ${result.value.branch}.`, 'Open in New Window', 'Stay Here',
        );
        if (choice === 'Open in New Window') {
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(result.value.path), { forceNewWindow: true });
        }
        break;
      }
```

(The method containing this `switch` is already `async` — it calls `await this._sendIssues()` elsewhere in the file — so `await` here is valid.)

- [ ] **Step 2: Add the button in `webview/issues.ts`**

Add a new icon constant near `BRANCH_ICON` (top of file):

```ts
const WORKTREE_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/><path d="M4.5 7v3a1 1 0 001 1h3" stroke-linecap="round"/></svg>';
```

Add the button next to the existing branch button (in `renderList`, in the `row-actions` div):

```ts
            <button class="branch-btn" title="Create branch for this issue">${BRANCH_ICON}</button>
            <button class="worktree-btn" title="Create worktree for this issue">${WORKTREE_ICON}</button>
```

Add the event listener next to the branch button's (inside the `forEach(row => ...)` loop):

```ts
      row.querySelector('.worktree-btn')?.addEventListener('click', ev => {
        ev.stopPropagation();
        vscode.postMessage({ type: 'createWorktreeForIssue', number });
      });
```

- [ ] **Step 3: Compile check**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && npx tsc -p tsconfig.webview-issues.json`
Expected: PASS with no errors.

- [ ] **Step 4: Manual smoke test**

In a synced local Null IDE build: open the GitHub Issues panel, hover an issue row, click the new worktree-icon button, confirm a worktree is created and the "Open in New Window" prompt appears.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/issuesPanel.ts extensions/null-tools/src/webview/issues.ts
git commit -m "feat(null-tools): add Create Worktree for Issue to the Issues panel list"
```

---

## Task 12: Issue detail panel integration — "Create Worktree"

**Files:**
- Modify: `extensions/null-tools/src/issueDetailPanel.ts`
- Modify: `extensions/null-tools/src/webview/issueDetail.ts`

**Interfaces:**
- Consumes: `createWorktree` (Task 5).

- [ ] **Step 1: Add the message type and handler in `issueDetailPanel.ts`**

Add the import: `import { createWorktree } from './worktrees';`

Add to the `InboundMessage` union (after `| { type: 'createBranch' }`):

```ts
  | { type: 'createWorktree' }
```

Add the case (after the existing `case 'createBranch':` block):

```ts
      case 'createWorktree': {
        const issue = this.store.getByNumber(this.issueNumber);
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!issue || !cwd) break;
        const result = createWorktree(cwd, { kind: 'issue', issueNumber: issue.number, title: issue.title });
        if (!result.ok) { void vscode.window.showErrorMessage(`Failed to create worktree: ${result.message}`); break; }
        const choice = await vscode.window.showInformationMessage(
          `Worktree created on branch ${result.value.branch}.`, 'Open in New Window', 'Stay Here',
        );
        if (choice === 'Open in New Window') {
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(result.value.path), { forceNewWindow: true });
        }
        break;
      }
```

- [ ] **Step 2: Add the button in `webview/issueDetail.ts`**

In the button row markup (around the `branch-btn` button), add a sibling:

```ts
        <button class="btn btn-ghost" id="branch-btn">Branch</button>
        <button class="btn btn-ghost" id="worktree-btn">Worktree</button>
```

Add the event listener next to `branch-btn`'s in `bindEvents`:

```ts
    document.getElementById('worktree-btn')?.addEventListener('click', () =>
      vscode.postMessage({ type: 'createWorktree' }));
```

- [ ] **Step 3: Compile check**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && npx tsc -p tsconfig.webview-issue-detail.json`
Expected: PASS with no errors.

- [ ] **Step 4: Manual smoke test**

In a synced local Null IDE build: open an issue's detail panel, click "Worktree", confirm a worktree is created and the "Open in New Window" prompt appears.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/issueDetailPanel.ts extensions/null-tools/src/webview/issueDetail.ts
git commit -m "feat(null-tools): add Create Worktree to the issue detail panel"
```

# Git Pull: Diverged Branches Implementation Plan

> **For agentic workers:** See Execution Options below. The checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** When `Null: Pull` finds a branch that has diverged from its upstream, let the user choose Rebase or Merge in a prompt, instead of being told to "merge or rebase by hand".

**Architecture:** `pull()` keeps its fast-forward-only behaviour and now reports how far each side moved (`ahead`, `behind`). A new `integrateUpstream(git, inProgress, strategy)` in `gitActions.ts` runs `git rebase @{u}` or `git merge --no-edit @{u}` through the existing `sequencer`, so a conflict becomes a *stopped* operation. The graph already handles stopped operations: the in-progress banner, `null.graph.continue|skip|abort`, `resumeOperation`, and `reportOperation`. `pullFlow` in `graphCommands.ts` asks the question and calls the new action. No webview change, no new command, no new setting.

**Tech Stack:** TypeScript (null-tools `src/graph/`), `node:test` against real temporary git repos (the style `gitActions.test.ts` already uses for cherry-pick and reset).

**Spec:** [docs/specs/commit-graph-design.md](../specs/commit-graph-design.md) (actions table, "Rules for all actions"). Predecessor plan: [git-pull.md](git-pull.md), already shipped; it left `diverged` as a dead end and listed "merge or rebase option" as a later plan. This is that plan.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- `out/` is tracked. After editing `src/`, run `npm run compile` in `extensions/null-tools` and commit the refreshed `out/` in its own commit (`chore: refresh null-tools compiled output`). Never hand-edit `out/`.
- A new test file must be added to the explicit list in `extensions/null-tools/package.json` `test` script, or it is silently skipped. This plan adds no new file; `out/graph/gitActions.test.js` is already listed.
- Only `graphSession`, `commitGraphPanel`, `graphTreeView`, `graphCommands`, `graphDiff`, `gitApi` and `graphIntegration` may import `vscode`. `gitActions.ts` stays vscode-free.
- `gitRun.ts` is the only place that spawns git. It already sets `GIT_EDITOR=true`, `GIT_TERMINAL_PROMPT=0` and `LC_ALL=C`; do not work around them.
- No force flags, no push (spec, "Rules for all actions"). Rebase and merge here touch only the local branch.
- No `--autostash`. A dirty tree makes git refuse and its message reaches the user; a stash that fails to re-apply would add a second conflict state on top of the first.
- Amends the predecessor plan's "Pull never merges and never rebases": it still never does so on its own. Only an explicit Rebase or Merge click in the prompt may.
- Tests use `node:test` and `node:assert` with the helpers already in `gitActions.test.ts` (`initRepo`, `commit`, `git`, `tools`, `expectOk`, `fakeGit`). Do not use `describe`/`expect`.

## Review Focus

1. A rebase or merge that hits a conflict: reported as stopped (not an error), the banner state is reachable, and Abort restores the branch to exactly the commit it was on.
2. Dirty tracked files in the way: git refuses with its own message, HEAD and the files are untouched, and no half-started operation is left behind.
3. Upstream was force-pushed or amended, so a local commit has the same patch as an incoming one: Rebase must drop the duplicate instead of producing a conflict or a second copy.
4. The user dismisses the prompt: nothing runs. (Not unit-testable, `vscode` is involved; covered by the manual step in Task 3.)
5. The branch stops being diverged between the prompt and the click (a commit or fetch in a terminal): the chosen operation must still be safe, never a force or a reset.

Items 1 to 3 get their tests in Task 1. Item 5 holds by construction (`rebase @{u}` and `merge @{u}` never discard commits, and `runAction` refuses while another operation is in progress). Item 4 is a manual check in Task 3.

---

### Task 1: `integrateUpstream` and `diverged` counts in gitActions

**Files:**
- Modify: `extensions/null-tools/src/graph/gitActions.ts` (`PullOutcome` at line 118, `pull` at line 139, new function after `pull`)
- Test: `extensions/null-tools/src/graph/gitActions.test.ts` (import at line 9, edit the diverged test at line 247, append after line 315)

**Interfaces:**
- Consumes: `sequencer(git, inProgress, args): Promise<Result<StoppedInfo>>` and the `InProgress` type, both already in `gitActions.ts`; `resumeOperation` for the abort assertions.
- Produces:
  - `PullOutcome` variant changes to `{ kind: 'diverged'; ahead: number; behind: number }`.
  - `export type IntegrateStrategy = 'rebase' | 'merge'`
  - `export function integrateUpstream(git: RunGit, inProgress: InProgress, strategy: IntegrateStrategy): Promise<Result<StoppedInfo>>`. Task 2 calls it.

- [ ] **Step 1: Write the failing tests**

In `gitActions.test.ts`, change the import on line 9 to add `integrateUpstream`:

```ts
import { cherryPick, checkout, createBranch, integrateUpstream, pull, reset, resetImpact, resumeOperation, revert } from './gitActions';
```

Replace the expectation in the test `pull reports diverged and does not pull when local and upstream both have commits` (line 255) with:

```ts
  assert.deepStrictEqual(await pull(git), { ok: true, value: { kind: 'diverged', ahead: 1, behind: 2 } });
```

Append to the end of the file:

```ts
// A clone whose branch has one local commit while origin has one new commit: ahead 1, behind 1, upstream already fetched.
function divergedClone(local: [file: string, content: string], remote: [file: string, content: string]): string {
  const origin = initRepo();
  commit(origin, 'a.txt', 'base', 'base');
  const clone = path.join(mkdtempSync(path.join(tmpdir(), 'graph-pull-')), 'c');
  execFileSync('git', ['clone', '-q', origin, clone]);
  for (const [key, value] of [['user.email', 'test@example.com'], ['user.name', 'Test'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) {
    git(clone, 'config', key, value);
  }
  commit(clone, local[0], local[1], 'local change');
  commit(origin, remote[0], remote[1], 'remote change');
  git(clone, 'fetch', '-q');
  return clone;
}

test('integrateUpstream rebase puts the local commit on top of the upstream with no merge commit', async () => {
  const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
  const { run, inProgress } = tools(clone);
  assert.strictEqual(expectOk(await integrateUpstream(run, inProgress, 'rebase')).stopped, false);
  assert.strictEqual(git(clone, 'log', '--format=%s'), 'local change\nremote change\nbase');
  assert.strictEqual(git(clone, 'rev-list', '--merges', '--count', 'HEAD'), '0');
  assert.strictEqual(await inProgress(), null);
});

test('integrateUpstream merge adds one merge commit that keeps both histories', async () => {
  const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
  const { run, inProgress } = tools(clone);
  assert.strictEqual(expectOk(await integrateUpstream(run, inProgress, 'merge')).stopped, false);
  assert.strictEqual(git(clone, 'rev-list', '--parents', '-n1', 'HEAD').split(' ').length, 3, 'a merge commit has two parents');
  assert.strictEqual(await inProgress(), null);
});

test('a conflicting rebase or merge is a stop, and Abort puts the branch back on the same commit', async () => {
  for (const strategy of ['rebase', 'merge'] as const) {
    const clone = divergedClone(['a.txt', 'local'], ['a.txt', 'remote']);
    const { run, inProgress } = tools(clone);
    const before = git(clone, 'rev-parse', 'HEAD');
    assert.strictEqual(expectOk(await integrateUpstream(run, inProgress, strategy)).stopped, true, strategy);
    assert.deepStrictEqual(await inProgress(), { kind: strategy }, strategy);
    expectOk(await resumeOperation(run, inProgress, 'abort'));
    assert.strictEqual(git(clone, 'rev-parse', 'HEAD'), before, `${strategy}: HEAD restored`);
    assert.strictEqual(await inProgress(), null, strategy);
    assert.strictEqual(readFileSync(path.join(clone, 'a.txt'), 'utf8'), 'local', `${strategy}: file restored`);
  }
});

test('integrateUpstream is refused on a dirty tree, with the tree and HEAD untouched and no operation started', async () => {
  // Rebase refuses any unstaged change; merge refuses when the change overlaps what comes in.
  const cases = [
    { strategy: 'rebase', remote: ['o.txt', 'remote'] },
    { strategy: 'merge', remote: ['a.txt', 'remote'] },
  ] as const;
  for (const { strategy, remote } of cases) {
    const clone = divergedClone(['l.txt', 'local'], [remote[0], remote[1]]);
    const { run, inProgress } = tools(clone);
    const before = git(clone, 'rev-parse', 'HEAD');
    writeFileSync(path.join(clone, 'a.txt'), 'dirty');
    const result = await integrateUpstream(run, inProgress, strategy);
    assert.strictEqual(result.ok, false, strategy);
    assert.strictEqual(git(clone, 'rev-parse', 'HEAD'), before, `${strategy}: HEAD`);
    assert.strictEqual(readFileSync(path.join(clone, 'a.txt'), 'utf8'), 'dirty', `${strategy}: file`);
    assert.strictEqual(await inProgress(), null, strategy);
  }
});

test('integrateUpstream rebase drops a local commit whose patch the upstream already has', async () => {
  // The upstream was amended or squashed: the same change exists on both sides under different hashes.
  const clone = divergedClone(['o.txt', 'same'], ['o.txt', 'same']);
  const { run, inProgress } = tools(clone);
  assert.strictEqual(expectOk(await integrateUpstream(run, inProgress, 'rebase')).stopped, false);
  assert.strictEqual(git(clone, 'rev-parse', 'HEAD'), git(clone, 'rev-parse', '@{u}'), 'no duplicate commit is left');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `extensions/null-tools`): `npm test`
Expected: FAIL to compile, `integrateUpstream` is not exported from `./gitActions`, and `diverged` has no `ahead`/`behind`.

- [ ] **Step 3: Write the minimal implementation**

In `gitActions.ts`, change the `diverged` variant of `PullOutcome`:

```ts
  | { kind: 'diverged'; ahead: number; behind: number };
```

Change the line in `pull` that returns it:

```ts
    if (ahead > 0) return ok({ kind: 'diverged', ahead, behind });
```

Append after `pull`:

```ts
export type IntegrateStrategy = 'rebase' | 'merge';

/**
 * Brings a diverged branch level with its upstream. The caller has fetched already, so this never touches the network.
 * No --autostash: a dirty tree is refused by git and its message comes back as a failure.
 */
export function integrateUpstream(git: RunGit, inProgress: InProgress, strategy: IntegrateStrategy): Promise<Result<StoppedInfo>> {
  return sequencer(git, inProgress, strategy === 'rebase' ? ['rebase', '@{u}'] : ['merge', '--no-edit', '@{u}']);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` in `extensions/null-tools`
Expected: PASS, including the five new `integrateUpstream` cases and the updated `diverged` assertion. If the dirty-tree merge case passes `ok: true`, the remote file in that case does not overlap the dirty file; the case must change `a.txt` upstream.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/graph/gitActions.ts extensions/null-tools/src/graph/gitActions.test.ts
git commit -m "feat(null-tools): rebase or merge a diverged branch onto its upstream"
```

---

### Task 2: Ask Rebase or Merge in `pullFlow`

**Files:**
- Modify: `extensions/null-tools/src/graph/graphCommands.ts` (import at line 7, `pullMessage` at lines 117-125, `pullFlow` at lines 127-131)

**Interfaces:**
- Consumes: `integrateUpstream`, `IntegrateStrategy` and `PullOutcome` (with `ahead`/`behind`) from Task 1; `reportOperation(result, label)` (line 20), `session.runAction`, `a.service.inProgress()`, all already in this file.
- Produces: nothing new for later tasks. The command id stays `null.graph.pull`.

- [ ] **Step 1: Update the import**

On line 7 add `IntegrateStrategy` and `integrateUpstream` to the import from `./gitActions`:

```ts
import {
  CheckoutTarget, IntegrateStrategy, PullOutcome, StoppedInfo, checkout, cherryPick, createBranch, integrateUpstream, pull, reset, resetImpact, resumeOperation, revert,
} from './gitActions';
```

- [ ] **Step 2: Replace `pullMessage` and `pullFlow`**

Replace lines 117-131 with:

```ts
type SettledPull = Exclude<PullOutcome, { kind: 'diverged' }>;

/** One line per outcome. A refused pull is named, never silent. */
function pullMessage(outcome: SettledPull): void {
  switch (outcome.kind) {
    case 'upToDate': void vscode.window.showInformationMessage('Already up to date.'); return;
    case 'fastForwarded': void vscode.window.showInformationMessage(`Pulled ${outcome.commits} ${outcome.commits === 1 ? 'commit' : 'commits'}.`); return;
    case 'noUpstream': void vscode.window.showWarningMessage('This branch has no upstream to pull from.'); return;
  }
}

const commits = (n: number, adjective: string): string => `${n} ${adjective} ${n === 1 ? 'commit' : 'commits'}`;

/** Pull never merges or rebases on its own: a diverged branch asks, and a dismissed prompt changes nothing. */
async function divergedFlow(session: GraphSession, ahead: number, behind: number): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    `This branch has diverged from its upstream: ${commits(ahead, 'local')}, ${commits(behind, 'incoming')}.`,
    {
      modal: true,
      detail: 'Rebase puts your local commits on top of the incoming ones and keeps history linear; your local commits get new hashes. '
        + 'Merge keeps every commit as it is and adds a merge commit. Either can stop on conflicts: the Commit Graph then offers Continue, Skip and Abort.',
    },
    'Rebase', 'Merge',
  );
  if (choice !== 'Rebase' && choice !== 'Merge') return;
  const strategy: IntegrateStrategy = choice === 'Rebase' ? 'rebase' : 'merge';
  const result = await session.runAction((a) => integrateUpstream(a.act, () => a.service.inProgress(), strategy));
  await reportOperation(result, choice);
  if (result.ok && !result.value.stopped) {
    void vscode.window.showInformationMessage(strategy === 'rebase' ? 'Rebased onto the upstream.' : 'Merged the upstream.');
  }
}

async function pullFlow(session: GraphSession): Promise<void> {
  const result = await session.runAction((a) => pull(a.act));
  if (!result.ok) { report(result); return; }
  const outcome = result.value;
  if (outcome.kind === 'diverged') { await divergedFlow(session, outcome.ahead, outcome.behind); return; }
  pullMessage(outcome);
}
```

- [ ] **Step 3: Compile and run the tests**

Run: `npx tsc -p . --noEmit` then `npm test` in `extensions/null-tools`
Expected: no type errors (the `switch` in `pullMessage` is exhaustive over `SettledPull`), all tests PASS. This step has no new unit test: everything in the function is `vscode` calls, and the git behaviour it relies on is pinned by Task 1.

- [ ] **Step 4: Commit**

```bash
git add extensions/null-tools/src/graph/graphCommands.ts
git commit -m "feat(null-tools): Null: Pull offers Rebase or Merge when the branch has diverged"
```

---

### Task 3: Spec row, compiled output and local verification

**Files:**
- Modify: `docs/specs/commit-graph-design.md` (actions table, insert after the "Reset soft/mixed/hard" row at line 94)
- Modify: `extensions/null-tools/out/**` (generated by `npm run compile`; never hand-edit)

- [ ] **Step 1: Add the Pull row to the spec**

Insert after line 94 of `docs/specs/commit-graph-design.md`:

```markdown
| Pull | `git fetch`, then `git pull --ff-only`; when the branch has diverged, `git rebase @{u}` or `git merge --no-edit @{u}` | Command only (view title), no row context. A branch without an upstream, or already up to date, gets a one-line message. A diverged branch gets a modal naming the local and incoming commit counts with Rebase / Merge; dismissing it runs nothing. No `--autostash`: a dirty tree makes git refuse and its message is shown. Conflicts stop the operation and the banner offers Continue / Skip / Abort. |
```

- [ ] **Step 2: Commit the spec row**

```bash
git add docs/specs/commit-graph-design.md
git commit -m "docs: describe Null: Pull in the commit graph spec"
```

- [ ] **Step 3: Refresh compiled output**

Run: `npm run compile` in `extensions/null-tools`, then `git status extensions/null-tools/out`.
Expected: only `out/graph/gitActions.js`, `out/graph/gitActions.test.js` and `out/graph/graphCommands.js` (plus their `.map` or `.d.ts` siblings if tracked) changed.

- [ ] **Step 4: Commit compiled output separately**

```bash
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output"
```

- [ ] **Step 5: Verify in the real build**

Run `/verify-local null-tools` (syncs into the installed Null IDE and runs the integration specs). Then, in a scratch clone of a throwaway repo, make one local commit and one commit on the remote so the branch is ahead 1 / behind 1, and run `Null: Pull` from the Commit Graph view title:

1. Click Rebase with non-overlapping changes. Expected: "Rebased onto the upstream.", `git log --oneline --graph` is a straight line.
2. Reset the scratch clone, repeat with Merge. Expected: "Merged the upstream." and one merge commit.
3. Reset, make both sides edit the same line, click Rebase. Expected: the "Rebase stopped" warning with Continue / Skip / Abort, and the banner in the graph tab. Click Abort; `git status` is clean and HEAD is the pre-pull commit.
4. Reset, run `Null: Pull` and press Escape on the prompt. Expected: nothing changes (`git reflog` shows no new entry).
5. Reset, edit a tracked file without committing, click Rebase. Expected: an error toast carrying git's "cannot rebase: You have unstaged changes" text, and the edit still there.

Expected: all five as stated.

- [ ] **Step 6: Report**

Report which of Steps 1 to 5 ran, with output. Do not push.

---

## Notes for the Reviewer of This Plan

- Not in scope: honouring git's own `pull.rebase` / `pull.ff` config (skip the prompt when the user already chose), a "remember my choice" setting, `--autostash`, a webview button, and auto-fetch on a timer. Each is a separate small plan if wanted; the prompt is the one place a default could later be injected.
- Rebase rewrites the *local* commits only, and they are by definition not on the upstream. They can still be on another branch or a different remote; the modal says they get new hashes, which is the warning this case needs.
- `reportOperation(result, choice)` reuses its "Rebase stopped / Merge stopped" wording and its Continue / Skip / Abort buttons unchanged; `resumeOperation` already refuses Skip on a merge.

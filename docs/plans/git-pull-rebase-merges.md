# Git Pull: Honour pull.rebase=merges Implementation Plan

> **For agentic workers:** See Execution Options below. The checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** When `Null: Pull` finds a diverged branch and git's config says `pull.rebase=merges` (or `branch.<name>.rebase=merges`), rebase with `--rebase-merges` and keep the user's local merge commits, instead of asking and then flattening them with a plain rebase.

**Architecture:** `IntegrateStrategy` gains a third value, `'rebase-merges'`, which `integrateUpstream` maps to `git rebase --rebase-merges @{u}` through the existing `sequencer`. `pullPreference` returns `'rebase-merges'` for the `merges` value instead of `'ask'`. `divergedFlow` in `graphCommands.ts` already runs any non-`ask` preference without the modal, so it needs only its label text extended. `interactive` keeps asking because it needs an editor. No new setting, no new command, no webview change.

**Tech Stack:** TypeScript (null-tools `src/graph/`), `node:test` against real temporary git repos (the `divergedClone` helper and `git(...)` shell helper in `gitActions.test.ts`).

**Spec:** [docs/specs/commit-graph-design.md](../specs/commit-graph-design.md) (actions table, Pull row). Predecessor plans, all shipped: [git-pull-config.md](git-pull-config.md) and [git-pull-remember.md](git-pull-remember.md). Both listed `--rebase-merges` for `pull.rebase=merges` as out of scope; this plan is that follow-on.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Rebase only through `sequencer` in `gitActions.ts`, so a conflict stops the operation and the banner offers Continue / Skip / Abort. No other rebase path.
- No `--autostash`, no `--force`, no push, no fetch inside the action (the caller fetches first).
- `interactive` keeps the Rebase / Merge modal. `preserve` and unknown values keep asking, as today.
- Repo-local config only is written; this plan writes no config at all.
- Tests are added to the existing `gitActions.test.ts` and `graphCommands` test files that already run in the `npm test` list in `extensions/null-tools/package.json`. A new test file must be added to that list or it is silently skipped.
- Compiled `out/` is committed with the source change (`npm run compile` in `extensions/null-tools`).

## Review Focus

1. `pull.rebase=merges` in the repo, but `branch.<name>.rebase=false` for the current branch: the branch value wins, so the pull merges and never rebases with `--rebase-merges`. Pinned in Task 2.
2. `pull.rebase=merges` on a detached HEAD: there is no branch to rebase, so the action reports "nothing to pull" like today, and does not run a rebase. Pinned in Task 2.
3. `--rebase-merges` with a conflict on a local merge commit: the operation stops, `inProgress` reports it, and Abort returns the branch to its original commit. Pinned in Task 1.
4. A local merge commit whose upstream already contains its side branch: the rebase must not produce a duplicate or empty merge. Pinned in Task 1.
5. `pull.rebase=merges` with no local merge commits: the result must be linear history equal to a plain rebase, with no error from `--rebase-merges`. Pinned in Task 1.

---

### Task 1: `rebase-merges` strategy in `integrateUpstream`

**Files:**
- Modify: `extensions/null-tools/src/graph/gitActions.ts:153-155` (the `IntegrateStrategy` type and `integrateUpstream` body)
- Test: `extensions/null-tools/src/graph/gitActions.test.ts` (add after the test at line 382)

**Interfaces:**
- Consumes: `sequencer(git, inProgress, args)` (`gitActions.ts:62`), `divergedClone` and `git(dir, ...args)` helpers already in `gitActions.test.ts`.
- Produces: `export type IntegrateStrategy = 'rebase' | 'merge' | 'rebase-merges';` and `integrateUpstream(git, inProgress, strategy)` accepting all three. Task 2 and Task 3 rely on the literal string `'rebase-merges'`.

- [ ] **Step 1: Write the failing test**

Add to `gitActions.test.ts`:

```ts
test('integrateUpstream rebase-merges keeps a local merge commit and adds no merge to the upstream history', async () => {
  const clone = divergedClone(['local.txt', 'local'], ['remote.txt', 'remote']);
  const run = runGitIn(clone);
  // Local side branch merged into main with a real merge commit (--no-ff), on top of the diverged history.
  git(clone, 'checkout', '-b', 'side');
  fs.writeFileSync(path.join(clone, 'side.txt'), 'side');
  git(clone, 'add', 'side.txt');
  git(clone, 'commit', '-m', 'side');
  git(clone, 'checkout', 'main');
  git(clone, 'merge', '--no-ff', '-m', 'merge side', 'side');
  const inProgress = () => Promise.resolve(null);

  assert.strictEqual(expectOk(await integrateUpstream(run, inProgress, 'rebase-merges')).stopped, false);
  assert.strictEqual(git(clone, 'rev-list', '--merges', '--count', '@{u}..HEAD'), '1');
  assert.strictEqual(git(clone, 'rev-list', '--count', '@{u}..HEAD'), '3');
});

test('integrateUpstream rebase-merges on a linear branch gives the same history as a plain rebase', async () => {
  const linear = divergedClone(['local.txt', 'local'], ['remote.txt', 'remote']);
  const plain = divergedClone(['local.txt', 'local'], ['remote.txt', 'remote']);
  expectOk(await integrateUpstream(runGitIn(linear), () => Promise.resolve(null), 'rebase-merges'));
  expectOk(await integrateUpstream(runGitIn(plain), () => Promise.resolve(null), 'rebase'));
  assert.strictEqual(git(linear, 'rev-list', '--merges', '--count', '@{u}..HEAD'), '0');
  assert.strictEqual(git(linear, 'log', '--format=%s', '@{u}..HEAD'), git(plain, 'log', '--format=%s', '@{u}..HEAD'));
});
```

The helper names `runGitIn` and `git` stand for whatever `gitActions.test.ts` already uses to build a `RunGit` for a directory and to run git in a directory. Before writing, open the test at line 332 and copy its exact setup and `expectOk` usage; if the file names them differently, use the file's names. Do not add new helpers.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-tools && npm run compile && node --test out/graph/gitActions.test.js`
Expected: FAIL. TypeScript rejects `'rebase-merges'` in `tsc` (not assignable to `IntegrateStrategy`), so the compile step is the failure.

- [ ] **Step 3: Write minimal implementation**

In `gitActions.ts`, replace the type and the function body:

```ts
export type IntegrateStrategy = 'rebase' | 'merge' | 'rebase-merges';
```

```ts
export function integrateUpstream(git: RunGit, inProgress: InProgress, strategy: IntegrateStrategy): Promise<Result<StoppedInfo>> {
  const args = strategy === 'merge'
    ? ['merge', '--no-edit', '@{u}']
    : ['rebase', ...(strategy === 'rebase-merges' ? ['--rebase-merges'] : []), '@{u}'];
  return sequencer(git, inProgress, args);
}
```

Also update the doc comment above it (`integrateUpstream`) to say `rebase-merges` recreates local merge commits on top of the upstream.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/null-tools && npm run compile && node --test out/graph/gitActions.test.js`
Expected: PASS for both new tests and every existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/graph/gitActions.ts extensions/null-tools/src/graph/gitActions.test.ts extensions/null-tools/out/graph/
git commit -m "feat(null-tools): integrateUpstream can rebase with --rebase-merges"
```

---

### Task 2: `pullPreference` returns `'rebase-merges'` for `merges`

**Files:**
- Modify: `extensions/null-tools/src/graph/gitActions.ts:166-186` (the `PullPreference` type, the doc comment, and the `pullPreference` body)
- Test: `extensions/null-tools/src/graph/gitActions.test.ts:435-437` (the "asks for the rebase modes" test) and the decision-table test at lines 420-430

**Interfaces:**
- Consumes: `IntegrateStrategy` now including `'rebase-merges'` (Task 1).
- Produces: `export type PullPreference = 'rebase' | 'merge' | 'rebase-merges' | 'ff-only' | 'ask';`. Task 3 relies on this exact union.

- [ ] **Step 1: Write the failing test**

Replace the test at lines 435-439 with:

```ts
test('pullPreference asks only for the values Null cannot act on', async () => {
  for (const value of ['interactive', 'preserve', 'nonsense']) {
    assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': value })), 'ask', value);
  }
});

test('pullPreference maps merges to rebase-merges, scoped and unscoped', async () => {
  assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': 'merges' })), 'rebase-merges');
  assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': 'false', 'branch.main.rebase': 'MERGES' })), 'rebase-merges');
  assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': 'merges', 'pull.ff': 'only' })), 'rebase-merges');
});

test('pullPreference: detached HEAD with merges still returns rebase-merges, the flow reports the detached state', async () => {
  assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': 'merges' }, null)), 'rebase-merges');
});
```

The `pull.ff=only` line is deliberate: `ff-only` wins over a rebase setting only when `rebase` is a boolean-false value, so `merges` with `ff=only` must still rebase-merges, matching the existing rule that a rebase setting beats `pull.ff`.

Note on the detached-HEAD test: `pullPreference` never reads the branch on detached HEAD and `divergedFlow` is reached only after a branch exists, so the detached case must not run a rebase in practice. Task 3 pins that in the flow. This unit test only pins the mapping.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-tools && npm run compile && node --test out/graph/gitActions.test.js`
Expected: FAIL on `maps merges to rebase-merges` (received `'ask'`).

- [ ] **Step 3: Write minimal implementation**

Change the union and the one line that returns `'ask'` for any non-empty rebase value:

```ts
export type PullPreference = 'rebase' | 'merge' | 'rebase-merges' | 'ff-only' | 'ask';
```

In `pullPreference`, after the boolean checks, insert the `merges` branch before the generic `if (rebase) return 'ask';`:

```ts
  if (rebase === 'merges') return 'rebase-merges';
  if (rebase) return 'ask';
```

Update the doc comment: replace "`merges` and `interactive` are not offered by Null, so they ask rather than silently rebase plainly." with "`merges` maps to `rebase-merges`; `interactive` is not offered by Null (it needs an editor), so it asks rather than silently rebase plainly."

Confirm `rebase` is already lower-cased by `configValue` (it is), so `MERGES` matches.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/null-tools && npm run compile && node --test out/graph/gitActions.test.js`
Expected: PASS for all three updated tests and the existing decision-table test.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/graph/gitActions.ts extensions/null-tools/src/graph/gitActions.test.ts extensions/null-tools/out/graph/
git commit -m "feat(null-tools): pull.rebase=merges maps to a rebase that keeps merges"
```

---

### Task 3: `divergedFlow` runs `rebase-merges` without the modal, and the spec says so

**Files:**
- Modify: `extensions/null-tools/src/graph/graphCommands.ts:161-177` (the `strategy` label and success text inside `divergedFlow`)
- Modify: `docs/specs/commit-graph-design.md` (the Pull row, line 95): the sentence "When the config does not decide (unset, `merges`, `interactive`)" becomes "(unset, `interactive`)", and add "`pull.rebase=merges` runs `git rebase --rebase-merges @{u}` without the modal."
- Test: `extensions/null-tools/src/graph/graphMessages.test.ts` is not the right place. Pin the labels with a pure helper: add `integrateLabel(strategy)` and `integrateDoneText(strategy)` exported from `gitActions.ts`, and test them in `gitActions.test.ts`.

**Interfaces:**
- Consumes: `IntegrateStrategy` (Task 1), `PullPreference` (Task 2), `pullPreference` returning `'rebase-merges'`.
- Produces: `export function integrateLabel(strategy: IntegrateStrategy): string` returning `'Rebase'`, `'Merge'` or `'Rebase (keep merges)'`; `export function integrateDoneText(strategy: IntegrateStrategy): string` returning `'Rebased onto the upstream.'`, `'Merged the upstream.'` or `'Rebased onto the upstream, keeping merge commits.'`.

- [ ] **Step 1: Write the failing test**

Add to `gitActions.test.ts`:

```ts
test('integrateLabel and integrateDoneText name rebase-merges distinctly from rebase', () => {
  assert.strictEqual(integrateLabel('rebase-merges'), 'Rebase (keep merges)');
  assert.strictEqual(integrateLabel('rebase'), 'Rebase');
  assert.strictEqual(integrateLabel('merge'), 'Merge');
  assert.strictEqual(integrateDoneText('rebase-merges'), 'Rebased onto the upstream, keeping merge commits.');
  assert.strictEqual(integrateDoneText('rebase'), 'Rebased onto the upstream.');
  assert.strictEqual(integrateDoneText('merge'), 'Merged the upstream.');
});
```

Add `integrateLabel, integrateDoneText` to the import line at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-tools && npm run compile && node --test out/graph/gitActions.test.js`
Expected: FAIL to compile, `integrateLabel` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `gitActions.ts`, after `integrateUpstream`:

```ts
/** The word the operation banner and error messages use for a strategy. */
export function integrateLabel(strategy: IntegrateStrategy): string {
  return strategy === 'merge' ? 'Merge' : strategy === 'rebase' ? 'Rebase' : 'Rebase (keep merges)';
}

/** The information message shown after a clean (non-stopped) integrate. */
export function integrateDoneText(strategy: IntegrateStrategy): string {
  return strategy === 'merge' ? 'Merged the upstream.'
    : strategy === 'rebase' ? 'Rebased onto the upstream.'
      : 'Rebased onto the upstream, keeping merge commits.';
}
```

In `graphCommands.ts` `divergedFlow`, replace the two inline ternaries:

```ts
  const label = integrateLabel(strategy);
  const result = await session.runAction((a) => integrateUpstream(a.act, () => a.service.inProgress(), strategy));
  await reportOperation(result, label);
  if (result.ok && !result.value.stopped) {
    void vscode.window.showInformationMessage(integrateDoneText(strategy));
  }
```

Add `integrateLabel, integrateDoneText` to the existing `./gitActions` import in `graphCommands.ts`. The `strategy = preference;` branch already accepts the new union member because `preference` narrowed to `IntegrateStrategy` by the `ask` / `ff-only` checks; if TypeScript reports `'rebase-merges'` is not assignable, narrow the `else` with `strategy = preference as IntegrateStrategy;` only if the compiler requires it, and say so in the commit.

Make the spec edit described in Files above.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/null-tools && npm test`
Expected: PASS. The whole list in `package.json` runs, including `graph/gitActions.test.js`, so the other decision-table tests and the real-repo tests from Tasks 1 and 2 are covered.

Then manually in a repo with `pull.rebase=merges` and a diverged branch: run `Null: Pull` from the Commit Graph tab title, and confirm no modal appears, the banner reads "Rebase (keep merges)" on conflict, and the success message is the keep-merges text. Report what was seen; if it cannot be run here, say so.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/graph/gitActions.ts extensions/null-tools/src/graph/gitActions.test.ts extensions/null-tools/src/graph/graphCommands.ts extensions/null-tools/out/ docs/specs/commit-graph-design.md
git commit -m "feat(null-tools): Null: Pull keeps merge commits when pull.rebase=merges"
```

---

## Notes for the Reviewer of This Plan

- Chosen: honour `merges` by running `--rebase-merges` silently, the same way `true` already runs a plain rebase silently. The alternative is to keep asking for `merges`, which the current code does; that keeps the user in a prompt for a choice git already made. If you want the prompt kept, drop Task 2 and Task 3 and the spec edit stays as it is.
- Not in scope: `interactive` (needs an editor; still asks), `preserve` (deprecated spelling, still asks), `--autostash` / `rebase.autoStash`, a way to un-remember from the UI, a timed auto-fetch, and a webview button. Each was already listed as out of scope in the predecessor plans.
- "Always Rebase" on the modal still writes `pull.rebase=true`. That overwrites a `merges` value only if the modal was reached, which it no longer is for `merges`, so no new conflict arises.

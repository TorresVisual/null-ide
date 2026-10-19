# Git Pull: Remember My Choice Implementation Plan

> **For agentic workers:** See Execution Options below. The checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** When `Null: Pull` asks Rebase or Merge on a diverged branch, let the user answer "always" once, so the prompt stops coming back for that repo.

**Architecture:** One new function `rememberPullStrategy(git, strategy)` in `gitActions.ts` writes the answer into the repo's own git config (`pull.rebase`, or `branch.<name>.rebase` when the branch already has a value Null cannot read, because that key wins). `pullPreference` from the predecessor plan then reads it back, so Null and the terminal agree and no new storage exists. The modal in `graphCommands.ts` gains two buttons, Always Rebase and Always Merge; the choice is written before the operation runs, because a stopped rebase blocks further actions until it is resolved.

**Tech Stack:** TypeScript (null-tools `src/graph/`), `node:test` against a real temporary clone (the `divergedClone` helper in `gitActions.test.ts`).

**Spec:** [docs/specs/commit-graph-design.md](../specs/commit-graph-design.md) (actions table, Pull row). Predecessor plan: [git-pull-config.md](git-pull-config.md), shipped. It listed "remember my choice" as out of scope because it needs to write config; this plan is that follow-on.

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
- `gitRun.ts` is the only place that spawns git. It sets `GIT_EDITOR=true`, `GIT_TERMINAL_PROMPT=0` and `LC_ALL=C`; do not work around them.
- Write to the repository's own config only (`git config --local`). Never `--global` or `--system`: one click in one repo must not change how every other repo on the machine pulls.
- No new `null-tools.*` setting; git's config stays the single source of truth.
- Tests use `node:test` and `node:assert` with the helpers already in `gitActions.test.ts` (`initRepo`, `commit`, `git`, `tools`, `expectOk`, `divergedClone`). Do not use `describe`/`expect`.

## Review Focus

1. The branch already has `branch.<name>.rebase=merges` (or `interactive`): writing `pull.rebase` would change nothing and the prompt would return forever, so the branch key is the one overwritten.
2. The write must be repo-local: a `git config --global` read afterwards must not see the new value.
3. A config write that fails (read-only `.git/config`, locked file): the chosen rebase or merge still runs, and the failure is shown, not swallowed.
4. Always Rebase or Always Merge chosen, then the operation stops on conflicts: the preference is already saved, and Continue / Skip / Abort still work (the write happens before the operation, not after).
5. Dismissing the modal writes nothing and runs nothing.

Items 1 to 3 get their tests in Task 1. Item 4 holds by ordering in Task 2; items 4 and 5 are manual checks in Task 3.

---

### Task 1: `rememberPullStrategy` in gitActions

**Files:**
- Modify: `extensions/null-tools/src/graph/gitActions.ts` (append after `pullPreference`)
- Test: `extensions/null-tools/src/graph/gitActions.test.ts` (import at line 9, append at the end)

**Interfaces:**
- Consumes: `RunGit`, `Result<T>`, `IntegrateStrategy`, `configValue`, `ok`, `fail`, `messageOf` (all already in `gitActions.ts`).
- Produces: `export function rememberPullStrategy(git: RunGit, strategy: IntegrateStrategy): Promise<Result<null>>`. Never rejects. Task 2 calls it.

- [ ] **Step 1: Write the failing tests**

In `gitActions.test.ts`, add `pullPreference` (if absent) and `rememberPullStrategy` to the import on line 9. Append to the end of the file:

```ts
test('rememberPullStrategy writes pull.rebase into the repo and pullPreference reads it back', async () => {
  const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
  const { run } = tools(clone);
  expectOk(await rememberPullStrategy(run, 'rebase'));
  assert.strictEqual(git(clone, 'config', '--local', '--get', 'pull.rebase'), 'true');
  assert.strictEqual(await pullPreference(run), 'rebase');
  expectOk(await rememberPullStrategy(run, 'merge'));
  assert.strictEqual(git(clone, 'config', '--local', '--get', 'pull.rebase'), 'false');
  assert.strictEqual(await pullPreference(run), 'merge');
});

test('rememberPullStrategy overwrites a branch setting Null cannot read, since that key wins', async () => {
  const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
  const { run } = tools(clone);
  const branch = git(clone, 'symbolic-ref', '--short', 'HEAD');
  git(clone, 'config', `branch.${branch}.rebase`, 'merges');
  assert.strictEqual(await pullPreference(run), 'ask');
  expectOk(await rememberPullStrategy(run, 'merge'));
  assert.strictEqual(git(clone, 'config', '--local', '--get', `branch.${branch}.rebase`), 'false');
  assert.strictEqual(await pullPreference(run), 'merge');
});

test('rememberPullStrategy never writes outside the repository config', async () => {
  const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
  expectOk(await rememberPullStrategy(tools(clone).run, 'rebase'));
  assert.throws(() => git(clone, 'config', '--system', '--get', 'pull.rebase'));
  assert.throws(() => git(clone, 'config', '--global', '--get', 'pull.rebase'));
});

test('rememberPullStrategy returns git failures as a result and does not throw', async () => {
  const broken = async (): Promise<string> => { throw new Error('error: could not lock config file'); };
  assert.deepStrictEqual(await rememberPullStrategy(broken, 'rebase'), { ok: false, message: 'error: could not lock config file' });
});
```

The `--global` assertion can pass on a machine where the developer already set `pull.rebase` globally; if `git(clone, 'config', '--global', '--get', 'pull.rebase')` does not throw before the call, replace that one assertion with a comparison of the global value before and after.

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `extensions/null-tools`): `npm test`
Expected: FAIL to compile, `rememberPullStrategy` is not exported from `./gitActions`.

- [ ] **Step 3: Write the minimal implementation**

Append to `gitActions.ts` after `pullPreference`:

```ts
/**
 * Saves a Rebase / Merge answer so `pullPreference` stops asking. Repo-local only.
 * A `branch.<name>.rebase` value beats `pull.rebase`, so when one exists (it is one Null cannot act on, or we would not be asking) it is the key to overwrite.
 */
export async function rememberPullStrategy(git: RunGit, strategy: IntegrateStrategy): Promise<Result<null>> {
  try {
    const branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
    const scoped = await configValue(git, `branch.${branch}.rebase`);
    if (scoped === null) return fail('Could not read the git config.');
    await git(['config', '--local', scoped ? `branch.${branch}.rebase` : 'pull.rebase', strategy === 'rebase' ? 'true' : 'false']);
    return ok(null);
  } catch (err) {
    return fail(messageOf(err));
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` in `extensions/null-tools`
Expected: PASS, including the four new `rememberPullStrategy` tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/graph/gitActions.ts extensions/null-tools/src/graph/gitActions.test.ts
git commit -m "feat(null-tools): save a pull strategy answer into the repo's git config"
```

---

### Task 2: Always buttons in the modal

**Files:**
- Modify: `extensions/null-tools/src/graph/graphCommands.ts` (import at line 6, `askStrategy` and `divergedFlow` at lines 130-163)

**Interfaces:**
- Consumes: `rememberPullStrategy` from Task 1; `IntegrateStrategy`, `pullPreference`, `integrateUpstream`, `reportOperation`, `commits`, `report`, `session.availability()` (when `ok`, it has `act`, `read`, `service`), all already in this file.
- Produces: nothing for later tasks. The command id stays `null.graph.pull`.

- [ ] **Step 1: Update the import**

Add `rememberPullStrategy` to the import from `./gitActions` on line 6.

- [ ] **Step 2: Replace `askStrategy`**

```ts
/** The modal for a user whose git config does not say. `remember` saves the answer; a dismissed prompt returns null and changes nothing. */
async function askStrategy(ahead: number, behind: number): Promise<{ strategy: IntegrateStrategy; remember: boolean } | null> {
  const choice = await vscode.window.showWarningMessage(
    `This branch has diverged from its upstream: ${commits(ahead, 'local')}, ${commits(behind, 'incoming')}.`,
    {
      modal: true,
      detail: 'Rebase puts your local commits on top of the incoming ones and keeps history linear; your local commits get new hashes. '
        + 'Merge keeps every commit as it is and adds a merge commit. Either can stop on conflicts: the Commit Graph then offers Continue, Skip and Abort. '
        + 'Always Rebase and Always Merge save the answer as pull.rebase in this repository\'s git config, so you are not asked again.',
    },
    'Rebase', 'Merge', 'Always Rebase', 'Always Merge',
  );
  switch (choice) {
    case 'Rebase': return { strategy: 'rebase', remember: false };
    case 'Merge': return { strategy: 'merge', remember: false };
    case 'Always Rebase': return { strategy: 'rebase', remember: true };
    case 'Always Merge': return { strategy: 'merge', remember: true };
    default: return null;
  }
}
```

- [ ] **Step 3: Use it in `divergedFlow`**

Replace the two lines `const strategy = preference === 'ask' ? await askStrategy(ahead, behind) : preference;` and `if (!strategy) return;` with:

```ts
  let strategy: IntegrateStrategy;
  if (preference === 'ask') {
    const answer = await askStrategy(ahead, behind);
    if (!answer) return;
    strategy = answer.strategy;
    // Saved before the operation: a stopped rebase blocks further actions until it is resolved, and the answer is already given.
    if (answer.remember) report(await rememberPullStrategy(availability.act, strategy));
  } else {
    strategy = preference;
  }
```

A failed write is shown by `report`, and the rebase or merge still runs.

- [ ] **Step 4: Compile and run the tests**

Run: `npx tsc -p . --noEmit` then `npm test` in `extensions/null-tools`
Expected: no type errors, all tests PASS. No new unit test: the function is `vscode` calls, and the decisions it relies on are pinned by Task 1.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/graph/graphCommands.ts
git commit -m "feat(null-tools): Null: Pull can remember Rebase or Merge for the repo"
```

---

### Task 3: Spec row, compiled output and local verification

**Files:**
- Modify: `docs/specs/commit-graph-design.md` (Pull row, line 95)
- Modify: `extensions/null-tools/out/**` (generated by `npm run compile`; never hand-edit)

- [ ] **Step 1: Amend the Pull row in the spec**

In the Pull row, replace `dismissing it runs nothing.` (the end of the modal sentence) with:

```markdown
dismissing it runs nothing. Always Rebase and Always Merge on that modal write `pull.rebase` (or an unreadable `branch.<name>.rebase`) into the repository's own git config, never the global one, before the operation runs.
```

- [ ] **Step 2: Commit the spec row**

```bash
git add docs/specs/commit-graph-design.md
git commit -m "docs: describe the Always buttons on Null: Pull in the commit graph spec"
```

- [ ] **Step 3: Refresh compiled output**

Run: `npm run compile` in `extensions/null-tools`, then `git status extensions/null-tools/out`.
Expected: only `out/graph/gitActions.js`, `out/graph/gitActions.test.js`, `out/graph/graphCommands.js` and their `.map` files changed.

- [ ] **Step 4: Commit compiled output separately**

```bash
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output"
```

- [ ] **Step 5: Verify in the real build**

Run `/verify-local null-tools`. Then, in a scratch clone with one local and one remote commit (ahead 1 / behind 1) and no pull config, run `Null: Pull` from the Commit Graph view title:

1. Dismiss the modal (Esc). Expected: nothing changes, `git config --local --get pull.rebase` prints nothing.
2. Choose Always Rebase. Expected: "Rebased onto the upstream.", `git config --local --get pull.rebase` prints `true`. Make the clone diverge again and run Pull: no modal.
3. Reset, `git config --unset pull.rebase`, then repeat with Always Merge. Expected: a merge commit, `pull.rebase` is `false`, the next diverged pull merges without asking.
4. `git config branch.<name>.rebase merges`, choose Always Rebase. Expected: `branch.<name>.rebase` becomes `true`, `pull.rebase` is untouched.
5. Make both sides edit the same line, unset the config, choose Always Rebase. Expected: "Rebase stopped" with Continue / Skip / Abort, and `pull.rebase` is already `true`. Abort restores the pre-pull HEAD.
6. `chmod`-style read-only `.git/config` (on Windows: `attrib +r .git\config`), choose Always Merge. Expected: an error naming the config failure, and the merge still runs. Restore with `attrib -r`.

Expected: all six as stated.

- [ ] **Step 6: Report**

Report which of Steps 1 to 5 ran, with output. Do not push.

---

## Notes for the Reviewer of This Plan

- Checked and dropped: honouring `rebase.autoStash` / `merge.autoStash`. Null runs plain `git rebase @{u}` and `git merge @{u}`, and git applies those keys to them by itself, so the diverged path already follows them. The fast-forward path never needs a stash unless files overlap, and then git's refusal is the right answer. Nothing to plan.
- Not in scope: `--rebase-merges` for `pull.rebase=merges`, a webview button, a timed auto-fetch, a way to un-remember from the UI (the terminal's `git config --unset pull.rebase` does it, and the modal text names the key).
- One click writes repo config silently apart from the modal text that says so. If you would rather confirm the write separately, the alternative is a follow-up notification after the pull with an "Always do this" action; it costs a second prompt for the same decision.

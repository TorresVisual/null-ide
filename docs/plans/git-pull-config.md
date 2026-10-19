# Git Pull: Honour pull.rebase and pull.ff Implementation Plan

> **For agentic workers:** See Execution Options below. The checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** When `Null: Pull` finds a diverged branch and the user has already told git what to do (`pull.rebase`, `branch.<name>.rebase`, `pull.ff`), do that instead of asking Rebase or Merge every time.

**Architecture:** One new function `pullPreference(git)` in `gitActions.ts` reads the three config keys and returns `'rebase' | 'merge' | 'ff-only' | 'ask'`. It never throws: any git failure means `'ask'`, today's behaviour. `divergedFlow` in `graphCommands.ts` calls it first. `rebase` and `merge` skip the modal and call the existing `integrateUpstream`; `ff-only` runs nothing and says why; `ask` shows the existing modal. `pull()` and `integrateUpstream` do not change. No new setting: git's config is the setting.

**Tech Stack:** TypeScript (null-tools `src/graph/`), `node:test` with the existing `fakeGit` helper for the decision table and one real temporary repo for config precedence.

**Spec:** [docs/specs/commit-graph-design.md](../specs/commit-graph-design.md) (actions table, Pull row). Predecessor plans: [git-pull.md](git-pull.md) and [git-pull-diverged.md](git-pull-diverged.md), both shipped. The latter lists "honouring git's own `pull.rebase` / `pull.ff` config" as out of scope and names the prompt as "the one place a default could later be injected". This is that plan.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [x] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- `out/` is tracked. After editing `src/`, run `npm run compile` in `extensions/null-tools` and commit the refreshed `out/` in its own commit (`chore: refresh null-tools compiled output`). Never hand-edit `out/`.
- A new test file must be added to the explicit list in `extensions/null-tools/package.json` `test` script, or it is silently skipped. This plan adds no new file; `out/graph/gitActions.test.js` is already listed.
- Only `graphSession`, `commitGraphPanel`, `graphTreeView`, `graphCommands`, `graphDiff`, `gitApi` and `graphIntegration` may import `vscode`. `gitActions.ts` stays vscode-free.
- `gitRun.ts` is the only place that spawns git. It sets `GIT_EDITOR=true`, `GIT_TERMINAL_PROMPT=0` and `LC_ALL=C`; do not work around them.
- No force flags, no push, no `--autostash` (spec, "Rules for all actions"; predecessor plan). Config can pick Rebase or Merge, never anything destructive.
- No new `null-tools.*` setting. The source of truth is git's own config, so Null IDE and the terminal agree.
- Tests use `node:test` and `node:assert` with the helpers already in `gitActions.test.ts` (`initRepo`, `commit`, `git`, `tools`, `expectOk`, `fakeGit`, `divergedClone`). Do not use `describe`/`expect`.

## Review Focus

1. `pull.rebase=merges` or `interactive`: Null cannot run those, so it must ask instead of silently doing a plain rebase.
2. `branch.<name>.rebase` disagrees with `pull.rebase`: the branch value wins, as in git.
3. `pull.ff=only` with no rebase setting: nothing runs and the message says why; it must not fall through to the modal or to a merge.
4. Detached HEAD, a missing key, or git failing on `config`: result is `ask`, never an exception out of the command.
5. Boolean spellings: `true`/`yes`/`on`/`1` (any case) mean true; `false`/`no`/`off`/`0` mean false.

Items 1 to 5 get their tests in Task 1. The no-modal flow itself is `vscode` code and is a manual check in Task 3.

---

### Task 1: `pullPreference` in gitActions

**Files:**
- Modify: `extensions/null-tools/src/graph/gitActions.ts` (append after `integrateUpstream`, line 155)
- Test: `extensions/null-tools/src/graph/gitActions.test.ts` (import at line 9, append after line 388)

**Interfaces:**
- Consumes: `RunGit` (already imported in `gitActions.ts`).
- Produces: `export type PullPreference = 'rebase' | 'merge' | 'ff-only' | 'ask'` and `export function pullPreference(git: RunGit): Promise<PullPreference>`. Never rejects. Task 2 calls it.

- [ ] **Step 1: Write the failing tests**

In `gitActions.test.ts`, change the import on line 9 to add `pullPreference`:

```ts
import { cherryPick, checkout, createBranch, integrateUpstream, pull, pullPreference, reset, resetImpact, resumeOperation, revert } from './gitActions';
```

Append to the end of the file:

```ts
// fakeGit answers only the keys given; an absent key throws, which is how `git config --get` reports "unset" (exit 1).
function configGit(config: Record<string, string>, branch: string | null = 'main') {
  const answers: Record<string, string> = {};
  if (branch) answers['symbolic-ref --quiet --short HEAD'] = `${branch}\n`;
  for (const [key, value] of Object.entries(config)) answers[`config --get ${key}`] = `${value}\n`;
  return fakeGit(answers);
}

test('pullPreference maps git config to a strategy', async () => {
  const cases: [Record<string, string>, string][] = [
    [{}, 'ask'],
    [{ 'pull.rebase': 'true' }, 'rebase'],
    [{ 'pull.rebase': 'false' }, 'merge'],
    [{ 'pull.ff': 'only' }, 'ff-only'],
    [{ 'pull.ff': 'false' }, 'merge'],
    [{ 'pull.ff': 'true' }, 'ask'],
    [{ 'pull.ff': 'only', 'pull.rebase': 'true' }, 'rebase'],
    [{ 'pull.ff': 'only', 'pull.rebase': 'false' }, 'ff-only'],
  ];
  for (const [config, expected] of cases) {
    assert.strictEqual(await pullPreference(configGit(config)), expected, JSON.stringify(config));
  }
});

test('pullPreference asks for the rebase modes Null cannot run', async () => {
  for (const value of ['merges', 'interactive', 'preserve', 'nonsense']) {
    assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': value })), 'ask', value);
  }
});

test('pullPreference accepts every boolean spelling git does, in any case', async () => {
  for (const value of ['true', 'TRUE', 'yes', 'on', '1']) {
    assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': value })), 'rebase', value);
  }
  for (const value of ['false', 'No', 'off', '0']) {
    assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': value })), 'merge', value);
  }
});

test('pullPreference: the branch setting beats pull.rebase', async () => {
  assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': 'false', 'branch.main.rebase': 'true' })), 'rebase');
  assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': 'true', 'branch.main.rebase': 'false' })), 'merge');
});

test('pullPreference on a detached HEAD uses pull.* only, and never throws when git fails', async () => {
  assert.strictEqual(await pullPreference(configGit({ 'pull.rebase': 'true' }, null)), 'rebase');
  const broken = async (): Promise<string> => { throw new Error('fatal: not a git repository'); };
  assert.strictEqual(await pullPreference(broken), 'ask');
});

test('pullPreference reads the real repo config, branch setting first', async () => {
  const clone = divergedClone(['l.txt', 'local'], ['o.txt', 'remote']);
  const { run } = tools(clone);
  assert.strictEqual(await pullPreference(run), 'ask');
  git(clone, 'config', 'pull.rebase', 'true');
  assert.strictEqual(await pullPreference(run), 'rebase');
  git(clone, 'config', 'branch.main.rebase', 'false');
  assert.strictEqual(await pullPreference(run), 'merge');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `extensions/null-tools`): `npm test`
Expected: FAIL to compile, `pullPreference` is not exported from `./gitActions`.

- [ ] **Step 3: Write the minimal implementation**

Append to `gitActions.ts` after `integrateUpstream`:

```ts
export type PullPreference = 'rebase' | 'merge' | 'ff-only' | 'ask';

/** One `git config --get` value, lower-cased; '' when unset or unreadable (git exits 1 for an unset key). */
async function configValue(git: RunGit, key: string): Promise<string> {
  try { return (await git(['config', '--get', key])).trim().toLowerCase(); } catch { return ''; }
}

/**
 * What the user's git config says a pull should do once the branch has diverged.
 * Same precedence as git: branch.<name>.rebase over pull.rebase; a rebase setting over pull.ff.
 * `merges` and `interactive` are not offered by Null, so they ask rather than silently rebase plainly.
 * Anything unset or unreadable asks: that is what git itself does (it refuses and tells the user to choose).
 */
export async function pullPreference(git: RunGit): Promise<PullPreference> {
  let branch = '';
  try { branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim(); } catch { /* detached */ }
  const rebase = (branch && await configValue(git, `branch.${branch}.rebase`)) || await configValue(git, 'pull.rebase');
  if (['true', 'yes', 'on', '1'].includes(rebase)) return 'rebase';
  const ff = await configValue(git, 'pull.ff');
  if (['false', 'no', 'off', '0'].includes(rebase)) return ff === 'only' ? 'ff-only' : 'merge';
  if (rebase) return 'ask';
  if (ff === 'only') return 'ff-only';
  return ['false', 'no', 'off', '0'].includes(ff) ? 'merge' : 'ask';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` in `extensions/null-tools`
Expected: PASS, including the six new `pullPreference` tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/graph/gitActions.ts extensions/null-tools/src/graph/gitActions.test.ts
git commit -m "feat(null-tools): read git's pull.rebase and pull.ff for a diverged pull"
```

---

### Task 2: Use the preference in `divergedFlow`

**Files:**
- Modify: `extensions/null-tools/src/graph/graphCommands.ts` (import at line 7, `divergedFlow` at lines 130-148)

**Interfaces:**
- Consumes: `pullPreference` and `PullPreference` from Task 1; `integrateUpstream`, `IntegrateStrategy`, `reportOperation`, `commits`, `session.availability()` (returns `{ ok, service, read }` as `resetFlow` uses it), `session.runAction`, all already in this file.
- Produces: nothing new for later tasks. The command id stays `null.graph.pull`.

- [ ] **Step 1: Update the import**

On line 7 add `pullPreference` to the import from `./gitActions`:

```ts
import {
  CheckoutTarget, IntegrateStrategy, PullOutcome, StoppedInfo, checkout, cherryPick, createBranch, integrateUpstream, pull, pullPreference, reset, resetImpact, resumeOperation, revert,
} from './gitActions';
```

- [ ] **Step 2: Replace `divergedFlow`**

Replace lines 130-148 with:

```ts
/** The modal for a user whose git config does not say. A dismissed prompt returns null and changes nothing. */
async function askStrategy(ahead: number, behind: number): Promise<IntegrateStrategy | null> {
  const choice = await vscode.window.showWarningMessage(
    `This branch has diverged from its upstream: ${commits(ahead, 'local')}, ${commits(behind, 'incoming')}.`,
    {
      modal: true,
      detail: 'Rebase puts your local commits on top of the incoming ones and keeps history linear; your local commits get new hashes. '
        + 'Merge keeps every commit as it is and adds a merge commit. Either can stop on conflicts: the Commit Graph then offers Continue, Skip and Abort. '
        + 'Set pull.rebase in your git config to stop being asked.',
    },
    'Rebase', 'Merge',
  );
  if (choice === 'Rebase') return 'rebase';
  return choice === 'Merge' ? 'merge' : null;
}

/** Pull never merges or rebases unprompted unless the user's git config (pull.rebase, branch.<name>.rebase, pull.ff) already says to. */
async function divergedFlow(session: GraphSession, ahead: number, behind: number): Promise<void> {
  const availability = await session.availability();
  if (!availability.ok) return;
  const preference = await pullPreference(availability.read);
  if (preference === 'ff-only') {
    void vscode.window.showWarningMessage(
      `This branch has diverged from its upstream (${commits(ahead, 'local')}, ${commits(behind, 'incoming')}) and pull.ff is "only", so nothing was pulled. Rebase or merge it yourself, or change pull.ff.`,
    );
    return;
  }
  const strategy = preference === 'ask' ? await askStrategy(ahead, behind) : preference;
  if (!strategy) return;
  const label = strategy === 'rebase' ? 'Rebase' : 'Merge';
  const result = await session.runAction((a) => integrateUpstream(a.act, () => a.service.inProgress(), strategy));
  await reportOperation(result, label);
  if (result.ok && !result.value.stopped) {
    void vscode.window.showInformationMessage(strategy === 'rebase' ? 'Rebased onto the upstream.' : 'Merged the upstream.');
  }
}
```

- [ ] **Step 3: Compile and run the tests**

Run: `npx tsc -p . --noEmit` then `npm test` in `extensions/null-tools`
Expected: no type errors (after the `ff-only` return, `preference` narrows to `'rebase' | 'merge' | 'ask'`, so `strategy` is `IntegrateStrategy | null`), all tests PASS. No new unit test: everything in the function is `vscode` calls, and the decisions it relies on are pinned by Task 1.

- [ ] **Step 4: Commit**

```bash
git add extensions/null-tools/src/graph/graphCommands.ts
git commit -m "feat(null-tools): Null: Pull follows pull.rebase and pull.ff on a diverged branch"
```

---

### Task 3: Spec row, compiled output and local verification

**Files:**
- Modify: `docs/specs/commit-graph-design.md` (Pull row at line 95)
- Modify: `extensions/null-tools/out/**` (generated by `npm run compile`; never hand-edit)

- [ ] **Step 1: Amend the Pull row in the spec**

In the Pull row (line 95), replace the sentence `A diverged branch gets a modal naming the local and incoming commit counts with Rebase / Merge; dismissing it runs nothing.` with:

```markdown
A diverged branch follows git's config: `branch.<name>.rebase` over `pull.rebase` (`true` rebases, `false` merges), and `pull.ff=only` runs nothing and says so. When the config does not decide (unset, `merges`, `interactive`), a modal names the local and incoming commit counts with Rebase / Merge; dismissing it runs nothing.
```

- [ ] **Step 2: Commit the spec row**

```bash
git add docs/specs/commit-graph-design.md
git commit -m "docs: describe config-driven Null: Pull in the commit graph spec"
```

- [ ] **Step 3: Refresh compiled output**

Run: `npm run compile` in `extensions/null-tools`, then `git status extensions/null-tools/out`.
Expected: only `out/graph/gitActions.js`, `out/graph/gitActions.test.js` and `out/graph/graphCommands.js` (plus tracked `.map` / `.d.ts` siblings) changed.

- [ ] **Step 4: Commit compiled output separately**

```bash
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output"
```

- [ ] **Step 5: Verify in the real build**

Run `/verify-local null-tools`. Then, in a scratch clone of a throwaway repo with one local and one remote commit (ahead 1 / behind 1), run `Null: Pull` from the Commit Graph view title once per row, resetting the clone between rows:

1. No config. Expected: the Rebase / Merge modal, now ending with "Set pull.rebase in your git config to stop being asked."
2. `git config pull.rebase true`. Expected: no modal, "Rebased onto the upstream.", straight-line history.
3. `git config pull.rebase false`. Expected: no modal, "Merged the upstream.", one merge commit.
4. `git config pull.rebase true` plus `git config branch.<name>.rebase false`. Expected: merge (branch setting wins).
5. `git config pull.ff only`. Expected: warning naming `pull.ff`, nothing changes (`git reflog` shows no new entry).
6. `git config pull.rebase merges`. Expected: the modal (Null does not run `--rebase-merges`).
7. `pull.rebase true` with both sides editing the same line. Expected: "Rebase stopped" warning with Continue / Skip / Abort; Abort restores the pre-pull HEAD.

Expected: all seven as stated.

- [ ] **Step 6: Report**

Report which of Steps 1 to 5 ran, with output. Do not push.

---

## Notes for the Reviewer of This Plan

- Not in scope: a "remember my choice" button on the modal (it would have to write git config; this plan only reads it), `--autostash` and `rebase.autoStash` (a failed stash re-apply would stack a second conflict on the first), `--rebase-merges` for `pull.rebase=merges`, a webview button, auto-fetch on a timer. Each is a separate small plan if wanted.
- Silently rebasing is not new risk: it is exactly what `git pull` does in the terminal for the same config, and the user set that config. The rebase still never forces, pushes or discards commits.
- `pullPreference` runs at most four cheap `git config` reads and only after a fetch found a diverged branch, so the common fast-forward path is unchanged.

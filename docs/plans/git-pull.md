# Git Pull Implementation Plan

> **For agentic workers:** See Execution Options below. The checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Let the user fast-forward the current branch from its upstream with one command in the commit graph, and never create a merge commit or leave a conflict behind.

**Architecture:** One new pure-ish action `pull(git)` in `gitActions.ts`, next to `checkout`/`reset`, that runs `git pull --ff-only` after resolving the upstream. It reuses the graph's `RunGit`, its `BusyFlag` (one action per repo) and its `Result<T>` shape. The command is registered in `graphCommands.ts` and shown in the commit graph's view title. No webview protocol change, no new storage.

**Tech Stack:** TypeScript (null-tools `src/graph/`), `execFile` git via `gitRun.ts`, node `--test`-style tests through the existing `npm test` list.

**Spec:** None. No design doc exists for pull; this plan is self-contained. Scope was chosen from the existing graph code: a pull is a graph action in the same family as checkout and reset.

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
- A new test file must be added to the explicit list in `extensions/null-tools/package.json` `test` script, or it is silently skipped. This plan adds no new file.
- Only `graphSession`, `commitGraphPanel`, `graphTreeView`, `graphCommands`, `graphDiff`, `gitApi` and `graphIntegration` may import `vscode`. `gitActions.ts` stays vscode-free.
- `gitRun.ts` is the only place that spawns git. Network actions get a longer timeout by passing it to `makeRunGit`, never by calling `execFile` directly.
- Pull never merges and never rebases. `--ff-only` only.

## Review Focus

1. Branch has no upstream (new local branch, or detached HEAD): the command must say so and change nothing.
2. Local branch has diverged from its upstream: pull must refuse, say so, and leave the working tree and branch untouched.
3. Working tree has uncommitted changes that the pull would overwrite: git refuses; the message must reach the user unchanged.
4. Already up to date: a success result, not an error, and no notification noise beyond one line.
5. Offline or no credentials (`GIT_TERMINAL_PROMPT=0` makes git fail fast): a failure message, the graph stays usable, and `BusyFlag` is released.

Each line gets its test in Task 1.

---

### Task 1: `pull` action in gitActions

**Files:**
- Modify: `extensions/null-tools/src/graph/gitActions.ts` (append after `resetImpact`)
- Test: `extensions/null-tools/src/graph/gitActions.test.ts`

**Interfaces:**
- Consumes: `RunGit` (`gitRun.ts`), `Result<T>` (`../worktrees`), the local `run`/`ok`/`fail`/`messageOf` helpers in `gitActions.ts`.
- Produces: `export type PullOutcome = { kind: 'upToDate' } | { kind: 'fastForwarded'; commits: number } | { kind: 'noUpstream' } | { kind: 'diverged' }` and `export function pull(git: RunGit): Promise<Result<PullOutcome>>`. Task 2 calls `pull` and formats the outcome.

- [ ] **Step 1: Write the failing tests**

Append to `gitActions.test.ts`, using the file's existing fake-`RunGit` style (check the top of the file and copy its helper if it has one; do not add a new helper module):

```ts
import { pull } from './gitActions';

// Fake git: `answers` maps the joined args to stdout; a missing key throws like a failing git.
function fakeGit(answers: Record<string, string>, calls: string[][] = []) {
  return async (args: string[]) => {
    calls.push(args);
    const key = args.join(' ');
    if (key in answers) return answers[key];
    throw new Error(`fatal: unexpected ${key}`);
  };
}

describe('pull', () => {
  it('reports noUpstream when the branch tracks nothing, and runs no pull', async () => {
    const calls: string[][] = [];
    const git = fakeGit({}, calls);
    const r = await pull(git);
    expect(r).toEqual({ ok: true, value: { kind: 'noUpstream' } });
    expect(calls.some((a) => a[0] === 'pull')).toBe(false);
  });

  it('reports upToDate when HEAD already contains the upstream', async () => {
    const git = fakeGit({
      'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main\n',
      'rev-list --count HEAD..@{u}': '0\n',
      'pull --ff-only': 'Already up to date.\n',
    });
    expect(await pull(git)).toEqual({ ok: true, value: { kind: 'upToDate' } });
  });

  it('reports diverged and does not pull when local and upstream both have commits', async () => {
    const calls: string[][] = [];
    const git = fakeGit({
      'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main\n',
      'rev-list --count HEAD..@{u}': '2\n',
      'rev-list --count @{u}..HEAD': '1\n',
    }, calls);
    expect(await pull(git)).toEqual({ ok: true, value: { kind: 'diverged' } });
    expect(calls.some((a) => a[0] === 'pull')).toBe(false);
  });

  it('fast-forwards and counts the commits that came in', async () => {
    const git = fakeGit({
      'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main\n',
      'rev-list --count HEAD..@{u}': '3\n',
      'rev-list --count @{u}..HEAD': '0\n',
      'pull --ff-only': 'Fast-forward\n',
    });
    expect(await pull(git)).toEqual({ ok: true, value: { kind: 'fastForwarded', commits: 3 } });
  });

  it('returns git refusal text as a failure, e.g. a dirty tree', async () => {
    const git = async (args: string[]) => {
      const key = args.join(' ');
      if (key.startsWith('rev-parse')) return 'origin/main\n';
      if (key === 'rev-list --count HEAD..@{u}') return '1\n';
      if (key === 'rev-list --count @{u}..HEAD') return '0\n';
      throw new Error('error: Your local changes to the following files would be overwritten by merge');
    };
    const r = await pull(git);
    expect(r).toEqual({ ok: false, message: 'error: Your local changes to the following files would be overwritten by merge' });
  });
});
```

Note the `diverged` check runs before any `pull`, so a diverged branch never touches the tree.

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `extensions/null-tools`): `npx tsc -p . --noEmit` then `npm test`
Expected: FAIL, `pull` is not exported from `./gitActions`.

- [ ] **Step 3: Write the minimal implementation**

Append to `gitActions.ts`:

```ts
export type PullOutcome =
  | { kind: 'upToDate' }
  | { kind: 'fastForwarded'; commits: number }
  | { kind: 'noUpstream' }
  | { kind: 'diverged' };

/** Fast-forward only: a diverged branch is reported and left alone, so no merge commit and no conflict can appear. */
export async function pull(git: RunGit): Promise<Result<PullOutcome>> {
  try {
    let upstream: string;
    try {
      upstream = (await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim();
    } catch {
      return ok({ kind: 'noUpstream' });
    }
    if (!upstream) return ok({ kind: 'noUpstream' });
    const behind = await count(git, ['rev-list', '--count', 'HEAD..@{u}']);
    if (behind === 0) return ok({ kind: 'upToDate' });
    const ahead = await count(git, ['rev-list', '--count', '@{u}..HEAD']);
    if (ahead > 0) return ok({ kind: 'diverged' });
    await git(['pull', '--ff-only']);
    return ok({ kind: 'fastForwarded', commits: behind });
  } catch (err) {
    return fail(messageOf(err));
  }
}
```

The `upToDate` test expects `rev-list --count HEAD..@{u}` to return `0`, which this returns before the `ahead` count. Good.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` in `extensions/null-tools`
Expected: PASS, including the five new `pull` cases.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/graph/gitActions.ts extensions/null-tools/src/graph/gitActions.test.ts
git commit -m "feat(null-tools): fast-forward-only pull action for the commit graph"
```

---

### Task 2: Command, view-title button and status line

**Files:**
- Modify: `extensions/null-tools/src/graph/graphCommands.ts` (register `null.graph.pull`, near `null.graph.checkout` at line 127)
- Modify: `extensions/null-tools/package.json` (command, `view/title` menu entry for `null.graphView`)
- Test: `extensions/null-tools/src/graph/graphCommands.test.ts` only if it already exists and tests registration; otherwise rely on Task 3's integration check.

**Interfaces:**
- Consumes: `pull(git)` and `PullOutcome` from Task 1; `session.runAction((a) => ..., opts)` and `reportOperation(result, label)` already used in `graphCommands.ts` (the `a.act` runner has the 120 s action timeout set in `graphSession.ts`; `BusyFlag` is handled inside `runAction`).
- Produces: command id `null.graph.pull` ("Null: Pull", codicon `$(repo-pull)`).

- [ ] **Step 1: Read the pattern to copy**

Open `graphCommands.ts`, find `checkoutFlow` and the `register('null.graph.checkout', ...)` line. Copy its shape: it obtains the session, runs the action inside `BusyFlag`, refreshes the graph afterwards, and shows a message on failure. Do not invent a new flow.

- [ ] **Step 2: Register the command**

Add beside the checkout registration:

```ts
register('null.graph.pull', () => pullFlow(session));
```

and in the same file:

```ts
async function pullFlow(session: GraphSession): Promise<void> {
  const result = await session.runAction((a) => pull(a.act));
  await reportOperation(result, 'Pull');
}
```

If `reportOperation` only handles `StoppedInfo`-shaped results, do not force it: write a small `pullMessage(outcome)` in `graphCommands.ts` that maps the four `PullOutcome` kinds to these texts, and show failures with `vscode.window.showErrorMessage`:

- `upToDate`: "Already up to date."
- `fastForwarded`: "Pulled N commit(s)."
- `noUpstream`: "This branch has no upstream to pull from."
- `diverged`: "This branch has diverged from its upstream. Pull was not run; merge or rebase by hand."

- [ ] **Step 3: Add the package.json entries**

In `contributes.commands`:

```json
{ "command": "null.graph.pull", "title": "Null: Pull", "icon": "$(repo-pull)" }
```

In `contributes.menus`, the `view/title` block (around line 360). Add this entry there, using the same `when` style as the other `null.graphView` entries in that block if any exist; the `!null.graph.operationInProgress` guard is required:

```json
{ "command": "null.graph.pull", "when": "view == null.graphView && !null.graph.operationInProgress", "group": "navigation@1" }
```

- [ ] **Step 4: Compile and check the wiring**

Run: `npm run compile` in `extensions/null-tools`, then `npm test`.
Expected: compile clean, all tests PASS. Also `node -e "const p=require('./package.json');console.log(p.contributes.commands.some(c=>c.command==='null.graph.pull'))"` prints `true`.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/graph/graphCommands.ts extensions/null-tools/package.json
git commit -m "feat(null-tools): Null: Pull command in the commit graph view"
```

---

### Task 3: Local verification and compiled output

**Files:**
- Modify: `extensions/null-tools/out/**` (generated by `npm run compile`; never hand-edit)

- [ ] **Step 1: Refresh compiled output**

Run: `npm run compile` in `extensions/null-tools`, then `git status extensions/null-tools/out`.
Expected: `out/graph/gitActions.js`, `out/graph/graphCommands.js`, and `out/package` are the only changes.

- [ ] **Step 2: Commit compiled output separately**

```bash
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output"
```

- [ ] **Step 3: Verify in the real build**

Run `/verify-local null-tools` (syncs into the installed Null IDE and runs the integration specs). Then, in a scratch repo with a remote and a branch one commit behind, run `Null: Pull` and confirm the message reads "Pulled 1 commit." Repeat with a diverged branch and confirm the message and that `git status` is unchanged.

Expected: both messages as stated; no merge commit in `git log`.

- [ ] **Step 4: Report**

Report which of Steps 1 to 3 ran, with output. Do not push.

---

## Notes for the Reviewer of This Plan

- Scope is deliberately small: no merge or rebase option, no pull on file-open or on a timer, no webview button. Each is a separate later plan if wanted.
- Credentials rely on what null-accounts already wires for the folder. If a pull to a private remote fails with an auth message, that is an account-binding question, not part of this plan.

# Git Pull: Button in the Commit Graph Tab Implementation Plan

> **For agentic workers:** See Execution Options below. The checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Put `Null: Pull` in the title bar of the Commit Graph tab, so a user looking at the graph can pull without opening the sidebar view.

**Architecture:** One manifest entry in `contributes.menus["editor/title"]` for the existing command `null.graph.pull`, shown only while the Commit Graph tab is the active editor. No webview code, no new message type, no new command: the tab is a `WebviewPanel` with viewType `null.commitGraph`, and VS Code puts `editor/title` items on a webview panel's tab bar when their `when` matches `activeWebviewPanelId`. The button reuses the whole pull flow (config-driven strategy, the Rebase / Merge modal, the banner), so it behaves exactly like the view-title button.

**Tech Stack:** VS Code extension manifest (`extensions/null-tools/package.json`), one `node:test` file that reads that manifest.

**Spec:** [docs/specs/commit-graph-design.md](../specs/commit-graph-design.md) (actions table, Pull row). Predecessor plans, all shipped: [git-pull.md](git-pull.md), [git-pull-diverged.md](git-pull-diverged.md), [git-pull-config.md](git-pull-config.md), [git-pull-remember.md](git-pull-remember.md). Each listed "a webview button" as out of scope; this plan is that follow-on. It deliberately does not draw a button inside the webview (see Notes).

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
- A new test file must be added to the explicit list in `extensions/null-tools/package.json` `test` script, or it is silently skipped. This plan adds `out/graph/graphMenus.test.js` to it.
- Only `graphSession`, `commitGraphPanel`, `graphTreeView`, `graphCommands`, `graphDiff`, `gitApi` and `graphIntegration` may import `vscode`. This plan touches none of them.
- No new command id, no new `null-tools.*` setting. The command stays `null.graph.pull`; its `$(repo-pull)` icon is already declared.
- Tests use `node:test` and `node:assert`. Do not use `describe`/`expect`.
- Commits follow the repo's Conventional Commit style; the manifest change is `feat(null-tools): ...`, the spec edit is `docs: ...`.

## Review Focus

1. Another editor is active (a Markdown preview, another webview, a text file): the Pull button must not appear there, because a Pull button on a file tab reads as "pull this file".
2. The graph cannot work (no folder, not a repository, untrusted workspace, remote window): the tab shows an explanation instead of history, so the button is hidden rather than offered and then refused.
3. A rebase, merge, cherry-pick or revert is stopped on conflicts: the button is hidden, as it already is in the sidebar view, and the tab's banner (Continue / Skip / Abort) is the way forward.
4. Two clicks in a row, or the sidebar button and the tab button together: the second one is refused with "Another Commit Graph action is still running." by the existing `BusyFlag`, not run twice. Already true; checked by hand in Task 2.
5. The tab is restored after a window reload with no sidebar view open: the button must appear once the session reports `ready`, not stay hidden because nothing set the context key.

Items 1 to 3 are pinned by the exact `when` string tested in Task 1. Items 4 and 5 are manual checks in Task 2.

---

### Task 1: The tab-title entry and a test that pins it

**Files:**
- Modify: `extensions/null-tools/package.json` (`editor/title` array at line 325; `test` script at line 14)
- Create: `extensions/null-tools/src/graph/graphMenus.test.ts`

**Interfaces:**
- Consumes: the existing command `null.graph.pull` and the context keys `null.graph.state` (`'ready'` or an unavailable reason, set in `graphSession.ts:57`) and `null.graph.operationInProgress` (set in `graphSession.ts:113`).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing test**

Create `extensions/null-tools/src/graph/graphMenus.test.ts`:

```ts
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import test from 'node:test';

// out/graph -> out -> null-tools
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
type MenuItem = { command?: string; when?: string; group?: string };
const menus = manifest.contributes.menus as Record<string, MenuItem[]>;

test('Null: Pull is in the Commit Graph tab title, only on that tab, only when the graph is ready, and not mid-operation', () => {
  const items = menus['editor/title'].filter((m) => m.command === 'null.graph.pull');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(
    items[0].when,
    "activeWebviewPanelId == 'null.commitGraph' && null.graph.state == ready && !null.graph.operationInProgress",
  );
});

test('the sidebar view keeps its own Null: Pull button', () => {
  const items = menus['view/title'].filter((m) => m.command === 'null.graph.pull');
  assert.strictEqual(items.length, 1);
  assert.match(items[0].when ?? '', /view == null\.graphView/);
});
```

- [ ] **Step 2: Add the test to the explicit list and run it to see it fail**

In the `test` script on line 14 of `package.json`, insert `out/graph/graphMenus.test.js` right after `out/graph/gitActions.test.js`.

Run: `npm test` in `extensions/null-tools`.
Expected: FAIL in "Null: Pull is in the Commit Graph tab title…" with `0 !== 1` (no `editor/title` entry exists yet). The second test passes.

- [ ] **Step 3: Add the manifest entry**

In `package.json`, `contributes.menus["editor/title"]` (line 325), add a comma after the `null.openInNullNotes` entry and append:

```json
        {
          "command": "null.graph.pull",
          "when": "activeWebviewPanelId == 'null.commitGraph' && null.graph.state == ready && !null.graph.operationInProgress",
          "group": "navigation@1"
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` in `extensions/null-tools`.
Expected: PASS for both new tests and no regression in the others. If JSON parsing throws, the comma from Step 3 is missing.

- [ ] **Step 5: Update the spec row**

In `docs/specs/commit-graph-design.md`, in the Pull row of the actions table, replace `Command only (view title), no row context.` with `Command only: a button in the sidebar view's title and one in the Commit Graph tab's title bar, no row context.` Change nothing else in the row.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-tools/package.json extensions/null-tools/src/graph/graphMenus.test.ts
git commit -m "feat(null-tools): Null: Pull button in the Commit Graph tab title"
git add docs/specs/commit-graph-design.md
git commit -m "docs: mention the Pull button in the Commit Graph tab title in the spec"
```

---

### Task 2: Compiled output and real-build verification

**Files:**
- Modify (generated): `extensions/null-tools/out/graph/graphMenus.test.js` and its `.map`

**Interfaces:**
- Consumes: Task 1.
- Produces: nothing.

- [ ] **Step 1: Refresh compiled output**

Run: `npm run compile` in `extensions/null-tools`, then `git status extensions/null-tools`.
Expected: only `out/graph/graphMenus.test.js` and its `.map` are new. `lib/` is unchanged (no webview code changed).

- [ ] **Step 2: Commit compiled output separately**

```bash
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output"
```

- [ ] **Step 3: Verify in the real build**

Run `/verify-local null-tools`. A manifest `when` clause cannot be unit tested against VS Code's own evaluator, so these checks are the proof. In a scratch clone with one local and one remote commit (ahead 1 / behind 1), run `Null: Open Commit Graph` and check:

1. The Pull button (`$(repo-pull)`) is in the tab's title bar. Switch to a text file tab and to a Markdown preview: no Pull button there. (Focus item 1.)
2. Click it: same result as the sidebar button (modal, or the configured behaviour). The graph reloads afterwards.
3. Click the tab button and then the sidebar button quickly: the second reports "Another Commit Graph action is still running." and nothing runs twice. (Focus item 4.)
4. Make both sides edit the same line, unset `pull.rebase`, pull and choose Rebase. While the banner shows "Rebase stopped", the button is gone from the tab title. After Abort it is back. (Focus item 3.)
5. Close the sidebar view, run `Developer: Reload Window` with the Commit Graph tab open: the button appears once the tab has loaded. (Focus item 5. If it never appears, `null.graph.state` is only set while a view is open; set it from `CommitGraphPanel.reveal`'s lease instead and add that to this plan.)
6. Open the tab in a folder that is not a Git repository: the tab explains it and has no Pull button. (Focus item 2.)

Expected: all six as stated.

- [ ] **Step 4: Report**

Report which of Steps 1 to 3 ran, with output. Do not push.

---

## Notes for the Reviewer of This Plan

- Chosen over a button drawn inside the webview: that needs a new `pull` message in `protocol.ts`, a validator case in `graphMessages.ts`, a toolbar element and CSS in `lib/commitGraph.css`, a state-driven disabled flag in `commitGraph.ts`, and a rebuilt `lib/commitGraph.js`, all to reproduce what the editor title bar already provides with the same icon and the same enablement keys. If you want the button inside the page (for example next to a future search box), say so and I will write that plan; it reuses `{ type: 'banner' }`'s pattern of forwarding to a command.
- Checked and dropped: gating on `null.graph.state` in the sidebar entry too. It shows a button on the welcome states there, but pressing it only yields a message, and that entry is shipped behaviour this plan does not need to change.
- Not in scope: `--rebase-merges` for `pull.rebase=merges`, a timed auto-fetch, a way to un-remember from the UI, Fetch and Push buttons (push is excluded by the spec's "no push" rule).

# Native Project Dashboard Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Replace the stock VS Code Welcome/Getting Started page with a NULL-branded dashboard that opens on startup, showing recent-project cards (with async git branch/dirty status) and three quick actions: Open Folder, New Project, Clone Repo.

**Architecture:** A single-line VS Code core patch redirects the startup-page decision to open a `null-dashboard:` scheme URI instead of constructing `GettingStartedInput`. Everything else — the card grid, git shelling, New Project, Clone Repo — lives entirely in the `null-tools` extension as a `CustomReadonlyEditorProvider` + webview, following the same webview-asset/message-passing pattern already used by the AI Agents and GitHub Issues panels.

**Tech Stack:** TypeScript (extension host + webview client), VS Code Extension API (`registerCustomEditorProvider`, `showOpenDialog`/`showInputBox`, Terminal Shell Integration API), `node:test` for unit tests, `git` CLI via `child_process`.

**Spec:** `docs/specs/native-project-dashboard-design.md`

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

- Work only inside `D:\Coding\Apps\null-ide\` and its subdirectories (repo-wide constraint, `CLAUDE.md`).
- No new npm dependencies for the git-status batching — spec requires "a small manual queue... no new dependency" (design spec, Scope).
- Git shelling follows the existing `execFile*` convention in `extensions/null-tools/src/github/gitBranch.ts`: always pass `{ cwd, timeout: 5000 }`; a failing/timing-out call is caught and treated as "no status," never thrown to the caller.
- `patches/` files follow the `NNN-short-description.patch` naming convention and are generated via `git format-patch` against a temporary `vscode-src` clone at the pinned `VSCODIUM_TAG`/`MS_TAG` (currently `1.135.06055`), per `patches/README.md`. No local `vscode-src/` checkout is kept in this repo.
- Never hand-edit compiled output (`extensions/null-tools/out/*.js`, `extensions/null-tools/lib/*.js`) — those are `tsc` build artifacts; edit the `.ts` sources under `src/` only.
- v1 scope, per the design spec — do not build: "last build status" badges, pinned projects, a New Project template/type picker, auto-refresh of git status on focus/timer, or unregistering the stock Welcome/Getting Started contribution (it must stay reachable via Command Palette → "Help: Welcome").
- Full builds run in CI only (`windows-2022` runner); nothing in this plan requires or should attempt a local full VS Code build. `scripts/build-local.ps1` exists for iterating on `build.yml`/`shell-ext`/`installer`/patch-apply steps specifically, but don't invoke it as part of this plan unless asked.

## Review Focus

- A recent-project entry whose folder was deleted or renamed since it was last opened — `git rev-parse`/`git status` will fail with ENOENT-style errors; the batch must treat it as "no git badge," not crash or hang the batch. Covered by Task 2's isolation test.
- `null-recent-projects.json` missing, empty, or containing zero entries — the webview must render an empty state, not throw on an empty array or a `[]` payload. Covered by Task 3's card-render logic (explicit empty-array branch) and manual check.
- New Project: the chosen project name collides with an existing directory at the target path — `mkdirSync` must surface an error dialog and must not silently open the pre-existing (unrelated) folder. Covered by Task 4's `createProjectDirectory` unit test (EEXIST case).
- Clone Repo: the user's shell has no Shell Integration active (unusual shell, or the setting disabled) — `onDidEndTerminalShellExecution` never fires, so the clone still completes but the folder never auto-opens. This is an accepted degradation (documented in Task 5, not a bug to fix): the terminal output still shows success, and the user can Open Folder manually.
- Re-opening the dashboard after closing it (via Command Palette → "Help: Welcome" then back, or a second `null-dashboard:` URI open) must not throw or duplicate state — the provider is stateless per `resolveCustomEditor` call, verified manually in Task 3's step 6 and Task 6's final walkthrough.

---

## File Structure

**Create:**
- `patches/003-null-dashboard-startup.patch` — core patch redirecting the startup-page open call.
- `extensions/null-tools/src/dashboardGitStatus.ts` — bounded-concurrency git branch/dirty batch (pure Node, no `vscode` import).
- `extensions/null-tools/src/dashboardGitStatus.test.ts` — unit tests for the batch.
- `extensions/null-tools/src/webview/dashboard.ts` — webview client script (card rendering, message handling).
- `extensions/null-tools/tsconfig.webview-dashboard.json` — compiles the client script to `lib/dashboard.js`.
- `extensions/null-tools/src/dashboard.ts` — `CustomReadonlyEditorProvider` (extension host side).
- `extensions/null-tools/src/dashboardActions.ts` — New Project / Clone Repo flows.
- `extensions/null-tools/src/dashboardActions.test.ts` — unit test for the one pure/testable piece of `dashboardActions.ts`.
- `extensions/null-tools/src/dashboardIntegration.ts` — `registerDashboardFeature`, wiring the provider into `activate()`.

**Modify:**
- `extensions/null-tools/package.json` — `customEditors` contribution, `onCustomEditor:null.dashboard` activation event, `compile`/`test` script entries.
- `extensions/null-tools/src/extension.ts` — call `registerDashboardFeature(context)`.
- `extensions/null-tools/src/dashboard.ts` — Task 4 and Task 5 each add one `case` to the inbound-message switch.

---

### Task 1: VS Code core patch — redirect startup page to the dashboard scheme

**Files:**
- Create: `patches/003-null-dashboard-startup.patch`

**Interfaces:**
- Consumes: nothing from this repo's TypeScript — this is a patch against the upstream VS Code source tree.
- Produces: on startup (when `workbench.startupEditor` resolves to the Welcome-page branch), the workbench opens `URI.from({ scheme: 'null-dashboard', path: '/Dashboard' })` via `IEditorService.openEditor(...)` instead of constructing `GettingStartedInput`. Task 3's `customEditors` contribution (`selector: [{ filenamePattern: 'Dashboard' }]`) depends on that exact basename (`Dashboard`).

This patch can't be written blind — per the design spec's Background section, there's no local `vscode-src/` checkout in this repo, and the exact call site must be confirmed against the source at the pinned tag before editing. Do the investigation as the first two steps; don't skip to editing a guessed line number.

- [ ] **Step 1: Clone VS Code at the pinned tag and apply VSCodium's patches**

```bash
MS_TAG=$(grep -A1 '"vscode"' <(curl -s https://raw.githubusercontent.com/VSCodium/vscodium/$(cat VSCODIUM_TAG)/package.json) | tail -1 | tr -d ' ",' | cut -d: -f2)
git clone --depth 1 https://github.com/microsoft/vscode.git /tmp/vscode-src
cd /tmp/vscode-src
git fetch --depth 1 origin "$MS_TAG"
git checkout "$MS_TAG"
```

If `MS_TAG` can't be resolved this way, check VSCodium's own `build.sh`/`prepare_vscode.sh` at `VSCODIUM_TAG` (`1.135.06055`) for the exact upstream commit/tag it builds against, and check that out instead.

- [ ] **Step 2: Locate the startup-page decision point**

```bash
grep -rn "GettingStartedInput" src/vs/workbench/contrib/welcomeGettingStarted/browser/ | grep -i "startup\|contribution"
grep -rn "workbench.startupEditor" src/vs/workbench/contrib/welcomeGettingStarted/browser/
```

As of recent VS Code versions this resolves to a `StartupPage*Contribution` class in
`src/vs/workbench/contrib/welcomeGettingStarted/browser/startupPage.ts` (or
`gettingStarted.contribution.ts` — the exact filename has moved between versions),
whose `run()`/`doOpen()` method reads the `workbench.startupEditor` setting and,
for the Welcome-page branch, calls `this.editorService.openEditor({ resource: GettingStartedInput.RESOURCE, ... }, ...)`
or constructs `new GettingStartedInput()` directly. Confirm the exact file, class,
and line against what Step 2's grep actually returns — don't assume the names
above are still current for `1.135.06055`.

- [ ] **Step 3: Replace the `GettingStartedInput` construction with the dashboard URI**

In the file/method found in Step 2, change only the single construction site.
Example shape of the change (adjust to match the real surrounding code):

```diff
- await this.editorService.openEditor({
-   resource: GettingStartedInput.RESOURCE,
-   options: { pinned: false },
- }, ACTIVE_GROUP);
+ await this.editorService.openEditor({
+   resource: URI.from({ scheme: 'null-dashboard', path: '/Dashboard' }),
+   options: { pinned: false },
+ }, ACTIVE_GROUP);
```

Do not touch `GettingStartedInput`/`GettingStartedEditor`'s own registration —
"Help: Welcome" in the Command Palette must keep working. Make sure `URI` is
already imported in that file (it's used pervasively in workbench contribution
code; if not, add the import from `vs/base/common/uri`).

- [ ] **Step 4: Commit inside the vscode-src clone and export the patch**

```bash
cd /tmp/vscode-src
git add -p
git commit -m "feat: open null-dashboard scheme instead of GettingStartedInput on startup"
git format-patch HEAD~1 -o /d/Coding/Apps/null-ide/patches/
mv /d/Coding/Apps/null-ide/patches/0001-feat-open-null-dashboard-scheme-instead-of-getting.patch \
   /d/Coding/Apps/null-ide/patches/003-null-dashboard-startup.patch
```

- [ ] **Step 5: Verify the patch applies cleanly**

```bash
cd /d/Coding/Apps/null-ide
VSCODE_SRC=/tmp/vscode-src bash build.sh --patches-only
```

(per `patches/README.md`'s documented patch-testing command). Expected: no
rejected hunks. If this repo doesn't have a `build.sh` at the root (check
first — `patches/README.md` references it but it may live under a build
script that's part of the CI checkout, not this repo), instead verify by
re-applying the patch onto a fresh copy of the same clone: `git apply --check
patches/003-null-dashboard-startup.patch` from inside a fresh `vscode-src`
checkout at the same tag with VSCodium's patches applied.

- [ ] **Step 6: Commit**

```bash
git add patches/003-null-dashboard-startup.patch
git commit -m "feat: add core patch to open null dashboard on startup"
```

---

### Task 2: Bounded-concurrency git-status batch

**Files:**
- Create: `extensions/null-tools/src/dashboardGitStatus.ts`
- Test: `extensions/null-tools/src/dashboardGitStatus.test.ts`
- Modify: `extensions/null-tools/package.json:12` (add the new test file to the `test` script's `node --test` argument list)

**Interfaces:**
- Consumes: nothing outside Node's `child_process`/`util`.
- Produces (for Task 3):
  ```ts
  export interface GitStatus { branch: string; dirty: boolean; }
  export function computeGitStatuses(
    paths: string[],
    onResult: (path: string, status: GitStatus | null) => void,
    concurrency?: number,
    fetchStatus?: (cwd: string) => Promise<GitStatus | null>,
  ): Promise<void>
  ```

Note on the spec's wording: the design doc says to follow `gitBranch.ts`'s
`execFileSync` pattern. That pattern is fine for `gitBranch.ts`'s single
one-off call, but `execFileSync` blocks the whole extension host thread —
using it in a loop would make "4 in flight at once" impossible (Node is
single-threaded; a synchronous call can't overlap with anything) and would
freeze the UI for `projects × up to 5s` in the worst case. This task uses
`execFile` (async, promisified) instead so the concurrency cap is real and
the extension host stays responsive. Same git commands, same `cwd`/`timeout`
options as the existing pattern — only the sync/async choice differs.

- [ ] **Step 1: Write the failing tests**

```ts
// extensions/null-tools/src/dashboardGitStatus.test.ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { computeGitStatuses, GitStatus } from './dashboardGitStatus';

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'dashboard-git-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

function commit(dir: string, file: string, message: string): void {
  writeFileSync(path.join(dir, file), file);
  execFileSync('git', ['add', file], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

test('computeGitStatuses reports branch and clean status for a committed repo', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  const results = new Map<string, GitStatus | null>();
  await computeGitStatuses([dir], (p, status) => results.set(p, status));
  const status = results.get(dir);
  assert.ok(status);
  assert.strictEqual(status!.dirty, false);
  assert.match(status!.branch, /^(main|master)$/);
});

test('computeGitStatuses reports dirty for uncommitted changes', async () => {
  const dir = initRepo();
  commit(dir, 'a.txt', 'initial');
  writeFileSync(path.join(dir, 'a.txt'), 'changed');
  const results = new Map<string, GitStatus | null>();
  await computeGitStatuses([dir], (p, status) => results.set(p, status));
  assert.strictEqual(results.get(dir)!.dirty, true);
});

test('computeGitStatuses returns null for a non-git directory without blocking others', async () => {
  const gitDir = initRepo();
  commit(gitDir, 'a.txt', 'initial');
  const nonGitDir = mkdtempSync(path.join(tmpdir(), 'dashboard-nongit-test-'));
  const results = new Map<string, GitStatus | null>();
  await computeGitStatuses([nonGitDir, gitDir], (p, status) => results.set(p, status));
  assert.strictEqual(results.get(nonGitDir), null);
  assert.ok(results.get(gitDir));
});

test('computeGitStatuses never exceeds the configured concurrency cap', async () => {
  let inFlight = 0, peak = 0;
  const fakeFetch = async (): Promise<GitStatus | null> => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise(resolve => setTimeout(resolve, 20));
    inFlight--;
    return { branch: 'main', dirty: false };
  };
  const paths = Array.from({ length: 10 }, (_, i) => `fake-${i}`);
  await computeGitStatuses(paths, () => {}, 3, fakeFetch);
  assert.strictEqual(peak, 3);
});

test('computeGitStatuses isolates a failing fetch from the rest of the batch', async () => {
  const fakeFetch = async (cwd: string): Promise<GitStatus | null> => {
    if (cwd === 'bad') throw new Error('boom');
    return { branch: 'main', dirty: false };
  };
  const results = new Map<string, GitStatus | null>();
  await computeGitStatuses(['bad', 'good-1', 'good-2'], (p, s) => results.set(p, s), 2, fakeFetch);
  assert.strictEqual(results.get('bad'), null);
  assert.deepStrictEqual(results.get('good-1'), { branch: 'main', dirty: false });
  assert.deepStrictEqual(results.get('good-2'), { branch: 'main', dirty: false });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd extensions/null-tools
npx tsc -p tsconfig.json
node --test out/dashboardGitStatus.test.js
```

Expected: FAIL — `Cannot find module './dashboardGitStatus'`.

- [ ] **Step 3: Implement `dashboardGitStatus.ts`**

```ts
// extensions/null-tools/src/dashboardGitStatus.ts
'use strict';

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitStatus {
  branch: string;
  dirty: boolean;
}

async function getGitStatus(cwd: string): Promise<GitStatus | null> {
  try {
    const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 5000 });
    const { stdout: porcelain } = await execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 5000 });
    return { branch: branch.trim(), dirty: porcelain.trim().length > 0 };
  } catch {
    return null;
  }
}

/**
 * Computes git status for each path with at most `concurrency` shell-outs in
 * flight at once, calling onResult(path, status) as each one resolves (not
 * all at once) so the caller can update the UI progressively. A failing or
 * throwing fetch for one path never blocks or fails the rest of the batch.
 */
export async function computeGitStatuses(
  paths: string[],
  onResult: (path: string, status: GitStatus | null) => void,
  concurrency = 4,
  fetchStatus: (cwd: string) => Promise<GitStatus | null> = getGitStatus,
): Promise<void> {
  let next = 0;

  async function worker(): Promise<void> {
    while (next < paths.length) {
      const index = next++;
      const p = paths[index];
      let status: GitStatus | null;
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

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd extensions/null-tools
npx tsc -p tsconfig.json
node --test out/dashboardGitStatus.test.js
```

Expected: PASS (5 tests).

- [ ] **Step 5: Add the test file to `package.json`'s `test` script**

```diff
- "test": "tsc -p tsconfig.json && node --test out/recentProjects.test.js out/scratchNotesStorage.test.js out/autoGitignore.test.js out/versionComparison.test.js out/nullNotes.test.js out/github/githubRemote.test.js out/github/issueFilter.test.js out/github/promptFormat.test.js out/github/gitBranch.test.js out/github/taskList.test.js out/github/issueTemplates.test.js"
+ "test": "tsc -p tsconfig.json && node --test out/recentProjects.test.js out/scratchNotesStorage.test.js out/autoGitignore.test.js out/versionComparison.test.js out/nullNotes.test.js out/github/githubRemote.test.js out/github/issueFilter.test.js out/github/promptFormat.test.js out/github/gitBranch.test.js out/github/taskList.test.js out/github/issueTemplates.test.js out/dashboardGitStatus.test.js"
```

- [ ] **Step 6: Run the full test script and commit**

```bash
npm test
git add extensions/null-tools/src/dashboardGitStatus.ts extensions/null-tools/src/dashboardGitStatus.test.ts extensions/null-tools/package.json
git commit -m "feat(null-tools): add bounded-concurrency git status batch for the dashboard"
```

---

### Task 3: Dashboard custom editor provider + webview client

**Files:**
- Create: `extensions/null-tools/src/webview/dashboard.ts`
- Create: `extensions/null-tools/tsconfig.webview-dashboard.json`
- Create: `extensions/null-tools/src/dashboard.ts`
- Modify: `extensions/null-tools/package.json` — add `customEditors` contribution, add `onCustomEditor:null.dashboard` to `activationEvents`, add the webview tsconfig to the `compile` script.

**Interfaces:**
- Consumes:
  - `getRecentProjectsFilePath(): string`, `readRecentProjects(filePath: string): RecentProjectEntry[]`, `RecentProjectEntry { path, label, isWorkspaceFile, timestamp }` from `./recentProjects`.
  - `getNonce(): string` from `./webviewUtils`.
  - `computeGitStatuses`, `GitStatus` from Task 2's `./dashboardGitStatus`.
- Produces (for Task 4, 5, 6):
  ```ts
  export class DashboardEditorProvider implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> {
    constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext)
  }
  ```
  Inbound webview message union (extended by Tasks 4/5): `{ type: 'ready' } | { type: 'refresh' } | { type: 'openFolder' } | { type: 'openProject'; path: string } | { type: 'newProject' } | { type: 'cloneRepo' }`.

Per the design spec's Testing section, this class of change (webview wiring,
no branching logic of its own) isn't unit tested in this repo — the same
convention `agentsPaste`/`injectContext` follow. It's verified by compiling
and by the manual walkthrough in Task 6.

- [ ] **Step 1: Add the `customEditors` contribution and activation event**

`registerCustomEditorProvider` needs the `viewType` declared in
`package.json` so VS Code's editor-resolver knows to activate `null-tools`
the first time a `null-dashboard:` URI is opened — including at startup,
before `onStartupFinished` has fired. Add `onCustomEditor:null.dashboard`
alongside the existing `onStartupFinished` (don't remove the latter; other
features still rely on it).

```diff
- "activationEvents": ["onStartupFinished"],
+ "activationEvents": ["onStartupFinished", "onCustomEditor:null.dashboard"],
  "contributes": {
+   "customEditors": [
+     {
+       "viewType": "null.dashboard",
+       "displayName": "Null Dashboard",
+       "selector": [{ "filenamePattern": "Dashboard" }],
+       "priority": "default"
+     }
+   ],
    "commands": [
```

(Insert `customEditors` as a new top-level key under `contributes`, e.g.
right before `"commands"`.)

- [ ] **Step 2: Add the webview tsconfig**

```json
// extensions/null-tools/tsconfig.webview-dashboard.json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "none",
    "lib": ["ES2017", "DOM"],
    "outFile": "./lib/dashboard.js",
    "strict": true,
    "sourceMap": false,
    "skipLibCheck": true
  },
  "include": ["src/webview/dashboard.ts"]
}
```

```diff
- "compile": "tsc -p tsconfig.json && tsc -p tsconfig.webview.json && tsc -p tsconfig.webview-issues.json && tsc -p tsconfig.webview-issue-detail.json",
+ "compile": "tsc -p tsconfig.json && tsc -p tsconfig.webview.json && tsc -p tsconfig.webview-issues.json && tsc -p tsconfig.webview-issue-detail.json && tsc -p tsconfig.webview-dashboard.json",
```

- [ ] **Step 3: Write the webview client script**

```ts
// extensions/null-tools/src/webview/dashboard.ts
'use strict';

interface RecentProjectEntry {
  path: string;
  label: string;
  isWorkspaceFile: boolean;
  timestamp: number;
}

interface GitStatus {
  branch: string;
  dirty: boolean;
}

type OutboundMessage =
  | { type: 'projects'; projects: RecentProjectEntry[] }
  | { type: 'gitStatus'; path: string; status: GitStatus | null };

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

(function main(): void {
  const vscode = acquireVsCodeApi();
  const cardsEl = document.getElementById('cards')!;
  const cardByPath = new Map<string, HTMLElement>();

  function formatTimestamp(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  function render(projects: RecentProjectEntry[]): void {
    cardsEl.innerHTML = '';
    cardByPath.clear();
    if (projects.length === 0) {
      const empty = document.createElement('div');
      empty.id = 'empty';
      empty.textContent = 'No recent projects yet.';
      cardsEl.appendChild(empty);
      return;
    }
    for (const project of projects) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="label"></div>
        <div class="path"></div>
        <div class="meta"></div>
      `;
      card.querySelector('.label')!.textContent = project.label;
      card.querySelector('.path')!.textContent = project.path;
      const meta = card.querySelector('.meta')!;
      const timestamp = document.createElement('span');
      timestamp.className = 'timestamp';
      timestamp.textContent = formatTimestamp(project.timestamp);
      meta.appendChild(timestamp);
      card.addEventListener('click', () => vscode.postMessage({ type: 'openProject', path: project.path }));
      cardsEl.appendChild(card);
      cardByPath.set(project.path, card);
    }
  }

  function applyGitStatus(path: string, status: GitStatus | null): void {
    const card = cardByPath.get(path);
    if (!card || !status) return;
    const meta = card.querySelector('.meta')!;
    const branch = document.createElement('span');
    branch.className = 'branch';
    branch.textContent = status.branch;
    meta.appendChild(branch);
    if (status.dirty) {
      const dirty = document.createElement('span');
      dirty.className = 'dirty';
      dirty.textContent = '\u25CF';
      dirty.title = 'Uncommitted changes';
      meta.appendChild(dirty);
    }
  }

  window.addEventListener('message', (event: MessageEvent<OutboundMessage>) => {
    const msg = event.data;
    if (msg.type === 'projects') render(msg.projects);
    else if (msg.type === 'gitStatus') applyGitStatus(msg.path, msg.status);
  });

  document.getElementById('refresh')!.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  document.getElementById('open-folder')!.addEventListener('click', () => vscode.postMessage({ type: 'openFolder' }));
  document.getElementById('new-project')!.addEventListener('click', () => vscode.postMessage({ type: 'newProject' }));
  document.getElementById('clone-repo')!.addEventListener('click', () => vscode.postMessage({ type: 'cloneRepo' }));

  vscode.postMessage({ type: 'ready' });
})();
```

- [ ] **Step 4: Write the extension-host provider**

```ts
// extensions/null-tools/src/dashboard.ts
'use strict';

import * as vscode from 'vscode';
import { getNonce } from './webviewUtils';
import { getRecentProjectsFilePath, readRecentProjects, RecentProjectEntry } from './recentProjects';
import { computeGitStatuses, GitStatus } from './dashboardGitStatus';

type OutboundMessage =
  | { type: 'projects'; projects: RecentProjectEntry[] }
  | { type: 'gitStatus'; path: string; status: GitStatus | null };

type InboundMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openFolder' }
  | { type: 'openProject'; path: string }
  | { type: 'newProject' }
  | { type: 'cloneRepo' };

export class DashboardEditorProvider implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
  ) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  resolveCustomEditor(_document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'lib')],
    };
    panel.webview.html = this._buildHtml(panel.webview);
    panel.webview.onDidReceiveMessage((msg: InboundMessage) => this._handleMessage(msg, panel.webview));
  }

  private _handleMessage(msg: InboundMessage, webview: vscode.Webview): void {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        this._sendProjectsAndStatuses(webview);
        break;
      case 'openFolder':
        vscode.commands.executeCommand('workbench.action.files.openFolder');
        break;
      case 'openProject':
        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(msg.path));
        break;
      // 'newProject' / 'cloneRepo' are handled by Task 4 / Task 5.
    }
  }

  private _sendProjectsAndStatuses(webview: vscode.Webview): void {
    const projects = readRecentProjects(getRecentProjectsFilePath());
    webview.postMessage({ type: 'projects', projects } as OutboundMessage);
    void computeGitStatuses(
      projects.map(p => p.path),
      (path, status) => webview.postMessage({ type: 'gitStatus', path, status } as OutboundMessage),
    );
  }

  private _buildHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', 'dashboard.js'));
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
<style>
  html,body { margin:0; padding:0; height:100%; background:var(--vscode-editor-background); color:var(--vscode-foreground);
              font:13px/1.5 var(--vscode-font-family); }
  #app { display:flex; flex-direction:column; height:100%; padding:24px; gap:16px; box-sizing:border-box; }
  #toolbar { display:flex; align-items:center; gap:8px; }
  #toolbar h1 { font-size:16px; font-weight:600; flex:1; margin:0; }
  button { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none;
           border-radius:4px; padding:6px 12px; cursor:pointer; font:inherit; }
  button:hover { background:var(--vscode-button-hoverBackground); }
  button.secondary { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }
  #cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:12px; overflow:auto; }
  .card { border:1px solid var(--vscode-widget-border,rgba(128,128,128,.2)); border-radius:6px; padding:12px; cursor:pointer; }
  .card:hover { background:var(--vscode-list-hoverBackground); }
  .card .label { font-weight:600; }
  .card .path { color:var(--vscode-descriptionForeground); font-size:11px; word-break:break-all; }
  .card .meta { display:flex; gap:8px; margin-top:8px; font-size:11px; color:var(--vscode-descriptionForeground); }
  .card .branch::before { content:"\\2387 "; }
  .card .dirty { color:var(--vscode-gitDecoration-modifiedResourceForeground); }
  #empty { color:var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <h1>Null IDE</h1>
    <button id="refresh" class="secondary">Refresh</button>
    <button id="clone-repo" class="secondary">Clone Repo</button>
    <button id="new-project" class="secondary">New Project</button>
    <button id="open-folder">Open Folder</button>
  </div>
  <div id="cards"></div>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body></html>`;
  }
}
```

- [ ] **Step 5: Compile and check for type errors**

```bash
cd extensions/null-tools
npm run compile
```

Expected: no TypeScript errors from `tsconfig.json` or `tsconfig.webview-dashboard.json`.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-tools/package.json extensions/null-tools/tsconfig.webview-dashboard.json \
        extensions/null-tools/src/dashboard.ts extensions/null-tools/src/webview/dashboard.ts
git commit -m "feat(null-tools): add dashboard custom editor provider with recent-project cards and async git status"
```

---

### Task 4: New Project action

**Files:**
- Create: `extensions/null-tools/src/dashboardActions.ts`
- Test: `extensions/null-tools/src/dashboardActions.test.ts`
- Modify: `extensions/null-tools/src/dashboard.ts` (add the `newProject` case)
- Modify: `extensions/null-tools/package.json:12` (add the new test file to the `test` script)

**Interfaces:**
- Consumes: nothing new.
- Produces (for Task 5 and Task 6):
  ```ts
  export function createProjectDirectory(target: string): { ok: true } | { ok: false; message: string }
  export function runNewProjectFlow(): Promise<void>
  ```

`createProjectDirectory` is pulled out as a pure, `vscode`-free function
(mirroring the `{ ok, message }` result shape `gitBranch.ts`'s
`createIssueBranch` already uses) specifically so the EEXIST failure mode —
picking a project name that collides with an existing folder — has a real
test, instead of being untestable orchestration mixed in with dialog calls.

- [ ] **Step 1: Write the failing test**

```ts
// extensions/null-tools/src/dashboardActions.test.ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProjectDirectory } from './dashboardActions';

test('createProjectDirectory creates the folder and git-inits it', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'dashboard-newproject-'));
  const target = path.join(parent, 'my-app');
  const result = createProjectDirectory(target);
  assert.deepStrictEqual(result, { ok: true });
  assert.ok(existsSync(path.join(target, '.git')));
});

test('createProjectDirectory fails with a message when the target already exists', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'dashboard-newproject-'));
  const target = path.join(parent, 'my-app');
  mkdirSync(target);
  const result = createProjectDirectory(target);
  assert.strictEqual(result.ok, false);
  assert.match((result as { ok: false; message: string }).message, /EEXIST/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd extensions/null-tools
npx tsc -p tsconfig.json
node --test out/dashboardActions.test.js
```

Expected: FAIL — `Cannot find module './dashboardActions'`.

- [ ] **Step 3: Implement `createProjectDirectory` and `runNewProjectFlow`**

```ts
// extensions/null-tools/src/dashboardActions.ts
'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

export function createProjectDirectory(target: string): { ok: true } | { ok: false; message: string } {
  try {
    fs.mkdirSync(target);
    execFileSync('git', ['init'], { cwd: target, timeout: 5000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function runNewProjectFlow(): Promise<void> {
  const parent = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Choose Parent Folder',
  });
  if (!parent || parent.length === 0) return;

  const name = await vscode.window.showInputBox({
    prompt: 'Project name',
    validateInput: value => (value.trim().length === 0 ? 'Enter a project name.' : undefined),
  });
  if (!name) return;

  const target = path.join(parent[0].fsPath, name.trim());
  const result = createProjectDirectory(target);
  if (!result.ok) {
    vscode.window.showErrorMessage(`Null: failed to create project — ${result.message}`);
    return;
  }
  vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd extensions/null-tools
npx tsc -p tsconfig.json
node --test out/dashboardActions.test.js
```

Expected: PASS (2 tests).

- [ ] **Step 5: Wire `newProject` into the dashboard provider**

```diff
// extensions/null-tools/src/dashboard.ts
 import { computeGitStatuses, GitStatus } from './dashboardGitStatus';
+import { runNewProjectFlow } from './dashboardActions';
```

```diff
       case 'openProject':
         vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(msg.path));
         break;
-      // 'newProject' / 'cloneRepo' are handled by Task 4 / Task 5.
+      case 'newProject':
+        void runNewProjectFlow();
+        break;
+      // 'cloneRepo' is handled by Task 5.
```

- [ ] **Step 6: Add the test file to `package.json`'s `test` script and recompile**

```diff
- ... out/github/issueTemplates.test.js out/dashboardGitStatus.test.js"
+ ... out/github/issueTemplates.test.js out/dashboardGitStatus.test.js out/dashboardActions.test.js"
```

```bash
cd extensions/null-tools
npm test
```

Expected: all tests, including the two new ones, pass.

- [ ] **Step 7: Commit**

```bash
git add extensions/null-tools/src/dashboardActions.ts extensions/null-tools/src/dashboardActions.test.ts \
        extensions/null-tools/src/dashboard.ts extensions/null-tools/package.json
git commit -m "feat(null-tools): add New Project action to the dashboard"
```

---

### Task 5: Clone Repo action

**Files:**
- Modify: `extensions/null-tools/src/dashboardActions.ts` (append `runCloneRepoFlow`)
- Modify: `extensions/null-tools/src/dashboard.ts` (add the `cloneRepo` case)

**Interfaces:**
- Consumes: nothing new (reuses `vscode.window`/`vscode.commands`).
- Produces (for Task 6 — already consumed by Task 3's provider once wired here):
  ```ts
  export function runCloneRepoFlow(context: vscode.ExtensionContext): Promise<void>
  ```

No unit test here: this is dialog + terminal orchestration with no pure
logic to extract (unlike Task 4's directory-collision check), consistent
with how `agentsPaste`/`injectContext` are verified in this repo — manually,
per the design spec's Testing section. The one thing worth writing down as a
comment (not a test) is the Shell Integration caveat from Review Focus:
folders open automatically only when the user's shell reports command exit
codes back to VS Code.

- [ ] **Step 1: Append the clone flow to `dashboardActions.ts`**

```ts
// extensions/null-tools/src/dashboardActions.ts — append below runNewProjectFlow

let cloneTerminal: vscode.Terminal | undefined;

function getCloneTerminal(): vscode.Terminal {
  if (!cloneTerminal || cloneTerminal.exitStatus !== undefined) {
    cloneTerminal = vscode.window.createTerminal({ name: 'Null: Clone Repo' });
  }
  return cloneTerminal;
}

export async function runCloneRepoFlow(context: vscode.ExtensionContext): Promise<void> {
  const url = await vscode.window.showInputBox({
    prompt: 'Repository URL to clone',
    validateInput: value => (value.trim().length === 0 ? 'Enter a repository URL.' : undefined),
  });
  if (!url) return;

  const parent = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Choose Parent Folder',
  });
  if (!parent || parent.length === 0) return;

  const trimmedUrl = url.trim();
  const folderName = path.basename(trimmedUrl, '.git');
  const target = vscode.Uri.file(path.join(parent[0].fsPath, folderName));

  const terminal = getCloneTerminal();
  terminal.show();

  // Auto-opens the cloned folder once the clone command exits 0, via the
  // Shell Integration API (stable since VS Code 1.93; this repo targets
  // VSCodium 1.135.06055, well past that). If the user's shell doesn't
  // report shell-integration exit codes (an unusual shell, or the setting
  // disabled), this listener simply never fires -- the clone still
  // completes and the terminal shows the result, the user just needs to
  // click Open Folder afterwards. Accepted degradation, not a bug.
  const subscription = vscode.window.onDidEndTerminalShellExecution(event => {
    if (event.terminal !== terminal) return;
    subscription.dispose();
    if (event.exitCode === 0) {
      vscode.commands.executeCommand('vscode.openFolder', target);
    }
  });
  context.subscriptions.push(subscription);

  terminal.sendText(`git clone "${trimmedUrl}" "${target.fsPath}"`);
}
```

- [ ] **Step 2: Wire `cloneRepo` into the dashboard provider**

```diff
// extensions/null-tools/src/dashboard.ts
-import { runNewProjectFlow } from './dashboardActions';
+import { runNewProjectFlow, runCloneRepoFlow } from './dashboardActions';
```

```diff
       case 'newProject':
         void runNewProjectFlow();
         break;
-      // 'cloneRepo' is handled by Task 5.
+      case 'cloneRepo':
+        void runCloneRepoFlow(this.context);
+        break;
```

- [ ] **Step 3: Compile**

```bash
cd extensions/null-tools
npm run compile
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add extensions/null-tools/src/dashboardActions.ts extensions/null-tools/src/dashboard.ts
git commit -m "feat(null-tools): add Clone Repo action to the dashboard"
```

---

### Task 6: Wire the feature into `extension.ts` and verify end to end

**Files:**
- Create: `extensions/null-tools/src/dashboardIntegration.ts`
- Modify: `extensions/null-tools/src/extension.ts`

**Interfaces:**
- Consumes: `DashboardEditorProvider` from `./dashboard` (Task 3).
- Produces: `export function registerDashboardFeature(context: vscode.ExtensionContext): void`, called once from `activate()`.

- [ ] **Step 1: Write the integration module**

```ts
// extensions/null-tools/src/dashboardIntegration.ts
'use strict';

import * as vscode from 'vscode';
import { DashboardEditorProvider } from './dashboard';

export function registerDashboardFeature(context: vscode.ExtensionContext): void {
  const provider = new DashboardEditorProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('null.dashboard', provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
  );
}
```

- [ ] **Step 2: Call it from `activate()`**

```diff
// extensions/null-tools/src/extension.ts
 import { showWelcomePage } from './welcomePage';
+import { registerDashboardFeature } from './dashboardIntegration';
```

```diff
   registerRecentProjectsUriHandler(context);
   registerScratchAndNotesFeature(context);
   registerAutoGitignoreFeature(context);
+  registerDashboardFeature(context);
```

(Place it near the other `registerXFeature(context)` calls, e.g. right
after `registerAutoGitignoreFeature`.)

- [ ] **Step 3: Compile and run the full test suite**

```bash
cd extensions/null-tools
npm run compile
npm test
```

Expected: no TypeScript errors; all unit tests (including Task 2's and
Task 4's new ones) pass.

- [ ] **Step 4: Commit**

```bash
git add extensions/null-tools/src/dashboardIntegration.ts extensions/null-tools/src/extension.ts
git commit -m "feat(null-tools): wire the dashboard feature into activation"
```

- [ ] **Step 5: Manual verification (per the design spec's Testing/Verification section — no local VS Code build is possible)**

1. Trigger a `workflow_dispatch` CI build (or wait for the next tag build).
2. Install the resulting ZIP or installer.
3. Open a fresh window; confirm the Null dashboard opens instead of the stock Welcome page. (Depends on Task 1's patch having been included in the same build.)
4. Confirm recent-project cards appear immediately, and git branch/dirty badges fill in shortly after for git-tracked entries.
5. Click the refresh button; confirm badges recompute.
6. Close the dashboard editor and reopen it via Command Palette → "Help: Welcome" then navigate back (or reopen a fresh window); confirm it renders correctly the second time with no errors in the Extension Host output.
7. Run New Project; confirm the folder is created, `git init`'d, and opened. Try it again with the same name to confirm the collision case shows an error instead of silently opening the existing folder.
8. Run Clone Repo against a real URL; confirm the terminal clones and the folder opens on success.
9. Confirm "Help: Welcome" in the Command Palette still opens the stock Getting Started page (Task 1 must not have touched `GettingStartedInput`'s own registration).

# Jump List Recent Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-clicking the Null IDE taskbar icon on Windows shows a "Recent Projects" jump list category (sourced from a list `null-tools` maintains) plus a "More Recent Projects..." task that opens a quick-pick of everything tracked beyond the jump list's visible cap.

**Architecture:** `null-tools` (extension host) writes recently-opened folders/`.code-workspace` files to `%APPDATA%\Null\null-recent-projects.json` (up to 50 entries). A patch to VS Code's Electron main process (`patches/001-jumplist-recent-projects.patch`) repoints the existing jump-list-building code in `workspacesHistoryMainService.ts` to read that file instead of VS Code's own built-in recently-opened-workspaces history, and adds a static "More Recent Projects..." task that launches `null.exe --open-url -- "null://null.null-tools/recent-projects"`, routed by VS Code's already-registered `null://` protocol to a `vscode.window.registerUriHandler` in `null-tools`.

**Tech Stack:** TypeScript (null-tools extension, `tsc`, CommonJS, target ES2022), Node's built-in `node:test` runner (no new devDependency), a git-format patch against VS Code's Electron main process (applied via `git apply --ignore-whitespace` in CI, per `.github/workflows/build.yml`).

## Global Constraints

- Builds only run in CI (`windows-latest`) — never run `npx gulp` or the full VSCodium build locally (`CLAUDE.md`).
- Patches in `patches/` apply after VSCodium's own patches, against the VS Code commit at `MS_TAG` (currently resolved from `VSCODIUM_TAG = 1.121.03429`, which pins VS Code `1.121.0` — confirmed by fetching `package.json` from that exact tag).
- `extensions/null-tools/tsconfig.json` has `strict: true` and (transitively, via VS Code's own `src/tsconfig.base.json`) the core patch's target file compiles under `noUnusedLocals: true` — any import or method left unused after editing must be removed.
- `null-tools`'s `tsconfig.json` `include` array is `["src/extension.ts", "src/ollama.ts"]` (not a glob). A file is only compiled if it's one of those two roots or transitively imported from one of them — a standalone test file that nothing imports must be added to `include` explicitly, or `tsc` silently won't emit it.
- No new npm dependencies — use Node's built-in `node:test`/`node:assert` for unit tests, matching this repo having zero existing test framework.
- Follow the existing `null.clearWebviewCache` command's convention (`extension.ts:1364-1381`) of resolving the userData directory as `path.join(process.env.APPDATA, 'Null')` — do not introduce a different path-resolution strategy.
- This entire feature is a no-op on portable ZIP installs, because upstream's `handleWindowsJumpList()` already returns early when `environmentMainService.isPortable` — this is existing upstream behavior, not something this plan changes or needs to work around.

---

### Task 1: `recentProjects.ts` core logic (pure functions, TDD)

**Files:**
- Create: `extensions/null-tools/src/recentProjects.ts`
- Create: `extensions/null-tools/src/recentProjects.test.ts`
- Modify: `extensions/null-tools/package.json:10-12` (add a `test` script)
- Modify: `extensions/null-tools/tsconfig.json:13` (add the test file to `include`, since nothing imports it and `include` is an explicit file list, not a glob)

**Interfaces:**
- Produces (consumed by Task 2 and by the patch in Task 3, which independently implements the same JSON shape in TypeScript on the main-process side — the two must agree on file path and shape):
  - `interface RecentProjectEntry { path: string; label: string; isWorkspaceFile: boolean; timestamp: number }`
  - `const MAX_TRACKED_ENTRIES = 50`
  - `function getRecentProjectsFilePath(): string` — returns `path.join(process.env.APPDATA, 'Null', 'null-recent-projects.json')`; throws if `process.env.APPDATA` is unset.
  - `function readRecentProjects(filePath: string): RecentProjectEntry[]` — returns `[]` on missing file, corrupt JSON, or non-array content.
  - `function writeRecentProjectsAtomic(filePath: string, entries: RecentProjectEntry[]): void` — writes to a temp file in the same directory then renames over the target.
  - `function upsertEntry(entries: RecentProjectEntry[], entry: Pick<RecentProjectEntry, 'path' | 'label' | 'isWorkspaceFile'>, maxEntries?: number): RecentProjectEntry[]` — dedupes by case-insensitive `path`, moves the (possibly new) entry to the front with a fresh `timestamp`, truncates to `maxEntries` (default `MAX_TRACKED_ENTRIES`).

- [ ] **Step 1: Write the failing tests**

Create `extensions/null-tools/src/recentProjects.test.ts`:

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  upsertEntry,
  readRecentProjects,
  writeRecentProjectsAtomic,
  RecentProjectEntry,
} from './recentProjects';

test('upsertEntry adds a new entry to the front', () => {
  const result = upsertEntry([], { path: 'C:\\Projects\\Foo', label: 'Foo', isWorkspaceFile: false });
  assert.equal(result.length, 1);
  assert.equal(result[0].path, 'C:\\Projects\\Foo');
  assert.equal(result[0].label, 'Foo');
});

test('upsertEntry moves an existing entry (case-insensitive) to the front instead of duplicating', () => {
  const existing: RecentProjectEntry[] = [
    { path: 'C:\\Projects\\Foo', label: 'Foo', isWorkspaceFile: false, timestamp: 1 },
    { path: 'C:\\Projects\\Bar', label: 'Bar', isWorkspaceFile: false, timestamp: 2 },
  ];
  const result = upsertEntry(existing, { path: 'c:\\projects\\foo', label: 'Foo', isWorkspaceFile: false });
  assert.equal(result.length, 2);
  assert.equal(result[0].path, 'c:\\projects\\foo');
  assert.equal(result[1].path, 'C:\\Projects\\Bar');
});

test('upsertEntry truncates to maxEntries', () => {
  const existing: RecentProjectEntry[] = Array.from({ length: 5 }, (_, i) => ({
    path: `C:\\Projects\\P${i}`, label: `P${i}`, isWorkspaceFile: false, timestamp: i,
  }));
  const result = upsertEntry(existing, { path: 'C:\\Projects\\New', label: 'New', isWorkspaceFile: false }, 3);
  assert.equal(result.length, 3);
  assert.equal(result[0].path, 'C:\\Projects\\New');
});

test('readRecentProjects returns [] for a missing file', () => {
  const missing = path.join(os.tmpdir(), `null-recent-projects-missing-${process.pid}.json`);
  assert.deepEqual(readRecentProjects(missing), []);
});

test('readRecentProjects returns [] for corrupt JSON', () => {
  const filePath = path.join(os.tmpdir(), `null-recent-projects-corrupt-${process.pid}.json`);
  fs.writeFileSync(filePath, '{not valid json');
  try {
    assert.deepEqual(readRecentProjects(filePath), []);
  } finally {
    fs.unlinkSync(filePath);
  }
});

test('writeRecentProjectsAtomic then readRecentProjects round-trips entries', () => {
  const filePath = path.join(os.tmpdir(), `null-recent-projects-roundtrip-${process.pid}.json`);
  const entries: RecentProjectEntry[] = [
    { path: 'C:\\Projects\\Foo', label: 'Foo', isWorkspaceFile: false, timestamp: 123 },
  ];
  try {
    writeRecentProjectsAtomic(filePath, entries);
    assert.deepEqual(readRecentProjects(filePath), entries);
  } finally {
    fs.unlinkSync(filePath);
  }
});
```

- [ ] **Step 2: Add the test file to `tsconfig.json`'s `include`**

`tsconfig.json`'s `include` is an explicit file list, not a glob (see Global Constraints) — `recentProjects.test.ts` isn't imported by anything, so it must be listed directly or `tsc` will silently skip it.

Modify `extensions/null-tools/tsconfig.json:13` — change:
```json
  "include": ["src/extension.ts", "src/ollama.ts"],
```
to:
```json
  "include": ["src/extension.ts", "src/ollama.ts", "src/recentProjects.test.ts"],
```

(`recentProjects.ts` itself does not need a separate `include` entry — it will be pulled in transitively once `recentProjects.test.ts` imports it below.)

- [ ] **Step 3: Run tsc to verify the tests fail to compile**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './recentProjects'` (the module doesn't exist yet).

- [ ] **Step 4: Write the minimal implementation**

Create `extensions/null-tools/src/recentProjects.ts`:

```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';

export interface RecentProjectEntry {
  path: string;
  label: string;
  isWorkspaceFile: boolean;
  timestamp: number;
}

export const MAX_TRACKED_ENTRIES = 50;

export function getRecentProjectsFilePath(): string {
  const appData = process.env.APPDATA;
  if (!appData) { throw new Error('Cannot locate %APPDATA%.'); }
  return path.join(appData, 'Null', 'null-recent-projects.json');
}

export function readRecentProjects(filePath: string): RecentProjectEntry[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeRecentProjectsAtomic(filePath: string, entries: RecentProjectEntry[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(entries, null, '\t'));
  fs.renameSync(tmpPath, filePath);
}

export function upsertEntry(
  entries: RecentProjectEntry[],
  entry: Pick<RecentProjectEntry, 'path' | 'label' | 'isWorkspaceFile'>,
  maxEntries: number = MAX_TRACKED_ENTRIES,
): RecentProjectEntry[] {
  const normalizedTarget = entry.path.toLowerCase();
  const withoutExisting = entries.filter(e => e.path.toLowerCase() !== normalizedTarget);
  const updated: RecentProjectEntry[] = [
    { path: entry.path, label: entry.label, isWorkspaceFile: entry.isWorkspaceFile, timestamp: Date.now() },
    ...withoutExisting,
  ];
  return updated.slice(0, maxEntries);
}
```

- [ ] **Step 5: Run `tsc` to verify it compiles**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: PASS (no errors, `out/recentProjects.js` and `out/recentProjects.test.js` produced).

- [ ] **Step 6: Add the `test` script and run the tests**

Modify `extensions/null-tools/package.json:10-12`:

```json
  "scripts": {
    "compile": "tsc -p tsconfig.json && tsc -p tsconfig.webview.json",
    "test": "tsc -p tsconfig.json && node --test out/recentProjects.test.js"
  },
```

(Discovered during implementation: `node --test <directory>` does not reliably scan the directory on this Node version/platform — it errors with `Cannot find module`. An explicit file path avoids that, and avoids relying on shell glob expansion, which Windows' default `cmd.exe` npm script shell doesn't perform anyway.)

Run: `cd extensions/null-tools && npm test`
Expected: PASS — 6 tests, 0 failures (Node's built-in test runner reports a summary like `# pass 6`, `# fail 0`).

- [ ] **Step 7: Commit**

```bash
git add extensions/null-tools/src/recentProjects.ts extensions/null-tools/src/recentProjects.test.ts extensions/null-tools/package.json extensions/null-tools/tsconfig.json
git commit -m "feat(null-tools): add recent-projects tracking core logic"
```

---

### Task 2: Wire into `extension.ts` — track on activation, handle the "More Recent Projects..." URI

**Files:**
- Create: `extensions/null-tools/src/recentProjectsIntegration.ts` (not appended to `recentProjects.ts` — see note below)
- Modify: `extensions/null-tools/src/extension.ts:1-10` (import) and `extensions/null-tools/src/extension.ts:1298-1302` (activate, call sites)

**Interfaces:**
- Consumes from Task 1: `RecentProjectEntry`, `getRecentProjectsFilePath()`, `readRecentProjects(filePath)`, `writeRecentProjectsAtomic(filePath, entries)`, `upsertEntry(entries, entry, maxEntries?)`.
- Produces (consumed by Task 4's manual verification): `trackCurrentProject(): void`, `registerRecentProjectsUriHandler(context: vscode.ExtensionContext): void`.
- Depends on Task 3's patch reading the exact same file path and JSON shape — do not change the shape here without updating the patch.

**Correction discovered during implementation:** the plan originally called for appending these functions directly to `recentProjects.ts`. That breaks Task 1's tests: `recentProjects.test.ts` imports `recentProjects.ts`, and TypeScript compiles `import * as vscode from 'vscode'` to a top-level (eagerly executed) `require('vscode')` under `module: commonjs` — which fails immediately under plain `node --test`, since `vscode` only resolves inside the extension host, not standalone Node. Splitting the `vscode`-touching glue into its own file (`recentProjectsIntegration.ts`, which imports the pure functions from `recentProjects.ts`) keeps `recentProjects.ts` itself free of any `vscode` import, so the Task 1 tests keep working. `extension.ts` now imports from `recentProjectsIntegration.ts` instead of `recentProjects.ts`.

This task's logic touches the live `vscode` API surface (workspace state, URI handlers, quick-picks) and can't be meaningfully unit-tested without mocking the entire `vscode` module — out of proportion for this codebase, which has no such mocking setup anywhere. It's verified manually in Task 4 instead, alongside the jump list itself (which requires a real Windows shell regardless).

- [ ] **Step 1: Create `recentProjectsIntegration.ts` with the VS Code integration functions**

Create `extensions/null-tools/src/recentProjectsIntegration.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import {
  RecentProjectEntry,
  getRecentProjectsFilePath,
  readRecentProjects,
  writeRecentProjectsAtomic,
  upsertEntry,
} from './recentProjects';

export function trackCurrentProject(): void {
  let root: { path: string; isWorkspaceFile: boolean } | undefined;

  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile && workspaceFile.scheme === 'file') {
    root = { path: workspaceFile.fsPath, isWorkspaceFile: true };
  } else {
    const folders = vscode.workspace.workspaceFolders;
    if (folders?.length) {
      root = { path: folders[0].uri.fsPath, isWorkspaceFile: false };
    }
  }
  if (!root) { return; }

  let label = path.basename(root.path);
  if (root.isWorkspaceFile && label.endsWith('.code-workspace')) {
    label = `${label.slice(0, -'.code-workspace'.length)} (Workspace)`;
  }

  try {
    const filePath = getRecentProjectsFilePath();
    const entries = readRecentProjects(filePath);
    const updated = upsertEntry(entries, { path: root.path, label, isWorkspaceFile: root.isWorkspaceFile });
    writeRecentProjectsAtomic(filePath, updated);
  } catch (err) {
    console.error('null-tools: failed to update recent projects list', err);
  }
}

export function registerRecentProjectsUriHandler(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.window.registerUriHandler({
    async handleUri(uri: vscode.Uri) {
      if (uri.path !== '/recent-projects') { return; }

      let entries: RecentProjectEntry[];
      try {
        entries = readRecentProjects(getRecentProjectsFilePath());
      } catch {
        entries = [];
      }
      if (!entries.length) {
        vscode.window.showInformationMessage('No recent projects tracked yet.');
        return;
      }

      const picked = await vscode.window.showQuickPick(
        entries.map(e => ({ label: e.label, description: e.path, entry: e })),
        { placeHolder: 'Select a recent project to open' },
      );
      if (!picked) { return; }

      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(picked.entry.path), { forceNewWindow: true });
    },
  }));
}
```

- [ ] **Step 2: Wire both functions into `activate()`**

Modify `extensions/null-tools/src/extension.ts` — add the import near the top (after the existing `import { ClaudeHistoryIndex, ClaudeCodeSession } from './claudeHistory';` on line 10):

```ts
import { trackCurrentProject, registerRecentProjectsUriHandler } from './recentProjectsIntegration';
```

Then in `activate()` (`extension.ts:1298`), add these two calls right after the existing `context.subscriptions.push(bar);` block (after line 1302):

```ts
  trackCurrentProject();
  registerRecentProjectsUriHandler(context);
```

- [ ] **Step 3: Compile and confirm no regressions**

Run: `cd extensions/null-tools && npm test`
Expected: PASS — same 6 tests from Task 1 still pass (this task adds no new automated tests, per the note above), and `tsc` reports no errors for `extension.ts` or `recentProjects.ts`.

- [ ] **Step 4: Commit**

```bash
git add extensions/null-tools/src/recentProjectsIntegration.ts extensions/null-tools/src/extension.ts
git commit -m "feat(null-tools): track current project and handle More Recent Projects URI"
```

---

### Task 3: VS Code core patch — source the jump list from null-tools' list

**Files:**
- Create: `patches/001-jumplist-recent-projects.patch`
- Modify: `TODO.md` (check off "Jump list recent projects")

**Interfaces:**
- Consumes the exact file path and JSON shape from Task 1/2: `%APPDATA%\Null\null-recent-projects.json`, array of `{ path: string; label: string; isWorkspaceFile: boolean; timestamp: number }` (the patch only reads `path`, `label`, `isWorkspaceFile` — `timestamp` is irrelevant on the main-process side since the file is already sorted/truncated by `null-tools`).
- Consumes the URI route from Task 2: `null://null.null-tools/recent-projects`.
- Produces: a patched `src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts` in the CI build's `vscode-src` checkout.

**Corrections discovered during implementation:**
- `patches/README.md` (not mentioned in `CLAUDE.md`, discovered while placing this file) documents the actual naming convention: a **three-digit** `NNN-short-description.patch` prefix, not `git format-patch`'s default four-digit `000N-`. The patch is named `001-jumplist-recent-projects.patch` (patches/ was otherwise empty, so this is patch 001).
- The same README references a local verification helper, `build.sh --patches-only`, which applies everything in `patches/` against a `VSCODE_SRC` checkout. It currently has a pre-existing bash syntax bug unrelated to this feature (`patches=("$patch_dir"/*.patch 2>/dev/null || true)` on line 41 is invalid array-literal syntax) that prevents it from running at all. This is out of scope for this plan; verification instead uses the equivalent direct `git apply --check` shown in Step 2 below, which was actually run (not just described) against a scratch copy of the exact pinned upstream file and applied cleanly.
- **A real CI run caught a genuine bug in the first version of this patch**, since `git apply --check` only verifies the diff applies — it can't catch TypeScript type errors. The original patch called `Promises.readFile(...)` (from `vs/base/node/pfs.js`), which doesn't exist: that class only exposes `read`, `readdir`, `writeFile`, `rm`, `rename`, `copy`, `realpath`, etc. — confirmed by fetching `pfs.ts` directly and checking its exported shape, and by checking that the *original* (pre-patch) file only ever called `Promises.exists`, never `readFile`. `npx gulp vscode-win32-x64`'s `compile-src` step failed with `error TS2339: Property 'readFile' does not exist on type '(Anonymous class)'` at the exact line. Fixed by importing Node's `fs/promises` directly (`import { promises as fsPromises } from 'fs';`) and using `fsPromises.readFile`/`fsPromises.writeFile` instead of guessing at VS Code's internal `Promises` API shape. Re-verified with `git apply --check` against both 1.121.0 and 1.126.0, and with a standalone TypeScript-parser syntax check (`ts.createProgram` with `noResolve: true`) against the patched file, since the full `vscode-src` tree isn't available locally to run a real `tsc` typecheck.
- Separately, `VSCODIUM_TAG` was bumped to `1.126.04524` (VS Code `1.126.0`) mid-implementation by the scheduled upstream-check job — see the CI fix commit for `build.yml`'s Node version pin (unrelated to this patch; `workspacesHistoryMainService.ts` is byte-identical between 1.121.0 and 1.126.0, confirmed by diff).
- Three unrelated compile errors also surfaced in the same CI run, in `src/vs/platform/agentHost/node/{claude,codex,copilot}/...` — none of those files are touched by this patch or by anything in this plan; they're a pre-existing issue with VS Code 1.126.0's agentHost source (likely interacting with the VSCodium copilot-removal patch/build step) and are out of scope here.

This patch was authored and verified against the real upstream source before writing this plan: `VSCODIUM_TAG` (`1.121.03429`) pins VS Code `1.121.0`, whose `src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts` was fetched from `https://raw.githubusercontent.com/microsoft/vscode/1.121.0/...` and used as the exact base for a real `git format-patch`. The patch was then test-applied with `git apply --check --ignore-whitespace` against a pristine copy of that same file in a scratch git repo, and applied cleanly. It also removes the `getWindowsJumpListLabel` method (and its now-solely-dependent `splitRecentLabel`/`WORKSPACE_EXTENSION` imports), since that method's only call site is removed and VS Code's `tsconfig.base.json` has `noUnusedLocals: true` — leaving it in would break the CI compile step.

- [ ] **Step 1: Create the patch file**

Create `patches/001-jumplist-recent-projects.patch` with exactly this content:

```
From 093ec8f8ff7e57ff5d0da53739851ec1f4f8d99f Mon Sep 17 00:00:00 2001
From: Null IDE <dev@null-ide.local>
Date: Thu, 9 Jul 2026 15:57:16 +0200
Subject: [PATCH] feat(jumplist): source Windows jump list Recent category from
 null-tools

Adds a 'More Recent Projects...' task and repoints the jump list's
'Recent' category to read from a JSON file maintained by the null-tools
extension, instead of VS Code's built-in recently-opened-workspaces
history. Bumps the visible cap from 7 to 10 entries. Removes the
now-dead getWindowsJumpListLabel helper (and its now-unused
splitRecentLabel/WORKSPACE_EXTENSION imports) since noUnusedLocals is
enabled in VS Code's tsconfig. Uses Node's fs/promises directly for
reading/writing the JSON file rather than VS Code's internal Promises
helper from pfs.js, which has no readFile method.
---
 .../workspacesHistoryMainService.ts           | 123 +++++++++---------
 1 file changed, 58 insertions(+), 65 deletions(-)

diff --git a/src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts b/src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts
index 560f5ca..f753352 100644
--- a/src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts
+++ b/src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts
@@ -7,7 +7,7 @@ import { app, JumpListCategory, JumpListItem } from 'electron';
 import { coalesce } from '../../../base/common/arrays.js';
 import { ThrottledDelayer } from '../../../base/common/async.js';
 import { Emitter, Event as CommonEvent } from '../../../base/common/event.js';
-import { normalizeDriveLetter, splitRecentLabel } from '../../../base/common/labels.js';
+import { normalizeDriveLetter } from '../../../base/common/labels.js';
 import { Disposable } from '../../../base/common/lifecycle.js';
 import { Schemas } from '../../../base/common/network.js';
 import { isMacintosh, isWindows } from '../../../base/common/platform.js';
@@ -21,11 +21,13 @@ import { ILogService } from '../../log/common/log.js';
 import { StorageScope, StorageTarget } from '../../storage/common/storage.js';
 import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
 import { IRecent, IRecentFile, IRecentFolder, IRecentlyOpened, IRecentWorkspace, isRecentFile, isRecentFolder, isRecentWorkspace, restoreRecentlyOpened, toStoreData } from '../common/workspaces.js';
-import { IWorkspaceIdentifier, WORKSPACE_EXTENSION } from '../../workspace/common/workspace.js';
+import { IWorkspaceIdentifier } from '../../workspace/common/workspace.js';
 import { IWorkspacesManagementMainService } from './workspacesManagementMainService.js';
 import { ResourceMap } from '../../../base/common/map.js';
 import { IDialogMainService } from '../../dialogs/electron-main/dialogMainService.js';
 import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
+import { join } from '../../../base/common/path.js';
+import { promises as fsPromises } from 'fs';
 
 export const IWorkspacesHistoryMainService = createDecorator<IWorkspacesHistoryMainService>('workspacesHistoryMainService');
 
@@ -305,7 +307,7 @@ export class WorkspacesHistoryMainService extends Disposable implements IWorkspa
 	private static readonly MAX_MACOS_DOCK_RECENT_WORKSPACES = 7; 		// prefer higher number of workspaces...
 	private static readonly MAX_MACOS_DOCK_RECENT_ENTRIES_TOTAL = 10; 	// ...over number of files
 
-	private static readonly MAX_WINDOWS_JUMP_LIST_ENTRIES = 7;
+	private static readonly MAX_WINDOWS_JUMP_LIST_ENTRIES = 10; // Null IDE: was 7 upstream
 
 	// Exclude some very common files from the dock/taskbar
 	private static readonly COMMON_FILES_FILTER = [
@@ -349,58 +351,75 @@ export class WorkspacesHistoryMainService extends Disposable implements IWorkspa
 					args: '-n', // force new window
 					iconPath: process.execPath,
 					iconIndex: 0
+				},
+				{
+					// Null IDE: opens a quick-pick of all tracked recent projects (beyond the
+					// MAX_WINDOWS_JUMP_LIST_ENTRIES cap below), handled by the null-tools extension's
+					// registered URI handler. 'null' below must match product.json's urlProtocol.
+					type: 'task',
+					title: localize('moreRecentProjects', "More Recent Projects..."),
+					description: localize('moreRecentProjectsDesc', "Shows all recently opened projects"),
+					program: process.execPath,
+					args: '--open-url -- "null://null.null-tools/recent-projects"',
+					iconPath: process.execPath,
+					iconIndex: 0
 				}
 			]
 		});
 
-		// Recent Workspaces
-		if ((await this.getRecentlyOpened()).workspaces.length > 0) {
+		// Recent Projects (Null IDE: sourced from null-tools' own tracked list, not
+		// VS Code's built-in recently-opened-workspaces history)
+		{
+			interface NullRecentProjectEntry { path: string; label: string; isWorkspaceFile: boolean }
+
+			const nullRecentProjectsPath = join(this.environmentMainService.userDataPath, 'null-recent-projects.json');
+			let nullRecentProjects: NullRecentProjectEntry[] = [];
+			try {
+				const raw = await fsPromises.readFile(nullRecentProjectsPath, 'utf8');
+				nullRecentProjects = JSON.parse(raw);
+			} catch {
+				nullRecentProjects = [];
+			}
+
+			const argsForEntry = (entry: NullRecentProjectEntry) => entry.isWorkspaceFile
+				? `--file-uri "${URI.file(entry.path).toString()}"`
+				: `--folder-uri "${URI.file(entry.path).toString()}"`;
 
 			// The user might have meanwhile removed items from the jump list and we have to respect that
 			// so we need to update our list of recent paths with the choice of the user to not add them again
 			// Also: Windows will not show our custom category at all if there is any entry which was removed
 			// by the user! See https://github.com/microsoft/vscode/issues/15052
-			const toRemove: URI[] = [];
-			for (const item of app.getJumpListSettings().removedItems) {
-				const args = item.args;
-				if (args) {
-					const match = /^--(folder|file)-uri\s+"([^"]+)"$/.exec(args);
-					if (match) {
-						toRemove.push(URI.parse(match[2]));
+			const removedArgs = new Set(coalesce(app.getJumpListSettings().removedItems.map(item => item.args)));
+			if (removedArgs.size > 0) {
+				const filtered = nullRecentProjects.filter(entry => !removedArgs.has(argsForEntry(entry)));
+				if (filtered.length !== nullRecentProjects.length) {
+					nullRecentProjects = filtered;
+					try {
+						await fsPromises.writeFile(nullRecentProjectsPath, JSON.stringify(nullRecentProjects, undefined, '\t'));
+					} catch (error) {
+						this.logService.warn('updateWindowsJumpList#writeFile (null-recent-projects)', error);
 					}
 				}
 			}
-			await this.removeRecentlyOpened(toRemove);
-
-			// Add entries
-			let hasWorkspaces = false;
-			const items: JumpListItem[] = coalesce((await this.getRecentlyOpened()).workspaces.slice(0, WorkspacesHistoryMainService.MAX_WINDOWS_JUMP_LIST_ENTRIES).map(recent => {
-				const workspace = isRecentWorkspace(recent) ? recent.workspace : recent.folderUri;
-
-				const { title, description } = this.getWindowsJumpListLabel(workspace, recent.label);
-				let args;
-				if (URI.isUri(workspace)) {
-					args = `--folder-uri "${workspace.toString()}"`;
-				} else {
-					hasWorkspaces = true;
-					args = `--file-uri "${workspace.configPath.toString()}"`;
-				}
 
-				return {
-					type: 'task',
-					title: title.substr(0, 255), 				// Windows seems to be picky around the length of entries
-					description: description.substr(0, 255),	// (see https://github.com/microsoft/vscode/issues/111177)
-					program: process.execPath,
-					args,
-					iconPath: 'explorer.exe', // simulate folder icon
-					iconIndex: 0
-				};
-			}));
+			if (nullRecentProjects.length > 0) {
+				const items: JumpListItem[] = nullRecentProjects.slice(0, WorkspacesHistoryMainService.MAX_WINDOWS_JUMP_LIST_ENTRIES).map(entry => {
+					const uri = URI.file(entry.path);
+
+					return {
+						type: 'task',
+						title: entry.label.substr(0, 255), 				// Windows seems to be picky around the length of entries
+						description: this.renderJumpListPathDescription(uri).substr(0, 255),	// (see https://github.com/microsoft/vscode/issues/111177)
+						program: process.execPath,
+						args: argsForEntry(entry),
+						iconPath: 'explorer.exe', // simulate folder icon
+						iconIndex: 0
+					};
+				});
 
-			if (items.length > 0) {
 				jumpList.push({
 					type: 'custom',
-					name: hasWorkspaces ? localize('recentFoldersAndWorkspaces', "Recent Folders & Workspaces") : localize('recentFolders', "Recent Folders"),
+					name: localize('recentProjects', "Recent Projects"),
 					items
 				});
 			}
@@ -421,32 +440,6 @@ export class WorkspacesHistoryMainService extends Disposable implements IWorkspa
 		}
 	}
 
-	private getWindowsJumpListLabel(workspace: IWorkspaceIdentifier | URI, recentLabel: string | undefined): { title: string; description: string } {
-
-		// Prefer recent label
-		if (recentLabel) {
-			return { title: splitRecentLabel(recentLabel).name, description: recentLabel };
-		}
-
-		// Single Folder
-		if (URI.isUri(workspace)) {
-			return { title: basename(workspace), description: this.renderJumpListPathDescription(workspace) };
-		}
-
-		// Workspace: Untitled
-		if (this.workspacesManagementMainService.isUntitledWorkspace(workspace)) {
-			return { title: localize('untitledWorkspace', "Untitled (Workspace)"), description: '' };
-		}
-
-		// Workspace: normal
-		let filename = basename(workspace.configPath);
-		if (filename.endsWith(WORKSPACE_EXTENSION)) {
-			filename = filename.substr(0, filename.length - WORKSPACE_EXTENSION.length - 1);
-		}
-
-		return { title: localize('workspaceName', "{0} (Workspace)", filename), description: this.renderJumpListPathDescription(workspace.configPath) };
-	}
-
 	private renderJumpListPathDescription(uri: URI) {
 		return uri.scheme === 'file' ? normalizeDriveLetter(uri.fsPath) : uri.toString();
 	}
-- 
2.55.0.windows.2
```

- [ ] **Step 2: Verify the patch applies cleanly against the real upstream file**

Run (from repo root, in a scratch directory — this does not touch `vscode-src`, which doesn't exist locally per `CLAUDE.md`):

```bash
mkdir -p /tmp/verify-patch/src/vs/platform/workspaces/electron-main
curl -s "https://raw.githubusercontent.com/microsoft/vscode/1.121.0/src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts" \
  -o /tmp/verify-patch/src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts
cd /tmp/verify-patch && git init -q && git config core.autocrlf false \
  && git add -A && git -c user.email=a@a.com -c user.name=a commit -q -m baseline
git apply --check --ignore-whitespace "$OLDPWD/patches/001-jumplist-recent-projects.patch"
```

Expected: no output from `git apply --check` (silent success means the patch applies cleanly).

- [ ] **Step 3: Check off the TODO item**

Modify `TODO.md` — change:
```
* [ ] Jump list recent projects
```
to:
```
* [x] Jump list recent projects
```

- [ ] **Step 4: Commit**

```bash
git add patches/001-jumplist-recent-projects.patch TODO.md
git commit -m "feat: patch VS Code jump list to source Recent Projects from null-tools"
```

---

### Task 4: CI build and manual verification

**Files:** none (manual verification against a real build/install)

**Interfaces:** consumes the complete feature from Tasks 1-3.

- [ ] **Step 1: Trigger a CI build**

Run: `gh workflow run build.yml` (or trigger `workflow_dispatch` from the GitHub Actions UI for this repo).
Expected: the workflow starts; in particular watch the "Apply overlay patches" step log for `Applying overlay patch: 001-jumplist-recent-projects.patch` with no error, and the subsequent `npx gulp vscode-win32-x64` step compiling without TypeScript errors in `workspacesHistoryMainService.ts`.

- [ ] **Step 2: Install the built artifact**

Download the produced ZIP or `NullIDESetup-<version>.exe` from the workflow run's artifacts/release, and install it (or unzip and run `null.exe` directly for the portable ZIP — noting the jump list itself won't appear in portable mode, per the Global Constraints above; use the installer for this verification).

- [ ] **Step 3: Verify tracking and the jump list**

1. Open Null IDE, open a folder (e.g. any folder on disk), close it.
2. Open a second, different folder, close it.
3. Right-click the Null IDE icon in the Windows taskbar.
4. Confirm a "Recent Projects" category is present listing both folders, most-recently-opened first.
5. Confirm a "More Recent Projects..." task is present under "Tasks".
6. Click one of the "Recent Projects" entries — confirm it launches Null IDE on that folder.
7. Re-open a folder already in the list, close it, right-click the taskbar icon again — confirm it moved to the top rather than appearing twice.
8. Click "More Recent Projects..." — confirm a quick-pick opens listing all tracked entries; select one and confirm it opens in a new window.

- [ ] **Step 4: Report results**

If any check in Step 3 fails, note which one and the observed behavior — this determines whether the CLI-flag assumptions (`--open-url --`, `--folder-uri`, `--file-uri`) or the patched call site need adjustment before merging.

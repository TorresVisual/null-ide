# Null C++ Smart Enable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Make `null-cpp`'s three features (symbol-aware switch, auto-paired split, class scaffolding) only take effect in workspaces that look like C++ projects, with a manual override setting for edge cases.

**Architecture:** A new `projectDetection.ts` module runs a one-time `vscode.workspace.findFiles` scan at activation (gated by an `"auto"`/`"always"`/`"never"` override setting) and caches the result. `extension.ts`'s `activate()` becomes `async`, sets a `null-cpp.isCppProject` context key from that result (gating declarative `when` clauses in `package.json`), and the three feature modules each add an `isEnabled()` guard as defense-in-depth for the case a hidden command is invoked directly.

**Tech Stack:** Same as the base `null-cpp` extension — TypeScript strict/ES2022/commonjs, `node --test` for pure logic, VS Code Extension API.

## Global Constraints

- This extends the existing `extensions/null-cpp/` extension built in `docs/plans/null-cpp-extension.md` — do not duplicate its file structure or conventions, only add to them.
- `projectDetection.ts` calls `vscode.workspace.findFiles`, so — like `clangdBridge.ts` and `symbolCache.ts` — it is not unit-tested; verified via `tsc` type-checking and the manual pass, per the existing convention (files with unit tests must never `import` the `vscode` module).
- Detection is a **one-time check at activation**, not a live file watcher (per the design spec's explicit "Out of Scope").
- Every task's compile check: `cd extensions/null-cpp && npm run compile` must exit with no errors; every task touching the pure test suite: `npm test` must still show all 19 existing tests passing (this feature adds no new unit tests, since detection itself is vscode-touching).

---

## File Structure

```
extensions/null-cpp/src/
├── projectDetection.ts   — NEW: vscode-touching, one-time findFiles scan + cached isEnabled()
├── extension.ts           — MODIFIED: async activate(), setContext, detection init
├── symbolSwitch.ts         — MODIFIED: isEnabled() guard in the command handler
├── pairedSplit.ts          — MODIFIED: isEnabled() guard in all three listeners
└── scaffold.ts             — MODIFIED: isEnabled() guard in the command handler (with message)
```

Also modified: `extensions/null-cpp/package.json` (new setting, `when`-clause gating), `extensions/null-cpp/tsconfig.json` (include the new file).

---

### Task 1: Project detection module

**Files:**
- Create: `extensions/null-cpp/src/projectDetection.ts`
- Modify: `extensions/null-cpp/tsconfig.json`
- Modify: `extensions/null-cpp/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `initializeProjectDetection(): Promise<boolean>` and `isEnabled(): boolean`, both exported from `./projectDetection`. `initializeProjectDetection()` is consumed by `extension.ts` (Task 2). `isEnabled()` is consumed by `symbolSwitch.ts`, `pairedSplit.ts`, and `scaffold.ts` (Task 3).

This module cannot be unit tested outside a real workspace (it calls `vscode.workspace.findFiles`), so verification here is a successful `tsc` type-check, matching the existing `clangdBridge.ts`/`symbolCache.ts` precedent.

- [ ] **Step 1: Add the new file to `tsconfig.json`'s include list**

In `extensions/null-cpp/tsconfig.json`, change:
```json
    "src/symbolSwitch.ts",
    "src/pairedSplit.ts",
    "src/scaffold.ts"
  ]
```
to:
```json
    "src/symbolSwitch.ts",
    "src/pairedSplit.ts",
    "src/scaffold.ts",
    "src/projectDetection.ts"
  ]
```

- [ ] **Step 2: Add the override setting to `package.json`**

In `extensions/null-cpp/package.json`, change:
```json
        "null-cpp.scaffold.showInExplorer": {
          "type": "boolean",
          "default": true,
          "description": "Show 'New C++ Class...' in the Explorer context menu for folders."
        }
      }
    },
```
to:
```json
        "null-cpp.scaffold.showInExplorer": {
          "type": "boolean",
          "default": true,
          "description": "Show 'New C++ Class...' in the Explorer context menu for folders."
        },
        "null-cpp.projectDetection.override": {
          "type": "string",
          "enum": ["auto", "always", "never"],
          "default": "auto",
          "description": "Controls whether null-cpp's features are active for this workspace. 'auto' detects a C/C++ project by scanning for CMakeLists.txt, compile_commands.json, .clangd, or C/C++ source files. 'always'/'never' force the result regardless of detection."
        }
      }
    },
```

- [ ] **Step 3: Implement the detection module**

`extensions/null-cpp/src/projectDetection.ts`:
```ts
import * as vscode from 'vscode';

const BUILD_CONFIG_GLOB = '**/{CMakeLists.txt,compile_commands.json,.clangd}';
const SOURCE_FILE_GLOB = '**/*.{c,cpp,cc,cxx,h,hpp,hh,hxx}';
const EXCLUDE_GLOB = '**/node_modules/**';

let enabled = false;

function getOverride(): 'auto' | 'always' | 'never' {
  return vscode.workspace.getConfiguration('null-cpp').get<'auto' | 'always' | 'never'>(
    'projectDetection.override',
    'auto'
  );
}

async function hasAnyMatch(glob: string): Promise<boolean> {
  const matches = await vscode.workspace.findFiles(glob, EXCLUDE_GLOB, 1);
  return matches.length > 0;
}

async function scanWorkspace(): Promise<boolean> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return false;
  }
  if (await hasAnyMatch(BUILD_CONFIG_GLOB)) {
    return true;
  }
  return hasAnyMatch(SOURCE_FILE_GLOB);
}

export async function initializeProjectDetection(): Promise<boolean> {
  const override = getOverride();
  if (override === 'always') {
    enabled = true;
  } else if (override === 'never') {
    enabled = false;
  } else {
    enabled = await scanWorkspace();
  }
  return enabled;
}

export function isEnabled(): boolean {
  return enabled;
}
```

- [ ] **Step 4: Compile to verify it type-checks**

Run: `cd extensions/null-cpp && npm run compile`
Expected: exits with no errors; `out/projectDetection.js` is produced.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-cpp/src/projectDetection.ts extensions/null-cpp/tsconfig.json extensions/null-cpp/package.json
git commit -m "feat(null-cpp): add C++ project detection with manual override"
```

---

### Task 2: Wire detection into activation and gate declarative contributions

**Files:**
- Modify: `extensions/null-cpp/src/extension.ts`
- Modify: `extensions/null-cpp/package.json`

**Interfaces:**
- Consumes: `initializeProjectDetection` from `./projectDetection` (Task 1).
- Produces: the extension's real (now-async) `activate` export; the `null-cpp.isCppProject` VS Code context key, referenced by `package.json`'s `when` clauses and by nothing else in TypeScript (context keys are one-way, extension → declarative UI — imperative code must use `isEnabled()` instead, per Task 3).

- [ ] **Step 1: Make activation async and set the context key**

In `extensions/null-cpp/src/extension.ts`, replace the entire file:
```ts
import * as vscode from 'vscode';
import { registerSwitchSourceHeader } from './symbolSwitch';
import { registerPairedSplit } from './pairedSplit';
import { registerNewClass } from './scaffold';

export function activate(context: vscode.ExtensionContext): void {
  registerSwitchSourceHeader(context);
  registerPairedSplit(context);
  registerNewClass(context);
}

export function deactivate(): void {}
```
with:
```ts
import * as vscode from 'vscode';
import { registerSwitchSourceHeader } from './symbolSwitch';
import { registerPairedSplit } from './pairedSplit';
import { registerNewClass } from './scaffold';
import { initializeProjectDetection } from './projectDetection';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const enabled = await initializeProjectDetection();
  await vscode.commands.executeCommand('setContext', 'null-cpp.isCppProject', enabled);

  registerSwitchSourceHeader(context);
  registerPairedSplit(context);
  registerNewClass(context);
}

export function deactivate(): void {}
```

- [ ] **Step 2: Gate the keybinding and command palette entries**

In `extensions/null-cpp/package.json`, change:
```json
    "keybindings": [
      {
        "command": "null-cpp.switchSourceHeader",
        "key": "alt+o",
        "when": "editorTextFocus && (editorLangId == cpp || editorLangId == c)"
      }
    ],
```
to:
```json
    "keybindings": [
      {
        "command": "null-cpp.switchSourceHeader",
        "key": "alt+o",
        "when": "editorTextFocus && (editorLangId == cpp || editorLangId == c) && null-cpp.isCppProject"
      }
    ],
```

And change:
```json
      "commandPalette": [
        { "command": "null-cpp.switchSourceHeader", "when": "editorLangId == cpp || editorLangId == c" },
        { "command": "null-cpp.newClass" }
      ]
```
to:
```json
      "commandPalette": [
        {
          "command": "null-cpp.switchSourceHeader",
          "when": "(editorLangId == cpp || editorLangId == c) && null-cpp.isCppProject"
        },
        { "command": "null-cpp.newClass", "when": "null-cpp.isCppProject" }
      ]
```

- [ ] **Step 3: Gate the Explorer menu entry**

In `extensions/null-cpp/package.json`, change:
```json
      "explorer/context": [
        {
          "command": "null-cpp.newClass",
          "when": "explorerResourceIsFolder && config.null-cpp.scaffold.showInExplorer",
          "group": "navigation"
        }
      ],
```
to:
```json
      "explorer/context": [
        {
          "command": "null-cpp.newClass",
          "when": "explorerResourceIsFolder && config.null-cpp.scaffold.showInExplorer && null-cpp.isCppProject",
          "group": "navigation"
        }
      ],
```

- [ ] **Step 4: Compile and run the full test suite to verify nothing broke**

Run: `cd extensions/null-cpp && npm test`
Expected: PASS — `tsc` reports no errors, all 19 `node --test` cases still pass.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-cpp/src/extension.ts extensions/null-cpp/package.json
git commit -m "feat(null-cpp): gate keybinding/palette/menu contributions on detected project"
```

---

### Task 3: Guard the three feature modules imperatively

**Files:**
- Modify: `extensions/null-cpp/src/symbolSwitch.ts`
- Modify: `extensions/null-cpp/src/pairedSplit.ts`
- Modify: `extensions/null-cpp/src/scaffold.ts`

**Interfaces:**
- Consumes: `isEnabled` from `./projectDetection` (Task 1).
- Produces: nothing new — this task only adds early-return guards to existing exported functions (`registerSwitchSourceHeader`, `registerPairedSplit`, `registerNewClass`); their signatures are unchanged.

- [ ] **Step 1: Guard the switch command handler**

In `extensions/null-cpp/src/symbolSwitch.ts`, change:
```ts
import * as vscode from 'vscode';
import { isCppDocument } from './cppLanguage';
import { switchSourceHeader } from './clangdBridge';
import { findEnclosing, findByQualifiedName } from './symbolCache';

export function registerSwitchSourceHeader(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('null-cpp.switchSourceHeader', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isCppDocument(editor.document)) {
        return;
      }
```
to:
```ts
import * as vscode from 'vscode';
import { isCppDocument } from './cppLanguage';
import { switchSourceHeader } from './clangdBridge';
import { findEnclosing, findByQualifiedName } from './symbolCache';
import { isEnabled } from './projectDetection';

export function registerSwitchSourceHeader(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('null-cpp.switchSourceHeader', async () => {
      if (!isEnabled()) {
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isCppDocument(editor.document)) {
        return;
      }
```

- [ ] **Step 2: Guard the three paired-split listeners**

In `extensions/null-cpp/src/pairedSplit.ts`, change:
```ts
import * as vscode from 'vscode';
import { isCppDocument } from './cppLanguage';
import { switchSourceHeader } from './clangdBridge';
import { findEnclosing, findByQualifiedName, invalidate } from './symbolCache';
import { PairRegistry } from './pairRegistry';
```
to:
```ts
import * as vscode from 'vscode';
import { isCppDocument } from './cppLanguage';
import { switchSourceHeader } from './clangdBridge';
import { findEnclosing, findByQualifiedName, invalidate } from './symbolCache';
import { PairRegistry } from './pairRegistry';
import { isEnabled } from './projectDetection';
```

Then change:
```ts
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (!getConfig('autoPairSplit.enabled', true) || !isCppDocument(doc)) {
        return;
      }
```
to:
```ts
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (!isEnabled() || !getConfig('autoPairSplit.enabled', true) || !isCppDocument(doc)) {
        return;
      }
```

Then change:
```ts
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      const counterpart = registry.getCounterpart(key);
      registry.remove(key);
      invalidate(doc.uri);
      if (counterpart && getConfig('pairedSplit.autoCloseCounterpart', false)) {
        closeTab(counterpart);
      }
    }),
```
to:
```ts
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (!isEnabled()) {
        return;
      }
      const key = doc.uri.toString();
      const counterpart = registry.getCounterpart(key);
      registry.remove(key);
      invalidate(doc.uri);
      if (counterpart && getConfig('pairedSplit.autoCloseCounterpart', false)) {
        closeTab(counterpart);
      }
    }),
```

Then change:
```ts
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (!getConfig('scrollSync.enabled', true)) {
        return;
      }
```
to:
```ts
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (!isEnabled() || !getConfig('scrollSync.enabled', true)) {
        return;
      }
```

Note: the close-listener's guard is intentionally narrower in scope than the
other two — it must still run `registry.remove(key)` and `invalidate(doc.uri)`
even if `isEnabled()` is false, in every case where the *open* listener had
already recorded a pair before detection could change; but since detection is
one-time-at-activation and never changes mid-session (per Task 1), `isEnabled()`
is constant for the process lifetime, so if it's `false` no pair was ever
recorded by the open listener and this cleanup is a no-op either way. The
guard is added for symmetry and as defense-in-depth, not because it changes
behavior today.

- [ ] **Step 3: Guard the scaffold command handler**

In `extensions/null-cpp/src/scaffold.ts`, change:
```ts
import * as vscode from 'vscode';
import {
  validateClassName,
  headerFileName,
  sourceFileName,
  headerContent,
  sourceContent,
} from './scaffoldNaming';
```
to:
```ts
import * as vscode from 'vscode';
import {
  validateClassName,
  headerFileName,
  sourceFileName,
  headerContent,
  sourceContent,
} from './scaffoldNaming';
import { isEnabled } from './projectDetection';
```

Then change:
```ts
    vscode.commands.registerCommand('null-cpp.newClass', async (target?: vscode.Uri) => {
      const folderUri = await resolveTargetFolder(target);
      if (!folderUri) {
        return;
      }
```
to:
```ts
    vscode.commands.registerCommand('null-cpp.newClass', async (target?: vscode.Uri) => {
      if (!isEnabled()) {
        void vscode.window.showInformationMessage(
          "Null C++ features are inactive for this workspace (no CMakeLists.txt, compile_commands.json, .clangd, or C/C++ source files found). Set null-cpp.projectDetection.override to \"always\" to force it on."
        );
        return;
      }
      const folderUri = await resolveTargetFolder(target);
      if (!folderUri) {
        return;
      }
```

- [ ] **Step 4: Compile and run the full test suite to verify nothing broke**

Run: `cd extensions/null-cpp && npm test`
Expected: PASS — `tsc` reports no errors, all 19 `node --test` cases still pass.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-cpp/src/symbolSwitch.ts extensions/null-cpp/src/pairedSplit.ts extensions/null-cpp/src/scaffold.ts
git commit -m "feat(null-cpp): guard feature handlers with isEnabled() as defense-in-depth"
```

---

### Task 4: Manual end-to-end verification

**Files:** None — this task changes no code; it confirms the feature works in a real build.

This isn't unit-testable: it depends on real workspace content and a real running extension host.

- [ ] **Step 1: Sync the build**

Run `copy.ps1` (or trigger a `workflow_dispatch` CI build and install it) and restart Null IDE.

- [ ] **Step 2: Verify a non-C++ workspace stays quiet**

Open a workspace with no `CMakeLists.txt`/`compile_commands.json`/`.clangd` and no `.c`/`.cpp`/`.h`/`.hpp` files anywhere in it. Confirm: `Alt+O` does nothing, `null-cpp.switchSourceHeader` and `null-cpp.newClass` don't appear in the Command Palette, and "New C++ Class..." doesn't appear in the Explorer folder context menu.

- [ ] **Step 3: Verify a build-config-only workspace activates**

Open a workspace containing only a `compile_commands.json` (no source files yet). Confirm all three features are active (palette entries appear, Explorer menu entry appears, `Alt+O` works on any opened C/C++ file).

- [ ] **Step 4: Verify a source-file-only workspace activates**

Open a workspace containing only a stray `.cpp` file (no build config). Confirm all three features are active.

- [ ] **Step 5: Verify the override setting**

In a non-C++ workspace, set `null-cpp.projectDetection.override` to `"always"`, reload the window, and confirm features turn on. In a C++ workspace, set it to `"never"`, reload, and confirm features turn off. Reset to `"auto"` and reload again.

- [ ] **Step 6: Verify the scaffold guard message**

With `override` set to `"never"`, try invoking `null-cpp.newClass` directly via the Command Palette's "Show and Run Commands" (typing the raw command id if the palette entry itself is hidden — e.g. via `F1` then pasting the id). Confirm the informational message about inactive features appears instead of creating files.

No commit for this task — it's a verification pass, not a code change. If any step fails, return to the relevant task above, fix it, and re-run `npm test` before re-verifying end to end.

# Null C++ Split-View Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Fix Alt+O so it targets an already-open split pane instead of duplicating the counterpart in the current column, and make "New C++ Class..." always produce a deterministic left/right layout instead of one that depends on whatever was open beforehand.

**Architecture:** Extract the existing `findVisibleEditor` helper out of `pairedSplit.ts` into a new shared `editorLookup.ts` module so `symbolSwitch.ts` can reuse it. `symbolSwitch.ts` uses it to pick the right `viewColumn` before opening the counterpart. `scaffold.ts` gains an explicit two-column open sequence, gated by the existing `autoPairSplit.enabled` setting.

**Tech Stack:** Same as the base `null-cpp` extension — TypeScript strict/ES2022/commonjs, VS Code Extension API. No new unit tests (both fixes touch vscode-touching command/listener code, not the pure tested modules).

## Global Constraints

- Extends the existing `extensions/null-cpp/` extension — do not duplicate its established file/module conventions.
- `editorLookup.ts` is vscode-touching (calls `vscode.window.visibleTextEditors`), so — like `clangdBridge.ts`/`symbolCache.ts` — it is not unit-tested; verified via `tsc` type-checking and the manual pass.
- Every task's compile check: `cd extensions/null-cpp && npm run compile` must exit with no errors; `npm test` must still show all 19 existing tests passing (this feature adds no new unit tests).

---

## File Structure

```
extensions/null-cpp/src/
├── editorLookup.ts   — NEW: findVisibleEditor(uriString), extracted from pairedSplit.ts
├── pairedSplit.ts     — MODIFIED: imports findVisibleEditor instead of defining it locally
├── symbolSwitch.ts     — MODIFIED: targets the counterpart's existing column, or Beside if not visible
└── scaffold.ts         — MODIFIED: deterministic cpp=left/hpp=right layout when autoPairSplit is enabled
```

No `tsconfig.json`/`package.json` changes — `editorLookup.ts` needs adding to `tsconfig.json`'s include list, covered in Task 1.

---

### Task 1: Extract `findVisibleEditor` into a shared module

**Files:**
- Create: `extensions/null-cpp/src/editorLookup.ts`
- Modify: `extensions/null-cpp/src/pairedSplit.ts`
- Modify: `extensions/null-cpp/tsconfig.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `findVisibleEditor(uriString: string): vscode.TextEditor | undefined` exported from `./editorLookup`, consumed by `pairedSplit.ts` (this task) and `symbolSwitch.ts` (Task 2).

- [ ] **Step 1: Add the new file to `tsconfig.json`'s include list**

In `extensions/null-cpp/tsconfig.json`, change:
```json
    "src/scaffold.ts",
    "src/projectDetection.ts"
  ]
```
to:
```json
    "src/scaffold.ts",
    "src/projectDetection.ts",
    "src/editorLookup.ts"
  ]
```

- [ ] **Step 2: Create the shared module**

`extensions/null-cpp/src/editorLookup.ts`:
```ts
import * as vscode from 'vscode';

export function findVisibleEditor(uriString: string): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uriString);
}
```

- [ ] **Step 3: Update `pairedSplit.ts` to import it instead of defining it locally**

In `extensions/null-cpp/src/pairedSplit.ts`, change:
```ts
import * as vscode from 'vscode';
import { isCppDocument } from './cppLanguage';
import { switchSourceHeader } from './clangdBridge';
import { findEnclosing, findByQualifiedName, invalidate } from './symbolCache';
import { PairRegistry } from './pairRegistry';
import { isEnabled } from './projectDetection';

const SCROLL_SYNC_DEBOUNCE_MS = 120;

function getConfig<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('null-cpp').get<T>(key, fallback);
}

function findVisibleEditor(uriString: string): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uriString);
}

function closeTab(uriString: string): void {
```
to:
```ts
import * as vscode from 'vscode';
import { isCppDocument } from './cppLanguage';
import { switchSourceHeader } from './clangdBridge';
import { findEnclosing, findByQualifiedName, invalidate } from './symbolCache';
import { PairRegistry } from './pairRegistry';
import { isEnabled } from './projectDetection';
import { findVisibleEditor } from './editorLookup';

const SCROLL_SYNC_DEBOUNCE_MS = 120;

function getConfig<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('null-cpp').get<T>(key, fallback);
}

function closeTab(uriString: string): void {
```

- [ ] **Step 4: Compile and run the full test suite to verify nothing broke**

Run: `cd extensions/null-cpp && npm test`
Expected: PASS — `tsc` reports no errors (no duplicate/unused `findVisibleEditor` definition), all 19 `node --test` cases still pass.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-cpp/src/editorLookup.ts extensions/null-cpp/src/pairedSplit.ts extensions/null-cpp/tsconfig.json
git commit -m "refactor(null-cpp): extract findVisibleEditor into a shared module"
```

---

### Task 2: Alt+O targets the counterpart's existing split

**Files:**
- Modify: `extensions/null-cpp/src/symbolSwitch.ts`

**Interfaces:**
- Consumes: `findVisibleEditor` from `./editorLookup` (Task 1).
- Produces: nothing new — `registerSwitchSourceHeader`'s signature is unchanged.

- [ ] **Step 1: Look up the counterpart's existing column and target it, or open Beside if not visible**

In `extensions/null-cpp/src/symbolSwitch.ts`, change:
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

      const enclosing = await findEnclosing(editor.document, editor.selection.active);
      const result = await switchSourceHeader(editor.document.uri);
      if (result.kind !== 'switched') {
        return;
      }

      const counterpartDoc = await vscode.workspace.openTextDocument(result.uri);
      const counterpartEditor = await vscode.window.showTextDocument(counterpartDoc);
```
to:
```ts
import * as vscode from 'vscode';
import { isCppDocument } from './cppLanguage';
import { switchSourceHeader } from './clangdBridge';
import { findEnclosing, findByQualifiedName } from './symbolCache';
import { isEnabled } from './projectDetection';
import { findVisibleEditor } from './editorLookup';

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

      const enclosing = await findEnclosing(editor.document, editor.selection.active);
      const result = await switchSourceHeader(editor.document.uri);
      if (result.kind !== 'switched') {
        return;
      }

      const existingEditor = findVisibleEditor(result.uri.toString());
      const counterpartDoc = await vscode.workspace.openTextDocument(result.uri);
      const counterpartEditor = await vscode.window.showTextDocument(counterpartDoc, {
        viewColumn: existingEditor ? existingEditor.viewColumn : vscode.ViewColumn.Beside,
      });
```

- [ ] **Step 2: Compile and run the full test suite to verify nothing broke**

Run: `cd extensions/null-cpp && npm test`
Expected: PASS — `tsc` reports no errors, all 19 `node --test` cases still pass.

- [ ] **Step 3: Commit**

```bash
git add extensions/null-cpp/src/symbolSwitch.ts
git commit -m "fix(null-cpp): Alt+O targets the counterpart's existing split pane"
```

---

### Task 3: Deterministic scaffold layout

**Files:**
- Modify: `extensions/null-cpp/src/scaffold.ts`

**Interfaces:**
- Consumes: nothing new from earlier tasks (reads `null-cpp.autoPairSplit.enabled` directly via `vscode.workspace.getConfiguration`, same pattern `pairedSplit.ts` already uses).
- Produces: nothing new — `registerNewClass`'s signature is unchanged.

- [ ] **Step 1: Open cpp on the left, hpp on the right (focused), when auto-pair-split is enabled**

In `extensions/null-cpp/src/scaffold.ts`, change:
```ts
      await vscode.workspace.fs.writeFile(headerUri, Buffer.from(headerContent(), 'utf8'));
      await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(sourceContent(name), 'utf8'));

      const headerDoc = await vscode.workspace.openTextDocument(headerUri);
      await vscode.window.showTextDocument(headerDoc);
    })
  );
}
```
to:
```ts
      await vscode.workspace.fs.writeFile(headerUri, Buffer.from(headerContent(), 'utf8'));
      await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(sourceContent(name), 'utf8'));

      const autoPairSplit = vscode.workspace
        .getConfiguration('null-cpp')
        .get<boolean>('autoPairSplit.enabled', true);

      if (autoPairSplit) {
        const sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        await vscode.window.showTextDocument(sourceDoc, {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: true,
          preview: false,
        });
        const headerDoc = await vscode.workspace.openTextDocument(headerUri);
        await vscode.window.showTextDocument(headerDoc, { viewColumn: vscode.ViewColumn.Two });
      } else {
        const headerDoc = await vscode.workspace.openTextDocument(headerUri);
        await vscode.window.showTextDocument(headerDoc);
      }
    })
  );
}
```

- [ ] **Step 2: Compile and run the full test suite to verify nothing broke**

Run: `cd extensions/null-cpp && npm test`
Expected: PASS — `tsc` reports no errors, all 19 `node --test` cases still pass.

- [ ] **Step 3: Commit**

```bash
git add extensions/null-cpp/src/scaffold.ts
git commit -m "fix(null-cpp): scaffold cpp/hpp into a deterministic left/right layout"
```

---

### Task 4: Manual end-to-end verification

**Files:** None — this task changes no code; it confirms both fixes work in a real build.

This isn't unit-testable: it depends on real editor layout/focus state in a running extension host.

- [ ] **Step 1: Sync the build**

Run `copy.ps1` and restart Null IDE.

- [ ] **Step 2: Verify Alt+O targets an existing split**

Open a `.cpp` whose `.hpp` auto-opens beside it. Move focus back to the `.cpp`, place the cursor inside a method body, and press Alt+O. Confirm it reveals the matching declaration in the *existing* `.hpp` pane rather than opening a duplicate copy in the current column.

- [ ] **Step 3: Verify Alt+O opens Beside when no split exists**

Close the `.hpp` pane (or disable `autoPairSplit.enabled` temporarily and reopen the `.cpp` alone). Press Alt+O. Confirm the `.hpp` opens in a new column beside the current one, not in the same column.

- [ ] **Step 4: Verify deterministic scaffold layout**

With `autoPairSplit.enabled` at its default (`true`), open and focus some unrelated file, then run "New C++ Class...". Confirm the new `.cpp` lands in the left column, `.hpp` in the right column, with `.hpp` focused — regardless of what was open/focused beforehand. Repeat starting from a different prior layout (e.g. two columns already open) and confirm the result is the same.

- [ ] **Step 5: Verify the opt-out**

Set `autoPairSplit.enabled` to `false` and run "New C++ Class..." again. Confirm only the header opens, in the active column, with no forced two-column layout.

No commit for this task — it's a verification pass, not a code change. If any step fails, return to the relevant task above, fix it, and re-run `npm test` before re-verifying end to end.

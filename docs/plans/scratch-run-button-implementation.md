# Run Button for Scratch Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Add a ▶ "Run" button to the editor title bar that executes the currently-open Scratch File (`.py`/`.js`/`.ts` only) in a reused "Scratch" integrated terminal, per `docs/specs/scratch-run-button-design.md`.

**Architecture:** A pure `buildScratchRunCommand(filePath)` helper (unit-tested) maps file extension to an interpreter command string. `scratchNotesIntegration.ts` tracks a custom context key `null.canRunScratchFile` via `vscode.window.onDidChangeActiveTextEditor`, mirroring the existing `null.viewingProposedDiff` pattern in `extension.ts:1417-1426`. The `null.runScratchFile` command saves the active document if dirty, then sends the built command to a reused terminal.

**Tech Stack:** TypeScript (`strict`, ES2022, CommonJS), VS Code Extension API 1.85+, `node:test` for unit tests.

## Global Constraints

- Runnable extensions: `.py` → `python "<file>"`, `.js` → `node "<file>"`, `.ts` → `npx "ts-node" "<file>"` (per spec's Behavior section — fixed table, no config).
- Button is hidden (not disabled) for non-runnable files and when no workspace is open (per spec Non-goals / Behavior).
- No keybinding, no Notes support, no configurable interpreter overrides (per spec Non-goals).
- Auto-save the active document before running if it's dirty (per spec Behavior, step 1).
- Reuse a terminal named exactly `"Scratch"` if one already exists; otherwise create it (per spec Behavior, step 3).

---

### Task 1: Runner mapping and `buildScratchRunCommand`

**Files:**
- Modify: `extensions/null-tools/src/scratchNotesStorage.ts`
- Modify: `extensions/null-tools/src/scratchNotesStorage.test.ts`

**Interfaces:**
- Produces (consumed by Task 2):
  - `interface ScratchRunner { command: string; args: (filePath: string) => string[] }`
  - `const SCRATCH_RUNNERS: Record<string, ScratchRunner>`
  - `function buildScratchRunCommand(filePath: string): string | undefined`

- [ ] **Step 1: Write the failing tests**

Append to `extensions/null-tools/src/scratchNotesStorage.test.ts` (add this import to the existing `import { ... } from './scratchNotesStorage';` block: `buildScratchRunCommand`), then add these test cases at the end of the file:
```typescript
test('buildScratchRunCommand maps .py to a quoted python invocation', () => {
  assert.equal(
    buildScratchRunCommand('C:\\ws\\.null\\scratch\\scratch-1.py'),
    'python "C:\\ws\\.null\\scratch\\scratch-1.py"',
  );
});

test('buildScratchRunCommand maps .js to a quoted node invocation', () => {
  assert.equal(
    buildScratchRunCommand('C:\\ws\\.null\\scratch\\scratch-1.js'),
    'node "C:\\ws\\.null\\scratch\\scratch-1.js"',
  );
});

test('buildScratchRunCommand maps .ts to a quoted npx ts-node invocation', () => {
  assert.equal(
    buildScratchRunCommand('C:\\ws\\.null\\scratch\\scratch-1.ts'),
    'npx "ts-node" "C:\\ws\\.null\\scratch\\scratch-1.ts"',
  );
});

test('buildScratchRunCommand returns undefined for non-runnable extensions', () => {
  assert.equal(buildScratchRunCommand('C:\\ws\\.null\\scratch\\scratch-1.md'), undefined);
  assert.equal(buildScratchRunCommand('C:\\ws\\.null\\scratch\\scratch-1.json'), undefined);
  assert.equal(buildScratchRunCommand('C:\\ws\\.null\\scratch\\scratch-1.txt'), undefined);
  assert.equal(buildScratchRunCommand('C:\\ws\\.null\\scratch\\scratch-1.unknown'), undefined);
});
```

The full updated import line at the top of the test file must read:
```typescript
import {
  getNullDir,
  getScratchDir,
  getNotesDir,
  ensureDir,
  formatTimestamp,
  buildScratchFilename,
  slugify,
  buildNoteFilename,
  deriveNoteLabel,
  ensureGitignoreEntry,
  buildScratchRunCommand,
} from './scratchNotesStorage';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `extensions/null-tools/`): `npm test`
Expected: FAIL — `tsc` reports `Module '"./scratchNotesStorage"' has no exported member 'buildScratchRunCommand'`.

- [ ] **Step 3: Implement the runner mapping**

Add to the end of `extensions/null-tools/src/scratchNotesStorage.ts`:
```typescript
export interface ScratchRunner {
  command: string;
  args: (filePath: string) => string[];
}

export const SCRATCH_RUNNERS: Record<string, ScratchRunner> = {
  '.py': { command: 'python', args: filePath => [filePath] },
  '.js': { command: 'node', args: filePath => [filePath] },
  '.ts': { command: 'npx', args: filePath => ['ts-node', filePath] },
};

export function buildScratchRunCommand(filePath: string): string | undefined {
  const runner = SCRATCH_RUNNERS[path.extname(filePath)];
  if (!runner) { return undefined; }
  const quotedArgs = runner.args(filePath).map(arg => `"${arg}"`);
  return [runner.command, ...quotedArgs].join(' ');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `extensions/null-tools/`): `npm test`
Expected: PASS — 20 tests total (16 existing + 4 new), 0 failures.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/scratchNotesStorage.ts extensions/null-tools/src/scratchNotesStorage.test.ts
git commit -m "feat: add scratch file run command mapping"
```

---

### Task 2: Context key tracking and the run command

**Files:**
- Modify: `extensions/null-tools/src/scratchNotesIntegration.ts`

**Interfaces:**
- Consumes from Task 1: `buildScratchRunCommand(filePath: string): string | undefined` (from `./scratchNotesStorage`).
- Consumes from the original scratch/notes feature: `getScratchDir(workspaceRoot: string): string` (already imported in this file), `getWorkspaceRoot(): string | undefined` (already defined in this file).
- Produces: registers command `null.runScratchFile` and maintains context key `null.canRunScratchFile` (consumed by Task 3's `package.json` `when` clauses).

- [ ] **Step 1: Add the import**

Edit `extensions/null-tools/src/scratchNotesIntegration.ts` — change:
```typescript
import {
  SCRATCH_LANGUAGES,
  getScratchDir,
  getNotesDir,
  ensureDir,
  ensureGitignoreEntry,
  buildScratchFilename,
  buildNoteFilename,
  deriveNoteLabel,
} from './scratchNotesStorage';
```
to:
```typescript
import {
  SCRATCH_LANGUAGES,
  getScratchDir,
  getNotesDir,
  ensureDir,
  ensureGitignoreEntry,
  buildScratchFilename,
  buildNoteFilename,
  deriveNoteLabel,
  buildScratchRunCommand,
} from './scratchNotesStorage';
```

- [ ] **Step 2: Add the runnable-file check**

Edit `extensions/null-tools/src/scratchNotesIntegration.ts` — change:
```typescript
function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}
```
to:
```typescript
function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function isRunnableScratchFile(filePath: string): boolean {
  const root = getWorkspaceRoot();
  if (!root) { return false; }
  const scratchDir = getScratchDir(root);
  return filePath.startsWith(scratchDir + path.sep) && buildScratchRunCommand(filePath) !== undefined;
}
```

- [ ] **Step 3: Add context key tracking and the run command inside `registerScratchAndNotesFeature`**

Edit `extensions/null-tools/src/scratchNotesIntegration.ts` — change the end of `registerScratchAndNotesFeature` (the last `context.subscriptions.push` block) from:
```typescript
  context.subscriptions.push(
    vscode.commands.registerCommand('null.renameScratchOrNoteItem', renameItem),
    vscode.commands.registerCommand('null.deleteScratchOrNoteItem', deleteItem),
    output,
  );
}
```
to:
```typescript
  context.subscriptions.push(
    vscode.commands.registerCommand('null.renameScratchOrNoteItem', renameItem),
    vscode.commands.registerCommand('null.deleteScratchOrNoteItem', deleteItem),
    output,
  );

  const updateRunContext = () => {
    const active = vscode.window.activeTextEditor;
    const runnable = !!active && isRunnableScratchFile(active.document.uri.fsPath);
    vscode.commands.executeCommand('setContext', 'null.canRunScratchFile', runnable);
  };
  updateRunContext();
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateRunContext));

  context.subscriptions.push(vscode.commands.registerCommand('null.runScratchFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }
    const runCommand = buildScratchRunCommand(editor.document.uri.fsPath);
    if (!runCommand) { return; }
    if (editor.document.isDirty) {
      await editor.document.save();
    }
    const terminal = vscode.window.terminals.find(t => t.name === 'Scratch') ?? vscode.window.createTerminal('Scratch');
    terminal.show();
    terminal.sendText(runCommand);
  }));
}
```

- [ ] **Step 4: Compile and run the full test suite**

Run (from `extensions/null-tools/`): `npm run compile && npm test`
Expected: both exit 0; `npm test` reports `# pass 20`, `# fail 0` (unchanged from Task 1 — this task adds no new unit tests, since it's `vscode`-API-dependent glue code, matching how the rest of `scratchNotesIntegration.ts` is verified).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/scratchNotesIntegration.ts
git commit -m "feat: add run command and context key for runnable scratch files"
```

---

### Task 3: package.json contributions

**Files:**
- Modify: `extensions/null-tools/package.json`

**Interfaces:**
- Consumes from Task 2: command id `null.runScratchFile`, context key `null.canRunScratchFile`.

- [ ] **Step 1: Add the command**

Edit `extensions/null-tools/package.json` — change:
```json
      {
        "command": "null.deleteScratchOrNoteItem",
        "title": "Null: Delete Item"
      }
    ],
```
to:
```json
      {
        "command": "null.deleteScratchOrNoteItem",
        "title": "Null: Delete Item"
      },
      {
        "command": "null.runScratchFile",
        "title": "Null: Run Scratch File",
        "icon": "$(play)"
      }
    ],
```

- [ ] **Step 2: Add the editor/title menu entry**

Edit `extensions/null-tools/package.json` — change:
```json
      "editor/title": [
        {
          "command": "null.acceptProposedDiff",
          "when": "null.viewingProposedDiff",
          "group": "navigation"
        },
        {
          "command": "null.rejectProposedDiff",
          "when": "null.viewingProposedDiff",
          "group": "navigation"
        }
      ],
```
to:
```json
      "editor/title": [
        {
          "command": "null.acceptProposedDiff",
          "when": "null.viewingProposedDiff",
          "group": "navigation"
        },
        {
          "command": "null.rejectProposedDiff",
          "when": "null.viewingProposedDiff",
          "group": "navigation"
        },
        {
          "command": "null.runScratchFile",
          "when": "null.canRunScratchFile",
          "group": "navigation"
        }
      ],
```

- [ ] **Step 3: Add the command palette entry**

Edit `extensions/null-tools/package.json` — change:
```json
        { "command": "null.renameScratchOrNoteItem", "when": "false" },
        { "command": "null.deleteScratchOrNoteItem", "when": "false" }
      ]
```
to:
```json
        { "command": "null.renameScratchOrNoteItem", "when": "false" },
        { "command": "null.deleteScratchOrNoteItem", "when": "false" },
        { "command": "null.runScratchFile", "when": "null.canRunScratchFile" }
      ]
```

- [ ] **Step 4: Verify the manifest is valid JSON**

Run (from repo root): `node -e "require('./extensions/null-tools/package.json'); console.log('valid json')"`
Expected: prints `valid json` with no errors.

- [ ] **Step 5: Compile the whole extension**

Run (from `extensions/null-tools/`): `npm run compile`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-tools/package.json
git commit -m "feat: contribute run scratch file command, icon, and menus"
```

---

### Task 4: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Recompile and re-run the full test suite**

Run (from `extensions/null-tools/`): `npm run compile && npm test`
Expected: both exit 0; `npm test` reports `# pass 20`, `# fail 0`.

- [ ] **Step 2: If a VS Code-family CLI is available, smoke-test in an Extension Development Host**

Run: `where code` or `where null`. If found, launch (substituting whichever CLI was found) against a scratch temp folder:
```
null --extensionDevelopmentPath=extensions/null-tools --new-window --disable-workspace-trust <temp-folder>
```
In the new window:
1. Use "Null: New Scratch File" to create a `.py` file — confirm the ▶ icon appears in the editor title bar.
2. Type `print("hello from scratch")`, click ▶ — confirm a "Scratch" terminal opens/reuses and prints `hello from scratch` (requires `python` on `PATH`; if not installed, confirm the terminal shows the shell's own "not recognized"/"not found" error instead of a silent failure).
3. Switch to a `.md` scratch file (or create one) — confirm the ▶ icon disappears.
4. Create a second `.py` scratch file, run it — confirm the same "Scratch" terminal is reused rather than a new one being created.
5. Edit the `.py` file without saving, click ▶ — confirm the file is saved automatically (check the tab's dirty indicator clears) before the command runs.

- [ ] **Step 3: If no CLI is available, do a static review instead**

Re-read `extensions/null-tools/src/scratchNotesIntegration.ts` and the `package.json` diff from Task 3 side by side against `docs/specs/scratch-run-button-design.md`'s Behavior section, confirming every behavior described there has corresponding code. Note in your final summary to the user that live UI behavior is unverified.

- [ ] **Step 4: Report results**

Summarize what was verified (or, if Step 3 was taken, what remains unverified) back to the user.

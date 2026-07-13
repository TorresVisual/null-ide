# Scratch Files & Quick Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Add two workspace-scoped tree views to the `null-tools` extension — Scratch Files and Notes — backed by a shared `.null/` folder, per `docs/specs/scratch-and-notes-design.md`.

**Architecture:** Pure fs/path helpers (`scratchNotesStorage.ts`) are unit-tested in isolation; a small shared `TreeDataProvider` (`scratchNotesTreeView.ts`) renders either folder as a flat, watched tree; `scratchNotesIntegration.ts` wires commands and views together and is registered from `extension.ts`'s `activate()`. `package.json` gains a new activity-bar container, two views, four commands, and matching menus.

**Tech Stack:** TypeScript (`strict`, ES2022, CommonJS), VS Code Extension API 1.85+, `node:test` for unit tests (no test framework dependency, matching the existing `recentProjects.test.ts` convention).

## Global Constraints

- Storage root: `<workspace-root>/.null/`, with `scratch/` and `notes/` subfolders (per spec's Storage layout section).
- `.null/` must be appended to the workspace's `.gitignore` on first use, idempotently, best-effort (never blocks file creation on failure).
- No auto-cleanup/retention policy — deletion is manual only (per spec Non-goals).
- No new user-facing settings in this version (per spec Non-goals).
- Follow existing `null-tools` conventions: flat files under `src/`, `'use strict'` header, `node:test` + `node:assert/strict` for tests, temp-dir-based fs tests cleaned up in `finally` blocks (see `recentProjects.test.ts`).
- Do not run the full Null IDE / VSCodium build locally (CLAUDE.md) — this plan only ever runs `tsc` and `node --test` inside `extensions/null-tools/`, which is normal extension-local development, not the CI build pipeline.

---

### Task 1: Storage helpers module

**Files:**
- Create: `extensions/null-tools/src/scratchNotesStorage.ts`
- Create: `extensions/null-tools/src/scratchNotesStorage.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`
- Modify: `extensions/null-tools/package.json:12` (`"test"` script)

**Interfaces:**
- Produces (consumed by Task 4's `scratchNotesIntegration.ts`):
  - `interface ScratchLanguage { label: string; extension: string }`
  - `const SCRATCH_LANGUAGES: ScratchLanguage[]`
  - `function getNullDir(workspaceRoot: string): string`
  - `function getScratchDir(workspaceRoot: string): string`
  - `function getNotesDir(workspaceRoot: string): string`
  - `function ensureDir(dirPath: string): void`
  - `function formatTimestamp(date: Date): string`
  - `function buildScratchFilename(extension: string, date?: Date): string`
  - `function slugify(title: string): string`
  - `function buildNoteFilename(title: string, existingFilenames: string[]): string`
  - `function deriveNoteLabel(filePath: string, content: string): string`
  - `function ensureGitignoreEntry(workspaceRoot: string): void`

- [ ] **Step 1: Update `tsconfig.json` to compile the new test file**

Edit `extensions/null-tools/tsconfig.json` — change:
```json
  "include": ["src/extension.ts", "src/ollama.ts", "src/recentProjects.test.ts"],
```
to:
```json
  "include": ["src/extension.ts", "src/ollama.ts", "src/recentProjects.test.ts", "src/scratchNotesStorage.test.ts"],
```

- [ ] **Step 2: Update the `test` script to run the new test file**

Edit `extensions/null-tools/package.json` — change:
```json
    "test": "tsc -p tsconfig.json && node --test out/recentProjects.test.js"
```
to:
```json
    "test": "tsc -p tsconfig.json && node --test out/recentProjects.test.js out/scratchNotesStorage.test.js"
```

- [ ] **Step 3: Write the failing test file**

Create `extensions/null-tools/src/scratchNotesStorage.test.ts`:
```typescript
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
} from './scratchNotesStorage';

test('getScratchDir and getNotesDir nest under .null inside the workspace root', () => {
  const root = 'C:\\Projects\\Foo';
  assert.equal(getNullDir(root), path.join(root, '.null'));
  assert.equal(getScratchDir(root), path.join(root, '.null', 'scratch'));
  assert.equal(getNotesDir(root), path.join(root, '.null', 'notes'));
});

test('formatTimestamp zero-pads month/day/hour/minute/second', () => {
  const date = new Date(2026, 0, 5, 9, 3, 7); // Jan 5 2026, 09:03:07
  assert.equal(formatTimestamp(date), '20260105-090307');
});

test('buildScratchFilename combines the scratch prefix, timestamp, and extension', () => {
  const date = new Date(2026, 0, 5, 9, 3, 7);
  assert.equal(buildScratchFilename('.ts', date), 'scratch-20260105-090307.ts');
});

test('slugify lowercases, hyphenates, and trims non-alphanumeric runs', () => {
  assert.equal(slugify('Meeting Notes: Q3 Plan!'), 'meeting-notes-q3-plan');
  assert.equal(slugify('  leading/trailing  '), 'leading-trailing');
});

test('slugify falls back to "note" when nothing alphanumeric remains', () => {
  assert.equal(slugify('***'), 'note');
});

test('buildNoteFilename appends -2, -3, ... on collision', () => {
  assert.equal(buildNoteFilename('Ideas', []), 'ideas.md');
  assert.equal(buildNoteFilename('Ideas', ['ideas.md']), 'ideas-2.md');
  assert.equal(buildNoteFilename('Ideas', ['ideas.md', 'ideas-2.md']), 'ideas-3.md');
});

test('deriveNoteLabel prefers the first markdown heading', () => {
  assert.equal(
    deriveNoteLabel('C:\\ws\\.null\\notes\\ideas.md', '# Project Ideas\n\nsome text'),
    'Project Ideas',
  );
});

test('deriveNoteLabel falls back to the filename when there is no heading', () => {
  assert.equal(deriveNoteLabel('C:\\ws\\.null\\notes\\ideas.md', 'no heading here'), 'ideas');
});

test('ensureDir creates nested directories', () => {
  const base = path.join(os.tmpdir(), `null-scratch-ensuredir-${process.pid}`);
  const dir = path.join(base, 'a', 'b');
  try {
    ensureDir(dir);
    assert.equal(fs.existsSync(dir), true);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('ensureGitignoreEntry appends .null/ to a missing .gitignore', () => {
  const root = path.join(os.tmpdir(), `null-gitignore-missing-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  try {
    ensureGitignoreEntry(root);
    const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    assert.equal(content, '.null/\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureGitignoreEntry appends to an existing .gitignore without a trailing newline', () => {
  const root = path.join(os.tmpdir(), `null-gitignore-existing-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/');
    ensureGitignoreEntry(root);
    const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    assert.equal(content, 'node_modules/\n.null/\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureGitignoreEntry is idempotent', () => {
  const root = path.join(os.tmpdir(), `null-gitignore-idempotent-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  try {
    ensureGitignoreEntry(root);
    ensureGitignoreEntry(root);
    const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    assert.equal(content, '.null/\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run (from `extensions/null-tools/`): `npm test`
Expected: FAIL — `tsc` reports `Cannot find module './scratchNotesStorage'` (the module doesn't exist yet).

- [ ] **Step 5: Write the implementation**

Create `extensions/null-tools/src/scratchNotesStorage.ts`:
```typescript
'use strict';

import * as fs from 'fs';
import * as path from 'path';

export interface ScratchLanguage {
  label: string;
  extension: string;
}

export const SCRATCH_LANGUAGES: ScratchLanguage[] = [
  { label: 'JavaScript', extension: '.js' },
  { label: 'TypeScript', extension: '.ts' },
  { label: 'Python', extension: '.py' },
  { label: 'Markdown', extension: '.md' },
  { label: 'JSON', extension: '.json' },
  { label: 'Plain Text', extension: '.txt' },
];

export function getNullDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.null');
}

export function getScratchDir(workspaceRoot: string): string {
  return path.join(getNullDir(workspaceRoot), 'scratch');
}

export function getNotesDir(workspaceRoot: string): string {
  return path.join(getNullDir(workspaceRoot), 'notes');
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export function formatTimestamp(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function buildScratchFilename(extension: string, date: Date = new Date()): string {
  return `scratch-${formatTimestamp(date)}${extension}`;
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'note';
}

export function buildNoteFilename(title: string, existingFilenames: string[]): string {
  const base = slugify(title);
  const existing = new Set(existingFilenames);
  let candidate = `${base}.md`;
  let n = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-${n}.md`;
    n++;
  }
  return candidate;
}

export function deriveNoteLabel(filePath: string, content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) { return match[1].trim(); }
  return path.basename(filePath, '.md');
}

export function ensureGitignoreEntry(workspaceRoot: string): void {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  let content: string;
  try {
    content = fs.readFileSync(gitignorePath, 'utf8');
  } catch {
    content = '';
  }
  const alreadyPresent = content.split(/\r?\n/).some(line => line.trim() === '.null/');
  if (alreadyPresent) { return; }
  const needsLeadingNewline = content.length > 0 && !content.endsWith('\n');
  fs.writeFileSync(gitignorePath, `${content}${needsLeadingNewline ? '\n' : ''}.null/\n`);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run (from `extensions/null-tools/`): `npm test`
Expected: PASS — all `scratchNotesStorage.test.js` cases pass alongside the existing `recentProjects.test.js` cases.

- [ ] **Step 7: Commit**

```bash
git add extensions/null-tools/src/scratchNotesStorage.ts extensions/null-tools/src/scratchNotesStorage.test.ts extensions/null-tools/tsconfig.json extensions/null-tools/package.json
git commit -m "feat: add scratch/notes storage helpers with unit tests"
```

---

### Task 2: Shared folder tree view provider

**Files:**
- Create: `extensions/null-tools/src/scratchNotesTreeView.ts`

**Interfaces:**
- Consumes: nothing from Task 1 directly (takes a plain folder path string and a label resolver callback).
- Produces (consumed by Task 4):
  - `type FolderTreeLabelResolver = (filePath: string) => string`
  - `class FolderTreeProvider implements vscode.TreeDataProvider<string>` with constructor `(folderPath: string | undefined, resolveLabel: FolderTreeLabelResolver)`, method `watch(): vscode.Disposable`, and method `refresh(): void`.
  - Tree items it emits have `contextValue = 'nullFolderItem'` — Task 3's menu `when` clauses depend on this exact string.

There's no `vscode`-API test harness in this repo (the existing `recentProjectsIntegration.ts`, which also depends on the `vscode` module, has no unit test either — it's covered by `tsc` type-checking plus manual verification in Task 5). This task follows the same pattern.

- [ ] **Step 1: Write the implementation**

Create `extensions/null-tools/src/scratchNotesTreeView.ts`:
```typescript
'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type FolderTreeLabelResolver = (filePath: string) => string;

export class FolderTreeProvider implements vscode.TreeDataProvider<string> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly folderPath: string | undefined,
    private readonly resolveLabel: FolderTreeLabelResolver,
  ) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  watch(): vscode.Disposable {
    const folderPath = this.folderPath;
    if (!folderPath) {
      return new vscode.Disposable(() => { /* no folder to watch */ });
    }
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folderPath, '*'),
    );
    watcher.onDidCreate(() => this.refresh());
    watcher.onDidDelete(() => this.refresh());
    watcher.onDidChange(() => this.refresh());
    return watcher;
  }

  getTreeItem(filePath: string): vscode.TreeItem {
    const item = new vscode.TreeItem(this.resolveLabel(filePath), vscode.TreeItemCollapsibleState.None);
    item.resourceUri = vscode.Uri.file(filePath);
    item.contextValue = 'nullFolderItem';
    item.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [vscode.Uri.file(filePath)],
    };
    return item;
  }

  getChildren(): string[] {
    const folderPath = this.folderPath;
    if (!folderPath || !fs.existsSync(folderPath)) { return []; }
    return fs.readdirSync(folderPath)
      .map(name => path.join(folderPath, name))
      .filter(p => fs.statSync(p).isFile())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run (from `extensions/null-tools/`): `npx tsc -p tsconfig.json --noEmit`
Expected: no errors. (This file isn't referenced by `extension.ts` yet, so `tsc` won't pull it into the `include` graph — this step only catches syntax errors by compiling it standalone: `npx tsc --noEmit --strict --target ES2022 --module commonjs --skipLibCheck src/scratchNotesTreeView.ts`, run from `extensions/null-tools/`.)
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/null-tools/src/scratchNotesTreeView.ts
git commit -m "feat: add shared folder tree view provider for scratch/notes"
```

---

### Task 3: Activity bar icon + package.json contributions

**Files:**
- Create: `extensions/null-tools/media/workspace.svg`
- Modify: `extensions/null-tools/package.json`

**Interfaces:**
- Produces (consumed by Task 4's registration code): view ids `null.scratchView`, `null.notesView`; command ids `null.newScratchFile`, `null.newNote`, `null.renameScratchOrNoteItem`, `null.deleteScratchOrNoteItem`; tree item `contextValue` convention `nullFolderItem` (already fixed by Task 2 — menus below match it).

- [ ] **Step 1: Add the activity bar icon**

Create `extensions/null-tools/media/workspace.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="1.5" width="10" height="13" rx="1"/>
  <line x1="5.5" y1="5" x2="10.5" y2="5"/>
  <line x1="5.5" y1="8" x2="10.5" y2="8"/>
  <line x1="5.5" y1="11" x2="8.5" y2="11"/>
</svg>
```

- [ ] **Step 2: Add the four new commands**

Edit `extensions/null-tools/package.json` — change:
```json
      {
        "command": "null.rejectProposedDiff",
        "title": "Reject Changes",
        "icon": "$(discard)"
      }
    ],
```
to:
```json
      {
        "command": "null.rejectProposedDiff",
        "title": "Reject Changes",
        "icon": "$(discard)"
      },
      {
        "command": "null.newScratchFile",
        "title": "Null: New Scratch File",
        "icon": "$(new-file)"
      },
      {
        "command": "null.newNote",
        "title": "Null: New Note",
        "icon": "$(new-file)"
      },
      {
        "command": "null.renameScratchOrNoteItem",
        "title": "Null: Rename Item"
      },
      {
        "command": "null.deleteScratchOrNoteItem",
        "title": "Null: Delete Item"
      }
    ],
```

- [ ] **Step 3: Add the activity bar container**

Edit `extensions/null-tools/package.json` — change:
```json
    "viewsContainers": {
      "secondarySidebar": [
        {
          "id": "null-agents",
          "title": "AI Agents",
          "icon": "media/null.svg"
        }
      ]
    },
```
to:
```json
    "viewsContainers": {
      "activitybar": [
        {
          "id": "null-workspace",
          "title": "Null Workspace",
          "icon": "media/workspace.svg"
        }
      ],
      "secondarySidebar": [
        {
          "id": "null-agents",
          "title": "AI Agents",
          "icon": "media/null.svg"
        }
      ]
    },
```

- [ ] **Step 4: Add the two tree views**

Edit `extensions/null-tools/package.json` — change:
```json
    "views": {
      "null-agents": [
        {
          "type": "webview",
          "id": "null.agentsView",
          "name": "Claude Code",
          "visibility": "visible"
        }
      ]
    },
```
to:
```json
    "views": {
      "null-agents": [
        {
          "type": "webview",
          "id": "null.agentsView",
          "name": "Claude Code",
          "visibility": "visible"
        }
      ],
      "null-workspace": [
        {
          "id": "null.scratchView",
          "name": "Scratch Files"
        },
        {
          "id": "null.notesView",
          "name": "Notes"
        }
      ]
    },
```

- [ ] **Step 5: Add view/title and view/item/context menus**

Edit `extensions/null-tools/package.json` — change:
```json
      "view/title": [
        {
          "command": "null.injectContext",
          "when": "view == null.agentsView",
          "group": "navigation@1"
        },
        {
          "command": "null.insertPromptTemplate",
          "when": "view == null.agentsView",
          "group": "navigation@2"
        },
        {
          "command": "null.ollamaModel",
          "when": "view == null.agentsView",
          "group": "navigation@3"
        }
      ],
```
to:
```json
      "view/title": [
        {
          "command": "null.injectContext",
          "when": "view == null.agentsView",
          "group": "navigation@1"
        },
        {
          "command": "null.insertPromptTemplate",
          "when": "view == null.agentsView",
          "group": "navigation@2"
        },
        {
          "command": "null.ollamaModel",
          "when": "view == null.agentsView",
          "group": "navigation@3"
        },
        {
          "command": "null.newScratchFile",
          "when": "view == null.scratchView",
          "group": "navigation"
        },
        {
          "command": "null.newNote",
          "when": "view == null.notesView",
          "group": "navigation"
        }
      ],
      "view/item/context": [
        {
          "command": "null.renameScratchOrNoteItem",
          "when": "view == null.scratchView && viewItem == nullFolderItem",
          "group": "inline@1"
        },
        {
          "command": "null.renameScratchOrNoteItem",
          "when": "view == null.notesView && viewItem == nullFolderItem",
          "group": "inline@1"
        },
        {
          "command": "null.deleteScratchOrNoteItem",
          "when": "view == null.scratchView && viewItem == nullFolderItem",
          "group": "inline@2"
        },
        {
          "command": "null.deleteScratchOrNoteItem",
          "when": "view == null.notesView && viewItem == nullFolderItem",
          "group": "inline@2"
        }
      ],
```

- [ ] **Step 6: Add command palette entries**

Edit `extensions/null-tools/package.json` — change:
```json
      "commandPalette": [
        { "command": "null.checkForUpdates" },
        { "command": "null.installUpdate", "when": "nullUpdateAvailable" },
        { "command": "null.agentsPaste" },
        { "command": "null.clearWebviewCache" },
        { "command": "null.showWelcome" },
        { "command": "null.toggleSoundDesign" },
        { "command": "null.ollamaModel" },
        { "command": "null.ollamaChat" },
        { "command": "null.ollamaReview" },
        { "command": "null.insertPromptTemplate" },
        { "command": "null.injectContext" }
      ]
```
to:
```json
      "commandPalette": [
        { "command": "null.checkForUpdates" },
        { "command": "null.installUpdate", "when": "nullUpdateAvailable" },
        { "command": "null.agentsPaste" },
        { "command": "null.clearWebviewCache" },
        { "command": "null.showWelcome" },
        { "command": "null.toggleSoundDesign" },
        { "command": "null.ollamaModel" },
        { "command": "null.ollamaChat" },
        { "command": "null.ollamaReview" },
        { "command": "null.insertPromptTemplate" },
        { "command": "null.injectContext" },
        { "command": "null.newScratchFile" },
        { "command": "null.newNote" },
        { "command": "null.renameScratchOrNoteItem", "when": "false" },
        { "command": "null.deleteScratchOrNoteItem", "when": "false" }
      ]
```

- [ ] **Step 7: Verify the manifest is valid JSON**

Run (from repo root): `node -e "require('./extensions/null-tools/package.json'); console.log('valid json')"`
Expected: prints `valid json` with no errors.

- [ ] **Step 8: Commit**

```bash
git add extensions/null-tools/media/workspace.svg extensions/null-tools/package.json
git commit -m "feat: contribute Null Workspace activity bar container, views, and commands"
```

---

### Task 4: Command and view registration

**Files:**
- Create: `extensions/null-tools/src/scratchNotesIntegration.ts`
- Modify: `extensions/null-tools/src/extension.ts:11` (import) and `extensions/null-tools/src/extension.ts:1305` (activation call)

**Interfaces:**
- Consumes from Task 1: `SCRATCH_LANGUAGES`, `getScratchDir`, `getNotesDir`, `ensureDir`, `ensureGitignoreEntry`, `buildScratchFilename`, `buildNoteFilename`, `deriveNoteLabel` (all from `./scratchNotesStorage`).
- Consumes from Task 2: `FolderTreeProvider` (from `./scratchNotesTreeView`).
- Consumes from Task 3: view ids `null.scratchView` / `null.notesView`, command ids `null.newScratchFile` / `null.newNote` / `null.renameScratchOrNoteItem` / `null.deleteScratchOrNoteItem`.
- Produces: `function registerScratchAndNotesFeature(context: vscode.ExtensionContext): void`.

- [ ] **Step 1: Write the implementation**

Create `extensions/null-tools/src/scratchNotesIntegration.ts`:
```typescript
'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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
import { FolderTreeProvider } from './scratchNotesTreeView';

const output = vscode.window.createOutputChannel('Null Scratch & Notes');

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function tryEnsureGitignoreEntry(root: string): void {
  try {
    ensureGitignoreEntry(root);
  } catch (err) {
    output.appendLine(`Could not update .gitignore: ${(err as Error).message}`);
  }
}

function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function renameItem(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  const oldName = path.basename(filePath);
  const newName = await vscode.window.showInputBox({ prompt: 'New file name', value: oldName });
  if (!newName || newName === oldName) { return; }
  fs.renameSync(filePath, path.join(dir, newName));
}

async function deleteItem(filePath: string): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
    `Delete "${path.basename(filePath)}"?`,
    { modal: true },
    'Delete',
  );
  if (confirmed !== 'Delete') { return; }
  fs.unlinkSync(filePath);
}

export function registerScratchAndNotesFeature(context: vscode.ExtensionContext): void {
  const workspaceRoot = getWorkspaceRoot();

  const scratchProvider = new FolderTreeProvider(
    workspaceRoot ? getScratchDir(workspaceRoot) : undefined,
    filePath => path.basename(filePath),
  );
  const notesProvider = new FolderTreeProvider(
    workspaceRoot ? getNotesDir(workspaceRoot) : undefined,
    filePath => deriveNoteLabel(filePath, readFileSafe(filePath)),
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('null.scratchView', scratchProvider),
    vscode.window.registerTreeDataProvider('null.notesView', notesProvider),
    scratchProvider.watch(),
    notesProvider.watch(),
  );

  context.subscriptions.push(vscode.commands.registerCommand('null.newScratchFile', async () => {
    const root = getWorkspaceRoot();
    if (!root) {
      vscode.window.showErrorMessage('Open a folder to create scratch files.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      SCRATCH_LANGUAGES.map(lang => ({ label: lang.label, lang })),
      { placeHolder: 'Select a language for the new scratch file' },
    );
    if (!picked) { return; }

    const scratchDir = getScratchDir(root);
    let filePath: string;
    try {
      ensureDir(scratchDir);
      filePath = path.join(scratchDir, buildScratchFilename(picked.lang.extension));
      fs.writeFileSync(filePath, '');
    } catch (err) {
      vscode.window.showErrorMessage(`Could not create scratch file: ${(err as Error).message}`);
      return;
    }
    tryEnsureGitignoreEntry(root);
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('null.newNote', async () => {
    const root = getWorkspaceRoot();
    if (!root) {
      vscode.window.showErrorMessage('Open a folder to create notes.');
      return;
    }
    const title = await vscode.window.showInputBox({ prompt: 'Note title' });
    if (!title) { return; }

    const notesDir = getNotesDir(root);
    let filePath: string;
    try {
      ensureDir(notesDir);
      const existing = fs.readdirSync(notesDir);
      filePath = path.join(notesDir, buildNoteFilename(title, existing));
      fs.writeFileSync(filePath, `# ${title}\n\n`);
    } catch (err) {
      vscode.window.showErrorMessage(`Could not create note: ${(err as Error).message}`);
      return;
    }
    tryEnsureGitignoreEntry(root);
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
  }));

  context.subscriptions.push(
    vscode.commands.registerCommand('null.renameScratchOrNoteItem', renameItem),
    vscode.commands.registerCommand('null.deleteScratchOrNoteItem', deleteItem),
    output,
  );
}
```

- [ ] **Step 2: Wire the import into `extension.ts`**

Edit `extensions/null-tools/src/extension.ts` — change:
```typescript
import { registerRecentProjectsUriHandler } from './recentProjectsIntegration';
```
to:
```typescript
import { registerRecentProjectsUriHandler } from './recentProjectsIntegration';
import { registerScratchAndNotesFeature } from './scratchNotesIntegration';
```

- [ ] **Step 3: Wire the activation call into `extension.ts`**

Edit `extensions/null-tools/src/extension.ts` — change:
```typescript
  registerRecentProjectsUriHandler(context);
```
to:
```typescript
  registerRecentProjectsUriHandler(context);
  registerScratchAndNotesFeature(context);
```

- [ ] **Step 4: Compile the whole extension and verify no type errors**

Run (from `extensions/null-tools/`): `npm run compile`
Expected: exits 0, no TypeScript errors. This pulls in `scratchNotesIntegration.ts`, `scratchNotesStorage.ts`, and `scratchNotesTreeView.ts` transitively through `extension.ts`'s import graph (matching how `recentProjectsIntegration.ts` and `recentProjects.ts` are compiled today without being listed explicitly in `tsconfig.json`'s `include`).

- [ ] **Step 5: Run the full test suite**

Run (from `extensions/null-tools/`): `npm test`
Expected: PASS — same output as Task 1's Step 6, unaffected by this task's changes (no new tests added here).

- [ ] **Step 6: Commit**

```bash
git add extensions/null-tools/src/scratchNotesIntegration.ts extensions/null-tools/src/extension.ts
git commit -m "feat: register scratch files and notes commands and views"
```

---

### Task 5: Manual verification

**Files:** none (verification only).

This project's build (the full VSCodium/Null IDE package) only runs in GitHub Actions — do not invoke `npx gulp` or any release script locally. But `null-tools` is an ordinary VS Code extension, so it can be smoke-tested in any VS Code-family editor's Extension Development Host without touching the release pipeline.

- [ ] **Step 1: Check whether a VS Code-family CLI is available**

Run: `where code` (or `where null` if a separately-installed Null IDE build is on `PATH`)
Expected: prints a path, or `INFO: Could not find files` if neither is installed.

- [ ] **Step 2a: If a CLI is available, launch the Extension Development Host**

Run (from repo root), substituting `code` for `null` if that's what Step 1 found: `code --extensionDevelopmentPath=extensions/null-tools --new-window "$env:TEMP"` (PowerShell) — opens a scratch folder with `null-tools` loaded from source, unaffected by whatever version is normally installed.

In the new window:
1. Confirm a new "Null Workspace" icon appears in the activity bar, with **Scratch Files** and **Notes** views.
2. Click the `+` on **Scratch Files**, pick "TypeScript" — confirm `.null/scratch/scratch-<timestamp>.ts` opens in an editor tab and appears in the tree.
3. Click the `+` on **Notes**, type a title with mixed case and punctuation (e.g. `My Ideas!`) — confirm `.null/notes/my-ideas.md` opens, seeded with `# My Ideas!`, and the tree shows "My Ideas!" as the label.
4. Create a second note with the same title — confirm it's saved as `my-ideas-2.md` and both appear in the tree.
5. Right-click a scratch file → **Rename** and → **Delete** (confirm the modal prompt) — confirm the tree updates live via the file watcher without a manual refresh.
6. Open the temp folder's `.gitignore` — confirm it contains exactly one `.null/` line.

- [ ] **Step 2b: If no CLI is available, skip to a static review**

Re-read `extensions/null-tools/src/scratchNotesIntegration.ts`, `scratchNotesTreeView.ts`, and the `package.json` diff from Task 3 side by side against `docs/specs/scratch-and-notes-design.md`'s Scratch Files / Notes / Shared plumbing sections, confirming every behavior described there has corresponding code. Note in your final summary to the user that live UI behavior is unverified and recommend they smoke-test after their next Null IDE build.

- [ ] **Step 3: Report results**

Summarize what was verified (or, if Step 2b was taken, what remains unverified) back to the user.

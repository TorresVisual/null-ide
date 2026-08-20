# Null Actions Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Build `null-actions`, a new built-in extension providing status-bar action buttons (shell commands or VS Code API commands) that replaces the third-party `vscode-action-buttons` extension, with a settings webview instead of hand-written JSON, deterministic per-button terminal identity (fixing the reload-duplicates-terminals bug), and context-adaptive visibility.

**Architecture:** Pure, unit-tested logic modules (`buttonConfig`, `variableResolver`, `whenClause`, `terminalRegistry`, `projectDetector`, `npmScriptsProvider`) with zero `vscode` import, wrapped by thin `vscode`-integration modules (`buttonConfigIntegration`, `terminalHostIntegration`, `statusBarController`, `runButton`, `settingsPanel`) that adapt them to the live extension host. This mirrors the existing `*Storage.ts` (pure) / `*.ts` (vscode-wired) split already used by `autoGitignore`/`scratchNotes` in `null-tools`, and is what makes the terminal-duplication bug fix (`terminalRegistry.ts`) actually testable without a running Extension Host.

**Tech Stack:** TypeScript (strict), VS Code Extension API ^1.85.0, `node --test` for unit tests, vanilla-JS webview (no framework, matching the existing Welcome-page pattern in `null-tools`).

**Spec:** `docs/specs/null-actions-design.md`

## Global Constraints

- Extension lives at `extensions/null-actions/`, publisher `null`, `engines.vscode: "^1.85.0"`, `main: "./out/extension.js"`, `activationEvents: ["onStartupFinished"]` — matches `null-cpp`/`wooting-analog` conventions exactly.
- `tsconfig.json`: `target: ES2022`, `module: commonjs`, `strict: true`, `outDir: ./out`, `rootDir: ./src` — copy verbatim from `extensions/null-cpp/tsconfig.json`.
- Every `.ts` source file starts with `'use strict';` on its own line (existing repo convention).
- Pure-logic modules (no side effects, no `vscode` import) get a same-named `.test.ts` using `node:test` + `node:assert`, following `extensions/null-tools/src/autoGitignoreStorage.test.ts`'s style.
- `vscode`-importing modules are not unit tested — verified by compiling and running in a dev Extension Host (no automated UI harness in this repo for webviews or status bar rendering), matching the spec's own Testing section.
- Terminal identity is keyed by button `id`, **never** by command text — this is the direct fix for the reported bug and must not regress in later tasks.
- `devDependencies`: `typescript ^5.8.0`, `@types/vscode ^1.85.0`, `@types/node ^22.0.0` — matches sibling extensions.
- `package.json`'s `scripts.test` and `tsconfig.json`'s `include` array are extended incrementally, one entry per task, as each new source/test file is created — never left referencing nonexistent files mid-task.

---

### Task 1: Extension scaffold + `buttonConfig.ts` (data model, parsing, validation)

**Files:**
- Create: `extensions/null-actions/package.json`
- Create: `extensions/null-actions/tsconfig.json`
- Create: `extensions/null-actions/src/extension.ts` (minimal stub — filled in by Task 11)
- Create: `extensions/null-actions/src/buttonConfig.ts`
- Test: `extensions/null-actions/src/buttonConfig.test.ts`

**Interfaces:**
- Produces: `ActionButtonConfig`, `ButtonType`, `ButtonAlignment`, `ButtonBackground`, `WhenClauseConfig` (types), `parseButtonConfigs(raw: unknown): { buttons: ActionButtonConfig[]; errors: string[] }` — every later task that touches button config imports these from `./buttonConfig`.

- [ ] **Step 1: Create the package scaffold**

`extensions/null-actions/package.json`:
```json
{
  "name": "null-actions",
  "displayName": "Null Actions",
  "description": "Status bar action buttons for Null IDE — run shell commands or VS Code commands with one click",
  "version": "1.0.0",
  "publisher": "null",
  "license": "MIT",
  "engines": { "vscode": "^1.85.0" },
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "scripts": {
    "compile": "tsc -p tsconfig.json",
    "test": "tsc -p tsconfig.json && node --test out/buttonConfig.test.js"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "@types/vscode": "^1.85.0",
    "@types/node": "^22.0.0"
  },
  "contributes": {
    "configuration": {
      "title": "Null Actions",
      "properties": {
        "null-actions.buttons": {
          "type": "array",
          "default": [],
          "description": "Status bar action buttons. Edit via the Action Buttons panel, or directly here.",
          "items": {
            "type": "object",
            "required": ["id", "label", "command"],
            "properties": {
              "id": {
                "type": "string",
                "description": "Stable identifier. Also used as the dedicated terminal's identity — changing it disconnects the button from its existing terminal."
              },
              "label": { "type": "string" },
              "icon": { "type": "string", "description": "Codicon name, without $() wrapper, e.g. \"tools\"." },
              "type": { "type": "string", "enum": ["terminal", "vscode-command"], "default": "terminal" },
              "command": { "type": "string" },
              "args": { "type": "array", "description": "Arguments for type: vscode-command." },
              "color": { "type": "string" },
              "background": { "type": "string", "enum": ["none", "warning", "error"], "default": "none" },
              "tooltip": { "type": "string" },
              "cwd": { "type": "string" },
              "saveAll": { "type": "boolean", "default": false },
              "focus": { "type": "boolean", "default": false },
              "alignment": { "type": "string", "enum": ["left", "right"], "default": "left" },
              "priority": { "type": "number", "default": 0 },
              "when": {
                "type": "object",
                "properties": {
                  "languages": { "type": "array", "items": { "type": "string" } },
                  "filesExist": { "type": "array", "items": { "type": "string" } },
                  "folder": { "type": "string" }
                }
              }
            }
          }
        },
        "null-actions.npm.autoLoad": {
          "type": "boolean",
          "default": false,
          "description": "Automatically show a status bar button for every script in package.json."
        },
        "null-actions.defaultColor": {
          "type": "string",
          "default": "",
          "description": "Default text color applied to buttons that don't set their own color."
        }
      }
    }
  }
}
```

`extensions/null-actions/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./out",
    "rootDir": "./src",
    "strict": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": [
    "src/extension.ts",
    "src/buttonConfig.ts",
    "src/buttonConfig.test.ts"
  ]
}
```

`extensions/null-actions/src/extension.ts`:
```ts
'use strict';

import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  // Wired up incrementally in later tasks.
}

export function deactivate(): void {}
```

- [ ] **Step 2: Write the failing test for `buttonConfig.ts`**

`extensions/null-actions/src/buttonConfig.test.ts`:
```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { parseButtonConfigs } from './buttonConfig';

test('parses a minimal valid button, applying defaults', () => {
  const { buttons, errors } = parseButtonConfigs([
    { id: 'build', label: 'Build', command: 'npm run build' },
  ]);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(buttons.length, 1);
  assert.deepStrictEqual(buttons[0], {
    id: 'build',
    label: 'Build',
    icon: undefined,
    type: 'terminal',
    command: 'npm run build',
    args: undefined,
    color: undefined,
    background: 'none',
    tooltip: undefined,
    cwd: undefined,
    saveAll: false,
    focus: false,
    alignment: 'left',
    priority: 0,
    when: undefined,
  });
});

test('undefined setting (never configured) yields empty buttons and no errors', () => {
  const { buttons, errors } = parseButtonConfigs(undefined);
  assert.deepStrictEqual(buttons, []);
  assert.deepStrictEqual(errors, []);
});

test('non-array value is rejected with a single error', () => {
  const { buttons, errors } = parseButtonConfigs({ not: 'an array' });
  assert.deepStrictEqual(buttons, []);
  assert.strictEqual(errors.length, 1);
});

test('entry missing required fields is skipped with an error, valid entries still parse', () => {
  const { buttons, errors } = parseButtonConfigs([
    { id: 'no-label', command: 'echo hi' },
    { id: 'no-command', label: 'No Command' },
    { label: 'No Id', command: 'echo hi' },
    { id: 'ok', label: 'OK', command: 'echo ok' },
  ]);
  assert.strictEqual(buttons.length, 1);
  assert.strictEqual(buttons[0].id, 'ok');
  assert.strictEqual(errors.length, 3);
});

test('duplicate ids: first wins, second is rejected as an error', () => {
  const { buttons, errors } = parseButtonConfigs([
    { id: 'dup', label: 'First', command: 'echo 1' },
    { id: 'dup', label: 'Second', command: 'echo 2' },
  ]);
  assert.strictEqual(buttons.length, 1);
  assert.strictEqual(buttons[0].label, 'First');
  assert.strictEqual(errors.length, 1);
});

test('invalid enum values fall back to their defaults instead of erroring', () => {
  const { buttons, errors } = parseButtonConfigs([
    { id: 'x', label: 'X', command: 'echo x', type: 'bogus', alignment: 'sideways', background: 'purple' },
  ]);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(buttons[0].type, 'terminal');
  assert.strictEqual(buttons[0].alignment, 'left');
  assert.strictEqual(buttons[0].background, 'none');
});

test('parses a full when clause, filtering non-string array entries', () => {
  const { buttons } = parseButtonConfigs([
    {
      id: 'x', label: 'X', command: 'echo x',
      when: { languages: ['cpp', 42, 'c'], filesExist: ['CMakeLists.txt'], folder: 'backend' },
    },
  ]);
  assert.deepStrictEqual(buttons[0].when, {
    languages: ['cpp', 'c'],
    filesExist: ['CMakeLists.txt'],
    folder: 'backend',
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd extensions/null-actions && npm install && npm run test`
Expected: FAIL — `buttonConfig.ts` doesn't exist yet, `tsc` reports a missing module error.

- [ ] **Step 4: Implement `buttonConfig.ts`**

`extensions/null-actions/src/buttonConfig.ts`:
```ts
'use strict';

export type ButtonType = 'terminal' | 'vscode-command';
export type ButtonAlignment = 'left' | 'right';
export type ButtonBackground = 'none' | 'warning' | 'error';

export interface WhenClauseConfig {
  languages?: string[];
  filesExist?: string[];
  folder?: string;
}

export interface ActionButtonConfig {
  id: string;
  label: string;
  icon?: string;
  type: ButtonType;
  command: string;
  args?: unknown[];
  color?: string;
  background: ButtonBackground;
  tooltip?: string;
  cwd?: string;
  saveAll: boolean;
  focus: boolean;
  alignment: ButtonAlignment;
  priority: number;
  when?: WhenClauseConfig;
}

export interface ParseResult {
  buttons: ActionButtonConfig[];
  errors: string[];
}

const VALID_TYPES: ButtonType[] = ['terminal', 'vscode-command'];
const VALID_ALIGNMENTS: ButtonAlignment[] = ['left', 'right'];
const VALID_BACKGROUNDS: ButtonBackground[] = ['none', 'warning', 'error'];

function parseWhenClause(raw: unknown): WhenClauseConfig | undefined {
  if (typeof raw !== 'object' || raw === null) { return undefined; }
  const w = raw as Record<string, unknown>;
  const languages = Array.isArray(w.languages)
    ? w.languages.filter((x): x is string => typeof x === 'string')
    : undefined;
  const filesExist = Array.isArray(w.filesExist)
    ? w.filesExist.filter((x): x is string => typeof x === 'string')
    : undefined;
  const folder = typeof w.folder === 'string' ? w.folder : undefined;
  if (!languages && !filesExist && !folder) { return undefined; }
  return { languages, filesExist, folder };
}

export function parseButtonConfigs(raw: unknown): ParseResult {
  const buttons: ActionButtonConfig[] = [];
  const errors: string[] = [];

  if (raw === undefined) {
    return { buttons, errors };
  }
  if (!Array.isArray(raw)) {
    return { buttons, errors: ['null-actions.buttons must be an array'] };
  }

  const seenIds = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    const prefix = `null-actions.buttons[${i}]`;

    if (typeof entry !== 'object' || entry === null) {
      errors.push(`${prefix}: entry must be an object`);
      continue;
    }
    const e = entry as Record<string, unknown>;

    if (typeof e.id !== 'string' || e.id.trim() === '') {
      errors.push(`${prefix}: missing required string field "id"`);
      continue;
    }
    if (seenIds.has(e.id)) {
      errors.push(`${prefix} (id=${e.id}): duplicate id, ignoring this entry`);
      continue;
    }
    if (typeof e.label !== 'string' || e.label.trim() === '') {
      errors.push(`${prefix} (id=${e.id}): missing required string field "label"`);
      continue;
    }
    if (typeof e.command !== 'string' || e.command.trim() === '') {
      errors.push(`${prefix} (id=${e.id}): missing required string field "command"`);
      continue;
    }

    seenIds.add(e.id);
    buttons.push({
      id: e.id,
      label: e.label,
      icon: typeof e.icon === 'string' ? e.icon : undefined,
      type: VALID_TYPES.includes(e.type as ButtonType) ? (e.type as ButtonType) : 'terminal',
      command: e.command,
      args: Array.isArray(e.args) ? e.args : undefined,
      color: typeof e.color === 'string' ? e.color : undefined,
      background: VALID_BACKGROUNDS.includes(e.background as ButtonBackground) ? (e.background as ButtonBackground) : 'none',
      tooltip: typeof e.tooltip === 'string' ? e.tooltip : undefined,
      cwd: typeof e.cwd === 'string' ? e.cwd : undefined,
      saveAll: e.saveAll === true,
      focus: e.focus === true,
      alignment: VALID_ALIGNMENTS.includes(e.alignment as ButtonAlignment) ? (e.alignment as ButtonAlignment) : 'left',
      priority: typeof e.priority === 'number' ? e.priority : 0,
      when: parseWhenClause(e.when),
    });
  }

  return { buttons, errors };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd extensions/null-actions && npm run test`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add extensions/null-actions/package.json extensions/null-actions/tsconfig.json extensions/null-actions/src/extension.ts extensions/null-actions/src/buttonConfig.ts extensions/null-actions/src/buttonConfig.test.ts
git commit -m "feat(null-actions): scaffold extension and add button config parsing"
```

---

### Task 2: `variableResolver.ts`

**Files:**
- Create: `extensions/null-actions/src/variableResolver.ts`
- Test: `extensions/null-actions/src/variableResolver.test.ts`
- Modify: `extensions/null-actions/tsconfig.json` (add both files to `include`)
- Modify: `extensions/null-actions/package.json` (append `out/variableResolver.test.js` to `scripts.test`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `VariableContext` (type), `resolveVariables(template: string, ctx: VariableContext): string` — consumed by Task 9's `runButton.ts`.

- [ ] **Step 1: Write the failing test**

`extensions/null-actions/src/variableResolver.test.ts`:
```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { resolveVariables, VariableContext } from './variableResolver';

test('substitutes each known variable', () => {
  const ctx: VariableContext = {
    workspaceFolder: '/repo',
    file: '/repo/src/a.ts',
    fileBasename: 'a.ts',
    fileDirname: '/repo/src',
    relativeFile: 'src/a.ts',
    selectedText: 'const x = 1;',
    lineNumber: '42',
  };
  assert.strictEqual(resolveVariables('${workspaceFolder}', ctx), '/repo');
  assert.strictEqual(resolveVariables('${file}', ctx), '/repo/src/a.ts');
  assert.strictEqual(resolveVariables('${fileBasename}', ctx), 'a.ts');
  assert.strictEqual(resolveVariables('${fileDirname}', ctx), '/repo/src');
  assert.strictEqual(resolveVariables('${relativeFile}', ctx), 'src/a.ts');
  assert.strictEqual(resolveVariables('${selectedText}', ctx), 'const x = 1;');
  assert.strictEqual(resolveVariables('${lineNumber}', ctx), '42');
});

test('substitutes multiple variables in one template', () => {
  const ctx: VariableContext = { fileBasename: 'a.ts', lineNumber: '3' };
  assert.strictEqual(
    resolveVariables('lint ${fileBasename} --line ${lineNumber}', ctx),
    'lint a.ts --line 3',
  );
});

test('resolves ${env:VAR} from the provided env map', () => {
  const ctx: VariableContext = { env: { FOO: 'bar' } as NodeJS.ProcessEnv };
  assert.strictEqual(resolveVariables('echo ${env:FOO}', ctx), 'echo bar');
});

test('unresolved variable (missing from context) is left as the literal token', () => {
  const ctx: VariableContext = {};
  assert.strictEqual(resolveVariables('open ${file}', ctx), 'open ${file}');
  assert.strictEqual(resolveVariables('echo ${env:MISSING}', ctx), 'echo ${env:MISSING}');
});

test('unknown variable name is left untouched', () => {
  const ctx: VariableContext = { file: '/a.ts' };
  assert.strictEqual(resolveVariables('${notAVariable}', ctx), '${notAVariable}');
});

test('template with no variables passes through unchanged', () => {
  assert.strictEqual(resolveVariables('npm run build', {}), 'npm run build');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-actions && npm run test`
Expected: FAIL — `variableResolver.ts` doesn't exist.

- [ ] **Step 3: Implement `variableResolver.ts`**

`extensions/null-actions/src/variableResolver.ts`:
```ts
'use strict';

export interface VariableContext {
  workspaceFolder?: string;
  file?: string;
  fileBasename?: string;
  fileDirname?: string;
  relativeFile?: string;
  selectedText?: string;
  lineNumber?: string;
  env?: NodeJS.ProcessEnv;
}

const SIMPLE_VARS = [
  'workspaceFolder', 'file', 'fileBasename', 'fileDirname',
  'relativeFile', 'selectedText', 'lineNumber',
] as const;

export function resolveVariables(template: string, ctx: VariableContext): string {
  return template.replace(
    /\$\{([a-zA-Z]+)(?::([a-zA-Z_][a-zA-Z0-9_]*))?\}/g,
    (match, name: string, envVar?: string) => {
      if (name === 'env' && envVar) {
        const value = ctx.env?.[envVar];
        return value !== undefined ? value : match;
      }
      if ((SIMPLE_VARS as readonly string[]).includes(name)) {
        const value = ctx[name as (typeof SIMPLE_VARS)[number]];
        return value !== undefined ? value : match;
      }
      return match;
    },
  );
}
```

- [ ] **Step 4: Update `tsconfig.json` and `package.json`**

In `extensions/null-actions/tsconfig.json`, add to `include`:
```json
"src/variableResolver.ts",
"src/variableResolver.test.ts"
```

In `extensions/null-actions/package.json`, update `scripts.test`:
```json
"test": "tsc -p tsconfig.json && node --test out/buttonConfig.test.js out/variableResolver.test.js"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd extensions/null-actions && npm run test`
Expected: PASS (13 tests total)

- [ ] **Step 6: Commit**

```bash
git add extensions/null-actions/src/variableResolver.ts extensions/null-actions/src/variableResolver.test.ts extensions/null-actions/tsconfig.json extensions/null-actions/package.json
git commit -m "feat(null-actions): add variable substitution engine"
```

---

### Task 3: `whenClause.ts`

**Files:**
- Create: `extensions/null-actions/src/whenClause.ts`
- Test: `extensions/null-actions/src/whenClause.test.ts`
- Modify: `extensions/null-actions/tsconfig.json`, `extensions/null-actions/package.json`

**Interfaces:**
- Consumes: `WhenClauseConfig` from `./buttonConfig` (Task 1).
- Produces: `WhenClauseContext` (type), `evaluateWhenClause(when: WhenClauseConfig | undefined, ctx: WhenClauseContext): boolean` — consumed by Task 8's `statusBarController` refresh logic (via `extension.ts`).

- [ ] **Step 1: Write the failing test**

`extensions/null-actions/src/whenClause.test.ts`:
```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { evaluateWhenClause } from './whenClause';

test('no when clause always passes', () => {
  assert.strictEqual(evaluateWhenClause(undefined, {}), true);
});

test('languages: passes when active language is in the list', () => {
  assert.strictEqual(
    evaluateWhenClause({ languages: ['cpp', 'c'] }, { activeLanguageId: 'cpp' }),
    true,
  );
});

test('languages: fails when active language is not in the list', () => {
  assert.strictEqual(
    evaluateWhenClause({ languages: ['cpp', 'c'] }, { activeLanguageId: 'python' }),
    false,
  );
});

test('languages: fails when there is no active editor at all', () => {
  assert.strictEqual(
    evaluateWhenClause({ languages: ['cpp'] }, {}),
    false,
  );
});

test('folder: passes when folder name matches, fails when it does not', () => {
  assert.strictEqual(evaluateWhenClause({ folder: 'backend' }, { folderName: 'backend' }), true);
  assert.strictEqual(evaluateWhenClause({ folder: 'backend' }, { folderName: 'frontend' }), false);
  assert.strictEqual(evaluateWhenClause({ folder: 'backend' }, {}), false);
});

test('filesExist: passes when every listed file exists under folderPath', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-test-'));
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
  assert.strictEqual(
    evaluateWhenClause({ filesExist: ['Cargo.toml'] }, { folderPath: dir }),
    true,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('filesExist: fails when any listed file is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-test-'));
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
  assert.strictEqual(
    evaluateWhenClause({ filesExist: ['Cargo.toml', 'missing.txt'] }, { folderPath: dir }),
    false,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('filesExist: fails when there is no folderPath to check against', () => {
  assert.strictEqual(evaluateWhenClause({ filesExist: ['Cargo.toml'] }, {}), false);
});

test('multiple conditions all must pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-test-'));
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
  const ctx = { activeLanguageId: 'rust', folderName: 'backend', folderPath: dir };
  assert.strictEqual(
    evaluateWhenClause({ languages: ['rust'], folder: 'backend', filesExist: ['Cargo.toml'] }, ctx),
    true,
  );
  assert.strictEqual(
    evaluateWhenClause({ languages: ['python'], folder: 'backend', filesExist: ['Cargo.toml'] }, ctx),
    false,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-actions && npm run test`
Expected: FAIL — `whenClause.ts` doesn't exist.

- [ ] **Step 3: Implement `whenClause.ts`**

`extensions/null-actions/src/whenClause.ts`:
```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { WhenClauseConfig } from './buttonConfig';

export interface WhenClauseContext {
  activeLanguageId?: string;
  folderName?: string;
  folderPath?: string;
}

export function evaluateWhenClause(when: WhenClauseConfig | undefined, ctx: WhenClauseContext): boolean {
  if (!when) { return true; }

  if (when.folder !== undefined && when.folder !== ctx.folderName) {
    return false;
  }

  if (when.languages && when.languages.length > 0) {
    if (!ctx.activeLanguageId || !when.languages.includes(ctx.activeLanguageId)) {
      return false;
    }
  }

  if (when.filesExist && when.filesExist.length > 0) {
    if (!ctx.folderPath) { return false; }
    for (const rel of when.filesExist) {
      if (!fs.existsSync(path.join(ctx.folderPath, rel))) {
        return false;
      }
    }
  }

  return true;
}
```

- [ ] **Step 4: Update `tsconfig.json` and `package.json`**

Add `"src/whenClause.ts", "src/whenClause.test.ts"` to `tsconfig.json`'s `include`, and append `out/whenClause.test.js` to `scripts.test` in `package.json`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd extensions/null-actions && npm run test`
Expected: PASS (21 tests total)

- [ ] **Step 6: Commit**

```bash
git add extensions/null-actions/src/whenClause.ts extensions/null-actions/src/whenClause.test.ts extensions/null-actions/tsconfig.json extensions/null-actions/package.json
git commit -m "feat(null-actions): add when-clause visibility filtering"
```

---

### Task 4: `terminalRegistry.ts` — deterministic terminal identity (the bug fix)

**Files:**
- Create: `extensions/null-actions/src/terminalRegistry.ts`
- Test: `extensions/null-actions/src/terminalRegistry.test.ts`
- Modify: `extensions/null-actions/tsconfig.json`, `extensions/null-actions/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks (deliberately decoupled from `vscode` via an injected `TerminalHost`).
- Produces: `TerminalHandle`, `TerminalHost` (interfaces), `TerminalRegistry` class with `dispatch(buttonId: string, command: string, options?: { cwd?: string; focus?: boolean }): void` and `forget(buttonId: string): void` — consumed by Task 7's `terminalHostIntegration.ts` (provides the real `TerminalHost`) and Task 9's `runButton.ts` (calls `dispatch`).

- [ ] **Step 1: Write the failing test**

`extensions/null-actions/src/terminalRegistry.test.ts`:
```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { TerminalRegistry, TerminalHandle, TerminalHost } from './terminalRegistry';

class FakeTerminal implements TerminalHandle {
  public sentTexts: string[] = [];
  public shown = false;
  constructor(public readonly name: string) {}
  sendText(text: string): void { this.sentTexts.push(text); }
  show(): void { this.shown = true; }
}

class FakeTerminalHost implements TerminalHost {
  public terminals: FakeTerminal[];
  public createCount = 0;
  constructor(initial: FakeTerminal[] = []) { this.terminals = initial; }
  listTerminals(): TerminalHandle[] { return this.terminals; }
  createTerminal(options: { name: string }): TerminalHandle {
    this.createCount++;
    const t = new FakeTerminal(options.name);
    this.terminals.push(t);
    return t;
  }
}

test('dispatch creates exactly one terminal on first call, named after the button id', () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  registry.dispatch('build', 'npm run build');
  assert.strictEqual(host.createCount, 1);
  assert.strictEqual(host.terminals[0].name, 'Action: build');
  assert.deepStrictEqual(host.terminals[0].sentTexts, ['npm run build']);
});

test('repeated dispatch reuses the cached terminal instead of creating new ones', () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  registry.dispatch('build', 'npm run build');
  registry.dispatch('build', 'npm run build');
  registry.dispatch('build', 'npm run build');
  assert.strictEqual(host.createCount, 1);
  assert.strictEqual(host.terminals[0].sentTexts.length, 3);
});

test('a terminal already present under the button name (simulated extension-host restart / restored persistent session) is adopted, never duplicated', () => {
  const restored = new FakeTerminal('Action: build');
  const host = new FakeTerminalHost([restored]);
  const registry = new TerminalRegistry(host); // fresh instance — no in-memory cache
  registry.dispatch('build', 'npm run build');
  assert.strictEqual(host.createCount, 0, 'must not create a duplicate when a matching terminal already exists');
  assert.strictEqual(host.terminals.length, 1);
  assert.deepStrictEqual(restored.sentTexts, ['npm run build']);
});

test('changing the button command text does not create a new terminal — identity is keyed by id, not command', () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  registry.dispatch('build', 'npm run build');
  registry.dispatch('build', 'npm run build -- --watch');
  assert.strictEqual(host.createCount, 1);
  assert.deepStrictEqual(host.terminals[0].sentTexts, ['npm run build', 'npm run build -- --watch']);
});

test('multiple stale terminals sharing the button name: adopts one (the most recent), creates no more', () => {
  const older = new FakeTerminal('Action: build');
  const newer = new FakeTerminal('Action: build');
  const host = new FakeTerminalHost([older, newer]);
  const registry = new TerminalRegistry(host);
  registry.dispatch('build', 'npm run build');
  assert.strictEqual(host.createCount, 0);
  assert.deepStrictEqual(newer.sentTexts, ['npm run build']);
  assert.deepStrictEqual(older.sentTexts, [], 'the other stale terminal must be left untouched, not closed or written to');
});

test('a terminal the user closed is not reused — dispatch after removal from the host creates a fresh one', () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  registry.dispatch('build', 'npm run build');
  host.terminals = []; // simulate the user closing it
  registry.dispatch('build', 'npm run build');
  assert.strictEqual(host.createCount, 2);
});

test('different button ids get independent terminals', () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  registry.dispatch('build', 'npm run build');
  registry.dispatch('test', 'npm test');
  assert.strictEqual(host.createCount, 2);
  assert.strictEqual(host.terminals[0].name, 'Action: build');
  assert.strictEqual(host.terminals[1].name, 'Action: test');
});

test('focus option shows the terminal after dispatch, absent focus does not', () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  registry.dispatch('build', 'npm run build');
  assert.strictEqual((host.terminals[0] as FakeTerminal).shown, false);
  registry.dispatch('build', 'npm run build', { focus: true });
  assert.strictEqual((host.terminals[0] as FakeTerminal).shown, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-actions && npm run test`
Expected: FAIL — `terminalRegistry.ts` doesn't exist.

- [ ] **Step 3: Implement `terminalRegistry.ts`**

`extensions/null-actions/src/terminalRegistry.ts`:
```ts
'use strict';

export interface TerminalHandle {
  readonly name: string;
  sendText(text: string, addNewLine?: boolean): void;
  show(preserveFocus?: boolean): void;
}

export interface TerminalHost {
  listTerminals(): TerminalHandle[];
  createTerminal(options: { name: string; cwd?: string }): TerminalHandle;
}

function terminalNameForButton(buttonId: string): string {
  return `Action: ${buttonId}`;
}

export class TerminalRegistry {
  private cache = new Map<string, TerminalHandle>();

  constructor(private readonly host: TerminalHost) {}

  dispatch(buttonId: string, command: string, options: { cwd?: string; focus?: boolean } = {}): void {
    const terminal = this.resolve(buttonId, options.cwd);
    terminal.sendText(command);
    if (options.focus) {
      terminal.show(false);
    }
  }

  forget(buttonId: string): void {
    this.cache.delete(buttonId);
  }

  private resolve(buttonId: string, cwd?: string): TerminalHandle {
    const name = terminalNameForButton(buttonId);
    const live = this.host.listTerminals();

    // Never trust the in-memory cache alone — it resets on extension-host
    // restart, but VS Code frequently restores the actual terminal objects
    // from the previous session (persistent sessions). Re-validate liveness
    // against the host on every dispatch.
    const cached = this.cache.get(buttonId);
    if (cached && live.includes(cached)) {
      return cached;
    }

    // No live cached reference — look for a terminal VS Code already has
    // open under this button's name (adopts a restored session terminal,
    // or a leftover duplicate from before this fix) instead of creating a
    // new one. `vscode.window.terminals` is ordered by creation, so the
    // last match is the most recently created one.
    const matches = live.filter(t => t.name === name);
    if (matches.length > 0) {
      const adopted = matches[matches.length - 1];
      this.cache.set(buttonId, adopted);
      return adopted;
    }

    const created = this.host.createTerminal({ name, cwd });
    this.cache.set(buttonId, created);
    return created;
  }
}
```

- [ ] **Step 4: Update `tsconfig.json` and `package.json`**

Add `"src/terminalRegistry.ts", "src/terminalRegistry.test.ts"` to `tsconfig.json`'s `include`, and append `out/terminalRegistry.test.js` to `scripts.test`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd extensions/null-actions && npm run test`
Expected: PASS (29 tests total)

- [ ] **Step 6: Commit**

```bash
git add extensions/null-actions/src/terminalRegistry.ts extensions/null-actions/src/terminalRegistry.test.ts extensions/null-actions/tsconfig.json extensions/null-actions/package.json
git commit -m "feat(null-actions): add deterministic per-button terminal identity

Fixes the terminal-duplication behavior seen in vscode-action-buttons on
window reload/folder reopen: terminal identity is keyed by button id and
re-resolved against the live terminal list on every dispatch, so a
restored persistent-session terminal is adopted instead of duplicated."
```

---

### Task 5: `projectDetector.ts`

**Files:**
- Create: `extensions/null-actions/src/projectDetector.ts`
- Test: `extensions/null-actions/src/projectDetector.test.ts`
- Modify: `extensions/null-actions/tsconfig.json`, `extensions/null-actions/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SuggestedButton` (type), `detectSuggestedButtons(folderPath: string): SuggestedButton[]` — consumed by Task 10's `settingsPanel.ts`.

- [ ] **Step 1: Write the failing test**

`extensions/null-actions/src/projectDetector.test.ts`:
```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectSuggestedButtons } from './projectDetector';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-detect-'));
}

test('empty folder yields no suggestions', () => {
  const dir = tmpDir();
  assert.deepStrictEqual(detectSuggestedButtons(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Cargo.toml yields cargo suggestions', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "x"');
  const suggestions = detectSuggestedButtons(dir);
  assert.ok(suggestions.some(s => s.command === 'cargo run'));
  assert.ok(suggestions.some(s => s.command === 'cargo build'));
  assert.ok(suggestions.some(s => s.command === 'cargo test'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CMakeLists.txt yields cmake suggestions', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'CMakeLists.txt'), 'project(x)');
  const suggestions = detectSuggestedButtons(dir);
  assert.ok(suggestions.some(s => s.command === 'cmake -B build'));
  assert.ok(suggestions.some(s => s.command === 'cmake --build build'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a .csproj file yields dotnet suggestions', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'App.csproj'), '<Project />');
  const suggestions = detectSuggestedButtons(dir);
  assert.ok(suggestions.some(s => s.command === 'dotnet build'));
  assert.ok(suggestions.some(s => s.command === 'dotnet run'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('multiple manifests present yields the union of their suggestions', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
  fs.writeFileSync(path.join(dir, 'CMakeLists.txt'), 'project(x)');
  const suggestions = detectSuggestedButtons(dir);
  assert.ok(suggestions.some(s => s.command === 'cargo run'));
  assert.ok(suggestions.some(s => s.command === 'cmake -B build'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('suggestion ids are unique within one result set', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
  const suggestions = detectSuggestedButtons(dir);
  const ids = suggestions.map(s => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-actions && npm run test`
Expected: FAIL — `projectDetector.ts` doesn't exist.

- [ ] **Step 3: Implement `projectDetector.ts`**

`extensions/null-actions/src/projectDetector.ts`:
```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';

export interface SuggestedButton {
  id: string;
  label: string;
  command: string;
  icon?: string;
}

interface ManifestDetector {
  manifest: string;
  suggestions: SuggestedButton[];
}

const DETECTORS: ManifestDetector[] = [
  {
    manifest: 'Cargo.toml',
    suggestions: [
      { id: 'cargo-run', label: 'cargo run', command: 'cargo run', icon: 'play' },
      { id: 'cargo-build', label: 'cargo build', command: 'cargo build', icon: 'tools' },
      { id: 'cargo-test', label: 'cargo test', command: 'cargo test', icon: 'beaker' },
    ],
  },
  {
    manifest: 'CMakeLists.txt',
    suggestions: [
      { id: 'cmake-configure', label: 'cmake configure', command: 'cmake -B build', icon: 'gear' },
      { id: 'cmake-build', label: 'cmake build', command: 'cmake --build build', icon: 'tools' },
    ],
  },
];

export function detectSuggestedButtons(folderPath: string): SuggestedButton[] {
  const suggestions: SuggestedButton[] = [];

  for (const detector of DETECTORS) {
    if (fs.existsSync(path.join(folderPath, detector.manifest))) {
      suggestions.push(...detector.suggestions);
    }
  }

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(folderPath);
  } catch {
    entries = [];
  }
  if (entries.some(f => f.endsWith('.csproj'))) {
    suggestions.push(
      { id: 'dotnet-build', label: 'dotnet build', command: 'dotnet build', icon: 'tools' },
      { id: 'dotnet-run', label: 'dotnet run', command: 'dotnet run', icon: 'play' },
    );
  }

  return suggestions;
}
```

- [ ] **Step 4: Update `tsconfig.json` and `package.json`**

Add `"src/projectDetector.ts", "src/projectDetector.test.ts"` to `tsconfig.json`'s `include`, and append `out/projectDetector.test.js` to `scripts.test`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd extensions/null-actions && npm run test`
Expected: PASS (35 tests total)

- [ ] **Step 6: Commit**

```bash
git add extensions/null-actions/src/projectDetector.ts extensions/null-actions/src/projectDetector.test.ts extensions/null-actions/tsconfig.json extensions/null-actions/package.json
git commit -m "feat(null-actions): add project-type detection for button suggestions"
```

---

### Task 6: `npmScriptsProvider.ts`

**Files:**
- Create: `extensions/null-actions/src/npmScriptsProvider.ts`
- Test: `extensions/null-actions/src/npmScriptsProvider.test.ts`
- Modify: `extensions/null-actions/tsconfig.json`, `extensions/null-actions/package.json`

**Interfaces:**
- Consumes: `ActionButtonConfig` from `./buttonConfig` (Task 1).
- Produces: `parseNpmScripts(packageJsonContent: string): { id: string; label: string; command: string }[]` and `toActionButtonConfig(script: { id: string; label: string; command: string }, priority: number): ActionButtonConfig` — both consumed by Task 11's `extension.ts` refresh logic.

- [ ] **Step 1: Write the failing test**

`extensions/null-actions/src/npmScriptsProvider.test.ts`:
```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { parseNpmScripts, toActionButtonConfig } from './npmScriptsProvider';

test('parses scripts into buttons', () => {
  const content = JSON.stringify({ scripts: { build: 'tsc', test: 'node --test out' } });
  const buttons = parseNpmScripts(content);
  assert.deepStrictEqual(buttons, [
    { id: 'npm-build', label: 'npm run build', command: 'npm run build' },
    { id: 'npm-test', label: 'npm run test', command: 'npm run test' },
  ]);
});

test('package.json with no scripts field yields no buttons', () => {
  assert.deepStrictEqual(parseNpmScripts(JSON.stringify({ name: 'x' })), []);
});

test('malformed JSON yields no buttons rather than throwing', () => {
  assert.deepStrictEqual(parseNpmScripts('{ not valid json'), []);
});

test('non-string script values are ignored', () => {
  const content = JSON.stringify({ scripts: { build: 'tsc', weird: 123 } });
  const buttons = parseNpmScripts(content);
  assert.strictEqual(buttons.length, 1);
  assert.strictEqual(buttons[0].id, 'npm-build');
});

test('toActionButtonConfig fills in full ActionButtonConfig defaults', () => {
  const config = toActionButtonConfig({ id: 'npm-build', label: 'npm run build', command: 'npm run build' }, 10);
  assert.strictEqual(config.id, 'npm-build');
  assert.strictEqual(config.label, 'npm run build');
  assert.strictEqual(config.command, 'npm run build');
  assert.strictEqual(config.type, 'terminal');
  assert.strictEqual(config.alignment, 'left');
  assert.strictEqual(config.priority, 10);
  assert.strictEqual(config.background, 'none');
  assert.strictEqual(config.saveAll, false);
  assert.strictEqual(config.focus, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/null-actions && npm run test`
Expected: FAIL — `npmScriptsProvider.ts` doesn't exist.

- [ ] **Step 3: Implement `npmScriptsProvider.ts`**

`extensions/null-actions/src/npmScriptsProvider.ts`:
```ts
'use strict';

import { ActionButtonConfig } from './buttonConfig';

export interface NpmScriptButton {
  id: string;
  label: string;
  command: string;
}

export function parseNpmScripts(packageJsonContent: string): NpmScriptButton[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonContent);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) { return []; }

  const scripts = (parsed as Record<string, unknown>).scripts;
  if (typeof scripts !== 'object' || scripts === null) { return []; }

  const buttons: NpmScriptButton[] = [];
  for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof value !== 'string') { continue; }
    buttons.push({ id: `npm-${name}`, label: `npm run ${name}`, command: `npm run ${name}` });
  }
  return buttons;
}

export function toActionButtonConfig(script: NpmScriptButton, priority: number): ActionButtonConfig {
  return {
    id: script.id,
    label: script.label,
    icon: undefined,
    type: 'terminal',
    command: script.command,
    args: undefined,
    color: undefined,
    background: 'none',
    tooltip: undefined,
    cwd: undefined,
    saveAll: false,
    focus: false,
    alignment: 'left',
    priority,
    when: undefined,
  };
}
```

- [ ] **Step 4: Update `tsconfig.json` and `package.json`**

Add `"src/npmScriptsProvider.ts", "src/npmScriptsProvider.test.ts"` to `tsconfig.json`'s `include`, and append `out/npmScriptsProvider.test.js` to `scripts.test`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd extensions/null-actions && npm run test`
Expected: PASS (40 tests total)

- [ ] **Step 6: Commit**

```bash
git add extensions/null-actions/src/npmScriptsProvider.ts extensions/null-actions/src/npmScriptsProvider.test.ts extensions/null-actions/tsconfig.json extensions/null-actions/package.json
git commit -m "feat(null-actions): add npm script auto-load parsing"
```

---

### Task 7: `vscode` integration layer — `buttonConfigIntegration.ts` + `terminalHostIntegration.ts`

**Files:**
- Create: `extensions/null-actions/src/buttonConfigIntegration.ts`
- Create: `extensions/null-actions/src/terminalHostIntegration.ts`
- Modify: `extensions/null-actions/tsconfig.json` (add both to `include` — no test entries, these are thin `vscode` wrappers per the Global Constraints)

**Interfaces:**
- Consumes: `parseButtonConfigs`, `ActionButtonConfig` from `./buttonConfig` (Task 1); `TerminalHost`, `TerminalHandle` from `./terminalRegistry` (Task 4).
- Produces: `readButtonConfigs(): ParseResult`, `writeButtonConfigs(buttons: ActionButtonConfig[]): Promise<void>` and `VscodeTerminalHost` class implementing `TerminalHost` — both consumed by Task 11's `extension.ts`.

- [ ] **Step 1: Implement `buttonConfigIntegration.ts`**

`extensions/null-actions/src/buttonConfigIntegration.ts`:
```ts
'use strict';

import * as vscode from 'vscode';
import { ActionButtonConfig, ParseResult, parseButtonConfigs } from './buttonConfig';

export function readButtonConfigs(): ParseResult {
  const raw = vscode.workspace.getConfiguration().get('null-actions.buttons');
  return parseButtonConfigs(raw);
}

export async function writeButtonConfigs(buttons: ActionButtonConfig[]): Promise<void> {
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration().update('null-actions.buttons', buttons, target);
}
```

- [ ] **Step 2: Implement `terminalHostIntegration.ts`**

`extensions/null-actions/src/terminalHostIntegration.ts`:
```ts
'use strict';

import * as vscode from 'vscode';
import { TerminalHandle, TerminalHost } from './terminalRegistry';

export class VscodeTerminalHost implements TerminalHost {
  listTerminals(): TerminalHandle[] {
    return [...vscode.window.terminals];
  }

  createTerminal(options: { name: string; cwd?: string }): TerminalHandle {
    return vscode.window.createTerminal({ name: options.name, cwd: options.cwd });
  }
}
```

- [ ] **Step 3: Update `tsconfig.json`**

Add `"src/buttonConfigIntegration.ts", "src/terminalHostIntegration.ts"` to `include`.

- [ ] **Step 4: Verify it compiles**

Run: `cd extensions/null-actions && npm run compile`
Expected: exits 0, no TypeScript errors. (`vscode.Terminal` structurally satisfies `TerminalHandle` — both `sendText`/`show` signatures match — so no adapter shimming is needed.)

- [ ] **Step 5: Commit**

```bash
git add extensions/null-actions/src/buttonConfigIntegration.ts extensions/null-actions/src/terminalHostIntegration.ts extensions/null-actions/tsconfig.json
git commit -m "feat(null-actions): wire config and terminal modules to the live vscode API"
```

---

### Task 8: `statusBarController.ts`

**Files:**
- Create: `extensions/null-actions/src/statusBarController.ts`
- Modify: `extensions/null-actions/tsconfig.json` (add to `include`)

**Interfaces:**
- Consumes: `ActionButtonConfig` from `./buttonConfig` (Task 1).
- Produces: `StatusBarController` class with `update(buttons: ActionButtonConfig[]): void` and `dispose(): void` — consumed by Task 11's `extension.ts`.

- [ ] **Step 1: Implement `statusBarController.ts`**

`extensions/null-actions/src/statusBarController.ts`:
```ts
'use strict';

import * as vscode from 'vscode';
import { ActionButtonConfig } from './buttonConfig';

interface TrackedItem {
  item: vscode.StatusBarItem;
  alignment: ActionButtonConfig['alignment'];
  priority: number;
}

export class StatusBarController {
  private items = new Map<string, TrackedItem>();

  update(buttons: ActionButtonConfig[]): void {
    const nextIds = new Set(buttons.map(b => b.id));

    for (const [id, tracked] of this.items) {
      if (!nextIds.has(id)) {
        tracked.item.dispose();
        this.items.delete(id);
      }
    }

    for (const button of buttons) {
      const existing = this.items.get(button.id);
      // Alignment and priority are fixed at creation time by the VS Code
      // API (there's no setter) — recreate the item if either changed.
      if (existing && (existing.alignment !== button.alignment || existing.priority !== button.priority)) {
        existing.item.dispose();
        this.items.delete(button.id);
      }

      const tracked = this.items.get(button.id) ?? this.create(button);
      this.applyButton(tracked.item, button);
      this.items.set(button.id, tracked);
    }
  }

  dispose(): void {
    for (const tracked of this.items.values()) {
      tracked.item.dispose();
    }
    this.items.clear();
  }

  private create(button: ActionButtonConfig): TrackedItem {
    const alignment = button.alignment === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
    const item = vscode.window.createStatusBarItem(`null-actions.${button.id}`, alignment, button.priority);
    return { item, alignment: button.alignment, priority: button.priority };
  }

  private applyButton(item: vscode.StatusBarItem, button: ActionButtonConfig): void {
    item.text = button.icon ? `$(${button.icon}) ${button.label}` : button.label;
    item.tooltip = button.tooltip;
    item.color = button.color;
    item.backgroundColor = button.background !== 'none'
      ? new vscode.ThemeColor(`statusBarItem.${button.background}Background`)
      : undefined;
    item.command = { command: 'null-actions.runButton', title: button.label, arguments: [button.id] };
    item.show();
  }
}
```

- [ ] **Step 2: Update `tsconfig.json`**

Add `"src/statusBarController.ts"` to `include`.

- [ ] **Step 3: Verify it compiles**

Run: `cd extensions/null-actions && npm run compile`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add extensions/null-actions/src/statusBarController.ts extensions/null-actions/tsconfig.json
git commit -m "feat(null-actions): add status bar rendering with left/right alignment and priority"
```

---

### Task 9: `runButton.ts` — command dispatch

**Files:**
- Create: `extensions/null-actions/src/runButton.ts`
- Modify: `extensions/null-actions/tsconfig.json` (add to `include`)
- Modify: `extensions/null-actions/package.json` (add the `null-actions.runButton` command contribution)

**Interfaces:**
- Consumes: `ActionButtonConfig` from `./buttonConfig` (Task 1); `resolveVariables`, `VariableContext` from `./variableResolver` (Task 2); `TerminalRegistry` from `./terminalRegistry` (Task 4).
- Produces: `runButton(button: ActionButtonConfig, registry: TerminalRegistry): Promise<void>` — consumed by Task 11's `extension.ts` command registration.

- [ ] **Step 1: Implement `runButton.ts`**

`extensions/null-actions/src/runButton.ts`:
```ts
'use strict';

import * as vscode from 'vscode';
import { ActionButtonConfig } from './buttonConfig';
import { resolveVariables, VariableContext } from './variableResolver';
import { TerminalRegistry } from './terminalRegistry';

function buildVariableContext(): VariableContext {
  const editor = vscode.window.activeTextEditor;
  const folder = vscode.workspace.workspaceFolders?.[0];
  const doc = editor?.document;
  const fsPath = doc?.uri.fsPath;

  return {
    workspaceFolder: folder?.uri.fsPath,
    file: fsPath,
    fileBasename: fsPath ? fsPath.split(/[\\/]/).pop() : undefined,
    fileDirname: fsPath ? fsPath.replace(/[\\/][^\\/]*$/, '') : undefined,
    relativeFile: doc ? vscode.workspace.asRelativePath(doc.uri) : undefined,
    selectedText: editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : undefined,
    lineNumber: editor ? String(editor.selection.active.line + 1) : undefined,
    env: process.env,
  };
}

export async function runButton(button: ActionButtonConfig, registry: TerminalRegistry): Promise<void> {
  if (button.saveAll) {
    await vscode.workspace.saveAll();
  }

  const ctx = buildVariableContext();

  if (button.type === 'vscode-command') {
    const args = (button.args ?? []).map(a => (typeof a === 'string' ? resolveVariables(a, ctx) : a));
    await vscode.commands.executeCommand(button.command, ...args);
    return;
  }

  const cwd = button.cwd ? resolveVariables(button.cwd, ctx) : ctx.workspaceFolder;
  const command = resolveVariables(button.command, ctx);
  registry.dispatch(button.id, command, { cwd, focus: button.focus });
}
```

- [ ] **Step 2: Update `tsconfig.json`**

Add `"src/runButton.ts"` to `include`.

- [ ] **Step 3: Add the command contribution**

In `extensions/null-actions/package.json`, add to `contributes` (creating the `commands` array):
```json
"commands": [
  {
    "command": "null-actions.runButton",
    "title": "Null Actions: Run Button"
  }
]
```
And to `contributes.menus.commandPalette` (creating both):
```json
"menus": {
  "commandPalette": [
    { "command": "null-actions.runButton", "when": "false" }
  ]
}
```
(`"when": "false"` hides it from the palette — it requires a `buttonId` argument and only makes sense invoked from a status bar item's own `command`, matching how `null.renameScratchOrNoteItem` is hidden in `null-tools`.)

- [ ] **Step 4: Verify it compiles**

Run: `cd extensions/null-actions && npm run compile`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-actions/src/runButton.ts extensions/null-actions/tsconfig.json extensions/null-actions/package.json
git commit -m "feat(null-actions): add button dispatch (terminal + vscode-command, saveAll, focus)"
```

---

### Task 10: `settingsPanel.ts` — webview CRUD UI

**Files:**
- Create: `extensions/null-actions/src/settingsPanel.ts`
- Modify: `extensions/null-actions/tsconfig.json` (add to `include`)
- Modify: `extensions/null-actions/package.json` (add the `views` contribution)

**Interfaces:**
- Consumes: `ActionButtonConfig` from `./buttonConfig`; `readButtonConfigs`, `writeButtonConfigs` from `./buttonConfigIntegration` (Task 7); `parseButtonConfigs` from `./buttonConfig`; `detectSuggestedButtons`, `SuggestedButton` from `./projectDetector` (Task 5).
- Produces: `ActionButtonsViewProvider` class (implements `vscode.WebviewViewProvider`), registered under view id `null-actions.buttonsView` — consumed by Task 11's `extension.ts`.

- [ ] **Step 1: Implement `settingsPanel.ts`**

`extensions/null-actions/src/settingsPanel.ts`:
```ts
'use strict';

import * as vscode from 'vscode';
import { ActionButtonConfig, parseButtonConfigs } from './buttonConfig';
import { readButtonConfigs, writeButtonConfigs } from './buttonConfigIntegration';
import { detectSuggestedButtons, SuggestedButton } from './projectDetector';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

type InboundMessage =
  | { type: 'ready' }
  | { type: 'save'; buttons: unknown };

export class ActionButtonsViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: InboundMessage) => {
      if (msg.type === 'ready') {
        this.postState();
      } else if (msg.type === 'save') {
        this.handleSave(msg.buttons);
      }
    });
  }

  refresh(): void {
    this.postState();
  }

  private postState(): void {
    if (!this.view) { return; }
    const { buttons } = readButtonConfigs();
    const folder = vscode.workspace.workspaceFolders?.[0];
    const suggestions: SuggestedButton[] = folder ? detectSuggestedButtons(folder.uri.fsPath) : [];
    this.view.webview.postMessage({ type: 'init', buttons, suggestions });
  }

  private async handleSave(raw: unknown): Promise<void> {
    if (!this.view) { return; }
    const { buttons, errors } = parseButtonConfigs(raw);
    if (errors.length > 0) {
      this.view.webview.postMessage({ type: 'error', errors });
      return;
    }
    await writeButtonConfigs(buttons);
    this.view.webview.postMessage({ type: 'saved' });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    return '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
'<meta charset="UTF-8">' +
'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'nonce-' + nonce + '\'; script-src \'nonce-' + nonce + '\';">' +
'<meta name="viewport" content="width=device-width,initial-scale=1">' +
'<title>Action Buttons</title>' +
'<style nonce="' + nonce + '">' +
this.css() +
'</style>' +
'</head>' +
'<body>' +
'<div id="toolbar">' +
'  <button id="add-btn">+ Add Button</button>' +
'  <button id="save-btn" class="primary">Save All</button>' +
'  <span id="status"></span>' +
'</div>' +
'<div id="buttons-list"></div>' +
'<h3>Suggested</h3>' +
'<div id="suggestions-list"></div>' +
'<script nonce="' + nonce + '">' +
this.clientScript() +
'</script>' +
'</body>' +
'</html>';
  }

  private css(): string {
    return '*,*::before,*::after{box-sizing:border-box;}' +
      'body{font-family:var(--vscode-font-family);font-size:12px;color:var(--vscode-foreground);padding:8px;}' +
      '#toolbar{display:flex;gap:8px;align-items:center;margin-bottom:10px;}' +
      'button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:3px;padding:4px 10px;cursor:pointer;}' +
      'button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}' +
      'button:hover{opacity:0.85;}' +
      '.card{border:1px solid var(--vscode-widget-border,rgba(255,255,255,0.1));border-radius:4px;padding:8px;margin-bottom:8px;}' +
      '.row{display:flex;gap:6px;margin-bottom:6px;align-items:center;}' +
      '.row label{width:80px;flex-shrink:0;opacity:0.75;}' +
      '.row input[type=text],.row input[type=number],.row select{flex:1;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:2px;padding:3px 6px;}' +
      '.card-footer{display:flex;gap:6px;justify-content:flex-end;}' +
      '#status{opacity:0.7;}' +
      '.suggestion{display:flex;justify-content:space-between;align-items:center;padding:4px 0;}';
  }

  private clientScript(): string {
    return 'const vscode = acquireVsCodeApi();' +
      'let buttons = [];' +
      'let suggestions = [];' +
      '' +
      'function fieldRow(label, inputHtml) {' +
      '  return "<div class=row><label>" + label + "</label>" + inputHtml + "</div>";' +
      '}' +
      '' +
      'function renderCard(btn, index) {' +
      '  const html =' +
      '    fieldRow("Label", "<input type=text data-field=label data-index=" + index + " value=\\"" + (btn.label || "").replace(/\\"/g, "&quot;") + "\\">") +' +
      '    fieldRow("Command", "<input type=text data-field=command data-index=" + index + " value=\\"" + (btn.command || "").replace(/\\"/g, "&quot;") + "\\">") +' +
      '    fieldRow("Type", "<select data-field=type data-index=" + index + "><option value=terminal" + (btn.type === "terminal" ? " selected" : "") + ">terminal</option><option value=vscode-command" + (btn.type === "vscode-command" ? " selected" : "") + ">vscode-command</option></select>") +' +
      '    fieldRow("Icon", "<input type=text data-field=icon data-index=" + index + " value=\\"" + (btn.icon || "") + "\\" placeholder=tools>") +' +
      '    fieldRow("Color", "<input type=text data-field=color data-index=" + index + " value=\\"" + (btn.color || "") + "\\" placeholder=#ffcc00>") +' +
      '    fieldRow("Background", "<select data-field=background data-index=" + index + "><option value=none" + (btn.background === "none" ? " selected" : "") + ">none</option><option value=warning" + (btn.background === "warning" ? " selected" : "") + ">warning</option><option value=error" + (btn.background === "error" ? " selected" : "") + ">error</option></select>") +' +
      '    fieldRow("Tooltip", "<input type=text data-field=tooltip data-index=" + index + " value=\\"" + (btn.tooltip || "") + "\\">") +' +
      '    fieldRow("Cwd", "<input type=text data-field=cwd data-index=" + index + " value=\\"" + (btn.cwd || "") + "\\" placeholder=${workspaceFolder}>") +' +
      '    fieldRow("Alignment", "<select data-field=alignment data-index=" + index + "><option value=left" + (btn.alignment === "left" ? " selected" : "") + ">left</option><option value=right" + (btn.alignment === "right" ? " selected" : "") + ">right</option></select>") +' +
      '    fieldRow("Priority", "<input type=number data-field=priority data-index=" + index + " value=" + (btn.priority || 0) + ">") +' +
      '    fieldRow("Save all", "<input type=checkbox data-field=saveAll data-index=" + index + (btn.saveAll ? " checked" : "") + ">") +' +
      '    fieldRow("Focus", "<input type=checkbox data-field=focus data-index=" + index + (btn.focus ? " checked" : "") + ">") +' +
      '    fieldRow("Languages", "<input type=text data-field=whenLanguages data-index=" + index + " value=\\"" + ((btn.when && btn.when.languages) || []).join(",") + "\\" placeholder=cpp,c>") +' +
      '    fieldRow("Files exist", "<input type=text data-field=whenFilesExist data-index=" + index + " value=\\"" + ((btn.when && btn.when.filesExist) || []).join(",") + "\\" placeholder=CMakeLists.txt>") +' +
      '    fieldRow("Folder", "<input type=text data-field=whenFolder data-index=" + index + " value=\\"" + ((btn.when && btn.when.folder) || "") + "\\">") +' +
      '    "<div class=card-footer>" +' +
      '    "<button data-action=up data-index=" + index + ">Up</button>" +' +
      '    "<button data-action=down data-index=" + index + ">Down</button>" +' +
      '    "<button data-action=delete data-index=" + index + ">Delete</button>" +' +
      '    "</div>";' +
      '  const div = document.createElement("div");' +
      '  div.className = "card";' +
      '  div.innerHTML = html;' +
      '  return div;' +
      '}' +
      '' +
      'function render() {' +
      '  const list = document.getElementById("buttons-list");' +
      '  list.innerHTML = "";' +
      '  buttons.forEach(function(btn, i) { list.appendChild(renderCard(btn, i)); });' +
      '' +
      '  const sList = document.getElementById("suggestions-list");' +
      '  sList.innerHTML = "";' +
      '  suggestions.forEach(function(s) {' +
      '    const row = document.createElement("div");' +
      '    row.className = "suggestion";' +
      '    row.innerHTML = "<span>" + s.label + "</span><button data-action=add-suggestion data-id=" + s.id + ">+ Add</button>";' +
      '    sList.appendChild(row);' +
      '  });' +
      '}' +
      '' +
      'function fieldToButtons(index, field, value) {' +
      '  const btn = buttons[index];' +
      '  if (field === "whenLanguages" || field === "whenFilesExist" || field === "whenFolder") {' +
      '    btn.when = btn.when || {};' +
      '    if (field === "whenLanguages") { btn.when.languages = value ? value.split(",").map(function(s){return s.trim();}).filter(Boolean) : undefined; }' +
      '    if (field === "whenFilesExist") { btn.when.filesExist = value ? value.split(",").map(function(s){return s.trim();}).filter(Boolean) : undefined; }' +
      '    if (field === "whenFolder") { btn.when.folder = value || undefined; }' +
      '    return;' +
      '  }' +
      '  btn[field] = value;' +
      '}' +
      '' +
      'document.addEventListener("input", function(e) {' +
      '  const t = e.target;' +
      '  const field = t.getAttribute("data-field");' +
      '  if (!field) { return; }' +
      '  const index = parseInt(t.getAttribute("data-index"), 10);' +
      '  let value = t.type === "checkbox" ? t.checked : t.value;' +
      '  if (t.type === "number") { value = parseFloat(t.value) || 0; }' +
      '  fieldToButtons(index, field, value);' +
      '});' +
      '' +
      'document.addEventListener("click", function(e) {' +
      '  const t = e.target;' +
      '  const action = t.getAttribute("data-action");' +
      '  if (!action) { return; }' +
      '  const index = parseInt(t.getAttribute("data-index"), 10);' +
      '  if (action === "delete") { buttons.splice(index, 1); render(); }' +
      '  if (action === "up" && index > 0) { const tmp = buttons[index - 1]; buttons[index - 1] = buttons[index]; buttons[index] = tmp; render(); }' +
      '  if (action === "down" && index < buttons.length - 1) { const tmp = buttons[index + 1]; buttons[index + 1] = buttons[index]; buttons[index] = tmp; render(); }' +
      '  if (action === "add-suggestion") {' +
      '    const id = t.getAttribute("data-id");' +
      '    const s = suggestions.find(function(x) { return x.id === id; });' +
      '    if (s) {' +
      '      buttons.push({ id: s.id, label: s.label, command: s.command, icon: s.icon, type: "terminal", background: "none", alignment: "left", priority: 0, saveAll: false, focus: false });' +
      '      render();' +
      '    }' +
      '  }' +
      '});' +
      '' +
      'document.getElementById("add-btn").addEventListener("click", function() {' +
      '  buttons.push({ id: "button-" + Date.now(), label: "New Button", command: "", type: "terminal", background: "none", alignment: "left", priority: 0, saveAll: false, focus: false });' +
      '  render();' +
      '});' +
      '' +
      'document.getElementById("save-btn").addEventListener("click", function() {' +
      '  vscode.postMessage({ type: "save", buttons: buttons });' +
      '});' +
      '' +
      'window.addEventListener("message", function(event) {' +
      '  const msg = event.data;' +
      '  if (msg.type === "init") {' +
      '    buttons = msg.buttons;' +
      '    suggestions = msg.suggestions;' +
      '    render();' +
      '  } else if (msg.type === "saved") {' +
      '    document.getElementById("status").textContent = "Saved";' +
      '    setTimeout(function() { document.getElementById("status").textContent = ""; }, 1500);' +
      '  } else if (msg.type === "error") {' +
      '    document.getElementById("status").textContent = "Error: " + msg.errors.join("; ");' +
      '  }' +
      '});' +
      '' +
      'vscode.postMessage({ type: "ready" });';
  }
}
```

- [ ] **Step 2: Update `tsconfig.json`**

Add `"src/settingsPanel.ts"` to `include`.

- [ ] **Step 3: Add the view contribution**

In `extensions/null-actions/package.json`, add to `contributes`:
```json
"views": {
  "null-workspace": [
    {
      "type": "webview",
      "id": "null-actions.buttonsView",
      "name": "Action Buttons"
    }
  ]
}
```
(This registers into `null-tools`'s existing `null-workspace` activity-bar container — the same pattern `null.scratchView`/`null.notesView`/`null.portsView` already use. No new container needed.)

- [ ] **Step 4: Verify it compiles**

Run: `cd extensions/null-actions && npm run compile`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-actions/src/settingsPanel.ts extensions/null-actions/tsconfig.json extensions/null-actions/package.json
git commit -m "feat(null-actions): add settings webview for button CRUD and suggestions"
```

---

### Task 11: `extension.ts` — final wiring

**Files:**
- Modify: `extensions/null-actions/src/extension.ts`
- Modify: `extensions/null-actions/package.json` (activation already correct from Task 1; no changes needed here beyond what Tasks 9/10 already added)

**Interfaces:**
- Consumes: everything produced by Tasks 1–10 (`buttonConfigIntegration`, `terminalHostIntegration`, `terminalRegistry`, `statusBarController`, `whenClause`, `runButton`, `settingsPanel`, `npmScriptsProvider`).
- Produces: `activate(context)` — the extension's real entry point.

- [ ] **Step 1: Replace the `extension.ts` stub with full wiring**

`extensions/null-actions/src/extension.ts`:
```ts
'use strict';

import * as vscode from 'vscode';
import { readButtonConfigs } from './buttonConfigIntegration';
import { VscodeTerminalHost } from './terminalHostIntegration';
import { TerminalRegistry } from './terminalRegistry';
import { StatusBarController } from './statusBarController';
import { evaluateWhenClause, WhenClauseContext } from './whenClause';
import { runButton } from './runButton';
import { ActionButtonsViewProvider } from './settingsPanel';
import { parseNpmScripts, toActionButtonConfig } from './npmScriptsProvider';
import { ActionButtonConfig } from './buttonConfig';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext): void {
  const terminalRegistry = new TerminalRegistry(new VscodeTerminalHost());
  const statusBar = new StatusBarController();
  const settingsProvider = new ActionButtonsViewProvider();

  context.subscriptions.push(statusBar);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('null-actions.buttonsView', settingsProvider),
  );

  function loadNpmButtons(): ActionButtonConfig[] {
    const auto = vscode.workspace.getConfiguration().get<boolean>('null-actions.npm.autoLoad', false);
    if (!auto) { return []; }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { return []; }
    const pkgPath = path.join(folder.uri.fsPath, 'package.json');
    if (!fs.existsSync(pkgPath)) { return []; }
    let content: string;
    try {
      content = fs.readFileSync(pkgPath, 'utf8');
    } catch {
      return [];
    }
    return parseNpmScripts(content).map((s, i) => toActionButtonConfig(s, -i));
  }

  function refresh(): void {
    const { buttons } = readButtonConfigs();
    const npmButtons = loadNpmButtons();
    const folder = vscode.workspace.workspaceFolders?.[0];
    const ctx: WhenClauseContext = {
      activeLanguageId: vscode.window.activeTextEditor?.document.languageId,
      folderName: folder?.name,
      folderPath: folder?.uri.fsPath,
    };
    const visible = [...buttons, ...npmButtons].filter(b => evaluateWhenClause(b.when, ctx));
    statusBar.update(visible);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('null-actions.runButton', async (buttonId: string) => {
      const { buttons } = readButtonConfigs();
      const npmButtons = loadNpmButtons();
      const button = [...buttons, ...npmButtons].find(b => b.id === buttonId);
      if (!button) { return; }
      await runButton(button, terminalRegistry);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('null-actions')) {
        refresh();
        settingsProvider.refresh();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => refresh()),
  );

  refresh();
}

export function deactivate(): void {}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd extensions/null-actions && npm run compile`
Expected: exits 0.

- [ ] **Step 3: Run the full test suite once more**

Run: `cd extensions/null-actions && npm run test`
Expected: PASS (40 tests total, unchanged from Task 6 — `extension.ts` itself has no unit tests per the Global Constraints).

- [ ] **Step 4: Manual verification in a dev Extension Host**

This extension can't be exercised by the repo's CI build locally (per `CLAUDE.md`, builds only run in GitHub Actions), but its `.ts` sources can be manually smoke-tested by opening `extensions/null-actions/` in a stock VS Code / VSCodium and pressing F5 (Run Extension). Check:
- A button added via `null-actions.buttons` in workspace settings appears in the status bar and runs its command in a dedicated terminal on click.
- Clicking the same button twice reuses the same terminal (no duplicate terminal appears).
- Reloading the window (`Developer: Reload Window`) and clicking the button again still reuses one terminal, not a second one.
- The "Action Buttons" view appears under the workspace container, lists configured buttons, and Save All persists edits back to `settings.json`.
- A workspace containing a `Cargo.toml` shows cargo suggestions in the "Suggested" list.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-actions/src/extension.ts
git commit -m "feat(null-actions): wire status bar, settings panel, and command dispatch together"
```

---

### Task 12: Build integration — `build.yml` and `CLAUDE.md`

**Files:**
- Modify: `.github/workflows/build.yml`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing (build/doc plumbing only).
- Produces: nothing consumed by other tasks — this is the final task.

- [ ] **Step 1: Add a compile step to `build.yml`**

In `.github/workflows/build.yml`, immediately after the existing "Compile null-cpp TypeScript" step (around line 172), add:
```yaml
      - name: Compile null-actions TypeScript
        shell: pwsh
        run: |
          Set-Location ide-overlay/extensions/null-actions
          npm ci --ignore-scripts
          npm run compile
```

- [ ] **Step 2: Add the copy line to the "Copy built-in extensions" step**

In the same file, in the "Copy built-in extensions" step, add a line after the `null-cpp` copy:
```yaml
          Copy-Item -Recurse -Force ide-overlay/extensions/null-actions    vscode-src/extensions/
```

- [ ] **Step 3: Update `CLAUDE.md`**

In `CLAUDE.md`'s Repository Layout tree, add `null-actions/` alongside the other extensions, and add `null-cpp/` too (missing from the current tree — a pre-existing doc gap noted during this feature's design). In the "Built-in Extensions" section, add a `### null-actions (\`extensions/null-actions/\`)` subsection documenting:
```markdown
### null-actions (`extensions/null-actions/`)
Status-bar buttons that run shell commands (via a dedicated, deterministically-reused
terminal per button) or VS Code API commands. Configured through the "Action Buttons"
webview panel (in the `null-workspace` view container) or directly via the
`null-actions.buttons` setting. Supports variable substitution
(`${workspaceFolder}`, `${file}`, `${selectedText}`, etc.), per-button visibility
filters (`when.languages`, `when.filesExist`, `when.folder`), left/right status-bar
alignment with priority ordering, project-type-detection suggestions (Cargo.toml,
CMakeLists.txt, *.csproj), and optional npm-script auto-loading
(`null-actions.npm.autoLoad`).
```
Also update the sentence "Five built-in extensions bundled at build time" near the top to reflect the current count (it's already stale — six extensions exist today counting `null-cpp`; this task brings it to seven counting `null-actions`).

- [ ] **Step 4: Verify YAML validity**

Run: `cd d:\Coding\Apps\null-ide && python -c "import yaml; yaml.safe_load(open('.github/workflows/build.yml'))"` (or any available YAML linter) to confirm the edit didn't break indentation.
Expected: no error.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/build.yml CLAUDE.md
git commit -m "build: bundle null-actions as a sixth built-in extension"
```

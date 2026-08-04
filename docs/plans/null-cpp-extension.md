# Null C++ Extension (`null-cpp`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Add a new built-in extension, `null-cpp`, providing symbol-aware C/C++ header/source switching, auto-paired split editors with scroll sync, and `.hpp`/`.cpp` class scaffolding, on top of the (separately installed) clangd extension.

**Architecture:** A new `extensions/null-cpp/` extension (mirroring `wooting-analog`'s layout) with a hard `extensionDependencies` entry on clangd. Each feature is built from a pure, unit-testable logic module (no `vscode` import) plus a thin `vscode`-touching wiring module that isn't unit-tested but is verified via `tsc` type-checking and a manual end-to-end pass. Shared infrastructure (the clangd LSP bridge, the document-symbol cache) is factored out so both the switch feature and the paired-split feature reuse it.

**Tech Stack:** TypeScript (`strict`, ES2022, commonjs — matching `null-tools`/`wooting-analog`), `node --test` for pure-logic unit tests, VS Code Extension API (`vscode` module), clangd's exported extension API (`llvm-vs-code-extensions.vscode-clangd`).

## Global Constraints

- Work only inside `D:\Coding\Apps\null-ide\` and its subdirectories; do not touch system PATH, registry, or any existing VS Code/VSCodium install outside this repo (`CLAUDE.md`).
- Do not run the CI/build pipeline locally — it only runs on GitHub Actions' `windows-2022` runner (`CLAUDE.md`). `npm run compile` / `npm test` inside `extensions/null-cpp/` are fine to run locally; the full VSCodium build is not.
- `"engines": { "vscode": "^1.85.0" }` — matches every other built-in extension's floor.
- `tsconfig.json`: `target: ES2022`, `module: commonjs`, `strict: true`, `sourceMap: true`, `esModuleInterop: true`, `skipLibCheck: true` — matches `null-tools`/`wooting-analog`.
- Compiled `out/*.js` is committed to the repo (not gitignored), matching `null-tools` and `wooting-analog` — never hand-edit those compiled files, only the `.ts` sources.
- `publisher: "null"` — matches `null-tools` (not `wooting-analog`'s `"you"`, which is an outlier, not a convention to repeat).
- `extensionDependencies: ["llvm-vs-code-extensions.vscode-clangd"]` — the exact clangd extension ID; this ordering guarantee (dependencies activate first) is what makes the `Alt+O` keybinding override deterministic — see the design spec's Architecture section.
- Any file that has a unit test must not `import` the `vscode` module (even transitively) — `node --test` runs the compiled JS in plain Node, where `require('vscode')` throws. This is the existing convention behind `null-tools`'s `*Storage.ts` (pure, tested) vs `*Integration.ts` (vscode-touching, untested) split (e.g. `scratchNotesStorage.ts` / `scratchNotesIntegration.ts`).

---

## File Structure

```
extensions/null-cpp/
├── package.json
├── package-lock.json
├── tsconfig.json
├── src/
│   ├── extension.ts          — activation entry point
│   ├── symbolTree.ts         — PURE: tree walk, qualified-name matching
│   ├── symbolTree.test.ts
│   ├── pairRegistry.ts       — PURE: pairing map + loop guard
│   ├── pairRegistry.test.ts
│   ├── scaffoldNaming.ts     — PURE: name validation, file naming/content
│   ├── scaffoldNaming.test.ts
│   ├── cppLanguage.ts        — vscode-touching: C/C++ document check
│   ├── clangdBridge.ts       — vscode-touching: clangd API + raw LSP request
│   ├── symbolCache.ts        — vscode-touching: per-doc DocumentSymbol cache
│   ├── symbolSwitch.ts       — feature #1: null-cpp.switchSourceHeader command
│   ├── pairedSplit.ts        — feature #2: auto-open + scroll sync listeners
│   └── scaffold.ts           — feature #3: null-cpp.newClass command
└── out/                      — compiled JS, committed
```

Also modified: `.github/workflows/build.yml` (compile + copy steps for the sixth built-in extension).

---

### Task 1: Extension scaffold + symbol tree walk (pure, tested)

**Files:**
- Create: `extensions/null-cpp/package.json`
- Create: `extensions/null-cpp/tsconfig.json`
- Create: `extensions/null-cpp/src/extension.ts`
- Create: `extensions/null-cpp/src/symbolTree.ts`
- Test: `extensions/null-cpp/src/symbolTree.test.ts`

**Interfaces:**
- Produces: `SymbolPosition { line: number; character: number }`, `SymbolRange { start: SymbolPosition; end: SymbolPosition }`, `SymbolNode { name: string; range: SymbolRange; children: SymbolNode[] }`, `EnclosingSymbol { node: SymbolNode; qualifiedName: string }`, `findEnclosingSymbol(symbols: SymbolNode[], position: SymbolPosition): EnclosingSymbol | undefined`, `findSymbolByQualifiedName(symbols: SymbolNode[], qualifiedName: string): SymbolNode | undefined` — all exported from `./symbolTree`, consumed by `symbolCache.ts` in Task 5.

- [ ] **Step 1: Create the extension package files**

`extensions/null-cpp/package.json`:
```json
{
  "name": "null-cpp",
  "displayName": "Null C++",
  "description": "Symbol-aware C++ header/source navigation, paired editors, and class scaffolding for Null IDE",
  "version": "1.0.0",
  "publisher": "null",
  "license": "MIT",
  "engines": { "vscode": "^1.85.0" },
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "extensionDependencies": ["llvm-vs-code-extensions.vscode-clangd"],
  "scripts": {
    "compile": "tsc -p tsconfig.json",
    "test": "tsc -p tsconfig.json && node --test out/symbolTree.test.js"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "@types/vscode": "^1.85.0",
    "@types/node": "^22.0.0"
  },
  "contributes": {
    "commands": [],
    "keybindings": [],
    "configuration": { "title": "Null C++", "properties": {} },
    "menus": { "explorer/context": [], "commandPalette": [] }
  }
}
```

`extensions/null-cpp/tsconfig.json`:
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
    "src/symbolTree.ts",
    "src/symbolTree.test.ts"
  ]
}
```

`extensions/null-cpp/src/extension.ts` (stub — filled in by Task 9):
```ts
import * as vscode from 'vscode';

export function activate(_context: vscode.ExtensionContext): void {}

export function deactivate(): void {}
```

- [ ] **Step 2: Install dependencies**

Run: `cd extensions/null-cpp && npm install`
Expected: `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 3: Write the failing test for the symbol tree walk**

`extensions/null-cpp/src/symbolTree.test.ts`:
```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { findEnclosingSymbol, findSymbolByQualifiedName, SymbolNode } from './symbolTree';

function tree(): SymbolNode[] {
  return [
    {
      name: 'Foo',
      range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
      children: [
        {
          name: 'Bar',
          range: { start: { line: 1, character: 0 }, end: { line: 9, character: 1 } },
          children: [
            {
              name: 'baz',
              range: { start: { line: 3, character: 2 }, end: { line: 6, character: 3 } },
              children: [],
            },
          ],
        },
      ],
    },
  ];
}

test('findEnclosingSymbol returns the innermost symbol containing the position', () => {
  const result = findEnclosingSymbol(tree(), { line: 4, character: 5 });
  assert.equal(result?.qualifiedName, 'Foo::Bar::baz');
});

test('findEnclosingSymbol falls back to an outer symbol when no child contains the position', () => {
  const result = findEnclosingSymbol(tree(), { line: 0, character: 5 });
  assert.equal(result?.qualifiedName, 'Foo');
});

test('findEnclosingSymbol returns undefined when nothing contains the position', () => {
  const result = findEnclosingSymbol(tree(), { line: 20, character: 0 });
  assert.equal(result, undefined);
});

test('findEnclosingSymbol treats range boundaries as inclusive', () => {
  const atStart = findEnclosingSymbol(tree(), { line: 3, character: 2 });
  const atEnd = findEnclosingSymbol(tree(), { line: 6, character: 3 });
  assert.equal(atStart?.qualifiedName, 'Foo::Bar::baz');
  assert.equal(atEnd?.qualifiedName, 'Foo::Bar::baz');
});

test('findSymbolByQualifiedName finds a nested symbol', () => {
  const match = findSymbolByQualifiedName(tree(), 'Foo::Bar::baz');
  assert.equal(match?.name, 'baz');
});

test('findSymbolByQualifiedName finds a top-level symbol', () => {
  const match = findSymbolByQualifiedName(tree(), 'Foo');
  assert.equal(match?.name, 'Foo');
});

test('findSymbolByQualifiedName returns undefined for an unknown name', () => {
  assert.equal(findSymbolByQualifiedName(tree(), 'Foo::Bar::nope'), undefined);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd extensions/null-cpp && npm test`
Expected: FAIL — `tsc` reports `Cannot find module './symbolTree'` (the module doesn't exist yet).

- [ ] **Step 5: Implement the symbol tree walk**

`extensions/null-cpp/src/symbolTree.ts`:
```ts
export interface SymbolPosition {
  line: number;
  character: number;
}

export interface SymbolRange {
  start: SymbolPosition;
  end: SymbolPosition;
}

export interface SymbolNode {
  name: string;
  range: SymbolRange;
  children: SymbolNode[];
}

export interface EnclosingSymbol {
  node: SymbolNode;
  qualifiedName: string;
}

function isPositionInRange(position: SymbolPosition, range: SymbolRange): boolean {
  if (position.line < range.start.line || position.line > range.end.line) {
    return false;
  }
  if (position.line === range.start.line && position.character < range.start.character) {
    return false;
  }
  if (position.line === range.end.line && position.character > range.end.character) {
    return false;
  }
  return true;
}

export function findEnclosingSymbol(
  symbols: SymbolNode[],
  position: SymbolPosition,
  ancestors: string[] = []
): EnclosingSymbol | undefined {
  for (const node of symbols) {
    if (!isPositionInRange(position, node.range)) {
      continue;
    }
    const qualifiedName = [...ancestors, node.name].join('::');
    const childMatch = findEnclosingSymbol(node.children, position, [...ancestors, node.name]);
    return childMatch ?? { node, qualifiedName };
  }
  return undefined;
}

export function findSymbolByQualifiedName(
  symbols: SymbolNode[],
  qualifiedName: string,
  ancestors: string[] = []
): SymbolNode | undefined {
  for (const node of symbols) {
    const nodeName = [...ancestors, node.name].join('::');
    if (nodeName === qualifiedName) {
      return node;
    }
    const childMatch = findSymbolByQualifiedName(node.children, qualifiedName, [...ancestors, node.name]);
    if (childMatch) {
      return childMatch;
    }
  }
  return undefined;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd extensions/null-cpp && npm test`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add extensions/null-cpp/package.json extensions/null-cpp/package-lock.json extensions/null-cpp/tsconfig.json extensions/null-cpp/src/extension.ts extensions/null-cpp/src/symbolTree.ts extensions/null-cpp/src/symbolTree.test.ts
git commit -m "feat(null-cpp): scaffold extension and add symbol tree walk"
```

---

### Task 2: Pairing registry (pure, tested)

**Files:**
- Create: `extensions/null-cpp/src/pairRegistry.ts`
- Test: `extensions/null-cpp/src/pairRegistry.test.ts`
- Modify: `extensions/null-cpp/tsconfig.json`
- Modify: `extensions/null-cpp/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `class PairRegistry { record(uriA: string, uriB: string): void; getCounterpart(uri: string): string | undefined; has(uri: string): boolean; remove(uri: string): void; }` exported from `./pairRegistry`, consumed by `pairedSplit.ts` in Task 7.

- [ ] **Step 1: Write the failing test**

`extensions/null-cpp/src/pairRegistry.test.ts`:
```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PairRegistry } from './pairRegistry';

test('record makes the pair discoverable from either uri', () => {
  const registry = new PairRegistry();
  registry.record('a.hpp', 'a.cpp');
  assert.equal(registry.getCounterpart('a.hpp'), 'a.cpp');
  assert.equal(registry.getCounterpart('a.cpp'), 'a.hpp');
});

test('has returns false for an untracked uri', () => {
  const registry = new PairRegistry();
  assert.equal(registry.has('a.hpp'), false);
});

test('has returns true once a uri is recorded', () => {
  const registry = new PairRegistry();
  registry.record('a.hpp', 'a.cpp');
  assert.equal(registry.has('a.hpp'), true);
  assert.equal(registry.has('a.cpp'), true);
});

test('getCounterpart returns undefined for an untracked uri', () => {
  const registry = new PairRegistry();
  assert.equal(registry.getCounterpart('a.hpp'), undefined);
});

test('remove drops the pair in both directions', () => {
  const registry = new PairRegistry();
  registry.record('a.hpp', 'a.cpp');
  registry.remove('a.hpp');
  assert.equal(registry.has('a.hpp'), false);
  assert.equal(registry.has('a.cpp'), false);
});
```

- [ ] **Step 2: Add the new files to `tsconfig.json`'s include list**

In `extensions/null-cpp/tsconfig.json`, change:
```json
  "include": [
    "src/extension.ts",
    "src/symbolTree.ts",
    "src/symbolTree.test.ts"
  ]
```
to:
```json
  "include": [
    "src/extension.ts",
    "src/symbolTree.ts",
    "src/symbolTree.test.ts",
    "src/pairRegistry.ts",
    "src/pairRegistry.test.ts"
  ]
```

- [ ] **Step 3: Add the test file to `package.json`'s test script**

In `extensions/null-cpp/package.json`, change:
```json
    "test": "tsc -p tsconfig.json && node --test out/symbolTree.test.js"
```
to:
```json
    "test": "tsc -p tsconfig.json && node --test out/symbolTree.test.js out/pairRegistry.test.js"
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd extensions/null-cpp && npm test`
Expected: FAIL — `Cannot find module './pairRegistry'`.

- [ ] **Step 5: Implement the pairing registry**

`extensions/null-cpp/src/pairRegistry.ts`:
```ts
export class PairRegistry {
  private pairs = new Map<string, string>();

  record(uriA: string, uriB: string): void {
    this.pairs.set(uriA, uriB);
    this.pairs.set(uriB, uriA);
  }

  getCounterpart(uri: string): string | undefined {
    return this.pairs.get(uri);
  }

  has(uri: string): boolean {
    return this.pairs.has(uri);
  }

  remove(uri: string): void {
    const counterpart = this.pairs.get(uri);
    this.pairs.delete(uri);
    if (counterpart !== undefined) {
      this.pairs.delete(counterpart);
    }
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd extensions/null-cpp && npm test`
Expected: PASS (12 tests total).

- [ ] **Step 7: Commit**

```bash
git add extensions/null-cpp/src/pairRegistry.ts extensions/null-cpp/src/pairRegistry.test.ts extensions/null-cpp/tsconfig.json extensions/null-cpp/package.json
git commit -m "feat(null-cpp): add pairing registry with loop-guard semantics"
```

---

### Task 3: Scaffold naming (pure, tested)

**Files:**
- Create: `extensions/null-cpp/src/scaffoldNaming.ts`
- Test: `extensions/null-cpp/src/scaffoldNaming.test.ts`
- Modify: `extensions/null-cpp/tsconfig.json`
- Modify: `extensions/null-cpp/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `validateClassName(name: string): string | undefined`, `headerFileName(name: string): string`, `sourceFileName(name: string): string`, `headerContent(): string`, `sourceContent(name: string): string` exported from `./scaffoldNaming`, consumed by `scaffold.ts` in Task 8.

- [ ] **Step 1: Write the failing test**

`extensions/null-cpp/src/scaffoldNaming.test.ts`:
```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  validateClassName,
  headerFileName,
  sourceFileName,
  headerContent,
  sourceContent,
} from './scaffoldNaming';

test('validateClassName rejects an empty name', () => {
  assert.equal(validateClassName(''), 'Class name cannot be empty.');
  assert.equal(validateClassName('   '), 'Class name cannot be empty.');
});

test('validateClassName rejects a name starting with a digit', () => {
  assert.match(
    validateClassName('123Foo') ?? '',
    /must start with a letter or underscore/
  );
});

test('validateClassName rejects a name with invalid characters', () => {
  assert.match(
    validateClassName('My Class') ?? '',
    /must start with a letter or underscore/
  );
});

test('validateClassName accepts a valid identifier', () => {
  assert.equal(validateClassName('My_Class1'), undefined);
  assert.equal(validateClassName('_private'), undefined);
});

test('headerFileName and sourceFileName append the right extensions', () => {
  assert.equal(headerFileName('Widget'), 'Widget.hpp');
  assert.equal(sourceFileName('Widget'), 'Widget.cpp');
});

test('headerContent is just pragma once', () => {
  assert.equal(headerContent(), '#pragma once\n\n');
});

test('sourceContent includes the matching header include', () => {
  assert.equal(sourceContent('Widget'), '#include "Widget.hpp"\n\n');
});
```

- [ ] **Step 2: Add the new files to `tsconfig.json`'s include list**

In `extensions/null-cpp/tsconfig.json`, change:
```json
    "src/pairRegistry.ts",
    "src/pairRegistry.test.ts"
  ]
```
to:
```json
    "src/pairRegistry.ts",
    "src/pairRegistry.test.ts",
    "src/scaffoldNaming.ts",
    "src/scaffoldNaming.test.ts"
  ]
```

- [ ] **Step 3: Add the test file to `package.json`'s test script**

In `extensions/null-cpp/package.json`, change:
```json
    "test": "tsc -p tsconfig.json && node --test out/symbolTree.test.js out/pairRegistry.test.js"
```
to:
```json
    "test": "tsc -p tsconfig.json && node --test out/symbolTree.test.js out/pairRegistry.test.js out/scaffoldNaming.test.js"
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd extensions/null-cpp && npm test`
Expected: FAIL — `Cannot find module './scaffoldNaming'`.

- [ ] **Step 5: Implement scaffold naming**

`extensions/null-cpp/src/scaffoldNaming.ts`:
```ts
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateClassName(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Class name cannot be empty.';
  }
  if (!VALID_NAME.test(trimmed)) {
    return 'Class name must start with a letter or underscore and contain only letters, numbers, and underscores.';
  }
  return undefined;
}

export function headerFileName(name: string): string {
  return `${name}.hpp`;
}

export function sourceFileName(name: string): string {
  return `${name}.cpp`;
}

export function headerContent(): string {
  return '#pragma once\n\n';
}

export function sourceContent(name: string): string {
  return `#include "${headerFileName(name)}"\n\n`;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd extensions/null-cpp && npm test`
Expected: PASS (19 tests total).

- [ ] **Step 7: Commit**

```bash
git add extensions/null-cpp/src/scaffoldNaming.ts extensions/null-cpp/src/scaffoldNaming.test.ts extensions/null-cpp/tsconfig.json extensions/null-cpp/package.json
git commit -m "feat(null-cpp): add scaffold naming/content helpers"
```

---

### Task 4: clangd bridge (vscode-touching, compile-verified)

**Files:**
- Create: `extensions/null-cpp/src/clangdBridge.ts`
- Modify: `extensions/null-cpp/tsconfig.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `type SwitchSourceHeaderResult = { kind: 'switched'; uri: vscode.Uri } | { kind: 'not-found' } | { kind: 'fallback' } | { kind: 'unavailable' }` and `switchSourceHeader(uri: vscode.Uri): Promise<SwitchSourceHeaderResult>` exported from `./clangdBridge`, consumed by `symbolSwitch.ts` (Task 6) and `pairedSplit.ts` (Task 7).

This module cannot be unit tested outside a real extension host (it calls into clangd's live language client), so this task's verification is a successful `tsc` type-check rather than `node --test`. It is still isolated in its own task because both feature tasks depend on it and neither should have to redefine it.

- [ ] **Step 1: Add the new file to `tsconfig.json`'s include list**

In `extensions/null-cpp/tsconfig.json`, change:
```json
    "src/scaffoldNaming.ts",
    "src/scaffoldNaming.test.ts"
  ]
```
to:
```json
    "src/scaffoldNaming.ts",
    "src/scaffoldNaming.test.ts",
    "src/clangdBridge.ts"
  ]
```

- [ ] **Step 2: Implement the clangd bridge**

`extensions/null-cpp/src/clangdBridge.ts`:
```ts
import * as vscode from 'vscode';

const CLANGD_EXTENSION_ID = 'llvm-vs-code-extensions.vscode-clangd';

interface ClangdLanguageClient {
  sendRequest<T>(method: string, param: unknown): Promise<T>;
}

interface ClangdApiV1 {
  languageClient: ClangdLanguageClient;
}

interface ClangdExtensionExports {
  getApi?(version: 1): ClangdApiV1;
}

export type SwitchSourceHeaderResult =
  | { kind: 'switched'; uri: vscode.Uri }
  | { kind: 'not-found' }
  | { kind: 'fallback' }
  | { kind: 'unavailable' };

let cachedClient: ClangdLanguageClient | undefined;
let warnedMissingApi = false;

export async function switchSourceHeader(uri: vscode.Uri): Promise<SwitchSourceHeaderResult> {
  const ext = vscode.extensions.getExtension<ClangdExtensionExports>(CLANGD_EXTENSION_ID);
  if (!ext) {
    return { kind: 'unavailable' };
  }

  const exports = ext.isActive ? ext.exports : await ext.activate();

  if (typeof exports.getApi !== 'function') {
    if (!warnedMissingApi) {
      warnedMissingApi = true;
      void vscode.window.showWarningMessage(
        'Null C++ needs a newer version of the clangd extension (0.1.29+) for symbol-aware navigation. Falling back to plain Alt+O.'
      );
    }
    await vscode.commands.executeCommand('clangd.switchheadersource');
    return { kind: 'fallback' };
  }

  if (!cachedClient) {
    cachedClient = exports.getApi(1).languageClient;
  }

  const result = await cachedClient.sendRequest<string | undefined>(
    'textDocument/switchSourceHeader',
    { uri: uri.toString() }
  );

  if (!result) {
    return { kind: 'not-found' };
  }
  return { kind: 'switched', uri: vscode.Uri.parse(result) };
}
```

- [ ] **Step 3: Compile to verify it type-checks**

Run: `cd extensions/null-cpp && npm run compile`
Expected: exits with no errors; `out/clangdBridge.js` is produced.

- [ ] **Step 4: Commit**

```bash
git add extensions/null-cpp/src/clangdBridge.ts extensions/null-cpp/tsconfig.json
git commit -m "feat(null-cpp): add clangd bridge for raw switchSourceHeader requests"
```

---

### Task 5: C++ language check + document symbol cache (vscode-touching, compile-verified)

**Files:**
- Create: `extensions/null-cpp/src/cppLanguage.ts`
- Create: `extensions/null-cpp/src/symbolCache.ts`
- Modify: `extensions/null-cpp/tsconfig.json`

**Interfaces:**
- Consumes: `SymbolNode`, `SymbolPosition`, `EnclosingSymbol`, `findEnclosingSymbol`, `findSymbolByQualifiedName` from `./symbolTree` (Task 1).
- Produces: `isCppDocument(doc: vscode.TextDocument): boolean` from `./cppLanguage`; `getSymbols(doc: vscode.TextDocument): Promise<SymbolNode[]>`, `invalidate(uri: vscode.Uri): void`, `findEnclosing(doc: vscode.TextDocument, position: vscode.Position): Promise<EnclosingSymbol | undefined>`, `findByQualifiedName(doc: vscode.TextDocument, qualifiedName: string): Promise<SymbolNode | undefined>` from `./symbolCache` — all consumed by `symbolSwitch.ts` (Task 6) and `pairedSplit.ts` (Task 7).

- [ ] **Step 1: Add the new files to `tsconfig.json`'s include list**

In `extensions/null-cpp/tsconfig.json`, change:
```json
    "src/clangdBridge.ts"
  ]
```
to:
```json
    "src/clangdBridge.ts",
    "src/cppLanguage.ts",
    "src/symbolCache.ts"
  ]
```

- [ ] **Step 2: Implement the C++ language check**

`extensions/null-cpp/src/cppLanguage.ts`:
```ts
import * as vscode from 'vscode';

export function isCppDocument(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'cpp' || doc.languageId === 'c';
}
```

- [ ] **Step 3: Implement the document symbol cache**

`extensions/null-cpp/src/symbolCache.ts`:
```ts
import * as vscode from 'vscode';
import { EnclosingSymbol, SymbolNode, findEnclosingSymbol, findSymbolByQualifiedName } from './symbolTree';

interface CacheEntry {
  version: number;
  symbols: SymbolNode[];
}

const cache = new Map<string, CacheEntry>();

function toSymbolNode(symbol: vscode.DocumentSymbol): SymbolNode {
  return {
    name: symbol.name,
    range: {
      start: { line: symbol.range.start.line, character: symbol.range.start.character },
      end: { line: symbol.range.end.line, character: symbol.range.end.character },
    },
    children: symbol.children.map(toSymbolNode),
  };
}

export async function getSymbols(doc: vscode.TextDocument): Promise<SymbolNode[]> {
  const key = doc.uri.toString();
  const cached = cache.get(key);
  if (cached && cached.version === doc.version) {
    return cached.symbols;
  }

  // clangd's provider always returns hierarchical DocumentSymbol, never flat SymbolInformation.
  const result = (await vscode.commands.executeCommand(
    'vscode.executeDocumentSymbolProvider',
    doc.uri
  )) as vscode.DocumentSymbol[] | undefined;

  const symbols = (result ?? []).map(toSymbolNode);
  cache.set(key, { version: doc.version, symbols });
  return symbols;
}

export function invalidate(uri: vscode.Uri): void {
  cache.delete(uri.toString());
}

export async function findEnclosing(
  doc: vscode.TextDocument,
  position: vscode.Position
): Promise<EnclosingSymbol | undefined> {
  const symbols = await getSymbols(doc);
  return findEnclosingSymbol(symbols, { line: position.line, character: position.character });
}

export async function findByQualifiedName(
  doc: vscode.TextDocument,
  qualifiedName: string
): Promise<SymbolNode | undefined> {
  const symbols = await getSymbols(doc);
  return findSymbolByQualifiedName(symbols, qualifiedName);
}
```

- [ ] **Step 4: Compile to verify it type-checks**

Run: `cd extensions/null-cpp && npm run compile`
Expected: exits with no errors; `out/cppLanguage.js` and `out/symbolCache.js` are produced.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-cpp/src/cppLanguage.ts extensions/null-cpp/src/symbolCache.ts extensions/null-cpp/tsconfig.json
git commit -m "feat(null-cpp): add C++ language check and document symbol cache"
```

---

### Task 6: Feature #1 — symbol-aware switch command

**Files:**
- Create: `extensions/null-cpp/src/symbolSwitch.ts`
- Modify: `extensions/null-cpp/tsconfig.json`
- Modify: `extensions/null-cpp/package.json`

**Interfaces:**
- Consumes: `isCppDocument` from `./cppLanguage` (Task 5); `switchSourceHeader` from `./clangdBridge` (Task 4); `findEnclosing`, `findByQualifiedName` from `./symbolCache` (Task 5).
- Produces: `registerSwitchSourceHeader(context: vscode.ExtensionContext): void` from `./symbolSwitch`, consumed by `extension.ts` (Task 9). Contributes the `null-cpp.switchSourceHeader` command.

- [ ] **Step 1: Add the new file to `tsconfig.json`'s include list**

In `extensions/null-cpp/tsconfig.json`, change:
```json
    "src/cppLanguage.ts",
    "src/symbolCache.ts"
  ]
```
to:
```json
    "src/cppLanguage.ts",
    "src/symbolCache.ts",
    "src/symbolSwitch.ts"
  ]
```

- [ ] **Step 2: Implement the switch command**

`extensions/null-cpp/src/symbolSwitch.ts`:
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

      const enclosing = await findEnclosing(editor.document, editor.selection.active);
      const result = await switchSourceHeader(editor.document.uri);
      if (result.kind !== 'switched') {
        return;
      }

      const counterpartDoc = await vscode.workspace.openTextDocument(result.uri);
      const counterpartEditor = await vscode.window.showTextDocument(counterpartDoc);

      if (!enclosing) {
        return;
      }
      const match = await findByQualifiedName(counterpartDoc, enclosing.qualifiedName);
      if (!match) {
        return;
      }

      const range = new vscode.Range(
        new vscode.Position(match.range.start.line, match.range.start.character),
        new vscode.Position(match.range.end.line, match.range.end.character)
      );
      counterpartEditor.selection = new vscode.Selection(range.start, range.start);
      counterpartEditor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    })
  );
}
```

- [ ] **Step 3: Contribute the command and keybinding in `package.json`**

In `extensions/null-cpp/package.json`, change:
```json
    "commands": [],
    "keybindings": [],
```
to:
```json
    "commands": [
      {
        "command": "null-cpp.switchSourceHeader",
        "title": "Null C++: Switch Header/Source (Symbol-Aware)"
      }
    ],
    "keybindings": [
      {
        "command": "null-cpp.switchSourceHeader",
        "key": "alt+o",
        "when": "editorTextFocus && (editorLangId == cpp || editorLangId == c)"
      }
    ],
```

And change:
```json
    "menus": { "explorer/context": [], "commandPalette": [] }
```
to:
```json
    "menus": {
      "explorer/context": [],
      "commandPalette": [
        { "command": "null-cpp.switchSourceHeader", "when": "editorLangId == cpp || editorLangId == c" }
      ]
    }
```

- [ ] **Step 4: Compile to verify it type-checks**

Run: `cd extensions/null-cpp && npm run compile`
Expected: exits with no errors; `out/symbolSwitch.js` is produced.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-cpp/src/symbolSwitch.ts extensions/null-cpp/tsconfig.json extensions/null-cpp/package.json
git commit -m "feat(null-cpp): add symbol-aware switch header/source command"
```

---

### Task 7: Feature #2 — auto-paired split + scroll sync

**Files:**
- Create: `extensions/null-cpp/src/pairedSplit.ts`
- Modify: `extensions/null-cpp/tsconfig.json`
- Modify: `extensions/null-cpp/package.json`

**Interfaces:**
- Consumes: `isCppDocument` from `./cppLanguage` (Task 5); `switchSourceHeader` from `./clangdBridge` (Task 4); `findEnclosing`, `findByQualifiedName`, `invalidate` from `./symbolCache` (Task 5); `PairRegistry` from `./pairRegistry` (Task 2).
- Produces: `registerPairedSplit(context: vscode.ExtensionContext): void` from `./pairedSplit`, consumed by `extension.ts` (Task 9). Contributes the four `null-cpp.*` settings.

- [ ] **Step 1: Add the new file to `tsconfig.json`'s include list**

In `extensions/null-cpp/tsconfig.json`, change:
```json
    "src/symbolSwitch.ts"
  ]
```
to:
```json
    "src/symbolSwitch.ts",
    "src/pairedSplit.ts"
  ]
```

- [ ] **Step 2: Implement the paired split + scroll sync wiring**

`extensions/null-cpp/src/pairedSplit.ts`:
```ts
import * as vscode from 'vscode';
import { isCppDocument } from './cppLanguage';
import { switchSourceHeader } from './clangdBridge';
import { findEnclosing, findByQualifiedName, invalidate } from './symbolCache';
import { PairRegistry } from './pairRegistry';

const SCROLL_SYNC_DEBOUNCE_MS = 120;

function getConfig<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('null-cpp').get<T>(key, fallback);
}

function findVisibleEditor(uriString: string): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uriString);
}

function closeTab(uriString: string): void {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uriString) {
        void vscode.window.tabGroups.close(tab);
      }
    }
  }
}

async function syncScroll(
  doc: vscode.TextDocument,
  position: vscode.Position,
  counterpartEditor: vscode.TextEditor
): Promise<void> {
  const enclosing = await findEnclosing(doc, position);
  if (!enclosing) {
    return;
  }
  const match = await findByQualifiedName(counterpartEditor.document, enclosing.qualifiedName);
  if (!match) {
    return;
  }
  const range = new vscode.Range(
    new vscode.Position(match.range.start.line, match.range.start.character),
    new vscode.Position(match.range.end.line, match.range.end.character)
  );
  counterpartEditor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

export function registerPairedSplit(context: vscode.ExtensionContext): void {
  const registry = new PairRegistry();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (!getConfig('autoPairSplit.enabled', true) || !isCppDocument(doc)) {
        return;
      }
      const key = doc.uri.toString();
      if (registry.has(key)) {
        return;
      }

      const result = await switchSourceHeader(doc.uri);
      if (result.kind !== 'switched') {
        return;
      }

      const counterpartKey = result.uri.toString();
      const alreadyVisible = findVisibleEditor(counterpartKey) !== undefined;
      registry.record(key, counterpartKey);
      if (alreadyVisible) {
        return;
      }

      const counterpartDoc = await vscode.workspace.openTextDocument(result.uri);
      await vscode.window.showTextDocument(counterpartDoc, {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
        preview: false,
      });
    }),

    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      const counterpart = registry.getCounterpart(key);
      registry.remove(key);
      invalidate(doc.uri);
      if (counterpart && getConfig('pairedSplit.autoCloseCounterpart', false)) {
        closeTab(counterpart);
      }
    }),

    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (!getConfig('scrollSync.enabled', true)) {
        return;
      }
      const doc = event.textEditor.document;
      const counterpartKey = registry.getCounterpart(doc.uri.toString());
      if (!counterpartKey) {
        return;
      }
      const counterpartEditor = findVisibleEditor(counterpartKey);
      if (!counterpartEditor) {
        return;
      }

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      const position = event.selections[0].active;
      debounceTimer = setTimeout(() => {
        void syncScroll(doc, position, counterpartEditor);
      }, SCROLL_SYNC_DEBOUNCE_MS);
    })
  );
}
```

- [ ] **Step 3: Contribute the four settings in `package.json`**

In `extensions/null-cpp/package.json`, change:
```json
    "configuration": { "title": "Null C++", "properties": {} },
```
to:
```json
    "configuration": {
      "title": "Null C++",
      "properties": {
        "null-cpp.autoPairSplit.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Automatically open a C/C++ file's header/source counterpart beside it when opened."
        },
        "null-cpp.scrollSync.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Sync scroll position between paired header/source editors as the cursor moves."
        },
        "null-cpp.pairedSplit.autoCloseCounterpart": {
          "type": "boolean",
          "default": false,
          "description": "Closing one half of a paired header/source split also closes the other half."
        },
        "null-cpp.scaffold.showInExplorer": {
          "type": "boolean",
          "default": true,
          "description": "Show 'New C++ Class...' in the Explorer context menu for folders."
        }
      }
    },
```

- [ ] **Step 4: Compile to verify it type-checks**

Run: `cd extensions/null-cpp && npm run compile`
Expected: exits with no errors; `out/pairedSplit.js` is produced.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-cpp/src/pairedSplit.ts extensions/null-cpp/tsconfig.json extensions/null-cpp/package.json
git commit -m "feat(null-cpp): add auto-paired split editors with scroll sync"
```

---

### Task 8: Feature #3 — class scaffolding command

**Files:**
- Create: `extensions/null-cpp/src/scaffold.ts`
- Modify: `extensions/null-cpp/tsconfig.json`
- Modify: `extensions/null-cpp/package.json`

**Interfaces:**
- Consumes: `validateClassName`, `headerFileName`, `sourceFileName`, `headerContent`, `sourceContent` from `./scaffoldNaming` (Task 3).
- Produces: `registerNewClass(context: vscode.ExtensionContext): void` from `./scaffold`, consumed by `extension.ts` (Task 9). Contributes the `null-cpp.newClass` command and its Explorer menu entry.

- [ ] **Step 1: Add the new file to `tsconfig.json`'s include list**

In `extensions/null-cpp/tsconfig.json`, change:
```json
    "src/pairedSplit.ts"
  ]
```
to:
```json
    "src/pairedSplit.ts",
    "src/scaffold.ts"
  ]
```

- [ ] **Step 2: Implement the scaffolding command**

`extensions/null-cpp/src/scaffold.ts`:
```ts
import * as vscode from 'vscode';
import {
  validateClassName,
  headerFileName,
  sourceFileName,
  headerContent,
  sourceContent,
} from './scaffoldNaming';

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function resolveTargetFolder(target: vscode.Uri | undefined): Promise<vscode.Uri | undefined> {
  if (target) {
    const stat = await vscode.workspace.fs.stat(target);
    return stat.type === vscode.FileType.Directory ? target : vscode.Uri.joinPath(target, '..');
  }
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showErrorMessage('Open a folder to create a new C++ class.');
    return undefined;
  }
  return folders[0].uri;
}

export function registerNewClass(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('null-cpp.newClass', async (target?: vscode.Uri) => {
      const folderUri = await resolveTargetFolder(target);
      if (!folderUri) {
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'C++ class/file name (no extension)',
        validateInput: validateClassName,
      });
      if (!name) {
        return;
      }

      const headerUri = vscode.Uri.joinPath(folderUri, headerFileName(name));
      const sourceUri = vscode.Uri.joinPath(folderUri, sourceFileName(name));
      if ((await fileExists(headerUri)) || (await fileExists(sourceUri))) {
        void vscode.window.showErrorMessage(
          `${headerFileName(name)} or ${sourceFileName(name)} already exists.`
        );
        return;
      }

      await vscode.workspace.fs.writeFile(headerUri, Buffer.from(headerContent(), 'utf8'));
      await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(sourceContent(name), 'utf8'));

      const headerDoc = await vscode.workspace.openTextDocument(headerUri);
      await vscode.window.showTextDocument(headerDoc);
    })
  );
}
```

- [ ] **Step 3: Contribute the command and Explorer menu entry in `package.json`**

In `extensions/null-cpp/package.json`, change:
```json
    "commands": [
      {
        "command": "null-cpp.switchSourceHeader",
        "title": "Null C++: Switch Header/Source (Symbol-Aware)"
      }
    ],
```
to:
```json
    "commands": [
      {
        "command": "null-cpp.switchSourceHeader",
        "title": "Null C++: Switch Header/Source (Symbol-Aware)"
      },
      {
        "command": "null-cpp.newClass",
        "title": "New C++ Class...",
        "icon": "$(new-file)"
      }
    ],
```

And change:
```json
    "menus": {
      "explorer/context": [],
      "commandPalette": [
        { "command": "null-cpp.switchSourceHeader", "when": "editorLangId == cpp || editorLangId == c" }
      ]
    }
```
to:
```json
    "menus": {
      "explorer/context": [
        {
          "command": "null-cpp.newClass",
          "when": "explorerResourceIsFolder && config.null-cpp.scaffold.showInExplorer",
          "group": "navigation"
        }
      ],
      "commandPalette": [
        { "command": "null-cpp.switchSourceHeader", "when": "editorLangId == cpp || editorLangId == c" },
        { "command": "null-cpp.newClass" }
      ]
    }
```

Note: right-clicking empty space in the Explorer (rather than a specific item) is routed by VS Code to the workspace root folder's own context menu, so this same `explorer/context` contribution (scoped by `explorerResourceIsFolder`) already covers that case — no separate "background" menu ID exists in VS Code's contribution point for this (unlike the Win11 shell extension in `shell-ext/`, which is a distinct OS-level concept).

- [ ] **Step 4: Compile to verify it type-checks**

Run: `cd extensions/null-cpp && npm run compile`
Expected: exits with no errors; `out/scaffold.js` is produced.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-cpp/src/scaffold.ts extensions/null-cpp/tsconfig.json extensions/null-cpp/package.json
git commit -m "feat(null-cpp): add New C++ Class scaffolding command"
```

---

### Task 9: Wire up activation

**Files:**
- Modify: `extensions/null-cpp/src/extension.ts`

**Interfaces:**
- Consumes: `registerSwitchSourceHeader` from `./symbolSwitch` (Task 6), `registerPairedSplit` from `./pairedSplit` (Task 7), `registerNewClass` from `./scaffold` (Task 8).
- Produces: the extension's real `activate`/`deactivate` exports, used by VS Code at runtime (not by any other task).

- [ ] **Step 1: Replace the stub with real activation**

In `extensions/null-cpp/src/extension.ts`, replace the entire file:
```ts
import * as vscode from 'vscode';

export function activate(_context: vscode.ExtensionContext): void {}

export function deactivate(): void {}
```
with:
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

- [ ] **Step 2: Compile and run the full test suite to verify nothing broke**

Run: `cd extensions/null-cpp && npm test`
Expected: PASS — `tsc` reports no errors, all 19 `node --test` cases still pass.

- [ ] **Step 3: Commit**

```bash
git add extensions/null-cpp/src/extension.ts
git commit -m "feat(null-cpp): wire up activation for all three features"
```

---

### Task 10: CI integration

**Files:**
- Modify: `.github/workflows/build.yml`

**Interfaces:** None — this task only changes the build pipeline, not any TypeScript module.

- [ ] **Step 1: Add a compile step for null-cpp**

In `.github/workflows/build.yml`, change:
```yaml
      - name: Compile null-tools TypeScript
        shell: pwsh
        run: |
          Set-Location ide-overlay/extensions/null-tools
          npm ci --ignore-scripts
          npm run compile

      - name: Build wooting-analog extension
```
to:
```yaml
      - name: Compile null-tools TypeScript
        shell: pwsh
        run: |
          Set-Location ide-overlay/extensions/null-tools
          npm ci --ignore-scripts
          npm run compile

      - name: Compile null-cpp TypeScript
        shell: pwsh
        run: |
          Set-Location ide-overlay/extensions/null-cpp
          npm ci --ignore-scripts
          npm run compile

      - name: Build wooting-analog extension
```

- [ ] **Step 2: Add null-cpp to the built-in extension copy step**

In `.github/workflows/build.yml`, change:
```yaml
      - name: Copy built-in extensions
        shell: pwsh
        run: |
          Copy-Item -Recurse -Force ide-overlay/extensions/null-theme      vscode-src/extensions/
          Copy-Item -Recurse -Force ide-overlay/extensions/null-tools      vscode-src/extensions/
          Copy-Item -Recurse -Force ide-overlay/extensions/null-icons      vscode-src/extensions/
          Copy-Item -Recurse -Force ide-overlay/extensions/null-markdown   vscode-src/extensions/
          Copy-Item -Recurse -Force ide-overlay/extensions/wooting-analog  vscode-src/extensions/
```
to:
```yaml
      - name: Copy built-in extensions
        shell: pwsh
        run: |
          Copy-Item -Recurse -Force ide-overlay/extensions/null-theme      vscode-src/extensions/
          Copy-Item -Recurse -Force ide-overlay/extensions/null-tools      vscode-src/extensions/
          Copy-Item -Recurse -Force ide-overlay/extensions/null-icons      vscode-src/extensions/
          Copy-Item -Recurse -Force ide-overlay/extensions/null-markdown   vscode-src/extensions/
          Copy-Item -Recurse -Force ide-overlay/extensions/wooting-analog  vscode-src/extensions/
          Copy-Item -Recurse -Force ide-overlay/extensions/null-cpp        vscode-src/extensions/
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: build and bundle null-cpp as a sixth built-in extension"
```

No local verification is possible for this step — per `CLAUDE.md`, the build only runs in GitHub Actions (`windows-2022`). Verified in Task 11 via an actual `workflow_dispatch` run.

---

### Task 11: Manual end-to-end verification

**Files:** None — this task changes no code; it confirms the feature works in a real build.

This isn't unit-testable: it depends on a real compiled Null IDE build, a real clangd installation, and real editor layout/focus state.

- [ ] **Step 1: Trigger a build**

Trigger a `workflow_dispatch` run of `.github/workflows/build.yml` and install the resulting ZIP or installer.

- [ ] **Step 2: Verify clangd auto-installs**

Open Null IDE fresh (or a profile without clangd already installed); confirm the clangd extension is installed automatically alongside `null-cpp` (via `extensionDependencies`).

- [ ] **Step 3: Verify symbol-aware switch**

Open a C++ project with a `compile_commands.json` clangd can use. Place the cursor inside a method body in a `.cpp` file, press `Alt+O`. Confirm it lands on that method's declaration in the `.hpp`, not line 0.

- [ ] **Step 4: Verify auto-paired split**

With `null-cpp.autoPairSplit.enabled` at its default (`true`), open a `.cpp` file. Confirm its `.hpp` opens beside it without stealing focus, and isn't reopened a second time if it's already visible.

- [ ] **Step 5: Verify scroll sync**

Move the cursor between two different methods in one pane of a paired split. Confirm the other pane scrolls to the matching method without moving its own cursor or fighting manual scrolling there.

- [ ] **Step 6: Verify close lifecycle**

With `null-cpp.pairedSplit.autoCloseCounterpart` at its default (`false`), close one half of a pair; confirm the other stays open. Toggle the setting to `true` and repeat; confirm the counterpart now closes too.

- [ ] **Step 7: Verify scaffolding**

Right-click a folder in the Explorer → "New C++ Class..." → enter a name. Confirm both `<Name>.hpp` and `<Name>.cpp` are created with the expected boilerplate and open paired (assuming `autoPairSplit.enabled`).

- [ ] **Step 8: Verify the Explorer menu toggle**

Set `null-cpp.scaffold.showInExplorer` to `false`; confirm "New C++ Class..." disappears from the Explorer context menu.

No commit for this task — it's a verification pass, not a code change. If any step fails, return to the relevant task above, fix it, and re-run the full `npm test` for that extension before re-verifying end to end.

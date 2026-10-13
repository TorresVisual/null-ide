# Null Env — Environment Check Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Add a `null-env` built-in extension that reports missing companion extensions and CLI tools per project, fixes them in one click, and replaces the duplicated detection/tool-lookup code in `null-format`, `null-actions` and `null-cpp`.

**Architecture:** `null-env` is a workspace-side extension that owns one manifest→language table, one executable finder and a data-only rule table; a pure `check()` turns (languages, probes) into findings. Workspace-side built-ins (`null-format`, `null-actions`, `null-cpp`) declare `extensionDependencies: ["null.null-env"]` and use its exports; `null-tools` (UI-side) reads findings through the `null.env.getFindings` command.

**Tech Stack:** TypeScript (CommonJS, ES2022), `node --test` for unit tests, mocha + `@vscode/test-electron` for the integration spec, no runtime dependencies.

**Spec:** [docs/specs/null-env-environment-check-design.md](../specs/null-env-environment-check-design.md)

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

- Work only inside `D:\Coding\Apps\null-ide\`. Commands below run from the repo root in Git Bash (forward slashes) unless a `cd` is shown.
- The working tree already has unrelated modified files (`.impeccable/config.json`, `docs/plans/explorer-preview-integration.md`, `docs/plans/null-markdown-editor.md`, `extensions/null-markdown/**`). **Stage only the paths each step names. Never `git add -A` / `git add .`.**
- Every commit message ends with a blank line and `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push, never amend, never `--no-verify`.
- `out/` (and `lib/`) are tracked in git. Never hand-edit them. After editing `src/`, run `npm run compile` in that extension and commit the refreshed output as a separate `chore: refresh <ext> compiled output` commit (repo convention).
- `npm test` runs an explicit list of `out/**/*.test.js` files in each `package.json`'s `test` script; a new test file is skipped until it is added there. `null-cpp` and `null-actions` also list every source file in `tsconfig.json`'s `include`; a new file must be added there.
- Extension id is `null.null-env` (publisher `null`, name `null-env`). Commands: `null.env.check` (contributed), `null.env.getFindings` (internal, not contributed).
- No local fallback in consumers: a fallback would be a fourth copy of the logic. Consumers use `getEnvApi()` and nothing else.
- Out of scope: installing CLI toolchains; re-adding third-party `extensionDependencies`. `extensionDependencies: ["null.null-env"]` (built-in → built-in) is in scope.
- Do not run `scripts/build-local.ps1`. Use `scripts/sync-local.ps1` + the integration spec only in the final verification task.

## Review Focus

Input classes the spec implies but no one asked for; each has a pinning test in the task named.

1. A workspace folder that cannot be read (deleted, virtual `vscode-vfs://`, permissions): detection returns `[]` and only the `all`-language rules (Claude Code) can appear; nothing throws. — Task 2 (`detectProjects`/`detectLanguages` tests).
2. `PATH` is fixed when the extension host launches, so a CLI installed afterwards stays "missing" until restart, while well-known dirs (`~/.cargo/bin`, LLVM) are re-read on every check. — Task 2 (`findExecutable` takes an explicit dir list) and Task 4 (the QuickPick re-runs the check on open).
3. Windows shims: `claude` installed via npm is `claude.cmd`, not `claude.exe`. — Task 2 (`executableNames` honours `PATHEXT`).
4. Multi-root workspaces repeat a language: every requirement is still reported once. — Task 3 (`check` with `['cpp','cpp']`).
5. The status bar warning snoozed for a workspace must reappear when a *new* required item goes missing. — Task 3 (`visibleRequired` signature test).

---

### Task 1: Ship recommendations and fix stale docs

Small, independent, lands first (the issue calls the `extensionRecommendations` line out as shippable alone).

**Files:**
- Modify: `product.json:51-68`
- Modify: `docs/ROADMAP.md` (the "Key decision — new dependencies" paragraph near line 59, and the checklist line near 286)
- Modify: `docs/specs/null-env-environment-check-design.md` (record the refinements this plan makes)

**Interfaces:** none.

- [ ] **Step 1: Add the two recommendations to `product.json`**

Replace
```json
			{
				"extensionId": "eamodio.gitlens",
				"reason": "Enhanced Git history and blame"
			}
		],
```
with
```json
			{
				"extensionId": "eamodio.gitlens",
				"reason": "Enhanced Git history and blame"
			},
			{
				"extensionId": "anthropic.claude-code",
				"reason": "Claude Code, Null IDE's AI workflow"
			},
			{
				"extensionId": "rust-lang.rust-analyzer",
				"reason": "Rust language support"
			}
		],
```

- [ ] **Step 2: Validate the JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('product.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit the recommendations on their own**

```bash
git add product.json
git commit -m "feat: recommend the Claude Code and rust-analyzer extensions (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Fix the ROADMAP**

In `docs/ROADMAP.md`, with the Edit tool, replace the exact text
```
requires two new
`extensionDependencies`: `ms-vscode.cpptools`
```
with
```
uses two companion extensions, no longer declared as
`extensionDependencies` (dropped in 1f7c00b so null-cpp activates standalone; the Null Env check, #89, reports them when missing): `ms-vscode.cpptools`
```
and replace the line beginning `- [x] Add \`ms-vscode.cpptools\` (WSL/native Clang/GCC via \`cppdbg\`) and \`vadimcn.vscode-lldb\`` through `to \`extensionDependencies\`;` — i.e. the substring
```
to `extensionDependencies`; set
```
with
```
as companions (originally `extensionDependencies`, dropped in 1f7c00b; the Null Env check, #89, reports them when missing); set
```

- [ ] **Step 5: Record the plan's refinements in the spec**

In `docs/specs/null-env-environment-check-design.md`:
- In "Modules → `detect.ts`", replace the sentence beginning "`detectLanguages(folderPath, deps)` with injected fs." with: "`detectProjects(folderPath, listDir?)` returns one `{ language, manifest }` per matched manifest (null-actions maps manifests to buttons); `detectLanguages` is its unique-language projection. `listDir` is injectable for tests."
- In "Rules", change the cpp line so `gdb-or-lldb` and `clangd` (tool) are `recommended` (clangd's extension can download clangd itself; MSVC presets debug through CodeLLDB and need no gdb).
- In "Migration → null-format", replace "becomes a thin wrapper that delegates to null-env (keeps its configured-path and bundled-binary precedence); its duplicated finder is deleted." with "is deleted; the providers call null-env's `findRustfmtPath` / `findClangFormatPath`, which keep the configured-path → bundled-binary → known-locations → PATH precedence."
- In "Migration → null-cpp", replace "`toolchainRegistry.findOnPath` delegates to null-env" with "`toolchainRegistry.findOnPath` calls an injected finder that `extension.ts` points at null-env's `findExecutable` (keeps `toolchainRegistry.ts` free of `vscode` so its tests run in plain Node)".
- In "Surfaces → Status bar warning", append: "The QuickPick also offers *Hide this warning for this workspace*, which stores the set of missing required ids; the item reappears when that set changes."

- [ ] **Step 6: Commit the docs**

```bash
git add docs/ROADMAP.md docs/specs/null-env-environment-check-design.md
git commit -m "docs: fix stale extensionDependencies in ROADMAP, refine null-env spec (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: null-env scaffold, `detect` and `probe`

**Files:**
- Create: `extensions/null-env/package.json`
- Create: `extensions/null-env/tsconfig.json`
- Create: `extensions/null-env/src/types.ts`
- Create: `extensions/null-env/src/detect.ts`, `extensions/null-env/src/detect.test.ts`
- Create: `extensions/null-env/src/probe.ts`, `extensions/null-env/src/probe.test.ts`
- Create (generated): `extensions/null-env/package-lock.json`, `extensions/null-env/out/**`

**Interfaces:**
- Produces (`types.ts`): `Language`, `Severity`, `Fix`, `Requirement`, `Finding`, `Probes` (exact shapes in Step 3).
- Produces (`detect.ts`): `interface DetectedProject { language: Language; manifest: string }`, `detectProjects(folderPath: string, listDir?: (p: string) => string[]): DetectedProject[]`, `detectLanguages(folderPath: string, listDir?: (p: string) => string[]): Language[]`.
- Produces (`probe.ts`): `executableNames(name, isWindows?, pathext?): string[]`, `extraToolDirs(): string[]`, `findExecutable(name: string, dirs?: readonly string[]): string | null`, `findExecutableOnPath(name: string): string | null`, `findBundledBinary(extensionPath: string, binaryName: string): string | null`, `findClangFormatPath(configuredPath?: string, extensionPath?: string): string | null`, `findRustfmtPath(configuredPath?: string, extensionPath?: string): string | null`.

- [ ] **Step 1: Create `package.json`**

`extensions/null-env/package.json`:
```json
{
  "name": "null-env",
  "displayName": "Null Environment",
  "description": "Environment check for Null IDE — finds missing companion extensions and CLI tools per project and fixes them in one click",
  "version": "1.0.0",
  "publisher": "null",
  "license": "MIT",
  "engines": {
    "vscode": "^1.93.0"
  },
  "main": "./out/extension.js",
  "activationEvents": [
    "onStartupFinished"
  ],
  "contributes": {
    "commands": [
      {
        "command": "null.env.check",
        "title": "Null: Check Environment"
      }
    ]
  },
  "scripts": {
    "compile": "tsc -p tsconfig.json",
    "test": "tsc -p tsconfig.json && node --test out/detect.test.js out/probe.test.js out/rules.test.js out/check.test.js",
    "pretest:integration": "tsc -p tsconfig.json",
    "test:integration": "node ./out/test/runTest.js"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "@types/vscode": "^1.93.0",
    "@types/node": "^22.0.0",
    "@vscode/test-electron": "^3.1.0",
    "mocha": "^11.8.0",
    "@types/mocha": "^10.0.10",
    "glob": "^13.0.6"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json` and install**

`extensions/null-env/tsconfig.json`:
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
    "skipLibCheck": true,
    "types": ["node", "mocha"]
  },
  "include": ["src/**/*.ts"]
}
```
Run: `cd extensions/null-env && npm install`
Expected: creates `package-lock.json` and an ignored `node_modules/`.

- [ ] **Step 3: Create `src/types.ts`**

```ts
export type Language = 'cpp' | 'rust' | 'node' | 'dotnet';
export type Severity = 'required' | 'recommended';

export type Fix =
  | { kind: 'install'; extensionId: string }
  | { kind: 'url'; url: string };

export interface Requirement {
  id: string;
  label: string;
  /** Languages that make this requirement apply, or `'all'` for every workspace. */
  languages: readonly Language[] | 'all';
  kind: 'extension' | 'tool';
  /** Satisfied when any one of these is present: extension ids, or executable names without extension. */
  anyOf: readonly string[];
  severity: Severity;
  fix: Fix;
}

/** A requirement that is not met. Plain JSON, so it can cross extension hosts as a command result. */
export type Finding = Omit<Requirement, 'languages'>;

/** What `check` needs to know about the machine; bound to `vscode` and the file system in `probes.ts`. */
export interface Probes {
  hasExtension(id: string): boolean;
  hasTool(name: string): boolean;
}
```

- [ ] **Step 4: Write the failing `detect` tests**

`src/detect.test.ts`:
```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { detectLanguages, detectProjects } from './detect';

const list = (names: string[]) => () => names;

test('an empty folder has no projects and no languages', () => {
  assert.deepEqual(detectProjects('/x', list([])), []);
  assert.deepEqual(detectLanguages('/x', list([])), []);
});

test('each manifest maps to its language', () => {
  assert.deepEqual(detectProjects('/x', list(['Cargo.toml'])), [{ language: 'rust', manifest: 'Cargo.toml' }]);
  assert.deepEqual(detectProjects('/x', list(['CMakeLists.txt'])), [{ language: 'cpp', manifest: 'CMakeLists.txt' }]);
  assert.deepEqual(detectProjects('/x', list(['compile_commands.json'])), [{ language: 'cpp', manifest: 'compile_commands.json' }]);
  assert.deepEqual(detectProjects('/x', list(['.clangd'])), [{ language: 'cpp', manifest: '.clangd' }]);
  assert.deepEqual(detectProjects('/x', list(['package.json'])), [{ language: 'node', manifest: 'package.json' }]);
});

test('a .csproj file of any name is a dotnet project, reported once', () => {
  assert.deepEqual(
    detectProjects('/x', list(['App.csproj', 'Lib.csproj'])),
    [{ language: 'dotnet', manifest: '.csproj' }],
  );
});

test('manifest names match case-insensitively', () => {
  assert.deepEqual(detectProjects('/x', list(['cmakelists.txt'])), [{ language: 'cpp', manifest: 'CMakeLists.txt' }]);
});

test('results follow the table order: Cargo, CMake, then the rest', () => {
  const manifests = detectProjects('/x', list(['CMakeLists.txt', 'Cargo.toml', 'package.json', 'A.csproj'])).map(p => p.manifest);
  assert.deepEqual(manifests, ['Cargo.toml', 'CMakeLists.txt', 'package.json', '.csproj']);
});

test('detectLanguages returns each language once', () => {
  const languages = detectLanguages('/x', list(['CMakeLists.txt', 'compile_commands.json', '.clangd', 'Cargo.toml']));
  assert.deepEqual(languages, ['rust', 'cpp']);
});

test('an unreadable folder yields nothing instead of throwing', () => {
  const boom = () => { throw new Error('ENOENT'); };
  assert.deepEqual(detectProjects('/missing', boom), []);
  assert.deepEqual(detectLanguages('/missing', boom), []);
});
```

- [ ] **Step 5: Run it to see it fail**

Run: `cd extensions/null-env && npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './detect'`.

- [ ] **Step 6: Implement `src/detect.ts`**

```ts
import * as fs from 'node:fs';
import type { Language } from './types';

export interface DetectedProject {
  language: Language;
  /** The canonical manifest name (the suffix, e.g. `.csproj`, for suffix matches). */
  manifest: string;
}

interface Matcher {
  language: Language;
  exact?: string;
  suffix?: string;
}

// The one manifest -> language table. Order is the order results are reported in.
const MATCHERS: readonly Matcher[] = [
  { language: 'rust', exact: 'Cargo.toml' },
  { language: 'cpp', exact: 'CMakeLists.txt' },
  { language: 'cpp', exact: 'compile_commands.json' },
  { language: 'cpp', exact: '.clangd' },
  { language: 'node', exact: 'package.json' },
  { language: 'dotnet', suffix: '.csproj' },
];

const defaultListDir = (folderPath: string): string[] => fs.readdirSync(folderPath);

export function detectProjects(folderPath: string, listDir: (p: string) => string[] = defaultListDir): DetectedProject[] {
  let names: string[];
  try {
    names = listDir(folderPath).map(n => n.toLowerCase());
  } catch {
    return [];
  }
  const found: DetectedProject[] = [];
  for (const m of MATCHERS) {
    const hit = names.some(n => (m.exact ? n === m.exact.toLowerCase() : n.endsWith(m.suffix!)));
    if (hit) {
      found.push({ language: m.language, manifest: (m.exact ?? m.suffix)! });
    }
  }
  return found;
}

export function detectLanguages(folderPath: string, listDir?: (p: string) => string[]): Language[] {
  return [...new Set(detectProjects(folderPath, listDir).map(p => p.language))];
}
```

- [ ] **Step 7: Write the `probe` tests (the three moved from null-format, plus new ones)**

`src/probe.test.ts`:
```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  executableNames,
  findBundledBinary,
  findClangFormatPath,
  findExecutable,
  findRustfmtPath,
} from './probe';

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-env-probe-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('executableNames', () => {
  it('expands PATHEXT on Windows', () => {
    assert.deepEqual(executableNames('claude', true, '.EXE;.CMD'), ['claude.exe', 'claude.cmd']);
  });
  it('keeps a name that already has an extension', () => {
    assert.deepEqual(executableNames('clang-cl.exe', true, '.EXE;.CMD'), ['clang-cl.exe']);
  });
  it('is the bare name elsewhere', () => {
    assert.deepEqual(executableNames('cmake', false), ['cmake']);
  });
  it('falls back to the default PATHEXT when it is empty', () => {
    assert.ok(executableNames('node', true, '').includes('node.cmd'));
  });
});

describe('findExecutable', () => {
  it('finds a file in the given dirs, in order', () => {
    withTempDir(a => withTempDir(b => {
      const file = executableNames('faketool')[0];
      fs.writeFileSync(path.join(b, file), '');
      assert.equal(findExecutable('faketool', [a, b]), path.join(b, file));
    }));
  });
  it('returns null when absent', () => {
    withTempDir(dir => assert.equal(findExecutable('faketool', [dir]), null));
  });
  it('does not treat a directory as an executable', () => {
    withTempDir(dir => {
      fs.mkdirSync(path.join(dir, executableNames('faketool')[0]));
      assert.equal(findExecutable('faketool', [dir]), null);
    });
  });
});

describe('findBundledBinary / configured paths', () => {
  it('finds a bundled binary when present', () => {
    withTempDir(dir => {
      fs.mkdirSync(path.join(dir, 'bin'));
      const fake = path.join(dir, 'bin', process.platform === 'win32' ? 'clang-format.exe' : 'clang-format');
      fs.writeFileSync(fake, '');
      assert.equal(findBundledBinary(dir, 'clang-format'), fake);
    });
  });
  it('prioritizes an explicitly configured clang-format path', () => {
    withTempDir(dir => {
      const custom = path.join(dir, 'custom-clang-format.exe');
      fs.writeFileSync(custom, '');
      assert.equal(findClangFormatPath(custom, dir), custom);
    });
  });
  it('prioritizes an explicitly configured rustfmt path', () => {
    withTempDir(dir => {
      const custom = path.join(dir, 'custom-rustfmt.exe');
      fs.writeFileSync(custom, '');
      assert.equal(findRustfmtPath(custom, dir), custom);
    });
  });
});
```

- [ ] **Step 8: Implement `src/probe.ts`**

```ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function pathDirs(): string[] {
  return (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
}

/** File names to try for `name`: on Windows the PATHEXT variants (`claude.cmd`, `cmake.exe`), unless it already has an extension. */
export function executableNames(
  name: string,
  isWindows: boolean = process.platform === 'win32',
  pathext: string | undefined = process.env.PATHEXT,
): string[] {
  if (!isWindows || path.extname(name)) {
    return [name];
  }
  return (pathext || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
    .map(ext => name + ext.toLowerCase());
}

/** Directories tools commonly live in without being on the extension host's PATH. */
export function extraToolDirs(): string[] {
  const home = os.homedir();
  const dirs = [path.join(home, '.cargo', 'bin')];
  if (process.platform === 'win32') {
    dirs.push(
      'C:\\Program Files\\LLVM\\bin',
      'C:\\Program Files (x86)\\LLVM\\bin',
      'C:\\LLVM\\bin',
      path.join(home, 'scoop', 'apps', 'llvm', 'current', 'bin'),
      path.join(home, 'AppData', 'Local', 'Programs', 'LLVM', 'bin'),
    );
  }
  return dirs;
}

/** First match for `name` in `dirs` (default: PATH, then the well-known extra dirs). PATH is read at call time but fixed at host launch. */
export function findExecutable(
  name: string,
  dirs: readonly string[] = [...pathDirs(), ...extraToolDirs()],
): string | null {
  const names = executableNames(name);
  for (const dir of dirs) {
    for (const n of names) {
      const full = path.join(dir, n);
      if (isFile(full)) {
        return full;
      }
    }
  }
  return null;
}

export function findExecutableOnPath(name: string): string | null {
  return findExecutable(name, pathDirs());
}

export function findBundledBinary(extensionPath: string, binaryName: string): string | null {
  const nameWithExt = process.platform === 'win32' && !binaryName.endsWith('.exe') ? `${binaryName}.exe` : binaryName;
  const candidate = path.join(extensionPath, 'bin', nameWithExt);
  return isFile(candidate) ? candidate : null;
}

function findConfiguredOrBundled(name: string, configuredPath?: string, extensionPath?: string): string | null {
  // 1. Explicit user-configured path
  if (configuredPath && configuredPath.trim().length > 0 && fs.existsSync(configuredPath)) {
    return configuredPath;
  }
  // 2. Bundled binary inside the owning extension's directory
  if (extensionPath) {
    const bundled = findBundledBinary(extensionPath, name);
    if (bundled) {
      return bundled;
    }
  }
  // 3. PATH plus the well-known install dirs (cargo bin, LLVM)
  return findExecutable(name);
}

export function findClangFormatPath(configuredPath?: string, extensionPath?: string): string | null {
  return findConfiguredOrBundled('clang-format', configuredPath, extensionPath);
}

export function findRustfmtPath(configuredPath?: string, extensionPath?: string): string | null {
  return findConfiguredOrBundled('rustfmt', configuredPath, extensionPath);
}
```

- [ ] **Step 9: Run the two suites**

The `npm test` script also lists `rules`/`check` tests that do not exist yet, so run these two directly:
Run: `cd extensions/null-env && npx tsc -p tsconfig.json && node --test out/detect.test.js out/probe.test.js`
Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add extensions/null-env/package.json extensions/null-env/package-lock.json extensions/null-env/tsconfig.json extensions/null-env/src
git commit -m "feat(null-env): scaffold extension with project detection and tool lookup (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
(`out/` is committed later, in Task 4, once the extension compiles as a whole.)

---

### Task 3: `rules` and `check`

**Files:**
- Create: `extensions/null-env/src/rules.ts`, `extensions/null-env/src/rules.test.ts`
- Create: `extensions/null-env/src/check.ts`, `extensions/null-env/src/check.test.ts`

**Interfaces:**
- Consumes: `Requirement`, `Finding`, `Probes`, `Language` from `types.ts`.
- Produces (`rules.ts`): `RULES: readonly Requirement[]`, `debugExtensionFor(type: string): { extensionId: string; label: string } | undefined`.
- Produces (`check.ts`): `check(languages: readonly Language[], probes: Probes, rules?: readonly Requirement[]): Finding[]`, `requiredSignature(findings: readonly Finding[]): string`, `visibleRequired(findings: readonly Finding[], snoozedSignature: string | undefined): Finding[]`.

- [ ] **Step 1: Write the failing `rules` tests**

`src/rules.test.ts`:
```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { RULES, debugExtensionFor } from './rules';

test('requirement ids are unique and every anyOf is non-empty', () => {
  const ids = RULES.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of RULES) {
    assert.ok(r.anyOf.length > 0, r.id);
  }
});

test('an extension requirement installs one of the ids it accepts', () => {
  for (const r of RULES.filter(x => x.kind === 'extension')) {
    assert.equal(r.fix.kind, 'install', r.id);
    if (r.fix.kind === 'install') {
      assert.ok(r.anyOf.includes(r.fix.extensionId), r.id);
    }
  }
});

test('a tool requirement links to a download page', () => {
  for (const r of RULES.filter(x => x.kind === 'tool')) {
    assert.equal(r.fix.kind, 'url', r.id);
    if (r.fix.kind === 'url') {
      assert.match(r.fix.url, /^https:\/\//, r.id);
    }
  }
});

test('the issue-89 requirements are present', () => {
  const ids = new Set(RULES.map(r => r.id));
  for (const id of [
    'ext.clangd', 'ext.cpptools', 'ext.codelldb', 'ext.rust-analyzer', 'ext.claude-code',
    'tool.cmake', 'tool.clangd', 'tool.debugger', 'tool.clang-format',
    'tool.cargo', 'tool.rustfmt', 'tool.node', 'tool.claude',
  ]) {
    assert.ok(ids.has(id), id);
  }
});

test('debugExtensionFor maps the debug types null-cpp emits, and only those', () => {
  assert.deepEqual(debugExtensionFor('lldb'), { extensionId: 'vadimcn.vscode-lldb', label: 'CodeLLDB' });
  assert.deepEqual(debugExtensionFor('cppdbg'), { extensionId: 'ms-vscode.cpptools', label: 'C/C++ (cpptools)' });
  assert.equal(debugExtensionFor('node'), undefined);
  assert.equal(debugExtensionFor('constructor'), undefined);
});

test('the debug type extensions are the same ids the cpp rules install', () => {
  const installs = new Set(RULES.flatMap(r => (r.fix.kind === 'install' ? [r.fix.extensionId] : [])));
  assert.ok(installs.has(debugExtensionFor('lldb')!.extensionId));
  assert.ok(installs.has(debugExtensionFor('cppdbg')!.extensionId));
});
```

- [ ] **Step 2: Implement `src/rules.ts`**

```ts
import type { Requirement } from './types';

const install = (extensionId: string) => ({ kind: 'install', extensionId }) as const;
const url = (u: string) => ({ kind: 'url', url: u }) as const;

export const RULES: readonly Requirement[] = [
  // C / C++
  { id: 'ext.clangd', label: 'clangd extension', languages: ['cpp'], kind: 'extension', anyOf: ['llvm-vs-code-extensions.vscode-clangd'], severity: 'required', fix: install('llvm-vs-code-extensions.vscode-clangd') },
  { id: 'ext.cpptools', label: 'C/C++ (cpptools) extension', languages: ['cpp'], kind: 'extension', anyOf: ['ms-vscode.cpptools'], severity: 'required', fix: install('ms-vscode.cpptools') },
  { id: 'ext.codelldb', label: 'CodeLLDB extension', languages: ['cpp'], kind: 'extension', anyOf: ['vadimcn.vscode-lldb'], severity: 'required', fix: install('vadimcn.vscode-lldb') },
  { id: 'tool.cmake', label: 'cmake', languages: ['cpp'], kind: 'tool', anyOf: ['cmake'], severity: 'required', fix: url('https://cmake.org/download/') },
  // The clangd extension can download clangd itself, so a missing binary is only a recommendation.
  { id: 'tool.clangd', label: 'clangd', languages: ['cpp'], kind: 'tool', anyOf: ['clangd'], severity: 'recommended', fix: url('https://clangd.llvm.org/installation') },
  // MSVC presets debug through CodeLLDB and need neither; native Clang/GCC presets need gdb.
  { id: 'tool.debugger', label: 'gdb or lldb', languages: ['cpp'], kind: 'tool', anyOf: ['gdb', 'lldb'], severity: 'recommended', fix: url('https://www.msys2.org/') },
  { id: 'tool.clang-format', label: 'clang-format', languages: ['cpp'], kind: 'tool', anyOf: ['clang-format'], severity: 'recommended', fix: url('https://github.com/llvm/llvm-project/releases') },
  // Rust
  { id: 'ext.rust-analyzer', label: 'rust-analyzer extension', languages: ['rust'], kind: 'extension', anyOf: ['rust-lang.rust-analyzer'], severity: 'required', fix: install('rust-lang.rust-analyzer') },
  { id: 'tool.cargo', label: 'cargo', languages: ['rust'], kind: 'tool', anyOf: ['cargo'], severity: 'required', fix: url('https://rustup.rs/') },
  { id: 'tool.rustfmt', label: 'rustfmt', languages: ['rust'], kind: 'tool', anyOf: ['rustfmt'], severity: 'required', fix: url('https://rustup.rs/') },
  // Node
  { id: 'tool.node', label: 'node', languages: ['node'], kind: 'tool', anyOf: ['node'], severity: 'required', fix: url('https://nodejs.org/en/download') },
  // Every workspace: Null IDE's AI workflow
  { id: 'ext.claude-code', label: 'Claude Code extension', languages: 'all', kind: 'extension', anyOf: ['anthropic.claude-code'], severity: 'recommended', fix: install('anthropic.claude-code') },
  { id: 'tool.claude', label: 'claude CLI', languages: 'all', kind: 'tool', anyOf: ['claude'], severity: 'recommended', fix: url('https://docs.claude.com/en/docs/claude-code/setup') },
];

const DEBUG_TYPE_EXTENSIONS = new Map<string, { extensionId: string; label: string }>([
  ['lldb', { extensionId: 'vadimcn.vscode-lldb', label: 'CodeLLDB' }],
  ['cppdbg', { extensionId: 'ms-vscode.cpptools', label: 'C/C++ (cpptools)' }],
]);

/** The extension that provides debug type `type` for the configs null-cpp synthesizes; undefined for any other type. */
export function debugExtensionFor(type: string): { extensionId: string; label: string } | undefined {
  return DEBUG_TYPE_EXTENSIONS.get(type);
}
```

- [ ] **Step 3: Write the failing `check` tests**

`src/check.test.ts`:
```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { check, requiredSignature, visibleRequired } from './check';
import type { Finding, Probes } from './types';

function probes(extensions: string[] = [], tools: string[] = []): Probes {
  return { hasExtension: id => extensions.includes(id), hasTool: name => tools.includes(name) };
}

const ALL_EXTENSIONS = [
  'llvm-vs-code-extensions.vscode-clangd', 'ms-vscode.cpptools', 'vadimcn.vscode-lldb',
  'rust-lang.rust-analyzer', 'anthropic.claude-code',
];
const ALL_TOOLS = ['cmake', 'clangd', 'gdb', 'clang-format', 'cargo', 'rustfmt', 'node', 'claude'];

const ids = (findings: Finding[]) => findings.map(f => f.id);

test('everything present means no findings', () => {
  assert.deepEqual(check(['cpp', 'rust', 'node'], probes(ALL_EXTENSIONS, ALL_TOOLS)), []);
});

test('a cmake project with nothing installed names cpptools, CodeLLDB and clangd', () => {
  const found = ids(check(['cpp'], probes()));
  for (const id of ['ext.clangd', 'ext.cpptools', 'ext.codelldb', 'tool.cmake']) {
    assert.ok(found.includes(id), id);
  }
});

test('anyOf is satisfied by a single entry', () => {
  const found = ids(check(['cpp'], probes(ALL_EXTENSIONS, ['cmake', 'clangd', 'clang-format', 'claude', 'gdb'])));
  assert.deepEqual(found, []);
  const lldbOnly = ids(check(['cpp'], probes(ALL_EXTENSIONS, ['cmake', 'clangd', 'clang-format', 'claude', 'lldb'])));
  assert.deepEqual(lldbOnly, []);
});

test('a cargo project without rust-analyzer or rustfmt reports both', () => {
  const found = ids(check(['rust'], probes(['anthropic.claude-code'], ['cargo', 'claude'])));
  assert.deepEqual(found, ['ext.rust-analyzer', 'tool.rustfmt']);
});

test('requirements for languages that are not detected are not reported', () => {
  const found = ids(check(['node'], probes()));
  assert.deepEqual(found, ['tool.node', 'ext.claude-code', 'tool.claude']);
});

test('with no language only the all-language rules apply', () => {
  assert.deepEqual(ids(check([], probes())), ['ext.claude-code', 'tool.claude']);
});

test('a repeated language (multi-root workspace) reports each requirement once', () => {
  const once = ids(check(['cpp'], probes()));
  const twice = ids(check(['cpp', 'cpp'], probes()));
  assert.deepEqual(twice, once);
  assert.equal(new Set(twice).size, twice.length);
});

test('findings carry the fix and omit the language list', () => {
  const [first] = check(['rust'], probes());
  assert.ok(first.fix);
  assert.equal('languages' in first, false);
});

test('only required findings are visible, and a snooze hides them until the set changes', () => {
  const cpp = check(['cpp'], probes(ALL_EXTENSIONS, ALL_TOOLS));
  assert.deepEqual(visibleRequired(cpp, undefined), []);

  const missing = check(['cpp'], probes([], ['cmake', 'clangd', 'gdb', 'clang-format', 'claude']));
  const required = visibleRequired(missing, undefined);
  assert.ok(required.length > 0);
  assert.ok(required.every(f => f.severity === 'required'));

  const snoozed = requiredSignature(missing);
  assert.deepEqual(visibleRequired(missing, snoozed), []);

  // A new required item (cmake) goes missing: the snooze no longer matches and the warning returns.
  const worse = check(['cpp'], probes([], ['clangd', 'gdb', 'clang-format', 'claude']));
  assert.notEqual(requiredSignature(worse), snoozed);
  assert.ok(visibleRequired(worse, snoozed).length > 0);
});
```

- [ ] **Step 4: Run to see failures**

Run: `cd extensions/null-env && npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './check'`.

- [ ] **Step 5: Implement `src/check.ts`**

```ts
import { RULES } from './rules';
import type { Finding, Language, Probes, Requirement } from './types';

/** Requirements that apply to `languages` and are not satisfied by `probes`. Empty means nothing to show. */
export function check(languages: readonly Language[], probes: Probes, rules: readonly Requirement[] = RULES): Finding[] {
  const present = new Set(languages);
  return rules
    .filter(r => r.languages === 'all' || r.languages.some(l => present.has(l)))
    .filter(r => !r.anyOf.some(x => (r.kind === 'extension' ? probes.hasExtension(x) : probes.hasTool(x))))
    .map(({ languages: _languages, ...finding }) => finding);
}

/** Identifies the set of missing required items, so a snooze can tell "same problem" from "a new one". */
export function requiredSignature(findings: readonly Finding[]): string {
  return findings
    .filter(f => f.severity === 'required')
    .map(f => f.id)
    .sort()
    .join(',');
}

/** The required findings to warn about; none while the user's snooze still matches the current set. */
export function visibleRequired(findings: readonly Finding[], snoozedSignature: string | undefined): Finding[] {
  const required = findings.filter(f => f.severity === 'required');
  return required.length > 0 && requiredSignature(required) === snoozedSignature ? [] : required;
}
```

- [ ] **Step 6: Run the whole suite**

Run: `cd extensions/null-env && npm test`
Expected: all four test files PASS (detect, probe, rules, check).

- [ ] **Step 7: Commit**

```bash
git add extensions/null-env/src/rules.ts extensions/null-env/src/rules.test.ts extensions/null-env/src/check.ts extensions/null-env/src/check.test.ts
git commit -m "feat(null-env): rule table and pure environment check (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: VS Code glue — state, command, status bar, API, integration spec

**Files:**
- Create: `extensions/null-env/src/probes.ts`, `envState.ts`, `fix.ts`, `commands.ts`, `statusBar.ts`, `api.ts`, `extension.ts`
- Create: `extensions/null-env/src/test/runTest.ts`, `src/test/suite/index.ts`, `src/test/suite/activation.spec.ts`
- Generated and committed: `extensions/null-env/out/**`

**Interfaces:**
- Consumes: everything from Tasks 2–3.
- Produces (`api.ts`): `NullEnvApi` —
  ```ts
  interface NullEnvApi {
    getFindings(): Finding[];
    onDidChange: vscode.Event<void>;
    detectProjects(folderPath: string): DetectedProject[];
    findExecutable(name: string): string | null;
    findRustfmtPath(configuredPath?: string, extensionPath?: string): string | null;
    findClangFormatPath(configuredPath?: string, extensionPath?: string): string | null;
    ensureDebugType(type: string): Promise<boolean>;
  }
  ```
  `ensureDebugType` resolves `true` when `type` needs no extension or its extension is installed; otherwise it shows a notification (Install / Check Environment) **without awaiting it** and resolves `false`.
- Produces: commands `null.env.check` and `null.env.getFindings` (returns `Finding[]`).

- [ ] **Step 1: `src/probes.ts`**

```ts
import * as vscode from 'vscode';
import { findExecutable } from './probe';
import type { Probes } from './types';

export const vscodeProbes: Probes = {
  hasExtension: id => vscode.extensions.getExtension(id) !== undefined,
  hasTool: name => findExecutable(name) !== null,
};
```

- [ ] **Step 2: `src/envState.ts`**

```ts
import * as vscode from 'vscode';
import { check, requiredSignature, visibleRequired } from './check';
import { detectLanguages } from './detect';
import type { Finding, Language, Probes } from './types';

const SNOOZE_KEY = 'null-env.snoozedSignature';

/** The current findings for the open workspace folders, plus the per-workspace snooze of the status bar warning. */
export class EnvState {
  private findings: Finding[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly probes: Probes, private readonly memento: vscode.Memento) {}

  get(): Finding[] {
    return this.findings;
  }

  /** Required findings to warn about right now (none while snoozed). */
  warnings(): Finding[] {
    return visibleRequired(this.findings, this.memento.get<string>(SNOOZE_KEY));
  }

  snooze(): Thenable<void> {
    return this.memento.update(SNOOZE_KEY, requiredSignature(this.findings)).then(() => this.emitter.fire());
  }

  refresh(): void {
    const languages = new Set<Language>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      for (const language of detectLanguages(folder.uri.fsPath)) {
        languages.add(language);
      }
    }
    const next = check([...languages], this.probes);
    if (JSON.stringify(next) !== JSON.stringify(this.findings)) {
      this.findings = next;
      this.emitter.fire();
    }
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
```

- [ ] **Step 3: `src/fix.ts`**

```ts
import * as vscode from 'vscode';
import { debugExtensionFor } from './rules';
import type { Finding } from './types';

export async function applyFix(finding: Finding): Promise<void> {
  if (finding.fix.kind === 'install') {
    await vscode.commands.executeCommand('workbench.extensions.installExtension', finding.fix.extensionId);
  } else {
    await vscode.env.openExternal(vscode.Uri.parse(finding.fix.url));
  }
}

/**
 * Whether debug type `type` can start. When its extension is missing this explains why and offers the
 * fix, but does not wait for the user's choice: callers just stop and return.
 */
export async function ensureDebugType(type: string): Promise<boolean> {
  const need = debugExtensionFor(type);
  if (!need || vscode.extensions.getExtension(need.extensionId)) {
    return true;
  }
  void vscode.window
    .showErrorMessage(
      `Debugging needs the ${need.label} extension (${need.extensionId}), which is not installed.`,
      'Install',
      'Check Environment',
    )
    .then(choice => {
      if (choice === 'Install') {
        return vscode.commands.executeCommand('workbench.extensions.installExtension', need.extensionId);
      }
      if (choice === 'Check Environment') {
        return vscode.commands.executeCommand('null.env.check');
      }
      return undefined;
    });
  return false;
}
```

- [ ] **Step 4: `src/commands.ts`**

```ts
import * as vscode from 'vscode';
import { applyFix } from './fix';
import type { EnvState } from './envState';
import type { Finding } from './types';

type Item = vscode.QuickPickItem & { finding?: Finding; action?: 'installAll' | 'snooze' };

async function runCheck(state: EnvState): Promise<void> {
  state.refresh(); // PATH-independent dirs (cargo bin, LLVM) may have changed since the last check
  const findings = state.get();
  if (findings.length === 0) {
    void vscode.window.showInformationMessage('Null: nothing is missing for this workspace.');
    return;
  }

  const installable = findings.filter(f => f.fix.kind === 'install');
  const items: Item[] = [];
  if (installable.length > 1) {
    items.push({ label: '$(cloud-download) Install all missing extensions', action: 'installAll' });
  }
  for (const finding of findings) {
    const install = finding.fix.kind === 'install';
    items.push({
      label: `$(${install ? 'extensions' : 'link-external'}) ${finding.label}`,
      description: finding.severity,
      detail: finding.fix.kind === 'install' ? `Install ${finding.fix.extensionId}` : `Open ${finding.fix.url}`,
      finding,
    });
  }
  if (state.warnings().length > 0) {
    items.push({ label: '$(bell-slash) Hide this warning for this workspace', action: 'snooze' });
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Null: Check Environment',
    placeHolder: 'Pick an item to fix it',
  });
  if (!picked) {
    return;
  }
  if (picked.action === 'installAll') {
    for (const finding of installable) {
      await applyFix(finding);
    }
  } else if (picked.action === 'snooze') {
    await state.snooze();
  } else if (picked.finding) {
    await applyFix(picked.finding);
  }
}

export function registerCommands(context: vscode.ExtensionContext, state: EnvState): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('null.env.check', () => runCheck(state)),
    // Internal: lets the UI-side null-tools read findings across extension hosts (exports do not cross them).
    vscode.commands.registerCommand('null.env.getFindings', () => state.get()),
  );
}
```

- [ ] **Step 5: `src/statusBar.ts`**

```ts
import * as vscode from 'vscode';
import type { EnvState } from './envState';

export function registerStatusBar(context: vscode.ExtensionContext, state: EnvState): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  item.command = 'null.env.check';
  item.name = 'Null Environment';

  const render = (): void => {
    const warnings = state.warnings();
    if (warnings.length === 0) {
      item.hide();
      return;
    }
    item.text = `$(warning) ${warnings.length} missing`;
    item.tooltip = `Missing for this workspace: ${warnings.map(f => f.label).join(', ')}. Click to fix.`;
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    item.show();
  };

  context.subscriptions.push(item, state.onDidChange(render));
  render();
}
```

- [ ] **Step 6: `src/api.ts`**

```ts
import type * as vscode from 'vscode';
import type { DetectedProject } from './detect';
import type { Finding } from './types';

/** Exports of `null.null-env`, for the workspace-side built-ins that depend on it. */
export interface NullEnvApi {
  getFindings(): Finding[];
  onDidChange: vscode.Event<void>;
  detectProjects(folderPath: string): DetectedProject[];
  findExecutable(name: string): string | null;
  findRustfmtPath(configuredPath?: string, extensionPath?: string): string | null;
  findClangFormatPath(configuredPath?: string, extensionPath?: string): string | null;
  ensureDebugType(type: string): Promise<boolean>;
}
```

- [ ] **Step 7: `src/extension.ts`**

```ts
import * as vscode from 'vscode';
import type { NullEnvApi } from './api';
import { registerCommands } from './commands';
import { detectProjects } from './detect';
import { EnvState } from './envState';
import { ensureDebugType } from './fix';
import { findClangFormatPath, findExecutable, findRustfmtPath } from './probe';
import { vscodeProbes } from './probes';
import { registerStatusBar } from './statusBar';

export function activate(context: vscode.ExtensionContext): NullEnvApi {
  const state = new EnvState(vscodeProbes, context.workspaceState);
  context.subscriptions.push(
    state,
    vscode.workspace.onDidChangeWorkspaceFolders(() => state.refresh()),
    vscode.extensions.onDidChange(() => state.refresh()),
  );
  registerCommands(context, state);
  registerStatusBar(context, state);
  state.refresh();

  return {
    getFindings: () => state.get(),
    onDidChange: state.onDidChange,
    detectProjects: folderPath => detectProjects(folderPath),
    findExecutable: name => findExecutable(name),
    findRustfmtPath,
    findClangFormatPath,
    ensureDebugType,
  };
}

export function deactivate(): void {}
```
Note: `state` has `dispose()`, so pushing it into `subscriptions` is valid.

- [ ] **Step 8: Integration runner and spec**

`src/test/runTest.ts` — copy `extensions/null-actions/src/test/runTest.ts` verbatim, then replace every `null-actions` with `null-env` (the install sub-path, the error message, the three temp-dir prefixes `null-env-spec-workspace-` / `-userdata-` / `-extensions-`). Keep the long comment about the vanilla VS Code build.

`src/test/suite/index.ts` — copy `extensions/null-actions/src/test/suite/index.ts` verbatim (no changes).

`src/test/suite/activation.spec.ts`:
```ts
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('null-env activation', () => {
  test('activates and registers its commands', async () => {
    const extension = vscode.extensions.getExtension('null.null-env');
    assert.ok(extension, 'null.null-env extension not found');
    await extension!.activate();
    assert.strictEqual(extension!.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('null.env.check'), 'null.env.check not registered');
    assert.ok(commands.includes('null.env.getFindings'), 'null.env.getFindings not registered');
  });

  test('getFindings returns plain JSON findings', async () => {
    const findings = await vscode.commands.executeCommand<unknown[]>('null.env.getFindings');
    assert.ok(Array.isArray(findings));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(findings)), findings);
  });

  test('ensureDebugType blocks a debug type whose extension is missing, and passes unknown types', async () => {
    const api = vscode.extensions.getExtension('null.null-env')!.exports;
    // The runner uses an empty extensions dir, so CodeLLDB and cpptools are absent.
    assert.strictEqual(await api.ensureDebugType('lldb'), false);
    assert.strictEqual(await api.ensureDebugType('cppdbg'), false);
    assert.strictEqual(await api.ensureDebugType('node'), true);
  });
});
```

- [ ] **Step 9: Compile, run unit tests**

Run: `cd extensions/null-env && npm run compile && npm test`
Expected: compiles without errors; unit tests PASS.

- [ ] **Step 10: Commit source, then compiled output**

```bash
git add extensions/null-env/src
git commit -m "feat(null-env): status bar warning, Check Environment command and exports (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git add extensions/null-env/out
git commit -m "chore: refresh null-env compiled output (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
(The integration spec runs in Task 10.)

---

### Task 5: Build wiring

**Files:**
- Modify: `.github/workflows/build.yml` (compile step after the `null-startup` compile step ~line 174; copy list ~line 194; REH list ~line 441)
- Modify: `scripts/build-local.ps1:361` and `:378`
- Modify: `scripts/sync-local.ps1` (extension table, after the `null-startup` entry ~line 303)

**Interfaces:** none.

- [ ] **Step 1: `build.yml` compile step**

After the `Compile null-startup TypeScript` step, insert:
```yaml
      - name: Compile null-env TypeScript
        shell: pwsh
        run: |
          Set-Location ide-overlay/extensions/null-env
          npm ci --ignore-scripts
          npm run compile
```

- [ ] **Step 2: `build.yml` copy list**

After `Copy-Item -Recurse -Force ide-overlay/extensions/null-startup    vscode-src/extensions/` add:
```
          Copy-Item -Recurse -Force ide-overlay/extensions/null-env        vscode-src/extensions/
```

- [ ] **Step 3: `build.yml` REH repack list**

Change
```
foreach ($e in 'null-cpp', 'null-format', 'null-actions', 'null-markdown', 'code-spell-checker') {
```
to
```
foreach ($e in 'null-env', 'null-cpp', 'null-format', 'null-actions', 'null-markdown', 'code-spell-checker') {
```

- [ ] **Step 4: `build-local.ps1`**

Append `"null-env"` to both arrays (the compile loop at line 361 and the copy loop at line 378), i.e. `... "null-activity", "null-startup", "null-env")`.

- [ ] **Step 5: `sync-local.ps1`**

After the `"null-startup" = @{ ... }` entry add:
```powershell
    "null-env" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out"
        )
    }
```

- [ ] **Step 6: Verify the edits are syntactically sound**

Run: `grep -n "null-env" .github/workflows/build.yml scripts/build-local.ps1 scripts/sync-local.ps1`
Expected: 1 compile step, 1 copy line, 1 REH match in `build.yml`; 2 in `build-local.ps1`; 1 in `sync-local.ps1`.
Run: `powershell -NoProfile -Command "[void][System.Management.Automation.Language.Parser]::ParseFile('scripts/sync-local.ps1',[ref]$null,[ref]$e); [void][System.Management.Automation.Language.Parser]::ParseFile('scripts/build-local.ps1',[ref]$null,[ref]$e2); 'parsed'"`
Expected: `parsed`.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/build.yml scripts/build-local.ps1 scripts/sync-local.ps1
git commit -m "build: compile, bundle and repack null-env for remote servers (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Migrate `null-format` onto null-env

**Files:**
- Create: `extensions/null-format/src/envApi.ts`
- Modify: `extensions/null-format/src/rustfmtProvider.ts`, `src/clangFormatProvider.ts`
- Modify: `extensions/null-format/package.json` (dependency + test script)
- Delete: `extensions/null-format/src/toolchainDiscovery.ts`, `src/toolchainDiscovery.test.ts`, and the stale `out/toolchainDiscovery*.js[.map]` files

**Interfaces:**
- Consumes: `NullEnvApi.findRustfmtPath`, `NullEnvApi.findClangFormatPath` (Task 4).

- [ ] **Step 1: `src/envApi.ts`**

```ts
import * as vscode from 'vscode';

/** The slice of null-env's exports that null-format uses. */
export interface EnvApi {
  findRustfmtPath(configuredPath?: string, extensionPath?: string): string | null;
  findClangFormatPath(configuredPath?: string, extensionPath?: string): string | null;
}

/** null-format declares null-env in `extensionDependencies`, so it is active before this extension is. */
export function getEnvApi(): EnvApi {
  const api = vscode.extensions.getExtension<EnvApi>('null.null-env')?.exports;
  if (!api) {
    throw new Error('Null Env (null.null-env) is not available.');
  }
  return api;
}
```

- [ ] **Step 2: `rustfmtProvider.ts`**

Replace `import { findRustfmtPath } from './toolchainDiscovery';` with `import { getEnvApi } from './envApi';`, and replace
```ts
    const exePath = findRustfmtPath(configuredExe, this.extensionPath);
    if (!exePath) {
      vscode.window.showWarningMessage(
        'Null IDE: rustfmt was not found. Please install Rust (rustup component add rustfmt) or configure null-format.rustfmt.path.'
      );
      return [];
    }
```
with
```ts
    const exePath = getEnvApi().findRustfmtPath(configuredExe, this.extensionPath);
    if (!exePath) {
      void vscode.window
        .showWarningMessage(
          'Null IDE: rustfmt was not found. Please install Rust (rustup component add rustfmt) or configure null-format.rustfmt.path.',
          'Check Environment'
        )
        .then(choice => (choice ? vscode.commands.executeCommand('null.env.check') : undefined));
      return [];
    }
```

- [ ] **Step 3: `clangFormatProvider.ts`**

Replace `import { findClangFormatPath } from './toolchainDiscovery';` with `import { getEnvApi } from './envApi';`, and replace
```ts
    const exePath = findClangFormatPath(configuredExe, this.extensionPath);
    if (!exePath) {
      vscode.window.showWarningMessage(
        'Null IDE: clang-format was not found. Please install LLVM or configure null-format.clangFormat.path.'
      );
      return [];
    }
```
with
```ts
    const exePath = getEnvApi().findClangFormatPath(configuredExe, this.extensionPath);
    if (!exePath) {
      void vscode.window
        .showWarningMessage(
          'Null IDE: clang-format was not found. Please install LLVM or configure null-format.clangFormat.path.',
          'Check Environment'
        )
        .then(choice => (choice ? vscode.commands.executeCommand('null.env.check') : undefined));
      return [];
    }
```

- [ ] **Step 4: Remove the old finder and its test**

```bash
git rm extensions/null-format/src/toolchainDiscovery.ts extensions/null-format/src/toolchainDiscovery.test.ts
git rm extensions/null-format/out/toolchainDiscovery.js extensions/null-format/out/toolchainDiscovery.js.map extensions/null-format/out/toolchainDiscovery.test.js extensions/null-format/out/toolchainDiscovery.test.js.map
```
(Its three tests live in `null-env/src/probe.test.ts` since Task 2.)

- [ ] **Step 5: `package.json`**

Add after `"activationEvents": [ "onStartupFinished" ],`:
```json
  "extensionDependencies": [
    "null.null-env"
  ],
```
and remove ` out/toolchainDiscovery.test.js` from the `test` script.

- [ ] **Step 6: Compile and test**

Run: `cd extensions/null-format && npm run compile && npm test`
Expected: compiles; remaining tests (diffUtils, configResolver, prettier) PASS.
Run: `git grep -n "toolchainDiscovery" -- extensions/null-format/src extensions/null-format/package.json`
Expected: no output.

- [ ] **Step 7: Commit source, then compiled output**

```bash
git add extensions/null-format/src extensions/null-format/package.json
git commit -m "refactor(null-format): use null-env for rustfmt/clang-format lookup (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git add -A extensions/null-format/out
git commit -m "chore: refresh null-format compiled output (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
(`git add -A` is limited to `extensions/null-format/out`, which contains only this task's changes.)

---

### Task 7: Migrate `null-actions` onto null-env

**Files:**
- Create: `extensions/null-actions/src/envApi.ts`
- Modify: `extensions/null-actions/src/projectDetector.ts`, `src/projectDetector.test.ts`, `src/settingsPanel.ts:79`
- Modify: `extensions/null-actions/package.json`, `tsconfig.json`

**Interfaces:**
- Consumes: `NullEnvApi.detectProjects(folderPath): { language: string; manifest: string }[]` (Task 4).
- Produces: `detectSuggestedButtons(folderPath: string, detect: ProjectDetector): SuggestedButton[]`.

- [ ] **Step 1: Rewrite the tests first**

Replace the whole of `src/projectDetector.test.ts` with:
```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { detectSuggestedButtons, DetectedProject } from './projectDetector';

const detecting = (...projects: DetectedProject[]) => () => projects;

test('no detected projects yields no suggestions', () => {
  assert.deepStrictEqual(detectSuggestedButtons('/x', detecting()), []);
});

test('Cargo.toml yields cargo suggestions', () => {
  const suggestions = detectSuggestedButtons('/x', detecting({ language: 'rust', manifest: 'Cargo.toml' }));
  assert.ok(suggestions.some(s => s.command === 'cargo run'));
  assert.ok(suggestions.some(s => s.command === 'cargo build'));
  assert.ok(suggestions.some(s => s.command === 'cargo test'));
});

test('CMakeLists.txt yields cmake suggestions', () => {
  const suggestions = detectSuggestedButtons('/x', detecting({ language: 'cpp', manifest: 'CMakeLists.txt' }));
  assert.ok(suggestions.some(s => s.command === 'cmake -B build'));
  assert.ok(suggestions.some(s => s.command === 'cmake --build build'));
});

test('a .csproj yields dotnet suggestions', () => {
  const suggestions = detectSuggestedButtons('/x', detecting({ language: 'dotnet', manifest: '.csproj' }));
  assert.ok(suggestions.some(s => s.command === 'dotnet build'));
  assert.ok(suggestions.some(s => s.command === 'dotnet run'));
});

test('other C++ markers do not suggest cmake commands', () => {
  const suggestions = detectSuggestedButtons('/x', detecting(
    { language: 'cpp', manifest: 'compile_commands.json' },
    { language: 'cpp', manifest: '.clangd' },
    { language: 'node', manifest: 'package.json' },
  ));
  assert.deepStrictEqual(suggestions, []);
});

test('multiple manifests yield the union of their suggestions', () => {
  const suggestions = detectSuggestedButtons('/x', detecting(
    { language: 'rust', manifest: 'Cargo.toml' },
    { language: 'cpp', manifest: 'CMakeLists.txt' },
  ));
  assert.ok(suggestions.some(s => s.command === 'cargo run'));
  assert.ok(suggestions.some(s => s.command === 'cmake -B build'));
});

test('suggestion ids are unique within one result set', () => {
  const suggestions = detectSuggestedButtons('/x', detecting(
    { language: 'rust', manifest: 'Cargo.toml' },
    { language: 'cpp', manifest: 'CMakeLists.txt' },
    { language: 'dotnet', manifest: '.csproj' },
  ));
  const ids = suggestions.map(s => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('the folder path is passed to the detector', () => {
  let seen = '';
  detectSuggestedButtons('/some/folder', p => { seen = p; return []; });
  assert.strictEqual(seen, '/some/folder');
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd extensions/null-actions && npx tsc -p tsconfig.json`
Expected: FAIL — `DetectedProject` is not exported / `detectSuggestedButtons` expects 1 argument.

- [ ] **Step 3: Rewrite `src/projectDetector.ts`**

```ts
'use strict';

export interface SuggestedButton {
  id: string;
  label: string;
  command: string;
  icon?: string;
}

/** One manifest found in a folder; produced by null-env's `detectProjects`. */
export interface DetectedProject {
  language: string;
  manifest: string;
}

export type ProjectDetector = (folderPath: string) => readonly DetectedProject[];

const SUGGESTIONS_BY_MANIFEST: Record<string, SuggestedButton[]> = {
  'Cargo.toml': [
    { id: 'cargo-run', label: 'cargo run', command: 'cargo run', icon: 'play' },
    { id: 'cargo-build', label: 'cargo build', command: 'cargo build', icon: 'tools' },
    { id: 'cargo-test', label: 'cargo test', command: 'cargo test', icon: 'beaker' },
  ],
  'CMakeLists.txt': [
    { id: 'cmake-configure', label: 'cmake configure', command: 'cmake -B build', icon: 'gear' },
    { id: 'cmake-build', label: 'cmake build', command: 'cmake --build build', icon: 'tools' },
  ],
  '.csproj': [
    { id: 'dotnet-build', label: 'dotnet build', command: 'dotnet build', icon: 'tools' },
    { id: 'dotnet-run', label: 'dotnet run', command: 'dotnet run', icon: 'play' },
  ],
};

/** Which manifests exist is null-env's job (`detect`); this only maps them to buttons. */
export function detectSuggestedButtons(folderPath: string, detect: ProjectDetector): SuggestedButton[] {
  return detect(folderPath).flatMap(project => SUGGESTIONS_BY_MANIFEST[project.manifest] ?? []);
}
```
Note: `SUGGESTIONS_BY_MANIFEST` keys come only from null-env's fixed table, so prototype keys cannot occur.

- [ ] **Step 4: `src/envApi.ts`**

```ts
import * as vscode from 'vscode';
import type { DetectedProject } from './projectDetector';

/** The slice of null-env's exports that null-actions uses. */
export interface EnvApi {
  detectProjects(folderPath: string): DetectedProject[];
}

/** null-actions declares null-env in `extensionDependencies`, so it is active before this extension is. */
export function getEnvApi(): EnvApi {
  const api = vscode.extensions.getExtension<EnvApi>('null.null-env')?.exports;
  if (!api) {
    throw new Error('Null Env (null.null-env) is not available.');
  }
  return api;
}
```

- [ ] **Step 5: Wire `settingsPanel.ts`**

Add `import { getEnvApi } from './envApi';` next to the other imports and change
```ts
    const suggestions: SuggestedButton[] = folder ? detectSuggestedButtons(folder.uri.fsPath) : [];
```
to
```ts
    const suggestions: SuggestedButton[] = folder ? detectSuggestedButtons(folder.uri.fsPath, getEnvApi().detectProjects) : [];
```

- [ ] **Step 6: `package.json` and `tsconfig.json`**

`package.json`: add after `"activationEvents": ["onStartupFinished"],`
```json
  "extensionDependencies": ["null.null-env"],
```
`tsconfig.json`: add `"src/envApi.ts",` to `include` (e.g. after `"src/projectDetector.test.ts",`).

- [ ] **Step 7: Compile and test**

Run: `cd extensions/null-actions && npm run compile && npm test`
Expected: compiles; all listed tests PASS (including the rewritten `projectDetector.test.js`).

- [ ] **Step 8: Commit source, then compiled output**

```bash
git add extensions/null-actions/src extensions/null-actions/package.json extensions/null-actions/tsconfig.json
git commit -m "refactor(null-actions): take manifest detection from null-env (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git status --short extensions/null-actions/out
git add extensions/null-actions/out
git commit -m "chore: refresh null-actions compiled output (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `null-cpp` — injected finder and the debug guard

**Files:**
- Create: `extensions/null-cpp/src/envApi.ts`
- Modify: `extensions/null-cpp/src/toolchainRegistry.ts:144-156`, `src/toolchainRegistry.test.ts`, `src/extension.ts`, `src/cmakeToolbar.ts:347`
- Modify: `extensions/null-cpp/package.json`, `tsconfig.json`

**Interfaces:**
- Consumes: `NullEnvApi.findExecutable`, `NullEnvApi.ensureDebugType` (Task 4).
- Produces: `setExecutableFinder(finder: (name: string) => string | null): void` in `toolchainRegistry.ts`.

- [ ] **Step 1: Failing test**

In `src/toolchainRegistry.test.ts` add `findOnPath, setExecutableFinder,` to the import list from `./toolchainRegistry` and append:
```ts
test('findOnPath delegates to the installed finder and maps a miss to undefined', async () => {
  setExecutableFinder(name => (name === 'clang++.exe' ? 'C:\\llvm\\bin\\clang++.exe' : null));
  assert.equal(await findOnPath('clang++.exe'), 'C:\\llvm\\bin\\clang++.exe');
  assert.equal(await findOnPath('nope.exe'), undefined);
});
```
Run: `cd extensions/null-cpp && npx tsc -p tsconfig.json`
Expected: FAIL — `setExecutableFinder` is not exported.

- [ ] **Step 2: Implement in `toolchainRegistry.ts`**

Replace
```ts
function pathDirs(): string[] {
  return (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
}

export async function findOnPath(exeName: string): Promise<string | undefined> {
  for (const dir of pathDirs()) {
    const candidate = path.join(dir, exeName);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
```
with
```ts
let executableFinder: (name: string) => string | null = () => null;

/** Points executable lookup at null-env's `findExecutable`. Injected so this module stays free of `vscode` and its tests run in plain Node. */
export function setExecutableFinder(finder: (name: string) => string | null): void {
  executableFinder = finder;
}

export async function findOnPath(exeName: string): Promise<string | undefined> {
  return executableFinder(exeName) ?? undefined;
}
```
(`path` and `pathExists` are still used elsewhere in the file.)

- [ ] **Step 3: `src/envApi.ts`**

```ts
import * as vscode from 'vscode';

/** The slice of null-env's exports that null-cpp uses. */
export interface EnvApi {
  findExecutable(name: string): string | null;
  ensureDebugType(type: string): Promise<boolean>;
}

/** null-cpp declares null-env in `extensionDependencies`, so it is active before this extension is. */
export function getEnvApi(): EnvApi {
  const api = vscode.extensions.getExtension<EnvApi>('null.null-env')?.exports;
  if (!api) {
    throw new Error('Null Env (null.null-env) is not available.');
  }
  return api;
}
```

- [ ] **Step 4: Activation wiring in `extension.ts`**

Add imports
```ts
import { getEnvApi } from './envApi';
import { setExecutableFinder } from './toolchainRegistry';
```
and make the first statement of `activate`:
```ts
  setExecutableFinder(name => getEnvApi().findExecutable(name));
```

- [ ] **Step 5: The debug guard in `cmakeToolbar.ts`**

Add `import { getEnvApi } from './envApi';` and replace
```ts
  await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], config);
}
```
(the one at the end of `cmdDebug`) with
```ts
  // A missing debugger extension otherwise surfaces as VS Code's generic "unknown debug type".
  if (!(await getEnvApi().ensureDebugType(config.type))) {
    return;
  }
  await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], config);
}
```

- [ ] **Step 6: Manifest and tsconfig**

`package.json`: add after `"activationEvents": ["onStartupFinished"],`
```json
  "extensionDependencies": ["null.null-env"],
```
`tsconfig.json`: add `"src/envApi.ts",` to `include` (after `"src/extension.ts",`).

- [ ] **Step 7: Compile and test**

Run: `cd extensions/null-cpp && npm run compile && npm test`
Expected: compiles; all tests PASS including the new `findOnPath` one.

- [ ] **Step 8: Commit source, then compiled output**

```bash
git add extensions/null-cpp/src extensions/null-cpp/package.json extensions/null-cpp/tsconfig.json
git commit -m "feat(null-cpp): explain a missing debugger extension instead of 'unknown debug type' (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git add extensions/null-cpp/out
git commit -m "chore: refresh null-cpp compiled output (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Dashboard row in `null-tools`

The "card" is a rail row in the dashboard's *Home* group (beside *Today*), hidden unless required items are missing; it opens the Check Environment QuickPick.

**Files:**
- Modify: `extensions/null-tools/src/dashboardHome.ts`, `src/dashboardHome.test.ts`
- Modify: `extensions/null-tools/src/dashboard.ts` (imports, `InboundMessage`, `_handleMessage`, `_sendHome` ~line 170, rail HTML + icon symbol)
- Modify: `extensions/null-tools/src/webview/dashboard.ts` (lines 10, ~156, ~200)
- Generated: `extensions/null-tools/out/**`, `lib/dashboard.js`

**Interfaces:**
- Consumes: command `null.env.getFindings` → `Array<{ severity: string }>` (Task 4).
- Produces: `envMissing(findings): number | undefined` in `dashboardHome.ts`; `DashboardHome.envMissing?: number`; inbound webview message `{ type: 'openEnv' }`.

- [ ] **Step 1: Failing test**

In `src/dashboardHome.test.ts` change the import to `import { envMissing, homeUpdate, todayMs } from './dashboardHome';` and append:
```ts
test('envMissing counts required findings and hides the row when there are none or no answer', () => {
  assert.equal(envMissing(undefined), undefined);
  assert.equal(envMissing([]), undefined);
  assert.equal(envMissing([{ severity: 'recommended' }]), undefined);
  assert.equal(envMissing([{ severity: 'required' }, { severity: 'recommended' }, { severity: 'required' }]), 2);
});
```
Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: FAIL — `envMissing` is not exported.

- [ ] **Step 2: Implement in `dashboardHome.ts`**

Change `export interface DashboardHome { update?: HomeUpdate; todayMs?: number; }` to
```ts
export interface DashboardHome { update?: HomeUpdate; todayMs?: number; envMissing?: number; }
```
and append:
```ts
/** How many required items null-env reports missing; undefined (row hidden) when none, or when null-env did not answer. */
export function envMissing(findings: readonly { severity: string }[] | undefined): number | undefined {
  const count = findings?.filter(f => f.severity === 'required').length ?? 0;
  return count > 0 ? count : undefined;
}
```

- [ ] **Step 3: Host side in `dashboard.ts`**

Change the import to `import { DashboardHome, envMissing, homeUpdate, todayMs } from './dashboardHome';`.
Add `| { type: 'openEnv' }` to `InboundMessage` (after `| { type: 'openAccounts' };` — move the semicolon).
Add a case after `case 'openAccounts'`:
```ts
      case 'openEnv':
        void vscode.commands.executeCommand('null.env.check');
        break;
```
Add a module-level helper above the class:
```ts
/** Required findings from null-env. A command, not exports: null-env runs in the workspace host, this extension in the UI host. */
async function fetchEnvMissing(): Promise<number | undefined> {
  try {
    return envMissing(await vscode.commands.executeCommand<Array<{ severity: string }>>('null.env.getFindings'));
  } catch {
    return undefined;
  }
}
```
In `_sendHome`, replace
```ts
    const send = (activity: Parameters<typeof todayMs>[0]): void => {
      void webview.postMessage({ type: 'home', update, todayMs: todayMs(activity) } as OutboundMessage);
    };
```
with
```ts
    const send = (activity: Parameters<typeof todayMs>[0]): void => {
      void fetchEnvMissing().then(missing =>
        webview.postMessage({ type: 'home', update, todayMs: todayMs(activity), envMissing: missing } as OutboundMessage));
    };
```
In `_buildHtml`: add a warning icon next to the other symbols
```html
  <symbol id="i-warn" viewBox="0 0 16 16"><path d="M8 2.5 14 13H2zM8 6.5v3M8 11.25v.01"/></symbol>
```
and a row after the `today` row:
```html
      <button class="rail-item" id="env" hidden><svg class="i"><use href="#i-warn"/></svg><span class="label">Environment</span><span class="value" id="env-value"></span></button>
```

- [ ] **Step 4: Webview side (`src/webview/dashboard.ts`)**

Line 10: change to
```ts
  | { type: 'home'; update?: { version: string; ready: boolean }; todayMs?: number; envMissing?: number };
```
In `renderHome`, after the `today-value` line add:
```ts
    byId('env').hidden = message.envMissing === undefined;
    if (message.envMissing !== undefined) byId('env-value').textContent = `${message.envMissing} missing`;
```
In the `clicks` record add `env: 'openEnv'`.

- [ ] **Step 5: Compile and test**

Run: `cd extensions/null-tools && npm run compile && npm test`
Expected: compiles (host + dashboard webview projects); all tests PASS, including the new `envMissing` test.
Run: `grep -n "env-value" extensions/null-tools/lib/dashboard.js`
Expected: one match (the refreshed webview bundle).
Also check `lib/dashboard.css` styles `.rail-item[hidden]` / `.value` the same way as `#today`; if `#today` is selected by id there, add `#env` to the same rule.

- [ ] **Step 6: Commit source, then compiled output**

```bash
git add extensions/null-tools/src
git commit -m "feat(null-tools): show missing required dependencies on the dashboard (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git add extensions/null-tools/out extensions/null-tools/lib
git commit -m "chore: refresh null-tools compiled output (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
(If `lib/dashboard.css` was edited in Step 5, include it in the source commit instead.)

---

### Task 10: Docs and end-to-end verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `CLAUDE.md`**

- Project Overview: change "Eleven built-in extensions bundled at build time:" to "Twelve built-in extensions bundled at build time:" and add `` `null-env` `` to the list after `` `null-startup` ``; change "bundled as a twelfth built-in extension" to "bundled as a thirteenth built-in extension".
- "How the Build Works" step 4: append `` `null-env` `` to the TS-extension list; step 5: "Copy all eleven" → "Copy all twelve".
- Remote development bullet: add `null-env` to the list of workspace-side built-ins CI appends to the REH tarball.
- Add a section after `### null-startup`:

```markdown
### null-env (`extensions/null-env/`)
Environment check (issue #89). Workspace-side (no `extensionKind`), so it checks the machine that has the tools, including a remote window. Pure modules: `detect` (the one manifest → language table; `detectProjects` / `detectLanguages`), `probe` (the one executable finder: PATH with `PATHEXT`, plus `~/.cargo/bin` and LLVM dirs; `findRustfmtPath` / `findClangFormatPath` with configured → bundled → lookup precedence), `rules` (data-only requirement table: `anyOf` extension ids or tool names, `required` / `recommended`, fix = install an extension or open a URL; `debugExtensionFor` maps `lldb`/`cppdbg` to their extension), `check` (`check(languages, probes)` → findings, plus the snooze signature helpers). Only `probes.ts`, `envState.ts`, `fix.ts`, `commands.ts`, `statusBar.ts` and `extension.ts` import `vscode`. `Null: Check Environment` (`null.env.check`) is a QuickPick of findings; the status bar warning shows only `required` findings, can be hidden per workspace and reappears when the missing set changes. `null-format`, `null-actions` and `null-cpp` declare `extensionDependencies: ["null.null-env"]` and use its exports through a local `envApi.ts`, with no fallback (a fallback would be a second copy). `null-cpp.debug.start` calls `ensureDebugType` before `startDebugging`. `null-tools` (UI host) reads findings through the internal command `null.env.getFindings` (exports do not cross hosts) for its dashboard row. `PATH` is read at extension-host launch, so a CLI installed later stays "missing" until restart. Design `docs/specs/null-env-environment-check-design.md`; plan `docs/plans/null-env-environment-check.md`. Integration spec: `npm run test:integration` (via `/verify-local null-env`).
```

- [ ] **Step 2: Run every affected unit suite**

Run:
```bash
for e in null-env null-format null-actions null-cpp null-tools; do (cd extensions/$e && npm test) || echo "FAILED: $e"; done
```
Expected: no `FAILED:` line.

- [ ] **Step 3: Integration spec against a synced build**

Requires an installed Null IDE (see `scripts/sync-local.ps1`; ask the user before syncing into their install). Use the `/verify-local null-env` skill, which runs `scripts/sync-local.ps1`, `scripts/reload-local.ps1` and `npm run test:integration` in `extensions/null-env`.
Expected: the three `null-env activation` specs PASS.

- [ ] **Step 4: Manual check in the synced build (the click paths vanilla VS Code cannot cover)**

1. Open a folder with a `CMakeLists.txt` in a profile without cpptools/CodeLLDB: the status bar shows `⚠ N missing`; click → the QuickPick names them; *Install all missing extensions* installs them; the warning disappears.
2. Remove CodeLLDB again, run `null-cpp.debug.start` on an MSVC preset: the "Debugging needs the CodeLLDB extension" notification appears, not "unknown debug type".
3. Open a Cargo project without rust-analyzer: it is listed; *Hide this warning for this workspace* hides the status bar item and it returns after uninstalling another required item.
4. The dashboard's Home group shows `Environment · N missing` and opens the QuickPick.
5. All present: no status bar item, no dashboard row, `Null: Check Environment` says nothing is missing.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the null-env extension and the built-in count (#89)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** detection (T2), probes/PATH/bundled (T2), rules incl. Claude Code + `claude` CLI (T3), pure check (T3), command/QuickPick/install-all/openExternal (T4), status bar + snooze (T3 helpers, T4 UI), dashboard (T9), debug guard (T8), format links (T6), migration of all three extensions (T6–T8), recommendations (T1), ROADMAP fix (T1), build/REH/sync wiring (T5), CLAUDE.md (T10), unit + integration tests (T2–T4, T10). Acceptance criteria 1–4 are exercised by the unit tests (`check`) and the manual checks in T10 Step 4.
- **Spec refinements** (detectProjects, `tool.clangd`/`tool.debugger` recommended, `toolchainDiscovery.ts` deleted instead of wrapped, injected finder in null-cpp, snooze row) are written back into the spec in Task 1 Step 5.
- **Known limitation, documented:** `PATH` is fixed at extension-host launch (CLAUDE.md note, Task 10).

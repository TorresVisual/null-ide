# Crash Recovery Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** After an unexpected exit, Null IDE restores unsaved editors through VS Code's own hot exit and tells the user which Claude Code conversations were open or interrupted mid-turn, letting them reopen them.

**Architecture:** Editors reuse VS Code's backup tracker (config pins only). `null-tools` writes a per-run marker file; a marker whose pid is dead is a crash and doubles as the pending record. A pure scanner reads the tail/head of `~/.claude/projects/<workspace>/*.jsonl` to find interrupted sessions; one `vscode`-facing file shows the prompt and opens sessions with `claude-vscode.editor.open`.

**Tech Stack:** TypeScript (commonjs, strict), `node:test`, VS Code extension API, no new dependencies.

**Spec:** `docs/specs/crash-recovery-design.md` (issue #17)

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

- All new code lives in `extensions/null-tools/src/recovery/`; no patches, no new extension.
- `out/` is tracked: never hand-edit it; run `npm run compile` in `extensions/null-tools` and commit the refresh as `chore: refresh null-tools compiled output`.
- `npm test` runs only the files listed in `package.json`'s `test` script, and `tsconfig.json` `include` is an explicit list: every new `*.test.ts` must be added to **both**.
- Only `recoveryIntegration.ts` may import `vscode`. `crashMarker.ts` and `interruptedSessions.ts` are pure Node.
- Recovery must never throw out of `activate` or block startup; every fs/JSON step is guarded.
- Setting `null.recovery.enabled` (default `true`) is the master switch; when off, no marker is written and nothing is scanned.
- Never write to project files. `files.hotExit` is pinned to `"onExit"` (not `"onExitAndWindowClose"`), `window.restoreWindows` to `"all"`.
- Commit messages follow the repo style (`feat(null-tools): …`, `chore: …`) and end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push.
- Unrelated dirty files in the working tree (null-markdown, `.impeccable`, other docs/plans) must not be staged.

## Review Focus

1. **Torn marker read by a second window** — a window scanning while another is mid-write must not delete the live marker (atomic temp + rename; `.tmp` files ignored). Pinned in Task 2.
2. **Corrupt marker JSON** — deleted and ignored, never an exception. Pinned in Task 2.
3. **Workspace path casing** — `D:\Repo` vs `d:\repo` must be the same folder. Pinned in Task 2 (`sharesFolder`).
4. **Torn final transcript line** — the half-written last line left by a crash must be skipped, not misread as "no turn" or crash the scan. Pinned in Task 3.
5. **Another live window's session** — a transcript written after this window started must not be flagged as crashed. Pinned in Task 3 (`scanSessions` upper bound).

---

### Task 1: Pin hot-exit and window-restore defaults

**Files:**
- Modify: `product.json` (inside `configurationDefaults`, after the `window.title` line)

**Interfaces:**
- Consumes: nothing.
- Produces: `files.hotExit` / `window.restoreWindows` defaults in the built `product.json`.

- [ ] **Step 1: Add the two keys**

Edit `product.json`, replace:

```json
		"window.title": "${dirty}${rootName} - ${activeEditorShort}",
```

with:

```json
		"window.title": "${dirty}${rootName} - ${activeEditorShort}",
		"files.hotExit": "onExit",
		"window.restoreWindows": "all",
```

- [ ] **Step 2: Verify the file is still valid JSON and the keys are unique**

Run: `node -e "const p=require('./product.json');console.log(p.configurationDefaults['files.hotExit'],p.configurationDefaults['window.restoreWindows'])"`
Expected: `onExit all`

Run: `grep -c "files.hotExit" product.json`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add product.json
git commit -m "feat: pin hot exit and window restore defaults for crash recovery (#17)"
```

---

### Task 2: Crash marker module

**Files:**
- Create: `extensions/null-tools/src/recovery/crashMarker.ts`
- Test: `extensions/null-tools/src/recovery/crashMarker.test.ts`
- Modify: `extensions/null-tools/tsconfig.json` (add test to `include`)
- Modify: `extensions/null-tools/package.json` (add test to `test` script)

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `crashMarker.ts`):
  - `interface Marker { pid: number; startedAt: number; folders: string[] }`
  - `interface FoundMarker { file: string; marker: Marker }`
  - `isPidAlive(pid: number): boolean`
  - `writeMarker(dir: string, marker: Marker): string` — returns the marker file path
  - `removeMarker(file: string): void` — never throws
  - `findCrashed(dir: string, isAlive: (pid: number) => boolean, now: number, maxAgeMs: number): FoundMarker[]` — returns dead-pid markers; deletes corrupt and over-age ones
  - `sharesFolder(markerFolders: string[], windowFolders: string[]): boolean`

- [ ] **Step 1: Register the test file (so it compiles and runs)**

In `extensions/null-tools/tsconfig.json`, replace `"src/whyIsThisHere.test.ts",` with:

```json
"src/whyIsThisHere.test.ts", "src/recovery/crashMarker.test.ts",
```

In `extensions/null-tools/package.json`, in the `test` script replace the trailing `out/github/githubSession.test.js"` with:

```
out/github/githubSession.test.js out/recovery/crashMarker.test.js"
```

(`interruptedSessions` is registered in Task 3, when its file exists.)

- [ ] **Step 2: Write the failing tests**

Create `extensions/null-tools/src/recovery/crashMarker.test.ts`:

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findCrashed, isPidAlive, removeMarker, sharesFolder, writeMarker } from './crashMarker';

const DAY = 24 * 3600 * 1000;

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'null-recovery-'));
}

test('a marker whose pid is dead is reported as crashed', () => {
  const dir = tempDir();
  try {
    const marker = { pid: 4242, startedAt: 1000, folders: ['D:\\Repo'] };
    const file = writeMarker(dir, marker);
    assert.deepEqual(findCrashed(dir, () => false, 2000, DAY), [{ file, marker }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a marker whose pid is alive is not crashed, and removeMarker clears it', () => {
  const dir = tempDir();
  try {
    const file = writeMarker(dir, { pid: 4242, startedAt: 1000, folders: [] });
    assert.deepEqual(findCrashed(dir, () => true, 2000, DAY), []);
    removeMarker(file);
    assert.deepEqual(findCrashed(dir, () => false, 2000, DAY), []);
    removeMarker(file); // already gone: must not throw
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt marker is deleted and ignored', () => {
  const dir = tempDir();
  try {
    const bad = path.join(dir, '1-1.json');
    fs.writeFileSync(bad, '{nope');
    const wrongShape = path.join(dir, '2-2.json');
    fs.writeFileSync(wrongShape, JSON.stringify({ pid: 'x', startedAt: 1, folders: [] }));
    assert.deepEqual(findCrashed(dir, () => false, 2000, DAY), []);
    assert.equal(fs.existsSync(bad), false);
    assert.equal(fs.existsSync(wrongShape), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a marker older than the max age is deleted even though its pid is dead', () => {
  const dir = tempDir();
  try {
    const file = writeMarker(dir, { pid: 4242, startedAt: 0, folders: ['D:\\Repo'] });
    assert.deepEqual(findCrashed(dir, () => false, 31 * DAY, 30 * DAY), []);
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeMarker leaves no temp file behind and temp files are never read as markers', () => {
  const dir = tempDir();
  try {
    writeMarker(dir, { pid: 1, startedAt: 1, folders: [] });
    fs.writeFileSync(path.join(dir, '9-9.json.tmp'), '{"half');
    assert.deepEqual(fs.readdirSync(dir).filter(f => f === '1-1.json.tmp'), []);
    assert.equal(findCrashed(dir, () => false, 2000, DAY).length, 1);
    assert.equal(fs.existsSync(path.join(dir, '9-9.json.tmp')), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('findCrashed on a missing directory returns an empty list', () => {
  assert.deepEqual(findCrashed(path.join(os.tmpdir(), 'null-recovery-does-not-exist'), () => false, 1, DAY), []);
});

test('isPidAlive: this process is alive, an absurd pid is not', () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(2147483646), false);
});

test('sharesFolder compares workspace folders case-insensitively', () => {
  assert.equal(sharesFolder(['D:\\Coding\\Repo'], ['d:\\coding\\repo']), true);
  assert.equal(sharesFolder(['D:\\Coding\\Repo', 'D:\\Other'], ['d:\\other']), true);
  assert.equal(sharesFolder(['D:\\Coding\\Repo'], ['D:\\Coding\\Different']), false);
  assert.equal(sharesFolder([], ['D:\\Coding\\Repo']), false);
});
```

- [ ] **Step 3: Run to verify it fails**

Run (in `extensions/null-tools`): `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './crashMarker'`.

- [ ] **Step 4: Write the implementation**

Create `extensions/null-tools/src/recovery/crashMarker.ts`:

```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';

export interface Marker {
  pid: number;
  startedAt: number;
  folders: string[];
}

export interface FoundMarker {
  file: string;
  marker: Marker;
}

// EPERM means the process exists but belongs to someone else — still alive.
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Written to a temp name and renamed so a window scanning at the same moment
// never reads a half-written marker (and deletes it as "corrupt").
export function writeMarker(dir: string, marker: Marker): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${marker.pid}-${marker.startedAt}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(marker));
  fs.renameSync(tmp, file);
  return file;
}

export function removeMarker(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // already gone
  }
}

function parseMarker(text: string): Marker | null {
  try {
    const m = JSON.parse(text);
    if (
      m &&
      Number.isInteger(m.pid) &&
      Number.isFinite(m.startedAt) &&
      Array.isArray(m.folders) &&
      m.folders.every((f: unknown) => typeof f === 'string')
    ) {
      return m as Marker;
    }
  } catch {
    // corrupt
  }
  return null;
}

// Markers of dead processes = crashed runs. They stay on disk until the user
// reviews or discards them, so they are the pending record too.
// ponytail: a dead pid reused by another live process hides that crash; the age rule cleans it up.
export function findCrashed(
  dir: string,
  isAlive: (pid: number) => boolean,
  now: number,
  maxAgeMs: number,
): FoundMarker[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const crashed: FoundMarker[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(dir, entry);
    let marker: Marker | null = null;
    try {
      marker = parseMarker(fs.readFileSync(file, 'utf8'));
    } catch {
      // unreadable
    }
    if (!marker || now - marker.startedAt > maxAgeMs) {
      removeMarker(file);
      continue;
    }
    if (!isAlive(marker.pid)) crashed.push({ file, marker });
  }
  return crashed;
}

// Windows paths are case-insensitive; `D:\Repo` and `d:\repo` are one folder.
const norm = (p: string): string => path.resolve(p).toLowerCase();

export function sharesFolder(markerFolders: string[], windowFolders: string[]): boolean {
  const mine = new Set(windowFolders.map(norm));
  return markerFolders.some(f => mine.has(norm(f)));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run (in `extensions/null-tools`): `npx tsc -p tsconfig.json && node --test out/recovery/crashMarker.test.js`
Expected: all 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-tools/src/recovery/crashMarker.ts extensions/null-tools/src/recovery/crashMarker.test.ts extensions/null-tools/tsconfig.json extensions/null-tools/package.json
git commit -m "feat(null-tools): detect unclean exits with per-run marker files (#17)"
```

(Do not stage `out/` here; Task 5 refreshes it once.)

---

### Task 3: Interrupted-session scanner

**Files:**
- Create: `extensions/null-tools/src/recovery/interruptedSessions.ts`
- Test: `extensions/null-tools/src/recovery/interruptedSessions.test.ts`
- Modify: `extensions/null-tools/tsconfig.json`, `extensions/null-tools/package.json` (register the second test file)

**Interfaces:**
- Consumes: nothing from earlier tasks (callers pass the project dir from `findProjectDir` in `followAlong.ts`).
- Produces (exported from `interruptedSessions.ts`):
  - `interface RecoverableSession { sessionId: string; title: string; lastActivity: number; interrupted: boolean }`
  - `type TurnState = 'completed' | 'interrupted' | 'unknown'`
  - `classifyLastTurn(tail: string): TurnState`
  - `firstPromptTitle(head: string): string | undefined`
  - `scanSessions(projectDir: string, fromMs: number, untilMs: number): RecoverableSession[]` — newest first; includes transcripts with `fromMs ≤ mtime < untilMs`

- [ ] **Step 1: Register the second test file**

In `extensions/null-tools/tsconfig.json` replace `"src/recovery/crashMarker.test.ts",` with `"src/recovery/crashMarker.test.ts", "src/recovery/interruptedSessions.test.ts",`.

In `extensions/null-tools/package.json` replace `out/recovery/crashMarker.test.js"` with `out/recovery/crashMarker.test.js out/recovery/interruptedSessions.test.js"`.

- [ ] **Step 2: Write the failing tests**

Create `extensions/null-tools/src/recovery/interruptedSessions.test.ts`:

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { classifyLastTurn, firstPromptTitle, scanSessions } from './interruptedSessions';

const asst = (stop: string | null, extra: object = {}) =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', stop_reason: stop, content: [{ type: 'text', text: 'ok' }] }, ...extra });
const user = (content: unknown, extra: object = {}) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra });
const lines = (...l: string[]) => l.join('\n') + '\n';

test('a transcript ending in an assistant end_turn is completed', () => {
  assert.equal(classifyLastTurn(lines(user('hi'), asst('end_turn'))), 'completed');
});

test('a transcript ending in an assistant tool_use is interrupted', () => {
  assert.equal(classifyLastTurn(lines(user('hi'), asst('tool_use'))), 'interrupted');
  assert.equal(classifyLastTurn(lines(user('hi'), asst(null))), 'interrupted');
});

test('a transcript ending in a user entry (prompt or tool result) is interrupted', () => {
  assert.equal(classifyLastTurn(lines(asst('end_turn'), user('next question'))), 'interrupted');
  assert.equal(classifyLastTurn(lines(asst('tool_use'), user([{ type: 'tool_result', content: 'x' }]))), 'interrupted');
});

test('a user-initiated interrupt is a deliberate stop, not a crash', () => {
  const stop = user([{ type: 'text', text: '[Request interrupted by user]' }]);
  assert.equal(classifyLastTurn(lines(asst('tool_use'), stop)), 'completed');
});

test('a torn final line is skipped and the previous turn decides', () => {
  assert.equal(classifyLastTurn(lines(user('hi'), asst('end_turn')) + '{"type":"assis'), 'completed');
  assert.equal(classifyLastTurn(lines(user('hi'), asst('tool_use')) + '{"type":"assis'), 'interrupted');
});

test('non-conversation, sidechain and meta entries are ignored', () => {
  const noise = [
    JSON.stringify({ type: 'attachment' }),
    asst('tool_use', { isSidechain: true }),
    user('meta text', { isMeta: true }),
  ];
  assert.equal(classifyLastTurn(lines(user('hi'), asst('end_turn'), ...noise)), 'completed');
});

test('a transcript with no conversation entries is unknown', () => {
  assert.equal(classifyLastTurn(''), 'unknown');
  assert.equal(classifyLastTurn(lines(JSON.stringify({ type: 'summary' }))), 'unknown');
});

test('firstPromptTitle skips wrappers, tool results and meta, and truncates', () => {
  const head = lines(
    user('<command-name>/clear</command-name>'),
    user([{ type: 'tool_result', content: 'x' }]),
    user('real   question\nabout things', { isMeta: false }),
  );
  assert.equal(firstPromptTitle(head), 'real question about things');
  assert.equal(firstPromptTitle(lines(user('x'.repeat(200))))?.length, 80);
  assert.equal(firstPromptTitle(lines(asst('end_turn'))), undefined);
  assert.equal(firstPromptTitle(user([{ type: 'text', text: 'array form' }])), 'array form');
});

function transcript(dir: string, id: string, body: string, mtimeMs: number): void {
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, body);
  fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
}

test('scanSessions keeps transcripts in [from, until), newest first, with state and title', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-recovery-sessions-'));
  try {
    const T = Date.parse('2026-01-01T00:00:00Z');
    transcript(dir, 'before', lines(user('old'), asst('end_turn')), T - 5000);
    transcript(dir, 'done', lines(user('finished work'), asst('end_turn')), T + 1000);
    transcript(dir, 'cut', lines(user('long task'), asst('tool_use')), T + 2000);
    transcript(dir, 'live', lines(user('another window'), asst('tool_use')), T + 9000); // written after this window started
    transcript(dir, 'empty', '', T + 1500);
    transcript(dir, 'notes', lines(JSON.stringify({ type: 'summary' })), T + 1600);
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'not a transcript');

    assert.deepEqual(scanSessions(dir, T, T + 5000), [
      { sessionId: 'cut', title: 'long task', lastActivity: T + 2000, interrupted: true },
      { sessionId: 'done', title: 'finished work', lastActivity: T + 1000, interrupted: false },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scanSessions on a missing directory returns an empty list', () => {
  assert.deepEqual(scanSessions(path.join(os.tmpdir(), 'null-recovery-nope'), 0, 1), []);
});
```

- [ ] **Step 3: Run to verify it fails**

Run (in `extensions/null-tools`): `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './interruptedSessions'`.

- [ ] **Step 4: Write the implementation**

Create `extensions/null-tools/src/recovery/interruptedSessions.ts`:

```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';

export interface RecoverableSession {
  sessionId: string;
  title: string;
  lastActivity: number;
  interrupted: boolean;
}

export type TurnState = 'completed' | 'interrupted' | 'unknown';

interface Entry {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { stop_reason?: string | null; content?: unknown };
}

const CHUNK_BYTES = 64 * 1024;
const TITLE_MAX = 80;
// stop reasons that mean the assistant's turn ran to its end
const FINISHED = new Set(['end_turn', 'stop_sequence', 'max_tokens']);

function parseEntry(line: string): Entry | null {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' ? (v as Entry) : null;
  } catch {
    return null; // blank, or a line cut by a crash / chunk boundary
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(c => (c && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join(' ');
}

function isConversation(e: Entry): boolean {
  return (e.type === 'user' || e.type === 'assistant') && !e.isSidechain && !e.isMeta;
}

// Looks at the last user/assistant entry only: a finished assistant turn means
// the session ended cleanly; anything else (dangling tool_use, an unanswered
// prompt or tool result) means it was cut off.
export function classifyLastTurn(tail: string): TurnState {
  const all = tail.split('\n');
  for (let i = all.length - 1; i >= 0; i--) {
    const entry = parseEntry(all[i]);
    if (!entry || !isConversation(entry)) continue;
    if (entry.type === 'assistant') {
      return FINISHED.has(entry.message?.stop_reason ?? '') ? 'completed' : 'interrupted';
    }
    const stoppedByUser = textOf(entry.message?.content).includes('[Request interrupted by user');
    return stoppedByUser ? 'completed' : 'interrupted';
  }
  return 'unknown';
}

export function firstPromptTitle(head: string): string | undefined {
  for (const line of head.split('\n')) {
    const entry = parseEntry(line);
    if (!entry || entry.type !== 'user' || !isConversation(entry)) continue;
    const text = textOf(entry.message?.content).replace(/\s+/g, ' ').trim();
    if (!text || text.startsWith('<')) continue; // slash-command / system wrappers
    return text.length > TITLE_MAX ? text.slice(0, TITLE_MAX - 1) + '…' : text;
  }
  return undefined;
}

function readChunk(file: string, size: number, fromEnd: boolean): string {
  const fd = fs.openSync(file, 'r');
  try {
    const length = Math.min(size, CHUNK_BYTES);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, fromEnd ? size - length : 0);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// Transcripts written in [fromMs, untilMs): from the crashed run's start up to
// this window's start. Later writes belong to windows that are still running.
export function scanSessions(projectDir: string, fromMs: number, untilMs: number): RecoverableSession[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(projectDir);
  } catch {
    return [];
  }
  const found: RecoverableSession[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue;
    const file = path.join(projectDir, entry);
    try {
      const { mtimeMs, size } = fs.statSync(file);
      if (size === 0 || mtimeMs < fromMs || mtimeMs >= untilMs) continue;
      const state = classifyLastTurn(readChunk(file, size, true));
      if (state === 'unknown') continue;
      const sessionId = entry.slice(0, -'.jsonl'.length);
      found.push({
        sessionId,
        title: firstPromptTitle(readChunk(file, size, false)) ?? sessionId.slice(0, 8),
        lastActivity: mtimeMs,
        interrupted: state === 'interrupted',
      });
    } catch {
      // unreadable transcript: skip it, keep scanning
    }
  }
  return found.sort((a, b) => b.lastActivity - a.lastActivity);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run (in `extensions/null-tools`): `npx tsc -p tsconfig.json && node --test out/recovery/interruptedSessions.test.js out/recovery/crashMarker.test.js`
Expected: all tests PASS (10 in `interruptedSessions`, 8 in `crashMarker`).

- [ ] **Step 6: Commit**

```bash
git add extensions/null-tools/src/recovery/interruptedSessions.ts extensions/null-tools/src/recovery/interruptedSessions.test.ts extensions/null-tools/tsconfig.json extensions/null-tools/package.json
git commit -m "feat(null-tools): find Claude sessions interrupted by a crash (#17)"
```

---

### Task 4: Recovery prompt, setting and wiring

**Files:**
- Create: `extensions/null-tools/src/recovery/recoveryIntegration.ts`
- Modify: `extensions/null-tools/src/extension.ts` (import at line ~22, call at line ~152)
- Modify: `extensions/null-tools/package.json` (add `null.recovery.enabled`)
- Modify: `CLAUDE.md` (null-tools table row)

**Interfaces:**
- Consumes: `findCrashed`, `isPidAlive`, `writeMarker`, `removeMarker`, `sharesFolder`, `FoundMarker` from `./crashMarker`; `scanSessions`, `RecoverableSession` from `./interruptedSessions`; `findProjectDir` from `../followAlong`.
- Produces: `registerRecoveryFeature(context: vscode.ExtensionContext): void`.

This glue file has no unit tests (it only wires `vscode` APIs around the two tested modules); it is verified by the manual checklist in Task 5.

- [ ] **Step 1: Write the integration**

Create `extensions/null-tools/src/recovery/recoveryIntegration.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { findProjectDir } from '../followAlong';
import { FoundMarker, findCrashed, isPidAlive, removeMarker, sharesFolder, writeMarker } from './crashMarker';
import { RecoverableSession, scanSessions } from './interruptedSessions';

const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const CLAUDE_EXTENSION = 'anthropic.claude-code';
const OPEN_SESSION_COMMAND = 'claude-vscode.editor.open';

interface SessionItem extends vscode.QuickPickItem {
  session: RecoverableSession;
}

function collectSessions(found: FoundMarker[], windowFolders: string[], until: number): RecoverableSession[] {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  const byId = new Map<string, RecoverableSession>();
  for (const { marker } of found) {
    for (const folder of marker.folders.filter(f => sharesFolder([f], windowFolders))) {
      const projectDir = findProjectDir(claudeProjectsDir, folder);
      if (!projectDir) continue;
      for (const s of scanSessions(projectDir, marker.startedAt, until)) byId.set(s.sessionId, s);
    }
  }
  return [...byId.values()].sort((a, b) => b.lastActivity - a.lastActivity);
}

function toItem(session: RecoverableSession): SessionItem {
  return {
    label: session.title,
    description: new Date(session.lastActivity).toLocaleString(),
    detail: session.interrupted
      ? 'Interrupted mid-turn — the conversation is restored, the operation was not resumed'
      : 'Completed before the exit',
    iconPath: new vscode.ThemeIcon(session.interrupted ? 'warning' : 'comment-discussion'),
    session,
  };
}

async function review(found: FoundMarker[], windowFolders: string[], until: number): Promise<void> {
  const drop = (): void => found.forEach(f => removeMarker(f.file));
  // Nothing to offer without the Claude Code extension or any session from the crashed run.
  if (!vscode.extensions.getExtension(CLAUDE_EXTENSION)) return drop();
  const sessions = collectSessions(found, windowFolders, until);
  if (!sessions.length) return drop();

  const interrupted = sessions.filter(s => s.interrupted).length;
  const noun = sessions.length === 1 ? 'conversation was' : 'conversations were';
  const tail = interrupted ? ` (${interrupted} interrupted mid-turn)` : '';
  const choice = await vscode.window.showWarningMessage(
    `Null IDE closed unexpectedly. Unsaved editors were restored by VS Code. ${sessions.length} Claude ${noun} open${tail}.`,
    'Review',
    'Later',
    'Discard',
  );
  if (choice === 'Discard') return drop();
  if (choice !== 'Review') return; // Later, or the toast was dismissed: ask again next launch

  let remaining = sessions;
  while (remaining.length) {
    const pick = await vscode.window.showQuickPick(remaining.map(toItem), {
      placeHolder: 'Open a Claude conversation from before the exit',
    });
    if (!pick) return; // left early: keep the rest pending
    await vscode.commands.executeCommand(OPEN_SESSION_COMMAND, pick.session.sessionId);
    remaining = remaining.filter(s => s !== pick.session);
  }
  drop();
}

export function registerRecoveryFeature(context: vscode.ExtensionContext): void {
  if (!vscode.workspace.getConfiguration('null.recovery').get<boolean>('enabled', true)) return;
  try {
    const dir = path.join(context.globalStorageUri.fsPath, 'recovery');
    const startedAt = Date.now();
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);

    // Scan before writing our own marker so we never see ourselves.
    const relevant: FoundMarker[] = [];
    for (const crashed of findCrashed(dir, isPidAlive, startedAt, MAX_AGE_MS)) {
      if (crashed.marker.folders.length === 0) removeMarker(crashed.file); // nothing to review
      else if (sharesFolder(crashed.marker.folders, folders)) relevant.push(crashed);
    }

    const file = writeMarker(dir, { pid: process.pid, startedAt, folders });
    context.subscriptions.push({ dispose: () => removeMarker(file) });

    if (relevant.length) {
      review(relevant, folders, startedAt).catch(err => console.error('[null-recovery]', err));
    }
  } catch (err) {
    console.error('[null-recovery]', err);
  }
}
```

- [ ] **Step 2: Wire it into activation**

In `extensions/null-tools/src/extension.ts`, replace:

```ts
import { registerWhyIsThisHereFeature } from './whyIsThisHereIntegration';
```

with:

```ts
import { registerWhyIsThisHereFeature } from './whyIsThisHereIntegration';
import { registerRecoveryFeature } from './recovery/recoveryIntegration';
```

and replace:

```ts
  registerWhyIsThisHereFeature(context);
}
```

with:

```ts
  registerWhyIsThisHereFeature(context);
  registerRecoveryFeature(context);
}
```

- [ ] **Step 3: Add the setting**

In `extensions/null-tools/package.json`, replace:

```json
        "null.gitignore.autoUpdate": {
```

with:

```json
        "null.recovery.enabled": {
          "type": "boolean",
          "default": true,
          "description": "After an unexpected exit, offer to reopen the Claude Code conversations that were open (and flag those interrupted mid-turn). Unsaved editor contents are restored by VS Code itself and are not affected by this setting."
        },
        "null.gitignore.autoUpdate": {
```

- [ ] **Step 4: Document it**

In `CLAUDE.md`, replace:

```
`null.discord.testConnection` reports setup problems |
```

with:

```
`null.discord.testConnection` reports setup problems |
| **Crash recovery** | `src/recovery/` (#17). Unsaved editors come back through VS Code's own hot exit (`files.hotExit`/`window.restoreWindows` pinned in `product.json`). Each window writes `<pid>-<startedAt>.json` under `globalStorageUri/recovery` and deletes it on dispose; a marker with a dead pid is a crash and stays until the user reviews or discards it (`crashMarker.ts`). `interruptedSessions.ts` reads the head/tail of `~/.claude/projects/<workspace>/*.jsonl` written between the crashed run's start and this window's start and flags sessions whose last turn did not finish. `recoveryIntegration.ts` (only `vscode` file) shows Review / Later / Discard and opens sessions with `claude-vscode.editor.open`. Unsent prompts and interrupted operations cannot be recovered (the extension owns both). `null.recovery.enabled` is the master switch. Design `docs/specs/crash-recovery-design.md`; plan `docs/plans/crash-recovery.md` |
```

- [ ] **Step 5: Compile and run the whole null-tools test suite**

Run (in `extensions/null-tools`): `npm test`
Expected: `tsc` clean, all tests PASS (including the 18 new ones).

- [ ] **Step 6: Commit (sources only)**

```bash
git add extensions/null-tools/src/recovery/recoveryIntegration.ts extensions/null-tools/src/extension.ts extensions/null-tools/package.json CLAUDE.md
git commit -m "feat(null-tools): offer to reopen Claude conversations after an unexpected exit (#17)"
```

---

### Task 5: Refresh compiled output and verify end to end

**Files:**
- Modify (generated): `extensions/null-tools/out/**`

**Interfaces:**
- Consumes: Tasks 2–4 sources.
- Produces: tracked `out/` matching `src/`.

- [ ] **Step 1: Recompile**

Run (in `extensions/null-tools`): `npm run compile`
Expected: exits 0; `git status --short extensions/null-tools/out` shows new `out/recovery/*.js` and a changed `out/extension.js`.

- [ ] **Step 2: Commit the refreshed output**

```bash
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output"
```

- [ ] **Step 3: Sync into the installed Null IDE**

Use the `/verify-local null-tools` skill (it chains `scripts/sync-local.ps1`, `scripts/reload-local.ps1` and the integration specs). Expected: existing null-tools integration specs still pass (activation not broken).

- [ ] **Step 4: Manual crash checklist (a forced kill cannot run in the spec harness)**

Do these in the synced Null IDE, with the Claude Code extension installed, in a folder that has a Claude history:

1. Open the folder. Open an untitled editor and type text; edit a saved file without saving; put the cursor mid-file.
2. Start a Claude turn that runs a long tool call (e.g. ask it to run `sleep 60`), and keep a second Claude conversation that is finished.
3. `taskkill /F /IM null.exe`.
4. Relaunch Null IDE. Expected: both editors return with their unsaved text and cursor position; the warning "Null IDE closed unexpectedly… 2 Claude conversations were open (1 interrupted mid-turn)" appears.
5. Click **Review**: the picker lists both, the long-running one with the warning icon and "operation was not resumed". Pick one: it opens in Claude Code. Pick the other. Expected: prompt gone; `%APPDATA%\Null\User\globalStorage\null.null-tools\recovery\` contains only the current window's marker.
6. Repeat 1–4, click **Later**, relaunch normally (clean quit first): the prompt returns. Repeat, click **Discard**, relaunch: no prompt.
7. Normal quit and relaunch; and `Developer: Reload Window`: no prompt in either case.
8. Set `null.recovery.enabled` to `false`, crash and relaunch: no prompt and no new marker file.
9. Edit a saved file on disk (outside the IDE) after step 3, then relaunch and save the restored dirty buffer: VS Code shows its own newer-on-disk conflict instead of overwriting.

Report the outcome of each numbered item (pass/fail) to the user; do not claim the feature done without it.

---

## Self-Review

- **Spec coverage:** §1 editors → Task 1; §2 detection (marker, dead pid, corrupt, age, folder match, empty-folder delete) → Tasks 2 and 4; §3 scan (head/tail, state rules, sidechain/meta, `[from, until)`) → Task 3; §4 prompt (Review/Later/Discard, picker, icons, wording, master switch, absent Claude Code) → Task 4; testing (unit + manual checklist incl. normal quit/reload and the newer-on-disk conflict) → Tasks 2, 3, 5.
- **Placeholders:** none; all steps carry the code or exact edits.
- **Type consistency:** `Marker`, `FoundMarker`, `findCrashed(dir, isAlive, now, maxAgeMs)`, `sharesFolder`, `scanSessions(projectDir, fromMs, untilMs)`, `RecoverableSession`, `TurnState` match between Tasks 2–4. Task 2 registers only the `crashMarker` test; Task 3 Step 1 appends `interruptedSessions`.
- **Review Focus:** all five lines have a named test (Task 2: atomic write test, corrupt test, `sharesFolder` test; Task 3: torn-final-line test, `scanSessions` `until` bound).

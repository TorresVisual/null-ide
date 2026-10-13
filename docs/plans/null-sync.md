# Null Sync Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** A new built-in `null-sync` extension that keeps settings, keybindings, snippets and the extension list consistent across a user's machines through an encrypted secret GitHub Gist, with no UI of its own.

**Architecture:** Pure, injectable modules (`cryptoBox`, `syncPlan`, `settingsFilter`, `gistStore`, `localFiles`, `lock`, `syncEngine`, `enable`) hold all the logic and are tested with `node --test`, including a two-device test against an in-memory fake Gist. Only `prompts.ts`, `commands.ts` and `extension.ts` import `vscode`. Each synced file is compared whole against the `{ local, remote }` hash pair recorded at the last sync; the extension list is a set merged by set arithmetic.

**Tech Stack:** TypeScript (commonjs, ES2022), Node `crypto` (AES-256-GCM, scrypt), `jsonc-parser` (the only runtime dependency), `node:test`, the `null.null-accounts` API for GitHub sign-in and tokens.

**Spec:** `docs/specs/null-sync-design.md`

Delivery is two phases, each ending in a working committed state: **Phase 1** (Tasks 1–13) syncs settings, keybindings and snippets and ships the API and all commands; **Phase 2** (Tasks 14–16) adds the extension list. #23 closes when Phase 2 lands.

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

- Extension lives in `extensions/null-sync/`, `publisher: "null"`, `engines.vscode: "^1.93.0"`, `extensionKind: ["ui"]`, `extensionDependencies: ["null.null-accounts"]`, `activationEvents: ["onStartupFinished"]`.
- Only `prompts.ts`, `commands.ts`, `extension.ts` (and `extensionHost.ts` in Phase 2) may import `vscode` (`types.ts` may `import type`). Everything else takes its dependencies as arguments so `node --test` can run it.
- Cryptography is Node's built-in `crypto` only: AES-256-GCM with a 12-byte random IV, 16-byte tag, file name as AAD; key from scrypt `N=32768, r=8, p=1`, 32 bytes, `maxmem` 64 MB, passphrase normalized to NFC. Passphrase minimum 12 characters.
- Gist: description `Null IDE settings sync`, `public: false`, remote files `<name>.enc` plus plaintext `manifest.json`. Network only through `gistHttp.ts`: hosts `api.github.com` and `gist.githubusercontent.com`, `redirect: 'error'`, 15 s timeout, token only in the `Authorization` header and never sent to the raw host.
- Files over 900 000 bytes are not uploaded (reported). Remote file names are untrusted: every local path goes through `isSyncableFile`.
- Triggers: 10 s after startup, 30 s after a change to a synced file (debounced), every 10 minutes; all background runs are `interactive:false` and show no UI.
- Settings (all `application` scope): `null-sync.enabled` (default `false`), `null-sync.categories`, `null-sync.excludedSettings`. Commands: `null.sync.enable`, `.syncNow`, `.resolveConflicts`, `.restore`, `.stop`, `.setCategories`, `.showStatus`.
- No status bar item, no panel, no unsolicited notification. The workspace UI is a separate, later piece of work.
- Repo conventions: `out/` is tracked (refresh it with `npm run compile` and commit as `chore: refresh null-sync compiled output (#23)`, never hand-edit); `npm test` runs an explicit list of `out/**/*.test.js` files, so every new test file is added to the `test` script in the task that creates it; platform is Windows only; commit messages are `type(scope): subject (#23)` and end with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` line; never push, never `--no-verify`, never amend.
- **The working tree already has unrelated staged changes.** Every commit in this plan names its paths (`git add <paths>` then `git commit … -- <paths>`) so only this feature's files are committed.

## Review Focus

Failure modes the spec implies that the obvious tests would not catch, most likely first. Each has a test in the task named in brackets.

1. **A remote file name that tries to escape the user folder** (`snippets__..\..\x.json.enc`, a name with `/`, `manifest.json`) must be ignored, never written. [Task 1, Task 6]
2. **Awkward but valid `settings.json`**: empty file, comments, trailing commas, CRLF line endings, tab indentation, a file that is only the excluded keys. None may error, lose comments or change line endings; invalid JSON must be reported, not uploaded. [Task 4, Task 9]
3. **One corrupt or tampered remote file** must be reported and skipped while every other file still syncs, and nothing may be written locally from it. [Task 9; Task 15 for the extension list]
4. **Passphrase edge cases**: unicode written composed or decomposed, a wrong passphrase, a passphrase shorter than 12 characters. [Task 2, Task 8, Task 9]
5. **A missing `settings.json`/`keybindings.json`** (this machine has no `keybindings.json`) must never delete the remote copy, and a file over 900 KB must not be uploaded. [Task 3, Task 9]

---

## File Structure

All paths under `extensions/null-sync/`.

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `package-lock.json` | Extension manifest, build, explicit `test` list, `jsonc-parser` dependency |
| `src/types.ts` | `Category`/`CATEGORIES`, `Value`, `Base`, `StoredState`, `SyncAccount`, `FirstSync`, `SyncStatus`, `NullSyncApi` |
| `src/layout.ts` | Which files sync, their remote names, `isSyncableFile` (the path-safety gate) |
| `src/cryptoBox.ts` | `seal`, `open`, `makeManifest`, `unlock`, `passphraseProblem` |
| `src/syncPlan.ts` | `planFile`, `planAll` — the three-way decision |
| `src/settingsFilter.ts` | `matchesKey`, `stripExcluded`, `reapplyExcluded` |
| `src/gistStore.ts` | The Gist REST client (`createGistStore`) with injected HTTP |
| `src/gistHttp.ts` | The only `fetch` caller |
| `src/localFiles.ts` | Read/list/write synced files, atomic writes, backups |
| `src/lock.ts` | Cross-window run lock |
| `src/enable.ts` | The Enable flow (account, consent, passphrase, Gist creation) with injected prompts |
| `src/syncEngine.ts` | `SyncEngine`: `run`, `resolve`, `previewRemote`, `revisions`, `restore`, `stop`, status |
| `src/statusText.ts` | `describeStatus` for the status quick pick |
| `src/fakeGist.ts`, `src/testDevice.ts` | `FakeGist` (in-memory Gist API) and `Device` (one machine) — the two-device test harness; test-only, compiled with the rest like null-accounts' `testFakes.ts` |
| `src/extensionSet.ts` | Phase 2: `mergeExtensions`, `parseIds`, `installedIds` (pure) |
| `src/prompts.ts`, `src/commands.ts`, `src/extension.ts` (+ `src/extensionHost.ts` in Phase 2) | The only `vscode` code |
| `src/test/runTest.ts`, `src/test/suite/index.ts`, `src/test/suite/activation.spec.ts` | Integration specs |

---

## Phase 1 — settings, keybindings, snippets

### Task 1: Scaffold the extension, shared types and the path-safety layout

**Files:**
- Create: `extensions/null-sync/package.json`, `extensions/null-sync/tsconfig.json`, `extensions/null-sync/src/types.ts`, `extensions/null-sync/src/layout.ts`, `extensions/null-sync/src/layout.test.ts`
- Create (generated): `extensions/null-sync/package-lock.json`

**Interfaces:**
- Produces (`types.ts`):
  - `CATEGORIES: readonly ['settings','keybindings','snippets']`, `type Category`
  - `type Value = string | null` (a sha-256 hex, or `null` for "absent")
  - `interface Base { local: Value; remote: Value }`
  - `interface StoredState { gistId: string; accountId: string; owner: string; base: Record<string, Base>; lastSyncedAt?: number }`
  - `interface SyncAccount { id: string; username: string }`, `type FirstSync = 'cloud' | 'device'`
  - `type SyncState`, `interface Conflict`, `interface SyncStatus`, `interface NullSyncApi`
- Produces (`layout.ts`): `SETTINGS`, `KEYBINDINGS`, `CORE_FILES`, `MANIFEST`, `isSyncableFile(file)`, `categoryOf(file)`, `isDeletable(file)`, `remoteNameOf(file)`, `fileOfRemoteName(name)`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "null-sync",
  "displayName": "Null Sync",
  "description": "Encrypted cross-device sync of settings, keybindings, snippets and extensions through a secret GitHub Gist",
  "version": "1.0.0",
  "publisher": "null",
  "license": "MIT",
  "engines": {
    "vscode": "^1.93.0"
  },
  "scripts": {
    "compile": "tsc -p tsconfig.json",
    "test": "tsc -p tsconfig.json && node --test out/layout.test.js",
    "pretest:integration": "tsc -p tsconfig.json",
    "test:integration": "node ./out/test/runTest.js"
  },
  "dependencies": {
    "jsonc-parser": "^3.3.1"
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

(`main`, `activationEvents`, `extensionKind`, `extensionDependencies` and `contributes` are added in Task 11 together with the code they point at.)

- [ ] **Step 2: Create `tsconfig.json`** (identical to null-env's)

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

- [ ] **Step 3: Install dependencies and create the lockfile**

Run: `cd extensions/null-sync && npm install`
Expected: creates `node_modules/` (git-ignored) and `package-lock.json`; `jsonc-parser` is listed under `dependencies`.

- [ ] **Step 4: Create `src/types.ts`**

```ts
'use strict';

import type * as vscode from 'vscode';

export const CATEGORIES = ['settings', 'keybindings', 'snippets'] as const;
export type Category = (typeof CATEGORIES)[number];

/** A sha-256 hex digest of a file's synced content, or `null` when the file is absent. */
export type Value = string | null;

/** What each side looked like at the last successful sync; kept as a pair because a pulled `settings.json` is not byte-identical to the remote text. */
export interface Base {
  local: Value;
  remote: Value;
}

/** Remembered between runs (globalState). */
export interface StoredState {
  gistId: string;
  accountId: string;
  owner: string;
  base: Record<string, Base>;
  lastSyncedAt?: number;
}

export interface SyncAccount {
  id: string;
  username: string;
}

/** How the Enable flow resolves every first-sync conflict at once. */
export type FirstSync = 'cloud' | 'device';

export type SyncState = 'disabled' | 'signedOut' | 'idle' | 'syncing' | 'offline' | 'error' | 'needsAttention';

export interface Conflict {
  file: string;
  category: Category;
}

export interface SyncStatus {
  state: SyncState;
  /** ms since the epoch */
  lastSyncedAt?: number;
  /** Why, for offline / error / signedOut. */
  message?: string;
  conflicts: Conflict[];
  /** Files whose pull was skipped because they have unsaved edits; retried next run. */
  pending: string[];
  pendingInstalls: string[];
  pendingRemovals: string[];
}

/** Returned from `activate`; the contract the Null workspace UI builds against. */
export interface NullSyncApi {
  getStatus(): SyncStatus;
  onDidChangeStatus: vscode.Event<void>;
  syncNow(): Promise<void>;
  resolveConflict(file: string, side: 'mine' | 'theirs'): Promise<void>;
}
```

- [ ] **Step 5: Write the failing test `src/layout.test.ts`**

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { categoryOf, fileOfRemoteName, isDeletable, isSyncableFile, remoteNameOf } from './layout';

describe('isSyncableFile', () => {
  it('accepts the two core files and plain snippet files', () => {
    for (const f of ['settings.json', 'keybindings.json', 'snippets/cpp.json', 'snippets/my.code-snippets']) {
      assert.equal(isSyncableFile(f), true, f);
    }
  });

  it('rejects anything else, including traversal', () => {
    const bad = [
      '', 'tasks.json', 'snippets/', 'snippets/a.txt', 'snippets/../settings.json', 'snippets/..\\x.json',
      'snippets/a/b.json', '../settings.json', 'snippets/C:x.json', '/etc/passwd', 'settings.json/..',
    ];
    for (const f of bad) assert.equal(isSyncableFile(f), false, f);
  });
});

describe('remote names', () => {
  it('round-trips every syncable file', () => {
    for (const f of ['settings.json', 'keybindings.json', 'snippets/cpp.json', 'snippets/a__b.code-snippets']) {
      assert.equal(fileOfRemoteName(remoteNameOf(f)), f, f);
    }
    assert.equal(remoteNameOf('snippets/cpp.json'), 'snippets__cpp.json.enc');
  });

  it('ignores remote names that are not ours or would escape the user folder', () => {
    const bad = [
      'manifest.json', 'settings.json', 'snippets__..\\..\\x.json.enc', 'snippets__a/b.json.enc',
      'snippets/a.json.enc', 'tasks.json.enc', '.enc', 'snippets__.enc', 'extensions.json.enc',
    ];
    for (const n of bad) assert.equal(fileOfRemoteName(n), undefined, n);
  });
});

describe('categories', () => {
  it('maps files to categories', () => {
    assert.equal(categoryOf('settings.json'), 'settings');
    assert.equal(categoryOf('keybindings.json'), 'keybindings');
    assert.equal(categoryOf('snippets/a.json'), 'snippets');
  });

  it('only snippets can be deleted', () => {
    assert.equal(isDeletable('snippets/a.json'), true);
    assert.equal(isDeletable('settings.json'), false);
    assert.equal(isDeletable('keybindings.json'), false);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd extensions/null-sync && npm test`
Expected: FAIL at `tsc` with `error TS2307: Cannot find module './layout'`.

- [ ] **Step 7: Write `src/layout.ts`**

```ts
'use strict';

import { Category } from './types';

/**
 * A synced local file is named relative to the user-data folder with `/` separators:
 * `settings.json`, `keybindings.json` or `snippets/<name>`.
 */
export const SETTINGS = 'settings.json';
export const KEYBINDINGS = 'keybindings.json';
export const CORE_FILES = [SETTINGS, KEYBINDINGS];
/** The plaintext file in the Gist that holds the KDF parameters and the passphrase check. */
export const MANIFEST = 'manifest.json';

const SNIPPET_NAME = /^[^\\/:*?"<>|]+\.(json|code-snippets)$/i;

/** The only names this extension reads or writes. Remote names are untrusted, so every local path goes through here. */
export function isSyncableFile(file: string): boolean {
  if (file === SETTINGS || file === KEYBINDINGS) return true;
  return file.startsWith('snippets/') && SNIPPET_NAME.test(file.slice('snippets/'.length));
}

export function categoryOf(file: string): Category {
  return file === SETTINGS ? 'settings' : file === KEYBINDINGS ? 'keybindings' : 'snippets';
}

/** A deleted snippet file is a change to sync; a missing settings/keybindings file is "no local data". */
export const isDeletable = (file: string): boolean => file.startsWith('snippets/');

/** Gist file names cannot contain `/`. */
export const remoteNameOf = (file: string): string => `${file.replace('/', '__')}.enc`;

/** The local file a remote name stands for, or `undefined` if it is not exactly the name we would have written. */
export function fileOfRemoteName(name: string): string | undefined {
  if (!name.endsWith('.enc')) return undefined;
  const stem = name.slice(0, -'.enc'.length);
  const file = stem.startsWith('snippets__') ? `snippets/${stem.slice('snippets__'.length)}` : stem;
  return isSyncableFile(file) && remoteNameOf(file) === name ? file : undefined;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd extensions/null-sync && npm test`
Expected: PASS — `tests 6`, `pass 6`, `fail 0`.

- [ ] **Step 9: Commit**

```bash
git add extensions/null-sync/package.json extensions/null-sync/package-lock.json extensions/null-sync/tsconfig.json extensions/null-sync/src/types.ts extensions/null-sync/src/layout.ts extensions/null-sync/src/layout.test.ts
git commit -m "feat(null-sync): scaffold extension, shared types and path-safe file layout (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/package.json extensions/null-sync/package-lock.json extensions/null-sync/tsconfig.json extensions/null-sync/src/types.ts extensions/null-sync/src/layout.ts extensions/null-sync/src/layout.test.ts
```

---

### Task 2: cryptoBox — encryption, manifest and passphrase policy

**Files:**
- Create: `extensions/null-sync/src/cryptoBox.ts`, `extensions/null-sync/src/cryptoBox.test.ts`
- Modify: `extensions/null-sync/package.json` (`test` script)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `MIN_PASSPHRASE = 12`
  - `passphraseProblem(passphrase: string, confirmation: string): string | undefined`
  - `seal(key: Buffer, name: string, plaintext: string): string` (JSON envelope)
  - `open(key: Buffer, name: string, text: string): string | undefined`
  - `makeManifest(passphrase: string): Promise<{ manifest: Manifest; key: Buffer }>`
  - `unlock(passphrase: string, manifestText: string | undefined): Promise<Buffer | undefined>`

- [ ] **Step 1: Write the failing test `src/cryptoBox.test.ts`**

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { makeManifest, open, passphraseProblem, seal, unlock } from './cryptoBox';

const PASS = 'correct horse battery staple';

describe('seal / open', () => {
  const key = Buffer.alloc(32, 7);

  it('round-trips text, including unicode, CRLF and empty', () => {
    for (const text of ['', 'hello', '{"a": "päss 日本語 🚀"}\r\n']) {
      assert.equal(open(key, 'x.enc', seal(key, 'x.enc', text)), text);
    }
  });

  it('uses a fresh IV every time', () => {
    assert.notEqual(seal(key, 'x', 'a'), seal(key, 'x', 'a'));
  });

  it('fails for the wrong key', () => {
    assert.equal(open(Buffer.alloc(32, 8), 'x', seal(key, 'x', 'secret')), undefined);
  });

  it('fails when the file name differs (a ciphertext moved to another name)', () => {
    assert.equal(open(key, 'y', seal(key, 'x', 'secret')), undefined);
  });

  it('fails when a ciphertext bit is flipped', () => {
    const e = JSON.parse(seal(key, 'x', 'secret'));
    const data = Buffer.from(e.data, 'base64');
    data[0] ^= 1;
    e.data = data.toString('base64');
    assert.equal(open(key, 'x', JSON.stringify(e)), undefined);
  });

  it('fails for a truncated auth tag', () => {
    const e = JSON.parse(seal(key, 'x', 'secret'));
    e.tag = Buffer.from(e.tag, 'base64').subarray(0, 4).toString('base64');
    assert.equal(open(key, 'x', JSON.stringify(e)), undefined);
  });

  it('rejects garbage and unknown versions without throwing', () => {
    for (const t of ['', 'not json', '{}', 'null', '{"v":2,"iv":"","tag":"","data":""}']) {
      assert.equal(open(key, 'x', t), undefined, t);
    }
  });
});

describe('manifest', () => {
  it('unlocks with the right passphrase and not with a wrong one', async () => {
    const { manifest, key } = await makeManifest(PASS);
    const text = JSON.stringify(manifest);
    assert.deepEqual(await unlock(PASS, text), key);
    assert.equal(await unlock(`${PASS}!`, text), undefined);
  });

  it('treats a unicode passphrase the same however it is composed', async () => {
    const composed = 'pa\u00dfw\u00f6rd \u65e5\u672c\u8a9e 123';
    const decomposed = composed.normalize('NFD');
    assert.notEqual(composed, decomposed);
    const { manifest } = await makeManifest(composed);
    assert.ok(await unlock(decomposed, JSON.stringify(manifest)));
  });

  it('refuses a missing manifest, garbage, or other KDF parameters', async () => {
    const { manifest } = await makeManifest(PASS);
    assert.equal(await unlock(PASS, undefined), undefined);
    assert.equal(await unlock(PASS, 'nope'), undefined);
    assert.equal(await unlock(PASS, JSON.stringify({ ...manifest, N: 2 ** 20 })), undefined);
    assert.equal(await unlock(PASS, JSON.stringify({ ...manifest, v: 2 })), undefined);
  });
});

describe('passphraseProblem', () => {
  it('requires 12 characters and a matching confirmation', () => {
    assert.match(passphraseProblem('short', 'short')!, /12/);
    assert.match(passphraseProblem('long enough passphrase', 'different one here')!, /match/);
    assert.equal(passphraseProblem('long enough passphrase', 'long enough passphrase'), undefined);
  });

  it('counts characters', () => {
    assert.equal(passphraseProblem('123456789012', '123456789012'), undefined);
    assert.match(passphraseProblem('12345678901', '12345678901')!, /12/);
  });
});
```

- [ ] **Step 2: Add the test file to the `test` script**

In `package.json` change `"test"` to:
`"tsc -p tsconfig.json && node --test out/layout.test.js out/cryptoBox.test.js"`

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd extensions/null-sync && npm test`
Expected: FAIL at `tsc` with `error TS2307: Cannot find module './cryptoBox'`.

- [ ] **Step 4: Write `src/cryptoBox.ts`**

```ts
'use strict';

import * as crypto from 'crypto';

const scrypt = (passphrase: string, salt: Buffer, keylen: number, options: crypto.ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    crypto.scrypt(passphrase, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });

const PARAMS = { N: 32768, r: 8, p: 1 } as const;
/** N=32768, r=8 needs exactly 32 MB, which is over Node's default `maxmem`. */
const MAX_MEMORY = 64 * 1024 * 1024;
const CHECK_NAME = 'manifest.json';
const CHECK_TEXT = 'null-sync';

export const MIN_PASSPHRASE = 12;

export interface Manifest {
  v: 1;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  /** base64 */
  salt: string;
  /** An envelope of a known string, to verify a passphrase without touching real data. */
  check: string;
}

interface Envelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

/** A message for the user, or `undefined` when the passphrase is acceptable. */
export function passphraseProblem(passphrase: string, confirmation: string): string | undefined {
  if ([...passphrase].length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters.`;
  if (passphrase !== confirmation) return 'The two passphrases do not match.';
  return undefined;
}

const derive = (passphrase: string, salt: Buffer): Promise<Buffer> =>
  scrypt(passphrase.normalize('NFC'), salt, 32, { ...PARAMS, maxmem: MAX_MEMORY });

/** Encrypts `plaintext` for the Gist file `name`; the name is bound as additional authenticated data. */
export function seal(key: Buffer, name: string, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(name));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const envelope: Envelope = {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  return JSON.stringify(envelope);
}

/** `undefined` for a wrong key, a tampered or renamed file, or anything that is not a v1 envelope. Never throws. */
export function open(key: Buffer, name: string, text: string): string | undefined {
  try {
    const envelope = JSON.parse(text) as Envelope;
    if (envelope.v !== 1) return undefined;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

export async function makeManifest(passphrase: string): Promise<{ manifest: Manifest; key: Buffer }> {
  const salt = crypto.randomBytes(16);
  const key = await derive(passphrase, salt);
  const manifest: Manifest = {
    v: 1,
    kdf: 'scrypt',
    ...PARAMS,
    salt: salt.toString('base64'),
    check: seal(key, CHECK_NAME, CHECK_TEXT),
  };
  return { manifest, key };
}

/** The key if `passphrase` matches this manifest; `undefined` for a wrong passphrase, an unknown format or parameters we did not write. */
export async function unlock(passphrase: string, manifestText: string | undefined): Promise<Buffer | undefined> {
  try {
    const m = JSON.parse(manifestText ?? '') as Manifest;
    if (m.v !== 1 || m.kdf !== 'scrypt' || m.N !== PARAMS.N || m.r !== PARAMS.r || m.p !== PARAMS.p) return undefined;
    const key = await derive(passphrase, Buffer.from(m.salt, 'base64'));
    return open(key, CHECK_NAME, m.check) === CHECK_TEXT ? key : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd extensions/null-sync && npm test`
Expected: PASS — all `layout` and `cryptoBox` tests, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-sync/package.json extensions/null-sync/src/cryptoBox.ts extensions/null-sync/src/cryptoBox.test.ts
git commit -m "feat(null-sync): AES-GCM envelope, scrypt manifest and passphrase policy (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/package.json extensions/null-sync/src/cryptoBox.ts extensions/null-sync/src/cryptoBox.test.ts
```

---

### Task 3: syncPlan — the three-way decision

**Files:**
- Create: `extensions/null-sync/src/syncPlan.ts`, `extensions/null-sync/src/syncPlan.test.ts`
- Modify: `extensions/null-sync/package.json` (`test` script)

**Interfaces:**
- Consumes: `Base`, `Value` from `types.ts`.
- Produces:
  - `type Action = 'none' | 'push' | 'pull' | 'conflict'`
  - `planFile(local: Value, remote: Value, base: Base | undefined, deletable: boolean): Action`
  - `interface FileState { local: Value; remote: Value; base: Base | undefined; deletable: boolean }`
  - `planAll(files: Record<string, FileState>): Record<string, Action>`

- [ ] **Step 1: Write the failing test `src/syncPlan.test.ts`**

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { planAll, planFile } from './syncPlan';
import { Base, Value } from './types';

const base = (local: Value, remote: Value): Base => ({ local, remote });

describe('planFile', () => {
  it('is none when both sides are equal, whatever the base', () => {
    assert.equal(planFile('a', 'a', undefined, false), 'none');
    assert.equal(planFile('a', 'a', base('b', 'c'), false), 'none');
    assert.equal(planFile(null, null, undefined, true), 'none');
  });

  it('first sync: a missing side has nothing to lose', () => {
    assert.equal(planFile(null, 'r', undefined, true), 'pull');
    assert.equal(planFile(null, 'r', undefined, false), 'pull');
    assert.equal(planFile('l', null, undefined, true), 'push');
    assert.equal(planFile('l', null, undefined, false), 'push');
  });

  it('first sync: both present and different is a conflict', () => {
    assert.equal(planFile('l', 'r', undefined, false), 'conflict');
    assert.equal(planFile('l', 'r', undefined, true), 'conflict');
  });

  it('only one side changed: that side wins', () => {
    assert.equal(planFile('l', 'y', base('x', 'y'), false), 'push');
    assert.equal(planFile('x', 'r', base('x', 'y'), false), 'pull');
  });

  it('neither side changed is none even if the two texts differ (settings.json after a pull)', () => {
    assert.equal(planFile('x', 'y', base('x', 'y'), false), 'none');
  });

  it('both changed to different content is a conflict', () => {
    assert.equal(planFile('l', 'r', base('x', 'y'), false), 'conflict');
  });

  it('a deleted snippet propagates in both directions', () => {
    assert.equal(planFile(null, 'y', base('x', 'y'), true), 'push');
    assert.equal(planFile('x', null, base('x', 'y'), true), 'pull');
  });

  it('a snippet deleted on one side and edited on the other is a conflict', () => {
    assert.equal(planFile('l', null, base('x', 'y'), true), 'conflict');
    assert.equal(planFile(null, 'r', base('x', 'y'), true), 'conflict');
  });

  it('a missing settings/keybindings file is never a deletion', () => {
    assert.equal(planFile(null, 'y', base('x', 'y'), false), 'pull');
    assert.equal(planFile(null, 'r', base('x', 'y'), false), 'pull');
    assert.equal(planFile('x', null, base('x', 'y'), false), 'push');
  });
});

describe('planAll', () => {
  it('plans every file independently', () => {
    const plan = planAll({
      'settings.json': { local: 'l', remote: 'y', base: base('x', 'y'), deletable: false },
      'keybindings.json': { local: 'a', remote: 'a', base: undefined, deletable: false },
      'snippets/a.json': { local: 'l', remote: 'r', base: base('x', 'y'), deletable: true },
    });
    assert.deepEqual(plan, { 'settings.json': 'push', 'keybindings.json': 'none', 'snippets/a.json': 'conflict' });
  });
});
```

- [ ] **Step 2: Add `out/syncPlan.test.js` to the `test` script**, then run `npm test`

Expected: FAIL at `tsc` with `error TS2307: Cannot find module './syncPlan'`.

- [ ] **Step 3: Write `src/syncPlan.ts`**

```ts
'use strict';

import { Base, Value } from './types';

export type Action = 'none' | 'push' | 'pull' | 'conflict';

/**
 * Decides what to do with one file. `local` and `remote` are hashes of what each side holds now (`null` = absent);
 * `base` is each side's hash at the last successful sync (`undefined` = never synced on this device).
 * Each side is compared with its own half of `base`, so a pull that rewrote the text slightly does not look like a change.
 * For files that are not `deletable`, `null` is never a change: a missing file is "no local data" and is restored, not propagated.
 */
export function planFile(local: Value, remote: Value, base: Base | undefined, deletable: boolean): Action {
  if (local === remote) return 'none';
  if (local === null && (!deletable || base === undefined)) return 'pull';
  if (remote === null && (!deletable || base === undefined)) return 'push';
  if (base === undefined) return 'conflict';
  const localChanged = local !== base.local;
  const remoteChanged = remote !== base.remote;
  if (!localChanged && !remoteChanged) return 'none';
  if (!remoteChanged) return 'push';
  if (!localChanged) return 'pull';
  return 'conflict';
}

export interface FileState {
  local: Value;
  remote: Value;
  base: Base | undefined;
  deletable: boolean;
}

export function planAll(files: Record<string, FileState>): Record<string, Action> {
  return Object.fromEntries(Object.entries(files).map(([file, s]) => [file, planFile(s.local, s.remote, s.base, s.deletable)]));
}
```

- [ ] **Step 4: Run `npm test`** — Expected: PASS, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-sync/package.json extensions/null-sync/src/syncPlan.ts extensions/null-sync/src/syncPlan.test.ts
git commit -m "feat(null-sync): three-way sync planner with per-side base hashes (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/package.json extensions/null-sync/src/syncPlan.ts extensions/null-sync/src/syncPlan.test.ts
```

---

### Task 4: settingsFilter — keep machine-specific and secret keys local

**Files:**
- Create: `extensions/null-sync/src/settingsFilter.ts`, `extensions/null-sync/src/settingsFilter.test.ts`
- Modify: `extensions/null-sync/package.json` (`test` script)

**Interfaces:**
- Consumes: `jsonc-parser` (`parse`, `modify`, `applyEdits`).
- Produces:
  - `matchesKey(key: string, patterns: string[]): boolean` (glob `*`, case-insensitive, anchored)
  - `stripExcluded(text: string, patterns: string[]): string | undefined` (`undefined` = not valid JSONC object)
  - `reapplyExcluded(incoming: string, current: string | null, patterns: string[]): string | undefined`

- [ ] **Step 1: Write the failing test `src/settingsFilter.test.ts`**

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parse } from 'jsonc-parser';
import { matchesKey, reapplyExcluded, stripExcluded } from './settingsFilter';

const EXCL = ['*.path', '*Path', '*token*', 'http.proxy'];
const obj = (text: string | undefined): unknown => parse(text ?? '');

describe('matchesKey', () => {
  it('matches glob patterns case-insensitively and anchored', () => {
    for (const k of ['git.path', 'rust-analyzer.server.path', 'python.defaultInterpreterPath', 'x.apiToken', 'http.proxy']) {
      assert.equal(matchesKey(k, EXCL), true, k);
    }
    for (const k of ['editor.fontSize', 'paths.x', 'workbench.colorTheme']) assert.equal(matchesKey(k, EXCL), false, k);
  });

  it('treats a dot in a pattern literally', () => {
    assert.equal(matchesKey('httpXproxy', ['http.proxy']), false);
  });
});

describe('stripExcluded', () => {
  const src = '{\n  // font\n  "editor.fontSize": 14,\n  "git.path": "C:\\\\git.exe",\n  "workbench.colorTheme": "Null Dark"\n}\n';

  it('removes matching keys and keeps comments, indentation and the other keys', () => {
    assert.equal(
      stripExcluded(src, EXCL),
      '{\n  // font\n  "editor.fontSize": 14,\n  "workbench.colorTheme": "Null Dark"\n}\n',
    );
  });

  it('leaves text byte-identical when nothing matches', () => {
    assert.equal(stripExcluded('{\n  "a": 1\n}\n', EXCL), '{\n  "a": 1\n}\n');
  });

  it('removes the last key without leaving a comma', () => {
    assert.equal(stripExcluded('{\n  "a": 1,\n  "git.path": "x"\n}\n', EXCL), '{\n  "a": 1\n}\n');
  });

  it('keeps tab indentation and CRLF line endings', () => {
    assert.equal(stripExcluded('{\n\t"a": 1,\n\t"git.path": "x"\n}\n', EXCL), '{\n\t"a": 1\n}\n');
    assert.equal(stripExcluded('{\r\n  "a": 1,\r\n  "git.path": "x"\r\n}\r\n', EXCL), '{\r\n  "a": 1\r\n}\r\n');
  });

  it('accepts comments and trailing commas', () => {
    assert.deepEqual(obj(stripExcluded('{\n  "a": 1, // one\n  "git.path": "x",\n}\n', EXCL)), { a: 1 });
  });

  it('treats an empty or blank file as valid and leaves it alone', () => {
    assert.equal(stripExcluded('', EXCL), '');
    assert.equal(stripExcluded('  \n', EXCL), '  \n');
  });

  it('returns undefined for invalid JSON or a non-object', () => {
    assert.equal(stripExcluded('{ "a": ', EXCL), undefined);
    assert.equal(stripExcluded('[1]', EXCL), undefined);
  });

  it('handles a file that holds only excluded keys', () => {
    assert.deepEqual(obj(stripExcluded('{\n  "git.path": "x"\n}\n', EXCL)), {});
  });
});

describe('reapplyExcluded', () => {
  const local = '{\n  // font\n  "editor.fontSize": 14,\n  "git.path": "C:\\\\git.exe",\n  "workbench.colorTheme": "Null Dark"\n}\n';

  it('puts this device\'s excluded values back into the incoming text', () => {
    const incoming = '{\n  "editor.fontSize": 16\n}\n';
    assert.deepEqual(obj(reapplyExcluded(incoming, local, EXCL)), { 'editor.fontSize': 16, 'git.path': 'C:\\git.exe' });
  });

  it('round-trips: strip then reapply gives back the same settings', () => {
    const stripped = stripExcluded(local, EXCL);
    assert.deepEqual(obj(reapplyExcluded(stripped!, local, EXCL)), obj(local));
  });

  it('drops an excluded key that an older client uploaded', () => {
    const incoming = '{\n  "a": 1,\n  "git.path": "REMOTE"\n}\n';
    assert.deepEqual(obj(reapplyExcluded(incoming, '{ "other": 1 }', EXCL)), { a: 1 });
  });

  it('with no local file there is nothing to put back', () => {
    assert.deepEqual(obj(reapplyExcluded('{\n  "a": 1\n}\n', null, EXCL)), { a: 1 });
  });

  it('keeps tabs and CRLF when inserting', () => {
    assert.equal(
      reapplyExcluded('{\n\t"a": 1\n}\n', '{ "git.path": "x" }', EXCL),
      '{\n\t"a": 1,\n\t"git.path": "x"\n}\n',
    );
    assert.equal(
      reapplyExcluded('{\r\n  "a": 1\r\n}\r\n', '{\r\n  "git.path": "D:\\\\b"\r\n}\r\n', EXCL),
      '{\r\n  "a": 1,\r\n  "git.path": "D:\\\\b"\r\n}\r\n',
    );
  });

  it('works when the incoming file is empty', () => {
    assert.deepEqual(obj(reapplyExcluded('', local, EXCL)), { 'git.path': 'C:\\git.exe' });
  });

  it('returns undefined when either side is not valid JSON', () => {
    assert.equal(reapplyExcluded('{ "a": ', local, EXCL), undefined);
    assert.equal(reapplyExcluded('{}', '{ bad', EXCL), undefined);
  });
});
```

- [ ] **Step 2: Add `out/settingsFilter.test.js` to the `test` script**, then run `npm test`

Expected: FAIL at `tsc` with `error TS2307: Cannot find module './settingsFilter'`.

- [ ] **Step 3: Write `src/settingsFilter.ts`**

```ts
'use strict';

import { applyEdits, modify, parse, ParseError } from 'jsonc-parser';

/** The top-level object of a settings file; `{}` for an empty file (valid in VS Code); `undefined` if it is not a JSONC object. */
function parsed(text: string): Record<string, unknown> | undefined {
  if (text.trim() === '') return {};
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  return errors.length === 0 && value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Edits must reuse the file's own indentation and line endings, or they reformat the whole file. */
function formatting(text: string) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = /^([ \t]+)"/m.exec(text)?.[1];
  if (indent?.startsWith('\t')) return { insertSpaces: false, tabSize: 4, eol };
  return { insertSpaces: true, tabSize: indent?.length ?? 4, eol };
}

const edit = (text: string, key: string, value: unknown): string =>
  applyEdits(text, modify(text, [key], value, { formattingOptions: formatting(text) }));

/** `*` matches any run of characters; matching is case-insensitive and anchored to the whole key. */
export function matchesKey(key: string, patterns: string[]): boolean {
  return patterns.some((p) =>
    new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i').test(key),
  );
}

/**
 * The text that is hashed and uploaded: `text` without its top-level keys that match `patterns`.
 * `undefined` if `text` is not a valid settings object. Comments and formatting of the other keys are preserved
 * (a trailing comment on a removed key may end up on the line above).
 */
export function stripExcluded(text: string, patterns: string[]): string | undefined {
  const settings = parsed(text);
  if (!settings) return undefined;
  return Object.keys(settings)
    .filter((key) => matchesKey(key, patterns))
    .reduce((acc, key) => edit(acc, key, undefined), text);
}

/**
 * Turns an uploaded (stripped) settings text into what to write locally: the incoming text plus this device's own values
 * for the excluded keys, taken from `current` (`null` = no local file). `undefined` if either side is not valid JSON.
 */
export function reapplyExcluded(incoming: string, current: string | null, patterns: string[]): string | undefined {
  const base = stripExcluded(incoming, patterns);
  if (base === undefined) return undefined;
  const mine = current === null ? {} : parsed(current);
  if (!mine) return undefined;
  const entries = Object.entries(mine).filter(([key]) => matchesKey(key, patterns));
  if (entries.length === 0) return base;
  return entries.reduce((acc, [key, value]) => edit(acc, key, value), base.trim() === '' ? '{}' : base);
}
```

- [ ] **Step 4: Run `npm test`** — Expected: PASS, `fail 0`. If an exact-string assertion differs only in whitespace from `jsonc-parser`'s output, fix the *implementation's* `formatting()` so the file's own style is kept; do not loosen the assertions (they pin the "preserves formatting" requirement).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-sync/package.json extensions/null-sync/src/settingsFilter.ts extensions/null-sync/src/settingsFilter.test.ts
git commit -m "feat(null-sync): exclude machine-specific and secret settings from sync (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/package.json extensions/null-sync/src/settingsFilter.ts extensions/null-sync/src/settingsFilter.test.ts
```

---
### Task 5: gistStore and gistHttp — the Gist REST client

**Files:**
- Create: `extensions/null-sync/src/gistStore.ts`, `extensions/null-sync/src/gistHttp.ts`, `extensions/null-sync/src/gistStore.test.ts`
- Modify: `extensions/null-sync/package.json` (`test` script)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (`gistStore.ts`):
  - `HttpReply { status: number; body: unknown }`
  - `HttpJson = (method: 'GET'|'POST'|'PATCH'|'DELETE', url: string, headers: Record<string,string>, body?: Record<string,unknown>) => Promise<HttpReply>`
  - `HttpText = (url: string, headers: Record<string,string>) => Promise<{ status: number; body: string }>`
  - `GistIo { json: HttpJson; text: HttpText }`
  - `Failure { ok: false; kind: 'offline'|'auth'|'notFound'|'error'; message: string }`, `Res<T> = { ok: true; value: T } | Failure`
  - `Snapshot { id: string; owner: string; files: Record<string,string> }`, `Revision { sha: string; date: string }`
  - `DESCRIPTION = 'Null IDE settings sync'`
  - `createGistStore(io: GistIo, token: string)` returning `{ find(): Promise<Res<string|undefined>>; read(id): Promise<Res<Snapshot>>; create(files: Record<string,string>): Promise<Res<Snapshot>>; update(id, changes: Record<string,string|null>): Promise<Res<void>>; remove(id): Promise<Res<void>>; revisions(id): Promise<Res<Revision[]>>; readRevision(id, sha): Promise<Res<Snapshot>> }`
  - `type GistStore = ReturnType<typeof createGistStore>`
- Produces (`gistHttp.ts`): `fetchJson: HttpJson`, `fetchText: HttpText`

- [ ] **Step 1: Write the failing test `src/gistStore.test.ts`**

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { DESCRIPTION, GistIo, HttpReply, createGistStore } from './gistStore';

interface Call { method: string; url: string; headers: Record<string, string>; body?: Record<string, unknown> }

function fake(replies: (HttpReply | Error)[], text: { status: number; body: string } = { status: 200, body: '' }) {
  const calls: Call[] = [];
  const textCalls: { url: string; headers: Record<string, string> }[] = [];
  const queue = [...replies];
  const io: GistIo = {
    json: async (method, url, headers, body) => {
      calls.push({ method, url, headers, body });
      const next = queue.shift();
      if (!next) throw new Error('unexpected request');
      if (next instanceof Error) throw next;
      return next;
    },
    text: async (url, headers) => {
      textCalls.push({ url, headers });
      return text;
    },
  };
  return { io, calls, textCalls };
}

const gist = (files: Record<string, unknown>) => ({ id: 'g1', owner: { login: 'me' }, files });

describe('find', () => {
  it('finds the gist by description and sends the token only as a bearer header', async () => {
    const { io, calls } = fake([{ status: 200, body: [{ id: 'x', description: 'other' }, { id: 'g1', description: DESCRIPTION }] }]);
    const found = await createGistStore(io, 'tok').find();
    assert.deepEqual(found, { ok: true, value: 'g1' });
    assert.equal(calls[0].headers.Authorization, 'Bearer tok');
    assert.match(calls[0].url, /per_page=100&page=1$/);
    assert.equal(JSON.stringify(calls[0].body ?? {}).includes('tok'), false);
  });

  it('returns undefined when there is none, without paging past a short page', async () => {
    const { io, calls } = fake([{ status: 200, body: [] }]);
    assert.deepEqual(await createGistStore(io, 't').find(), { ok: true, value: undefined });
    assert.equal(calls.length, 1);
  });

  it('keeps paging while pages are full', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, description: 'nope' }));
    const { io, calls } = fake([{ status: 200, body: full }, { status: 200, body: [{ id: 'g2', description: DESCRIPTION }] }]);
    assert.deepEqual(await createGistStore(io, 't').find(), { ok: true, value: 'g2' });
    assert.match(calls[1].url, /page=2$/);
  });
});

describe('read', () => {
  it('returns the owner and every file\'s content', async () => {
    const { io } = fake([{ status: 200, body: gist({ 'a.enc': { content: 'A' }, 'manifest.json': { content: 'M' } }) }]);
    assert.deepEqual(await createGistStore(io, 't').read('g1'), {
      ok: true,
      value: { id: 'g1', owner: 'me', files: { 'a.enc': 'A', 'manifest.json': 'M' } },
    });
  });

  it('fetches a truncated file from the raw host without sending the token', async () => {
    const raw = 'https://gist.githubusercontent.com/me/g1/raw/a.enc';
    const { io, textCalls } = fake(
      [{ status: 200, body: gist({ 'a.enc': { truncated: true, raw_url: raw, content: 'cut' }, 'b.enc': { content: 'B' } }) }],
      { status: 200, body: 'FULL' },
    );
    const read = await createGistStore(io, 'secret').read('g1');
    assert.deepEqual(read.ok && read.value.files, { 'a.enc': 'FULL', 'b.enc': 'B' });
    assert.deepEqual(textCalls, [{ url: raw, headers: {} }]);
  });

  it('refuses a truncated file whose URL is not on the raw host', async () => {
    const { io, textCalls } = fake([{ status: 200, body: gist({ 'a.enc': { truncated: true, raw_url: 'https://evil.example/x' } }) }]);
    const read = await createGistStore(io, 't').read('g1');
    assert.equal(read.ok, false);
    assert.equal(textCalls.length, 0);
  });

  it('rejects a body that is not a gist', async () => {
    const { io } = fake([{ status: 200, body: { hello: 'world' } }]);
    const read = await createGistStore(io, 't').read('g1');
    assert.equal(!read.ok && read.kind, 'error');
  });
});

describe('write calls', () => {
  it('creates a secret gist with the description', async () => {
    const { io, calls } = fake([{ status: 201, body: gist({ 'manifest.json': { content: 'M' } }) }]);
    const created = await createGistStore(io, 't').create({ 'manifest.json': 'M' });
    assert.equal(created.ok, true);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].body, { description: DESCRIPTION, public: false, files: { 'manifest.json': { content: 'M' } } });
  });

  it('updates changed files in one PATCH and deletes with null', async () => {
    const { io, calls } = fake([{ status: 200, body: gist({}) }]);
    const updated = await createGistStore(io, 't').update('g 1', { 'a.enc': 'X', 'b.enc': null });
    assert.equal(updated.ok, true);
    assert.equal(calls[0].method, 'PATCH');
    assert.ok(calls[0].url.endsWith('/gists/g%201'));
    assert.deepEqual(calls[0].body, { files: { 'a.enc': { content: 'X' }, 'b.enc': null } });
  });

  it('removes a gist', async () => {
    const { io, calls } = fake([{ status: 204, body: undefined }]);
    assert.equal((await createGistStore(io, 't').remove('g1')).ok, true);
    assert.equal(calls[0].method, 'DELETE');
  });
});

describe('revisions', () => {
  it('lists commits newest first and reads one by sha', async () => {
    const { io, calls } = fake([
      { status: 200, body: [{ version: 'c2', committed_at: '2026-02-01T00:00:00Z' }, { version: 'c1', committed_at: '2026-01-01T00:00:00Z' }] },
      { status: 200, body: gist({ 'a.enc': { content: 'OLD' } }) },
    ]);
    const store = createGistStore(io, 't');
    assert.deepEqual(await store.revisions('g1'), {
      ok: true,
      value: [{ sha: 'c2', date: '2026-02-01T00:00:00Z' }, { sha: 'c1', date: '2026-01-01T00:00:00Z' }],
    });
    const old = await store.readRevision('g1', 'c1');
    assert.deepEqual(old.ok && old.value.files, { 'a.enc': 'OLD' });
    assert.ok(calls[1].url.endsWith('/gists/g1/c1'));
  });
});

describe('failures', () => {
  it('maps 401/403 to auth and mentions the gist scope', async () => {
    for (const status of [401, 403]) {
      const { io } = fake([{ status, body: { message: 'Bad credentials' } }]);
      const r = await createGistStore(io, 't').read('g1');
      assert.equal(!r.ok && r.kind, 'auth');
      assert.match(!r.ok ? r.message : '', /gist/);
      assert.match(!r.ok ? r.message : '', /Bad credentials/);
    }
  });

  it('maps 404 to notFound', async () => {
    const { io } = fake([{ status: 404, body: { message: 'Not Found' } }]);
    const r = await createGistStore(io, 't').read('g1');
    assert.equal(!r.ok && r.kind, 'notFound');
  });

  it('maps a network failure to offline', async () => {
    const { io } = fake([new Error('getaddrinfo ENOTFOUND api.github.com')]);
    const r = await createGistStore(io, 't').read('g1');
    assert.equal(!r.ok && r.kind, 'offline');
    assert.match(!r.ok ? r.message : '', /ENOTFOUND/);
  });

  it('echoes only a short JSON message, never an HTML error page', async () => {
    const { io } = fake([{ status: 500, body: '<html><body>Bad gateway</body></html>' }, { status: 502, body: { message: 'x'.repeat(500) } }]);
    const store = createGistStore(io, 't');
    const html = await store.read('g1');
    assert.equal(!html.ok && html.message, 'GitHub answered HTTP 500.');
    const long = await store.read('g1');
    assert.ok(!long.ok && long.message.length < 260);
  });
});
```

- [ ] **Step 2: Add `out/gistStore.test.js` to the `test` script**, then run `npm test`

Expected: FAIL at `tsc` with `error TS2307: Cannot find module './gistStore'`.

- [ ] **Step 3: Write `src/gistStore.ts`**

```ts
'use strict';

export interface HttpReply {
  status: number;
  body: unknown;
}

/** Resolves any HTTP response; rejects only on a network failure. */
export type HttpJson = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  headers: Record<string, string>,
  body?: Record<string, unknown>,
) => Promise<HttpReply>;

export type HttpText = (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>;

export interface GistIo {
  json: HttpJson;
  text: HttpText;
}

export interface Failure {
  ok: false;
  kind: 'offline' | 'auth' | 'notFound' | 'error';
  message: string;
}
export type Res<T> = { ok: true; value: T } | Failure;

export interface Snapshot {
  id: string;
  owner: string;
  /** Gist file name → content */
  files: Record<string, string>;
}

export interface Revision {
  sha: string;
  date: string;
}

export const DESCRIPTION = 'Null IDE settings sync';
const API = 'https://api.github.com/gists';
const RAW_HOST = /^https:\/\/gist\.githubusercontent\.com\//;
const PAGES = 3;

const failure = (kind: Failure['kind'], message: string): Failure => ({ ok: false, kind, message });
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Only a JSON `message`; a non-JSON body (an HTML error page from an outage or proxy) is never echoed. */
function serverSays(body: unknown): string {
  const message = typeof body === 'object' && body ? (body as { message?: unknown }).message : undefined;
  return typeof message === 'string' ? message.replace(/\s+/g, ' ').slice(0, 200) : '';
}

const toApiFiles = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { content }]));

export type GistStore = ReturnType<typeof createGistStore>;

/** Every method resolves; none throws. The token only ever goes in the `Authorization` header of a GitHub API call. */
export function createGistStore(io: GistIo, token: string) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };

  async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: Record<string, unknown>): Promise<Res<unknown>> {
    let reply: HttpReply;
    try {
      reply = await io.json(method, url, headers, body);
    } catch (err) {
      return failure('offline', `Could not reach GitHub (${messageOf(err)}).`);
    }
    const said = serverSays(reply.body);
    if (reply.status === 401 || reply.status === 403) {
      return failure('auth', `GitHub refused (HTTP ${reply.status}): the sign-in needs the "gist" scope.${said ? ` ${said}` : ''}`);
    }
    if (reply.status === 404) return failure('notFound', 'The sync Gist no longer exists.');
    if (reply.status < 200 || reply.status >= 300) {
      return failure('error', `GitHub answered HTTP ${reply.status}${said ? `: ${said}` : '.'}`);
    }
    return { ok: true, value: reply.body };
  }

  async function snapshotOf(body: unknown): Promise<Res<Snapshot>> {
    const gist = body as
      | {
          id?: unknown;
          owner?: { login?: unknown };
          files?: Record<string, { content?: unknown; truncated?: unknown; raw_url?: unknown } | null>;
        }
      | undefined;
    if (typeof gist?.id !== 'string' || typeof gist.owner?.login !== 'string' || !gist.files) {
      return failure('error', 'GitHub returned an unexpected Gist.');
    }
    const files: Record<string, string> = {};
    for (const [name, file] of Object.entries(gist.files)) {
      if (!file) continue;
      if (file.truncated === true) {
        const url = typeof file.raw_url === 'string' ? file.raw_url : '';
        if (!RAW_HOST.test(url)) return failure('error', `GitHub returned an unexpected location for ${name}.`);
        try {
          const raw = await io.text(url, {});
          if (raw.status !== 200) return failure('error', `GitHub answered HTTP ${raw.status} for ${name}.`);
          files[name] = raw.body;
        } catch (err) {
          return failure('offline', `Could not reach GitHub (${messageOf(err)}).`);
        }
      } else if (typeof file.content === 'string') {
        files[name] = file.content;
      }
    }
    return { ok: true, value: { id: gist.id, owner: gist.owner.login, files } };
  }

  return {
    /** The id of this user's sync Gist (matched by description), or `undefined` if there is none. */
    async find(): Promise<Res<string | undefined>> {
      for (let page = 1; page <= PAGES; page++) {
        const r = await call('GET', `${API}?per_page=100&page=${page}`);
        if (!r.ok) return r;
        const list = Array.isArray(r.value) ? (r.value as { id?: unknown; description?: unknown }[]) : [];
        const hit = list.find((g) => g.description === DESCRIPTION && typeof g.id === 'string');
        if (hit) return { ok: true, value: hit.id as string };
        if (list.length < 100) break;
      }
      return { ok: true, value: undefined };
    },

    async read(id: string): Promise<Res<Snapshot>> {
      const r = await call('GET', `${API}/${encodeURIComponent(id)}`);
      return r.ok ? snapshotOf(r.value) : r;
    },

    async create(files: Record<string, string>): Promise<Res<Snapshot>> {
      const r = await call('POST', API, { description: DESCRIPTION, public: false, files: toApiFiles(files) });
      return r.ok ? snapshotOf(r.value) : r;
    },

    /** One PATCH; a `null` content deletes the file. */
    async update(id: string, changes: Record<string, string | null>): Promise<Res<void>> {
      const files = Object.fromEntries(Object.entries(changes).map(([name, content]) => [name, content === null ? null : { content }]));
      const r = await call('PATCH', `${API}/${encodeURIComponent(id)}`, { files });
      return r.ok ? { ok: true, value: undefined } : r;
    },

    async remove(id: string): Promise<Res<void>> {
      const r = await call('DELETE', `${API}/${encodeURIComponent(id)}`);
      return r.ok ? { ok: true, value: undefined } : r;
    },

    /** Newest first. */
    async revisions(id: string): Promise<Res<Revision[]>> {
      const r = await call('GET', `${API}/${encodeURIComponent(id)}/commits`);
      if (!r.ok) return r;
      const list = Array.isArray(r.value) ? (r.value as { version?: unknown; committed_at?: unknown }[]) : [];
      return {
        ok: true,
        value: list.flatMap((c) =>
          typeof c.version === 'string' && typeof c.committed_at === 'string' ? [{ sha: c.version, date: c.committed_at }] : [],
        ),
      };
    },

    async readRevision(id: string, sha: string): Promise<Res<Snapshot>> {
      const r = await call('GET', `${API}/${encodeURIComponent(id)}/${encodeURIComponent(sha)}`);
      return r.ok ? snapshotOf(r.value) : r;
    },
  };
}
```

- [ ] **Step 4: Write `src/gistHttp.ts`** (the only `fetch` caller; compile-checked, no unit test)

```ts
'use strict';

import { HttpJson, HttpText } from './gistStore';

const TIMEOUT_MS = 15_000;

/** The only network calls in this extension: GitHub's Gist API and the raw host for truncated files. */
export const fetchJson: HttpJson = async (method, url, headers, body) => {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'null-ide', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    /* keep the raw text */
  }
  return { status: res.status, body: parsed };
};

export const fetchText: HttpText = async (url, headers) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'null-ide', ...headers },
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, body: await res.text() };
};
```

- [ ] **Step 5: Run `npm test`** — Expected: PASS, `fail 0` (and `tsc` compiles `gistHttp.ts`).

- [ ] **Step 6: Commit**

```bash
git add extensions/null-sync/package.json extensions/null-sync/src/gistStore.ts extensions/null-sync/src/gistHttp.ts extensions/null-sync/src/gistStore.test.ts
git commit -m "feat(null-sync): Gist REST client with typed failures (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/package.json extensions/null-sync/src/gistStore.ts extensions/null-sync/src/gistHttp.ts extensions/null-sync/src/gistStore.test.ts
```

---

### Task 6: localFiles — read, list, atomic write and backups

**Files:**
- Create: `extensions/null-sync/src/localFiles.ts`, `extensions/null-sync/src/localFiles.test.ts`
- Modify: `extensions/null-sync/package.json` (`test` script)

**Interfaces:**
- Consumes: `CORE_FILES`, `categoryOf`, `isSyncableFile` (layout), `Category` (types).
- Produces:
  - `LocalFilesOptions { userDir: string; backupsDir: string; isDirty(absolutePath: string): boolean; now(): number }`
  - `class LocalFiles` with `read(file): Promise<string|null>`, `list(categories: Category[]): Promise<Record<string,string>>`, `write(file, content: string|null): Promise<void>` (backs up first; `null` deletes), `isDirty(file): boolean`

- [ ] **Step 1: Write the failing test `src/localFiles.test.ts`**

```ts
import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalFiles } from './localFiles';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function setup(dirty: string[] = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-files-'));
  made.push(root);
  const userDir = path.join(root, 'User');
  const backupsDir = path.join(root, 'backups');
  fs.mkdirSync(path.join(userDir, 'snippets'), { recursive: true });
  let clock = 1;
  const files = new LocalFiles({
    userDir,
    backupsDir,
    isDirty: (p) => dirty.includes(p),
    now: () => clock++,
  });
  return { userDir, backupsDir, files };
}

describe('read / list', () => {
  it('reads null for a missing file', async () => {
    assert.equal(await setup().files.read('keybindings.json'), null);
  });

  it('lists only existing synced files in the requested categories', async () => {
    const { userDir, files } = setup();
    fs.writeFileSync(path.join(userDir, 'settings.json'), 'S');
    fs.writeFileSync(path.join(userDir, 'snippets', 'a.json'), 'A');
    fs.writeFileSync(path.join(userDir, 'snippets', 'readme.txt'), 'no');
    fs.mkdirSync(path.join(userDir, 'snippets', 'dir.json'));
    assert.deepEqual(await files.list(['settings']), { 'settings.json': 'S' });
    assert.deepEqual(await files.list(['snippets']), { 'snippets/a.json': 'A' });
    assert.deepEqual(await files.list(['settings', 'keybindings', 'snippets']), { 'settings.json': 'S', 'snippets/a.json': 'A' });
  });
});

describe('write', () => {
  it('creates the file (and the snippets folder) atomically, leaving no temp file', async () => {
    const { userDir, files } = setup();
    fs.rmSync(path.join(userDir, 'snippets'), { recursive: true });
    await files.write('snippets/a.json', 'A');
    assert.equal(fs.readFileSync(path.join(userDir, 'snippets', 'a.json'), 'utf8'), 'A');
    assert.deepEqual(fs.readdirSync(path.join(userDir, 'snippets')), ['a.json']);
  });

  it('backs up the previous content before overwriting or deleting', async () => {
    const { backupsDir, files } = setup();
    await files.write('settings.json', 'v1');
    await files.write('settings.json', 'v2');
    await files.write('settings.json', null);
    assert.equal(await files.read('settings.json'), null);
    const backups = fs.readdirSync(backupsDir).sort();
    assert.deepEqual(backups.map((b) => fs.readFileSync(path.join(backupsDir, b), 'utf8')), ['v1', 'v2']);
  });

  it('keeps only the 10 newest backups per file', async () => {
    const { backupsDir, files } = setup();
    for (let i = 1; i <= 13; i++) await files.write('settings.json', `v${i}`);
    const stamps = fs.readdirSync(backupsDir).filter((n) => n.startsWith('settings.json.')).map((n) => Number(n.split('.').pop()));
    assert.equal(stamps.length, 10);
    assert.equal(Math.min(...stamps), 3);
  });

  it('does not mix backups of different files', async () => {
    const { backupsDir, files } = setup();
    await files.write('snippets/a.json', '1');
    await files.write('snippets/a.json', '2');
    await files.write('settings.json', '1');
    await files.write('settings.json', '2');
    assert.deepEqual(fs.readdirSync(backupsDir).map((n) => n.split('.')[0]).sort(), ['settings', 'snippets__a']);
  });
});

describe('safety', () => {
  it('refuses any name outside the synced set', async () => {
    const { files } = setup();
    for (const name of ['../evil.json', 'snippets/..\\x.json', 'snippets/a/b.json', 'tasks.json']) {
      await assert.rejects(files.write(name, 'x'), /Refusing/, name);
      await assert.rejects(files.read(name), /Refusing/, name);
    }
  });

  it('asks the editor about the absolute path', () => {
    const { userDir } = setup();
    const dirtyPath = path.join(userDir, 'settings.json');
    const files = new LocalFiles({ userDir, backupsDir: '', isDirty: (p) => p === dirtyPath, now: () => 0 });
    assert.equal(files.isDirty('settings.json'), true);
    assert.equal(files.isDirty('keybindings.json'), false);
  });
});
```

- [ ] **Step 2: Add `out/localFiles.test.js` to the `test` script**, then run `npm test`

Expected: FAIL at `tsc` with `error TS2307: Cannot find module './localFiles'`.

- [ ] **Step 3: Write `src/localFiles.ts`**

```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { CORE_FILES, categoryOf, isSyncableFile } from './layout';
import { Category } from './types';

const KEEP_BACKUPS = 10;

export interface LocalFilesOptions {
  /** `<User>`: the folder that holds settings.json, keybindings.json and snippets/. */
  userDir: string;
  /** Where the losing version of a pull or conflict is kept (`<name>.<ms timestamp>`). */
  backupsDir: string;
  /** True while the file at this absolute path is open in an editor with unsaved edits. */
  isDirty(absolutePath: string): boolean;
  now(): number;
}

/** The synced files on disk. Every name goes through `isSyncableFile`, so a hostile remote name can never reach the file system. */
export class LocalFiles {
  constructor(private readonly options: LocalFilesOptions) {}

  private pathOf(file: string): string {
    if (!isSyncableFile(file)) throw new Error(`Refusing to touch '${file}'.`);
    return path.join(this.options.userDir, ...file.split('/'));
  }

  isDirty(file: string): boolean {
    return this.options.isDirty(this.pathOf(file));
  }

  /** `null` if the file does not exist. */
  async read(file: string): Promise<string | null> {
    try {
      return await fs.promises.readFile(this.pathOf(file), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Raw contents of every existing synced file in the given categories. */
  async list(categories: Category[]): Promise<Record<string, string>> {
    const found: Record<string, string> = {};
    const add = async (file: string): Promise<void> => {
      try {
        const text = await this.read(file);
        if (text !== null) found[file] = text;
      } catch {
        /* unreadable (for example a folder named x.json): not a synced file */
      }
    };
    for (const file of CORE_FILES) {
      if (categories.includes(categoryOf(file))) await add(file);
    }
    if (categories.includes('snippets')) {
      let names: string[] = [];
      try {
        names = await fs.promises.readdir(path.join(this.options.userDir, 'snippets'));
      } catch {
        /* no snippets folder */
      }
      for (const name of names) {
        if (isSyncableFile(`snippets/${name}`)) await add(`snippets/${name}`);
      }
    }
    return found;
  }

  /** Writes atomically (temp file + rename) after backing up what is there; `null` deletes the file. */
  async write(file: string, content: string | null): Promise<void> {
    const target = this.pathOf(file);
    await this.backup(file, target);
    if (content === null) {
      await fs.promises.rm(target, { force: true });
      return;
    }
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.null-sync.tmp`;
    await fs.promises.writeFile(temp, content, 'utf8');
    await fs.promises.rename(temp, target);
  }

  private async backup(file: string, target: string): Promise<void> {
    if (!fs.existsSync(target)) return;
    const { backupsDir, now } = this.options;
    await fs.promises.mkdir(backupsDir, { recursive: true });
    const stem = file.replace('/', '__');
    await fs.promises.copyFile(target, path.join(backupsDir, `${stem}.${now()}`));
    const stamp = (name: string): number | undefined => {
      const rest = name.startsWith(`${stem}.`) ? name.slice(stem.length + 1) : '';
      return /^\d+$/.test(rest) ? Number(rest) : undefined;
    };
    const mine = (await fs.promises.readdir(backupsDir))
      .filter((name) => stamp(name) !== undefined)
      .sort((a, b) => stamp(b)! - stamp(a)!);
    for (const old of mine.slice(KEEP_BACKUPS)) await fs.promises.rm(path.join(backupsDir, old), { force: true });
  }
}
```

- [ ] **Step 4: Run `npm test`** — Expected: PASS, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-sync/package.json extensions/null-sync/src/localFiles.ts extensions/null-sync/src/localFiles.test.ts
git commit -m "feat(null-sync): safe local file access with atomic writes and backups (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/package.json extensions/null-sync/src/localFiles.ts extensions/null-sync/src/localFiles.test.ts
```

---

### Task 7: lock — keep several windows from syncing at once

**Files:**
- Create: `extensions/null-sync/src/lock.ts`, `extensions/null-sync/src/lock.test.ts`
- Modify: `extensions/null-sync/package.json` (`test` script)

**Interfaces:**
- Produces: `type Release = () => Promise<void>`; `acquire(lockPath: string, now?: () => number, staleMs?: number): Promise<Release | undefined>` (never throws; `undefined` = another window holds it)

- [ ] **Step 1: Write the failing test `src/lock.test.ts`**

```ts
import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { acquire } from './lock';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const lockPath = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-lock-'));
  made.push(dir);
  return path.join(dir, 'nested', 'lock');
};

describe('acquire', () => {
  it('creates the folder and holds the lock until released', async () => {
    const lock = lockPath();
    const release = await acquire(lock);
    assert.ok(release);
    assert.equal(await acquire(lock), undefined, 'a second window must not get it');
    await release();
    assert.ok(await acquire(lock), 'free again after release');
  });

  it('takes over a lock older than the stale limit', async () => {
    const lock = lockPath();
    assert.ok(await acquire(lock));
    const old = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(lock, old, old);
    assert.ok(await acquire(lock), 'a crashed window must not block sync forever');
  });

  it('does not take over a fresh lock', async () => {
    const lock = lockPath();
    assert.ok(await acquire(lock));
    assert.equal(await acquire(lock, Date.now, 60_000), undefined);
  });

  it('returns undefined instead of throwing when the path is unusable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-lock-'));
    made.push(dir);
    fs.writeFileSync(path.join(dir, 'file'), 'x');
    assert.equal(await acquire(path.join(dir, 'file', 'lock')), undefined);
  });
});
```

- [ ] **Step 2: Add `out/lock.test.js` to the `test` script**, then run `npm test`

Expected: FAIL at `tsc` with `error TS2307: Cannot find module './lock'`.

- [ ] **Step 3: Write `src/lock.ts`**

```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';

const STALE_MS = 120_000;

export type Release = () => Promise<void>;

/**
 * Several windows share one user-data folder and each runs the sync timers. A run takes this lock first and
 * skips when another window holds it. A lock older than `staleMs` belongs to a crashed window and is taken over.
 * Never throws. ponytail: a lock file with a stale timeout, not leader election; two windows taking over the same
 * stale lock in the same instant can both proceed, which the three-way plan tolerates (the second push is a no-op).
 */
export async function acquire(lockPath: string, now: () => number = Date.now, staleMs = STALE_MS): Promise<Release | undefined> {
  try {
    await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await fs.promises.open(lockPath, 'wx');
        await handle.writeFile(`${process.pid} ${now()}`);
        await handle.close();
        return () => fs.promises.rm(lockPath, { force: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return undefined;
        const stat = await fs.promises.stat(lockPath).catch(() => undefined);
        if (stat && now() - stat.mtimeMs < staleMs) return undefined;
        await fs.promises.rm(lockPath, { force: true });
      }
    }
  } catch {
    /* an unusable path means no sync this time */
  }
  return undefined;
}
```

- [ ] **Step 4: Run `npm test`** — Expected: PASS, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-sync/package.json extensions/null-sync/src/lock.ts extensions/null-sync/src/lock.test.ts
git commit -m "feat(null-sync): cross-window run lock (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/package.json extensions/null-sync/src/lock.ts extensions/null-sync/src/lock.test.ts
```

---
### Task 8: enable flow and the in-memory fake Gist

**Files:**
- Create: `extensions/null-sync/src/enable.ts`, `extensions/null-sync/src/fakeGist.ts`, `extensions/null-sync/src/enable.test.ts`
- Modify: `extensions/null-sync/package.json` (`test` script)

**Interfaces:**
- Consumes: `makeManifest`, `unlock` (cryptoBox); `createGistStore`, `GistIo`, `Snapshot` (gistStore); `MANIFEST` (layout); `Category`, `FirstSync`, `StoredState`, `SyncAccount` (types).
- Produces (`enable.ts`):
  - `CANCELLED = 'Cancelled.'`
  - `EnableDeps { accounts(): Promise<SyncAccount[]>; token(accountId: string, interactive: boolean): Promise<string | undefined>; io: GistIo; categories(): Category[]; savePassphrase(passphrase: string): Promise<void>; setState(state: StoredState): Promise<void> }`
  - `EnablePrompts { chooseAccount(accounts: SyncAccount[]): Promise<SyncAccount | undefined>; consent(categories: Category[]): Promise<boolean>; newPassphrase(): Promise<string | undefined>; existingPassphrase(attempt: number): Promise<string | undefined>; firstSync(): Promise<FirstSync | 'each' | undefined> }`
  - `EnableResult = { ok: true; firstSync?: FirstSync } | { ok: false; message: string }`
  - `enable(deps: EnableDeps, prompts: EnablePrompts): Promise<EnableResult>`
- Produces (`fakeGist.ts`): `class FakeGist` with `offline: boolean`, `io: GistIo`, `ids(): string[]`, `has(id): boolean`, `files(id): Record<string,string>`, `revisionCount(id): number`, `tamper(id, name, text): void`, `delete(id): void`

- [ ] **Step 1: Write `src/fakeGist.ts`** (test support; compiled with the rest, like null-accounts' `testFakes.ts`)

```ts
'use strict';

import { GistIo, HttpReply } from './gistStore';

interface Record_ {
  description: string;
  owner: string;
  /** Every revision's full file set, oldest first. */
  revisions: Record<string, string>[];
}

/** An in-memory stand-in for GitHub's Gist API: just enough of it for the engine and two-device tests. */
export class FakeGist {
  /** While true every request fails like a lost connection. */
  offline = false;
  private readonly gists = new Map<string, Record_>();
  private counter = 1;

  readonly io: GistIo = {
    json: async (method, url, _headers, body) => this.handle(method, url, body),
    text: async () => ({ status: 404, body: '' }),
  };

  ids(): string[] {
    return [...this.gists.keys()];
  }
  has(id: string): boolean {
    return this.gists.has(id);
  }
  /** The newest revision's files (Gist file name → stored text). */
  files(id: string): Record<string, string> {
    const record = this.gists.get(id)!;
    return record.revisions[record.revisions.length - 1];
  }
  revisionCount(id: string): number {
    return this.gists.get(id)!.revisions.length;
  }
  delete(id: string): void {
    this.gists.delete(id);
  }
  /** Replaces one file's stored text in a new revision, to simulate corruption or tampering. */
  tamper(id: string, name: string, text: string): void {
    this.gists.get(id)!.revisions.push({ ...this.files(id), [name]: text });
  }

  private view(id: string, record: Record_, revision: Record<string, string>) {
    return {
      id,
      owner: { login: record.owner },
      files: Object.fromEntries(Object.entries(revision).map(([name, content]) => [name, { content }])),
    };
  }

  private handle(method: string, url: string, body?: Record<string, unknown>): HttpReply {
    if (this.offline) throw new Error('getaddrinfo ENOTFOUND api.github.com');
    const parsed = new URL(url);
    const [root, id, sub] = parsed.pathname.split('/').filter(Boolean);
    const notFound: HttpReply = { status: 404, body: { message: 'Not Found' } };
    if (root !== 'gists') return notFound;

    if (id === undefined) {
      if (method === 'GET') {
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const list = [...this.gists].map(([gid, g]) => ({ id: gid, description: g.description })).reverse();
        return { status: 200, body: page === 1 ? list : [] };
      }
      const newId = `gist${this.counter++}`;
      const files = Object.fromEntries(
        Object.entries(body!.files as Record<string, { content: string }>).map(([name, f]) => [name, f.content]),
      );
      const created = { description: String(body!.description), owner: 'me', revisions: [files] };
      this.gists.set(newId, created);
      return { status: 201, body: this.view(newId, created, files) };
    }

    const record = this.gists.get(id);
    if (!record) return notFound;
    const latest = record.revisions[record.revisions.length - 1];
    if (method === 'DELETE') {
      this.gists.delete(id);
      return { status: 204, body: undefined };
    }
    if (method === 'PATCH') {
      const next = { ...latest };
      for (const [name, f] of Object.entries(body!.files as Record<string, { content: string } | null>)) {
        if (f === null) delete next[name];
        else next[name] = f.content;
      }
      record.revisions.push(next);
      return { status: 200, body: this.view(id, record, next) };
    }
    if (sub === 'commits') {
      const commits = record.revisions.map((_, i) => ({
        version: `v${i + 1}`,
        committed_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      }));
      return { status: 200, body: commits.reverse() };
    }
    if (sub !== undefined) {
      const revision = record.revisions[Number(sub.slice(1)) - 1];
      return revision ? { status: 200, body: this.view(id, record, revision) } : notFound;
    }
    return { status: 200, body: this.view(id, record, latest) };
  }
}
```

- [ ] **Step 2: Write the failing test `src/enable.test.ts`**

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CANCELLED, EnableDeps, EnablePrompts, enable } from './enable';
import { FakeGist } from './fakeGist';
import { MANIFEST } from './layout';
import { FirstSync, StoredState, SyncAccount } from './types';

const PASS = 'correct horse battery staple';
const ME: SyncAccount = { id: 'acc', username: 'me' };

function setup(gist: FakeGist, over: Partial<EnableDeps> = {}, prompts: Partial<EnablePrompts> = {}) {
  const saved: { passphrase?: string; state?: StoredState } = {};
  const asked: { attempts: number[]; consent?: string[] } = { attempts: [] };
  const deps: EnableDeps = {
    accounts: async () => [ME],
    token: async () => 'token',
    io: gist.io,
    categories: () => ['settings', 'keybindings', 'snippets'],
    savePassphrase: async (p) => { saved.passphrase = p; },
    setState: async (s) => { saved.state = s; },
    ...over,
  };
  const ui: EnablePrompts = {
    chooseAccount: async (accounts) => accounts[0],
    consent: async (categories) => { asked.consent = categories; return true; },
    newPassphrase: async () => PASS,
    existingPassphrase: async (attempt) => { asked.attempts.push(attempt); return PASS; },
    firstSync: async () => 'each',
    ...prompts,
  };
  return { deps, ui, saved, asked };
}

describe('enable', () => {
  it('needs a github.com account', async () => {
    const { deps, ui } = setup(new FakeGist(), { accounts: async () => [] });
    const result = await enable(deps, ui);
    assert.equal(!result.ok && /Add a GitHub account/.test(result.message), true);
  });

  it('creates the store on the first device and remembers the passphrase and the gist', async () => {
    const gist = new FakeGist();
    const { deps, ui, saved, asked } = setup(gist);
    assert.deepEqual(await enable(deps, ui), { ok: true, firstSync: undefined });
    const [id] = gist.ids();
    assert.deepEqual(Object.keys(gist.files(id)), [MANIFEST]);
    assert.deepEqual(saved.state, { gistId: id, accountId: 'acc', owner: 'me', base: {} });
    assert.equal(saved.passphrase, PASS);
    assert.deepEqual(asked.consent, ['settings', 'keybindings', 'snippets']);
  });

  it('cancelling at the consent step creates nothing', async () => {
    const gist = new FakeGist();
    const { deps, ui, saved } = setup(gist, {}, { consent: async () => false });
    assert.deepEqual(await enable(deps, ui), { ok: false, message: CANCELLED });
    assert.equal(gist.ids().length, 0);
    assert.equal(saved.state, undefined);
  });

  it('fails clearly when GitHub gives no token', async () => {
    const { deps, ui } = setup(new FakeGist(), { token: async () => undefined });
    const result = await enable(deps, ui);
    assert.equal(!result.ok && /gist scope/.test(result.message), true);
  });

  it('asks which account when there are several', async () => {
    const other: SyncAccount = { id: 'acc2', username: 'work' };
    const { deps, ui, saved } = setup(new FakeGist(), { accounts: async () => [ME, other] }, {
      chooseAccount: async (accounts) => accounts[1],
    });
    assert.equal((await enable(deps, ui)).ok, true);
    assert.equal(saved.state?.accountId, 'acc2');
  });

  it('joins an existing store with the right passphrase, trying again after a wrong one', async () => {
    const gist = new FakeGist();
    assert.equal((await enable(setup(gist).deps, setup(gist).ui)).ok, true);
    const { deps, ui, saved, asked } = setup(gist, {}, {
      existingPassphrase: async (attempt) => { asked.attempts.push(attempt); return attempt === 1 ? 'a wrong passphrase!' : PASS; },
    });
    assert.deepEqual(await enable(deps, ui), { ok: true, firstSync: undefined });
    assert.deepEqual(asked.attempts, [1, 2]);
    assert.equal(saved.passphrase, PASS);
  });

  it('gives up after three wrong passphrases and saves nothing', async () => {
    const gist = new FakeGist();
    assert.equal((await enable(setup(gist).deps, setup(gist).ui)).ok, true);
    const { deps, ui, saved, asked } = setup(gist, {}, {
      existingPassphrase: async (attempt) => { asked.attempts.push(attempt); return 'a wrong passphrase!'; },
    });
    const result = await enable(deps, ui);
    assert.equal(!result.ok && /not the passphrase/.test(result.message), true);
    assert.deepEqual(asked.attempts, [1, 2, 3]);
    assert.deepEqual(saved, {});
  });

  it('asks how to resolve the first sync only when the store already has data', async () => {
    const gist = new FakeGist();
    assert.equal((await enable(setup(gist).deps, setup(gist).ui)).ok, true);
    let asks = 0;
    const empty = setup(gist, {}, { firstSync: async () => { asks++; return 'cloud'; } });
    assert.deepEqual(await enable(empty.deps, empty.ui), { ok: true, firstSync: undefined });
    assert.equal(asks, 0, 'a store with only a manifest has nothing to resolve');

    gist.tamper(gist.ids()[0], 'settings.json.enc', 'x');
    for (const [choice, expected] of [['cloud', 'cloud'], ['device', 'device'], ['each', undefined]] as [FirstSync | 'each', FirstSync | undefined][]) {
      const s = setup(gist, {}, { firstSync: async () => choice });
      assert.deepEqual(await enable(s.deps, s.ui), { ok: true, firstSync: expected }, choice);
    }
  });

  it('cancelling the first-sync question saves nothing', async () => {
    const gist = new FakeGist();
    assert.equal((await enable(setup(gist).deps, setup(gist).ui)).ok, true);
    gist.tamper(gist.ids()[0], 'settings.json.enc', 'x');
    const { deps, ui, saved } = setup(gist, {}, { firstSync: async () => undefined });
    assert.deepEqual(await enable(deps, ui), { ok: false, message: CANCELLED });
    assert.deepEqual(saved, {});
  });
});
```

- [ ] **Step 3: Add `out/enable.test.js` to the `test` script**, then run `npm test`

Expected: FAIL at `tsc` with `error TS2307: Cannot find module './enable'`.

- [ ] **Step 4: Write `src/enable.ts`**

```ts
'use strict';

import { makeManifest, unlock } from './cryptoBox';
import { GistIo, Snapshot, createGistStore } from './gistStore';
import { MANIFEST } from './layout';
import { Category, FirstSync, StoredState, SyncAccount } from './types';

export const CANCELLED = 'Cancelled.';
const ATTEMPTS = 3;

export interface EnableDeps {
  /** github.com accounts from null-accounts that can have a token. */
  accounts(): Promise<SyncAccount[]>;
  token(accountId: string, interactive: boolean): Promise<string | undefined>;
  io: GistIo;
  /** The categories that will be uploaded, for the consent text. */
  categories(): Category[];
  savePassphrase(passphrase: string): Promise<void>;
  setState(state: StoredState): Promise<void>;
}

export interface EnablePrompts {
  chooseAccount(accounts: SyncAccount[]): Promise<SyncAccount | undefined>;
  consent(categories: Category[]): Promise<boolean>;
  /** Already validated (length, confirmation); `undefined` = cancelled. */
  newPassphrase(): Promise<string | undefined>;
  /** `attempt` starts at 1 so the prompt can say "try again"; `undefined` = cancelled. */
  existingPassphrase(attempt: number): Promise<string | undefined>;
  /** Only asked when the existing store already holds data; `undefined` = cancelled. */
  firstSync(): Promise<FirstSync | 'each' | undefined>;
}

export type EnableResult = { ok: true; firstSync?: FirstSync } | { ok: false; message: string };

const fail = (message: string): EnableResult => ({ ok: false, message });

async function askExisting(prompts: EnablePrompts, snapshot: Snapshot): Promise<string | EnableResult> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const passphrase = await prompts.existingPassphrase(attempt);
    if (!passphrase) return fail(CANCELLED);
    if (await unlock(passphrase, snapshot.files[MANIFEST])) return passphrase;
  }
  return fail('That is not the passphrase for this sync store.');
}

/**
 * Sets this device up: account, consent, then either creates the store (new passphrase) or joins the existing one
 * (its passphrase, plus how to resolve the first sync). Nothing is saved until every step has succeeded.
 */
export async function enable(d: EnableDeps, p: EnablePrompts): Promise<EnableResult> {
  const accounts = await d.accounts();
  if (accounts.length === 0) return fail('Add a GitHub account (github.com) in Null Accounts first.');
  const account = accounts.length === 1 ? accounts[0] : await p.chooseAccount(accounts);
  if (!account) return fail(CANCELLED);
  const token = await d.token(account.id, true);
  if (!token) return fail('GitHub did not provide a token with the gist scope.');
  if (!(await p.consent(d.categories()))) return fail(CANCELLED);

  const store = createGistStore(d.io, token);
  const found = await store.find();
  if (!found.ok) return fail(found.message);

  let snapshot: Snapshot;
  let passphrase: string;
  if (found.value === undefined) {
    const chosen = await p.newPassphrase();
    if (!chosen) return fail(CANCELLED);
    const { manifest } = await makeManifest(chosen);
    const created = await store.create({ [MANIFEST]: JSON.stringify(manifest) });
    if (!created.ok) return fail(created.message);
    snapshot = created.value;
    passphrase = chosen;
  } else {
    const read = await store.read(found.value);
    if (!read.ok) return fail(read.message);
    snapshot = read.value;
    const asked = await askExisting(p, snapshot);
    if (typeof asked !== 'string') return asked;
    passphrase = asked;
  }

  let firstSync: FirstSync | undefined;
  if (found.value !== undefined && Object.keys(snapshot.files).some((name) => name !== MANIFEST)) {
    const choice = await p.firstSync();
    if (!choice) return fail(CANCELLED);
    firstSync = choice === 'each' ? undefined : choice;
  }

  await d.savePassphrase(passphrase);
  await d.setState({ gistId: snapshot.id, accountId: account.id, owner: snapshot.owner, base: {} });
  return { ok: true, firstSync };
}
```

- [ ] **Step 5: Run `npm test`** — Expected: PASS, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-sync/package.json extensions/null-sync/src/enable.ts extensions/null-sync/src/fakeGist.ts extensions/null-sync/src/enable.test.ts
git commit -m "feat(null-sync): enable flow and in-memory fake Gist for tests (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/package.json extensions/null-sync/src/enable.ts extensions/null-sync/src/fakeGist.ts extensions/null-sync/src/enable.test.ts
```

---

### Task 9: syncEngine — the sync run, and the two-device tests

**Files:**
- Create: `extensions/null-sync/src/syncEngine.ts`, `extensions/null-sync/src/testDevice.ts`, `extensions/null-sync/src/syncEngine.test.ts`
- Modify: `extensions/null-sync/package.json` (`test` script)

**Interfaces:**
- Consumes: `open`, `seal`, `unlock` (cryptoBox); `Failure`, `GistIo`, `GistStore`, `createGistStore` (gistStore); layout helpers; `reapplyExcluded`, `stripExcluded`; `planFile`; types; `enable` (testDevice only); `FakeGist`; `LocalFiles`.
- Produces (`syncEngine.ts`):
  - `LocalFilesPort { list(categories: Category[]): Promise<Record<string,string>>; read(file): Promise<string|null>; write(file, content: string|null): Promise<void>; isDirty(file): boolean }` (satisfied by `LocalFiles`)
  - `EngineDeps { enabled(): boolean; categories(): Record<Category, boolean>; excluded(): string[]; accounts(): Promise<SyncAccount[]>; token(accountId: string, interactive: boolean): Promise<string|undefined>; io: GistIo; files: LocalFilesPort; passphrase(): Promise<string|undefined>; clearPassphrase(): Promise<void>; state: { get(): StoredState | undefined }; setState(state: StoredState | undefined): Promise<void>; lock(): Promise<(() => Promise<void>) | undefined>; now(): number; confirmOverwrite?(file: string): Promise<boolean> }`
  - `RunOptions { interactive: boolean; firstSync?: FirstSync }`
  - `class SyncEngine` with `constructor(deps: EngineDeps)`, `getStatus(): SyncStatus`, `onDidChange(listener: () => void): { dispose(): void }`, `run(options: RunOptions): Promise<void>` (never rejects)
- Produces (`testDevice.ts`): `class Device` (fields `engine`, `state`, `passphrase`, `enabled`, `locked`, `overwrite`, `dirty`, `categories`, `excluded`, `backupsDir`, `userDir`; methods `write(file, text)`, `read(file): string|null`, `remove(file)`, `backups(prefix): string[]`, `run()`, `syncNow()`, `enable(passphrase, firstSync?)`, getter `status`), `cleanup()`

- [ ] **Step 1: Write `src/testDevice.ts`** (a whole "machine" for the tests: its own user folder, state and settings, sharing one `FakeGist`)

```ts
'use strict';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EnableResult, enable } from './enable';
import { FakeGist } from './fakeGist';
import { LocalFiles } from './localFiles';
import { SyncEngine } from './syncEngine';
import { Category, FirstSync, StoredState, SyncStatus } from './types';

const roots: string[] = [];

/** Deletes every temp folder the devices created; call from `after()`. */
export function cleanup(): void {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** One machine: its own user-data folder, remembered state, passphrase and settings, talking to a shared fake Gist. */
export class Device {
  readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-device-'));
  readonly userDir = path.join(this.root, 'User');
  readonly backupsDir = path.join(this.root, 'backups');
  /** Files (e.g. `keybindings.json`) that count as open with unsaved edits. */
  readonly dirty = new Set<string>();
  readonly engine: SyncEngine;
  enabled = true;
  /** Another window holds the cross-window lock. */
  locked = false;
  /** What an interactive run answers when asked to overwrite a file with unsaved edits. */
  overwrite = false;
  state: StoredState | undefined;
  passphrase: string | undefined;
  categories: Record<Category, boolean> = { settings: true, keybindings: true, snippets: true };
  excluded = ['*.path', '*token*'];
  readonly account = { id: 'acc', username: 'me' };
  private clock = 1;

  constructor(readonly gist: FakeGist) {
    roots.push(this.root);
    fs.mkdirSync(path.join(this.userDir, 'snippets'), { recursive: true });
    const files = new LocalFiles({
      userDir: this.userDir,
      backupsDir: this.backupsDir,
      now: () => this.clock++,
      isDirty: (p) => this.dirty.has(path.relative(this.userDir, p).split(path.sep).join('/')),
    });
    this.engine = new SyncEngine({
      enabled: () => this.enabled,
      categories: () => this.categories,
      excluded: () => this.excluded,
      accounts: async () => [this.account],
      token: async () => 'token',
      io: gist.io,
      files,
      passphrase: async () => this.passphrase,
      clearPassphrase: async () => { this.passphrase = undefined; },
      state: { get: () => this.state },
      setState: async (s) => { this.state = s; },
      lock: async () => (this.locked ? undefined : async () => undefined),
      now: () => this.clock++,
      confirmOverwrite: async () => this.overwrite,
    });
  }

  get status(): SyncStatus {
    return this.engine.getStatus();
  }

  private abs(file: string): string {
    return path.join(this.userDir, ...file.split('/'));
  }
  write(file: string, text: string): void {
    fs.mkdirSync(path.dirname(this.abs(file)), { recursive: true });
    fs.writeFileSync(this.abs(file), text);
  }
  read(file: string): string | null {
    try {
      return fs.readFileSync(this.abs(file), 'utf8');
    } catch {
      return null;
    }
  }
  remove(file: string): void {
    fs.rmSync(this.abs(file), { force: true });
  }
  /** Backup files whose name starts with `prefix`, e.g. `keybindings.json.`. */
  backups(prefix: string): string[] {
    return fs.existsSync(this.backupsDir) ? fs.readdirSync(this.backupsDir).filter((n) => n.startsWith(prefix)) : [];
  }

  /** A background run (the timer / file watcher). */
  run(): Promise<void> {
    return this.engine.run({ interactive: false });
  }
  /** `Null: Sync Settings Now`. */
  syncNow(): Promise<void> {
    return this.engine.run({ interactive: true });
  }

  /** The Enable command: set this device up, then run once like the command does. */
  async enable(passphrase: string, firstSync: FirstSync | 'each' = 'each'): Promise<EnableResult> {
    const result = await enable(
      {
        accounts: async () => [this.account],
        token: async () => 'token',
        io: this.gist.io,
        categories: () => (['settings', 'keybindings', 'snippets'] as Category[]).filter((c) => this.categories[c]),
        savePassphrase: async (p) => { this.passphrase = p; },
        setState: async (s) => { this.state = s; },
      },
      {
        chooseAccount: async (accounts) => accounts[0],
        consent: async () => true,
        newPassphrase: async () => passphrase,
        existingPassphrase: async () => passphrase,
        firstSync: async () => firstSync,
      },
    );
    if (result.ok) await this.engine.run({ interactive: true, firstSync: result.firstSync });
    return result;
  }
}
```

- [ ] **Step 2: Write the failing test `src/syncEngine.test.ts`**

```ts
import { after, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parse } from 'jsonc-parser';
import { FakeGist } from './fakeGist';
import { Device, cleanup } from './testDevice';

after(cleanup);

const PASS = 'correct horse battery staple';
const SETTINGS = '{\n  "editor.fontSize": 14,\n  "git.path": "C:\\\\git.exe"\n}\n';

/** Two devices that already hold exactly `files` and agree with the cloud. */
async function synced(files: Record<string, string>) {
  const gist = new FakeGist();
  const a = new Device(gist);
  const b = new Device(gist);
  for (const [file, text] of Object.entries(files)) {
    a.write(file, text);
    b.write(file, text);
  }
  assert.equal((await a.enable(PASS)).ok, true);
  assert.equal((await b.enable(PASS, 'cloud')).ok, true);
  assert.equal(a.status.state, 'idle');
  assert.equal(b.status.state, 'idle');
  return { gist, a, b, id: gist.ids()[0] };
}

describe('first sync', () => {
  it('a new device takes the cloud data but keeps its own excluded settings', async () => {
    const gist = new FakeGist();
    const a = new Device(gist);
    const b = new Device(gist);
    a.write('settings.json', '{\n  "editor.fontSize": 14,\n  "git.path": "C:\\\\a\\\\git.exe"\n}\n');
    assert.equal((await a.enable(PASS)).ok, true);
    b.write('settings.json', '{\n  "git.path": "D:\\\\b\\\\git.exe"\n}\n');
    assert.equal((await b.enable(PASS, 'cloud')).ok, true);
    assert.deepEqual(parse(b.read('settings.json')!), { 'editor.fontSize': 14, 'git.path': 'D:\\b\\git.exe' });
    assert.equal(b.backups('settings.json.').length, 1, 'the old local file is backed up');
    assert.deepEqual(parse(a.read('settings.json')!), { 'editor.fontSize': 14, 'git.path': 'C:\\a\\git.exe' });
  });

  it('"use this device" makes the cloud match this device', async () => {
    const { gist, a } = await synced({ 'keybindings.json': '[]\n' });
    const c = new Device(gist);
    c.write('keybindings.json', '[1]\n');
    assert.equal((await c.enable(PASS, 'device')).ok, true);
    await a.run();
    assert.equal(a.read('keybindings.json'), '[1]\n');
    assert.equal(c.status.state, 'idle');
  });

  it('"decide per file" leaves the conflict for the user and changes nothing', async () => {
    const { gist } = await synced({ 'keybindings.json': '[]\n' });
    const c = new Device(gist);
    c.write('keybindings.json', '[1]\n');
    assert.equal((await c.enable(PASS, 'each')).ok, true);
    assert.deepEqual(c.status.conflicts, [{ file: 'keybindings.json', category: 'keybindings' }]);
    assert.equal(c.status.state, 'needsAttention');
    assert.equal(c.read('keybindings.json'), '[1]\n');
  });

  it('a device with no snippets simply receives them', async () => {
    const gist = new FakeGist();
    const a = new Device(gist);
    a.write('snippets/cpp.json', '{}\n');
    assert.equal((await a.enable(PASS)).ok, true);
    const b = new Device(gist);
    assert.equal((await b.enable(PASS, 'each')).ok, true);
    assert.equal(b.read('snippets/cpp.json'), '{}\n');
    assert.equal(b.status.state, 'idle');
  });
});

describe('syncing edits', () => {
  it('an edit on one device reaches the other, and nothing ping-pongs', async () => {
    const { gist, a, b, id } = await synced({ 'settings.json': SETTINGS });
    const before = gist.revisionCount(id);
    for (let i = 0; i < 2; i++) { await a.run(); await b.run(); }
    assert.equal(gist.revisionCount(id), before, 'idle devices push nothing');

    b.write('settings.json', SETTINGS.replace('14', '16'));
    await b.run();
    await a.run();
    assert.deepEqual(parse(a.read('settings.json')!), { 'editor.fontSize': 16, 'git.path': 'C:\\git.exe' });

    const afterEdit = gist.revisionCount(id);
    for (let i = 0; i < 2; i++) { await a.run(); await b.run(); }
    assert.equal(gist.revisionCount(id), afterEdit, 'no further pushes');
    assert.equal(a.status.state, 'idle');
    assert.equal(b.status.state, 'idle');
  });

  it('editing only an excluded setting syncs nothing', async () => {
    const { gist, a, id } = await synced({ 'settings.json': SETTINGS });
    const before = gist.revisionCount(id);
    a.write('settings.json', SETTINGS.replace('C:\\\\git.exe', 'D:\\\\other.exe'));
    await a.run();
    assert.equal(gist.revisionCount(id), before);
  });

  it('a secret-looking setting never reaches the other device', async () => {
    const { a, b } = await synced({ 'settings.json': '{\n  "editor.fontSize": 14\n}\n' });
    a.write('settings.json', '{\n  "editor.fontSize": 18,\n  "my.apiToken": "s3cret"\n}\n');
    await a.run();
    await b.run();
    assert.equal(b.read('settings.json')!.includes('s3cret'), false);
    assert.deepEqual(parse(b.read('settings.json')!), { 'editor.fontSize': 18 });
  });

  it('a new snippet file is added on the other device', async () => {
    const { a, b } = await synced({});
    a.write('snippets/rust.json', '{"a":1}\n');
    await a.run();
    await b.run();
    assert.equal(b.read('snippets/rust.json'), '{"a":1}\n');
  });
});

describe('conflicts', () => {
  it('a file edited on both devices is a conflict that no run resolves silently', async () => {
    const { a, b } = await synced({ 'keybindings.json': '[]\n' });
    a.write('keybindings.json', '[1]\n');
    b.write('keybindings.json', '[2]\n');
    await a.run();
    await b.run();
    assert.deepEqual(b.status.conflicts, [{ file: 'keybindings.json', category: 'keybindings' }]);
    assert.equal(b.status.state, 'needsAttention');
    assert.equal(b.read('keybindings.json'), '[2]\n');
    await b.run();
    assert.equal(b.read('keybindings.json'), '[2]\n', 'still untouched on a later run');
    assert.equal(b.status.conflicts.length, 1);
  });
});

describe('connectivity and credentials', () => {
  it('offline edits are kept and pushed when the connection returns', async () => {
    const { gist, a, b } = await synced({ 'keybindings.json': '[]\n' });
    gist.offline = true;
    a.write('keybindings.json', '[1]\n');
    await a.run();
    assert.equal(a.status.state, 'offline');
    assert.match(a.status.message!, /ENOTFOUND/);
    assert.equal(a.read('keybindings.json'), '[1]\n');
    gist.offline = false;
    await a.run();
    await b.run();
    assert.equal(b.read('keybindings.json'), '[1]\n');
    assert.equal(a.status.state, 'idle');
  });

  it('a wrong saved passphrase is an error and writes nothing locally', async () => {
    const { a, b } = await synced({ 'keybindings.json': '[]\n' });
    b.passphrase = 'some other passphrase';
    a.write('keybindings.json', '[1]\n');
    await a.run();
    await b.run();
    assert.equal(b.status.state, 'error');
    assert.match(b.status.message!, /passphrase/);
    assert.equal(b.read('keybindings.json'), '[]\n');
  });

  it('a deleted gist asks to set up again instead of recreating it', async () => {
    const { gist, a, id } = await synced({ 'keybindings.json': '[]\n' });
    gist.delete(id);
    await a.run();
    assert.equal(a.status.state, 'signedOut');
    assert.match(a.status.message!, /no longer exists/);
    assert.equal(gist.ids().length, 0, 'a background run must not create a new gist');
  });

  it('is disabled when switched off and signedOut when never set up', async () => {
    const d = new Device(new FakeGist());
    d.enabled = false;
    await d.run();
    assert.equal(d.status.state, 'disabled');
    d.enabled = true;
    await d.run();
    assert.equal(d.status.state, 'signedOut');
  });

  it('a held cross-window lock skips a background run quietly and tells an interactive one', async () => {
    const { gist, a, id } = await synced({ 'keybindings.json': '[]\n' });
    a.locked = true;
    a.write('keybindings.json', '[1]\n');
    const before = gist.revisionCount(id);
    await a.run();
    assert.equal(gist.revisionCount(id), before);
    assert.equal(a.status.state, 'idle');
    await a.syncNow();
    assert.match(a.status.message!, /Another window/);
    assert.equal(gist.revisionCount(id), before);
  });

  it('tells listeners about every status change', async () => {
    const { a } = await synced({});
    const seen: string[] = [];
    const sub = a.engine.onDidChange(() => seen.push(a.status.state));
    await a.run();
    sub.dispose();
    await a.run();
    assert.deepEqual(seen, ['syncing', 'idle']);
  });
});

describe('deletions', () => {
  it('a missing settings.json is restored from the cloud and never deleted there', async () => {
    const S = '{\n  "editor.fontSize": 14\n}\n';
    const { gist, a, id } = await synced({ 'settings.json': S });
    const before = gist.revisionCount(id);
    a.remove('settings.json');
    await a.run();
    assert.equal(a.read('settings.json'), S);
    assert.equal(gist.revisionCount(id), before);
  });

  it('a device that never had a keybindings.json pushes nothing for it', async () => {
    const { gist, a, b, id } = await synced({});
    const before = gist.revisionCount(id);
    await a.run();
    await b.run();
    assert.equal(a.read('keybindings.json'), null);
    assert.equal(gist.revisionCount(id), before);
    assert.equal(a.status.state, 'idle');
  });

  it('a deleted snippet is deleted on the other device, with a backup', async () => {
    const { a, b } = await synced({ 'snippets/a.json': '{"a":1}\n' });
    a.remove('snippets/a.json');
    await a.run();
    await b.run();
    assert.equal(b.read('snippets/a.json'), null);
    assert.equal(b.backups('snippets__a.json.').length, 1);
    assert.equal(b.status.state, 'idle');
  });
});

describe('unsaved edits', () => {
  it('a file open with unsaved edits is skipped and applied on the next run', async () => {
    const { a, b } = await synced({ 'keybindings.json': '[]\n' });
    a.write('keybindings.json', '[1]\n');
    await a.run();
    b.dirty.add('keybindings.json');
    await b.run();
    assert.deepEqual(b.status.pending, ['keybindings.json']);
    assert.equal(b.status.state, 'needsAttention');
    assert.equal(b.read('keybindings.json'), '[]\n');
    b.dirty.clear();
    await b.run();
    assert.equal(b.read('keybindings.json'), '[1]\n');
    assert.deepEqual(b.status.pending, []);
    assert.equal(b.status.state, 'idle');
  });

  it('an interactive run asks, and only overwrites when told to', async () => {
    const { a, b } = await synced({ 'keybindings.json': '[]\n' });
    a.write('keybindings.json', '[1]\n');
    await a.run();
    b.dirty.add('keybindings.json');
    await b.syncNow();
    assert.deepEqual(b.status.pending, ['keybindings.json']);
    b.overwrite = true;
    await b.syncNow();
    assert.equal(b.read('keybindings.json'), '[1]\n');
    assert.deepEqual(b.status.pending, []);
  });
});

describe('bad data', () => {
  it('one corrupt remote file is reported while the rest still syncs, and nothing is written from it', async () => {
    const { gist, a, b, id } = await synced({ 'keybindings.json': '[]\n', 'snippets/a.json': '{}\n' });
    gist.tamper(id, 'keybindings.json.enc', '{"v":1,"iv":"AAAA","tag":"AAAA","data":"AAAA"}');
    a.write('snippets/a.json', '{"x":1}\n');
    a.write('keybindings.json', '[9]\n');
    await a.run();
    await b.run();
    assert.equal(a.status.state, 'error');
    assert.match(a.status.message!, /keybindings\.json\.enc/);
    assert.equal(a.read('keybindings.json'), '[9]\n', 'an undecryptable remote file is never overwritten');
    assert.equal(b.read('snippets/a.json'), '{"x":1}\n');
    assert.equal(b.read('keybindings.json'), '[]\n');
    assert.equal(b.status.state, 'error');
  });

  it('a remote file name that tries to leave the snippets folder is ignored', async () => {
    const { gist, b, id } = await synced({});
    gist.tamper(id, 'snippets__..\\..\\evil.json.enc', 'x');
    gist.tamper(id, 'tasks.json.enc', 'x');
    await b.run();
    assert.equal(b.status.state, 'idle');
    assert.equal(b.read('tasks.json'), null);
  });

  it('an invalid local settings.json is reported and not uploaded', async () => {
    const { gist, a, id } = await synced({ 'settings.json': '{\n  "a": 1\n}\n' });
    const before = gist.revisionCount(id);
    a.write('settings.json', '{ "a": ');
    await a.run();
    assert.equal(a.status.state, 'error');
    assert.match(a.status.message!, /settings\.json is not valid JSON/);
    assert.equal(gist.revisionCount(id), before);
  });

  it('an empty settings.json, comments and trailing commas are all fine', async () => {
    const { a, b } = await synced({ 'settings.json': '' });
    a.write('settings.json', '// my settings\n{\n  "a": 1, // one\n}\n');
    await a.run();
    await b.run();
    assert.equal(b.status.state, 'idle');
    assert.deepEqual(parse(b.read('settings.json')!), { a: 1 });
    assert.match(b.read('settings.json')!, /\/\/ my settings/);
  });

  it('a file over 900 KB is reported and not uploaded', async () => {
    const { gist, a, id } = await synced({});
    a.write('snippets/big.json', 'x'.repeat(900_001));
    await a.run();
    assert.equal(a.status.state, 'error');
    assert.match(a.status.message!, /too large/);
    assert.equal(Object.keys(gist.files(id)).some((n) => n.includes('big')), false);
  });
});

describe('categories', () => {
  it('a disabled category is neither uploaded nor applied', async () => {
    const { a, b } = await synced({ 'keybindings.json': '[]\n', 'snippets/a.json': '{}\n' });
    a.categories.snippets = false;
    b.categories.keybindings = false;
    a.write('snippets/a.json', '{"x":1}\n');
    a.write('keybindings.json', '[1]\n');
    await a.run();
    await b.run();
    assert.equal(b.read('snippets/a.json'), '{}\n', 'a never uploaded the snippet');
    assert.equal(b.read('keybindings.json'), '[]\n', 'b does not apply keybindings');
  });
});
```

- [ ] **Step 3: Add `out/syncEngine.test.js` to the `test` script**, then run `npm test`

Expected: FAIL at `tsc` with `error TS2307: Cannot find module './syncEngine'`.

- [ ] **Step 4: Write `src/syncEngine.ts`**

```ts
'use strict';

import * as crypto from 'crypto';
import { open, seal, unlock } from './cryptoBox';
import { Failure, GistIo, GistStore, createGistStore } from './gistStore';
import { CORE_FILES, MANIFEST, SETTINGS, categoryOf, fileOfRemoteName, isDeletable, remoteNameOf } from './layout';
import { reapplyExcluded, stripExcluded } from './settingsFilter';
import { planFile } from './syncPlan';
import { Base, CATEGORIES, Category, Conflict, FirstSync, StoredState, SyncAccount, SyncStatus, Value } from './types';

/** Gist files over 1 MB are truncated by the API; stay well below. */
const MAX_FILE_BYTES = 900_000;

export interface LocalFilesPort {
  list(categories: Category[]): Promise<Record<string, string>>;
  read(file: string): Promise<string | null>;
  write(file: string, content: string | null): Promise<void>;
  isDirty(file: string): boolean;
}

export interface EngineDeps {
  /** The `null-sync.enabled` switch. */
  enabled(): boolean;
  categories(): Record<Category, boolean>;
  excluded(): string[];
  accounts(): Promise<SyncAccount[]>;
  /** `interactive: false` must never show UI. */
  token(accountId: string, interactive: boolean): Promise<string | undefined>;
  io: GistIo;
  files: LocalFilesPort;
  passphrase(): Promise<string | undefined>;
  clearPassphrase(): Promise<void>;
  state: { get(): StoredState | undefined };
  setState(state: StoredState | undefined): Promise<void>;
  /** The cross-window lock: a release function, or `undefined` if another window is syncing. */
  lock(): Promise<(() => Promise<void>) | undefined>;
  now(): number;
  /** Only called in interactive runs, for a file with unsaved edits. */
  confirmOverwrite?(file: string): Promise<boolean>;
}

export interface RunOptions {
  interactive: boolean;
  /** How the Enable flow resolved first-sync conflicts, applied to this run's conflicts that have no base yet. */
  firstSync?: FirstSync;
}

const hash = (text: string | null): Value => (text === null ? null : crypto.createHash('sha256').update(text).digest('hex'));
const enabledCategories = (c: Record<Category, boolean>): Category[] => CATEGORIES.filter((category) => c[category]);
const tooLarge = (content: string | null): boolean => content !== null && Buffer.byteLength(content) > MAX_FILE_BYTES;

const CLEARED: Partial<SyncStatus> = {
  conflicts: [],
  pending: [],
  pendingInstalls: [],
  pendingRemovals: [],
  lastSyncedAt: undefined,
  message: undefined,
};

interface Conn {
  st: StoredState;
  store: GistStore;
  key: Buffer;
  /** Gist file name → stored text, as read at the start of this run. */
  files: Record<string, string>;
}

/** One synced file as seen from both sides. */
interface Inspected {
  file: string;
  name: string;
  /** What is on disk (`null` = no file). */
  raw: string | null;
  /** What would be uploaded: `raw`, with the excluded settings removed for `settings.json`. */
  content: string | null;
  /** The decrypted remote text (`null` = no such remote file). */
  plain: string | null;
  lv: Value;
  rv: Value;
}

export class SyncEngine {
  private status: SyncStatus;
  private readonly listeners = new Set<() => void>();
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: EngineDeps) {
    this.status = { conflicts: [], pending: [], pendingInstalls: [], pendingRemovals: [], state: d.enabled() ? 'idle' : 'disabled' };
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  }

  private set(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Runs one sync. Never rejects. A background run (`interactive: false`) never prompts and skips quietly when another window is syncing. */
  run(options: RunOptions): Promise<void> {
    if (!this.d.enabled()) {
      this.set({ ...CLEARED, state: 'disabled' });
      return Promise.resolve();
    }
    return this.serialized(async () => {
      this.set({ state: 'syncing' });
      const conn = await this.connect(options.interactive);
      if (conn) await this.sync(conn, options);
    }, !options.interactive);
  }

  /** One task at a time, under the cross-window lock. Never rejects. */
  private serialized(task: () => Promise<void>, quiet: boolean): Promise<void> {
    const next = this.tail.then(async () => {
      try {
        const release = await this.d.lock();
        if (!release) {
          if (!quiet) this.set({ message: 'Another window is syncing. Try again in a moment.' });
          return;
        }
        try {
          await task();
        } finally {
          await release();
        }
      } catch (err) {
        this.set({ state: 'error', message: `Sync failed (${err instanceof Error ? err.message : String(err)}).` });
      }
    });
    this.tail = next;
    return next;
  }

  /** Sets the status for a failed Gist call and returns `undefined` so callers can `return this.failed(...)`. */
  private failed(failure: Failure): undefined {
    this.set({
      state: failure.kind === 'offline' ? 'offline' : failure.kind === 'error' ? 'error' : 'signedOut',
      message:
        failure.kind === 'notFound'
          ? 'The sync Gist no longer exists. Run "Null: Enable Settings Sync" to create a new one.'
          : failure.message,
    });
    return undefined;
  }

  /** Account, token, passphrase and the current remote files; sets the status and returns `undefined` if any is missing. */
  private async connect(interactive: boolean): Promise<Conn | undefined> {
    const { d } = this;
    const st = d.state.get();
    const passphrase = await d.passphrase();
    const account = st && (await d.accounts()).find((a) => a.id === st.accountId);
    if (!st || !account || !passphrase) {
      this.set({ state: 'signedOut', message: 'Run "Null: Enable Settings Sync" to set up sync on this device.' });
      return undefined;
    }
    const token = await d.token(account.id, interactive);
    if (!token) {
      this.set({ state: 'signedOut', message: `Sign in to @${account.username} in Null Accounts (with the gist scope) to sync.` });
      return undefined;
    }
    const store = createGistStore(d.io, token);
    const read = await store.read(st.gistId);
    if (!read.ok) return this.failed(read);
    const key = await unlock(passphrase, read.value.files[MANIFEST]);
    if (!key) {
      this.set({ state: 'error', message: 'The saved passphrase does not match this sync store. Run "Null: Enable Settings Sync" again.' });
      return undefined;
    }
    return { st, store, key, files: read.value.files };
  }

  /** Both sides of one file, or a message if either cannot be used. */
  private inspect(c: Conn, file: string, raw: string | null): Inspected | string {
    const name = remoteNameOf(file);
    let content = raw;
    if (file === SETTINGS && raw !== null) {
      const stripped = stripExcluded(raw, this.d.excluded());
      if (stripped === undefined) return 'settings.json is not valid JSON, so it was not synced.';
      content = stripped;
    }
    let plain: string | null = null;
    const encrypted = c.files[name];
    if (encrypted !== undefined) {
      const opened = open(c.key, name, encrypted);
      if (opened === undefined) return `Could not decrypt ${name}; it was left alone.`;
      plain = opened;
    }
    return { file, name, raw, content, plain, lv: hash(content), rv: hash(plain) };
  }

  /** Writes the remote version locally (back-up first). `uploaded` is what this device would now upload for the file. */
  private async applyPull(i: Inspected): Promise<{ base: Base; uploaded: string | null } | string> {
    let text = i.plain;
    if (i.file === SETTINGS && i.plain !== null) {
      const merged = reapplyExcluded(i.plain, i.raw, this.d.excluded());
      if (merged === undefined) return 'The synced settings.json is not valid JSON and was not applied.';
      text = merged;
    }
    await this.d.files.write(i.file, text);
    const uploaded = i.file === SETTINGS && text !== null ? (stripExcluded(text, this.d.excluded()) ?? text) : text;
    return { base: { local: hash(uploaded), remote: i.rv }, uploaded };
  }

  private async sync(c: Conn, { interactive, firstSync }: RunOptions): Promise<void> {
    const { d } = this;
    const categories = enabledCategories(d.categories());
    const raws = await d.files.list(categories);
    const names = new Set(Object.keys(raws));
    for (const file of CORE_FILES) {
      if (categories.includes(categoryOf(file))) names.add(file);
    }
    for (const name of Object.keys(c.files)) {
      const file = fileOfRemoteName(name);
      if (file !== undefined && categories.includes(categoryOf(file))) names.add(file);
    }

    const problems: string[] = [];
    const conflicts: Conflict[] = [];
    const pending: string[] = [];
    const base = { ...c.st.base };
    const changes: Record<string, string | null> = {};
    const pushed: Record<string, Base> = {};

    for (const file of [...names].sort()) {
      const i = this.inspect(c, file, raws[file] ?? null);
      if (typeof i === 'string') {
        problems.push(i);
        continue;
      }
      const prior = c.st.base[file];
      let action = planFile(i.lv, i.rv, prior, isDeletable(file));
      if (action === 'conflict' && prior === undefined && firstSync) action = firstSync === 'cloud' ? 'pull' : 'push';

      switch (action) {
        case 'none':
          base[file] = { local: i.lv, remote: i.rv };
          break;
        case 'conflict':
          conflicts.push({ file, category: categoryOf(file) });
          break;
        case 'push':
          if (tooLarge(i.content)) {
            problems.push(`${file} is too large to sync.`);
            break;
          }
          changes[i.name] = i.content === null ? null : seal(c.key, i.name, i.content);
          pushed[file] = { local: i.lv, remote: i.lv };
          break;
        case 'pull': {
          if (d.files.isDirty(file) && !(interactive && d.confirmOverwrite && (await d.confirmOverwrite(file)))) {
            pending.push(file);
            break;
          }
          const applied = await this.applyPull(i);
          if (typeof applied === 'string') problems.push(applied);
          else base[file] = applied.base;
          break;
        }
      }
    }

    if (Object.keys(changes).length > 0) {
      const updated = await c.store.update(c.st.gistId, changes);
      if (!updated.ok) {
        await d.setState({ ...c.st, base });
        this.failed(updated);
        this.set({ conflicts, pending });
        return;
      }
      Object.assign(base, pushed);
    }

    const lastSyncedAt = d.now();
    await d.setState({ ...c.st, base, lastSyncedAt });
    this.set({
      state: problems.length > 0 ? 'error' : conflicts.length > 0 || pending.length > 0 ? 'needsAttention' : 'idle',
      message: problems.length > 0 ? problems.join(' ') : undefined,
      lastSyncedAt,
      conflicts,
      pending,
      pendingInstalls: [],
      pendingRemovals: [],
    });
  }
}
```

- [ ] **Step 5: Run `npm test`** — Expected: PASS, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-sync/package.json extensions/null-sync/src/syncEngine.ts extensions/null-sync/src/testDevice.ts extensions/null-sync/src/syncEngine.test.ts
git commit -m "feat(null-sync): sync engine with three-way file sync and two-device tests (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/package.json extensions/null-sync/src/syncEngine.ts extensions/null-sync/src/testDevice.ts extensions/null-sync/src/syncEngine.test.ts
```

---
### Task 10: syncEngine — resolve conflicts, preview, restore, stop

**Files:**
- Modify: `extensions/null-sync/src/syncEngine.ts`, `extensions/null-sync/src/syncEngine.test.ts`

**Interfaces:**
- Consumes: everything from Task 9; `Revision` from `gistStore`.
- Produces on `SyncEngine`:
  - `resolve(file: string, side: 'mine' | 'theirs'): Promise<void>`
  - `previewRemote(file: string): Promise<string | undefined>` — decrypted remote text, for a diff
  - `revisions(): Promise<Revision[] | undefined>` — newest first
  - `restore(revision: string): Promise<void>`
  - `stop(deleteGist: boolean): Promise<{ ok: true } | { ok: false; message: string }>`

- [ ] **Step 1: Append the failing tests to `src/syncEngine.test.ts`**

First add `import * as fs from 'fs';` and `import * as path from 'path';` to the imports at the top of the file, then append:

```ts
describe('resolving conflicts', () => {
  async function conflicted() {
    const s = await synced({ 'keybindings.json': '[]\n' });
    s.a.write('keybindings.json', '[1]\n');
    s.b.write('keybindings.json', '[2]\n');
    await s.a.run();
    await s.b.run();
    assert.equal(s.b.status.conflicts.length, 1);
    return s;
  }

  it('shows the remote text for a diff, and nothing for a file that is not there', async () => {
    const { b } = await conflicted();
    assert.equal(await b.engine.previewRemote('keybindings.json'), '[1]\n');
    assert.equal(await b.engine.previewRemote('snippets/none.json'), undefined);
  });

  it('taking theirs applies the remote file and keeps this device\'s version as a backup', async () => {
    const { b } = await conflicted();
    await b.engine.resolve('keybindings.json', 'theirs');
    assert.equal(b.read('keybindings.json'), '[1]\n');
    const backups = b.backups('keybindings.json.');
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(b.backupsDir, backups[0]), 'utf8'), '[2]\n');
    assert.equal(b.status.state, 'idle');
    assert.deepEqual(b.status.conflicts, []);
    await b.run();
    assert.equal(b.read('keybindings.json'), '[1]\n');
  });

  it('keeping mine uploads this device\'s file so the other device receives it', async () => {
    const { a, b } = await conflicted();
    await b.engine.resolve('keybindings.json', 'mine');
    assert.equal(b.status.state, 'idle');
    await a.run();
    assert.equal(a.read('keybindings.json'), '[2]\n');
  });

  it('resolving one conflict leaves the others', async () => {
    const { a, b } = await synced({ 'keybindings.json': '[]\n', 'snippets/a.json': '{}\n' });
    a.write('keybindings.json', '[1]\n');
    a.write('snippets/a.json', '{"a":1}\n');
    b.write('keybindings.json', '[2]\n');
    b.write('snippets/a.json', '{"b":1}\n');
    await a.run();
    await b.run();
    assert.equal(b.status.conflicts.length, 2);
    await b.engine.resolve('keybindings.json', 'theirs');
    assert.deepEqual(b.status.conflicts, [{ file: 'snippets/a.json', category: 'snippets' }]);
    assert.equal(b.status.state, 'needsAttention');
  });
});

describe('restore', () => {
  it('lists revisions newest first and rolls this device and the cloud back', async () => {
    const { a, b } = await synced({ 'keybindings.json': '[1]\n' });
    a.write('keybindings.json', '[2]\n');
    await a.run();
    await b.run();
    assert.equal(b.read('keybindings.json'), '[2]\n');

    const revisions = await a.engine.revisions();
    assert.equal(revisions?.length, 3, 'manifest, first upload, edit');
    await a.engine.restore(revisions![1].sha);
    assert.equal(a.read('keybindings.json'), '[1]\n');
    assert.equal(a.backups('keybindings.json.').length, 1);
    assert.equal(a.status.state, 'idle');

    await b.run();
    assert.equal(b.read('keybindings.json'), '[1]\n');
    assert.equal(b.status.state, 'idle');
  });

  it('reports an unknown revision instead of changing anything', async () => {
    const { a } = await synced({ 'keybindings.json': '[1]\n' });
    await a.engine.restore('v99');
    assert.equal(a.read('keybindings.json'), '[1]\n');
    assert.equal(a.status.state, 'error');
    assert.match(a.status.message!, /revision/);
  });
});

describe('stop', () => {
  it('forgets this device but leaves its files and, by default, the cloud copy', async () => {
    const { gist, a, id } = await synced({ 'keybindings.json': '[1]\n' });
    assert.deepEqual(await a.engine.stop(false), { ok: true });
    assert.equal(a.state, undefined);
    assert.equal(a.passphrase, undefined);
    assert.equal(a.read('keybindings.json'), '[1]\n');
    assert.equal(gist.has(id), true);
    assert.equal(a.status.state, 'disabled');
    await a.run();
    assert.equal(a.status.state, 'signedOut', 'running again asks to set up');
  });

  it('can also delete the cloud copy, and other devices then ask to set up again', async () => {
    const { gist, a, b, id } = await synced({ 'keybindings.json': '[1]\n' });
    assert.deepEqual(await a.engine.stop(true), { ok: true });
    assert.equal(gist.has(id), false);
    await b.run();
    assert.equal(b.status.state, 'signedOut');
    assert.match(b.status.message!, /no longer exists/);
  });

  it('keeps everything if the cloud copy cannot be deleted', async () => {
    const { gist, a } = await synced({ 'keybindings.json': '[1]\n' });
    gist.offline = true;
    const result = await a.engine.stop(true);
    assert.equal(result.ok, false);
    assert.notEqual(a.state, undefined);
    assert.notEqual(a.passphrase, undefined);
  });
});
```

- [ ] **Step 2: Run `npm test`** — Expected: FAIL at `tsc` with `Property 'previewRemote' does not exist on type 'SyncEngine'` (and the same for `resolve`, `revisions`, `restore`, `stop`).

- [ ] **Step 3: Implement.** In `src/syncEngine.ts` change the gistStore import to
`import { Failure, GistIo, GistStore, Revision, createGistStore } from './gistStore';`
and add these members to `SyncEngine` immediately after the `run` method:

```ts
  /** `idle` or `needsAttention`, from what is still outstanding. */
  private settle(): void {
    const s = this.status;
    const outstanding = s.conflicts.length + s.pending.length + s.pendingInstalls.length + s.pendingRemovals.length;
    this.set({ state: outstanding > 0 ? 'needsAttention' : 'idle', message: undefined });
  }

  /** `mine` uploads this device's file; `theirs` backs it up and applies the remote one. */
  resolve(file: string, side: 'mine' | 'theirs'): Promise<void> {
    return this.serialized(async () => {
      const c = await this.connect(true);
      if (!c) return;
      const i = this.inspect(c, file, await this.d.files.read(file));
      if (typeof i === 'string') {
        this.set({ state: 'error', message: i });
        return;
      }
      const base = { ...c.st.base };
      if (side === 'mine') {
        if (tooLarge(i.content)) {
          this.set({ state: 'error', message: `${file} is too large to sync.` });
          return;
        }
        const updated = await c.store.update(c.st.gistId, { [i.name]: i.content === null ? null : seal(c.key, i.name, i.content) });
        if (!updated.ok) {
          this.failed(updated);
          return;
        }
        base[file] = { local: i.lv, remote: i.lv };
      } else {
        const applied = await this.applyPull(i);
        if (typeof applied === 'string') {
          this.set({ state: 'error', message: applied });
          return;
        }
        base[file] = applied.base;
      }
      await this.d.setState({ ...c.st, base });
      this.set({ conflicts: this.status.conflicts.filter((x) => x.file !== file) });
      this.settle();
    }, false);
  }

  /** The decrypted remote text of a file, for a diff; `undefined` if there is none. */
  async previewRemote(file: string): Promise<string | undefined> {
    await this.tail;
    const c = await this.connect(true);
    const i = c && this.inspect(c, file, null);
    return typeof i === 'object' ? (i.plain ?? undefined) : undefined;
  }

  /** The Gist's revisions, newest first; `undefined` (with the status set) if they cannot be read. */
  async revisions(): Promise<Revision[] | undefined> {
    await this.tail;
    const c = await this.connect(true);
    if (!c) return undefined;
    const revisions = await c.store.revisions(c.st.gistId);
    return revisions.ok ? revisions.value : this.failed(revisions);
  }

  /** Applies an earlier revision locally and uploads it as a new revision, so every other device rolls back too. */
  restore(revision: string): Promise<void> {
    return this.serialized(async () => {
      const c = await this.connect(true);
      if (!c) return;
      const snapshot = await c.store.readRevision(c.st.gistId, revision);
      if (!snapshot.ok) {
        if (snapshot.kind === 'notFound') this.set({ state: 'error', message: 'That revision no longer exists.' });
        else this.failed(snapshot);
        return;
      }
      const categories = enabledCategories(this.d.categories());
      const problems: string[] = [];
      const base = { ...c.st.base };
      const changes: Record<string, string | null> = {};
      const pushed: Record<string, Base> = {};
      for (const [name, encrypted] of Object.entries(snapshot.value.files)) {
        const file = fileOfRemoteName(name);
        if (file === undefined || !categories.includes(categoryOf(file))) continue;
        const plain = open(c.key, name, encrypted);
        if (plain === undefined) {
          problems.push(`Could not decrypt ${name} in that revision.`);
          continue;
        }
        const raw = await this.d.files.read(file);
        const applied = await this.applyPull({ file, name, raw, content: plain, plain, lv: hash(plain), rv: hash(plain) });
        if (typeof applied === 'string') {
          problems.push(applied);
          continue;
        }
        const uploaded = applied.uploaded ?? plain;
        changes[name] = seal(c.key, name, uploaded);
        pushed[file] = { local: hash(uploaded), remote: hash(uploaded) };
      }
      if (Object.keys(changes).length > 0) {
        const updated = await c.store.update(c.st.gistId, changes);
        if (!updated.ok) {
          this.failed(updated);
          return;
        }
        Object.assign(base, pushed);
      }
      await this.d.setState({ ...c.st, base });
      this.set({ conflicts: this.status.conflicts.filter((x) => !(x.file in pushed)) });
      if (problems.length > 0) this.set({ state: 'error', message: problems.join(' ') });
      else this.settle();
    }, false);
  }

  /** Forgets this device (state and passphrase); optionally deletes the cloud copy first. Local files are never touched. */
  async stop(deleteGist: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
    await this.tail;
    const st = this.d.state.get();
    if (deleteGist && st) {
      const account = (await this.d.accounts()).find((a) => a.id === st.accountId);
      const token = account && (await this.d.token(account.id, true));
      if (!token) return { ok: false, message: 'Could not get a GitHub token to delete the Gist.' };
      const removed = await createGistStore(this.d.io, token).remove(st.gistId);
      if (!removed.ok && removed.kind !== 'notFound') return { ok: false, message: removed.message };
    }
    await this.d.setState(undefined);
    await this.d.clearPassphrase();
    this.set({ ...CLEARED, state: 'disabled' });
    return { ok: true };
  }
```

- [ ] **Step 4: Run `npm test`** — Expected: PASS, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-sync/src/syncEngine.ts extensions/null-sync/src/syncEngine.test.ts
git commit -m "feat(null-sync): resolve conflicts, preview, restore and stop (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/src/syncEngine.ts extensions/null-sync/src/syncEngine.test.ts
```

---

### Task 11: statusText — a one-line summary for the status quick pick

**Files:**
- Create: `extensions/null-sync/src/statusText.ts`, `extensions/null-sync/src/statusText.test.ts`
- Modify: `extensions/null-sync/package.json` (`test` script)

**Interfaces:**
- Produces: `describeStatus(status: SyncStatus, now: number): string`

- [ ] **Step 1: Write the failing test `src/statusText.test.ts`**

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { describeStatus } from './statusText';
import { SyncState, SyncStatus } from './types';

const status = (state: SyncState, lastSyncedAt?: number): SyncStatus => ({
  state,
  lastSyncedAt,
  conflicts: [],
  pending: [],
  pendingInstalls: [],
  pendingRemovals: [],
});
const NOW = 10 * 24 * 3_600_000;
const MINUTE = 60_000;

describe('describeStatus', () => {
  it('says what each state means', () => {
    assert.equal(describeStatus(status('disabled'), NOW), 'Sync is off');
    assert.equal(describeStatus(status('signedOut'), NOW), 'Sign-in or setup needed');
    assert.equal(describeStatus(status('syncing'), NOW), 'Syncing…');
  });

  it('adds when it last synced', () => {
    assert.equal(describeStatus(status('idle', NOW - 30_000), NOW), 'Up to date (last synced just now)');
    assert.equal(describeStatus(status('offline', NOW - 5 * MINUTE), NOW), 'Offline (last synced 5 min ago)');
    assert.equal(describeStatus(status('error', NOW - 3 * 60 * MINUTE), NOW), 'Error (last synced 3 h ago)');
    assert.equal(describeStatus(status('needsAttention', NOW - 2 * 24 * 60 * MINUTE), NOW), 'Needs attention (last synced 2 d ago)');
  });

  it('says so when it has never synced', () => {
    assert.equal(describeStatus(status('idle'), NOW), 'Up to date (never synced)');
  });
});
```

- [ ] **Step 2: Add `out/statusText.test.js` to the `test` script**, then run `npm test`

Expected: FAIL at `tsc` with `error TS2307: Cannot find module './statusText'`.

- [ ] **Step 3: Write `src/statusText.ts`**

```ts
'use strict';

import { SyncStatus } from './types';

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** A one-line summary of the sync state, for the status quick pick. */
export function describeStatus(status: SyncStatus, now: number): string {
  const last = status.lastSyncedAt === undefined ? 'never synced' : `last synced ${ago(now - status.lastSyncedAt)}`;
  switch (status.state) {
    case 'disabled':
      return 'Sync is off';
    case 'signedOut':
      return 'Sign-in or setup needed';
    case 'syncing':
      return 'Syncing…';
    case 'idle':
      return `Up to date (${last})`;
    case 'offline':
      return `Offline (${last})`;
    case 'error':
      return `Error (${last})`;
    case 'needsAttention':
      return `Needs attention (${last})`;
  }
}
```

- [ ] **Step 4: Run `npm test`** — Expected: PASS, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-sync/package.json extensions/null-sync/src/statusText.ts extensions/null-sync/src/statusText.test.ts
git commit -m "feat(null-sync): one-line status summary (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/package.json extensions/null-sync/src/statusText.ts extensions/null-sync/src/statusText.test.ts
```

---

### Task 12: VS Code glue — prompts, commands, activation and the manifest

**Files:**
- Create: `extensions/null-sync/src/prompts.ts`, `extensions/null-sync/src/commands.ts`, `extensions/null-sync/src/extension.ts`, `extensions/null-sync/src/manifest.test.ts`
- Modify: `extensions/null-sync/package.json` (add `main`, `activationEvents`, `extensionKind`, `extensionDependencies`, `contributes`; extend the `test` script)

**Interfaces:**
- Consumes: `SyncEngine`, `LocalFiles`, `acquire`, `fetchJson`/`fetchText`, `enable`/`EnableDeps`/`EnablePrompts`/`CANCELLED`, `describeStatus`, `passphraseProblem`, `Revision`, types.
- Produces: `activate(context): NullSyncApi`; commands `null.sync.enable`, `.syncNow`, `.resolveConflicts`, `.restore`, `.stop`, `.setCategories`, `.showStatus`; settings `null-sync.enabled`, `.categories`, `.excludedSettings`.

- [ ] **Step 1: Write the failing contract test `src/manifest.test.ts`**

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { matchesKey } from './settingsFilter';
import { CATEGORIES } from './types';

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const props = pkg.contributes.configuration.properties;

describe('package.json contract', () => {
  it('is a UI-side built-in that depends on null-accounts', () => {
    assert.equal(pkg.publisher, 'null');
    assert.deepEqual(pkg.extensionKind, ['ui']);
    assert.deepEqual(pkg.extensionDependencies, ['null.null-accounts']);
    assert.deepEqual(pkg.activationEvents, ['onStartupFinished']);
    assert.ok(fs.existsSync(path.join(root, pkg.main)), 'main points at a compiled file');
  });

  it('contributes exactly the documented commands', () => {
    const ids = pkg.contributes.commands.map((c: { command: string }) => c.command).sort();
    assert.deepEqual(ids, [
      'null.sync.enable', 'null.sync.resolveConflicts', 'null.sync.restore', 'null.sync.setCategories',
      'null.sync.showStatus', 'null.sync.stop', 'null.sync.syncNow',
    ]);
  });

  it('is off by default and every setting is application-scoped', () => {
    assert.equal(props['null-sync.enabled'].default, false);
    for (const key of Object.keys(props)) assert.equal(props[key].scope, 'application', key);
  });

  it('syncs every category by default', () => {
    const defaults = props['null-sync.categories'].default;
    assert.deepEqual(Object.keys(defaults), [...CATEGORIES]);
    assert.ok(Object.values(defaults).every((v) => v === true));
  });

  it('excludes machine-specific paths and secrets by default', () => {
    const excluded: string[] = props['null-sync.excludedSettings'].default;
    for (const key of [
      'git.path', 'rust-analyzer.server.path', 'python.defaultInterpreterPath', 'terminal.integrated.defaultProfile.windows',
      'terminal.integrated.profiles.windows', 'http.proxy', 'null-sync.enabled', 'my.apiToken', 'x.SECRET', 'a.password',
      'github.credentialHelper',
    ]) {
      assert.equal(matchesKey(key, excluded), true, key);
    }
    for (const key of ['editor.fontSize', 'workbench.colorTheme', 'files.autoSave']) {
      assert.equal(matchesKey(key, excluded), false, key);
    }
  });
});
```

- [ ] **Step 2: Write `package.json`** (replace the file; the dependency and script blocks are unchanged except `test`, which lists every test file created so far plus `out/manifest.test.js`)

```json
{
  "name": "null-sync",
  "displayName": "Null Sync",
  "description": "Encrypted cross-device sync of settings, keybindings, snippets and extensions through a secret GitHub Gist",
  "version": "1.0.0",
  "publisher": "null",
  "license": "MIT",
  "engines": {
    "vscode": "^1.93.0"
  },
  "extensionKind": ["ui"],
  "extensionDependencies": ["null.null-accounts"],
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "null.sync.enable", "title": "Null: Enable Settings Sync" },
      { "command": "null.sync.syncNow", "title": "Null: Sync Settings Now" },
      { "command": "null.sync.resolveConflicts", "title": "Null: Resolve Sync Conflicts" },
      { "command": "null.sync.restore", "title": "Null: Restore Synced Settings…" },
      { "command": "null.sync.stop", "title": "Null: Stop Settings Sync" },
      { "command": "null.sync.setCategories", "title": "Null: Choose What to Sync" },
      { "command": "null.sync.showStatus", "title": "Null: Show Sync Status" }
    ],
    "configuration": {
      "title": "Null Sync",
      "properties": {
        "null-sync.enabled": {
          "type": "boolean",
          "default": false,
          "scope": "application",
          "markdownDescription": "Sync settings, keybindings, snippets and the extension list across your devices. Set it up with **Null: Enable Settings Sync**. Turning this off pauses syncing without forgetting this device."
        },
        "null-sync.categories": {
          "type": "object",
          "scope": "application",
          "default": { "settings": true, "keybindings": true, "snippets": true },
          "properties": {
            "settings": { "type": "boolean" },
            "keybindings": { "type": "boolean" },
            "snippets": { "type": "boolean" }
          },
          "additionalProperties": false,
          "markdownDescription": "What to sync on this device. Change it with **Null: Choose What to Sync**."
        },
        "null-sync.excludedSettings": {
          "type": "array",
          "items": { "type": "string" },
          "scope": "application",
          "default": [
            "*.path", "*Path", "terminal.integrated.defaultProfile.*", "terminal.integrated.profiles.*", "http.proxy",
            "null-sync.*", "*token*", "*secret*", "*password*", "*apiKey*", "*credential*"
          ],
          "markdownDescription": "Settings that stay on this device. `*` matches any run of characters; matching is case-insensitive. Machine-specific paths and anything that looks like a secret are excluded by default."
        }
      }
    }
  },
  "scripts": {
    "compile": "tsc -p tsconfig.json",
    "test": "tsc -p tsconfig.json && node --test out/layout.test.js out/cryptoBox.test.js out/syncPlan.test.js out/settingsFilter.test.js out/gistStore.test.js out/localFiles.test.js out/lock.test.js out/enable.test.js out/syncEngine.test.js out/statusText.test.js out/manifest.test.js",
    "pretest:integration": "tsc -p tsconfig.json",
    "test:integration": "node ./out/test/runTest.js"
  },
  "dependencies": {
    "jsonc-parser": "^3.3.1"
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

- [ ] **Step 3: Write `src/prompts.ts`**

```ts
'use strict';

import * as vscode from 'vscode';
import { passphraseProblem } from './cryptoBox';
import { EnablePrompts } from './enable';
import { Revision } from './gistStore';
import { FirstSync } from './types';

const secret = (options: vscode.InputBoxOptions): Thenable<string | undefined> =>
  vscode.window.showInputBox({ password: true, ignoreFocusOut: true, ...options });

export const enablePrompts: EnablePrompts = {
  async chooseAccount(accounts) {
    const picked = await vscode.window.showQuickPick(
      accounts.map((account) => ({ label: `@${account.username}`, account })),
      { placeHolder: 'Sync settings with which GitHub account?' },
    );
    return picked?.account;
  },

  async consent(categories) {
    const answer = await vscode.window.showWarningMessage(
      `Upload your ${categories.join(', ')} to a secret GitHub Gist? They are encrypted on this device with a passphrase you choose, so only someone who knows it can read them. The passphrase cannot be recovered or reset.`,
      { modal: true },
      'Enable Sync',
    );
    return answer === 'Enable Sync';
  },

  async newPassphrase() {
    const first = await secret({
      title: 'Null Sync: choose a passphrase',
      prompt: 'At least 12 characters. It cannot be recovered or reset, and you will enter it once on each device.',
      validateInput: (value) => passphraseProblem(value, value),
    });
    if (first === undefined) return undefined;
    const second = await secret({
      title: 'Null Sync: confirm the passphrase',
      prompt: 'Enter it again.',
      validateInput: (value) => passphraseProblem(first, value),
    });
    return second === undefined ? undefined : first;
  },

  existingPassphrase: (attempt) =>
    Promise.resolve(
      secret({
        title: 'Null Sync: enter your passphrase',
        prompt:
          attempt === 1
            ? 'This account already has synced settings. Enter the passphrase you chose on your first device.'
            : 'That was not the right passphrase. Try again.',
      }),
    ),

  async firstSync() {
    const picked = await vscode.window.showQuickPick<vscode.QuickPickItem & { value: FirstSync | 'each' }>(
      [
        { label: 'Use the synced settings', description: 'Replace this device\'s files; your versions are backed up', value: 'cloud' },
        { label: 'Use this device\'s settings', description: 'Replace the synced files with this device\'s', value: 'device' },
        { label: 'Decide file by file', description: 'Keep both for now and resolve each difference yourself', value: 'each' },
      ],
      { placeHolder: 'This device already has settings. How should they be combined with the synced ones?', ignoreFocusOut: true },
    );
    return picked?.value;
  },
};

export async function chooseConflictAction(file: string): Promise<'mine' | 'theirs' | 'diff' | undefined> {
  const picked = await vscode.window.showQuickPick<vscode.QuickPickItem & { value: 'mine' | 'theirs' | 'diff' }>(
    [
      { label: 'Keep mine', description: 'Upload this device\'s version', value: 'mine' },
      { label: 'Take theirs', description: 'Use the synced version; yours is backed up', value: 'theirs' },
      { label: 'Show diff', description: 'Compare the two first', value: 'diff' },
    ],
    { placeHolder: `${file} changed on this device and on another one`, ignoreFocusOut: true },
  );
  return picked?.value;
}

export async function chooseRevision(revisions: Revision[]): Promise<Revision | undefined> {
  const picked = await vscode.window.showQuickPick(
    revisions.map((revision) => ({ label: new Date(revision.date).toLocaleString(), description: revision.sha.slice(0, 7), revision })),
    { placeHolder: 'Restore the synced settings as they were at…' },
  );
  return picked?.revision;
}

export async function confirmRestore(revision: Revision): Promise<boolean> {
  const answer = await vscode.window.showWarningMessage(
    `Restore the synced settings from ${new Date(revision.date).toLocaleString()}? This device and every synced device will switch to that version. The current files are backed up on this device first.`,
    { modal: true },
    'Restore',
  );
  return answer === 'Restore';
}

export async function confirmStop(): Promise<'stop' | 'delete' | undefined> {
  const answer = await vscode.window.showWarningMessage(
    'Stop syncing on this device? Your local files are not changed.',
    { modal: true },
    'Stop Syncing',
    'Stop and Delete the Synced Copy',
  );
  return answer === 'Stop Syncing' ? 'stop' : answer === 'Stop and Delete the Synced Copy' ? 'delete' : undefined;
}
```

- [ ] **Step 4: Write `src/commands.ts`**

```ts
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { CANCELLED, EnableDeps, enable } from './enable';
import * as prompts from './prompts';
import { describeStatus } from './statusText';
import { SyncEngine } from './syncEngine';
import { CATEGORIES } from './types';

const config = () => vscode.workspace.getConfiguration('null-sync');

function report(engine: SyncEngine, done: string): void {
  const s = engine.getStatus();
  if (s.state === 'idle') void vscode.window.showInformationMessage(`Null Sync: ${done}`);
  else if (s.message) void vscode.window.showWarningMessage(`Null Sync: ${s.message}`);
  else if (s.state === 'needsAttention') {
    void vscode.window.showInformationMessage('Null Sync: some items need attention. Run "Null: Show Sync Status".');
  }
}

async function showDiff(engine: SyncEngine, userDir: string, file: string): Promise<void> {
  const remote = await engine.previewRemote(file);
  const synced = await vscode.workspace.openTextDocument({ content: remote ?? '', language: 'jsonc' });
  const local = vscode.Uri.file(path.join(userDir, ...file.split('/')));
  const note = file === 'settings.json' ? ' (excluded settings are not synced)' : '';
  await vscode.commands.executeCommand('vscode.diff', synced.uri, local, `${file}: synced ↔ this device${note}`);
}

/** Asks what to do with one conflict until the user decides; false if they gave up. */
async function resolveOne(engine: SyncEngine, userDir: string, file: string): Promise<boolean> {
  for (;;) {
    const choice = await prompts.chooseConflictAction(file);
    if (choice === undefined) return false;
    if (choice === 'diff') {
      await showDiff(engine, userDir, file);
      continue;
    }
    await engine.resolve(file, choice);
    return true;
  }
}

export function registerCommands(context: vscode.ExtensionContext, engine: SyncEngine, enableDeps: EnableDeps, userDir: string): void {
  const resolveAll = async (): Promise<void> => {
    for (const { file } of [...engine.getStatus().conflicts]) {
      if (!(await resolveOne(engine, userDir, file))) return;
    }
    report(engine, 'all conflicts resolved.');
  };

  const restore = async (): Promise<void> => {
    const revisions = await engine.revisions();
    if (!revisions) return report(engine, '');
    const picked = await prompts.chooseRevision(revisions);
    if (!picked || !(await prompts.confirmRestore(picked))) return;
    await engine.restore(picked.sha);
    report(engine, 'restored.');
  };

  const stop = async (): Promise<void> => {
    const choice = await prompts.confirmStop();
    if (!choice) return;
    const result = await engine.stop(choice === 'delete');
    if (!result.ok) {
      void vscode.window.showErrorMessage(`Null Sync: ${result.message}`);
      return;
    }
    await config().update('enabled', false, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage('Null Sync: stopped on this device. Your local files were not changed.');
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('null.sync.enable', async () => {
      const result = await enable(enableDeps, prompts.enablePrompts);
      if (!result.ok) {
        if (result.message !== CANCELLED) void vscode.window.showErrorMessage(`Null Sync: ${result.message}`);
        return;
      }
      await config().update('enabled', true, vscode.ConfigurationTarget.Global);
      await engine.run({ interactive: true, firstSync: result.firstSync });
      report(engine, 'sync is on.');
    }),

    vscode.commands.registerCommand('null.sync.syncNow', async () => {
      await engine.run({ interactive: true });
      report(engine, 'up to date.');
    }),

    vscode.commands.registerCommand('null.sync.resolveConflicts', resolveAll),
    vscode.commands.registerCommand('null.sync.restore', restore),
    vscode.commands.registerCommand('null.sync.stop', stop),

    vscode.commands.registerCommand('null.sync.setCategories', async () => {
      const current: Record<string, boolean> = {
        ...Object.fromEntries(CATEGORIES.map((category) => [category, true])),
        ...config().get<Record<string, boolean>>('categories'),
      };
      const picked = await vscode.window.showQuickPick(
        CATEGORIES.map((category) => ({ label: category, picked: current[category] !== false })),
        { canPickMany: true, placeHolder: 'Choose what to sync on this device' },
      );
      if (!picked) return;
      const next = Object.fromEntries(CATEGORIES.map((category) => [category, picked.some((p) => p.label === category)]));
      await config().update('categories', next, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('null.sync.showStatus', async () => {
      const s = engine.getStatus();
      type Item = vscode.QuickPickItem & { run?: () => Thenable<unknown> };
      const items: Item[] = [{ label: `$(sync) ${describeStatus(s, Date.now())}`, description: s.message }];
      for (const c of s.conflicts) {
        items.push({ label: `$(warning) Resolve conflict: ${c.file}`, run: () => resolveOne(engine, userDir, c.file) });
      }
      for (const file of s.pending) {
        items.push({ label: `$(clock) Waiting for unsaved changes: ${file}`, description: 'applied once it is saved or closed' });
      }
      items.push(
        { label: '$(sync) Sync now', run: () => vscode.commands.executeCommand('null.sync.syncNow') },
        { label: '$(history) Restore an earlier version…', run: restore },
        { label: '$(debug-stop) Stop syncing…', run: stop },
      );
      const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Null Sync' });
      await picked?.run?.();
    }),
  );
}
```

- [ ] **Step 5: Write `src/extension.ts`**

```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { EnableDeps } from './enable';
import { fetchJson, fetchText } from './gistHttp';
import { LocalFiles } from './localFiles';
import { acquire } from './lock';
import { SyncEngine } from './syncEngine';
import { CATEGORIES, Category, NullSyncApi, StoredState, SyncAccount } from './types';

const STATE_KEY = 'null-sync.state';
const PASSPHRASE_KEY = 'null-sync/passphrase';
const STARTUP_MS = 10_000;
const DEBOUNCE_MS = 30_000;
const INTERVAL_MS = 10 * 60_000;

/** The part of null-accounts' public API used here (a separate extension, so no shared import). */
interface AccountRecord {
  id: string;
  provider: string;
  host: string;
  username: string;
  authMethod: string;
}
interface AccountsApi {
  getAccounts(): AccountRecord[];
  getToken(account: AccountRecord, scopes?: string[], options?: { interactive?: boolean }): Promise<string | undefined>;
}

/** Windows paths are case-insensitive (Null IDE is Windows-only). */
const samePath = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export function activate(context: vscode.ExtensionContext): NullSyncApi {
  const config = () => vscode.workspace.getConfiguration('null-sync');
  const storage = context.globalStorageUri.fsPath;
  // `<User>/globalStorage/<publisher.name>` -> `<User>`, where settings.json, keybindings.json and snippets/ live.
  const userDir = path.dirname(path.dirname(storage));
  fs.mkdirSync(storage, { recursive: true });

  const accountsApi = () => vscode.extensions.getExtension<AccountsApi>('null.null-accounts')?.activate();
  const categories = (): Record<Category, boolean> => ({
    ...(Object.fromEntries(CATEGORIES.map((category) => [category, true])) as Record<Category, boolean>),
    ...config().get<Partial<Record<Category, boolean>>>('categories'),
  });
  const githubAccounts = async (): Promise<SyncAccount[]> =>
    ((await accountsApi())?.getAccounts() ?? [])
      .filter((a) => a.provider === 'github' && a.host === 'github.com' && a.authMethod !== 'ssh')
      .map(({ id, username }) => ({ id, username }));
  const token = async (accountId: string, interactive: boolean): Promise<string | undefined> => {
    const api = await accountsApi();
    const account = api?.getAccounts().find((a) => a.id === accountId);
    return api && account ? api.getToken(account, ['gist'], { interactive }) : undefined;
  };
  const io = { json: fetchJson, text: fetchText };

  const files = new LocalFiles({
    userDir,
    backupsDir: path.join(storage, 'backups'),
    now: Date.now,
    isDirty: (absolutePath) => vscode.workspace.textDocuments.some((doc) => doc.isDirty && samePath(doc.uri.fsPath, absolutePath)),
  });

  const engine = new SyncEngine({
    enabled: () => config().get<boolean>('enabled', false),
    categories,
    excluded: () => config().get<string[]>('excludedSettings', []),
    accounts: githubAccounts,
    token,
    io,
    files,
    passphrase: async () => context.secrets.get(PASSPHRASE_KEY),
    clearPassphrase: async () => context.secrets.delete(PASSPHRASE_KEY),
    state: { get: () => context.globalState.get<StoredState>(STATE_KEY) },
    setState: async (state) => { await context.globalState.update(STATE_KEY, state); },
    lock: () => acquire(path.join(storage, 'lock')),
    now: Date.now,
    confirmOverwrite: async (file) =>
      (await vscode.window.showWarningMessage(`${file} has unsaved changes. Overwrite it with the synced version?`, { modal: true }, 'Overwrite')) === 'Overwrite',
  });

  const enableDeps: EnableDeps = {
    accounts: githubAccounts,
    token,
    io,
    categories: () => CATEGORIES.filter((category) => categories()[category]),
    savePassphrase: async (passphrase) => { await context.secrets.store(PASSPHRASE_KEY, passphrase); },
    setState: async (state) => { await context.globalState.update(STATE_KEY, state); },
  };

  const changed = new vscode.EventEmitter<void>();
  context.subscriptions.push(changed, engine.onDidChange(() => changed.fire()));
  registerCommands(context, engine, enableDeps, userDir);

  // Background triggers: shortly after startup, after a synced file changes (debounced), and on a timer. None prompt.
  const background = (): void => void engine.run({ interactive: false });
  let debounce: NodeJS.Timeout | undefined;
  const fileChanged = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(background, DEBOUNCE_MS);
  };
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(userDir), '{settings.json,keybindings.json,snippets/*}'),
  );
  const startup = setTimeout(background, STARTUP_MS);
  const timer = setInterval(background, INTERVAL_MS);
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(fileChanged),
    watcher.onDidCreate(fileChanged),
    watcher.onDidDelete(fileChanged),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('null-sync')) background(); }),
    { dispose: () => { clearTimeout(startup); clearInterval(timer); if (debounce) clearTimeout(debounce); } },
  );

  return {
    getStatus: () => engine.getStatus(),
    onDidChangeStatus: changed.event,
    syncNow: () => engine.run({ interactive: true }),
    resolveConflict: (file, side) => engine.resolve(file, side),
  };
}

export function deactivate(): void {}
```

- [ ] **Step 6: Run `npm test`** — Expected: PASS, `fail 0`; `tsc` compiles the three `vscode` files. If `tsc` reports that `watcher.onDidChange(fileChanged)` returns a `Disposable` pushed into `subscriptions`, that is intended.

- [ ] **Step 7: Commit**

```bash
git add extensions/null-sync/package.json extensions/null-sync/src/prompts.ts extensions/null-sync/src/commands.ts extensions/null-sync/src/extension.ts extensions/null-sync/src/manifest.test.ts
git commit -m "feat(null-sync): commands, prompts, activation and manifest (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/package.json extensions/null-sync/src/prompts.ts extensions/null-sync/src/commands.ts extensions/null-sync/src/extension.ts extensions/null-sync/src/manifest.test.ts
```

---

### Task 13: build wiring, integration spec, docs and compiled output (ends Phase 1)

**Files:**
- Modify: `.github/workflows/build.yml`, `scripts/build-local.ps1`, `scripts/sync-local.ps1`, `CLAUDE.md`, `docs/specs/null-sync-design.md`
- Create: `extensions/null-sync/src/test/runTest.ts`, `extensions/null-sync/src/test/suite/index.ts`, `extensions/null-sync/src/test/suite/activation.spec.ts`
- Commit: `extensions/null-sync/out/`

- [ ] **Step 1: `build.yml` — compile and copy.** After the `Compile null-env TypeScript` step add:

```yaml
      - name: Compile null-sync TypeScript
        shell: pwsh
        run: |
          Set-Location ide-overlay/extensions/null-sync
          npm ci --ignore-scripts
          npm run compile
```

and in `Copy built-in extensions` add, after the `null-env` line:

```powershell
          Copy-Item -Recurse -Force ide-overlay/extensions/null-sync       vscode-src/extensions/
```

(`null-sync` is machine-local, so it is **not** added to the remote-server tarball list near `foreach ($e in 'null-env', 'null-cpp', …)`.)

- [ ] **Step 2: `scripts/build-local.ps1`.** In both arrays (the `foreach ($ext in @("null-tools", … "null-env"))` compile loop and the `Copying built-in extensions` loop) append `, "null-sync"` after `"null-env"`.

- [ ] **Step 3: `scripts/sync-local.ps1`.** After the `"null-env"` entry add (note the runtime dependency, which `robocopy /MIR` mirrors):

```powershell
    "null-sync" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out",
            "node_modules/jsonc-parser"
        )
    }
```

- [ ] **Step 4: Integration spec.** Create three files.

`src/test/suite/index.ts` (the same Mocha loader every extension here uses):

```ts
'use strict';

import * as path from 'path';
import { glob } from 'glob';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
  });

  const testsRoot = path.resolve(__dirname);

  return new Promise((resolve, reject) => {
    glob('**/*.spec.js', { cwd: testsRoot }).then(files => {
      files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

      try {
        mocha.run((failures: number) => {
          if (failures > 0) {
            reject(new Error(`${failures} spec(s) failed.`));
          } else {
            resolve();
          }
        });
      } catch (err) {
        reject(err);
      }
    }).catch(reject);
  });
}
```

`src/test/runTest.ts` (null-env's runner, loading `null-accounts` too because of `extensionDependencies`, like null-tools'):

```ts
'use strict';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';

async function main(): Promise<void> {
  const installDir = process.env.NULL_IDE_INSTALL_DIR
    ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Null IDE');

  // null-sync lists null-accounts in extensionDependencies, so the vanilla host must load it too.
  const extensionDevelopmentPath = ['null-sync', 'null-accounts'].map(name => {
    const dir = path.join(installDir, 'resources', 'app', 'extensions', name);
    if (!fs.existsSync(dir)) {
      throw new Error(`Synced ${name} not found at '${dir}'. Run scripts/sync-local.ps1 first.`);
    }
    return dir;
  });

  // Null IDE's own executable can't host this run: its product.json bakes in a fixed win32MutexName, so the
  // single-instance mutex collides with the window this is usually launched from. A separate vanilla VS Code
  // build has a different product identity; the synced extensions are loaded into it via extensionDevelopmentPath.
  const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-spec-workspace-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-spec-userdata-'));
  const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-spec-extensions-'));

  // If set, this forces any Electron binary to run as plain Node instead of launching the app, which breaks the
  // GUI launch this harness needs; it can be inherited from an Electron-based parent (e.g. an IDE terminal).
  delete process.env.ELECTRON_RUN_AS_NODE;

  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspaceDir,
        '--user-data-dir', userDataDir,
        '--extensions-dir', extensionsDir,
      ],
    });
  } finally {
    // VS Code's child processes can hold the profile briefly after runTests() settles; cleanup must never mask the spec result.
    for (const dir of [workspaceDir, userDataDir, extensionsDir]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
      } catch (err) {
        console.warn(`Could not remove temp dir ${dir}: ${(err as Error).message}`);
      }
    }
  }
}

main().catch(err => {
  console.error('Failed to run integration specs');
  console.error(err);
  process.exit(1);
});
```

`src/test/suite/activation.spec.ts`:

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';

const COMMANDS = [
  'null.sync.enable', 'null.sync.syncNow', 'null.sync.resolveConflicts', 'null.sync.restore',
  'null.sync.stop', 'null.sync.setCategories', 'null.sync.showStatus',
];

suite('null-sync activation', () => {
  test('activates, exposes its API and registers its commands', async () => {
    const extension = vscode.extensions.getExtension('null.null-sync');
    assert.ok(extension, 'null.null-sync extension not found');
    const api = await extension!.activate();
    assert.strictEqual(extension!.isActive, true);
    assert.strictEqual(typeof api.getStatus, 'function');
    assert.strictEqual(typeof api.syncNow, 'function');
    assert.strictEqual(typeof api.resolveConflict, 'function');
    const registered = await vscode.commands.getCommands(true);
    for (const id of COMMANDS) assert.ok(registered.includes(id), `${id} not registered`);
  });

  test('is off by default: a sync run reports disabled and touches nothing', async () => {
    const api = vscode.extensions.getExtension('null.null-sync')!.exports;
    await api.syncNow();
    assert.strictEqual(api.getStatus().state, 'disabled');
    assert.deepStrictEqual(api.getStatus().conflicts, []);
  });

  test('switched on without setup it says so instead of failing', async () => {
    const config = vscode.workspace.getConfiguration('null-sync');
    await config.update('enabled', true, vscode.ConfigurationTarget.Global);
    try {
      const api = vscode.extensions.getExtension('null.null-sync')!.exports;
      await api.syncNow();
      assert.strictEqual(api.getStatus().state, 'signedOut');
      assert.match(api.getStatus().message, /Enable Settings Sync/);
    } finally {
      await config.update('enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
```

- [ ] **Step 5: Compile everything and run the unit tests**

Run: `cd extensions/null-sync && npm test`
Expected: PASS, `fail 0`, and `tsc` compiles `src/test/**` without errors.

- [ ] **Step 6: Run the integration spec if a local install exists.**

If `%LOCALAPPDATA%\Programs\Null IDE` exists, invoke the `verify-local` skill with `null-sync` (it syncs the build into the install and runs `npm run test:integration`). Expected: 3 specs pass. If there is no install, say so in the final report; do not claim the specs passed.

- [ ] **Step 7: Document.**

(a) `CLAUDE.md`: change `Twelve built-in extensions` to `Thirteen built-in extensions` and append `` `null-sync` `` to its list; change `bundled as a thirteenth built-in extension` to `bundled as a fourteenth built-in extension`; add `` `null-sync` `` to the machine-local `extensionKind: ["ui"]` list in the Remote development bullet; add `` `null-sync` `` to the step-4 compile list and change step 5's `all twelve` to `all thirteen`; and add this section after `### null-env`:

```markdown
### null-sync (`extensions/null-sync/`)
Cross-device sync (issue #23) of `settings.json`, `keybindings.json` and snippets (the installed-extension list follows in a second phase) with no server of our own: one secret GitHub Gist per user, reached through null-accounts (`getToken(account, ['gist'], …)`, github.com accounts only) and **encrypted on the device** (AES-256-GCM, scrypt key from a passphrase of at least 12 characters kept in `SecretStorage`; a secret Gist is only unlisted, so it holds ciphertext plus a plaintext `manifest.json` with the KDF parameters). The passphrase cannot be recovered: forgetting it means Stop Syncing and starting a new store. `extensionKind: ["ui"]`, off by default (`null-sync.enabled`), not run in Safe Mode (publisher `null` built-ins are disabled). Pure, injectable modules: `cryptoBox`; `syncPlan` (`planFile(local, remote, base, deletable)`, where `base` is the pair `{ local, remote }` recorded at the last sync because a pulled `settings.json` is not byte-identical to the remote text); `settingsFilter` (`jsonc-parser`, the only runtime dependency; removes `null-sync.excludedSettings` keys — paths, terminal profiles, proxy, anything matching `*token*`/`*secret*`/`*password*`/`*apiKey*`/`*credential*` — before hashing and uploading, and puts this device's values back on pull); `gistStore` (+ `gistHttp.ts`, the only `fetch`); `localFiles` (every name through `isSyncableFile`, atomic writes, backups of the losing version under `globalStorage/null-sync/backups`, last 10 per file); `lock` (cross-window lock file); `enable`; `syncEngine` (`run` / `resolve` / `restore` / `stop`). Only `prompts.ts`, `commands.ts` and `extension.ts` import `vscode`. Whole-file three-way sync: one side changed wins; both changed is a conflict that is never auto-resolved; a missing `settings.json`/`keybindings.json` never deletes the remote copy, a deleted snippet does; a file open with unsaved edits is skipped and retried. Background runs (startup + 10 s, 30 s after a change, every 10 min) never prompt. **No UI:** `activate` returns `NullSyncApi` (`getStatus`, `onDidChangeStatus`, `syncNow`, `resolveConflict`) and the `null.sync.*` commands include `null.sync.showStatus`; the Null workspace rework will build the Sync screen on that contract. Design `docs/specs/null-sync-design.md`; plan `docs/plans/null-sync.md`. Integration spec: `npm run test:integration` (via `/verify-local null-sync`).
```

(b) `docs/specs/null-sync-design.md`: in the `prompts.ts` row of the Components table remove "(pre-selects the null-accounts default account when it is a github.com one)", and add under "Decisions": "**Account picker.** All github.com accounts from null-accounts are listed; the default account is not pre-selected because null-accounts keeps it private (`globalState`) and its public API does not expose it."

- [ ] **Step 8: Commit the wiring and docs**

```bash
git add .github/workflows/build.yml scripts/build-local.ps1 scripts/sync-local.ps1 CLAUDE.md docs/specs/null-sync-design.md extensions/null-sync/src/test
git commit -m "build(null-sync): wire the new built-in into CI, local build and sync, add integration spec and docs (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- .github/workflows/build.yml scripts/build-local.ps1 scripts/sync-local.ps1 CLAUDE.md docs/specs/null-sync-design.md extensions/null-sync/src/test
```

- [ ] **Step 9: Refresh and commit the compiled output**

Run: `cd extensions/null-sync && npm run compile`

```bash
git add extensions/null-sync/out
git commit -m "chore: refresh null-sync compiled output (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/out
```

Phase 1 is now shippable on its own: with the extension list not yet synced, everything in the issue's acceptance criteria except the extension list works through the palette commands.

---
## Phase 2 — the extension list

Phase 1 is complete and committed before any of this starts. Phase 2 is isolated because install and uninstall behavior depends on a real Null IDE build.

### Task 14: extensionSet — merging the installed-extension lists

**Files:**
- Create: `extensions/null-sync/src/extensionSet.ts`, `extensions/null-sync/src/extensionSet.test.ts`
- Modify: `extensions/null-sync/package.json` (`test` script)

**Interfaces:**
- Produces:
  - `interface Merge { install: string[]; notifyRemoved: string[]; push: string[] | undefined; nextBase: string[] }`
  - `mergeExtensions(local: string[], remote: string[] | null, base: string[] | undefined): Merge` — all IDs lowercase `publisher.name`; `remote === null` = no remote list yet; `base === undefined` = never synced
  - `parseIds(text: string): string[] | undefined` — the decrypted remote list
  - `installedIds(manifestText: string): string[] | undefined` — the user extensions in `extensions.json`, disabled ones included; `undefined` if the file cannot be read as a list

- [ ] **Step 1: Write the failing test `src/extensionSet.test.ts`**

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { installedIds, mergeExtensions, parseIds } from './extensionSet';

describe('mergeExtensions', () => {
  it('first sync with no remote list uploads everything this device has', () => {
    assert.deepEqual(mergeExtensions(['a', 'b'], null, undefined), { install: [], notifyRemoved: [], push: ['a', 'b'], nextBase: ['a', 'b'] });
  });

  it('first sync joins two different sets in both directions', () => {
    assert.deepEqual(mergeExtensions(['a', 'b'], ['b', 'c'], undefined), {
      install: ['c'],
      notifyRemoved: [],
      push: ['a', 'b', 'c'],
      nextBase: ['a', 'b'],
    });
  });

  it('is stable once everything is installed', () => {
    assert.deepEqual(mergeExtensions(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b']), {
      install: [],
      notifyRemoved: [],
      push: undefined,
      nextBase: ['a', 'b', 'c'],
    });
  });

  it('an extension added elsewhere is to install, one removed elsewhere is only reported', () => {
    assert.deepEqual(mergeExtensions(['a', 'b'], ['a', 'c'], ['a', 'b']), {
      install: ['c'],
      notifyRemoved: ['b'],
      push: undefined,
      nextBase: ['a', 'b'],
    });
  });

  it('an extension uninstalled here is removed from the cloud list', () => {
    assert.deepEqual(mergeExtensions(['a'], ['a', 'b'], ['a', 'b']), { install: [], notifyRemoved: [], push: ['a'], nextBase: ['a'] });
  });

  it('both sides adding the same extension is not a change', () => {
    assert.deepEqual(mergeExtensions(['a', 'x'], ['a', 'x'], ['a']), { install: [], notifyRemoved: [], push: undefined, nextBase: ['a', 'x'] });
  });

  it('a removal on both sides is a no-op', () => {
    assert.deepEqual(mergeExtensions(['a'], ['a'], ['a', 'b']), { install: [], notifyRemoved: [], push: undefined, nextBase: ['a'] });
  });

  it('a device with nothing installed and no remote list creates an empty list', () => {
    assert.equal(mergeExtensions([], null, undefined).push?.length, 0);
    assert.equal(mergeExtensions([], [], undefined).push, undefined);
  });
});

describe('two devices converge', () => {
  interface Dev { installed: Set<string>; base?: string[] }
  const cloud: { ids: string[] | null } = { ids: null };
  function sync(dev: Dev, interactive: boolean) {
    let merge = mergeExtensions([...dev.installed], cloud.ids, dev.base);
    if (interactive) {
      for (const id of merge.install) dev.installed.add(id);
      merge = mergeExtensions([...dev.installed], cloud.ids, dev.base);
    }
    if (merge.push) cloud.ids = merge.push;
    dev.base = merge.nextBase;
    return merge;
  }

  it('adds propagate, removals are reported and never re-uploaded', () => {
    const a: Dev = { installed: new Set(['x', 'y']) };
    const b: Dev = { installed: new Set(['y', 'z']) };
    sync(a, true);
    sync(b, true);
    sync(a, true);
    assert.deepEqual([...a.installed].sort(), ['x', 'y', 'z']);
    assert.deepEqual([...b.installed].sort(), ['x', 'y', 'z']);
    assert.equal(sync(a, true).push, undefined);
    assert.equal(sync(b, true).push, undefined);

    a.installed.delete('y');
    sync(a, true);
    assert.deepEqual(cloud.ids, ['x', 'z']);
    assert.deepEqual(sync(b, false).notifyRemoved, ['y']);
    assert.equal(b.installed.has('y'), true, 'a removal elsewhere never uninstalls here');
    const again = sync(b, false);
    assert.deepEqual(again.notifyRemoved, ['y']);
    assert.equal(again.push, undefined);
    assert.deepEqual(cloud.ids, ['x', 'z']);

    b.installed.delete('y');
    b.base = b.base!.filter((id) => id !== 'y');
    const settled = sync(b, true);
    assert.deepEqual(settled.notifyRemoved, []);
    assert.equal(settled.push, undefined);
  });
});

describe('parseIds', () => {
  it('lowercases, sorts and de-duplicates a list of strings', () => {
    assert.deepEqual(parseIds('["B.two","a.one","A.ONE"]'), ['a.one', 'b.two']);
  });
  it('rejects anything else', () => {
    for (const t of ['', 'nope', '{}', '[1]', '["a",2]']) assert.equal(parseIds(t), undefined, t);
  });
});

describe('installedIds', () => {
  const manifest = JSON.stringify([
    { identifier: { id: 'Ms-Python.Python', uuid: '1' }, version: '1.0.0', metadata: { isBuiltin: false } },
    { identifier: { id: 'null.something' }, metadata: { isBuiltin: true } },
    { identifier: { id: 'machine.only' }, metadata: { isMachineScoped: true } },
    { identifier: { id: 'rust-lang.rust-analyzer' } },
    { nothing: true },
  ]);

  it('lists user extensions (enabled or not), lowercased, without built-ins or machine-scoped ones', () => {
    assert.deepEqual(installedIds(manifest), ['ms-python.python', 'rust-lang.rust-analyzer']);
  });

  it('returns undefined rather than an empty list when the file cannot be read, so nothing is mistaken for "all uninstalled"', () => {
    for (const t of ['', '{ half a fi', '{}', 'null']) assert.equal(installedIds(t), undefined, t);
  });

  it('an empty list is a real answer', () => {
    assert.deepEqual(installedIds('[]'), []);
  });
});
```

- [ ] **Step 2: Add `out/extensionSet.test.js` to the `test` script**, then run `npm test`

Expected: FAIL at `tsc` with `error TS2307: Cannot find module './extensionSet'`.

- [ ] **Step 3: Write `src/extensionSet.ts`**

```ts
'use strict';

export interface Merge {
  /** IDs on the remote list that this device does not have yet. */
  install: string[];
  /** Removed elsewhere but still installed here: reported, never uninstalled automatically. */
  notifyRemoved: string[];
  /** The new remote list, or `undefined` when the remote already has it. */
  push: string[] | undefined;
  /** What to remember as agreed: installed here and on the remote, plus the removals still being reported. */
  nextBase: string[];
}

const sorted = (ids: Iterable<string>): string[] => [...new Set(ids)].sort();
const sameSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((id) => b.has(id));

/**
 * Three-way set merge. `base` is what both sides agreed on at the last sync (`undefined` = never synced, so nothing
 * has been removed by either side). IDs pending install are deliberately left out of `nextBase`: remembering them
 * would make the next run read them as "uninstalled here" and push their removal. Removals still being reported are kept
 * in it for the opposite reason: dropping them would make the next run read them as new local additions and re-upload them.
 */
export function mergeExtensions(local: string[], remote: string[] | null, base: string[] | undefined): Merge {
  const mine = new Set(local);
  const theirs = new Set(remote ?? []);
  const agreed = new Set(base ?? []);

  const install = [...theirs].filter((id) => !agreed.has(id) && !mine.has(id));
  const notifyRemoved = [...agreed].filter((id) => !theirs.has(id) && mine.has(id));

  const next = new Set([...theirs, ...[...mine].filter((id) => !agreed.has(id))]);
  for (const id of agreed) {
    if (!mine.has(id)) next.delete(id);
  }

  return {
    install: sorted(install),
    notifyRemoved: sorted(notifyRemoved),
    push: remote !== null && sameSet(next, theirs) ? undefined : sorted(next),
    nextBase: sorted([...[...mine].filter((id) => next.has(id)), ...notifyRemoved]),
  };
}

/** The decrypted remote list: a JSON array of extension IDs; `undefined` if it is anything else. */
export function parseIds(text: string): string[] | undefined {
  try {
    const list = JSON.parse(text) as unknown;
    return Array.isArray(list) && list.every((id) => typeof id === 'string')
      ? sorted((list as string[]).map((id) => id.toLowerCase()))
      : undefined;
  } catch {
    return undefined;
  }
}

interface ManifestEntry {
  identifier?: { id?: unknown };
  metadata?: { isBuiltin?: unknown; isMachineScoped?: unknown };
}

/**
 * User-installed extension IDs from `extensions.json`. That file lists disabled extensions too (`vscode.extensions.all`
 * does not). `undefined` when the text is not a list, so an unreadable file is never mistaken for "everything was uninstalled".
 */
export function installedIds(manifestText: string): string[] | undefined {
  try {
    const list = JSON.parse(manifestText) as unknown;
    if (!Array.isArray(list)) return undefined;
    return sorted(
      (list as ManifestEntry[]).flatMap((entry) =>
        typeof entry?.identifier?.id === 'string' && entry.metadata?.isBuiltin !== true && entry.metadata?.isMachineScoped !== true
          ? [entry.identifier.id.toLowerCase()]
          : [],
      ),
    );
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run `npm test`** — Expected: PASS, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-sync/package.json extensions/null-sync/src/extensionSet.ts extensions/null-sync/src/extensionSet.test.ts
git commit -m "feat(null-sync): set merge for the installed-extension list (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/package.json extensions/null-sync/src/extensionSet.ts extensions/null-sync/src/extensionSet.test.ts
```

---

### Task 15: engine — sync the extension list

**Files:**
- Modify: `extensions/null-sync/src/types.ts`, `extensions/null-sync/src/layout.ts`, `extensions/null-sync/src/syncEngine.ts`, `extensions/null-sync/src/testDevice.ts`, `extensions/null-sync/src/syncEngine.test.ts`

**Interfaces:**
- Consumes: `mergeExtensions`, `parseIds` (Task 14).
- Produces:
  - `CATEGORIES` gains `'extensions'`; `StoredState.extensionsBase?: string[]`; `NullSyncApi.uninstallRemoved(id: string): Promise<void>`
  - `EXTENSIONS_REMOTE = 'extensions.json.enc'` (layout)
  - `interface ExtensionHost { installed(): Promise<string[] | undefined>; install(id: string): Promise<boolean>; uninstall(id: string): Promise<boolean> }` and `EngineDeps.extensions?: ExtensionHost`
  - `SyncEngine.uninstallRemoved(id: string): Promise<void>`

- [ ] **Step 1: Extend the test device.** In `src/testDevice.ts`:

(a) change `import { Category, FirstSync, StoredState, SyncStatus } from './types';` to `import { CATEGORIES, Category, FirstSync, StoredState, SyncStatus } from './types';`

(b) replace the `categories` field with
`categories: Record<Category, boolean> = { settings: true, keybindings: true, snippets: true, extensions: true };`

(c) add these fields after `excluded`:

```ts
  /** The extensions installed on this machine (enabled or not). */
  readonly installed = new Set<string>();
  /** Extension IDs whose install fails, like one that is not in the gallery. */
  readonly failing = new Set<string>();
  /** The on-disk extension list cannot be read. */
  manifestBroken = false;
```

(d) add this dependency to the `new SyncEngine({ … })` object, after `confirmOverwrite`:

```ts
      extensions: {
        installed: async () => (this.manifestBroken ? undefined : [...this.installed].sort()),
        install: async (id) => {
          if (this.failing.has(id)) return false;
          this.installed.add(id);
          return true;
        },
        uninstall: async (id) => this.installed.delete(id),
      },
```

(e) in `enable`, replace the `categories:` line with
`categories: () => CATEGORIES.filter((c) => this.categories[c]),`
and remove the now-unused `Category` cast.

- [ ] **Step 2: Append the failing tests to `src/syncEngine.test.ts`**

```ts
describe('extension list', () => {
  it('an interactive run installs what another device added; a background run only reports it', async () => {
    const { a, b } = await synced({});
    a.installed.add('pub.x');
    a.installed.add('pub.y');
    b.installed.add('pub.y');
    await a.syncNow();
    await b.run();
    assert.deepEqual(b.status.pendingInstalls, ['pub.x']);
    assert.equal(b.status.state, 'needsAttention');
    assert.equal(b.installed.has('pub.x'), false, 'a background run never installs');
    await b.syncNow();
    assert.equal(b.installed.has('pub.x'), true);
    assert.deepEqual(b.status.pendingInstalls, []);
    assert.equal(b.status.state, 'idle');
  });

  it('a removal elsewhere is reported but never applied, and uninstallRemoved applies it without re-uploading it', async () => {
    const { gist, a, b, id } = await synced({});
    a.installed.add('pub.x');
    a.installed.add('pub.y');
    await a.syncNow();
    await b.syncNow();
    a.installed.delete('pub.y');
    await a.syncNow();
    await b.run();
    assert.deepEqual(b.status.pendingRemovals, ['pub.y']);
    assert.equal(b.installed.has('pub.y'), true);

    const before = gist.revisionCount(id);
    await b.run();
    assert.equal(gist.revisionCount(id), before, 'reporting a removal pushes nothing');

    await b.engine.uninstallRemoved('pub.y');
    assert.equal(b.installed.has('pub.y'), false);
    assert.deepEqual(b.status.pendingRemovals, []);
    assert.equal(b.status.state, 'idle');
    await b.run();
    await a.run();
    assert.equal(gist.revisionCount(id), before);
    assert.equal(b.status.state, 'idle');
  });

  it('a failed install is reported and stays pending until it works', async () => {
    const { a, b } = await synced({});
    a.installed.add('pub.ok');
    a.installed.add('pub.bad');
    await a.syncNow();
    b.failing.add('pub.bad');
    await b.syncNow();
    assert.equal(b.installed.has('pub.ok'), true);
    assert.equal(b.status.state, 'error');
    assert.match(b.status.message!, /Could not install pub\.bad/);
    assert.deepEqual(b.status.pendingInstalls, ['pub.bad']);
    b.failing.clear();
    await b.syncNow();
    assert.equal(b.installed.has('pub.bad'), true);
    assert.equal(b.status.state, 'idle');
  });

  it('an unreadable installed list skips the extension sync instead of removing everything', async () => {
    const { gist, a, id } = await synced({});
    a.installed.add('pub.x');
    await a.syncNow();
    const before = gist.revisionCount(id);
    a.manifestBroken = true;
    await a.syncNow();
    assert.equal(a.status.state, 'error');
    assert.match(a.status.message!, /installed extensions/);
    assert.equal(gist.revisionCount(id), before);
  });

  it('a corrupt remote extension list is reported and left alone', async () => {
    const { gist, a, id } = await synced({});
    a.installed.add('pub.x');
    gist.tamper(id, 'extensions.json.enc', '{"v":1,"iv":"AAAA","tag":"AAAA","data":"AAAA"}');
    const before = gist.revisionCount(id);
    await a.syncNow();
    assert.equal(a.status.state, 'error');
    assert.match(a.status.message!, /extensions\.json\.enc/);
    assert.equal(gist.revisionCount(id), before);
  });

  it('is not synced when its category is off', async () => {
    const { gist, a, id } = await synced({});
    a.categories.extensions = false;
    a.installed.add('pub.x');
    const before = gist.revisionCount(id);
    await a.syncNow();
    assert.equal(gist.revisionCount(id), before);
  });
});
```

- [ ] **Step 3: Run `npm test`** — Expected: FAIL at `tsc` (`'extensions' is not assignable…`, `Property 'extensions' does not exist…`, `Property 'uninstallRemoved' does not exist`).

- [ ] **Step 4: Update `types.ts` and `layout.ts`.**

In `src/types.ts`: change `CATEGORIES` to `['settings', 'keybindings', 'snippets', 'extensions'] as const`; add `extensionsBase?: string[];` to `StoredState` (after `base`); add `uninstallRemoved(id: string): Promise<void>;` to `NullSyncApi` (after `resolveConflict`).

In `src/layout.ts`, after `MANIFEST`:

```ts
/** The remote file that holds the encrypted list of installed extension IDs (not a local file). */
export const EXTENSIONS_REMOTE = 'extensions.json.enc';
```

- [ ] **Step 5: Update `src/syncEngine.ts`.**

(a) Imports: add `import { mergeExtensions, parseIds } from './extensionSet';` and add `EXTENSIONS_REMOTE` to the `./layout` import.

(b) After `LocalFilesPort` add:

```ts
/** Reads and changes the installed extensions on this machine; `installed()` is `undefined` if it cannot be read. */
export interface ExtensionHost {
  installed(): Promise<string[] | undefined>;
  /** True only if the extension is installed afterwards. */
  install(id: string): Promise<boolean>;
  /** True only if the extension is gone afterwards. */
  uninstall(id: string): Promise<boolean>;
}
```

and in `EngineDeps` add `extensions?: ExtensionHost;` after `confirmOverwrite`.

(c) Replace the whole `private async sync(...)` method with:

```ts
  private async sync(c: Conn, { interactive, firstSync }: RunOptions): Promise<void> {
    const { d } = this;
    const categories = enabledCategories(d.categories());
    const raws = await d.files.list(categories);
    const names = new Set(Object.keys(raws));
    for (const file of CORE_FILES) {
      if (categories.includes(categoryOf(file))) names.add(file);
    }
    for (const name of Object.keys(c.files)) {
      const file = fileOfRemoteName(name);
      if (file !== undefined && categories.includes(categoryOf(file))) names.add(file);
    }

    const problems: string[] = [];
    const conflicts: Conflict[] = [];
    const pending: string[] = [];
    const base = { ...c.st.base };
    const changes: Record<string, string | null> = {};
    const pushed: Record<string, Base> = {};

    for (const file of [...names].sort()) {
      const i = this.inspect(c, file, raws[file] ?? null);
      if (typeof i === 'string') {
        problems.push(i);
        continue;
      }
      const prior = c.st.base[file];
      let action = planFile(i.lv, i.rv, prior, isDeletable(file));
      if (action === 'conflict' && prior === undefined && firstSync) action = firstSync === 'cloud' ? 'pull' : 'push';

      switch (action) {
        case 'none':
          base[file] = { local: i.lv, remote: i.rv };
          break;
        case 'conflict':
          conflicts.push({ file, category: categoryOf(file) });
          break;
        case 'push':
          if (tooLarge(i.content)) {
            problems.push(`${file} is too large to sync.`);
            break;
          }
          changes[i.name] = i.content === null ? null : seal(c.key, i.name, i.content);
          pushed[file] = { local: i.lv, remote: i.lv };
          break;
        case 'pull': {
          if (d.files.isDirty(file) && !(interactive && d.confirmOverwrite && (await d.confirmOverwrite(file)))) {
            pending.push(file);
            break;
          }
          const applied = await this.applyPull(i);
          if (typeof applied === 'string') problems.push(applied);
          else base[file] = applied.base;
          break;
        }
      }
    }

    let extensionsBase = c.st.extensionsBase;
    let pendingInstalls: string[] = [];
    let pendingRemovals: string[] = [];
    if (categories.includes('extensions') && d.extensions) {
      const merged = await this.syncExtensions(c, d.extensions, interactive, problems);
      if (merged) {
        pendingInstalls = merged.pendingInstalls;
        pendingRemovals = merged.pendingRemovals;
        extensionsBase = merged.nextBase;
        if (merged.push) changes[EXTENSIONS_REMOTE] = seal(c.key, EXTENSIONS_REMOTE, JSON.stringify(merged.push));
      }
    }

    if (Object.keys(changes).length > 0) {
      const updated = await c.store.update(c.st.gistId, changes);
      if (!updated.ok) {
        // Pulls already happened, so remember them; the extension base stays put until the upload works.
        await d.setState({ ...c.st, base });
        this.failed(updated);
        this.set({ conflicts, pending, pendingInstalls, pendingRemovals });
        return;
      }
      Object.assign(base, pushed);
    }

    const lastSyncedAt = d.now();
    await d.setState({ ...c.st, base, extensionsBase, lastSyncedAt });
    const outstanding = conflicts.length + pending.length + pendingInstalls.length + pendingRemovals.length;
    this.set({
      state: problems.length > 0 ? 'error' : outstanding > 0 ? 'needsAttention' : 'idle',
      message: problems.length > 0 ? problems.join(' ') : undefined,
      lastSyncedAt,
      conflicts,
      pending,
      pendingInstalls,
      pendingRemovals,
    });
  }

  /**
   * Merges the installed-extension list with the remote one. Only an interactive run installs; removals are only ever
   * reported. `undefined` (with a message in `problems`) when either list cannot be read, so nothing is changed.
   */
  private async syncExtensions(c: Conn, host: ExtensionHost, interactive: boolean, problems: string[]) {
    let remote: string[] | null = null;
    const encrypted = c.files[EXTENSIONS_REMOTE];
    if (encrypted !== undefined) {
      const plain = open(c.key, EXTENSIONS_REMOTE, encrypted);
      const ids = plain === undefined ? undefined : parseIds(plain);
      if (ids === undefined) {
        problems.push(`Could not read ${EXTENSIONS_REMOTE}; the extension list was left alone.`);
        return undefined;
      }
      remote = ids;
    }
    const installed = await host.installed();
    if (installed === undefined) {
      problems.push('Could not read the installed extensions; the extension list was not synced.');
      return undefined;
    }

    let local = installed;
    let merge = mergeExtensions(local, remote, c.st.extensionsBase);
    if (interactive && merge.install.length > 0) {
      for (const id of merge.install) {
        if (await host.install(id)) local = [...local, id];
        else problems.push(`Could not install ${id}.`);
      }
      merge = mergeExtensions(local, remote, c.st.extensionsBase);
    }
    return { pendingInstalls: merge.install, pendingRemovals: merge.notifyRemoved, push: merge.push, nextBase: merge.nextBase };
  }

  /** Uninstalls an extension that was removed on another device, and stops reporting it. */
  async uninstallRemoved(id: string): Promise<void> {
    await this.tail;
    const host = this.d.extensions;
    const st = this.d.state.get();
    if (!host || !st || !this.status.pendingRemovals.includes(id)) return;
    if (!(await host.uninstall(id))) {
      this.set({ state: 'error', message: `Could not uninstall ${id}.` });
      return;
    }
    await this.d.setState({ ...st, extensionsBase: (st.extensionsBase ?? []).filter((x) => x !== id) });
    this.set({ pendingRemovals: this.status.pendingRemovals.filter((x) => x !== id) });
    this.settle();
  }
```

- [ ] **Step 6: Run `npm test`** — Expected: PASS, `fail 0`, including every Phase 1 test (they now run with an extension host that has nothing installed, so the extension list is `[]` on both devices).

If a Phase 1 test that counts revisions now fails, the cause is that the first upload also writes `extensions.json.enc`; they measure `revisionCount` after `synced(...)`, so none should, but the `restore` test expects 3 revisions (manifest, first upload — which now carries the extension list in the same PATCH — and the edit). Do not change those assertions without understanding why.

- [ ] **Step 7: Commit**

```bash
git add extensions/null-sync/src/types.ts extensions/null-sync/src/layout.ts extensions/null-sync/src/syncEngine.ts extensions/null-sync/src/testDevice.ts extensions/null-sync/src/syncEngine.test.ts
git commit -m "feat(null-sync): sync the extension list (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/src/types.ts extensions/null-sync/src/layout.ts extensions/null-sync/src/syncEngine.ts extensions/null-sync/src/testDevice.ts extensions/null-sync/src/syncEngine.test.ts
```

---

### Task 16: extension host glue, status entries, docs, verification on a real install (ends Phase 2)

**Files:**
- Create: `extensions/null-sync/src/extensionHost.ts`
- Modify: `extensions/null-sync/src/extension.ts`, `extensions/null-sync/src/commands.ts`, `extensions/null-sync/src/manifest.test.ts`, `extensions/null-sync/package.json`, `CLAUDE.md`, `docs/specs/null-sync-design.md`
- Commit: `extensions/null-sync/out/`

**Interfaces:**
- Consumes: `installedIds` (Task 14), `ExtensionHost` (Task 15).
- Produces: `extensionHost: ExtensionHost` (the only code that touches `extensions.json` and the `workbench.extensions.*` commands).

- [ ] **Step 1: Write `src/extensionHost.ts`**

```ts
'use strict';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { installedIds } from './extensionSet';
import { ExtensionHost } from './syncEngine';

/**
 * `~/<dataFolderName>/extensions/extensions.json` lists every installed user extension, disabled ones included
 * (`vscode.extensions.all` lists enabled ones only). `dataFolderName` is `Null` in this product's product.json.
 */
function manifestPath(): string | undefined {
  try {
    const product = JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8')) as { dataFolderName?: string };
    return product.dataFolderName ? path.join(os.homedir(), product.dataFolderName, 'extensions', 'extensions.json') : undefined;
  } catch {
    return undefined;
  }
}

async function installed(): Promise<string[] | undefined> {
  const file = manifestPath();
  if (!file) return undefined;
  try {
    return installedIds(await fs.promises.readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** The commands can resolve without an error even when nothing happened, so the result is checked against the manifest. */
export const extensionHost: ExtensionHost = {
  installed,

  async install(id) {
    try {
      await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
    } catch {
      return false;
    }
    return ((await installed()) ?? []).includes(id.toLowerCase());
  },

  async uninstall(id) {
    try {
      await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', id);
    } catch {
      return false;
    }
    return !((await installed()) ?? [id.toLowerCase()]).includes(id.toLowerCase());
  },
};
```

- [ ] **Step 2: Wire it into `src/extension.ts`.** Add `import { extensionHost } from './extensionHost';`, add `extensions: extensionHost,` to the `new SyncEngine({ … })` object (after `confirmOverwrite`), and add to the returned API object:
`uninstallRemoved: (id) => engine.uninstallRemoved(id),`

- [ ] **Step 3: Show the pending items in `Null: Show Sync Status`.** In `src/commands.ts`, in the `showStatus` handler, after the `for (const file of s.pending)` loop and before the `items.push(` of the three fixed entries, add:

```ts
      if (s.pendingInstalls.length > 0) {
        items.push({
          label: `$(cloud-download) Install ${s.pendingInstalls.length} extension(s) added on other devices`,
          description: s.pendingInstalls.join(', '),
          run: () => vscode.commands.executeCommand('null.sync.syncNow'),
        });
      }
      for (const id of s.pendingRemovals) {
        items.push({
          label: `$(trash) Uninstall ${id}`,
          description: 'removed on another device',
          run: () => engine.uninstallRemoved(id),
        });
      }
```

- [ ] **Step 4: Manifest.** In `package.json` add `"extensions": { "type": "boolean" }` to the `null-sync.categories` `properties` and `"extensions": true` to its `default`; add `out/extensionSet.test.js` to the `test` script if Task 14 did not already (it did). In `src/manifest.test.ts` the test `syncs every category by default` already compares the default's keys to `CATEGORIES`, so it now requires `extensions` — no test change is needed beyond the manifest.

- [ ] **Step 5: Run `npm test`** — Expected: PASS, `fail 0`.

- [ ] **Step 6: Docs.**

(a) `CLAUDE.md`, in the `### null-sync` section: replace "snippets (the installed-extension list follows in a second phase)" with "snippets and the installed-extension list"; change "Only `prompts.ts`, `commands.ts` and `extension.ts` import `vscode`" to "Only `prompts.ts`, `commands.ts`, `extensionHost.ts` and `extension.ts` import `vscode`"; change "(`getStatus`, `onDidChangeStatus`, `syncNow`, `resolveConflict`)" to "(`getStatus`, `onDidChangeStatus`, `syncNow`, `resolveConflict`, `uninstallRemoved`)"; and insert this sentence before "Background runs": "`extensionSet` merges the installed-extension IDs by set arithmetic (never a conflict); `extensionHost.ts` reads them from `~/<dataFolderName>/extensions/extensions.json` so disabled extensions count, and an unreadable file skips the extension sync instead of reading as 'all uninstalled'. Only interactive runs install; removals are only reported (`pendingRemovals`) until `uninstallRemoved(id)`."

(b) `docs/specs/null-sync-design.md`: in the Synced data table, in the `extensions` row, delete "(…`vscode.extensions.all` lists enabled extensions only, so it is a fallback only if that path cannot be derived)" and replace it with "(`vscode.extensions.all` lists enabled extensions only, so it is not used; if the manifest cannot be read the extension sync is skipped with a message)". In "To verify in the plan" item 2, delete "the on-disk extensions manifest path can be derived (Phase 2)" and add under it: "Verified 2026-10-13 on a real install: `%USERPROFILE%\\Null\\extensions\\extensions.json` exists (`dataFolderName` is `Null`), lists user extensions with `identifier.id` and `metadata.isBuiltin`, and `%APPDATA%\\Null\\User` holds `settings.json`, `snippets/` and `globalStorage/` (this machine has no `keybindings.json`)."

- [ ] **Step 7: Verify on a real install (needs the user).** This signs in to GitHub, creates a real secret Gist and installs/uninstalls extensions, so do not run it unattended; ask the user to do it with you, or report it as not done.

1. `scripts\sync-local.ps1`, then `scripts\reload-local.ps1`.
2. `Null: Enable Settings Sync`: pick the GitHub account, accept the consent, choose a passphrase. Open the new Gist on gist.github.com: it must contain only `manifest.json` and `*.enc` files, and each `.enc` file must be an opaque JSON envelope.
3. `Null: Show Sync Status` shows "Up to date".
4. From a second user-data folder (`null --user-data-dir <temp> --extensions-dir <temp>`) sign in to the same GitHub account in Null Accounts and run Enable with the same passphrase; choose "Use the synced settings". Check that `settings.json`, `keybindings.json`, snippets and the extension list arrive (the interactive first run installs the missing extensions), and that a path setting such as `git.path` stayed local.
5. Edit a setting on one side; after at most 10 minutes (or `Null: Sync Settings Now` on the other) it arrives. Edit the same file on both sides to get a conflict and resolve it from `Null: Resolve Sync Conflicts`, including *Show diff*.
6. Install an extension on one side, uninstall another; confirm the other side shows both in `Null: Show Sync Status` and only installs on `Null: Sync Settings Now`.
7. `Null: Restore Synced Settings…` rolls both sides back; `Null: Stop Settings Sync` (delete the copy) leaves local files untouched.
8. Open `%APPDATA%\Null\User\settings.json` after a pull that changed it and confirm the comments, indentation and this device's `git.path`-style values survived (the spec's open question about `jsonc-parser` on a real file).
9. Open two windows of the same install, edit a synced file, and run `Null: Sync Settings Now` in both. The Gist must gain one revision, and neither window may report a conflict with itself. If a window sees stale state, `globalState` is not shared between windows as assumed; move `StoredState` into a JSON file under `globalStorage/null-sync/` (the cross-window lock already serialises runs) and add a test for it before finishing.

- [ ] **Step 8: Commit the glue and docs**

```bash
git add extensions/null-sync/package.json extensions/null-sync/src/extensionHost.ts extensions/null-sync/src/extension.ts extensions/null-sync/src/commands.ts extensions/null-sync/src/manifest.test.ts CLAUDE.md docs/specs/null-sync-design.md
git commit -m "feat(null-sync): install and uninstall synced extensions, show pending items (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/package.json extensions/null-sync/src/extensionHost.ts extensions/null-sync/src/extension.ts extensions/null-sync/src/commands.ts extensions/null-sync/src/manifest.test.ts CLAUDE.md docs/specs/null-sync-design.md
```

- [ ] **Step 9: Refresh and commit the compiled output**

Run: `cd extensions/null-sync && npm run compile`

```bash
git add extensions/null-sync/out
git commit -m "chore: refresh null-sync compiled output (#23)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- extensions/null-sync/out
```

- [ ] **Step 10: Final check.** Run `npm test` in `extensions/null-sync` once more and `git status --short`; the only remaining changes must be the user's pre-existing unrelated ones. Report the commit hashes, which tests ran, and whether the integration specs (Task 13) and the real-install checklist (Step 7) were run or not.

Then: #23 is done when Phase 2 lands. Offer to file a follow-up issue for the Null workspace Sync screen (it builds on `NullSyncApi` and the `null.sync.*` commands; the `file-issue` skill does this) and to comment on #23 with the two phase summaries. Do not post or close anything on GitHub without being asked.

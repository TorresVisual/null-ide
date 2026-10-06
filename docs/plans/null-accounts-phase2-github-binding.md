# Null Accounts — Phase 2: GitHub + Binding Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Make `null-accounts` useful end to end for GitHub: a GitHub provider (add account, issue tokens), per-folder project binding with an origin-based suggestion, a minimal pick/add quick-pick, a first-run import of the session VS Code already holds, and the Issues panel in `null-tools` switched from the raw built-in session to the bound account.

**Architecture:** Same split as Phase 1 — pure, node-testable modules that take their VS Code surface as injected interfaces (`GithubDeps`, `MetadataStore`), with `extension.ts` and `ui/accountPicker.ts` as the only runtime `vscode` users. `projectBinding` (folder → account id in `globalState`), `suggest` (origin URL → account) and `providers/github` (wraps `vscode.authentication`) are new units; `ProjectBinding` replaces the Phase 1 `accountIdForFolder: () => undefined` stub and `GithubProvider` fills the `tokenProviders.github` seam. `null-tools/src/github/githubAuth.ts` shrinks to a thin call into the exported API.

**Tech Stack:** TypeScript (strict), VS Code Extension API `^1.85.0` (`authentication.getSession` with `account` / `forceNewSession` / `silent`), Node global `fetch`, `node --test` + `node:assert`.

**Spec:** `docs/specs/null-accounts-design.md` (issue #102). This is plan 2 of 6: (1) Foundation — `docs/plans/null-accounts-phase1-foundation.md`, landed; (2) GitHub + binding ← this plan; (3) UI; (4) GitLab; (5) Git wiring; (6) Integration.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- All Phase 1 constraints still hold: every `.ts` file starts with `'use strict';`; unit-tested modules do not import `vscode` at runtime (`import type` is fine); secrets only in `SecretStorage` under `null-accounts/<id>` and never logged; edit TypeScript sources only, never `out/`; commit after each task, do not push.
- `Account.host` is a bare lowercase hostname with optional port. GitHub accounts always use `github.com` (GitHub Enterprise is out of scope — the built-in `github` provider does not serve it).
- `NullAccountsApi.getToken` never throws for auth failure — it resolves `undefined`. So does the new `ensureAccountForFolder`.
- Background / silent callers must never surface UI: `getToken` is non-interactive unless `options.interactive === true`. (Plan decision: the spec's `getToken(account, scopes?)` has no way to say "don't prompt", but `issuesStore.ensureSession(false)` is a silent background read and `ensureSession(true)` a user-initiated write. The third parameter is additive; existing two-argument calls keep working.)
- GitHub OAuth tokens stay owned by VS Code's built-in provider and are re-requested on demand; they are **not** copied into `SecretStorage` (Phase 5 gets the token via `getToken` when it needs it for `git credential approve`).
- `Account.externalId` is the provider-side account id. For GitHub it is `AuthenticationSession.account.id` exactly as VS Code reports it (not the numeric id from `GET /user`), so the identity check in `getToken` is self-consistent whatever format VS Code uses.
- GitHub scopes: `GITHUB_SCOPES = ['repo', 'user:email']` — `repo` is what the Issues panel needs, `user:email` lets us read the primary email. Callers' extra scopes are unioned with these so one sign-in satisfies every request (separate scope sets create separate sessions on the built-in provider).
- `null-tools` and `null-accounts` are built separately in CI and cannot share TypeScript types; `null-tools` declares its own structural copy of the slice of the API it uses.
- Not in this phase: the accounts webview, status bar item, edit/remove UI (Phase 3); GitLab (Phase 4); anything that writes git config (Phase 5); the "needs re-auth" flag and notification (Phase 4 — with the built-in GitHub provider VS Code owns session expiry and shows its own sign-in prompts, so the flag only becomes meaningful once we refresh GitLab tokens ourselves).

## Review Focus

The spec says what the provider and binding must do, not everything they will meet. These are the inputs most likely to bite someone using this phase, most likely first; each has a test in the owning task.

1. **Sign-in completes as a different GitHub account than the one asked for** (the browser is logged into someone else, or the user picks another account) → `getToken` resolves `undefined` rather than returning a token for the wrong identity. (Task 4)
2. **The same GitHub account added again** (browser still signed into an account that's already stored) → the existing account is reused and bound, no "already added" error, no duplicate. (Task 5)
3. **The same folder written differently** (`C:\Repo\` vs `c:/repo`, drive-letter case) → one binding, found either way. (Task 2)
4. **A user whose email is private, or whose `/user/emails` call fails** → account is still created, with the primary verified email, else the profile email, else the `users.noreply.github.com` address; never an empty or invalid email. (Task 4)
5. **A folder bound to a non-GitHub account, or to an account that was deleted** → GitHub consumers get `undefined` (never someone else's token), and bindings to deleted accounts are pruned. (Tasks 2 and 6)

---

### Task 1: Phase 1 amendments — `externalId`, shared emitter and fakes, API seams

The new units need four small changes to Phase 1 code. They are done first, together, because they all touch the same two interfaces (`Account`, `NullAccountsApi`) and must leave the build green.

**Files:**
- Modify: `extensions/null-accounts/src/types.ts`
- Modify: `extensions/null-accounts/src/accountInput.ts`, `accountInput.test.ts`
- Create: `extensions/null-accounts/src/changeEmitter.ts`
- Create: `extensions/null-accounts/src/testFakes.ts`
- Modify: `extensions/null-accounts/src/accountStore.ts`, `accountStore.test.ts`
- Modify: `extensions/null-accounts/src/api.ts`, `api.test.ts`
- Modify: `extensions/null-accounts/src/extension.ts`

**Interfaces:**
- Consumes: Phase 1 `Account`, `NewAccount`, `AccountStore`, `MetadataStore`, `SecretVault`, `createApi`.
- Produces:
  - `Account.externalId?: string` (and therefore `NewAccount.externalId?`).
  - `changeEmitter.ts`: `class ChangeEmitter { readonly event: vscode.Event<void>; fire(): void }` — moved out of `accountStore.ts`, behaviour unchanged.
  - `testFakes.ts`: `class FakeMeta implements MetadataStore { data: Map<string, unknown> }`, `class FakeVault implements SecretVault { data: Map<string, string> }`.
  - `api.ts`: `interface TokenOptions { interactive?: boolean }`; `TokenProvider.getToken(account, scopes?, options?: TokenOptions)`; `NullAccountsApi.getToken(account, scopes?, options?)`; `NullAccountsApi.ensureAccountForFolder(folder: vscode.Uri): Promise<Account | undefined>`; `ApiDeps` becomes `{ accounts: { list(); get(id) }; accountIdForFolder(folder); chooseAccountForFolder(folder: vscode.Uri): Promise<Account | undefined>; tokenProviders; onDidChange: vscode.Event<void> }` (the event moves out of `accounts` so the API can merge account and binding changes).

- [ ] **Step 1: Add `externalId` to the type**

In `types.ts`, add to `Account` directly after `sshKeyPath`:

```ts
  /** Provider-side account id (GitHub: the session's `account.id`); used to pick the matching session. */
  externalId?: string;
```

- [ ] **Step 2: Write the failing tests for `externalId`**

Append to `accountInput.test.ts`:

```ts
test('validateNewAccount keeps a trimmed externalId and drops a blank one', () => {
  assert.strictEqual(validateNewAccount({ ...base, externalId: ' 583231 ' }).externalId, '583231');
  assert.strictEqual('externalId' in validateNewAccount({ ...base, externalId: '  ' }), false);
});
```

Append to `accountStore.test.ts`:

```ts
test('list skips an entry whose externalId is not a string', async () => {
  const { store, meta } = makeStore();
  const good = { id: 'g', provider: 'github', host: 'github.com', username: 'u', email: 'u@e.com', authMethod: 'oauth', externalId: '42' };
  meta.data.set(ACCOUNTS_KEY, [good, { ...good, id: 'bad', externalId: 42 }]);
  assert.deepStrictEqual(store.list(), [good]);
});
```

- [ ] **Step 3: Extract the shared test fakes**

Create `extensions/null-accounts/src/testFakes.ts`:

```ts
'use strict';

import { MetadataStore, SecretVault } from './accountStore';

/** In-memory stand-in for vscode.Memento, shared by the unit tests. */
export class FakeMeta implements MetadataStore {
  data = new Map<string, unknown>();
  get<T>(key: string): T | undefined { return this.data.get(key) as T | undefined; }
  async update(key: string, value: unknown): Promise<void> { this.data.set(key, structuredClone(value)); }
}

/** In-memory stand-in for vscode.SecretStorage, shared by the unit tests. */
export class FakeVault implements SecretVault {
  data = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.data.get(key); }
  async store(key: string, value: string): Promise<void> { this.data.set(key, value); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}
```

In `accountStore.test.ts`: delete the local `class FakeMeta` and `class FakeVault` blocks, change the first import to `import { ACCOUNTS_KEY, AccountStore } from './accountStore';`, and add `import { FakeMeta, FakeVault } from './testFakes';`.

- [ ] **Step 4: Rewrite `api.test.ts` for the new API surface**

Replace `extensions/null-accounts/src/api.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import type * as vscode from 'vscode';
import { ApiDeps, createApi, TokenOptions, TokenProvider } from './api';
import { Account } from './types';

const gh: Account = { id: 'a1', provider: 'github', host: 'github.com', username: 'octocat', email: 'o@e.com', authMethod: 'oauth' };
const gl: Account = { id: 'a2', provider: 'gitlab', host: 'gitlab.com', username: 'tanuki', email: 't@e.com', authMethod: 'oauth' };
const folder = { fsPath: 'C:\\repo' } as vscode.Uri;
const noopEvent: vscode.Event<void> = () => ({ dispose() {} });

function makeDeps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  const all = [gh, gl];
  return {
    accounts: { list: () => all, get: id => all.find(a => a.id === id) },
    accountIdForFolder: () => undefined,
    chooseAccountForFolder: async () => undefined,
    tokenProviders: {},
    onDidChange: noopEvent,
    ...overrides,
  };
}

test('getAccounts returns the stored accounts', () => {
  assert.deepStrictEqual(createApi(makeDeps()).getAccounts(), [gh, gl]);
});

test('getAccountForFolder resolves the bound account, and undefined when unbound or dangling', () => {
  assert.strictEqual(createApi(makeDeps({ accountIdForFolder: () => 'a2' })).getAccountForFolder(folder), gl);
  assert.strictEqual(createApi(makeDeps()).getAccountForFolder(folder), undefined);
  // A binding that points at an account that has since been removed.
  assert.strictEqual(createApi(makeDeps({ accountIdForFolder: () => 'gone' })).getAccountForFolder(folder), undefined);
});

test('ensureAccountForFolder returns the bound account without prompting', async () => {
  let prompted = 0;
  const api = createApi(makeDeps({ accountIdForFolder: () => 'a1', chooseAccountForFolder: async () => { prompted++; return gl; } }));
  assert.strictEqual(await api.ensureAccountForFolder(folder), gh);
  assert.strictEqual(prompted, 0);
});

test('ensureAccountForFolder prompts when unbound or dangling, and resolves undefined if the prompt fails', async () => {
  const picks = createApi(makeDeps({ chooseAccountForFolder: async () => gl }));
  assert.strictEqual(await picks.ensureAccountForFolder(folder), gl);

  const dangling = createApi(makeDeps({ accountIdForFolder: () => 'gone', chooseAccountForFolder: async () => gh }));
  assert.strictEqual(await dangling.ensureAccountForFolder(folder), gh);

  const broken = createApi(makeDeps({ chooseAccountForFolder: async () => { throw new Error('boom'); } }));
  assert.strictEqual(await broken.ensureAccountForFolder(folder), undefined);
});

test('getToken dispatches to the provider for the account and passes scopes and options through', async () => {
  const calls: Array<[string, string[] | undefined, TokenOptions | undefined]> = [];
  const github: TokenProvider = { getToken: async (a, scopes, options) => { calls.push([a.id, scopes, options]); return 'tok-gh'; } };
  const api = createApi(makeDeps({ tokenProviders: { github } }));
  assert.strictEqual(await api.getToken(gh, ['repo'], { interactive: true }), 'tok-gh');
  assert.deepStrictEqual(calls, [['a1', ['repo'], { interactive: true }]]);
});

test('getToken resolves undefined when no provider is registered for the account', async () => {
  const api = createApi(makeDeps({ tokenProviders: { github: { getToken: async () => 'x' } } }));
  assert.strictEqual(await api.getToken(gl), undefined);
});

test('getToken resolves undefined, never rejects, when the provider throws', async () => {
  const api = createApi(makeDeps({ tokenProviders: { github: { getToken: async () => { throw new Error('offline'); } } } }));
  assert.strictEqual(await api.getToken(gh), undefined);
});

test('onDidChange is the supplied event, not a wrapper', () => {
  assert.strictEqual(createApi(makeDeps()).onDidChange, noopEvent);
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd extensions/null-accounts && npm test`
Expected: FAIL at the `tsc` step — `TS2353`/`TS2339` about `externalId` on `NewAccount`, `TokenOptions` not exported from `./api`, `chooseAccountForFolder` not in `ApiDeps`.

- [ ] **Step 6: Implement — validation and store**

In `accountInput.ts`, directly before `return out;` in `validateNewAccount` add:

```ts
  const externalId = input.externalId?.trim();
  if (externalId) {
    out.externalId = externalId;
  }
```

In `accountStore.ts`: delete the `ChangeEmitter` class, add `import { ChangeEmitter } from './changeEmitter';`, remove the `import type { Event } from 'vscode';` line if nothing else in the file uses `Event`, and add to `isAccount` before the final `;`:

```ts
    && (a.externalId === undefined || typeof a.externalId === 'string')
```

Create `extensions/null-accounts/src/changeEmitter.ts`:

```ts
'use strict';

import type { Event } from 'vscode';

export class ChangeEmitter {
  private readonly listeners = new Set<(e: void) => unknown>();

  readonly event: Event<void> = listener => {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  };

  fire(): void {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* one bad listener must not break the others or the write that fired it */ }
    }
  }
}
```

- [ ] **Step 7: Implement — the API**

Replace `extensions/null-accounts/src/api.ts`:

```ts
'use strict';

import type * as vscode from 'vscode';
import { Account, Provider } from './types';

export interface TokenOptions {
  /** Allow a sign-in / re-auth prompt. Default false: background callers must never surface UI. */
  interactive?: boolean;
}

/** Public surface other Null IDE extensions consume via `extensions.getExtension('null.null-accounts')?.exports`. */
export interface NullAccountsApi {
  getAccounts(): Account[];
  getAccountForFolder(folder: vscode.Uri): Account | undefined;
  /**
   * The folder's bound account; if it has none, asks the user to pick or add one and binds it.
   * `undefined` if they cancel. Never throws.
   */
  ensureAccountForFolder(folder: vscode.Uri): Promise<Account | undefined>;
  /**
   * Resolves a token for the account, refreshing if needed. `undefined` if no token is available
   * or (with `interactive`) the user cancels re-auth. Never throws for auth failure.
   */
  getToken(account: Account, scopes?: string[], options?: TokenOptions): Promise<string | undefined>;
  onDidChange: vscode.Event<void>;
}

/** One per provider (providers/github.ts, providers/gitlab.ts). May throw; the API turns that into `undefined`. */
export interface TokenProvider {
  getToken(account: Account, scopes?: string[], options?: TokenOptions): Promise<string | undefined>;
}

export interface ApiDeps {
  accounts: {
    list(): Account[];
    get(id: string): Account | undefined;
  };
  /** Folder -> bound account id (projectBinding). */
  accountIdForFolder(folder: vscode.Uri): string | undefined;
  /** Quick-pick an account for the folder and bind it (ui/accountPicker). */
  chooseAccountForFolder(folder: vscode.Uri): Promise<Account | undefined>;
  /** Filled in per provider as they land (github: Phase 2, gitlab: Phase 4). */
  tokenProviders: Partial<Record<Provider, TokenProvider>>;
  /** Fires when accounts or bindings change. */
  onDidChange: vscode.Event<void>;
}

export function createApi(deps: ApiDeps): NullAccountsApi {
  const getAccountForFolder = (folder: vscode.Uri): Account | undefined => {
    const id = deps.accountIdForFolder(folder);
    return id === undefined ? undefined : deps.accounts.get(id);
  };
  return {
    getAccounts: () => deps.accounts.list(),
    getAccountForFolder,
    async ensureAccountForFolder(folder) {
      const bound = getAccountForFolder(folder);
      if (bound) { return bound; }
      try {
        return await deps.chooseAccountForFolder(folder);
      } catch {
        return undefined;
      }
    },
    async getToken(account, scopes, options) {
      try {
        return await deps.tokenProviders[account.provider]?.getToken(account, scopes, options);
      } catch {
        return undefined;
      }
    },
    onDidChange: deps.onDidChange,
  };
}
```

In `extension.ts`, replace the `createApi({ ... })` argument so the build stays green until Task 5 rewires it:

```ts
  return createApi({
    accounts: store,
    accountIdForFolder: () => undefined,
    chooseAccountForFolder: async () => undefined,
    tokenProviders: {},
    onDidChange: store.onDidChange,
  });
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd extensions/null-accounts && npm test`
Expected: PASS, `# fail 0` (Phase 1's tests plus 2 new for `externalId`, and `api.test` now has 8 tests).

- [ ] **Step 9: Commit**

```bash
git add extensions/null-accounts/src
git commit -m "refactor: extract null-accounts emitter and fakes, add externalId and interactive-token API seams"
```

---

### Task 2: `projectBinding.ts` — folder → account map

**Files:**
- Create: `extensions/null-accounts/src/projectBinding.ts`
- Create: `extensions/null-accounts/src/projectBinding.test.ts`
- Modify: `extensions/null-accounts/package.json` (`scripts.test`)

**Interfaces:**
- Consumes: `MetadataStore` from `./accountStore`; `ChangeEmitter` from `./changeEmitter`; `FakeMeta` from `./testFakes` (tests only).
- Produces (from `projectBinding.ts`):
  - `const BINDINGS_KEY = 'null-accounts.bindings'`
  - `folderKey(fsPath: string, platform?: NodeJS.Platform): string`
  - `class ProjectBinding` — `constructor(meta: MetadataStore, platform?: NodeJS.Platform)`; `readonly onDidChange: vscode.Event<void>`; `accountIdFor(folderPath: string): string | undefined`; `bind(folderPath: string, accountId: string): Promise<void>`; `unbind(folderPath: string): Promise<void>`; `prune(validIds: ReadonlySet<string>): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`extensions/null-accounts/src/projectBinding.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { BINDINGS_KEY, folderKey, ProjectBinding } from './projectBinding';
import { FakeMeta } from './testFakes';

function makeBinding() {
  const meta = new FakeMeta();
  return { meta, binding: new ProjectBinding(meta, 'win32') };
}

test('folderKey folds case, slashes and trailing separators on Windows', () => {
  assert.strictEqual(folderKey('C:\\Repo\\', 'win32'), 'c:/repo');
  assert.strictEqual(folderKey('c:/repo', 'win32'), 'c:/repo');
  assert.strictEqual(folderKey('C:\\Users\\Me\\My Project', 'win32'), 'c:/users/me/my project');
});

test('folderKey keeps case elsewhere and drops a trailing slash', () => {
  assert.strictEqual(folderKey('/home/Me/Repo/', 'linux'), '/home/Me/Repo');
  assert.notStrictEqual(folderKey('/home/me/repo', 'linux'), folderKey('/home/Me/Repo', 'linux'));
});

test('a binding is found however the folder path is written', async () => {
  const { binding } = makeBinding();
  await binding.bind('C:\\Repo', 'a1');
  assert.strictEqual(binding.accountIdFor('c:/repo/'), 'a1');
  assert.strictEqual(binding.accountIdFor('C:\\Other'), undefined);
});

test('rebind replaces, unbind removes, and only real changes fire an event', async () => {
  const { binding } = makeBinding();
  let fired = 0;
  binding.onDidChange(() => fired++);

  await binding.bind('C:\\Repo', 'a1');
  await binding.bind('c:/repo', 'a1'); // same folder, same account: no change
  assert.strictEqual(fired, 1);

  await binding.bind('C:\\Repo', 'a2');
  assert.strictEqual(binding.accountIdFor('C:\\Repo'), 'a2');
  assert.strictEqual(fired, 2);

  await binding.unbind('C:\\Repo');
  assert.strictEqual(binding.accountIdFor('C:\\Repo'), undefined);
  assert.strictEqual(fired, 3);

  await binding.unbind('C:\\Repo'); // already gone
  assert.strictEqual(fired, 3);
});

test('prune drops bindings to accounts that no longer exist', async () => {
  const { binding } = makeBinding();
  await binding.bind('C:\\a', 'a1');
  await binding.bind('C:\\b', 'a2');
  let fired = 0;
  binding.onDidChange(() => fired++);

  await binding.prune(new Set(['a1', 'a2']));
  assert.strictEqual(fired, 0);

  await binding.prune(new Set(['a1']));
  assert.strictEqual(binding.accountIdFor('C:\\a'), 'a1');
  assert.strictEqual(binding.accountIdFor('C:\\b'), undefined);
  assert.strictEqual(fired, 1);
});

test('corrupt stored data reads as no bindings and is overwritten by the next bind', async () => {
  const { binding, meta } = makeBinding();
  meta.data.set(BINDINGS_KEY, 'garbage');
  assert.strictEqual(binding.accountIdFor('C:\\a'), undefined);

  meta.data.set(BINDINGS_KEY, { 'c:/bad': 5, 'c:/ok': 'a1' });
  assert.strictEqual(binding.accountIdFor('C:\\ok'), 'a1');
  assert.strictEqual(binding.accountIdFor('C:\\bad'), undefined);

  meta.data.set(BINDINGS_KEY, ['not', 'a', 'map']);
  await binding.bind('C:\\a', 'a1');
  assert.strictEqual(binding.accountIdFor('C:\\a'), 'a1');
});
```

- [ ] **Step 2: Extend the test script**

In `extensions/null-accounts/package.json`, set `scripts.test` to:

```json
"test": "tsc -p tsconfig.json && node --test out/accountInput.test.js out/accountStore.test.js out/api.test.js out/projectBinding.test.js"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd extensions/null-accounts && npm test`
Expected: FAIL at the `tsc` step with `TS2307: Cannot find module './projectBinding'`.

- [ ] **Step 4: Write the implementation**

`extensions/null-accounts/src/projectBinding.ts`:

```ts
'use strict';

import path from 'node:path';
import { MetadataStore } from './accountStore';
import { ChangeEmitter } from './changeEmitter';

export const BINDINGS_KEY = 'null-accounts.bindings';

/** Stable key for a folder: absolute, forward slashes, no trailing separator; case-folded on Windows (case-insensitive filesystem). */
export function folderKey(fsPath: string, platform: NodeJS.Platform = process.platform): string {
  const win = platform === 'win32';
  const resolved = (win ? path.win32 : path.posix).resolve(fsPath).replace(/\\/g, '/');
  return win ? resolved.toLowerCase() : resolved;
}

/**
 * folder key -> account id, in `globalState` so the dashboard can read bindings for projects that
 * aren't open. Every write reads and updates with no `await` in between, so overlapping calls
 * can't lose each other's changes.
 */
export class ProjectBinding {
  private readonly emitter = new ChangeEmitter();
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly meta: MetadataStore,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  accountIdFor(folderPath: string): string | undefined {
    return this.read()[folderKey(folderPath, this.platform)];
  }

  async bind(folderPath: string, accountId: string): Promise<void> {
    const key = folderKey(folderPath, this.platform);
    const bindings = this.read();
    if (bindings[key] === accountId) { return; }
    await this.write({ ...bindings, [key]: accountId });
  }

  async unbind(folderPath: string): Promise<void> {
    const key = folderKey(folderPath, this.platform);
    const { [key]: removed, ...rest } = this.read();
    if (removed === undefined) { return; }
    await this.write(rest);
  }

  /** Drops bindings whose account no longer exists. */
  async prune(validIds: ReadonlySet<string>): Promise<void> {
    const entries = Object.entries(this.read());
    const kept = entries.filter(([, id]) => validIds.has(id));
    if (kept.length === entries.length) { return; }
    await this.write(Object.fromEntries(kept));
  }

  private read(): Record<string, string> {
    const raw = this.meta.get<unknown>(BINDINGS_KEY);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { return {}; }
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'));
  }

  private async write(bindings: Record<string, string>): Promise<void> {
    await this.meta.update(BINDINGS_KEY, bindings);
    this.emitter.fire();
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd extensions/null-accounts && npm test`
Expected: PASS, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-accounts/src/projectBinding.ts extensions/null-accounts/src/projectBinding.test.ts extensions/null-accounts/package.json
git commit -m "feat: add null-accounts project binding with path normalisation and pruning"
```

---

### Task 3: `suggest.ts` and `git.ts` — suggest an account from `origin`

**Files:**
- Create: `extensions/null-accounts/src/suggest.ts`, `suggest.test.ts`
- Create: `extensions/null-accounts/src/git.ts`, `git.test.ts`
- Modify: `extensions/null-accounts/package.json` (`scripts.test`)

**Interfaces:**
- Consumes: `Account` from `./types`.
- Produces:
  - `suggest.ts`: `interface RemoteRef { host: string; owner: string; user?: string }`; `parseRemoteUrl(raw: string): RemoteRef | undefined`; `suggestAccount(originUrl: string, accounts: readonly Account[]): Account | undefined`.
  - `git.ts`: `originUrl(cwd: string): Promise<string | undefined>` — the `origin` remote URL, `undefined` for a non-repo, no `origin`, or no `git`.

Matching rule (plan decision — the spec says "the account whose provider/host/username matches", which fails for org-owned repos where the owner is not a username): host must match; then prefer an embedded https login, then an account whose username equals the repo owner, then — only if exactly one account is on that host — that account. The result is only a suggestion that the user confirms in the quick-pick. An ssh remote's port is the ssh port, not the https port that `Account.host` carries, so it is dropped.

- [ ] **Step 1: Write the failing tests**

`extensions/null-accounts/src/suggest.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { parseRemoteUrl, suggestAccount } from './suggest';
import { Account } from './types';

const gh = (username: string): Account =>
  ({ id: username, provider: 'github', host: 'github.com', username, email: `${username}@e.com`, authMethod: 'oauth' });
const gl: Account = { id: 'tanuki', provider: 'gitlab', host: 'gitlab.example.org', username: 'tanuki', email: 't@e.com', authMethod: 'oauth' };
const glPort: Account = { ...gl, id: 'tanuki8443', host: 'gitlab.example.org:8443' };

test('parseRemoteUrl reads https, ssh:// and scp-style remotes', () => {
  assert.deepStrictEqual(parseRemoteUrl('https://github.com/octocat/hello.git'), { host: 'github.com', owner: 'octocat' });
  assert.deepStrictEqual(parseRemoteUrl('git@github.com:octocat/hello.git'), { host: 'github.com', owner: 'octocat' });
  assert.deepStrictEqual(parseRemoteUrl('ssh://git@gitlab.example.org:2222/team/app.git'), { host: 'gitlab.example.org', owner: 'team' });
  assert.deepStrictEqual(parseRemoteUrl('https://GitLab.Example.org:8443/team/app'), { host: 'gitlab.example.org:8443', owner: 'team' });
});

test('parseRemoteUrl keeps an https login but never a password', () => {
  assert.deepStrictEqual(parseRemoteUrl('https://hubot:s3cret@github.com/acme/app.git'), { host: 'github.com', owner: 'acme', user: 'hubot' });
});

test('parseRemoteUrl returns undefined for local paths, http and junk', () => {
  for (const bad of ['C:\\repos\\app', 'C:/repos/app', '/srv/git/app.git', 'http://github.com/a/b', '', 'not a url']) {
    assert.strictEqual(parseRemoteUrl(bad), undefined, `expected "${bad}" to be rejected`);
  }
});

test('suggestAccount prefers the embedded login, then the owner', () => {
  const accounts = [gh('octocat'), gh('hubot'), gl];
  assert.strictEqual(suggestAccount('git@github.com:HuBot/app.git', accounts)?.id, 'hubot');
  assert.strictEqual(suggestAccount('https://octocat@github.com/hubot/app.git', accounts)?.id, 'octocat');
});

test('suggestAccount falls back to the only account on the host, but not when that is ambiguous', () => {
  assert.strictEqual(suggestAccount('git@gitlab.example.org:team/app.git', [gh('octocat'), gl])?.id, 'tanuki');
  assert.strictEqual(suggestAccount('git@github.com:acme/app.git', [gh('octocat'), gh('hubot')]), undefined);
});

test('suggestAccount needs the host (including an https port) to match', () => {
  assert.strictEqual(suggestAccount('https://gitlab.example.org:8443/team/app', [glPort])?.id, 'tanuki8443');
  assert.strictEqual(suggestAccount('https://gitlab.example.org/team/app', [glPort]), undefined);
  assert.strictEqual(suggestAccount('git@bitbucket.org:team/app.git', [gh('octocat')]), undefined);
  assert.strictEqual(suggestAccount('not a url', [gh('octocat')]), undefined);
});
```

`extensions/null-accounts/src/git.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { originUrl } from './git';

test('originUrl reads origin from a real repo, and is undefined for a non-repo or a repo without origin', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'null-accounts-git-'));
  try {
    assert.strictEqual(await originUrl(dir), undefined);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    assert.strictEqual(await originUrl(dir), undefined);
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:octocat/hello.git'], { cwd: dir });
    assert.strictEqual(await originUrl(dir), 'git@github.com:octocat/hello.git');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Extend the test script**

Append ` out/suggest.test.js out/git.test.js` to the `node --test` list in `scripts.test`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd extensions/null-accounts && npm test`
Expected: FAIL at the `tsc` step with `TS2307` for `./suggest` and `./git`.

- [ ] **Step 4: Write the implementations**

`extensions/null-accounts/src/suggest.ts`:

```ts
'use strict';

import { Account } from './types';

export interface RemoteRef {
  /** Lowercase hostname; includes the port for https remotes (matches `Account.host`). */
  host: string;
  owner: string;
  /** Login embedded in an https URL, never the ssh `git` user or a password. */
  user?: string;
}

const URL_RE = /^(https|ssh|git):\/\/(?:([^@/\s]+)@)?([^/:\s@]+)(:\d+)?\/([^/\s]+)\/\S+$/i;
// Host needs 2+ characters so a Windows drive path like "C:/repos/app" is not read as host "C".
const SCP_RE = /^(?:[^@/\s]+@)?([^:/\s]{2,}):([^/\s]+)\/\S+$/;

export function parseRemoteUrl(raw: string): RemoteRef | undefined {
  const url = raw.trim();
  const m = URL_RE.exec(url);
  if (m) {
    const [, scheme, login, host, port, owner] = m;
    const https = scheme.toLowerCase() === 'https';
    const ref: RemoteRef = { host: host.toLowerCase() + (https && port ? port : ''), owner };
    if (https && login) { ref.user = login.split(':')[0]; }
    return ref;
  }
  const s = SCP_RE.exec(url);
  return s ? { host: s[1].toLowerCase(), owner: s[2] } : undefined;
}

/** The account that best matches a repo's origin URL, or undefined. Only a suggestion: the user confirms it. */
export function suggestAccount(originUrl: string, accounts: readonly Account[]): Account | undefined {
  const remote = parseRemoteUrl(originUrl);
  if (!remote) { return undefined; }
  const onHost = accounts.filter(a => a.host === remote.host);
  const named = (name?: string): Account | undefined =>
    name ? onHost.find(a => a.username.toLowerCase() === name.toLowerCase()) : undefined;
  return named(remote.user) ?? named(remote.owner) ?? (onHost.length === 1 ? onHost[0] : undefined);
}
```

`extensions/null-accounts/src/git.ts`:

```ts
'use strict';

import { execFile } from 'node:child_process';

/** The `origin` remote URL of the repo at `cwd`; undefined if it isn't a repo, has no origin, or git is missing. */
export function originUrl(cwd: string): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 5000, windowsHide: true }, (err, stdout) => {
      resolve(err ? undefined : stdout.trim() || undefined);
    });
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd extensions/null-accounts && npm test`
Expected: PASS, `# fail 0`. (`git.test` needs `git` on `PATH`, which the dev machine has.)

- [ ] **Step 6: Commit**

```bash
git add extensions/null-accounts/src/suggest.ts extensions/null-accounts/src/suggest.test.ts extensions/null-accounts/src/git.ts extensions/null-accounts/src/git.test.ts extensions/null-accounts/package.json
git commit -m "feat: suggest a null-accounts account from a repo's origin remote"
```

---

### Task 4: `providers/github.ts` — sign-in, identity, tokens

**Files:**
- Create: `extensions/null-accounts/src/providers/github.ts`
- Create: `extensions/null-accounts/src/providers/github.test.ts`
- Modify: `extensions/null-accounts/package.json` (`scripts.test`)

**Interfaces:**
- Consumes: `NewAccount`, `Account` from `../types`; `TokenProvider`, `TokenOptions` from `../api`.
- Produces (from `providers/github.ts`):
  - `const GITHUB_SCOPES: string[]` = `['repo', 'user:email']`
  - `interface GithubDeps { getSession(scopes: readonly string[], options: vscode.AuthenticationGetSessionOptions): Thenable<vscode.AuthenticationSession | undefined>; api(path: string, token: string): Promise<unknown> }`
  - `fetchGithub(path: string, token: string): Promise<unknown>` — the real `GithubDeps.api`.
  - `class GithubProvider implements TokenProvider` — `constructor(deps: GithubDeps)`; `signIn(): Promise<NewAccount | undefined>` (forces a fresh sign-in; `undefined` if cancelled); `existing(): Promise<NewAccount | undefined>` (the session VS Code already holds, no prompt); `getToken(account, scopes?, options?)`.
  - `signIn`/`existing` return a `NewAccount` with `externalId = session.account.id`; no token is returned or stored.

- [ ] **Step 1: Write the failing tests**

`extensions/null-accounts/src/providers/github.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import type * as vscode from 'vscode';
import { Account } from '../types';
import { GITHUB_SCOPES, GithubDeps, GithubProvider } from './github';

const session = (id: string, login: string, token = 'tok'): vscode.AuthenticationSession =>
  ({ id: `s-${id}`, accessToken: token, account: { id, label: login }, scopes: GITHUB_SCOPES });

const emails = [
  { email: 'old@example.com', primary: false, verified: true },
  { email: 'octo@example.com', primary: true, verified: true },
];

function makeDeps(opts: { session?: vscode.AuthenticationSession; reject?: boolean; api?: Record<string, unknown> } = {}) {
  const calls: Array<{ scopes: readonly string[]; options: vscode.AuthenticationGetSessionOptions }> = [];
  const apiCalls: string[] = [];
  const deps: GithubDeps = {
    getSession: async (scopes, options) => {
      calls.push({ scopes, options });
      if (opts.reject) { throw new Error('User did not consent to login.'); }
      return opts.session;
    },
    api: async path => {
      apiCalls.push(path);
      const r = opts.api?.[path];
      if (r === undefined || r instanceof Error) { throw r ?? new Error(`GitHub API 404 for ${path}`); }
      return r;
    },
  };
  return { deps, calls, apiCalls };
}

const octocat: Account = {
  id: 'a1', provider: 'github', host: 'github.com', username: 'octocat', email: 'o@e.com', authMethod: 'oauth', externalId: 'vsc-583231',
};

test('signIn forces a new session and describes the account from /user and the primary email', async () => {
  const { deps, calls } = makeDeps({
    session: session('vsc-583231', 'octocat'),
    api: { '/user': { id: 583231, login: 'octocat', email: null }, '/user/emails': emails },
  });
  const account = await new GithubProvider(deps).signIn();
  assert.deepStrictEqual(account, {
    provider: 'github', host: 'github.com', username: 'octocat', email: 'octo@example.com', authMethod: 'oauth',
    externalId: 'vsc-583231', // the session's account id, not the numeric /user id
  });
  assert.deepStrictEqual(calls[0].scopes, GITHUB_SCOPES);
  assert.deepStrictEqual(calls[0].options, { forceNewSession: true });
});

test('signIn resolves undefined without calling the API when the user cancels', async () => {
  const { deps, apiCalls } = makeDeps({ reject: true });
  assert.strictEqual(await new GithubProvider(deps).signIn(), undefined);
  assert.deepStrictEqual(apiCalls, []);
});

test('signIn surfaces an API failure instead of storing a half-described account', async () => {
  const { deps } = makeDeps({ session: session('1', 'octocat') });
  await assert.rejects(new GithubProvider(deps).signIn(), /404/);
});

test('email falls back to the profile email, then to the noreply address, and never fails the sign-in', async () => {
  const user = { id: 583231, login: 'octocat', email: 'profile@example.com' };
  const emailFor = async (api: Record<string, unknown>) =>
    (await new GithubProvider(makeDeps({ session: session('1', 'octocat'), api }).deps).signIn())?.email;

  // /user/emails unavailable (e.g. token lacks user:email) -> profile email
  assert.strictEqual(await emailFor({ '/user': user, '/user/emails': new Error('GitHub API 403') }), 'profile@example.com');
  // primary exists but is unverified -> ignored
  assert.strictEqual(
    await emailFor({ '/user': { ...user, email: null }, '/user/emails': [{ email: 'x@e.com', primary: true, verified: false }] }),
    '583231+octocat@users.noreply.github.com',
  );
  // private email, nothing from /user/emails
  assert.strictEqual(
    await emailFor({ '/user': { ...user, email: null }, '/user/emails': 'not-a-list' }),
    '583231+octocat@users.noreply.github.com',
  );
});

test('existing reads the signed-in session silently, and is undefined when there is none', async () => {
  const withSession = makeDeps({ session: session('1', 'octocat'), api: { '/user': { id: 1, login: 'octocat', email: 'o@e.com' }, '/user/emails': [] } });
  assert.strictEqual((await new GithubProvider(withSession.deps).existing())?.username, 'octocat');
  assert.deepStrictEqual(withSession.calls[0].options, { silent: true });

  assert.strictEqual(await new GithubProvider(makeDeps().deps).existing(), undefined);
});

test('getToken is silent by default, targets the account, and unions scopes with the defaults', async () => {
  const { deps, calls } = makeDeps({ session: session('vsc-583231', 'octocat', 'ghp_x') });
  const provider = new GithubProvider(deps);
  assert.strictEqual(await provider.getToken(octocat, ['read:org', 'repo']), 'ghp_x');
  assert.deepStrictEqual(calls[0].scopes, ['repo', 'user:email', 'read:org']);
  assert.deepStrictEqual(calls[0].options, { account: { id: 'vsc-583231', label: 'octocat' }, silent: true });

  await provider.getToken(octocat, undefined, { interactive: true });
  assert.deepStrictEqual(calls[1].scopes, GITHUB_SCOPES);
  assert.deepStrictEqual(calls[1].options, { account: { id: 'vsc-583231', label: 'octocat' }, createIfNone: true });
});

test('getToken refuses a session that belongs to a different GitHub account', async () => {
  const { deps } = makeDeps({ session: session('vsc-999', 'mallory', 'ghp_wrong') });
  assert.strictEqual(await new GithubProvider(deps).getToken(octocat, undefined, { interactive: true }), undefined);
});

test('getToken returns undefined without asking VS Code for accounts it cannot identify', async () => {
  const { deps, calls } = makeDeps({ session: session('x', 'y') });
  const provider = new GithubProvider(deps);
  assert.strictEqual(await provider.getToken({ ...octocat, externalId: undefined }), undefined);
  assert.strictEqual(await provider.getToken({ ...octocat, provider: 'gitlab' }), undefined);
  assert.deepStrictEqual(calls, []);
});
```

- [ ] **Step 2: Extend the test script**

Append ` out/providers/github.test.js` to the `node --test` list in `scripts.test`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd extensions/null-accounts && npm test`
Expected: FAIL at the `tsc` step with `TS2307: Cannot find module './github'`.

- [ ] **Step 4: Write the implementation**

`extensions/null-accounts/src/providers/github.ts`:

```ts
'use strict';

import type * as vscode from 'vscode';
import { TokenOptions, TokenProvider } from '../api';
import { Account, NewAccount } from '../types';

/** `repo` is what the Issues panel needs; `user:email` lets us read the primary email. */
export const GITHUB_SCOPES = ['repo', 'user:email'];

export interface GithubDeps {
  getSession(
    scopes: readonly string[],
    options: vscode.AuthenticationGetSessionOptions,
  ): Thenable<vscode.AuthenticationSession | undefined>;
  /** GET https://api.github.com<path> with the token; resolves the parsed JSON, rejects on a non-2xx status. */
  api(path: string, token: string): Promise<unknown>;
}

/** The real `GithubDeps.api`. */
export async function fetchGithub(path: string, token: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'null-ide' },
  });
  if (!res.ok) { throw new Error(`GitHub API ${res.status} for ${path}`); }
  return res.json();
}

interface GithubUser { id: number; login: string; email?: string | null }
interface GithubEmail { email: string; primary: boolean; verified: boolean }

/** Wraps VS Code's built-in `github` auth provider; it keeps the tokens, we keep who they belong to. */
export class GithubProvider implements TokenProvider {
  constructor(private readonly deps: GithubDeps) {}

  /** Forces a fresh sign-in (so a second account can be added) and describes who signed in. `undefined` if the user cancels. */
  async signIn(): Promise<NewAccount | undefined> {
    const session = await this.deps.getSession(GITHUB_SCOPES, { forceNewSession: true }).then(s => s, () => undefined);
    return session ? this.describe(session) : undefined;
  }

  /** The account VS Code is already signed in with, without prompting. */
  async existing(): Promise<NewAccount | undefined> {
    const session = await this.deps.getSession(GITHUB_SCOPES, { silent: true }).then(s => s, () => undefined);
    return session ? this.describe(session) : undefined;
  }

  async getToken(account: Account, scopes?: string[], options?: TokenOptions): Promise<string | undefined> {
    if (account.provider !== 'github' || !account.externalId) { return undefined; }
    const wanted = [...new Set([...GITHUB_SCOPES, ...(scopes ?? [])])];
    const target = { id: account.externalId, label: account.username };
    const session = await this.deps.getSession(
      wanted,
      options?.interactive ? { account: target, createIfNone: true } : { account: target, silent: true },
    );
    // A prompt can end with the user signing in as someone else; never hand back that identity's token.
    return session?.account.id === account.externalId ? session.accessToken : undefined;
  }

  private async describe(session: vscode.AuthenticationSession): Promise<NewAccount> {
    const user = await this.deps.api('/user', session.accessToken) as GithubUser;
    const emails = await this.deps.api('/user/emails', session.accessToken)
      .then(list => (Array.isArray(list) ? list as GithubEmail[] : []), () => [] as GithubEmail[]);
    const primary = emails.find(e => e.primary && e.verified)?.email;
    return {
      provider: 'github',
      host: 'github.com',
      username: user.login,
      email: primary ?? user.email ?? `${user.id}+${user.login}@users.noreply.github.com`,
      authMethod: 'oauth',
      externalId: session.account.id,
    };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd extensions/null-accounts && npm test`
Expected: PASS, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-accounts/src/providers extensions/null-accounts/package.json
git commit -m "feat: add null-accounts GitHub provider over the built-in auth session"
```

---

### Task 5: Account setup logic, quick-pick, and `activate()` wiring

**Files:**
- Create: `extensions/null-accounts/src/accountSetup.ts`, `accountSetup.test.ts`
- Create: `extensions/null-accounts/src/ui/pickItems.ts`, `pickItems.test.ts`
- Create: `extensions/null-accounts/src/ui/accountPicker.ts`
- Modify: `extensions/null-accounts/src/accountStore.ts` (export `sameIdentity`)
- Modify: `extensions/null-accounts/src/extension.ts`
- Modify: `extensions/null-accounts/package.json` (`scripts.test`)

**Interfaces:**
- Consumes: `AccountStore`, `sameIdentity` (newly exported) from `./accountStore`; `ProjectBinding`; `GithubProvider`, `fetchGithub`; `originUrl`; `suggestAccount`; `ChangeEmitter`; `createApi`.
- Produces:
  - `accountSetup.ts`: `findAccount(accounts: readonly Account[], candidate: NewAccount): Account | undefined`; `addOrReuse(accounts: { list(): Account[]; add(input: NewAccount, secret?: string): Promise<Account> }, candidate: NewAccount): Promise<Account>`; `importExisting(found: NewAccount, folders: readonly string[], accounts, bindings: { accountIdFor(p: string): string | undefined; bind(p: string, accountId: string): Promise<void> }): Promise<Account>`.
  - `ui/pickItems.ts`: `interface PickItem { label: string; description?: string; detail?: string; account?: Account }`; `buildPickItems(accounts: readonly Account[], suggestedId?: string): PickItem[]` — the last item is always the "add" action (no `account`).
  - `ui/accountPicker.ts`: `interface PickerDeps { accounts: AccountStore; bindings: ProjectBinding; github: GithubProvider }`; `addGithubAccount(deps): Promise<Account | undefined>`; `chooseAccountForFolder(deps, folder: vscode.Uri): Promise<Account | undefined>`.
  - `activate(context): NullAccountsApi` now returns the real API.

- [ ] **Step 1: Write the failing tests**

`extensions/null-accounts/src/accountSetup.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { AccountStore } from './accountStore';
import { addOrReuse, findAccount, importExisting } from './accountSetup';
import { ProjectBinding } from './projectBinding';
import { FakeMeta, FakeVault } from './testFakes';
import { NewAccount } from './types';

function setup() {
  let n = 0;
  const meta = new FakeMeta();
  const accounts = new AccountStore(meta, new FakeVault(), () => `id-${++n}`);
  const bindings = new ProjectBinding(meta, 'win32');
  return { accounts, bindings };
}

const octocat: NewAccount = {
  provider: 'github', host: 'github.com', username: 'octocat', email: 'o@e.com', authMethod: 'oauth', externalId: 'vsc-1',
};

test('addOrReuse adds a new account', async () => {
  const { accounts } = setup();
  const account = await addOrReuse(accounts, octocat);
  assert.strictEqual(account.id, 'id-1');
  assert.strictEqual(accounts.list().length, 1);
});

test('addOrReuse reuses an existing account instead of rejecting a duplicate', async () => {
  const { accounts } = setup();
  const first = await addOrReuse(accounts, octocat);
  const again = await addOrReuse(accounts, { ...octocat, username: 'OctoCat' });
  assert.strictEqual(again.id, first.id);
  assert.strictEqual(accounts.list().length, 1);
  assert.strictEqual(findAccount(accounts.list(), { ...octocat, username: 'hubot' }), undefined);
});

test('importExisting binds unbound open folders and leaves existing bindings alone', async () => {
  const { accounts, bindings } = setup();
  await bindings.bind('C:\\a', 'someone-else');
  const account = await importExisting(octocat, ['C:\\a', 'C:\\b'], accounts, bindings);
  assert.strictEqual(bindings.accountIdFor('C:\\a'), 'someone-else');
  assert.strictEqual(bindings.accountIdFor('C:\\b'), account.id);
});

test('importExisting twice does not duplicate the account', async () => {
  const { accounts, bindings } = setup();
  await importExisting(octocat, ['C:\\a'], accounts, bindings);
  await importExisting(octocat, ['C:\\a'], accounts, bindings);
  assert.strictEqual(accounts.list().length, 1);
});
```

`extensions/null-accounts/src/ui/pickItems.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Account } from '../types';
import { ADD_GITHUB_LABEL, buildPickItems } from './pickItems';

const acct = (id: string): Account =>
  ({ id, provider: 'github', host: 'github.com', username: id, email: `${id}@e.com`, authMethod: 'oauth' });

test('the suggested account comes first and is marked; the add action is always last', () => {
  const items = buildPickItems([acct('a1'), acct('a2'), acct('a3')], 'a2');
  assert.deepStrictEqual(items.map(i => i.account?.id), ['a2', 'a1', 'a3', undefined]);
  assert.match(items[0].detail ?? '', /suggested/i);
  assert.strictEqual(items[1].detail, undefined);
  assert.strictEqual(items[3].label, ADD_GITHUB_LABEL);
});

test('without a suggestion the order is unchanged, and with no accounts only the add action remains', () => {
  assert.deepStrictEqual(buildPickItems([acct('a1'), acct('a2')]).map(i => i.account?.id), ['a1', 'a2', undefined]);
  const only = buildPickItems([]);
  assert.strictEqual(only.length, 1);
  assert.strictEqual(only[0].account, undefined);
});
```

- [ ] **Step 2: Extend the test script**

Append ` out/accountSetup.test.js out/ui/pickItems.test.js` to the `node --test` list in `scripts.test`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd extensions/null-accounts && npm test`
Expected: FAIL at the `tsc` step with `TS2307` for `./accountSetup` and `./pickItems`.

- [ ] **Step 4: Export `sameIdentity` and write the pure modules**

In `accountStore.ts`, change `const sameIdentity = (` to `export const sameIdentity = (`.

`extensions/null-accounts/src/accountSetup.ts`:

```ts
'use strict';

import { sameIdentity } from './accountStore';
import { Account, NewAccount } from './types';

interface Accounts {
  list(): Account[];
  add(input: NewAccount, secret?: string): Promise<Account>;
}

interface Bindings {
  accountIdFor(folderPath: string): string | undefined;
  bind(folderPath: string, accountId: string): Promise<void>;
}

export function findAccount(accounts: readonly Account[], candidate: NewAccount): Account | undefined {
  return accounts.find(a => sameIdentity(a, candidate));
}

/** Signing in again as an account that's already stored must resolve to it, not fail as a duplicate. */
export async function addOrReuse(accounts: Accounts, candidate: NewAccount): Promise<Account> {
  return findAccount(accounts.list(), candidate) ?? accounts.add(candidate);
}

/**
 * First-run migration: store the account VS Code was already signed in with and bind every open,
 * unbound folder to it, so an existing user's Issues panel keeps working.
 */
export async function importExisting(
  found: NewAccount,
  folders: readonly string[],
  accounts: Accounts,
  bindings: Bindings,
): Promise<Account> {
  const account = await addOrReuse(accounts, found);
  for (const folder of folders) {
    if (bindings.accountIdFor(folder) === undefined) {
      await bindings.bind(folder, account.id);
    }
  }
  return account;
}
```

`extensions/null-accounts/src/ui/pickItems.ts`:

```ts
'use strict';

import { Account } from '../types';

export interface PickItem {
  label: string;
  description?: string;
  detail?: string;
  /** Absent on the "add" action. */
  account?: Account;
}

export const ADD_GITHUB_LABEL = '$(add) Add GitHub account…';

/** Accounts (the suggested one first), then the add action. */
export function buildPickItems(accounts: readonly Account[], suggestedId?: string): PickItem[] {
  const items: PickItem[] = accounts.map(account => ({
    label: `$(account) ${account.username}`,
    description: account.host,
    detail: account.id === suggestedId ? 'Suggested — matches this repository’s remote' : undefined,
    account,
  }));
  const rank = (i: PickItem): number => (i.account?.id === suggestedId ? 0 : 1);
  items.sort((a, b) => rank(a) - rank(b)); // stable: everything else keeps its order
  return [...items, { label: ADD_GITHUB_LABEL }];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd extensions/null-accounts && npm test`
Expected: PASS, `# fail 0`.

- [ ] **Step 6: Write the quick-pick (the only new `vscode` runtime code besides `extension.ts`)**

`extensions/null-accounts/src/ui/accountPicker.ts`:

```ts
'use strict';

import path from 'node:path';
import * as vscode from 'vscode';
import { AccountStore } from '../accountStore';
import { addOrReuse } from '../accountSetup';
import { originUrl } from '../git';
import { ProjectBinding } from '../projectBinding';
import { GithubProvider } from '../providers/github';
import { suggestAccount } from '../suggest';
import { Account } from '../types';
import { buildPickItems, PickItem } from './pickItems';

export interface PickerDeps {
  accounts: AccountStore;
  bindings: ProjectBinding;
  github: GithubProvider;
}

/** Signs in to another GitHub account and stores it; resolves the stored one if it was already added. */
export async function addGithubAccount(deps: PickerDeps): Promise<Account | undefined> {
  try {
    const fresh = await deps.github.signIn();
    return fresh ? await addOrReuse(deps.accounts, fresh) : undefined;
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not add the GitHub account: ${(err as Error).message}`);
    return undefined;
  }
}

/** Quick-pick an account for the folder (suggesting one from its origin remote), then bind it. */
export async function chooseAccountForFolder(deps: PickerDeps, folder: vscode.Uri): Promise<Account | undefined> {
  const origin = await originUrl(folder.fsPath);
  const suggested = origin ? suggestAccount(origin, deps.accounts.list()) : undefined;
  const picked = await vscode.window.showQuickPick<PickItem>(buildPickItems(deps.accounts.list(), suggested?.id), {
    placeHolder: `Which account should "${path.basename(folder.fsPath)}" use?`,
  });
  if (!picked) { return undefined; }
  const account = picked.account ?? await addGithubAccount(deps);
  if (!account) { return undefined; }
  await deps.bindings.bind(folder.fsPath, account.id);
  return account;
}
```

- [ ] **Step 7: Wire `activate()`**

Replace `extensions/null-accounts/src/extension.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import { AccountStore } from './accountStore';
import { findAccount, importExisting } from './accountSetup';
import { createApi, NullAccountsApi } from './api';
import { ChangeEmitter } from './changeEmitter';
import { ProjectBinding } from './projectBinding';
import { fetchGithub, GithubProvider } from './providers/github';
import { chooseAccountForFolder } from './ui/accountPicker';

const IMPORT_OFFERED_KEY = 'null-accounts.importOffered';

export function activate(context: vscode.ExtensionContext): NullAccountsApi {
  const store = new AccountStore(context.globalState, context.secrets);
  const bindings = new ProjectBinding(context.globalState);
  const github = new GithubProvider({
    getSession: (scopes, options) => vscode.authentication.getSession('github', scopes, options),
    api: fetchGithub,
  });

  // One event for "something changed" (accounts or bindings); the API and, later, the UI listen to it.
  const changed = new ChangeEmitter();
  context.subscriptions.push(
    store.onDidChange(() => {
      void bindings.prune(new Set(store.list().map(a => a.id)));
      changed.fire();
    }),
    bindings.onDidChange(() => changed.fire()),
  );

  const api = createApi({
    accounts: store,
    accountIdForFolder: folder => bindings.accountIdFor(folder.fsPath),
    chooseAccountForFolder: folder => chooseAccountForFolder({ accounts: store, bindings, github }, folder),
    tokenProviders: { github }, // Phase 4 adds gitlab
    onDidChange: changed.event,
  });

  void offerImport(context, store, bindings, github).catch(() => { /* a failed offer must never break activation */ });
  return api;
}

/** Once: offer to keep an already-signed-in GitHub account instead of silently logging existing users out. */
async function offerImport(
  context: vscode.ExtensionContext,
  store: AccountStore,
  bindings: ProjectBinding,
  github: GithubProvider,
): Promise<void> {
  if (context.globalState.get<boolean>(IMPORT_OFFERED_KEY)) { return; }
  const found = await github.existing().catch(() => undefined);
  if (!found) { return; } // not signed in, or offline: look again next start
  await context.globalState.update(IMPORT_OFFERED_KEY, true);
  if (findAccount(store.list(), found)) { return; }
  const choice = await vscode.window.showInformationMessage(
    `Null IDE now manages GitHub accounts. Import the account you're signed in with (${found.username})?`,
    'Import',
    'Not now',
  );
  if (choice !== 'Import') { return; }
  const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
  await importExisting(found, folders, store, bindings);
}

export function deactivate(): void {}
```

- [ ] **Step 8: Compile against the real VS Code types**

Run: `cd extensions/null-accounts && npm run compile && npm test`
Expected: compile exits 0; `npm test` shows `# fail 0`. If `vscode.authentication.getSession` reports an overload mismatch in `extension.ts`, adjust the `GithubDeps.getSession` signature in `providers/github.ts` to match (do not cast in `extension.ts`).

- [ ] **Step 9: Commit**

```bash
git add extensions/null-accounts/src extensions/null-accounts/package.json
git commit -m "feat: wire null-accounts binding, GitHub provider, quick-pick and first-run import"
```

---

### Task 6: Migrate the `null-tools` Issues panel onto the API

**Files:**
- Create: `extensions/null-tools/src/github/githubSession.ts`, `githubSession.test.ts`
- Modify: `extensions/null-tools/src/github/githubAuth.ts`
- Modify: `extensions/null-tools/src/github/issuesStore.ts:90-94`
- Modify: `extensions/null-tools/src/issuesPanelIntegration.ts` (the `context.subscriptions.push(` block at ~line 78)
- Modify: `extensions/null-tools/package.json` (`extensionDependencies`, `scripts.test`)

**Interfaces:**
- Consumes: the exported `NullAccountsApi` from Tasks 1–5, via a structural copy.
- Produces:
  - `githubSession.ts`: `interface AccountLike { provider: string; username: string }`; `interface AccountsApiLike { getAccountForFolder(folder: vscode.Uri): AccountLike | undefined; ensureAccountForFolder(folder: vscode.Uri): Promise<AccountLike | undefined>; getToken(account: AccountLike, scopes?: string[], options?: { interactive?: boolean }): Promise<string | undefined>; onDidChange: vscode.Event<void> }`; `interface GithubSession { accessToken: string; login: string }`; `resolveGithubSession(api: AccountsApiLike | undefined, folder: vscode.Uri | undefined, interactive: boolean): Promise<GithubSession | undefined>`.
  - `githubAuth.ts`: `getGithubSession(createIfNone: boolean): Promise<GithubSession | undefined>` (same name and call shape as today; the resolved value is now `{ accessToken, login }` instead of a VS Code `AuthenticationSession`); `getAccountsApi(): AccountsApiLike | undefined`.

- [ ] **Step 1: Write the failing test**

`extensions/null-tools/src/github/githubSession.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import type * as vscode from 'vscode';
import { AccountLike, AccountsApiLike, resolveGithubSession } from './githubSession';

const folder = { fsPath: 'C:\\repo' } as vscode.Uri;
const octocat: AccountLike = { provider: 'github', username: 'octocat' };
const tanuki: AccountLike = { provider: 'gitlab', username: 'tanuki' };

function makeApi(opts: { bound?: AccountLike; picked?: AccountLike; token?: string } = {}) {
  const log: string[] = [];
  const api: AccountsApiLike = {
    getAccountForFolder: () => opts.bound,
    ensureAccountForFolder: async () => { log.push('ensure'); return opts.picked; },
    getToken: async (_account, scopes, options) => { log.push(`token:${scopes}:${options?.interactive}`); return opts.token; },
    onDidChange: () => ({ dispose() {} }),
  };
  return { api, log };
}

test('a bound GitHub account yields its token and login, silently when not interactive', async () => {
  const { api, log } = makeApi({ bound: octocat, token: 'ghp_x' });
  assert.deepStrictEqual(await resolveGithubSession(api, folder, false), { accessToken: 'ghp_x', login: 'octocat' });
  assert.deepStrictEqual(log, ['token:repo:false']);
});

test('an unbound folder stays signed out when silent, and prompts to pick or add when interactive', async () => {
  const silent = makeApi({ token: 'ghp_x' });
  assert.strictEqual(await resolveGithubSession(silent.api, folder, false), undefined);
  assert.deepStrictEqual(silent.log, []);

  const interactive = makeApi({ picked: octocat, token: 'ghp_x' });
  assert.deepStrictEqual(await resolveGithubSession(interactive.api, folder, true), { accessToken: 'ghp_x', login: 'octocat' });
  assert.deepStrictEqual(interactive.log, ['ensure', 'token:repo:true']);

  const cancelled = makeApi({});
  assert.strictEqual(await resolveGithubSession(cancelled.api, folder, true), undefined);
});

test('a folder bound to a non-GitHub account never gets a GitHub session', async () => {
  const { api, log } = makeApi({ bound: tanuki, token: 'glpat_x' });
  assert.strictEqual(await resolveGithubSession(api, folder, true), undefined);
  assert.deepStrictEqual(log, []);
});

test('no token, no accounts extension, or no folder all resolve undefined', async () => {
  assert.strictEqual(await resolveGithubSession(makeApi({ bound: octocat }).api, folder, false), undefined);
  assert.strictEqual(await resolveGithubSession(undefined, folder, true), undefined);
  assert.strictEqual(await resolveGithubSession(makeApi({ bound: octocat, token: 't' }).api, undefined, true), undefined);
});
```

- [ ] **Step 2: Add the test to the script**

In `extensions/null-tools/package.json`, append ` out/github/githubSession.test.js` to the end of the `node --test` list in `scripts.test` (after `out/github/imageUpload.test.js`).

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd extensions/null-tools && npm test`
Expected: FAIL at the `tsc` step with `TS2307: Cannot find module './githubSession'`.

- [ ] **Step 4: Write `githubSession.ts`**

`extensions/null-tools/src/github/githubSession.ts`:

```ts
'use strict';

import type * as vscode from 'vscode';

// null-tools and null-accounts are built separately, so this is a structural copy of the slice of
// NullAccountsApi (extensions/null-accounts/src/api.ts) that null-tools uses.
export interface AccountLike { provider: string; username: string }

export interface AccountsApiLike {
  getAccountForFolder(folder: vscode.Uri): AccountLike | undefined;
  ensureAccountForFolder(folder: vscode.Uri): Promise<AccountLike | undefined>;
  getToken(account: AccountLike, scopes?: string[], options?: { interactive?: boolean }): Promise<string | undefined>;
  onDidChange: vscode.Event<void>;
}

export interface GithubSession { accessToken: string; login: string }

const SCOPES = ['repo'];

/**
 * The token and login of the GitHub account bound to `folder`. Silent callers get `undefined` for an
 * unbound folder; interactive callers are asked to pick or add an account first.
 */
export async function resolveGithubSession(
  api: AccountsApiLike | undefined,
  folder: vscode.Uri | undefined,
  interactive: boolean,
): Promise<GithubSession | undefined> {
  if (!api || !folder) { return undefined; }
  let account = api.getAccountForFolder(folder);
  if (!account && interactive) { account = await api.ensureAccountForFolder(folder); }
  if (account?.provider !== 'github') { return undefined; }
  const accessToken = await api.getToken(account, SCOPES, { interactive });
  return accessToken ? { accessToken, login: account.username } : undefined;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd extensions/null-tools && npm test`
Expected: PASS for `githubSession.test`; the pre-existing tests still pass (they don't touch `githubAuth`). `# fail 0`.

- [ ] **Step 6: Replace `githubAuth.ts` and fix the one consumer that reads the session**

Replace `extensions/null-tools/src/github/githubAuth.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import { AccountsApiLike, GithubSession, resolveGithubSession } from './githubSession';

/** null-accounts' exported API. null-tools lists it in `extensionDependencies`, so it is active by now. */
export function getAccountsApi(): AccountsApiLike | undefined {
  return vscode.extensions.getExtension<AccountsApiLike>('null.null-accounts')?.exports;
}

export function getGithubSession(createIfNone: boolean): Promise<GithubSession | undefined> {
  return resolveGithubSession(getAccountsApi(), vscode.workspace.workspaceFolders?.[0]?.uri, createIfNone);
}
```

In `extensions/null-tools/src/github/issuesStore.ts`, in `ensureSession` change:

```ts
    this.viewerLogin = session.account.label;
```

to:

```ts
    this.viewerLogin = session.login;
```

(The other three consumers — `issuesPanel.ts:81`, `issuesListController.ts:292`, `issuesPanelIntegration.ts:133` — only call `getGithubSession(true)` and read `.accessToken` / discard the result, so they compile unchanged.)

- [ ] **Step 7: Refresh the Issues panel when accounts or bindings change**

In `extensions/null-tools/src/issuesPanelIntegration.ts`, add `import { getAccountsApi } from './github/githubAuth';` is not needed (already imports `getGithubSession` from that file — change that import line to `import { getAccountsApi, getGithubSession } from './github/githubAuth';`). Then directly after the `context.subscriptions.push(...)` block that contains `vscode.workspace.onDidChangeWorkspaceFolders(() => refreshIssueCountBar()),` (and before `void refreshIssueCountBar();`), add:

```ts
  // Importing or binding an account must show up without a manual refresh.
  const accountsChanged = getAccountsApi()?.onDidChange(() => {
    void provider.refresh();
    void refreshIssueCountBar();
  });
  if (accountsChanged) { context.subscriptions.push(accountsChanged); }
```

- [ ] **Step 8: Declare the dependency**

In `extensions/null-tools/package.json`, add next to `"main"`:

```json
  "extensionDependencies": ["null.null-accounts"],
```

(Phase 1 deliberately postponed this: with nothing consuming the API, the dependency would only have made `null-tools` fail to activate whenever `null-accounts` did.)

- [ ] **Step 9: Compile and test both extensions**

Run: `cd extensions/null-tools && npm run compile && npm test`
Expected: compile exits 0 (a type error here means a consumer still reads an `AuthenticationSession` field — fix it the way Step 6 did); `# fail 0`.

- [ ] **Step 10: Commit**

```bash
git add extensions/null-tools/src extensions/null-tools/package.json
git commit -m "feat: resolve null-tools GitHub sessions through null-accounts"
```

---

### Task 7: Docs and end-to-end verification

**Files:**
- Modify: `CLAUDE.md` (the `null-accounts` section, the `null-tools` Issues row, the repo-layout `src/` comment for `null-accounts`)
- Modify: `extensions/null-accounts/src/test/suite/activation.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: documentation and a passing activation spec against the real build.

- [ ] **Step 1: Extend the activation spec**

In `activation.spec.ts`, directly before the closing `});` of the single test, add:

```ts
    // Phase 2: an unbound folder has no account, and a silent token request for an unknown
    // GitHub account (no externalId) resolves undefined instead of prompting or throwing.
    assert.strictEqual(typeof api.ensureAccountForFolder, 'function');
    assert.strictEqual(await api.getToken(stranger, ['repo'], { interactive: false }), undefined);
```

- [ ] **Step 2: Update `CLAUDE.md`**

1. In the `### null-accounts` section replace the `**Status: foundation only** — …` sentence with: `**Status: GitHub + project binding** — the GitHub provider wraps VS Code's built-in \`github\` session (\`Account.externalId\` is the session's account id; tokens stay with VS Code), folders bind to an account in \`globalState\` (\`projectBinding.ts\`) with an origin-based suggestion (\`suggest.ts\`), \`ensureAccountForFolder\` opens a pick/add quick-pick, and a one-time prompt imports the account VS Code was already signed in with. The Issues panel in null-tools resolves its token through the API. The accounts webview, GitLab, and git wiring land in later phases.`
2. In the same section extend the API sentence: `getToken(account, scopes?, { interactive? })` is silent unless `interactive` is true, and `ensureAccountForFolder(folder)` was added.
3. In the `null-tools` table's **GitHub Issues panel** row, append: `signs in through null-accounts (\`githubAuth.ts\` → \`githubSession.ts\`); \`null-tools\` declares \`extensionDependencies: ["null.null-accounts"]\``.
4. In the repo-layout comment for `null-accounts/src/`, add `projectBinding.ts, suggest.ts, providers/github.ts, ui/`.

- [ ] **Step 3: Full unit run**

Run: `cd extensions/null-accounts && npm test` and `cd ../null-tools && npm test`
Expected: both `# fail 0`.

- [ ] **Step 4: Verify in the real build (confirm with the user first)**

`scripts/sync-local.ps1` replaces files in the installed Null IDE and may close running Null IDE windows, so confirm before running it. Then use the `verify-local` skill with target extension `null-accounts`; it syncs and runs `npm run test:integration`. Because `null-tools` now depends on `null-accounts`, sync **both** extensions.
Expected: the `null-accounts activation` spec passes (1 passing).

- [ ] **Step 5: Manual smoke test (needs the user's GitHub login — hand this list to the user)**

1. Fresh profile or `null-accounts.importOffered` cleared, already signed in to GitHub: start Null IDE in a repo with a GitHub `origin` → the "Import the account you're signed in with (…)?" prompt appears once; **Import** → the Issues panel loads without clicking anything.
2. Open a second, unbound repo → Issues panel shows signed out; **Sign in** → quick-pick lists the stored account (marked *Suggested* when the owner matches) and **Add GitHub account…**; pick it → issues load.
3. **Add GitHub account…** → browser flow → issues load; add the same account again → reuses it, no error.
4. Reload the window → both repos load silently, no prompt.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md extensions/null-accounts/src/test
git commit -m "docs: document null-accounts GitHub binding and extend the activation spec"
```

---

## Self-Review

**Spec coverage (Phase 2 = "github provider, projectBinding (+ suggest), Issues migration with import of the existing session"):**
- `providers/github` — `addAccount` forcing a new session, `/user` + primary email, `getToken(account, scopes)` via `getSession(…, { account })` → Task 4 (`signIn`, `describe`, `getToken`).
- `projectBinding` — `bind`, `accountFor`, normalised-path key in `globalState` so closed projects are readable → Task 2; `suggest` from the origin URL → Task 3.
- Migration — `getGithubSession(createIfNone)` resolves the folder's account and token; unbound + `createIfNone` opens the pick/add quick-pick; unbound + silent returns `undefined`; the three Issues consumers change only at that call → Tasks 5–6 (the quick-pick is built here, not in Phase 3, because the migration needs it; Phase 3 reuses it for the status bar). `null-tools` `extensionDependencies` → Task 6 Step 8.
- Import of the existing session on first run, so existing users aren't logged out → Task 5 (`offerImport`, `importExisting`), with open folders bound so the panel keeps working.
- Error handling: "Account removed while bound: bindings … cleared" → `prune` wired to `store.onDidChange` (Tasks 2, 5); the git-key half of that line is Phase 5. "Needs re-auth" → deferred to Phase 4 (reason in Global Constraints).
- Deviations from the spec, all additive: `getToken`'s third `options` parameter; `ensureAccountForFolder` on the API; `suggest` falls back to owner and to the sole account on the host; GitHub tokens are not copied into `SecretStorage`. Each is argued where it is introduced.

**Placeholder scan:** no TBD/TODO steps; every code step has the full code. The Task 7 doc edits are given as exact sentences. The only judgement left to the executor is the compile-fix instruction in Task 5 Step 8, which names the file to change and the direction.

**Type consistency:** `TokenOptions`, `TokenProvider.getToken(account, scopes?, options?)` (Task 1) match `GithubProvider.getToken` (Task 4) and the `getToken(..., { interactive })` call in Task 6. `ApiDeps` (Task 1) matches the object built in Task 5's `activate()` (`accounts`, `accountIdForFolder`, `chooseAccountForFolder`, `tokenProviders`, `onDidChange`). `ProjectBinding.accountIdFor` / `bind` match the `Bindings` slice in `accountSetup.ts`. `sameIdentity` is exported in Task 5 before `accountSetup.ts` imports it. `NewAccount.externalId` (Task 1) is produced by `GithubProvider.describe` (Task 4) and kept by `validateNewAccount`. `AccountsApiLike` (Task 6) is a subset of `NullAccountsApi` (Task 1) — `AccountLike` is satisfied by `Account`.

**Review Focus:** line 1 → Task 4 "refuses a session that belongs to a different GitHub account"; line 2 → Task 5 `addOrReuse` reuse test; line 3 → Task 2 `folderKey` and "found however the folder path is written" tests; line 4 → Task 4 email-fallback test; line 5 → Task 6 "non-GitHub account" test and Task 2 `prune` test.

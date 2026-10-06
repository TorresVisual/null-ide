# Null Accounts — Phase 1: Foundation Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Ship the `null-accounts` built-in extension skeleton: account types and validation, a persistent account store (metadata in `globalState`, secrets in `SecretStorage`), the exported `NullAccountsApi`, and full build/repo wiring — with no UI and no provider logic yet.

**Architecture:** Pure, node-testable modules (`accountInput`, `accountStore`, `api`) that take their storage as injected interfaces (`MetadataStore`, `SecretVault`) so tests need no VS Code host; `extension.ts` is the only file that touches `vscode` at runtime and just wires `context.globalState` / `context.secrets` into them. This is the same pure-logic / thin-integration split `null-actions` uses. The API ships with two deliberate seams — a folder→account resolver and a per-provider token-provider registry — that Phases 2 and 4 fill in.

**Tech Stack:** TypeScript (strict), VS Code Extension API `^1.85.0`, `node --test` + `node:assert` for unit tests, Mocha via `@vscode/test-electron` for the one activation spec (copied from `null-actions`).

**Spec:** `docs/specs/null-accounts-design.md` (issue #102). This is plan 1 of 6, one per delivery phase in the spec: (1) Foundation ← this plan, (2) GitHub + binding, (3) UI, (4) GitLab, (5) Git wiring, (6) Integration. Each later phase gets its own plan once the previous one lands.

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

- Extension lives at `extensions/null-accounts/`; manifest `name: "null-accounts"`, `publisher: "null"` (so the extension ID is `null.null-accounts`), `engines.vscode: "^1.85.0"`, `main: "./out/extension.js"`, `activationEvents: ["onStartupFinished"]` — same conventions as `null-actions` / `null-cpp`.
- `tsconfig.json` compiler options are copied from `extensions/null-actions/tsconfig.json`: `target: ES2022`, `module: commonjs`, `lib: ["ES2022"]`, `outDir: ./out`, `rootDir: ./src`, `strict: true`, `sourceMap: true`, `esModuleInterop: true`, `skipLibCheck: true`, `types: ["node"]`. (Plan decision: `include` is the glob `src/**/*.ts` rather than null-actions' hand-maintained file list, so no task has to edit it.)
- Every `.ts` source file starts with `'use strict';` on its own line.
- Account metadata (`id`, `provider`, `host`, `username`, `email`, `authMethod`, `sshKeyPath`) lives in `globalState`. Secrets live in `SecretStorage` under the key `null-accounts/<id>`. Secrets never touch settings or `globalState`, and are never logged.
- `NullAccountsApi.getToken` never throws for auth failure — it resolves `undefined`.
- Unit-tested modules must not import `vscode` at runtime. Type-only imports (`import type`) are fine; they are erased at compile time.
- `Account.host` is stored as a bare lowercase hostname with optional port (`github.com`, `gitlab.example.org:8443`) — no scheme, no path. (Plan decision: Phase 2's `suggest()` matches it against hostnames parsed from `origin` URLs, and Phase 5 uses it as `credential.<host>`.) `http://` input is rejected (spec: "HTTPS only … `http://` rejected").
- Edit TypeScript sources only; never edit compiled `out/` output.
- Commit after each task; do not push.

## Review Focus

The spec says what the store and API must do, not everything they will meet. These are the inputs most likely to bite someone using this foundation, most likely first; each has a test in the owning task.

1. **The same account added twice** (re-running sign-in, or `OctoCat` / `GITHUB.COM` casing differences) → rejected with a clear error, not silently duplicated; an `update` that would collide is rejected too. (Task 2)
2. **Corrupt or old-schema `globalState`** (a non-array value, or junk entries mixed with good ones) → `list()` skips what it can't read and never throws, so activation can't fail on bad stored data. (Task 2)
3. **A host pasted as a URL** (`https://GitLab.com/`, trailing whitespace) → normalised to `gitlab.com`; `http://…`, paths, spaces and empty input → rejected with a message, not stored. (Task 1)
4. **A consumer asks for a token for a provider that has no token provider yet, or the provider throws** (offline, revoked) → resolves `undefined`, never rejects. (Task 3)
5. **Removing an account that no longer exists** (double click, stale UI) → silent no-op, no change event; and an `add` that fails validation must not leave an orphan secret behind. (Task 2)

---

### Task 1: Extension scaffold, `types.ts`, and input validation

**Files:**
- Create: `extensions/null-accounts/package.json`
- Create: `extensions/null-accounts/tsconfig.json`
- Create: `extensions/null-accounts/src/extension.ts` (placeholder `activate`, replaced in Task 4)
- Create: `extensions/null-accounts/src/types.ts`
- Create: `extensions/null-accounts/src/accountInput.ts`
- Create: `extensions/null-accounts/src/accountInput.test.ts`
- Create: `extensions/null-accounts/package-lock.json` (generated)
- Modify: `.gitignore:36` (add the `.vscode-test/` line for the new extension)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `types.ts`: `type Provider = 'github' | 'gitlab'`; `type AuthMethod = 'oauth' | 'ssh' | 'https'`; `interface Account { id: string; provider: Provider; host: string; username: string; email: string; authMethod: AuthMethod; sshKeyPath?: string }`; `type NewAccount = Omit<Account, 'id'>`.
  - `accountInput.ts`: `normalizeHost(input: string): string` (throws `Error` on invalid); `validateNewAccount(input: NewAccount): NewAccount` (returns a trimmed/normalised copy, throws `Error` on invalid).

- [ ] **Step 1: Create the manifest**

`extensions/null-accounts/package.json`:

```json
{
  "name": "null-accounts",
  "displayName": "Null Accounts",
  "description": "GitHub and GitLab account manager for Null IDE — multiple identities, per-project binding, and a token API for other Null IDE features",
  "version": "1.0.0",
  "publisher": "null",
  "license": "MIT",
  "engines": { "vscode": "^1.85.0" },
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "scripts": {
    "compile": "tsc -p tsconfig.json",
    "test": "tsc -p tsconfig.json && node --test out/accountInput.test.js",
    "pretest:integration": "tsc -p tsconfig.json",
    "test:integration": "node ./out/test/runTest.js"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "@types/vscode": "^1.85.0",
    "@types/node": "^22.0.0",
    "@vscode/test-electron": "^3.1.0",
    "mocha": "^11.8.0",
    "@types/mocha": "^10.0.10",
    "glob": "^13.0.6"
  }
}
```

`extensions/null-accounts/tsconfig.json`:

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
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

`extensions/null-accounts/src/extension.ts`:

```ts
'use strict';

export function activate(): void {}

export function deactivate(): void {}
```

- [ ] **Step 2: Ignore the integration-test download cache**

In `.gitignore`, directly after the existing line `extensions/null-actions/.vscode-test/`, add:

```
extensions/null-accounts/.vscode-test/
```

- [ ] **Step 3: Install dependencies and generate the lockfile**

CI runs `npm ci --ignore-scripts`, which needs a committed lockfile.

Run: `cd extensions/null-accounts && npm install --ignore-scripts`
Expected: creates `package-lock.json` and `node_modules/` (the latter is already gitignored).

- [ ] **Step 4: Write `types.ts`**

`extensions/null-accounts/src/types.ts`:

```ts
'use strict';

export type Provider = 'github' | 'gitlab';
export type AuthMethod = 'oauth' | 'ssh' | 'https';

export interface Account {
  id: string;
  provider: Provider;
  /** Bare lowercase hostname, optional port: "github.com", "gitlab.example.org:8443". */
  host: string;
  username: string;
  email: string;
  authMethod: AuthMethod;
  /** Required when authMethod is "ssh"; absent otherwise. */
  sshKeyPath?: string;
}

export type NewAccount = Omit<Account, 'id'>;
```

(`Binding` from the spec's `types.ts` listing is added in Phase 2, which is the first code that uses it.)

- [ ] **Step 5: Write the failing test**

`extensions/null-accounts/src/accountInput.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { normalizeHost, validateNewAccount } from './accountInput';
import { NewAccount } from './types';

const base: NewAccount = {
  provider: 'github',
  host: 'github.com',
  username: 'octocat',
  email: 'octocat@example.com',
  authMethod: 'oauth',
};

test('normalizeHost lowercases and strips scheme, trailing slashes and whitespace', () => {
  assert.strictEqual(normalizeHost('  https://GitLab.com/ '), 'gitlab.com');
  assert.strictEqual(normalizeHost('GitHub.com'), 'github.com');
});

test('normalizeHost keeps an explicit port', () => {
  assert.strictEqual(normalizeHost('gitlab.example.org:8443'), 'gitlab.example.org:8443');
});

test('normalizeHost rejects http://', () => {
  assert.throws(() => normalizeHost('http://gitlab.example.org'), /http/i);
  assert.throws(() => normalizeHost('HTTP://gitlab.example.org'), /http/i);
});

test('normalizeHost rejects empty input, paths, spaces and bad ports', () => {
  for (const bad of ['', '   ', 'https://', 'gitlab.com/group', 'git lab.com', 'gitlab.com:abc', 'ftp://gitlab.com']) {
    assert.throws(() => normalizeHost(bad), `expected "${bad}" to be rejected`);
  }
});

test('validateNewAccount trims fields and normalises the host', () => {
  const out = validateNewAccount({ ...base, host: ' https://GitHub.com/ ', username: '  octocat ', email: ' octocat@example.com ' });
  assert.deepStrictEqual(out, base);
});

test('validateNewAccount rejects a blank username or an email without @', () => {
  assert.throws(() => validateNewAccount({ ...base, username: '   ' }), /username/i);
  assert.throws(() => validateNewAccount({ ...base, email: 'nope' }), /email/i);
  assert.throws(() => validateNewAccount({ ...base, email: '' }), /email/i);
});

test('validateNewAccount rejects unknown provider and auth method', () => {
  assert.throws(() => validateNewAccount({ ...base, provider: 'bitbucket' as never }), /provider/i);
  assert.throws(() => validateNewAccount({ ...base, authMethod: 'magic' as never }), /auth/i);
});

test('validateNewAccount requires an SSH key path for ssh accounts only', () => {
  assert.throws(() => validateNewAccount({ ...base, authMethod: 'ssh' }), /ssh key/i);
  assert.throws(() => validateNewAccount({ ...base, authMethod: 'ssh', sshKeyPath: '  ' }), /ssh key/i);
  const ssh = validateNewAccount({ ...base, authMethod: 'ssh', sshKeyPath: ' C:\\keys\\id_ed25519 ' });
  assert.strictEqual(ssh.sshKeyPath, 'C:\\keys\\id_ed25519');
  // A stray key path on a non-ssh account is dropped, not stored.
  const oauth = validateNewAccount({ ...base, sshKeyPath: 'C:\\keys\\id_ed25519' });
  assert.strictEqual('sshKeyPath' in oauth, false);
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd extensions/null-accounts && npm test`
Expected: FAIL at the `tsc` step with `TS2307: Cannot find module './accountInput'`.

- [ ] **Step 7: Write the implementation**

`extensions/null-accounts/src/accountInput.ts`:

```ts
'use strict';

import { AuthMethod, NewAccount, Provider } from './types';

const PROVIDERS: readonly Provider[] = ['github', 'gitlab'];
const AUTH_METHODS: readonly AuthMethod[] = ['oauth', 'ssh', 'https'];

/** "https://GitLab.com/" -> "gitlab.com". Rejects http:// and anything that isn't a bare host[:port]. */
export function normalizeHost(input: string): string {
  let host = input.trim().toLowerCase();
  if (host.startsWith('http://')) {
    throw new Error('Plain http:// hosts are not supported; use https.');
  }
  if (host.startsWith('https://')) {
    host = host.slice('https://'.length);
  }
  host = host.replace(/\/+$/, '');
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(host)) {
    throw new Error(`Invalid host: "${input}"`);
  }
  return host;
}

/** Returns a trimmed, normalised copy of `input`; throws an Error describing the first problem. */
export function validateNewAccount(input: NewAccount): NewAccount {
  if (!PROVIDERS.includes(input.provider)) {
    throw new Error(`Unknown provider: ${String(input.provider)}`);
  }
  if (!AUTH_METHODS.includes(input.authMethod)) {
    throw new Error(`Unknown auth method: ${String(input.authMethod)}`);
  }
  const username = input.username.trim();
  if (!username) {
    throw new Error('Username is required.');
  }
  const email = input.email.trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new Error('A valid email address is required.');
  }
  const out: NewAccount = {
    provider: input.provider,
    host: normalizeHost(input.host),
    username,
    email,
    authMethod: input.authMethod,
  };
  if (input.authMethod === 'ssh') {
    const key = input.sshKeyPath?.trim();
    if (!key) {
      throw new Error('An SSH key path is required for SSH accounts.');
    }
    out.sshKeyPath = key;
  }
  return out;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd extensions/null-accounts && npm test`
Expected: PASS — `# pass 8`, `# fail 0`.

- [ ] **Step 9: Commit**

```bash
git add .gitignore extensions/null-accounts
git commit -m "feat: scaffold null-accounts extension with account types and input validation"
```

---

### Task 2: `accountStore.ts` — account CRUD, secrets, change events

**Files:**
- Create: `extensions/null-accounts/src/accountStore.ts`
- Create: `extensions/null-accounts/src/accountStore.test.ts`
- Modify: `extensions/null-accounts/package.json` (`scripts.test`)

**Interfaces:**
- Consumes: `Account`, `NewAccount` from `./types`; `validateNewAccount` from `./accountInput`.
- Produces (from `accountStore.ts`):
  - `interface MetadataStore { get<T>(key: string): T | undefined; update(key: string, value: unknown): PromiseLike<void> }` — satisfied by `vscode.Memento`.
  - `interface SecretVault { get(key: string): PromiseLike<string | undefined>; store(key: string, value: string): PromiseLike<void>; delete(key: string): PromiseLike<void> }` — satisfied by `vscode.SecretStorage`.
  - `const ACCOUNTS_KEY = 'null-accounts.accounts'`
  - `class AccountStore` with `constructor(meta: MetadataStore, secrets: SecretVault, newId?: () => string)`; `readonly onDidChange: vscode.Event<void>`; `list(): Account[]` (copies); `get(id: string): Account | undefined`; `add(input: NewAccount, secret?: string): Promise<Account>`; `update(id: string, patch: Partial<NewAccount>): Promise<Account>`; `remove(id: string): Promise<void>`; `getSecret(id: string): PromiseLike<string | undefined>`; `setSecret(id: string, value: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`extensions/null-accounts/src/accountStore.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { ACCOUNTS_KEY, AccountStore, MetadataStore, SecretVault } from './accountStore';
import { NewAccount } from './types';

class FakeMeta implements MetadataStore {
  data = new Map<string, unknown>();
  get<T>(key: string): T | undefined { return this.data.get(key) as T | undefined; }
  async update(key: string, value: unknown): Promise<void> { this.data.set(key, structuredClone(value)); }
}

class FakeVault implements SecretVault {
  data = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.data.get(key); }
  async store(key: string, value: string): Promise<void> { this.data.set(key, value); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}

function makeStore() {
  let n = 0;
  const meta = new FakeMeta();
  const vault = new FakeVault();
  const store = new AccountStore(meta, vault, () => `id-${++n}`);
  return { store, meta, vault };
}

const octocat: NewAccount = {
  provider: 'github', host: 'github.com', username: 'octocat', email: 'octocat@example.com', authMethod: 'oauth',
};

test('add persists metadata and keeps the secret out of it', async () => {
  const { store, meta, vault } = makeStore();
  const account = await store.add(octocat, 'ghp_supersecret');
  assert.strictEqual(account.id, 'id-1');
  assert.deepStrictEqual(store.list(), [account]);
  assert.strictEqual(await store.getSecret('id-1'), 'ghp_supersecret');
  assert.strictEqual(vault.data.get('null-accounts/id-1'), 'ghp_supersecret');
  assert.ok(!JSON.stringify([...meta.data.entries()]).includes('ghp_supersecret'), 'secret leaked into metadata');
});

test('add without a secret stores no vault entry', async () => {
  const { store, vault } = makeStore();
  await store.add(octocat);
  assert.strictEqual(vault.data.size, 0);
});

test('list returns copies, so callers cannot mutate stored state', async () => {
  const { store } = makeStore();
  await store.add(octocat);
  store.list()[0].username = 'mallory';
  assert.strictEqual(store.list()[0].username, 'octocat');
});

test('add rejects a duplicate provider+host+username, ignoring case and host formatting', async () => {
  const { store } = makeStore();
  await store.add(octocat);
  await assert.rejects(store.add({ ...octocat, username: 'OctoCat', host: 'HTTPS://GITHUB.COM/' }), /already/i);
  assert.strictEqual(store.list().length, 1);
  // Same login on a different host, or a different login on the same host, is fine.
  await store.add({ ...octocat, provider: 'gitlab', host: 'gitlab.com' });
  await store.add({ ...octocat, username: 'hubot' });
  assert.strictEqual(store.list().length, 3);
});

test('a failed add leaves no orphan secret and fires no event', async () => {
  const { store, vault } = makeStore();
  let fired = 0;
  store.onDidChange(() => fired++);
  await assert.rejects(store.add({ ...octocat, host: 'http://github.com' }, 'tok'), /http/i);
  assert.strictEqual(vault.data.size, 0);
  assert.strictEqual(fired, 0);
});

test('update patches fields, fires one event, and rejects a patch that creates a duplicate', async () => {
  const { store } = makeStore();
  const a = await store.add(octocat);
  await store.add({ ...octocat, username: 'hubot' });
  let fired = 0;
  store.onDidChange(() => fired++);

  const updated = await store.update(a.id, { email: 'new@example.com' });
  assert.strictEqual(updated.email, 'new@example.com');
  assert.strictEqual(store.get(a.id)?.email, 'new@example.com');
  assert.strictEqual(fired, 1);

  // Re-saving an account with its own username is not a duplicate of itself.
  await store.update(a.id, { username: 'octocat' });
  await assert.rejects(store.update(a.id, { username: 'hubot' }), /already/i);
  await assert.rejects(store.update('missing', { email: 'x@example.com' }), /no account/i);
});

test('remove deletes the account and its secret and fires one event', async () => {
  const { store, vault } = makeStore();
  const a = await store.add(octocat, 'tok');
  let fired = 0;
  store.onDidChange(() => fired++);
  await store.remove(a.id);
  assert.deepStrictEqual(store.list(), []);
  assert.strictEqual(vault.data.size, 0);
  assert.strictEqual(fired, 1);
});

test('removing an unknown account is a silent no-op', async () => {
  const { store } = makeStore();
  let fired = 0;
  store.onDidChange(() => fired++);
  await store.remove('nope');
  assert.strictEqual(fired, 0);
});

test('list ignores corrupt stored data instead of throwing', async () => {
  const { store, meta } = makeStore();
  meta.data.set(ACCOUNTS_KEY, 'garbage');
  assert.deepStrictEqual(store.list(), []);

  const good = { id: 'g', provider: 'github', host: 'github.com', username: 'u', email: 'u@e.com', authMethod: 'oauth' };
  meta.data.set(ACCOUNTS_KEY, ['x', null, { id: 1 }, { ...good, provider: 'bitbucket' }, good]);
  assert.deepStrictEqual(store.list(), [good]);
});

test('setSecret refuses an unknown account so no orphan secret is created', async () => {
  const { store, vault } = makeStore();
  await assert.rejects(store.setSecret('nope', 'tok'), /no account/i);
  assert.strictEqual(vault.data.size, 0);
  const a = await store.add(octocat);
  await store.setSecret(a.id, 'tok2');
  assert.strictEqual(await store.getSecret(a.id), 'tok2');
});

test('onDidChange listeners can be disposed, and a throwing listener does not break the write or other listeners', async () => {
  const { store } = makeStore();
  let kept = 0;
  let disposed = 0;
  store.onDidChange(() => { throw new Error('bad listener'); });
  store.onDidChange(() => kept++);
  const sub = store.onDidChange(() => disposed++);
  sub.dispose();
  await store.add(octocat);
  assert.strictEqual(kept, 1);
  assert.strictEqual(disposed, 0);
});
```

- [ ] **Step 2: Extend the test script**

In `extensions/null-accounts/package.json`, change `scripts.test` to:

```json
"test": "tsc -p tsconfig.json && node --test out/accountInput.test.js out/accountStore.test.js"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd extensions/null-accounts && npm test`
Expected: FAIL at the `tsc` step with `TS2307: Cannot find module './accountStore'`.

- [ ] **Step 4: Write the implementation**

`extensions/null-accounts/src/accountStore.ts`:

```ts
'use strict';

import { randomUUID } from 'node:crypto';
import type { Event } from 'vscode';
import { validateNewAccount } from './accountInput';
import { Account, NewAccount } from './types';

/** The slice of vscode.Memento the store needs, so tests need no VS Code host. */
export interface MetadataStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** The slice of vscode.SecretStorage the store needs. */
export interface SecretVault {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export const ACCOUNTS_KEY = 'null-accounts.accounts';
const secretKey = (id: string): string => `null-accounts/${id}`;

const PROVIDERS = ['github', 'gitlab'];
const AUTH_METHODS = ['oauth', 'ssh', 'https'];

function isAccount(value: unknown): value is Account {
  if (typeof value !== 'object' || value === null) { return false; }
  const a = value as Record<string, unknown>;
  return typeof a.id === 'string'
    && PROVIDERS.includes(a.provider as string)
    && typeof a.host === 'string'
    && typeof a.username === 'string'
    && typeof a.email === 'string'
    && AUTH_METHODS.includes(a.authMethod as string);
}

const sameIdentity = (a: NewAccount, b: NewAccount): boolean =>
  a.provider === b.provider && a.host === b.host && a.username.toLowerCase() === b.username.toLowerCase();

class ChangeEmitter {
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

export class AccountStore {
  private readonly emitter = new ChangeEmitter();
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly meta: MetadataStore,
    private readonly secrets: SecretVault,
    private readonly newId: () => string = randomUUID,
  ) {}

  /** Copies of the stored accounts. Unreadable entries are skipped, never thrown on. */
  list(): Account[] {
    const raw = this.meta.get<unknown>(ACCOUNTS_KEY);
    return Array.isArray(raw) ? raw.filter(isAccount).map(a => ({ ...a })) : [];
  }

  get(id: string): Account | undefined {
    return this.list().find(a => a.id === id);
  }

  async add(input: NewAccount, secret?: string): Promise<Account> {
    const valid = validateNewAccount(input);
    this.assertUnique(valid);
    const account: Account = { id: this.newId(), ...valid };
    // Secret first: if the metadata write then fails, the leftover secret is unreachable
    // (nothing references its id); the reverse order would leave an account with no token.
    if (secret !== undefined) {
      await this.secrets.store(secretKey(account.id), secret);
    }
    await this.meta.update(ACCOUNTS_KEY, [...this.list(), account]);
    this.emitter.fire();
    return { ...account };
  }

  async update(id: string, patch: Partial<NewAccount>): Promise<Account> {
    const existing = this.get(id);
    if (!existing) { throw new Error(`No account with id ${id}`); }
    const { id: _id, ...rest } = existing;
    const valid = validateNewAccount({ ...rest, ...patch });
    this.assertUnique(valid, id);
    const updated: Account = { id, ...valid };
    await this.meta.update(ACCOUNTS_KEY, this.list().map(a => (a.id === id ? updated : a)));
    this.emitter.fire();
    return { ...updated };
  }

  async remove(id: string): Promise<void> {
    if (!this.get(id)) { return; }
    // Secret first: if deleting it fails the account stays listed and removal can be retried.
    await this.secrets.delete(secretKey(id));
    await this.meta.update(ACCOUNTS_KEY, this.list().filter(a => a.id !== id));
    this.emitter.fire();
  }

  getSecret(id: string): PromiseLike<string | undefined> {
    return this.secrets.get(secretKey(id));
  }

  async setSecret(id: string, value: string): Promise<void> {
    if (!this.get(id)) { throw new Error(`No account with id ${id}`); }
    await this.secrets.store(secretKey(id), value);
  }

  private assertUnique(candidate: NewAccount, ignoreId?: string): void {
    if (this.list().some(a => a.id !== ignoreId && sameIdentity(a, candidate))) {
      throw new Error(`${candidate.username}@${candidate.host} is already added.`);
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd extensions/null-accounts && npm test`
Expected: PASS — `# fail 0` (8 tests from Task 1 plus 11 new).

- [ ] **Step 6: Commit**

```bash
git add extensions/null-accounts/src/accountStore.ts extensions/null-accounts/src/accountStore.test.ts extensions/null-accounts/package.json
git commit -m "feat: add null-accounts account store with metadata/secret separation"
```

---

### Task 3: `api.ts` — `NullAccountsApi` and its dependency seams

**Files:**
- Create: `extensions/null-accounts/src/api.ts`
- Create: `extensions/null-accounts/src/api.test.ts`
- Modify: `extensions/null-accounts/package.json` (`scripts.test`)

**Interfaces:**
- Consumes: `Account`, `Provider` from `./types`. (`AccountStore` from Task 2 satisfies `ApiDeps.accounts` structurally; `api.ts` does not import it.)
- Produces (from `api.ts`):
  - `interface NullAccountsApi { getAccounts(): Account[]; getAccountForFolder(folder: vscode.Uri): Account | undefined; getToken(account: Account, scopes?: string[]): Promise<string | undefined>; onDidChange: vscode.Event<void> }` — exactly the spec's signature.
  - `interface TokenProvider { getToken(account: Account, scopes?: string[]): Promise<string | undefined> }` — implemented by `providers/github.ts` (Phase 2) and `providers/gitlab.ts` (Phase 4). May throw; the API converts that to `undefined`.
  - `interface ApiDeps { accounts: { list(): Account[]; get(id: string): Account | undefined; onDidChange: vscode.Event<void> }; accountIdForFolder(folder: vscode.Uri): string | undefined; tokenProviders: Partial<Record<Provider, TokenProvider>> }`
  - `createApi(deps: ApiDeps): NullAccountsApi`

- [ ] **Step 1: Write the failing tests**

`extensions/null-accounts/src/api.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import type * as vscode from 'vscode';
import { ApiDeps, createApi, TokenProvider } from './api';
import { Account } from './types';

const gh: Account = { id: 'a1', provider: 'github', host: 'github.com', username: 'octocat', email: 'o@e.com', authMethod: 'oauth' };
const gl: Account = { id: 'a2', provider: 'gitlab', host: 'gitlab.com', username: 'tanuki', email: 't@e.com', authMethod: 'oauth' };
const folder = { fsPath: 'C:\\repo' } as vscode.Uri;
const noopEvent: vscode.Event<void> = () => ({ dispose() {} });

function makeDeps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  const all = [gh, gl];
  return {
    accounts: { list: () => all, get: id => all.find(a => a.id === id), onDidChange: noopEvent },
    accountIdForFolder: () => undefined,
    tokenProviders: {},
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

test('getToken dispatches to the provider for the account and passes scopes through', async () => {
  const calls: Array<[string, string[] | undefined]> = [];
  const github: TokenProvider = { getToken: async (a, scopes) => { calls.push([a.id, scopes]); return 'tok-gh'; } };
  const api = createApi(makeDeps({ tokenProviders: { github } }));
  assert.strictEqual(await api.getToken(gh, ['repo']), 'tok-gh');
  assert.deepStrictEqual(calls, [['a1', ['repo']]]);
});

test('getToken resolves undefined when no provider is registered for the account', async () => {
  const api = createApi(makeDeps({ tokenProviders: { github: { getToken: async () => 'x' } } }));
  assert.strictEqual(await api.getToken(gl), undefined);
});

test('getToken resolves undefined, never rejects, when the provider throws', async () => {
  const api = createApi(makeDeps({ tokenProviders: { github: { getToken: async () => { throw new Error('offline'); } } } }));
  assert.strictEqual(await api.getToken(gh), undefined);
});

test('onDidChange is the accounts source event', () => {
  const api = createApi(makeDeps());
  assert.strictEqual(api.onDidChange, noopEvent);
});
```

(`noopEvent` is the same reference `makeDeps` passes in, so the last test pins that the API re-exposes the store's event rather than wrapping it.)

- [ ] **Step 2: Extend the test script**

In `extensions/null-accounts/package.json`, change `scripts.test` to:

```json
"test": "tsc -p tsconfig.json && node --test out/accountInput.test.js out/accountStore.test.js out/api.test.js"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd extensions/null-accounts && npm test`
Expected: FAIL at the `tsc` step with `TS2307: Cannot find module './api'`.

- [ ] **Step 4: Write the implementation**

`extensions/null-accounts/src/api.ts`:

```ts
'use strict';

import type * as vscode from 'vscode';
import { Account, Provider } from './types';

/** Public surface other Null IDE extensions consume via `extensions.getExtension('null.null-accounts')?.exports`. */
export interface NullAccountsApi {
  getAccounts(): Account[];
  getAccountForFolder(folder: vscode.Uri): Account | undefined;
  /**
   * Resolves a token for the account, refreshing if needed. `undefined` if the user cancels
   * re-auth or no token is available. Never throws for auth failure.
   */
  getToken(account: Account, scopes?: string[]): Promise<string | undefined>;
  onDidChange: vscode.Event<void>;
}

/** One per provider (providers/github.ts, providers/gitlab.ts). May throw; the API turns that into `undefined`. */
export interface TokenProvider {
  getToken(account: Account, scopes?: string[]): Promise<string | undefined>;
}

export interface ApiDeps {
  accounts: {
    list(): Account[];
    get(id: string): Account | undefined;
    onDidChange: vscode.Event<void>;
  };
  /** Folder -> bound account id. Backed by projectBinding in Phase 2. */
  accountIdForFolder(folder: vscode.Uri): string | undefined;
  /** Filled in per provider as they land (github: Phase 2, gitlab: Phase 4). */
  tokenProviders: Partial<Record<Provider, TokenProvider>>;
}

export function createApi(deps: ApiDeps): NullAccountsApi {
  return {
    getAccounts: () => deps.accounts.list(),
    getAccountForFolder(folder) {
      const id = deps.accountIdForFolder(folder);
      return id === undefined ? undefined : deps.accounts.get(id);
    },
    async getToken(account, scopes) {
      try {
        return await deps.tokenProviders[account.provider]?.getToken(account, scopes);
      } catch {
        return undefined;
      }
    },
    onDidChange: deps.accounts.onDidChange,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd extensions/null-accounts && npm test`
Expected: PASS — `# fail 0` (19 tests from Tasks 1–2 plus 6 new). This also proves `AccountStore` and `ApiDeps` compile together only once Task 4 wires them; Task 4's `tsc` is the check for that.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-accounts/src/api.ts extensions/null-accounts/src/api.test.ts extensions/null-accounts/package.json
git commit -m "feat: add null-accounts public API with provider token seam"
```

---

### Task 4: `extension.ts` wiring and the activation spec

**Files:**
- Modify: `extensions/null-accounts/src/extension.ts`
- Create: `extensions/null-accounts/src/test/runTest.ts` (copied from `null-actions`)
- Create: `extensions/null-accounts/src/test/suite/index.ts` (copied from `null-actions`)
- Create: `extensions/null-accounts/src/test/suite/activation.spec.ts`

**Interfaces:**
- Consumes: `AccountStore` (`constructor(meta: MetadataStore, secrets: SecretVault)`) from `./accountStore`; `createApi`, `NullAccountsApi` from `./api`.
- Produces: `activate(context: vscode.ExtensionContext): NullAccountsApi` — its return value becomes the extension's `exports`. Phase 2 edits this function to pass the real folder resolver and register the GitHub token provider.

- [ ] **Step 1: Wire `activate`**

Replace the contents of `extensions/null-accounts/src/extension.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import { AccountStore } from './accountStore';
import { createApi, NullAccountsApi } from './api';

export function activate(context: vscode.ExtensionContext): NullAccountsApi {
  const store = new AccountStore(context.globalState, context.secrets);
  // Phase 2 swaps the resolver for projectBinding and registers the github token provider;
  // Phase 4 adds gitlab. Until then no folder is bound and no provider can issue tokens.
  return createApi({
    accounts: store,
    accountIdForFolder: () => undefined,
    tokenProviders: {},
  });
}

export function deactivate(): void {}
```

- [ ] **Step 2: Compile to check the real VS Code types line up**

`context.globalState` must satisfy `MetadataStore`, `context.secrets` must satisfy `SecretVault`, and `AccountStore` must satisfy `ApiDeps.accounts` — only the compiler can confirm this.

Run: `cd extensions/null-accounts && npm run compile`
Expected: exits 0 with no type errors. If `Memento.get` or `update` is reported as incompatible with `MetadataStore`, adjust the `MetadataStore` signature in `accountStore.ts` to match (do not cast in `extension.ts`).

- [ ] **Step 3: Copy the integration harness from `null-actions`**

Only the extension name differs; copying keeps the long explanatory comments about the mutex collision and `ELECTRON_RUN_AS_NODE` intact.

Run:
```bash
mkdir -p extensions/null-accounts/src/test/suite
sed 's/null-actions/null-accounts/g' extensions/null-actions/src/test/runTest.ts > extensions/null-accounts/src/test/runTest.ts
cp extensions/null-actions/src/test/suite/index.ts extensions/null-accounts/src/test/suite/index.ts
grep -c "null-actions" extensions/null-accounts/src/test/runTest.ts extensions/null-accounts/src/test/suite/index.ts
```
Expected: both counts are `0`.

- [ ] **Step 4: Write the activation spec**

`extensions/null-accounts/src/test/suite/activation.spec.ts`:

```ts
'use strict';

import * as assert from 'assert';
import * as vscode from 'vscode';
import { NullAccountsApi } from '../../api';

suite('null-accounts activation', () => {
  test('activates and exports a working API', async () => {
    const extension = vscode.extensions.getExtension<NullAccountsApi>('null.null-accounts');
    assert.ok(extension, 'null.null-accounts extension not found');

    const api = await extension!.activate();
    assert.ok(api, 'activate() returned no API');

    // The run uses a fresh --user-data-dir, so no accounts exist yet.
    assert.deepStrictEqual(api.getAccounts(), []);
    assert.strictEqual(api.getAccountForFolder(vscode.Uri.file(process.cwd())), undefined);

    const stranger = { id: 'x', provider: 'github', host: 'github.com', username: 'u', email: 'u@e.com', authMethod: 'oauth' } as const;
    assert.strictEqual(await api.getToken(stranger), undefined);
  });
});
```

- [ ] **Step 5: Compile everything including the spec**

Run: `cd extensions/null-accounts && npm run compile && npm test`
Expected: compile exits 0; `npm test` shows `# fail 0`. (The spec itself runs against the real build in Task 5, once the extension is synced.)

- [ ] **Step 6: Commit**

```bash
git add extensions/null-accounts/src
git commit -m "feat: wire null-accounts activation and add activation spec"
```

---

### Task 5: Build and repo wiring, then verify in the real build

**Files:**
- Modify: `.github/workflows/build.yml` (after the `Compile null-actions TypeScript` step ~line 177; and the `Copy built-in extensions` block ~line 199)
- Modify: `scripts/build-local.ps1:361` and `:378`
- Modify: `scripts/sync-local.ps1` (the `$Extensions` table, after the `"null-actions"` entry ~line 244)
- Modify: `CLAUDE.md` (lines 12–13, repo layout, build steps 9–10, new extension section)

**Interfaces:**
- Consumes: the compiled `extensions/null-accounts/` from Tasks 1–4.
- Produces: `null-accounts` shipped as a built-in extension in CI, local builds, and `sync-local` runs; documented in `CLAUDE.md`.

- [ ] **Step 1: `build.yml` — compile step**

Directly after the `Compile null-actions TypeScript` step and before `Compile null-format TypeScript`, insert:

```yaml
      - name: Compile null-accounts TypeScript
        shell: pwsh
        run: |
          Set-Location ide-overlay/extensions/null-accounts
          npm ci --ignore-scripts
          npm run compile

```

- [ ] **Step 2: `build.yml` — copy step**

In the `Copy built-in extensions` block, directly after the `null-actions` line, add (note the three spaces of padding, matching `null-markdown`):

```yaml
          Copy-Item -Recurse -Force ide-overlay/extensions/null-accounts   vscode-src/extensions/
```

- [ ] **Step 3: `build-local.ps1` — both extension lists**

Line 361 becomes:

```powershell
foreach ($ext in @("null-tools", "null-cpp", "null-actions", "null-accounts", "null-format")) {
```

Line 378 becomes:

```powershell
foreach ($ext in @("null-theme", "null-tools", "null-icons", "null-markdown", "null-cpp", "null-actions", "null-accounts", "null-format")) {
```

- [ ] **Step 4: `sync-local.ps1` — extension table entry**

In the `$Extensions` table, directly after the `"null-actions"` entry and before `"null-format"`, insert:

```powershell
    "null-accounts" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out"
        )
    }

```

- [ ] **Step 5: Update `CLAUDE.md`**

Make these edits:

1. Line 12: change `Seven built-in extensions` to `Eight built-in extensions` and append `, \`null-accounts\`` after `` `null-actions` `` (before `` `null-format` ``).
2. Line 13: change `bundled as an eighth built-in extension` to `bundled as a ninth built-in extension`.
3. Repo layout tree: under `extensions/`, after the `null-actions/` block, add (switching the `null-actions` connectors from `└──`/` ` to `├──`/`│` as needed so the tree stays well-formed):

   ```
   │   └── null-accounts/          # GitHub/GitLab account manager and token API
   │       ├── src/                # TypeScript source (accountStore.ts, accountInput.ts, api.ts, extension.ts)
   │       └── out/                # Compiled JS output (built during CI)
   ```
4. "How the Build Works": insert a new step 10, `Compile \`null-accounts\` TypeScript (\`npm ci && npm run compile\` in \`extensions/null-accounts/\`).`, renumber the following steps (old 10–22 become 11–23), and in the copy step change `all seven built-in extensions` to `all eight built-in extensions` and add `` `null-accounts` `` to its list.
5. Add a section after `### null-actions` and before `### wooting-analog — archived`:

   ```markdown
   ### null-accounts (`extensions/null-accounts/`)
   GitHub/GitLab account manager (issue #102). Activated on `onStartupFinished`; exports `NullAccountsApi` (`getAccounts`, `getAccountForFolder`, `getToken`, `onDidChange`) via `extensions.getExtension('null.null-accounts')?.exports`. Account metadata lives in `globalState`, secrets in `SecretStorage` under `null-accounts/<id>`; `Account.host` is a bare lowercase hostname. **Status: foundation only** — store and API exist; project binding, the GitHub/GitLab providers, UI, and git wiring land in later phases. Design: `docs/specs/null-accounts-design.md`; phase plans: `docs/plans/null-accounts-phase*.md`.
   ```

(README's built-in extensions table and `PRODUCT.md` are intentionally not touched yet — nothing user-visible exists until Phase 3.)

- [ ] **Step 6: Check that nothing else lists the extensions**

Use the Grep tool for `null-actions` over the repo excluding `docs/plans`, `docs/specs`, `graphify-out`, `node_modules`, `package-lock.json` and `extensions/null-actions/`.
Expected: every remaining hit is either a place you just added `null-accounts` next to, or one the plan deliberately skips (`README.md`, `PRODUCT.md`, `.claude/product-audit/*`). Any other hit is a missed wiring site — add `null-accounts` there.

- [ ] **Step 7: Verify in the real Null IDE build**

`scripts/sync-local.ps1` replaces files in the installed Null IDE and may close running Null IDE windows, so confirm with the user before running it, then use the `verify-local` skill with target extension `null-accounts` (it syncs the build and runs `npm run test:integration`).
Expected: the `null-accounts activation` spec passes (1 passing). If `Synced null-accounts not found` appears, the sync entry from Step 4 is wrong.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/build.yml scripts/build-local.ps1 scripts/sync-local.ps1 CLAUDE.md
git commit -m "feat: ship null-accounts as a built-in extension"
```

---

## Self-Review

**Spec coverage (Phase 1 = "extension skeleton, types, accountStore, API, build wiring"):**
- Extension skeleton, manifest, `onStartupFinished` → Task 1.
- `types.ts` (`Account`, `Provider`, `AuthMethod`) → Task 1. `Binding` → deferred to Phase 2 (first user), noted in Task 1.
- `accountStore` — CRUD, metadata in `globalState`, secrets in `SecretStorage` as `null-accounts/<id>`, `onDidChange` → Task 2.
- `api.ts` — `NullAccountsApi` exactly as in the spec, `getToken` never throws → Task 3; exported from `activate()` → Task 4.
- Build wiring (`build.yml`, `build-local.ps1`, `sync-local.ps1`) and `CLAUDE.md` (count, layout, section) → Task 5. README/PRODUCT.md deferred to Phase 3 on purpose.
- Spec Testing, unit part for accountStore (CRUD, secret separation) → Task 2; `verify-local` integration → activation spec here, the full bind/credential spec in Phase 6.
- Not in this plan (by phase): `null-tools` `extensionDependencies` and Issues migration → Phase 2 (adding the dependency earlier would make `null-tools` fail to activate whenever `null-accounts` does, with nothing gained); "account removed while bound clears bindings" → Phase 2 (`projectBinding` listens to `onDidChange`); GitLab OAuth app registration → Phase 4; "needs re-auth" flag and notification → Phases 2/4 (needs a provider that can fail).

**Placeholder scan:** no TBD/TODO steps. The two deliberate seams (`accountIdForFolder: () => undefined`, `tokenProviders: {}`) are real, tested behaviour for "nothing bound / no provider", with the replacing phase named in the code comments.

**Type consistency:** `MetadataStore`/`SecretVault`/`ACCOUNTS_KEY`/`AccountStore` names match between Task 2's interfaces, tests and implementation. `NewAccount`, `Account`, `validateNewAccount` match across Tasks 1–2. `ApiDeps.accounts` (`list`, `get`, `onDidChange`) is a subset of `AccountStore`'s public members; `TokenProvider` and `createApi` signatures match between Task 3 and Task 4's call. `onDidChange` is `vscode.Event<void>` on both the store (via `import type { Event }`) and the API.

**Review Focus:** line 1 → Task 2 duplicate test; line 2 → Task 2 corrupt-data test; line 3 → Task 1 `normalizeHost` tests; line 4 → Task 3 no-provider and throwing-provider tests; line 5 → Task 2 unknown-remove and failed-add-no-orphan tests.

# Null Accounts — Phase 6: Git Wiring Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Make git itself use the account a folder is bound to: repo-local identity (`user.name` / `user.email`), the right credential for that account's host, and an SSH key when an account has one — applied on bind and rebind, undone on unbind, and kept fresh as GitLab tokens rotate.

**Architecture:** Same split as Phases 1–5: logic with branches lives in modules that never import `vscode` at runtime and take every side effect as an injected dependency. `git.ts` gains `runGit` (the one place a `git` process is spawned; never rejects, never prompts). `gitPlan.ts` is the pure "account → config keys + credential target" function. `GitWiring` (repo-local config) and `CredentialSync` (OS credential store) each *reconcile* against the current bindings and accounts rather than reacting to individual events, so they are idempotent, restart-safe and cheap to call often; both run their work through `serial()` so a burst of changes can't interleave. Only `extension.ts` touches `vscode`: it triggers a reconcile on every change, on every refreshed token and every 5 minutes.

**Tech Stack:** TypeScript (strict), `node:child_process` `execFile`, `node --test` + `node:assert`, the real `git` binary in unit tests (as `git.test.ts` already does), `git config --local`, `git credential approve|reject`.

**Spec:** `docs/specs/null-accounts-design.md` (issue #102), sections "Git wiring", "Error handling", "Security" and "Delivery phases". This is plan 6 of 7: (1) Foundation, (2) GitHub + binding, (3) UI, (4) Accounts menu, (5) GitLab — all landed (`docs/plans/null-accounts-phase{1,2,3,4,5}-*.md`); (6) Git wiring ← this plan; (7) Integration.

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

- Phase 1–5 constraints still hold: every `.ts` file starts with `'use strict';`; unit-tested modules do not import `vscode` at runtime (`import type` is fine); secrets only in `SecretStorage` and never logged; edit TypeScript sources only — `extensions/null-accounts/out/` is tracked but regenerated with `npm run compile` and committed alone in a `chore: refresh null-accounts compiled output` commit; commit after each task, message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; do not push.
- Run tests with `npm --prefix extensions/null-accounts test` (it runs `tsc` first, then `node --test` over the files listed in `scripts.test`; a new test file must be appended to that list in the task that creates it). To run one file: `cd extensions/null-accounts && npx tsc -p tsconfig.json && node --test out/<file>.test.js`.
- **Repo-local only.** Global and system git config are never modified. Everything goes through `git config --local` in the bound folder (spec: "Git reach").
- **Every value reaches git as an argv element or on stdin, never through a shell string.** (The one exception is `core.sshCommand`, whose *value* git runs through a shell — its key path is single-quoted by `planFor`.)
- **A token only ever travels on stdin** to `git credential approve`. It is never an argument, never logged, never in an error message, and never persisted outside `SecretStorage` (the `CredentialSync` record holds host + username only).
- The credential is looked up by (host, username). `Account.host` may carry a port (`git.example.org:8443`), which is exactly git's `host=` form.
- GitHub tokens come from `api.getToken(account)` with no `interactive` flag — wiring must **never open a prompt**. No token ⇒ the identity is still written, the credential is skipped, and the next sync tries again.
- **Deviations from the spec** (each one is applied to the spec in Task 6):
  1. The username key is `credential.https://<host>.username` (the documented URL form; scoped to https remotes), not `credential.<host>.username`. Verified against git 2.56: both match, the URL form is the one the docs promise.
  2. Unbinding **restores the value that was there before** (`null` ⇒ unset), instead of only removing our keys, and leaves a value alone if the user changed it after we wrote it. The spec's "remove the keys this extension set" would delete a `user.email` the user had set by hand.
  3. `core.sshCommand` single-quotes the key path (no shell expansion), writes it with forward slashes, and expands a leading `~/`.
  4. The OS credential is withdrawn (`git credential reject`) when **no folder uses the account any more** — the spec only says the token exists in two places and doesn't say when the second copy goes away.
  5. A 5-minute poll keeps the OS-store token current while the IDE stays open: GitLab tokens last ~2 h and nothing else would refresh them for a session that only uses a terminal.
  6. Reasons for skipping are shown as a warning **only when actionable** (git missing, SSH key missing, git refusing a setting) and only for open workspace folders, once per session. "Not a repository" and "folder is gone" are silent: a plain folder bound to an account for the Issues panel is not an error.
- Not in this phase: any UI to *create* an SSH account (the model, validation and `planFor` already handle `authMethod: 'ssh'`; nothing in the Add Account flow produces one yet), the dashboard showing each project's account and the end-to-end `verify-local` spec (Phase 7), `git config` for submodules, `includeIf`, or git worktrees (a worktree shares its repo's `.git/config`, so binding two worktrees of one repo to different accounts makes the last write win).

## Review Focus

Inputs the spec implies but doesn't spell out, most likely to bite first. Each has a test in the owning task.

1. **A repo that already has a hand-set `user.email`** — binding must not lose it: unbinding puts it back, and a value the user edits *after* we wrote ours is never overwritten or deleted. (Task 3)
2. **Two folders on one account** — the OS credential belongs to the account, so unbinding one folder must not withdraw the token the other still uses. (Task 4)
3. **A token containing a newline, or a username that does** — would add a forged `host=` / `password=` line to `git credential` input. Refused, nothing sent. (Task 4)
4. **A bound folder that was deleted, is not a repo, or git is not installed** — three different outcomes. Git reports a missing folder exactly like a missing `git` (`ENOENT`), so the folder is checked first; only real "git missing" keeps a cleanup record for retry and warns. (Tasks 1, 3)
5. **A burst of changes** (bind → rebind → edit email, or the 5-minute poll landing mid-change) — reconciles are serialised and a no-change reconcile spawns no git process. (Tasks 1, 3)

---

### Task 1: Git plumbing (`runGit`, `serial`)

**Files:**
- Modify: `extensions/null-accounts/src/git.ts`
- Modify: `extensions/null-accounts/src/git.test.ts`
- Create: `extensions/null-accounts/src/serial.ts`
- Create: `extensions/null-accounts/src/serial.test.ts`
- Modify: `extensions/null-accounts/package.json` (`scripts.test`)

**Interfaces:**
- Consumes: nothing.
- Produces (Tasks 3–5 import these exact names):
  - `interface GitResult { code: number; stdout: string; stderr: string }`
  - `const GIT_UNAVAILABLE = -1` — `code` when git could not be started (not installed, or `cwd` does not exist)
  - `type GitRun = (cwd: string, args: string[], input?: string) => Promise<GitResult>` — never rejects
  - `const runGit: GitRun`
  - `serial(): <T>(task: () => Promise<T>) => Promise<T>` in `serial.ts`

- [ ] **Step 1: Write the failing tests**

In `extensions/null-accounts/src/git.test.ts` change the import line to:

```ts
import { GIT_UNAVAILABLE, originUrl, runGit } from './git';
```

and append:

```ts
test('runGit reports the exit code, feeds stdin, and tells "git could not start" apart from "git said no"', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'null-accounts-rungit-'));
  try {
    const notRepo = await runGit(dir, ['rev-parse', '--is-inside-work-tree']);
    assert.strictEqual(notRepo.code, 128);
    assert.notStrictEqual(notRepo.stderr, '');

    // The blob id of "hello\n" is fixed, so a matching id proves the input reached git's stdin.
    const hashed = await runGit(dir, ['hash-object', '--stdin'], 'hello\n');
    assert.deepStrictEqual([hashed.code, hashed.stdout.trim()], [0, 'ce013625030ba8dba906f756967f9e9ca394464a']);

    const gone = await runGit(path.join(dir, 'does-not-exist'), ['--version']);
    assert.strictEqual(gone.code, GIT_UNAVAILABLE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Create `extensions/null-accounts/src/serial.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { serial } from './serial';

test('serial runs tasks one at a time, in the order they were queued', async () => {
  const run = serial();
  const log: string[] = [];
  const slow = run(async () => { log.push('a:start'); await new Promise(r => setTimeout(r, 20)); log.push('a:end'); });
  const fast = run(async () => { log.push('b'); });
  await Promise.all([slow, fast]);
  assert.deepStrictEqual(log, ['a:start', 'a:end', 'b']);
});

test('serial: a failing task rejects its own caller but not the queue behind it', async () => {
  const run = serial();
  const failed = run(async () => { throw new Error('boom'); });
  const next = run(async () => 'still runs');
  await assert.rejects(failed, /boom/);
  assert.strictEqual(await next, 'still runs');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extensions/null-accounts && npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './serial'` and `Module './git' has no exported member 'runGit'`.

- [ ] **Step 3: Implement**

Append to `extensions/null-accounts/src/git.ts`:

```ts
export interface GitResult { code: number; stdout: string; stderr: string }

/** `GitResult.code` when git could not be started at all: not installed, or `cwd` does not exist. */
export const GIT_UNAVAILABLE = -1;

/** Runs `git <args>` in `cwd`, feeding `input` to stdin. Never rejects, never prompts. */
export type GitRun = (cwd: string, args: string[], input?: string) => Promise<GitResult>;

export const runGit: GitRun = (cwd, args, input) => new Promise(resolve => {
  const child = execFile(
    'git',
    args,
    { cwd, timeout: 10_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (err, stdout, stderr) => {
      if (!err) { resolve({ code: 0, stdout, stderr }); return; }
      // A non-zero exit has a numeric `code`; a failure to start git has a string one ('ENOENT') or none.
      const code = (err as { code?: unknown }).code;
      resolve({ code: typeof code === 'number' ? code : GIT_UNAVAILABLE, stdout, stderr: stderr || err.message });
    },
  );
  child.stdin?.on('error', () => { /* git exited before reading its input; the exit code says what happened */ });
  child.stdin?.end(input ?? '');
});
```

Create `extensions/null-accounts/src/serial.ts`:

```ts
'use strict';

/** Runs the tasks it is given one at a time, in order; a task that fails doesn't stop the ones queued behind it. */
export function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return task => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}
```

- [ ] **Step 4: Register the tests and run them**

In `extensions/null-accounts/package.json`, append ` out/serial.test.js` to the end of the `scripts.test` file list (after `out/providers/gitlab.test.js`).

Run: `npm --prefix extensions/null-accounts test`
Expected: PASS, including the new `runGit` and two `serial` tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-accounts/src/git.ts extensions/null-accounts/src/git.test.ts extensions/null-accounts/src/serial.ts extensions/null-accounts/src/serial.test.ts extensions/null-accounts/package.json
git commit -m "feat(null-accounts): add runGit and serial for git wiring" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The wiring plan (`gitPlan.ts`)

**Files:**
- Create: `extensions/null-accounts/src/gitPlan.ts`
- Test: `extensions/null-accounts/src/gitPlan.test.ts`
- Modify: `extensions/null-accounts/package.json` (`scripts.test`)

**Interfaces:**
- Consumes: `Account` from `types.ts`.
- Produces (Tasks 3–4 import these exact names):
  - `interface ConfigEntry { key: string; value: string }`
  - `interface CredentialTarget { host: string; username: string }`
  - `interface WiringPlan { config: ConfigEntry[]; credential?: CredentialTarget }`
  - `planFor(account: Account, home: string): WiringPlan` — `config` is `user.name`, `user.email`, then either `core.sshCommand` (SSH) or `credential.https://<host>.username` (everything else)
  - `sshKeyFile(account: Account, home: string): string` — the key path with `~/` expanded and `/` separators; `''` when the account has none
  - `credentialFor(account: Account): CredentialTarget | undefined` — `undefined` for SSH accounts

- [ ] **Step 1: Write the failing tests**

Create `extensions/null-accounts/src/gitPlan.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { credentialFor, planFor, sshKeyFile } from './gitPlan';
import { Account } from './types';

const github: Account = {
  id: 'a1', provider: 'github', host: 'github.com', username: 'octocat', email: 'octo@example.com', authMethod: 'oauth',
};

test('a token account gets its identity, a host-scoped credential username, and a credential-store entry', () => {
  assert.deepStrictEqual(planFor(github, '/home/me'), {
    config: [
      { key: 'user.name', value: 'octocat' },
      { key: 'user.email', value: 'octo@example.com' },
      { key: 'credential.https://github.com.username', value: 'octocat' },
    ],
    credential: { host: 'github.com', username: 'octocat' },
  });
});

test('a self-hosted host keeps its port in the credential key and target', () => {
  const gitlab: Account = { ...github, provider: 'gitlab', host: 'git.example.org:8443', username: 'eve', authMethod: 'https' };
  const plan = planFor(gitlab, '/home/me');
  assert.ok(plan.config.some(e => e.key === 'credential.https://git.example.org:8443.username' && e.value === 'eve'));
  assert.deepStrictEqual(plan.credential, { host: 'git.example.org:8443', username: 'eve' });
});

test('an SSH account sets core.sshCommand with the key in single quotes and no credential entry', () => {
  const ssh: Account = { ...github, authMethod: 'ssh', sshKeyPath: 'C:\\Users\\me\\.ssh\\id work' };
  const plan = planFor(ssh, 'C:\\Users\\me');
  assert.deepStrictEqual(plan.config.at(-1), {
    key: 'core.sshCommand', value: `ssh -i 'C:/Users/me/.ssh/id work' -o IdentitiesOnly=yes`,
  });
  assert.strictEqual(plan.credential, undefined);
  assert.strictEqual(credentialFor(ssh), undefined);
});

test('~ in an SSH key path expands to the home directory, and a quote in the path cannot end the quoting', () => {
  const ssh: Account = { ...github, authMethod: 'ssh', sshKeyPath: '~/.ssh/it\'s; rm -rf ~' };
  assert.strictEqual(sshKeyFile(ssh, 'C:\\Users\\me\\'), `C:/Users/me/.ssh/it's; rm -rf ~`);
  assert.strictEqual(planFor(ssh, '/home/me').config.at(-1)?.value, `ssh -i '/home/me/.ssh/it'\\''s; rm -rf ~' -o IdentitiesOnly=yes`);
});

test('an SSH account without a key path plans an empty key, which the caller reports as a missing file', () => {
  assert.strictEqual(sshKeyFile({ ...github, authMethod: 'ssh' }, '/home/me'), '');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extensions/null-accounts && npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './gitPlan'`.

- [ ] **Step 3: Implement**

Create `extensions/null-accounts/src/gitPlan.ts`:

```ts
'use strict';

import { Account } from './types';

export interface ConfigEntry { key: string; value: string }

/** The OS credential-store entry git looks up for a host + username. */
export interface CredentialTarget { host: string; username: string }

export interface WiringPlan {
  /** Repo-local git config (`git config --local`) to apply, in order. */
  config: ConfigEntry[];
  /** Present for token-based accounts; SSH accounts authenticate with their key instead. */
  credential?: CredentialTarget;
}

/** "~/.ssh/id" -> "<home>/.ssh/id"; backslashes become slashes (git runs `core.sshCommand` through a POSIX shell). */
export function sshKeyFile(account: Account, home: string): string {
  const raw = account.sshKeyPath?.trim() ?? '';
  const expanded = /^~[\\/]/.test(raw) ? `${home.replace(/[\\/]+$/, '')}/${raw.slice(2)}` : raw;
  return expanded.replace(/\\/g, '/');
}

/** The credential entry for a token account (GitHub OAuth, GitLab OAuth or access token); SSH accounts have none. */
export function credentialFor(account: Account): CredentialTarget | undefined {
  return account.authMethod === 'ssh' ? undefined : { host: account.host, username: account.username };
}

// Single quotes: the shell expands nothing inside them, so a key path can't smuggle in a command.
const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

export function planFor(account: Account, home: string): WiringPlan {
  const config: ConfigEntry[] = [
    { key: 'user.name', value: account.username },
    { key: 'user.email', value: account.email },
  ];
  if (account.authMethod === 'ssh') {
    config.push({ key: 'core.sshCommand', value: `ssh -i ${shellQuote(sshKeyFile(account, home))} -o IdentitiesOnly=yes` });
    return { config };
  }
  // The URL form of the key is the documented one and scopes the username to https remotes on this host.
  config.push({ key: `credential.https://${account.host}.username`, value: account.username });
  return { config, credential: credentialFor(account) };
}
```

- [ ] **Step 4: Register the test and run it**

Append ` out/gitPlan.test.js` to `scripts.test` in `extensions/null-accounts/package.json`.

Run: `npm --prefix extensions/null-accounts test`
Expected: PASS (5 new tests).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-accounts/src/gitPlan.ts extensions/null-accounts/src/gitPlan.test.ts extensions/null-accounts/package.json
git commit -m "feat(null-accounts): plan the git config and credential for an account" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Repo-local wiring (`GitWiring`)

**Files:**
- Create: `extensions/null-accounts/src/gitWiring.ts`
- Test: `extensions/null-accounts/src/gitWiring.test.ts`
- Modify: `extensions/null-accounts/package.json` (`scripts.test`)

**Interfaces:**
- Consumes: `MetadataStore` (`accountStore.ts`), `GIT_UNAVAILABLE` / `GitRun` (Task 1), `planFor` / `sshKeyFile` / `WiringPlan` (Task 2), `serial` (Task 1), `Account`.
- Produces (Task 5 imports these exact names):
  - `WIRING_KEY = 'null-accounts.gitWiring'` — `globalState` key; value `Record<folderKey, { accountId, entries: { key, value, previous: string | null }[] }>`
  - `type SkipReason = 'folder-missing' | 'git-missing' | 'not-a-repo' | 'ssh-key-missing' | 'config-failed'`
  - `type WireOutcome = { folder: string; status: 'unchanged' | 'wired' | 'cleared' } | { folder: string; status: 'skipped'; reason: SkipReason; detail?: string }`
  - `interface WiringDeps { meta: MetadataStore; git: GitRun; bindings: { entries(): [string, string][] }; accounts: { get(id: string): Account | undefined }; exists(path: string): boolean; home: string }` — `bindings` is `ProjectBinding` as is
  - `class GitWiring { constructor(deps: WiringDeps); reconcile(): Promise<WireOutcome[]> }`
  - `describeSkip(outcome: Extract<WireOutcome, { status: 'skipped' }>, folderName: string): string | undefined` — `undefined` for `not-a-repo` / `folder-missing`

How `reconcile` decides (read this before the code): for every folder that is bound **or** has a record from an earlier run, it looks up the folder's account. No account (unbound, or the account was removed) ⇒ undo the record. Otherwise compute the plan; if the record already holds exactly that plan ⇒ `unchanged` with **no git process**. Else check the folder exists, the SSH key exists (SSH accounts), and `git rev-parse` says it is a work tree; then undo the old record, and for each plan key remember its current value as `previous` and write the new one.

- [ ] **Step 1: Write the failing tests**

Create `extensions/null-accounts/src/gitWiring.test.ts` (these run against real throw-away repos, like `git.test.ts`, so they prove git's own behaviour — URL-form subsection keys, `--unset-all`, restoring values):

```ts
'use strict';

import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { GIT_UNAVAILABLE, GitRun, runGit } from './git';
import { describeSkip, GitWiring } from './gitWiring';
import { FakeMeta } from './testFakes';
import { Account } from './types';

const scratch = mkdtempSync(path.join(tmpdir(), 'null-accounts-wiring-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
function makeRepo(): string {
  const dir = path.join(scratch, `repo-${++n}`);
  execFileSync('git', ['init', '-q', dir]);
  return dir;
}
const config = (dir: string, key: string): string | undefined => {
  try { return execFileSync('git', ['config', '--local', '--get', key], { cwd: dir, encoding: 'utf8' }).trim(); } catch { return undefined; }
};

const alice: Account = {
  id: 'a1', provider: 'github', host: 'github.com', username: 'alice', email: 'alice@example.com', authMethod: 'oauth',
};
const bob: Account = {
  id: 'a2', provider: 'gitlab', host: 'git.example.org:8443', username: 'bob', email: 'bob@example.org', authMethod: 'https',
};
const CRED_ALICE = 'credential.https://github.com.username';

function setup(initial: Array<[string, Account]>, git: GitRun = runGit) {
  const meta = new FakeMeta();
  const accounts = new Map(initial.map(([, a]) => [a.id, a]));
  const bound = new Map(initial.map(([folder, a]) => [folder, a.id]));
  const calls: string[][] = [];
  const counting: GitRun = (cwd, args, input) => { calls.push(args); return git(cwd, args, input); };
  const make = () => new GitWiring({
    meta, git: counting, home: '/home/me', exists: existsSync,
    bindings: { entries: () => [...bound.entries()] },
    accounts: { get: id => accounts.get(id) },
  });
  return { meta, accounts, bound, calls, wiring: make(), make };
}

test('binding writes the identity and the credential username into the repo, and nothing outside it', async () => {
  const dir = makeRepo();
  const { wiring } = setup([[dir, alice]]);
  assert.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'wired' }]);
  assert.strictEqual(config(dir, 'user.name'), 'alice');
  assert.strictEqual(config(dir, 'user.email'), 'alice@example.com');
  assert.strictEqual(config(dir, CRED_ALICE), 'alice');
});

test('a second reconcile with nothing changed runs no git at all', async () => {
  const dir = makeRepo();
  const { wiring, calls } = setup([[dir, alice]]);
  await wiring.reconcile();
  calls.length = 0;
  assert.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'unchanged' }]);
  assert.deepStrictEqual(calls, []);
});

test('rebinding swaps every value and drops keys the new account does not use', async () => {
  const dir = makeRepo();
  const { wiring, bound, accounts } = setup([[dir, alice]]);
  accounts.set(bob.id, bob);
  await wiring.reconcile();
  bound.set(dir, bob.id);
  assert.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'wired' }]);
  assert.strictEqual(config(dir, 'user.email'), 'bob@example.org');
  assert.strictEqual(config(dir, 'credential.https://git.example.org:8443.username'), 'bob');
  assert.strictEqual(config(dir, CRED_ALICE), undefined);
});

test('unbinding restores what the repo had before, and removes what it did not', async () => {
  const dir = makeRepo();
  execFileSync('git', ['config', '--local', 'user.email', 'me@work.example'], { cwd: dir });
  const { wiring, bound } = setup([[dir, alice]]);
  await wiring.reconcile();
  assert.strictEqual(config(dir, 'user.email'), 'alice@example.com');

  bound.delete(dir);
  assert.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'cleared' }]);
  assert.strictEqual(config(dir, 'user.email'), 'me@work.example');
  assert.strictEqual(config(dir, 'user.name'), undefined);
  assert.strictEqual(config(dir, CRED_ALICE), undefined);
  assert.deepStrictEqual(await wiring.reconcile(), []); // forgotten: nothing left to visit
});

test('a value the user changed after we wrote it is left alone on unbind', async () => {
  const dir = makeRepo();
  const { wiring, bound } = setup([[dir, alice]]);
  await wiring.reconcile();
  execFileSync('git', ['config', '--local', 'user.email', 'edited@by.hand'], { cwd: dir });
  bound.delete(dir);
  await wiring.reconcile();
  assert.strictEqual(config(dir, 'user.email'), 'edited@by.hand');
  assert.strictEqual(config(dir, 'user.name'), undefined);
});

test('removing the account clears its folders, even after a restart (the record lives in the metadata store)', async () => {
  const dir = makeRepo();
  const { wiring, accounts, meta, make } = setup([[dir, alice]]);
  await wiring.reconcile();
  accounts.delete(alice.id);
  const restarted = make(); // same meta, new instance
  assert.deepStrictEqual(await restarted.reconcile(), [{ folder: dir, status: 'cleared' }]);
  assert.strictEqual(config(dir, 'user.email'), undefined);
  assert.deepStrictEqual(meta.data.get('null-accounts.gitWiring'), {});
});

test('editing the account email rewrites the repo', async () => {
  const dir = makeRepo();
  const { wiring, accounts } = setup([[dir, alice]]);
  await wiring.reconcile();
  accounts.set(alice.id, { ...alice, email: 'new@example.com' });
  assert.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'wired' }]);
  assert.strictEqual(config(dir, 'user.email'), 'new@example.com');
});

test('a bound folder that is not a repo, or does not exist, is skipped without being mistaken for "git missing"', async () => {
  const plain = path.join(scratch, 'plain');
  mkdirSync(plain);
  const gone = path.join(scratch, 'gone');
  const { wiring } = setup([[plain, alice], [gone, alice]]);
  const outcomes = await wiring.reconcile();
  const byFolder = Object.fromEntries(outcomes.map(o => [o.folder, o]));
  assert.strictEqual(byFolder[plain].status, 'skipped');
  assert.strictEqual((byFolder[plain] as { reason: string }).reason, 'not-a-repo');
  assert.strictEqual((byFolder[gone] as { reason: string }).reason, 'folder-missing');
  assert.strictEqual(describeSkip(byFolder[plain] as never, 'plain'), undefined);
  assert.strictEqual(describeSkip(byFolder[gone] as never, 'gone'), undefined);
});

test('git not being installed skips with a warning and keeps the record so cleanup is retried', async () => {
  const dir = makeRepo();
  let installed = true;
  const flaky: GitRun = (cwd, args, input) =>
    installed ? runGit(cwd, args, input) : Promise.resolve({ code: GIT_UNAVAILABLE, stdout: '', stderr: 'spawn git ENOENT' });
  const { wiring, bound } = setup([[dir, alice]], flaky);
  await wiring.reconcile();

  bound.delete(dir);
  installed = false;
  const [offline] = await wiring.reconcile();
  assert.deepStrictEqual(offline, { folder: dir, status: 'skipped', reason: 'git-missing' });
  assert.match(describeSkip(offline as never, 'repo') ?? '', /git was not found/);
  assert.strictEqual(config(dir, 'user.email'), 'alice@example.com'); // untouched

  installed = true;
  assert.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'cleared' }]);
  assert.strictEqual(config(dir, 'user.email'), undefined);
});

test('an SSH account writes core.sshCommand; a missing key file changes nothing and names the file', async () => {
  const dir = makeRepo();
  const key = path.join(scratch, 'id_work');
  const ssh: Account = { ...alice, id: 'a3', authMethod: 'ssh', sshKeyPath: key };
  const { wiring, accounts } = setup([[dir, ssh]]);
  const [missing] = await wiring.reconcile();
  assert.deepStrictEqual(missing, { folder: dir, status: 'skipped', reason: 'ssh-key-missing', detail: key.replace(/\\/g, '/') });
  assert.match(describeSkip(missing as never, 'repo') ?? '', /SSH key .*id_work.* was not found/);
  assert.strictEqual(config(dir, 'user.email'), undefined);

  writeFileSync(key, 'not a real key');
  assert.deepStrictEqual(await wiring.reconcile(), [{ folder: dir, status: 'wired' }]);
  assert.strictEqual(config(dir, 'core.sshCommand'), `ssh -i '${key.replace(/\\/g, '/')}' -o IdentitiesOnly=yes`);
  assert.strictEqual(config(dir, CRED_ALICE), undefined);
  assert.ok(accounts.has('a3'));
});

test('rebinding to an SSH account whose key is missing still removes the previous account from the repo', async () => {
  const dir = makeRepo();
  const ssh: Account = { ...bob, id: 'a3', authMethod: 'ssh', sshKeyPath: path.join(scratch, 'nope') };
  const { wiring, bound, accounts } = setup([[dir, alice]]);
  accounts.set(ssh.id, ssh);
  await wiring.reconcile();
  bound.set(dir, ssh.id);
  const [outcome] = await wiring.reconcile();
  assert.strictEqual((outcome as { reason: string }).reason, 'ssh-key-missing');
  assert.strictEqual(config(dir, 'user.email'), undefined);
});

test('overlapping reconciles are serialised: two rapid calls leave one consistent result', async () => {
  const dir = makeRepo();
  const { wiring } = setup([[dir, alice]]);
  const [first, second] = await Promise.all([wiring.reconcile(), wiring.reconcile()]);
  assert.strictEqual(first[0].status, 'wired');
  assert.strictEqual(second[0].status, 'unchanged');
  assert.strictEqual(config(dir, 'user.email'), 'alice@example.com');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extensions/null-accounts && npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './gitWiring'`.

- [ ] **Step 3: Implement**

Create `extensions/null-accounts/src/gitWiring.ts`:

```ts
'use strict';

import { MetadataStore } from './accountStore';
import { GIT_UNAVAILABLE, GitRun } from './git';
import { planFor, sshKeyFile, WiringPlan } from './gitPlan';
import { serial } from './serial';
import { Account } from './types';

export const WIRING_KEY = 'null-accounts.gitWiring';

/** One config key we wrote, and what was there before (`null` = it was unset). */
interface WrittenEntry { key: string; value: string; previous: string | null }
/** What we wrote into one folder's repo, so unbinding undoes exactly that. */
interface WiringRecord { accountId: string; entries: WrittenEntry[] }

export type SkipReason = 'folder-missing' | 'git-missing' | 'not-a-repo' | 'ssh-key-missing' | 'config-failed';

export type WireOutcome =
  | { folder: string; status: 'unchanged' | 'wired' | 'cleared' }
  | { folder: string; status: 'skipped'; reason: SkipReason; detail?: string };

export interface WiringDeps {
  meta: MetadataStore;
  git: GitRun;
  /** [folder key, account id] pairs (`ProjectBinding.entries`). */
  bindings: { entries(): [string, string][] };
  accounts: { get(id: string): Account | undefined };
  exists(path: string): boolean;
  home: string;
}

const stripNewline = (s: string): string => s.replace(/\r?\n$/, '');
const INSIDE_REPO = ['rev-parse', '--is-inside-work-tree'];

const sameConfig = (entries: readonly WrittenEntry[], plan: WiringPlan): boolean =>
  entries.length === plan.config.length && plan.config.every((c, i) => entries[i].key === c.key && entries[i].value === c.value);

const isRecord = (v: unknown): v is WiringRecord =>
  typeof v === 'object' && v !== null && typeof (v as WiringRecord).accountId === 'string' && Array.isArray((v as WiringRecord).entries);

/**
 * Applies each bound folder's account to its repo-local git config (`git config --local` only; global and
 * system config are never touched) and takes it back out when the folder is unbound.
 */
export class GitWiring {
  private readonly queue = serial();

  constructor(private readonly deps: WiringDeps) {}

  /** Brings every bound folder, and every folder we wired earlier, in line with the current bindings. Safe to call often. */
  reconcile(): Promise<WireOutcome[]> {
    return this.queue(async () => {
      const bound = new Map(this.deps.bindings.entries());
      const folders = new Set([...bound.keys(), ...Object.keys(this.records())]);
      const outcomes: WireOutcome[] = [];
      for (const folder of folders) {
        outcomes.push(await this.syncFolder(folder, bound.get(folder)));
      }
      return outcomes;
    });
  }

  private async syncFolder(folder: string, accountId: string | undefined): Promise<WireOutcome> {
    const old = this.records()[folder];
    const account = accountId === undefined ? undefined : this.deps.accounts.get(accountId);
    if (!account) {
      if (!old) { return { folder, status: 'unchanged' }; }
      return (await this.release(folder, old))
        ? { folder, status: 'cleared' }
        : { folder, status: 'skipped', reason: 'git-missing' };
    }

    const plan = planFor(account, this.deps.home);
    if (old && old.accountId === account.id && sameConfig(old.entries, plan)) { return { folder, status: 'unchanged' }; }

    // A skipped folder must not keep the previous account's identity.
    const skip = async (reason: SkipReason, detail?: string): Promise<WireOutcome> => {
      if (old && old.accountId !== account.id) { await this.release(folder, old); }
      return { folder, status: 'skipped', reason, detail };
    };
    // Checked first: git reports a folder that doesn't exist exactly like git not being installed.
    if (!this.deps.exists(folder)) { return skip('folder-missing'); }
    if (account.authMethod === 'ssh') {
      const keyFile = sshKeyFile(account, this.deps.home);
      if (!this.deps.exists(keyFile)) { return skip('ssh-key-missing', keyFile); }
    }
    const probe = await this.deps.git(folder, INSIDE_REPO);
    if (probe.code === GIT_UNAVAILABLE) { return skip('git-missing'); }
    if (probe.code !== 0) { return skip('not-a-repo', probe.stderr.trim().split(/\r?\n/)[0]); }

    if (old) { await this.restore(folder, old); }
    const entries: WrittenEntry[] = [];
    for (const { key, value } of plan.config) {
      const current = await this.deps.git(folder, ['config', '--local', '--get', key]);
      // ponytail: a key set several times collapses to one value here; `previous` keeps only the last.
      const previous = current.code === 0 ? stripNewline(current.stdout) : null;
      const set = await this.deps.git(folder, ['config', '--local', '--replace-all', key, value]);
      if (set.code !== 0) {
        await this.save(folder, { accountId: account.id, entries }); // keep what did land, so it can still be undone
        return { folder, status: 'skipped', reason: 'config-failed', detail: set.stderr.trim() };
      }
      entries.push({ key, value, previous });
    }
    // ponytail: a crash between the writes above and this save leaves keys with no record; they just stay until the next bind overwrites them.
    await this.save(folder, { accountId: account.id, entries });
    return { folder, status: 'wired' };
  }

  /** Puts back what each entry replaced, but only where the value is still the one we wrote: a hand edit since then is the user's. */
  private async restore(folder: string, record: WiringRecord): Promise<boolean> {
    for (const entry of [...record.entries].reverse()) {
      const current = await this.deps.git(folder, ['config', '--local', '--get', entry.key]);
      if (current.code === GIT_UNAVAILABLE) { return false; }
      if (current.code !== 0 || stripNewline(current.stdout) !== entry.value) { continue; }
      await this.deps.git(folder, entry.previous === null
        ? ['config', '--local', '--unset-all', entry.key]
        : ['config', '--local', '--replace-all', entry.key, entry.previous]);
    }
    return true;
  }

  /** Undoes a folder's wiring and forgets it. `false` (record kept) only when git can't run, so it is retried. */
  private async release(folder: string, record: WiringRecord): Promise<boolean> {
    if (this.deps.exists(folder)) {
      const probe = await this.deps.git(folder, INSIDE_REPO);
      if (probe.code === GIT_UNAVAILABLE) { return false; }
      if (probe.code === 0 && !(await this.restore(folder, record))) { return false; }
      // Not a repo any more (or the folder is gone): there is no config left to clean.
    }
    await this.save(folder, undefined);
    return true;
  }

  private records(): Record<string, WiringRecord> {
    const raw = this.deps.meta.get<unknown>(WIRING_KEY);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { return {}; }
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, WiringRecord] => isRecord(e[1])));
  }

  private async save(folder: string, record: WiringRecord | undefined): Promise<void> {
    const { [folder]: _old, ...rest } = this.records();
    await this.deps.meta.update(WIRING_KEY, record ? { ...rest, [folder]: record } : rest);
  }
}

/** The warning worth showing for a skipped folder; `undefined` for the quiet reasons (a plain folder isn't an error). */
export function describeSkip(outcome: Extract<WireOutcome, { status: 'skipped' }>, folderName: string): string | undefined {
  switch (outcome.reason) {
    case 'git-missing': return `git was not found on your PATH, so the git identity for "${folderName}" was not set.`;
    case 'ssh-key-missing': return `The SSH key ${outcome.detail} was not found; the git settings for "${folderName}" were not changed.`;
    case 'config-failed': return `git refused a setting for "${folderName}": ${outcome.detail}`;
    case 'not-a-repo':
    case 'folder-missing': return undefined;
  }
}
```

- [ ] **Step 4: Register the test and run it**

Append ` out/gitWiring.test.js` to `scripts.test` in `extensions/null-accounts/package.json`.

Run: `npm --prefix extensions/null-accounts test`
Expected: PASS (12 new tests; they spawn real git, so this file takes ~10 s).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-accounts/src/gitWiring.ts extensions/null-accounts/src/gitWiring.test.ts extensions/null-accounts/package.json
git commit -m "feat(null-accounts): apply the bound account to a repo's local git config" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: OS credential store (`CredentialSync`)

**Files:**
- Create: `extensions/null-accounts/src/gitCredentials.ts`
- Test: `extensions/null-accounts/src/gitCredentials.test.ts`
- Modify: `extensions/null-accounts/package.json` (`scripts.test`)

**Interfaces:**
- Consumes: `MetadataStore`, `GIT_UNAVAILABLE` / `GitResult` / `GitRun` (Task 1), `credentialFor` / `CredentialTarget` (Task 2), `serial` (Task 1), `Account`.
- Produces (Task 5 imports these exact names):
  - `CREDENTIALS_KEY = 'null-accounts.gitCredentials'` — `globalState` key; value `Record<accountId, { host, username }>` (never a token)
  - `interface CredentialDeps { meta: MetadataStore; git: GitRun; bindings: { entries(): [string, string][] }; accounts: { get(id: string): Account | undefined }; token(account: Account): Promise<string | undefined>; cwd: string }`
  - `credentialInput(target: CredentialTarget, token?: string): string | undefined` — the stdin text for `git credential approve` (with token) or `reject` (without); `undefined` if any value contains CR, LF or NUL
  - `class CredentialSync { constructor(deps: CredentialDeps); sync(): Promise<void> }`

Behaviour: `sync()` collects the distinct accounts that are bound to at least one folder and have a credential target. For each: ask `token(account)`; with a token that differs from the last one approved (or no approval yet), run `git credential approve` and record the account's target. Anything recorded as approved that is no longer wanted (account removed, unbound everywhere, switched to SSH, renamed) is withdrawn with `git credential reject`.

- [ ] **Step 1: Write the failing tests**

Create `extensions/null-accounts/src/gitCredentials.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { GIT_UNAVAILABLE, GitRun } from './git';
import { CREDENTIALS_KEY, credentialInput, CredentialSync } from './gitCredentials';
import { FakeMeta } from './testFakes';
import { Account } from './types';

const alice: Account = {
  id: 'a1', provider: 'github', host: 'github.com', username: 'alice', email: 'alice@example.com', authMethod: 'oauth',
};
const bob: Account = {
  id: 'a2', provider: 'gitlab', host: 'git.example.org:8443', username: 'bob', email: 'bob@example.org', authMethod: 'https',
};
const ssh: Account = { ...alice, id: 'a3', username: 'carol', authMethod: 'ssh', sshKeyPath: '/k' };

function setup(initial: Array<[string, Account]>) {
  const meta = new FakeMeta();
  const accounts = new Map(initial.map(([, a]) => [a.id, a]));
  const bound = new Map(initial.map(([folder, a]) => [folder, a.id]));
  const tokens = new Map<string, string | undefined>(initial.map(([, a]) => [a.id, `token-of-${a.username}`]));
  const calls: Array<{ cwd: string; args: string[]; input?: string }> = [];
  let result = { code: 0, stdout: '', stderr: '' };
  const git: GitRun = async (cwd, args, input) => { calls.push({ cwd, args, input }); return result; };
  const sync = new CredentialSync({
    meta, git, cwd: '/tmp',
    bindings: { entries: () => [...bound.entries()] },
    accounts: { get: id => accounts.get(id) },
    token: async account => tokens.get(account.id),
  });
  return { sync, meta, accounts, bound, tokens, calls, failWith: (code: number) => { result = { code, stdout: '', stderr: 'x' }; } };
}

test('the token reaches git over stdin only, in the credential format, never in the arguments', async () => {
  const { sync, calls } = setup([['/work/a', alice]]);
  await sync.sync();
  assert.deepStrictEqual(calls, [{
    cwd: '/tmp',
    args: ['credential', 'approve'],
    input: 'protocol=https\nhost=github.com\nusername=alice\npassword=token-of-alice\n\n',
  }]);
  assert.ok(!calls[0].args.join(' ').includes('token-of-alice'));
});

test('the same token is approved once; a refreshed token is approved again', async () => {
  const { sync, calls, tokens } = setup([['/work/a', bob]]);
  await sync.sync();
  await sync.sync();
  assert.strictEqual(calls.length, 1);
  tokens.set(bob.id, 'rotated');
  await sync.sync();
  assert.strictEqual(calls.length, 2);
  assert.match(calls[1].input ?? '', /host=git\.example\.org:8443\nusername=bob\npassword=rotated\n/);
});

test('two folders on one account share one credential; it is withdrawn only when the last folder lets go', async () => {
  const { sync, calls, bound } = setup([['/work/a', alice]]);
  bound.set('/work/b', alice.id);
  await sync.sync();
  assert.strictEqual(calls.length, 1);

  bound.delete('/work/a');
  await sync.sync();
  assert.strictEqual(calls.length, 1, 'still used by /work/b, so it stays in the store');

  bound.delete('/work/b');
  await sync.sync();
  assert.deepStrictEqual(calls[1], {
    cwd: '/tmp', args: ['credential', 'reject'], input: 'protocol=https\nhost=github.com\nusername=alice\n\n',
  });
});

test('removing the account withdraws its credential, and the record of it survives a restart', async () => {
  const { sync, calls, accounts, meta } = setup([['/work/a', alice]]);
  await sync.sync();
  assert.deepStrictEqual(meta.data.get(CREDENTIALS_KEY), { a1: { host: 'github.com', username: 'alice' } });
  assert.ok(!JSON.stringify([...meta.data.values()]).includes('token-of-alice'), 'a token was persisted');

  accounts.delete(alice.id);
  const afterRestart = new CredentialSync({
    meta, git: async (cwd, args, input) => { calls.push({ cwd, args, input }); return { code: 0, stdout: '', stderr: '' }; }, cwd: '/tmp',
    bindings: { entries: () => [['/work/a', alice.id]] }, accounts: { get: id => accounts.get(id) }, token: async () => undefined,
  });
  await afterRestart.sync();
  assert.deepStrictEqual(calls.at(-1)?.args, ['credential', 'reject']);
  assert.deepStrictEqual(meta.data.get(CREDENTIALS_KEY), {});
});

test('an SSH account has no credential, and an account with no token is skipped without prompting', async () => {
  const { sync, calls, tokens } = setup([['/work/a', ssh], ['/work/b', alice]]);
  tokens.set(alice.id, undefined);
  await sync.sync();
  assert.deepStrictEqual(calls, []);
});

test('if git cannot run, nothing is recorded as approved, so the next sync tries again', async () => {
  const { sync, calls, failWith, meta } = setup([['/work/a', alice]]);
  failWith(GIT_UNAVAILABLE);
  await sync.sync();
  assert.deepStrictEqual(meta.data.get(CREDENTIALS_KEY) ?? {}, {});
  failWith(0);
  await sync.sync();
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(meta.data.get(CREDENTIALS_KEY), { a1: { host: 'github.com', username: 'alice' } });
});

test('a value containing a newline is refused instead of injecting another credential attribute', async () => {
  assert.strictEqual(credentialInput({ host: 'github.com', username: 'alice' }, 'tok\nhost=evil.example'), undefined);
  assert.strictEqual(credentialInput({ host: 'github.com', username: 'a\r\nb' }), undefined);
  const { sync, calls, tokens } = setup([['/work/a', alice]]);
  tokens.set(alice.id, 'tok\nhost=evil.example');
  await sync.sync();
  assert.deepStrictEqual(calls, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extensions/null-accounts && npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './gitCredentials'`.

- [ ] **Step 3: Implement**

Create `extensions/null-accounts/src/gitCredentials.ts`:

```ts
'use strict';

import { MetadataStore } from './accountStore';
import { GIT_UNAVAILABLE, GitResult, GitRun } from './git';
import { credentialFor, CredentialTarget } from './gitPlan';
import { serial } from './serial';
import { Account } from './types';

export const CREDENTIALS_KEY = 'null-accounts.gitCredentials';

export interface CredentialDeps {
  /** Holds which account's credential we put in the OS store, so it can be withdrawn later. Never a token. */
  meta: MetadataStore;
  git: GitRun;
  /** [folder key, account id] pairs (`ProjectBinding.entries`). */
  bindings: { entries(): [string, string][] };
  accounts: { get(id: string): Account | undefined };
  /** A token without any prompt (`NullAccountsApi.getToken` without `interactive`). */
  token(account: Account): Promise<string | undefined>;
  /** A directory to run `git credential` in; it needs no repo. */
  cwd: string;
}

const sameTarget = (a?: CredentialTarget, b?: CredentialTarget): boolean =>
  a !== undefined && b !== undefined && a.host === b.host && a.username === b.username;

/** The text `git credential approve|reject` reads on stdin; `undefined` if a value could smuggle in another line. */
export function credentialInput(target: CredentialTarget, token?: string): string | undefined {
  const values = [target.host, target.username, ...(token === undefined ? [] : [token])];
  if (values.some(v => /[\r\n\0]/.test(v))) { return undefined; }
  return `protocol=https\nhost=${target.host}\nusername=${target.username}\n${token === undefined ? '' : `password=${token}\n`}\n`;
}

/**
 * Keeps the OS credential store (via `git credential approve|reject`) holding the current token of every
 * account that is bound to a folder, so git finds it from any terminal, even with the IDE closed. A credential
 * belongs to the account, not the folder: it is withdrawn only when no folder uses the account any more.
 */
export class CredentialSync {
  private readonly queue = serial();
  /** The token last approved per account, in memory only: a restart approves once more, which is harmless. */
  private readonly last = new Map<string, string>();

  constructor(private readonly deps: CredentialDeps) {}

  sync(): Promise<void> {
    return this.queue(async () => {
      const wanted = new Map<string, { account: Account; target: CredentialTarget }>();
      for (const [, accountId] of this.deps.bindings.entries()) {
        const account = this.deps.accounts.get(accountId);
        const target = account && credentialFor(account);
        if (account && target) { wanted.set(account.id, { account, target }); }
      }

      let approved = this.approved();
      for (const [id, target] of Object.entries(approved)) {
        if (sameTarget(wanted.get(id)?.target, target)) { continue; }
        const res = await this.run('reject', target);
        if (res?.code === GIT_UNAVAILABLE) { continue; } // keep the record; withdraw it once git is back
        const { [id]: _withdrawn, ...rest } = approved;
        approved = rest;
        this.last.delete(id);
        await this.deps.meta.update(CREDENTIALS_KEY, approved);
      }

      for (const [id, { account, target }] of wanted) {
        const token = await this.deps.token(account);
        if (!token) { continue; } // signed out or offline: leave whatever is stored, never prompt from here
        if (this.last.get(id) === token && sameTarget(approved[id], target)) { continue; }
        const res = await this.run('approve', target, token);
        if (res?.code !== 0) { continue; } // retried on the next sync
        this.last.set(id, token);
        approved = { ...approved, [id]: target };
        await this.deps.meta.update(CREDENTIALS_KEY, approved);
      }
    });
  }

  private run(verb: 'approve' | 'reject', target: CredentialTarget, token?: string): Promise<GitResult> | undefined {
    const input = credentialInput(target, token);
    // Token and input go over stdin only: never into an argument, a log line or an error message.
    return input === undefined ? undefined : this.deps.git(this.deps.cwd, ['credential', verb], input);
  }

  private approved(): Record<string, CredentialTarget> {
    const raw = this.deps.meta.get<unknown>(CREDENTIALS_KEY);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { return {}; }
    const isTarget = (v: unknown): v is CredentialTarget =>
      typeof v === 'object' && v !== null && typeof (v as CredentialTarget).host === 'string' && typeof (v as CredentialTarget).username === 'string';
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, CredentialTarget] => isTarget(e[1])));
  }
}
```

- [ ] **Step 4: Register the test and run it**

Append ` out/gitCredentials.test.js` to `scripts.test` in `extensions/null-accounts/package.json`.

Run: `npm --prefix extensions/null-accounts test`
Expected: PASS (7 new tests).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-accounts/src/gitCredentials.ts extensions/null-accounts/src/gitCredentials.test.ts extensions/null-accounts/package.json
git commit -m "feat(null-accounts): keep the OS credential store in step with bound accounts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire it up (`AccountStore` token event, `extension.ts`)

**Files:**
- Modify: `extensions/null-accounts/src/accountStore.ts`
- Modify: `extensions/null-accounts/src/accountStore.test.ts`
- Modify: `extensions/null-accounts/src/extension.ts`

**Interfaces:**
- Consumes: everything produced by Tasks 1–4; `NullAccountsApi.getToken`; `folderKey` / `ProjectBinding` (`projectBinding.ts`); `ChangeEmitter`.
- Produces: `AccountStore.onDidChangeSecret: vscode.Event<void>` — fires after `setSecret` (every GitLab refresh and re-sign-in goes through it: `extension.ts`'s `GitlabDeps.secrets.set` and `addOrRefresh` both call `store.setSecret`). No new public API for other extensions.

- [ ] **Step 1: Write the failing test**

Append to `extensions/null-accounts/src/accountStore.test.ts`:

```ts
test('setSecret fires onDidChangeSecret but not onDidChange; add does the opposite', async () => {
  const { store } = makeStore();
  let secretEvents = 0;
  let changeEvents = 0;
  store.onDidChangeSecret(() => { secretEvents++; });
  store.onDidChange(() => { changeEvents++; });
  const account = await store.add(octocat, 'first');
  assert.deepStrictEqual([secretEvents, changeEvents], [0, 1]);
  await store.setSecret(account.id, 'second');
  assert.deepStrictEqual([secretEvents, changeEvents], [1, 1]);
  await assert.rejects(store.setSecret('missing', 'x'), /No account/);
  assert.strictEqual(secretEvents, 1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd extensions/null-accounts && npx tsc -p tsconfig.json`
Expected: FAIL — `Property 'onDidChangeSecret' does not exist on type 'AccountStore'`.

- [ ] **Step 3: Add the event to `AccountStore`**

In `extensions/null-accounts/src/accountStore.ts`, directly under `readonly onDidChange = this.emitter.event;` add:

```ts
  private readonly secretEmitter = new ChangeEmitter();
  /** Fires after a stored secret is replaced (token refresh, re-sign-in). `add` and `remove` fire `onDidChange` instead. */
  readonly onDidChangeSecret = this.secretEmitter.event;
```

and in `setSecret`, after `await this.secrets.store(secretKey(id), value);` add:

```ts
    this.secretEmitter.fire();
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix extensions/null-accounts test`
Expected: PASS.

- [ ] **Step 5: Wire git sync into `extension.ts`**

In `extensions/null-accounts/src/extension.ts`:

(a) Replace the first import line block

```ts
import * as vscode from 'vscode';
import { AccountStore } from './accountStore';
```

with

```ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { AccountStore } from './accountStore';
```

(b) Replace

```ts
import { ChangeEmitter } from './changeEmitter';
import { ProjectBinding } from './projectBinding';
```

with

```ts
import { ChangeEmitter } from './changeEmitter';
import { runGit } from './git';
import { CredentialSync } from './gitCredentials';
import { describeSkip, GitWiring } from './gitWiring';
import { folderKey, ProjectBinding } from './projectBinding';
```

(c) Directly under `const IMPORT_OFFERED_KEY = 'null-accounts.importOffered';` add:

```ts
// ponytail: GitLab tokens last ~2 h and nothing else wakes the extension for a terminal-only session, so poll;
// the OS-store token can lag a rotation by up to this long. Schedule from the token's expiry if that proves too coarse.
const GIT_SYNC_INTERVAL_MS = 5 * 60_000;
```

(d) In `activate()`, directly above `void offerImport(context, store, bindings, github)…` add:

```ts
  registerGitSync(context, store, bindings, changed, api);

```

(e) Directly above the `/** Once: offer to keep an already-signed-in GitHub account…` comment add:

```ts
/** Keeps repo-local git config and the OS credential store in line with the bindings (see gitWiring.ts, gitCredentials.ts). */
function registerGitSync(
  context: vscode.ExtensionContext,
  store: AccountStore,
  bindings: ProjectBinding,
  changed: ChangeEmitter,
  api: NullAccountsApi,
): void {
  const wiring = new GitWiring({
    meta: context.globalState, git: runGit, bindings, accounts: store, exists: fs.existsSync, home: os.homedir(),
  });
  const credentials = new CredentialSync({
    meta: context.globalState, git: runGit, bindings, accounts: store, token: account => api.getToken(account), cwd: os.tmpdir(),
  });
  const warned = new Set<string>();

  const syncGit = async (): Promise<void> => {
    const outcomes = await wiring.reconcile();
    await credentials.sync();
    const open = new Map((vscode.workspace.workspaceFolders ?? []).map(f => [folderKey(f.uri.fsPath), f.name]));
    for (const outcome of outcomes) {
      const name = open.get(outcome.folder);
      if (outcome.status !== 'skipped' || name === undefined) { continue; } // only folders the user is looking at
      const message = describeSkip(outcome, name);
      const once = `${outcome.folder}|${outcome.reason}|${outcome.detail ?? ''}`;
      if (message && !warned.has(once)) {
        warned.add(once);
        void vscode.window.showWarningMessage(`Null Accounts: ${message}`);
      }
    }
  };
  const trigger = (): void => { void syncGit().catch(() => { /* git wiring must never break the extension */ }); };

  const timer = setInterval(trigger, GIT_SYNC_INTERVAL_MS);
  context.subscriptions.push(
    changed.event(trigger), // accounts, bindings and re-auth state
    store.onDidChangeSecret(trigger), // a refreshed or replaced token
    { dispose: () => clearInterval(timer) },
  );
  trigger();
}
```

- [ ] **Step 6: Compile and run the whole suite**

Run: `npm --prefix extensions/null-accounts test`
Expected: PASS — everything compiles (`extension.ts` is only type-checked here; its behaviour is Task 7).

- [ ] **Step 7: Commit**

```bash
git add extensions/null-accounts/src/accountStore.ts extensions/null-accounts/src/accountStore.test.ts extensions/null-accounts/src/extension.ts
git commit -m "feat(null-accounts): wire bound accounts into git on every change" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs and compiled output

**Files:**
- Modify: `CLAUDE.md` (the `null-accounts` section)
- Modify: `docs/specs/null-accounts-design.md`
- Modify: `extensions/null-accounts/out/` (regenerated)

- [ ] **Step 1: Update `CLAUDE.md`**

In the `### null-accounts` paragraph replace `Git wiring lands in a later phase.` with:

```
Binding a folder wires git (`gitPlan.ts` → `gitWiring.ts` for repo-local `user.name` / `user.email` / `credential.https://<host>.username` / `core.sshCommand`, `gitCredentials.ts` for the token in the OS credential store via `git credential approve|reject`): it reconciles against the bindings on every change, every refreshed token and every 5 minutes; unbinding restores the values it replaced; global git config is never touched. Nothing in the Add Account flow creates an SSH-key account yet.
```

- [ ] **Step 2: Update the spec**

In `docs/specs/null-accounts-design.md`:

- In the "Git wiring" table, replace the SSH row's config cell `` `core.sshCommand` = `ssh -i "<sshKeyPath>" -o IdentitiesOnly=yes` `` with `` `core.sshCommand` = `ssh -i '<sshKeyPath>' -o IdentitiesOnly=yes` (single-quoted, `/` separators, leading `~/` expanded) ``, and replace `` `credential.<host>.username` `` in the HTTPS / OAuth row with `` `credential.https://<host>.username` ``.
- After the paragraph that ends "GitHub built-in tokens do not expire.", add:

```
Implementation notes (Phase 6): wiring is a reconcile against the current bindings, so it is idempotent and survives restarts (`globalState` records per folder what was written and the value it replaced; unbinding restores that value, and leaves a value the user changed since). The OS credential belongs to the account: it is approved while any folder is bound to the account and withdrawn (`git credential reject`) when none is. A 5-minute poll re-approves a rotated GitLab token for sessions that only use a terminal. Skips (git missing, SSH key missing, git refusing a setting) warn once per session for open folders; a folder that is not a repository is silent.
```

- In "Delivery phases", append ` — landed (\`docs/plans/null-accounts-phase6-git-wiring.md\`)` to item 6.

- [ ] **Step 3: Regenerate the compiled output**

Run: `npm --prefix extensions/null-accounts run compile`

- [ ] **Step 4: Commit docs and compiled output separately**

```bash
git add CLAUDE.md docs/specs/null-accounts-design.md
git commit -m "docs: document null-accounts git wiring" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git add extensions/null-accounts/out
git commit -m "chore: refresh null-accounts compiled output" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Refresh the knowledge graph**

Run: `graphify update .` (AST-only; `graphify-out/` is git-ignored, nothing to commit).

---

### Task 7: Smoke-test against real git and the real credential store

Human steps — every unit test fakes the credential store and the editor, so this is the first time wiring meets Git Credential Manager and a real window. Use a **throw-away private repo** on each account you test with. Sync the build into the installed Null IDE with the `verify-local` skill (or F5 *Extension Development Host*). Commands are PowerShell.

- [ ] **Step 1: Identity.** Clone a throw-away repo, open it in Null IDE, bind it with *Null Accounts: Use Account for This Project* (account A). Within a second, in the repo:
  `git config --local --list | Select-String 'user\.|credential'` → `user.name`, `user.email` and `credential.https://github.com.username` (or your GitLab host) with A's values. `git config --global --list` is unchanged (compare with a copy taken before).

- [ ] **Step 2: Credential.** `$o = "protocol=https`nhost=github.com`nusername=A`n`n" | git credential fill; ($o | Select-String '^password=(.+)').Matches.Groups[1].Value.Length -gt 0` → `True` (this checks the length without printing the token). `cmdkey /list | Select-String 'git:https://github.com'` lists the entry. With `$env:GIT_TERMINAL_PROMPT = '0'`, `git ls-remote origin` on the private repo succeeds from a terminal **with Null IDE closed**.

- [ ] **Step 3: Two accounts, one host.** Bind a second throw-away repo to account B (same host). `git ls-remote origin` works in both repos, each as its own user (`git credential fill` for each username returns a different password).

- [ ] **Step 4: Rebind and unbind.** Before binding a third repo, set `git config --local user.email me@work.example` in it. Bind it, check the email changed, unbind it (quick-pick → *No account*): `user.email` is `me@work.example` again, `user.name` and the credential key are gone. Unbind repos 1 and 2 as well, then confirm `cmdkey /list` no longer shows the entry (the credential leaves with the last folder).

- [ ] **Step 5: Removal.** Bind a repo, remove the account in the Accounts panel: the repo's keys are gone and the credential entry is withdrawn.

- [ ] **Step 6: Quiet and loud skips.** Bind a plain folder (no `.git`): no notification. Bind a folder, then `git init` it: within 5 minutes the keys appear. Start Null IDE from a terminal whose `$env:PATH` has Git's `cmd` directory removed and bind an open repo: exactly one "git was not found" warning for that folder, however many times it is rebound.

- [ ] **Step 7: GitLab rotation.** Temporarily set `EXPIRY_MARGIN_MS` in `providers/gitlabOAuth.ts` to `7_200_000` (as in the Phase 5 refresh check) so every sync refreshes; bind a repo to a GitLab account; confirm the password returned by `git credential fill` (compare its length/prefix, don't print it) changes after a sync. Revert the temporary edit (`git diff` must show nothing).

---

## Self-Review

**Spec coverage** (spec → task): `user.name` / `user.email` for any account → Tasks 2, 3; SSH `core.sshCommand` with the key → Tasks 2, 3 (`planFor`, `ssh-key-missing`; creation of SSH accounts is out of scope, stated under Global Constraints); HTTPS/OAuth `credential.<host>.username` + token in the OS store via `git credential approve` → Tasks 2, 4 (URL-form key, documented deviation 1); token passed on stdin, never as an argument → Task 4 (`credentialInput`, test asserts the args); refresh re-approves → Tasks 4, 5 (`onDidChangeSecret` + 5-minute poll); "unbinding removes the keys this extension set (tracked in globalState per folder)" → Task 3 (records, restore of previous values — deviation 2); "account removed while bound: bindings cleared, keys removed" → Task 3 (`reconcile` visits recorded folders whose account is gone; `extension.ts` already prunes bindings, and `changed` triggers a sync either way); "SSH key file missing: flagged, config not written" → Task 3 (`ssh-key-missing`, warning in Task 5); "`git` not on PATH, or folder is not a repo: skip git wiring, show the reason, binding still succeeds" → Tasks 3, 5 (binding is never touched by wiring; reason shown for the actionable cases — deviation 6); "global and system config never modified" → every write is `git config --local`. Deferred and stated: SSH account creation UI, dashboard, `verify-local` spec (Phase 7).

**Placeholder scan:** none — no TBD/TODO; every code step carries the code. The only manual part is Task 7, which is a labelled human step.

**Type consistency:** `GitRun` / `GitResult` / `GIT_UNAVAILABLE` (Task 1) are used by Tasks 3–5 under those names; `planFor`, `sshKeyFile`, `credentialFor`, `CredentialTarget` (Task 2) are imported by Tasks 3–4; `WiringDeps.bindings` and `CredentialDeps.bindings` both take `ProjectBinding.entries(): [string, string][]` and `accounts` takes `AccountStore.get`; `GitWiring.reconcile()` returns `WireOutcome[]` consumed by `describeSkip` in Task 5; `CredentialSync.sync()` takes its token from `api.getToken(account)`, whose signature is unchanged.

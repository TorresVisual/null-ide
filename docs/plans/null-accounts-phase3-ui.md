# Null Accounts — Phase 3: UI Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Give `null-accounts` a face: an Accounts panel in the main editor area (list, add, edit email, remove, per-account "projects using this" with unbind), a status bar item showing the current folder's account, and a quick-pick that can switch or clear that account.

**Architecture:** Same split as Phases 1–2. Everything with logic is a pure, node-testable module that does not import `vscode` at runtime: `ui/accountsView.ts` (accounts + bindings → panel rows, remove-confirmation wording), `ui/panelMessages.ts` (validates webview → host messages), `ui/accountsHtml.ts` (static HTML + client script, no account data baked in), `ui/statusBarModel.ts` (text/tooltip), and the reworked `ui/pickItems.ts`. Only `ui/accountsPanel.ts`, `ui/statusBarController.ts`, `ui/accountPicker.ts` and `extension.ts` touch `vscode`. The webview is a dumb renderer: the host sends it a ready-made `rows` array and it builds DOM with `textContent` only.

**Tech Stack:** TypeScript (strict), VS Code `WebviewPanel` + `StatusBarItem` APIs (`^1.85.0`), `node --test` + `node:assert`, `@vscode/test-electron` + mocha for the one integration spec.

**Spec:** `docs/specs/null-accounts-design.md` (issue #102), sections "ui" and "Delivery phases". This is plan 3 of 6: (1) Foundation — `docs/plans/null-accounts-phase1-foundation.md`, landed; (2) GitHub + binding — `docs/plans/null-accounts-phase2-github-binding.md`, landed; (3) UI ← this plan; (4) GitLab; (5) Git wiring; (6) Integration.

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

- All Phase 1–2 constraints still hold: every `.ts` file starts with `'use strict';`; unit-tested modules do not import `vscode` at runtime (`import type` is fine); secrets only in `SecretStorage` and never logged; edit TypeScript sources only, never `out/`; commit after each task (message ends with the session's `Co-Authored-By` trailer), do not push.
- The webview never receives secrets and never builds DOM from account or folder data with `innerHTML` — usernames come from the provider and folder names come from disk, so treat both as untrusted text.
- Messages from the webview are untrusted input: the host parses them with `parsePanelMessage` and ignores anything that doesn't match.
- The panel's CSP is `default-src 'none'; style-src 'nonce-<n>'; script-src 'nonce-<n>'` with a fresh `crypto.randomBytes` nonce per panel. No `unsafe-inline`, no external resources, so no `localResourceRoots`.
- One Accounts panel at a time (`createOrShow` reveals the existing one). The panel re-reads state on every `onDidChange` and on the webview's `ready` message, so it never needs `retainContextWhenHidden`.
- The status bar item and `null-accounts.switchAccount` act on `vscode.workspace.workspaceFolders?.[0]` — the same folder `null-tools`' `getGithubSession` uses. Multi-root awareness is out of scope.
- Status bar item id `null-accounts.account`, name `Null Accounts` (so users can hide it from VS Code's native status-bar context menu — no setting of our own).
- Commands (titles are the command-palette text): `null-accounts.open` = "Null Accounts: Manage Accounts", `null-accounts.switchAccount` = "Null Accounts: Switch Account for This Project".
- "Edit" means **email only**. Username/host/external id come from the provider and are not user-editable; the SSH key path arrives with Phase 5 when SSH accounts can exist.
- Removing an account only removes it from Null IDE. It does not sign out VS Code's built-in GitHub session, and the confirmation says so.
- Not in this phase: GitLab and the "Add GitLab account" action (Phase 4); the "needs re-auth" flag and notification (Phase 4, per the Phase 2 constraint); anything that writes git config (Phase 5); the dashboard showing each project's account (Phase 6).

## Review Focus

The spec says what the UI must show, not everything it will meet. These are the inputs most likely to bite someone using this phase, most likely first; each has a test in the owning task.

1. **A username or folder name containing HTML** (`<img src=x onerror=alert(1)>`) → shown as literal text, never parsed. Pinned by a guard that the client script never uses `innerHTML` and that the CSP carries no `unsafe-inline`. (Task 4)
2. **A forged or malformed webview message** (`remove` with no id, an unknown `type`, a non-object, an id for an account that doesn't exist) → ignored, never throws; `remove`/`editEmail` of a missing account is a no-op. (Task 4)
3. **A bound folder that has been moved or deleted, or a Windows folder key that is lower-cased** → still listed (real-cased path when it exists, `(not found)` when not), and Unbind works from the key the panel sends back. (Task 1)
4. **Removing an account that open projects use** → the confirmation says how many projects lose their binding (singular/plural correct, nothing about projects when there are none) and that the VS Code sign-in is untouched; afterwards the existing prune in `extension.ts` clears the bindings and the status bar flips to "No account". (Tasks 1 and 3)
5. **No folder open, or the user picks "no account"** → status bar hidden / reads "No account"; `null-accounts.switchAccount` with no folder shows a message and resolves instead of hanging on it. (Tasks 2, 3 and 5)

---

### Task 1: `ProjectBinding.entries()` and `ui/accountsView.ts`

The panel needs every binding (not just one folder's) and a pure function that joins accounts, bindings and the filesystem into rows.

**Files:**
- Modify: `extensions/null-accounts/src/projectBinding.ts`, `projectBinding.test.ts`
- Create: `extensions/null-accounts/src/ui/accountsView.ts`
- Create: `extensions/null-accounts/src/ui/accountsView.test.ts`
- Modify: `extensions/null-accounts/package.json` (test script)

**Interfaces:**
- Consumes: `Account` (`types.ts`), `ProjectBinding`, `FakeMeta` (`testFakes.ts`).
- Produces:
  - `ProjectBinding.entries(): [string, string][]` — `[folderKey, accountId]` pairs.
  - `ui/accountsView.ts`:
    - `interface ProjectRef { key: string; path: string; name: string; exists: boolean }`
    - `interface AccountRow { id: string; provider: Provider; host: string; username: string; email: string; authMethod: AuthMethod; projects: ProjectRef[] }`
    - `type ResolveFolder = (key: string) => { path: string; exists: boolean }`
    - `buildRows(accounts: readonly Account[], entries: ReadonlyArray<readonly [string, string]>, resolve: ResolveFolder): AccountRow[]`
    - `removeConfirmation(account: Pick<Account, 'username' | 'host'>, projectCount: number): { message: string; detail: string }`

- [ ] **Step 1: Write the failing tests**

Append to `projectBinding.test.ts` (add `import { FakeMeta } from './testFakes';` and `import { ProjectBinding } from './projectBinding';` at the top if they aren't imported already):

```ts
test('entries lists every binding as [folder key, account id]', async () => {
  const b = new ProjectBinding(new FakeMeta(), 'linux');
  assert.deepStrictEqual(b.entries(), []);
  await b.bind('/work/a', 'acc1');
  await b.bind('/work/b', 'acc2');
  assert.deepStrictEqual(b.entries(), [['/work/a', 'acc1'], ['/work/b', 'acc2']]);
});

test('a folder key from entries() can be passed straight back to unbind, on Windows too', async () => {
  const b = new ProjectBinding(new FakeMeta(), 'win32');
  await b.bind('C:\\Work\\MyRepo\\', 'acc1');
  const [[key]] = b.entries();
  assert.strictEqual(key, 'c:/work/myrepo'); // lower-cased: Windows paths are case-insensitive
  await b.unbind(key);
  assert.deepStrictEqual(b.entries(), []);
});
```

Create `ui/accountsView.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Account } from '../types';
import { buildRows, removeConfirmation } from './accountsView';

const acct = (id: string): Account =>
  ({ id, provider: 'github', host: 'github.com', username: id, email: `${id}@e.com`, authMethod: 'oauth' });

const exists = (key: string) => ({ path: key, exists: true });

test('projects are grouped under their account and sorted by name, ignoring case', () => {
  const rows = buildRows(
    [acct('a1'), acct('a2')],
    [['/work/zeta', 'a1'], ['/work/Alpha', 'a1'], ['/work/mid', 'a2']],
    exists,
  );
  assert.deepStrictEqual(rows[0].projects.map(p => p.name), ['Alpha', 'zeta']);
  assert.deepStrictEqual(rows[1].projects.map(p => p.name), ['mid']);
  assert.strictEqual(rows[0].projects[0].key, '/work/Alpha');
});

test('accounts with no projects get an empty list; bindings to unknown accounts are ignored', () => {
  const rows = buildRows([acct('a1')], [['/work/x', 'ghost']], exists);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0].projects, []);
});

test('the resolved (real-cased) path is shown; a missing or throwing folder falls back to its key', () => {
  const rows = buildRows(
    [acct('a1')],
    [['c:/work/myrepo', 'a1'], ['c:/gone', 'a1'], ['c:/broken', 'a1']],
    key => {
      if (key === 'c:/work/myrepo') { return { path: 'C:\\Work\\MyRepo', exists: true }; }
      if (key === 'c:/broken') { throw new Error('EPERM'); }
      return { path: key, exists: false };
    },
  );
  const byKey = Object.fromEntries(rows[0].projects.map(p => [p.key, p]));
  assert.deepStrictEqual(byKey['c:/work/myrepo'], { key: 'c:/work/myrepo', path: 'C:\\Work\\MyRepo', name: 'MyRepo', exists: true });
  assert.strictEqual(byKey['c:/gone'].exists, false);
  assert.strictEqual(byKey['c:/broken'].exists, false);
  assert.strictEqual(byKey['c:/broken'].name, 'broken');
});

test('rows carry only display fields — no secrets or provider internals', () => {
  const rows = buildRows([{ ...acct('a1'), externalId: 'ext-1' }], [], exists);
  assert.deepStrictEqual(Object.keys(rows[0]).sort(),
    ['authMethod', 'email', 'host', 'id', 'projects', 'provider', 'username']);
});

test('removeConfirmation counts projects with correct plurals and never claims to sign out', () => {
  const none = removeConfirmation({ username: 'octo', host: 'github.com' }, 0);
  assert.strictEqual(none.message, 'Remove octo@github.com?');
  assert.doesNotMatch(none.detail, /project/);
  assert.match(removeConfirmation({ username: 'o', host: 'h' }, 1).detail, /1 project will lose/);
  assert.match(removeConfirmation({ username: 'o', host: 'h' }, 3).detail, /3 projects will lose/);
  assert.match(none.detail, /not affected/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test --prefix extensions/null-accounts`
Expected: FAIL at compile — `Property 'entries' does not exist on type 'ProjectBinding'` and `Cannot find module './accountsView'`.

- [ ] **Step 3: Implement**

In `projectBinding.ts`, add after `accountIdFor`:

```ts
  /** Every binding as [folder key, account id]. Keys are in `folderKey` form (lower-cased on Windows). */
  entries(): [string, string][] {
    return Object.entries(this.read());
  }
```

Create `ui/accountsView.ts`:

```ts
'use strict';

import path from 'node:path';
import { Account } from '../types';

export interface ProjectRef {
  /** `folderKey` form; what the panel sends back to unbind. */
  key: string;
  /** Real-cased path when the folder exists, else the key. */
  path: string;
  name: string;
  exists: boolean;
}

export interface AccountRow {
  id: string;
  provider: Account['provider'];
  host: string;
  username: string;
  email: string;
  authMethod: Account['authMethod'];
  projects: ProjectRef[];
}

export type ResolveFolder = (key: string) => { path: string; exists: boolean };

/** Everything the panel shows, as plain data. Deliberately copies display fields only. */
export function buildRows(
  accounts: readonly Account[],
  entries: ReadonlyArray<readonly [string, string]>,
  resolve: ResolveFolder,
): AccountRow[] {
  return accounts.map(a => ({
    id: a.id,
    provider: a.provider,
    host: a.host,
    username: a.username,
    email: a.email,
    authMethod: a.authMethod,
    projects: entries
      .filter(([, accountId]) => accountId === a.id)
      .map(([key]): ProjectRef => {
        let resolved: { path: string; exists: boolean };
        try { resolved = resolve(key); } catch { resolved = { path: key, exists: false }; }
        return { key, path: resolved.path, name: path.basename(resolved.path) || resolved.path, exists: resolved.exists };
      })
      .sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' })),
  }));
}

export function removeConfirmation(
  account: Pick<Account, 'username' | 'host'>,
  projectCount: number,
): { message: string; detail: string } {
  const used = projectCount === 0
    ? ''
    : `${projectCount} project${projectCount === 1 ? '' : 's'} will lose their account binding. `;
  return {
    message: `Remove ${account.username}@${account.host}?`,
    detail: `${used}This only removes the account from Null IDE; any sign-in kept by VS Code is not affected.`,
  };
}
```

In `package.json`, append ` out/ui/accountsView.test.js` to the end of the `node --test …` list in the `test` script.

- [ ] **Step 4: Run to verify pass**

Run: `npm test --prefix extensions/null-accounts`
Expected: PASS, including the six new tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-accounts/src/projectBinding.ts extensions/null-accounts/src/projectBinding.test.ts extensions/null-accounts/src/ui/accountsView.ts extensions/null-accounts/src/ui/accountsView.test.ts extensions/null-accounts/package.json
git commit -m "feat: add null-accounts binding entries and accounts panel view model"
```

---

### Task 2: Quick-pick can switch and clear the account

`buildPickItems` learns the folder's *current* account and gains a "use no account" action. `PickItem.account` (absent = add) becomes an explicit `action`, so three outcomes are unambiguous.

**Files:**
- Modify: `extensions/null-accounts/src/ui/pickItems.ts` (replace whole file)
- Modify: `extensions/null-accounts/src/ui/pickItems.test.ts` (replace whole file)
- Modify: `extensions/null-accounts/src/ui/accountPicker.ts` (`chooseAccountForFolder`)

**Interfaces:**
- Consumes: `Account`, `ProjectBinding.accountIdFor/bind/unbind`.
- Produces:
  - `type PickAction = { kind: 'account'; account: Account } | { kind: 'add' } | { kind: 'unbind' }`
  - `interface PickItem { label: string; description?: string; detail?: string; action: PickAction }`
  - `interface PickOptions { suggestedId?: string; currentId?: string }`
  - `buildPickItems(accounts: readonly Account[], options?: PickOptions): PickItem[]`
  - `ADD_GITHUB_LABEL`, `UNBIND_LABEL` constants.
  - `chooseAccountForFolder(deps, folder)` signature unchanged. If the folder is already bound, choosing "no account" unbinds it and resolves `undefined`. (`ensureAccountForFolder` only calls it for unbound folders, where that item never appears.)

- [ ] **Step 1: Write the failing test**

Replace `ui/pickItems.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Account } from '../types';
import { ADD_GITHUB_LABEL, buildPickItems, PickItem, UNBIND_LABEL } from './pickItems';

const acct = (id: string): Account =>
  ({ id, provider: 'github', host: 'github.com', username: id, email: `${id}@e.com`, authMethod: 'oauth' });

const kinds = (items: PickItem[]): string[] =>
  items.map(i => (i.action.kind === 'account' ? i.action.account.id : i.action.kind));

test('the suggested account comes first and is marked; the add action is always last when unbound', () => {
  const items = buildPickItems([acct('a1'), acct('a2'), acct('a3')], { suggestedId: 'a2' });
  assert.deepStrictEqual(kinds(items), ['a2', 'a1', 'a3', 'add']);
  assert.match(items[0].detail ?? '', /suggested/i);
  assert.strictEqual(items[1].detail, undefined);
  assert.strictEqual(items[3].label, ADD_GITHUB_LABEL);
});

test('the current account comes first and is marked, followed by add and "no account"', () => {
  const items = buildPickItems([acct('a1'), acct('a2')], { currentId: 'a2', suggestedId: 'a1' });
  assert.deepStrictEqual(kinds(items), ['a2', 'a1', 'add', 'unbind']);
  assert.strictEqual(items[0].detail, 'Current');
  assert.match(items[1].detail ?? '', /suggested/i);
  assert.strictEqual(items[3].label, UNBIND_LABEL);
});

test('"no account" is offered only when the current account still exists', () => {
  assert.deepStrictEqual(kinds(buildPickItems([acct('a1')])), ['a1', 'add']);
  assert.deepStrictEqual(kinds(buildPickItems([acct('a1')], { currentId: 'deleted' })), ['a1', 'add']);
});

test('with no accounts only the add action remains', () => {
  assert.deepStrictEqual(kinds(buildPickItems([])), ['add']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test --prefix extensions/null-accounts`
Expected: FAIL at compile — `Module './pickItems' has no exported member 'PickItem'`/`UNBIND_LABEL`, and `accountPicker.ts` errors on `picked.account`.

- [ ] **Step 3: Implement**

Replace `ui/pickItems.ts`:

```ts
'use strict';

import { Account } from '../types';

export type PickAction =
  | { kind: 'account'; account: Account }
  | { kind: 'add' }
  | { kind: 'unbind' };

export interface PickItem {
  label: string;
  description?: string;
  detail?: string;
  action: PickAction;
}

export interface PickOptions {
  /** Matches the repository's origin remote (only worth computing for an unbound folder). */
  suggestedId?: string;
  /** The account the folder is bound to now. */
  currentId?: string;
}

export const ADD_GITHUB_LABEL = '$(add) Add GitHub account…';
export const UNBIND_LABEL = '$(circle-slash) Use no account for this project';

/** Current account first, then the suggested one, then the rest in stored order; add; and "no account" when bound. */
export function buildPickItems(accounts: readonly Account[], { suggestedId, currentId }: PickOptions = {}): PickItem[] {
  const rank = (id: string): number => (id === currentId ? 0 : id === suggestedId ? 1 : 2);
  const items = [...accounts]
    .sort((a, b) => rank(a.id) - rank(b.id)) // stable: ties keep their stored order
    .map((account): PickItem => ({
      label: `$(account) ${account.username}`,
      description: account.host,
      detail: account.id === currentId
        ? 'Current'
        : account.id === suggestedId ? 'Suggested — matches this repository’s remote' : undefined,
      action: { kind: 'account', account },
    }));
  items.push({ label: ADD_GITHUB_LABEL, action: { kind: 'add' } });
  if (currentId !== undefined && accounts.some(a => a.id === currentId)) {
    items.push({ label: UNBIND_LABEL, action: { kind: 'unbind' } });
  }
  return items;
}
```

In `ui/accountPicker.ts`, replace `chooseAccountForFolder`:

```ts
/** Quick-pick an account for the folder (suggesting one from its origin remote when unbound), then bind it. */
export async function chooseAccountForFolder(deps: PickerDeps, folder: vscode.Uri): Promise<Account | undefined> {
  const currentId = deps.bindings.accountIdFor(folder.fsPath);
  let suggestedId: string | undefined;
  if (currentId === undefined) {
    const origin = await originUrl(folder.fsPath);
    suggestedId = origin ? suggestAccount(origin, deps.accounts.list())?.id : undefined;
  }
  const picked = await vscode.window.showQuickPick<PickItem>(
    buildPickItems(deps.accounts.list(), { suggestedId, currentId }),
    { placeHolder: `Which account should "${path.basename(folder.fsPath)}" use?` },
  );
  if (!picked) { return undefined; }
  if (picked.action.kind === 'unbind') {
    await deps.bindings.unbind(folder.fsPath);
    return undefined;
  }
  const account = picked.action.kind === 'add' ? await addGithubAccount(deps) : picked.action.account;
  if (!account) { return undefined; }
  await deps.bindings.bind(folder.fsPath, account.id);
  return account;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test --prefix extensions/null-accounts`
Expected: PASS, and `tsc` is clean (no remaining reference to `PickItem.account`).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-accounts/src/ui/pickItems.ts extensions/null-accounts/src/ui/pickItems.test.ts extensions/null-accounts/src/ui/accountPicker.ts
git commit -m "feat: let the null-accounts quick-pick switch or clear a project's account"
```

---

### Task 3: Status bar item

**Files:**
- Create: `extensions/null-accounts/src/ui/statusBarModel.ts`
- Create: `extensions/null-accounts/src/ui/statusBarModel.test.ts`
- Create: `extensions/null-accounts/src/ui/statusBarController.ts`
- Modify: `extensions/null-accounts/package.json` (test script)

**Interfaces:**
- Consumes: `NullAccountsApi.getAccountForFolder`, `NullAccountsApi.onDidChange` (`api.ts`); `Account`.
- Produces:
  - `statusBarModel(folderName: string, account: Account | undefined): { text: string; tooltip: string }`
  - `SWITCH_COMMAND = 'null-accounts.switchAccount'` (exported from `statusBarController.ts`)
  - `registerStatusBar(api: NullAccountsApi): vscode.Disposable` — creates the item, keeps it in sync with `api.onDidChange` and `onDidChangeWorkspaceFolders`, hides it when no folder is open.

- [ ] **Step 1: Write the failing test**

Create `ui/statusBarModel.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { statusBarModel } from './statusBarModel';

test('a bound folder shows the account and explains the click', () => {
  const m = statusBarModel('my-repo', {
    id: 'a1', provider: 'github', host: 'github.com', username: 'octo', email: 'o@e.com', authMethod: 'oauth',
  });
  assert.strictEqual(m.text, '$(account) octo');
  assert.match(m.tooltip, /my-repo uses octo@github\.com/);
  assert.match(m.tooltip, /switch/i);
});

test('an unbound folder reads "No account" and invites a choice', () => {
  const m = statusBarModel('my-repo', undefined);
  assert.strictEqual(m.text, '$(account) No account');
  assert.match(m.tooltip, /my-repo has no account/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test --prefix extensions/null-accounts`
Expected: FAIL at compile — `Cannot find module './statusBarModel'`.

- [ ] **Step 3: Implement**

Create `ui/statusBarModel.ts`:

```ts
'use strict';

import { Account } from '../types';

export function statusBarModel(folderName: string, account: Account | undefined): { text: string; tooltip: string } {
  return account
    ? { text: `$(account) ${account.username}`, tooltip: `${folderName} uses ${account.username}@${account.host} — click to switch` }
    : { text: '$(account) No account', tooltip: `${folderName} has no account — click to choose one` };
}
```

Create `ui/statusBarController.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import type { NullAccountsApi } from '../api';
import { statusBarModel } from './statusBarModel';

export const SWITCH_COMMAND = 'null-accounts.switchAccount';

/** Shows the first workspace folder's account; click runs `null-accounts.switchAccount`. */
export function registerStatusBar(api: NullAccountsApi): vscode.Disposable {
  const item = vscode.window.createStatusBarItem('null-accounts.account', vscode.StatusBarAlignment.Left, 50);
  item.name = 'Null Accounts';
  item.command = SWITCH_COMMAND;
  const refresh = (): void => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { item.hide(); return; }
    const model = statusBarModel(folder.name, api.getAccountForFolder(folder.uri));
    item.text = model.text;
    item.tooltip = model.tooltip;
    item.show();
  };
  refresh();
  return vscode.Disposable.from(item, api.onDidChange(refresh), vscode.workspace.onDidChangeWorkspaceFolders(refresh));
}
```

In `package.json`, append ` out/ui/statusBarModel.test.js` to the `test` script's `node --test …` list.

- [ ] **Step 4: Run to verify pass**

Run: `npm test --prefix extensions/null-accounts`
Expected: PASS, `tsc` clean. (`statusBarController.ts` has no unit test — it is the thin `vscode` adapter; Task 5 exercises it in the integration host.)

- [ ] **Step 5: Commit**

```bash
git add extensions/null-accounts/src/ui/statusBarModel.ts extensions/null-accounts/src/ui/statusBarModel.test.ts extensions/null-accounts/src/ui/statusBarController.ts extensions/null-accounts/package.json
git commit -m "feat: show the current project's account in the status bar"
```

---

### Task 4: Accounts panel

**Files:**
- Create: `extensions/null-accounts/src/ui/panelMessages.ts`, `panelMessages.test.ts`
- Create: `extensions/null-accounts/src/ui/accountsHtml.ts`, `accountsHtml.test.ts`
- Create: `extensions/null-accounts/src/ui/accountsClient.ts`
- Create: `extensions/null-accounts/src/ui/accountsPanel.ts`
- Modify: `extensions/null-accounts/package.json` (test script)

**Interfaces:**
- Consumes: `AccountStore.get/list/remove/update`, `ProjectBinding.entries/unbind` (Task 1), `buildRows`/`removeConfirmation` (Task 1), `validateNewAccount` (`accountInput.ts`), `Account`.
- Produces:
  - `type PanelMessage = { type: 'ready' } | { type: 'add' } | { type: 'remove'; id: string } | { type: 'editEmail'; id: string } | { type: 'unbind'; key: string }`
  - `parsePanelMessage(raw: unknown): PanelMessage | undefined`
  - `buildHtml(nonce: string): string`
  - `CLIENT_SCRIPT: string` (from `accountsClient.ts`)
  - `interface PanelDeps { accounts: AccountStore; bindings: ProjectBinding; addGithub(): Promise<Account | undefined>; onDidChange: vscode.Event<void> }`
  - `AccountsPanel.createOrShow(deps: PanelDeps): void`
  - Host → webview: `{ type: 'state', rows: AccountRow[] }`.

- [ ] **Step 1: Write the failing tests**

Create `ui/panelMessages.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { parsePanelMessage } from './panelMessages';

test('well-formed messages parse and drop unknown fields', () => {
  assert.deepStrictEqual(parsePanelMessage({ type: 'ready' }), { type: 'ready' });
  assert.deepStrictEqual(parsePanelMessage({ type: 'add', evil: 1 }), { type: 'add' });
  assert.deepStrictEqual(parsePanelMessage({ type: 'remove', id: 'a1', extra: true }), { type: 'remove', id: 'a1' });
  assert.deepStrictEqual(parsePanelMessage({ type: 'editEmail', id: 'a1' }), { type: 'editEmail', id: 'a1' });
  assert.deepStrictEqual(parsePanelMessage({ type: 'unbind', key: 'c:/repo' }), { type: 'unbind', key: 'c:/repo' });
});

test('anything else is rejected without throwing', () => {
  for (const bad of [
    undefined, null, 'remove', 42, [], {},
    { type: 'nope' },
    { type: 'remove' }, { type: 'remove', id: '' }, { type: 'remove', id: 7 },
    { type: 'editEmail', id: null },
    { type: 'unbind' }, { type: 'unbind', key: '' }, { type: 'unbind', id: 'a1' },
  ]) {
    assert.strictEqual(parsePanelMessage(bad), undefined, JSON.stringify(bad));
  }
});
```

Create `ui/accountsHtml.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { CLIENT_SCRIPT } from './accountsClient';
import { buildHtml } from './accountsHtml';

test('the CSP is nonce-only and the same nonce guards the style and script tags', () => {
  const html = buildHtml('abc123');
  assert.match(html, /Content-Security-Policy[^>]*default-src 'none'/);
  assert.match(html, /style-src 'nonce-abc123'/);
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.match(html, /<script nonce="abc123">/);
  assert.match(html, /<style nonce="abc123">/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
});

test('the page has the add button the client script wires up, and embeds the client script', () => {
  const html = buildHtml('n');
  assert.match(html, /id="add-btn"/);
  assert.match(html, /id="list"/);
  assert.ok(html.includes(CLIENT_SCRIPT));
});

test('account and folder text only ever reaches the DOM as text', () => {
  assert.doesNotMatch(CLIENT_SCRIPT, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  assert.match(CLIENT_SCRIPT, /textContent/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test --prefix extensions/null-accounts`
Expected: FAIL at compile — `Cannot find module './panelMessages'`, `'./accountsClient'`, `'./accountsHtml'`.

- [ ] **Step 3: Implement the pure modules**

Create `ui/panelMessages.ts`:

```ts
'use strict';

export type PanelMessage =
  | { type: 'ready' }
  | { type: 'add' }
  | { type: 'remove'; id: string }
  | { type: 'editEmail'; id: string }
  | { type: 'unbind'; key: string };

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Webview messages are untrusted: accept only the exact shapes the host handles, copying known fields only. */
export function parsePanelMessage(raw: unknown): PanelMessage | undefined {
  if (typeof raw !== 'object' || raw === null) { return undefined; }
  const m = raw as Record<string, unknown>;
  const type = m.type;
  switch (type) {
    case 'ready':
    case 'add':
      return { type };
    case 'remove':
    case 'editEmail':
      return nonEmpty(m.id) ? { type, id: m.id } : undefined;
    case 'unbind':
      return nonEmpty(m.key) ? { type, key: m.key } : undefined;
    default:
      return undefined;
  }
}
```

Create `ui/accountsClient.ts` (the whole script is one template literal — it must not contain backticks or `${`; the DOM is built with `textContent` only):

```ts
'use strict';

/** Runs inside the webview. Renders the `rows` the host sends; every string is set via textContent. */
export const CLIENT_SCRIPT = `
const vscode = acquireVsCodeApi();
const list = document.getElementById('list');
const empty = document.getElementById('empty');

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) { node.className = cls; }
  if (text !== undefined) { node.textContent = text; }
  return node;
}

function button(label, onClick, cls) {
  const b = el('button', cls, label);
  b.addEventListener('click', onClick);
  return b;
}

function render(rows) {
  list.replaceChildren();
  empty.classList.toggle('visible', rows.length === 0);
  for (const row of rows) {
    const card = el('div', 'card');
    const head = el('div', 'head');
    head.append(el('span', 'name', row.username), el('span', 'meta', row.provider + ' · ' + row.host + ' · ' + row.authMethod));
    const actions = el('div', 'actions');
    actions.append(
      button('Edit email', () => vscode.postMessage({ type: 'editEmail', id: row.id })),
      button('Remove', () => vscode.postMessage({ type: 'remove', id: row.id }), 'danger'),
    );
    const projects = el('div', 'projects');
    projects.append(el('h3', '', row.projects.length ? 'Projects using this account' : 'No projects use this account yet'));
    for (const p of row.projects) {
      const line = el('div', p.exists ? 'project' : 'project missing');
      line.title = p.path;
      line.append(
        el('span', 'pname', p.name),
        el('span', 'ppath', p.exists ? p.path : p.path + ' (not found)'),
        button('Unbind', () => vscode.postMessage({ type: 'unbind', key: p.key })),
      );
      projects.append(line);
    }
    card.append(head, el('div', 'email', row.email), actions, projects);
    list.append(card);
  }
}

window.addEventListener('message', event => {
  if (event.data && event.data.type === 'state') { render(event.data.rows); }
});
document.getElementById('add-btn').addEventListener('click', () => vscode.postMessage({ type: 'add' }));
vscode.postMessage({ type: 'ready' });
`;
```

Create `ui/accountsHtml.ts`:

```ts
'use strict';

import { CLIENT_SCRIPT } from './accountsClient';

const CSS = `
*,*::before,*::after{box-sizing:border-box;}
body{font-family:var(--vscode-font-family);font-size:12px;line-height:1.5;color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;}
#page{max-width:680px;margin:0 auto;padding:28px 26px 60px;}
h1{font-size:19px;font-weight:600;margin:0 0 4px;}
.subtitle{margin:0 0 18px;color:var(--vscode-descriptionForeground);}
#toolbar{margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--vscode-widget-border,rgba(255,255,255,.08));}
button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:4px;padding:4px 11px;cursor:pointer;font:inherit;}
button:hover{filter:brightness(1.12);}
button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
button.danger{color:var(--vscode-errorForeground);}
#empty{display:none;text-align:center;padding:30px 18px;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-widget-border,rgba(255,255,255,.14));border-radius:8px;}
#empty.visible{display:block;}
.card{background:var(--vscode-editorWidget-background,rgba(255,255,255,.02));border:1px solid var(--vscode-widget-border,rgba(255,255,255,.08));border-radius:7px;padding:12px 14px;margin-bottom:10px;}
.head{display:flex;align-items:baseline;gap:10px;}
.name{font-size:14px;font-weight:600;}
.meta,.email,.ppath{color:var(--vscode-descriptionForeground);}
.actions{display:flex;gap:6px;margin:8px 0 10px;}
.projects h3{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--vscode-descriptionForeground);margin:0 0 4px;}
.project{display:flex;align-items:center;gap:10px;padding:2px 0;}
.pname{font-weight:600;}
.ppath{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.project.missing .pname,.project.missing .ppath{text-decoration:line-through;opacity:.7;}
`;

/** The panel page. Contains no account data — the host posts that after the script announces `ready`. */
export function buildHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Null Accounts</title>
<style nonce="${nonce}">${CSS}</style>
</head>
<body>
<div id="page">
  <h1>Null Accounts</h1>
  <p class="subtitle">Each project uses one account for GitHub features.</p>
  <div id="toolbar"><button id="add-btn" class="primary">Add GitHub account</button></div>
  <div id="list"></div>
  <div id="empty">No accounts yet — add one above.</div>
</div>
<script nonce="${nonce}">${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
```

In `package.json`, append ` out/ui/panelMessages.test.js out/ui/accountsHtml.test.js` to the `test` script's `node --test …` list.

- [ ] **Step 4: Run to verify pass**

Run: `npm test --prefix extensions/null-accounts`
Expected: PASS, including the new message and HTML tests.

- [ ] **Step 5: Implement the panel (the `vscode` adapter)**

Create `ui/accountsPanel.ts`:

```ts
'use strict';

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { validateNewAccount } from '../accountInput';
import { AccountStore } from '../accountStore';
import { ProjectBinding } from '../projectBinding';
import { Account } from '../types';
import { buildHtml } from './accountsHtml';
import { buildRows, removeConfirmation, ResolveFolder } from './accountsView';
import { parsePanelMessage } from './panelMessages';

export interface PanelDeps {
  accounts: AccountStore;
  bindings: ProjectBinding;
  /** Sign in to another GitHub account and store it (ui/accountPicker `addGithubAccount`). */
  addGithub(): Promise<Account | undefined>;
  /** Fires when accounts or bindings change. */
  onDidChange: vscode.Event<void>;
}

/** Real-cased path when the folder exists (binding keys are lower-cased on Windows). */
const resolveFolder: ResolveFolder = key => {
  try { return { path: fs.realpathSync.native(key), exists: true }; } catch { return { path: key, exists: false }; }
};

/** The Accounts tab in the main editor area. One at a time; state is re-posted on every change. */
export class AccountsPanel {
  private static current: AccountsPanel | undefined;

  static createOrShow(deps: PanelDeps): void {
    if (AccountsPanel.current) {
      AccountsPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'null-accounts.panel',
      'Null Accounts',
      vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [] },
    );
    AccountsPanel.current = new AccountsPanel(panel, deps);
  }

  private constructor(private readonly panel: vscode.WebviewPanel, private readonly deps: PanelDeps) {
    panel.webview.html = buildHtml(randomBytes(16).toString('hex'));
    const changes = deps.onDidChange(() => this.postState());
    panel.webview.onDidReceiveMessage(raw => void this.handle(raw));
    panel.onDidDispose(() => {
      changes.dispose();
      AccountsPanel.current = undefined;
    });
  }

  private postState(): void {
    const rows = buildRows(this.deps.accounts.list(), this.deps.bindings.entries(), resolveFolder);
    void this.panel.webview.postMessage({ type: 'state', rows });
  }

  private async handle(raw: unknown): Promise<void> {
    const msg = parsePanelMessage(raw);
    if (!msg) { return; }
    try {
      switch (msg.type) {
        case 'ready': this.postState(); break;
        case 'add': await this.deps.addGithub(); break; // the store's change event refreshes the list
        case 'unbind': await this.deps.bindings.unbind(msg.key); break;
        case 'remove': await this.remove(msg.id); break;
        case 'editEmail': await this.editEmail(msg.id); break;
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`Null Accounts: ${(err as Error).message}`);
    }
  }

  private async remove(id: string): Promise<void> {
    const account = this.deps.accounts.get(id);
    if (!account) { return; }
    const used = this.deps.bindings.entries().filter(([, accountId]) => accountId === id).length;
    const { message, detail } = removeConfirmation(account, used);
    if (await vscode.window.showWarningMessage(message, { modal: true, detail }, 'Remove') !== 'Remove') { return; }
    await this.deps.accounts.remove(id); // extension.ts prunes the now-dangling bindings
  }

  private async editEmail(id: string): Promise<void> {
    const account = this.deps.accounts.get(id);
    if (!account) { return; }
    const email = await vscode.window.showInputBox({
      title: `Email for ${account.username}`,
      prompt: 'Email address for this account',
      value: account.email,
      validateInput: value => {
        try { validateNewAccount({ ...account, email: value }); return undefined; } catch (err) { return (err as Error).message; }
      },
    });
    if (email === undefined || email.trim() === account.email) { return; }
    await this.deps.accounts.update(id, { email });
  }
}
```

- [ ] **Step 6: Run to verify the adapter compiles**

Run: `npm test --prefix extensions/null-accounts`
Expected: PASS, `tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add extensions/null-accounts/src/ui extensions/null-accounts/package.json
git commit -m "feat: add the null-accounts Accounts panel"
```

---

### Task 5: Wire it up, integration spec, docs

**Files:**
- Modify: `extensions/null-accounts/src/extension.ts`
- Modify: `extensions/null-accounts/package.json` (`contributes.commands`)
- Modify: `extensions/null-accounts/src/test/suite/activation.spec.ts`
- Modify: `CLAUDE.md` (null-accounts section)

**Interfaces:**
- Consumes: everything above — `AccountsPanel.createOrShow`, `registerStatusBar`, `SWITCH_COMMAND`, `addGithubAccount`, `chooseAccountForFolder`, `PickerDeps`.
- Produces: commands `null-accounts.open` and `null-accounts.switchAccount`; the status bar item.

- [ ] **Step 1: Write the failing integration spec**

Append inside the `suite('null-accounts activation', …)` block of `activation.spec.ts`, after the existing test:

```ts
  test('Phase 3: both commands are registered; the panel opens; switch with no folder resolves', async () => {
    await vscode.extensions.getExtension<NullAccountsApi>('null.null-accounts')!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('null-accounts.open'), 'null-accounts.open not registered');
    assert.ok(commands.includes('null-accounts.switchAccount'), 'null-accounts.switchAccount not registered');

    await vscode.commands.executeCommand('null-accounts.open');
    const labels = vscode.window.tabGroups.all.flatMap(g => g.tabs.map(t => t.label));
    assert.ok(labels.includes('Null Accounts'), `no Accounts tab among: ${labels.join(', ')}`);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

    if (!vscode.workspace.workspaceFolders?.length) {
      // Must show a message and return — not block on it, and not open a quick-pick.
      await vscode.commands.executeCommand('null-accounts.switchAccount');
    }
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration --prefix extensions/null-accounts` (needs the synced build — use the `verify-local` skill, which runs `scripts/sync-local.ps1` first).
Expected: FAIL — `null-accounts.open not registered`.

- [ ] **Step 3: Contribute the commands**

In `package.json`, add a `contributes` block after `activationEvents`:

```json
  "contributes": {
    "commands": [
      { "command": "null-accounts.open", "title": "Null Accounts: Manage Accounts" },
      { "command": "null-accounts.switchAccount", "title": "Null Accounts: Switch Account for This Project" }
    ]
  },
```

- [ ] **Step 4: Wire `extension.ts`**

Replace the imports' `chooseAccountForFolder` line and the body of `activate` up to `void offerImport(…)` as follows.

Imports (replace the `ui/accountPicker` import and add three):

```ts
import { addGithubAccount, chooseAccountForFolder, PickerDeps } from './ui/accountPicker';
import { AccountsPanel } from './ui/accountsPanel';
import { registerStatusBar, SWITCH_COMMAND } from './ui/statusBarController';
```

In `activate`, after the `changed` subscriptions block, replace the `createApi({...})` call and add the registrations:

```ts
  const pickerDeps: PickerDeps = { accounts: store, bindings, github };

  const api = createApi({
    accounts: store,
    accountIdForFolder: folder => bindings.accountIdFor(folder.fsPath),
    chooseAccountForFolder: folder => chooseAccountForFolder(pickerDeps, folder),
    tokenProviders: { github }, // Phase 4 adds gitlab
    onDidChange: changed.event,
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('null-accounts.open', () =>
      AccountsPanel.createOrShow({
        accounts: store,
        bindings,
        addGithub: () => addGithubAccount(pickerDeps),
        onDidChange: changed.event,
      })),
    vscode.commands.registerCommand(SWITCH_COMMAND, async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showInformationMessage('Open a folder to choose its account.');
        return;
      }
      await chooseAccountForFolder(pickerDeps, folder.uri);
    }),
    registerStatusBar(api),
  );
```

(`void` on the message matters: `showInformationMessage` only resolves when the toast is dismissed, so awaiting it would hang the command.)

- [ ] **Step 5: Run unit tests and the integration spec**

Run: `npm test --prefix extensions/null-accounts`
Expected: PASS, `tsc` clean.

Then invoke the `verify-local` skill for `null-accounts` and confirm the integration spec passes, then launch the synced Null IDE, run **Null Accounts: Manage Accounts** and check by eye: the panel opens, the empty state shows, **Add GitHub account** signs in and the card appears, **Edit email** validates, **Remove** shows the confirmation (with the project count when bound), the status bar item flips between the account and "No account" when switching and clearing from the quick-pick.

- [ ] **Step 6: Update the docs**

In `CLAUDE.md`'s null-accounts section: change `**Status: GitHub + project binding**` to `**Status: GitHub + project binding + UI**`, and replace the sentence `The accounts webview, GitLab, and git wiring land in later phases.` with `The Accounts panel (\`null-accounts.open\`: list, add, edit email, remove, per-account projects with unbind) and a status bar item (click → \`null-accounts.switchAccount\` quick-pick to switch or clear) are in; GitLab and git wiring land in later phases.` Add `docs/plans/null-accounts-phase3-ui.md` to the "phase plans" reference if the section lists them by name.

Run `graphify update .` (project rule after modifying code).

- [ ] **Step 7: Commit**

```bash
git add extensions/null-accounts/src/extension.ts extensions/null-accounts/package.json extensions/null-accounts/src/test/suite/activation.spec.ts CLAUDE.md
git commit -m "feat: wire the null-accounts panel, status bar item and switch command"
```

---

## Self-Review

**Spec coverage** (spec → `ui` bullet and Phase 3 line):
- Accounts webview in the main editor area, same pattern as `null-actions` → Task 4 (`WebviewPanel`, `ViewColumn.One`).
- List / add / edit / remove → Task 4 (rows, `add`, `editEmail`, `remove`). Edit is email-only — documented in Global Constraints.
- Per-account "projects using this" → Tasks 1 and 4 (`ProjectRef`, unbind button).
- Status bar item showing the current folder's account; click → quick-pick to switch or add → Tasks 2 and 3.
- Command `null-accounts.open` → Task 5.
- Spec's "account removed while bound: bindings cleared" → already wired (`store.onDidChange` → `bindings.prune` in `extension.ts`); Task 4's `remove` relies on it and Task 1's confirmation text tells the user.
- Gaps by design, recorded in Global Constraints: "needs re-auth" (Phase 4), GitLab add (Phase 4), SSH key editing (Phase 5), dashboard (Phase 6).

**Placeholder scan:** no TBD/TODO/"similar to" — every step carries its code.

**Type consistency:** `PickAction`/`PickItem`/`PickOptions`/`buildPickItems(accounts, options?)` (Task 2) are the shapes `accountPicker.ts` consumes in the same task; `ProjectBinding.entries(): [string, string][]` (Task 1) feeds `buildRows(accounts, entries, resolve)` and the panel's `remove` count (Task 4); `AccountRow`/`ResolveFolder` (Task 1) are used unchanged in `accountsPanel.ts`; `PanelMessage` field names (`id`, `key`) match what `accountsClient.ts` posts (`id: row.id`, `key: p.key`); `SWITCH_COMMAND` (Task 3) matches the `package.json` command id and the integration spec string; `PickerDeps` is exported from `accountPicker.ts` (already `export interface` there).

**Review Focus:** each of the five lines has an owning test — #1 `accountsHtml.test.ts` guards, #2 `panelMessages.test.ts` (and missing-id no-ops are the `if (!account) return` in the panel), #3 `accountsView.test.ts` + `projectBinding.test.ts` Windows key round-trip, #4 `removeConfirmation` test + existing prune, #5 `pickItems.test.ts` unbind/stale-current cases, `statusBarModel.test.ts`, and the integration spec's no-folder `switchAccount`.

# Null Accounts — Phase 4: Accounts Menu Integration Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Make VS Code's Accounts menu (the avatar at the bottom of the activity bar) list null-accounts' accounts with the current project's one checked, bind the project on click, offer `Add Account…` / `Manage Accounts…`, and drop VS Code's own provider-session, Settings Sync, Copilot, Edit Sessions and tunnel rows.

**Architecture:** `null-accounts` computes the menu as plain data and publishes it as the context key `null.accounts.menu` (`setContext`). A small workbench patch (`007`) changes only `AccountsActivityActionViewItem.resolveMainMenuActions` to render that key and to keep just the sign-in/access *request* menu groups. All logic with branches is pure and node-testable (`accountsMenuModel.ts`, `accountsMenuActions.ts`); only `accountsMenuController.ts` and `extension.ts` touch `vscode`.

**Tech Stack:** TypeScript (strict) + `node --test` for the extension; a git patch against the VS Code source tree (`src/vs/workbench/browser/parts/globalCompositeBar.ts`, CRLF line endings); `@vscode/test-electron` + mocha for the one integration spec.

**Spec:** `docs/specs/null-accounts-menu-design.md`, building on `docs/specs/null-accounts-design.md`. This is the phase inserted before GitLab: (1) Foundation, (2) GitHub + binding, (3) UI — all landed (`docs/plans/null-accounts-phase{1,2,3}-*.md`); (4) Accounts menu ← this plan; GitLab, Git wiring and Integration shift to 5–7.

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

- Phase 1–3 constraints still hold: every `.ts` file starts with `'use strict';`; unit-tested modules do not import `vscode` at runtime (`import type` is fine); edit TypeScript sources only — `extensions/null-accounts/out/` is tracked but is regenerated with `npm run compile` and committed in its own `chore:` commit (see history: "chore: refresh null-accounts compiled output"); commit after each task, message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; do not push.
- Context key name: `null.accounts.menu`. Entry contract (the workbench knows nothing else about null-accounts):
  `type NullAccountsMenuEntry = 'separator' | { label: string; description?: string; checked?: boolean; command: string; args?: unknown[] }`.
- Commands: `null-accounts.bindFolderToAccount(accountId)`, `null-accounts.addAccount`; existing `null-accounts.open` is the `Manage Accounts…` target. Menu labels are exactly `Add Account…` and `Manage Accounts…` (U+2026 ellipsis).
- "Current folder" = `vscode.workspace.workspaceFolders?.[0]`, the same rule as the status bar and `switchAccount`.
- Workbench patch scope: only `AccountsActivityActionViewItem.resolveMainMenuActions` plus the minimum needed to keep `noUnusedLocals` happy. `groupedAccounts`, `addAccountsFromProvider`, `updateAvatar` and the avatar setting stay untouched.
- Kept menu groups (allow-list): `2_signInRequests`, `3_accessRequests`. Everything else from `MenuId.AccountsContext` is dropped.
- `globalCompositeBar.ts` has **CRLF** line endings; the patch must not turn into a whole-file diff.
- The patch is a plain `git diff` applied in CI with `git apply --ignore-whitespace`, after VSCodium's patches and `001`–`006`. No earlier patch touches this file.
- Full build via `scripts/build-local.ps1` is **not** run unless the user asks (tens of minutes). `vscode-src/` is gitignored and already present locally; leave it unpatched when done.
- Not in this phase: GitLab, per-account submenus, hiding the "Sign in with X to use Y" / "Grant access" request rows, signing out of VS Code's GitHub session on *Remove account* (see Task 5 for the finding).

## Review Focus

Inputs the spec implies but doesn't spell out, most likely to bite first. Each has a test (or, for the workbench, a stated manual check) in the owning task.

1. **Stale click** — an account removed between the menu opening and the click → `bindFolderToAccount` re-reads the store, binds nothing, and tells the user. A non-string / missing id behaves the same. (Task 2)
2. **No folder open** — clicking an account does nothing but show "Open a folder to choose its account."; the published menu has no check mark and still offers Add / Manage. (Tasks 1, 2)
3. **`setContext` rejects or the model throws** — never breaks activation or an `onDidChange` listener; the previous key value stays. (Task 2)
4. **Current folder is bound to an account that no longer exists, or `currentAccountId` is `undefined`** — no entry is checked. (Task 1)
5. **Key unset or malformed in the workbench** (null-accounts not yet activated, failed to load, or a value that isn't an array / has junk entries) — the menu shows only the request groups, junk entries are skipped, nothing throws. (Task 4 — the reader is defensive by construction; verified by the typecheck and the manual visual check, since the workbench has no unit-test runner wired into this repo.)

---

### Task 1: Menu model (pure)

**Files:**
- Create: `extensions/null-accounts/src/ui/accountsMenuModel.ts`
- Test: `extensions/null-accounts/src/ui/accountsMenuModel.test.ts`
- Modify: `extensions/null-accounts/package.json` (`scripts.test` list)

**Interfaces:**
- Consumes: `Account` from `../types`.
- Produces (Task 2 and 3 import these exact names from `./accountsMenuModel`):
  - `type NullAccountsMenuEntry` (as in Global Constraints)
  - `const MENU_CONTEXT_KEY = 'null.accounts.menu'`
  - `const BIND_COMMAND = 'null-accounts.bindFolderToAccount'`, `ADD_ACCOUNT_COMMAND = 'null-accounts.addAccount'`, `MANAGE_COMMAND = 'null-accounts.open'`
  - `accountsMenuModel(accounts: readonly Account[], currentAccountId?: string): NullAccountsMenuEntry[]`

- [ ] **Step 1: Write the failing test**

Create `extensions/null-accounts/src/ui/accountsMenuModel.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Account } from '../types';
import { accountsMenuModel, ADD_ACCOUNT_COMMAND, BIND_COMMAND, MANAGE_COMMAND } from './accountsMenuModel';

const acct = (id: string, host = 'github.com'): Account =>
  ({ id, provider: 'github', host, username: id, email: `${id}@e.com`, authMethod: 'oauth' });

const ADD = { label: 'Add Account…', command: ADD_ACCOUNT_COMMAND };
const MANAGE = { label: 'Manage Accounts…', command: MANAGE_COMMAND };

test('no accounts: just Add and Manage, no leading separator', () => {
  assert.deepStrictEqual(accountsMenuModel([]), [ADD, MANAGE]);
});

test('each account becomes a row that binds the folder to it, then a separator, then Add and Manage', () => {
  const m = accountsMenuModel([acct('octo'), acct('hub', 'ghe.example.org')]);
  assert.deepStrictEqual(m, [
    { label: 'octo', description: 'github.com', checked: false, command: BIND_COMMAND, args: ['octo'] },
    { label: 'hub', description: 'ghe.example.org', checked: false, command: BIND_COMMAND, args: ['hub'] },
    'separator',
    ADD,
    MANAGE,
  ]);
});

test('only the current account is checked', () => {
  const m = accountsMenuModel([acct('a1'), acct('a2'), acct('a3')], 'a2');
  const checked = m.filter(e => e !== 'separator' && e.checked).map(e => (e as { args?: unknown[] }).args?.[0]);
  assert.deepStrictEqual(checked, ['a2']);
});

test('a current id that is not in the list (removed account) checks nothing', () => {
  const m = accountsMenuModel([acct('a1')], 'gone');
  assert.ok(m.every(e => e === 'separator' || !e.checked));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `extensions/null-accounts/`): `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './accountsMenuModel'`.

- [ ] **Step 3: Write the implementation**

Create `extensions/null-accounts/src/ui/accountsMenuModel.ts`:

```ts
'use strict';

import { Account } from '../types';

/** Contract with the workbench patch (007): it renders whatever array is under this key. */
export type NullAccountsMenuEntry =
  | 'separator'
  | { label: string; description?: string; checked?: boolean; command: string; args?: unknown[] };

export const MENU_CONTEXT_KEY = 'null.accounts.menu';
export const BIND_COMMAND = 'null-accounts.bindFolderToAccount';
export const ADD_ACCOUNT_COMMAND = 'null-accounts.addAccount';
export const MANAGE_COMMAND = 'null-accounts.open';

/** The Accounts menu: one row per account (current one checked), then Add / Manage. */
export function accountsMenuModel(accounts: readonly Account[], currentAccountId?: string): NullAccountsMenuEntry[] {
  const rows: NullAccountsMenuEntry[] = accounts.map(a => ({
    label: a.username,
    description: a.host,
    checked: a.id === currentAccountId,
    command: BIND_COMMAND,
    args: [a.id],
  }));
  if (rows.length) { rows.push('separator'); }
  rows.push(
    { label: 'Add Account…', command: ADD_ACCOUNT_COMMAND },
    { label: 'Manage Accounts…', command: MANAGE_COMMAND },
  );
  return rows;
}
```

- [ ] **Step 4: Register the test file in the suite**

In `extensions/null-accounts/package.json`, append ` out/ui/accountsMenuModel.test.js` to the end of the `scripts.test` command (after `out/ui/accountsHtml.test.js`).

- [ ] **Step 5: Run the tests and verify they pass**

Run (from `extensions/null-accounts/`): `npx tsc -p tsconfig.json && node --test out/ui/accountsMenuModel.test.js`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-accounts/src/ui/accountsMenuModel.ts extensions/null-accounts/src/ui/accountsMenuModel.test.ts extensions/null-accounts/package.json
git commit -m "feat: add the null-accounts Accounts menu model"
```

---

### Task 2: Bind and publish logic (pure)

**Files:**
- Create: `extensions/null-accounts/src/ui/accountsMenuActions.ts`
- Test: `extensions/null-accounts/src/ui/accountsMenuActions.test.ts`
- Modify: `extensions/null-accounts/package.json` (`scripts.test` list)

**Interfaces:**
- Consumes: `Account` (`../types`); `MENU_CONTEXT_KEY`, `NullAccountsMenuEntry` (`./accountsMenuModel`).
- Produces (Task 3 imports these):
  - `type BindResult = 'bound' | 'no-folder' | 'no-account'`
  - `interface BindDeps { folderPath: string | undefined; accounts: { get(id: string): Account | undefined }; bindings: { bind(folderPath: string, accountId: string): Promise<void> } }`
  - `bindFolderToAccount(deps: BindDeps, accountId: unknown): Promise<BindResult>`
  - `publishAccountsMenu(compute: () => NullAccountsMenuEntry[], setContext: (key: string, value: unknown) => PromiseLike<unknown>): Promise<void>` — never rejects.

- [ ] **Step 1: Write the failing test**

Create `extensions/null-accounts/src/ui/accountsMenuActions.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Account } from '../types';
import { bindFolderToAccount, publishAccountsMenu } from './accountsMenuActions';
import { MENU_CONTEXT_KEY, NullAccountsMenuEntry } from './accountsMenuModel';

const acct = (id: string): Account =>
  ({ id, provider: 'github', host: 'github.com', username: id, email: `${id}@e.com`, authMethod: 'oauth' });

function deps(folderPath: string | undefined, accounts: Account[]) {
  const bound: [string, string][] = [];
  return {
    bound,
    deps: {
      folderPath,
      accounts: { get: (id: string) => accounts.find(a => a.id === id) },
      bindings: { bind: async (folder: string, id: string) => { bound.push([folder, id]); } },
    },
  };
}

test('binds the first folder to an existing account', async () => {
  const d = deps('C:/work/repo', [acct('a1')]);
  assert.strictEqual(await bindFolderToAccount(d.deps, 'a1'), 'bound');
  assert.deepStrictEqual(d.bound, [['C:/work/repo', 'a1']]);
});

test('no folder open: nothing is bound', async () => {
  const d = deps(undefined, [acct('a1')]);
  assert.strictEqual(await bindFolderToAccount(d.deps, 'a1'), 'no-folder');
  assert.deepStrictEqual(d.bound, []);
});

test('stale click (account removed since the menu opened), missing or non-string id: nothing is bound', async () => {
  const d = deps('C:/work/repo', [acct('a1')]);
  for (const id of ['gone', undefined, 42, { id: 'a1' }]) {
    assert.strictEqual(await bindFolderToAccount(d.deps, id), 'no-account');
  }
  assert.deepStrictEqual(d.bound, []);
});

test('publishes the model under the menu context key', async () => {
  const calls: [string, unknown][] = [];
  const model: NullAccountsMenuEntry[] = ['separator'];
  await publishAccountsMenu(() => model, async (k, v) => { calls.push([k, v]); });
  assert.deepStrictEqual(calls, [[MENU_CONTEXT_KEY, model]]);
});

test('a throwing model or a rejecting setContext never escapes', async () => {
  await publishAccountsMenu(() => { throw new Error('boom'); }, async () => { assert.fail('must not publish'); });
  await publishAccountsMenu(() => [], async () => { throw new Error('host gone'); });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `extensions/null-accounts/`): `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './accountsMenuActions'`.

- [ ] **Step 3: Write the implementation**

Create `extensions/null-accounts/src/ui/accountsMenuActions.ts`:

```ts
'use strict';

import { Account } from '../types';
import { MENU_CONTEXT_KEY, NullAccountsMenuEntry } from './accountsMenuModel';

export type BindResult = 'bound' | 'no-folder' | 'no-account';

export interface BindDeps {
  /** First workspace folder's fsPath; undefined when no folder is open. */
  folderPath: string | undefined;
  accounts: { get(id: string): Account | undefined };
  bindings: { bind(folderPath: string, accountId: string): Promise<void> };
}

/** The menu's click target. Re-reads the store, so a row for an account removed since the menu opened is a no-op. */
export async function bindFolderToAccount(deps: BindDeps, accountId: unknown): Promise<BindResult> {
  if (deps.folderPath === undefined) { return 'no-folder'; }
  if (typeof accountId !== 'string' || !deps.accounts.get(accountId)) { return 'no-account'; }
  await deps.bindings.bind(deps.folderPath, accountId);
  return 'bound';
}

/** Publishes the menu; a failure leaves the previous key value in place and must never break activation or a listener. */
export async function publishAccountsMenu(
  compute: () => NullAccountsMenuEntry[],
  setContext: (key: string, value: unknown) => PromiseLike<unknown>,
): Promise<void> {
  try {
    await setContext(MENU_CONTEXT_KEY, compute());
  } catch { /* keep the previous value */ }
}
```

- [ ] **Step 4: Register the test file in the suite**

In `extensions/null-accounts/package.json`, append ` out/ui/accountsMenuActions.test.js` to the end of `scripts.test`.

- [ ] **Step 5: Run the tests and verify they pass**

Run (from `extensions/null-accounts/`): `npx tsc -p tsconfig.json && node --test out/ui/accountsMenuActions.test.js`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-accounts/src/ui/accountsMenuActions.ts extensions/null-accounts/src/ui/accountsMenuActions.test.ts extensions/null-accounts/package.json
git commit -m "feat: add null-accounts menu bind and publish logic"
```

---

### Task 3: Wire the controller, commands and integration spec

**Files:**
- Create: `extensions/null-accounts/src/ui/accountsMenuController.ts`
- Modify: `extensions/null-accounts/src/extension.ts`
- Modify: `extensions/null-accounts/package.json` (`contributes`)
- Modify: `extensions/null-accounts/src/test/suite/activation.spec.ts`
- Regenerate + commit: `extensions/null-accounts/out/`

**Interfaces:**
- Consumes: `NullAccountsApi` (`../api`); `accountsMenuModel`, `ADD_ACCOUNT_COMMAND`, `BIND_COMMAND` (`./accountsMenuModel`); `publishAccountsMenu`, `bindFolderToAccount` (`./accountsMenuActions`); existing `addGithubAccount(pickerDeps)`, `store`, `bindings`, `pickerDeps` in `extension.ts`.
- Produces: `registerAccountsMenu(api: NullAccountsApi): vscode.Disposable`; two registered commands.

- [ ] **Step 1: Write the controller**

Create `extensions/null-accounts/src/ui/accountsMenuController.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import type { NullAccountsApi } from '../api';
import { publishAccountsMenu } from './accountsMenuActions';
import { accountsMenuModel } from './accountsMenuModel';

/** Keeps the `null.accounts.menu` context key (rendered by the workbench Accounts menu) in sync with accounts, bindings and the open folder. */
export function registerAccountsMenu(api: NullAccountsApi): vscode.Disposable {
  const refresh = (): void => {
    void publishAccountsMenu(
      () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        return accountsMenuModel(api.getAccounts(), folder ? api.getAccountForFolder(folder.uri)?.id : undefined);
      },
      (key, value) => vscode.commands.executeCommand('setContext', key, value),
    );
  };
  refresh();
  return vscode.Disposable.from(api.onDidChange(refresh), vscode.workspace.onDidChangeWorkspaceFolders(refresh));
}
```

- [ ] **Step 2: Register the commands and the controller in `extension.ts`**

Add imports next to the other `./ui/...` imports:

```ts
import { bindFolderToAccount } from './ui/accountsMenuActions';
import { registerAccountsMenu } from './ui/accountsMenuController';
import { ADD_ACCOUNT_COMMAND, BIND_COMMAND } from './ui/accountsMenuModel';
```

In the `context.subscriptions.push(...)` call, between the `SWITCH_COMMAND` registration and `registerStatusBar(api)`, add:

```ts
    vscode.commands.registerCommand(BIND_COMMAND, async (accountId: unknown) => {
      const result = await bindFolderToAccount(
        { folderPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, accounts: store, bindings },
        accountId,
      );
      if (result === 'no-folder') { void vscode.window.showInformationMessage('Open a folder to choose its account.'); }
      if (result === 'no-account') { void vscode.window.showInformationMessage('That account no longer exists.'); }
    }),
    vscode.commands.registerCommand(ADD_ACCOUNT_COMMAND, async () => { await addGithubAccount(pickerDeps); }),
```

and after `registerStatusBar(api),` add `registerAccountsMenu(api),`.

- [ ] **Step 3: Declare the commands in `package.json`**

In `contributes.commands` add:

```json
      { "command": "null-accounts.addAccount", "title": "Null Accounts: Add Account" },
      { "command": "null-accounts.bindFolderToAccount", "title": "Null Accounts: Use Account for This Project" }
```

and add a sibling of `commands` inside `contributes` (the bind command takes an id argument, so keep it out of the palette):

```json
    "menus": {
      "commandPalette": [
        { "command": "null-accounts.bindFolderToAccount", "when": "false" }
      ]
    }
```

- [ ] **Step 4: Extend the integration spec**

In `extensions/null-accounts/src/test/suite/activation.spec.ts`, add a third test inside the `suite(...)` block, after the Phase 3 test:

```ts
  test('Phase 4: menu commands are registered; a stale bind resolves without throwing', async () => {
    await vscode.extensions.getExtension<NullAccountsApi>('null.null-accounts')!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('null-accounts.bindFolderToAccount'), 'bindFolderToAccount not registered');
    assert.ok(commands.includes('null-accounts.addAccount'), 'addAccount not registered');

    // No such account: must be a no-op (an info message, not a throw, not a binding).
    await vscode.commands.executeCommand('null-accounts.bindFolderToAccount', 'does-not-exist');
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      const api = vscode.extensions.getExtension<NullAccountsApi>('null.null-accounts')!.exports as NullAccountsApi;
      assert.strictEqual(api.getAccountForFolder(folder.uri), undefined);
    }
    // The `null.accounts.menu` context key cannot be read from the extension host, so its content is
    // covered by accountsMenuModel/accountsMenuActions unit tests and the manual check in Task 4.
  });
```

(`null-accounts.addAccount` is only checked for registration: running it would open a GitHub sign-in.)

- [ ] **Step 5: Compile and run the unit suite**

Run (from `extensions/null-accounts/`): `npm test`
Expected: tsc clean; all suites pass, including the two new ones.

- [ ] **Step 6: Commit the sources**

```bash
git add extensions/null-accounts/src/ui/accountsMenuController.ts extensions/null-accounts/src/extension.ts extensions/null-accounts/package.json extensions/null-accounts/src/test/suite/activation.spec.ts
git commit -m "feat: publish the null-accounts Accounts menu and add its commands"
```

- [ ] **Step 7: Run the integration spec (only if the install is synced)**

Use the `verify-local` skill (syncs source into the local Null IDE install, then runs `npm run test:integration` in `extensions/null-accounts/`). Expected: all `null-accounts activation` tests pass. If the user hasn't synced / doesn't want that now, say it was skipped.

- [ ] **Step 8: Commit the compiled output**

```bash
git add extensions/null-accounts/out
git commit -m "chore: refresh null-accounts compiled output"
```

---

### Task 4: Workbench patch `007-accounts-menu-null-accounts.patch`

**Files:**
- Create: `patches/007-accounts-menu-null-accounts.patch`
- Temporarily modify (then restore): `vscode-src/src/vs/workbench/browser/parts/globalCompositeBar.ts`

**Interfaces:**
- Consumes: context key `null.accounts.menu` with the `NullAccountsMenuEntry[]` contract from Task 1.
- Produces: a patch that `git apply --ignore-whitespace` accepts on a tree with VSCodium patches and `001`–`006`.

All commands below run in Git Bash from the repo root `D:/Coding/Apps/null-ide` unless stated.

- [ ] **Step 1: Confirm the target file is pristine**

Run: `git -C vscode-src status --short src/vs/workbench/browser/parts/globalCompositeBar.ts`
Expected: no output. (If it prints `M`, stop: the patch would capture someone else's changes. Restore with `git -C vscode-src checkout -- src/vs/workbench/browser/parts/globalCompositeBar.ts` after confirming with the user.)

- [ ] **Step 2: Write the edit script (outside the repo)**

The file has CRLF endings and the method to replace is ~150 lines, so edit with a script that normalizes to LF, makes exact-once replacements, and converts back. Save as `$TMPDIR/edit-accounts-menu.js` (any dir outside the repo):

```js
const fs = require('fs');
const file = process.argv[2];
let s = fs.readFileSync(file, 'utf8');
const crlf = s.includes('\r\n');
s = s.replace(/\r\n/g, '\n');

function rep(from, to) {
	if (s.split(from).length !== 2) { throw new Error('expected exactly one match for: ' + from); }
	s = s.replace(from, () => to);
}

// imports that only the removed code used (noUnusedLocals)
rep('import { Action, IAction, Separator, SubmenuAction, toAction }', 'import { Action, IAction, Separator, toAction }');
rep('AuthenticationSessionAccount, IAuthenticationService, INTERNAL_AUTH_PROVIDER_PREFIX }', 'AuthenticationSessionAccount, IAuthenticationService }');
rep('import { createCodexAccountMenuActions, ICodexAccountService, shouldShowCodexAccount }', 'import { ICodexAccountService }');

// the subclass needs the context key service; the base class kept it private
rep('@IContextKeyService private readonly contextKeyService: IContextKeyService,', '@IContextKeyService protected readonly contextKeyService: IContextKeyService,');

// Codex rows are gone, but the constructor parameter stays so the subclass's super(...) call is unchanged
rep('@ICodexAccountService private readonly codexAccountService: ICodexAccountService,', '@ICodexAccountService codexAccountService: ICodexAccountService,');

// `initialized` was only read by the removed provider loop
rep('\tprivate initialized = false;\n', '');
rep('\t\tthis.initialized = true;\n', '');

// reader + entry type, placed right before the view item
rep('export class AccountsActivityActionViewItem ', `// Null IDE: null-accounts publishes the Accounts menu rows as the context key \`null.accounts.menu\`.
type NullAccountsMenuEntry = 'separator' | { label: string; description?: string; checked?: boolean; command: string; args?: unknown[] };

function readNullAccountsMenu(value: unknown): NullAccountsMenuEntry[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((e): e is NullAccountsMenuEntry => {
		if (e === 'separator') {
			return true;
		}
		if (typeof e !== 'object' || e === null) {
			return false;
		}
		const entry = e as Record<string, unknown>;
		return typeof entry.label === 'string' && typeof entry.command === 'string'
			&& (entry.description === undefined || typeof entry.description === 'string')
			&& (entry.checked === undefined || typeof entry.checked === 'boolean')
			&& (entry.args === undefined || Array.isArray(entry.args));
	});
}

export class AccountsActivityActionViewItem `);

// the method itself: from its signature to its \`return menus;\` closer
const start = s.indexOf('\tprotected override async resolveMainMenuActions(accountsMenu: IMenu');
const closer = '\t\treturn menus;\n\t}\n';
const end = s.indexOf(closer, start);
if (start < 0 || end < 0) { throw new Error('resolveMainMenuActions markers not found'); }
s = s.slice(0, start) + `\tprotected override async resolveMainMenuActions(accountsMenu: IMenu, disposables: DisposableStore): Promise<IAction[]> {
		await super.resolveMainMenuActions(accountsMenu, disposables);

		// Null IDE: the account rows come from null-accounts; VS Code's provider sessions and the
		// Settings Sync / Copilot / Edit Sessions / tunnel groups are not shown. The sign-in and
		// access request groups stay so extensions calling getSession() can still surface a prompt.
		let menus: IAction[] = readNullAccountsMenu(this.contextKeyService.getContextKeyValue('null.accounts.menu')).map((entry, i) => {
			if (entry === 'separator') {
				return new Separator();
			}
			return toAction({
				id: \`null.accounts.menu.\${i}\`,
				label: entry.description ? \`\${entry.label} (\${entry.description})\` : entry.label,
				checked: entry.checked,
				run: () => this.commandService.executeCommand(entry.command, ...(entry.args ?? []))
			});
		});

		const requestGroups = accountsMenu.getActions().filter(([group]) => group === '2_signInRequests' || group === '3_accessRequests');
		if (menus.length && requestGroups.length) {
			menus.push(new Separator());
		}
		requestGroups.forEach(([, actions], i) => {
			menus = menus.concat(actions);
			if (i !== requestGroups.length - 1) {
				menus.push(new Separator());
			}
		});

		return menus;
	}
` + s.slice(end + closer.length);

fs.writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s);
```

- [ ] **Step 3: Run it and check the diff is only what we meant**

Run: `node "$TMPDIR/edit-accounts-menu.js" vscode-src/src/vs/workbench/browser/parts/globalCompositeBar.ts`
Then: `file vscode-src/src/vs/workbench/browser/parts/globalCompositeBar.ts` — must still say `with CRLF line terminators` (not "with CRLF, LF").
Then: `git -C vscode-src diff --stat -- src/vs/workbench/browser/parts/globalCompositeBar.ts`
Expected: roughly `+45 −145` (one file). A diff touching ~1000 lines means the line endings broke — restore with `git -C vscode-src checkout -- <file>` and redo.

- [ ] **Step 4: Typecheck the workbench**

Run (several minutes, ~8 GB; run in the background if your shell allows): `cd vscode-src && npx tsc --project ./src/tsconfig.json --noEmit --skipLibCheck 2>&1 | tee /tmp/tsc-007.txt | grep -c "error TS"; grep globalCompositeBar /tmp/tsc-007.txt`
Expected: the `grep globalCompositeBar` prints nothing. Errors in other files are pre-existing noise from VSCodium's patched tree and are not this task's concern. If `globalCompositeBar.ts` reports TS6133 ("declared but never used"), remove that symbol and re-run.

- [ ] **Step 5: Export the patch and prove it round-trips**

```bash
git -C vscode-src diff -- src/vs/workbench/browser/parts/globalCompositeBar.ts > patches/007-accounts-menu-null-accounts.patch
git -C vscode-src checkout -- src/vs/workbench/browser/parts/globalCompositeBar.ts
git -C vscode-src apply --check --ignore-whitespace ../patches/007-accounts-menu-null-accounts.patch
git -C vscode-src apply --ignore-whitespace ../patches/007-accounts-menu-null-accounts.patch
git -C vscode-src diff --stat -- src/vs/workbench/browser/parts/globalCompositeBar.ts
git -C vscode-src checkout -- src/vs/workbench/browser/parts/globalCompositeBar.ts
```

Expected: `--check` silent; the stat after applying matches Step 3; the final checkout leaves `vscode-src` unpatched (the build re-applies patches fresh).

- [ ] **Step 6: Manual visual check (only if the user has a build to look at)**

Not runnable without `build-local.ps1`; report as *not verified visually* unless the user runs it. When a build exists: Accounts menu shows accounts (current one checked), `Add Account…`, `Manage Accounts…`; no Settings Sync / Copilot / Edit Sessions / tunnel rows; clicking another account moves the check mark and the status bar item follows; with no folder open, clicking an account shows the info message.

- [ ] **Step 7: Commit**

```bash
git add patches/007-accounts-menu-null-accounts.patch
git commit -m "feat: render null-accounts in the Accounts menu (patch 007)"
```

---

### Task 5: Docs and repo wiring

**Files:**
- Modify: `CLAUDE.md` (Patches list; null-accounts section)
- Modify: `docs/specs/null-accounts-design.md` (delivery phases)
- Modify: `docs/specs/null-accounts-menu-design.md` (open item finding)

(`patches/README.md` has no per-patch list — only naming examples — so it needs no entry.)

- [ ] **Step 1: `CLAUDE.md` patch list**

After the `006-settings-toc-split-extensions.patch` line add:

```
- `007-accounts-menu-null-accounts.patch` — the Accounts menu lists null-accounts' accounts (read from the `null.accounts.menu` context key) and drops VS Code's provider-session and Settings Sync / Copilot / Edit Sessions / tunnel rows
```

- [ ] **Step 2: `CLAUDE.md` null-accounts section**

Append to the status sentence of the `### null-accounts` section: `The Accounts menu (avatar in the activity bar) is null-accounts' front door: extension publishes it as the context key `null.accounts.menu` (`ui/accountsMenuController.ts`, model in `ui/accountsMenuModel.ts`) and patch 007 renders it; commands `null-accounts.bindFolderToAccount` and `null-accounts.addAccount`. Design: `docs/specs/null-accounts-menu-design.md`; plan: `docs/plans/null-accounts-phase4-accounts-menu.md`.`

- [ ] **Step 3: Renumber the delivery phases**

In `docs/specs/null-accounts-design.md`, replace the list under "Delivery phases" so it reads: 1 Foundation, 2 GitHub + binding, 3 UI, **4 Accounts menu** (`null-accounts-menu-design.md`), 5 GitLab, 6 Git wiring, 7 Integration (text of the existing items unchanged).

- [ ] **Step 4: Record the open-item finding**

In `docs/specs/null-accounts-menu-design.md`, under "Open item", add: `Finding (plan time): `_signOutOfAccount` is registered as a normal workbench command (src/vs/workbench/contrib/authentication/browser/actions/signOutOfAccountAction.ts) taking a serializable `{ providerId, accountLabel }`, so an extension can call it with `vscode.commands.executeCommand`. Not wired in this phase; making *Remove account* sign out the built-in `github` session is a follow-up that needs a product decision (it also logs VS Code's other GitHub consumers out).`

- [ ] **Step 5: Refresh the graph and commit**

```bash
graphify update .
git add CLAUDE.md docs/specs/null-accounts-design.md docs/specs/null-accounts-menu-design.md
git commit -m "docs: document the null-accounts Accounts menu integration"
```

(`graphify-out/` is not staged unless it is tracked and the user wants it committed — check `git status` first.)

---

## Self-review notes

- **Spec coverage:** model (T1) · publish + context key + folder/changed triggers (T2, T3) · both commands + `package.json` (T3) · error handling — setContext failure, stale click (T2) · workbench subtraction, request-group allow-list, key-unset behavior, untouched avatar code (T4) · tests: `git apply --check`, model unit tests, integration spec (T1, T4, T3) · docs wiring (T5) · open item (T5 step 4).
- **Deliberate deviation from the spec:** the spec's `verify-local` spec says the context key is "populated", but an extension host cannot read context keys. That assertion is replaced by unit tests on the exact value passed to `setContext` (T2) plus registration/no-op checks in the integration spec (T3).
- **Deliberate addition:** `bindFolderToAccount`'s logic lives in `accountsMenuActions.ts` (not in `extension.ts`) so the stale-click and no-folder branches are node-testable; `publishAccountsMenu` likewise for the swallow-errors rule.
- **Types:** `NullAccountsMenuEntry`, `MENU_CONTEXT_KEY`, `BIND_COMMAND`, `ADD_ACCOUNT_COMMAND`, `MANAGE_COMMAND`, `accountsMenuModel`, `BindResult`, `BindDeps`, `bindFolderToAccount`, `publishAccountsMenu`, `registerAccountsMenu` are spelled identically everywhere they appear.

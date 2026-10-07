# Null Accounts — Accounts Menu Integration — Design

Follows [null-accounts-design.md](null-accounts-design.md). Inserted as a new phase before GitLab; the
original phases 4-6 (GitLab, Git wiring, Integration) shift by one.

## Problem

null-accounts currently surfaces only in a status bar item and its own panel. VS Code's Accounts menu
(the avatar at the bottom of the activity bar) is unrelated: it lists the built-in auth providers'
sessions ("user (GitHub) > Manage Trusted Extensions / Sign Out") plus Settings Sync, Copilot, Edit
Sessions and tunnel entries. Null IDE has no use for most of that, and the account rows contradict
null-accounts' model (several accounts, one bound per project).

## Goal

The Accounts menu becomes null-accounts' front door:

- lists null-accounts accounts, the current project's one checked;
- clicking an account binds the current project to it;
- `Add Account…` and `Manage Accounts…` entries;
- VS Code's provider-session rows and the Settings Sync / Copilot / Edit Sessions / tunnel entries
  are gone.

## Non-goals

- GitLab (separate phase; the menu model already handles any `Account`, so GitLab accounts appear for free).
- Replacing the avatar image logic: it keeps drawing the GitHub avatar from the built-in session.
- Per-account submenus (trusted extensions, MCP servers, sign out).
- Making the "Sign in with X to use Y" / "Grant access" request entries disappear. They are kept:
  without them, third-party extensions calling `getSession('github')` could never surface a prompt.

## Decision

| Decision | Choice | Rejected |
|---|---|---|
| Bridge | Extension publishes the menu as a context key (`null.accounts.menu`); a small patch renders it | Register a `null-accounts` auth provider (no per-project "current" concept, second token path, still needs a hide patch); workbench polling an extension command (async, no change event) |
| Hiding | Allow-list of menu groups in the one method that builds the menu | Editing each contributing file (six places, breaks on every VS Code bump) |

## Workbench side — `patches/007-accounts-menu-null-accounts.patch`

Touches only `AccountsActivityActionViewItem.resolveMainMenuActions` in
`src/vs/workbench/browser/parts/globalCompositeBar.ts`.

- **Removed:** the registered- and dynamic-provider loops (per-account submenus) and the Codex rows.
- **Added:** rows read from the context key `null.accounts.menu` via
  `contextKeyService.getContextKeyValue(...)`. Contract (the workbench knows nothing else about null-accounts):

  ```ts
  type NullAccountsMenuEntry =
    | 'separator'
    | { label: string; description?: string; checked?: boolean; command: string; args?: unknown[] };
  ```

  Each object entry becomes one action that runs `commandService.executeCommand(command, ...args)`,
  with a check mark when `checked`. Malformed values (not an array, unknown entry shape) are ignored.
  The menu is rebuilt on every open, so no change listener is needed in the workbench.
- **Filter:** from `accountsMenu.getActions()` keep only groups `2_signInRequests` and `3_accessRequests`.
  Everything else (`1_settings`, `2_copilot`, `2_editSessions`, `2_remoteTunnel`, and the ungrouped
  extensions-gallery / preferences entries) is dropped.
- **Key unset** (null-accounts not yet activated, or failed to load): only the request groups show.
- **Untouched:** `groupedAccounts`, `addAccountsFromProvider`, `updateAvatar` and the avatar setting.
  The patch is therefore strictly a subtraction from `resolveMainMenuActions` plus one reader.

## null-accounts side

- **`ui/accountsMenuModel.ts`** — pure function
  `accountsMenuModel(accounts: Account[], currentAccountId?: string): NullAccountsMenuEntry[]`.
  Output, in order: one entry per account (`label` = `username`, `description` = `host`,
  `checked` = id matches `currentAccountId`, `command` = `null-accounts.bindFolderToAccount`,
  `args` = `[account.id]`), `'separator'`, `Add Account…` (`null-accounts.addAccount`),
  `Manage Accounts…` (`null-accounts.open`). With no accounts: just the last two.
- **`ui/accountsMenuController.ts`** — `registerAccountsMenu(api)`: calls
  `vscode.commands.executeCommand('setContext', 'null.accounts.menu', model)` on activation, on
  `api.onDidChange`, and on `workspace.onDidChangeWorkspaceFolders`. "Current folder" is the first
  workspace folder, same rule as the status bar. Returns a `Disposable`.
- **New commands** (registered in `extension.ts`, declared in `package.json`):
  - `null-accounts.bindFolderToAccount(accountId)` — binds the first workspace folder to the account via
    `ProjectBinding`; no-op with an info message if no folder is open or the account no longer exists.
  - `null-accounts.addAccount` — runs the existing `addGithubAccount(pickerDeps)` (today only reachable
    through the picker and panel).

## Error handling

- `setContext` rejecting or the model throwing must never break activation: the controller catches and
  leaves the previous key value in place.
- Stale click (account removed between menu open and click): `bindFolderToAccount` re-reads the store
  and no-ops.

## Open item (resolve during implementation, not assumed here)

The menu no longer offers "Sign Out" for the built-in `github` session, so signing out of VS Code's
GitHub session is no longer reachable from the menu. Whether null-accounts' *Remove account* should also
sign out that session depends on `_signOutOfAccount` being callable from an extension host; there is no
public API. Until verified, Remove only drops the null-accounts record (current behavior). Trusted
extensions remain manageable from the command palette.

## Testing

- `git apply --check patches/007-*.patch` against the pinned VS Code source; build via `build-local.ps1`
  is the full check but is run only on request.
- Unit (node): `accountsMenuModel` — no accounts, several accounts, none checked, one checked, id not in list.
- `verify-local` spec: after activation, the `null.accounts.menu` context key is populated and
  `null-accounts.bindFolderToAccount` binds a temp folder. Visual check of the menu is manual.

## Docs / repo wiring

- `patches/README.md` and the `CLAUDE.md` patch list gain `007`; the `null-accounts` section gains the menu.
- `docs/specs/null-accounts-design.md` delivery-phase list gets this phase and renumbers GitLab / Git wiring / Integration.
- Plan: `docs/plans/null-accounts-phase4-accounts-menu.md` (after spec approval).

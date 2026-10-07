# Null Accounts Extension (`null-accounts`) — Design

Issue: [#102 Github / Gitlab Account Manager](https://github.com/TorresVisual/null-ide/issues/102)

## Problem

Null IDE has no central place for GitHub/GitLab identities. Today:

- GitHub auth is a single call, `vscode.authentication.getSession('github', ['repo'])`
  in `extensions/null-tools/src/github/githubAuth.ts`, used by the Issues panel
  (`issuesPanel`, `issuesListController`, `issuesStore`). One session, no choice of
  identity, no per-project selection.
- GitLab is unsupported.
- Git itself (commit identity, SSH key, HTTPS credentials) is configured by hand,
  per machine, so working with two identities means reconfiguring constantly.

## Goals

1. Store multiple GitHub and GitLab accounts (provider, host, username, email,
   auth method: OAuth / SSH / HTTPS) in one place.
2. Bind each project (folder) to one account.
3. Manage OAuth centrally and expose tokens to any Null IDE feature through an API.
4. Make Git operations in a bound repo use the bound account (identity + credentials).

## Non-goals

- A GitLab backend for the Issues panel, Pull/Merge Requests, repository browsing.
  The API makes tokens available for them; they are separate features.
- Touching global git config, the system PATH, or existing credentials not created
  by this extension.
- Gitea/Bitbucket/other providers (provider interface is internal; no plugin point).

## Decisions

| Decision | Choice | Rejected |
|---|---|---|
| Placement | New built-in extension `null-accounts` (precedent: `null-cpp`, `null-actions`) | Module in `null-tools` (catch-all; others would depend on it); core patch (fragile across VS Code bumps) |
| OAuth | GitHub: wrap VS Code's built-in `github` provider. GitLab: own device flow | Own device flow for both (two client IDs to own); PAT-only (drops the issue's OAuth section) |
| Git reach | Repo-local config only: identity, SSH command, credentials | Identity only; nothing |

## Architecture

```
extensions/null-accounts/
├── package.json          # commands, configuration, activationEvents
├── src/
│   ├── extension.ts      # activate(): wires units, returns the public API
│   ├── api.ts            # NullAccountsApi type + implementation
│   ├── types.ts          # Account, Provider, AuthMethod, Binding
│   ├── accountStore.ts   # metadata (globalState) + secrets (SecretStorage)
│   ├── projectBinding.ts # folder -> accountId map + origin-based suggestion
│   ├── providers/
│   │   ├── github.ts     # wraps vscode.authentication
│   │   └── gitlab.ts     # device flow, refresh, self-hosted host
│   ├── gitConfig.ts      # repo-local git config application
│   └── ui/               # accounts webview panel, status bar, quick-pick
└── out/                  # compiled in CI
```

Each unit has one purpose and talks to others through typed interfaces:

- **accountStore** — CRUD for `Account` records. Metadata lives in `globalState`
  (id, provider, host, username, email, authMethod, sshKeyPath). Secrets (OAuth
  access/refresh tokens, HTTPS tokens) live in `SecretStorage` under
  `null-accounts/<id>`; they never touch settings or `globalState`. Fires
  `onDidChange`.
- **projectBinding** — `bind(folder, accountId)`, `accountFor(folder)`,
  `suggest(folder)`. Stored in `globalState` keyed by normalized folder path, so the
  dashboard can read bindings for projects that are not open. `suggest` parses the
  repo's `origin` URL and proposes the account whose provider/host/username matches.
- **providers/github** — `addAccount()` forces a new session on the built-in
  provider (so a second account can be added), then reads `GET /user` (and
  `/user/emails` for the primary email) to fill username and email.
  `getToken(account, scopes)` calls `getSession('github', scopes, { account })`.
- **providers/gitlab** — OAuth device flow: `POST /oauth/authorize_device`, show the
  user code and open the verification URL, poll `POST /oauth/token` honoring
  `interval` / `slow_down`. Host is configurable per account (default
  `https://gitlab.com`). Requires a registered GitLab OAuth application (public
  client ID, no secret) shipped as a default in `null-accounts.gitlab.clientId`; the
  setting can be overridden for self-hosted instances. An OAuth application is registered per instance, so self-hosted hosts get their own ID from `null-accounts.gitlab.hostClientIds` (`{ "<host>": "<id>" }`); `clientId` covers gitlab.com only. Both settings are application-scoped. Access tokens expire (~2 h),
  so `getToken` refreshes via the refresh token and persists the rotated pair.
- **gitConfig** — applies repo-local config when a project is bound/rebound
  (see Git wiring).
- **ui** — Accounts webview in the main editor area (`WebviewPanel`, same pattern
  as `null-actions` settings): list, add, edit, remove, per-account "projects using
  this". Status-bar item shows the current folder's account; click opens a
  quick-pick to switch or add. Command `null-accounts.open`.
- **api** — returned from `activate()`:

```ts
interface NullAccountsApi {
  getAccounts(): Account[];
  getAccountForFolder(folder: vscode.Uri): Account | undefined;
  // Resolves a token for the account; refreshes if needed. undefined if the
  // user cancels re-auth. Never throws for auth failure.
  getToken(account: Account, scopes?: string[]): Promise<string | undefined>;
  onDidChange: vscode.Event<void>;
}
```

Consumers use `extensions.getExtension('null.null-accounts')?.exports`.
null-tools lists it in `extensionDependencies` so activation order is guaranteed.

## Git wiring

Applied on bind/rebind via `git config --local` in the folder's repo. Global and
system config are never modified. Unbinding removes the keys this extension set
(tracked in `globalState` per folder so only our keys are removed).

| Account auth | Config written |
|---|---|
| any | `user.name` = username, `user.email` = account email |
| SSH | `core.sshCommand` = `ssh -i "<sshKeyPath>" -o IdentitiesOnly=yes` |
| HTTPS / OAuth | `credential.<host>.username` = username; token stored in the OS credential store via `git credential approve` for (host, username) |

Rationale for the HTTPS/OAuth row: Git then selects the right credential for that
repo even when invoked from a plain terminal outside the IDE. The alternative, a
custom credential helper talking to the extension host over a pipe, fails whenever
git runs while the IDE is closed. Trade-off accepted: the token exists in two
places (SecretStorage and the OS store). GitLab refreshes re-run `credential
approve` with the new token while the IDE is running; if the IDE is closed past
token expiry, the next IDE start refreshes and re-approves. GitHub built-in
tokens do not expire.

## Data flow

- **Add account:** provider auth → `GET /user` → `accountStore.add` (metadata +
  secret) → `onDidChange`.
- **Bind project:** `projectBinding.bind` → `gitConfig.apply` → `onDidChange`.
- **Consumer token request:** `getAccountForFolder` → `getToken` → provider
  (built-in session, or stored/refreshed GitLab token).
- **Unbound folder:** consumers get `undefined` from `getAccountForFolder`; the
  consumer (or the status bar) offers `suggest()` or the add/pick quick-pick.

## Migration

`null-tools/src/github/githubAuth.ts` becomes a thin call into the API:
`getGithubSession(createIfNone)` resolves the folder's account and token. With no
binding and `createIfNone`, it opens the pick/add quick-pick instead of silently
creating a session. With no binding and `!createIfNone` (silent paths) it returns
`undefined`. The three Issues consumers change only at this call. If no account is
bound but the built-in provider already has a session, the first run offers to
import it as an account so existing users are not logged out.

## Error handling

- **Token revoked/expired and refresh fails:** mark the account "needs
  re-auth" in the UI, fire `onDidChange`, show a one-time notification with a
  Re-authenticate action. `getToken` returns `undefined`, never throws.
- **SSH key file missing:** account flagged in the UI; git config is not written
  until fixed.
- **Self-hosted GitLab host:** HTTPS only; host validated (reachable
  `/api/v4/version`) before the flow starts. `http://` rejected.
- **Device flow:** expired/denied code surfaces as a clear message; user can retry.
- **`git` not on PATH, or folder is not a repo:** skip git wiring, show the reason
  in the UI; binding itself still succeeds.
- **Account removed while bound:** bindings pointing at it are cleared, git keys it
  set are removed.

## Security

- Secrets only in `SecretStorage` (+ OS credential store for HTTPS/OAuth git use).
  Never logged, never in settings or `globalState`.
- Token is passed to `git credential approve` over stdin, never as an argument.
- GitLab client ID is public (device flow, no secret). No client secrets are
  committed.
- All provider requests use HTTPS.

## Testing

- **Unit (node, no VS Code host):** accountStore (CRUD, secret separation),
  projectBinding (path normalization, origin-URL suggestion), GitLab device-flow
  polling with a faked `fetch` (pending, slow_down, denied, expired, refresh
  rotation), gitConfig command construction and cleanup (injected runner).
- **Integration:** a `verify-local` spec: add account, bind a temp repo, assert
  repo-local `user.email` and credential keys, assert the Issues panel's token
  request resolves through the API.

## Build / repo wiring

- Add `extensions/null-accounts/` to `build.yml` (npm ci + compile, copy into
  `vscode-src/extensions/`), `scripts/build-local.ps1`, `scripts/sync-local.ps1`.
- `CLAUDE.md`: built-in extension count becomes eight (nine with Code Spell
  Checker); add a `null-accounts` section and repo-layout entry.
- Open item for implementation: register a GitLab OAuth application (gitlab.com,
  device flow, `read_user api write_repository` scopes) and record its client ID
  as the setting default.

## Delivery phases (input to the implementation plan)

1. **Foundation** — extension skeleton, types, accountStore, API, build wiring.
2. **GitHub + binding** — github provider, projectBinding (+ suggest), Issues
   migration with import of the existing session.
3. **UI** — accounts webview, status bar, quick-pick.
4. **Accounts menu** — the Accounts menu lists null-accounts' accounts
   (`null-accounts-menu-design.md`).
5. **GitLab** — device flow, refresh, self-hosted host. — landed (`docs/plans/null-accounts-phase5-gitlab.md`)
6. **Git wiring** — identity, SSH, HTTPS/OAuth credential store, cleanup on unbind.
7. **Integration** — dashboard shows each project's account; docs; verify-local spec.

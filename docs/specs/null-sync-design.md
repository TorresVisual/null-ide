# Null Sync — Cross-Device Settings Synchronization Design

Issue: [#23 Add Cross-Device User Settings Synchronization](https://github.com/TorresVisual/null-ide/issues/23)

## Goal

Keep a user's Null IDE configuration — `settings.json` (including every layout, theme and icon-theme setting), `keybindings.json`, user snippets and the list of installed extensions — consistent across machines, with no server for Null to run. Data is encrypted on the device with a passphrase and stored in one secret GitHub Gist through `null-accounts`. Null IDE works exactly as before with no account, no passphrase or no network; the local files stay the source of truth and a sync failure never touches them.

This spec covers the **engine, its API and its commands**. It deliberately has **no UI surface**: the Null workspace rework will host the Sync screen and consume `NullSyncApi` (below). Until then every action is a command-palette command.

## Decisions

- **Backend: a secret GitHub Gist via `null-accounts`.** No custom server (hosting, ops and security upkeep are not worth a low-priority feature). Same trust and token model as the `null-activity` badges (`getToken(account, ['gist'], …)`, github.com accounts only). GitLab is out of scope; its snippets API is a separate client.
- **Secret means unlisted, not private** (anyone with the URL can read it), so everything uploaded is **client-side encrypted**: AES-256-GCM, key from a user passphrase via scrypt. The Gist holds only ciphertext plus a plaintext `manifest.json` (format version, salt, KDF parameters). Forgetting the passphrase makes the remote data unrecoverable; local files are unaffected and the user can stop syncing and start a new store.
- **New built-in extension `null-sync`** (`extensions/null-sync/`), `extensionKind: ["ui"]` (it reads the machine's user-data folder), `extensionDependencies: ["null.null-accounts"]`, activated on `onStartupFinished`. It follows the repo's pure-modules-plus-thin-`vscode`-glue layout. The ~60 lines of Gist HTTP handling in `null-activity` are not shared (extensions only share code through exports); `null-sync` gets its own small client rather than a new cross-extension coupling.
- **Whole-file three-way sync** for settings, keybindings and each snippet file. Each file is compared as `local` / `remote` / `base`, where `base` is the hash recorded at the last successful sync. Only one side changed → that side wins silently. Both changed to different content → **conflict**, never auto-resolved. No JSONC merging.
- **Extension list is a set, merged by set arithmetic** — it never produces a conflict prompt.
- **Machine-specific settings are filtered by key** (the only key-level logic, see below).
- **No UI.** No status bar, no panel, no unsolicited notifications. State is observable only through `NullSyncApi.getStatus()` / `onDidChangeStatus`.
- **Off by default.** `null-sync.enabled` is `false`; enabling runs a setup flow with a consent modal naming exactly what leaves the device.

## Synced data

| Category | Local source | Remote file (in the Gist) |
|---|---|---|
| `settings` | `<User>/settings.json` (filtered) | `settings.json.enc` |
| `keybindings` | `<User>/keybindings.json` | `keybindings.json.enc` |
| `snippets` | each `<User>/snippets/*.json` / `*.code-snippets` | `snippets__<file>.enc` (Gist names cannot contain `/`) |
| `extensions` | installed, non-built-in extension IDs | `extensions.json.enc` (sorted, lowercased `publisher.name` array) |

`<User>` is the grandparent of `context.globalStorageUri.fsPath` (`…/User/globalStorage/<id>`); the plan verifies this on a real install. Categories are switched in `null-sync.categories`; a disabled category is neither read, uploaded nor applied.

**Never read or synced:** workspace settings, `globalStorage`, `SecretStorage`, null-accounts state, credentials, view/layout state in `state.vscdb` (syncing view arrangement needs a patch and is out of scope), extension enabled/disabled state, extension versions.

### Machine-specific settings filter

`settings.json` is filtered before hashing and encrypting:

- Keys matching `null-sync.excludedSettings` are removed. Defaults: `*.path`, `*Path`, `terminal.integrated.defaultProfile.*`, `terminal.integrated.profiles.*`, `http.proxy`, `null-sync.*` (so the sync switches are per device).
- On **pull**, this device's current values for the excluded keys are re-applied to the incoming text.
- Both directions use `jsonc-parser`'s `modify`/`parse`, so comments and formatting survive. `jsonc-parser` is the only new dependency (not currently used by any Null extension; added to `null-sync/package.json` and installed by the `npm ci` step).

The hash that feeds the three-way comparison is over the **filtered** text, so an excluded key changing locally is never a change.

## Remote layout and cryptography

- One Gist, description `Null IDE settings sync`, `public: false`.
- `manifest.json` (plaintext): `{ "v": 1, "kdf": "scrypt", "N": 32768, "r": 8, "p": 1, "salt": "<base64>", "check": "<envelope>" }`. `check` is the envelope of a fixed string, used to verify a passphrase without touching real data.
- **Envelope** (every `.enc` file, JSON): `{ "v": 1, "iv": "<12 random bytes b64>", "tag": "<b64>", "data": "<b64>" }`. The file name is bound as GCM additional authenticated data, so a ciphertext cannot be moved to another name. The key is derived once per run (scrypt, `maxmem` raised to 64 MB) and held in memory only.
- Node's built-in `crypto` only. Wrong passphrase, a tampered file or an unknown `v` fails decryption; that file is skipped and reported, nothing is written locally.
- The passphrase is stored in `SecretStorage` (`null-sync/passphrase`). It is never logged, never in `globalState`, never in settings. Changing it = Stop Syncing, then Enable again.
- Files over 900 KB are skipped with a reported error (Gist API truncates larger files at 1 MB; truncated files fetched from the Gist are re-read from `raw_url`, host allow-list `api.github.com` and `gist.githubusercontent.com`).

## Components

All under `extensions/null-sync/src/`; only the starred files import `vscode`.

| Unit | Purpose |
|---|---|
| `cryptoBox.ts` | `deriveKey`, `seal`, `open`, `makeManifest`, `checkPassphrase`. Pure. |
| `syncPlan.ts` | `planFile(local, remote, base)` → `none \| push \| pull \| conflict`; values are a hash or `null` (absent), so deletes are changes like any other. `planAll` over a file map. Pure. The core logic. |
| `extensionSet.ts` | `mergeExtensions(local, remote, base)` → `{ install, notifyRemoved, push, nextBase }`. Pure. |
| `settingsFilter.ts` | `stripExcluded`, `reapplyExcluded`, key-pattern matching. Pure (uses `jsonc-parser`). |
| `gistStore.ts` | `find`, `read`, `write` (one `PATCH` of changed files; `null` content deletes), `revisions`, `readRevision`. Gist-specific, takes an injected `HttpJson`; never throws; messages follow `null-activity/gistClient.ts` (only a JSON `message` is echoed, token only in `Authorization`). |
| `gistHttp.ts` | The only `fetch` caller: the two allowed hosts, `redirect: 'error'`, 15 s timeout. |
| `localFiles.ts` | Read/write/delete the synced local files, atomic write (temp + rename), backups to `globalStorage/null-sync/backups/` (last 10 per file), injected `fs`. |
| `syncEngine.ts` | The serialised `run({ interactive })` / `resolve(file, side)` / `restore(revision)` / `stop()`; owns `Status`. Injected: accounts, token, store, files, extension host, state, clock. Calls run one at a time, never reject (same queue idea as `BadgePublisher`). |
| `lock.ts` | Cross-window run lock (below). |
| `api.ts` | `NullSyncApi` type. |
| `extensionHost.ts` ★ | Installed extension IDs; `installExtension` / `uninstallExtension` via the `workbench.extensions.*` commands. |
| `prompts.ts` ★ | Account pick, consent modal, passphrase input, conflict choice, diff, revision pick. |
| `commands.ts` ★, `watcher.ts` ★, `extension.ts` ★ | Command registration, file watching and timers, activation (returns `NullSyncApi`). |

## Sync algorithm

`run({ interactive })`:

1. If `null-sync.enabled` is off → status `disabled`, stop. Take the cross-window lock; if another window holds it, skip silently.
2. Resolve account and token (`interactive:false` for background runs) and the passphrase from `SecretStorage`. Missing → status `signedOut`, stop.
3. `find`/`read` the Gist, verify the passphrase against `manifest.json`, decrypt remote files.
4. Read local files for the enabled categories (settings filtered), hash them.
5. `planAll(local, remote, base)`. Execute: `pull` → back up, write locally (settings re-apply excluded keys); `push` → collected into one `PATCH`; `conflict` → left alone and listed in `Status.conflicts`.
6. Merge the extension set; install new IDs; removals are reported in `Status.pendingRemovals`, never applied silently.
7. After a successful write, set `base` for every file resolved this run. Conflicted files keep their old `base`.
8. Status → `needsAttention` if conflicts or pending removals remain, else `idle` with `lastSyncedAt`.

Properties:

- **Self-triggered loops are impossible by construction**: after we write a file, `local == base`, so the next plan is `none`.
- **No base yet** (first sync on a device) and the contents differ → `conflict`, so a new device never silently overwrites, and never silently loses, anything.
- **Both sides made the same change** → `none`; `base` is updated.
- **Failed extension installs** (VSIX-only or removed from the gallery) are recorded in `state.failedInstalls` and not retried by background runs; an interactive run retries them.
- Network error → status `offline`; auth/decrypt/API failure → `error`; both with a short `message`. Local edits made while offline are simply local changes that the next successful run pushes.
- The Gist API has no compare-and-set, so a push can overwrite a push another device made in the seconds between our read and write. Gist revisions keep the overwritten version, so it is recoverable through Restore. ponytail: no optimistic locking; add a re-read-before-PATCH check if this is ever seen in practice.

### Triggers

Startup (after 10 s), 30 s after a change to a synced local file (debounced `FileSystemWatcher`), and every 10 minutes — all background (`interactive:false`, no UI). `Sync Now` is interactive: it may prompt for a token, a passphrase or conflicts.

### Cross-window lock

Several windows share one user-data folder; each runs the timers. A run first creates `globalStorage/null-sync/lock` with `flag: 'wx'` (content: pid + time) and removes it when done; a lock older than 2 minutes is stale and taken over. A window that cannot take the lock skips that run. ponytail: lock file with stale timeout, not leader election.

## Conflicts

`Status.conflicts` lists `{ file, category }`. `resolve(file, 'mine' | 'theirs')` re-reads the remote, then either pushes the local version or backs up the local file and pulls the remote one, and sets `base` for that file. The `null.sync.resolveConflicts` command walks the conflicts with a quick pick (*Keep mine / Take theirs / Show diff*; the diff opens `vscode.diff` against a read-only temp copy of the remote). Whichever side loses is in `backups/`.

## Restore

`restore()` lists the Gist's revisions (`GET /gists/{id}/commits`) with their dates, decrypts the chosen revision's files and applies them as a pull (back up first), then sets `base` to the restored state; the next run treats later differences as ordinary local changes.

## Lifecycle

- **Enable (`null.sync.enable`).** Pick a github.com account from `null-accounts` (`gist` scope, interactive token) → consent modal listing the enabled categories and stating that encrypted data is stored in a secret Gist → if no Gist is found, choose a passphrase (entered twice) and create it; if one exists, enter its passphrase once. Then sets `null-sync.enabled` and runs once. The account and Gist id are remembered in `globalState` (`null-sync.state`: `gistId`, `accountId`, `owner`, `base`, `extensionsBase`, `lastSyncedAt`, `failedInstalls`).
- **Disable.** Setting `null-sync.enabled` to `false` pauses everything; state and passphrase are kept.
- **Stop Syncing (`null.sync.stop`).** Clears `state` and the passphrase; a separate confirm modal offers to also delete the Gist. Local files are never changed, and this device's `backups/` are kept.
- **Another device.** Sign in to the same GitHub account in `null-accounts`, run Enable; the Gist is found by description and the passphrase is verified against `manifest.json`.

## API and commands

Returned from `activate` (`extensions.getExtension('null.null-sync')?.exports`):

```ts
type SyncState = 'disabled' | 'signedOut' | 'idle' | 'syncing' | 'offline' | 'error' | 'needsAttention';
interface SyncStatus {
  state: SyncState;            // 'signedOut' = no usable account token or passphrase
  lastSyncedAt?: number;       // ms epoch
  message?: string;            // why, for offline / error / signedOut
  conflicts: { file: string; category: Category }[];
  pendingRemovals: string[];   // extension IDs removed elsewhere, not yet uninstalled here
}
interface NullSyncApi {
  getStatus(): SyncStatus;
  onDidChangeStatus: Event<void>;
  syncNow(): Promise<void>;
  resolveConflict(file: string, side: 'mine' | 'theirs'): Promise<void>;
  uninstallRemoved(id: string): Promise<void>;   // act on a pendingRemovals entry
}
```

Commands (palette-visible, and what the workspace UI calls): `null.sync.enable`, `null.sync.syncNow`, `null.sync.resolveConflicts`, `null.sync.restore`, `null.sync.stop`, `null.sync.setCategories`. Settings (all `application` scope): `null-sync.enabled` (default `false`), `null-sync.categories` (`{ settings, keybindings, snippets, extensions }`, all default `true`), `null-sync.excludedSettings`.

This API and command set **is the contract the Null workspace UI builds against**; the UI itself is a later piece of work.

## Security and privacy

- Leaves the device: only AES-256-GCM ciphertext, the plaintext manifest (salt, KDF parameters, version), and file names from the table above. A snippet file name and the number of files are therefore visible; their contents are not.
- Stays on the device: the passphrase (`SecretStorage`), the token (owned by `null-accounts`; `null-sync` stores none), local backups.
- The consent modal names the categories and the secret-Gist model before the first upload.
- Network access is confined to `gistHttp.ts` (two hosts, no redirects, 15 s timeout); the plan, crypto and filter code have none.
- `docs/` (this spec, linked from CLAUDE.md) documents authentication, data protection and disconnection, which satisfies the issue's documentation criterion.

## Error handling

Sync never throws into the extension host and never blocks activation. Background runs show no UI at all. A decrypt failure for one file reports that file and still syncs the others. A malformed local `settings.json` (unparseable JSONC) skips the settings category with an `error` message rather than uploading it. A deleted Gist moves the state to `signedOut` with a message to re-run Enable (a background run must not silently recreate it and orphan other devices' passphrase); an interactive Enable creates a new one.

## Testing

Pure units under `node --test` (listed in the `test` script in `package.json`):

- `cryptoBox`: round trip, wrong passphrase, flipped ciphertext bit, wrong file-name AAD, unknown `v`.
- `syncPlan`: a table over every combination of `local`/`remote`/`base` being equal, different or absent.
- `extensionSet`: adds, removals, both-sides, empty base.
- `settingsFilter`: strip and re-apply preserve comments and formatting; patterns match as specified.
- `gistStore`: fake `HttpJson` for 401, 403, 404, network failure, truncated file, HTML error body (never echoed).
- **`syncEngine` with two devices sharing one in-memory Gist** (the most valuable test): first sync, edit on A → B pulls, edit on both → conflict and each resolution, offline then reconnect, restore, Stop Syncing; asserts `getStatus()` transitions, since the API is the only observable surface.
- `lock`: held, stale takeover.

Integration (`npm run test:integration`, via `/verify-local null-sync`): activation exposes the API and the commands; with sync disabled nothing is read or written. A real Gist round trip is not run in CI.

## Acceptance criteria

| Issue criterion | Where |
|---|---|
| Architecture and infrastructure evaluated | Decisions (Gist via null-accounts chosen over a custom server and folder sync) |
| Multiple installations, same account | Lifecycle → Another device |
| Supported settings synchronize | Synced data, Sync algorithm |
| Enable / disable | Lifecycle, `null-sync.enabled` |
| Conflicts handled safely | Conflicts, no-base rule, backups |
| Offline changes retained | Sync algorithm → network error |
| Machine-specific / sensitive data excluded | Settings filter, Never-synced list, encryption |
| Failures give feedback without affecting the IDE | `Status`, Error handling |
| Recover from conflicts / restore earlier configuration | Conflicts → backups, Restore |
| Authentication, data protection, disconnection documented | This spec, Security and privacy, Lifecycle |

## Build wiring

New built-in extension `null-sync`: `npm ci && npm run compile` in `build.yml` and `scripts/build-local.ps1`, copied with the other built-ins, listed in `scripts/sync-local.ps1`, `out/` tracked, and the built-in counts and extension list in `CLAUDE.md` updated (twelve → thirteen, plus Code Spell Checker). It is machine-local (`extensionKind: ["ui"]`) and `isDisabledInSafeMode` already covers Null-owned built-ins generically; the plan confirms that.

## To verify in the plan

1. `<User>` resolves from `globalStorageUri` as stated, including in a portable install.
2. `workbench.extensions.installExtension` / `uninstallExtension` work from a `ui` extension host and report failure in a way the engine can catch.
3. `jsonc-parser` `modify` keeps comments and formatting on the real default `settings.json`.

## Out of scope

- Any UI (the Null workspace rework owns it), including a status bar item.
- GitLab storage; syncing view arrangement (pinned/hidden/ordered views, which needs a patch to read `state.vscdb`); workspace settings; profiles; extension versions and enabled state; changing the passphrase in place; real-time push; key-level merge of `settings.json`; optimistic locking on the Gist.

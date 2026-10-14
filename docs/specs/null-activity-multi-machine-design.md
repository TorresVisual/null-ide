# Null Activity — Multiple Machines Design

Issue: [#131 Null Activity Support for Multiple Machines](https://github.com/TorresVisual/null-ide/issues/131)

## Goal

One coding-activity history across all of a user's machines: each interval is attributed to the machine that recorded it, the dashboard can show the machines apart, and nothing is double-counted when the same data is synced twice or two machines were active at the same time. Project, language and time statistics keep the meaning they have today. Without `null-sync`, an account or a network, `null-activity` behaves exactly as before.

## Decisions

- **Transport: the encrypted secret Gist of `null-sync`.** Same trust model as settings sync (AES-256-GCM, passphrase in `SecretStorage`, `gist` token through `null-accounts`). No new server, account flow or crypto.
- **`null-sync` provides the remote, `null-activity` decides what goes in it.** `null-sync` exposes a narrow *blob store* on its API: it owns the account, token, passphrase, cross-window lock, Gist and encryption. `null-activity` owns the merge logic and its own timer. The sync engine (a three-way file sync with conflicts) is untouched: activity files have exactly one writer, so conflicts cannot occur and that machinery would be dead weight.
- **Optional coupling.** `null-activity` finds `null-sync` with `extensions.getExtension('null.null-sync')?.exports`. It declares no `extensionDependencies`; without `null-sync` (or with it disabled) activity data stays local.
- **Single writer per blob.** A machine uploads only its own data and downloads only other machines'. No base state, no conflict prompt.
- **Opt-in.** `null-sync.categories.activity` defaults to **false**, so users who already sync settings do not start uploading history unnoticed. Enabling it shows the consent text naming the activity data (project names, file paths, languages and times, all encrypted).
- **No "editor" dimension.** The issue mentions editor statistics; the log has no editor field and Null IDE is the only tracker. Not added.

## Machine identity

- `globalStorage/machine.json` holds `{ id }`, 10 random hex chars, written once. A reinstall or a new user profile is a new machine; the old id stays in the cloud as a separate machine.
- The display name is the setting `null-activity.machineName` (application scope); empty means `os.hostname()`. The name is part of the uploaded blob header, so other machines can label it; the id is the identity.
- `Interval` keeps its persisted shape. Like `window`, a new read-back-only field `machine?: string` is set by `IntervalStore.read` and never written.
- This device's windows keep writing `intervals-YYYY-MM-<windowId>.jsonl` exactly as today.
- Other machines' data is cached in `globalStorage/machines/<machineId>/<YYYY-MM>.jsonl`, one file per month, replaced wholesale on pull (never appended to). A `machines/<machineId>/meta.json` holds `{ name }` and the last-seen content hashes.

## Remote format and sync

- One Gist file per machine per month: `activity__<machineId>__<YYYY-MM>.enc`.
- Content: a JSON header line `{ "v": 1, "machine": "<id>", "name": "<name>" }` followed by one interval per line, each carrying its window id (so the per-window attribution survives and WakaTime imports stay recognisable). The whole text is gzipped, then sealed by `null-sync`'s envelope with the file name as AAD. Compression keeps a heavy month well under the 900 KB cap.
- **Upload:** for each month of this machine's own data (all its window files merged, including the WakaTime import window), compute a content hash; upload when it differs from the hash stored at the last upload. A month that became empty is deleted from the Gist.
- **Download:** list the `activity__*` files of other machines (never this machine's own id); fetch and decrypt those whose remote hash differs from the cached one; write them to `machines/<id>/`. A file that fails decryption or parsing is skipped and logged, the cached copy stays.
- **Dedupe:** a blob is identified by `(machineId, month)`, so repeating a sync replaces and never appends; nothing is merged by line.
- **Triggers:** 10 s after startup and every 10 minutes, silent, plus once after `deleteRange`/`deleteAll`. Offline, signed out, wrong passphrase or sync disabled → nothing happens and the last pulled data is shown. Runs are serialised and never reject.
- **Limits.** A Gist holds at most 300 files, about 3 machines × 8 years of monthly blobs. `ponytail:` monthly blobs, add yearly roll-ups of closed months if this is ever reached.

### Blob store contract (in `null-sync`)

Added to `NullSyncApi` as one optional method; the engine does not use it.

```ts
interface SyncBlobStore {
  list(prefix: string): Promise<{ name: string; hash: string }[]>;   // hash = sha-256 of the decrypted bytes
  read(name: string): Promise<Uint8Array | undefined>;
  write(name: string, bytes: Uint8Array | null): Promise<boolean>;   // null deletes
}
NullSyncApi.getBlobStore(category: 'activity', options: { interactive: false }): Promise<SyncBlobStore | undefined>
```

It returns `undefined` unless `null-sync.enabled` and `null-sync.categories.activity` are on and a token and passphrase are available silently. It uses the engine's cross-window lock (`lock.ts`) per call so several windows never write the Gist at once, and shares the Gist found/created by Enable. The engine must ignore (not delete, not warn about) `activity__*` files; `fileOfRemoteName` already rejects unknown names, to be verified (below).

## Statistics

- **Headline** (daily/monthly totals, hourly bars, session durations, dashboard `totalMs`): still the union of all intervals from every machine through `normalizeIntervals`, so minutes in which two machines were active count once.
- **Per-project and per-language**: `attributedIntervals` keys by `machine/window` instead of `window`, so parallel work on two machines sums exactly like parallel windows do today.
- **WakaTime imports** from every machine are pooled into one gap-fill source (they all compare against the same export), so importing the same export on two machines does not double-count.
- **New:** `getMachineStats(range): MachineStat[]` with `MachineStat = { machine: { id, name, isThisDevice }, ms }`, each machine's own time (overlaps clipped within a machine only). Added to `NullActivityApi` and to `dashboardModel`.
- `IntervalStore.read` returns both local and cached remote intervals; `deleteRange`/`deleteAll` act on this machine's files only. Remote caches are never edited from here (they would be pulled again); the next upload propagates the deletion to other machines.

## Dashboard

A **Machines** section (name, share of time, "this device" tag) appears only when more than one machine has data in the range. No per-machine filter. Git statistics stay local-repo only (unchanged).

## Components

| Unit | Change |
|---|---|
| `machineId.ts` (new, pure + injected fs) | `loadMachine(dir, hostname)` → `{ id }`; name resolution. |
| `intervalStore.ts` | `read` also scans `machines/<id>/`, sets `machine`; `exportOwn(month)` → this machine's intervals incl. window ids; `replaceRemote(machineId, month, intervals)`. |
| `stats.ts` | `attributedIntervals` window key `machine/window`; pooled import source; `machineStats`. |
| `activityBlob.ts` (new, pure) | `encodeMonth` / `decodeMonth` (header + JSONL + gzip), content hash. |
| `activitySync.ts` (new, injected deps, no `vscode`) | `run()`: list → upload changed own months → download changed remote months; serialised; returns a result for logging. |
| `syncLink.ts` (new, `vscode`) | Looks up `null.null-sync`, supplies the blob store and the timers; the only new file importing `vscode` besides `extension.ts`. |
| `null-sync/src/blobStore.ts` + `extension.ts` | The contract above; `categories.activity` (default false); consent text. |
| `types.ts`, `dashboardModel.ts`, `protocol.ts`, `src/webview/dashboard/*` | `machine` field, `MachineStat`, Machines section. |

## Error handling

Sync never throws into the extension host and never blocks activation or tracking. Failures are logged to the "Null Activity" output channel (never the token or passphrase). A corrupt or unreadable remote blob is skipped; the cache keeps the previous copy. A wrong-version header (`v` unknown) is skipped. Local tracking, stats and deletion are unchanged when the remote is unreachable.

## Security and privacy

Leaves the device only when the user turned on both `null-sync.enabled` and `null-sync.categories.activity`: AES-256-GCM ciphertext, the plaintext `manifest.json` already used by `null-sync`, and the file names `activity__<machineId>__<month>.enc` (so machine ids and active months are visible, contents are not). `null-activity`'s own engine, dashboard and git code stay free of network code; the only network code remains in `null-sync/gistHttp.ts` and `null-activity/gistHttp.ts` (badges).

## Testing

Pure units under `node --test` (added to each extension's `test` script):

- `activityBlob`: round trip, header check, unknown `v`, corrupt gzip.
- `machineId`: created once, stable, hostname fallback.
- `stats`: two machines active at the same time → headline counts once, per-project sums per machine/window; the same WakaTime import on two machines counts once; `machineStats`.
- `intervalStore`: remote cache is read and tagged; `replaceRemote` replaces rather than appends; delete affects own files only.
- **`activitySync` with two devices sharing one in-memory blob store** (like `syncEngine`'s two-device test): first upload, B pulls A's month, A adds data → B's cache replaced, no duplicates after repeated runs, empty month deleted, unreadable remote blob skipped, own id never downloaded, store unavailable → no-op.
- `null-sync` `blobStore`: unavailable unless enabled and the category is on; the engine run ignores `activity__*` files.

Integration (`/verify-local null-activity`, `null-sync`): activation without `null-sync`; with sync disabled nothing is read or written remotely. A real Gist round trip is not run in CI.

## Acceptance criteria

| Issue criterion | Where |
|---|---|
| Activity from multiple machines attributed to the same user | Remote format (same Gist/account), Machine identity |
| Machines distinguishable in activity details | `machine` field, `getMachineStats`, Dashboard |
| No duplicate records when syncing | Dedupe: one blob per `(machine, month)`, replaced not appended; overlap clipping in Statistics |
| Accurate project and coding-time statistics | Statistics (union headline, per-machine/window attribution, pooled imports) |
| Unified view without losing machine detail or double-counting | Statistics + Dashboard |

## Delivery

One plan, two phases, each ending in a working committed state.

- **Phase 1:** machine identity, `machine` tag, `IntervalStore` remote cache, `stats` changes, `getMachineStats`, dashboard Machines section. Works with remote data already present in `machines/` (no transport yet), fully unit-testable.
- **Phase 2:** `activityBlob`, `activitySync`, `syncLink`, the `null-sync` blob store and `activity` category, docs (`CLAUDE.md`, `null-sync` design note).

## To verify in the plan

1. `null-sync`'s engine ignores unknown remote names such as `activity__*` (does not delete or report them) when it plans and pushes.
2. `null.null-sync`'s exports are reachable from `null-activity` (both `ui`, so same host) and activation order is safe (`activate()` on first use).
3. Concurrent Gist writes from the settings run and the activity run in different windows are serialised by the shared lock.
4. A heavy month stays under 900 KB gzipped (measure on the real interval logs).

## Out of scope

Per-machine filter on other dashboard views; merging or forgetting old machine ids; deleting another machine's data from here; real-time push; yearly roll-ups; an "editor" dimension; cross-machine git statistics; GitLab or non-Gist transport.

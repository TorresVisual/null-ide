# Null Activity — Git Statistics Design

Issue: [#113 WakaTime Replacement](https://github.com/TorresVisual/null-ide/issues/113)

## Goal

Show what you committed next to what you tracked. The Coding Activity dashboard gains, per project and in total, the number of **commits, files changed and lines added/removed** you authored in the selected range. It is local and read-only: git is read with the `git` binary already on the machine; no network code, no engine changes, no change to the interval log.

This is piece 3 of the decomposition in `docs/specs/null-activity-engine-design.md`. The badge and WakaTime import remain separate later specs.

## Decisions

- **Only your commits.** Commits whose author email equals the repo's own `git config user.email` (so the per-repo identity null-accounts writes is respected). No `user.email` → the project has no git result.
- **Open workspace folders only.** A tracked project's `key` is a normalized remote URL, which cannot be turned back into a folder, and the log deliberately stores no folder paths. Git stats are therefore computed for the folders open in this window; every other tracked project shows time only (git cell "—"). Nothing new is stored. (Remembering folders so past projects fill in is a possible later extension and would add a field to the log.)
- **Spawn `git log --numstat`.** Not the built-in `vscode.git` API (no numstat, no date filter, an extra coupling) and not `.git` object parsing (packfiles).
- **Engine untouched.** No new `NullActivityApi` method and no `Interval` change. Git data is host-side only and reaches the webview through `DashboardModel`.
- **Same ranges as the dashboard.** Today, Yesterday, This week, This month, All time, using the existing `DateRange` (half-open) semantics.
- **No setting.** Git is only ever read, never written, and the dashboard stays opt-out via `null-activity.enabled` like everything else. (`ponytail:` add `null-activity.git.enabled` only if people ask to stop the child processes.)

## What is counted

For one repo and one `DateRange`:

- **Commits:** commits reachable from any **local branch** (`--branches`, so work on branches that are not checked out counts), without merges (`--no-merges`), authored by the repo's `user.email`, with committer time in `[from, to)`. A commit on several branches is counted once (git de-duplicates within a single `git log`).
- **Files changed:** the number of **distinct paths** touched across those commits (`--no-renames`, so a rename is a delete plus an add and paths stay simple). Binary files (numstat prints `-`) count as a changed file and add no lines.
- **Lines added / removed:** the sum of the numstat columns over those commits.
- Repos are keyed by `resolveProject(folder).key`. Two open folders with the same key (a second worktree, or a subfolder and its parent) are one repo and are queried once.

Committer time is used because it is what `--since`/`--until` filter on; the parser re-applies the exact half-open bounds so a commit at a boundary is never counted in two adjacent ranges.

## Components

| File | Responsibility |
|---|---|
| `src/gitLog.ts` | Pure, no imports beyond types. `gitLogArgs(range) → string[]` and `parseGitLog(stdout, email, range) → GitTotals`. |
| `src/gitStatsService.ts` | No `vscode` import. `class GitStatsService` with injected deps (`folders()`, `trusted()`, `exec`, `now`, `log`). `cached(range) → DashboardGit \| undefined` and `load(range) → Promise<DashboardGit>`. Resolves keys, dedupes repos, runs git, caches. |
| `src/protocol.ts` | Add `GitTotals`, `DashboardGit`; `Share.key?`; `DashboardModel.git?`. |
| `src/dashboardModel.ts` | `buildDashboardModel(..., git?: DashboardGit)` copies it into the model; `toShares` passes an optional `key` through (projects only). |
| `src/dashboardPanel.ts` | Constructs the service with real `vscode`/`child_process` deps. After each push, if git for the range is missing or stale, loads it and re-posts the model with `git` attached. |
| `src/webview/dashboard/` | `model.ts`: pure `formatGit(totals)`. `breakdown.ts`: git line under each project name. `main.ts`: git line under the total. |
| `lib/dashboard.css` | Styles for the two git lines (hand-written). |

### `gitLog.ts`

```ts
export function gitLogArgs(range: DateRange): string[];
export function parseGitLog(stdout: string, email: string, range: DateRange): GitTotals;
```

Arguments (run with `execFile`, never through a shell, `cwd` = the folder):

```
git --no-pager log --branches --no-merges --no-renames --numstat -F --author=<email>
    --format=@%ct%x09%ae [--since=<from seconds>] [--until=<to seconds>]
```

`--since`/`--until` are omitted for `ALL_TIME` (`from <= 0` / `to === Number.MAX_SAFE_INTEGER`). `--author` only narrows the output; the parser does the authoritative case-insensitive **exact** match on `%ae`, so `a@b.com` never matches `xa@b.com`.

Output shape the parser handles: a header line `@<unix seconds>\t<email>`, then zero or more `<added>\t<removed>\t<path>` lines, then a blank line. Header lines that fail the author or `[from, to)` test skip their file lines too. Unparseable lines are skipped, never thrown.

### `gitStatsService.ts`

- `folders()` is `vscode.workspace.workspaceFolders` mapped to paths; `trusted()` is `vscode.workspace.isTrusted`. Untrusted workspaces return an empty result: git reads repo config, and the built-in git extension makes the same trust call.
- Per distinct key: `git config --get user.email` (once per load), then the log. Both run with `GIT_OPTIONAL_LOCKS=0`, a 15 s timeout and a 32 MB output cap.
- **Cache:** per `(key, from, to)`, 60 s TTL (the dashboard's refresh period), with in-flight de-duplication, so the dashboard's one-push-per-second throttle cannot spawn a process per interval close. A commit made now appears within a minute.
- Any failure for a repo (no `git`, no `user.email`, timeout, cap exceeded, not a repo) drops that repo from the result and logs one line; it never throws and never blocks the other repos or the dashboard.

## Data model

```ts
interface GitTotals { commits: number; filesChanged: number; linesAdded: number; linesRemoved: number }

interface DashboardGit {
  /** Sum over `byProject`; the projects that have no git result are not part of it. */
  totals: GitTotals;
  /** Keyed by `Share.key` of the projects row. Only projects with a git result. */
  byProject: Record<string, GitTotals>;
}
```

`Share.key` is set on project rows only (the other-folding "Other" row and language rows have none). `DashboardModel.git` is absent until the first load finishes, and stays absent when nothing is open or nothing resolved.

## Flow

1. `push()` builds and posts the model synchronously as today, with `git` taken from `service.cached(range)` when fresh.
2. If the cache is missing or stale, `load(range)` starts. When it resolves and the panel is still open on the same range, the panel posts the model again with `git` attached.
3. A range change repeats this for the new range. Rapid range changes are safe: a result for a range that is no longer selected is dropped.

No new webview→host message types; `parseWebviewMessage` is unchanged.

## UI

- **Total:** under the range label, one muted line `7 commits · 12 files · +512 −120`, shown only when `git.totals.commits > 0`.
- **Projects rows:** a muted second line under the name with the same format when the project has `commits > 0`; `—` when the row has a `key` but no entry in `byProject` (not open, no `user.email`, git failed); nothing when the project has an entry with 0 commits. If `byProject` is empty, no project row shows any git line at all (no wall of dashes).
- `+` figures use the existing success tone and `−` the error tone via VS Code theme variables, never a new accent. All text goes in through `textContent`.
- Plural forms: `1 commit`, `1 file`.
- The empty-range state ("Nothing tracked") is unchanged: git lines only appear with the lists they annotate.

## Error handling

- A throw while loading or merging git is caught in the panel, logged to the output channel, and the model is posted without `git`; no modal.
- Huge history on All time: the 32 MB cap and 15 s timeout turn it into "—" for that repo rather than a hang.
- Repo names that collide (two open folders called `app`) are not a problem because rows match on `key`, not on name.
- Closing the panel disposes any pending load result (it is discarded, not cancelled).

## Testing

`node --test`, registered in the `test` script in `package.json`:

- **`gitLog.test.ts`:** parses a fixture with several commits and files; exact-email filter (substring and different-case email); half-open bounds (commit exactly at `from` counts, exactly at `to` does not); distinct files counted once across commits; binary `-\t-` lines; merge-free output only; empty output; garbage and torn lines skipped; `gitLogArgs` omits `--since`/`--until` for `ALL_TIME`.
- **`gitStatsService.test.ts`:** a fake `exec`. Same key from two folders queries once; untrusted → empty; missing `user.email` drops the repo; one failing repo does not affect another; cache hit within TTL and refetch after it; in-flight de-duplication; a result for an old range is not returned from `cached` of the new one.
- **`gitStatsService.git.test.ts`:** against a real temporary repository created with `git init` (skipped when `git` is not on `PATH`): two commits with known line counts under a configured `user.email`, a commit by another author, and a commit on a non-checked-out branch; asserts the totals end to end. This is the only test that runs real git.
- **`dashboardModel.test.ts`:** `git` is passed through unchanged; `Share.key` on project rows only.
- **`dashboardWebviewModel.test.ts`:** `formatGit` (singular/plural, zero lines, large numbers).

One `verify-local` integration spec is not worthwhile: the webview contents cannot be inspected from the extension host, and the real-git test above covers the path that can fail.

## Repository wiring

- `package.json`: `test` script entries for the three new test files.
- CLAUDE.md: add a git-statistics sentence to the null-activity paragraph (open-folders-only rule, no log change) and the spec/plan paths.
- No `build.yml`, `sync-local.ps1` or patch changes; `lib/` is already copied.

## Out of scope

Git data for projects that are not open (needs stored folder paths), other authors, per-branch breakdowns, ratios such as lines per hour or time per commit, commit lists or a graph over time, pushes or PRs (network), badge, WakaTime import, a git on/off setting.

# Crash Recovery Design (#17)

## Goal

After an unexpected exit (crash, forced kill, power loss) Null IDE never loses unsaved work and never leaves the user unsure what their Claude Code sessions were doing.

## Findings that shape the design

- Null IDE is VSCodium. VS Code's backup tracker ("hot exit") already keeps dirty buffers on disk and restores open editors, cursors and scroll positions. It also protects newer on-disk content through the save-conflict dialog. Nothing in the repo sets or verifies `files.hotExit` / `window.restoreWindows`, and nothing tells the user a crash happened.
- There is no native agent UI (AI Agents panel deleted in #84; see `.claude/product-audit/ARCHITECTURE.md`). The official Claude Code extension owns sessions. Transcripts live in `~/.claude/projects/<encoded-workspace>/<sessionId>.jsonl`; `followAlong.ts` already locates and parses them.
- A finished turn ends with an assistant entry with `stop_reason: end_turn`. An interrupted one ends on an assistant `tool_use` with no result.
- The extension exposes `claude-vscode.editor.open(sessionId, initialPrompt?, viewColumn?)`, which opens a specific session.
- The extension's input box is a webview Null IDE cannot read, so **unsent prompts are not recoverable**. Programmatic prompt submission is blocked by the extension, so an interrupted **operation cannot be resumed**; only the conversation is reopened.

## Scope

In: hot-exit configuration, unclean-exit detection, interrupted-session detection, recovery prompt.
Out: a Null IDE backup store (duplicates hot exit), a patch to VS Code's main process, draft capture for the extension's input box, resuming operations.

## Design

All new code is in `extensions/null-tools/src/recovery/`. No patches and no new extension.

### 1. Editors (config only)

`product.json → configurationDefaults` pins `files.hotExit: "onExit"` and `window.restoreWindows: "all"` (the VS Code defaults, made explicit so they cannot drift). `"onExitAndWindowClose"` is deliberately not used: VS Code's backup tracker writes dirty-buffer backups continuously for any value except `"off"`, so it adds nothing for crash recovery and would change ordinary window-close behavior (no save prompt). Recovery never writes to project files, so newer on-disk content cannot be overwritten; a dirty restored buffer that conflicts with a newer file hits VS Code's own save-conflict flow.

### 2. Crash detection (`crashMarker.ts`, no `vscode` import)

- On activation, write `recovery/<pid>-<startedAt>.json` under `globalStorageUri`: `{ pid, startedAt, folders[] }` (written to a temp name and renamed, so a scanning window never sees a torn marker). A clean dispose (extension deactivation) deletes it synchronously.
- On activation, before writing its own marker, scan the others. A marker whose pid is dead (`process.kill(pid, 0)` throws `ESRCH`; injected for tests) is a crashed run. **The stale marker file is itself the pending record**: it stays on disk until Review completes or Discard, so the prompt survives a second crash and there is no cross-window `globalState` race.
- A window only handles dead markers that share a workspace folder with it (compared case-insensitively). Markers with no folders are deleted at once (nothing to review); markers for other folders are left for a window that opens them. Markers older than 30 days are deleted.
- A corrupt or unreadable marker is deleted and ignored; recovery must never block startup.
- Known ceiling: if the OS reuses a dead pid for an unrelated live process, that crash is not detected. The marker is removed by the 30-day age rule.
- `deactivate` is best-effort on quit, so a false positive is possible. The cost is one harmless notice; hot-exit restore is the real safety net.

### 3. Interrupted sessions (`interruptedSessions.ts`, pure over a directory)

For each folder in a crashed marker that this window also has open, `findProjectDir` (reused from `followAlong.ts`), then every transcript with `crashed.startedAt ≤ mtime < thisWindow.startedAt`. The upper bound excludes sessions that other, still-running windows wrote after this window started. Only the last 64 KB (for state) and first 64 KB (for the title) of each file are read. State comes from the last parseable `user`/`assistant` entry (torn final lines, non-conversation entries, `isSidechain` and `isMeta` entries are skipped).

- **interrupted**: the last entry is not an assistant `end_turn`, or is an assistant `tool_use` without a result. A "[Request interrupted by user]" entry is a deliberate stop and is not interrupted.
- Otherwise the session is **restorable** (recent, completed).
- Output: `{ sessionId, title (first prompt, truncated), lastActivity, interrupted }`.

### 4. Prompt and cleanup (`recoveryIntegration.ts`, the only file importing `vscode`)

One notification: "Null IDE closed unexpectedly. Unsaved editors were restored by VS Code. N Claude conversations were open (M interrupted mid-turn)." Buttons: **Review**, **Later**, **Discard**.

- **Review**: QuickPick of the sessions; interrupted ones carry a warning icon and "interrupted — conversation restored, the operation was not resumed". Choosing one runs `claude-vscode.editor.open(sessionId)`. Pending data is cleared once every listed session has been opened or the list is dismissed with Discard.
- **Later**: pending is kept; the prompt returns on next launch.
- **Discard**: pending is cleared.
- No crash, no transcripts, or Claude Code absent: no prompt, no behavior change.
- Setting `null.recovery.enabled` (default `true`) is the master switch.

## Error handling

Every filesystem and JSON step is wrapped; a failure drops that marker or transcript and continues. Recovery code never throws out of `activate`.

## Testing

- Unit tests (added to null-tools' explicit `test` list): marker lifecycle with injected pid-alive check; corrupt marker; transcript fixtures for `end_turn`, dangling `tool_use`, torn last line, user interrupt, and mtime before `startedAt`.
- Manual checklist (a forced kill cannot run in the spec harness): type unsaved text in an untitled and a saved file, run a Claude turn, `taskkill /F`, relaunch; confirm the text, cursor and editors return, the prompt appears, interrupted sessions are flagged, Review opens the session, and Discard stops the prompt on next launch. Also confirm a normal quit and a Reload Window show no prompt.

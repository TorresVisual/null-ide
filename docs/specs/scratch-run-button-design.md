# Run Button for Scratch Files — Design

Extends the Scratch Files feature (`docs/specs/scratch-and-notes-design.md`) with a way to execute the currently-open scratch file directly from the editor.

## Goals

- One click (or command palette entry) to run a `.py`, `.js`, or `.ts` scratch file and see its output.
- No new settings surface — fixed, hardcoded interpreter mapping, matching the existing `SCRATCH_LANGUAGES` convention.

## Non-goals

- Notes are never runnable — this feature only touches Scratch Files.
- No keybinding in this version (not requested).
- No support for `.md` / `.json` / `.txt` scratch files — the button simply doesn't appear for them.
- No configurable interpreter overrides.

## Behavior

**Runner mapping** (fixed table, added to `scratchNotesStorage.ts` alongside `SCRATCH_LANGUAGES`):

| Extension | Command |
|---|---|
| `.py` | `python "<file>"` |
| `.js` | `node "<file>"` |
| `.ts` | `npx ts-node "<file>"` |

**Button visibility:** A ▶ icon in the editor title bar, visible only when the active editor's document is inside `.null/scratch/` and has one of the three runnable extensions. Visibility is driven by a custom context key `null.canRunScratchFile`, kept in sync via a `vscode.window.onDidChangeActiveTextEditor` listener (same pattern as the existing `null.viewingProposedDiff` key used by the diff accept/reject buttons). The button is hidden (not disabled) for non-runnable files, and hidden entirely when no workspace is open.

**Run command (`null.runScratchFile`):**
1. If the active document is dirty, save it.
2. Build the run command string via `buildScratchRunCommand(filePath)`.
3. Reuse an existing integrated terminal named "Scratch" if one exists, otherwise create it.
4. Show the terminal and send the command text to it.

No special error handling is needed if `python`/`node`/`npx` aren't on `PATH` — the terminal surfaces the shell's own "command not found" error, same as running it manually.

## Testing

- Unit tests for `buildScratchRunCommand`: returns the expected command string for `.py`/`.js`/`.ts`, and `undefined` for `.json`/`.md`/`.txt` and unknown extensions.
- Manual verification: open a `.py` scratch file, confirm the ▶ button appears and running it prints output in a "Scratch" terminal; open a `.md` scratch file, confirm the button is absent.

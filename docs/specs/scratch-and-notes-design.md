# Scratch Files & Quick Notes — Design

Covers two related TODO items from `TODO.md`:
- `Integrated scratchpad/temp files`
- `Built-in quick notes panel`

Both are workspace-scoped features implemented in `null-tools`, sharing one storage root and one activity-bar container, but otherwise independent.

## Goals

- A fast way to spin up a throwaway file for pasting/testing code, without polluting the real project tree or relying on VS Code's `Untitled-N` tabs (which don't survive reliably and have no home on disk).
- A fast way to keep multiple named, persistent notes per project (meeting notes, reminders, planning) that render as markdown.
- No new backend services, no webview UI — reuse existing editor/tree-view primitives to keep the implementation small and consistent with the rest of null-tools.

## Non-goals

- No auto-cleanup / retention policies (manual delete only).
- No cross-project or global notes (each workspace has its own scratch files and notes).
- No settings/configuration surface in the first version (folder paths, filename schemes, etc. are fixed).
- No note tagging, search, or backlink features (that's what full note apps are for).

## Storage layout

```
<workspace-root>/.null/
├── scratch/
│   └── scratch-<timestamp>.<ext>
└── notes/
    └── <slugified-title>.md
```

- `.null/` is created lazily on first use of either feature.
- The first time `.null/` is created, a `.null/` entry is appended to the workspace's `.gitignore` (created if it doesn't exist) if the entry isn't already present. This is a one-time check per workspace, not re-verified on every file creation.
- Both folders are real files on disk — visible in the regular Explorer, editable with any tool, but ignored by git by default.

## Activity bar container

One new `viewsContainers.activitybar` entry, id `null-workspace`, title "Null Workspace", with its own icon. It contains two tree views:

| View id | Name | Backed by |
|---|---|---|
| `null.scratchView` | Scratch Files | `.null/scratch/` |
| `null.notesView` | Notes | `.null/notes/` |

Both are `vscode.TreeDataProvider<vscode.Uri>` implementations that list files in their folder (flat list, no subfolders), sorted newest-first by mtime. Each watches its folder with `vscode.workspace.createFileSystemWatcher` and fires `onDidChangeTreeData` on create/delete/rename, matching the pattern used by `recentProjects.ts` for its own tree data.

Each view's title bar has a `navigation` group `+` button wired to that view's "New" command. Right-click context menu on tree items offers **Rename** and **Delete**.

## Scratch Files feature

**Command:** `null.newScratchFile` ("Null: New Scratch File")

Flow:
1. Show a `vscode.window.showQuickPick` with common languages: JavaScript, TypeScript, Python, Markdown, JSON, Plain Text (extensible list, hardcoded — no config).
2. Build filename `scratch-<YYYYMMDD-HHmmss>.<ext>` (ext mapped from the picked language, e.g. Plain Text → `.txt`).
3. Ensure `.null/scratch/` exists, write an empty file, open it via `vscode.window.showTextDocument`.

Deletion: right-click → Delete on a tree item removes the file from disk (with a confirmation prompt, matching VS Code's own delete-file UX). Rename: right-click → Rename prompts for a new filename (extension preserved unless the user changes it).

## Notes feature

**Command:** `null.newNote` ("Null: New Note")

Flow:
1. Show a `vscode.window.showInputBox` prompting for a note title.
2. Slugify the title to build the filename (lowercase, spaces → hyphens, strip non-alphanumerics) → `<slug>.md`. If a file with that name already exists, append `-2`, `-3`, etc.
3. Ensure `.null/notes/` exists, write a file seeded with `# <title>\n\n`, open it via `vscode.window.showTextDocument`.

The tree view's display label for each note is derived from the file's first `# heading` line if present, falling back to the filename. Opening a note gives normal markdown editing, and the existing null-markdown preview command (`Ctrl+Shift+V`) works on it unmodified — no new preview logic needed.

Deletion/rename: same as scratch files (confirmation-gated delete, rename prompt).

## Error handling

- Folder creation failures (e.g. read-only workspace) surface via `vscode.window.showErrorMessage` with the underlying error message; the command aborts without opening a doc.
- `.gitignore` append is best-effort: if it fails (permissions, no workspace root), log to the extension's output channel and continue — this must never block scratch/note creation.

## Testing

- Unit tests (`node --test`, matching `recentProjects.test.ts`'s pattern) for: filename slugification/collision handling, extension-from-language mapping, and the `.gitignore` append logic (idempotent — running twice doesn't duplicate the entry).
- Manual verification in a running dev instance: create/rename/delete a scratch file and a note, confirm tree views update live, confirm `.gitignore` gets the entry exactly once.

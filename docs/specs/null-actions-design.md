# Null Actions Extension (`null-actions`) — Design

## Problem

The user relies on [vscode-action-buttons](https://github.com/SeunLanLege/vscode-action-buttons)
(status-bar buttons that run shell commands or VS Code API commands) for
frequently-used commands, but it has real day-to-day friction:

1. **Config is fiddly/error-prone.** Buttons are hand-authored JSON arrays in
   `settings.json` with no validation UI; typos or malformed entries fail
   silently or produce "you have no run commands" errors.
2. **Terminal reuse is broken.** In practice this shows up as *multiple
   terminals accumulating for what should be one button* — most visibly
   after reopening a folder/reloading the window, and also suspected when a
   button's underlying command text changes. Root cause (inferred from
   behavior): the extension's in-memory terminal-identity map resets on
   extension-host restart, but VS Code often restores the actual terminal
   objects from the previous session (persistent sessions). With no memory
   of the old terminal, the next click just creates a new one — old
   terminal orphaned, new one created, repeat on every reload.
3. **No real visual/layout control.** Text color exists, but there's no
   control over left/right alignment or ordering among buttons — everything
   lands whichever way the extension happens to created them in.
4. **Buttons don't adapt to context.** Same fixed button set regardless of
   project type or active file language; no per-workspace-folder scoping in
   multi-root workspaces.

## Background

Repo precedent: `null-cpp` and `wooting-analog` are narrowly-scoped built-in
extensions with their own `package.json`, `src/`, activation, and CI build
step, as opposed to bolting unrelated functionality onto the grab-bag
`null-tools` extension. `null-actions` follows that same pattern — it's a
big enough, self-contained feature (status bar UI + a settings webview + a
command-execution engine) to warrant isolation, and keeps `null-tools` from
growing further.

VS Code platform constraint that shapes the design: `StatusBarItem`'s
`backgroundColor` only accepts the theme's `statusBarItem.warningBackground`
or `.errorBackground` — arbitrary background colors are not permitted by the
API. This is why the original extension never had real background-color
control either, despite users asking for it in issues. Text color
(`StatusBarItem.color`, accepts a hex string or `ThemeColor`) and icon
(codicon syntax) remain fully custom.

## Scope

In scope: status-bar buttons backed by per-button dedicated terminals or VS
Code API command execution; a settings webview for CRUD instead of raw JSON
editing; deterministic terminal identity that survives window
reload/folder-reopen without duplicating terminals; alignment/priority
ordering; context filters (`when.languages`, `when.filesExist`,
`when.folder`); project-type-detection suggestions (opt-in, never
auto-injected); npm-script auto-loading (kept from the original, since it
was the one dynamic-discovery behavior worth preserving).

Out of scope: arbitrary status-bar background colors (platform doesn't
allow it); auto-injecting suggested buttons into the bar without explicit
user action; task-runner integration (`tasks.json`) — buttons are
independent of VS Code's built-in task system, not a wrapper around it.

## Architecture

New built-in extension at `extensions/null-actions/`, publisher `null`,
mirroring `null-cpp`'s layout:

```
extensions/null-actions/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts       — activation; registers commands, status bar
│   │                         controller, webview panel, config watcher
│   ├── buttonConfig.ts    — reads/writes null-actions.buttons setting,
│   │                         (de)serialization, schema validation
│   ├── variableResolver.ts — ${workspaceFolder}, ${file}, ${selectedText},
│   │                         etc. substitution
│   ├── whenClause.ts      — evaluates when.languages / when.filesExist /
│   │                         when.folder against current editor/workspace
│   │                         state
│   ├── terminalRegistry.ts — deterministic per-button terminal identity
│   │                         and reuse (the fix for the duplication bug)
│   ├── statusBarController.ts — creates/updates/disposes StatusBarItems
│   │                         from the resolved, filtered button list
│   ├── projectDetector.ts — scans workspace root(s) for package.json /
│   │                         Cargo.toml / *.csproj / CMakeLists.txt,
│   │                         produces suggestion entries (not live buttons)
│   ├── npmScriptsProvider.ts — optional auto-loaded buttons from
│   │                         package.json scripts (not written to settings)
│   └── settingsPanel.ts   — webview panel: add/edit/reorder/delete buttons,
│                             "Suggested" tab from projectDetector
└── out/                    — compiled JS, committed (matches null-tools /
                              null-cpp / wooting-analog convention)
```

`extension.ts` wires a single reactive pipeline: config change
(`workspace.onDidChangeConfiguration`) or editor/workspace-folder change
(`window.onDidChangeActiveTextEditor`, `workspace.onDidChangeWorkspaceFolders`)
→ re-resolve the filtered button list (`whenClause.ts`) → diff against the
currently-rendered status bar items → `statusBarController.ts` creates,
updates, or disposes only the items that changed.

## Data Model

Stored in the `null-actions.buttons` configuration array (workspace or user
scope, same as any other VS Code setting — stays git-portable):

```jsonc
{
  "id": "build",                  // stable slug; terminal identity and
                                   // React-style list key both key off this,
                                   // never off the command text
  "label": "Build",
  "icon": "tools",                // codicon name, no $() wrapper
  "type": "terminal",             // "terminal" | "vscode-command"
  "command": "npm run build",     // shell command, or command id if
                                   // type is vscode-command
  "args": [],                     // only for vscode-command
  "color": "#ffcc00",             // optional text color (hex or theme color id)
  "background": "none",           // "none" | "warning" | "error" — see
                                   // platform constraint above
  "tooltip": "Run the production build",
  "cwd": "${workspaceFolder}",
  "saveAll": true,
  "focus": false,
  "alignment": "left",            // "left" | "right"
  "priority": 100,                // sort order within alignment group
  "when": {
    "languages": ["cpp", "c"],       // optional
    "filesExist": ["CMakeLists.txt"], // optional, relative to folder root
    "folder": "backend"              // optional, multi-root scoping
  }
}
```

Global settings: `null-actions.npm.autoLoad` (boolean, default `false`) and
`null-actions.defaultColor` (string), mirroring the two global options from
the original extension that were actually useful.

Variable substitution (`variableResolver.ts`) supports `${workspaceFolder}`,
`${file}`, `${fileBasename}`, `${fileDirname}`, `${relativeFile}`,
`${selectedText}`, `${lineNumber}`, `${env:VAR}`. Unresolvable variables
(e.g. `${file}` with no active editor) leave the literal token in place
rather than throwing — the command dispatch surfaces this as a normal shell
error, which is more debuggable than a silent no-op.

## Execution Engine

**`type: "vscode-command"`** — straight
`vscode.commands.executeCommand(command, ...args)` after variable
substitution on `args`.

**`type: "terminal"`** — dispatched through `terminalRegistry.ts`, which is
the direct fix for the reported bug:

1. Terminal name is deterministic and derived from the button `id`
   (`Action: <id>`), never from the command text — editing what a button
   runs never changes which terminal owns it; only closing the terminal
   does.
2. Resolving "the terminal for this button" never trusts a stale in-memory
   reference alone. Lookup order on every dispatch:
   a. If a cached `vscode.Terminal` reference exists for this id **and**
      it's still present in `vscode.window.terminals`, use it.
   b. Otherwise, scan `vscode.window.terminals` for a name match (handles
      the case where VS Code restored a persistent-session terminal after
      an extension-host restart, or the extension itself just reactivated)
      and adopt the most recently created match. This is what closes the
      "reopen the folder → duplicate terminal" gap.
   c. Otherwise, `createTerminal({ name })`.
3. Dispatch sends the resolved command via `sendText`. If a prior command
   is still running in that terminal, the new one queues normally — no
   special-casing, matches ordinary terminal semantics.
4. If step 2b finds *more than one* live match (e.g. leftover duplicates
   from before this fix, or a terminal the user manually created with a
   colliding name), the extension adopts one and leaves the others alone —
   it never closes a terminal it didn't create itself in the current
   session.
5. `saveAll` (if set) runs `workspace.saveAll()` before dispatch; `focus`
   (if set) calls `.show()` on the terminal after dispatch.

## Context-Adaptivity

- **Active-file language** (`when.languages`): re-evaluated on
  `window.onDidChangeActiveTextEditor`. A button without this filter is
  unaffected by editor focus changes.
- **File existence** (`when.filesExist`): checked against the relevant
  workspace folder root (or the folder named in `when.folder`, if set) on
  workspace-folder change and on extension activation. Not re-checked on
  every file save — only on folder add/remove — since manifest files
  changing existence mid-session is rare and re-scanning per save would be
  wasteful.
- **Multi-root folder scoping** (`when.folder`): when set, the button's
  `cwd`/variable resolution defaults to that folder, and the button is
  hidden entirely if that named folder isn't part of the current workspace.
- **Project-type detection** (`projectDetector.ts`): scans workspace
  root(s) for `package.json`, `Cargo.toml`, `*.csproj`, `CMakeLists.txt`.
  Matches populate the settings webview's "Suggested" tab (e.g. `cargo run`,
  `cargo build`, `dotnet build`) as one-click-to-add entries. **Never**
  auto-injected into the status bar — nothing appears without explicit user
  action, so there's no surprise-button churn as projects are opened/closed.
- **npm scripts** (`npmScriptsProvider.ts`): when `null-actions.npm.autoLoad`
  is on, scripts from `package.json` become live status-bar buttons directly
  (not written into `null-actions.buttons`), refreshed on `package.json`
  save. This is the one auto-live (not suggestion-only) piece of
  context-adaptivity, kept because it was the original extension's one
  dynamic-discovery feature that wasn't a complaint in its issue tracker.

## Settings UI (Webview)

A `WebviewPanel` opened in the main editor area (`vscode.ViewColumn.One`),
triggered by a `$(gear) Actions` status bar item or the
`null-actions.openSettings` command — not a sidebar view, which cramped the
form too narrow to use comfortably. Singleton: reopening reveals the
existing panel instead of creating a second one. Lists configured buttons
with add/edit/reorder/delete, and a "Suggested" tab fed by
`projectDetector.ts`. Form fields match the data model: text inputs for
label/command/tooltip/cwd, a codicon-name picker for icon, a color swatch
for text color, a `none`/`warning`/`error` selector for background (labeled
clearly as a platform-limited option, not a free color picker), and
alignment/priority steppers. Saves write back to `null-actions.buttons` in
workspace settings — plain JSON underneath, so it's still hand-editable if
someone wants to skip the UI for a quick change.

## Testing

Unit tests via `node --test` (matching `null-tools`/`null-cpp`'s pattern),
covering:

- `variableResolver.ts` — substitution correctness, unresolved-token
  passthrough.
- `whenClause.ts` — language/file-existence/folder filter evaluation,
  including the "no active editor" edge case for `when.languages`.
- `buttonConfig.ts` — (de)serialization round-trip, validation of malformed
  entries.
- `terminalRegistry.ts` — the core regression test suite for the reported
  bug: (a) fresh dispatch creates one terminal; (b) re-dispatch reuses the
  cached reference; (c) simulated extension-host restart with a matching
  terminal already present in `vscode.window.terminals` adopts it rather
  than creating a duplicate; (d) editing a button's `command` while its
  terminal is open does not create a new terminal, only changes what gets
  sent.

Webview rendering and status bar visuals are verified manually in a running
dev build (no automated UI test harness in this repo for webviews).

## Build Integration

Add to `.github/workflows/build.yml`, mirroring the existing `null-cpp`
steps:

- A "Compile null-actions TypeScript" step (`npm ci && npm run compile` in
  `extensions/null-actions/`).
- A `Copy-Item -Recurse -Force ide-overlay/extensions/null-actions
  vscode-src/extensions/` line alongside the other five built-ins.

`product.json` and `CLAUDE.md` get updated to list `null-actions` as a
sixth built-in extension (CLAUDE.md's extension table is already slightly
stale — it doesn't list `null-cpp` either — so this update should correct
both in the same pass).

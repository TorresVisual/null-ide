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
reload/folder-reopen without duplicating terminals; priority ordering (all
buttons render left-aligned — right-alignment was dropped as unneeded);
project-type-detection suggestions (opt-in, never auto-injected) including
a one-click "Load npm scripts" action that writes each `package.json`
script in as a real persisted button.

Out of scope: arbitrary status-bar background colors (platform doesn't
allow it); auto-injecting suggested/npm-script buttons into the bar
without explicit user action — everything a user sees in the status bar
must exist as a real, persisted entry in `null-actions.buttons`, no live
ephemeral buttons; per-button visibility filters (language/file-existence/
folder conditions were built, then dropped — not worth the complexity for
this extension's actual usage); task-runner integration (`tasks.json`) —
buttons are independent of VS Code's built-in task system, not a wrapper
around it.

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
│   ├── terminalRegistry.ts — deterministic per-button terminal identity
│   │                         and reuse (the fix for the duplication bug)
│   ├── statusBarController.ts — creates/updates/disposes StatusBarItems
│   │                         from the current button list
│   ├── projectDetector.ts — scans workspace root(s) for package.json /
│   │                         Cargo.toml / *.csproj / CMakeLists.txt,
│   │                         produces suggestion entries (not live buttons)
│   ├── npmScriptsProvider.ts — parses package.json scripts; consumed by
│   │                         settingsPanel's "Load npm scripts" action,
│   │                         which writes them into null-actions.buttons
│   │                         as real persisted entries (not live buttons)
│   ├── settingsPanel.ts   — WebviewPanel: add/edit/reorder/delete buttons,
│   │                         "Suggested" tab from projectDetector
│   └── webview/colorPicker.ts — Affinity-style hue-ring + saturation/
│                             lightness-triangle canvas picker for the
│                             button text color; compiled separately (see
│                             tsconfig.webview.json) since it runs in the
│                             webview's browser context, not the extension
│                             host
└── out/                    — compiled JS, committed (matches null-tools /
                              null-cpp / wooting-analog convention)
```

`extension.ts` wires a single reactive pipeline: on activation and on every
config change (`workspace.onDidChangeConfiguration`), re-read
`null-actions.buttons` and hand the list straight to
`statusBarController.ts`, which creates, updates, or disposes only the
status bar items that changed.

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
  "focus": true,                  // defaults to true — most buttons are
                                   // things you want to watch run
  "priority": 100                 // status bar sort order (all buttons are left-aligned)
}
```

No global settings remain in this extension's `contributes.configuration`
besides `null-actions.buttons` itself — `null-actions.npm.autoLoad` (live,
ephemeral npm-script buttons) and `null-actions.defaultColor` (declared but
never actually wired up) were both removed. Per-button visibility filters
(`when.languages`/`when.filesExist`/`when.folder`) were built and then
dropped for the same reason: not worth the complexity for how this
extension actually gets used.

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

## Project-Type Detection

- **`projectDetector.ts`**: scans workspace root(s) for `package.json`,
  `Cargo.toml`, `*.csproj`, `CMakeLists.txt`. Matches populate the settings
  panel's "Suggested" tab (e.g. `cargo run`, `cargo build`, `dotnet build`)
  as one-click-to-add entries. **Never** auto-injected into the status bar —
  nothing appears without explicit user action, so there's no
  surprise-button churn as projects are opened/closed.
- **npm scripts** (`npmScriptsProvider.ts`): a "Load npm scripts" button in
  the settings panel reads `package.json`'s `scripts` and adds each one as
  a regular button object to the in-panel list (skipping any id already
  present), for the user to review, edit, or drop before hitting Save All.
  This replaced an earlier live/ephemeral `null-actions.npm.autoLoad`
  toggle — every button visible in the status bar is now a real, persisted
  entry in `null-actions.buttons`, with no separate "auto-loaded but not
  saved" category to reason about.

## Settings UI (Webview)

A `WebviewPanel` opened in the main editor area (`vscode.ViewColumn.One`),
triggered by a `$(gear)` status bar item or the `null-actions.openSettings`
command — not a sidebar view, which cramped the form too narrow to use
comfortably. Singleton: reopening reveals the existing panel instead of
creating a second one. Lists configured buttons as collapsible cards
(chevron + label + command preview when collapsed; all start collapsed,
new buttons start expanded), plus a "Suggested" tab fed by
`projectDetector.ts` and a "Load npm scripts" toolbar action.

Each card's fields are grouped under two headers, "Behavior" (Command +
file-browse button, Type, Args — shown only when Type is `vscode-command`,
Cwd, Save all, Focus) and "Appearance" (Icon — a text input with a curated
`<datalist>` of common codicon names, still free-text for anything not
listed; Color — a swatch button that opens the Affinity-style canvas picker
plus a text input for typed hex/theme-color-id values; Background; Tooltip;
Priority). Saves write back to `null-actions.buttons` in workspace
settings — plain JSON underneath, so it's still hand-editable if someone
wants to skip the UI for a quick change.

## Testing

Unit tests via `node --test` (matching `null-tools`/`null-cpp`'s pattern),
covering:

- `variableResolver.ts` — substitution correctness, unresolved-token
  passthrough.
- `buttonConfig.ts` — (de)serialization round-trip, validation of malformed
  entries, `focus`'s true-by-default behavior.
- `terminalRegistry.ts` — the core regression test suite for the reported
  bug: (a) fresh dispatch creates one terminal; (b) re-dispatch reuses the
  cached reference; (c) simulated extension-host restart with a matching
  terminal already present in `vscode.window.terminals` adopts it rather
  than creating a duplicate; (d) editing a button's `command` while its
  terminal is open does not create a new terminal, only changes what gets
  sent.

Webview rendering, status bar visuals, and `webview/colorPicker.ts` (the
canvas hue-ring/triangle picker — DOM/canvas/pointer-event code, same
"manual verification" bucket) are checked by hand in a running dev build
(no automated UI test harness in this repo for webviews).

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

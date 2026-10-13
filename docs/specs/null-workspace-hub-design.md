# Null Workspace Hub — Design

Issue: [#133 Redesign NULL Workspace as the Central Hub for NULL IDE Features](https://github.com/TorresVisual/null-ide/issues/133)

## Goal

Make the **Null Workspace** Activity Bar entry the one recognizable home for Null IDE features. Today it holds four tree views (Scratch Files, Notes, Null Ports, Worktrees) while other features are only reachable through the command palette (Sync, Environment check, Startup report) or through editor-tab panels nobody is pointed to (Accounts, Activity dashboard, Actions settings), and Music takes a separate Activity Bar entry.

Success: a user finds every Null feature from Null Workspace; a new feature is added with a JSON entry in its own `package.json`, never a new top-level Activity Bar entry; nothing that works today stops working.

## Decisions (agreed in the brainstorm)

- **Shape:** a categorized **Features launcher** tree at the top of the `null-workspace` container. The four existing tool views stay below it, unchanged.
- **Music** moves into `null-workspace` as a view (collapsed by default). Its own Activity Bar entry is removed.
- **GitHub Issues** keeps its own Activity Bar entry (large, always-on triage list that fights for height in a shared container) and gets a launcher entry too.
- **Registration is declarative.** No `registerFeature()` API.
- The extensions stay separate; the launcher depends on no extension's internals.

## Non-goals

- The dedicated Sync screen (own issue, builds on `NullSyncApi`). The launcher only links to `null.sync.showStatus`.
- A webview launcher, search box, status badges or favorites. Add when the entry count makes the tree hard to scan.
- Evaluating `when` clauses for entries (an extension cannot read context keys). Entries are always shown; the command itself handles an unavailable feature.
- Moving or redesigning Scratch / Notes / Ports / Worktrees.
- Entries for status-bar or context-driven features (updater, crash recovery, commit message, Markdown, `null-cpp`) and Discord presence settings. Adding one later is a JSON entry.
- Seeding a default Activity Bar order in `product.json`.

## Registration contract

Any extension adds a block to its own `package.json`:

```json
"nullWorkspace": {
  "features": [
    { "id": "accounts", "label": "Accounts", "category": "account",
      "icon": "account", "command": "null-accounts.open",
      "description": "GitHub & GitLab", "order": 10 }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique within its extension; the global key is `<extensionId>/<id>`. |
| `label` | yes | Tree item label. |
| `command` | yes | Command id run on click (`executeCommand`; works across extension hosts). |
| `category` | yes | Category id (below). |
| `icon` | no | Codicon id without `$()`; default `symbol-misc`. |
| `description` | no | Dimmed text after the label; also the tooltip. |
| `order` | no | Ascending within a category; default 100. Ties sort by label. |

**Only publisher `null` counts.** `collectFeatures` ignores `nullWorkspace` from any extension whose id does not start with `null.`; the hub is Null's home, and a Marketplace extension cannot add entries. Opening it up later means removing that one check.

**Entries are static.** A label, an optional description and an icon; no live state (counts, conflict markers). A dynamic description would be a second contract between extensions and is a later issue; the entry shape above does not need to change to allow it.

**Why `package.json` data and not an exported API:** exports do not cross extension hosts (`null-env` runs workspace-side, the rest UI-side, the same limit `null-env` documents), entries show without activating the providing extension, and a missing provider simply contributes nothing.

**Categories.** Fixed, ordered list in the registry: `develop` (Develop), `insights` (Insights), `account` (Account & Sync), `setup` (Setup). An unknown category id is appended after these, alphabetical, titled by capitalizing the id. A category with no entries is not shown.

## Initial entries

| Category | Label | Declared in | Command |
|---|---|---|---|
| develop | Dashboard | null-tools | `null.showWelcome` |
| develop | GitHub Issues | null-tools | `null.issues.openFullView` |
| insights | Activity Dashboard | null-activity | `null-activity.openDashboard` |
| insights | Startup Report | null-startup | `null-startup.openReport` |
| account | Accounts | null-accounts | `null-accounts.open` |
| account | Sync Status | null-sync | `null.sync.showStatus` |
| setup | Environment Check | null-env | `null.env.check` |
| setup | Actions Settings | null-actions | `null-actions.openSettings` |
| setup | Formatting Settings | null-format | `null-format.openSettings` |

`null-cpp.openSettings` is deliberately not listed: it matters only in C/C++ projects and entries cannot be hidden by context. "Sync Status" is listed although it is only a quick pick today, because the launcher is the one place a user can discover Sync; the later Sync screen replaces the command.

Each extension declares its own entry; `null-tools` does not hard-code the others.

## Components

### `null-tools` (new)

- `src/featureRegistry.ts` — **pure, no `vscode` import.** `collectFeatures(manifests: { extensionId: string; packageJSON: unknown }[]): FeatureCategory[]`. Validates each entry, drops malformed ones, de-duplicates by global key (first wins), groups by category and sorts. Exports the `Feature` / `FeatureCategory` types.
- `src/featuresTreeView.ts` — `vscode.TreeDataProvider` over `FeatureCategory[]`. Category nodes are expanded; feature nodes carry `command` and `ThemeIcon(icon)`. Refreshes on `vscode.extensions.onDidChange`.
- `package.json` — view `null.featuresView` ("Features") as the first entry of `views["null-workspace"]`; a `command` is not needed (the tree item invokes the target command directly).
- `package.json` view defaults: `null.featuresView` is `"visibility": "visible"` (expanded); `null.scratchView`, `null.notesView`, `null.portsView`, `null.worktreesView` and Music get `"visibility": "collapsed"`. VS Code applies these only the first time it sees a view id and keeps the user's own state afterwards, so existing users' layouts do not change; only fresh installs open to the launcher with five collapsed headers.
- `src/extension.ts` — registers the provider.
- `package.json` also declares the two `null-tools` entries (Dashboard, GitHub Issues) in `nullWorkspace.features`.

### Other extensions

- `null-accounts`, `null-activity`, `null-startup`, `null-sync`, `null-env`, `null-actions`, `null-format`: add their `nullWorkspace.features` entry to `package.json`. No code change.
- `null-music`:
  - `package.json`: remove the `null-music` container; contribute `null.musicView` under `views["null-workspace"]` with `"visibility": "collapsed"`.
  - `src/extension.ts:20`: replace `workbench.view.extension.null-music` with `null.musicView.focus`.
  - Keep `retainContextWhenHidden: true` (already set, `extension.ts:64`): hiding the view or switching containers must not stop audio.
- `docs`: update CLAUDE.md (null-tools row / null-music section) after implementation.

## Behavior and error handling

- Malformed `nullWorkspace` (not an object, `features` not an array, entry missing a required string field) is skipped silently for that entry; the rest still load. One `console.warn` per skipped entry names the extension id.
- Clicking an entry whose command does not exist (provider disabled, Safe Mode) shows VS Code's own "command not found" error; no custom handling.
- With `null-tools` disabled the launcher and the `null-workspace` container do not exist. VS Code then adds the Music view to **Explorer** (collapsed) and logs a "view container does not exist" warning. Accepted (no `extensionDependencies`): it needs `null-tools` disabled by hand, and Safe Mode disables all Null built-ins anyway. Music keeps its status-bar controls and keybindings.
- Remote windows: `vscode.extensions.all` includes workspace- and UI-side extensions, so the launcher is complete in either place; commands route to the correct host.
- Existing Activity Bar order, view sizes and collapse state for the four tool views are unaffected. A user who had the Music container pinned loses that pin; VS Code stores view locations by id, so the view lands in Null Workspace.

## Testing

- `src/featureRegistry.test.ts` (add to the explicit list in `package.json` `test`): valid entries group and sort; `order` then label; unknown category appended; malformed entries dropped; duplicate global key keeps the first; empty categories omitted.
- Integration (`/verify-local null-tools` and `null-music`): launcher shows all nine entries grouped; clicking Accounts opens the Accounts panel; Music playback started in the Workspace container continues after switching to Explorer and back; `null-music.*` commands still reveal the player.
- Manual in a built package: the Music Activity Bar entry is gone; Issues entry remains.

## Phases

1. `featureRegistry` + tree view + the two `null-tools` entries + tests.
2. Entries in the six other extensions.
3. Music move (manifest + one-line reveal fix + verify audio survives).
4. CLAUDE.md update.

## Risks / open verification

- **Contributing a view into another extension's container.** Verified in the VS Code source (`viewsExtensionPoint.ts`): any id resolves to `workbench.view.extension.<id>`. Still confirm the result in `/verify-local`. Fallback if it does not work: keep Music's own container and list it in the launcher (`null-tools` cannot declare the view itself, because the webview provider belongs to `null-music`).
- **Height.** Six views in one container share the sidebar. Music is collapsed by default and the Features tree is short; if this proves cramped, the follow-up is a webview launcher, not more views.

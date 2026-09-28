# Settings Editor — Design

Issue: [#108 Better settings panel](https://github.com/TorresVisual/null-ide/issues/108).

## Problem

The native Settings editor (`Ctrl+,`) is hard to navigate and doesn't look like the rest of Null IDE.

1. **Navigation.** Reaching a Null extension's settings takes four clicks (open Settings → expand Extensions → find the extension → pick its category) and a long scroll. The cause is `createTocTreeForExtensionSettings` (`src/vs/workbench/contrib/preferences/browser/settingsTree.ts`): it puts *every* extension that contributes configuration into a single alphabetical "Extensions" TOC node. ~100 VS Code built-ins (Git, TypeScript, Emmet, npm, …) are mixed in with Null's own extensions and the user's marketplace installs.
2. **Look.** The editor ignores `DESIGN.md`: 26/22/18px group headings in a workbench that is otherwise 12–13px, airy rows (`12px 14px 18px` padding — about 4 settings per screen), underlined User/Workspace tabs, and a blue outline box on the focused row.

Already fine, and left alone: clicking a TOC entry filters the list to that category (`viewState.categoryFilter`, upstream behavior).

## Goals

- A Null extension's settings are one or two clicks from opening the editor, with no scroll.
- The user's own marketplace extensions are separated from VS Code's built-ins.
- The editor matches `DESIGN.md` ("Null Compact", option B from the brainstorm mockups): denser rows, small headings, 1px dividers, rounded search, segmented scope switch.
- Works in all four shipped themes (Null Dark, Light, OLED, Retro).

## Non-goals

- Two-column row layout (brainstorm option C) — denser, but deeper coupling to upstream DOM.
- Changing core categories (Text Editor, Workbench, …), Commonly Used, or search.
- A custom settings webview.
- A "jump to extension settings" quick pick.

## Part 1 — TOC split (`patches/006-settings-toc-split-extensions.patch`)

### Resulting TOC order

```
Commonly Used
Null                  ← expanded by default
  Actions / C++ / Format / Tools / Wooting Analog
Installed Extensions
Text Editor
Workbench
Window
Features
Application
Security
Built-in Extensions
```

Empty sections are omitted (no marketplace extensions installed, or a search/scope filter leaves a section with nothing).

### Classification

Each extension settings group is classified by its extension:

| Section | id | Rule |
|---|---|---|
| Null | `null` | extension id starts with `null.` (case-insensitive) |
| Installed Extensions | `extensions` | otherwise, `!extension.isBuiltin` |
| Built-in Extensions | `builtinExtensions` | otherwise |

Rule order matters: Null's extensions are copied into `vscode-src/extensions/` at build time, so they are `isBuiltin` too — the `null.` check runs first. The user-installed section keeps upstream's `extensions` id (nothing else in `preferences/browser/` matches on it). An extension whose description can't be resolved (`getExtension` returns `undefined`) falls into Installed Extensions, where it already lands today.

Inside each section, per-extension entries are built exactly as today (single-category extensions flattened, multi-category ones nested, "ungrouped" category handling, alphabetical sort).

### Code changes

- **`settingsTree.ts` — `createTocTreeForExtensionSettings`**: return `ITOCEntry<ISetting>[]` (up to three section entries, empties dropped) instead of one entry. The `extension` object is already fetched per group for its display name; reuse it for classification.
- **`settingsEditor2.ts` — `onConfigUpdate`** (currently `resolvedSettingsRoot.children!.push(await createTocTreeForExtensionSettings(...))`): take the returned sections, insert `null` and `extensions` directly after the Commonly Used entry (which is `unshift`ed just below — order the two statements so Commonly Used stays first), and push `builtinExtensions` to the end.
- **`tocTree.ts` — `createTOCIterator`**: `collapsed: g.id === 'null' ? false : undefined`, so the Null section starts expanded.

### `wooting-analog` publisher

`extensions/wooting-analog/package.json` `"publisher": "you"` → `"null"`, so it matches the `null.` rule. Safe: its setting keys (`wooting-analog.*`) don't depend on the publisher, it stores no `globalState`/`workspaceState`, and nothing in the repo references `you.wooting-analog`.

### Docs

Add `006-settings-toc-split-extensions.patch` to the patch list in `CLAUDE.md` (Patches section).

## Part 2 — "Null Compact" styling (`workbench/custom.css`)

A new `/* ── Settings editor ── */` section in `workbench/custom.css`. No patch — this is how the rest of Null's workbench chrome is styled. All selectors are scoped under `.settings-editor`.

### Theme variables only

Null ships four themes, including Light and Retro (green accent). The CSS uses only `var(--vscode-*)` theme variables for color — never the Dark hex values from the mockup — so each theme restyles correctly. Sizes, radii and spacing are fixed values from `DESIGN.md`.

| Element | Treatment | Colors from |
|---|---|---|
| Search field (`.settings-header .search-container`) | 6px radius, command-palette-style border | `--vscode-input-background`, `--vscode-widget-border` |
| User / Workspace tabs (`.settings-tabs-widget`) | segmented control: bordered pill, 4px outer radii, checked segment filled; replaces the bottom-border underline | `--vscode-input-border`, `--vscode-button-secondaryBackground`, `--vscode-foreground`, `--vscode-descriptionForeground` |
| Header divider (`.settings-header-controls`) | border removed (the segmented control carries the separation) | — |
| TOC (`.settings-toc-container`) | 12px text; selected row gets a soft fill and a 2px accent left edge. The 1px right divider already exists (the split-view sash uses `settings.sashBorder`, which defaults to the panel border) | `--vscode-list-hoverBackground`, `--vscode-focusBorder` |
| Group titles (`.settings-group-title-label.settings-group-level-{1,2,3}`) | 13px / 12px / 12px, weight 600, 1px bottom divider on level 1 | `--vscode-panel-border` |
| Setting rows (`.setting-item-contents`) | padding `8px 12px 10px`; 1px bottom divider; description in secondary text | `--vscode-panel-border`, `--vscode-descriptionForeground` |
| Focused row | soft background fill instead of the outline box | `--vscode-settings-focusedRowBackground` (kept); the `--vscode-settings-focusedRowBorder` outline rule (`.monaco-list:focus-within .monaco-list-row.focused .setting-item-contents`) overridden to `none` |
| Modified indicator (`.setting-item-modified-indicator`) | kept; top/bottom offsets shortened to match the new padding; recolored to the accent (upstream's `settings.modifiedItemIndicator` default is teal `#0C7D9D`, and no Null theme overrides it) | `--vscode-focusBorder` (the accent in every Null theme) |

Keyboard focus must stay visible: removing the row outline is only acceptable because the focused row keeps a background fill, and focused *controls* inside the row (inputs, checkboxes, dropdowns) keep their own `focusBorder` outline.

### Why CSS-only is safe here

The settings list is a virtualized `WorkbenchObjectTree`; `SettingsTree` measures each row's rendered height (`HeightChangeParams` in `settingsEditor2.ts`) rather than assuming a fixed one, so changing padding and font size does not break scrolling, scroll-to-setting, or TOC-driven navigation. The TOC rows stay at their fixed 22px height (`TOCTreeDelegate.getHeight`) — only font size and colors change there.

## Testing

- **Patch correctness**: `npm run typecheck-client` in `vscode-src` (type-checks the whole `src/` tree), and `git apply --check --reverse` of the exported patch against the edited tree. No upstream unit test is added: CI never runs VS Code's unit-test suites (it only runs `gulp vscode-win32-x64`), and running one locally requires a full `npm run compile` plus an Electron download — a test that never runs would only add rebase weight to the patch.
- **CSS, on the installed build** via `scripts/sync-local.ps1` (copies `workbench/custom.css` to `null-custom.css`): open Settings in Null Dark and Null Light and check — header, segmented User/Workspace switch, TOC selection, group headings, row density, a modified setting's indicator, keyboard-focused row, a search with results, and the Workspace tab.
- **Patch**: CI applies and builds it. A local `scripts/build-local.ps1` run happens only if explicitly requested (tens of minutes).

## Maintenance risk

- The patch touches `settingsTree.ts` / `settingsEditor2.ts`, which change often upstream; it is kept to ~40 lines so re-exporting on an upstream bump is cheap. If it stops applying, the CSS half still works on its own.
- The CSS depends on upstream class names (`.settings-editor`, `.setting-item-contents`, `.settings-group-title-label`, `.settings-tabs-widget`, …). If upstream renames them, the rules silently stop matching and the editor falls back to the stock look — nothing breaks.

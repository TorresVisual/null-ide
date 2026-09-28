# Settings Editor (#108) Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Make the native Settings editor navigable (Null / Installed / Built-in extension sections in the TOC) and on-brand ("Null Compact" styling).

**Architecture:** Two independent halves. (1) An overlay patch, `patches/006-settings-toc-split-extensions.patch`, against VS Code's `preferences/browser` sources splits the single "Extensions" TOC node into three sections. (2) A new section in `workbench/custom.css` restyles the editor using only theme variables. Either half works without the other.

**Tech Stack:** VS Code workbench TypeScript (patched via `git apply` in CI), plain CSS injected as `null-custom.css`.

**Spec:** [docs/specs/settings-editor-design.md](../specs/settings-editor-design.md)

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Work only inside `D:\Coding\Apps\null-ide\` (CLAUDE.md scope rule). `vscode-src/` is a local scratch checkout — edits there are only a means to export the patch; they are never committed to the null-ide repo.
- Overlay patches are applied in CI with `git apply --ignore-whitespace` from inside `vscode-src/`, **after** VSCodium's patches. Paths in the patch must be `a/src/vs/...`.
- `vscode-src` already carries VSCodium's (uncommitted) changes, including one to `tocTree.ts`. The patch must contain **only** our change — never VSCodium's hunks.
- Do not run `scripts/build-local.ps1` without explicitly asking the user first (tens of minutes).
- CSS: colors only via `var(--vscode-*)` — no hex values. Null ships Dark, Light, OLED and Retro themes.
- CSS: sizes from DESIGN.md — 12px UI text, 13px max heading, radii 4px (controls) / 6px (search field).
- Section ids: `null`, `extensions` (installed), `builtinExtensions`. Labels: `Null`, `Installed Extensions`, `Built-in Extensions`.
- Commit messages follow the repo's conventional style (`feat(settings): …`), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.

## Review Focus

1. **Search with results** — the TOC switches to "filter" mode and shows only categories with matches; a section with zero matches (e.g. no Null setting matches "font") must disappear, not show as an empty header. Checked in Task 1 Step 9.
2. **Workspace tab** — only workspace-scoped settings are listed; the three sections must still render and filter correctly. Checked in Task 1 Step 9 and Task 2 Step 4.
3. **Keyboard focus visibility** — with the row outline removed, a keyboard-focused row must still be visibly distinct (background fill), and a focused checkbox/input/dropdown must still show its own focus ring. Checked in Task 2 Step 4.
4. **Light and Retro themes** — every restyled element must stay legible (no dark-only assumptions). Checked in Task 2 Step 4.
5. **Narrow editor** — below ~600px the TOC auto-hides (`narrow-width`); rows and header must not overflow or clip. Checked in Task 2 Step 4.

---

### Task 1: Split the Extensions TOC node (patch 006)

**Files:**
- Modify (scratch, exported to patch): `vscode-src/src/vs/workbench/contrib/preferences/browser/settingsTree.ts:480-564` (`createTocTreeForExtensionSettings`)
- Modify (scratch, exported to patch): `vscode-src/src/vs/workbench/contrib/preferences/browser/settingsEditor2.ts:1589-1591` (`onConfigUpdate`)
- Modify (scratch, exported to patch): `vscode-src/src/vs/workbench/contrib/preferences/browser/tocTree.ts:~167` (`createTOCIterator`)
- Create: `patches/006-settings-toc-split-extensions.patch`
- Modify: `extensions/wooting-analog/package.json:6` (publisher)
- Modify: `CLAUDE.md` (Patches list, after the `004-…` line)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `createTocTreeForExtensionSettings(extensionService, groups, filter): Promise<ITOCEntry<ISetting>[]>` — returns 0–3 section entries with ids `null` | `extensions` | `builtinExtensions`, in that order, empty ones omitted. Only caller: `SettingsEditor2.onConfigUpdate`.

- [ ] **Step 1: Record the type-check baseline**

`vscode-src` may already have type errors unrelated to this work (e.g. if overlay patch 002 isn't applied locally). Capture them so Step 6 compares like with like.

Run (Git Bash, from `D:/Coding/Apps/null-ide/vscode-src`):
```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck-client > /tmp/tc-before.txt 2>&1; grep -c "error TS" /tmp/tc-before.txt
```
Expected: a count (possibly 0). Note it.

- [ ] **Step 2: Stage the VSCodium baseline for the three files**

So `git diff` later shows only our edits, not VSCodium's existing change to `tocTree.ts`:
```bash
cd D:/Coding/Apps/null-ide/vscode-src
git add -- src/vs/workbench/contrib/preferences/browser/settingsTree.ts \
           src/vs/workbench/contrib/preferences/browser/settingsEditor2.ts \
           src/vs/workbench/contrib/preferences/browser/tocTree.ts
git diff --stat -- src/vs/workbench/contrib/preferences/browser/
```
Expected: empty output (working tree == index for those files).

- [ ] **Step 3: Classify extensions in `createTocTreeForExtensionSettings`** (`settingsTree.ts`)

Change the signature's return type:
```ts
export async function createTocTreeForExtensionSettings(extensionService: IExtensionService, groups: ISettingsGroup[], filter: ITOCFilter | undefined): Promise<ITOCEntry<ISetting>[]> {
	const extGroupTree = new Map<string, ITOCEntry<ISetting>>();
	// Null IDE: which TOC section each extension goes in (see SettingsEditor2.onConfigUpdate)
	const extSection = new Map<string, string>();
```

In `processGroupEntry`, directly after `const extensionName = ...;`, add:
```ts
		extSection.set(extensionId, extensionId.toLowerCase().startsWith('null.') ? 'null' : extension?.isBuiltin ? 'builtinExtensions' : 'extensions');
```
(Null's extensions are bundled as built-ins, so the `null.` check must come first. An unresolvable extension — `extension` undefined — lands in `extensions`, as today.)

Replace the tail of the function — from `// Sort the outermost settings.` to the end of the `.then` callback — with:
```ts
		// Sort the outermost settings.
		extGroups.sort((a, b) => a.label.localeCompare(b.label));

		const sections = [
			{ id: 'null', label: localize('nullExtensions', "Null") },
			{ id: 'extensions', label: localize('installedExtensions', "Installed Extensions") },
			{ id: 'builtinExtensions', label: localize('builtinExtensions', "Built-in Extensions") },
		];
		return sections
			.map(section => ({ ...section, children: extGroups.filter(entry => extSection.get(entry.id) === section.id) }))
			.filter(section => section.children.length > 0);
	});
}
```
Every entry in `extGroups` has `id === extensionId` (all three push branches use `extensionRootEntry.id`), so the lookup is exact.

- [ ] **Step 4: Place the sections in `onConfigUpdate`** (`settingsEditor2.ts`)

Replace:
```ts
		resolvedSettingsRoot.children!.push(await createTocTreeForExtensionSettings(this.extensionService, extensionSettingsGroups, filter));

		resolvedSettingsRoot.children!.unshift(getCommonlyUsedData(groups));
```
with:
```ts
		// Null IDE: Null + Installed Extensions go right after Commonly Used, Built-in Extensions last.
		const extSections = await createTocTreeForExtensionSettings(this.extensionService, extensionSettingsGroups, filter);
		const builtinSection = extSections.find(section => section.id === 'builtinExtensions');
		resolvedSettingsRoot.children!.unshift(...extSections.filter(section => section !== builtinSection));
		if (builtinSection) {
			resolvedSettingsRoot.children!.push(builtinSection);
		}

		resolvedSettingsRoot.children!.unshift(getCommonlyUsedData(groups));
```
Resulting root order: Commonly Used, Null, Installed Extensions, core categories, Built-in Extensions.

- [ ] **Step 5: Expand the Null section by default** (`tocTree.ts`, `createTOCIterator`)

The TOC tree is created with `collapseByDefault: true`. Change:
```ts
			collapsed: undefined,
```
to:
```ts
			collapsed: g.id === 'null' ? false : undefined, // Null IDE: keep the Null section open
```

- [ ] **Step 6: Type-check**

```bash
cd D:/Coding/Apps/null-ide/vscode-src
NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck-client > /tmp/tc-after.txt 2>&1; grep -c "error TS" /tmp/tc-after.txt
grep "preferences/browser" /tmp/tc-after.txt
```
Expected: same count as Step 1, and no lines mentioning `preferences/browser`.

- [ ] **Step 7: Export the patch and verify it**

```bash
cd D:/Coding/Apps/null-ide/vscode-src
{ printf 'Subject: [PATCH] feat(settings): split the Extensions TOC node into Null / Installed / Built-in\n\nIssue #108. See docs/specs/settings-editor-design.md.\n---\n'; \
  git diff -- src/vs/workbench/contrib/preferences/browser/; } > ../patches/006-settings-toc-split-extensions.patch
git diff --stat -- src/vs/workbench/contrib/preferences/browser/
git apply --check --reverse --ignore-whitespace ../patches/006-settings-toc-split-extensions.patch && echo REVERSE-OK
```
Expected: diffstat lists exactly `settingsEditor2.ts`, `settingsTree.ts`, `tocTree.ts` (~40 lines total, **no** `FONT` import hunk in `tocTree.ts` — that's VSCodium's), then `REVERSE-OK`.

- [ ] **Step 8: Rename the wooting-analog publisher and document the patch**

`extensions/wooting-analog/package.json`:
```json
  "publisher": "null",
```
`CLAUDE.md`, Patches list — add after the `004-null-dashboard-help-welcome.patch` line:
```markdown
- `006-settings-toc-split-extensions.patch` — splits the Settings editor's Extensions node into Null / Installed Extensions / Built-in Extensions sections
```
Check nothing else refers to the old id:
```bash
cd D:/Coding/Apps/null-ide && git grep -n "you\.wooting-analog" -- ':!vscode-src' ':!vscodium-src' ':!VSCode-win32-x64'
```
Expected: no output.

- [ ] **Step 9: Visual check in a built app (ask first)**

The TOC change only exists in a full build. Ask the user: "Run `scripts/build-local.ps1` now (tens of minutes), or verify on the next CI build?" If they choose local, run it, launch the built `null.exe`, open Settings (`Ctrl+,`) and check:
- TOC order: Commonly Used, **Null** (expanded: Actions, C++, Format, Tools, Wooting Analog), Installed Extensions, Text Editor … Security, Built-in Extensions (collapsed).
- Clicking **Format** lists only Null Format settings; titles read "Prettier: Enable" (no `Null-format ›` prefix).
- Search `font`: the TOC shows only sections with matches — no empty Null/Installed header.
- Workspace tab: the sections render; no errors in Help → Toggle Developer Tools → Console.

If they choose CI, record this checklist in the commit body so it's done on the next release build.

- [ ] **Step 10: Commit**

```bash
cd D:/Coding/Apps/null-ide
git add patches/006-settings-toc-split-extensions.patch extensions/wooting-analog/package.json CLAUDE.md
git commit -m "feat(settings): split Settings TOC Extensions into Null / Installed / Built-in (#108)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: "Null Compact" styling in custom.css

**Files:**
- Modify: `workbench/custom.css` — insert a new section immediately before `/* ── Empty editor letterpress — ambient breathing pulse ──…` (currently line 378).

**Interfaces:**
- Consumes: nothing (works with or without Task 1).
- Produces: nothing other tasks depend on.

Why `!important`: the search field's border/background are set as inline styles by `SuggestEnabledInput`, and list selection colors come from an ID-scoped injected stylesheet — both beat plain selectors. This matches the rest of `custom.css`. Row heights are measured from the DOM (`CachedListVirtualDelegate`), so padding/font changes don't break scrolling.

- [ ] **Step 1: Add the section**

```css
/* ── Settings editor — "Null Compact" (#108) ────────────────────────────────
   Theme variables only, so Light/OLED/Retro restyle too.
   See docs/specs/settings-editor-design.md. */
.settings-editor {
  font-size: 12px;
}

/* Search field — rounded like the command palette filter */
.settings-editor > .settings-header > .search-container > .suggest-input-container {
  border-radius: 6px !important;
  border-color: var(--vscode-widget-border, var(--vscode-input-border, transparent)) !important;
}

/* Header: drop the full-width underline; the segmented switch separates it */
.settings-editor > .settings-header > .settings-header-controls {
  border-bottom: none !important;
  margin-top: 8px !important;
  padding-bottom: 8px;
}

/* User / Workspace / Folder — segmented control instead of underlined tabs */
.settings-editor .settings-tabs-widget > .monaco-action-bar .action-item .action-label {
  font-size: 12px !important;
  padding: 3px 10px !important;
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)) !important;
  color: var(--vscode-descriptionForeground) !important;
}
.settings-editor .settings-tabs-widget > .monaco-action-bar .action-item:not(:first-child) .action-label {
  border-left: none !important;
}
.settings-editor .settings-tabs-widget > .monaco-action-bar .action-item:first-child .action-label {
  border-radius: 4px 0 0 4px;
}
.settings-editor .settings-tabs-widget > .monaco-action-bar .action-item:last-child .action-label {
  border-radius: 0 4px 4px 0;
}
.settings-editor .settings-tabs-widget > .monaco-action-bar .action-item .action-label.checked {
  background: var(--vscode-button-secondaryBackground) !important;
  color: var(--vscode-foreground) !important;
}

/* TOC — 12px, soft selection with an accent edge */
.settings-editor > .settings-body .settings-toc-container .monaco-list-row {
  font-size: 12px;
}
.settings-editor > .settings-body .settings-toc-container .monaco-list-row.selected {
  background-color: var(--vscode-list-hoverBackground) !important;
  box-shadow: inset 2px 0 0 var(--vscode-focusBorder);
}
.settings-editor > .settings-body .settings-toc-container .monaco-list-row.selected .settings-toc-entry {
  font-weight: 600 !important;
}

/* Group headings — 13 / 12 / 12px instead of 26 / 22 / 18px */
.settings-editor > .settings-body .settings-tree-container .settings-group-title-label.settings-group-level-1 {
  font-size: 13px !important;
  padding: 14px 12px 6px !important;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.settings-editor > .settings-body .settings-tree-container .settings-group-title-label.settings-group-level-2,
.settings-editor > .settings-body .settings-tree-container .settings-group-title-label.settings-group-level-3 {
  font-size: 12px !important;
  padding: 12px 12px 4px !important;
}

/* Setting rows — denser, 1px dividers, secondary-colored descriptions */
.settings-editor > .settings-body .settings-tree-container .setting-item-contents {
  padding: 8px 12px 10px !important;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.settings-editor > .settings-body .settings-tree-container .setting-item-contents .setting-item-description {
  color: var(--vscode-descriptionForeground) !important;
}

/* Focused row: keep the background fill, drop the outline box.
   Controls inside the row keep their own focusBorder outline. */
.settings-editor > .settings-body .settings-tree-container .monaco-list:focus-within .monaco-list-row.focused .setting-item-contents {
  outline: none !important;
}

/* Modified indicator — accent color, offsets matched to the new padding */
.settings-editor > .settings-body .settings-tree-container .setting-item-contents.is-configured .setting-item-modified-indicator {
  border-color: var(--vscode-focusBorder) !important;
  left: 2px !important;
  top: 10px !important;
  bottom: 10px !important;
}
```

- [ ] **Step 2: Check the section uses no hard-coded colors**

```bash
cd D:/Coding/Apps/null-ide
sed -n '/Settings editor — "Null Compact"/,/Empty editor letterpress/p' workbench/custom.css | grep -nE ':\s*#[0-9a-fA-F]{3,8}\b|rgba?\('
```
Expected: no output (every color in the new section is a `var(--vscode-*)`).

- [ ] **Step 3: Sync into the installed Null IDE**

```powershell
cd D:\Coding\Apps\null-ide\scripts; .\sync-local.ps1
```
Expected: the script reports copying `null-custom.css`. Then in the installed Null IDE run **Developer: Reload Window**.

- [ ] **Step 4: Visual check (Review Focus 2–5)**

Open Settings (`Ctrl+,`) and check each, in **Null Dark** then **Null Light** (and a quick look in Retro):
- Header: search field has rounded corners; User/Workspace is a joined segmented control, checked segment filled; no full-width underline.
- TOC: 12px; the selected entry has a soft fill and a 2px accent left edge.
- Group headings are small (13/12px); rows are denser with 1px dividers; descriptions in secondary color.
- Change any checkbox setting: the modified bar is the accent color and sits within the row.
- Keyboard: click the list, press ↓ a few times — the focused row has a visible background; Tab into a text input/checkbox — it shows a focus ring.
- Search `tab size` with results, then the Workspace tab: nothing clipped or overlapping.
- Narrow the editor below ~600px: the TOC hides, rows reflow without horizontal overflow.

Fix any failure in `custom.css`, re-sync, re-check.

- [ ] **Step 5: Commit**

```bash
cd D:/Coding/Apps/null-ide
git add workbench/custom.css
git commit -m "style(settings): Null Compact restyle of the Settings editor (#108)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

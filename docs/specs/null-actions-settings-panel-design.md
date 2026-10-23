# Null Actions Settings Panel — Design

Follow-up to [`null-actions-design.md`](null-actions-design.md). Reworks the settings webview (`extensions/null-actions/src/settingsPanel.ts`).

## Problem

The panel is 438 lines of HTML, CSS and client script built as TypeScript string concatenation. It has no type checking on the client side and no tests, and it has real defects:

1. **Up/Down do not reorder the status bar.** They swap array entries, but placement is decided by each button's `priority` (higher = further left). With distinct priorities nothing moves.
2. **Unsaved edits are lost silently.** Any `null-actions` settings change re-sends the whole state and overwrites the draft; closing the tab discards it; nothing shows the draft is dirty.
3. **Field values are not escaped.** Only `"` is replaced, and only for Label and Command. Tooltip, Cwd, Icon, Color and Problem matcher are not escaped, so a value containing `"` truncates the field.
4. **Save errors are unactionable.** "Add Button" creates an empty command; saving shows `null-actions.buttons[2] (id=button-1729…): missing required string field "command"` in a status chip with no field highlighted.
5. **A suggestion can be added twice** (it stays listed), producing a duplicate id that then fails to save.
6. **Delete has no undo.**
7. **Suggestions and "Load npm scripts" use `workspaceFolders[0]`**, wrong in a multi-root workspace.

## Scope

In scope: fix 1–7 and move the client script, styles and message types out of string literals into compiled, typed, partly unit-tested source.

Out of scope: Duplicate, search, import/export; changing the args format (stays comma-split, so an argument cannot contain a comma); any change to `null-actions.buttons` schema or to how buttons run.

## Architecture

Follow the `null-music` pattern (see `extensions/null-music/CLAUDE.md`): vanilla TypeScript with `module: none` and no imports, compiled by `tsc` into one global-scope bundle. No new dependency and no new CI step beyond what `npm run compile` already runs.

```
extensions/null-actions/
├── src/
│   ├── settingsPanel.ts            — HTML shell (links lib/settings.css, lib/colorPicker.js, lib/settings.js) + message handling
│   ├── workspaceFolder.ts          — activeWorkspaceFolder(): active file's folder, else first folder (shared with runButton.ts)
│   └── webview/
│       ├── colorPicker.ts          — unchanged, still its own script
│       └── settings/
│           ├── protocol.ts         — HostToWebview / WebviewToHost unions (host pulls them in via triple-slash reference)
│           ├── model.ts            — pure logic (below)
│           ├── dom.ts              — escapeAttr / escapeHtml, small element helpers
│           └── main.ts             — render, event wiring, dirty/undo/banner state
├── lib/
│   ├── colorPicker.js              — tracked, compiled
│   ├── settings.js                 — tracked, compiled from src/webview/settings/*.ts
│   └── settings.css                — tracked, hand-written (the only hand-edited file in lib/)
├── tsconfig.webview-settings.json        — protocol, dom, model, main -> lib/settings.js
└── tsconfig.webview-settings-shared.json — protocol, dom, model -> out/webview-settings-shared.js (for node --test via vm)
```

`package.json` `compile` gains the two projects; `test` lists the new test files. CSP changes from `style-src 'nonce-…'` to `style-src ${cspSource}` so the stylesheet can be linked; inline `<style>` is removed. `localResourceRoots` stays `lib`.

## Pure model (`model.ts`, unit-tested)

Top-level `function` declarations only (required by the `vm` loading pattern).

- `sortByPriority(buttons)` — stable sort, priority descending. This is the order the panel shows, matching the status bar.
- `moveButton(buttons, index, direction)` — returns a new list. Swaps the `priority` of the two neighbours. If the two priorities are equal, or any priorities in the list tie, the whole list is renumbered (`n-1 … 0`, preserving current order) before the swap, so the move always has a visible effect. Untouched buttons keep their priority when there are no ties.
- `addSuggestion(buttons, suggestion)` — no-op if a button with that id exists; otherwise appends with the defaults currently used by the panel.
- `visibleSuggestions(buttons, suggestions)` — suggestions whose id is not already a button.
- `newButton(buttons)` — a button with an id guaranteed unique in the list.
- `validate(buttons)` — `{ index, field, message }[]` for empty `label` / `command` and duplicate `id`.
- `isDirty(draft, saved)` — structural comparison against the last saved snapshot.
- `escapeAttr(s)` / `escapeHtml(s)` in `dom.ts` — escape `& < > " '`.

## Behaviour

- **Rendering.** Every attribute value goes through `escapeAttr`. Appearance of cards, fields, color picker, icon datalist, Browse and Load npm scripts is unchanged.
- **Reordering.** Up/Down call `moveButton`; the list is shown sorted by priority. The Priority field remains as an advanced input.
- **Validation.** Save runs `validate` first. Failing fields get an `invalid` class and `aria-invalid`, the first failing card is expanded and scrolled into view, and the status text reads e.g. "2 buttons need a command". Nothing is sent to the host. The host's `parseButtonConfigs` stays authoritative; its errors still appear in the status text if they occur.
- **Dirty state.** The draft is compared with the saved snapshot on every change. When dirty: the Save button shows a marker and the panel title is `Action Buttons ●` (host sets it on a `dirty` message). Closing still discards edits; VS Code cannot veto closing a webview, so the marker is the mitigation.
- **External change while dirty.** `refreshIfOpen` still posts state. If the webview is dirty it does not apply it; it shows a banner "Settings changed outside this panel" with **Reload** (apply the incoming state, drop the draft) and **Keep mine**. If not dirty it applies the state as today. A save the panel itself made is recognised (the incoming state equals what was just saved) and never raises the banner.
- **Suggestions.** Listed via `visibleSuggestions`, so an added suggestion disappears.
- **Delete / undo.** Delete removes the card and shows "Deleted <label> — Undo" in the status area; Undo restores the card at its old position. One level; replaced by the next delete.
- **Folder.** Suggestions and Load npm scripts use `activeWorkspaceFolder()`. `buildVariableContext` in `runButton.ts` switches to the same helper.

## Testing

- `model.test.ts` and `dom.test.ts`, loading `out/webview-settings-shared.js` through `vm` like null-music's `webviewModel.test.ts`. Cases: ordering with distinct priorities, with ties, at the list ends; suggestion de-duplication; unique new ids; each validation rule; dirty comparison; escaping of every special character.
- DOM behaviour (dirty marker, banner, undo, invalid highlighting) has no automated test; verify with `/verify-local null-actions` plus `scripts/reload-local.ps1` and walk through each finding 1–7. The existing integration specs must still pass.
- `npm test` and `npm run compile` in `extensions/null-actions`; commit the refreshed `out/` and `lib/` as `chore: refresh null-actions compiled output`.

## Docs

Update `extensions/null-actions/CLAUDE.md` (panel structure, the `lib/settings.css` hand-edit exception, the shared-bundle test pattern) and the file list in `tsconfig.json`.

## Risks

- `module: none` means no `import`; anything shared between the shared and full webview projects must be a top-level function in a file listed in both tsconfigs.
- The CSP change must be verified in a real window; a mistake renders an unstyled panel.
- Priority renumbering rewrites several `priority` values in `settings.json` the first time ties are broken. This is deliberate and only happens when a move would otherwise do nothing.

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
8. **Invalid entries vanish on Save.** `readButtonConfigs` drops entries the host rejects (missing `command`, duplicate id) and returns them only as `errors`. The panel never sees them, so Save All rewrites `null-actions.buttons` without them, silently.

## Scope

In scope: fix 1–8 and move the client script, styles and message types out of string literals into compiled, typed, partly unit-tested source.

Out of scope: Duplicate, search, import/export; preserving the raw JSON of ignored entries; changing the args format (stays comma-split, so an argument cannot contain a comma); any change to `null-actions.buttons` schema or to how buttons run.

## Architecture

Follow the `null-music` pattern (see `extensions/null-music/CLAUDE.md`): vanilla TypeScript with `module: none` and no imports, compiled by `tsc` into one global-scope bundle. No new dependency and no new CI step beyond what `npm run compile` already runs.

```
extensions/null-actions/
├── src/
│   ├── settingsPanel.ts            — HTML shell (links lib/settings.css, lib/colorPicker.js, lib/settings.js) + message handling
│   ├── workspaceFolder.ts          — activeWorkspaceFolder() and the last-active-editor tracker (shared with runButton.ts)
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

**No inline `style=` attributes.** A CSP `style-src` without `'unsafe-inline'` blocks style attributes set through `innerHTML`, with or without a nonce (the current `style="background:…"` on the swatch and `style="display:…"` on the Args row are affected). `main.ts` shows and hides with classes or `hidden`, and sets the swatch colour through CSSOM (`el.style.background = …`) after insertion.

**Addressing.** Messages identify a button by `id`, never by list index: the list is sorted and can re-sort, and Browse is async. DOM `data-index` may stay for click handlers, which resolve synchronously. A reply for an id that no longer exists (deleted meanwhile) is dropped.

## Pure model (`model.ts`, unit-tested)

Top-level `function` declarations only (required by the `vm` loading pattern).

- `sortByPriority(buttons)` — stable sort, priority descending. This is the order the panel shows, matching the status bar.
- `moveButton(buttons, index, direction)` — returns a new list. Swaps the `priority` of the two neighbours. If the two priorities are equal, or any priorities in the list tie, the whole list is renumbered **downward from 0** (`0, -1, … -(n-1)`, preserving current order) before the swap, so the move always has a visible effect. Renumbering stays at or below 0 because the `$(gear)` status bar item sits at priority 1 and must remain leftmost; `n-1 … 0` would put buttons ahead of it. Untouched buttons keep their priority when there are no ties.
- `nextPriority(buttons)` — `min(priorities) - 1`, or `0` for an empty list. New buttons, accepted suggestions and loaded npm scripts (`nextPriority - i`) use it, so they always land last in the panel and the status bar (no tie with an existing button, notably the npm loader's `0, -1, -2`).
- `addSuggestion(buttons, suggestion)` — no-op if a button with that id exists; otherwise appends with the panel's current defaults and `nextPriority`.
- `visibleSuggestions(buttons, suggestions)` — suggestions whose id is not already a button.
- `newButton(buttons)` — a button with an id guaranteed unique in the list and `nextPriority`.
- `validate(buttons)` — `{ index, field, message }[]`. Mirrors the host: `label` and `command` are invalid when empty after trim; duplicate `id` is reported on the later card only.
- `normalize(buttons)` — applies the defaults `parseButtonConfigs` applies (`args` empty -> undefined, numeric `priority`, trimmed `problemMatcher`, `onBusy`/`background`/`focus`/`saveAll` defaults) so representation differences never count as edits.
- `isDirty(draft, saved)` — structural comparison of `normalize(draft)` against `normalize(saved)`.
- `escapeAttr(s)` / `escapeHtml(s)` in `dom.ts` — escape `& < > " '`.

## Behaviour

- **Rendering.** Every attribute value goes through `escapeAttr` and is quoted. Appearance of cards, fields, color picker, icon datalist, Browse and Load npm scripts is unchanged.
- **Reordering.** Up/Down call `moveButton`; the list is shown sorted by priority. The Priority field remains as an advanced input. The list re-sorts on the field's `change` event (blur / Enter), never on `input`, so a card does not jump while the user types. A moved card keeps its expanded state and the focus moves with it (Up/Down button of the card, scrolled into view).
- **Validation.** Save runs `validate` first. Each failing field gets an `invalid` class, `aria-invalid` and an inline message under it ("Command is required"); the first failing card is expanded and scrolled into view; the status chip carries only a summary ("2 buttons need fixing"). A field's mark clears on its next `input`. Nothing is sent to the host. The host's `parseButtonConfigs` stays authoritative; its errors still appear in the status text if they occur.
- **Ignored entries.** `init` carries the `errors` from `readButtonConfigs`. When non-empty the panel shows a banner "N entries in settings were ignored and will be removed when you save" listing the messages. The raw entries are not preserved.
- **Dirty state.** The saved snapshot is `sortByPriority(init buttons)`; the draft is compared with it via `isDirty` on every change, so opening the panel is never dirty (settings.json order differs from display order, and `normalize` absorbs default/representation differences). When dirty: the Save button shows a marker and the panel title is `Action Buttons ●` (host sets it on a `dirty` message). A move followed by its reverse is not dirty. Closing still discards edits; VS Code cannot veto closing a webview, so the marker is the mitigation.
- **Own save.** The host replies `saved` with the canonical buttons it wrote (the `parseButtonConfigs` output). The webview adopts them as the new snapshot and leaves the draft untouched, so edits made between pressing Save and the reply stay dirty.
- **External change while dirty.** `refreshIfOpen` still posts state. The webview ignores an incoming state that `normalize`-equals the snapshot (this covers the panel's own save and any unrelated `null-actions` setting). Otherwise: if the draft is not dirty it applies the state; if dirty it shows a banner "Settings changed outside this panel" with **Reload** (apply the incoming state, drop the draft, clear Undo) and **Keep mine**. Keep mine dismisses the banner and makes the incoming state the snapshot, so the dirty marker reflects the difference from what is on disk; the next Save overwrites the external change on purpose, and a further external change raises the banner again.
- **Suggestions.** Listed via `visibleSuggestions`, so an added suggestion disappears.
- **Delete / undo.** Delete removes the card and shows "Deleted <label> — Undo" in its own element next to the status chip. Undo restores the card (priority intact, so it returns to its sorted position). One level, no timer; replaced by the next delete and cleared on Save and on Reload. Saved/error messages show in the status chip and never replace the Undo element.
- **Folder.** Suggestions and Load npm scripts use `activeWorkspaceFolder()`. A focused webview has no `activeTextEditor`, so `workspaceFolder.ts` also tracks the folder of the last active text editor (`onDidChangeActiveTextEditor`) and resolves `activeTextEditor ?? lastSeen ?? workspaceFolders[0]`. `buildVariableContext` in `runButton.ts` uses the same helper. No folder picker in the panel.
- **Load npm scripts.** Reads `package.json` in that folder; the "not found" message names the folder. Skips ids already present; new buttons use `nextPriority - i`.

## Testing

- `model.test.ts` and `dom.test.ts`, loading `out/webview-settings-shared.js` through `vm` like null-music's `webviewModel.test.ts`. Cases: ordering with distinct priorities, with ties, at the list ends; renumbering never exceeds 0; `nextPriority`; suggestion de-duplication; unique new ids; each validation rule including whitespace-only values; `isDirty(x, x)` false for a freshly loaded list, move-then-reverse not dirty; escaping of every special character.
- DOM behaviour (dirty marker, banner, undo, invalid highlighting, folder tracker) has no automated test; verify with `/verify-local null-actions` plus `scripts/reload-local.ps1` and walk through each finding 1–8. The existing integration specs must still pass (only `activation.spec.ts` touches the panel, by checking the command is registered).
- `npm test` and `npm run compile` in `extensions/null-actions`; commit the refreshed `out/` and `lib/` as `chore: refresh null-actions compiled output`.

## Delivery

Staged so each step is reviewable and bisectable, each followed by its own compiled-output refresh commit:

1. `workspaceFolder.ts` with the tracker, used by `runButton.ts` and the panel (fix 7).
2. Extract the panel into `webview/settings/*`, `lib/settings.css` and the CSP change; behaviour unchanged except escaping (fix 3) and no inline `style=`. Check in a real window that the panel is styled and functional before continuing.
3. Model changes: ordering (fix 1), suggestion de-dup (fix 5), validation (fix 4), ignored-entries banner (fix 8).
4. Dirty state, external-change banner and undo (fixes 2 and 6), then the docs below.

## Docs

Update `extensions/null-actions/CLAUDE.md` (panel structure, the `lib/settings.css` hand-edit exception, the shared-bundle test pattern) and the file list in `tsconfig.json`.

## Risks

- `module: none` means no `import`; anything shared between the shared and full webview projects must be a top-level function in a file listed in both tsconfigs.
- The CSP change must be verified in a real window; a mistake renders an unstyled panel. The Args row and swatch may already be mis-rendered today because of inline `style=` attributes; check both before and after.
- Priority renumbering rewrites several `priority` values in `settings.json` the first time ties are broken. This is deliberate and only happens when a move would otherwise do nothing.
- The last-active-editor tracker depends on `onDidChangeActiveTextEditor` behaviour in a real multi-root window and cannot be unit-tested.

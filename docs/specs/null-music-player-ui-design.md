# Null Music — Player UI (Sub-project B) — Design

Status: approved in brainstorming; awaiting spec review.
Part 2 of 3: [A](null-music-engine-design.md) engine & library → **B** player UI → C IDE integration.
**Depends on A.** B ships after A: it consumes A's track tags, cover art, queue and scan progress.

## Problem

The current webview (`src/ui/musicHtml.ts`, ~1,970 lines) works but is hard to live with:

1. **One giant template string.** HTML, CSS and a ~800-line script live in a single TypeScript string:
   no type checking inside the script, no way to unit-test UI logic, every edit is painful.
2. **Hard-coded palette** (`#181818`, `#0078D4`, …) instead of `--vscode-*` variables, so light and
   high-contrast themes look wrong and the player ignores the user's theme.
3. **String-concatenated `innerHTML`** with unescaped attributes
   (`data-track-uri="' + t.uri + '"`): a file name containing a quote breaks the row and is an
   injection vector.
4. **Flat information architecture.** Tracks / Playlists / Folders / Favorites: no queue view, no album
   or artist browsing, and Folders (a setup concern) takes a tab that browsing should have.
5. **Visual roughness**: emoji empty states (📋📁), no cover art, no loading or error states beyond a banner.
6. **`any`-typed messages** between host and webview.

## Goals

- A cover-forward player that looks native to Null IDE in any theme.
- Queue view, album and artist browsing, search with ranking, native context menus.
- Real empty, loading and error states; keyboard and screen-reader support.
- A maintainable, testable code structure with no new dependency.

## Non-goals

- Engine, tags, queue logic, persistence — that is [A](null-music-engine-design.md).
- Quick-pick, media keys, mini-player in the editor area — sub-project C.
- Wide or panel layouts (the player is designed for the narrow primary sidebar), lyrics, visualizer,
  equalizer.

## Decisions

| Question | Decision | Rejected |
|---|---|---|
| Where does it live? | Narrow primary sidebar (~250–350 px). Single column; wide layouts are not a requirement. | Responsive wide/panel compositions (more layout work for a case the user doesn't use). |
| Now-playing layout | **Always cover-forward**: large square art, title, scrubber, controls on top; list beneath. Art height is capped so the list stays usable (see Layout). | Compact strip that expands on click (recommended by the author, not chosen); bottom-pinned mini-player. |
| Navigation | **Queue / Library / Playlists** tabs. Library has Tracks / Albums / Artists plus a Liked filter. Folders and import move to a header menu. | Five icon-only tabs; one scrolling library plus queue drawer. |
| Webview stack | **Vanilla TS in real files**, compiled per the `null-tools` pattern. | Preact/Lit (new dependency + bundling + CI step); tidying the template string. |

## Structure

Follows the existing `null-tools` webview pattern: `module: none` + `outFile` per webview, compiled
output (`lib/`) tracked in git, pure modules also compiled by a shared tsconfig so `node --test` can
import them.

```
src/webview/music/   protocol.ts   shared host<->webview message types
                     model.ts      pure: sort/filter/group albums & artists, search ranking + highlight
                     dom.ts        pure: escape + h(tag, attrs, children)
                     player.ts  queueView.ts  libraryView.ts  playlistsView.ts
                     main.ts       wiring + message loop
lib/music.js  lib/music.css        compiled / hand-written; loaded via asWebviewUri
src/ui/musicHtml.ts                shrinks to a ~30-line shell: CSP, nonce, <link>, <script>
tsconfig.webview-music.json        module none, outFile lib/music.js (file order matters: no imports)
tsconfig.webview-shared.json       lists model.ts + dom.ts so out/ tests can import them
```

Because `module: none` concatenates files in `include` order into one global scope, there are no
`import`s in webview files: list `protocol.ts`, `dom.ts`, `model.ts` first, then views, then `main.ts`.
Testable logic must live in plain functions in `model.ts` / `dom.ts`, never inside DOM-bound code.

### Protocol

One typed `protocol.ts` with `HostToWebview` and `WebviewToHost` discriminated unions replacing the
current `any` messages. Host to webview carries snapshots: `player` (state), `queue`, `library`, `scan`
(progress), `unavailable` (track ids skipped by A). Webview to host carries intents: transport
(`playPause`, `next`, `previous`, `seek`, `setVolume`, `toggleShuffle`, `toggleRepeat`), library
(`playList { kind, id, index }`, `toggleLike`), queue (`playNext`, `add`, `remove`, `move`, `clear`,
`jump`), and setup (`addFolder`, `importPlaylist`, `removeFolder`, `rescan`). Both sides compile against
the same file, so a renamed message is a compile error. Audio-element messages (`localAudio*`) are
unchanged from A and stay in the same union.

### Rendering

A small `h(tag, attrs, children)` helper builds DOM with `textContent` / `setAttribute` — never
`innerHTML` with data — which closes the attribute-injection hole. Lists use event delegation. No
framework; the strict CSP (nonce'd script, `lib/` loaded via `asWebviewUri`) is kept.

### Theming

All colours become `--vscode-*` variables with a few Null tokens layered on top (for example
`--np-accent: var(--vscode-focusBorder)`). Null Dark is the default; light and high-contrast themes
must work. Inline SVG icons (codicon style) replace the emoji empty states.

## Layout

```
+----------------------+
| ∅ Music   [scan]  ⋯  |   header: scan pill, search (/), menu
+----------------------+
|     [ cover art ]    |   centred square, height <= min(100% width, 35vh)
| Title            <3  |   artist / album are links into Library
| Artist · Album       |
| ----o-------   2:10  |   scrubber: role=slider, arrows seek ±5 s
|  shuf <<  ||  >> rep |
|  vol [-----------]   |
+----------------------+
| Queue  Library  Lists|
| ...list...           |
+----------------------+
```

- The art is capped at about `min(100% width, 35vh)` so a short window still shows several list rows.
  *(Author's proposal — confirm at spec review.)*
- Without art: placeholder with the ∅ mark over a colour derived from the album name.
- The ±10 s rewind/forward buttons are **dropped** (five transport controls fit a 300 px column; seven
  don't). Arrow keys on the scrubber cover the need. *(Author's proposal — confirm at spec review.)*
- Clicking the artist or album text jumps to that detail view in Library.

## Views

### Header
`∅ Music`, a scan-progress pill ("Scanning 212/640") while A reports a scan, a search field (`/` focuses
it), and a `⋯` menu: Add folder, Import playlist, Manage folders, Rescan. *Manage folders* is a
sub-view listing folders with track counts and remove buttons (replaces the old Folders tab).

### Queue tab
Sections: *Now playing*, *Next up (N)*, *History* (collapsed by default). Rows: 32 px art thumbnail,
title and artist, duration, hover `×` to remove. Reorder by drag, or `Alt+↑/↓` from the keyboard.
*Clear queue* button; clicking a row jumps to it; native context menu per row. Index arithmetic for
move/remove lives in A's `Queue`; the view only sends intents.

### Library tab
A segmented switch **Tracks / Albums / Artists** plus a **Liked** filter chip applying to the active
segment.
- *Tracks*: flat list, sort selector (Title, Artist, Album, Duration).
- *Albums*: two-column grid of cover cards → album detail (art, name, artist, year, Play and Shuffle,
  tracks ordered by disc then track number).
- *Artists*: rows with avatar (first album's art, else generated placeholder) and album count → artist
  detail (albums grid + all tracks).
- A back arrow returns from any detail view and restores scroll position.

### Playlists tab
List of imported playlists (name, track count) → detail using the **same component as album detail**:
one piece of code, two data sources.

### Playing from a list
Clicking a row replaces the queue with that list and starts at the clicked track (current behaviour,
now explicit). *Play next* and *Add to queue* come from the context menu.

### Search
The query filters the active view (Queue, the active Library segment, or an open playlist). Ranking in
`model.ts`: prefix match, then word-start, then substring; matches are highlighted. An empty result
shows its own state with a *Clear search* action.

### Context menus
Native, via the `webview/context` menu contribution: rows carry
`data-vscode-context='{"webviewSection":"track","uri":"…"}'` and the manifest contributes
`menus["webview/context"]` entries. Commands: `null-music.track.playNext`, `.addToQueue`, `.favorite`,
`.reveal` (Reveal in Explorer); they receive the row's context payload. No custom menu code.

### Keyboard
Roving tabindex in lists (`↑/↓` move, `Enter` plays); `Space` toggles play/pause when focus isn't in an
input (existing behaviour); `/` focuses search; `Esc` clears search or goes back; `Alt+↑/↓` reorders in
the queue.

## States

| State | Behaviour |
|---|---|
| No library yet | Centred SVG mark, "Add a music folder", Add folder / Import playlist buttons |
| Scanning | Header progress pill; rows fill in progressively; first run shows skeleton rows |
| Scan found nothing | "No audio files found in <folder>" + the supported extensions |
| Nothing playing | Placeholder art, "Nothing playing"; play disabled with tooltip if the queue is empty |
| Waiting for host | Skeleton player until the first `player` snapshot arrives |
| Track unavailable | Row dimmed with a warning icon + tooltip after A skips it; dismissible banner for repeated failures |
| Autoplay blocked | Existing "click anywhere to play" banner stays |
| No cover art | Generated placeholder (see Layout) |

## Accessibility

- Every icon button has an `aria-label`; toggles use `aria-pressed`.
- Focus rings use `--vscode-focusBorder` with `:focus-visible`; hit targets are at least 24 px.
- A polite `aria-live` region announces the track on change.
- `prefers-reduced-motion` disables the equalizer animation and the art cross-fade.
- High-contrast themes get outline borders on cards and controls.

## Testing

`node --test` over compiled `out/test/*.test.js`. **Every new test file must be added to `package.json`'s
`test` script** or it is silently skipped.

- `model.test`: sort, filter, album/artist grouping, disc and track ordering, search ranking and highlight.
- `dom.test`: `h()` escapes text and attributes. Regression: a track named `"><img onerror=…>` renders as
  inert text and produces exactly one element.
- Existing `musicHtml` / `musicViewProvider` tests are rewritten for the new shell and protocol.
- Manual pass via `/verify-local` at ~250 px and ~350 px widths, in light, dark and high-contrast themes,
  covering the empty, scanning and large-library states.

## Handoff from A

B requires from A: the new `Track` fields and cover-art URLs; queue snapshots and operations (`playNext`,
`add`, `remove`, `move`, `clear`, `jump`); scan progress; "unavailable track" events. Until A is merged B
cannot be exercised end to end. Between A and B the existing webview keeps working through A's retained
`localAudio*` messages (see A, "Webview wiring").

## Delivery

- `npm run compile` refreshes both `out/` and `lib/` (both tracked); commit them separately as
  `chore: refresh null-music compiled output`.
- Delete the old `musicHtml.ts` template body and its dead CSS/JS.
- Update the null-music entry in `CLAUDE.md` (UI structure, `webview/context` commands).
- Suggested order for the plan: `protocol.ts` + `dom.ts` + `model.ts` (with tests) → shell + theming +
  player area → Queue → Library (Tracks, then Albums/Artists + detail) → Playlists → header menu,
  states and accessibility → delete the old template.

## Open items for review

- Confirm the art height cap (`min(100% width, 35vh)`).
- Confirm dropping the ±10 s buttons.
- The "playing from" label in the Queue tab is intentionally not included; A's `Queue` does not track a
  context name. Add later if wanted.

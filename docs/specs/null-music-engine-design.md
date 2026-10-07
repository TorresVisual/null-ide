# Null Music — Engine & Library (Sub-project A) — Design

Status: approved in brainstorming; awaiting spec review.
Part 1 of 3: **A** engine & library → [B](null-music-player-ui-design.md) player UI → C IDE integration.

## Problem

`null-music` is a local-file player whose basics work but whose foundations are weak:

1. **Audio only exists if the sidebar webview does.** Sound comes from an `<audio>` element in the
   webview. Keybindings, the status bar and commands do nothing until the view has been opened once.
   Worse, `LocalMusicProvider.play()` (`localProvider.ts:256`) sets `isPlayingState = true` and calls
   `audioAdapter?.resumeAudio()` even when no adapter is wired, so the status bar claims "playing"
   while nothing makes a sound.
2. **Three clocks.** The provider estimates position from `Date.now() - startTime`, the webview reports
   `timeupdate`, and `PlaybackManager` interpolates a third time on top. They drift after buffering
   or seeking.
3. **No real queue.** `play()` replaces the queue. Shuffle is `Math.random()` per `next()`: it can
   repeat a track back to back, and "previous" in shuffle jumps to a random track. There is no
   play-next or add-to-queue.
4. **Nothing persists** except folders, playlists and likes. Queue, position, volume, shuffle and
   repeat reset on every start.
5. **Metadata comes from file names.** `parseTrackMetadata` never reads tags, so `album` and
   `albumArtUrl` are effectively empty, and `Track.album` is overloaded to hold the *folder URI*
   (`localProvider.ts:244` plays a folder via `t.album === folderUri`).
6. **Every startup re-walks all folders**, with no cache.
7. **Dead abstraction.** Spotify and Lo-Fi were removed ("local only"), but `IMusicProvider`, devices,
   auth types, artist/album search types and a 2.5 s polling loop remain. `CLAUDE.md` still says to
   add new services as providers.
8. The webview's `localResourceRoots` include every drive root (`A:\`…`Z:\`).

## Goals

- One source of truth for queue and playback state, in the extension host.
- Commands and keybindings work before the sidebar has ever been opened.
- A real queue (history-aware shuffle, play next, add to queue).
- Session restore (paused) across restarts.
- Real tags and cover art for the common formats, cached, with non-blocking startup.
- Delete the dead provider layer.

## Non-goals

- UI redesign beyond keeping the current webview working — that is [B](null-music-player-ui-design.md).
- Quick-pick, media keys, mini-player — sub-project C.
- Gapless playback and crossfade (needs a second `<audio>` element and mixing; not worth it for a
  library this size — revisit after B).
- Large-library scaling (library is < 1,000 tracks): no database, no virtualization.
- Changing where audio is produced. Webview `<audio>` stays the engine.

## Decisions

| Question | Decision | Rejected alternatives |
|---|---|---|
| Where does audio play? | Webview `<audio>`, with **auto-reveal**: commands needing sound reveal the view without stealing focus and wait for `ready`. | External `mpv`/`ffplay` process (binary dependency); workbench patch hosting a headless audio element (another patch to rebase each upstream bump). |
| Tag reading | **In-house parser**, no dependency. | `music-metadata` (needs a CI `npm ci --prefix` step like null-markdown, is ESM-only). |
| Library scale | Small (< 1k): JSON cache, no DB. | — |

Caveat of the audio decision: the view must exist, so closing it stops playback.

## Architecture

The host owns all state; the webview is an output device.

```
Library       scan folders + .m3u8, read tags, JSON cache, likes     (no playback knowledge)
Queue         pure data: order, index, history, shuffle, repeat      (no I/O)
Player        owns Queue + position/volume/isPlaying; emits events   (replaces PlaybackManager polling
                                                                       and LocalMusicProvider play logic)
AudioOutput   interface: load/play/pause/seek/volume;
              events in: ready, play, pause, time, duration, ended, error
  └ WebviewAudioOutput   reveals the view if absent; buffers commands until 'ready'
SessionStore  queue ids + index + position + volume + shuffle + repeat → globalState
```

Proposed layout under `extensions/null-music/src/`:

```
library/   library.ts  tagReader.ts  libraryCache.ts  m3uParser.ts (moved)  scanner (inside library.ts)
playback/  queue.ts  player.ts  audioOutput.ts  webviewAudioOutput.ts  sessionStore.ts
ui/        (existing; rewired to Player/Library)
```

`PlaybackState` (consumed by the status bar and webview) is kept, minus `device`.
`NullMusicApi` becomes `{ player, library }`. Nothing outside the extension consumes it (verified).

### Player semantics

- **Playing means confirmed.** `isPlaying` flips true only on the `play` event from `AudioOutput`. If
  the webview cannot be revealed or never sends `ready` within 5 s, the command fails with one error
  message and the player stays paused.
- **One clock.** Position is the last `time` report plus its timestamp. The host does not integrate
  elapsed time itself. The `pollingIntervalMs` setting and the polling loop are removed; `Player`
  emits `onDidChange` instead.
- **Autoplay block.** The existing "click anywhere to play" prompt stays. The player remains in a
  pending-play state (not playing) until the `play` event arrives.
- **Skipping bad files.** On `error`, silently advance to the next queue item. Count consecutive
  skips in a status bar warning; if the whole queue fails in a row, stop and show one error.
- **Session restore.** On activation, restore queue, index, position, volume, shuffle and repeat
  **paused**. On first `ready`, load the source and seek on `loadedmetadata`. Never autoplay.

### Queue

- Holds `tracks`, `index`, `history`, `shuffle`, `repeat` (`off | track | context`).
- Shuffle is a pre-shuffled permutation of the remaining items (no immediate repeats). "Previous"
  walks `history` regardless of shuffle. Rebuilt when the queue content or the shuffle flag changes.
- Operations: `replace(tracks, startIndex)`, `playNext(track)`, `add(track)`, `remove(i)`, `move(i, j)`,
  `clear()`, `next()`, `previous()`. Each keeps `index` consistent with the item that was current.
- `previous()` restarts the current track when position > 3 s (existing behaviour, preserved).

## Library & tags

### Track shape (additive in `types.ts`)

`folder` (new — replaces the album-as-folder hack), `album` and `albumArtist` (from tags, `''` if
absent), `trackNo`, `discNo`, `year`, `artKey?` (content hash of the cover), `durationMs` (header
value, else learned on first play and written back to the cache). `name` and `artist` come from tags
and fall back to the existing filename parse (`Artist - Title`).

### Tag reader (`library/tagReader.ts`, ~250 lines, no dependencies)

Reads a bounded head of each file via `fs.open`, never the whole file.

| Format | Tags | Cover art | Duration |
|---|---|---|---|
| mp3 | ID3v2.2 / 2.3 / 2.4 (TIT2, TPE1, TPE2, TALB, TRCK, TPOS, TDRC, APIC) | APIC | learned on play |
| flac | `VORBIS_COMMENT` block | `PICTURE` block | `STREAMINFO`, exact |
| ogg / opus | comment header | `METADATA_BLOCK_PICTURE` (base64) | learned on play |
| m4a | `moov/udta/meta/ilst` | `covr` | `mvhd`, exact |
| wav, aac, other | filename fallback | none | learned on play |

A malformed tag never throws out of the reader: it returns what it parsed, and the filename fallback
fills gaps. Embedded art is capped at 16 MB per file (`// ponytail: 16 MB art cap` — raise only if a
real library needs it).

### Cache and scanning

- `globalStorageUri/library-cache.json`: `{ version, entries: { path: { mtime, size, tags } } }`.
  Reuse an entry when mtime and size match; read new or changed files; prune entries for deleted
  files. Write to a temp file and rename, so a crash cannot leave a half-written cache. A corrupt or
  wrong-`version` cache is discarded.
- Scans are async, ~8 files in flight. `Library` emits `onDidChange` as results arrive so the UI fills
  progressively and startup never blocks. It also exposes scan progress (`scanned`, `total`) for B.
- Cover art is written once per content hash to `globalStorageUri/art/<hash>.jpg|png`; tracks from the
  same album share a file. The webview receives it via `asWebviewUri`.
- `.wma` is removed from the default `null-music.local.supportedExtensions` (Chromium cannot decode it).

### Playlists and likes

`.m3u8` entries resolve to library tracks by path; entries outside the library go through the same tag
reader. Likes keep their existing track-id keys, so nothing already favorited is lost.

## Webview wiring

- `localResourceRoots` shrink to: extension URI, library folders, playlist directories, and
  `globalStorageUri/art`. The drive-root enumeration is deleted. Roots are refreshed when folders or
  playlists change (existing behaviour).
- Existing `localAudio*` message names are kept where they still fit, so the current UI keeps working
  until B replaces it. Handling moves from `LocalMusicProvider.notify*` into `Player`.

## Error handling

| Situation | Behaviour |
|---|---|
| Webview cannot be revealed / no `ready` in 5 s | Command fails with one error; player stays paused. |
| File fails to load or decode | Silent skip to next; consecutive-skip warning; stop with one error if all fail. |
| File deleted or moved after scan | Same skip path; next rescan prunes it from library and cache. |
| Autoplay blocked | "Click anywhere to play" prompt; pending-play, not playing. |
| Corrupt/unwritable cache or session file | Ignore, rebuild or start fresh; never block activation. |
| Tag parse error | Never surfaces; partial tags plus filename fallback. |

## Migration

- Existing `globalState` keys (`null-music.local.folders`, `.liked`, `.playlists`) are read as is.
- New keys: `null-music.session`; the cache has its own schema `version`.
- `null-music.playback.pollingIntervalMs` is removed from the manifest; a leftover value in user
  settings is harmless.
- Delete `IMusicProvider`, device/auth/artist/album-search types, `PlaybackDevice`, `MusicAuth*`, and the
  unused provider methods. Update `CLAUDE.md`'s null-music entry (Spotify mention; "add services as
  providers" guidance).

## Testing

`node --test` over compiled `out/test/*.test.js`. **Every new test file must be added to the `test`
script in `package.json`** or it is silently skipped.

- `queue.test.ts`: shuffle has no immediate repeats; previous walks history; repeat modes; play next /
  add; index fix-ups on remove and move.
- `player.test.ts` (fake `AudioOutput`): no "playing" without the `play` event; single clock; bad-file
  skip chain; session save and restore paused; commands before `ready` are buffered then flushed.
- `tagReader.test.ts`: one happy-path per format, one truncated file, one garbage-bytes case — all built
  from byte buffers inside the test (no binary fixtures).
- `libraryCache.test.ts`: reuse vs re-read on mtime change; prune; corrupt cache discarded.
- Existing `musicViewProvider`, `commands`, `statusBarController` tests updated for the new wiring.

Verify in the real app with `/verify-local` (sync + integration specs): press a keybinding with the
sidebar never opened and confirm sound; restart and confirm the session returns paused.

## Delivery

- Per repo convention, `npm run compile` and commit refreshed `out/` in a separate
  `chore: refresh null-music compiled output` commit.
- Correct the `CLAUDE.md` null-music entry in the same change.
- Implementation order (to be detailed in the plan): types + `Queue` → `tagReader` + cache + `Library` →
  `Player` + `AudioOutput` + `SessionStore` → rewire UI/commands/status bar → delete the provider layer.

## Open risks

- Auto-reveal relies on the view's `ready` handshake; a slow-to-resolve view is the main source of
  flakiness. The 5 s timeout and buffered commands bound the damage.
- ID3v2.4 unsynchronisation and exotic encodings are the likeliest parser edge cases; the filename
  fallback is the safety net.

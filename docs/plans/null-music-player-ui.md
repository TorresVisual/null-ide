# Null Music Player UI Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Replace the 1,970-line `musicHtml.ts` template string with a cover-forward, theme-native sidebar player (Queue / Library / Playlists, albums and artists, search, native context menus) written as real TypeScript webview files.

**Architecture:** The extension host keeps owning all state (`Player`, `Queue`, `Library`). It posts typed snapshots (`player`, `queue`, `library`, `liked`) to a vanilla-TS webview bundle (`lib/music.js`, `module: none`, `outFile`, the `null-tools` pattern). The webview builds DOM only through `h()` (no `innerHTML` with data), renders from those snapshots and sends typed intents back. Pure logic (`dom.ts`, `model.ts`) is also compiled by a shared tsconfig so `node --test` can load it through `vm`.

**Tech Stack:** TypeScript (host: commonjs/ES2022; webview: `module: none`/ES2017+DOM), `--vscode-*` CSS variables, `node --test`. No new dependencies.

**Spec:** [docs/specs/null-music-player-ui-design.md](../specs/null-music-player-ui-design.md) (engine it builds on: [docs/plans/null-music-engine.md](null-music-engine.md))

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

- All work is under `extensions/null-music/`, plus `scripts/sync-local.ps1` (Task 5), the `CLAUDE.md` null-music entry (Task 11) and this plan. Do not stage the pre-existing unrelated change to `extensions/null-music/media/music.svg`.
- No new dependencies; `devDependencies` unchanged. No Preact/Lit, no jsdom.
- Webview files use `module: none`: **no `import`/`export`**, one shared global scope, concatenated in `include` order. Target ES2017 + DOM lib: no `Array.prototype.flat/flatMap`, no `replaceAll`, no `??=`.
- Anything unit-tested through `vm` must be a top-level `function` declaration (a top-level `const` does not become a property of the vm context).
- Webview CSP stays strict: nonce'd external script, `style-src` without `'unsafe-inline'`. So never `setAttribute('style', …)` or markup `style="…"`; use `el.style.setProperty(...)` (CSSOM is allowed) or classes.
- All colours are `--vscode-*` variables (plus `--np-*` tokens derived from them). No hard-coded hex palette except the generated cover placeholder hue.
- Every icon button has an `aria-label`; toggles use `aria-pressed`; hit targets ≥ 24 px; focus ring is `:focus-visible` with `--vscode-focusBorder`.
- Every new test file must be appended to the `test` script in `package.json` or it is silently skipped.
- Never hand-edit `out/` or `lib/music.js` (`lib/music.css` is hand-written and is committed with features). Feature commits stage only `src/`, config, docs, manifests and `lib/music.css`. `out/` and `lib/music.js` are refreshed in their own commits `chore: refresh null-music compiled output` (end of Task 5 and Task 11). Running `npm test` dirties tracked `out/` files; do not stage them in feature commits.
- Commits: never push, never amend, never `--no-verify`. Every commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Run all commands from `extensions/null-music/` unless stated. Tests: `npm test`.
- From Task 4 until Task 10 the sidebar is only partially rebuilt (the host speaks the new protocol before every tab exists). Do not cut a release in between.

## Deviations from the spec (decided while writing this plan)

1. `playList { kind, id, index }` becomes **`playTracks { ids, startId, shuffle? }`**. Sorting, album grouping and filtering live in the webview `model.ts`; making the host re-derive each list would duplicate that logic. The webview sends the ids it is showing. `// ponytail: one message carries up to the whole library's ids; fine for ~10k tracks, switch to kind/id if it ever lags.`
2. The separate `scan` and `unavailable` messages are folded in: scan progress rides on `library.scan`; unavailable ids ride on `player.unavailable`. Likes travel in a tiny separate `liked` message so a like toggle never re-sends the library.
3. Context-menu payloads carry `trackId`, not `uri` (shorter, no filesystem path in the DOM). The commands resolve it through `Library.trackById`.
4. Queue rows are addressed by the stable entry `key` (added in Task 1), not by list index, because "Next up" is the shuffle order while shuffling and list order otherwise. Reordering is disabled while shuffling.
5. The two open items are resolved by adopting the author's proposals: art height cap `min(100% width, 35vh)`, and ±10 s buttons dropped (arrow keys on the scrubber seek ±5 s). Change them in `music.css` / `player.ts` if review disagrees.
6. `dom.ts` has no `escape()`: `h()` only uses `textContent`-style text nodes and `setAttribute`, so nothing is ever parsed as HTML and there is nothing to escape.

## Review Focus

Inputs the spec implies but its listed tests do not exercise, most likely first:

1. **A track or folder named like markup** (`"><img src=x onerror=…>`) must render as inert text in rows, titles, tooltips and context payloads. Pinned in Task 2 (`h()` test).
2. **Removing the currently playing queue row** (while playing, or the very last row) must start the successor, or stop cleanly with an empty player. Pinned in Task 1.
3. **Tracks with missing tags** (no album, no artist, no track number, album artist differing from artist) must group sanely and never throw or show `undefined`. Pinned in Task 3.
4. **A search query full of regex metacharacters** (`(`, `.*`, `[`) must not throw. The model uses `indexOf`, never `RegExp`. Pinned in Task 3.
5. **Closing and reopening the view** (or the webview reloading) must rebuild the full UI, not an empty shell: on `ready` the host re-sends every snapshot (the engine already treats a fresh view as paused). Pinned in Task 4 (`ready sends every snapshot`, `sendAll` re-sends an unchanged queue).

## File Structure

```
src/webview/music/protocol.ts   typed host<->webview messages (types only; host references it with a triple-slash)
src/webview/music/dom.ts        h(), markText()          [pure, vm-tested]
src/webview/music/model.ts      sort/group/search        [pure, vm-tested]
src/webview/music/icons.ts      inline SVG icon table
src/webview/music/bus.ts        acquireVsCodeApi + send()
src/webview/music/state.ts      the webview's copy of the host snapshots + UI-only state
src/webview/music/audio.ts      <audio> element driver (ported from the old template)
src/webview/music/player.ts     cover, title, scrubber, controls, volume
src/webview/music/queueView.ts  libraryView.ts  playlistsView.ts  header.ts
src/webview/music/main.ts       builds the skeleton, message loop, keyboard
lib/music.css                   hand-written styles (theme variables)      [loaded via asWebviewUri]
lib/music.js                    compiled bundle (tracked)
src/ui/wire.ts                  Track/PlaybackState -> Wire* mappers (host)
src/ui/musicHtml.ts             shrinks to a CSP + nonce + <link> + <script> shell
src/ui/musicViewController.ts   speaks the new protocol
src/playback/queue.ts, player.ts  gain keyed operations + unavailable set (Task 1)
tsconfig.webview-music-shared.json  protocol+dom+model -> out/webview-music-shared.js (tests)
tsconfig.webview-music.json         whole bundle -> lib/music.js (Task 5)
```

---

### Task 1: Keyed queue operations and unavailable tracks (host)

**Files:**
- Modify: `src/playback/queue.ts`, `src/playback/player.ts`
- Test: `src/test/queue.test.ts`, `src/test/player.test.ts`

**Interfaces:**
- Produces (Queue): `export interface Entry { key: number; track: Track }`, `QueueSnapshot { history: Entry[]; current: Entry | null; upcoming: Entry[] }`, `snapshot(): QueueSnapshot`, `removeKey(key: number): void`, `moveBefore(key: number, beforeKey: number | null): void`, `jumpTo(key: number): Track | undefined`.
- Produces (Player): `readonly unavailable: Set<string>` (track ids the output failed on; cleared when that track plays), `jump(key: number): Promise<void>`, `removeFromQueue(key: number): Promise<void>`, `moveInQueue(key: number, beforeKey: number | null): void`, `clearQueue(): void`.

- [ ] **Step 1: Write the failing Queue tests**

Append to `src/test/queue.test.ts`:

```ts
test('snapshot: list order when not shuffling, shuffle order when shuffling', () => {
  const q = new Queue(seeded(7));
  q.replace(tracks(4), 1);
  const plain = q.snapshot();
  assert.deepStrictEqual(plain.history, []);
  assert.strictEqual(plain.current?.track.name, 't1');
  assert.deepStrictEqual(plain.upcoming.map((e) => e.track.name), ['t2', 't3']);

  q.setShuffle(true);
  const shuffled = q.snapshot();
  assert.strictEqual(shuffled.current?.track.name, 't1');
  assert.deepStrictEqual(shuffled.upcoming.map((e) => e.track.name).sort(), ['t0', 't2', 't3']);
  assert.strictEqual(q.next()?.name, shuffled.upcoming[0].track.name);
  assert.strictEqual(q.snapshot().history[0].track.name, 't1');
});

test('snapshot of an empty queue has no current', () => {
  const s = new Queue().snapshot();
  assert.strictEqual(s.current, null);
  assert.deepStrictEqual(s.upcoming, []);
});

test('moveBefore reorders by key, null moves to the end, unknown keys are ignored', () => {
  const q = new Queue();
  q.replace(tracks(4), 0);
  const snap = q.snapshot();
  const [a, b, c, d] = [snap.current!, ...snap.upcoming];
  q.moveBefore(a.key, d.key);
  assert.deepStrictEqual(names(q), ['t1', 't2', 't0', 't3']);
  q.moveBefore(d.key, b.key);
  assert.deepStrictEqual(names(q), ['t3', 't1', 't2', 't0']);
  q.moveBefore(b.key, null);
  assert.deepStrictEqual(names(q), ['t3', 't2', 't0', 't1']);
  q.moveBefore(999, null);
  q.moveBefore(c.key, 999);
  assert.deepStrictEqual(names(q), ['t3', 't2', 't0', 't1']);
  assert.strictEqual(q.current?.name, 't0'); // the playing entry moved with its key
});

test('removeKey removes one entry and ignores unknown keys', () => {
  const q = new Queue();
  q.replace(tracks(3), 0);
  const [, b] = [q.snapshot().current!, ...q.snapshot().upcoming];
  q.removeKey(b.key);
  q.removeKey(12345);
  assert.deepStrictEqual(names(q), ['t0', 't2']);
});

test('jumpTo makes an upcoming or history entry current and records history', () => {
  const q = new Queue();
  q.replace(tracks(4), 0);
  const upcoming = q.snapshot().upcoming;
  assert.strictEqual(q.jumpTo(upcoming[2].key)?.name, 't3');
  assert.strictEqual(q.current?.name, 't3');
  assert.deepStrictEqual(q.snapshot().history.map((e) => e.track.name), ['t0']);
  const back = q.snapshot().history[0];
  assert.strictEqual(q.jumpTo(back.key)?.name, 't0');
  assert.deepStrictEqual(q.snapshot().history.map((e) => e.track.name), ['t3']);
  assert.strictEqual(q.jumpTo(999), undefined);
  assert.strictEqual(q.current?.name, 't0');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL at compile — `Property 'snapshot' does not exist on type 'Queue'`.

- [ ] **Step 3: Implement in `src/playback/queue.ts`**

Change `interface Entry {` (line 5) to `export interface Entry {`. Add after the `Entry` interface:

```ts
export interface QueueSnapshot {
  history: Entry[];
  current: Entry | null;
  /** Shuffle order while shuffling, list order otherwise. */
  upcoming: Entry[];
}
```

Add these methods to `Queue` (after `previous()`, before `private rebuild()`):

```ts
  snapshot(): QueueSnapshot {
    const byKey = new Map(this.entries.map((e) => [e.key, e]));
    const pick = (keys: number[]) => keys.map((k) => byKey.get(k)).filter((e): e is Entry => !!e);
    const at = this.index;
    return {
      history: pick(this.history),
      current: at >= 0 ? this.entries[at] : null,
      upcoming: this.shuffleOn ? pick(this.upcoming) : at >= 0 ? this.entries.slice(at + 1) : [],
    };
  }

  removeKey(key: number): void {
    const i = this.entries.findIndex((e) => e.key === key);
    if (i >= 0) this.remove(i);
  }

  /** Move the entry with `key` to just before `beforeKey` (`null` = the end). Unknown keys are ignored. */
  moveBefore(key: number, beforeKey: number | null): void {
    const from = this.entries.findIndex((e) => e.key === key);
    if (from < 0 || key === beforeKey) return;
    let to = beforeKey === null ? this.entries.length - 1 : this.entries.findIndex((e) => e.key === beforeKey);
    if (to < 0) return;
    if (beforeKey !== null && from < to) to--;
    this.move(from, to);
  }

  /** Make `key` current (from history or upcoming); the old current goes to history. */
  jumpTo(key: number): Track | undefined {
    const e = this.entries.find((x) => x.key === key);
    if (!e || key === this.currentKey) return e?.track;
    this.history = this.history.filter((k) => k !== key);
    if (this.currentKey !== -1) this.history.push(this.currentKey);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.upcoming = this.upcoming.filter((k) => k !== key);
    this.currentKey = key;
    return e.track;
  }
```

- [ ] **Step 4: Run to verify the Queue tests pass**

Run: `npm test`
Expected: PASS for queue tests.

- [ ] **Step 5: Write the failing Player tests**

Append to `src/test/player.test.ts` (it already imports `Player`, `FakeOutput`, `track`; add `tick` to the fixtures import if absent):

```ts
function readyPlayer() {
  const out = new FakeOutput();
  out.becomeReady();
  return { out, player: new Player({ output: out }) };
}
const upcomingKeys = (p: Player) => p.queue.snapshot().upcoming.map((e) => e.key);

test('jump starts the chosen entry and removeFromQueue of a non-current entry keeps playing', async () => {
  const { out, player } = readyPlayer();
  await player.playTracks([track(0), track(1), track(2)], 0);
  out.emit({ type: 'play' });
  const [k1, k2] = upcomingKeys(player);
  await player.jump(k2);
  assert.strictEqual(player.getState().track?.name, 't2');
  assert.ok(out.calls.at(-1)?.startsWith('load file:///t2.mp3 @0 play'));
  await player.removeFromQueue(k1);
  assert.strictEqual(player.getState().track?.name, 't2');
  assert.strictEqual(player.queue.length, 2);
});

test('removing the playing entry starts its successor; removing the last one stops cleanly', async () => {
  const { out, player } = readyPlayer();
  await player.playTracks([track(0), track(1)], 0);
  out.emit({ type: 'play' });
  await player.removeFromQueue(player.queue.snapshot().current!.key);
  assert.strictEqual(player.getState().track?.name, 't1');
  assert.ok(out.calls.at(-1)?.startsWith('load file:///t1.mp3 @0 play'));
  out.emit({ type: 'play' });
  await player.removeFromQueue(player.queue.snapshot().current!.key);
  assert.strictEqual(player.getState().track, null);
  assert.strictEqual(player.getState().isPlaying, false);
  assert.ok(out.calls.includes('pause'));
});

test('clearQueue empties the queue and stops', async () => {
  const { out, player } = readyPlayer();
  await player.playTracks([track(0), track(1)], 0);
  out.emit({ type: 'play' });
  player.clearQueue();
  assert.strictEqual(player.queue.length, 0);
  assert.strictEqual(player.getState().isPlaying, false);
  assert.strictEqual(player.getState().track, null);
});

test('moveInQueue reorders upcoming entries', async () => {
  const { player } = readyPlayer();
  await player.playTracks([track(0), track(1), track(2)], 0);
  const [k1, k2] = upcomingKeys(player);
  player.moveInQueue(k2, k1);
  assert.deepStrictEqual(player.queue.tracks.map((t) => t.name), ['t0', 't2', 't1']);
});

test('a track the output fails on is marked unavailable until it plays', async () => {
  const { out, player } = readyPlayer();
  const only = track(0);
  await player.playTracks([only], 0);
  out.emit({ type: 'error', message: 'decode', trackUri: only.uri });
  await tick();
  assert.ok(player.unavailable.has(only.id));
  await player.play();
  out.emit({ type: 'play' });
  assert.strictEqual(player.unavailable.size, 0);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test`
Expected: FAIL at compile — `Property 'jump' does not exist on type 'Player'`.

- [ ] **Step 7: Implement in `src/playback/player.ts`**

Add the field next to `private skipStreak = 0;`:

```ts
  /** Ids of tracks the output failed to play; a track leaves the set when it plays. */
  readonly unavailable = new Set<string>();
```

Add these methods after `addToQueue(...)`:

```ts
  async jump(key: number): Promise<void> {
    if (!this.queue.jumpTo(key)) return;
    this.skipStreak = 0;
    await this.startCurrent(true, 0, true);
  }

  async removeFromQueue(key: number): Promise<void> {
    const wasCurrent = this.queue.snapshot().current?.key === key;
    const autoplay = this.playing || this.pending;
    this.queue.removeKey(key);
    if (!wasCurrent) {
      this.changed();
    } else if (this.queue.current) {
      await this.startCurrent(autoplay, 0, true);
    } else {
      this.stopAtEnd();
    }
  }

  moveInQueue(key: number, beforeKey: number | null): void {
    this.queue.moveBefore(key, beforeKey);
    this.changed();
  }

  clearQueue(): void {
    this.queue.clear();
    this.stopAtEnd();
  }
```

In `handle`, change the `case 'play':` block to also clear the mark:

```ts
      case 'play':
        this.playing = true;
        this.pending = false;
        this.skipStreak = 0;
        if (current) this.unavailable.delete(current.id);
        break;
```

In `onOutputError`, directly after `const failed = this.queue.current;` add:

```ts
    if (failed) this.unavailable.add(failed.id);
```

- [ ] **Step 8: Run to verify everything passes**

Run: `npm test`
Expected: PASS (all suites).

- [ ] **Step 9: Commit**

```bash
git add src/playback/queue.ts src/playback/player.ts src/test/queue.test.ts src/test/player.test.ts
git commit -m "feat(null-music): keyed queue operations and unavailable-track tracking" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Webview build scaffolding, protocol and `h()`

**Files:**
- Create: `src/webview/music/protocol.ts`, `src/webview/music/dom.ts`, `tsconfig.webview-music-shared.json`, `src/test/webviewDom.test.ts`
- Modify: `tsconfig.json`, `package.json` (`compile` and `test` scripts)

**Interfaces:**
- Produces (global, webview and host): `WireTrack`, `WirePlayerState`, `WireQueueItem`, `WireFolder`, `WirePlaylist`, `HostToWebview`, `WebviewToHost` (all below). Webview-only: `h(tag, attrs?, ...children): HTMLElement`, `type Child`, `type Attrs`.

- [ ] **Step 1: Create `src/webview/music/protocol.ts`**

```ts
'use strict';

// Types only, shared by the host (via `/// <reference path>`) and the webview bundle.
// No imports/exports: this file is a global script (module: none).

interface WireTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  albumArtist?: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  durationMs: number;
  /** Webview-loadable cover URL, absent when the track has no embedded art. */
  artUrl?: string;
}

interface WirePlayerState {
  isPlaying: boolean;
  track: WireTrack | null;
  liked: boolean;
  progressMs: number;
  durationMs: number;
  volume: number;
  shuffle: boolean;
  repeat: 'off' | 'track' | 'context';
  /** Host clock (ms) when progressMs was measured. */
  timestamp: number;
}

interface WireQueueItem {
  key: number;
  track: WireTrack;
}

interface WireFolder {
  uri: string;
  name: string;
  trackCount: number;
}

interface WirePlaylist {
  id: string;
  name: string;
  /** Carried in full: a playlist can hold files that are not in any library folder. */
  tracks: WireTrack[];
}

type HostToWebview =
  | { type: 'player'; state: WirePlayerState; unavailable: string[] }
  | { type: 'queue'; history: WireQueueItem[]; current: WireQueueItem | null; upcoming: WireQueueItem[]; reorderable: boolean }
  | { type: 'library'; tracks: WireTrack[]; folders: WireFolder[]; playlists: WirePlaylist[]; scan: { scanned: number; total: number }; extensions: string[] }
  | { type: 'liked'; ids: string[] }
  // audio element commands (owned by WebviewAudioOutput; unchanged from the engine)
  | { type: 'localLoad'; uri: string; trackUri: string; startMs: number; autoplay: boolean }
  | { type: 'localPause' }
  | { type: 'localResume' }
  | { type: 'localSeek'; positionMs: number }
  | { type: 'localVolume'; volumePercent: number };

type WebviewToHost =
  | { type: 'ready' }
  // transport
  | { type: 'playPause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'setVolume'; volumePercent: number }
  | { type: 'toggleShuffle' }
  | { type: 'toggleRepeat' }
  // library
  | { type: 'playTracks'; ids: string[]; startId: string; shuffle?: boolean }
  | { type: 'toggleLike'; trackId?: string } // no id = the current track
  // queue
  | { type: 'queuePlayNext'; trackId: string }
  | { type: 'queueAdd'; trackId: string }
  | { type: 'queueRemove'; key: number }
  | { type: 'queueMove'; key: number; beforeKey: number | null }
  | { type: 'queueClear' }
  | { type: 'queueJump'; key: number }
  // setup
  | { type: 'addFolder' }
  | { type: 'importPlaylist' }
  | { type: 'removeFolder'; uri: string }
  | { type: 'removePlaylist'; id: string }
  | { type: 'rescan' }
  // audio element events (consumed by WebviewAudioOutput; unchanged from the engine)
  | { type: 'localAudioPlayStarted' }
  | { type: 'localAudioPaused'; positionMs: number; trackUri?: string }
  | { type: 'localAudioTimeUpdate'; positionMs: number; trackUri?: string }
  | { type: 'localAudioDuration'; durationMs: number; trackUri?: string }
  | { type: 'localAudioEnded'; trackUri?: string }
  | { type: 'localAudioError'; error: string; trackUri?: string }
  | { type: 'localAudioPlayFailed'; error: string; trackUri?: string; silent?: boolean };
```

- [ ] **Step 2: Create `src/webview/music/dom.ts`**

```ts
'use strict';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined> | null;

/**
 * Builds an element from text nodes and setAttribute only, so data (track names, paths) is never
 * parsed as HTML. `true` sets a boolean attribute; null/undefined/false attributes and children are skipped.
 * Never pass `style`: the CSP forbids inline style attributes (use el.style.setProperty).
 */
function h(tag: string, attrs?: Attrs, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const name of Object.keys(attrs)) {
      const v = attrs[name];
      if (v === null || v === undefined || v === false) continue;
      el.setAttribute(name, v === true ? '' : String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}
```

- [ ] **Step 3: Create `tsconfig.webview-music-shared.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "none",
    "lib": ["ES2017", "DOM"],
    "outFile": "./out/webview-music-shared.js",
    "strict": true,
    "sourceMap": false,
    "skipLibCheck": true
  },
  "include": [
    "src/webview/music/protocol.ts",
    "src/webview/music/dom.ts"
  ]
}
```

- [ ] **Step 4: Keep webview sources out of the CommonJS build**

In `tsconfig.json` add `"exclude": ["src/webview"]` after the `include` line:

```json
  "include": ["src/**/*.ts"],
  "exclude": ["src/webview"]
```

In `package.json`, change the scripts:
- `"compile": "tsc -p tsconfig.json"` → `"compile": "tsc -p tsconfig.json && tsc -p tsconfig.webview-music-shared.json"`
- in `"test"`: replace `"tsc -p tsconfig.json && node --test ` with `"tsc -p tsconfig.json && tsc -p tsconfig.webview-music-shared.json && node --test ` and append ` out/test/webviewDom.test.js` after `out/test/uri.test.js`.

- [ ] **Step 5: Write the failing test `src/test/webviewDom.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

// The webview bundle is a plain script, so load the compiled shared file into a sandbox that has a
// tiny fake `document` (no jsdom) and read its top-level functions off it.
class FakeNode {
  children: FakeNode[] = [];
  attrs: Record<string, string> = {};
  constructor(readonly tag: string, readonly text?: string) {}
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  appendChild(c: FakeNode) {
    this.children.push(c);
    return c;
  }
}

const counter = { elements: 0 };
const document = {
  createElement: (tag: string) => {
    counter.elements++;
    return new FakeNode(tag);
  },
  createTextNode: (text: string) => new FakeNode('#text', text),
};
const sandbox = vm.createContext({ document });
vm.runInContext(readFileSync(path.join(__dirname, '..', 'webview-music-shared.js'), 'utf8'), sandbox);
const dom = sandbox as unknown as {
  h(tag: string, attrs?: Record<string, unknown> | null, ...children: unknown[]): FakeNode;
};

test('h() keeps markup in names inert: one element, text node child, literal attributes', () => {
  counter.elements = 0;
  const evil = '"><img src=x onerror=alert(1)>';
  const row = dom.h('li', { 'data-id': evil, title: evil }, evil);
  assert.strictEqual(counter.elements, 1);
  assert.strictEqual(row.attrs['data-id'], evil);
  assert.strictEqual(row.attrs.title, evil);
  assert.strictEqual(row.children.length, 1);
  assert.strictEqual(row.children[0].tag, '#text');
  assert.strictEqual(row.children[0].text, evil);
});

test('h() skips null/undefined/false, sets boolean attributes and nests elements', () => {
  const inner = dom.h('b', null, 'x');
  const el = dom.h('div', { hidden: true, disabled: false, title: null, 'aria-pressed': 'false' }, null, undefined, false, inner, 'tail');
  assert.deepStrictEqual(el.attrs, { hidden: '', 'aria-pressed': 'false' });
  assert.deepStrictEqual(el.children.map((c) => c.tag), ['b', '#text']);
});
```

- [ ] **Step 6: Run to verify it passes** (the implementation already exists from Steps 1–3; if you ran this step before them it fails with `ENOENT … webview-music-shared.js`)

Run: `npm test`
Expected: PASS, including both `h()` tests.

- [ ] **Step 7: Commit**

```bash
git add src/webview/music/protocol.ts src/webview/music/dom.ts tsconfig.json tsconfig.webview-music-shared.json package.json src/test/webviewDom.test.ts
git commit -m "feat(null-music): webview protocol types and h() DOM helper with build scaffolding" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pure model (sort, group, search) and `markText`

**Files:**
- Create: `src/webview/music/model.ts`, `src/test/webviewModel.test.ts`
- Modify: `src/webview/music/dom.ts` (add `markText`, `trackContext`), `tsconfig.webview-music-shared.json` (add `model.ts`), `package.json` (test list)

**Interfaces:**
- Consumes: `WireTrack`, `h`, `Child` (Task 2).
- Produces (all top-level functions): `formatTime(ms): string`; `sortTracks(tracks, key: SortKey): WireTrack[]`; `groupAlbums(tracks): Album[]`; `groupArtists(tracks): Artist[]`; `albumKeyOf(t): string`, `artistKeyOf(t): string` (same values as `Album.key` / `Artist.key`); `scoreText(text, query): number` (3 prefix, 2 word-start, 1 substring, 0 none); `rankItems<T>(items, query, fields: (i: T) => string[]): T[]`; `rankTracks(tracks, query): WireTrack[]`; `matchesTrack(t, query): boolean`; `highlightRanges(text, query): Array<[number, number]>`; `placeholderHue(name): number`; `resolveTracks(ids, byId: Map<string, WireTrack>): WireTrack[]`; `reorderTarget(keys: number[], key: number, dir: -1 | 1): number | null | undefined`; plus in `dom.ts`: `markText(text, query): Child[]`, `trackContext(trackId): string`. Types: `SortKey = 'title' | 'artist' | 'album' | 'duration'`, `Album { key; name; artist; year?; artUrl?; tracks }`, `Artist { key; name; artUrl?; albums; tracks }`.

- [ ] **Step 1: Write the failing test `src/test/webviewModel.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, '..', 'webview-music-shared.js'), 'utf8'), sandbox);

interface T {
  id: string;
  name: string;
  artist: string;
  album: string;
  albumArtist?: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  durationMs: number;
  artUrl?: string;
}
interface Album { key: string; name: string; artist: string; year?: number; artUrl?: string; tracks: T[] }
const m = sandbox as unknown as {
  formatTime(ms: number): string;
  sortTracks(tracks: T[], key: 'title' | 'artist' | 'album' | 'duration'): T[];
  groupAlbums(tracks: T[]): Album[];
  groupArtists(tracks: T[]): Array<{ key: string; name: string; artUrl?: string; albums: Album[]; tracks: T[] }>;
  albumKeyOf(t: T): string;
  artistKeyOf(t: T): string;
  scoreText(text: string, query: string): number;
  rankItems<X>(items: X[], query: string, fields: (i: X) => string[]): X[];
  rankTracks(tracks: T[], query: string): T[];
  matchesTrack(t: T, query: string): boolean;
  highlightRanges(text: string, query: string): Array<[number, number]>;
  placeholderHue(name: string): number;
  resolveTracks(ids: string[], byId: Map<string, T>): T[];
  reorderTarget(keys: number[], key: number, dir: -1 | 1): number | null | undefined;
  trackContext(id: string): string;
};

// Values built inside the vm have a different Array prototype; compare plain copies.
const plain = <X>(v: X): X => JSON.parse(JSON.stringify(v));
const t = (id: string, over: Partial<T> = {}): T => ({ id, name: id, artist: 'A', album: 'X', durationMs: 1000, ...over });
const ids = (list: T[]) => list.map((x) => x.id);

test('formatTime: m:ss, h:mm:ss, and junk becomes 0:00', () => {
  assert.strictEqual(m.formatTime(0), '0:00');
  assert.strictEqual(m.formatTime(65000), '1:05');
  assert.strictEqual(m.formatTime(3725000), '1:02:05');
  assert.strictEqual(m.formatTime(NaN), '0:00');
  assert.strictEqual(m.formatTime(-5), '0:00');
});

test('sortTracks sorts a copy by title, artist and duration', () => {
  const list = [t('b', { name: 'beta', artist: 'Z', durationMs: 5 }), t('a', { name: 'Alpha', artist: 'Y', durationMs: 9 })];
  assert.deepStrictEqual(ids(m.sortTracks(list, 'title')), ['a', 'b']);
  assert.deepStrictEqual(ids(m.sortTracks(list, 'artist')), ['a', 'b']);
  assert.deepStrictEqual(ids(m.sortTracks(list, 'duration')), ['b', 'a']);
  assert.deepStrictEqual(ids(list), ['b', 'a']); // input untouched
});

test('groupAlbums orders by disc then track number and tolerates missing tags', () => {
  const albums = m.groupAlbums([
    t('d2t1', { album: 'Rec', artist: 'Band', discNo: 2, trackNo: 1, year: 1999, artUrl: 'u' }),
    t('d1t2', { album: 'Rec', artist: 'Band', discNo: 1, trackNo: 2 }),
    t('d1t1', { album: 'Rec', artist: 'Band', discNo: 1, trackNo: 1 }),
    t('lone', { album: '', artist: '' }),
  ]);
  const rec = albums.find((a) => a.name === 'Rec')!;
  assert.deepStrictEqual(ids(rec.tracks), ['d1t1', 'd1t2', 'd2t1']);
  assert.strictEqual(rec.year, 1999);
  assert.strictEqual(rec.artUrl, 'u');
  const lone = albums.find((a) => a.name === 'Unknown album')!;
  assert.strictEqual(lone.artist, 'Unknown artist');
  assert.deepStrictEqual(plain(m.groupAlbums([])), []);
});

test('groupArtists prefers album artist, merges case differences and lists albums', () => {
  const artists = m.groupArtists([
    t('1', { artist: 'The Band feat. X', albumArtist: 'The Band', album: 'One' }),
    t('2', { artist: 'the band', album: 'Two' }),
    t('3', { artist: 'Solo', album: 'S', artUrl: 'art' }),
  ]);
  assert.deepStrictEqual(artists.map((a) => a.name), ['Solo', 'The Band']);
  const band = artists.find((a) => a.name === 'The Band')!;
  assert.strictEqual(band.albums.length, 2);
  assert.strictEqual(band.tracks.length, 2);
  assert.strictEqual(artists.find((a) => a.name === 'Solo')!.artUrl, 'art');
  assert.deepStrictEqual(plain(m.groupArtists([])), []);
});

test('album and artist keys match the grouped keys the player links to', () => {
  const track = t('k', { album: 'Rec', artist: 'Band' });
  assert.strictEqual(m.albumKeyOf(track), m.groupAlbums([track])[0].key);
  assert.strictEqual(m.artistKeyOf(track), m.groupArtists([track])[0].key);
  assert.strictEqual(m.artistKeyOf(t('k2', { artist: 'BAND' })), m.artistKeyOf(track));
});

test('scoreText: prefix > word start > substring > none; case-insensitive', () => {
  assert.strictEqual(m.scoreText('Rainbow', 'rain'), 3);
  assert.strictEqual(m.scoreText('Dark Rain', 'RAIN'), 2);
  assert.strictEqual(m.scoreText('Training', 'rain'), 1);
  assert.strictEqual(m.scoreText('Sunshine', 'rain'), 0);
  assert.strictEqual(m.scoreText('anything', '   '), 0);
  assert.strictEqual(m.scoreText('Training rain', 'rain'), 2); // a later word start beats an earlier mid-word hit
});

test('rankTracks orders by match quality, titles outrank artists, keeps list order for ties', () => {
  const list = [t('train', { name: 'Training' }), t('dark', { name: 'Dark Rain' }), t('bow', { name: 'Rainbow' }), t('no', { name: 'Other' })];
  assert.deepStrictEqual(ids(m.rankTracks(list, 'rain')), ['bow', 'dark', 'train']);
  const byArtist = [t('x', { name: 'zzz', artist: 'rain' }), t('y', { name: 'rain man', artist: 'q' })];
  assert.deepStrictEqual(ids(m.rankTracks(byArtist, 'rain')), ['y', 'x']);
  assert.strictEqual(m.rankTracks(list, '  '), list); // blank query = unfiltered
});

test('matchesTrack filters without reordering; blank matches all', () => {
  assert.strictEqual(m.matchesTrack(t('a', { name: 'Rainbow' }), 'rain'), true);
  assert.strictEqual(m.matchesTrack(t('a', { name: 'Other', artist: 'Rain Band' }), 'rain'), true);
  assert.strictEqual(m.matchesTrack(t('a', { name: 'Other' }), 'rain'), false);
  assert.strictEqual(m.matchesTrack(t('a'), '   '), true);
});

test('regex metacharacters in a query are plain text and never throw', () => {
  const list = [t('a', { name: 'a[b' }), t('b', { name: 'plain (c) text' }), t('c', { name: 'zzz' })];
  assert.deepStrictEqual(ids(m.rankTracks(list, '[')), ['a']);
  assert.deepStrictEqual(ids(m.rankTracks(list, '(c')), ['b']);
  assert.deepStrictEqual(ids(m.rankTracks(list, '.*')), []);
  assert.deepStrictEqual(plain(m.highlightRanges('a.*b.*', '.*')), [[1, 3], [4, 6]]);
});

test('rankItems works on any item type', () => {
  const albums = [{ n: 'Abbey Road' }, { n: 'Road Trip' }, { n: 'Other' }];
  assert.deepStrictEqual(m.rankItems(albums, 'road', (a) => [a.n]).map((a) => a.n), ['Road Trip', 'Abbey Road']);
});

test('highlightRanges finds every non-overlapping occurrence', () => {
  assert.deepStrictEqual(plain(m.highlightRanges('Rain rain', 'rain')), [[0, 4], [5, 9]]);
  assert.deepStrictEqual(plain(m.highlightRanges('abc', '')), []);
  assert.deepStrictEqual(plain(m.highlightRanges('abc', 'z')), []);
});

test('placeholderHue is deterministic and within 0..359', () => {
  const a = m.placeholderHue('Abbey Road');
  assert.strictEqual(a, m.placeholderHue('Abbey Road'));
  assert.ok(a >= 0 && a < 360);
  assert.notStrictEqual(m.placeholderHue('a'), m.placeholderHue('b'));
});

test('resolveTracks keeps order and drops unknown ids', () => {
  const byId = new Map([['a', t('a')], ['b', t('b')]]);
  assert.deepStrictEqual(ids(m.resolveTracks(['b', 'zzz', 'a'], byId)), ['b', 'a']);
});

test('reorderTarget gives the beforeKey for Alt+Up/Down, undefined at the edges', () => {
  const keys = [10, 11, 12, 13];
  assert.strictEqual(m.reorderTarget(keys, 11, -1), 10);
  assert.strictEqual(m.reorderTarget(keys, 10, -1), undefined);
  assert.strictEqual(m.reorderTarget(keys, 11, 1), 13);
  assert.strictEqual(m.reorderTarget(keys, 12, 1), null); // becomes the last entry
  assert.strictEqual(m.reorderTarget(keys, 13, 1), undefined);
  assert.strictEqual(m.reorderTarget(keys, 99, 1), undefined);
});

test('trackContext is JSON the context-menu contribution can read, even for hostile ids', () => {
  const ctx = JSON.parse(m.trackContext('local:file:///a"b>.mp3'));
  assert.strictEqual(ctx.webviewSection, 'track');
  assert.strictEqual(ctx.trackId, 'local:file:///a"b>.mp3');
  assert.strictEqual(ctx.preventDefaultContextMenuItems, true);
});
```

Add `out/test/webviewModel.test.js` after `out/test/webviewDom.test.js` in the `package.json` test script.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `m.formatTime is not a function` (the shared bundle has no model yet).

- [ ] **Step 3: Create `src/webview/music/model.ts`**

```ts
'use strict';

type SortKey = 'title' | 'artist' | 'album' | 'duration';

interface Album {
  key: string;
  name: string;
  artist: string;
  year?: number;
  artUrl?: string;
  tracks: WireTrack[];
}

interface Artist {
  key: string;
  name: string;
  artUrl?: string;
  albums: Album[];
  tracks: WireTrack[];
}

const UNKNOWN_ARTIST = 'Unknown artist';
const UNKNOWN_ALBUM = 'Unknown album';
const SEPARATOR = /[\s\-_.,/()\[\]]/;

function formatTime(ms: number): string {
  if (!(ms > 0)) return '0:00';
  const total = Math.floor(ms / 1000);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const ss = secs < 10 ? '0' + secs : String(secs);
  if (hrs > 0) return hrs + ':' + (mins < 10 ? '0' + mins : String(mins)) + ':' + ss;
  return mins + ':' + ss;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

function artistOf(t: WireTrack): string {
  return (t.albumArtist || t.artist || '').trim() || UNKNOWN_ARTIST;
}

/** Stable ids the player's artist/album links and the Library detail views use. */
function artistKeyOf(t: WireTrack): string {
  return artistOf(t).toLowerCase();
}

function albumKeyOf(t: WireTrack): string {
  return artistKeyOf(t) + '\u0000' + (t.album.trim() || UNKNOWN_ALBUM).toLowerCase();
}

/** Disc, then track number (untagged last), then title. */
function albumOrder(a: WireTrack, b: WireTrack): number {
  const na = a.trackNo === undefined ? 1e9 : a.trackNo;
  const nb = b.trackNo === undefined ? 1e9 : b.trackNo;
  return (a.discNo || 1) - (b.discNo || 1) || na - nb || compareText(a.name, b.name);
}

function sortTracks(tracks: WireTrack[], key: SortKey): WireTrack[] {
  const by: Record<SortKey, (a: WireTrack, b: WireTrack) => number> = {
    title: (a, b) => compareText(a.name, b.name),
    artist: (a, b) => compareText(a.artist, b.artist) || compareText(a.name, b.name),
    album: (a, b) => compareText(a.album, b.album) || albumOrder(a, b),
    duration: (a, b) => a.durationMs - b.durationMs || compareText(a.name, b.name),
  };
  return tracks.slice().sort(by[key]);
}

function groupAlbums(tracks: WireTrack[]): Album[] {
  const map = new Map<string, Album>();
  for (const t of tracks) {
    const artist = artistOf(t);
    const name = t.album.trim() || UNKNOWN_ALBUM;
    const key = albumKeyOf(t);
    let album = map.get(key);
    if (!album) {
      album = { key, name, artist, tracks: [] };
      map.set(key, album);
    }
    album.tracks.push(t);
    if (album.year === undefined && t.year) album.year = t.year;
    if (!album.artUrl && t.artUrl) album.artUrl = t.artUrl;
  }
  const out = Array.from(map.values());
  for (const a of out) a.tracks.sort(albumOrder);
  return out.sort((a, b) => compareText(a.name, b.name) || compareText(a.artist, b.artist));
}

function groupArtists(tracks: WireTrack[]): Artist[] {
  const map = new Map<string, { name: string; tracks: WireTrack[] }>();
  for (const t of tracks) {
    const key = artistKeyOf(t);
    const entry = map.get(key);
    if (entry) entry.tracks.push(t);
    else map.set(key, { name: artistOf(t), tracks: [t] });
  }
  const out: Artist[] = [];
  map.forEach((entry, key) => {
    const albums = groupAlbums(entry.tracks);
    const ordered: WireTrack[] = [];
    let artUrl: string | undefined;
    for (const a of albums) {
      for (const t of a.tracks) ordered.push(t);
      if (!artUrl && a.artUrl) artUrl = a.artUrl;
    }
    out.push({ key, name: entry.name, artUrl, albums, tracks: ordered });
  });
  return out.sort((a, b) => compareText(a.name, b.name));
}

/** 3 = prefix, 2 = starts a word, 1 = elsewhere, 0 = no match. Plain indexOf: the query is never a pattern. */
function scoreText(text: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let best = 0;
  let from = 0;
  for (;;) {
    const at = t.indexOf(q, from);
    if (at < 0) return best;
    if (at === 0) return 3;
    if (SEPARATOR.test(t.charAt(at - 1))) best = 2;
    else if (best === 0) best = 1;
    from = at + 1;
  }
}

/** Keeps matching items, best first (ties keep list order). The first field outranks the others. */
function rankItems<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  if (!query.trim()) return items;
  const scored: Array<{ item: T; score: number; i: number }> = [];
  items.forEach((item, i) => {
    const f = fields(item);
    let rest = 0;
    for (let k = 1; k < f.length; k++) rest = Math.max(rest, scoreText(f[k], query));
    const score = scoreText(f[0], query) * 10 + rest;
    if (score > 0) scored.push({ item, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.item);
}

function rankTracks(tracks: WireTrack[], query: string): WireTrack[] {
  return rankItems(tracks, query, (t) => [t.name, t.artist, t.album]);
}

/** For views that must keep their order (queue, album detail): does the track match at all? Blank query matches everything. */
function matchesTrack(t: WireTrack, query: string): boolean {
  return !query.trim() || scoreText(t.name, query) + scoreText(t.artist, query) + scoreText(t.album, query) > 0;
}

function highlightRanges(text: string, query: string): Array<[number, number]> {
  const q = query.trim().toLowerCase();
  const out: Array<[number, number]> = [];
  if (!q) return out;
  const t = text.toLowerCase();
  let from = 0;
  for (;;) {
    const at = t.indexOf(q, from);
    if (at < 0) return out;
    out.push([at, at + q.length]);
    from = at + q.length;
  }
}

function placeholderHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function resolveTracks(ids: string[], byId: Map<string, WireTrack>): WireTrack[] {
  const out: WireTrack[] = [];
  for (const id of ids) {
    const t = byId.get(id);
    if (t) out.push(t);
  }
  return out;
}

/** The `beforeKey` for moving `key` one slot up/down among `keys`; undefined when it cannot move. */
function reorderTarget(keys: number[], key: number, dir: -1 | 1): number | null | undefined {
  const at = keys.indexOf(key);
  if (at < 0) return undefined;
  if (dir === -1) return at === 0 ? undefined : keys[at - 1];
  if (at === keys.length - 1) return undefined;
  return at + 2 < keys.length ? keys[at + 2] : null;
}
```

- [ ] **Step 4: Extend `src/webview/music/dom.ts` and the shared tsconfig**

Append to `dom.ts`:

```ts

/** `text` as strings and <mark> elements around every case-insensitive occurrence of `query`. */
function markText(text: string, query: string): Child[] {
  const out: Child[] = [];
  let at = 0;
  for (const range of highlightRanges(text, query)) {
    if (range[0] > at) out.push(text.slice(at, range[0]));
    out.push(h('mark', null, text.slice(range[0], range[1])));
    at = range[1];
  }
  if (at < text.length || out.length === 0) out.push(text.slice(at));
  return out;
}

/** Value for `data-vscode-context`: makes the `webview/context` menu contribution fire for this track. */
function trackContext(trackId: string): string {
  return JSON.stringify({ webviewSection: 'track', trackId, preventDefaultContextMenuItems: true });
}
```

In `tsconfig.webview-music-shared.json` add `"src/webview/music/model.ts"` to `include` after `dom.ts`.

- [ ] **Step 5: Run to verify it passes**

Run: `npm test`
Expected: PASS, including every `webviewModel` test.

- [ ] **Step 6: Commit**

```bash
git add src/webview/music/model.ts src/webview/music/dom.ts tsconfig.webview-music-shared.json package.json src/test/webviewModel.test.ts
git commit -m "feat(null-music): pure webview model for sorting, grouping and ranked search" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Host speaks the typed protocol; context-menu commands

After this task the host sends `player`/`queue`/`library`/`liked` snapshots and understands the new intents. The old template still loads but is incompatible until Task 5 replaces it.

**Files:**
- Create: `src/ui/wire.ts`
- Modify: `src/library/library.ts` (likes event), `src/ui/musicViewController.ts` (rewrite), `src/ui/musicViewProvider.ts`, `src/ui/commands.ts`, `package.json` (commands, `webview/context`, `commandPalette`)
- Test: `src/test/musicViewProvider.test.ts` (rewrite), `src/test/library.test.ts` (append)

**Interfaces:**
- Consumes: `Queue.snapshot()` / `Entry`, `Player.jump/removeFromQueue/moveInQueue/clearQueue/unavailable` (Task 1); protocol types (Task 2).
- Produces: `Library.onDidChangeLikes: Event<void>`; `toWireTrack(t, artUrl)`, `toWirePlayerState(s, artUrl)`, `toWireQueue(snapshot, shuffle, artUrl)`, `toWireLibrary(library, artUrl)`; `MusicViewController.sendAll() / sendPlayer() / sendQueue() / sendLibrary() / sendLiked()`; commands `null-music.track.playNext | addToQueue | favorite | reveal` (argument: `{ trackId: string }`).

- [ ] **Step 1: Write the failing tests**

Append to `src/test/library.test.ts`:

```ts
test('toggleLike fires onDidChangeLikes', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'likes-'));
  const lib = new Library({ state: new MemState(), cacheFile: path.join(dir, 'c.json'), artDir: path.join(dir, 'art'), extensions: () => ['.mp3'] });
  let fired = 0;
  lib.onDidChangeLikes(() => fired++);
  assert.strictEqual(await lib.toggleLike('local:x'), true);
  assert.strictEqual(await lib.toggleLike('local:x'), false);
  assert.strictEqual(fired, 2);
  lib.dispose();
});
```

Replace the entire contents of `src/test/musicViewProvider.test.ts` with:

```ts
'use strict';

import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { after, test } from 'node:test';
import { Library } from '../library/library';
import { Player } from '../playback/player';
import { pathToUri } from '../uri';
import { MusicViewController } from '../ui/musicViewController';
import { toWireTrack } from '../ui/wire';
import { track as makeTrack, FakeOutput, MemState, tick } from './fixtures';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-music-view-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

async function setup() {
  const music = fs.mkdtempSync(path.join(root, 'music-'));
  fs.writeFileSync(path.join(music, 'Band - One.mp3'), 'x');
  fs.writeFileSync(path.join(music, 'Band - Two.mp3'), 'x');
  fs.writeFileSync(path.join(music, 'Band - Three.mp3'), 'x');
  const out = new FakeOutput();
  out.becomeReady();
  const library = new Library({
    state: new MemState(),
    cacheFile: path.join(root, 'cache.json'),
    artDir: path.join(root, 'art'),
    extensions: () => ['.mp3'],
  });
  const player = new Player({ output: out, isLiked: (id) => library.isLiked(id), defaultQueue: () => library.tracks });
  await library.addFolder(pathToUri(music));
  const posted: any[] = [];
  const commands: string[] = [];
  const errors: string[] = [];
  const controller = new MusicViewController(
    player,
    library,
    { postMessage: (m) => void posted.push(m) },
    {
      executeCommand: async (cmd) => void commands.push(cmd),
      showErrorMessage: (m) => void errors.push(m),
      artUrl: (key) => `art:${key}`,
    }
  );
  const last = (type: string) => posted.filter((m) => m.type === type).at(-1);
  return { out, library, player, controller, posted, commands, errors, last, folder: pathToUri(music) };
}

test('ready sends every snapshot once, with no filesystem uri on the wire', async () => {
  const { controller, posted, library, player } = await setup();
  await controller.handleMessage({ type: 'ready' });
  assert.deepStrictEqual(posted.map((m) => m.type), ['player', 'queue', 'library', 'liked']);
  const lib = posted[2];
  assert.strictEqual(lib.tracks.length, 3);
  assert.deepStrictEqual(lib.scan, { scanned: 3, total: 3 });
  assert.strictEqual(lib.folders[0].trackCount, 3);
  assert.deepStrictEqual(lib.extensions, ['.mp3']);
  assert.ok(!JSON.stringify(lib.tracks).includes('file://'));
  player.dispose();
  library.dispose();
});

test('toWireTrack maps the cover through artUrl and drops the uri', () => {
  const wire = toWireTrack(makeTrack(1, { artKey: 'abc.jpg', trackNo: 3 }), (k) => `art:${k}`);
  assert.strictEqual(wire.artUrl, 'art:abc.jpg');
  assert.strictEqual(wire.trackNo, 3);
  assert.ok(!('uri' in wire));
  assert.strictEqual(toWireTrack(makeTrack(2), () => 'x').artUrl, undefined);
});

test('playTracks starts at the chosen id; shuffle starts anywhere with shuffle on', async () => {
  const { controller, player, library, out } = await setup();
  const [one, two, three] = library.tracks;
  await controller.handleMessage({ type: 'playTracks', ids: [one.id, two.id, three.id], startId: two.id });
  assert.strictEqual(player.getState().track?.id, two.id);
  out.emit({ type: 'play' });
  assert.strictEqual(player.getState().isPlaying, true);
  await controller.handleMessage({ type: 'playTracks', ids: [one.id, 'local:missing', three.id], startId: 'nope', shuffle: true });
  assert.strictEqual(player.queue.shuffle, true);
  assert.strictEqual(player.queue.length, 2); // unknown ids are dropped
  await controller.handleMessage({ type: 'playTracks', ids: ['local:missing'], startId: 'x' });
  assert.strictEqual(player.queue.length, 2); // nothing playable: untouched
  player.dispose();
  library.dispose();
});

test('transport, like and setup intents reach the Player and Library', async () => {
  const { controller, player, library, commands, errors, last } = await setup();
  const [one] = library.tracks;
  await controller.handleMessage({ type: 'playTracks', ids: library.tracks.map((x) => x.id), startId: one.id });
  await controller.handleMessage({ type: 'seek', positionMs: 30000 });
  assert.strictEqual(player.getState().progressMs, 30000);
  await controller.handleMessage({ type: 'setVolume', volumePercent: 45 });
  assert.strictEqual(player.getState().volume, 45);
  await controller.handleMessage({ type: 'toggleLike', trackId: one.id });
  assert.strictEqual(library.isLiked(one.id), true);
  await controller.handleMessage({ type: 'toggleLike' }); // current track
  assert.strictEqual(library.isLiked(one.id), false);
  controller.sendLiked();
  assert.deepStrictEqual(last('liked').ids, []);
  await controller.handleMessage({ type: 'addFolder' });
  await controller.handleMessage({ type: 'importPlaylist' });
  assert.deepStrictEqual(commands, ['null-music.openLocalFolder', 'null-music.importPlaylist']);
  // audio events belong to WebviewAudioOutput, not the controller: ignored, never an error
  await controller.handleMessage({ type: 'localAudioError', error: 'boom' });
  await controller.handleMessage({ type: 'nonsense' });
  await controller.handleMessage(null);
  await tick();
  assert.deepStrictEqual(errors, []);
  player.dispose();
  library.dispose();
});

test('queue intents jump, remove, reorder and clear by key; reorder is refused while shuffling', async () => {
  const { controller, player, library, last } = await setup();
  await controller.handleMessage({ type: 'playTracks', ids: library.tracks.map((x) => x.id), startId: library.tracks[0].id });
  controller.sendQueue();
  const q = last('queue');
  assert.strictEqual(q.reorderable, true);
  assert.strictEqual(q.upcoming.length, 2);
  const [u1, u2] = q.upcoming;

  await controller.handleMessage({ type: 'queueMove', key: u2.key, beforeKey: u1.key });
  assert.deepStrictEqual(player.queue.snapshot().upcoming.map((e) => e.key), [u2.key, u1.key]);

  await controller.handleMessage({ type: 'queueJump', key: u1.key });
  assert.strictEqual(player.queue.snapshot().current?.key, u1.key);

  await controller.handleMessage({ type: 'toggleShuffle' });
  const before = player.queue.tracks.map((x) => x.id);
  await controller.handleMessage({ type: 'queueMove', key: u2.key, beforeKey: null });
  assert.deepStrictEqual(player.queue.tracks.map((x) => x.id), before);
  await controller.handleMessage({ type: 'toggleShuffle' });

  await controller.handleMessage({ type: 'queueRemove', key: u2.key });
  assert.strictEqual(player.queue.length, 2);
  await controller.handleMessage({ type: 'queueClear' });
  assert.strictEqual(player.queue.length, 0);
  player.dispose();
  library.dispose();
});

test('queue snapshots are only re-sent when the queue actually changed', async () => {
  const { controller, posted, player, library } = await setup();
  await controller.handleMessage({ type: 'playTracks', ids: library.tracks.map((x) => x.id), startId: library.tracks[0].id });
  controller.sendQueue();
  controller.sendQueue(); // e.g. a position tick
  assert.strictEqual(posted.filter((m) => m.type === 'queue').length, 1);
  await controller.handleMessage({ type: 'next' });
  controller.sendQueue();
  assert.strictEqual(posted.filter((m) => m.type === 'queue').length, 2);
  controller.sendAll(); // a reloaded webview always gets a fresh copy
  assert.strictEqual(posted.filter((m) => m.type === 'queue').length, 3);
  player.dispose();
  library.dispose();
});

test('unavailable track ids ride on the player snapshot', async () => {
  const { controller, player, library, out, last } = await setup();
  const [one] = library.tracks;
  await controller.handleMessage({ type: 'playTracks', ids: [one.id], startId: one.id });
  out.emit({ type: 'error', message: 'decode', trackUri: one.uri });
  await tick();
  controller.sendPlayer();
  assert.deepStrictEqual(last('player').unavailable, [one.id]);
  player.dispose();
  library.dispose();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL at compile — `Property 'onDidChangeLikes' does not exist` / `Cannot find module '../ui/wire'`.

- [ ] **Step 3: Library likes event (`src/library/library.ts`)**

Next to `private readonly sourcesEmitter = new Emitter<void>();` add:

```ts
  private readonly likesEmitter = new Emitter<void>();
```

Next to `readonly onDidChangeSources = this.sourcesEmitter.event;` add:

```ts
  /** A like was added or removed (cheap: carries no data, the UI re-reads `likedTracks()`). */
  readonly onDidChangeLikes = this.likesEmitter.event;
```

Replace `toggleLike`:

```ts
  async toggleLike(id: string): Promise<boolean> {
    if (!this.liked.delete(id)) this.liked.add(id);
    await this.options.state.update(KEY_LIKED, [...this.liked]);
    this.likesEmitter.fire();
    return this.liked.has(id);
  }
```

In `dispose()` add `this.likesEmitter.dispose();` after `this.sourcesEmitter.dispose();`.

Also expose the configured extensions (the empty-library state lists them). Next to `get progress()` add:

```ts
  /** Audio extensions the scanner accepts, as configured (e.g. `.mp3`). */
  get supportedExtensions(): string[] {
    return this.options.extensions();
  }
```

- [ ] **Step 4: Create `src/ui/wire.ts`**

```ts
/// <reference path="../webview/music/protocol.ts" />
'use strict';

import * as path from 'path';
import { Library } from '../library/library';
import { Entry, QueueSnapshot } from '../playback/queue';
import { PlaybackState, Track } from '../types';
import { uriToPath } from '../uri';

/** Maps an art-directory file name to a URL the webview may load. */
export type ArtUrl = (artKey: string) => string | undefined;

export function toWireTrack(t: Track, artUrl: ArtUrl): WireTrack {
  return {
    id: t.id,
    name: t.name,
    artist: t.artist,
    album: t.album,
    albumArtist: t.albumArtist,
    trackNo: t.trackNo,
    discNo: t.discNo,
    year: t.year,
    durationMs: t.durationMs,
    artUrl: t.artKey ? artUrl(t.artKey) : undefined,
  };
}

export function toWirePlayerState(s: PlaybackState, artUrl: ArtUrl): WirePlayerState {
  return {
    isPlaying: s.isPlaying,
    track: s.track ? toWireTrack(s.track, artUrl) : null,
    liked: !!s.track?.isLiked,
    progressMs: s.progressMs,
    durationMs: s.durationMs,
    volume: s.volume,
    shuffle: s.shuffle,
    repeat: s.repeat,
    timestamp: s.timestamp,
  };
}

export function toWireQueue(s: QueueSnapshot, shuffle: boolean, artUrl: ArtUrl): Extract<HostToWebview, { type: 'queue' }> {
  const item = (e: Entry): WireQueueItem => ({ key: e.key, track: toWireTrack(e.track, artUrl) });
  return {
    type: 'queue',
    history: s.history.map(item),
    current: s.current ? item(s.current) : null,
    upcoming: s.upcoming.map(item),
    reorderable: !shuffle,
  };
}

export function toWireLibrary(library: Library, artUrl: ArtUrl): Extract<HostToWebview, { type: 'library' }> {
  return {
    type: 'library',
    tracks: library.tracks.map((t) => toWireTrack(t, artUrl)),
    folders: library.folders.map((uri) => ({
      uri,
      name: path.basename(uriToPath(uri)) || uri,
      trackCount: library.tracksInFolder(uri).length,
    })),
    playlists: library.playlists.map((p) => ({ id: p.id, name: p.name, tracks: p.tracks.map((t) => toWireTrack(t, artUrl)) })),
    scan: library.progress,
    extensions: library.supportedExtensions,
  };
}
```

- [ ] **Step 5: Rewrite `src/ui/musicViewController.ts`**

```ts
/// <reference path="../webview/music/protocol.ts" />
'use strict';

import { Library } from '../library/library';
import { Player } from '../playback/player';
import { Track } from '../types';
import { toWireLibrary, toWirePlayerState, toWireQueue } from './wire';

export interface WebviewMessenger {
  postMessage(message: HostToWebview): void | Promise<boolean | void>;
}

export interface WebviewControllerHost {
  executeCommand(command: string, ...args: any[]): Promise<any>;
  showErrorMessage(message: string): void;
  /** Webview-loadable URL for a cover in the art directory. */
  artUrl(artKey: string): string | undefined;
}

/** Translates webview intents into Player/Library calls and publishes snapshots. Audio events go to WebviewAudioOutput, not here. */
export class MusicViewController {
  private lastQueue = '';

  constructor(
    private readonly player: Player,
    private readonly library: Library,
    private readonly messenger: WebviewMessenger,
    private readonly host: WebviewControllerHost
  ) {}

  public async handleMessage(data: any): Promise<void> {
    if (!data || typeof data.type !== 'string') return;
    const msg = data as WebviewToHost;

    try {
      switch (msg.type) {
        case 'ready':
          this.sendAll();
          break;

        case 'playPause':
          await this.player.playPause();
          break;
        case 'previous':
          await this.player.previous();
          break;
        case 'next':
          await this.player.next();
          break;
        case 'seek':
          if (typeof msg.positionMs === 'number') this.player.seek(msg.positionMs);
          break;
        case 'setVolume':
          if (typeof msg.volumePercent === 'number') this.player.setVolume(msg.volumePercent);
          break;
        case 'toggleShuffle':
          this.player.toggleShuffle();
          break;
        case 'toggleRepeat':
          this.player.toggleRepeat();
          break;

        case 'playTracks':
          await this.playTracks(msg);
          break;
        case 'toggleLike': {
          const id = msg.trackId ?? this.player.getState().track?.id;
          if (id) {
            await this.library.toggleLike(id);
            this.player.refresh();
          }
          break;
        }

        case 'queuePlayNext': {
          const t = this.library.trackById(msg.trackId);
          if (t) this.player.playNext(t);
          break;
        }
        case 'queueAdd': {
          const t = this.library.trackById(msg.trackId);
          if (t) this.player.addToQueue(t);
          break;
        }
        case 'queueRemove':
          await this.player.removeFromQueue(msg.key);
          break;
        case 'queueMove':
          // Upcoming order is random while shuffling, so a manual order would mean nothing.
          if (!this.player.queue.shuffle) this.player.moveInQueue(msg.key, msg.beforeKey);
          break;
        case 'queueClear':
          this.player.clearQueue();
          break;
        case 'queueJump':
          await this.player.jump(msg.key);
          break;

        case 'addFolder':
          await this.host.executeCommand('null-music.openLocalFolder');
          break;
        case 'importPlaylist':
          await this.host.executeCommand('null-music.importPlaylist');
          break;
        case 'removeFolder':
          if (msg.uri) await this.library.removeFolder(msg.uri);
          break;
        case 'removePlaylist':
          if (msg.id) await this.library.removePlaylist(msg.id);
          break;
        case 'rescan':
          await this.library.rescan();
          break;
      }
    } catch (err: any) {
      this.host.showErrorMessage(`Null Music: ${err.message || err}`);
    }
  }

  /** A (re)loaded webview starts empty: give it everything, including a fresh copy of the queue. */
  public sendAll(): void {
    this.lastQueue = '';
    this.sendPlayer();
    this.sendQueue();
    this.sendLibrary();
    this.sendLiked();
  }

  public sendPlayer(): void {
    this.messenger.postMessage({
      type: 'player',
      state: toWirePlayerState(this.player.getState(), this.host.artUrl),
      unavailable: [...this.player.unavailable],
    });
  }

  /** Skips the post when nothing the Queue tab shows has changed (position ticks fire constantly). */
  public sendQueue(): void {
    const snapshot = this.player.queue.snapshot();
    const signature = [
      snapshot.history.map((e) => e.key).join(','),
      snapshot.current?.key ?? '',
      snapshot.upcoming.map((e) => e.key).join(','),
      this.player.queue.shuffle,
    ].join('|');
    if (signature === this.lastQueue) return;
    this.lastQueue = signature;
    this.messenger.postMessage(toWireQueue(snapshot, this.player.queue.shuffle, this.host.artUrl));
  }

  public sendLibrary(): void {
    this.messenger.postMessage(toWireLibrary(this.library, this.host.artUrl));
  }

  public sendLiked(): void {
    this.messenger.postMessage({ type: 'liked', ids: this.library.likedTracks().map((t) => t.id) });
  }

  private async playTracks(msg: Extract<WebviewToHost, { type: 'playTracks' }>): Promise<void> {
    if (!Array.isArray(msg.ids)) return;
    const tracks = msg.ids.map((id) => this.library.trackById(id)).filter((t): t is Track => !!t);
    if (tracks.length === 0) return;
    let start = Math.max(0, tracks.findIndex((t) => t.id === msg.startId));
    if (msg.shuffle) {
      if (!this.player.queue.shuffle) this.player.toggleShuffle();
      start = Math.floor(Math.random() * tracks.length);
    }
    await this.player.playTracks(tracks, start);
  }
}
```

Note: `this.host.artUrl` is passed unbound; it is an arrow function in the provider (Step 6), and in tests, so that is fine.

- [ ] **Step 6: Update `src/ui/musicViewProvider.ts` subscriptions**

Replace the constructor's `this.subscriptions.push(...)` block with:

```ts
    this.subscriptions.push(
      this.player.onDidChange(() => {
        this.controller?.sendPlayer();
        this.controller?.sendQueue();
      }),
      this.library.onDidChange(() => this.controller?.sendLibrary()),
      this.library.onDidChangeLikes(() => this.controller?.sendLiked()),
      this.library.onDidChangeSources(() => {
        if (this.view) this.refreshLocalResourceRoots(this.view);
      })
    );
```

(Nothing else changes in this task; `postMessage: (msg) => void webview.postMessage(msg)` already type-checks against `HostToWebview`.)

- [ ] **Step 7: Context-menu commands (`src/ui/commands.ts`)**

After the `null-music.likeCurrentTrack` registration add:

```ts
  // Row context-menu commands: the webview row's data-vscode-context payload arrives as the argument.
  const trackFrom = (ctx: { trackId?: string } | undefined) => (ctx?.trackId ? library.trackById(ctx.trackId) : undefined);
  register('null-music.track.playNext', (ctx) => {
    const t = trackFrom(ctx);
    if (t) player.playNext(t);
  });
  register('null-music.track.addToQueue', (ctx) => {
    const t = trackFrom(ctx);
    if (t) player.addToQueue(t);
  });
  register('null-music.track.favorite', async (ctx) => {
    if (!ctx?.trackId) return;
    await library.toggleLike(ctx.trackId);
    player.refresh();
  });
  register('null-music.track.reveal', async (ctx) => {
    const t = trackFrom(ctx);
    if (t && t.uri.startsWith('file:')) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.parse(t.uri));
  });
```

These four are deliberately **not** added to `NULL_MUSIC_COMMANDS` (that list is the palette-facing set; `commands.test.ts` pins its length at 18).

- [ ] **Step 8: Manifest (`package.json`)**

Append to `contributes.commands`:

```json
      { "command": "null-music.track.playNext", "title": "Null Music: Play Next" },
      { "command": "null-music.track.addToQueue", "title": "Null Music: Add to Queue" },
      { "command": "null-music.track.favorite", "title": "Null Music: Like / Unlike" },
      { "command": "null-music.track.reveal", "title": "Null Music: Reveal in File Explorer" }
```

Add to `contributes.menus` (a sibling of `view/title`):

```json
      "webview/context": [
        { "command": "null-music.track.playNext", "when": "webviewId == 'null.musicView' && webviewSection == 'track'", "group": "1_queue@1" },
        { "command": "null-music.track.addToQueue", "when": "webviewId == 'null.musicView' && webviewSection == 'track'", "group": "1_queue@2" },
        { "command": "null-music.track.favorite", "when": "webviewId == 'null.musicView' && webviewSection == 'track'", "group": "2_library@1" },
        { "command": "null-music.track.reveal", "when": "webviewId == 'null.musicView' && webviewSection == 'track'", "group": "3_file@1" }
      ],
      "commandPalette": [
        { "command": "null-music.track.playNext", "when": "false" },
        { "command": "null-music.track.addToQueue", "when": "false" },
        { "command": "null-music.track.favorite", "when": "false" },
        { "command": "null-music.track.reveal", "when": "false" }
      ]
```

- [ ] **Step 9: Run to verify everything passes**

Run: `npm test`
Expected: PASS. (`musicHtml.test.ts` still passes: the old template is untouched.)

- [ ] **Step 10: Commit**

```bash
git add src/ui/wire.ts src/ui/musicViewController.ts src/ui/musicViewProvider.ts src/ui/commands.ts src/library/library.ts src/test/musicViewProvider.test.ts src/test/library.test.ts package.json
git commit -m "feat(null-music): typed snapshot protocol, likes event and track context-menu commands" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Shell, bundle, theming and the player area

After this task the sidebar loads the new bundle: header title, cover-forward player (cover, scrubber, controls, volume, like), tabs, notices and the `<audio>` driver all work. The tab content area is empty until Tasks 6, 7 and 9 register their views (`tabRenderers`).

**Files:**
- Create: `tsconfig.webview-music.json`, `lib/music.css`, `src/webview/music/{icons,bus,state,rows,audio,player,header,main}.ts`
- Modify: `src/ui/musicHtml.ts` (replace entirely), `src/ui/musicViewProvider.ts`, `package.json` (scripts), `scripts/sync-local.ps1` (`lib` in the null-music copy list), `src/test/musicHtml.test.ts` (replace entirely)
- Generated and committed separately: `lib/music.js`, refreshed `out/`

**Interfaces:**
- Consumes: protocol types (Task 2), `h`, `markText`, `trackContext` (Tasks 2–3), `formatTime`, `placeholderHue`, model (Task 3).
- Produces (webview globals): `send(msg)`, `app` (state), `tabRenderers`, `invalidate(part)`, `setQuery(q)`, `openInLibrary(kind, id)`, `icon(name)`, `iconButton(name, label, onClick, extraClass?)`, `cover(artUrl, seed, cls)`, `trackRow(t, opts)`, `likeButton(id)`, `emptyState(...)`, `textButton(label, onClick, primary?)`, `noLibraryState()`, `noResultsState()`, `hasNoSources()`, `sectionHeading(label)`, `renderChunked(parent, items, makeRow)`, `makeRoving(list)`, `updateRowFlags()`, `showBanner(text)`, `hideBanner()`, `updateScrubber(curMs, durMs)`, `renderPlayer()`, `renderHeader()`, `renderContent()`, `setTab(tab)`, `contentEl`. Host: `getMusicWebviewHtml(nonce, cspSource, scriptUri, styleUri)`.

Extra global-scope rule for this task: never declare a top-level name that is also a `window` property (`name`, `status`, `top`, `parent`, `self`, `history`, `location`, `event`, `length`, `find`, `open`, `close`, `stop`, `focus`, `scroll`, `print`). `const`/`function` with those names either throws or silently replaces browser APIs.

- [ ] **Step 1: Write the failing shell test** (replace the whole of `src/test/musicHtml.test.ts`)

```ts
'use strict';

import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getMusicWebviewHtml } from '../ui/musicHtml';

test('the shell sets a strict CSP, links the bundle and carries no inline script or style', () => {
  const html = getMusicWebviewHtml('test-nonce', 'vscode-webview-resource:', 'vscode:music.js', 'vscode:music.css');
  assert.ok(html.includes("script-src 'nonce-test-nonce'"));
  assert.ok(html.includes('<script nonce="test-nonce" src="vscode:music.js"></script>'));
  assert.ok(html.includes('<link rel="stylesheet" href="vscode:music.css">'));
  assert.ok(html.includes('id="app"'));
  assert.ok(!html.includes("'unsafe-inline'"));
  assert.ok(!html.includes('<style'));
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(html), 'no inline <script>');
  assert.ok(html.split('\n').length < 40, 'the shell stays tiny');
});

test('the compiled bundle keeps the engine audio protocol and the AbortError filter', () => {
  const bundle = path.join(__dirname, '..', '..', 'lib', 'music.js');
  assert.ok(existsSync(bundle), 'run `npm run compile` first');
  const js = readFileSync(bundle, 'utf8');
  for (const message of ['localLoad', 'localPause', 'localResume', 'localSeek', 'localVolume', 'localAudioPlayStarted', 'localAudioEnded']) {
    assert.ok(js.includes(`'${message}'`), `bundle handles ${message}`);
  }
  assert.ok(js.includes("err.name === 'AbortError'"), 'an interrupted play() must not count as a failure');
});
```

Run: `npm test`
Expected: FAIL at compile (`getMusicWebviewHtml` takes 2 arguments).

- [ ] **Step 2: Create `tsconfig.webview-music.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "none",
    "lib": ["ES2017", "DOM"],
    "outFile": "./lib/music.js",
    "strict": true,
    "sourceMap": false,
    "skipLibCheck": true
  },
  "include": [
    "src/webview/music/protocol.ts",
    "src/webview/music/dom.ts",
    "src/webview/music/model.ts",
    "src/webview/music/icons.ts",
    "src/webview/music/bus.ts",
    "src/webview/music/state.ts",
    "src/webview/music/rows.ts",
    "src/webview/music/audio.ts",
    "src/webview/music/player.ts",
    "src/webview/music/header.ts",
    "src/webview/music/main.ts"
  ]
}
```

Order matters (no imports): later tasks insert `queueView.ts`, `libraryView.ts`, `playlistsView.ts` between `player.ts` and `header.ts`.

In `package.json`:
- `"compile"` → `"tsc -p tsconfig.json && tsc -p tsconfig.webview-music-shared.json && tsc -p tsconfig.webview-music.json"`
- in `"test"`, replace `tsc -p tsconfig.webview-music-shared.json && node --test` with `tsc -p tsconfig.webview-music-shared.json && tsc -p tsconfig.webview-music.json && node --test`.

- [ ] **Step 3: Create `src/webview/music/icons.ts`**

```ts
'use strict';

// Hand-drawn 16px stroke icons (codicon style). Check them at 100% zoom in Step 12 and nudge a path if one looks off.
const ICON_PATHS: Record<string, string> = {
  play: '<path d="M4 2.5v11l9-5.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" stroke="none"/>',
  next: '<path d="M3 2.5v11l8-5.5zM12 2.5h1.5v11H12z" fill="currentColor" stroke="none"/>',
  prev: '<path d="M13 2.5v11L5 8zM2.5 2.5H4v11H2.5z" fill="currentColor" stroke="none"/>',
  shuffle: '<path d="M1.5 4.5h2.5c3 0 4 7 7 7h3M1.5 11.5h2.5c1 0 1.8-.8 2.5-1.8M8.5 6c.7-.9 1.5-1.5 2.5-1.5h3M12.5 2.5l2 2-2 2M12.5 9.5l2 2-2 2"/>',
  repeat: '<path d="M3 7V6a2 2 0 0 1 2-2h8M11 1.5l2 2.5-2 2.5M13 9v1a2 2 0 0 1-2 2H3M5 14.5 3 12l2-2.5"/>',
  heart: '<path d="M8 13.5 2.7 8.2a3.1 3.1 0 0 1 4.4-4.4L8 4.7l.9-.9a3.1 3.1 0 0 1 4.4 4.4z"/>',
  volume: '<path d="M2 6v4h2.5L8 13V3L4.5 6zM10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.5 6.5 0 0 1 0 9"/>',
  mute: '<path d="M2 6v4h2.5L8 13V3L4.5 6zM10.5 6l4 4M14.5 6l-4 4"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 4 4"/>',
  more: '<circle cx="3" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="13" cy="8" r="1" fill="currentColor"/>',
  back: '<path d="M10 2.5 4.5 8 10 13.5"/>',
  close: '<path d="m3.5 3.5 9 9M12.5 3.5l-9 9"/>',
  warning: '<path d="M8 2 14.5 13.5h-13zM8 6.5v3.5M8 11.8v.4"/>',
  folder: '<path d="M1.5 3.5h4l1.5 1.5h7.5v7.5h-13z"/>',
  list: '<path d="M2 4h12M2 8h12M2 12h8"/>',
  note: '<path d="M6 12.5V3l7-1.5V11M8 12.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM15 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  disc: '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1.5"/>',
  user: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.5-3 2.5-4 5-4s4.5 1 5 4"/>',
};

function icon(name: string): HTMLElement {
  const span = h('span', { class: 'np-icon', 'aria-hidden': 'true' });
  // The one place markup is parsed: a static constant from the table above, never data.
  span.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" ' +
    'stroke-linecap="round" stroke-linejoin="round" focusable="false">' + (ICON_PATHS[name] || '') + '</svg>';
  return span;
}

function iconButton(name: string, label: string, onClick: () => void, extraClass?: string): HTMLButtonElement {
  const b = h('button', { class: 'np-btn' + (extraClass ? ' ' + extraClass : ''), type: 'button', 'aria-label': label, title: label }, icon(name)) as HTMLButtonElement;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
```

- [ ] **Step 4: Create `src/webview/music/bus.ts` and `state.ts`**

`bus.ts`:

```ts
'use strict';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscodeApi = acquireVsCodeApi(); // may be called only once per webview

/** The only way the webview talks to the host; the union makes a renamed message a compile error. */
function send(msg: WebviewToHost): void {
  vscodeApi.postMessage(msg);
}
```

`state.ts`:

```ts
'use strict';

type TabId = 'queue' | 'library' | 'playlists';
type Segment = 'tracks' | 'albums' | 'artists';
type Detail = { kind: 'album' | 'artist'; id: string };

/** The webview's copy of the host snapshots, plus UI-only state. Views read this and never mutate the snapshot half. */
const app = {
  player: null as WirePlayerState | null,
  unavailable: new Set<string>(),
  unavailableKey: '',
  queue: { history: [] as WireQueueItem[], current: null as WireQueueItem | null, upcoming: [] as WireQueueItem[], reorderable: true },
  tracks: [] as WireTrack[],
  byId: new Map<string, WireTrack>(),
  folders: [] as WireFolder[],
  playlists: [] as WirePlaylist[],
  scan: { scanned: 0, total: 0 },
  extensions: [] as string[],
  liked: new Set<string>(),
  libraryLoaded: false,
  // UI-only
  tab: 'queue' as TabId,
  segment: 'tracks' as Segment,
  likedOnly: false,
  sort: 'title' as SortKey,
  query: '',
  libraryDetail: null as Detail | null,
  playlistId: null as string | null,
  showFolders: false,
  historyOpen: false,
  /** Scroll offset saved when a detail view opens, and whether the next render of the list should go back to it. */
  detailScroll: 0,
  restoreScroll: false,
};

/** Each tab's view registers itself here (at the bottom of its file); main.ts calls the active one. */
const tabRenderers: Partial<Record<TabId, (el: HTMLElement) => void>> = {};

const dirty = { player: false, header: false, content: false };
let flushQueued = false;

/** Coalesces renders into one animation frame (frames are also skipped while the view is hidden). */
function invalidate(part: 'player' | 'header' | 'content'): void {
  dirty[part] = true;
  if (flushQueued) return;
  flushQueued = true;
  requestAnimationFrame(() => {
    flushQueued = false;
    if (dirty.player) {
      dirty.player = false;
      renderPlayer();
    }
    if (dirty.header) {
      dirty.header = false;
      renderHeader();
    }
    if (dirty.content) {
      dirty.content = false;
      renderContent();
    }
  });
}

function setQuery(query: string): void {
  app.query = query;
  invalidate('header'); // keeps the search box in sync when a view clears the query
  invalidate('content');
}

/** Jump from the player's artist/album text into the Library detail view. */
function openInLibrary(kind: 'album' | 'artist', id: string): void {
  app.query = '';
  app.libraryDetail = { kind, id };
  app.segment = kind === 'album' ? 'albums' : 'artists';
  app.showFolders = false;
  setTab('library');
}
```

- [ ] **Step 5: Create `src/webview/music/rows.ts`**

```ts
'use strict';

/** Square cover, or the ∅ placeholder tinted from `seed` when there is no art (or it fails to load). */
function cover(artUrl: string | undefined, seed: string, cls: string): HTMLElement {
  const box = h('div', { class: 'np-cover ' + cls });
  const placeholder = () => {
    box.classList.add('np-cover-ph');
    box.style.setProperty('--hue', String(placeholderHue(seed)));
    box.replaceChildren(h('span', { class: 'np-ph-mark', 'aria-hidden': 'true' }, '∅'));
  };
  if (artUrl) {
    const img = h('img', { src: artUrl, alt: '', loading: 'lazy', draggable: 'false' });
    img.addEventListener('error', placeholder);
    box.appendChild(img);
  } else {
    placeholder();
  }
  return box;
}

function likeButton(trackId: string): HTMLButtonElement {
  return iconButton('heart', 'Like', () => send({ type: 'toggleLike', trackId }), 'np-like');
}

interface RowOptions {
  /** Search text to highlight in the title/artist. */
  query?: string;
  onPlay: () => void;
  /** Queue rows: the stable entry key (also decides "playing" for that row). */
  key?: number;
  /** Extra trailing controls (e.g. the queue's remove button). */
  extra?: HTMLElement[];
}

function trackRow(t: WireTrack, o: RowOptions): HTMLElement {
  const q = o.query || '';
  const row = h(
    'div',
    {
      class: 'np-row',
      role: 'option',
      tabindex: -1,
      'data-row': true,
      'data-track-id': t.id,
      'data-key': o.key === undefined ? null : o.key,
      'data-vscode-context': trackContext(t.id),
    },
    h('div', { class: 'np-thumb-wrap' }, cover(t.artUrl, t.album || t.name, 'np-thumb'), h('span', { class: 'np-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))),
    h('div', { class: 'np-row-text' }, h('div', { class: 'np-row-title' }, ...markText(t.name, q)), h('div', { class: 'np-row-sub' }, ...markText(t.artist || 'Unknown artist', q))),
    h('span', { class: 'np-warn', title: 'This file could not be played' }, icon('warning')),
    h('span', { class: 'np-row-time' }, formatTime(t.durationMs)),
    likeButton(t.id),
    ...(o.extra || [])
  );
  row.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    o.onPlay();
  });
  return row;
}

function emptyState(iconName: string, title: string, body: string, actions: HTMLElement[] = []): HTMLElement {
  return h('div', { class: 'np-empty' }, icon(iconName), h('div', { class: 'np-empty-title' }, title), body ? h('div', { class: 'np-empty-body' }, body) : null, actions.length ? h('div', { class: 'np-empty-actions' }, ...actions) : null);
}

/** True until the user has added a folder or playlist (and the first library snapshot has arrived). */
function hasNoSources(): boolean {
  return app.libraryLoaded && app.folders.length === 0 && app.playlists.length === 0;
}

function noLibraryState(): HTMLElement {
  return emptyState('note', 'Add a music folder', 'Null Music plays audio files from folders on this computer, and .m3u8 playlists.', [
    textButton('Add folder', () => send({ type: 'addFolder' }), true),
    textButton('Import playlist', () => send({ type: 'importPlaylist' })),
  ]);
}

function noResultsState(): HTMLElement {
  return emptyState('search', 'No matches', 'Nothing here matches "' + app.query.trim() + '".', [textButton('Clear search', () => setQuery(''))]);
}

function sectionHeading(label: string): HTMLElement {
  return h('div', { class: 'np-section', role: 'presentation' }, label);
}

const CHUNK = 200;
const ROW_PX = 40;
/** Scroll offset the current render will be restored to; lets chunked lists render enough rows to reach it. */
let wantedScroll = 0;

/**
 * Appends `items` to `parent` CHUNK rows at a time, adding the next chunk as a sentinel scrolls near the view.
 * // ponytail: no virtualisation, so a 10k-track list ends up with 10k rows once scrolled to the bottom; add windowing if that lags.
 */
function renderChunked<T>(parent: HTMLElement, items: T[], makeRow: (item: T) => HTMLElement): void {
  let shown = 0;
  const sentinel = h('div', { class: 'np-more', 'aria-hidden': 'true' });
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) more(CHUNK);
    },
    { root: contentEl, rootMargin: '200px' }
  );
  function more(count: number): void {
    const next = items.slice(shown, shown + count);
    shown += next.length;
    const fragment = document.createDocumentFragment();
    for (const item of next) fragment.appendChild(makeRow(item));
    parent.insertBefore(fragment, sentinel);
    if (shown >= items.length) {
      observer.disconnect();
      sentinel.remove();
    } else {
      observer.unobserve(sentinel);
      observer.observe(sentinel); // re-fires while the sentinel is still on screen
    }
    updateRowFlags();
  }
  parent.appendChild(sentinel);
  more(Math.max(CHUNK, Math.ceil((wantedScroll + contentEl.clientHeight) / ROW_PX) + CHUNK / 2));
}

function textButton(label: string, onClick: () => void, primary?: boolean): HTMLButtonElement {
  const b = h('button', { class: 'np-text-btn' + (primary ? ' primary' : ''), type: 'button' }, label) as HTMLButtonElement;
  b.addEventListener('click', onClick);
  return b;
}

/** Roving tabindex: one row is tabbable, ↑/↓ move focus, Enter activates. Alt+arrows are left for reordering. */
function makeRoving(list: HTMLElement): void {
  const rows = () => Array.prototype.slice.call(list.querySelectorAll('[data-row]')) as HTMLElement[];
  const first = rows()[0];
  if (first) first.tabIndex = 0;
  list.addEventListener('focusin', (e) => {
    const target = e.target as HTMLElement;
    if (!target.hasAttribute('data-row')) return;
    for (const r of rows()) r.tabIndex = r === target ? 0 : -1;
  });
  list.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (!target.hasAttribute('data-row')) return;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey) {
      e.preventDefault();
      const all = rows();
      const next = all[Math.max(0, Math.min(all.length - 1, all.indexOf(target) + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) next.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      target.click();
    }
  });
}

/** Cheap in-place refresh of "playing", "unavailable" and the like toggles after a snapshot, without re-rendering lists. */
function updateRowFlags(): void {
  const s = app.player;
  const currentId = s && s.track ? s.track.id : '';
  const currentKey = app.queue.current ? String(app.queue.current.key) : '';
  document.querySelectorAll('[data-track-id]').forEach((node) => {
    const row = node as HTMLElement;
    const id = row.getAttribute('data-track-id') || '';
    const key = row.getAttribute('data-key');
    row.classList.toggle('playing', key !== null ? key === currentKey : id === currentId);
    row.classList.toggle('unavailable', app.unavailable.has(id));
    const like = row.querySelector('.np-like');
    if (like) like.setAttribute('aria-pressed', String(app.liked.has(id)));
  });
}
```

- [ ] **Step 6: Create `src/webview/music/audio.ts`** (the `<audio>` driver, ported from the old template with the same message names)

```ts
'use strict';

const audio = h('audio', { id: 'audio-player', preload: 'auto' }) as HTMLAudioElement;
let audioTrackUri: string | undefined;
let pendingSeekMs = 0;
let lastTimePost = 0;

const bannerText = h('span', { class: 'np-banner-text' });
const bannerEl = h('div', { class: 'np-banner', role: 'status', hidden: true }, bannerText, iconButton('close', 'Dismiss', () => hideBanner()));
const autoplayEl = h('button', { class: 'np-autoplay', type: 'button', hidden: true }, 'Click here to start playback');

function showBanner(text: string): void {
  bannerText.textContent = text;
  bannerEl.hidden = false;
}

function hideBanner(): void {
  bannerEl.hidden = true;
}

/** Start playback; report real failures, but not a play() that a pause() or a new load interrupted. */
function startPlayback(trackUri: string | undefined): void {
  const promise = audio.play();
  if (promise === undefined) return;
  promise.catch((err: any) => {
    if (err.name === 'AbortError') return;
    const blocked = err.name === 'NotAllowedError';
    if (blocked) autoplayEl.hidden = false;
    else showBanner('Audio play failed: ' + err.message);
    send({ type: 'localAudioPlayFailed', error: err.name + ': ' + err.message, trackUri, silent: blocked });
  });
}

function durationMsOfAudio(): number {
  return Math.round((audio.duration || 0) * 1000) || (app.player ? app.player.durationMs : 0);
}

function initAudio(): void {
  autoplayEl.addEventListener('click', () => {
    audio.play().then(() => {
      autoplayEl.hidden = true;
    }).catch((err: any) => showBanner('Play failed: ' + err.message));
  });

  audio.addEventListener('play', () => {
    hideBanner();
    autoplayEl.hidden = true;
    send({ type: 'localAudioPlayStarted' });
  });
  audio.addEventListener('pause', () => {
    send({ type: 'localAudioPaused', positionMs: Math.round(audio.currentTime * 1000), trackUri: audioTrackUri });
  });
  audio.addEventListener('timeupdate', () => {
    const cur = Math.round(audio.currentTime * 1000);
    if (!scrubDragging) updateScrubber(cur, durationMsOfAudio());
    const now = Date.now();
    if (now - lastTimePost > 1500) {
      lastTimePost = now;
      send({ type: 'localAudioTimeUpdate', positionMs: cur, trackUri: audioTrackUri });
    }
  });
  audio.addEventListener('loadedmetadata', () => {
    if (pendingSeekMs > 0) {
      audio.currentTime = pendingSeekMs / 1000;
      pendingSeekMs = 0;
    }
    send({ type: 'localAudioDuration', durationMs: Math.round(audio.duration * 1000), trackUri: audioTrackUri });
  });
  audio.addEventListener('ended', () => send({ type: 'localAudioEnded', trackUri: audioTrackUri }));
  audio.addEventListener('error', () => {
    const err = audio.error;
    let msg = 'Failed to load audio file';
    if (err) {
      if (err.code === 1) msg = 'Audio loading was aborted';
      else if (err.code === 2) msg = 'Network or filesystem error loading audio';
      else if (err.code === 3) msg = 'Audio decode error: format unsupported or file corrupted';
      else if (err.code === 4) msg = 'Audio source not supported or file inaccessible';
    }
    showBanner(msg);
    send({ type: 'localAudioError', error: msg, trackUri: audioTrackUri });
  });
}

/** Commands from WebviewAudioOutput on the host. */
function handleAudioMessage(msg: HostToWebview): void {
  switch (msg.type) {
    case 'localLoad':
      audioTrackUri = msg.trackUri;
      pendingSeekMs = msg.startMs > 0 ? msg.startMs : 0;
      hideBanner();
      if (msg.uri) {
        if (audio.src !== msg.uri) {
          audio.src = msg.uri;
        } else {
          audio.currentTime = pendingSeekMs / 1000;
          pendingSeekMs = 0;
        }
        if (msg.autoplay) startPlayback(msg.trackUri);
      }
      break;
    case 'localPause':
      audio.pause();
      break;
    case 'localResume':
      startPlayback(audioTrackUri);
      break;
    case 'localSeek':
      audio.currentTime = msg.positionMs / 1000;
      break;
    case 'localVolume':
      audio.volume = Math.max(0, Math.min(1, msg.volumePercent / 100));
      break;
  }
}

```

- [ ] **Step 7: Create `src/webview/music/player.ts`** (cover, title, scrubber, transport, volume)

```ts
'use strict';

const SEEK_STEP_MS = 5000;
let scrubDragging = false;
let renderedCoverKey = '\u0000';
let scrubbedTrackId = '';
let premuteVolume = 60;

const REPEAT_LABEL = { off: 'off', context: 'all', track: 'one' };

const coverSlot = h('div', { class: 'np-cover-slot' });
const titleEl = h('div', { class: 'np-title' }, 'Nothing playing');
const likeBtn = iconButton('heart', 'Like', () => send({ type: 'toggleLike' }), 'np-like');
const artistBtn = h('button', { class: 'np-link', type: 'button' });
const sepEl = h('span', { class: 'np-sep', 'aria-hidden': 'true' }, ' · ');
const albumBtn = h('button', { class: 'np-link', type: 'button' });
const announcer = h('div', { class: 'np-sr-only', 'aria-live': 'polite' });

const timeCur = h('span', { class: 'np-time' }, '0:00');
const timeDur = h('span', { class: 'np-time' }, '0:00');
const scrubFill = h('div', { class: 'np-scrub-fill' });
const scrubHandle = h('div', { class: 'np-scrub-handle' });
const scrub = h(
  'div',
  { class: 'np-scrub', role: 'slider', tabindex: 0, 'aria-label': 'Seek', 'aria-valuemin': 0, 'aria-valuemax': 0, 'aria-valuenow': 0 },
  h('div', { class: 'np-scrub-bar' }, scrubFill, scrubHandle)
);

const shuffleBtn = iconButton('shuffle', 'Shuffle', () => send({ type: 'toggleShuffle' }));
const prevBtn = iconButton('prev', 'Previous', () => send({ type: 'previous' }));
const playBtn = iconButton('play', 'Play', () => send({ type: 'playPause' }), 'np-play');
const nextBtn = iconButton('next', 'Next', () => send({ type: 'next' }));
const repeatBtn = iconButton('repeat', 'Repeat', () => send({ type: 'toggleRepeat' }), 'np-repeat');
const muteBtn = iconButton('volume', 'Mute', () => {
  const v = app.player ? app.player.volume : 0;
  if (v > 0) premuteVolume = v;
  send({ type: 'setVolume', volumePercent: v > 0 ? 0 : premuteVolume });
});
const volumeInput = h('input', { class: 'np-volume', type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Volume' }) as HTMLInputElement;
volumeInput.addEventListener('input', () => send({ type: 'setVolume', volumePercent: Number(volumeInput.value) }));

artistBtn.addEventListener('click', () => {
  const t = app.player && app.player.track;
  if (t) openInLibrary('artist', artistKeyOf(t));
});
albumBtn.addEventListener('click', () => {
  const t = app.player && app.player.track;
  if (t) openInLibrary('album', albumKeyOf(t));
});

const playerEl = h(
  'section',
  { class: 'np-player np-loading', 'aria-label': 'Now playing' },
  coverSlot,
  h('div', { class: 'np-meta' }, h('div', { class: 'np-title-row' }, titleEl, likeBtn), h('div', { class: 'np-sub' }, artistBtn, sepEl, albumBtn)),
  h('div', { class: 'np-scrub-row' }, timeCur, scrub, timeDur),
  h('div', { class: 'np-controls' }, shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn),
  h('div', { class: 'np-volume-row' }, muteBtn, volumeInput),
  announcer
);

function currentDurationMs(): number {
  return durationMsOfAudio();
}

function updateScrubber(curMs: number, durMs: number): void {
  const pct = durMs > 0 ? Math.max(0, Math.min(100, (curMs / durMs) * 100)) : 0;
  scrubFill.style.width = pct + '%';
  scrubHandle.style.left = pct + '%';
  timeCur.textContent = formatTime(curMs);
  timeDur.textContent = formatTime(durMs);
  scrub.setAttribute('aria-valuemax', String(Math.round(durMs / 1000)));
  scrub.setAttribute('aria-valuenow', String(Math.round(curMs / 1000)));
  scrub.setAttribute('aria-valuetext', formatTime(curMs) + ' of ' + formatTime(durMs));
}

function scrubTargetMs(clientX: number): number {
  const rect = scrub.getBoundingClientRect();
  const pct = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
  return Math.round(pct * currentDurationMs());
}

scrub.addEventListener('pointerdown', (e: PointerEvent) => {
  if (!currentDurationMs()) return;
  scrubDragging = true;
  scrub.setPointerCapture(e.pointerId);
  scrub.classList.add('dragging');
  updateScrubber(scrubTargetMs(e.clientX), currentDurationMs());
});
scrub.addEventListener('pointermove', (e: PointerEvent) => {
  if (scrubDragging) updateScrubber(scrubTargetMs(e.clientX), currentDurationMs());
});
scrub.addEventListener('pointerup', (e: PointerEvent) => {
  if (!scrubDragging) return;
  scrubDragging = false;
  scrub.classList.remove('dragging');
  send({ type: 'seek', positionMs: scrubTargetMs(e.clientX) });
});
scrub.addEventListener('pointercancel', () => {
  scrubDragging = false;
  scrub.classList.remove('dragging');
});
scrub.addEventListener('keydown', (e: KeyboardEvent) => {
  const dur = currentDurationMs();
  if (!dur) return;
  const pos = Math.round(audio.currentTime * 1000);
  let target: number | null = null;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') target = pos - SEEK_STEP_MS;
  else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') target = pos + SEEK_STEP_MS;
  else if (e.key === 'Home') target = 0;
  else if (e.key === 'End') target = dur;
  if (target === null) return;
  e.preventDefault();
  send({ type: 'seek', positionMs: Math.max(0, Math.min(dur, target)) });
});

function renderPlayer(): void {
  const s = app.player;
  if (!s) return; // keep the skeleton until the first snapshot arrives
  playerEl.classList.remove('np-loading');
  document.body.classList.toggle('np-is-playing', s.isPlaying);
  const t = s.track;

  const coverKey = t ? t.id + '|' + (t.artUrl || '') : '';
  if (coverKey !== renderedCoverKey) {
    renderedCoverKey = coverKey;
    coverSlot.replaceChildren(cover(t ? t.artUrl : undefined, t ? t.album || t.name : 'null', 'np-cover-main'));
    announcer.textContent = t ? 'Now playing: ' + t.name + (t.artist ? ' by ' + t.artist : '') : '';
  }

  titleEl.textContent = t ? t.name : 'Nothing playing';
  titleEl.title = t ? t.name : '';
  artistBtn.textContent = t ? t.artist || 'Unknown artist' : '';
  artistBtn.hidden = !t;
  albumBtn.textContent = t ? t.album : '';
  albumBtn.hidden = !t || !t.album;
  sepEl.hidden = albumBtn.hidden || artistBtn.hidden;

  likeBtn.disabled = !t;
  likeBtn.setAttribute('aria-pressed', String(s.liked));

  shuffleBtn.setAttribute('aria-pressed', String(s.shuffle));
  repeatBtn.setAttribute('aria-pressed', String(s.repeat !== 'off'));
  repeatBtn.setAttribute('data-mode', s.repeat);
  repeatBtn.setAttribute('aria-label', 'Repeat: ' + REPEAT_LABEL[s.repeat]);
  repeatBtn.title = 'Repeat: ' + REPEAT_LABEL[s.repeat];

  const nothingToPlay = !t && app.tracks.length === 0;
  playBtn.disabled = nothingToPlay;
  playBtn.title = nothingToPlay ? 'Add a music folder first' : s.isPlaying ? 'Pause' : 'Play';
  playBtn.setAttribute('aria-label', s.isPlaying ? 'Pause' : 'Play');
  playBtn.replaceChildren(icon(s.isPlaying ? 'pause' : 'play'));
  prevBtn.disabled = nextBtn.disabled = !t;

  if (document.activeElement !== volumeInput) volumeInput.value = String(s.volume);
  muteBtn.replaceChildren(icon(s.volume === 0 ? 'mute' : 'volume'));
  muteBtn.setAttribute('aria-label', s.volume === 0 ? 'Unmute' : 'Mute');
  muteBtn.title = s.volume === 0 ? 'Unmute' : 'Mute';

  // While playing, the audio element's timeupdate drives the scrubber; a snapshot only seeds it on a track change or when paused.
  const trackId = t ? t.id : '';
  if (!scrubDragging && (!s.isPlaying || scrubbedTrackId !== trackId)) updateScrubber(s.progressMs, s.durationMs);
  scrubbedTrackId = trackId;
}
```

- [ ] **Step 8: Create `src/webview/music/header.ts`** (title only for now; Task 10 adds the scan pill, search and menu)

```ts
'use strict';

const headerEl = h('header', { class: 'np-header' }, h('div', { class: 'np-brand' }, h('span', { class: 'np-brand-mark', 'aria-hidden': 'true' }, '∅'), 'Music'));

function renderHeader(): void {
  // Nothing dynamic yet; Task 10 fills this in.
}
```

- [ ] **Step 9: Create `src/webview/music/main.ts`**

```ts
'use strict';

const contentEl = h('main', { class: 'np-content', id: 'np-content', role: 'tabpanel', tabindex: -1 });
const TABS: Array<[TabId, string]> = [
  ['queue', 'Queue'],
  ['library', 'Library'],
  ['playlists', 'Playlists'],
];
const tabButtons: { [id: string]: HTMLElement } = {};
const tabsEl = h('nav', { class: 'np-tabs', role: 'tablist', 'aria-label': 'Music sections' });
for (const [id, label] of TABS) {
  const b = h('button', { class: 'np-tab', type: 'button', role: 'tab', id: 'np-tab-' + id }, label);
  b.addEventListener('click', () => setTab(id));
  tabButtons[id] = b;
  tabsEl.appendChild(b);
}
tabsEl.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const at = TABS.findIndex((t) => t[0] === app.tab);
  const next = TABS[(at + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
  e.preventDefault();
  setTab(next);
  tabButtons[next].focus();
});

function setTab(tab: TabId): void {
  app.tab = tab;
  for (const [id] of TABS) {
    const selected = id === tab;
    tabButtons[id].setAttribute('aria-selected', String(selected));
    tabButtons[id].tabIndex = selected ? 0 : -1;
  }
  contentEl.setAttribute('aria-labelledby', 'np-tab-' + tab);
  invalidate('content');
}

let lastViewKey = '';

function viewKey(): string {
  const detail = app.libraryDetail ? app.libraryDetail.kind + ':' + app.libraryDetail.id : '';
  return [app.tab, app.segment, detail, app.playlistId || '', app.showFolders ? 'folders' : ''].join('|');
}

/** Re-renders the active view, keeping the scroll position when it is the same view (or restoring it after "back"). */
function renderContent(): void {
  const key = viewKey();
  wantedScroll = key === lastViewKey ? contentEl.scrollTop : app.restoreScroll ? app.detailScroll : 0;
  lastViewKey = key;
  app.restoreScroll = false;
  const render = tabRenderers[app.tab];
  if (render) render(contentEl);
  contentEl.scrollTop = wantedScroll;
  updateRowFlags();
}

function trackIdOf(s: WirePlayerState | null): string {
  return s && s.track ? s.track.id : '';
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as HostToWebview;
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'player': {
      const previous = app.player;
      const unavailableKey = msg.unavailable.join(',');
      const flagsChanged = trackIdOf(previous) !== trackIdOf(msg.state) || unavailableKey !== app.unavailableKey;
      app.player = msg.state;
      app.unavailable = new Set(msg.unavailable);
      app.unavailableKey = unavailableKey;
      invalidate('player');
      if (flagsChanged) updateRowFlags();
      break;
    }
    case 'queue':
      app.queue = { history: msg.history, current: msg.current, upcoming: msg.upcoming, reorderable: msg.reorderable };
      if (app.tab === 'queue') invalidate('content');
      break;
    case 'library':
      app.tracks = msg.tracks;
      app.byId = new Map(msg.tracks.map((t): [string, WireTrack] => [t.id, t]));
      app.folders = msg.folders;
      app.playlists = msg.playlists;
      app.scan = msg.scan;
      app.extensions = msg.extensions;
      app.libraryLoaded = true;
      invalidate('player');
      invalidate('header');
      invalidate('content');
      break;
    case 'liked':
      app.liked = new Set(msg.ids);
      updateRowFlags();
      if (app.likedOnly) invalidate('content');
      break;
    default:
      handleAudioMessage(msg);
  }
});

window.addEventListener('keydown', (e: KeyboardEvent) => {
  const target = e.target as HTMLElement;
  const role = target.getAttribute('role');
  const interactive = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].indexOf(target.tagName) >= 0 || role === 'slider' || role === 'tab';
  if (e.code === 'Space' && !interactive && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    send({ type: 'playPause' });
  }
});

const appRoot = document.getElementById('app') as HTMLElement;
appRoot.append(headerEl, playerEl, tabsEl, contentEl, bannerEl, autoplayEl, audio);
initAudio();
setTab('queue');
send({ type: 'ready' });
```

- [ ] **Step 10: Create `lib/music.css`** (hand-written; the only hand-edited file in `lib/`)

```css
:root {
  --np-fg: var(--vscode-foreground);
  --np-muted: var(--vscode-descriptionForeground);
  --np-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --np-hover: var(--vscode-list-hoverBackground);
  --np-selected: var(--vscode-list-inactiveSelectionBackground);
  --np-border: var(--vscode-widget-border, var(--vscode-panel-border, transparent));
  --np-accent: var(--vscode-focusBorder);
  --np-button-bg: var(--vscode-button-background);
  --np-button-fg: var(--vscode-button-foreground);
  --np-button-hover: var(--vscode-button-hoverBackground);
  --np-input-bg: var(--vscode-input-background);
  --np-contrast: var(--vscode-contrastBorder, transparent);
}

* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; padding: 0; overflow: hidden; color: var(--np-fg); background: var(--np-bg); font: var(--vscode-font-size, 13px) var(--vscode-font-family, sans-serif); }
#app { display: flex; flex-direction: column; height: 100vh; min-width: 220px; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
button:disabled { opacity: 0.4; cursor: default; }
:focus-visible { outline: 1px solid var(--np-accent); outline-offset: -1px; }
[hidden] { display: none !important; }
mark { background: var(--vscode-editor-findMatchHighlightBackground); color: inherit; border-radius: 2px; }
.np-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* icons and buttons */
.np-icon { display: inline-flex; width: 16px; height: 16px; flex: none; }
.np-icon svg { display: block; }
.np-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 24px; border-radius: 4px; color: var(--np-muted); }
.np-btn:hover:not(:disabled) { color: var(--np-fg); background: var(--np-hover); }
.np-btn[aria-pressed='true'] { color: var(--np-accent); }
.np-like[aria-pressed='true'] { color: var(--vscode-charts-red); }
.np-like[aria-pressed='true'] svg path { fill: currentColor; }
.np-text-btn { padding: 4px 10px; border-radius: 3px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.np-text-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.np-text-btn.primary { background: var(--np-button-bg); color: var(--np-button-fg); }
.np-text-btn.primary:hover { background: var(--np-button-hover); }
.np-link { color: var(--np-muted); text-decoration: none; max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-link:hover:not(:disabled) { color: var(--np-fg); text-decoration: underline; }

/* header */
.np-header { display: flex; align-items: center; gap: 6px; padding: 6px 8px; min-height: 34px; flex: none; }
.np-brand { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; font-weight: 600; }
.np-brand-mark { font-size: 16px; line-height: 1; }

/* player */
.np-player { display: flex; flex-direction: column; gap: 6px; padding: 4px 12px 8px; flex: none; }
.np-loading .np-cover-slot { animation: np-pulse 1.4s ease-in-out infinite; }
.np-loading .np-meta, .np-loading .np-controls, .np-loading .np-volume-row { opacity: 0.4; pointer-events: none; }
.np-cover-slot { display: flex; justify-content: center; }
.np-cover { position: relative; overflow: hidden; flex: none; border-radius: 6px; background: var(--np-hover); }
.np-cover img { display: block; width: 100%; height: 100%; object-fit: cover; transition: opacity 0.2s; }
.np-cover-main { width: min(100%, 35vh); aspect-ratio: 1; }
.np-cover-ph { display: flex; align-items: center; justify-content: center; background: hsl(var(--hue, 220) 30% 28%); color: hsl(var(--hue, 220) 40% 78%); }
.np-cover-main .np-ph-mark { font-size: 64px; }
.np-thumb .np-ph-mark, .np-ph-mark { font-size: 16px; line-height: 1; }
.np-cover-main .np-ph-mark { font-size: 64px; }
.np-title-row { display: flex; align-items: center; gap: 4px; }
.np-title { flex: 1; min-width: 0; font-weight: 600; font-size: 1.1em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-sub { display: flex; align-items: baseline; gap: 4px; min-width: 0; color: var(--np-muted); }
.np-scrub-row { display: flex; align-items: center; gap: 8px; }
.np-time { min-width: 3ch; color: var(--np-muted); font-size: 0.9em; font-variant-numeric: tabular-nums; }
.np-scrub { position: relative; display: flex; align-items: center; flex: 1; height: 24px; cursor: pointer; touch-action: none; }
.np-scrub-bar { position: relative; width: 100%; height: 4px; border-radius: 2px; background: var(--vscode-scrollbarSlider-background, var(--np-hover)); }
.np-scrub-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: 2px; background: var(--np-accent); }
.np-scrub-handle { position: absolute; top: 50%; left: 0; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--np-fg); opacity: 0; }
.np-scrub:hover .np-scrub-handle, .np-scrub:focus-visible .np-scrub-handle, .np-scrub.dragging .np-scrub-handle { opacity: 1; }
.np-controls { display: flex; align-items: center; justify-content: center; gap: 12px; }
.np-play { width: 36px; height: 36px; border-radius: 50%; background: var(--np-button-bg); color: var(--np-button-fg); }
.np-play:hover:not(:disabled) { background: var(--np-button-hover); color: var(--np-button-fg); }
.np-repeat[data-mode='track']::after { content: '1'; position: absolute; right: 1px; bottom: 0; font-size: 9px; font-weight: 700; }
.np-volume-row { display: flex; align-items: center; gap: 8px; }
.np-volume { flex: 1; min-width: 0; accent-color: var(--np-accent); }

/* tabs and content */
.np-tabs { display: flex; flex: none; border-bottom: 1px solid var(--np-border); }
.np-tab { flex: 1; padding: 6px 4px; border-bottom: 2px solid transparent; color: var(--np-muted); }
.np-tab:hover { color: var(--np-fg); }
.np-tab[aria-selected='true'] { color: var(--np-fg); border-bottom-color: var(--np-accent); }
.np-content { flex: 1; min-height: 0; overflow-y: auto; }

/* rows */
.np-row { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 8px; cursor: pointer; }
.np-row:hover { background: var(--np-hover); }
.np-row.playing { background: var(--np-selected); }
.np-row.unavailable { opacity: 0.55; }
.np-thumb-wrap { position: relative; flex: none; width: 32px; height: 32px; }
.np-thumb { width: 32px; height: 32px; border-radius: 3px; }
.np-eq { position: absolute; inset: 0; display: none; align-items: flex-end; justify-content: center; gap: 2px; padding: 7px; border-radius: 3px; background: color-mix(in srgb, var(--np-bg) 60%, transparent); }
.np-row.playing .np-eq { display: flex; }
.np-eq i { width: 3px; height: 100%; background: var(--np-fg); transform-origin: bottom; animation: np-bounce 0.9s ease-in-out infinite; animation-play-state: paused; }
.np-is-playing .np-eq i { animation-play-state: running; }
.np-eq i:nth-child(2) { animation-delay: -0.3s; }
.np-eq i:nth-child(3) { animation-delay: -0.6s; }
.np-row-text { flex: 1; min-width: 0; }
.np-row-title, .np-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-row-sub { color: var(--np-muted); font-size: 0.92em; }
.np-row-time { color: var(--np-muted); font-size: 0.92em; font-variant-numeric: tabular-nums; }
.np-warn { display: none; color: var(--vscode-editorWarning-foreground); }
.np-row.unavailable .np-warn { display: inline-flex; }
.np-row .np-like { opacity: 0; }
.np-row:hover .np-like, .np-row:focus-within .np-like, .np-row .np-like[aria-pressed='true'] { opacity: 1; }

/* empty states and notices */
.np-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 24px 16px; text-align: center; color: var(--np-muted); }
.np-empty .np-icon { width: 32px; height: 32px; }
.np-empty .np-icon svg { width: 32px; height: 32px; }
.np-empty-title { color: var(--np-fg); font-weight: 600; }
.np-empty-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 4px; }
.np-banner { position: fixed; left: 8px; right: 8px; bottom: 8px; display: flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 4px; background: var(--vscode-inputValidation-errorBackground); }
.np-banner-text { flex: 1; min-width: 0; }
.np-autoplay { position: fixed; left: 8px; right: 8px; bottom: 44px; padding: 8px; border-radius: 4px; background: var(--np-button-bg); color: var(--np-button-fg); }

@keyframes np-bounce { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
@keyframes np-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

body.vscode-high-contrast .np-row, body.vscode-high-contrast-light .np-row,
body.vscode-high-contrast .np-btn, body.vscode-high-contrast-light .np-btn,
body.vscode-high-contrast .np-text-btn, body.vscode-high-contrast-light .np-text-btn,
body.vscode-high-contrast .np-cover, body.vscode-high-contrast-light .np-cover { outline: 1px solid var(--np-contrast); outline-offset: -1px; }

@media (prefers-reduced-motion: reduce) {
  .np-eq i, .np-loading .np-cover-slot { animation: none; }
  .np-cover img { transition: none; }
}
```

- [ ] **Step 11: Replace `src/ui/musicHtml.ts` with the shell**

```ts
'use strict';

/** The whole UI is built by lib/music.js; this page only sets the CSP and loads it. */
export function getMusicWebviewHtml(nonce: string, cspSource: string, scriptUri: string, styleUri: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource}; script-src 'nonce-${nonce}'; media-src ${cspSource} https: http: blob: data:;">
  <link rel="stylesheet" href="${styleUri}">
  <title>Null Music</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
```

In `src/ui/musicViewProvider.ts` replace the line `webview.html = getMusicWebviewHtml(this.getNonce(), webview.cspSource);` with:

```ts
    const asset = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', file)).toString();
    webview.html = getMusicWebviewHtml(this.getNonce(), webview.cspSource, asset('music.js'), asset('music.css'));
```

In `scripts/sync-local.ps1`, in the `"null-music"` entry's `Copy` list add `"lib"` (after `"out"`), so the bundle and stylesheet reach the installed IDE:

```powershell
    "null-music" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out",
            "lib",
            "media"
        )
    }
```

- [ ] **Step 12: Build, test and look at it**

Run: `npm run compile` then `npm test`
Expected: compile clean, all tests PASS including both shell tests.

Then, from the repo root: `scripts/sync-local.ps1`, then `scripts/reload-local.ps1` (per `CLAUDE.md`; `Reload Window` alone serves cached assets). In the installed Null IDE open the Music view and check, at ~250 px and ~350 px sidebar widths:
1. Skeleton, then the player: `∅` placeholder cover, "Nothing playing", Play is enabled only if a library exists.
2. Run `Null Music: Play / Pause` from the palette (plays the library): audio starts, scrubber and time advance, cover/title/artist update, like/shuffle/repeat/volume/mute buttons work, `←/→` on the focused scrubber seek ±5 s.
3. Switch to a light theme and a high-contrast theme: no unreadable text, outlines on controls in high contrast.
4. Check each icon at 100 % zoom and fix any path that looks wrong in `icons.ts`.

- [ ] **Step 13: Commit the source, then the generated output**

```bash
git add src/webview/music src/ui/musicHtml.ts src/ui/musicViewProvider.ts src/test/musicHtml.test.ts lib/music.css tsconfig.webview-music.json package.json ../../scripts/sync-local.ps1
git commit -m "feat(null-music): themed cover-forward player area on a typed webview bundle" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git add out lib/music.js
git commit -m "chore: refresh null-music compiled output" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Queue tab

**Files:**
- Create: `src/webview/music/queueView.ts`
- Modify: `tsconfig.webview-music.json` (include), `lib/music.css` (append)

**Interfaces:**
- Consumes: `app.queue` (`reorderable`, `history`, `current`, `upcoming`), `trackRow`, `iconButton`, `makeRoving`, `matchesTrack`, `reorderTarget`, `sectionHeading`, `noLibraryState`, `noResultsState`, `emptyState`, `textButton`, `send`, `invalidate`, `tabRenderers`.
- Produces: `renderQueueView(el)`, registered as `tabRenderers.queue`.

Behaviour (spec "Queue tab"): sections *Now playing*, *Next up (N)*, *History* (collapsed by default, newest first); each row has art, title/artist, duration, like and a hover `×` remove; clicking an upcoming/history row jumps to it; clicking the current row toggles play/pause; *Clear queue*; drag a *Next up* row onto another to put it before that row (or onto the end zone to move it last); `Alt+↑/↓` reorders from the keyboard. While shuffling the host sends `reorderable: false`: no drag handles, no `Alt+arrows`. Search filters rows but keeps their order (`matchesTrack`).

- [ ] **Step 1: Create `src/webview/music/queueView.ts`**

```ts
'use strict';

let queueDragKey: number | null = null;
let focusQueueKeyAfterRender: number | null = null;

function clearDropMarks(): void {
  document.querySelectorAll('.drop-before, .drop-end-active').forEach((n) => n.classList.remove('drop-before', 'drop-end-active'));
}

/** Put the dragged entry before `beforeKey` (`null` = last). */
function dropQueueEntry(beforeKey: number | null): void {
  const key = queueDragKey;
  queueDragKey = null;
  clearDropMarks();
  if (key !== null && key !== beforeKey) send({ type: 'queueMove', key, beforeKey });
}

function queueRow(item: WireQueueItem, kind: 'current' | 'upcoming' | 'history'): HTMLElement {
  const row = trackRow(item.track, {
    key: item.key,
    query: app.query,
    onPlay: () => send(kind === 'current' ? { type: 'playPause' } : { type: 'queueJump', key: item.key }),
    extra: [iconButton('close', 'Remove from queue', () => send({ type: 'queueRemove', key: item.key }), 'np-remove')],
  });
  if (kind === 'upcoming' && app.queue.reorderable) {
    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', (e: DragEvent) => {
      queueDragKey = item.key;
      row.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(item.key));
      }
    });
    row.addEventListener('dragend', () => {
      queueDragKey = null;
      row.classList.remove('dragging');
      clearDropMarks();
    });
    row.addEventListener('dragover', (e: DragEvent) => {
      if (queueDragKey === null) return;
      e.preventDefault();
      clearDropMarks();
      row.classList.add('drop-before');
    });
    row.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      dropQueueEntry(item.key);
    });
  }
  return row;
}

function renderQueueView(el: HTMLElement): void {
  const q = app.queue;
  if (!q.current) {
    el.replaceChildren(
      hasNoSources()
        ? noLibraryState()
        : emptyState('list', 'The queue is empty', app.tracks.length ? 'Pick a track in Library, or play everything.' : '', app.tracks.length ? [textButton('Play library', () => send({ type: 'playPause' }), true)] : [])
    );
    return;
  }

  const keep = (i: WireQueueItem) => matchesTrack(i.track, app.query);
  const upcoming = q.upcoming.filter(keep);
  const history = q.history.filter(keep).reverse(); // newest first
  if (app.query.trim() && !keep(q.current) && upcoming.length === 0 && history.length === 0) {
    el.replaceChildren(noResultsState());
    return;
  }

  const list = h('div', { class: 'np-list', role: 'listbox', 'aria-label': 'Queue' });
  list.append(sectionHeading('Now playing'), queueRow(q.current, 'current'));

  if (upcoming.length > 0) {
    list.appendChild(sectionHeading('Next up (' + q.upcoming.length + ')'));
    for (const item of upcoming) list.appendChild(queueRow(item, 'upcoming'));
    if (q.reorderable && !app.query.trim()) {
      const end = h('div', { class: 'np-drop-end', 'aria-hidden': 'true' });
      end.addEventListener('dragover', (e: DragEvent) => {
        if (queueDragKey === null) return;
        e.preventDefault();
        clearDropMarks();
        end.classList.add('drop-end-active');
      });
      end.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault();
        dropQueueEntry(null);
      });
      list.appendChild(end);
    }
  }

  if (history.length > 0) {
    const toggle = h('button', { class: 'np-section-btn', type: 'button', 'aria-expanded': String(app.historyOpen) }, icon('back'), 'History (' + q.history.length + ')');
    toggle.addEventListener('click', () => {
      app.historyOpen = !app.historyOpen;
      invalidate('content');
    });
    list.appendChild(h('div', { class: 'np-section' }, toggle));
    if (app.historyOpen) for (const item of history) list.appendChild(queueRow(item, 'history'));
  }

  list.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !app.queue.reorderable) return;
    const raw = (e.target as HTMLElement).getAttribute('data-key');
    if (raw === null) return;
    const key = Number(raw);
    const before = reorderTarget(app.queue.upcoming.map((i) => i.key), key, e.key === 'ArrowUp' ? -1 : 1);
    if (before === undefined) return;
    e.preventDefault();
    focusQueueKeyAfterRender = key;
    send({ type: 'queueMove', key, beforeKey: before });
  });
  makeRoving(list);

  const toolbar = h(
    'div',
    { class: 'np-toolbar' },
    h('span', { class: 'np-toolbar-title' }, q.upcoming.length + 1 + (q.upcoming.length === 0 ? ' track' : ' tracks')),
    textButton('Clear queue', () => send({ type: 'queueClear' }))
  );
  el.replaceChildren(toolbar, list);

  if (focusQueueKeyAfterRender !== null) {
    const row = list.querySelector('[data-key="' + focusQueueKeyAfterRender + '"]') as HTMLElement | null;
    focusQueueKeyAfterRender = null;
    if (row) row.focus();
  }
}

tabRenderers.queue = renderQueueView;
```

- [ ] **Step 2: Add the file to `tsconfig.webview-music.json`**

Insert `"src/webview/music/queueView.ts",` after the `player.ts` line.

- [ ] **Step 3: Append the Queue styles to `lib/music.css`**

```css
/* toolbar and sections */
.np-toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; }
.np-toolbar-title { flex: 1; min-width: 0; color: var(--np-muted); }
.np-section { display: flex; align-items: center; gap: 4px; padding: 8px 8px 2px; color: var(--np-muted); font-size: 0.85em; letter-spacing: 0.04em; text-transform: uppercase; }
.np-section-btn { display: flex; align-items: center; gap: 4px; color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit; }
.np-section-btn .np-icon { transform: rotate(180deg); }
.np-section-btn[aria-expanded='true'] .np-icon { transform: rotate(-90deg); }
.np-row .np-remove { opacity: 0; }
.np-row:hover .np-remove, .np-row:focus-within .np-remove { opacity: 1; }
.np-row.dragging { opacity: 0.4; }
.np-row.drop-before { box-shadow: inset 0 2px 0 var(--np-accent); }
.np-drop-end { height: 24px; }
.np-drop-end.drop-end-active { box-shadow: inset 0 2px 0 var(--np-accent); }
```

- [ ] **Step 4: Build and verify**

Run: `npm run compile` then `npm test`
Expected: PASS.

Sync into the installed IDE (`scripts/sync-local.ps1`, `scripts/reload-local.ps1`) and check the Queue tab: run `Null Music: Play / Pause` to fill the queue from the library, then
1. Now playing shows the current track with the equaliser; *Next up (N)* lists the rest; History is collapsed and opens on click (after pressing Next a few times).
2. Click an upcoming row: it starts and the old one moves to History. Click the playing row: toggles pause.
3. Hover `×` removes a row; removing the playing row starts the next one; removing the last stops playback.
4. Drag a row above another and onto the empty zone under the list; with focus on a row press `Alt+↓` / `Alt+↑`: the row moves and keeps focus.
5. Turn shuffle on: rows are no longer draggable and `Alt+arrows` do nothing. *Clear queue* empties everything and the empty state appears.

- [ ] **Step 5: Commit**

```bash
git add src/webview/music/queueView.ts tsconfig.webview-music.json lib/music.css
git commit -m "feat(null-music): queue tab with history, drag and keyboard reordering" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Library tab — Tracks

**Files:**
- Create: `src/webview/music/libraryView.ts`
- Modify: `tsconfig.webview-music.json`, `lib/music.css` (append)

**Interfaces:**
- Consumes: `app.tracks`, `app.liked`, `app.likedOnly`, `app.sort`, `app.query`, `app.segment`, `sortTracks`, `rankTracks`, `renderChunked`, `trackRow`, `makeRoving`, `hasNoSources`, `noLibraryState`, `noResultsState`, `emptyState`, `icon`.
- Produces: `renderLibraryView(el)` (registered as `tabRenderers.library`), `libraryToolbar()`, `SEGMENTS`, `SORTS`, `tracksBody(base)`, `playTrackList(list, startId)`. Task 8 extends `SEGMENTS` and `renderLibraryView`.

- [ ] **Step 1: Create `src/webview/music/libraryView.ts`**

```ts
'use strict';

const SEGMENTS: Array<[Segment, string]> = [['tracks', 'Tracks']]; // Task 8 adds Albums and Artists
const SORTS: Array<[SortKey, string]> = [
  ['title', 'Title'],
  ['artist', 'Artist'],
  ['album', 'Album'],
  ['duration', 'Duration'],
];

/** Replaces the queue with `list` and starts at `startId`. */
function playTrackList(list: WireTrack[], startId: string): void {
  send({ type: 'playTracks', ids: list.map((t) => t.id), startId });
}

function libraryToolbar(): HTMLElement {
  const segments = h('div', { class: 'np-seg', role: 'group', 'aria-label': 'Browse by' });
  for (const [id, label] of SEGMENTS) {
    const b = h('button', { class: 'np-seg-btn', type: 'button', 'aria-pressed': String(app.segment === id) }, label);
    b.addEventListener('click', () => {
      app.segment = id;
      app.libraryDetail = null;
      invalidate('content');
    });
    segments.appendChild(b);
  }

  const liked = h('button', { class: 'np-chip', type: 'button', 'aria-pressed': String(app.likedOnly) }, icon('heart'), 'Liked');
  liked.addEventListener('click', () => {
    app.likedOnly = !app.likedOnly;
    invalidate('content');
  });

  const sort = h('select', { class: 'np-select', 'aria-label': 'Sort by', disabled: app.query.trim() !== '' || app.segment !== 'tracks' }) as HTMLSelectElement;
  for (const [id, label] of SORTS) sort.appendChild(h('option', { value: id, selected: app.sort === id }, label));
  sort.addEventListener('change', () => {
    app.sort = sort.value as SortKey;
    invalidate('content');
  });

  return h('div', { class: 'np-toolbar np-lib-toolbar' }, segments, liked, sort);
}

/** What the active filters leave of the library (the Liked chip applies to every segment). */
function libraryBase(): WireTrack[] {
  return app.likedOnly ? app.tracks.filter((t) => app.liked.has(t.id)) : app.tracks;
}

function emptyLibraryBody(): HTMLElement {
  if (app.query.trim()) return noResultsState();
  if (app.likedOnly) return emptyState('heart', 'No liked tracks yet', 'Use the heart on a track to keep it here.');
  return emptyState('note', 'No tracks', '');
}

function tracksBody(base: WireTrack[]): HTMLElement {
  const list = app.query.trim() ? rankTracks(base, app.query) : sortTracks(base, app.sort);
  if (list.length === 0) return emptyLibraryBody();
  const body = h('div', { class: 'np-list', role: 'listbox', 'aria-label': 'Tracks' });
  renderChunked(body, list, (t) => trackRow(t, { query: app.query, onPlay: () => playTrackList(list, t.id) }));
  makeRoving(body);
  return body;
}

function renderLibraryView(el: HTMLElement): void {
  if (hasNoSources()) {
    el.replaceChildren(noLibraryState());
    return;
  }
  el.replaceChildren(libraryToolbar(), tracksBody(libraryBase()));
}

tabRenderers.library = renderLibraryView;
```

- [ ] **Step 2: Add the file to `tsconfig.webview-music.json`**

Insert `"src/webview/music/libraryView.ts",` after the `queueView.ts` line.

- [ ] **Step 3: Append the Library styles to `lib/music.css`**

```css
/* library toolbar */
.np-lib-toolbar { flex-wrap: wrap; position: sticky; top: 0; z-index: 1; background: var(--np-bg); }
.np-seg { display: inline-flex; border: 1px solid var(--np-border); border-radius: 4px; overflow: hidden; }
.np-seg-btn { min-height: 24px; padding: 2px 10px; color: var(--np-muted); }
.np-seg-btn:hover { color: var(--np-fg); background: var(--np-hover); }
.np-seg-btn[aria-pressed='true'] { color: var(--np-button-fg); background: var(--np-button-bg); }
.np-chip { display: inline-flex; align-items: center; gap: 4px; min-height: 24px; padding: 2px 8px; border: 1px solid var(--np-border); border-radius: 12px; color: var(--np-muted); }
.np-chip:hover { color: var(--np-fg); background: var(--np-hover); }
.np-chip[aria-pressed='true'] { color: var(--np-fg); border-color: var(--np-accent); }
.np-chip[aria-pressed='true'] .np-icon { color: var(--vscode-charts-red); }
.np-select { min-height: 24px; margin-left: auto; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border); border-radius: 3px; font: inherit; }
.np-more { grid-column: 1 / -1; height: 1px; }
```

- [ ] **Step 4: Build and verify**

Run: `npm run compile` then `npm test`
Expected: PASS.

Sync and reload, then in the Library tab:
1. All tracks list with covers, sorted by title; the sort selector re-sorts (Title, Artist, Album, Duration).
2. Click a row: the whole list becomes the queue starting at that track (Queue tab shows the rest).
3. The *Liked* chip filters to liked tracks; with none liked the "No liked tracks yet" state shows.
4. With a library of several hundred tracks, scrolling to the bottom loads more rows without a jump; ↑/↓ moves focus between rows, Enter plays.
5. With no folders added the "Add a music folder" state shows with working *Add folder* / *Import playlist* buttons.

- [ ] **Step 5: Commit**

```bash
git add src/webview/music/libraryView.ts tsconfig.webview-music.json lib/music.css
git commit -m "feat(null-music): library tab with sortable, filterable track list" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Library — Albums, Artists and detail views

**Files:**
- Create: `src/webview/music/detailView.ts`, `src/webview/music/albumsView.ts`
- Modify: `src/webview/music/libraryView.ts` (`SEGMENTS`, `renderLibraryView`), `tsconfig.webview-music.json`, `lib/music.css` (append)

**Interfaces:**
- Consumes: Task 7 items, `groupAlbums`, `groupArtists`, `rankItems`, `matchesTrack`, `cover`, `app.libraryDetail`, `app.detailScroll`, `app.restoreScroll`, `contentEl`, `sectionHeading`.
- Produces: `DetailSpec`, `renderDetailView(el, spec)` (also used by Playlists in Task 9); `albumsBody(base)`, `artistsBody(base)`, `albumGrid(albums)`, `openLibraryDetail(kind, id)`, `closeLibraryDetail()`, `renderLibraryDetail(el): boolean`.

- [ ] **Step 1: Create `src/webview/music/detailView.ts`** (one component for album, artist and playlist detail)

```ts
'use strict';

interface DetailSpec {
  title: string;
  subtitle: string;
  artUrl?: string;
  /** Seeds the placeholder colour when there is no art. */
  seed: string;
  tracks: WireTrack[];
  /** Artist detail: the artist's albums, shown above the full track list. */
  albums?: Album[];
  onBack: () => void;
}

function renderDetailView(el: HTMLElement, d: DetailSpec): void {
  const visible = d.tracks.filter((t) => matchesTrack(t, app.query));
  const play = (shuffle: boolean) => {
    if (visible.length > 0) send({ type: 'playTracks', ids: visible.map((t) => t.id), startId: visible[0].id, shuffle });
  };
  const playBtn = textButton('Play', () => play(false), true);
  const shuffleBtn = textButton('Shuffle', () => play(true));
  playBtn.disabled = shuffleBtn.disabled = visible.length === 0;

  const parts: HTMLElement[] = [
    h(
      'div',
      { class: 'np-detail-head' },
      iconButton('back', 'Back', d.onBack, 'np-back'),
      cover(d.artUrl, d.seed, 'np-detail-cover'),
      h('div', { class: 'np-detail-text' }, h('div', { class: 'np-detail-title' }, d.title), h('div', { class: 'np-detail-sub' }, d.subtitle))
    ),
    h('div', { class: 'np-detail-actions' }, playBtn, shuffleBtn),
  ];

  if (d.tracks.length === 0) {
    parts.push(emptyState('list', 'No tracks', ''));
  } else if (visible.length === 0) {
    parts.push(noResultsState());
  } else {
    if (d.albums && d.albums.length > 0) parts.push(sectionHeading('Albums'), albumGrid(d.albums), sectionHeading('All tracks'));
    const list = h('div', { class: 'np-list', role: 'listbox', 'aria-label': d.title });
    renderChunked(list, visible, (t) => trackRow(t, { query: app.query, onPlay: () => playTrackList(visible, t.id) }));
    makeRoving(list);
    parts.push(list);
  }
  el.replaceChildren(...parts);
}
```

- [ ] **Step 2: Create `src/webview/music/albumsView.ts`**

```ts
'use strict';

function openLibraryDetail(kind: 'album' | 'artist', id: string): void {
  app.detailScroll = contentEl.scrollTop;
  app.libraryDetail = { kind, id };
  invalidate('content');
}

function closeLibraryDetail(): void {
  app.libraryDetail = null;
  app.restoreScroll = true;
  invalidate('content');
}

function albumCard(a: Album): HTMLElement {
  const card = h(
    'button',
    { class: 'np-card', type: 'button', 'data-row': true, 'aria-label': a.name + ' by ' + a.artist },
    cover(a.artUrl, a.name, 'np-card-cover'),
    h('div', { class: 'np-card-title' }, ...markText(a.name, app.query)),
    h('div', { class: 'np-card-sub' }, a.artist + (a.year ? ' · ' + a.year : ''))
  );
  card.addEventListener('click', () => openLibraryDetail('album', a.key));
  return card;
}

function albumGrid(albums: Album[]): HTMLElement {
  const grid = h('div', { class: 'np-grid' });
  renderChunked(grid, albums, albumCard);
  return grid;
}

function albumsBody(base: WireTrack[]): HTMLElement {
  const albums = rankItems(groupAlbums(base), app.query, (a) => [a.name, a.artist]);
  if (albums.length === 0) return emptyLibraryBody();
  const grid = albumGrid(albums);
  makeRoving(grid);
  return grid;
}

function plural(n: number, one: string, many: string): string {
  return n + ' ' + (n === 1 ? one : many);
}

function artistRow(a: Artist): HTMLElement {
  const row = h(
    'button',
    { class: 'np-row np-artist-row', type: 'button', 'data-row': true },
    cover(a.artUrl, a.name, 'np-avatar'),
    h(
      'div',
      { class: 'np-row-text' },
      h('div', { class: 'np-row-title' }, ...markText(a.name, app.query)),
      h('div', { class: 'np-row-sub' }, plural(a.albums.length, 'album', 'albums') + ' · ' + plural(a.tracks.length, 'track', 'tracks'))
    )
  );
  row.addEventListener('click', () => openLibraryDetail('artist', a.key));
  return row;
}

function artistsBody(base: WireTrack[]): HTMLElement {
  const artists = rankItems(groupArtists(base), app.query, (a) => [a.name]);
  if (artists.length === 0) return emptyLibraryBody();
  const list = h('div', { class: 'np-list', 'aria-label': 'Artists' });
  renderChunked(list, artists, artistRow);
  makeRoving(list);
  return list;
}

/** Renders the open album/artist; false when it no longer exists (e.g. the folder was removed). */
function renderLibraryDetail(el: HTMLElement): boolean {
  const d = app.libraryDetail;
  if (!d) return false;
  if (d.kind === 'album') {
    const album = groupAlbums(app.tracks).find((a) => a.key === d.id);
    if (!album) return false;
    renderDetailView(el, {
      title: album.name,
      subtitle: album.artist + (album.year ? ' · ' + album.year : '') + ' · ' + plural(album.tracks.length, 'track', 'tracks'),
      artUrl: album.artUrl,
      seed: album.name,
      tracks: album.tracks,
      onBack: closeLibraryDetail,
    });
    return true;
  }
  const artist = groupArtists(app.tracks).find((a) => a.key === d.id);
  if (!artist) return false;
  renderDetailView(el, {
    title: artist.name,
    subtitle: plural(artist.albums.length, 'album', 'albums') + ' · ' + plural(artist.tracks.length, 'track', 'tracks'),
    artUrl: artist.artUrl,
    seed: artist.name,
    tracks: artist.tracks,
    albums: artist.albums,
    onBack: closeLibraryDetail,
  });
  return true;
}
```

- [ ] **Step 3: Update `libraryView.ts`**

Replace the `SEGMENTS` line with:

```ts
const SEGMENTS: Array<[Segment, string]> = [
  ['tracks', 'Tracks'],
  ['albums', 'Albums'],
  ['artists', 'Artists'],
];
```

Replace `renderLibraryView` with:

```ts
function renderLibraryView(el: HTMLElement): void {
  if (hasNoSources()) {
    el.replaceChildren(noLibraryState());
    return;
  }
  if (app.libraryDetail && renderLibraryDetail(el)) return;
  app.libraryDetail = null; // the open album/artist is gone
  const base = libraryBase();
  const body = app.segment === 'albums' ? albumsBody(base) : app.segment === 'artists' ? artistsBody(base) : tracksBody(base);
  el.replaceChildren(libraryToolbar(), body);
}
```

- [ ] **Step 4: Add the files to `tsconfig.webview-music.json`**

Insert `"src/webview/music/detailView.ts",` and `"src/webview/music/albumsView.ts",` after the `queueView.ts` line (before `libraryView.ts`).

- [ ] **Step 5: Append the Albums/Artists/detail styles to `lib/music.css`**

```css
/* albums, artists, detail */
.np-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 8px 12px; }
.np-card { display: flex; flex-direction: column; gap: 3px; padding: 6px; border-radius: 6px; text-align: left; }
.np-card:hover { background: var(--np-hover); }
.np-card-cover { width: 100%; aspect-ratio: 1; }
.np-card-cover .np-ph-mark, .np-detail-cover .np-ph-mark { font-size: 32px; }
.np-card-title, .np-card-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-card-sub { color: var(--np-muted); font-size: 0.92em; }
.np-artist-row { width: 100%; text-align: left; }
.np-avatar { width: 32px; height: 32px; flex: none; border-radius: 50%; }
.np-detail-head { display: flex; align-items: center; gap: 10px; padding: 8px 8px 4px; }
.np-detail-cover { width: 72px; height: 72px; flex: none; }
.np-detail-text { flex: 1; min-width: 0; }
.np-detail-title { font-weight: 600; font-size: 1.1em; overflow-wrap: anywhere; }
.np-detail-sub { color: var(--np-muted); }
.np-detail-actions { display: flex; gap: 6px; padding: 4px 8px 8px; }
```

- [ ] **Step 6: Build and verify**

Run: `npm run compile` then `npm test`
Expected: PASS.

Sync and reload, then in the Library tab:
1. *Albums*: a two-column grid of cover cards (placeholders tinted per album when no art). Click one: detail with art, name, artist · year · N tracks, *Play* and *Shuffle* (Shuffle starts at a random track with shuffle on), tracks ordered disc then track number. Back arrow returns to the grid at the same scroll position.
2. *Artists*: rows with avatar and "N albums · M tracks"; an artist opens a detail with its albums grid and *All tracks*.
3. In the player area click the artist text and the album text: Library opens on that artist/album detail.
4. A track with no album tag lands in "Unknown album" and no tag shows `undefined` anywhere.
5. The *Liked* chip filters the Albums and Artists segments too; remove the folder an open album belongs to: the view falls back to the list instead of throwing.

- [ ] **Step 7: Commit**

```bash
git add src/webview/music/detailView.ts src/webview/music/albumsView.ts src/webview/music/libraryView.ts tsconfig.webview-music.json lib/music.css
git commit -m "feat(null-music): album and artist browsing with a shared detail view" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Playlists tab

**Files:**
- Create: `src/webview/music/playlistsView.ts`
- Modify: `tsconfig.webview-music.json`

**Interfaces:**
- Consumes: `renderDetailView`/`DetailSpec` (Task 8), `plural`, `app.playlists`, `app.playlistId`, `app.detailScroll`, `app.restoreScroll`, `rankItems`, `renderChunked`, `makeRoving`, `cover`, `hasNoSources`, `noLibraryState`, `noResultsState`, `emptyState`, `textButton`.
- Produces: `renderPlaylistsView(el)` (registered as `tabRenderers.playlists`), `openPlaylist(id)`, `closePlaylist()`.

The playlist detail is the *same component* as album detail (`renderDetailView`): one piece of code, two data sources.

- [ ] **Step 1: Create `src/webview/music/playlistsView.ts`**

```ts
'use strict';

function openPlaylist(id: string): void {
  app.detailScroll = contentEl.scrollTop;
  app.playlistId = id;
  invalidate('content');
}

function closePlaylist(): void {
  app.playlistId = null;
  app.restoreScroll = true;
  invalidate('content');
}

function playlistArt(p: WirePlaylist): string | undefined {
  const withArt = p.tracks.find((t) => !!t.artUrl);
  return withArt ? withArt.artUrl : undefined;
}

function playlistRow(p: WirePlaylist): HTMLElement {
  const row = h(
    'div',
    { class: 'np-row', role: 'option', tabindex: -1, 'data-row': true },
    cover(playlistArt(p), p.name, 'np-thumb'),
    h('div', { class: 'np-row-text' }, h('div', { class: 'np-row-title' }, ...markText(p.name, app.query)), h('div', { class: 'np-row-sub' }, plural(p.tracks.length, 'track', 'tracks'))),
    iconButton('close', 'Remove playlist (keeps the file)', () => send({ type: 'removePlaylist', id: p.id }), 'np-remove')
  );
  row.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    openPlaylist(p.id);
  });
  return row;
}

function renderPlaylistsView(el: HTMLElement): void {
  if (app.playlistId) {
    const pl = app.playlists.find((p) => p.id === app.playlistId);
    if (pl) {
      renderDetailView(el, {
        title: pl.name,
        subtitle: plural(pl.tracks.length, 'track', 'tracks'),
        artUrl: playlistArt(pl),
        seed: pl.name,
        tracks: pl.tracks,
        onBack: closePlaylist,
      });
      return;
    }
    app.playlistId = null; // the open playlist was removed
  }

  if (app.playlists.length === 0) {
    el.replaceChildren(
      hasNoSources()
        ? noLibraryState()
        : emptyState('list', 'No playlists', 'Import an .m3u8 playlist and it shows up here.', [textButton('Import playlist', () => send({ type: 'importPlaylist' }), true)])
    );
    return;
  }

  const toolbar = h(
    'div',
    { class: 'np-toolbar' },
    h('span', { class: 'np-toolbar-title' }, plural(app.playlists.length, 'playlist', 'playlists')),
    textButton('Import', () => send({ type: 'importPlaylist' }))
  );
  const playlists = rankItems(app.playlists, app.query, (p) => [p.name]);
  if (playlists.length === 0) {
    el.replaceChildren(toolbar, noResultsState());
    return;
  }
  const list = h('div', { class: 'np-list', role: 'listbox', 'aria-label': 'Playlists' });
  renderChunked(list, playlists, playlistRow);
  makeRoving(list);
  el.replaceChildren(toolbar, list);
}

tabRenderers.playlists = renderPlaylistsView;
```

- [ ] **Step 2: Add the file to `tsconfig.webview-music.json`**

Insert `"src/webview/music/playlistsView.ts",` after the `libraryView.ts` line.

- [ ] **Step 3: Build and verify**

Run: `npm run compile` then `npm test`
Expected: PASS.

Sync and reload, then in the Playlists tab:
1. With no playlists: the "No playlists" state with a working *Import playlist* button; after importing a `.m3u8` it appears with name and track count.
2. Open it: same layout as an album detail (cover from its first track with art, *Play*, *Shuffle*, track list); Back returns to the list at the same scroll position.
3. A playlist that references files outside every library folder still plays them.
4. `×` removes the playlist from Null Music but leaves the `.m3u8` file on disk.

- [ ] **Step 4: Commit**

```bash
git add src/webview/music/playlistsView.ts tsconfig.webview-music.json
git commit -m "feat(null-music): playlists tab reusing the album detail view" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Header (scan pill, search, menu), folders, empty/loading states and accessibility

**Files:**
- Create: `src/webview/music/foldersView.ts`
- Replace: `src/webview/music/header.ts`
- Modify: `src/library/library.ts` (`isScanning`), `src/ui/wire.ts`, `src/webview/music/protocol.ts`, `src/webview/music/state.ts`, `src/webview/music/rows.ts`, `src/webview/music/libraryView.ts` (`emptyLibraryBody`), `src/webview/music/main.ts`, `tsconfig.webview-music.json`, `lib/music.css` (append)
- Test: `src/test/library.test.ts`, `src/test/musicViewProvider.test.ts`

**Interfaces:**
- Produces: `Library.isScanning: boolean`; `library.scan.active: boolean` on the wire; `isScanning()` (webview), `skeletonRows(n?)`, `renderFoldersView(el)`, `closeFolders()`, `navigateBack(): boolean`, `setQuery` wiring to the search box.

- [ ] **Step 1: Write the failing host tests**

Append to `src/test/library.test.ts`:

```ts
test('isScanning is true while a rescan or addFolder runs', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'scanning-'));
  const lib = new Library({ state: new MemState(), cacheFile: path.join(dir, 'c.json'), artDir: path.join(dir, 'art'), extensions: () => ['.mp3'] });
  assert.strictEqual(lib.isScanning, false);
  const rescan = lib.rescan();
  assert.strictEqual(lib.isScanning, true);
  await rescan;
  assert.strictEqual(lib.isScanning, false);
  const music = path.join(dir, 'music');
  fs.mkdirSync(music);
  const add = lib.addFolder(pathToUri(music));
  assert.strictEqual(lib.isScanning, true);
  await add;
  assert.strictEqual(lib.isScanning, false);
  lib.dispose();
});
```

In `src/test/musicViewProvider.test.ts`, change the scan assertion to `assert.deepStrictEqual(lib.scan, { scanned: 3, total: 3, active: false });`.

Run: `npm test`
Expected: FAIL at compile (`isScanning` does not exist).

- [ ] **Step 2: Host and protocol changes**

`src/library/library.ts`: add a field next to `private scanned = 0;`

```ts
  private adding = 0; // addFolder calls in flight (they scan without going through `scanning`)
```

next to `get progress()`:

```ts
  /** A rescan or an addFolder is walking and reading files right now. */
  get isScanning(): boolean {
    return this.scanning !== undefined || this.adding > 0;
  }
```

and wrap `addFolder` (keep its existing body inside the `try`):

```ts
  async addFolder(folder: string): Promise<Track[]> {
    this.adding++;
    try {
      if (!this.folderUris.includes(folder)) {
        this.folderUris.push(folder);
        await this.options.state.update(KEY_FOLDERS, [...this.folderUris]);
        this.sourcesEmitter.fire();
      }
      this.scanned = 0;
      this.total = 0;
      await this.scanFolder(folder);
      await this.cache.save();
      this.scanned = this.total;
      this.fireNow();
      return this.tracksInFolder(folder);
    } finally {
      this.adding--;
    }
  }
```

`src/webview/music/protocol.ts`: in the `library` message change `scan: { scanned: number; total: number }` to `scan: { scanned: number; total: number; active: boolean }`.

`src/ui/wire.ts`: change `scan: library.progress,` to `scan: { ...library.progress, active: library.isScanning },`.

`src/webview/music/state.ts`: change `scan: { scanned: 0, total: 0 },` to `scan: { scanned: 0, total: 0, active: false },`.

The host also needs to push the end of a scan: `fireNow()` already runs at the end of `scanAll`/`addFolder`, but `isScanning` only turns false afterwards, so after the existing `fireNow()` calls nothing re-sends. Make the controller republish when a scan ends: in `src/ui/musicViewProvider.ts` replace the `library.onDidChange` subscription with

```ts
      this.library.onDidChange(() => {
        this.controller?.sendLibrary();
        // `isScanning` flips just after the last change event; one more snapshot clears the "Scanning" pill.
        if (this.library.isScanning) setTimeout(() => this.controller?.sendLibrary(), 400);
      }),
```

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Webview helpers (`rows.ts`, `libraryView.ts`)**

Append to `rows.ts`:

```ts
function isScanning(): boolean {
  return app.scan.active || app.scan.total > app.scan.scanned;
}

/** Placeholder rows shown before the first tracks of a scan arrive. */
function skeletonRows(count: number = 8): HTMLElement {
  const wrap = h('div', { class: 'np-list', 'aria-busy': 'true', 'aria-label': 'Loading' });
  for (let i = 0; i < count; i++) {
    wrap.appendChild(
      h('div', { class: 'np-row np-skel', 'aria-hidden': 'true' }, h('div', { class: 'np-skel-block' }), h('div', { class: 'np-row-text' }, h('div', { class: 'np-skel-line wide' }), h('div', { class: 'np-skel-line' })))
    );
  }
  return wrap;
}
```

Replace `emptyLibraryBody` in `libraryView.ts`:

```ts
function emptyLibraryBody(): HTMLElement {
  if (app.query.trim()) return noResultsState();
  if (app.likedOnly) return emptyState('heart', 'No liked tracks yet', 'Use the heart on a track to keep it here.');
  if (isScanning() || !app.libraryLoaded) return skeletonRows();
  if (app.folders.length > 0) {
    const where = app.folders.map((f) => f.name).join(', ');
    return emptyState('folder', 'No audio files found', 'Looked in ' + where + '. Supported: ' + app.extensions.join(' ') + '.', [
      textButton('Rescan', () => send({ type: 'rescan' }), true),
      textButton('Add folder', () => send({ type: 'addFolder' })),
    ]);
  }
  return emptyState('note', 'No tracks', '');
}
```

- [ ] **Step 4: Create `src/webview/music/foldersView.ts`** (the *Manage folders* sub-view)

```ts
'use strict';

function closeFolders(): void {
  app.showFolders = false;
  app.restoreScroll = true;
  invalidate('content');
}

function folderPath(uri: string): string {
  try {
    return decodeURIComponent(uri.replace(/^file:\/\/\/?/, ''));
  } catch {
    return uri;
  }
}

function folderRow(f: WireFolder): HTMLElement {
  const path = folderPath(f.uri);
  return h(
    'div',
    { class: 'np-row np-folder-row' },
    icon('folder'),
    h('div', { class: 'np-row-text' }, h('div', { class: 'np-row-title' }, f.name), h('div', { class: 'np-row-sub', title: path }, path + ' · ' + plural(f.trackCount, 'track', 'tracks'))),
    iconButton('close', 'Remove folder ' + f.name, () => send({ type: 'removeFolder', uri: f.uri }), 'np-remove')
  );
}

function renderFoldersView(el: HTMLElement): void {
  const head = h('div', { class: 'np-detail-head' }, iconButton('back', 'Back', closeFolders, 'np-back'), h('div', { class: 'np-detail-text' }, h('div', { class: 'np-detail-title' }, 'Music folders')));
  const actions = h('div', { class: 'np-detail-actions' }, textButton('Add folder', () => send({ type: 'addFolder' }), true), textButton('Rescan', () => send({ type: 'rescan' })));
  const body = app.folders.length === 0 ? emptyState('folder', 'No folders yet', 'Add a folder to scan it for music.') : h('div', { class: 'np-list' }, ...app.folders.map(folderRow));
  el.replaceChildren(head, actions, body);
}
```

- [ ] **Step 5: Replace `src/webview/music/header.ts`**

```ts
'use strict';

const scanPill = h('span', { class: 'np-pill', role: 'status', hidden: true });
const searchInput = h('input', { class: 'np-search', type: 'search', placeholder: 'Search  ( / )', 'aria-label': 'Search music', spellcheck: 'false' }) as HTMLInputElement;
searchInput.addEventListener('input', () => setQuery(searchInput.value));

const menuEl = h('div', { class: 'np-menu', role: 'menu', hidden: true });
const menuBtn = iconButton('more', 'More actions', () => (menuEl.hidden ? openMenu() : closeMenu()), 'np-menu-btn');
menuBtn.setAttribute('aria-haspopup', 'menu');
menuBtn.setAttribute('aria-expanded', 'false');

function menuItem(label: string, onClick: () => void): HTMLElement {
  const b = h('button', { class: 'np-menu-item', type: 'button', role: 'menuitem' }, label);
  b.addEventListener('click', () => {
    closeMenu();
    onClick();
  });
  return b;
}

menuEl.append(
  menuItem('Add folder…', () => send({ type: 'addFolder' })),
  menuItem('Import playlist…', () => send({ type: 'importPlaylist' })),
  menuItem('Manage folders', () => {
    app.detailScroll = contentEl.scrollTop;
    app.showFolders = true;
    invalidate('content');
  }),
  menuItem('Rescan', () => send({ type: 'rescan' }))
);

function openMenu(): void {
  menuEl.hidden = false;
  menuBtn.setAttribute('aria-expanded', 'true');
  (menuEl.querySelector('button') as HTMLElement).focus();
}

function closeMenu(): void {
  menuEl.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
}

menuEl.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = Array.prototype.slice.call(menuEl.querySelectorAll('button')) as HTMLElement[];
  const at = items.indexOf(document.activeElement as HTMLElement);
  items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
});
document.addEventListener('click', (e) => {
  if (!menuEl.hidden && !menuEl.contains(e.target as Node)) closeMenu();
});

const headerEl = h(
  'header',
  { class: 'np-header' },
  h('div', { class: 'np-header-row' }, h('div', { class: 'np-brand' }, h('span', { class: 'np-brand-mark', 'aria-hidden': 'true' }, '∅'), 'Music'), scanPill, menuBtn),
  h('div', { class: 'np-search-row' }, searchInput),
  menuEl
);

function renderHeader(): void {
  const scanning = app.scan.total > app.scan.scanned;
  scanPill.hidden = !scanning;
  if (scanning) scanPill.textContent = 'Scanning ' + app.scan.scanned + '/' + app.scan.total;
  if (searchInput.value !== app.query) searchInput.value = app.query;
}

/** Esc: close the menu, then clear the search, then step out of folders / album / playlist detail. */
function navigateBack(): boolean {
  if (!menuEl.hidden) {
    closeMenu();
    menuBtn.focus();
    return true;
  }
  if (app.query) {
    setQuery('');
    return true;
  }
  if (app.showFolders) {
    closeFolders();
    return true;
  }
  if (app.tab === 'library' && app.libraryDetail) {
    closeLibraryDetail();
    return true;
  }
  if (app.tab === 'playlists' && app.playlistId) {
    closePlaylist();
    return true;
  }
  return false;
}

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    if (navigateBack()) e.preventDefault();
    return;
  }
  const target = e.target as HTMLElement;
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(target.tagName) >= 0;
  if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});
```

- [ ] **Step 6: Wire folders into `main.ts` and the tsconfig**

In `main.ts` `setTab`, add `app.showFolders = false;` as the first line of the body. In `renderContent` replace `const render = tabRenderers[app.tab];` with:

```ts
  const render = app.showFolders ? renderFoldersView : tabRenderers[app.tab];
```

In `tsconfig.webview-music.json` insert `"src/webview/music/foldersView.ts",` after the `playlistsView.ts` line.

- [ ] **Step 7: Append the header, state and skeleton styles to `lib/music.css`**

```css
/* header: scan pill, search, menu */
.np-header { position: relative; flex-direction: column; align-items: stretch; gap: 6px; }
.np-header-row { display: flex; align-items: center; gap: 6px; }
.np-pill { padding: 1px 8px; border-radius: 10px; font-size: 0.85em; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); white-space: nowrap; }
.np-search { width: 100%; min-height: 24px; padding: 2px 8px; color: var(--vscode-input-foreground); background: var(--np-input-bg); border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; font: inherit; }
.np-search::placeholder { color: var(--vscode-input-placeholderForeground); }
.np-search:focus { outline: 1px solid var(--np-accent); outline-offset: -1px; }
.np-menu { position: absolute; top: 34px; right: 8px; z-index: 5; display: flex; flex-direction: column; min-width: 160px; padding: 4px 0; color: var(--vscode-menu-foreground); background: var(--vscode-menu-background); border: 1px solid var(--vscode-menu-border, var(--np-border)); border-radius: 4px; box-shadow: 0 2px 8px var(--vscode-widget-shadow); }
.np-menu-item { padding: 4px 12px; text-align: left; }
.np-menu-item:hover, .np-menu-item:focus-visible { color: var(--vscode-menu-selectionForeground); background: var(--vscode-menu-selectionBackground); outline: none; }
.np-folder-row .np-remove { opacity: 1; }

/* loading skeleton */
.np-skel { cursor: default; }
.np-skel:hover { background: none; }
.np-skel-block, .np-skel-line { background: var(--np-hover); border-radius: 3px; animation: np-pulse 1.4s ease-in-out infinite; }
.np-skel-block { width: 32px; height: 32px; flex: none; }
.np-skel-line { height: 9px; width: 45%; margin: 4px 0; }
.np-skel-line.wide { width: 70%; }
@media (prefers-reduced-motion: reduce) { .np-skel-block, .np-skel-line { animation: none; } }
```

- [ ] **Step 8: Build and verify**

Run: `npm run compile` then `npm test`
Expected: PASS.

Sync and reload, then with the sidebar at ~250 px and ~350 px, in a dark, a light and a high-contrast theme:
1. Header: `∅ Music`, `⋯` menu (Add folder…, Import playlist…, Manage folders, Rescan) opens with the mouse and keyboard (↑/↓, Esc closes and returns focus), search box below.
2. Add a large folder: the *Scanning n/m* pill appears and counts up, skeleton rows show first, then rows fill in; the pill disappears when the scan ends.
3. Add an empty folder: "No audio files found" lists the folder and the supported extensions. Remove all folders: "Add a music folder".
4. Type in the search box (or press `/`): Queue, the Library segment and an open playlist filter, matches are highlighted, ranking puts prefixes first; a query like `(` or `.*` shows "No matches" without errors; *Clear search* and `Esc` clear it.
5. *Manage folders*: folders with track counts and `×`; Back/`Esc` returns to the previous view and tab clicks leave it.
6. Keyboard: Tab reaches tabs, rows, buttons and the scrubber; focus rings are visible; every icon button announces a label (check with Narrator or the accessibility tree); the track announcement fires on track change.
7. `prefers-reduced-motion` (OS setting) stops the equaliser and skeleton pulse.

- [ ] **Step 9: Commit**

```bash
git add src/library/library.ts src/ui/wire.ts src/ui/musicViewProvider.ts src/webview/music src/test/library.test.ts src/test/musicViewProvider.test.ts tsconfig.webview-music.json lib/music.css
git commit -m "feat(null-music): header with scan pill, search and menu; folders view; empty and loading states" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Docs, final verification and compiled output

**Files:**
- Modify: `CLAUDE.md` (null-music entry), `docs/specs/null-music-player-ui-design.md` (status), `docs/plans/null-music-player-ui.md` (tick off nothing; leave as is)
- Generated: `out/`, `lib/music.js`

- [ ] **Step 1: Update `CLAUDE.md`**

In the `null-music` entry replace

```
Designs: `docs/specs/null-music-engine-design.md`, `docs/specs/null-music-player-ui-design.md`; plan: `docs/plans/null-music-engine.md`.
```

with

```
The sidebar UI is vanilla TS in `src/webview/music/` (`module: none`, no imports; `tsconfig.webview-music.json` compiles it into the tracked `lib/music.js`, and `lib/music.css` is hand-written — the only hand-edited file in `lib/`). Pure `dom.ts`/`model.ts` are also compiled by `tsconfig.webview-music-shared.json` so `node --test` can load them through `vm` (top-level `function` declarations only). Host and webview share the typed `HostToWebview`/`WebviewToHost` unions in `protocol.ts` (the host pulls them in with a triple-slash reference); `MusicViewController` publishes `player`/`queue`/`library`/`liked` snapshots and the webview only sends intents. Rows carry `data-vscode-context` and the manifest's `webview/context` menu contributes the `null-music.track.*` commands. `sync-local.ps1` copies `lib/`. Designs: `docs/specs/null-music-engine-design.md`, `docs/specs/null-music-player-ui-design.md`; plans: `docs/plans/null-music-engine.md`, `docs/plans/null-music-player-ui.md`.
```

- [ ] **Step 2: Mark the spec as implemented**

In `docs/specs/null-music-player-ui-design.md` replace the first status line (`Status: approved in brainstorming; awaiting spec review.`) with:

```
Status: implemented per [the plan](../plans/null-music-player-ui.md). Open items resolved by adopting the author's proposals (art cap `min(100% width, 35vh)`; ±10 s buttons dropped). The plan lists the few deliberate deviations from this spec.
```

- [ ] **Step 3: Full verification**

Run: `npm run compile` then `npm test`
Expected: compile clean; every suite PASS (queue, player, library, webviewDom, webviewModel, musicHtml, musicViewProvider and the pre-existing ones).

Run (from the repo root): `grep -rn "btn-play-pause\|pane-tracks\|localLibraryUpdate\|stateUpdate" extensions/null-music/src` — Expected: no matches (the old template and protocol are gone).

Then the manual pass the spec asks for, via `scripts/sync-local.ps1` + `scripts/reload-local.ps1`: widths ~250 px and ~350 px; Null Dark, a light theme and a high-contrast theme; empty library, scanning, and a large library (a few thousand tracks: scrolling stays smooth, Albums/Artists open quickly); play, pause, seek by mouse and by arrow keys, next/previous, shuffle, repeat, volume, mute, like; the right-click menu on a track row shows *Play Next*, *Add to Queue*, *Like / Unlike*, *Reveal in File Explorer*, each working (if the menu is missing, check the `webviewId` in the `when` clause against the real view id `null.musicView`); closing and reopening the sidebar keeps playing and rebuilds the UI.

- [ ] **Step 4: Keep the knowledge graph current**

Run (repo root): `graphify update .`
If `graphify-out/` is tracked, `git add graphify-out` for the commit below; if it is untracked, leave it.

- [ ] **Step 5: Commit docs, then the generated output**

```bash
git add CLAUDE.md docs/specs/null-music-player-ui-design.md
git commit -m "docs(null-music): document the new webview UI structure" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git add extensions/null-music/out extensions/null-music/lib/music.js
git commit -m "chore: refresh null-music compiled output" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(Run from the repo root; `extensions/null-music/media/music.svg` stays unstaged.)

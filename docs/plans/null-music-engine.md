# Null Music Engine & Library Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Move all queue/playback state into the extension host (`Queue`, `Player`, `Library`, `AudioOutput`), add real tags/cover art with a JSON cache, session restore, and delete the dead provider layer.

**Architecture:** The host owns state; the webview `<audio>` element is an output device behind an `AudioOutput` interface (`WebviewAudioOutput` auto-reveals the view and waits for `ready`). `Library` scans folders/`.m3u8`, reads tags with an in-house parser, and caches in `globalStorageUri`. `Player` owns a pure `Queue`, a single position clock fed by output events, and persists a paused session.

**Tech Stack:** TypeScript (commonjs, ES2022, strict), Node `fs`/`crypto`, `node --test` over compiled `out/test/*.test.js`. No new dependencies.

**Spec:** [docs/specs/null-music-engine-design.md](../specs/null-music-engine-design.md)

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- All work is under `extensions/null-music/` (plus the `CLAUDE.md` null-music entry and this plan). Do not stage the pre-existing unrelated change to `extensions/null-music/media/music.svg`.
- No new runtime dependencies; the tag reader is in-house (`library/tagReader.ts`). `devDependencies` unchanged.
- Audio stays on the webview `<audio>` element. No gapless/crossfade, no database, no virtualization.
- Embedded art capped at 16 MB per file, marked `// ponytail: 16 MB art cap`.
- Cache: `globalStorageUri/library-cache.json` = `{ version, entries: { path: { mtime, size, tags } } }`; reuse on matching mtime+size; prune deleted files; write temp file then rename; corrupt or wrong-`version` cache is discarded. ~8 files in flight while scanning.
- Cover art: `globalStorageUri/art/<hash>.jpg|png`, shared per content hash. `Track.artKey` is that file name.
- Existing `globalState` keys are read as-is: `null-music.local.folders`, `null-music.local.liked`, `null-music.local.playlists`. New key: `null-music.session`. Track ids stay `local:<file uri>` so likes survive.
- `isPlaying` flips true only on the output's `play` event. No `ready` within 5 s → one error message, player stays paused. Session restore is always paused, never autoplay.
- `.wma` removed from default `null-music.local.supportedExtensions`; `null-music.playback.pollingIntervalMs` removed from the manifest.
- `localResourceRoots` = extension URI, library folders, playlist directories, `globalStorageUri/art`. The drive-root enumeration is deleted.
- Every new test file must be appended to the `test` script in `package.json` or it is silently skipped.
- Never hand-edit `out/`. `out/` is refreshed in its own commit `chore: refresh null-music compiled output`.
- Commits: never push, never amend, never `--no-verify`. Every commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Run all commands from `extensions/null-music/` unless stated. Tests: `npm test` (= `tsc` then `node --test <list>`).

## Review Focus

Inputs the spec implies but its listed tests do not exercise, most likely first:

1. **Pause while a `play()` promise is pending** (rapid play/pause) makes the browser reject with `AbortError`. It must not count as an unplayable file and skip the track. Pinned by a `musicHtml` assertion (Task 7) and the stale-error filter test (Task 6).
2. **Two imported playlists in the same directory** must get distinct ids (the old `base64url(path).slice(0,16)` id collided). Pinned in Task 5.
3. **A library folder that is missing or on an offline drive** must not throw or hide the other folders' tracks. Pinned in Task 5.
4. **Closing/disposing the view while music plays** must leave the player showing paused, not playing. Pinned in Task 7 (`detach` emits `pause`).
5. **Pressing Play with an empty library and empty queue** must be a silent no-op (no error, no view reveal). Pinned in Task 6.

## File Structure

```
src/emitter.ts                    Emitter/Event/Disposable (no vscode dependency, testable under node)
src/uri.ts                        pathToUri / uriToPath (vscode.Uri when available, plain shim under node --test)
src/types.ts                      Track gains folder/albumArtist/trackNo/discNo/year/artKey; KeyValueStore
src/library/m3uParser.ts          (moved from provider/local/)
src/library/tagReader.ts          readTags(): mp3/flac/ogg/opus/m4a tags, art, duration
src/library/libraryCache.ts       LibraryCache (JSON cache, atomic write)
src/library/library.ts            Library: scan, likes, playlists, collections, search
src/playback/queue.ts             Queue (pure)
src/playback/audioOutput.ts       AudioOutput + AudioEvent
src/playback/player.ts            Player
src/playback/sessionStore.ts      SessionStore
src/playback/webviewAudioOutput.ts WebviewAudioOutput (no vscode import; provider injects a WebviewLike)
src/ui/*                          rewired to Player/Library
src/test/fixtures.ts              shared builders (not a test file; never added to the test script)
DELETED: src/provider/**, src/playback/playbackManager.ts, old localProvider/playbackManager tests
```

---

### Task 1: Foundations (types, emitter, uri helpers, m3u move)

**Files:**
- Create: `src/emitter.ts`, `src/uri.ts`, `src/test/uri.test.ts`
- Move: `src/provider/local/m3uParser.ts` → `src/library/m3uParser.ts`
- Modify: `src/types.ts`, `src/provider/local/localProvider.ts:16` (import path), `src/test/m3uParser.test.ts:6` (import path), `package.json` (test script)

**Interfaces:**
- Produces: `Emitter<T>`, `Event<T>`, `Disposable`; `pathToUri(fsPath): string`, `uriToPath(uri): string`; `KeyValueStore`; additive optional `Track` fields.

- [ ] **Step 1: Install dev dependencies**

Run: `npm ci`
Expected: installs typescript, @types/vscode, @types/node (no errors).

- [ ] **Step 2: Create `src/emitter.ts`**

```ts
'use strict';

export interface Disposable {
  dispose(): void;
}

export type Event<T> = (listener: (e: T) => void) => Disposable;

export class Emitter<T> {
  private readonly listeners = new Set<(e: T) => void>();

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  };

  fire(e: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(e);
      } catch (err) {
        console.error('Null Music: listener failed', err);
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
```

- [ ] **Step 3: Write the failing test `src/test/uri.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import * as path from 'path';
import { test } from 'node:test';
import { pathToUri, uriToPath } from '../uri';

test('uriToPath inverts pathToUri, including spaces and non-ASCII', () => {
  const p = path.join(path.resolve('/'), 'Music', 'My Album', 'Bjørk – Ünïcode.mp3');
  assert.strictEqual(uriToPath(pathToUri(p)), p);
  assert.ok(pathToUri(p).startsWith('file:///'));
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module '../uri'`.

- [ ] **Step 5: Create `src/uri.ts`**

```ts
'use strict';

import * as path from 'path';

// `vscode` is absent under `node --test`; fall back to a plain file:// shim there.
let vscodeUri: any;
try {
  vscodeUri = require('vscode').Uri;
} catch {
  vscodeUri = undefined;
}

export function pathToUri(fsPath: string): string {
  if (vscodeUri) return vscodeUri.file(fsPath).toString();
  const p = fsPath.replace(/\\/g, '/');
  return 'file://' + (p.startsWith('/') ? '' : '/') + p;
}

export function uriToPath(uri: string): string {
  if (vscodeUri) return vscodeUri.parse(uri).fsPath;
  const p = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  return (/^\/[A-Za-z]:/.test(p) ? p.slice(1) : p).replace(/\//g, path.sep);
}
```

- [ ] **Step 6: Additive `Track` fields and `KeyValueStore` in `src/types.ts`**

Replace the `Track` interface and append `KeyValueStore`:

```ts
export interface Track {
  id: string;
  name: string;
  artist: string;
  artists: string[];
  album: string;
  albumArtUrl?: string;
  durationMs: number;
  uri: string;
  isLiked?: boolean;
  /** Library folder URI this track was scanned from; '' for playlist-only tracks. */
  folder?: string;
  albumArtist?: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  /** File name of the cover in the art directory (`<content hash>.<jpg|png>`). */
  artKey?: string;
}

/** The slice of `vscode.Memento` the extension uses (kept vscode-free for tests). */
export interface KeyValueStore {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}
```

- [ ] **Step 7: Move the m3u parser and drop its vscode shim**

Run: `mkdir -p src/library && git mv src/provider/local/m3uParser.ts src/library/m3uParser.ts`

In `src/library/m3uParser.ts`: change the types import to `import { Track } from '../types';`, add `import { pathToUri, uriToPath } from '../uri';`, delete the whole `let vscodeModule … catch { … }` block (lines 6–22), and apply these edits:

```ts
    } else if (trackPathOrUrl.startsWith('file://')) {
      uri = trackPathOrUrl;
      trackFileName = path.basename(uriToPath(trackPathOrUrl));
    } else {
      // Local filesystem path (either absolute or relative to playlist file)
      const isAbsolute = path.isAbsolute(trackPathOrUrl) || /^[A-Za-z]:[\\/]/.test(trackPathOrUrl);
      const resolvedFsPath = isAbsolute
        ? path.normalize(trackPathOrUrl)
        : path.normalize(path.resolve(playlistDir, trackPathOrUrl));
      uri = pathToUri(resolvedFsPath);
      trackFileName = path.basename(resolvedFsPath);
    }
```

and in the `tracks.push({ … })` call change `album: playlistName,` to `album: '',`.

Fix the two importers: in `src/provider/local/localProvider.ts` change `import { parseM3u } from './m3uParser';` to `import { parseM3u } from '../../library/m3uParser';`; in `src/test/m3uParser.test.ts` change the import to `'../library/m3uParser'`.

- [ ] **Step 8: Register the test and run everything**

In `package.json` append ` out/test/uri.test.js` to the `test` script's `node --test` list.

Run: `npm test`
Expected: all tests PASS (uri test included; m3u tests unchanged).

- [ ] **Step 9: Commit**

```bash
git add src/emitter.ts src/uri.ts src/types.ts src/library/m3uParser.ts src/provider/local/localProvider.ts src/test/uri.test.ts src/test/m3uParser.test.ts package.json
git commit -m "refactor(null-music): add emitter, uri helpers and move m3u parser to library/"
```

---

### Task 2: Queue

**Files:**
- Create: `src/playback/queue.ts`, `src/test/fixtures.ts`, `src/test/queue.test.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Produces: `class Queue` with `tracks: Track[]`, `length`, `index` (-1 when empty), `current`, `shuffle` (getter), `repeat: RepeatMode` (public field), `setShuffle(on)`, `replace(tracks, startIndex?)`, `playNext(track)`, `add(track)`, `remove(i)`, `move(from, to)`, `clear()`, `next(): Track|undefined` (undefined at end, state untouched), `previous(): Track|undefined`. Constructor `new Queue(rand = Math.random)`.
- Produces (fixtures): `track(n, overrides?)` with `uri = file:///t<n>.mp3`, `id = local:file:///t<n>.mp3`, `name = t<n>`; `MemState`.

- [ ] **Step 1: Create `src/test/fixtures.ts`**

```ts
'use strict';

import { KeyValueStore, Track } from '../types';

export function track(n: number, over: Partial<Track> = {}): Track {
  return {
    id: `local:file:///t${n}.mp3`,
    name: `t${n}`,
    artist: 'a',
    artists: ['a'],
    album: '',
    durationMs: 0,
    uri: `file:///t${n}.mp3`,
    ...over,
  };
}

/** In-memory stand-in for `vscode.Memento`. */
export class MemState implements KeyValueStore {
  readonly map = new Map<string, unknown>();

  get<T>(key: string, defaultValue: T): T {
    return this.map.has(key) ? (this.map.get(key) as T) : defaultValue;
  }

  update(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }
}
```

- [ ] **Step 2: Write the failing test `src/test/queue.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Queue } from '../playback/queue';
import { track } from './fixtures';

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const tracks = (n: number) => Array.from({ length: n }, (_, i) => track(i));
const names = (q: Queue) => q.tracks.map((t) => t.name);

test('next walks the list, stops at the end, wraps only for repeat=context', () => {
  const q = new Queue();
  q.replace(tracks(3), 0);
  assert.strictEqual(q.next()?.name, 't1');
  assert.strictEqual(q.next()?.name, 't2');
  assert.strictEqual(q.next(), undefined);
  assert.strictEqual(q.current?.name, 't2');
  q.repeat = 'context';
  assert.strictEqual(q.next()?.name, 't0');
});

test('shuffle never repeats a track back to back and covers everything first', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const q = new Queue(seeded(seed));
    q.replace(tracks(5), 0);
    q.setShuffle(true);
    q.repeat = 'context';
    const seq = [q.current!.name];
    for (let i = 0; i < 24; i++) seq.push(q.next()!.name);
    for (let i = 1; i < seq.length; i++) assert.notStrictEqual(seq[i], seq[i - 1], `seed ${seed}`);
    assert.strictEqual(new Set(seq.slice(0, 5)).size, 5, `seed ${seed}`);
  }
});

test('shuffle with repeat off ends after every track played once', () => {
  const q = new Queue(seeded(3));
  q.replace(tracks(4), 0);
  q.setShuffle(true);
  for (let i = 0; i < 3; i++) assert.ok(q.next());
  assert.strictEqual(q.next(), undefined);
});

test('single track + shuffle + repeat context replays the same track', () => {
  const q = new Queue();
  q.replace(tracks(1), 0);
  q.setShuffle(true);
  q.repeat = 'context';
  assert.strictEqual(q.next()?.name, 't0');
});

test('previous walks history regardless of shuffle, and forward returns to where you were', () => {
  const q = new Queue(seeded(7));
  q.replace(tracks(5), 0);
  q.setShuffle(true);
  const first = q.current!.name;
  const second = q.next()!.name;
  const third = q.next()!.name;
  assert.strictEqual(q.previous()?.name, second);
  assert.strictEqual(q.next()?.name, third);
  assert.strictEqual(q.previous()?.name, second);
  assert.strictEqual(q.previous()?.name, first);
  assert.strictEqual(q.previous(), undefined);
});

test('previous without history steps back in list order (non-shuffle)', () => {
  const q = new Queue();
  q.replace(tracks(3), 2);
  assert.strictEqual(q.previous()?.name, 't1');
  assert.strictEqual(q.previous()?.name, 't0');
  assert.strictEqual(q.previous(), undefined);
});

test('playNext inserts after current; add appends; both play in shuffle too', () => {
  const q = new Queue();
  q.replace(tracks(3), 0);
  q.playNext(track(9));
  q.add(track(8));
  assert.deepStrictEqual(names(q), ['t0', 't9', 't1', 't2', 't8']);
  assert.strictEqual(q.next()?.name, 't9');

  const s = new Queue(seeded(2));
  s.replace(tracks(4), 0);
  s.setShuffle(true);
  s.playNext(track(9));
  assert.strictEqual(s.next()?.name, 't9');
  s.add(track(8));
  const seen = new Set<string>();
  for (let i = 0; i < 4; i++) seen.add(s.next()!.name);
  assert.ok(seen.has('t8'));
});

test('add and playNext on an empty queue make the new track current', () => {
  const q = new Queue();
  q.add(track(1));
  assert.strictEqual(q.current?.name, 't1');
  const p = new Queue();
  p.playNext(track(2));
  assert.strictEqual(p.current?.name, 't2');
});

test('remove and move keep the current item current', () => {
  const q = new Queue();
  q.replace(tracks(4), 2);
  q.remove(0);
  assert.strictEqual(q.current?.name, 't2');
  assert.strictEqual(q.index, 1);
  q.move(0, 2);
  assert.deepStrictEqual(names(q), ['t2', 't3', 't1']);
  assert.strictEqual(q.current?.name, 't2');
  assert.strictEqual(q.index, 0);
  q.remove(q.index);
  assert.strictEqual(q.current?.name, 't3');
  q.clear();
  assert.strictEqual(q.current, undefined);
  assert.strictEqual(q.index, -1);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../playback/queue'`.

- [ ] **Step 4: Create `src/playback/queue.ts`**

```ts
'use strict';

import { RepeatMode, Track } from '../types';

interface Entry {
  key: number;
  track: Track;
}

const HISTORY_LIMIT = 500;

/**
 * Pure queue state. Entries carry a stable key so `index` is derived from the
 * current item and survives insert/remove/move without fix-ups.
 */
export class Queue {
  repeat: RepeatMode = 'off';

  private entries: Entry[] = [];
  private currentKey = -1;
  private nextKey = 1;
  private history: number[] = []; // keys, oldest first
  private upcoming: number[] = []; // keys still to play (shuffle only)
  private shuffleOn = false;

  constructor(private readonly rand: () => number = Math.random) {}

  get tracks(): Track[] {
    return this.entries.map((e) => e.track);
  }

  get length(): number {
    return this.entries.length;
  }

  get index(): number {
    return this.entries.findIndex((e) => e.key === this.currentKey);
  }

  get current(): Track | undefined {
    return this.entries[this.index]?.track;
  }

  get shuffle(): boolean {
    return this.shuffleOn;
  }

  setShuffle(on: boolean): void {
    this.shuffleOn = on;
    this.rebuild();
  }

  replace(tracks: Track[], startIndex = 0): void {
    this.entries = tracks.map((track) => this.entry(track));
    const start = this.entries[Math.max(0, Math.min(startIndex, this.entries.length - 1))];
    this.currentKey = start ? start.key : -1;
    this.history = [];
    this.rebuild();
  }

  playNext(track: Track): void {
    const e = this.entry(track);
    this.entries.splice(this.index + 1, 0, e);
    if (this.currentKey === -1) this.currentKey = e.key;
    else if (this.shuffleOn) this.upcoming.unshift(e.key);
  }

  add(track: Track): void {
    const e = this.entry(track);
    this.entries.push(e);
    if (this.currentKey === -1) this.currentKey = e.key;
    else if (this.shuffleOn) {
      this.upcoming.splice(Math.floor(this.rand() * (this.upcoming.length + 1)), 0, e.key);
    }
  }

  remove(i: number): void {
    const e = this.entries[i];
    if (!e) return;
    this.entries.splice(i, 1);
    this.history = this.history.filter((k) => k !== e.key);
    this.upcoming = this.upcoming.filter((k) => k !== e.key);
    if (e.key === this.currentKey) {
      const successor = this.entries[i] ?? this.entries[i - 1];
      this.currentKey = successor ? successor.key : -1;
      this.upcoming = this.upcoming.filter((k) => k !== this.currentKey);
    }
  }

  move(from: number, to: number): void {
    if (!this.entries[from] || to < 0 || to >= this.entries.length) return;
    const [e] = this.entries.splice(from, 1);
    this.entries.splice(to, 0, e);
  }

  clear(): void {
    this.entries = [];
    this.currentKey = -1;
    this.history = [];
    this.upcoming = [];
  }

  /** Advance and return the new current track, or undefined (state untouched) at the end. */
  next(): Track | undefined {
    if (this.currentKey === -1) return undefined;
    let key: number | undefined;
    if (this.shuffleOn) {
      if (this.upcoming.length === 0 && this.repeat === 'context') {
        this.upcoming = this.shuffled(this.otherKeys());
        if (this.upcoming.length === 0) this.upcoming = [this.currentKey];
      }
      key = this.upcoming.shift();
    } else {
      key = (this.entries[this.index + 1] ?? (this.repeat === 'context' ? this.entries[0] : undefined))?.key;
    }
    if (key === undefined) return undefined;
    this.history.push(this.currentKey);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.currentKey = key;
    return this.current;
  }

  /** Step back through history (list order when history is empty and not shuffling). */
  previous(): Track | undefined {
    let key = this.history.pop();
    if (key === undefined && !this.shuffleOn) key = this.entries[this.index - 1]?.key;
    if (key === undefined) return undefined;
    if (this.shuffleOn && this.currentKey !== -1) this.upcoming.unshift(this.currentKey);
    this.currentKey = key;
    return this.current;
  }

  private rebuild(): void {
    this.upcoming = this.shuffleOn ? this.shuffled(this.otherKeys()) : [];
  }

  private otherKeys(): number[] {
    return this.entries.map((e) => e.key).filter((k) => k !== this.currentKey);
  }

  private shuffled(keys: number[]): number[] {
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return keys;
  }

  private entry(track: Track): Entry {
    return { key: this.nextKey++, track };
  }
}
```

- [ ] **Step 5: Register and run**

In `package.json` append ` out/test/queue.test.js` to the test list.

Run: `npm test`
Expected: PASS (all queue tests).

- [ ] **Step 6: Commit**

```bash
git add src/playback/queue.ts src/test/fixtures.ts src/test/queue.test.ts package.json
git commit -m "feat(null-music): add history-aware Queue with play next and add"
```

---

### Task 3: Tag reader

**Files:**
- Create: `src/library/tagReader.ts`, `src/test/tagReader.test.ts`
- Modify: `src/test/fixtures.ts` (byte builders), `package.json`

**Interfaces:**
- Produces: `interface Tags { title?, artist?, album?, albumArtist?: string; trackNo?, discNo?, year?, durationMs?: number; art?: { data: Buffer; ext: 'jpg'|'png' } }` and `readTags(filePath): Promise<Tags>` — never throws; returns what it parsed.
- Produces (fixtures): `PNG`, `be32`, `le32`, `syncsafe`, `id3Frame`, `id3Text`, `id3Utf16`, `id3Apic`, `id3Tag`, `id3v22Text`, `flacBlock`, `flacStreamInfo`, `vorbisComments`, `flacPicture`, `flacFile`, `oggPage`, `mp4Atom`, `mp4Item`.

- [ ] **Step 1: Append byte builders to `src/test/fixtures.ts`**

```ts
export const PNG = Buffer.from('89504e470d0a1a0a', 'hex'); // not a real image; the reader only moves bytes

export const be32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
export const le32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
export const syncsafe = (n: number): Buffer =>
  Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

/** ID3v2.3/2.4 frame (v2.4 sizes are syncsafe). */
export function id3Frame(id: string, body: Buffer, version = 3): Buffer {
  return Buffer.concat([
    Buffer.from(id, 'latin1'),
    version === 4 ? syncsafe(body.length) : be32(body.length),
    Buffer.alloc(2),
    body,
  ]);
}
export const id3Text = (id: string, value: string, version = 3): Buffer =>
  id3Frame(id, Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8')]), version);
export const id3Utf16 = (id: string, value: string, version = 3): Buffer =>
  id3Frame(id, Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(value, 'utf16le')]), version);
export const id3Apic = (data: Buffer, version = 3): Buffer =>
  id3Frame(
    'APIC',
    Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0', 'latin1'), Buffer.from([3, 0]), data]),
    version
  );
export function id3v22Text(id: string, value: string): Buffer {
  const body = Buffer.concat([Buffer.from([0]), Buffer.from(value, 'latin1')]);
  return Buffer.concat([Buffer.from(id, 'latin1'), Buffer.from([0, (body.length >> 8) & 255, body.length & 255]), body]);
}
export function id3Tag(frames: Buffer[], version = 3): Buffer {
  const body = Buffer.concat(frames);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([version, 0, 0]), syncsafe(body.length), body]);
}

export function flacBlock(type: number, body: Buffer, last = false): Buffer {
  return Buffer.concat([
    Buffer.from([(last ? 0x80 : 0) | type, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255]),
    body,
  ]);
}
export function flacStreamInfo(sampleRate: number, totalSamples: number): Buffer {
  const b = Buffer.alloc(34);
  b[10] = (sampleRate >> 12) & 0xff;
  b[11] = (sampleRate >> 4) & 0xff;
  b[12] = (sampleRate & 0x0f) << 4;
  b[13] = Math.floor(totalSamples / 2 ** 32) & 0x0f;
  b.writeUInt32BE(totalSamples % 2 ** 32, 14);
  return b;
}
export function vorbisComments(comments: string[], prefix: Buffer = Buffer.alloc(0)): Buffer {
  const vendor = Buffer.from('null-test');
  return Buffer.concat([
    prefix,
    le32(vendor.length),
    vendor,
    le32(comments.length),
    ...comments.flatMap((c) => [le32(Buffer.byteLength(c)), Buffer.from(c)]),
  ]);
}
export function flacPicture(data: Buffer): Buffer {
  const mime = Buffer.from('image/png');
  return Buffer.concat([be32(3), be32(mime.length), mime, be32(0), Buffer.alloc(16), be32(data.length), data]);
}
export const flacFile = (blocks: Buffer[]): Buffer => Buffer.concat([Buffer.from('fLaC'), ...blocks]);

/** One Ogg page holding one whole packet (packets < 65 KB). */
export function oggPage(packet: Buffer, seq: number): Buffer {
  const lacing: number[] = [];
  for (let n = packet.length; ; n -= 255) {
    if (n >= 255) lacing.push(255);
    else {
      lacing.push(n);
      break;
    }
  }
  const header = Buffer.alloc(27);
  header.write('OggS', 0, 'latin1');
  header.writeUInt32LE(seq, 18);
  header[26] = lacing.length;
  return Buffer.concat([header, Buffer.from(lacing), packet]);
}

export function mp4Atom(type: string, ...children: Buffer[]): Buffer {
  const body = Buffer.concat(children);
  return Buffer.concat([be32(8 + body.length), Buffer.from(type, 'latin1'), body]);
}
export const mp4Item = (type: string, value: Buffer, flags = 1): Buffer =>
  mp4Atom(type, mp4Atom('data', be32(flags), be32(0), value));
```

- [ ] **Step 2: Write the failing test `src/test/tagReader.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { after, test } from 'node:test';
import { readTags } from '../library/tagReader';
import {
  PNG, be32, flacBlock, flacFile, flacPicture, flacStreamInfo, id3Apic, id3Tag, id3Text, id3Utf16,
  id3v22Text, mp4Atom, mp4Item, oggPage, syncsafe, vorbisComments,
} from './fixtures';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-music-tags-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const write = (ext: string, data: Buffer): string => {
  const f = path.join(dir, `f${n++}${ext}`);
  fs.writeFileSync(f, data);
  return f;
};

test('mp3: ID3v2.3 latin1/utf-8/utf-16 frames and front cover', async () => {
  const t = await readTags(
    write('.mp3', id3Tag([
      id3Text('TIT2', 'Song'), id3Utf16('TPE1', 'Bänd'), id3Text('TALB', 'LP'), id3Text('TPE2', 'Various'),
      id3Text('TRCK', '3/12'), id3Text('TPOS', '1/2'), id3Text('TYER', '2019'), id3Apic(PNG),
    ]))
  );
  assert.strictEqual(t.title, 'Song');
  assert.strictEqual(t.artist, 'Bänd');
  assert.strictEqual(t.album, 'LP');
  assert.strictEqual(t.albumArtist, 'Various');
  assert.strictEqual(t.trackNo, 3);
  assert.strictEqual(t.discNo, 1);
  assert.strictEqual(t.year, 2019);
  assert.strictEqual(t.art?.ext, 'png');
  assert.deepStrictEqual(t.art?.data, PNG);
});

test('mp3: ID3v2.4 (syncsafe sizes, TDRC) and ID3v2.2', async () => {
  const v24 = await readTags(
    write('.mp3', id3Tag([id3Text('TIT2', 'Four', 4), id3Text('TDRC', '2020-05-01', 4), id3Apic(PNG, 4)], 4))
  );
  assert.strictEqual(v24.title, 'Four');
  assert.strictEqual(v24.year, 2020);
  assert.deepStrictEqual(v24.art?.data, PNG);

  const v22 = await readTags(write('.mp3', id3Tag([id3v22Text('TT2', 'Two'), id3v22Text('TP1', 'Old Band')], 2)));
  assert.strictEqual(v22.title, 'Two');
  assert.strictEqual(v22.artist, 'Old Band');
});

test('mp3: ID3v2.3 whole-tag unsynchronisation', async () => {
  const frame = Buffer.concat([Buffer.from('TIT2'), be32(3), Buffer.alloc(2), Buffer.from([0, 0xff, 0x00, 0x61])]);
  const file = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0x80]), syncsafe(frame.length), frame]);
  assert.strictEqual((await readTags(write('.mp3', file))).title, 'ÿa');
});

test('flac: STREAMINFO duration, vorbis comments and picture', async () => {
  const t = await readTags(
    write('.flac', flacFile([
      flacBlock(0, flacStreamInfo(44100, 441000)),
      flacBlock(4, vorbisComments(['TITLE=Flac Song', 'ARTIST=Band', 'ALBUM=LP', 'ALBUMARTIST=VA', 'TRACKNUMBER=7', 'DISCNUMBER=2', 'DATE=2001-02-03'])),
      flacBlock(6, flacPicture(PNG), true),
    ]))
  );
  assert.strictEqual(t.durationMs, 10000);
  assert.strictEqual(t.title, 'Flac Song');
  assert.strictEqual(t.artist, 'Band');
  assert.strictEqual(t.album, 'LP');
  assert.strictEqual(t.albumArtist, 'VA');
  assert.strictEqual(t.trackNo, 7);
  assert.strictEqual(t.discNo, 2);
  assert.strictEqual(t.year, 2001);
  assert.deepStrictEqual(t.art?.data, PNG);
});

test('opus and ogg vorbis: comment header and base64 picture', async () => {
  const pic = `METADATA_BLOCK_PICTURE=${flacPicture(PNG).toString('base64')}`;
  const opus = Buffer.concat([
    oggPage(Buffer.concat([Buffer.from('OpusHead'), Buffer.alloc(11)]), 0),
    oggPage(vorbisComments(['TITLE=Opus Song', 'ARTIST=Band', pic], Buffer.from('OpusTags')), 1),
  ]);
  const o = await readTags(write('.opus', opus));
  assert.strictEqual(o.title, 'Opus Song');
  assert.strictEqual(o.artist, 'Band');
  assert.deepStrictEqual(o.art?.data, PNG);

  const vorbis = Buffer.concat([
    oggPage(Buffer.concat([Buffer.from([1]), Buffer.from('vorbis'), Buffer.alloc(23)]), 0),
    oggPage(vorbisComments(['TITLE=Ogg Song'], Buffer.concat([Buffer.from([3]), Buffer.from('vorbis')])), 1),
  ]);
  assert.strictEqual((await readTags(write('.ogg', vorbis))).title, 'Ogg Song');
});

test('m4a: mvhd duration, ilst text, trkn/disk and covr (moov after mdat)', async () => {
  const mvhd = mp4Atom('mvhd', Buffer.concat([Buffer.alloc(12), be32(1000), be32(213000)]));
  const ilst = mp4Atom(
    'ilst',
    mp4Item('©nam', Buffer.from('M4A Song')),
    mp4Item('©ART', Buffer.from('M4A Band')),
    mp4Item('aART', Buffer.from('M4A VA')),
    mp4Item('©alb', Buffer.from('M4A LP')),
    mp4Item('©day', Buffer.from('2018-01-01')),
    mp4Item('trkn', Buffer.from([0, 0, 0, 5, 0, 12, 0, 0]), 0),
    mp4Item('disk', Buffer.from([0, 0, 0, 2, 0, 3]), 0),
    mp4Item('covr', PNG, 14)
  );
  const file = Buffer.concat([
    mp4Atom('ftyp', Buffer.from('M4A \0\0\0\0')),
    mp4Atom('mdat', Buffer.alloc(64)),
    mp4Atom('moov', mvhd, mp4Atom('udta', mp4Atom('meta', Buffer.alloc(4), ilst))),
  ]);
  const t = await readTags(write('.m4a', file));
  assert.strictEqual(t.durationMs, 213000);
  assert.strictEqual(t.title, 'M4A Song');
  assert.strictEqual(t.artist, 'M4A Band');
  assert.strictEqual(t.albumArtist, 'M4A VA');
  assert.strictEqual(t.album, 'M4A LP');
  assert.strictEqual(t.year, 2018);
  assert.strictEqual(t.trackNo, 5);
  assert.strictEqual(t.discNo, 2);
  assert.strictEqual(t.art?.ext, 'png');
});

test('truncated files return the tags parsed before the cut', async () => {
  const mp3 = id3Tag([id3Text('TIT2', 'Song'), id3Apic(PNG)]);
  const a = await readTags(write('.mp3', mp3.subarray(0, mp3.length - 5)));
  assert.strictEqual(a.title, 'Song');
  assert.strictEqual(a.art, undefined);

  const flac = flacFile([
    flacBlock(0, flacStreamInfo(44100, 441000)),
    flacBlock(4, vorbisComments(['TITLE=Cut', 'ARTIST=Band']), true),
  ]);
  const b = await readTags(write('.flac', flac.subarray(0, flac.length - 8)));
  assert.strictEqual(b.durationMs, 10000);
  assert.strictEqual(b.title, 'Cut');
  assert.strictEqual(b.artist, undefined);
});

test('garbage, oversized declared sizes and missing files yield empty tags without throwing', async () => {
  for (const ext of ['.mp3', '.flac', '.ogg', '.opus', '.m4a']) {
    assert.deepStrictEqual(await readTags(write(ext, Buffer.alloc(4096, 0xff))), {});
  }
  const bigSize = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(100), Buffer.alloc(100, 0xff)]);
  assert.deepStrictEqual(await readTags(write('.mp3', bigSize)), {});
  assert.deepStrictEqual(await readTags(path.join(dir, 'missing.mp3')), {});
  assert.deepStrictEqual(await readTags(write('.wav', Buffer.from('RIFF'))), {});
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../library/tagReader'`.

- [ ] **Step 4: Create `src/library/tagReader.ts` — helpers, dispatcher, FLAC, Ogg/Opus**

```ts
'use strict';

import type { FileHandle } from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';

export interface Tags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  durationMs?: number;
  art?: { data: Buffer; ext: 'jpg' | 'png' };
}

// ponytail: 16 MB art cap — raise only if a real library needs it
const MAX_ART_BYTES = 16 * 1024 * 1024;
// A tag region larger than this is parsed from its first MAX_TAG_BYTES only.
const MAX_TAG_BYTES = MAX_ART_BYTES + 1024 * 1024;

/** Reads a bounded head of the file. Malformed input yields whatever was parsed so far. */
export async function readTags(filePath: string): Promise<Tags> {
  const tags: Tags = {};
  let fh: FileHandle | undefined;
  try {
    fh = await fs.promises.open(filePath, 'r');
    switch (path.extname(filePath).toLowerCase()) {
      case '.mp3':
        await readId3(fh, tags);
        break;
      case '.flac':
        await readFlac(fh, tags);
        break;
      case '.ogg':
      case '.opus':
        await readOgg(fh, tags);
        break;
      case '.m4a':
        await readMp4(fh, tags);
        break;
    }
  } catch {
    // keep the partial result
  } finally {
    await fh?.close().catch(() => {});
  }
  return tags;
}

async function readAt(fh: FileHandle, pos: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return bytesRead === len ? buf : buf.subarray(0, bytesRead);
}

const num = (s: string): number | undefined => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function setArt(tags: Tags, data: Buffer, mime: string): void {
  if (data.length === 0 || data.length > MAX_ART_BYTES) return;
  tags.art = { data, ext: /png/i.test(mime) ? 'png' : 'jpg' };
}

// ─── Vorbis comments / FLAC pictures (shared by flac, ogg, opus) ─────────────

function readVorbisComments(buf: Buffer, pos: number): string[] {
  const out: string[] = [];
  if (pos + 4 > buf.length) return out;
  pos += 4 + buf.readUInt32LE(pos); // vendor string
  if (pos + 4 > buf.length) return out;
  const count = buf.readUInt32LE(pos);
  pos += 4;
  for (let i = 0; i < count && pos + 4 <= buf.length; i++) {
    const len = buf.readUInt32LE(pos);
    pos += 4;
    if (pos + len > buf.length) break;
    out.push(buf.toString('utf8', pos, pos + len));
    pos += len;
  }
  return out;
}

function applyVorbisComments(tags: Tags, comments: string[]): void {
  for (const c of comments) {
    const eq = c.indexOf('=');
    if (eq < 1) continue;
    const key = c.slice(0, eq).toUpperCase();
    const value = c.slice(eq + 1).trim();
    if (!value) continue;
    switch (key) {
      case 'TITLE': tags.title ??= value; break;
      case 'ARTIST': tags.artist ??= value; break;
      case 'ALBUM': tags.album ??= value; break;
      case 'ALBUMARTIST': tags.albumArtist ??= value; break;
      case 'TRACKNUMBER': tags.trackNo ??= num(value); break;
      case 'DISCNUMBER': tags.discNo ??= num(value); break;
      case 'DATE':
      case 'YEAR': tags.year ??= num(value.slice(0, 4)); break;
      case 'METADATA_BLOCK_PICTURE': readFlacPicture(tags, Buffer.from(value, 'base64')); break;
    }
  }
}

function readFlacPicture(tags: Tags, b: Buffer): void {
  try {
    let p = 4; // picture type
    const mimeLen = b.readUInt32BE(p);
    p += 4;
    const mime = b.toString('latin1', p, p + mimeLen);
    p += mimeLen;
    p += 4 + b.readUInt32BE(p); // description
    p += 16; // width, height, depth, colours
    const dataLen = b.readUInt32BE(p);
    p += 4;
    if (p + dataLen <= b.length) setArt(tags, b.subarray(p, p + dataLen), mime);
  } catch {
    // a bad picture must not hide the text tags
  }
}

// ─── FLAC ────────────────────────────────────────────────────────────────────

async function readFlac(fh: FileHandle, tags: Tags): Promise<void> {
  if ((await readAt(fh, 0, 4)).toString('latin1') !== 'fLaC') return;
  let pos = 4;
  for (;;) {
    const head = await readAt(fh, pos, 4);
    if (head.length < 4) return;
    const last = (head[0] & 0x80) !== 0;
    const type = head[0] & 0x7f;
    const len = head.readUIntBE(1, 3);
    pos += 4;
    if (type === 0 && len >= 18) {
      const b = await readAt(fh, pos, 18);
      if (b.length === 18) {
        const rate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
        const total = (b[13] & 0x0f) * 2 ** 32 + b.readUInt32BE(14);
        if (rate > 0 && total > 0) tags.durationMs = Math.round((total / rate) * 1000);
      }
    } else if (type === 4 && len <= MAX_TAG_BYTES) {
      applyVorbisComments(tags, readVorbisComments(await readAt(fh, pos, len), 0));
    } else if (type === 6 && len <= MAX_TAG_BYTES) {
      readFlacPicture(tags, await readAt(fh, pos, len));
    }
    if (last) return;
    pos += len;
  }
}

// ─── Ogg / Opus ──────────────────────────────────────────────────────────────

async function readOgg(fh: FileHandle, tags: Tags): Promise<void> {
  let pos = 0;
  let packet: Buffer[] = [];
  let packetBytes = 0;
  let packetNo = 0;
  for (;;) {
    const h = await readAt(fh, pos, 27);
    if (h.length < 27 || h.toString('latin1', 0, 4) !== 'OggS') return;
    const nseg = h[26];
    const lacing = await readAt(fh, pos + 27, nseg);
    if (lacing.length < nseg) return;
    const bodyLen = lacing.reduce((a, b) => a + b, 0);
    const body = await readAt(fh, pos + 27 + nseg, bodyLen);
    if (body.length < bodyLen) return;
    let off = 0;
    for (const lace of lacing) {
      packet.push(body.subarray(off, off + lace));
      packetBytes += lace;
      off += lace;
      if (lace < 255) {
        if (++packetNo === 2) {
          parseOggComments(tags, Buffer.concat(packet));
          return;
        }
        packet = [];
        packetBytes = 0;
      }
    }
    if (packetBytes > MAX_TAG_BYTES) return;
    pos += 27 + nseg + bodyLen;
  }
}

function parseOggComments(tags: Tags, b: Buffer): void {
  let off: number;
  if (b.toString('latin1', 0, 8) === 'OpusTags') off = 8;
  else if (b[0] === 3 && b.toString('latin1', 1, 7) === 'vorbis') off = 7;
  else return;
  applyVorbisComments(tags, readVorbisComments(b, off));
}
```

- [ ] **Step 5: Append the ID3 and MP4 readers to `src/library/tagReader.ts`**

```ts
// ─── MP3 / ID3v2 ─────────────────────────────────────────────────────────────

const syncsafe = (b: Buffer, o: number): number =>
  (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];

/** Removes the 0x00 inserted after every 0xFF. Returns the input when there is nothing to remove. */
function unsync(b: Buffer): Buffer {
  const parts: Buffer[] = [];
  let from = 0;
  for (let i = 0; i + 1 < b.length; i++) {
    if (b[i] === 0xff && b[i + 1] === 0x00) {
      parts.push(b.subarray(from, i + 1));
      from = i + 2;
      i++;
    }
  }
  if (from === 0) return b;
  parts.push(b.subarray(from));
  return Buffer.concat(parts);
}

function decodeText(enc: number, b: Buffer): string {
  let s: string;
  if (enc === 1 || enc === 2) {
    let body = b;
    let le = true;
    if (enc === 1 && b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) body = b.subarray(2);
    else if (enc === 1 && b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
      body = b.subarray(2);
      le = false;
    } else if (enc === 2) le = false;
    body = body.subarray(0, body.length & ~1);
    s = le ? body.toString('utf16le') : Buffer.from(body).swap16().toString('utf16le');
  } else {
    s = b.toString(enc === 3 ? 'utf8' : 'latin1');
  }
  return s.split('\0')[0].trim();
}

const frameText = (frame: Buffer): string => (frame.length > 1 ? decodeText(frame[0], frame.subarray(1)) : '');

/** Index just past the terminator of a string starting at `p` in encoding `enc`. */
function skipTerminated(d: Buffer, p: number, enc: number): number {
  if (enc === 1 || enc === 2) {
    for (; p + 1 < d.length; p += 2) if (d[p] === 0 && d[p + 1] === 0) return p + 2;
    return d.length;
  }
  const end = d.indexOf(0, p);
  return end < 0 ? d.length : end + 1;
}

function readId3Picture(tags: Tags, d: Buffer, v22: boolean): void {
  if (d.length < 4) return;
  const enc = d[0];
  let p = 1;
  let mime: string;
  if (v22) {
    mime = 'image/' + d.toString('latin1', 1, 4).toLowerCase();
    p = 4;
  } else {
    const end = d.indexOf(0, p);
    if (end < 0) return;
    mime = d.toString('latin1', p, end);
    p = end + 1;
  }
  const picType = d[p];
  p = skipTerminated(d, p + 1, enc);
  if (!tags.art || picType === 3) setArt(tags, d.subarray(p), mime);
}

async function readId3(fh: FileHandle, tags: Tags): Promise<void> {
  const head = await readAt(fh, 0, 10);
  if (head.length < 10 || head.toString('latin1', 0, 3) !== 'ID3') return;
  const major = head[3];
  if (major < 2 || major > 4) return;
  const flags = head[5];
  let tag = await readAt(fh, 10, Math.min(syncsafe(head, 6), MAX_TAG_BYTES));
  if (major === 3 && flags & 0x80) tag = unsync(tag); // 2.3: whole-tag unsynchronisation
  let pos = 0;
  if (flags & 0x40 && tag.length >= 4) pos = major === 4 ? syncsafe(tag, 0) : 4 + tag.readUInt32BE(0);
  const idLen = major === 2 ? 3 : 4;
  const headLen = major === 2 ? 6 : 10;
  while (pos + headLen <= tag.length) {
    const id = tag.toString('latin1', pos, pos + idLen);
    if (id.charCodeAt(0) === 0) break; // padding
    const size =
      major === 2 ? tag.readUIntBE(pos + 3, 3) : major === 4 ? syncsafe(tag, pos + 4) : tag.readUInt32BE(pos + 4);
    const fflags = major === 2 ? 0 : tag.readUInt16BE(pos + 8);
    const start = pos + headLen;
    if (start + size > tag.length) break;
    let data = tag.subarray(start, start + size);
    pos = start + size;
    if (major === 3) {
      if (fflags & 0x00c0) continue; // compressed / encrypted
      if (fflags & 0x0020) data = data.subarray(1); // grouping byte
    } else if (major === 4) {
      if (fflags & 0x000c) continue; // compressed / encrypted
      if (fflags & 0x0040) data = data.subarray(1); // grouping byte
      if (fflags & 0x0001) data = data.subarray(4); // data length indicator
      if (fflags & 0x0002 || flags & 0x80) data = unsync(data);
    }
    const value = id[0] === 'T' ? frameText(data) : '';
    switch (id) {
      case 'TIT2': case 'TT2': tags.title ??= value || undefined; break;
      case 'TPE1': case 'TP1': tags.artist ??= value || undefined; break;
      case 'TPE2': case 'TP2': tags.albumArtist ??= value || undefined; break;
      case 'TALB': case 'TAL': tags.album ??= value || undefined; break;
      case 'TRCK': case 'TRK': tags.trackNo ??= num(value); break;
      case 'TPOS': case 'TPA': tags.discNo ??= num(value); break;
      case 'TDRC': case 'TYER': case 'TYE': tags.year ??= num(value.slice(0, 4)); break;
      case 'APIC': case 'PIC': readId3Picture(tags, data, id === 'PIC'); break;
    }
  }
}

// ─── M4A / MP4 ───────────────────────────────────────────────────────────────

/** Yields `[type, payloadStart, payloadEnd]` for each atom in `b[start, end)`. */
function* atoms(b: Buffer, start: number, end: number): Generator<[string, number, number]> {
  let p = start;
  while (p + 8 <= end) {
    const size = b.readUInt32BE(p);
    if (size < 8 || p + size > end) return;
    yield [b.toString('latin1', p + 4, p + 8), p + 8, p + size];
    p += size;
  }
}

function parseIlst(tags: Tags, b: Buffer, start: number, end: number): void {
  for (const [type, s, e] of atoms(b, start, end)) {
    for (const [t2, s2, e2] of atoms(b, s, e)) {
      if (t2 !== 'data' || e2 - s2 < 8) continue;
      const flags = b.readUInt32BE(s2) & 0xffffff; // 1 = UTF-8, 13 = JPEG, 14 = PNG, 0 = implicit
      const v = b.subarray(s2 + 8, e2);
      const str = () => v.toString('utf8').trim();
      switch (type) {
        case '©nam': tags.title ??= str() || undefined; break;
        case '©ART': tags.artist ??= str() || undefined; break;
        case 'aART': tags.albumArtist ??= str() || undefined; break;
        case '©alb': tags.album ??= str() || undefined; break;
        case '©day': tags.year ??= num(str().slice(0, 4)); break;
        case 'trkn': if (v.length >= 4) tags.trackNo ??= v.readUInt16BE(2) || undefined; break;
        case 'disk': if (v.length >= 4) tags.discNo ??= v.readUInt16BE(2) || undefined; break;
        case 'covr': if (!tags.art) setArt(tags, v, flags === 14 ? 'png' : 'jpeg'); break;
      }
    }
  }
}

function parseMoov(tags: Tags, moov: Buffer): void {
  for (const [type, s, e] of atoms(moov, 0, moov.length)) {
    if (type === 'mvhd') {
      const v1 = moov[s] === 1;
      const scale = moov.readUInt32BE(s + (v1 ? 20 : 12));
      const dur = v1 ? Number(moov.readBigUInt64BE(s + 24)) : moov.readUInt32BE(s + 16);
      if (scale > 0 && dur > 0) tags.durationMs = Math.round((dur / scale) * 1000);
    } else if (type === 'udta') {
      for (const [t2, s2, e2] of atoms(moov, s, e)) {
        if (t2 !== 'meta') continue;
        for (const [t3, s3, e3] of atoms(moov, s2 + 4, e2)) { // meta is a full box: skip version/flags
          if (t3 === 'ilst') parseIlst(tags, moov, s3, e3);
        }
      }
    }
  }
}

async function readMp4(fh: FileHandle, tags: Tags): Promise<void> {
  let pos = 0;
  for (;;) {
    const h = await readAt(fh, pos, 16);
    if (h.length < 8) return;
    let size = h.readUInt32BE(0);
    let headLen = 8;
    if (size === 1) {
      if (h.length < 16) return;
      size = Number(h.readBigUInt64BE(8));
      headLen = 16;
    }
    if (size < headLen) return; // size 0 (to EOF) or corrupt
    if (h.toString('latin1', 4, 8) === 'moov') {
      if (size > MAX_TAG_BYTES * 2) return;
      parseMoov(tags, await readAt(fh, pos + headLen, size - headLen));
      return;
    }
    pos += size;
  }
}
```

- [ ] **Step 6: Register and run**

In `package.json` append ` out/test/tagReader.test.js` to the test list.

Run: `npm test`
Expected: PASS. If a format test fails, fix the parser (not the fixture) unless the fixture contradicts the format spec.

- [ ] **Step 7: Commit**

```bash
git add src/library/tagReader.ts src/test/tagReader.test.ts src/test/fixtures.ts package.json
git commit -m "feat(null-music): add dependency-free tag reader for mp3, flac, ogg/opus and m4a"
```

---

### Task 4: Library cache

**Files:**
- Create: `src/library/libraryCache.ts`, `src/test/libraryCache.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `CACHE_VERSION = 1`; `interface CachedTags { title?, artist?, album?, albumArtist?: string; trackNo?, discNo?, year?, durationMs?: number; artKey?: string }`; `class LibraryCache(file)` with `load(): Promise<void>`, `lookup(file, mtime, size): CachedTags | undefined`, `set(file, mtime, size, tags)`, `setDuration(file, ms)`, `prune(keep: Set<string>)`, `entries(): IterableIterator<[string, CachedTags]>`, `save(): Promise<void>` (serialised, atomic, never rejects, no-op when clean).

- [ ] **Step 1: Write the failing test `src/test/libraryCache.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { after, test } from 'node:test';
import { CACHE_VERSION, LibraryCache } from '../library/libraryCache';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-music-cache-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const cacheFile = () => path.join(dir, `c${n++}`, 'library-cache.json');

test('lookup reuses an entry only when mtime and size both match', () => {
  const c = new LibraryCache(cacheFile());
  c.set('/m/a.mp3', 100, 5, { title: 'A' });
  assert.deepStrictEqual(c.lookup('/m/a.mp3', 100, 5), { title: 'A' });
  assert.strictEqual(c.lookup('/m/a.mp3', 101, 5), undefined);
  assert.strictEqual(c.lookup('/m/a.mp3', 100, 6), undefined);
  assert.strictEqual(c.lookup('/m/other.mp3', 100, 5), undefined);
});

test('an untagged file caches as {} and still counts as a hit', () => {
  const c = new LibraryCache(cacheFile());
  c.set('/m/a.mp3', 1, 1, {});
  assert.deepStrictEqual(c.lookup('/m/a.mp3', 1, 1), {});
});

test('save writes atomically, load restores, prune drops unseen files', async () => {
  const file = cacheFile();
  const c = new LibraryCache(file);
  c.set('/m/a.mp3', 1, 1, { title: 'A' });
  c.set('/m/b.mp3', 2, 2, { title: 'B' });
  c.prune(new Set(['/m/a.mp3']));
  await c.save();
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['library-cache.json']); // no .tmp left

  const again = new LibraryCache(file);
  await again.load();
  assert.deepStrictEqual([...again.entries()], [['/m/a.mp3', { title: 'A' }]]);
});

test('setDuration persists the learned duration', async () => {
  const file = cacheFile();
  const c = new LibraryCache(file);
  c.set('/m/a.mp3', 1, 1, { title: 'A' });
  await c.save();
  c.setDuration('/m/a.mp3', 123000);
  await c.save();
  const again = new LibraryCache(file);
  await again.load();
  assert.strictEqual(again.lookup('/m/a.mp3', 1, 1)?.durationMs, 123000);
});

test('corrupt or wrong-version caches are discarded', async () => {
  const file = cacheFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  const a = new LibraryCache(file);
  await a.load();
  assert.deepStrictEqual([...a.entries()], []);

  fs.writeFileSync(file, JSON.stringify({ version: CACHE_VERSION + 1, entries: { '/m/a.mp3': { mtime: 1, size: 1, tags: {} } } }));
  const b = new LibraryCache(file);
  await b.load();
  assert.deepStrictEqual([...b.entries()], []);
});

test('a clean cache does not touch disk and an unwritable path never throws', async () => {
  const file = cacheFile();
  await new LibraryCache(file).save();
  assert.strictEqual(fs.existsSync(file), false);

  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'x');
  const c = new LibraryCache(path.join(blocker, 'library-cache.json'));
  c.set('/m/a.mp3', 1, 1, {});
  await c.save(); // resolves
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../library/libraryCache'`.

- [ ] **Step 3: Create `src/library/libraryCache.ts`**

```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';

export const CACHE_VERSION = 1;

/** Tags minus the cover bytes: the cover lives in the art directory, keyed by `artKey`. */
export interface CachedTags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  durationMs?: number;
  artKey?: string;
}

interface CacheEntry {
  mtime: number;
  size: number;
  tags: CachedTags;
}

export class LibraryCache {
  private readonly map = new Map<string, CacheEntry>();
  private dirty = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    this.map.clear();
    this.dirty = false;
    try {
      const raw = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
      if (raw?.version !== CACHE_VERSION || typeof raw.entries !== 'object' || raw.entries === null) return;
      for (const [file, e] of Object.entries<any>(raw.entries)) {
        if (typeof e?.mtime === 'number' && typeof e?.size === 'number' && typeof e?.tags === 'object' && e.tags !== null) {
          this.map.set(file, { mtime: e.mtime, size: e.size, tags: e.tags });
        }
      }
    } catch {
      this.map.clear(); // missing, unreadable or corrupt: start fresh
    }
  }

  lookup(file: string, mtime: number, size: number): CachedTags | undefined {
    const e = this.map.get(file);
    return e && e.mtime === mtime && e.size === size ? e.tags : undefined;
  }

  set(file: string, mtime: number, size: number, tags: CachedTags): void {
    this.map.set(file, { mtime, size, tags });
    this.dirty = true;
  }

  setDuration(file: string, durationMs: number): void {
    const e = this.map.get(file);
    if (!e) return;
    e.tags.durationMs = durationMs;
    this.dirty = true;
  }

  prune(keep: Set<string>): void {
    for (const file of [...this.map.keys()]) {
      if (!keep.has(file)) {
        this.map.delete(file);
        this.dirty = true;
      }
    }
  }

  *entries(): IterableIterator<[string, CachedTags]> {
    for (const [file, e] of this.map) yield [file, e.tags];
  }

  save(): Promise<void> {
    this.chain = this.chain.then(() => this.write());
    return this.chain;
  }

  private async write(): Promise<void> {
    if (!this.dirty) return;
    const tmp = `${this.file}.tmp`;
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await fs.promises.writeFile(tmp, JSON.stringify({ version: CACHE_VERSION, entries: Object.fromEntries(this.map) }));
      await fs.promises.rename(tmp, this.file);
      this.dirty = false;
    } catch {
      // an unwritable cache only costs a re-scan next start
    }
  }
}
```

- [ ] **Step 4: Register and run**

In `package.json` append ` out/test/libraryCache.test.js`.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/library/libraryCache.ts src/test/libraryCache.test.ts package.json
git commit -m "feat(null-music): add JSON library cache with atomic writes"
```

---

### Task 5: Library (scan, tags, art, likes, playlists)

**Files:**
- Create: `src/library/library.ts`, `src/test/library.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `readTags`/`Tags` (Task 3), `LibraryCache`/`CachedTags` (Task 4), `parseM3u` (Task 1), `pathToUri`/`uriToPath`, `Emitter`, `KeyValueStore`, `Track`.
- Produces:
  - `interface LibraryOptions { state: KeyValueStore; cacheFile: string; artDir: string; extensions: () => string[]; concurrency?: number }`
  - `interface StoredPlaylist { id; name; filePath; tracks: Track[] }`
  - `interface Collection { id: string; kind: 'liked'|'playlist'|'folder'; name: string; detail: string; tracks: Track[] }`
  - `class Library(options)`: events `onDidChange`, `onDidChangeSources`; getters `tracks`, `folders`, `playlists`, `playlistPaths`, `progress: {scanned,total}`; `loadCache()`, `rescan()`, `addFolder(uri): Promise<Track[]>`, `removeFolder(uri)`, `tracksInFolder(uri)`, `importPlaylist(pathOrUri, content?)`, `removePlaylist(id)`, `playlistTracks(id)` (`'favorites'` = liked), `isLiked(id)`, `toggleLike(id): Promise<boolean>`, `likedTracks()`, `search(q)`, `collections()`, `trackById(id)`, `trackByUri(uri)`, `contextFor(uri): {tracks,index}|undefined`, `learnDuration(id, ms)`, `dispose()`.

- [ ] **Step 1: Write the failing test `src/test/library.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { after, test } from 'node:test';
import { Library } from '../library/library';
import { pathToUri } from '../uri';
import { MemState, PNG, id3Apic, id3Tag, id3Text } from './fixtures';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-music-lib-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
let n = 0;

const TAGGED = id3Tag([id3Text('TIT2', 'Tagged'), id3Text('TPE1', 'Tagger'), id3Text('TALB', 'Album X'), id3Apic(PNG)]);

/** music/Alpha/01 - Daft Punk - One More Time.mp3 (untagged), music/Beta/tagged.mp3, plus noise. */
function fixture() {
  const base = path.join(root, `case${n++}`);
  const music = path.join(base, 'music');
  const files = {
    alpha: path.join(music, 'Alpha', '01 - Daft Punk - One More Time.mp3'),
    tagged: path.join(music, 'Beta', 'tagged.mp3'),
  };
  fs.mkdirSync(path.dirname(files.alpha), { recursive: true });
  fs.mkdirSync(path.dirname(files.tagged), { recursive: true });
  fs.mkdirSync(path.join(music, '.hidden'), { recursive: true });
  fs.writeFileSync(files.alpha, 'x');
  fs.writeFileSync(files.tagged, TAGGED);
  fs.writeFileSync(path.join(music, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(music, '.hidden', 'h.mp3'), 'x');
  return { base, music, folderUri: pathToUri(music), files, cache: path.join(base, 'cache.json'), art: path.join(base, 'art') };
}

function make(fx: ReturnType<typeof fixture>, state = new MemState()) {
  return { state, lib: new Library({ state, cacheFile: fx.cache, artDir: fx.art, extensions: () => ['.mp3'], concurrency: 4 }) };
}

test('addFolder scans, falls back to filenames, reads tags and writes cover art', async () => {
  const fx = fixture();
  const { lib, state } = make(fx);
  const added = await lib.addFolder(fx.folderUri);
  assert.strictEqual(added.length, 2); // notes.txt and .hidden ignored
  const [alpha, tagged] = added;
  assert.strictEqual(alpha.name, 'One More Time');
  assert.strictEqual(alpha.artist, 'Daft Punk');
  assert.strictEqual(alpha.id, `local:${pathToUri(fx.files.alpha)}`); // same id format as before: likes survive
  assert.strictEqual(alpha.folder, fx.folderUri);
  assert.strictEqual(tagged.name, 'Tagged');
  assert.strictEqual(tagged.artist, 'Tagger');
  assert.strictEqual(tagged.album, 'Album X');
  assert.match(tagged.artKey ?? '', /^[0-9a-f]+\.png$/);
  assert.ok(fs.existsSync(path.join(fx.art, tagged.artKey!)));
  assert.deepStrictEqual(state.get('null-music.local.folders', []), [fx.folderUri]);
  assert.deepStrictEqual(lib.progress, { scanned: 2, total: 2 });
  lib.dispose();
});

test('emits onDidChange while scanning', async () => {
  const fx = fixture();
  const { lib } = make(fx);
  let fired = 0;
  lib.onDidChange(() => fired++);
  await lib.addFolder(fx.folderUri);
  assert.ok(fired >= 1);
  lib.dispose();
});

test('the cache is reused while mtime/size match and re-read when the file changes', async () => {
  const fx = fixture();
  const first = make(fx);
  await first.lib.addFolder(fx.folderUri);
  first.lib.dispose();

  const raw = JSON.parse(fs.readFileSync(fx.cache, 'utf8'));
  raw.entries[fx.files.tagged].tags.title = 'FromCache';
  fs.writeFileSync(fx.cache, JSON.stringify(raw));

  const second = make(fx, first.state);
  await second.lib.loadCache();
  assert.ok(second.lib.tracks.some((t) => t.name === 'FromCache')); // instant, before any scan
  await second.lib.rescan();
  assert.ok(second.lib.tracks.some((t) => t.name === 'FromCache')); // reused: mtime and size unchanged

  const later = new Date(Date.now() + 5000);
  fs.utimesSync(fx.files.tagged, later, later);
  await second.lib.rescan();
  assert.ok(second.lib.tracks.some((t) => t.name === 'Tagged')); // re-read
  second.lib.dispose();
});

test('deleted files leave the library and the cache', async () => {
  const fx = fixture();
  const { lib } = make(fx);
  await lib.addFolder(fx.folderUri);
  fs.rmSync(fx.files.alpha);
  await lib.rescan();
  assert.deepStrictEqual(lib.tracks.map((t) => t.name), ['Tagged']);
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(fx.cache, 'utf8')).entries), [fx.files.tagged]);
  lib.dispose();
});

test('a missing or offline folder does not throw or hide the other folders', async () => {
  const fx = fixture();
  const state = new MemState();
  await state.update('null-music.local.folders', [pathToUri(path.join(fx.base, 'nope')), fx.folderUri]);
  const { lib } = make(fx, state);
  await lib.rescan();
  assert.strictEqual(lib.tracks.length, 2);
  lib.dispose();
});

test('likes persist under the existing key and survive a new instance', async () => {
  const fx = fixture();
  const a = make(fx);
  const [alpha] = await a.lib.addFolder(fx.folderUri);
  assert.strictEqual(await a.lib.toggleLike(alpha.id), true);
  assert.deepStrictEqual(a.state.get('null-music.local.liked', []), [alpha.id]);
  a.lib.dispose();

  const b = make(fx, a.state);
  assert.strictEqual(b.lib.isLiked(alpha.id), true);
  assert.strictEqual(await b.lib.toggleLike(alpha.id), false);
  assert.strictEqual(b.lib.isLiked(alpha.id), false);
  b.lib.dispose();
});

test('playlists resolve to library tracks, read tags for outside files, keep streams, and get distinct ids', async () => {
  const fx = fixture();
  const outside = path.join(fx.base, 'other', 'solo.mp3');
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, id3Tag([id3Text('TIT2', 'Solo'), id3Text('TPE1', 'Lone')]));

  const { lib, state } = make(fx);
  await lib.addFolder(fx.folderUri);
  const content = `#EXTM3U\n#PLAYLIST:Mix\n${fx.files.alpha}\n${outside}\nhttps://x.test/stream.mp3\n`;
  const pl = await lib.importPlaylist(path.join(fx.base, 'mix.m3u8'), content);
  assert.strictEqual(pl.name, 'Mix');
  assert.strictEqual(pl.tracks.length, 3);
  assert.strictEqual(pl.tracks[0], lib.trackByUri(pl.tracks[0].uri)); // the library's own track
  assert.strictEqual(pl.tracks[0].name, 'One More Time');
  assert.strictEqual(pl.tracks[1].name, 'Solo');
  assert.strictEqual(pl.tracks[1].artist, 'Lone');
  assert.ok(lib.trackById(pl.tracks[1].id)); // resolvable (session restore) ...
  assert.strictEqual(lib.tracks.length, 2); // ... but not part of the library list
  assert.strictEqual(pl.tracks[2].uri, 'https://x.test/stream.mp3');

  const pl2 = await lib.importPlaylist(path.join(fx.base, 'mix2.m3u8'), content);
  assert.notStrictEqual(pl.id, pl2.id);
  assert.strictEqual(lib.playlists.length, 2);

  await lib.removePlaylist(pl.id);
  assert.strictEqual(lib.playlists.length, 1);
  assert.deepStrictEqual(state.get('null-music.local.playlists', []), [pl2.filePath]);
  lib.dispose();
});

test('collections, search and contextFor', async () => {
  const fx = fixture();
  const { lib } = make(fx);
  const [alpha, tagged] = await lib.addFolder(fx.folderUri);
  await lib.toggleLike(alpha.id);
  await lib.importPlaylist(path.join(fx.base, 'mix.m3u8'), `#PLAYLIST:Mix\n${fx.files.tagged}\n`);

  assert.deepStrictEqual(lib.collections().map((c) => c.kind), ['liked', 'playlist', 'folder']);
  assert.strictEqual(lib.collections()[2].tracks.length, 2);
  assert.deepStrictEqual(lib.search('tagger').map((t) => t.name), ['Tagged']);
  assert.strictEqual(lib.search('').length, 2);
  assert.strictEqual(lib.contextFor(tagged.uri)?.index, 1);
  assert.strictEqual(lib.contextFor('file:///nowhere.mp3'), undefined);
  lib.dispose();
});

test('learnDuration updates the track and the cache', async () => {
  const fx = fixture();
  const { lib } = make(fx);
  const [alpha] = await lib.addFolder(fx.folderUri);
  lib.learnDuration(alpha.id, 200000);
  assert.strictEqual(lib.trackById(alpha.id)?.durationMs, 200000);
  lib.dispose(); // flushes the cache
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(JSON.parse(fs.readFileSync(fx.cache, 'utf8')).entries[fx.files.alpha].tags.durationMs, 200000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../library/library'`.

- [ ] **Step 3: Create `src/library/library.ts` — module header, helpers, class state**

```ts
'use strict';

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Emitter } from '../emitter';
import { KeyValueStore, Track } from '../types';
import { pathToUri, uriToPath } from '../uri';
import { CachedTags, LibraryCache } from './libraryCache';
import { parseM3u } from './m3uParser';
import { readTags, Tags } from './tagReader';

const KEY_FOLDERS = 'null-music.local.folders';
const KEY_LIKED = 'null-music.local.liked';
const KEY_PLAYLISTS = 'null-music.local.playlists';
const MAX_DEPTH = 4;
const EMIT_THROTTLE_MS = 300;
const SAVE_DELAY_MS = 2000;

export interface LibraryOptions {
  state: KeyValueStore;
  cacheFile: string;
  artDir: string;
  extensions: () => string[];
  concurrency?: number;
}

export interface StoredPlaylist {
  id: string;
  name: string;
  filePath: string;
  tracks: Track[];
}

export interface Collection {
  id: string;
  kind: 'liked' | 'playlist' | 'folder';
  name: string;
  detail: string;
  tracks: Track[];
}

async function walk(dir: string, exts: Set<string>, depth: number): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return []; // missing or offline folder
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.')) out.push(...(await walk(full, exts, depth + 1)));
    } else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** `Artist - Title` filename convention, else the folder name as artist. */
function filenameMeta(filePath: string, folderName: string): { name: string; artist: string } {
  const base = path.basename(filePath, path.extname(filePath)).trim().replace(/^\d+[\s.\-_]+/, '');
  const sep = base.indexOf(' - ');
  if (sep >= 0) return { artist: base.slice(0, sep).trim(), name: base.slice(sep + 3).trim() };
  return { artist: folderName, name: base };
}

const playlistId = (fsPath: string): string => crypto.createHash('sha1').update(fsPath).digest('hex').slice(0, 16);

export class Library {
  private readonly cache: LibraryCache;
  private folderUris: string[];
  private playlistFiles: string[];
  private readonly liked: Set<string>;
  private readonly byFolder = new Map<string, Map<string, Track>>(); // folder uri → file path → track
  private readonly playlistMap = new Map<string, StoredPlaylist>();
  private readonly external = new Map<string, Track>(); // playlist-only tracks, by id
  private flat: Track[] | undefined;
  private index: Map<string, Track> | undefined;
  private scanned = 0;
  private total = 0;
  private scanning: Promise<void> | undefined;
  private scanAgain = false;
  private emitTimer: NodeJS.Timeout | undefined;
  private saveTimer: NodeJS.Timeout | undefined;
  private readonly changeEmitter = new Emitter<void>();
  private readonly sourcesEmitter = new Emitter<void>();

  /** Tracks, scan progress or likes-affecting data changed (throttled while scanning). */
  readonly onDidChange = this.changeEmitter.event;
  /** Folders or playlists were added/removed/reloaded. */
  readonly onDidChangeSources = this.sourcesEmitter.event;

  constructor(private readonly options: LibraryOptions) {
    this.cache = new LibraryCache(options.cacheFile);
    this.folderUris = [...options.state.get<string[]>(KEY_FOLDERS, [])];
    this.playlistFiles = [...options.state.get<string[]>(KEY_PLAYLISTS, [])];
    this.liked = new Set(options.state.get<string[]>(KEY_LIKED, []));
  }
```

- [ ] **Step 4: Append the read side (getters, lookups, collections, likes, search)**

```ts
  // ─── Read side ─────────────────────────────────────────────────────────────

  get tracks(): Track[] {
    if (!this.flat) this.flat = this.folderUris.flatMap((f) => this.tracksInFolder(f));
    return this.flat;
  }

  get folders(): string[] {
    return [...this.folderUris];
  }

  get playlists(): StoredPlaylist[] {
    return [...this.playlistMap.values()];
  }

  get playlistPaths(): string[] {
    return [...this.playlistFiles];
  }

  get progress(): { scanned: number; total: number } {
    return { scanned: this.scanned, total: this.total };
  }

  tracksInFolder(folder: string): Track[] {
    return [...(this.byFolder.get(folder)?.values() ?? [])].sort((a, b) => a.uri.localeCompare(b.uri));
  }

  trackById(id: string): Track | undefined {
    return this.lookup().get(id);
  }

  trackByUri(uri: string): Track | undefined {
    return this.trackById(`local:${uri}`);
  }

  /** The list a track should play in (the library, else the first playlist holding it). */
  contextFor(uri: string): { tracks: Track[]; index: number } | undefined {
    for (const list of [this.tracks, ...this.playlists.map((p) => p.tracks)]) {
      const index = list.findIndex((t) => t.uri === uri);
      if (index >= 0) return { tracks: list, index };
    }
    return undefined;
  }

  playlistTracks(id: string): Track[] {
    return id === 'favorites' ? this.likedTracks() : this.playlistMap.get(id)?.tracks ?? [];
  }

  collections(): Collection[] {
    const out: Collection[] = [];
    const liked = this.likedTracks();
    if (liked.length > 0) {
      out.push({ id: 'favorites', kind: 'liked', name: 'Liked Tracks', detail: `${liked.length} favorite track${liked.length !== 1 ? 's' : ''}`, tracks: liked });
    }
    for (const p of this.playlistMap.values()) {
      out.push({ id: p.id, kind: 'playlist', name: p.name, detail: p.filePath, tracks: p.tracks });
    }
    for (const f of this.folderUris) {
      out.push({ id: f, kind: 'folder', name: path.basename(uriToPath(f)) || f, detail: f, tracks: this.tracksInFolder(f) });
    }
    return out;
  }

  search(query: string): Track[] {
    const q = query.toLowerCase().trim();
    if (!q) return this.tracks;
    return this.tracks.filter(
      (t) => t.name.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q)
    );
  }

  isLiked(id: string): boolean {
    return this.liked.has(id);
  }

  likedTracks(): Track[] {
    return this.tracks.filter((t) => this.liked.has(t.id));
  }

  async toggleLike(id: string): Promise<boolean> {
    if (!this.liked.delete(id)) this.liked.add(id);
    await this.options.state.update(KEY_LIKED, [...this.liked]);
    return this.liked.has(id);
  }

  /** Called with the duration the audio element measured on first play. */
  learnDuration(id: string, durationMs: number): void {
    const track = this.trackById(id);
    if (!track || Math.abs(track.durationMs - durationMs) < 500) return;
    track.durationMs = durationMs;
    if (track.uri.startsWith('file://')) {
      this.cache.setDuration(uriToPath(track.uri), durationMs);
      this.saveSoon();
    }
    this.changed();
  }

  dispose(): void {
    clearTimeout(this.emitTimer);
    clearTimeout(this.saveTimer);
    void this.cache.save();
    this.changeEmitter.dispose();
    this.sourcesEmitter.dispose();
  }

  private lookup(): Map<string, Track> {
    if (!this.index) {
      this.index = new Map([...this.external, ...this.tracks.map((t): [string, Track] => [t.id, t])]);
    }
    return this.index;
  }
```

- [ ] **Step 5: Append the write side (folders, scanning, playlists, internals) and close the class**

```ts
  // ─── Folders and scanning ──────────────────────────────────────────────────

  /** Populate from the cache without touching the disk, so the UI fills instantly. */
  async loadCache(): Promise<void> {
    await this.cache.load();
    const exts = this.extensionSet();
    for (const folder of this.folderUris) {
      const root = uriToPath(folder);
      const prefix = root.endsWith(path.sep) ? root : root + path.sep;
      const bucket = new Map<string, Track>();
      for (const [file, tags] of this.cache.entries()) {
        if (file.startsWith(prefix) && exts.has(path.extname(file).toLowerCase())) {
          bucket.set(file, this.buildTrack(file, folder, tags));
        }
      }
      this.byFolder.set(folder, bucket);
    }
    await this.loadPlaylists();
    this.fireNow();
  }

  rescan(): Promise<void> {
    if (this.scanning) {
      this.scanAgain = true;
      return this.scanning;
    }
    this.scanning = (async () => {
      try {
        do {
          this.scanAgain = false;
          await this.scanAll();
        } while (this.scanAgain);
      } finally {
        this.scanning = undefined;
      }
    })();
    return this.scanning;
  }

  async addFolder(folder: string): Promise<Track[]> {
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
  }

  async removeFolder(folder: string): Promise<void> {
    this.folderUris = this.folderUris.filter((u) => u !== folder);
    this.byFolder.delete(folder);
    await this.options.state.update(KEY_FOLDERS, [...this.folderUris]);
    this.changed();
    this.sourcesEmitter.fire();
  }

  private async scanAll(): Promise<void> {
    this.scanned = 0;
    this.total = 0;
    for (const folder of [...this.folderUris]) await this.scanFolder(folder);
    // ponytail: an offline folder's cache entries are dropped here and re-read when it returns
    this.cache.prune(new Set([...this.byFolder.values()].flatMap((bucket) => [...bucket.keys()])));
    await this.cache.save();
    await this.loadPlaylists();
    this.scanned = this.total;
    this.fireNow();
  }

  private async scanFolder(folder: string): Promise<void> {
    const files = await walk(uriToPath(folder), this.extensionSet(), 0);
    const bucket = this.byFolder.get(folder) ?? new Map<string, Track>();
    this.byFolder.set(folder, bucket);
    this.total += files.length;
    await mapPool(files, this.options.concurrency ?? 8, async (file) => {
      try {
        const st = await fs.promises.stat(file);
        const tags = this.cache.lookup(file, st.mtimeMs, st.size) ?? (await this.readAndCache(file, st));
        bucket.set(file, this.buildTrack(file, folder, tags));
        this.changed();
      } catch {
        // unreadable file: leave it out
      }
      this.scanned++;
    });
    const present = new Set(files);
    for (const file of [...bucket.keys()]) if (!present.has(file)) bucket.delete(file);
    if (!this.folderUris.includes(folder)) this.byFolder.delete(folder); // removed mid-scan
    this.changed();
  }

  private async readAndCache(file: string, st: fs.Stats): Promise<CachedTags> {
    const { art, ...tags }: Tags = await readTags(file);
    const cached: CachedTags = tags;
    if (art) cached.artKey = await this.writeArt(art);
    this.cache.set(file, st.mtimeMs, st.size, cached);
    return cached;
  }

  /** Content-addressed: the same cover is written once and shared by the whole album. */
  private async writeArt(art: NonNullable<Tags['art']>): Promise<string | undefined> {
    const key = `${crypto.createHash('sha1').update(art.data).digest('hex').slice(0, 20)}.${art.ext}`;
    try {
      await fs.promises.mkdir(this.options.artDir, { recursive: true });
      await fs.promises.writeFile(path.join(this.options.artDir, key), art.data, { flag: 'wx' });
    } catch (err: any) {
      if (err?.code !== 'EEXIST') return undefined;
    }
    return key;
  }

  private buildTrack(file: string, folder: string, tags: CachedTags): Track {
    const uri = pathToUri(file);
    const fallback = filenameMeta(file, path.basename(uriToPath(folder)));
    const artist = tags.artist || fallback.artist;
    return {
      id: `local:${uri}`,
      name: tags.title || fallback.name,
      artist,
      artists: [artist],
      album: tags.album ?? '',
      albumArtist: tags.albumArtist ?? '',
      trackNo: tags.trackNo,
      discNo: tags.discNo,
      year: tags.year,
      artKey: tags.artKey,
      durationMs: tags.durationMs ?? 0,
      uri,
      folder,
    };
  }

  private extensionSet(): Set<string> {
    return new Set(this.options.extensions().map((e) => e.toLowerCase()));
  }

  // ─── Playlists ─────────────────────────────────────────────────────────────

  async importPlaylist(filePathOrUri: string, content?: string): Promise<StoredPlaylist> {
    const playlist = await this.loadPlaylistFile(filePathOrUri, content);
    if (!this.playlistFiles.includes(playlist.filePath)) {
      this.playlistFiles.push(playlist.filePath);
      await this.options.state.update(KEY_PLAYLISTS, [...this.playlistFiles]);
    }
    this.changed();
    this.sourcesEmitter.fire();
    return playlist;
  }

  async removePlaylist(id: string): Promise<void> {
    const playlist = this.playlistMap.get(id);
    if (!playlist) return;
    this.playlistMap.delete(id);
    this.playlistFiles = this.playlistFiles.filter((p) => p !== playlist.filePath);
    await this.options.state.update(KEY_PLAYLISTS, [...this.playlistFiles]);
    this.changed();
    this.sourcesEmitter.fire();
  }

  private async loadPlaylists(): Promise<void> {
    this.external.clear();
    this.playlistMap.clear();
    this.index = undefined;
    for (const file of this.playlistFiles) {
      try {
        await this.loadPlaylistFile(file);
      } catch (err) {
        console.error('Null Music: failed to load playlist', file, err);
      }
    }
    this.changed();
    this.sourcesEmitter.fire();
  }

  private async loadPlaylistFile(filePathOrUri: string, content?: string): Promise<StoredPlaylist> {
    const fsPath = filePathOrUri.startsWith('file://') ? uriToPath(filePathOrUri) : filePathOrUri;
    if (content === undefined) {
      try {
        content = await fs.promises.readFile(fsPath, 'utf8');
      } catch (err: any) {
        throw new Error(`Failed to read playlist file "${fsPath}": ${err.message}`);
      }
    }
    const parsed = parseM3u(content, fsPath);
    const tracks: Track[] = new Array(parsed.tracks.length);
    await mapPool(
      parsed.tracks.map((_, i) => i),
      this.options.concurrency ?? 8,
      async (i) => {
        tracks[i] = await this.resolveEntry(parsed.tracks[i]);
      }
    );
    const stored: StoredPlaylist = { id: playlistId(fsPath), name: parsed.name, filePath: fsPath, tracks };
    this.playlistMap.set(stored.id, stored);
    for (const t of tracks) this.external.set(t.id, t);
    this.index = undefined;
    return stored;
  }

  /** A library track wins; otherwise tags are read from the file; streams are kept as parsed. */
  private async resolveEntry(entry: Track): Promise<Track> {
    const known = this.trackById(entry.id);
    if (known) return known;
    if (!entry.uri.startsWith('file://')) return { ...entry, album: '', folder: '' };
    const tags = await readTags(uriToPath(entry.uri));
    const artist = tags.artist || entry.artist;
    return {
      ...entry,
      name: tags.title || entry.name,
      artist,
      artists: [artist],
      album: tags.album ?? '',
      albumArtist: tags.albumArtist ?? '',
      trackNo: tags.trackNo,
      discNo: tags.discNo,
      year: tags.year,
      durationMs: entry.durationMs || tags.durationMs || 0,
      folder: '',
    };
  }

  // ─── Change notification ───────────────────────────────────────────────────

  private changed(): void {
    this.flat = undefined;
    this.index = undefined;
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined;
      this.changeEmitter.fire();
    }, EMIT_THROTTLE_MS);
    this.emitTimer.unref();
  }

  private fireNow(): void {
    clearTimeout(this.emitTimer);
    this.emitTimer = undefined;
    this.flat = undefined;
    this.index = undefined;
    this.changeEmitter.fire();
  }

  private saveSoon(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.cache.save();
    }, SAVE_DELAY_MS);
    this.saveTimer.unref();
  }
}
```

- [ ] **Step 6: Register and run**

In `package.json` append ` out/test/library.test.js`.

Run: `npm test`
Expected: PASS. Failure hints: a playlist-test mismatch on `pl.tracks[0] === lib.trackByUri(...)` means `pathToUri` in `m3uParser` and `Library.buildTrack` disagree on URI form — fix `uri.ts`, not the test.

- [ ] **Step 7: Commit**

```bash
git add src/library/library.ts src/test/library.test.ts package.json
git commit -m "feat(null-music): add Library with cached tag scanning, cover art, likes and playlists"
```

---

### Task 6: AudioOutput, SessionStore and Player

**Files:**
- Create: `src/playback/audioOutput.ts`, `src/playback/sessionStore.ts`, `src/playback/player.ts`, `src/test/player.test.ts`
- Modify: `src/test/fixtures.ts` (`FakeOutput`), `package.json`

**Interfaces:**
- Consumes: `Queue` (Task 2), `Emitter`/`Event`/`Disposable`, `PlaybackState`/`RepeatMode`/`Track`/`KeyValueStore`.
- Produces:
  - `type AudioEvent = {type:'ready'} | {type:'play'} | {type:'pause'; positionMs?; trackUri?} | {type:'time'; positionMs; trackUri?} | {type:'duration'; durationMs; trackUri?} | {type:'ended'; trackUri?} | {type:'error'; message; silent?; trackUri?}`
  - `interface AudioOutput { onEvent: Event<AudioEvent>; isReady: boolean; ensureReady(timeoutMs): Promise<void>; load(track:{uri:string}, opts:{startMs:number; autoplay:boolean}): void; play(); pause(); seek(ms); setVolume(pct) }`
  - `interface SessionData { trackIds: string[]; index: number; positionMs: number; volume: number; shuffle: boolean; repeat: RepeatMode }`, `class SessionStore(state)` with `load(): SessionData|undefined`, `save(data)`.
  - `interface PlayerDeps { output: AudioOutput; session?: SessionStore; isLiked?(id): boolean; defaultQueue?(): Track[]; onDuration?(track, ms): void; onSkipped?(count): void; onError?(message): void }`
  - `class Player(deps, queue = new Queue())`: `queue`, events `onDidChange: Event<void>`, `onDidChangeTrack: Event<Track|null>`; `getState(): PlaybackState`; async `playTracks(tracks, startIndex?)`, `play()`, `playPause()`, `next()`, `previous()`; sync `pause()`, `seek(ms)`, `setVolume(pct)`, `adjustVolume(delta)`, `toggleShuffle()`, `toggleRepeat()`, `playNext(track)`, `addToQueue(track)`, `refresh()`, `restore(session, resolve)`, `flush()`, `dispose()`.
  - Fixtures: `FakeOutput`, `tick()`.
- Decisions the tests pin: manual Next at the end of the queue (repeat off) stops on the last track at 0:00; Next/Previous while paused change track without revealing the view or starting sound; the 5 s ready timeout lives in `Player` (via `ensureReady`), so the output needs no command buffer of its own.

- [ ] **Step 1: Create `src/playback/audioOutput.ts`**

```ts
'use strict';

import { Event } from '../emitter';

export type AudioEvent =
  | { type: 'ready' }
  | { type: 'play' }
  | { type: 'pause'; positionMs?: number; trackUri?: string }
  | { type: 'time'; positionMs: number; trackUri?: string }
  | { type: 'duration'; durationMs: number; trackUri?: string }
  | { type: 'ended'; trackUri?: string }
  | { type: 'error'; message: string; silent?: boolean; trackUri?: string };

/** Where sound comes out. The host owns all state; implementations only obey and report. */
export interface AudioOutput {
  readonly onEvent: Event<AudioEvent>;
  readonly isReady: boolean;
  /** Resolves once the output can take commands (revealing it if needed); rejects after `timeoutMs`. */
  ensureReady(timeoutMs: number): Promise<void>;
  load(track: { uri: string }, opts: { startMs: number; autoplay: boolean }): void;
  play(): void;
  pause(): void;
  seek(positionMs: number): void;
  setVolume(volumePercent: number): void;
}
```

- [ ] **Step 2: Create `src/playback/sessionStore.ts`**

```ts
'use strict';

import { KeyValueStore, RepeatMode } from '../types';

const KEY = 'null-music.session';

export interface SessionData {
  trackIds: string[];
  index: number;
  positionMs: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export class SessionStore {
  constructor(private readonly state: KeyValueStore) {}

  /** Returns undefined for anything missing or malformed — a bad session must never block startup. */
  load(): SessionData | undefined {
    try {
      const v = this.state.get<any>(KEY, undefined);
      if (!v || !Array.isArray(v.trackIds) || !v.trackIds.every((id: unknown) => typeof id === 'string')) return undefined;
      return {
        trackIds: v.trackIds,
        index: Number.isInteger(v.index) ? v.index : 0,
        positionMs: Number.isFinite(v.positionMs) && v.positionMs > 0 ? v.positionMs : 0,
        volume: Number.isFinite(v.volume) ? Math.max(0, Math.min(100, v.volume)) : 80,
        shuffle: v.shuffle === true,
        repeat: v.repeat === 'track' || v.repeat === 'context' ? v.repeat : 'off',
      };
    } catch {
      return undefined;
    }
  }

  save(data: SessionData): void {
    try {
      void Promise.resolve(this.state.update(KEY, data)).catch(() => {});
    } catch {
      // ignore: the session is best-effort
    }
  }
}
```

- [ ] **Step 3: Append `FakeOutput` and `tick` to `src/test/fixtures.ts`**

Add these imports at the top of the file: `import { Emitter } from '../emitter';` and `import { AudioEvent, AudioOutput } from '../playback/audioOutput';`, then append:

```ts
export const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Scriptable AudioOutput: records every command as a string and lets tests fire events. */
export class FakeOutput implements AudioOutput {
  private readonly emitter = new Emitter<AudioEvent>();
  readonly onEvent = this.emitter.event;
  isReady = false;
  failReady = false;
  readyChecks = 0;
  readonly calls: string[] = [];
  private waiters: Array<{ resolve(): void; reject(e: Error): void }> = [];

  ensureReady(): Promise<void> {
    this.readyChecks++;
    if (this.isReady) return Promise.resolve();
    if (this.failReady) return Promise.reject(new Error('timeout'));
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  /** Mirrors the real output: the 'ready' event first, then waiting commands continue. */
  becomeReady(): void {
    this.isReady = true;
    this.emit({ type: 'ready' });
    for (const w of this.waiters.splice(0)) w.resolve();
  }

  emit(e: AudioEvent): void {
    this.emitter.fire(e);
  }

  load(track: { uri: string }, opts: { startMs: number; autoplay: boolean }): void {
    this.calls.push(`load ${track.uri} @${opts.startMs} ${opts.autoplay ? 'play' : 'paused'}`);
  }
  play(): void {
    this.calls.push('play');
  }
  pause(): void {
    this.calls.push('pause');
  }
  seek(ms: number): void {
    this.calls.push(`seek ${ms}`);
  }
  setVolume(pct: number): void {
    this.calls.push(`volume ${pct}`);
  }
}
```

- [ ] **Step 4: Write the failing test `src/test/player.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Player } from '../playback/player';
import { SessionStore } from '../playback/sessionStore';
import { FakeOutput, MemState, tick, track } from './fixtures';

const tracks = (n: number) => Array.from({ length: n }, (_, i) => track(i));

function setup(extra: Partial<ConstructorParameters<typeof Player>[0]> = {}) {
  const out = new FakeOutput();
  const errors: string[] = [];
  const skips: number[] = [];
  const player = new Player({
    output: out,
    onError: (m) => errors.push(m),
    onSkipped: (n) => skips.push(n),
    ...extra,
  });
  return { out, player, errors, skips };
}

test('isPlaying becomes true only on the output play event', async () => {
  const { out, player } = setup();
  out.becomeReady();
  await player.playTracks(tracks(2), 0);
  assert.ok(out.calls.includes('load file:///t0.mp3 @0 play'));
  assert.strictEqual(player.getState().isPlaying, false);
  out.emit({ type: 'play' });
  assert.strictEqual(player.getState().isPlaying, true);
  out.emit({ type: 'pause' });
  assert.strictEqual(player.getState().isPlaying, false);
});

test('commands before ready are held, then flushed in order once the output is ready', async () => {
  const { out, player } = setup();
  const started = player.playTracks(tracks(2), 0);
  await tick();
  assert.deepStrictEqual(out.calls, []);
  out.becomeReady();
  await started;
  assert.deepStrictEqual(out.calls, ['volume 80', 'load file:///t0.mp3 @0 paused', 'play']);
  assert.strictEqual(player.getState().isPlaying, false); // still unconfirmed
});

test('a view that never becomes ready yields one error and leaves the player paused', async () => {
  const { out, player, errors } = setup();
  out.failReady = true;
  await player.playTracks(tracks(2), 0);
  assert.strictEqual(errors.length, 1);
  assert.deepStrictEqual(out.calls, []);
  assert.strictEqual(player.getState().isPlaying, false);
});

test('position comes only from output time reports (single clock)', async () => {
  const { out, player } = setup();
  out.becomeReady();
  await player.playTracks(tracks(1), 0);
  out.emit({ type: 'play' });
  out.emit({ type: 'time', positionMs: 42000, trackUri: 'file:///t0.mp3' });
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(player.getState().progressMs, 42000);
});

test('unplayable files are skipped silently; a full run of failures stops with one error', async () => {
  const { out, player, errors, skips } = setup();
  out.becomeReady();
  const t = tracks(3);
  await player.playTracks(t, 0);
  out.emit({ type: 'error', message: 'decode', trackUri: t[0].uri });
  await tick();
  assert.strictEqual(player.getState().track?.id, t[1].id);
  out.emit({ type: 'error', message: 'decode', trackUri: t[0].uri }); // duplicate for the old source: ignored
  await tick();
  assert.strictEqual(player.getState().track?.id, t[1].id);
  out.emit({ type: 'error', message: 'decode', trackUri: t[1].uri });
  await tick();
  assert.strictEqual(player.getState().track?.id, t[2].id);
  out.emit({ type: 'error', message: 'decode', trackUri: t[2].uri });
  await tick();
  assert.deepStrictEqual(skips, [1, 2]);
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(player.getState().isPlaying, false);
});

test('a successful play resets the skip streak; autoplay-blocked errors never skip', async () => {
  const { out, player, errors, skips } = setup();
  out.becomeReady();
  const t = tracks(3);
  await player.playTracks(t, 0);
  out.emit({ type: 'error', message: 'NotAllowedError', silent: true, trackUri: t[0].uri });
  await tick();
  assert.strictEqual(player.getState().track?.id, t[0].id);
  assert.deepStrictEqual(skips, []);
  out.emit({ type: 'play' });
  assert.strictEqual(player.getState().isPlaying, true);
  out.emit({ type: 'error', message: 'decode', trackUri: t[0].uri });
  await tick();
  out.emit({ type: 'play' }); // next one plays: streak back to 0
  out.emit({ type: 'error', message: 'decode', trackUri: t[1].uri });
  await tick();
  assert.deepStrictEqual(skips, [1, 1]);
  assert.strictEqual(errors.length, 0);
});

test('ended advances; at the end of the queue it stops on the last track at 0:00', async () => {
  const { out, player } = setup();
  out.becomeReady();
  const t = tracks(2);
  await player.playTracks(t, 0);
  out.emit({ type: 'play' });
  out.emit({ type: 'ended', trackUri: t[0].uri });
  await tick();
  assert.strictEqual(player.getState().track?.id, t[1].id);
  assert.strictEqual(out.calls.at(-1), 'load file:///t1.mp3 @0 play');
  out.emit({ type: 'ended', trackUri: t[1].uri });
  await tick();
  const s = player.getState();
  assert.strictEqual(s.track?.id, t[1].id);
  assert.strictEqual(s.isPlaying, false);
  assert.strictEqual(s.progressMs, 0);
  assert.ok(out.calls.includes('pause'));
});

test('repeat=track reloads the same track when it ends', async () => {
  const { out, player } = setup();
  out.becomeReady();
  const t = tracks(2);
  await player.playTracks(t, 0);
  player.toggleRepeat();
  player.toggleRepeat();
  assert.strictEqual(player.getState().repeat, 'track');
  out.emit({ type: 'ended', trackUri: t[0].uri });
  await tick();
  assert.strictEqual(player.getState().track?.id, t[0].id);
  assert.strictEqual(out.calls.at(-1), 'load file:///t0.mp3 @0 play');
});

test('previous restarts after 3 s, otherwise goes back', async () => {
  const { out, player } = setup();
  out.becomeReady();
  const t = tracks(3);
  await player.playTracks(t, 2);
  out.emit({ type: 'time', positionMs: 5000, trackUri: t[2].uri });
  await player.previous();
  assert.strictEqual(player.getState().track?.id, t[2].id);
  assert.strictEqual(out.calls.at(-1), 'seek 0');
  out.emit({ type: 'time', positionMs: 1000, trackUri: t[2].uri });
  await player.previous();
  assert.strictEqual(player.getState().track?.id, t[1].id);
});

test('next/previous while paused with no view neither reveal it nor start sound', async () => {
  const { out, player } = setup();
  player.queue.replace(tracks(3), 0);
  await player.next();
  assert.strictEqual(player.getState().track?.id, track(1).id);
  assert.strictEqual(out.readyChecks, 0);
  assert.deepStrictEqual(out.calls, []);
});

test('a view that reloads (ready again) comes back paused with the current track loaded', async () => {
  const { out, player } = setup();
  out.becomeReady();
  await player.playTracks(tracks(2), 0);
  out.emit({ type: 'play' });
  out.emit({ type: 'ready' });
  assert.strictEqual(player.getState().isPlaying, false);
  assert.strictEqual(out.calls.at(-1), 'load file:///t0.mp3 @0 paused');
});

test('Play with an empty queue and empty library is a silent no-op', async () => {
  const { out, player, errors } = setup({ defaultQueue: () => [] });
  await player.play();
  assert.strictEqual(out.readyChecks, 0);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(player.getState().track, null);
});

test('Play with an empty queue starts the whole library', async () => {
  const { out, player } = setup({ defaultQueue: () => tracks(2) });
  out.becomeReady();
  await player.play();
  assert.strictEqual(player.getState().track?.id, track(0).id);
  assert.ok(out.calls.includes('load file:///t0.mp3 @0 play'));
});

test('session round-trips and restores paused at the saved position, never autoplaying', async () => {
  const state = new MemState();
  const t = tracks(3);
  const a = setup({ session: new SessionStore(state) });
  a.out.becomeReady();
  await a.player.playTracks(t, 1);
  a.player.setVolume(55);
  a.out.emit({ type: 'time', positionMs: 12000, trackUri: t[1].uri });
  a.player.toggleShuffle();
  a.player.flush();

  const saved = new SessionStore(state).load();
  assert.deepStrictEqual(saved, {
    trackIds: t.map((x) => x.id),
    index: 1,
    positionMs: 12000,
    volume: 55,
    shuffle: true,
    repeat: 'off',
  });

  const b = setup();
  b.player.restore(saved!, (id) => t.find((x) => x.id === id));
  const s = b.player.getState();
  assert.strictEqual(s.isPlaying, false);
  assert.strictEqual(s.track?.id, t[1].id);
  assert.strictEqual(s.progressMs, 12000);
  assert.strictEqual(s.volume, 55);
  assert.strictEqual(s.shuffle, true);
  assert.deepStrictEqual(b.out.calls, []);
  b.out.becomeReady();
  assert.deepStrictEqual(b.out.calls, ['volume 55', 'load file:///t1.mp3 @12000 paused']);
});

test('restore drops unknown ids and resets the position when the current track is gone', () => {
  const { player } = setup();
  const t = tracks(3);
  player.restore(
    { trackIds: [t[0].id, 'gone', t[2].id], index: 1, positionMs: 9000, volume: 80, shuffle: false, repeat: 'off' },
    (id) => t.find((x) => x.id === id)
  );
  assert.deepStrictEqual(player.queue.tracks.map((x) => x.name), ['t0', 't2']);
  assert.strictEqual(player.getState().progressMs, 0);
});

test('corrupt session data loads as undefined', () => {
  const state = new MemState();
  void state.update('null-music.session', { trackIds: [1, 2] });
  assert.strictEqual(new SessionStore(state).load(), undefined);
});

test('learned durations are reported once the output measures them', async () => {
  const learned: Array<[string, number]> = [];
  const { out, player } = setup({ onDuration: (t, ms) => learned.push([t.id, ms]) });
  out.becomeReady();
  const t = tracks(1);
  await player.playTracks(t, 0);
  out.emit({ type: 'duration', durationMs: 201000, trackUri: t[0].uri });
  assert.deepStrictEqual(learned, [[t[0].id, 201000]]);
  assert.strictEqual(player.getState().durationMs, 201000);
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../playback/player'`.

- [ ] **Step 6: Create `src/playback/player.ts`**

```ts
'use strict';

import { Disposable, Emitter, Event } from '../emitter';
import { PlaybackState, RepeatMode, Track } from '../types';
import { AudioEvent, AudioOutput } from './audioOutput';
import { Queue } from './queue';
import { SessionData, SessionStore } from './sessionStore';

const READY_TIMEOUT_MS = 5000;
const RESTART_THRESHOLD_MS = 3000;
const SAVE_INTERVAL_MS = 3000;
const DURATION_EPSILON_MS = 500;

export interface PlayerDeps {
  output: AudioOutput;
  session?: SessionStore;
  isLiked?(trackId: string): boolean;
  /** Used when Play is pressed with an empty queue. */
  defaultQueue?(): Track[];
  onDuration?(track: Track, durationMs: number): void;
  onSkipped?(consecutiveSkips: number): void;
  onError?(message: string): void;
}

/**
 * Owns the queue and the one playback clock. `isPlaying` flips true only when the
 * output reports `play`; until then a requested play is `pending`.
 */
export class Player {
  private readonly changeEmitter = new Emitter<void>();
  private readonly trackEmitter = new Emitter<Track | null>();
  readonly onDidChange: Event<void> = this.changeEmitter.event;
  readonly onDidChangeTrack: Event<Track | null> = this.trackEmitter.event;

  private volume = 80;
  private positionMs = 0;
  private positionAt = 0;
  private durationMs = 0;
  private playing = false;
  private pending = false;
  private loadedId: string | undefined;
  private skipStreak = 0;
  private lastTrackId: string | null = null;
  private saveTimer: NodeJS.Timeout | undefined;
  private readonly subscription: Disposable;

  constructor(private readonly deps: PlayerDeps, readonly queue: Queue = new Queue()) {
    this.subscription = deps.output.onEvent((e) => this.handle(e));
  }

  private get output(): AudioOutput {
    return this.deps.output;
  }

  getState(): PlaybackState {
    const track = this.queue.current;
    return {
      isPlaying: this.playing,
      track: track ? { ...track, isLiked: this.deps.isLiked?.(track.id) ?? false } : null,
      progressMs: this.positionMs,
      durationMs: track ? this.durationMs || track.durationMs : 0,
      volume: this.volume,
      shuffle: this.queue.shuffle,
      repeat: this.queue.repeat,
      timestamp: this.positionAt,
    };
  }

  // ─── Transport ─────────────────────────────────────────────────────────────

  async playTracks(tracks: Track[], startIndex = 0): Promise<void> {
    this.skipStreak = 0;
    this.queue.replace(tracks, startIndex);
    await this.startCurrent(true, 0, true);
  }

  async play(): Promise<void> {
    if (!this.queue.current) {
      this.queue.replace(this.deps.defaultQueue?.() ?? [], 0);
      if (!this.queue.current) return;
    }
    await this.startCurrent(true, this.positionMs, false);
  }

  pause(): void {
    this.pending = false;
    this.playing = false;
    if (this.output.isReady) this.output.pause();
    this.changed();
  }

  async playPause(): Promise<void> {
    if (this.playing || this.pending) this.pause();
    else await this.play();
  }

  async next(): Promise<void> {
    const autoplay = this.playing || this.pending;
    if (!this.queue.next()) {
      this.stopAtEnd();
      return;
    }
    this.skipStreak = 0;
    await this.startCurrent(autoplay, 0, true);
  }

  async previous(): Promise<void> {
    const autoplay = this.playing || this.pending;
    if (this.positionMs <= RESTART_THRESHOLD_MS && this.queue.previous()) {
      await this.startCurrent(autoplay, 0, true);
      return;
    }
    this.seek(0);
  }

  seek(positionMs: number): void {
    this.positionMs = Math.max(0, positionMs);
    this.positionAt = Date.now();
    if (this.output.isReady && this.loadedId === this.queue.current?.id) this.output.seek(this.positionMs);
    this.changed();
  }

  setVolume(volumePercent: number): void {
    this.volume = Math.max(0, Math.min(100, Math.round(volumePercent)));
    if (this.output.isReady) this.output.setVolume(this.volume);
    this.changed();
  }

  adjustVolume(delta: number): void {
    this.setVolume(this.volume + delta);
  }

  toggleShuffle(): void {
    this.queue.setShuffle(!this.queue.shuffle);
    this.changed();
  }

  toggleRepeat(): void {
    const order: RepeatMode[] = ['off', 'context', 'track'];
    this.queue.repeat = order[(order.indexOf(this.queue.repeat) + 1) % order.length];
    this.changed();
  }

  playNext(track: Track): void {
    this.queue.playNext(track);
    this.changed();
  }

  addToQueue(track: Track): void {
    this.queue.add(track);
    this.changed();
  }

  /** Re-emit state (e.g. after a like toggled). */
  refresh(): void {
    this.changed();
  }

  // ─── Session ───────────────────────────────────────────────────────────────

  /** Restore a saved session, paused. `resolve` maps saved ids to tracks; unknown ids are dropped. */
  restore(session: SessionData, resolve: (id: string) => Track | undefined): void {
    const tracks: Track[] = [];
    let start = 0;
    let currentSurvived = false;
    session.trackIds.forEach((id, i) => {
      const t = resolve(id);
      if (!t) return;
      if (i === session.index) {
        start = tracks.length;
        currentSurvived = true;
      }
      tracks.push(t);
    });
    this.queue.replace(tracks, start);
    this.queue.setShuffle(session.shuffle);
    this.queue.repeat = session.repeat;
    this.volume = session.volume;
    this.positionMs = currentSurvived ? session.positionMs : 0;
    this.positionAt = Date.now();
    this.durationMs = this.queue.current?.durationMs ?? 0;
    this.lastTrackId = this.queue.current?.id ?? null; // restoring is not a track change
    this.playing = false;
    this.pending = false;
    if (this.output.isReady) this.syncOutput();
    this.changeEmitter.fire();
  }

  flush(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.deps.session?.save({
      trackIds: this.queue.tracks.map((t) => t.id),
      index: this.queue.index,
      positionMs: this.positionMs,
      volume: this.volume,
      shuffle: this.queue.shuffle,
      repeat: this.queue.repeat,
    });
  }

  dispose(): void {
    this.flush();
    this.subscription.dispose();
    this.changeEmitter.dispose();
    this.trackEmitter.dispose();
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /** Make the current item sound (autoplay) or sit loaded and paused. */
  private async startCurrent(autoplay: boolean, startMs: number, reload: boolean): Promise<void> {
    const track = this.queue.current;
    if (!track) return;
    if (reload) {
      this.loadedId = undefined;
      this.positionMs = startMs;
      this.positionAt = Date.now();
      this.durationMs = track.durationMs;
    }
    this.pending = autoplay;
    this.changed();
    // Without sound to make there is no reason to reveal the view: the next `ready` loads this track paused.
    if (!autoplay && !this.output.isReady) return;
    try {
      await this.output.ensureReady(READY_TIMEOUT_MS);
    } catch (err: any) {
      this.pending = false;
      this.deps.onError?.(`The player view did not start (${err?.message ?? err}). Open the Music view and try again.`);
      this.changed();
      return;
    }
    if (this.queue.current !== track) return; // superseded while waiting
    if (this.loadedId === track.id) {
      if (autoplay) this.output.play();
    } else {
      this.loadedId = track.id;
      this.output.load(track, { startMs, autoplay });
    }
  }

  /** Push volume and the current track (paused) to a fresh or reloaded output. */
  private syncOutput(): void {
    this.output.setVolume(this.volume);
    const track = this.queue.current;
    this.loadedId = track?.id;
    if (track) this.output.load(track, { startMs: this.positionMs, autoplay: false });
  }

  private handle(e: AudioEvent): void {
    const current = this.queue.current;
    if ('trackUri' in e && e.trackUri && e.trackUri !== current?.uri) return; // stale event from an old source
    switch (e.type) {
      case 'ready':
        this.playing = false; // a (re)loaded view has no source and is not playing
        this.syncOutput();
        break;
      case 'play':
        this.playing = true;
        this.pending = false;
        this.skipStreak = 0;
        break;
      case 'pause':
        if (e.positionMs !== undefined) {
          this.positionMs = e.positionMs;
          this.positionAt = Date.now();
        }
        if (!this.pending) this.playing = false;
        break;
      case 'time':
        this.positionMs = e.positionMs;
        this.positionAt = Date.now();
        break;
      case 'duration':
        if (current) {
          this.durationMs = e.durationMs;
          if (Math.abs(current.durationMs - e.durationMs) >= DURATION_EPSILON_MS) this.deps.onDuration?.(current, e.durationMs);
        }
        break;
      case 'ended':
        void this.onEnded();
        return;
      case 'error':
        void this.onOutputError(e);
        return;
    }
    this.changed();
  }

  private async onEnded(): Promise<void> {
    this.playing = false;
    if (this.queue.repeat === 'track') {
      await this.startCurrent(true, 0, true);
      return;
    }
    await this.advance();
  }

  private async onOutputError(e: Extract<AudioEvent, { type: 'error' }>): Promise<void> {
    this.playing = false;
    if (e.silent) {
      // Autoplay blocked: stay pending until the user clicks the prompt.
      this.changed();
      return;
    }
    const failed = this.queue.current;
    this.skipStreak++;
    if (this.skipStreak >= this.queue.length) {
      this.skipStreak = 0;
      this.pending = false;
      this.changed();
      this.deps.onError?.(`None of the ${this.queue.length} queued tracks could be played (${e.message}).`);
      return;
    }
    this.deps.onSkipped?.(this.skipStreak);
    if (!(await this.advance())) {
      this.skipStreak = 0;
      this.deps.onError?.(`Could not play "${failed?.name ?? 'track'}" (${e.message}).`);
    }
  }

  /** Move to the next item and start it; at the end of the queue, stop on the current one. */
  private async advance(): Promise<boolean> {
    if (!this.queue.next()) {
      this.stopAtEnd();
      return false;
    }
    await this.startCurrent(true, 0, true);
    return true;
  }

  private stopAtEnd(): void {
    this.playing = false;
    this.pending = false;
    this.positionMs = 0;
    this.positionAt = Date.now();
    if (this.output.isReady) {
      this.output.pause();
      this.output.seek(0);
    }
    this.changed();
  }

  private changed(): void {
    const id = this.queue.current?.id ?? null;
    if (id !== this.lastTrackId) {
      this.lastTrackId = id;
      this.trackEmitter.fire(this.queue.current ?? null);
    }
    this.changeEmitter.fire();
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (!this.deps.session || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.flush();
    }, SAVE_INTERVAL_MS);
    this.saveTimer.unref();
  }
}
```

- [ ] **Step 7: Register and run**

In `package.json` append ` out/test/player.test.js`.

Run: `npm test`
Expected: PASS. If the skip-chain test hangs on a count, re-trace `onOutputError`: a streak of N failures on an N-track queue must give up on the Nth.

- [ ] **Step 8: Commit**

```bash
git add src/playback/audioOutput.ts src/playback/sessionStore.ts src/playback/player.ts src/test/player.test.ts src/test/fixtures.ts package.json
git commit -m "feat(null-music): add Player, AudioOutput interface and session store"
```

---

### Task 7: WebviewAudioOutput and the webview audio protocol

**Files:**
- Create: `src/playback/webviewAudioOutput.ts`, `src/test/webviewAudioOutput.test.ts`
- Modify: `src/ui/musicHtml.ts` (webview script), `src/test/musicHtml.test.ts`, `package.json`

**Interfaces:**
- Consumes: `AudioOutput`/`AudioEvent` (Task 6), `Emitter`.
- Produces:
  - `interface WebviewLike { postMessage(message: unknown): unknown; resolveUri(uri: string): string }`
  - `interface OutputHost { revealView(): Promise<void> }`
  - `class WebviewAudioOutput(host) implements AudioOutput` plus `attach(view: WebviewLike)`, `detach()`, `handleMessage(data: any)`.
  - Webview → host message names (unchanged): `ready`, `localAudioPlayStarted`, `localAudioPaused {positionMs, trackUri}`, `localAudioTimeUpdate {positionMs, trackUri}`, `localAudioDuration {durationMs, trackUri}`, `localAudioEnded {trackUri}`, `localAudioError {error, trackUri}`, `localAudioPlayFailed {error, trackUri, silent}`.
  - Host → webview: **new** `localLoad {uri, trackUri, startMs, autoplay}` (replaces `localPlay`); `localPause`, `localResume`, `localSeek {positionMs}`, `localVolume {volumePercent}` unchanged.

- [ ] **Step 1: Write the failing test `src/test/webviewAudioOutput.test.ts`**

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { AudioEvent } from '../playback/audioOutput';
import { WebviewAudioOutput } from '../playback/webviewAudioOutput';

function setup() {
  let revealed = 0;
  const out = new WebviewAudioOutput({
    revealView: async () => {
      revealed++;
    },
  });
  const posted: any[] = [];
  const view = { postMessage: (m: unknown) => posted.push(m), resolveUri: (u: string) => `webview:${u}` };
  const events: AudioEvent[] = [];
  out.onEvent((e) => events.push(e));
  return { out, view, posted, events, revealed: () => revealed };
}

test('ensureReady reveals a missing view once, then resolves on the webview ready message', async () => {
  const { out, view, events, revealed } = setup();
  const waiting = out.ensureReady(1000);
  assert.strictEqual(revealed(), 1);
  out.attach(view);
  assert.strictEqual(out.isReady, false);
  out.handleMessage({ type: 'ready' });
  await waiting;
  assert.strictEqual(out.isReady, true);
  assert.deepStrictEqual(events, [{ type: 'ready' }]);
  await out.ensureReady(1000); // already ready: immediate, no second reveal
  assert.strictEqual(revealed(), 1);
});

test('ensureReady rejects when the view never reports ready', async () => {
  const { out, view } = setup();
  out.attach(view); // present, but silent
  await assert.rejects(out.ensureReady(20));
});

test('webview messages map to audio events', () => {
  const { out, events } = setup();
  out.handleMessage({ type: 'localAudioPlayStarted' });
  out.handleMessage({ type: 'localAudioPaused', positionMs: 900, trackUri: 'u' });
  out.handleMessage({ type: 'localAudioTimeUpdate', positionMs: 1500, trackUri: 'u' });
  out.handleMessage({ type: 'localAudioDuration', durationMs: 5000, trackUri: 'u' });
  out.handleMessage({ type: 'localAudioEnded', trackUri: 'u' });
  out.handleMessage({ type: 'localAudioError', error: 'bad', trackUri: 'u' });
  out.handleMessage({ type: 'localAudioPlayFailed', error: 'blocked', trackUri: 'u', silent: true });
  out.handleMessage({ type: 'localAudioTimeUpdate', positionMs: 'x' }); // malformed: ignored
  out.handleMessage(undefined);
  assert.deepStrictEqual(events, [
    { type: 'play' },
    { type: 'pause', positionMs: 900, trackUri: 'u' },
    { type: 'time', positionMs: 1500, trackUri: 'u' },
    { type: 'duration', durationMs: 5000, trackUri: 'u' },
    { type: 'ended', trackUri: 'u' },
    { type: 'error', message: 'bad', silent: false, trackUri: 'u' },
    { type: 'error', message: 'blocked', silent: true, trackUri: 'u' },
  ]);
});

test('commands post the expected webview messages and map file URIs', () => {
  const { out, view, posted } = setup();
  out.attach(view);
  out.load({ uri: 'file:///a.mp3' }, { startMs: 1200, autoplay: false });
  out.load({ uri: 'https://x.test/s.mp3' }, { startMs: 0, autoplay: true });
  out.play();
  out.pause();
  out.seek(5000);
  out.setVolume(40);
  assert.deepStrictEqual(posted, [
    { type: 'localLoad', uri: 'webview:file:///a.mp3', trackUri: 'file:///a.mp3', startMs: 1200, autoplay: false },
    { type: 'localLoad', uri: 'https://x.test/s.mp3', trackUri: 'https://x.test/s.mp3', startMs: 0, autoplay: true },
    { type: 'localResume' },
    { type: 'localPause' },
    { type: 'localSeek', positionMs: 5000 },
    { type: 'localVolume', volumePercent: 40 },
  ]);
});

test('closing the view while playing reports pause and requires a new ready', () => {
  const { out, view, events } = setup();
  out.attach(view);
  out.handleMessage({ type: 'ready' });
  events.length = 0;
  out.detach();
  assert.strictEqual(out.isReady, false);
  assert.deepStrictEqual(events, [{ type: 'pause' }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../playback/webviewAudioOutput'`.

- [ ] **Step 3: Create `src/playback/webviewAudioOutput.ts`**

```ts
'use strict';

import { Emitter } from '../emitter';
import { AudioEvent, AudioOutput } from './audioOutput';

/** The slice of a vscode Webview the output needs (kept vscode-free for tests). */
export interface WebviewLike {
  postMessage(message: unknown): unknown;
  /** Maps a file URI to something the webview may load. */
  resolveUri(uri: string): string;
}

export interface OutputHost {
  /** Make the view resolve (be created) without leaving focus there. */
  revealView(): Promise<void>;
}

export class WebviewAudioOutput implements AudioOutput {
  private readonly emitter = new Emitter<AudioEvent>();
  readonly onEvent = this.emitter.event;
  private view: WebviewLike | undefined;
  private ready = false;
  private waiters: Array<() => void> = [];

  constructor(private readonly host: OutputHost) {}

  get isReady(): boolean {
    return this.ready;
  }

  /** A freshly resolved view has not loaded its script yet: wait for its `ready` message. */
  attach(view: WebviewLike): void {
    this.view = view;
    this.ready = false;
  }

  /** The view went away; whatever was playing stopped with it. */
  detach(): void {
    const wasAttached = this.view !== undefined;
    this.view = undefined;
    this.ready = false;
    if (wasAttached) this.emitter.fire({ type: 'pause' });
  }

  handleMessage(data: any): void {
    switch (data?.type) {
      case 'ready':
        this.ready = true;
        this.emitter.fire({ type: 'ready' });
        for (const resolve of this.waiters.splice(0)) resolve();
        break;
      case 'localAudioPlayStarted':
        this.emitter.fire({ type: 'play' });
        break;
      case 'localAudioPaused':
        this.emitter.fire({ type: 'pause', positionMs: this.num(data.positionMs), trackUri: data.trackUri });
        break;
      case 'localAudioTimeUpdate':
        if (typeof data.positionMs === 'number') {
          this.emitter.fire({ type: 'time', positionMs: data.positionMs, trackUri: data.trackUri });
        }
        break;
      case 'localAudioDuration':
        if (typeof data.durationMs === 'number') {
          this.emitter.fire({ type: 'duration', durationMs: data.durationMs, trackUri: data.trackUri });
        }
        break;
      case 'localAudioEnded':
        this.emitter.fire({ type: 'ended', trackUri: data.trackUri });
        break;
      case 'localAudioError':
      case 'localAudioPlayFailed':
        this.emitter.fire({ type: 'error', message: data.error || 'Playback error', silent: !!data.silent, trackUri: data.trackUri });
        break;
    }
  }

  async ensureReady(timeoutMs: number): Promise<void> {
    if (this.ready) return;
    const ready = new Promise<void>((resolve) => this.waiters.push(resolve));
    if (!this.view) this.host.revealView().catch(() => {});
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('no response from the player view')), timeoutMs);
    });
    try {
      await Promise.race([ready, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  load(track: { uri: string }, opts: { startMs: number; autoplay: boolean }): void {
    const isStream = /^https?:/i.test(track.uri);
    this.post({
      type: 'localLoad',
      uri: isStream || !this.view ? track.uri : this.view.resolveUri(track.uri),
      trackUri: track.uri,
      startMs: opts.startMs,
      autoplay: opts.autoplay,
    });
  }

  play(): void {
    this.post({ type: 'localResume' });
  }

  pause(): void {
    this.post({ type: 'localPause' });
  }

  seek(positionMs: number): void {
    this.post({ type: 'localSeek', positionMs });
  }

  setVolume(volumePercent: number): void {
    this.post({ type: 'localVolume', volumePercent });
  }

  private post(message: unknown): void {
    try {
      void this.view?.postMessage(message);
    } catch {
      // a disposed webview throws; the next `ready` resynchronises
    }
  }

  private num(v: unknown): number | undefined {
    return typeof v === 'number' ? v : undefined;
  }
}
```

Note: `detach()` emits `pause` only when a view was attached, so repeated disposal does not spam events.

- [ ] **Step 4: Run the output tests**

In `package.json` append ` out/test/webviewAudioOutput.test.js`.

Run: `npm test`
Expected: PASS. (`'localAudioTimeUpdate'` with `positionMs: 'x'` must produce no event; the `pause` mapping produces `positionMs: undefined`, which `deepStrictEqual` treats as an own property — if that assertion fails on the `{ type: 'pause', positionMs: 900, … }` row only, the test is right and `num()` is returning the wrong value.)

- [ ] **Step 5: Edit the webview script in `src/ui/musicHtml.ts`**

The script is inside a TS template literal: do **not** introduce backticks or `${`; use string concatenation like the surrounding code. Apply these edits (each `old_string` appears exactly once):

1. State variable — after `let currentPlayingTrackUri = null;` add a line:

```js
    let pendingSeekMs = 0;
```

2. Pause handler. Old:

```js
      vscode.postMessage({ type: 'localAudioPaused' });
```
New:
```js
      vscode.postMessage({
        type: 'localAudioPaused',
        positionMs: Math.round(audioPlayer.currentTime * 1000),
        trackUri: currentPlayingTrackUri
      });
```

3. Time update. Old:

```js
        vscode.postMessage({ type: 'localAudioTimeUpdate', positionMs: curMs });
```
New:
```js
        vscode.postMessage({ type: 'localAudioTimeUpdate', positionMs: curMs, trackUri: currentPlayingTrackUri });
```

4. Loaded metadata — immediately after the line `audioPlayer.addEventListener('loadedmetadata', () => {` insert:

```js
      if (pendingSeekMs > 0) {
        audioPlayer.currentTime = pendingSeekMs / 1000;
        pendingSeekMs = 0;
      }
```

5. Ended. Old:

```js
      vscode.postMessage({ type: 'localAudioEnded' });
```
New:
```js
      vscode.postMessage({ type: 'localAudioEnded', trackUri: currentPlayingTrackUri });
```

6. Insert this function immediately before the `// Autoplay unlock` comment:

```js
    // Start playback; report real failures, but not a play() that a pause() or a new load interrupted.
    function startPlayback(trackUri) {
      const playPromise = audioPlayer.play();
      if (playPromise === undefined) return;
      playPromise.catch(err => {
        if (err.name === 'AbortError') return;
        if (err.name === 'NotAllowedError') {
          autoplayPrompt.style.display = 'flex';
          playerCard.classList.remove('playing');
        } else {
          showError('Audio play failed: ' + err.message);
        }
        vscode.postMessage({
          type: 'localAudioPlayFailed',
          error: err.name + ': ' + err.message,
          trackUri: trackUri,
          silent: err.name === 'NotAllowedError'
        });
      });
    }

```

7. Replace everything from `case 'localPlay':` through the `break;` that ends `case 'localResume':` (this span includes `case 'localPause':`; leave `localSeek` and `localVolume` after it untouched) with:

```js
        case 'localLoad':
          currentPlayingTrackUri = msg.trackUri;
          pendingSeekMs = msg.startMs > 0 ? msg.startMs : 0;
          hideError();
          if (audioPlayer && msg.uri) {
            if (audioPlayer.src !== msg.uri) {
              audioPlayer.src = msg.uri;
            } else {
              audioPlayer.currentTime = pendingSeekMs / 1000;
              pendingSeekMs = 0;
            }
            if (msg.autoplay) {
              startPlayback(msg.trackUri);
            }
          }
          break;

        case 'localPause':
          if (audioPlayer) {
            audioPlayer.pause();
            playerCard.classList.remove('playing');
          }
          break;

        case 'localResume':
          if (audioPlayer) {
            startPlayback(currentPlayingTrackUri);
          }
          break;
```

8. Folder count (tracks no longer overload `album` with the folder URI). Old:

```js
          const count = allTracks.filter(t => t.album === f).length;
```
New:
```js
          const count = allTracks.filter(t => t.folder === f).length;
```

- [ ] **Step 6: Pin the protocol in `src/test/musicHtml.test.ts`**

Append inside the existing test (before its closing `});`):

```ts
  // Engine protocol: loads carry autoplay + start offset, interrupted play() is not a failure.
  assert.ok(html.includes("case 'localLoad':"));
  assert.ok(!html.includes("case 'localPlay':"));
  assert.ok(html.includes("err.name === 'AbortError'"));
  assert.ok(html.includes('t.folder === f'));
```

- [ ] **Step 7: Run and commit**

Run: `npm test`
Expected: PASS (`musicHtml` test included).

```bash
git add src/playback/webviewAudioOutput.ts src/test/webviewAudioOutput.test.ts src/ui/musicHtml.ts src/test/musicHtml.test.ts package.json
git commit -m "feat(null-music): add WebviewAudioOutput and load/seek-aware webview audio protocol"
```

---

### Task 8: Rewire the UI onto Player/Library and delete the provider layer

This is one atomic change: `MusicViewController`, `MusicViewProvider`, `commands`, `StatusBarController` and `extension.ts` all change signature together, so the project only compiles again once every step is done. Compile and test at the end of the task, not between steps.

**Files:**
- Modify: `src/ui/musicViewController.ts`, `src/ui/musicViewProvider.ts`, `src/ui/commands.ts`, `src/ui/statusBarController.ts`, `src/ui/statusBarModel.ts`, `src/extension.ts`, `src/types.ts`, `src/testFakes.ts`, `src/test/statusBarController.test.ts`, `src/test/musicViewProvider.test.ts`, `package.json`
- Delete: `src/provider/` (all), `src/playback/playbackManager.ts`, `src/test/localProvider.test.ts`, `src/test/playbackManager.test.ts`

**Interfaces:**
- Consumes: `Player` (Task 6), `Library` (Task 5), `WebviewAudioOutput` (Task 7), `SessionStore`.
- Produces: `NullMusicApi = { player: Player; library: Library }`; `MusicViewController(player, library, messenger, host)` where `host` adds `artUrl(artKey): string | undefined`; `MusicViewProvider(extensionUri, player, library, output, artDir)` with `dispose()`; `StatusBarController(player)`; `registerCommands(context, player, library)`.

- [ ] **Step 1: Rewrite `src/ui/musicViewController.ts`**

```ts
'use strict';

import { Library } from '../library/library';
import { Player } from '../playback/player';
import { Track } from '../types';

export interface WebviewMessenger {
  postMessage(message: any): void | Promise<boolean | void>;
}

export interface WebviewControllerHost {
  executeCommand(command: string, ...args: any[]): Promise<any>;
  showErrorMessage(message: string): void;
  /** Webview-loadable URL for a cover in the art directory. */
  artUrl(artKey: string): string | undefined;
}

/** Translates webview messages into Player/Library calls. Audio events go to WebviewAudioOutput, not here. */
export class MusicViewController {
  constructor(
    private readonly player: Player,
    private readonly library: Library,
    private readonly messenger: WebviewMessenger,
    private readonly host: WebviewControllerHost
  ) {}

  public async handleMessage(data: any): Promise<void> {
    if (!data || !data.type) {
      return;
    }

    try {
      switch (data.type) {
        case 'ready':
          this.sendPlaybackState();
          this.sendLocalLibrary();
          break;

        case 'playPause':
          await this.player.playPause();
          break;
        case 'play':
          await this.player.play();
          break;
        case 'pause':
          this.player.pause();
          break;
        case 'previous':
          await this.player.previous();
          break;
        case 'next':
          await this.player.next();
          break;
        case 'seek':
          if (typeof data.positionMs === 'number') this.player.seek(data.positionMs);
          break;
        case 'setVolume':
          if (typeof data.volumePercent === 'number') this.player.setVolume(data.volumePercent);
          break;
        case 'toggleShuffle':
          this.player.toggleShuffle();
          break;
        case 'toggleRepeat':
          this.player.toggleRepeat();
          break;

        case 'toggleLike': {
          const track = this.player.getState().track;
          if (track) await this.toggleLike(track.id);
          break;
        }
        case 'toggleTrackLike':
          if (data.trackId) await this.toggleLike(data.trackId);
          break;

        case 'localOpenFolder':
          await this.host.executeCommand('null-music.openLocalFolder');
          break;
        case 'localRemoveFolder':
          if (data.folderUri) await this.library.removeFolder(data.folderUri);
          break;
        case 'localImportPlaylist':
          await this.host.executeCommand('null-music.importPlaylist');
          break;
        case 'localRemovePlaylist':
          if (data.playlistId) await this.library.removePlaylist(data.playlistId);
          break;

        case 'localPlayTrack': {
          const context = data.trackUri ? this.library.contextFor(data.trackUri) : undefined;
          if (context) await this.player.playTracks(context.tracks, context.index);
          break;
        }
        case 'localPlayFolder':
          if (data.folderUri) await this.playAll(this.library.tracksInFolder(data.folderUri));
          break;
        case 'localPlayPlaylist':
          if (data.playlistId) await this.playAll(this.library.playlistTracks(data.playlistId));
          break;

        case 'localGetLibrary':
          this.sendLocalLibrary();
          break;
      }
    } catch (err: any) {
      this.host.showErrorMessage(`Null Music: ${err.message || err}`);
    }
  }

  public sendPlaybackState(): void {
    this.messenger.postMessage({ type: 'stateUpdate', state: this.player.getState() });
  }

  public sendLocalLibrary(): void {
    const tracks = this.library.tracks.map((t) => ({
      ...t,
      isLiked: this.library.isLiked(t.id),
      albumArtUrl: t.artKey ? this.host.artUrl(t.artKey) : undefined,
    }));
    this.messenger.postMessage({
      type: 'localLibraryUpdate',
      tracks,
      folders: this.library.folders,
      playlists: this.library.playlists,
      progress: this.library.progress,
    });
  }

  private async toggleLike(trackId: string): Promise<void> {
    await this.library.toggleLike(trackId);
    this.player.refresh();
    this.sendLocalLibrary();
  }

  private async playAll(tracks: Track[]): Promise<void> {
    if (tracks.length > 0) await this.player.playTracks(tracks, 0);
  }
}
```

- [ ] **Step 2: Rewrite `src/ui/musicViewProvider.ts`**

```ts
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { Library } from '../library/library';
import { Player } from '../playback/player';
import { WebviewAudioOutput } from '../playback/webviewAudioOutput';
import { getMusicWebviewHtml } from './musicHtml';
import { MusicViewController } from './musicViewController';

export class MusicViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'null.musicView';
  private view?: vscode.WebviewView;
  private controller?: MusicViewController;
  private readonly subscriptions: Array<{ dispose(): void }> = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly player: Player,
    private readonly library: Library,
    private readonly output: WebviewAudioOutput,
    private readonly artDir: string
  ) {
    this.subscriptions.push(
      this.player.onDidChange(() => this.controller?.sendPlaybackState()),
      this.library.onDidChange(() => this.controller?.sendLocalLibrary()),
      this.library.onDidChangeSources(() => {
        if (this.view) this.refreshLocalResourceRoots(this.view);
      })
    );
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    const webview = webviewView.webview;
    this.refreshLocalResourceRoots(webviewView);

    // Attach before the html loads so the script's `ready` message is never missed.
    this.output.attach({
      postMessage: (message) => webview.postMessage(message),
      resolveUri: (uri) => webview.asWebviewUri(vscode.Uri.parse(uri)).toString(),
    });
    webview.html = getMusicWebviewHtml(this.getNonce(), webview.cspSource);

    this.controller = new MusicViewController(
      this.player,
      this.library,
      { postMessage: (msg) => void webview.postMessage(msg) },
      {
        executeCommand: async (cmd, ...args) => await vscode.commands.executeCommand(cmd, ...args),
        showErrorMessage: (msg) => void vscode.window.showErrorMessage(msg),
        artUrl: (artKey) => webview.asWebviewUri(vscode.Uri.file(path.join(this.artDir, artKey))).toString(),
      }
    );

    webview.onDidReceiveMessage(async (data) => {
      this.output.handleMessage(data);
      await this.controller?.handleMessage(data);
    });

    webviewView.onDidDispose(() => {
      this.output.detach();
      this.controller = undefined;
      this.view = undefined;
    });
  }

  /** Extension, art cache, library folders and playlist directories — nothing else is readable. */
  public getLocalFolderRoots(): vscode.Uri[] {
    const roots: vscode.Uri[] = [this.extensionUri, vscode.Uri.file(this.artDir)];
    for (const folder of this.library.folders) {
      try {
        roots.push(vscode.Uri.parse(folder));
      } catch {
        // skip a malformed stored folder
      }
    }
    for (const file of this.library.playlistPaths) {
      roots.push(vscode.Uri.file(path.dirname(file)));
    }
    return roots;
  }

  public refreshLocalResourceRoots(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: this.getLocalFolderRoots(),
    };
  }

  public dispose(): void {
    for (const s of this.subscriptions) s.dispose();
    this.subscriptions.length = 0;
  }

  private getNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
```

- [ ] **Step 3: Rewrite `src/ui/commands.ts`**

```ts
'use strict';

import * as vscode from 'vscode';
import { Library } from '../library/library';
import { Player } from '../playback/player';
import { formatSec, parseTimeToMs } from './commandHelpers';

export function registerCommands(context: vscode.ExtensionContext, player: Player, library: Library): void {
  const register = (command: string, callback: (...args: any[]) => any) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  };
  const guarded = (fn: () => unknown) => async () => {
    try {
      await fn();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
    }
  };

  register('null-music.playPause', guarded(() => player.playPause()));
  register('null-music.play', guarded(() => player.play()));
  register('null-music.pause', guarded(() => player.pause()));
  register('null-music.nextTrack', guarded(() => player.next()));
  register('null-music.previousTrack', guarded(() => player.previous()));

  register('null-music.seek', async () => {
    const state = player.getState();
    if (!state.track) {
      vscode.window.showInformationMessage('No track currently playing to seek.');
      return;
    }

    const currentSec = Math.floor(state.progressMs / 1000);
    const durationSec = Math.floor(state.durationMs / 1000);

    const items: vscode.QuickPickItem[] = [
      { label: '$(playback-play) Forward 30 seconds', description: `+30s (to ${formatSec(currentSec + 30)})` },
      { label: '$(playback-play) Rewind 30 seconds', description: `-30s (to ${formatSec(Math.max(0, currentSec - 30))})` },
      { label: '$(playback-play) Forward 10 seconds', description: `+10s` },
      { label: '$(playback-play) Rewind 10 seconds', description: `-10s` },
      { label: '$(history) Restart Track', description: 'Go to 0:00' },
      { label: '$(edit) Custom Position (seconds or mm:ss)', description: 'Enter specific position' },
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `Seek in current track (Current: ${formatSec(currentSec)} / ${formatSec(durationSec)})`,
    });

    if (!pick) return;

    if (pick.label.includes('Forward 30')) {
      player.seek(state.progressMs + 30000);
    } else if (pick.label.includes('Rewind 30')) {
      player.seek(Math.max(0, state.progressMs - 30000));
    } else if (pick.label.includes('Forward 10')) {
      player.seek(state.progressMs + 10000);
    } else if (pick.label.includes('Rewind 10')) {
      player.seek(Math.max(0, state.progressMs - 10000));
    } else if (pick.label.includes('Restart Track')) {
      player.seek(0);
    } else if (pick.label.includes('Custom Position')) {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter position in seconds (e.g. 90) or mm:ss (e.g. 1:30)',
      });
      if (input) {
        const ms = parseTimeToMs(input);
        if (ms !== null) {
          player.seek(ms);
        } else {
          vscode.window.showErrorMessage('Invalid time format. Please enter seconds or mm:ss.');
        }
      }
    }
  });

  register('null-music.setVolume', async () => {
    const items: vscode.QuickPickItem[] = [
      { label: '100%', description: 'Maximum volume' },
      { label: '75%', description: 'High volume' },
      { label: '50%', description: 'Medium volume' },
      { label: '25%', description: 'Low volume' },
      { label: '0%', description: 'Mute' },
      { label: '$(edit) Custom Volume (0-100%)', description: 'Enter custom volume percentage' },
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select or enter volume level',
    });

    if (!pick) return;

    if (pick.label.includes('Custom Volume')) {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter volume percentage (0 - 100)',
        validateInput: (v) => {
          const num = parseInt(v, 10);
          return isNaN(num) || num < 0 || num > 100 ? 'Please enter a number between 0 and 100' : null;
        },
      });
      if (input) {
        player.setVolume(parseInt(input, 10));
      }
    } else {
      player.setVolume(parseInt(pick.label, 10));
    }
  });

  register('null-music.volumeUp', () => player.adjustVolume(10));
  register('null-music.volumeDown', () => player.adjustVolume(-10));
  register('null-music.toggleShuffle', () => player.toggleShuffle());
  register('null-music.toggleRepeat', () => player.toggleRepeat());

  register('null-music.likeCurrentTrack', async () => {
    const track = player.getState().track;
    if (!track) {
      vscode.window.showInformationMessage('No track currently playing.');
      return;
    }
    const liked = await library.toggleLike(track.id);
    player.refresh();
    vscode.window.showInformationMessage(
      liked ? `Saved "${track.name}" to Liked Songs` : `Removed "${track.name}" from Liked Songs`
    );
  });

  register('null-music.showCurrentTrack', () => {
    const track = player.getState().track;
    if (!track) {
      vscode.window.showInformationMessage('Null Music: No track is currently playing.');
      return;
    }
    vscode.window.showInformationMessage(`Now Playing: ${track.name} by ${track.artist}`);
  });

  register('null-music.search', async () => {
    const query = await vscode.window.showInputBox({
      prompt: 'Search local music library by title, artist, or album',
      placeHolder: 'e.g. ambient, soundtrack, artist name…',
    });

    if (query === undefined) return;

    const matches = library.search(query);
    if (matches.length === 0) {
      vscode.window.showInformationMessage(`No tracks found matching "${query}".`);
      return;
    }

    const items = matches.map((t) => ({
      label: `$(play) ${t.name}`,
      description: t.artist,
      detail: t.album || undefined,
      trackUri: t.uri,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Search results for "${query}" (select to play)`,
    });

    if (selected) {
      const all = library.tracks;
      const idx = all.findIndex((t) => t.uri === selected.trackUri);
      if (idx >= 0) await player.playTracks(all, idx);
    }
  });

  register('null-music.browsePlaylists', async () => {
    try {
      const collections = library.collections();
      if (collections.length === 0) {
        const choice = await vscode.window.showInformationMessage(
          'No folders or playlists found. What would you like to add?',
          'Import Playlist (.m3u8)',
          'Add Music Folder'
        );
        if (choice === 'Import Playlist (.m3u8)') {
          await vscode.commands.executeCommand('null-music.importPlaylist');
        } else if (choice === 'Add Music Folder') {
          await vscode.commands.executeCommand('null-music.openLocalFolder');
        }
        return;
      }

      const icons = { liked: '$(heart)', playlist: '$(list-ordered)', folder: '$(folder)' } as const;
      const items = collections.map((c) => ({
        label: `${icons[c.kind]} ${c.name}`,
        description: `${c.tracks.length} track${c.tracks.length !== 1 ? 's' : ''}`,
        detail: c.detail,
        collection: c,
      }));

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a playlist or folder to play',
      });

      if (pick && pick.collection.tracks.length > 0) {
        await player.playTracks(pick.collection.tracks, 0);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
    }
  });

  register('null-music.importPlaylist', async () => {
    const files = await vscode.window.showOpenDialog({
      canSelectFolders: false,
      canSelectFiles: true,
      canSelectMany: false,
      filters: {
        'Playlists (*.m3u8, *.m3u)': ['m3u8', 'm3u'],
      },
      openLabel: 'Import Playlist',
      title: 'Select a .m3u8 or .m3u playlist file',
    });

    if (!files || files.length === 0) return;

    try {
      const playlist = await library.importPlaylist(files[0].fsPath || files[0].toString());
      if (playlist.tracks.length === 0) {
        vscode.window.showWarningMessage(`Playlist "${playlist.name}" was imported, but contained no tracks.`);
      } else {
        const action = await vscode.window.showInformationMessage(
          `Imported playlist "${playlist.name}" (${playlist.tracks.length} tracks)`,
          'Play Now'
        );
        if (action === 'Play Now') {
          await player.playTracks(playlist.tracks, 0);
        }
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to import playlist: ${err.message || err}`);
    }
  });

  register('null-music.openLocalFolder', async () => {
    const folders = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Add Music Folder',
      title: 'Select a folder containing audio files',
    });

    if (!folders || folders.length === 0) return;

    const tracks = await library.addFolder(folders[0].toString());
    if (tracks.length === 0) {
      vscode.window.showWarningMessage(
        'No supported audio files found in that folder. Supported formats: MP3, FLAC, OGG, WAV, M4A, AAC, Opus.'
      );
    } else {
      vscode.window.showInformationMessage(
        `Added ${tracks.length} track${tracks.length !== 1 ? 's' : ''} from "${folders[0].fsPath}"`
      );
    }
  });

  register('null-music.focus', async () => {
    await vscode.commands.executeCommand('null.musicView.focus');
  });
}
```

- [ ] **Step 4: Update the status bar**

`src/ui/statusBarController.ts`: replace the import `import { PlaybackManager } from '../playback/playbackManager';` with `import { Player } from '../playback/player';`; change the constructor to `constructor(private readonly player: Player)`; replace `this.playbackManager.onDidChangePlaybackState((state) => this.update(state))` with `this.player.onDidChange(() => this.update(this.player.getState()))`; replace both `this.playbackManager.getCurrentState()` calls with `this.player.getState()`.

`src/ui/statusBarModel.ts`: delete the `.replace('${device}', state.device?.name || '')` line and the `state.device ? … : '',` tooltip line.

- [ ] **Step 5: Rewrite `src/extension.ts`**

```ts
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { Library } from './library/library';
import { Player } from './playback/player';
import { SessionStore } from './playback/sessionStore';
import { WebviewAudioOutput } from './playback/webviewAudioOutput';
import { registerCommands } from './ui/commands';
import { MusicViewProvider } from './ui/musicViewProvider';
import { StatusBarController } from './ui/statusBarController';

export interface NullMusicApi {
  readonly player: Player;
  readonly library: Library;
}

/** Sound lives in the sidebar webview, so commands that need it open the view, then give focus back. */
async function revealView(): Promise<void> {
  await vscode.commands.executeCommand('workbench.view.extension.null-music');
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
}

export function activate(context: vscode.ExtensionContext): NullMusicApi {
  const storage = context.globalStorageUri.fsPath;
  const artDir = path.join(storage, 'art');

  const library = new Library({
    state: context.globalState,
    cacheFile: path.join(storage, 'library-cache.json'),
    artDir,
    extensions: () => vscode.workspace.getConfiguration('null-music.local').get<string[]>('supportedExtensions', []),
  });

  const output = new WebviewAudioOutput({ revealView });
  const sessions = new SessionStore(context.globalState);
  const player = new Player({
    output,
    session: sessions,
    isLiked: (id) => library.isLiked(id),
    defaultQueue: () => library.tracks,
    onDuration: (track, ms) => library.learnDuration(track.id, ms),
    onSkipped: (n) =>
      vscode.window.setStatusBarMessage(`$(warning) Null Music: skipped ${n} unplayable track${n === 1 ? '' : 's'}`, 5000),
    onError: (message) => vscode.window.showErrorMessage(`Null Music: ${message}`),
  });

  player.onDidChangeTrack((track) => {
    const enabled = vscode.workspace.getConfiguration('null-music.notifications').get<boolean>('showOnSongChange', false);
    if (track && enabled) {
      vscode.window.showInformationMessage(`Now Playing: ${track.name} • ${track.artist}`);
    }
  });

  const statusBar = new StatusBarController(player);
  const musicViewProvider = new MusicViewProvider(context.extensionUri, player, library, output, artDir);

  context.subscriptions.push(
    statusBar,
    player,
    library,
    musicViewProvider,
    vscode.window.registerWebviewViewProvider(MusicViewProvider.viewType, musicViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  registerCommands(context, player, library);

  // Never block activation: show cached tracks, restore the session paused, then re-scan.
  void (async () => {
    await library.loadCache();
    const session = sessions.load();
    if (session && player.queue.length === 0) {
      player.restore(session, (id) => library.trackById(id));
    }
    await library.rescan();
  })().catch((err) => console.error('Null Music: library startup failed', err));

  return { player, library };
}

export function deactivate(): void {}
```

- [ ] **Step 6: Delete the dead provider layer and trim shared files**

Run:
```bash
git rm -r src/provider src/playback/playbackManager.ts src/test/localProvider.test.ts src/test/playbackManager.test.ts
```

`src/types.ts`: delete `PlaybackDevice`, `Playlist`, `Artist`, `Album`, `SearchResults`, `MusicAuthToken`, `MusicAuthAccount`, `PlayOptions`, and the `device?: PlaybackDevice;` line of `PlaybackState`. What remains: `RepeatMode`, `Track`, `PlaybackState`, `KeyValueStore`.

`src/testFakes.ts`: delete the `FakeMusicProvider` class and its imports; keep `makeSampleTrack` and `makeSamplePlaybackState` (import `PlaybackState, Track` from `./types`); remove the `device: { … },` block from `makeSamplePlaybackState`.

- [ ] **Step 7: Update the tests**

`src/test/statusBarController.test.ts`: delete the line `assert.ok(model.tooltipText.includes('Null IDE Local Player'));`.

Replace `src/test/musicViewProvider.test.ts` entirely:

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
import { FakeOutput, MemState, tick } from './fixtures';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-music-view-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('MusicViewController drives the Player and Library from webview messages', async () => {
  const music = path.join(root, 'music');
  fs.mkdirSync(music, { recursive: true });
  fs.writeFileSync(path.join(music, 'Band - One.mp3'), 'x');
  fs.writeFileSync(path.join(music, 'Band - Two.mp3'), 'x');

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

  await controller.handleMessage({ type: 'ready' });
  assert.ok(posted.some((m) => m.type === 'stateUpdate'));
  const lib = posted.find((m) => m.type === 'localLibraryUpdate');
  assert.strictEqual(lib.tracks.length, 2);
  assert.deepStrictEqual(lib.progress, { scanned: 2, total: 2 });

  const [one, two] = library.tracks;
  await controller.handleMessage({ type: 'localPlayTrack', trackUri: two.uri });
  assert.strictEqual(player.getState().track?.id, two.id);
  out.emit({ type: 'play' });
  assert.strictEqual(player.getState().isPlaying, true);

  await controller.handleMessage({ type: 'seek', positionMs: 30000 });
  assert.strictEqual(player.getState().progressMs, 30000);
  await controller.handleMessage({ type: 'setVolume', volumePercent: 45 });
  assert.strictEqual(player.getState().volume, 45);

  await controller.handleMessage({ type: 'toggleTrackLike', trackId: one.id });
  assert.strictEqual(library.isLiked(one.id), true);
  assert.strictEqual(posted.filter((m) => m.type === 'localLibraryUpdate').at(-1).tracks[0].isLiked, true);

  await controller.handleMessage({ type: 'localPlayFolder', folderUri: pathToUri(music) });
  assert.strictEqual(player.getState().track?.id, one.id);

  await controller.handleMessage({ type: 'localOpenFolder' });
  await controller.handleMessage({ type: 'localImportPlaylist' });
  assert.deepStrictEqual(commands, ['null-music.openLocalFolder', 'null-music.importPlaylist']);

  // audio events belong to the output, not the controller: ignored here, never an error
  await controller.handleMessage({ type: 'localAudioError', error: 'boom' });
  await tick();
  assert.deepStrictEqual(errors, []);

  player.dispose();
  library.dispose();
});
```

- [ ] **Step 8: Update the test list, compile and run**

In `package.json`, set the `test` script's list to exactly:
`out/test/queue.test.js out/test/tagReader.test.js out/test/libraryCache.test.js out/test/library.test.js out/test/player.test.js out/test/webviewAudioOutput.test.js out/test/statusBarController.test.js out/test/musicHtml.test.js out/test/musicViewProvider.test.js out/test/commands.test.js out/test/m3uParser.test.js out/test/uri.test.js`

Run: `npm test`
Expected: PASS. Fix any compile error by following the new signatures above; do not re-introduce `PlaybackManager`/`LocalMusicProvider`. Then `git grep -n "playbackManager\|LocalMusicProvider\|IMusicProvider\|PlaybackDevice" -- src` must print nothing.

- [ ] **Step 9: Commit**

```bash
git add -A src package.json
git commit -m "refactor(null-music): rewire UI onto Player and Library, delete the provider layer"
```
(`git add -A src` stages deletions under `src/` only; the unrelated `media/music.svg` change is outside it.)

---

### Task 9: Manifest, docs, compiled output and real-app verification

**Files:**
- Modify: `package.json` (manifest), `CLAUDE.md` (repo root, null-music entry), `out/` (via compile only)

- [ ] **Step 1: Clean up the manifest in `package.json`**

- Delete the whole `"null-music.playback.pollingIntervalMs": { … }` property from `contributes.configuration.properties`.
- In `"null-music.statusBar.format"`, change the description to `"Format string for the status bar. Available variables: ${title}, ${artist}, ${album}."`.
- In `"null-music.local.supportedExtensions"`, change the default to `[".mp3", ".flac", ".ogg", ".wav", ".m4a", ".aac", ".opus"]`.

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`
Expected: no output (valid JSON).

- [ ] **Step 2: Correct the null-music entry in the repo-root `CLAUDE.md`**

Replace the whole `### null-music (…)` paragraph with:

```markdown
### null-music (`extensions/null-music/`)
Local-file music player: activity-bar view `null.musicView`, status bar item, `Ctrl+Alt+…` media keybindings. The extension host owns all state — `Library` (folders + `.m3u8`, tags and cover art via the in-house `library/tagReader.ts`, JSON cache in `globalStorageUri`), `Queue` (history-aware shuffle, play next/add), `Player` (single position clock, paused session restore under `globalState` key `null-music.session`) and an `AudioOutput`. Sound comes from an `<audio>` element in the sidebar webview (`WebviewAudioOutput`): commands reveal the view and wait for its `ready`, and closing the view stops playback. `isPlaying` is true only after the output reports `play`. There is no provider abstraction; do not add one. Designs: `docs/specs/null-music-engine-design.md`, `docs/specs/null-music-player-ui-design.md`; plan: `docs/plans/null-music-engine.md`.
```

Also change "Nine built-in extensions"–style text only if it mentions Spotify (it should not).

- [ ] **Step 3: Full test run**

Run: `npm test`
Expected: PASS, every test file in the `test` script executed (count the "# pass" total: it must be larger than before this plan because the old localProvider/playbackManager tests were replaced by ~50 new ones).

- [ ] **Step 4: Commit source and docs**

```bash
git add package.json ../../CLAUDE.md
git commit -m "docs(null-music): drop polling setting and wma default, update CLAUDE.md for the new engine"
```

- [ ] **Step 5: Refresh compiled output (separate commit, per repo convention)**

Run:
```bash
npm run compile
git rm -r --cached --ignore-unmatch out/provider out/playback/playbackManager.js out/playback/playbackManager.js.map out/test/localProvider.test.js out/test/localProvider.test.js.map out/test/playbackManager.test.js out/test/playbackManager.test.js.map
rm -rf out/provider out/playback/playbackManager.js out/playback/playbackManager.js.map out/test/localProvider.test.js out/test/localProvider.test.js.map out/test/playbackManager.test.js out/test/playbackManager.test.js.map
git add -A out
git status --short
```
Expected: `git status` lists only `out/` additions, modifications and deletions (plus the untouched `media/music.svg`, unstaged). `tsc` never deletes stale output, hence the explicit removals.

```bash
git commit -m "chore: refresh null-music compiled output"
```

- [ ] **Step 6: Refresh the code graph**

Run (repo root): `graphify update .`
Expected: completes without error (skip with a note if `graphify` is not installed).

- [ ] **Step 7: Verify in the real app**

Invoke the `verify-local` skill (syncs the extension into the installed Null IDE and runs integration specs; there are no null-music specs yet, so the manual checklist below is the acceptance test). Report each line as pass/fail with what was observed:

1. Fresh window, sidebar Music view **never opened**: add a music folder via the command palette, then press `Ctrl+Alt+Space`. Sound plays; the sidebar opened and focus returned to the editor. If focus stays in the sidebar, `revealView()` in `src/extension.ts` needs another way to resolve the view without focusing it (this is the spec's main flakiness risk) — fix and re-test before continuing.
2. Status bar shows the play icon only after sound actually starts; closing the sidebar view while playing flips it to paused.
3. Restart the IDE: the same track, position and volume return **paused**; no sound until Play.
4. Likes made before this change are still hearts (ids unchanged), including a file whose name has spaces, `#` and non-ASCII characters.
5. A library of mixed mp3/flac/m4a shows real titles/artists/albums; `globalStorage/null.null-music/art/` contains `<hash>.jpg|png` files; a second start does not re-read unchanged files (watch `library-cache.json` mtime stays constant when nothing changed).
6. Shuffle on: ten Next presses never repeat a track back to back; Previous walks back through what was just played.
7. Pause during the first second of a freshly started track does not skip or error.
8. Drop a corrupt `.mp3` into the folder, play through: it is skipped silently; the status bar shows one transient skipped-track warning.

If all pass, the work is complete. If any fail, fix in a new commit on the relevant earlier module (with its test), recompile, and refresh `out/` again in a new `chore: refresh null-music compiled output` commit.

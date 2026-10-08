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

test('externalDirs lists the folders of playlist-only files so the view may load them', async () => {
  const fx = fixture();
  const outside = path.join(fx.base, 'elsewhere', 'solo.mp3');
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, 'x');
  const { lib } = make(fx);
  await lib.addFolder(fx.folderUri);
  await lib.importPlaylist(path.join(fx.base, 'mix.m3u8'), `${fx.files.alpha}\n${outside}\nhttps://x.test/s.mp3\n`);
  assert.deepStrictEqual(lib.externalDirs, [path.dirname(outside)]);
  lib.dispose();
});

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

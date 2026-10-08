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
const ids = (list: T[]) => Array.from(list, (x) => x.id); // Array.from: an array of this realm, not the vm's

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
  assert.deepStrictEqual(Array.from(artists, (a) => a.name), ['Solo', 'The Band']);
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
  assert.deepStrictEqual(Array.from(m.rankItems(albums, 'road', (a) => [a.n]), (a) => a.n), ['Road Trip', 'Abbey Road']);
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

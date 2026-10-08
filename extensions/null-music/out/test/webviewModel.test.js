'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = require("node:test");
const node_vm_1 = __importDefault(require("node:vm"));
const sandbox = node_vm_1.default.createContext({});
node_vm_1.default.runInContext((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, '..', 'webview-music-shared.js'), 'utf8'), sandbox);
const m = sandbox;
// Values built inside the vm have a different Array prototype; compare plain copies.
const plain = (v) => JSON.parse(JSON.stringify(v));
const t = (id, over = {}) => ({ id, name: id, artist: 'A', album: 'X', durationMs: 1000, ...over });
const ids = (list) => Array.from(list, (x) => x.id); // Array.from: an array of this realm, not the vm's
(0, node_test_1.test)('formatTime: m:ss, h:mm:ss, and junk becomes 0:00', () => {
    node_assert_1.default.strictEqual(m.formatTime(0), '0:00');
    node_assert_1.default.strictEqual(m.formatTime(65000), '1:05');
    node_assert_1.default.strictEqual(m.formatTime(3725000), '1:02:05');
    node_assert_1.default.strictEqual(m.formatTime(NaN), '0:00');
    node_assert_1.default.strictEqual(m.formatTime(-5), '0:00');
});
(0, node_test_1.test)('sortTracks sorts a copy by title, artist and duration', () => {
    const list = [t('b', { name: 'beta', artist: 'Z', durationMs: 5 }), t('a', { name: 'Alpha', artist: 'Y', durationMs: 9 })];
    node_assert_1.default.deepStrictEqual(ids(m.sortTracks(list, 'title')), ['a', 'b']);
    node_assert_1.default.deepStrictEqual(ids(m.sortTracks(list, 'artist')), ['a', 'b']);
    node_assert_1.default.deepStrictEqual(ids(m.sortTracks(list, 'duration')), ['b', 'a']);
    node_assert_1.default.deepStrictEqual(ids(list), ['b', 'a']); // input untouched
});
(0, node_test_1.test)('groupAlbums orders by disc then track number and tolerates missing tags', () => {
    const albums = m.groupAlbums([
        t('d2t1', { album: 'Rec', artist: 'Band', discNo: 2, trackNo: 1, year: 1999, artUrl: 'u' }),
        t('d1t2', { album: 'Rec', artist: 'Band', discNo: 1, trackNo: 2 }),
        t('d1t1', { album: 'Rec', artist: 'Band', discNo: 1, trackNo: 1 }),
        t('lone', { album: '', artist: '' }),
    ]);
    const rec = albums.find((a) => a.name === 'Rec');
    node_assert_1.default.deepStrictEqual(ids(rec.tracks), ['d1t1', 'd1t2', 'd2t1']);
    node_assert_1.default.strictEqual(rec.year, 1999);
    node_assert_1.default.strictEqual(rec.artUrl, 'u');
    const lone = albums.find((a) => a.name === 'Unknown album');
    node_assert_1.default.strictEqual(lone.artist, 'Unknown artist');
    node_assert_1.default.deepStrictEqual(plain(m.groupAlbums([])), []);
});
(0, node_test_1.test)('groupArtists prefers album artist, merges case differences and lists albums', () => {
    const artists = m.groupArtists([
        t('1', { artist: 'The Band feat. X', albumArtist: 'The Band', album: 'One' }),
        t('2', { artist: 'the band', album: 'Two' }),
        t('3', { artist: 'Solo', album: 'S', artUrl: 'art' }),
    ]);
    node_assert_1.default.deepStrictEqual(Array.from(artists, (a) => a.name), ['Solo', 'The Band']);
    const band = artists.find((a) => a.name === 'The Band');
    node_assert_1.default.strictEqual(band.albums.length, 2);
    node_assert_1.default.strictEqual(band.tracks.length, 2);
    node_assert_1.default.strictEqual(artists.find((a) => a.name === 'Solo').artUrl, 'art');
    node_assert_1.default.deepStrictEqual(plain(m.groupArtists([])), []);
});
(0, node_test_1.test)('album and artist keys match the grouped keys the player links to', () => {
    const track = t('k', { album: 'Rec', artist: 'Band' });
    node_assert_1.default.strictEqual(m.albumKeyOf(track), m.groupAlbums([track])[0].key);
    node_assert_1.default.strictEqual(m.artistKeyOf(track), m.groupArtists([track])[0].key);
    node_assert_1.default.strictEqual(m.artistKeyOf(t('k2', { artist: 'BAND' })), m.artistKeyOf(track));
});
(0, node_test_1.test)('scoreText: prefix > word start > substring > none; case-insensitive', () => {
    node_assert_1.default.strictEqual(m.scoreText('Rainbow', 'rain'), 3);
    node_assert_1.default.strictEqual(m.scoreText('Dark Rain', 'RAIN'), 2);
    node_assert_1.default.strictEqual(m.scoreText('Training', 'rain'), 1);
    node_assert_1.default.strictEqual(m.scoreText('Sunshine', 'rain'), 0);
    node_assert_1.default.strictEqual(m.scoreText('anything', '   '), 0);
    node_assert_1.default.strictEqual(m.scoreText('Training rain', 'rain'), 2); // a later word start beats an earlier mid-word hit
});
(0, node_test_1.test)('rankTracks orders by match quality, titles outrank artists, keeps list order for ties', () => {
    const list = [t('train', { name: 'Training' }), t('dark', { name: 'Dark Rain' }), t('bow', { name: 'Rainbow' }), t('no', { name: 'Other' })];
    node_assert_1.default.deepStrictEqual(ids(m.rankTracks(list, 'rain')), ['bow', 'dark', 'train']);
    const byArtist = [t('x', { name: 'zzz', artist: 'rain' }), t('y', { name: 'rain man', artist: 'q' })];
    node_assert_1.default.deepStrictEqual(ids(m.rankTracks(byArtist, 'rain')), ['y', 'x']);
    node_assert_1.default.strictEqual(m.rankTracks(list, '  '), list); // blank query = unfiltered
});
(0, node_test_1.test)('matchesTrack filters without reordering; blank matches all', () => {
    node_assert_1.default.strictEqual(m.matchesTrack(t('a', { name: 'Rainbow' }), 'rain'), true);
    node_assert_1.default.strictEqual(m.matchesTrack(t('a', { name: 'Other', artist: 'Rain Band' }), 'rain'), true);
    node_assert_1.default.strictEqual(m.matchesTrack(t('a', { name: 'Other' }), 'rain'), false);
    node_assert_1.default.strictEqual(m.matchesTrack(t('a'), '   '), true);
});
(0, node_test_1.test)('regex metacharacters in a query are plain text and never throw', () => {
    const list = [t('a', { name: 'a[b' }), t('b', { name: 'plain (c) text' }), t('c', { name: 'zzz' })];
    node_assert_1.default.deepStrictEqual(ids(m.rankTracks(list, '[')), ['a']);
    node_assert_1.default.deepStrictEqual(ids(m.rankTracks(list, '(c')), ['b']);
    node_assert_1.default.deepStrictEqual(ids(m.rankTracks(list, '.*')), []);
    node_assert_1.default.deepStrictEqual(plain(m.highlightRanges('a.*b.*', '.*')), [[1, 3], [4, 6]]);
});
(0, node_test_1.test)('rankItems works on any item type', () => {
    const albums = [{ n: 'Abbey Road' }, { n: 'Road Trip' }, { n: 'Other' }];
    node_assert_1.default.deepStrictEqual(Array.from(m.rankItems(albums, 'road', (a) => [a.n]), (a) => a.n), ['Road Trip', 'Abbey Road']);
});
(0, node_test_1.test)('highlightRanges finds every non-overlapping occurrence', () => {
    node_assert_1.default.deepStrictEqual(plain(m.highlightRanges('Rain rain', 'rain')), [[0, 4], [5, 9]]);
    node_assert_1.default.deepStrictEqual(plain(m.highlightRanges('abc', '')), []);
    node_assert_1.default.deepStrictEqual(plain(m.highlightRanges('abc', 'z')), []);
});
(0, node_test_1.test)('placeholderHue is deterministic and within 0..359', () => {
    const a = m.placeholderHue('Abbey Road');
    node_assert_1.default.strictEqual(a, m.placeholderHue('Abbey Road'));
    node_assert_1.default.ok(a >= 0 && a < 360);
    node_assert_1.default.notStrictEqual(m.placeholderHue('a'), m.placeholderHue('b'));
});
(0, node_test_1.test)('resolveTracks keeps order and drops unknown ids', () => {
    const byId = new Map([['a', t('a')], ['b', t('b')]]);
    node_assert_1.default.deepStrictEqual(ids(m.resolveTracks(['b', 'zzz', 'a'], byId)), ['b', 'a']);
});
(0, node_test_1.test)('reorderTarget gives the beforeKey for Alt+Up/Down, undefined at the edges', () => {
    const keys = [10, 11, 12, 13];
    node_assert_1.default.strictEqual(m.reorderTarget(keys, 11, -1), 10);
    node_assert_1.default.strictEqual(m.reorderTarget(keys, 10, -1), undefined);
    node_assert_1.default.strictEqual(m.reorderTarget(keys, 11, 1), 13);
    node_assert_1.default.strictEqual(m.reorderTarget(keys, 12, 1), null); // becomes the last entry
    node_assert_1.default.strictEqual(m.reorderTarget(keys, 13, 1), undefined);
    node_assert_1.default.strictEqual(m.reorderTarget(keys, 99, 1), undefined);
});
(0, node_test_1.test)('trackContext is JSON the context-menu contribution can read, even for hostile ids', () => {
    const ctx = JSON.parse(m.trackContext('local:file:///a"b>.mp3'));
    node_assert_1.default.strictEqual(ctx.webviewSection, 'track');
    node_assert_1.default.strictEqual(ctx.trackId, 'local:file:///a"b>.mp3');
    node_assert_1.default.strictEqual(ctx.preventDefaultContextMenuItems, true);
});
//# sourceMappingURL=webviewModel.test.js.map
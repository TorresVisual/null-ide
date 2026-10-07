'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const node_test_1 = require("node:test");
const library_1 = require("../library/library");
const uri_1 = require("../uri");
const fixtures_1 = require("./fixtures");
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-music-lib-'));
(0, node_test_1.after)(() => fs.rmSync(root, { recursive: true, force: true }));
let n = 0;
const TAGGED = (0, fixtures_1.id3Tag)([(0, fixtures_1.id3Text)('TIT2', 'Tagged'), (0, fixtures_1.id3Text)('TPE1', 'Tagger'), (0, fixtures_1.id3Text)('TALB', 'Album X'), (0, fixtures_1.id3Apic)(fixtures_1.PNG)]);
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
    return { base, music, folderUri: (0, uri_1.pathToUri)(music), files, cache: path.join(base, 'cache.json'), art: path.join(base, 'art') };
}
function make(fx, state = new fixtures_1.MemState()) {
    return { state, lib: new library_1.Library({ state, cacheFile: fx.cache, artDir: fx.art, extensions: () => ['.mp3'], concurrency: 4 }) };
}
(0, node_test_1.test)('addFolder scans, falls back to filenames, reads tags and writes cover art', async () => {
    const fx = fixture();
    const { lib, state } = make(fx);
    const added = await lib.addFolder(fx.folderUri);
    node_assert_1.default.strictEqual(added.length, 2); // notes.txt and .hidden ignored
    const [alpha, tagged] = added;
    node_assert_1.default.strictEqual(alpha.name, 'One More Time');
    node_assert_1.default.strictEqual(alpha.artist, 'Daft Punk');
    node_assert_1.default.strictEqual(alpha.id, `local:${(0, uri_1.pathToUri)(fx.files.alpha)}`); // same id format as before: likes survive
    node_assert_1.default.strictEqual(alpha.folder, fx.folderUri);
    node_assert_1.default.strictEqual(tagged.name, 'Tagged');
    node_assert_1.default.strictEqual(tagged.artist, 'Tagger');
    node_assert_1.default.strictEqual(tagged.album, 'Album X');
    node_assert_1.default.match(tagged.artKey ?? '', /^[0-9a-f]+\.png$/);
    node_assert_1.default.ok(fs.existsSync(path.join(fx.art, tagged.artKey)));
    node_assert_1.default.deepStrictEqual(state.get('null-music.local.folders', []), [fx.folderUri]);
    node_assert_1.default.deepStrictEqual(lib.progress, { scanned: 2, total: 2 });
    lib.dispose();
});
(0, node_test_1.test)('emits onDidChange while scanning', async () => {
    const fx = fixture();
    const { lib } = make(fx);
    let fired = 0;
    lib.onDidChange(() => fired++);
    await lib.addFolder(fx.folderUri);
    node_assert_1.default.ok(fired >= 1);
    lib.dispose();
});
(0, node_test_1.test)('the cache is reused while mtime/size match and re-read when the file changes', async () => {
    const fx = fixture();
    const first = make(fx);
    await first.lib.addFolder(fx.folderUri);
    first.lib.dispose();
    const raw = JSON.parse(fs.readFileSync(fx.cache, 'utf8'));
    raw.entries[fx.files.tagged].tags.title = 'FromCache';
    fs.writeFileSync(fx.cache, JSON.stringify(raw));
    const second = make(fx, first.state);
    await second.lib.loadCache();
    node_assert_1.default.ok(second.lib.tracks.some((t) => t.name === 'FromCache')); // instant, before any scan
    await second.lib.rescan();
    node_assert_1.default.ok(second.lib.tracks.some((t) => t.name === 'FromCache')); // reused: mtime and size unchanged
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(fx.files.tagged, later, later);
    await second.lib.rescan();
    node_assert_1.default.ok(second.lib.tracks.some((t) => t.name === 'Tagged')); // re-read
    second.lib.dispose();
});
(0, node_test_1.test)('deleted files leave the library and the cache', async () => {
    const fx = fixture();
    const { lib } = make(fx);
    await lib.addFolder(fx.folderUri);
    fs.rmSync(fx.files.alpha);
    await lib.rescan();
    node_assert_1.default.deepStrictEqual(lib.tracks.map((t) => t.name), ['Tagged']);
    node_assert_1.default.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(fx.cache, 'utf8')).entries), [fx.files.tagged]);
    lib.dispose();
});
(0, node_test_1.test)('a missing or offline folder does not throw or hide the other folders', async () => {
    const fx = fixture();
    const state = new fixtures_1.MemState();
    await state.update('null-music.local.folders', [(0, uri_1.pathToUri)(path.join(fx.base, 'nope')), fx.folderUri]);
    const { lib } = make(fx, state);
    await lib.rescan();
    node_assert_1.default.strictEqual(lib.tracks.length, 2);
    lib.dispose();
});
(0, node_test_1.test)('likes persist under the existing key and survive a new instance', async () => {
    const fx = fixture();
    const a = make(fx);
    const [alpha] = await a.lib.addFolder(fx.folderUri);
    node_assert_1.default.strictEqual(await a.lib.toggleLike(alpha.id), true);
    node_assert_1.default.deepStrictEqual(a.state.get('null-music.local.liked', []), [alpha.id]);
    a.lib.dispose();
    const b = make(fx, a.state);
    node_assert_1.default.strictEqual(b.lib.isLiked(alpha.id), true);
    node_assert_1.default.strictEqual(await b.lib.toggleLike(alpha.id), false);
    node_assert_1.default.strictEqual(b.lib.isLiked(alpha.id), false);
    b.lib.dispose();
});
(0, node_test_1.test)('playlists resolve to library tracks, read tags for outside files, keep streams, and get distinct ids', async () => {
    const fx = fixture();
    const outside = path.join(fx.base, 'other', 'solo.mp3');
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, (0, fixtures_1.id3Tag)([(0, fixtures_1.id3Text)('TIT2', 'Solo'), (0, fixtures_1.id3Text)('TPE1', 'Lone')]));
    const { lib, state } = make(fx);
    await lib.addFolder(fx.folderUri);
    const content = `#EXTM3U\n#PLAYLIST:Mix\n${fx.files.alpha}\n${outside}\nhttps://x.test/stream.mp3\n`;
    const pl = await lib.importPlaylist(path.join(fx.base, 'mix.m3u8'), content);
    node_assert_1.default.strictEqual(pl.name, 'Mix');
    node_assert_1.default.strictEqual(pl.tracks.length, 3);
    node_assert_1.default.strictEqual(pl.tracks[0], lib.trackByUri(pl.tracks[0].uri)); // the library's own track
    node_assert_1.default.strictEqual(pl.tracks[0].name, 'One More Time');
    node_assert_1.default.strictEqual(pl.tracks[1].name, 'Solo');
    node_assert_1.default.strictEqual(pl.tracks[1].artist, 'Lone');
    node_assert_1.default.ok(lib.trackById(pl.tracks[1].id)); // resolvable (session restore) ...
    node_assert_1.default.strictEqual(lib.tracks.length, 2); // ... but not part of the library list
    node_assert_1.default.strictEqual(pl.tracks[2].uri, 'https://x.test/stream.mp3');
    const pl2 = await lib.importPlaylist(path.join(fx.base, 'mix2.m3u8'), content);
    node_assert_1.default.notStrictEqual(pl.id, pl2.id);
    node_assert_1.default.strictEqual(lib.playlists.length, 2);
    await lib.removePlaylist(pl.id);
    node_assert_1.default.strictEqual(lib.playlists.length, 1);
    node_assert_1.default.deepStrictEqual(state.get('null-music.local.playlists', []), [pl2.filePath]);
    lib.dispose();
});
(0, node_test_1.test)('collections, search and contextFor', async () => {
    const fx = fixture();
    const { lib } = make(fx);
    const [alpha, tagged] = await lib.addFolder(fx.folderUri);
    await lib.toggleLike(alpha.id);
    await lib.importPlaylist(path.join(fx.base, 'mix.m3u8'), `#PLAYLIST:Mix\n${fx.files.tagged}\n`);
    node_assert_1.default.deepStrictEqual(lib.collections().map((c) => c.kind), ['liked', 'playlist', 'folder']);
    node_assert_1.default.strictEqual(lib.collections()[2].tracks.length, 2);
    node_assert_1.default.deepStrictEqual(lib.search('tagger').map((t) => t.name), ['Tagged']);
    node_assert_1.default.strictEqual(lib.search('').length, 2);
    node_assert_1.default.strictEqual(lib.contextFor(tagged.uri)?.index, 1);
    node_assert_1.default.strictEqual(lib.contextFor('file:///nowhere.mp3'), undefined);
    lib.dispose();
});
(0, node_test_1.test)('learnDuration updates the track and the cache', async () => {
    const fx = fixture();
    const { lib } = make(fx);
    const [alpha] = await lib.addFolder(fx.folderUri);
    lib.learnDuration(alpha.id, 200000);
    node_assert_1.default.strictEqual(lib.trackById(alpha.id)?.durationMs, 200000);
    lib.dispose(); // flushes the cache
    await new Promise((r) => setTimeout(r, 50));
    node_assert_1.default.strictEqual(JSON.parse(fs.readFileSync(fx.cache, 'utf8')).entries[fx.files.alpha].tags.durationMs, 200000);
});
//# sourceMappingURL=library.test.js.map
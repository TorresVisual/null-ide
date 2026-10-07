'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const m3uParser_1 = require("../library/m3uParser");
(0, node_test_1.test)('m3uParser parses standard M3U8 with EXTINF metadata and relative paths', () => {
    const content = `#EXTM3U
#PLAYLIST:Synthwave Beats
#EXTINF:210,Kavinsky - Nightcall
tracks/nightcall.mp3
#EXTINF:185,Gunship - Tech Noir
../synth/tech_noir.flac
#EXTINF:240,Lazerhawk - Overdrive
Overdrive.ogg
`;
    const playlistPath = 'D:\\Music\\Playlists\\favorites.m3u8';
    const result = (0, m3uParser_1.parseM3u)(content, playlistPath);
    node_assert_1.default.strictEqual(result.name, 'Synthwave Beats');
    node_assert_1.default.strictEqual(result.tracks.length, 3);
    // Track 1
    node_assert_1.default.strictEqual(result.tracks[0].name, 'Nightcall');
    node_assert_1.default.strictEqual(result.tracks[0].artist, 'Kavinsky');
    node_assert_1.default.strictEqual(result.tracks[0].durationMs, 210000);
    node_assert_1.default.ok(result.tracks[0].uri.includes('nightcall.mp3'));
    // Track 2
    node_assert_1.default.strictEqual(result.tracks[1].name, 'Tech Noir');
    node_assert_1.default.strictEqual(result.tracks[1].artist, 'Gunship');
    node_assert_1.default.strictEqual(result.tracks[1].durationMs, 185000);
    node_assert_1.default.ok(result.tracks[1].uri.includes('tech_noir.flac'));
    // Track 3
    node_assert_1.default.strictEqual(result.tracks[2].name, 'Overdrive');
    node_assert_1.default.strictEqual(result.tracks[2].artist, 'Lazerhawk');
    node_assert_1.default.strictEqual(result.tracks[2].durationMs, 240000);
});
(0, node_test_1.test)('m3uParser handles UTF-8 BOM, web streams, and absolute paths', () => {
    const bomContent = '\uFEFF' + `#EXTM3U
#EXTINF:-1,SomaFM - Groove Salad
https://ice1.somafm.com/groovesalad-128-mp3
#EXTINF:300,The Midnight - Days of Thunder
C:\\Audio\\Library\\DaysOfThunder.mp3
#EXTINF:150,Simple Track Without Artist
track_only.wav
`;
    const playlistPath = '/home/user/music/chill.m3u8';
    const result = (0, m3uParser_1.parseM3u)(bomContent, playlistPath);
    node_assert_1.default.strictEqual(result.name, 'chill');
    node_assert_1.default.strictEqual(result.tracks.length, 3);
    // Web stream
    node_assert_1.default.strictEqual(result.tracks[0].name, 'Groove Salad');
    node_assert_1.default.strictEqual(result.tracks[0].artist, 'SomaFM');
    node_assert_1.default.strictEqual(result.tracks[0].uri, 'https://ice1.somafm.com/groovesalad-128-mp3');
    node_assert_1.default.strictEqual(result.tracks[0].durationMs, 0);
    // Absolute path
    node_assert_1.default.strictEqual(result.tracks[1].name, 'Days of Thunder');
    node_assert_1.default.strictEqual(result.tracks[1].artist, 'The Midnight');
    node_assert_1.default.strictEqual(result.tracks[1].durationMs, 300000);
    // Title without hyphen
    node_assert_1.default.strictEqual(result.tracks[2].name, 'Simple Track Without Artist');
    node_assert_1.default.strictEqual(result.tracks[2].artist, 'chill');
});
(0, node_test_1.test)('serializeM3u correctly formats tracks into M3U8 string', () => {
    const tracks = [
        {
            id: 'local:1',
            name: 'Song A',
            artist: 'Artist 1',
            artists: ['Artist 1'],
            album: 'Test',
            durationMs: 120000,
            uri: 'file:///music/songA.mp3',
        },
    ];
    const m3u = (0, m3uParser_1.serializeM3u)('My Cool Playlist', tracks);
    node_assert_1.default.ok(m3u.includes('#EXTM3U'));
    node_assert_1.default.ok(m3u.includes('#PLAYLIST:My Cool Playlist'));
    node_assert_1.default.ok(m3u.includes('#EXTINF:120,Artist 1 - Song A'));
    node_assert_1.default.ok(m3u.includes('file:///music/songA.mp3'));
});
//# sourceMappingURL=m3uParser.test.js.map
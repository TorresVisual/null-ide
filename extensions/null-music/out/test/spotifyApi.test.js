'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const spotifyApi_1 = require("../provider/spotify/spotifyApi");
(0, node_test_1.test)('SpotifyApi throws if not authenticated', async () => {
    const api = new spotifyApi_1.SpotifyApi({
        getAccessToken: async () => null,
    });
    await node_assert_1.default.rejects(api.getPlaybackState(), /not authenticated/i);
});
(0, node_test_1.test)('SpotifyApi getPlaybackState parses response correctly', async () => {
    const mockResponse = {
        is_playing: true,
        progress_ms: 12000,
        shuffle_state: true,
        repeat_state: 'track',
        timestamp: 1600000000000,
        device: {
            id: 'd1',
            name: 'Null Speaker',
            type: 'Speaker',
            is_active: true,
            volume_percent: 75,
        },
        item: {
            id: 'song-1',
            name: 'Coding Flow',
            duration_ms: 240000,
            uri: 'spotify:track:song-1',
            album: {
                name: 'Focus Album',
                images: [{ url: 'https://example.com/cover.jpg' }],
            },
            artists: [{ name: 'Null Artist' }, { name: 'Featuring Pro' }],
        },
    };
    const mockFetch = async (url, init) => {
        return {
            status: 200,
            ok: true,
            json: async () => mockResponse,
            text: async () => '',
        };
    };
    const api = new spotifyApi_1.SpotifyApi({
        getAccessToken: async () => 'fake-access-token',
        fetchFn: mockFetch,
    });
    const state = await api.getPlaybackState();
    node_assert_1.default.ok(state !== null);
    node_assert_1.default.strictEqual(state.isPlaying, true);
    node_assert_1.default.strictEqual(state.progressMs, 12000);
    node_assert_1.default.strictEqual(state.durationMs, 240000);
    node_assert_1.default.strictEqual(state.volume, 75);
    node_assert_1.default.strictEqual(state.shuffle, true);
    node_assert_1.default.strictEqual(state.repeat, 'track');
    node_assert_1.default.strictEqual(state.track?.id, 'song-1');
    node_assert_1.default.strictEqual(state.track?.name, 'Coding Flow');
    node_assert_1.default.strictEqual(state.track?.artist, 'Null Artist, Featuring Pro');
    node_assert_1.default.strictEqual(state.track?.album, 'Focus Album');
    node_assert_1.default.strictEqual(state.track?.albumArtUrl, 'https://example.com/cover.jpg');
    node_assert_1.default.strictEqual(state.device?.name, 'Null Speaker');
});
(0, node_test_1.test)('SpotifyApi playback control methods send correct endpoints and bodies', async () => {
    const requests = [];
    const mockFetch = async (url, init) => {
        requests.push({
            url: String(url),
            method: init?.method || 'GET',
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return {
            status: 204,
            ok: true,
            json: async () => ({}),
            text: async () => '',
        };
    };
    const api = new spotifyApi_1.SpotifyApi({
        getAccessToken: async () => 'tok',
        fetchFn: mockFetch,
    });
    await api.play({ uri: 'spotify:track:123' });
    await api.pause();
    await api.next();
    await api.previous();
    await api.seek(50000);
    await api.setVolume(60);
    await api.setShuffle(true);
    await api.setRepeatMode('context');
    node_assert_1.default.strictEqual(requests.length, 8);
    node_assert_1.default.strictEqual(requests[0].method, 'PUT');
    node_assert_1.default.ok(requests[0].url.includes('/player/play'));
    node_assert_1.default.deepStrictEqual(requests[0].body, { uris: ['spotify:track:123'] });
    node_assert_1.default.strictEqual(requests[1].method, 'PUT');
    node_assert_1.default.ok(requests[1].url.includes('/player/pause'));
    node_assert_1.default.strictEqual(requests[2].method, 'POST');
    node_assert_1.default.ok(requests[2].url.includes('/player/next'));
    node_assert_1.default.strictEqual(requests[3].method, 'POST');
    node_assert_1.default.ok(requests[3].url.includes('/player/previous'));
    node_assert_1.default.strictEqual(requests[4].method, 'PUT');
    node_assert_1.default.ok(requests[4].url.includes('position_ms=50000'));
    node_assert_1.default.strictEqual(requests[5].method, 'PUT');
    node_assert_1.default.ok(requests[5].url.includes('volume_percent=60'));
    node_assert_1.default.strictEqual(requests[6].method, 'PUT');
    node_assert_1.default.ok(requests[6].url.includes('state=true'));
    node_assert_1.default.strictEqual(requests[7].method, 'PUT');
    node_assert_1.default.ok(requests[7].url.includes('state=context'));
});
(0, node_test_1.test)('SpotifyApi search normalizes songs, playlists, artists, and albums', async () => {
    const mockSearchData = {
        tracks: {
            items: [
                {
                    id: 't1',
                    name: 'Song A',
                    type: 'track',
                    duration_ms: 180000,
                    uri: 'spotify:track:t1',
                    album: { name: 'Album A', images: [{ url: 'http://img.com/a.jpg' }] },
                    artists: [{ name: 'Artist A' }],
                },
            ],
        },
        playlists: {
            items: [
                {
                    id: 'p1',
                    name: 'Coding Lo-Fi',
                    description: 'Best beats',
                    images: [{ url: 'http://img.com/p.jpg' }],
                    tracks: { total: 42 },
                    uri: 'spotify:playlist:p1',
                    owner: { display_name: 'Spotify' },
                },
            ],
        },
        artists: {
            items: [{ id: 'art1', name: 'Chill Coder', uri: 'spotify:artist:art1', images: [] }],
        },
        albums: {
            items: [{ id: 'alb1', name: 'Synth Album', uri: 'spotify:album:alb1', total_tracks: 10, artists: [{ name: 'Synth' }], images: [] }],
        },
    };
    const mockFetch = async () => ({
        status: 200,
        ok: true,
        json: async () => mockSearchData,
        text: async () => '',
    });
    const api = new spotifyApi_1.SpotifyApi({
        getAccessToken: async () => 'tok',
        fetchFn: mockFetch,
    });
    const results = await api.search('chill');
    node_assert_1.default.strictEqual(results.tracks.length, 1);
    node_assert_1.default.strictEqual(results.tracks[0].name, 'Song A');
    node_assert_1.default.strictEqual(results.playlists.length, 1);
    node_assert_1.default.strictEqual(results.playlists[0].name, 'Coding Lo-Fi');
    node_assert_1.default.strictEqual(results.artists.length, 1);
    node_assert_1.default.strictEqual(results.artists[0].name, 'Chill Coder');
    node_assert_1.default.strictEqual(results.albums.length, 1);
    node_assert_1.default.strictEqual(results.albums[0].name, 'Synth Album');
});
//# sourceMappingURL=spotifyApi.test.js.map
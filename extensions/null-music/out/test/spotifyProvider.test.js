'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const authStore_1 = require("../auth/authStore");
const spotifyAuth_1 = require("../auth/spotifyAuth");
const spotifyProvider_1 = require("../provider/spotify/spotifyProvider");
const testFakes_1 = require("../testFakes");
(0, node_test_1.test)('SpotifyProvider delegates correctly to SpotifyAuth and SpotifyApi', async () => {
    const vault = new testFakes_1.FakeSecretVault();
    const authStore = new authStore_1.AuthStore(vault);
    const auth = new spotifyAuth_1.SpotifyAuth({
        authStore,
        getClientId: () => '',
        openUrl: async () => { },
    });
    let playCalledWith = null;
    const mockApi = {
        getCurrentUser: async () => ({ id: 'u1', name: 'Dev' }),
        getPlaybackState: async () => ({
            isPlaying: true,
            track: { id: 't1', name: 'Track 1' },
            progressMs: 0,
            durationMs: 1000,
            volume: 100,
            shuffle: false,
            repeat: 'off',
            timestamp: Date.now(),
        }),
        isLiked: async (id) => id === 't1',
        play: async (opt) => { playCalledWith = opt; },
        pause: async () => { },
        next: async () => { },
        previous: async () => { },
        seek: async () => { },
        setVolume: async () => { },
        setShuffle: async () => { },
        setRepeatMode: async () => { },
        getUserPlaylists: async () => [],
        getPlaylistTracks: async () => [],
        search: async () => ({ tracks: [], playlists: [], artists: [], albums: [] }),
        saveTrack: async () => { },
        removeTrack: async () => { },
        getDevices: async () => [],
        transferPlayback: async () => { },
    };
    const provider = new spotifyProvider_1.SpotifyProvider(auth, mockApi);
    node_assert_1.default.strictEqual(provider.id, 'spotify');
    node_assert_1.default.strictEqual(provider.displayName, 'Spotify');
    const user = await provider.getCurrentUser();
    node_assert_1.default.strictEqual(user?.name, 'Dev');
    const state = await provider.getPlaybackState();
    node_assert_1.default.strictEqual(state?.isPlaying, true);
    node_assert_1.default.strictEqual(state?.track?.isLiked, true);
    await provider.play({ uri: 'spotify:track:abc' });
    node_assert_1.default.deepStrictEqual(playCalledWith, { uri: 'spotify:track:abc' });
});
//# sourceMappingURL=spotifyProvider.test.js.map
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const lofiProvider_1 = require("../provider/lofi/lofiProvider");
const stations_1 = require("../provider/lofi/stations");
(0, node_test_1.test)('LofiProvider initialization and free authentication', async () => {
    const provider = new lofiProvider_1.LofiProvider();
    node_assert_1.default.strictEqual(provider.id, 'lofi');
    node_assert_1.default.strictEqual(provider.displayName, 'Null Lo-Fi Radio');
    node_assert_1.default.strictEqual(await provider.isAuthenticated(), true);
    node_assert_1.default.strictEqual(await provider.authenticate(), true);
    const user = await provider.getCurrentUser();
    node_assert_1.default.ok(user);
    node_assert_1.default.strictEqual(user.id, 'null-coder');
    node_assert_1.default.strictEqual(user.product, 'free-stream');
});
(0, node_test_1.test)('LofiProvider playback state, stations and audio adapter controls', async () => {
    const playedUrls = [];
    let paused = false;
    let currentVol = 0;
    const audioAdapter = {
        playStream: (url) => {
            playedUrls.push(url);
            paused = false;
        },
        pauseStream: () => {
            paused = true;
        },
        setVolume: (vol) => {
            currentVol = vol;
        },
    };
    const provider = new lofiProvider_1.LofiProvider(audioAdapter);
    // Initial playback state
    const state0 = await provider.getPlaybackState();
    node_assert_1.default.ok(state0);
    node_assert_1.default.strictEqual(state0.isPlaying, false);
    node_assert_1.default.strictEqual(state0.track?.id, stations_1.LOFI_STATIONS[0].id);
    // Play
    await provider.play();
    node_assert_1.default.strictEqual(playedUrls.length, 1);
    node_assert_1.default.strictEqual(playedUrls[0], stations_1.LOFI_STATIONS[0].streamUrl);
    const statePlaying = await provider.getPlaybackState();
    node_assert_1.default.strictEqual(statePlaying?.isPlaying, true);
    // Pause
    await provider.pause();
    node_assert_1.default.strictEqual(paused, true);
    // Next station
    await provider.play();
    await provider.next();
    const stateNext = await provider.getPlaybackState();
    node_assert_1.default.strictEqual(stateNext?.track?.id, stations_1.LOFI_STATIONS[1].id);
    // Previous station
    await provider.previous();
    const statePrev = await provider.getPlaybackState();
    node_assert_1.default.strictEqual(statePrev?.track?.id, stations_1.LOFI_STATIONS[0].id);
    // Volume
    await provider.setVolume(65);
    node_assert_1.default.strictEqual(currentVol, 65);
    const stateVol = await provider.getPlaybackState();
    node_assert_1.default.strictEqual(stateVol?.volume, 65);
});
(0, node_test_1.test)('LofiProvider playlists and search', async () => {
    const provider = new lofiProvider_1.LofiProvider();
    const playlists = await provider.getUserPlaylists();
    node_assert_1.default.strictEqual(playlists.length, stations_1.LOFI_STATIONS.length);
    node_assert_1.default.strictEqual(playlists[0].name, stations_1.LOFI_STATIONS[0].name);
    const tracks = await provider.getPlaylistTracks(stations_1.LOFI_STATIONS[0].id);
    node_assert_1.default.strictEqual(tracks.length, 1);
    node_assert_1.default.strictEqual(tracks[0].id, stations_1.LOFI_STATIONS[0].id);
    const emptyTracks = await provider.getPlaylistTracks('non-existent');
    node_assert_1.default.strictEqual(emptyTracks.length, 0);
    const searchResults = await provider.search('Synthwave');
    node_assert_1.default.ok(searchResults.tracks.length >= 1);
    node_assert_1.default.strictEqual(searchResults.tracks[0].id, 'synthwave');
});
(0, node_test_1.test)('LofiProvider likes management', async () => {
    const provider = new lofiProvider_1.LofiProvider();
    const stationId = stations_1.LOFI_STATIONS[0].id;
    node_assert_1.default.strictEqual(await provider.isLiked(stationId), false);
    await provider.saveTrack(stationId);
    node_assert_1.default.strictEqual(await provider.isLiked(stationId), true);
    const state = await provider.getPlaybackState();
    node_assert_1.default.strictEqual(state?.track?.isLiked, true);
    await provider.removeTrack(stationId);
    node_assert_1.default.strictEqual(await provider.isLiked(stationId), false);
});
//# sourceMappingURL=lofiProvider.test.js.map
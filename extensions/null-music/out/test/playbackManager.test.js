'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const playbackManager_1 = require("../playback/playbackManager");
const testFakes_1 = require("../testFakes");
(0, node_test_1.test)('PlaybackManager refreshes state and fires change events', async () => {
    const fakeProvider = new testFakes_1.FakeMusicProvider('local');
    fakeProvider.state = (0, testFakes_1.makeSamplePlaybackState)({ progressMs: 10000 });
    const notifications = [];
    const manager = new playbackManager_1.PlaybackManager({
        provider: fakeProvider,
        getPollingIntervalMs: () => 10000,
        onNotification: (msg) => notifications.push(msg),
    });
    const states = [];
    const tracks = [];
    manager.onDidChangePlaybackState((s) => states.push(s));
    manager.onDidTrackChange((t) => tracks.push(t));
    await manager.refreshNow();
    node_assert_1.default.ok(states.length >= 1);
    node_assert_1.default.strictEqual(tracks.length, 1);
    node_assert_1.default.strictEqual(tracks[0]?.id, 'track-123');
    node_assert_1.default.strictEqual(notifications.length, 1);
    node_assert_1.default.ok(notifications[0].includes('Ambient Coding'));
    // Controls
    await manager.playPause();
    node_assert_1.default.strictEqual(fakeProvider.state.isPlaying, false);
    await manager.playPause();
    node_assert_1.default.strictEqual(fakeProvider.state.isPlaying, true);
    await manager.seek(25000);
    node_assert_1.default.strictEqual(fakeProvider.state.progressMs, 25000);
    await manager.setVolume(50);
    node_assert_1.default.strictEqual(fakeProvider.state.volume, 50);
    await manager.volumeUp(10);
    node_assert_1.default.strictEqual(fakeProvider.state.volume, 60);
    await manager.volumeDown(20);
    node_assert_1.default.strictEqual(fakeProvider.state.volume, 40);
    await manager.toggleShuffle();
    node_assert_1.default.strictEqual(fakeProvider.state.shuffle, true);
    await manager.toggleRepeat();
    node_assert_1.default.strictEqual(fakeProvider.state.repeat, 'context');
    await manager.toggleRepeat();
    node_assert_1.default.strictEqual(fakeProvider.state.repeat, 'track');
    await manager.toggleRepeat();
    node_assert_1.default.strictEqual(fakeProvider.state.repeat, 'off');
    // Toggle Like
    const liked = await manager.toggleLike();
    node_assert_1.default.strictEqual(liked, true);
    node_assert_1.default.strictEqual(fakeProvider.likedTracks.has('track-123'), true);
    const unliked = await manager.toggleLike();
    node_assert_1.default.strictEqual(unliked, false);
    node_assert_1.default.strictEqual(fakeProvider.likedTracks.has('track-123'), false);
    manager.dispose();
});
//# sourceMappingURL=playbackManager.test.js.map
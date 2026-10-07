'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const playbackManager_1 = require("../playback/playbackManager");
const localProvider_1 = require("../provider/local/localProvider");
const testFakes_1 = require("../testFakes");
const musicViewController_1 = require("../ui/musicViewController");
(0, node_test_1.test)('MusicViewController handles UI messages and delegates to PlaybackManager and LocalProvider', async () => {
    const fakeProvider = new testFakes_1.FakeMusicProvider('local');
    fakeProvider.state = (0, testFakes_1.makeSamplePlaybackState)();
    const playbackManager = new playbackManager_1.PlaybackManager({
        provider: fakeProvider,
    });
    const localProvider = new localProvider_1.LocalMusicProvider();
    localProvider.queueAndPlay([
        {
            id: 'local:file:///music/t1.mp3',
            name: 'Song 1',
            artist: 'Band',
            artists: ['Band'],
            album: 'file:///music',
            durationMs: 100000,
            uri: 'file:///music/t1.mp3',
        },
    ]);
    const postedMessages = [];
    const executedCommands = [];
    const errorMessages = [];
    const messenger = {
        postMessage: (msg) => {
            postedMessages.push(msg);
        },
    };
    const host = {
        executeCommand: async (cmd) => {
            executedCommands.push(cmd);
        },
        showErrorMessage: (msg) => {
            errorMessages.push(msg);
        },
    };
    const controller = new musicViewController_1.MusicViewController(playbackManager, localProvider, messenger, host);
    // Ready message
    await controller.handleMessage({ type: 'ready' });
    node_assert_1.default.ok(postedMessages.some((m) => m.type === 'stateUpdate'));
    node_assert_1.default.ok(postedMessages.some((m) => m.type === 'localLibraryUpdate'));
    // Play / Pause
    await controller.handleMessage({ type: 'playPause' });
    node_assert_1.default.strictEqual(fakeProvider.state.isPlaying, false);
    // Seek
    await controller.handleMessage({ type: 'seek', positionMs: 30000 });
    node_assert_1.default.strictEqual(fakeProvider.state.progressMs, 30000);
    // Volume
    await controller.handleMessage({ type: 'setVolume', volumePercent: 45 });
    node_assert_1.default.strictEqual(fakeProvider.state.volume, 45);
    // Add folder
    await controller.handleMessage({ type: 'localOpenFolder' });
    node_assert_1.default.strictEqual(executedCommands[0], 'null-music.openLocalFolder');
    // Toggle track like
    await controller.handleMessage({ type: 'toggleTrackLike', trackId: 'local:file:///music/t1.mp3' });
    node_assert_1.default.strictEqual(await localProvider.isLiked('local:file:///music/t1.mp3'), true);
    // Play track
    await controller.handleMessage({ type: 'localPlayTrack', trackUri: 'file:///music/t1.mp3' });
    // Audio duration update
    await controller.handleMessage({ type: 'localAudioDuration', durationMs: 125000, trackUri: 'file:///music/t1.mp3' });
    node_assert_1.default.strictEqual(localProvider.getAllTracks()[0].durationMs, 125000);
    // Audio ended
    await controller.handleMessage({ type: 'localAudioEnded' });
    playbackManager.dispose();
});
//# sourceMappingURL=musicViewProvider.test.js.map
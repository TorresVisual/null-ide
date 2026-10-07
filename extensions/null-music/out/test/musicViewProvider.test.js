'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const authStore_1 = require("../auth/authStore");
const playbackManager_1 = require("../playback/playbackManager");
const providerRegistry_1 = require("../provider/providerRegistry");
const testFakes_1 = require("../testFakes");
const musicViewController_1 = require("../ui/musicViewController");
(0, node_test_1.test)('MusicViewController handles UI messages and delegates to PlaybackManager', async () => {
    const vault = new testFakes_1.FakeSecretVault();
    const authStore = new authStore_1.AuthStore(vault);
    const registry = new providerRegistry_1.ProviderRegistry();
    const fakeProvider = new testFakes_1.FakeMusicProvider('spotify');
    fakeProvider.state = (0, testFakes_1.makeSamplePlaybackState)();
    fakeProvider.playlists = [
        { id: 'p1', name: 'Work Focus', trackCount: 50, uri: 'spotify:playlist:p1', owner: 'Me' },
    ];
    registry.register(fakeProvider);
    const playbackManager = new playbackManager_1.PlaybackManager({
        providerRegistry: registry,
    });
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
    const controller = new musicViewController_1.MusicViewController(playbackManager, authStore, messenger, host);
    // Test message handling
    await controller.handleMessage({ type: 'ready' });
    node_assert_1.default.ok(postedMessages.some((m) => m.type === 'authUpdate' && m.isAuthenticated === true));
    node_assert_1.default.ok(postedMessages.some((m) => m.type === 'stateUpdate'));
    await controller.handleMessage({ type: 'signIn' });
    node_assert_1.default.strictEqual(executedCommands[0], 'null-music.signIn');
    await controller.handleMessage({ type: 'signOut' });
    node_assert_1.default.strictEqual(executedCommands[1], 'null-music.signOut');
    await controller.handleMessage({ type: 'playPause' });
    node_assert_1.default.strictEqual(fakeProvider.state.isPlaying, false);
    await controller.handleMessage({ type: 'seek', positionMs: 30000 });
    node_assert_1.default.strictEqual(fakeProvider.state.progressMs, 30000);
    await controller.handleMessage({ type: 'setVolume', volumePercent: 45 });
    node_assert_1.default.strictEqual(fakeProvider.state.volume, 45);
    await controller.handleMessage({ type: 'getPlaylists' });
    node_assert_1.default.ok(postedMessages.some((m) => m.type === 'playlistsUpdate' && m.playlists.length === 1));
    playbackManager.dispose();
});
//# sourceMappingURL=musicViewProvider.test.js.map
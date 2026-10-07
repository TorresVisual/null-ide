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
const player_1 = require("../playback/player");
const uri_1 = require("../uri");
const musicViewController_1 = require("../ui/musicViewController");
const fixtures_1 = require("./fixtures");
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-music-view-'));
(0, node_test_1.after)(() => fs.rmSync(root, { recursive: true, force: true }));
(0, node_test_1.test)('MusicViewController drives the Player and Library from webview messages', async () => {
    const music = path.join(root, 'music');
    fs.mkdirSync(music, { recursive: true });
    fs.writeFileSync(path.join(music, 'Band - One.mp3'), 'x');
    fs.writeFileSync(path.join(music, 'Band - Two.mp3'), 'x');
    const out = new fixtures_1.FakeOutput();
    out.becomeReady();
    const library = new library_1.Library({
        state: new fixtures_1.MemState(),
        cacheFile: path.join(root, 'cache.json'),
        artDir: path.join(root, 'art'),
        extensions: () => ['.mp3'],
    });
    const player = new player_1.Player({ output: out, isLiked: (id) => library.isLiked(id), defaultQueue: () => library.tracks });
    await library.addFolder((0, uri_1.pathToUri)(music));
    const posted = [];
    const commands = [];
    const errors = [];
    const controller = new musicViewController_1.MusicViewController(player, library, { postMessage: (m) => void posted.push(m) }, {
        executeCommand: async (cmd) => void commands.push(cmd),
        showErrorMessage: (m) => void errors.push(m),
        artUrl: (key) => `art:${key}`,
    });
    await controller.handleMessage({ type: 'ready' });
    node_assert_1.default.ok(posted.some((m) => m.type === 'stateUpdate'));
    const lib = posted.find((m) => m.type === 'localLibraryUpdate');
    node_assert_1.default.strictEqual(lib.tracks.length, 2);
    node_assert_1.default.deepStrictEqual(lib.progress, { scanned: 2, total: 2 });
    const [one, two] = library.tracks;
    await controller.handleMessage({ type: 'localPlayTrack', trackUri: two.uri });
    node_assert_1.default.strictEqual(player.getState().track?.id, two.id);
    out.emit({ type: 'play' });
    node_assert_1.default.strictEqual(player.getState().isPlaying, true);
    await controller.handleMessage({ type: 'seek', positionMs: 30000 });
    node_assert_1.default.strictEqual(player.getState().progressMs, 30000);
    await controller.handleMessage({ type: 'setVolume', volumePercent: 45 });
    node_assert_1.default.strictEqual(player.getState().volume, 45);
    await controller.handleMessage({ type: 'toggleTrackLike', trackId: one.id });
    node_assert_1.default.strictEqual(library.isLiked(one.id), true);
    node_assert_1.default.strictEqual(posted.filter((m) => m.type === 'localLibraryUpdate').at(-1).tracks[0].isLiked, true);
    await controller.handleMessage({ type: 'localPlayFolder', folderUri: (0, uri_1.pathToUri)(music) });
    node_assert_1.default.strictEqual(player.getState().track?.id, one.id);
    await controller.handleMessage({ type: 'localOpenFolder' });
    await controller.handleMessage({ type: 'localImportPlaylist' });
    node_assert_1.default.deepStrictEqual(commands, ['null-music.openLocalFolder', 'null-music.importPlaylist']);
    // audio events belong to the output, not the controller: ignored here, never an error
    await controller.handleMessage({ type: 'localAudioError', error: 'boom' });
    await (0, fixtures_1.tick)();
    node_assert_1.default.deepStrictEqual(errors, []);
    player.dispose();
    library.dispose();
});
//# sourceMappingURL=musicViewProvider.test.js.map
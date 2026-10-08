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
const wire_1 = require("../ui/wire");
const fixtures_1 = require("./fixtures");
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-music-view-'));
(0, node_test_1.after)(() => fs.rmSync(root, { recursive: true, force: true }));
async function setup() {
    const music = fs.mkdtempSync(path.join(root, 'music-'));
    fs.writeFileSync(path.join(music, 'Band - One.mp3'), 'x');
    fs.writeFileSync(path.join(music, 'Band - Two.mp3'), 'x');
    fs.writeFileSync(path.join(music, 'Band - Three.mp3'), 'x');
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
    const last = (type) => posted.filter((m) => m.type === type).at(-1);
    return { out, library, player, controller, posted, commands, errors, last, folder: (0, uri_1.pathToUri)(music) };
}
(0, node_test_1.test)('ready sends every snapshot once, with no filesystem uri on the wire', async () => {
    const { controller, posted, library, player } = await setup();
    await controller.handleMessage({ type: 'ready' });
    node_assert_1.default.deepStrictEqual(posted.map((m) => m.type), ['player', 'queue', 'library', 'liked']);
    const lib = posted[2];
    node_assert_1.default.strictEqual(lib.tracks.length, 3);
    node_assert_1.default.deepStrictEqual(lib.scan, { scanned: 3, total: 3 });
    node_assert_1.default.strictEqual(lib.folders[0].trackCount, 3);
    node_assert_1.default.deepStrictEqual(lib.extensions, ['.mp3']);
    node_assert_1.default.ok(lib.tracks.every((t) => !('uri' in t))); // ids are `local:<uri>` by design; only the uri field stays host-side
    player.dispose();
    library.dispose();
});
(0, node_test_1.test)('toWireTrack maps the cover through artUrl and drops the uri', () => {
    const wire = (0, wire_1.toWireTrack)((0, fixtures_1.track)(1, { artKey: 'abc.jpg', trackNo: 3 }), (k) => `art:${k}`);
    node_assert_1.default.strictEqual(wire.artUrl, 'art:abc.jpg');
    node_assert_1.default.strictEqual(wire.trackNo, 3);
    node_assert_1.default.ok(!('uri' in wire));
    node_assert_1.default.strictEqual((0, wire_1.toWireTrack)((0, fixtures_1.track)(2), () => 'x').artUrl, undefined);
});
(0, node_test_1.test)('playTracks starts at the chosen id; shuffle starts anywhere with shuffle on', async () => {
    const { controller, player, library, out } = await setup();
    const [one, two, three] = library.tracks;
    await controller.handleMessage({ type: 'playTracks', ids: [one.id, two.id, three.id], startId: two.id });
    node_assert_1.default.strictEqual(player.getState().track?.id, two.id);
    out.emit({ type: 'play' });
    node_assert_1.default.strictEqual(player.getState().isPlaying, true);
    await controller.handleMessage({ type: 'playTracks', ids: [one.id, 'local:missing', three.id], startId: 'nope', shuffle: true });
    node_assert_1.default.strictEqual(player.queue.shuffle, true);
    node_assert_1.default.strictEqual(player.queue.length, 2); // unknown ids are dropped
    await controller.handleMessage({ type: 'playTracks', ids: ['local:missing'], startId: 'x' });
    node_assert_1.default.strictEqual(player.queue.length, 2); // nothing playable: untouched
    player.dispose();
    library.dispose();
});
(0, node_test_1.test)('transport, like and setup intents reach the Player and Library', async () => {
    const { controller, player, library, commands, errors, last } = await setup();
    const [one] = library.tracks;
    await controller.handleMessage({ type: 'playTracks', ids: library.tracks.map((x) => x.id), startId: one.id });
    await controller.handleMessage({ type: 'seek', positionMs: 30000 });
    node_assert_1.default.strictEqual(player.getState().progressMs, 30000);
    await controller.handleMessage({ type: 'setVolume', volumePercent: 45 });
    node_assert_1.default.strictEqual(player.getState().volume, 45);
    await controller.handleMessage({ type: 'toggleLike', trackId: one.id });
    node_assert_1.default.strictEqual(library.isLiked(one.id), true);
    await controller.handleMessage({ type: 'toggleLike' }); // current track
    node_assert_1.default.strictEqual(library.isLiked(one.id), false);
    controller.sendLiked();
    node_assert_1.default.deepStrictEqual(last('liked').ids, []);
    await controller.handleMessage({ type: 'addFolder' });
    await controller.handleMessage({ type: 'importPlaylist' });
    node_assert_1.default.deepStrictEqual(commands, ['null-music.openLocalFolder', 'null-music.importPlaylist']);
    // audio events belong to WebviewAudioOutput, not the controller: ignored, never an error
    await controller.handleMessage({ type: 'localAudioError', error: 'boom' });
    await controller.handleMessage({ type: 'nonsense' });
    await controller.handleMessage(null);
    await (0, fixtures_1.tick)();
    node_assert_1.default.deepStrictEqual(errors, []);
    player.dispose();
    library.dispose();
});
(0, node_test_1.test)('queue intents jump, remove, reorder and clear by key; reorder is refused while shuffling', async () => {
    const { controller, player, library, last } = await setup();
    await controller.handleMessage({ type: 'playTracks', ids: library.tracks.map((x) => x.id), startId: library.tracks[0].id });
    controller.sendQueue();
    const q = last('queue');
    node_assert_1.default.strictEqual(q.reorderable, true);
    node_assert_1.default.strictEqual(q.upcoming.length, 2);
    const [u1, u2] = q.upcoming;
    await controller.handleMessage({ type: 'queueMove', key: u2.key, beforeKey: u1.key });
    node_assert_1.default.deepStrictEqual(player.queue.snapshot().upcoming.map((e) => e.key), [u2.key, u1.key]);
    await controller.handleMessage({ type: 'queueJump', key: u1.key });
    node_assert_1.default.strictEqual(player.queue.snapshot().current?.key, u1.key);
    await controller.handleMessage({ type: 'toggleShuffle' });
    const before = player.queue.tracks.map((x) => x.id);
    await controller.handleMessage({ type: 'queueMove', key: u2.key, beforeKey: null });
    node_assert_1.default.deepStrictEqual(player.queue.tracks.map((x) => x.id), before);
    await controller.handleMessage({ type: 'toggleShuffle' });
    await controller.handleMessage({ type: 'queueRemove', key: u2.key });
    node_assert_1.default.strictEqual(player.queue.length, 2);
    await controller.handleMessage({ type: 'queueClear' });
    node_assert_1.default.strictEqual(player.queue.length, 0);
    player.dispose();
    library.dispose();
});
(0, node_test_1.test)('queue snapshots are only re-sent when the queue actually changed', async () => {
    const { controller, posted, player, library } = await setup();
    await controller.handleMessage({ type: 'playTracks', ids: library.tracks.map((x) => x.id), startId: library.tracks[0].id });
    controller.sendQueue();
    controller.sendQueue(); // e.g. a position tick
    node_assert_1.default.strictEqual(posted.filter((m) => m.type === 'queue').length, 1);
    await controller.handleMessage({ type: 'next' });
    controller.sendQueue();
    node_assert_1.default.strictEqual(posted.filter((m) => m.type === 'queue').length, 2);
    controller.sendAll(); // a reloaded webview always gets a fresh copy
    node_assert_1.default.strictEqual(posted.filter((m) => m.type === 'queue').length, 3);
    player.dispose();
    library.dispose();
});
(0, node_test_1.test)('unavailable track ids ride on the player snapshot', async () => {
    const { controller, player, library, out, last } = await setup();
    const [one] = library.tracks;
    await controller.handleMessage({ type: 'playTracks', ids: [one.id], startId: one.id });
    out.emit({ type: 'error', message: 'decode', trackUri: one.uri });
    await (0, fixtures_1.tick)();
    controller.sendPlayer();
    node_assert_1.default.deepStrictEqual(last('player').unavailable, [one.id]);
    player.dispose();
    library.dispose();
});
//# sourceMappingURL=musicViewProvider.test.js.map
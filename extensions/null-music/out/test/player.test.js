'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const player_1 = require("../playback/player");
const sessionStore_1 = require("../playback/sessionStore");
const fixtures_1 = require("./fixtures");
const tracks = (n) => Array.from({ length: n }, (_, i) => (0, fixtures_1.track)(i));
function setup(extra = {}) {
    const out = new fixtures_1.FakeOutput();
    const errors = [];
    const skips = [];
    const player = new player_1.Player({
        output: out,
        onError: (m) => errors.push(m),
        onSkipped: (n) => skips.push(n),
        ...extra,
    });
    return { out, player, errors, skips };
}
(0, node_test_1.test)('isPlaying becomes true only on the output play event', async () => {
    const { out, player } = setup();
    out.becomeReady();
    await player.playTracks(tracks(2), 0);
    node_assert_1.default.ok(out.calls.includes('load file:///t0.mp3 @0 play'));
    node_assert_1.default.strictEqual(player.getState().isPlaying, false);
    out.emit({ type: 'play' });
    node_assert_1.default.strictEqual(player.getState().isPlaying, true);
    out.emit({ type: 'pause' });
    node_assert_1.default.strictEqual(player.getState().isPlaying, false);
});
(0, node_test_1.test)('commands before ready are held, then flushed in order once the output is ready', async () => {
    const { out, player } = setup();
    const started = player.playTracks(tracks(2), 0);
    await (0, fixtures_1.tick)();
    node_assert_1.default.deepStrictEqual(out.calls, []);
    out.becomeReady();
    await started;
    node_assert_1.default.deepStrictEqual(out.calls, ['volume 80', 'load file:///t0.mp3 @0 paused', 'play']);
    node_assert_1.default.strictEqual(player.getState().isPlaying, false); // still unconfirmed
});
(0, node_test_1.test)('a view that never becomes ready yields one error and leaves the player paused', async () => {
    const { out, player, errors } = setup();
    out.failReady = true;
    await player.playTracks(tracks(2), 0);
    node_assert_1.default.strictEqual(errors.length, 1);
    node_assert_1.default.deepStrictEqual(out.calls, []);
    node_assert_1.default.strictEqual(player.getState().isPlaying, false);
});
(0, node_test_1.test)('position comes only from output time reports (single clock)', async () => {
    const { out, player } = setup();
    out.becomeReady();
    await player.playTracks(tracks(1), 0);
    out.emit({ type: 'play' });
    out.emit({ type: 'time', positionMs: 42000, trackUri: 'file:///t0.mp3' });
    await new Promise((r) => setTimeout(r, 30));
    node_assert_1.default.strictEqual(player.getState().progressMs, 42000);
});
(0, node_test_1.test)('unplayable files are skipped silently; a full run of failures stops with one error', async () => {
    const { out, player, errors, skips } = setup();
    out.becomeReady();
    const t = tracks(3);
    await player.playTracks(t, 0);
    out.emit({ type: 'error', message: 'decode', trackUri: t[0].uri });
    await (0, fixtures_1.tick)();
    node_assert_1.default.strictEqual(player.getState().track?.id, t[1].id);
    out.emit({ type: 'error', message: 'decode', trackUri: t[0].uri }); // duplicate for the old source: ignored
    await (0, fixtures_1.tick)();
    node_assert_1.default.strictEqual(player.getState().track?.id, t[1].id);
    out.emit({ type: 'error', message: 'decode', trackUri: t[1].uri });
    await (0, fixtures_1.tick)();
    node_assert_1.default.strictEqual(player.getState().track?.id, t[2].id);
    out.emit({ type: 'error', message: 'decode', trackUri: t[2].uri });
    await (0, fixtures_1.tick)();
    node_assert_1.default.deepStrictEqual(skips, [1, 2]);
    node_assert_1.default.strictEqual(errors.length, 1);
    node_assert_1.default.strictEqual(player.getState().isPlaying, false);
});
(0, node_test_1.test)('a successful play resets the skip streak; autoplay-blocked errors never skip', async () => {
    const { out, player, errors, skips } = setup();
    out.becomeReady();
    const t = tracks(3);
    await player.playTracks(t, 0);
    out.emit({ type: 'error', message: 'NotAllowedError', silent: true, trackUri: t[0].uri });
    await (0, fixtures_1.tick)();
    node_assert_1.default.strictEqual(player.getState().track?.id, t[0].id);
    node_assert_1.default.deepStrictEqual(skips, []);
    out.emit({ type: 'play' });
    node_assert_1.default.strictEqual(player.getState().isPlaying, true);
    out.emit({ type: 'error', message: 'decode', trackUri: t[0].uri });
    await (0, fixtures_1.tick)();
    out.emit({ type: 'play' }); // next one plays: streak back to 0
    out.emit({ type: 'error', message: 'decode', trackUri: t[1].uri });
    await (0, fixtures_1.tick)();
    node_assert_1.default.deepStrictEqual(skips, [1, 1]);
    node_assert_1.default.strictEqual(errors.length, 0);
});
(0, node_test_1.test)('ended advances; at the end of the queue it stops on the last track at 0:00', async () => {
    const { out, player } = setup();
    out.becomeReady();
    const t = tracks(2);
    await player.playTracks(t, 0);
    out.emit({ type: 'play' });
    out.emit({ type: 'ended', trackUri: t[0].uri });
    await (0, fixtures_1.tick)();
    node_assert_1.default.strictEqual(player.getState().track?.id, t[1].id);
    node_assert_1.default.strictEqual(out.calls.at(-1), 'load file:///t1.mp3 @0 play');
    out.emit({ type: 'ended', trackUri: t[1].uri });
    await (0, fixtures_1.tick)();
    const s = player.getState();
    node_assert_1.default.strictEqual(s.track?.id, t[1].id);
    node_assert_1.default.strictEqual(s.isPlaying, false);
    node_assert_1.default.strictEqual(s.progressMs, 0);
    node_assert_1.default.ok(out.calls.includes('pause'));
});
(0, node_test_1.test)('repeat=track reloads the same track when it ends', async () => {
    const { out, player } = setup();
    out.becomeReady();
    const t = tracks(2);
    await player.playTracks(t, 0);
    player.toggleRepeat();
    player.toggleRepeat();
    node_assert_1.default.strictEqual(player.getState().repeat, 'track');
    out.emit({ type: 'ended', trackUri: t[0].uri });
    await (0, fixtures_1.tick)();
    node_assert_1.default.strictEqual(player.getState().track?.id, t[0].id);
    node_assert_1.default.strictEqual(out.calls.at(-1), 'load file:///t0.mp3 @0 play');
});
(0, node_test_1.test)('previous restarts after 3 s, otherwise goes back', async () => {
    const { out, player } = setup();
    out.becomeReady();
    const t = tracks(3);
    await player.playTracks(t, 2);
    out.emit({ type: 'time', positionMs: 5000, trackUri: t[2].uri });
    await player.previous();
    node_assert_1.default.strictEqual(player.getState().track?.id, t[2].id);
    node_assert_1.default.strictEqual(out.calls.at(-1), 'seek 0');
    out.emit({ type: 'time', positionMs: 1000, trackUri: t[2].uri });
    await player.previous();
    node_assert_1.default.strictEqual(player.getState().track?.id, t[1].id);
});
(0, node_test_1.test)('next/previous while paused with no view neither reveal it nor start sound', async () => {
    const { out, player } = setup();
    player.queue.replace(tracks(3), 0);
    await player.next();
    node_assert_1.default.strictEqual(player.getState().track?.id, (0, fixtures_1.track)(1).id);
    node_assert_1.default.strictEqual(out.readyChecks, 0);
    node_assert_1.default.deepStrictEqual(out.calls, []);
});
(0, node_test_1.test)('a view that reloads (ready again) comes back paused with the current track loaded', async () => {
    const { out, player } = setup();
    out.becomeReady();
    await player.playTracks(tracks(2), 0);
    out.emit({ type: 'play' });
    out.emit({ type: 'ready' });
    node_assert_1.default.strictEqual(player.getState().isPlaying, false);
    node_assert_1.default.strictEqual(out.calls.at(-1), 'load file:///t0.mp3 @0 paused');
});
(0, node_test_1.test)('Play with an empty queue and empty library is a silent no-op', async () => {
    const { out, player, errors } = setup({ defaultQueue: () => [] });
    await player.play();
    node_assert_1.default.strictEqual(out.readyChecks, 0);
    node_assert_1.default.strictEqual(errors.length, 0);
    node_assert_1.default.strictEqual(player.getState().track, null);
});
(0, node_test_1.test)('Play with an empty queue starts the whole library', async () => {
    const { out, player } = setup({ defaultQueue: () => tracks(2) });
    out.becomeReady();
    await player.play();
    node_assert_1.default.strictEqual(player.getState().track?.id, (0, fixtures_1.track)(0).id);
    node_assert_1.default.ok(out.calls.includes('load file:///t0.mp3 @0 play'));
});
(0, node_test_1.test)('session round-trips and restores paused at the saved position, never autoplaying', async () => {
    const state = new fixtures_1.MemState();
    const t = tracks(3);
    const a = setup({ session: new sessionStore_1.SessionStore(state) });
    a.out.becomeReady();
    await a.player.playTracks(t, 1);
    a.player.setVolume(55);
    a.out.emit({ type: 'time', positionMs: 12000, trackUri: t[1].uri });
    a.player.toggleShuffle();
    a.player.flush();
    const saved = new sessionStore_1.SessionStore(state).load();
    node_assert_1.default.deepStrictEqual(saved, {
        trackIds: t.map((x) => x.id),
        index: 1,
        positionMs: 12000,
        volume: 55,
        shuffle: true,
        repeat: 'off',
    });
    const b = setup();
    b.player.restore(saved, (id) => t.find((x) => x.id === id));
    const s = b.player.getState();
    node_assert_1.default.strictEqual(s.isPlaying, false);
    node_assert_1.default.strictEqual(s.track?.id, t[1].id);
    node_assert_1.default.strictEqual(s.progressMs, 12000);
    node_assert_1.default.strictEqual(s.volume, 55);
    node_assert_1.default.strictEqual(s.shuffle, true);
    node_assert_1.default.deepStrictEqual(b.out.calls, []);
    b.out.becomeReady();
    node_assert_1.default.deepStrictEqual(b.out.calls, ['volume 55', 'load file:///t1.mp3 @12000 paused']);
});
(0, node_test_1.test)('restore drops unknown ids and resets the position when the current track is gone', () => {
    const { player } = setup();
    const t = tracks(3);
    player.restore({ trackIds: [t[0].id, 'gone', t[2].id], index: 1, positionMs: 9000, volume: 80, shuffle: false, repeat: 'off' }, (id) => t.find((x) => x.id === id));
    node_assert_1.default.deepStrictEqual(player.queue.tracks.map((x) => x.name), ['t0', 't2']);
    node_assert_1.default.strictEqual(player.getState().progressMs, 0);
});
(0, node_test_1.test)('corrupt session data loads as undefined', () => {
    const state = new fixtures_1.MemState();
    void state.update('null-music.session', { trackIds: [1, 2] });
    node_assert_1.default.strictEqual(new sessionStore_1.SessionStore(state).load(), undefined);
});
(0, node_test_1.test)('learned durations are reported once the output measures them', async () => {
    const learned = [];
    const { out, player } = setup({ onDuration: (t, ms) => learned.push([t.id, ms]) });
    out.becomeReady();
    const t = tracks(1);
    await player.playTracks(t, 0);
    out.emit({ type: 'duration', durationMs: 201000, trackUri: t[0].uri });
    node_assert_1.default.deepStrictEqual(learned, [[t[0].id, 201000]]);
    node_assert_1.default.strictEqual(player.getState().durationMs, 201000);
});
//# sourceMappingURL=player.test.js.map
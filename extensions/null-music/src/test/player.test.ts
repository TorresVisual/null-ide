'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Player } from '../playback/player';
import { SessionStore } from '../playback/sessionStore';
import { FakeOutput, MemState, tick, track } from './fixtures';

const tracks = (n: number) => Array.from({ length: n }, (_, i) => track(i));

function setup(extra: Partial<ConstructorParameters<typeof Player>[0]> = {}) {
  const out = new FakeOutput();
  const errors: string[] = [];
  const skips: number[] = [];
  const player = new Player({
    output: out,
    onError: (m) => errors.push(m),
    onSkipped: (n) => skips.push(n),
    ...extra,
  });
  return { out, player, errors, skips };
}

test('isPlaying becomes true only on the output play event', async () => {
  const { out, player } = setup();
  out.becomeReady();
  await player.playTracks(tracks(2), 0);
  assert.ok(out.calls.includes('load file:///t0.mp3 @0 play'));
  assert.strictEqual(player.getState().isPlaying, false);
  out.emit({ type: 'play' });
  assert.strictEqual(player.getState().isPlaying, true);
  out.emit({ type: 'pause' });
  assert.strictEqual(player.getState().isPlaying, false);
});

test('commands before ready are held, then flushed in order once the output is ready', async () => {
  const { out, player } = setup();
  const started = player.playTracks(tracks(2), 0);
  await tick();
  assert.deepStrictEqual(out.calls, []);
  out.becomeReady();
  await started;
  assert.deepStrictEqual(out.calls, ['volume 80', 'load file:///t0.mp3 @0 paused', 'play']);
  assert.strictEqual(player.getState().isPlaying, false); // still unconfirmed
});

test('a view that never becomes ready yields one error and leaves the player paused', async () => {
  const { out, player, errors } = setup();
  out.failReady = true;
  await player.playTracks(tracks(2), 0);
  assert.strictEqual(errors.length, 1);
  assert.deepStrictEqual(out.calls, []);
  assert.strictEqual(player.getState().isPlaying, false);
});

test('position comes only from output time reports (single clock)', async () => {
  const { out, player } = setup();
  out.becomeReady();
  await player.playTracks(tracks(1), 0);
  out.emit({ type: 'play' });
  out.emit({ type: 'time', positionMs: 42000, trackUri: 'file:///t0.mp3' });
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(player.getState().progressMs, 42000);
});

test('unplayable files are skipped silently; a full run of failures stops with one error', async () => {
  const { out, player, errors, skips } = setup();
  out.becomeReady();
  const t = tracks(3);
  await player.playTracks(t, 0);
  out.emit({ type: 'error', message: 'decode', trackUri: t[0].uri });
  await tick();
  assert.strictEqual(player.getState().track?.id, t[1].id);
  out.emit({ type: 'error', message: 'decode', trackUri: t[0].uri }); // duplicate for the old source: ignored
  await tick();
  assert.strictEqual(player.getState().track?.id, t[1].id);
  out.emit({ type: 'error', message: 'decode', trackUri: t[1].uri });
  await tick();
  assert.strictEqual(player.getState().track?.id, t[2].id);
  out.emit({ type: 'error', message: 'decode', trackUri: t[2].uri });
  await tick();
  assert.deepStrictEqual(skips, [1, 2]);
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(player.getState().isPlaying, false);
});

test('a successful play resets the skip streak; autoplay-blocked errors never skip', async () => {
  const { out, player, errors, skips } = setup();
  out.becomeReady();
  const t = tracks(3);
  await player.playTracks(t, 0);
  out.emit({ type: 'error', message: 'NotAllowedError', silent: true, trackUri: t[0].uri });
  await tick();
  assert.strictEqual(player.getState().track?.id, t[0].id);
  assert.deepStrictEqual(skips, []);
  out.emit({ type: 'play' });
  assert.strictEqual(player.getState().isPlaying, true);
  out.emit({ type: 'error', message: 'decode', trackUri: t[0].uri });
  await tick();
  out.emit({ type: 'play' }); // next one plays: streak back to 0
  out.emit({ type: 'error', message: 'decode', trackUri: t[1].uri });
  await tick();
  assert.deepStrictEqual(skips, [1, 1]);
  assert.strictEqual(errors.length, 0);
});

test('ended advances; at the end of the queue it stops on the last track at 0:00', async () => {
  const { out, player } = setup();
  out.becomeReady();
  const t = tracks(2);
  await player.playTracks(t, 0);
  out.emit({ type: 'play' });
  out.emit({ type: 'ended', trackUri: t[0].uri });
  await tick();
  assert.strictEqual(player.getState().track?.id, t[1].id);
  assert.strictEqual(out.calls.at(-1), 'load file:///t1.mp3 @0 play');
  out.emit({ type: 'ended', trackUri: t[1].uri });
  await tick();
  const s = player.getState();
  assert.strictEqual(s.track?.id, t[1].id);
  assert.strictEqual(s.isPlaying, false);
  assert.strictEqual(s.progressMs, 0);
  assert.ok(out.calls.includes('pause'));
});

test('repeat=track reloads the same track when it ends', async () => {
  const { out, player } = setup();
  out.becomeReady();
  const t = tracks(2);
  await player.playTracks(t, 0);
  player.toggleRepeat();
  player.toggleRepeat();
  assert.strictEqual(player.getState().repeat, 'track');
  out.emit({ type: 'ended', trackUri: t[0].uri });
  await tick();
  assert.strictEqual(player.getState().track?.id, t[0].id);
  assert.strictEqual(out.calls.at(-1), 'load file:///t0.mp3 @0 play');
});

test('previous restarts after 3 s, otherwise goes back', async () => {
  const { out, player } = setup();
  out.becomeReady();
  const t = tracks(3);
  await player.playTracks(t, 2);
  out.emit({ type: 'time', positionMs: 5000, trackUri: t[2].uri });
  await player.previous();
  assert.strictEqual(player.getState().track?.id, t[2].id);
  assert.strictEqual(out.calls.at(-1), 'seek 0');
  out.emit({ type: 'time', positionMs: 1000, trackUri: t[2].uri });
  await player.previous();
  assert.strictEqual(player.getState().track?.id, t[1].id);
});

test('next/previous while paused with no view neither reveal it nor start sound', async () => {
  const { out, player } = setup();
  player.queue.replace(tracks(3), 0);
  await player.next();
  assert.strictEqual(player.getState().track?.id, track(1).id);
  assert.strictEqual(out.readyChecks, 0);
  assert.deepStrictEqual(out.calls, []);
});

test('a view that reloads (ready again) comes back paused with the current track loaded', async () => {
  const { out, player } = setup();
  out.becomeReady();
  await player.playTracks(tracks(2), 0);
  out.emit({ type: 'play' });
  out.emit({ type: 'ready' });
  assert.strictEqual(player.getState().isPlaying, false);
  assert.strictEqual(out.calls.at(-1), 'load file:///t0.mp3 @0 paused');
});

test('Play with an empty queue and empty library is a silent no-op', async () => {
  const { out, player, errors } = setup({ defaultQueue: () => [] });
  await player.play();
  assert.strictEqual(out.readyChecks, 0);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(player.getState().track, null);
});

test('Play with an empty queue starts the whole library', async () => {
  const { out, player } = setup({ defaultQueue: () => tracks(2) });
  out.becomeReady();
  await player.play();
  assert.strictEqual(player.getState().track?.id, track(0).id);
  assert.ok(out.calls.includes('load file:///t0.mp3 @0 play'));
});

test('session round-trips and restores paused at the saved position, never autoplaying', async () => {
  const state = new MemState();
  const t = tracks(3);
  const a = setup({ session: new SessionStore(state) });
  a.out.becomeReady();
  await a.player.playTracks(t, 1);
  a.player.setVolume(55);
  a.out.emit({ type: 'time', positionMs: 12000, trackUri: t[1].uri });
  a.player.toggleShuffle();
  a.player.flush();

  const saved = new SessionStore(state).load();
  assert.deepStrictEqual(saved, {
    trackIds: t.map((x) => x.id),
    index: 1,
    positionMs: 12000,
    volume: 55,
    shuffle: true,
    repeat: 'off',
  });

  const b = setup();
  b.player.restore(saved!, (id) => t.find((x) => x.id === id));
  const s = b.player.getState();
  assert.strictEqual(s.isPlaying, false);
  assert.strictEqual(s.track?.id, t[1].id);
  assert.strictEqual(s.progressMs, 12000);
  assert.strictEqual(s.volume, 55);
  assert.strictEqual(s.shuffle, true);
  assert.deepStrictEqual(b.out.calls, []);
  b.out.becomeReady();
  assert.deepStrictEqual(b.out.calls, ['volume 55', 'load file:///t1.mp3 @12000 paused']);
});

test('restore drops unknown ids and resets the position when the current track is gone', () => {
  const { player } = setup();
  const t = tracks(3);
  player.restore(
    { trackIds: [t[0].id, 'gone', t[2].id], index: 1, positionMs: 9000, volume: 80, shuffle: false, repeat: 'off' },
    (id) => t.find((x) => x.id === id)
  );
  assert.deepStrictEqual(player.queue.tracks.map((x) => x.name), ['t0', 't2']);
  assert.strictEqual(player.getState().progressMs, 0);
});

test('corrupt session data loads as undefined', () => {
  const state = new MemState();
  void state.update('null-music.session', { trackIds: [1, 2] });
  assert.strictEqual(new SessionStore(state).load(), undefined);
});

test('learned durations are reported once the output measures them', async () => {
  const learned: Array<[string, number]> = [];
  const { out, player } = setup({ onDuration: (t, ms) => learned.push([t.id, ms]) });
  out.becomeReady();
  const t = tracks(1);
  await player.playTracks(t, 0);
  out.emit({ type: 'duration', durationMs: 201000, trackUri: t[0].uri });
  assert.deepStrictEqual(learned, [[t[0].id, 201000]]);
  assert.strictEqual(player.getState().durationMs, 201000);
});

test('an unplayable file during a paused or restored load advances paused, never autoplaying', async () => {
  const t = tracks(3);
  const { out, player } = setup();
  player.restore({ trackIds: t.map((x) => x.id), index: 1, positionMs: 5000, volume: 50, shuffle: false, repeat: 'off' }, (id) => t.find((x) => x.id === id));
  out.becomeReady();
  out.emit({ type: 'error', message: 'gone', silent: false, trackUri: t[1].uri });
  await tick();
  assert.strictEqual(player.getState().track?.id, t[2].id);
  assert.ok(out.calls.every((c) => !c.endsWith(' play') && c !== 'play'), out.calls.join(' | '));
});

test('a pause pressed while the view is still being revealed cancels the pending play', async () => {
  const { out, player } = setup();
  const started = player.playTracks(tracks(2), 0);
  await tick();
  player.pause(); // output not ready: nothing to send, but the intent changed
  out.becomeReady();
  await started;
  assert.ok(out.calls.every((c) => !c.endsWith(' play') && c !== 'play'), out.calls.join(' | '));
  assert.strictEqual(player.getState().isPlaying, false);
});

function readyPlayer() {
  const out = new FakeOutput();
  out.becomeReady();
  return { out, player: new Player({ output: out }) };
}
const upcomingKeys = (p: Player) => p.queue.snapshot().upcoming.map((e) => e.key);

test('jump starts the chosen entry and removeFromQueue of a non-current entry keeps playing', async () => {
  const { out, player } = readyPlayer();
  await player.playTracks([track(0), track(1), track(2)], 0);
  out.emit({ type: 'play' });
  const [k1, k2] = upcomingKeys(player);
  await player.jump(k2);
  assert.strictEqual(player.getState().track?.name, 't2');
  assert.ok(out.calls.at(-1)?.startsWith('load file:///t2.mp3 @0 play'));
  await player.removeFromQueue(k1);
  assert.strictEqual(player.getState().track?.name, 't2');
  assert.strictEqual(player.queue.length, 2);
});

test('removing the playing entry starts its successor; removing the last one stops cleanly', async () => {
  const { out, player } = readyPlayer();
  await player.playTracks([track(0), track(1)], 0);
  out.emit({ type: 'play' });
  await player.removeFromQueue(player.queue.snapshot().current!.key);
  assert.strictEqual(player.getState().track?.name, 't1');
  assert.ok(out.calls.at(-1)?.startsWith('load file:///t1.mp3 @0 play'));
  out.emit({ type: 'play' });
  await player.removeFromQueue(player.queue.snapshot().current!.key);
  assert.strictEqual(player.getState().track, null);
  assert.strictEqual(player.getState().isPlaying, false);
  assert.ok(out.calls.includes('pause'));
});

test('clearQueue empties the queue and stops', async () => {
  const { out, player } = readyPlayer();
  await player.playTracks([track(0), track(1)], 0);
  out.emit({ type: 'play' });
  player.clearQueue();
  assert.strictEqual(player.queue.length, 0);
  assert.strictEqual(player.getState().isPlaying, false);
  assert.strictEqual(player.getState().track, null);
});

test('moveInQueue reorders upcoming entries', async () => {
  const { player } = readyPlayer();
  await player.playTracks([track(0), track(1), track(2)], 0);
  const [k1, k2] = upcomingKeys(player);
  player.moveInQueue(k2, k1);
  assert.deepStrictEqual(player.queue.tracks.map((t) => t.name), ['t0', 't2', 't1']);
});

test('a track the output fails on is marked unavailable until it plays', async () => {
  const { out, player } = readyPlayer();
  const only = track(0);
  await player.playTracks([only], 0);
  out.emit({ type: 'error', message: 'decode', trackUri: only.uri });
  await tick();
  assert.ok(player.unavailable.has(only.id));
  await player.play();
  out.emit({ type: 'play' });
  assert.strictEqual(player.unavailable.size, 0);
});

test('removing the playing last entry stops instead of replaying an earlier track', async () => {
  const { out, player } = readyPlayer();
  await player.playTracks([track(0), track(1), track(2)], 0);
  out.emit({ type: 'play' });
  await player.next();
  out.emit({ type: 'play' });
  await player.next();
  out.emit({ type: 'play' });
  await player.removeFromQueue(player.queue.snapshot().current!.key);
  assert.strictEqual(player.getState().track, null);
  assert.strictEqual(player.getState().isPlaying, false);
});

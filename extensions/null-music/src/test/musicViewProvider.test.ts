'use strict';

import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { after, test } from 'node:test';
import { Library } from '../library/library';
import { Player } from '../playback/player';
import { pathToUri } from '../uri';
import { MusicViewController } from '../ui/musicViewController';
import { toWireTrack } from '../ui/wire';
import { track as makeTrack, FakeOutput, MemState, tick } from './fixtures';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-music-view-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

async function setup() {
  const music = fs.mkdtempSync(path.join(root, 'music-'));
  fs.writeFileSync(path.join(music, 'Band - One.mp3'), 'x');
  fs.writeFileSync(path.join(music, 'Band - Two.mp3'), 'x');
  fs.writeFileSync(path.join(music, 'Band - Three.mp3'), 'x');
  const out = new FakeOutput();
  out.becomeReady();
  const library = new Library({
    state: new MemState(),
    cacheFile: path.join(root, 'cache.json'),
    artDir: path.join(root, 'art'),
    extensions: () => ['.mp3'],
  });
  const player = new Player({ output: out, isLiked: (id) => library.isLiked(id), defaultQueue: () => library.tracks });
  await library.addFolder(pathToUri(music));
  const posted: any[] = [];
  const commands: string[] = [];
  const errors: string[] = [];
  const controller = new MusicViewController(
    player,
    library,
    { postMessage: (m) => void posted.push(m) },
    {
      executeCommand: async (cmd) => void commands.push(cmd),
      showErrorMessage: (m) => void errors.push(m),
      artUrl: (key) => `art:${key}`,
    }
  );
  const last = (type: string) => posted.filter((m) => m.type === type).at(-1);
  return { out, library, player, controller, posted, commands, errors, last, folder: pathToUri(music) };
}

test('ready sends every snapshot once, with no filesystem uri on the wire', async () => {
  const { controller, posted, library, player } = await setup();
  await controller.handleMessage({ type: 'ready' });
  assert.deepStrictEqual(posted.map((m) => m.type), ['player', 'queue', 'library', 'liked']);
  const lib = posted[2];
  assert.strictEqual(lib.tracks.length, 3);
  assert.deepStrictEqual(lib.scan, { scanned: 3, total: 3, active: false });
  assert.strictEqual(lib.folders[0].trackCount, 3);
  assert.deepStrictEqual(lib.extensions, ['.mp3']);
  assert.ok(lib.tracks.every((t: object) => !('uri' in t))); // ids are `local:<uri>` by design; only the uri field stays host-side
  player.dispose();
  library.dispose();
});

test('toWireTrack maps the cover through artUrl and drops the uri', () => {
  const wire = toWireTrack(makeTrack(1, { artKey: 'abc.jpg', trackNo: 3 }), (k) => `art:${k}`);
  assert.strictEqual(wire.artUrl, 'art:abc.jpg');
  assert.strictEqual(wire.trackNo, 3);
  assert.ok(!('uri' in wire));
  assert.strictEqual(toWireTrack(makeTrack(2), () => 'x').artUrl, undefined);
});

test('playTracks starts at the chosen id; shuffle starts anywhere with shuffle on', async () => {
  const { controller, player, library, out } = await setup();
  const [one, two, three] = library.tracks;
  await controller.handleMessage({ type: 'playTracks', ids: [one.id, two.id, three.id], startId: two.id });
  assert.strictEqual(player.getState().track?.id, two.id);
  out.emit({ type: 'play' });
  assert.strictEqual(player.getState().isPlaying, true);
  await controller.handleMessage({ type: 'playTracks', ids: [one.id, 'local:missing', three.id], startId: 'nope', shuffle: true });
  assert.strictEqual(player.queue.shuffle, true);
  assert.strictEqual(player.queue.length, 2); // unknown ids are dropped
  await controller.handleMessage({ type: 'playTracks', ids: ['local:missing'], startId: 'x' });
  assert.strictEqual(player.queue.length, 2); // nothing playable: untouched
  player.dispose();
  library.dispose();
});

test('transport, like and setup intents reach the Player and Library', async () => {
  const { controller, player, library, commands, errors, last } = await setup();
  const [one] = library.tracks;
  await controller.handleMessage({ type: 'playTracks', ids: library.tracks.map((x) => x.id), startId: one.id });
  await controller.handleMessage({ type: 'seek', positionMs: 30000 });
  assert.strictEqual(player.getState().progressMs, 30000);
  await controller.handleMessage({ type: 'setVolume', volumePercent: 45 });
  assert.strictEqual(player.getState().volume, 45);
  await controller.handleMessage({ type: 'toggleLike', trackId: one.id });
  assert.strictEqual(library.isLiked(one.id), true);
  await controller.handleMessage({ type: 'toggleLike' }); // current track
  assert.strictEqual(library.isLiked(one.id), false);
  controller.sendLiked();
  assert.deepStrictEqual(last('liked').ids, []);
  await controller.handleMessage({ type: 'addFolder' });
  await controller.handleMessage({ type: 'importPlaylist' });
  assert.deepStrictEqual(commands, ['null-music.openLocalFolder', 'null-music.importPlaylist']);
  // audio events belong to WebviewAudioOutput, not the controller: ignored, never an error
  await controller.handleMessage({ type: 'localAudioError', error: 'boom' });
  await controller.handleMessage({ type: 'nonsense' });
  await controller.handleMessage(null);
  await tick();
  assert.deepStrictEqual(errors, []);
  player.dispose();
  library.dispose();
});

test('queue intents jump, remove, reorder and clear by key; reorder is refused while shuffling', async () => {
  const { controller, player, library, last } = await setup();
  await controller.handleMessage({ type: 'playTracks', ids: library.tracks.map((x) => x.id), startId: library.tracks[0].id });
  controller.sendQueue();
  const q = last('queue');
  assert.strictEqual(q.reorderable, true);
  assert.strictEqual(q.upcoming.length, 2);
  const [u1, u2] = q.upcoming;

  await controller.handleMessage({ type: 'queueMove', key: u2.key, beforeKey: u1.key });
  assert.deepStrictEqual(player.queue.snapshot().upcoming.map((e) => e.key), [u2.key, u1.key]);

  await controller.handleMessage({ type: 'queueJump', key: u1.key });
  assert.strictEqual(player.queue.snapshot().current?.key, u1.key);

  await controller.handleMessage({ type: 'toggleShuffle' });
  const before = player.queue.tracks.map((x) => x.id);
  await controller.handleMessage({ type: 'queueMove', key: u2.key, beforeKey: null });
  assert.deepStrictEqual(player.queue.tracks.map((x) => x.id), before);
  await controller.handleMessage({ type: 'toggleShuffle' });

  await controller.handleMessage({ type: 'queueRemove', key: u2.key });
  assert.strictEqual(player.queue.length, 2);
  await controller.handleMessage({ type: 'queueClear' });
  assert.strictEqual(player.queue.length, 0);
  player.dispose();
  library.dispose();
});

test('queue snapshots are only re-sent when the queue actually changed', async () => {
  const { controller, posted, player, library } = await setup();
  await controller.handleMessage({ type: 'playTracks', ids: library.tracks.map((x) => x.id), startId: library.tracks[0].id });
  controller.sendQueue();
  controller.sendQueue(); // e.g. a position tick
  assert.strictEqual(posted.filter((m) => m.type === 'queue').length, 1);
  await controller.handleMessage({ type: 'next' });
  controller.sendQueue();
  assert.strictEqual(posted.filter((m) => m.type === 'queue').length, 2);
  controller.sendAll(); // a reloaded webview always gets a fresh copy
  assert.strictEqual(posted.filter((m) => m.type === 'queue').length, 3);
  player.dispose();
  library.dispose();
});

test('unavailable track ids ride on the player snapshot', async () => {
  const { controller, player, library, out, last } = await setup();
  const [one] = library.tracks;
  await controller.handleMessage({ type: 'playTracks', ids: [one.id], startId: one.id });
  out.emit({ type: 'error', message: 'decode', trackUri: one.uri });
  await tick();
  controller.sendPlayer();
  assert.deepStrictEqual(last('player').unavailable, [one.id]);
  player.dispose();
  library.dispose();
});

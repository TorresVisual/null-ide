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
import { FakeOutput, MemState, tick } from './fixtures';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-music-view-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('MusicViewController drives the Player and Library from webview messages', async () => {
  const music = path.join(root, 'music');
  fs.mkdirSync(music, { recursive: true });
  fs.writeFileSync(path.join(music, 'Band - One.mp3'), 'x');
  fs.writeFileSync(path.join(music, 'Band - Two.mp3'), 'x');

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

  await controller.handleMessage({ type: 'ready' });
  assert.ok(posted.some((m) => m.type === 'stateUpdate'));
  const lib = posted.find((m) => m.type === 'localLibraryUpdate');
  assert.strictEqual(lib.tracks.length, 2);
  assert.deepStrictEqual(lib.progress, { scanned: 2, total: 2 });

  const [one, two] = library.tracks;
  await controller.handleMessage({ type: 'localPlayTrack', trackUri: two.uri });
  assert.strictEqual(player.getState().track?.id, two.id);
  out.emit({ type: 'play' });
  assert.strictEqual(player.getState().isPlaying, true);

  await controller.handleMessage({ type: 'seek', positionMs: 30000 });
  assert.strictEqual(player.getState().progressMs, 30000);
  await controller.handleMessage({ type: 'setVolume', volumePercent: 45 });
  assert.strictEqual(player.getState().volume, 45);

  await controller.handleMessage({ type: 'toggleTrackLike', trackId: one.id });
  assert.strictEqual(library.isLiked(one.id), true);
  assert.strictEqual(posted.filter((m) => m.type === 'localLibraryUpdate').at(-1).tracks[0].isLiked, true);

  await controller.handleMessage({ type: 'localPlayFolder', folderUri: pathToUri(music) });
  assert.strictEqual(player.getState().track?.id, one.id);

  await controller.handleMessage({ type: 'localOpenFolder' });
  await controller.handleMessage({ type: 'localImportPlaylist' });
  assert.deepStrictEqual(commands, ['null-music.openLocalFolder', 'null-music.importPlaylist']);

  // audio events belong to the output, not the controller: ignored here, never an error
  await controller.handleMessage({ type: 'localAudioError', error: 'boom' });
  await tick();
  assert.deepStrictEqual(errors, []);

  player.dispose();
  library.dispose();
});
